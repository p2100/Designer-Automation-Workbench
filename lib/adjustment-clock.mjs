import path from 'node:path';
import {readJSON, locked, safeId} from './io.mjs';
import {durableJSON} from './durable-json.mjs';

const budgetMs = 120 * 60 * 1000;

export function createAdjustmentClock(basis, now = Date.now()) {
  return {version:1,startedAt:new Date(now).toISOString(),budgetMs,basis};
}

function validateClock(clock) {
  if (clock?.version !== 1 || !Number.isFinite(Date.parse(clock.startedAt)) ||
    !Number.isFinite(clock.budgetMs) || clock.budgetMs <= 0 || typeof clock.basis !== 'string' || !clock.basis.trim())
    throw Error('Invalid saved adjustment clock; preserve its record rather than resetting elapsed time');
  return clock;
}

async function optionalJSON(file) {
  try { return await readJSON(file); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

// Persist before registration: checkout, inspection or an unavailable experience
// service may fail without ever creating task.json. Retries retain this start.
export async function getOrStartAdjustmentClock({data, id, basis, now = Date.now(), existingClock}) {
  const taskId = safeId(id), file = path.join(data, 'adjustment-clocks', taskId + '.json');
  for (let attempt = 0; ; attempt++) {
    let entered = false;
    try {
      return await locked(file, async () => {
        entered = true;
        const registered = existingClock || (await optionalJSON(path.join(data, 'tasks', taskId, 'task.json')))?.adjustmentClock;
        const saved = await optionalJSON(file);
        if (saved) validateClock(saved);
        const clock = validateClock(registered || saved || createAdjustmentClock(basis, now));
        if (!saved || JSON.stringify(saved) !== JSON.stringify(clock)) await durableJSON(file, clock);
        return clock;
      });
    } catch (error) {
      if (entered || !error.message.startsWith('Another operation') || attempt >= 200) throw error;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

// An approval or a queued upload is not the end of the measured workflow.
export function adjustmentTiming(task, delivery = {}, now = Date.now()) {
  const clock=task.adjustmentClock;
  if (!clock) return {status:'not-started',budgetMs,reason:'No recorded adjustment start; do not infer a two-hour result'};
  const candidate=task.candidates?.at(-1)?.hash;
  const uploaded=Object.values(delivery.deliveries||{}).filter(job=>candidate && job.candidate===candidate && job.library?.status==='uploaded' &&
    Number.isFinite(Date.parse(job.library.finishedAt))).sort((a,b)=>Date.parse(a.library.finishedAt)-Date.parse(b.library.finishedAt))[0];
  const completedAt=candidate && task.approval?.candidate===candidate ? uploaded?.library.finishedAt : undefined;
  const start=Date.parse(clock.startedAt),end=completedAt?Date.parse(completedAt):now;
  const elapsedMs=Math.max(0,end-start),remainingMs=Math.max(0,clock.budgetMs-elapsedMs);
  return {...clock,candidate,elapsedMs,remainingMs,deadlineAt:new Date(start+clock.budgetMs).toISOString(),
    status:completedAt?'completed':elapsedMs>clock.budgetMs?'over-budget':'in-progress',
    withinBudget:completedAt?elapsedMs<=clock.budgetMs:null,...(completedAt?{completedAt}:{}),
    limit:'Measured from the recorded start; no visual or business approval is inferred from elapsed time.'};
}
