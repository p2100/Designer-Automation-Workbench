import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {root, exists, readJSON, locked, safeId} from './io.mjs';
import {durableJSON} from './durable-json.mjs';
import {taskDirectory, loadTask} from './workbench.mjs';
import {ExperienceBridgeClient} from './experience-bridge.mjs';
import {uploadAfterApproval} from './library-client.mjs';

const retryable = channel => ['queued', 'running', 'pending'].includes(channel?.status);
const deliveryFile = (data, id) => path.join(taskDirectory(data, id), 'feedback-delivery.json');
const workerLock = (data, id, feedbackId) => path.join(taskDirectory(data, id), 'feedback-delivery', safeId(feedbackId));
const timestamp = () => new Date().toISOString();
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function legacyJob(state) {
  if (!state.feedbackId) return {};
  const queued = state.status !== 'scheduled';
  return {[state.feedbackId]: {
    feedbackId: state.feedbackId, queuedAt: state.at || timestamp(),
    experience: {status: queued ? 'queued' : 'scheduled', ...(state.experience ? {result: state.experience} : {})},
    library: {status: queued ? 'queued' : state.library?.status || 'not-applicable', ...(state.library ? {result: state.library} : {})},
  }};
}

async function readState(data, id) {
  const file = deliveryFile(data, id);
  const state = await exists(file) ? await readJSON(file) : {};
  return {...state, deliveries: state.deliveries || legacyJob(state)};
}

async function withStateLock(file, operation) {
  for (let attempt = 0; ; attempt++) {
    let entered = false;
    try { return await locked(file + '.state', () => {entered = true; return operation();}); }
    catch (error) {
      if (entered || !error.message.startsWith('Another operation') || attempt >= 200) throw error;
      await sleep(10);
    }
  }
}

async function updateJob(data, id, feedbackId, update) {
  const file = deliveryFile(data, id);
  return withStateLock(file, async () => {
    const state = await readState(data, id), previous = state.deliveries[feedbackId];
    const job = await update(previous);
    const status = job.error || retryable(job.experience) || retryable(job.library) ? 'pending' : 'scheduled';
    const result = {
      ...state, version: 2, feedbackId, status,
      experience: job.experience.result || {status: job.experience.status, shared: false},
      library: job.library.result || {status: job.library.status, uploaded: false},
      channels: {experience: job.experience, library: job.library},
      deliveries: {...state.deliveries, [feedbackId]: job},
    };
    if (job.error) result.error = job.error;
    else delete result.error;
    await durableJSON(file, result);
    return result;
  });
}

async function ensureJob(data, id, feedbackId) {
  safeId(feedbackId);
  const task = await loadTask(data, id), entry = task.feedback.find(feedback => feedback.id === feedbackId);
  if (!entry) throw Error('Saved designer feedback is missing');
  return updateJob(data, id, feedbackId, previous => previous || {
    feedbackId, candidate: entry.candidate, queuedAt: timestamp(),
    experience: {status: 'queued', attempts: 0},
    library: {status: entry.decision === 'approve' ? 'queued' : 'not-applicable', attempts: 0},
  });
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
}

async function workerActive(data, id, feedbackId, job) {
  if (processAlive(job?.workerPid)) return true;
  const owner = path.join(workerLock(data, id, feedbackId) + '.lock', 'owner.json');
  try { return processAlive((await readJSON(owner)).pid); }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// task.json owns durable lesson payloads. This file records channel activation
// and receipts, without introducing a second experience outbox.
export async function scheduleFeedbackDelivery({data, id, feedbackId, url, token}) {
  await ensureJob(data, id, feedbackId);
  return locked(workerLock(data, id, feedbackId) + '.schedule', async () => {
    const state = await readState(data, id), job = state.deliveries[feedbackId];
    if (!retryable(job.experience) && !retryable(job.library))
      return {status: 'scheduled', shared: false, automaticRetry: false};
    if (await workerActive(data, id, feedbackId, job))
      return {status: 'queued', shared: false, automaticRetry: true, reused: true};
    try {
      const child = spawn(process.execPath, [path.join(root, 'bin/feedback-worker.mjs'), data, id, feedbackId], {
        detached: true, stdio: 'ignore', windowsHide: true,
        env: {...process.env, ...(url ? {DA_EXPERIENCE_URL: url} : {}), ...(token ? {DA_EXPERIENCE_TOKEN: token} : {})},
      });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      await updateJob(data, id, feedbackId, current => ({...current, workerPid: child.pid, workerStartedAt: timestamp(), error: null}));
      return {status: 'queued', shared: false, automaticRetry: true};
    } catch (error) {
      await updateJob(data, id, feedbackId, current => ({...current, error: error.message}));
      return {status: 'pending', shared: false, error: error.message, automaticRetry: true,
        next: 'Saved channel states recover on the next experience MCP startup or resume.'};
    }
  });
}

async function attemptChannel({data, id, feedbackId, name, operation, retryMin, retryMax}) {
  const job = (await readState(data, id)).deliveries[feedbackId], previous = job[name];
  if (!retryable(previous) || previous.nextAttemptAt > Date.now()) return;
  const started = Date.now(), attempts = (previous.attempts || 0) + 1;
  await updateJob(data, id, feedbackId, current => ({...current, error: null,
    [name]: {...current[name], status: 'running', attempts, startedAt: new Date(started).toISOString(),
      queueWaitMs: Math.max(0, started - Date.parse(current.queuedAt))},
  }));
  let result, failed = false;
  try { result = await operation(); }
  catch (error) { failed = true; result = {status: 'pending', error: error.message, shared: false, uploaded: false}; }
  const terminal = ['uploaded', 'confirmation-required', 'not-connected', 'superseded', 'not-applicable'];
  const status = name === 'experience' ? failed ? 'pending' : 'scheduled'
    : terminal.includes(result?.status) ? result.status : 'pending';
  const delay = Math.min(retryMax, retryMin * 2 ** Math.min(attempts - 1, 16));
  await updateJob(data, id, feedbackId, current => ({...current,
    [name]: {...current[name], status, result: result || {status: 'pending'}, finishedAt: timestamp(),
      durationMs: Date.now() - started, nextAttemptAt: status === 'pending' ? Date.now() + delay : null,
      automaticRetry: status === 'pending'},
  }));
}

export async function deliverFeedback({data, id, feedbackId, client, upload = uploadAfterApproval, retryMin = 1000, retryMax = 60000}) {
  await ensureJob(data, id, feedbackId);
  const task = await loadTask(data, id), entry = task.feedback.find(feedback => feedback.id === feedbackId);
  const outcomes = await Promise.allSettled([
    attemptChannel({data, id, feedbackId, name: 'experience', retryMin, retryMax, operation: () => client.call('experience_status', {})}),
    attemptChannel({data, id, feedbackId, name: 'library', retryMin, retryMax, operation: async () => {
      const current = await loadTask(data, id);
      if (entry.decision !== 'approve') return {status: 'not-applicable', uploaded: false};
      if (current.approval?.candidate !== entry.candidate || current.candidates.at(-1)?.hash !== entry.candidate)
        return {status: 'superseded', uploaded: false};
      return upload(data, id);
    }}),
  ]);
  const failed = outcomes.find(outcome => outcome.status === 'rejected');
  if (failed) throw failed.reason;
  return readState(data, id);
}

export async function runFeedbackDelivery(data, id, feedbackId, {
  clientFactory = options => new ExperienceBridgeClient(options), upload = uploadAfterApproval,
  retryMin = 1000, retryMax = 60000, wait = sleep,
} = {}) {
  try {
    return await locked(workerLock(data, id, feedbackId), async () => {
      let client;
      try {
        while (true) {
          // Replace a failed local MCP connection; its existing durable outbox
          // remains the only owner of central experience delivery and retries.
          client ||= clientFactory({data, url: process.env.DA_EXPERIENCE_URL, token: process.env.DA_EXPERIENCE_TOKEN});
          const state = await deliverFeedback({data, id, feedbackId, client, upload, retryMin, retryMax});
          const job = state.deliveries[feedbackId], pending = [job.experience, job.library].filter(retryable);
          if (!pending.length) return state;
          if (job.experience.status === 'pending') { await client.close().catch(() => {}); client = null; }
          const next = Math.min(...pending.map(channel => channel.nextAttemptAt || Date.now()));
          await wait(Math.max(0, next - Date.now()));
        }
      } finally {
        await client?.close().catch(() => {});
        await updateJob(data, id, feedbackId, job => ({...job, workerPid: null}));
      }
    });
  } catch (error) {
    if (error.message.startsWith('Another operation')) return {status: 'active', shared: false};
    await ensureJob(data, id, feedbackId);
    return updateJob(data, id, feedbackId, job => ({...job, workerPid: null, error: error.message}));
  }
}

// Hook into the existing reliable MCP recovery seam. The active lock is checked
// before scheduling, including when a running worker calls experience_status.
export async function recoverFeedbackDeliveries({data, url, token, launch = scheduleFeedbackDelivery}) {
  const directory = path.join(data, 'tasks'), recovered = [], errors = [];
  if (!await exists(directory)) return {recovered, errors};
  for (const item of await fs.readdir(directory, {withFileTypes: true})) {
    if (!item.isDirectory()) continue;
    // Task mutations create sibling .lock/.recovery.lock directories. They are
    // operation metadata, never task identities or feedback recovery failures.
    try { safeId(item.name); } catch { continue; }
    try {
      if (!await exists(deliveryFile(data, item.name))) continue;
      const state = await readState(data, item.name);
      for (const [feedbackId, job] of Object.entries(state.deliveries)) {
        if ((!retryable(job.experience) && !retryable(job.library)) || await workerActive(data, item.name, feedbackId, job)) continue;
        recovered.push({id: item.name, feedbackId, result: await launch({data, id: item.name, feedbackId, url, token})});
      }
    } catch (error) { errors.push({id: item.name, error: error.message}); }
  }
  return {recovered, errors};
}
