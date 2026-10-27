import fs from 'node:fs/promises';
import path from 'node:path';
import {digest, requireText, exists, readJSON, locked, safeId} from './io.mjs';
import {caseContent, caseId} from './experience-case.mjs';
import {experienceCaseSchema} from './experience-schema.mjs';
import {durableJSON} from './durable-json.mjs';
import {experiencePage} from './site-rules.mjs';

export function taskLesson(task, lesson, actor) {
  if(task.sourceKind==='local' && lesson.learning?.transferable===true && !['coupon','app','games'].includes(task.config.siteType))
    throw Error('Determine the actual site type before creating a reusable local reference');
  const candidate = task.candidates.at(-1);
  if (!candidate) throw Error('No candidate to learn from');
  const corrections = task.feedback.filter((f) => f.decision === 'revise'),
    repairs = (task.events || []).filter((e) => e.type === 'repair');
  if (!corrections.length && !repairs.length)
    throw Error('A lesson needs actual correction feedback or repair history');
  const requested =
    lesson.checkIds ||
    task.checks
      .filter((c) =>
        lesson.pages?.includes(
          task.config.pages.find((p) => p.id === c.page)?.family,
        ),
      )
      .map((c) => c.id);
  if (
    !requested.length ||
    requested.some((id) => !task.checks.some((c) => c.id === id))
  )
    throw Error(
      'Bind each lesson to actual affected check IDs or page families',
    );
  const selected = task.checks.filter((c) => requested.includes(c.id));
  const pages = [
    ...new Set(
      selected.map(
        (c) => task.config.pages.find((p) => p.id === c.page)?.family,
      ),
    ),
  ].sort();
  if (pages.some((p) => !p) || lesson.pages?.some((p) => !pages.includes(p)))
    throw Error('Lesson page scope exceeds its actual affected checks');
  const approvalFeedback=[...task.feedback].reverse().find(f=>f.decision==='approve'&&f.candidate===candidate.hash),
    approved = task.approval?.candidate === candidate.hash && Boolean(approvalFeedback),
    requestedClassification = lesson.classification || 'general',
    classification = task.sourceKind==='local' && lesson.learning?.transferable===true && requestedClassification!=='site-preference' ? 'local-reference' : requestedClassification;
  const entry = {
    summary: requireText(lesson.summary, 'Summary'),
    cause: requireText(lesson.cause, 'Confirmed cause'),
    prevention: requireText(lesson.prevention, 'Actionable prevention'),
    actor: requireText(actor, 'Actor'),
    classification,
    scope: {pages:pages.map(p=>experiencePage(task.config.siteType,p)), site: task.repo, component: lesson.component},
    learning: lesson.learning,
    source: {site: task.repo, task: task.id, checkIds: requested},
    evidence: [
      ...corrections.map((f) => ({
        candidate: f.candidate,
        feedback: f.text,
        feedbackId: f.id,
      })),
      ...repairs.map((e) => ({
        candidate: e.from,
        files: e.files,
        at: e.at,
        source: 'recorded-repair',
      })),
      {
        candidate: candidate.hash,
        sourceHash: digest(candidate.source),
        artifactHash: candidate.artifactHash,
      },
    ],
    verification: {
      retested: selected.every(
        (c) =>
          task.results[c.id]?.candidate === candidate.hash &&
          task.results[c.id].status === 'pass',
      ),
      designerApproved: approved,
      candidate: candidate.hash,
      pages:pages.map(p=>experiencePage(task.config.siteType,p)),
    },
    ...(approved
      ? {
          approval: {
            decision: 'approve',
            actor: task.approval.actor,
            text: task.approval.text,
            candidate: candidate.hash,
            at: task.approval.at,
            feedbackId: approvalFeedback.id,
          },
        }
      : {}),
  };
  return caseContent(experienceCaseSchema.parse(entry));
}
export function feedbackCases(task) {
  const feedback = task.feedback.at(-1);
  if (!feedback) throw Error('No actual designer feedback');
  if (feedback.decision === 'approve' && feedback.lessons?.length)
    return feedback.lessons.map((l) => taskLesson(task, l, feedback.actor));
  return [
    caseContent(
      experienceCaseSchema.parse({
        summary: feedback.text,
        cause: 'Pending investigation; preserve actual feedback',
        prevention:
          'Pending verified correction; do not treat raw feedback as a rule',
        actor: feedback.actor,
        classification: 'unclassified',
        scope: {
          pages: [...new Set(task.config.pages.map((p) => experiencePage(task.config.siteType,p.family)))],
          site: task.repo,
        },
        evidence: [
          {
            candidate: feedback.candidate,
            feedbackId: feedback.id,
            decision: feedback.decision,
            ...(feedback.learningDecision
              ? {learningDecision: feedback.learningDecision}
              : {}),
          },
        ],
        verification: {retested: false, designerApproved: false},
      }),
    ),
  ];
}
export function stageFeedback(task, entries = feedbackCases(task)) {
  const feedbackId = task.feedback.at(-1)?.id || 'draft';
  const jobs = entries.map((entry) => ({
    id: caseId(entry),
    entry,
    feedbackId,
    delivered: false,
  }));
  return {
    ...task,
    experienceDeliveries: [
      ...(task.experienceDeliveries || []),
      ...jobs.filter(
        (j) => !task.experienceDeliveries?.some((old) => old.id === j.id),
      ),
    ],
  };
}
export async function markTaskDelivered(data, taskId, id, result) {
  const directory = path.join(data, 'tasks', safeId(taskId)),
    file = path.join(directory, 'task.json');
  if (!(await exists(file))) return;
  await locked(directory, async () => {
    const task = await readJSON(file);
    const jobs = (task.experienceDeliveries || []).map((j) =>
      j.id === id
        ? {
            ...j,
            delivered: true,
            result: {
              id: result.id,
              status: result.status,
              shared: result.shared === true,
              lessons: result.lessons,
              review: result.review,
            },
          }
        : j,
    );
    await durableJSON(file, {...task, experienceDeliveries: jobs});
  });
}
export async function recoverTaskDeliveries(
  data,
  enqueue,
  receipt,
  seen = new Map(),
) {
  const tasks = path.join(data, 'tasks');
  if (!(await exists(tasks))) return;
  for (const directory of await fs.readdir(tasks, {withFileTypes: true})) {
    if (!directory.isDirectory()) continue;
    const file = path.join(tasks, directory.name, 'task.json');
    if (!(await exists(file))) continue;
    let task;
    try {
      const modified = (await fs.stat(file)).mtimeMs;
      const cached = seen.get(file);
      task = cached?.modified === modified ? cached.task : await readJSON(file);
      seen.set(file, {
        modified,
        task: {
          id: task.id,
          experienceDeliveries: (task.experienceDeliveries || []).filter(
            (j) => !j.delivered,
          ),
        },
      });
    } catch (error) {
      await durableJSON(
        path.join(data, 'experience-recovery-errors', directory.name + '.json'),
        {
          task: directory.name,
          error: error.message,
          at: new Date().toISOString(),
        },
      );
      continue;
    }
    for (const job of task.experienceDeliveries || []) {
      if (job.delivered) continue;
      const confirmed = await receipt(job.id);
      if (confirmed) {
        try {
          await markTaskDelivered(data, task.id, job.id, confirmed);
        } catch (error) {
          if (!error.message.startsWith('Another operation')) throw error;
        }
        continue;
      }
      await enqueue(job.entry, {
        taskId: directory.name,
        feedbackId: job.feedbackId,
      });
    }
  }
}
