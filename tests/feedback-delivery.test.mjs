import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {deliverFeedback, runFeedbackDelivery, recoverFeedbackDeliveries} from '../lib/feedback-delivery.mjs';
import {ExperienceStore} from '../lib/experience-memory.mjs';
import {startExperienceServer} from '../lib/experience-server.mjs';
import {durableJSON} from '../lib/durable-json.mjs';

const uploaded = {status: 'uploaded', reviewStatus: 'approved', downloadable: true, buildId: 'synthetic-build'};
const client = call => ({call, close: async () => {}});
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function fixture(t) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), 'da-feedback-channels-'));
  t.after(() => fs.rm(data, {recursive: true, force: true}));
  const id = 'trial', feedbackId = 'feedback-1', candidate = 'a'.repeat(64);
  const directory = path.join(data, 'tasks', id), file = path.join(directory, 'feedback-delivery.json');
  const task = {id, feedback: [{id: feedbackId, decision: 'approve', candidate}], approval: {candidate}, candidates: [{hash: candidate}]};
  const save = value => durableJSON(path.join(directory, 'task.json'), value);
  await save(task);
  return {data, id, feedbackId, candidate, directory, file, task, save, read: async () => JSON.parse(await fs.readFile(file, 'utf8'))};
}

async function until(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await pause(20);
  }
  throw Error('Feedback delivery did not reach the expected durable state');
}

test('a local experience MCP failure cannot prevent an independently approved upload', async t => {
  const f = await fixture(t); let uploads = 0;
  const state = await deliverFeedback({...f, client: client(async () => {throw Error('local MCP unavailable');}), upload: async () => {uploads++; return uploaded;}});
  assert.equal(uploads, 1);
  assert.equal(state.status, 'pending');
  assert.equal(state.channels.experience.status, 'pending');
  assert.equal(state.channels.library.status, 'uploaded');
  assert.equal(state.channels.experience.automaticRetry, true);
  assert.equal(state.channels.library.automaticRetry, false);
  assert.equal(state.channels.experience.attempts, 1);
  for (const channel of Object.values(state.channels)) {
    assert(Number.isFinite(Date.parse(channel.startedAt)));
    assert(Number.isFinite(Date.parse(channel.finishedAt)));
    assert(channel.durationMs >= 0); assert(channel.queueWaitMs >= 0);
  }
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'task.json'))).approval, f.task.approval);
});

test('busy channel-state writes retry without hiding corrupt durable delivery state', async t => {
  const f = await fixture(t), lock = f.file + '.state.lock';
  await fs.mkdir(lock, {recursive: true}); await durableJSON(path.join(lock, 'owner.json'), {pid: process.pid});
  const release = pause(30).then(() => fs.rm(lock, {recursive: true, force: true}));
  const result = await deliverFeedback({...f, client: client(async () => ({pending: 0})), upload: async () => uploaded});
  await release; assert.equal(result.channels.library.status, 'uploaded');
  await fs.writeFile(f.file, '{corrupt');
  await assert.rejects(deliverFeedback({...f, client: client(async () => ({pending: 0})), upload: async () => uploaded}), SyntaxError);
  assert.equal(await fs.readFile(f.file, 'utf8'), '{corrupt');
});

test('upload receipt is durable while a separate experience call is still waiting', async t => {
  const f = await fixture(t); let release;
  const waiting = new Promise(resolve => {release = resolve;});
  const delivery = deliverFeedback({...f, client: client(() => waiting), upload: async () => uploaded});
  try {
    await until(async () => {try {return (await f.read()).channels.library.status === 'uploaded';} catch {return false;}});
    assert.equal((await f.read()).channels.experience.status, 'running');
  } finally {release({pending: 2}); await delivery;}
  assert.equal((await f.read()).experience.pending, 2);
  assert.equal((await f.read()).channels.experience.status, 'scheduled');
});

test('library failure retries without replaying the successful experience activation', async t => {
  const f = await fixture(t); let searches = 0, uploads = 0;
  const options = {...f, retryMin: 0, client: client(async () => {searches++; return {pending: 3};}), upload: async () => {
    uploads++; if (uploads === 1) throw Error('library offline'); return uploaded;
  }};
  const first = await deliverFeedback(options);
  assert.equal(first.channels.experience.status, 'scheduled');
  assert.equal(first.channels.library.status, 'pending');
  const second = await deliverFeedback(options);
  assert.equal(second.channels.library.status, 'uploaded');
  assert.equal(searches, 1); assert.equal(uploads, 2);
  assert.equal(second.channels.library.attempts, 2);
});

test('a candidate changed during an upload outage is superseded instead of uploaded on retry', async t => {
  const f = await fixture(t); let uploads = 0;
  const options = {...f, retryMin: 0, client: client(async () => ({pending: 0})), upload: async () => {uploads++; return {status: 'pending', error: 'library offline'};}};
  await deliverFeedback(options);
  await f.save({...f.task, candidates: [{hash: 'b'.repeat(64)}]});
  const result = await deliverFeedback(options);
  assert.equal(result.channels.library.status, 'superseded');
  assert.equal(result.library.uploaded, false); assert.equal(uploads, 1);
  assert.equal((await recoverFeedbackDeliveries({...f, launch: async () => {throw Error('must not restart terminal channels');}})).recovered.length, 0);
});

test('MCP recovery resumes legacy pending channels without spawning recursively from experience_status', async t => {
  const f = await fixture(t);
  await durableJSON(f.file, {feedbackId: f.feedbackId, status: 'pending', error: 'old interrupted worker'});
  let launches = 0, uploads = 0, calls = 0;
  const launch = async options => {
    launches++;
    return runFeedbackDelivery(options.data, options.id, options.feedbackId, {
      retryMin: 1, retryMax: 2,
      clientFactory: () => client(async () => {
        calls++;
        const nested = await recoverFeedbackDeliveries({...f, launch});
        assert.equal(nested.recovered.length, 0); assert.deepEqual(nested.errors, []);
        if (calls === 1) throw Error('first local MCP startup fails');
        return {pending: 0};
      }),
      upload: async () => {uploads++; return uploaded;},
    });
  };
  const resumed = await recoverFeedbackDeliveries({...f, launch});
  assert.equal(resumed.recovered.length, 1); assert.deepEqual(resumed.errors, []);
  assert.equal(launches, 1); assert.equal(calls, 2, JSON.stringify(resumed)); assert.equal(uploads, 1);
  const saved = await f.read();
  assert.equal(saved.version, 2); assert.equal(saved.status, 'scheduled');
  assert.equal(saved.channels.experience.attempts, 2); assert.equal(saved.channels.library.attempts, 1);
  assert.equal(saved.deliveries[f.feedbackId].workerPid, null);
});

test('feedback recovery ignores active task lock directories instead of rejecting them as invalid task IDs', async t => {
  const f = await fixture(t);
  await durableJSON(f.file, {feedbackId: f.feedbackId, status: 'pending'});
  for (const name of ['trial.lock', 'trial.recovery.lock', '.operation-state'])
    await durableJSON(path.join(f.data, 'tasks', name, 'owner.json'), {pid: process.pid});
  let launches = 0;
  const result = await recoverFeedbackDeliveries({...f, launch: async () => {launches++; return {status: 'queued'};}});
  assert.equal(launches, 1); assert.equal(result.recovered.length, 1); assert.deepEqual(result.errors, []);
});

test('later feedback retains earlier independent channel receipts', async t => {
  const f = await fixture(t); let uploads = 0;
  const options = {...f, client: client(async () => ({pending: 0})), upload: async () => {uploads++; return uploaded;}};
  await deliverFeedback(options);
  const nextFeedback = {id: 'feedback-2', decision: 'revise', candidate: f.candidate};
  await f.save({...f.task, feedback: [...f.task.feedback, nextFeedback]});
  const result = await deliverFeedback({...options, feedbackId: nextFeedback.id});
  assert.equal(Object.keys(result.deliveries).length, 2);
  assert.equal(result.deliveries[f.feedbackId].library.status, 'uploaded');
  assert.equal(result.channels.library.status, 'not-applicable'); assert.equal(uploads, 1);
});

test('queued library work is retained as pending rather than a successful upload', async t => {
  const f = await fixture(t);
  const result = await deliverFeedback({...f, client: client(async () => ({pending: 4})), upload: async () => ({status: 'queued'})});
  assert.equal(result.status, 'pending'); assert.equal(result.channels.library.status, 'pending');
  assert.equal(result.library.status, 'queued'); assert.notEqual(result.library.uploaded, true);
  assert.equal(result.channels.library.automaticRetry, true);
});

test('worker retries have bounded backoff and never repeat a completed upload', async t => {
  const f = await fixture(t); let calls = 0, uploads = 0; const waits = [];
  await runFeedbackDelivery(f.data, f.id, f.feedbackId, {
    retryMin: 2, retryMax: 4,
    clientFactory: () => client(async () => {calls++; if (calls < 4) throw Error('temporary local MCP failure'); return {pending: 1};}),
    upload: async () => {uploads++; return uploaded;},
    wait: async milliseconds => {waits.push(milliseconds); assert(milliseconds <= 4); await pause(milliseconds);},
  });
  assert.equal(calls, 4); assert.equal(uploads, 1); assert.equal(waits.length, 3);
  assert.equal((await f.read()).channels.experience.status, 'scheduled');
});

test('MCP restart reclaims a dead worker lock and launches the actual detached delivery entry', async t => {
  const f = await fixture(t);
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {stdio: ['pipe', 'ignore', 'ignore']});
  await once(child, 'spawn'); const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const lock = path.join(f.directory, 'feedback-delivery', f.feedbackId + '.lock');
  await durableJSON(path.join(lock, 'owner.json'), {pid: child.pid});
  await durableJSON(f.file, {feedbackId: f.feedbackId, status: 'queued'});
  const store = new ExperienceStore(path.join(f.data, 'test-service'));
  const service = await startExperienceServer({store, allowAnonymous: true});
  try {
    const recovery = await recoverFeedbackDeliveries({data: f.data, url: service.url});
    assert.equal(recovery.recovered.length, 1); assert.deepEqual(recovery.errors, []);
    await until(async () => {const state = await f.read(); return state.status === 'scheduled' && state.deliveries[f.feedbackId].workerPid === null;});
    assert.equal((await f.read()).channels.library.status, 'not-connected');
    await until(async () => {try {await fs.access(lock); return false;} catch (error) {return error.code === 'ENOENT';}});
  } finally {await service.close();}
});
