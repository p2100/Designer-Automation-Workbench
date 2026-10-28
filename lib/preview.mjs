import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {root, readJSON, writeJSON, exists} from './io.mjs';
import {loadTask, taskDirectory, verifyCandidate} from './workbench.mjs';
import {reviewScope} from './adjustment.mjs';

export async function previewAlive(record) {
  try {
    const response = await fetch(record.url+'/__designer/status',{signal:AbortSignal.timeout(1500)});
    const body = await response.json(); return body.identity === record.identity && body.id === record.id;
  } catch { return false; }
}
export async function ensurePreview(data,id) {
  const task = await loadTask(data,id), candidate = await verifyCandidate(task);
  const current = {candidate:candidate.hash,reviewStatus:task.status,reviewScope:reviewScope(task)};
  const file = path.join(taskDirectory(data,id),'preview.json');
  if (await exists(file)) { const record = await readJSON(file); if (await previewAlive(record)) return {...record,reused:true,...current}; }
  const identity = randomUUID(), child = spawn(process.execPath,[path.join(root,'bin/preview-worker.mjs'),data,id,identity],{detached:true,stdio:'ignore'}); child.unref();
  for (let attempt = 0; attempt < 50; attempt++) {
    await new Promise(resolve => setTimeout(resolve,100));
    if (await exists(file)) { const record = await readJSON(file); if (record.identity === identity && await previewAlive(record)) return {...record,...current}; }
  }
  child.kill(); throw Error('Preview did not start; inspect project output and Node runtime');
}
export async function stopPreview(data,id) {
  const file = path.join(taskDirectory(data,id),'preview.json'); if (!await exists(file)) return;
  const record = await readJSON(file); if (await previewAlive(record)) process.kill(record.pid,'SIGTERM');
  await fs.unlink(file);
}
