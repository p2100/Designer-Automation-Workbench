import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ExperienceStore} from '../lib/experience.mjs';
import {ReliableExperienceClient} from '../lib/experience-delivery.mjs';
import {startExperienceServer} from '../lib/experience-server.mjs';
import {stageFeedback} from '../lib/experience-task.mjs';
import {feedback} from '../lib/workbench.mjs';
import {durableJSON} from '../lib/durable-json.mjs';
import {digest, writeJSON, exists, snapshot, root} from '../lib/io.mjs';
import {checkPackage} from '../bin/common.mjs';
import {sample, lessonSpec, candidate} from './experience-fixture.mjs';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await pause(50);
  }
  throw Error('Automatic recovery did not finish');
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'da-delivery-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const store = new ExperienceStore(path.join(dir, 'shared'));
  let service = await startExperienceServer({store, allowAnonymous: true}),
    active = true;
  const port = service.server.address().port,
    url = service.url;
  t.after(async () => {
    if (active) await service.close();
  });
  const client = new ReliableExperienceClient({
    url,
    data: path.join(dir, 'client'),
    timeout: 300,
    retryMin: 75,
    retryMax: 150,
  });
  t.after(() => client.close());
  return {
    dir,
    store,
    url,
    client,
    stop: async () => {
      await service.close();
      active = false;
    },
    start: async () => {
      service = await startExperienceServer({
        store,
        allowAnonymous: true,
        port,
      });
      active = true;
    },
  };
}

test('restart recovers a standalone feedback record saved before enqueue',async t=>{
 const f=await fixture(t),record={version:1,projectId:'game-fixture',siteType:'games',baseBuild:'build-before',candidate:'a'.repeat(64),actor:'Designer',text:'首页卡片太挤',items:[{quote:'首页卡片太挤',summary:'调整卡片容量',pages:['home'],component:'cards'}],at:'2026-10-30T04:00:00.000Z'};
 const recordId=digest(record);await durableJSON(path.join(f.client.data,'library','feedback','fixture',recordId+'.json'),record);
 await f.client.initialize();await f.client.flush();
 const result=await f.store.searchFeedback({site:'game-fixture'});assert.equal(result.total,1);assert.equal(result.cases[0].evidence[0].originalFeedback,record.text);assert.equal(result.cases[0].verification.retested,false);
 await f.client.recoverLibraryFeedback();await f.client.flush();assert.equal((await f.store.searchFeedback({site:'game-fixture'})).total,1);
});
async function drained(client) {
  await until(async () => (await client.syncStatus()).pending === 0);
  await until(async () => !(await client.workerRunning()));
}
test('an approval is committed with its complete outbox payload before any MCP call, and restart recovers it', async (t) => {
  const f = await fixture(t),
    data = f.client.data,
    source = path.join(f.dir, 'source'),
    directory = path.join(f.dir, 'frozen');
  await fs.mkdir(source);
  await fs.mkdir(path.join(directory, 'site'), {recursive: true});
  await fs.writeFile(
    path.join(source, 'fixture.txt'),
    'synthetic protocol state',
  );
  await fs.copyFile(
    path.join(source, 'fixture.txt'),
    path.join(directory, 'site/fixture.txt'),
  );
  const rules = await checkPackage(root),
    sourceHashes = await snapshot(source),
    task = {
      id: 'atomic',
      repo: 'fixture-a',
      source,
      config: {
        artifactRoot: '.',
        pages: [
          {id: 'home', family: 'home'},
          {id: 'detail', family: 'offer-detail'},
        ],
      },
      rules: {directory: root, manifestHash: rules.manifestHash},
      candidates: [
        {
          hash: candidate,
          directory,
          source: sourceHashes,
          artifactHash: digest(await snapshot(path.join(directory, 'site'))),
        },
      ],
      checks: [
        {id: 'home/393/layout', page: 'home'},
        {id: 'detail/393/layout', page: 'detail'},
      ],
      results: {
        'home/393/layout': {candidate, status: 'pass'},
        'detail/393/layout': {candidate, status: 'pass'},
      },
      feedback: [
        {
          id: 'feedback-1',
          candidate,
          actor: 'designer',
          text: 'Synthetic correction',
          decision: 'revise',
        },
      ],
      events: [],
      status: 'awaiting-designer',
    };
  const taskFile = path.join(data, 'tasks/atomic/task.json');
  await durableJSON(taskFile, task);
  await feedback({
    data,
    id: 'atomic',
    candidate,
    actor: 'designer',
    text: 'Synthetic confirmation only',
    decision: 'approve',
    lessons: [lessonSpec()],
  });
  const skipTask = {...task, id: 'skip-atomic'};
  const skipFile = path.join(data, 'tasks/skip-atomic/task.json');
  await durableJSON(skipFile, skipTask);
  await feedback({
    data,
    id: 'skip-atomic',
    candidate,
    actor: 'designer',
    text: 'Synthetic approval of one-off content',
    decision: 'approve',
    learningDecision: {
      action: 'skip',
      reason:
        'One-off content replacement has no independently reusable correction method',
    },
  });
  assert.equal(
    JSON.parse(await fs.readFile(skipFile, 'utf8')).feedback.at(-1)
      .learningDecision.action,
    'skip',
  );
  const committed = JSON.parse(await fs.readFile(taskFile, 'utf8'));
  assert.equal(committed.status, 'approved');
  assert.equal(committed.experienceDeliveries.length, 1);
  assert.deepEqual(committed.experienceDeliveries[0].entry.scope.pages, [
    'home',
  ]);
  assert.equal((await f.store.read()).cases.length, 0);
  const restarted = new ReliableExperienceClient({
    ...f.client.settings,
    retryMin: 75,
    retryMax: 150,
  });
  t.after(() => restarted.close());
  await restarted.resume();
  await drained(restarted);
  assert.equal(
    (await f.store.search({site: 'fixture-a', pages: ['home']})).cases.length,
    1,
  );
  assert.equal(
    (await f.store.search({site: 'fixture-a', pages: ['offer-detail']})).cases
      .length,
    0,
  );
  assert.equal(
    JSON.parse(await fs.readFile(taskFile, 'utf8')).experienceDeliveries[0]
      .delivered,
    true,
  );
});
test('offline captures survive caller exit and are shared automatically after recovery', async (t) => {
  const f = await fixture(t);
  await f.stop();
  assert.equal((await f.client.capture(sample())).sync, 'queued');
  await f.client.close();
  await f.start();
  await drained(f.client);
  assert.equal((await f.store.search({site: 'fixture-a'})).cases.length, 1);
});
test('a killed transfer worker is restarted by its detached supervisor', async (t) => {
  const f = await fixture(t);
  await f.stop();
  await f.client.capture(sample());
  const statusFile = path.join(f.client.directory, 'supervisor-status.json');
  await until(() => exists(statusFile));
  const first = JSON.parse(await fs.readFile(statusFile, 'utf8'));
  await until(() =>
    exists(path.join(f.client.directory, 'worker.lock/owner.json')),
  );
  process.kill(first.workerPid, 'SIGKILL');
  await until(
    async () => JSON.parse(await fs.readFile(statusFile, 'utf8')).restarts >= 1,
  );
  await f.start();
  await drained(f.client);
  assert.equal((await f.store.read()).cases.length, 1);
});
test('one corrupt record is quarantined without blocking healthy records', async (t) => {
  const f = await fixture(t);
  await f.client.initialize();
  await fs.mkdir(f.client.outbox, {recursive: true});
  await fs.writeFile(
    path.join(f.client.outbox, 'case-' + 'a'.repeat(32) + '.json'),
    '{broken',
  );
  const result = await f.client.capture(sample());
  assert.equal(result.shared, true);
  const status = await f.client.syncStatus();
  assert.equal(status.pending, 0);
  assert.equal(status.rejected, 1);
  const rejected = JSON.parse(
    await fs.readFile(
      path.join(f.client.rejected, 'case-' + 'a'.repeat(32) + '.json'),
      'utf8',
    ),
  );
  assert.equal(rejected.raw, '{broken');
});
test('withdrawals are also queued offline and replay idempotently after recovery', async (t) => {
  const f = await fixture(t),
    saved = await f.client.capture(sample()),
    target = saved.lessons.find((l) => l.scope.site);
  await f.stop();
  const result = await f.client.manage({
    action: 'retract',
    id: target.id,
    expectedRevision: target.revision,
    actor: 'designer',
    reason: 'Synthetic actual withdrawal',
  });
  assert.equal(result.sync, 'queued');
  await f.start();
  await drained(f.client);
  assert.equal((await f.store.search({site: 'fixture-a'})).cases.length, 0);
});
test('legacy outboxes and lost acknowledgements resume without duplicate lessons', async (t) => {
  const f = await fixture(t),
    entry = sample();
  await f.store.capture(entry);
  await writeJSON(
    path.join(
      f.client.data,
      'outbox',
      'case-' + digest(entry).slice(0, 32) + '.json',
    ),
    {entry},
  );
  await f.client.resume();
  await drained(f.client);
  assert.equal((await f.store.read()).cases.length, 1);
  assert.equal((await f.store.search({site: 'fixture-a'})).cases.length, 1);
});
