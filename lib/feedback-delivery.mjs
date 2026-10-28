import path from 'node:path';
import {spawn} from 'node:child_process';
import {root} from './io.mjs';
import {durableJSON} from './durable-json.mjs';
import {taskDirectory, loadTask} from './workbench.mjs';
import {ExperienceBridgeClient} from './experience-bridge.mjs';
import {uploadAfterApproval} from './library-client.mjs';

// Feedback and its lesson jobs are already durably stored in task.json. The
// existing MCP outbox performs retries; UI delivery never waits for the network.
export async function scheduleFeedbackDelivery({data, id, feedbackId, url, token}) {
  const file = path.join(taskDirectory(data, id), 'feedback-delivery.json');
  await durableJSON(file, {feedbackId, status:'queued', at:new Date().toISOString()});
  try {
    const child = spawn(process.execPath, [path.join(root, 'bin/feedback-worker.mjs'), data, id, feedbackId], {
      detached:true, stdio:'ignore', windowsHide:true,
      env:{...process.env, ...(url ? {DA_EXPERIENCE_URL:url} : {}), ...(token ? {DA_EXPERIENCE_TOKEN:token} : {})},
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    return {status:'queued', shared:false, automaticRetry:true};
  } catch (error) {
    await durableJSON(file, {feedbackId, status:'pending', error:error.message});
    return {status:'pending', shared:false, error:error.message, next:'Local feedback is saved; the next MCP startup recovers pending lessons.'};
  }
}

export async function deliverFeedback({data, id, feedbackId, client, upload = uploadAfterApproval}) {
  const task = await loadTask(data, id);
  const entry = task.feedback.find(feedback => feedback.id === feedbackId);
  if (!entry) throw Error('Saved designer feedback is missing');
  // This local call recovers all durable task jobs and starts the existing
  // delivery supervisor, without waiting for a central-service acknowledgement.
  const experience = await client.call('experience_status', {});
  let library;
  if (entry.decision === 'approve') {
    const current = await loadTask(data, id);
    if (current.approval?.candidate === entry.candidate && current.candidates.at(-1)?.hash === entry.candidate)
      library = await upload(data, id);
    else library = {status:'superseded', uploaded:false};
  }
  const result = {feedbackId, status:'scheduled', experience, ...(library ? {library} : {})};
  await durableJSON(path.join(taskDirectory(data, id), 'feedback-delivery.json'), result);
  return result;
}

export async function runFeedbackDelivery(data, id, feedbackId) {
  const client = new ExperienceBridgeClient({data, url:process.env.DA_EXPERIENCE_URL, token:process.env.DA_EXPERIENCE_TOKEN});
  try { return await deliverFeedback({data, id, feedbackId, client}); }
  catch (error) {
    await durableJSON(path.join(taskDirectory(data, id), 'feedback-delivery.json'), {feedbackId,status:'pending',error:error.message});
  } finally { await client.close(); }
}
