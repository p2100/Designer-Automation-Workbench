import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright-core';
import {workbench} from '../bin/workbench.mjs';
import {generate} from '../bin/generate.mjs';
import {generationGamesPlan} from '../lib/generation.mjs';
import {loadTask, recordObservations} from '../lib/workbench.mjs';
import {reviewChecks} from '../lib/adjustment.mjs';
import {serveCandidate} from '../lib/audit.mjs';
import {stopPreview} from '../lib/preview.mjs';
import {ExperienceStore} from '../lib/experience-memory.mjs';
import {startExperienceServer} from '../lib/experience-server.mjs';
import {root, writeJSON} from '../lib/io.mjs';
import {actionLesson, createReplaySource, measureActionFamily, replayConfig, stableActionStyles, testApproval, testFeedback} from './fixtures/experience-loop/replay.mjs';

const executable = process.env.SITE_BROWSER_EXECUTABLE;
const fixtureActor = 'TEST protocol replay designer';

async function until(check, description) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Timed out: ' + description);
}

async function scenario(t, siteType) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'da-experience-loop-' + siteType + '-'));
  const data = path.join(directory, 'data');
  const storeDirectory = path.join(directory, 'isolated-experience-store');
  let service = await startExperienceServer({store: new ExperienceStore(storeDirectory), allowAnonymous: true});
  const url = service.url;
  const port = service.server.address().port;
  const tasks = new Set();
  const config = replayConfig(siteType);
  const configFile = path.join(directory, 'config.json');
  await writeJSON(configFile, config);
  const audit = async (action, id, payload, options = []) => {
    tasks.add(id);
    const fileArgs = [];
    if (payload) {
      const file = path.join(directory, id + '-' + action + '.json');
      await writeJSON(file, payload);
      fileArgs.push('--file', file);
    }
    return workbench([action, '--id', id, ...fileArgs, '--data', data, '--experience-url', url, ...options]);
  };
  const generation = args => generate([...args, '--data', data, '--experience-url', url]);
  t.after(async () => {
    for (const id of tasks) await stopPreview(data, id);
    await service.close();
    await fs.rm(directory, {recursive: true, force: true});
  });
  return {
    directory, data, config, configFile, tasks, audit, generation,
    restart: async () => {
      await service.close();
      service = await startExperienceServer({store: new ExperienceStore(storeDirectory), allowAnonymous: true, port});
    },
  };
}

function interactionChecks(task) {
  return reviewChecks(task).filter(check => check.kind === 'interaction');
}

async function inspectFamily(task, browser) {
  const preview = await serveCandidate(task);
  const page = await browser.newPage();
  try {
    await page.goto(preview.url + '/index.html');
    return await measureActionFamily(page);
  } finally {
    await page.close();
    await preview.close();
  }
}

async function observeFixtureVisuals(context, id, measurements) {
  assert(measurements.every(sample => sample.pass), 'Actual fixture geometry must pass before observations');
  const task = await loadTask(context.data, id);
  const observations = reviewChecks(task).filter(check => check.kind === 'visual').map(check => ({
    id: check.id,
    status: 'pass',
    actor: 'TEST deterministic geometry observer',
    observations: Object.fromEntries(check.criteria.map(key => [key,
      'TEST fixture only: both source-identified cards retain adjacent identity positions after the real label change at 320/393/1440px. No business aesthetic approval is asserted.'])),
  }));
  await recordObservations({data: context.data, id, candidate: task.candidates.at(-1).hash, observations});
}

// This adapter is intentionally deterministic CI scaffolding, not a claim that
// an arbitrary language model understands or applies arbitrary experience text.
async function replayGuidance(source, entry) {
  const width = entry.guidance.match(/Reserve a (\d+)px action track/i)?.[1];
  const height = entry.guidance.match(/keep its (\d+)px height/i)?.[1];
  if (!width || !height) throw Error('This narrow replay adapter cannot interpret the supplied guidance');
  const stylesheet = path.join(source, 'style.css');
  await fs.appendFile(stylesheet, `\n.action{inline-size:${width}px;block-size:${height}px;white-space:nowrap}`);
}

function planFrom(output) {
  return output.experiencePlan || output.plan || output;
}

async function experiencePlan(context, id) {
  const plan = planFrom(await context.audit('experience-plan', id));
  assert(Array.isArray(plan.entries));
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].reference.learning.key, 'action.feedback-track-stability');
  return plan;
}

async function recordAdoption(context, id, entry) {
  const task = await loadTask(context.data, id);
  return context.audit('experience-apply', id, {
    candidate: task.candidates.at(-1).hash,
    decisions: [{
      referenceId: entry.referenceId,
      revision: entry.revision,
      contentHash: entry.contentHash,
      decision: 'adopted',
      reason: 'TEST deterministic replay read the measured action-track guidance and implemented it in this new task stylesheet.',
      pages: ['home'],
      component: 'action-card',
      implementationPaths: ['style.css'],
      checkIds: interactionChecks(task).map(check => check.id),
    }],
  });
}

async function assertVerified(context, id) {
  const output = await context.audit('experience-verify', id);
  const result = output.experienceVerification || output.verification || output;
  assert.equal(result.status, 'verified');
}

async function assertNotVerified(context, id, reason) {
  let output;
  try {
    output = await context.audit('experience-verify', id);
  } catch (error) {
    assert.match(error.message, reason);
    return;
  }
  assert.notEqual(output.status, 'verified');
  assert.match(JSON.stringify(output), reason);
}

async function learnFromActualCorrection(context, browser, siteType) {
  const id = 'origin-' + siteType;
  const original = path.join(context.directory, 'original-source');
  await createReplaySource(original, siteType);
  await context.audit('start', id, undefined, ['--source', original, '--config', context.configFile, '--mode', 'adjustment']);
  await context.audit('recheck', id);
  let task = await loadTask(context.data, id);
  assert(interactionChecks(task).every(check => task.results[check.id].status === 'not-run' || task.results[check.id].status === 'fail'));
  const before = await inspectFamily(task, browser);
  assert(before.every(sample => !sample.pass), 'The old candidate must visibly reproduce the defect at both cards and every width');
  await context.audit('feedback', id, {
    candidate: task.candidates.at(-1).hash, actor: fixtureActor, text: testFeedback, decision: 'revise',
    checkIds: interactionChecks(task).map(check => check.id),
    adjustmentItems: [{quote: 'changing the action label moves the neighbouring identity text', summary: 'TEST action-state geometry moves', pages: ['home'], component: 'action-card'}],
  });
  await fs.appendFile(path.join(task.source, 'style.css'), stableActionStyles);
  await context.audit('adjust', id, {scope: context.config.adjustment});
  await context.audit('recheck', id);
  task = await loadTask(context.data, id);
  assert(interactionChecks(task).every(check => task.results[check.id].status === 'pass'));
  const after = await inspectFamily(task, browser);
  await observeFixtureVisuals(context, id, after);
  await context.audit('handoff', id);
  const lesson = actionLesson(interactionChecks(task).map(check => check.id));
  await context.audit('feedback', id, {
    candidate: task.candidates.at(-1).hash, actor: fixtureActor, text: testApproval, decision: 'approve', lessons: [lesson],
  });
  await until(async () => (await loadTask(context.data, id)).experienceDeliveries.every(job => job.delivered), 'actual feedback background delivery');
  await context.restart();
  return {before, after};
}

async function prepareFreshGeneration(context, siteType) {
  const id = 'fresh-' + siteType;
  const run = await context.generation(['start', '--id', id, '--site-type', siteType, '--request', 'TEST new action-card fixture using applicable experience', '--pages', 'home']);
  assert.equal((await fs.readdir(run.source)).length, 0);
  const plan = planFrom(run.experiencePlan);
  assert.equal(plan.entries.length, 1);
  // A fresh broken source is created independently; repaired origin files are
  // never copied. Only the retrieved guidance drives the following source edit.
  await createReplaySource(run.source, siteType);
  await replayGuidance(run.source, plan.entries[0]);
  if (siteType === 'games') {
    const task = JSON.parse(await fs.readFile(path.join(root, 'site-types/games/examples/task.json'), 'utf8'));
    task.routes = [{path: 'index.html', page: 'home'}];
    task.modules = [{id: 'action-card', route: 'index.html', job: 'TEST action-label layout replay', family: 'identity-and-store-actions', samples: ['minecraft'], states: ['loaded']}];
    const taskFile = path.join(context.directory, 'game-plan.json');
    await writeJSON(taskFile, task);
    await generationGamesPlan({data: context.data, id, taskFile});
  }
  await context.generation(['review', '--id', id, '--config', context.configFile, '--action', 'open']);
  const reviewId = 'gen-' + id;
  context.tasks.add(reviewId);
  await context.audit('cycle', reviewId, {scope: context.config.adjustment}, ['--mode', 'adjustment']);
  return reviewId;
}

async function verifyFreshCandidate(context, browser, id) {
  const plan = await experiencePlan(context, id);
  await context.audit('recheck', id);
  let task = await loadTask(context.data, id);
  const measurements = await inspectFamily(task, browser);
  assert(measurements.every(sample => sample.pass));
  assert(interactionChecks(task).every(check => task.results[check.id].status === 'pass'));
  await observeFixtureVisuals(context, id, measurements);
  await assert.rejects(context.audit('handoff', id), /experience|application/i, 'Unrecorded experience applications must not close the task');
  await recordAdoption(context, id, plan.entries[0]);
  await assertVerified(context, id);
  await context.audit('handoff', id);
  task = await loadTask(context.data, id);
  assert.equal(task.status, 'awaiting-designer');
  return {plan, measurements};
}

async function rejectStaleAndRecurringEvidence(context, id, entry) {
  let task = await loadTask(context.data, id);
  const check = interactionChecks(task)[0];
  const evidence = task.results[check.id].evidence[0];
  const originalEvidence = await fs.readFile(evidence.path);
  await fs.appendFile(evidence.path, 'TEST tampered evidence');
  await assertNotVerified(context, id, /evidence|application|conflict/i);
  await fs.writeFile(evidence.path, originalEvidence);
  await fs.appendFile(path.join(task.source, 'style.css'), '\n.action{inline-size:auto}');
  await assertNotVerified(context, id, /source|candidate|application|stale/i);
  await context.audit('adjust', id, {scope: context.config.adjustment});
  await assertNotVerified(context, id, /candidate|application|stale/i);
  await recordAdoption(context, id, entry);
  await context.audit('recheck', id);
  task = await loadTask(context.data, id);
  assert(interactionChecks(task).some(check => task.results[check.id].status !== 'pass'));
  await assertNotVerified(context, id, /check|application|conflict/i);
  await assert.rejects(context.audit('handoff', id), /check|application|experience/i, 'A recurring measured defect must not close after a claimed adoption');
}

for (const siteType of ['coupon', 'app', 'games']) {
  test('TEST browser replay ' + siteType + ': corrected feedback persists, fresh generation and optimization implement it, recurrence cannot close', {skip: !executable}, async t => {
    const context = await scenario(t, siteType);
    const browser = await chromium.launch({executablePath: executable, headless: true});
    t.after(() => browser.close());
    const origin = await learnFromActualCorrection(context, browser, siteType);
    const generatedId = await prepareFreshGeneration(context, siteType);
    const generated = await verifyFreshCandidate(context, browser, generatedId);

    const maintenanceId = 'next-optimization-' + siteType;
    const source = path.join(context.directory, 'independently-created-optimization-source');
    await createReplaySource(source, siteType);
    await context.audit('start', maintenanceId, undefined, ['--source', source, '--config', context.configFile, '--mode', 'adjustment']);
    const plan = await experiencePlan(context, maintenanceId);
    const before = await loadTask(context.data, maintenanceId);
    const failures = await inspectFamily(before, browser);
    assert(failures.every(sample => !sample.pass));
    await replayGuidance(before.source, plan.entries[0]);
    await context.audit('adjust', maintenanceId, {scope: context.config.adjustment});
    const optimized = await verifyFreshCandidate(context, browser, maintenanceId);
    assert.equal(generated.plan.entries[0].referenceId, optimized.plan.entries[0].referenceId);
    assert.equal(generated.plan.entries[0].revision, optimized.plan.entries[0].revision);
    await rejectStaleAndRecurringEvidence(context, maintenanceId, optimized.plan.entries[0]);
    t.diagnostic(JSON.stringify({siteType, fixtureOnly: true, referenceId: generated.plan.entries[0].referenceId, revision: generated.plan.entries[0].revision,
      originFailures: origin.before.length, generatedBrowserPasses: generated.measurements.length, optimizationBrowserPasses: optimized.measurements.length,
      actualArbitraryModelAdoption: 'not-certified-by-this-deterministic-CI-replay'}));
  });
}
