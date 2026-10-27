import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ExperienceStore} from '../lib/experience.mjs';
import {sample, lessonSpec, candidate} from './experience-fixture.mjs';
import {taskLesson} from '../lib/experience-task.mjs';
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'da-policy-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  return new ExperienceStore(dir);
}
test('repeat cases reinforce one conclusion; independent sites are required for global reuse', async (t) => {
  const store = await fixture(t);
  const first = await store.capture(sample());
  assert.equal(first.shared, true);
  assert.equal(
    (await store.search({pages: ['home'], site: 'fixture-b'})).cases.length,
    0,
  );
  await store.capture(sample({task: 'task-2'}));
  const local = await store.search({pages: ['home'], site: 'fixture-a'});
  assert.equal(local.cases.length, 1);
  assert.equal(local.cases[0].supportCount, 2);
  await store.capture(sample({site: 'fixture-b'}));
  const global = await store.search({pages: ['home'], site: 'fixture-c'});
  assert.equal(global.cases.length, 1);
  assert.deepEqual(global.cases[0].sites, ['fixture-a', 'fixture-b']);
  assert.equal(
    (await store.search({pages: ['offer-detail'], site: 'fixture-a'})).cases
      .length,
    0,
  );
});
test('contradictions stay pending; correction replaces a version and withdraw invalidates shared projections', async (t) => {
  const store = await fixture(t),
    first = await store.capture(sample());
  await store.capture(sample({site: 'fixture-b'}));
  const local = first.lessons.find((l) => l.scope.site);
  const alternate = sample({
    task: 'task-new',
    prevention:
      'Use a single line with an approved accessible expandable full title',
  });
  const pending = await store.capture(alternate);
  assert.equal(pending.shared, false);
  assert.equal(pending.status, 'conflict');
  assert.equal(
    (await store.search({site: 'fixture-a'})).cases[0].prevention,
    sample().prevention,
  );
  const changed = await store.manage({
    action: 'replace',
    id: local.id,
    expectedRevision: local.revision,
    actor: 'synthetic-designer',
    reason: 'Synthetic design correction',
    case: alternate,
  });
  assert.equal(changed.lesson.revision, 2);
  assert.equal((await store.search({site: 'fixture-c'})).cases.length, 0);
  assert.equal(
    (await store.search({site: 'fixture-a'})).cases[0].prevention,
    alternate.prevention,
  );
  await assert.rejects(
    store.manage({
      action: 'retract',
      id: local.id,
      expectedRevision: 1,
      actor: 'designer',
      reason: 'stale',
    }),
    /stale/,
  );
  const action = {
    action: 'retract',
    id: local.id,
    expectedRevision: 2,
    actor: 'designer',
    reason: 'Withdraw this synthetic conclusion',
  };
  await store.manage(action);
  assert.equal((await store.search({site: 'fixture-a'})).cases.length, 0);
  assert.equal((await store.manage(action)).replayed, true);
  assert.equal((await store.capture(alternate)).shared, false);
  assert.equal(
    (await store.manage({action: 'inspect', id: local.id})).history.length,
    2,
  );
});
test('vague approvals and unscoped legacy cases remain evidence only, never active reusable lessons', async (t) => {
  const store = await fixture(t);
  const old = sample();
  delete old.learning;
  delete old.source;
  const result = await store.capture(old);
  assert.equal(result.shared, false);
  assert.equal(result.review.required, true);
  assert.equal((await store.search({site: 'fixture-a'})).cases.length, 0);
  const vague = await store.capture(sample({prevention: 'Looks good'}));
  assert.equal(vague.shared, false);
  assert.equal(vague.status, 'candidate');
});
test('lesson scope is derived from selected checks and cannot expand to every task page', () => {
  const base = {
    id: 'fixture',
    repo: 'fixture-a',
    config: {
      pages: [
        {id: 'home', family: 'home'},
        {id: 'detail', family: 'offer-detail'},
      ],
    },
    candidates: [{hash: candidate, source: {}, artifactHash: candidate}],
    checks: [
      {id: 'home/393/layout', page: 'home'},
      {id: 'detail/393/layout', page: 'detail'},
    ],
    results: {
      'home/393/layout': {candidate, status: 'pass'},
      'detail/393/layout': {candidate, status: 'pass'},
    },
    events: [],
    feedback: [
      {
        id: 'f1',
        decision: 'revise',
        candidate,
        text: 'Synthetic actual correction',
      },
      {id: 'f2', decision: 'approve', candidate},
    ],
    approval: {
      candidate,
      actor: 'designer',
      text: 'Synthetic approval',
      at: '2026-10-26T00:00:00.000Z',
    },
  };
  assert.deepEqual(taskLesson(base, lessonSpec(), 'agent').scope.pages, [
    'home',
  ]);
  base.feedback.push({id:'f3',decision:'note',candidate,text:'I like this heading'});
  assert.equal(taskLesson(base, lessonSpec(), 'agent').approval.feedbackId,'f2');
  assert.throws(
    () =>
      taskLesson(
        base,
        {
          ...lessonSpec(),
          checkIds: ['home/393/layout'],
          pages: ['offer-detail'],
        },
        'agent',
      ),
    /exceeds/,
  );
});

test('repository aliases are one source site and a changed principle cannot be resurrected with another key', async (t) => {
  const store = await fixture(t);
  await store.capture(sample({site: 'git@github.com:Example/One.git'}));
  await store.capture(sample({site: 'https://github.com/example/one'}));
  assert.equal((await store.search({site: 'another-site'})).cases.length, 0);
  const found = await store.search({site: 'git@github.com:Example/One.git'});
  assert.equal(found.cases.length, 1);
  const target = found.cases[0];
  const replacement = sample({
    site: 'https://github.com/example/one',
    task: 'corrected',
    prevention:
      'Use a separately measured title track when the action changes state',
  });
  await store.manage({
    action: 'replace',
    id: target.id,
    expectedRevision: target.revision,
    actor: 'designer',
    reason: 'Synthetic correction',
    case: replacement,
  });
  const old = await store.capture(
    sample({
      site: 'https://github.com/example/one',
      task: 'old-again',
      key: 'duplicate.other-label',
    }),
  );
  assert.equal(old.shared, false);
  assert.equal(old.status, 'conflict');
});

test('a withdrawn global rule can only be replaced after both source conclusions are actually corrected', async (t) => {
  const store = await fixture(t);
  await store.capture(sample());
  await store.capture(sample({site: 'fixture-b'}));
  const global = (await store.search({site: 'third-site'})).cases[0];
  await store.manage({
    action: 'retract',
    id: global.id,
    expectedRevision: global.revision,
    actor: 'designer',
    reason: 'Synthetic global withdrawal',
  });
  const a = sample({
      task: 'new-a',
      prevention:
        'Reserve a separately measured content track for the confirmed action states',
    }),
    b = sample({site: 'fixture-b', task: 'new-b', prevention: a.prevention});
  const ca = await store.capture(a),
    cb = await store.capture(b);
  const operation = {
    action: 'replace',
    id: global.id,
    expectedRevision: global.revision + 1,
    actor: 'designer',
    reason: 'Synthetic verified correction supported by both sites',
    case: a,
    supportCaseIds: [ca.id, cb.id],
  };
  await assert.rejects(store.manage(operation), /two independently/);
  for (const [site, entry] of [
    ['fixture-a', a],
    ['fixture-b', b],
  ]) {
    const local = (await store.search({site})).cases[0];
    await store.manage({
      action: 'replace',
      id: local.id,
      expectedRevision: local.revision,
      actor: 'designer',
      reason: 'Synthetic source correction',
      case: entry,
    });
  }
  await store.manage(operation);
  assert.equal(
    (await store.search({site: 'third-site'})).cases[0].prevention,
    a.prevention,
  );
  assert.equal((await store.capture(a)).shared, true);
});

test('a site-only withdrawal blocks fallback there without retracting independently supported global guidance', async (t) => {
  const store = await fixture(t);
  await store.capture(sample());
  await store.capture(sample({site: 'fixture-b'}));
  const c = sample({site: 'fixture-c'});
  c.learning.transferable = false;
  const local = await store.capture(c),
    target = local.lessons.find((l) => l.scope.site);
  await store.manage({
    action: 'retract',
    id: target.id,
    expectedRevision: target.revision,
    actor: 'designer',
    reason: 'This synthetic method does not apply on this site',
  });
  assert.equal((await store.search({site: 'fixture-c'})).cases.length, 0);
  assert.equal((await store.search({site: 'fixture-d'})).cases.length, 1);
  await store.capture({
    ...c,
    source: {...c.source, task: 'retry-under-new-task'},
    learning: {...c.learning, transferable: true},
  });
  assert.equal((await store.search({site: 'fixture-c'})).cases.length, 0);
  assert.equal(
    (await store.search({site: 'fixture-d'})).cases[0].sites.includes(
      'fixture-c',
    ),
    false,
  );
});
