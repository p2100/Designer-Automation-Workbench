import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {root, digest, writeJSON} from '../lib/io.mjs';
import {openTask, prepare, prepareAdjustment, resumeAcceptance, loadTask, feedback, handoff, confirmCoverage, recordObservations, saveTask} from '../lib/workbench.mjs';
import {audit, incrementalPlan, status} from '../lib/audit.mjs';
import {reviewChecks} from '../lib/adjustment.mjs';
import {workbench} from '../bin/workbench.mjs';
import {stopPreview} from '../lib/preview.mjs';
import {taskLesson} from '../lib/experience-task.mjs';
import {lessonSpec} from './experience-fixture.mjs';
import {ExperienceStore} from '../lib/experience-memory.mjs';
import {startExperienceServer} from '../lib/experience-server.mjs';

const executable = process.env.SITE_BROWSER_EXECUTABLE;
const scope = {pages:['home'],component:'home heading',reason:'Only the home heading margin changes. The detail template does not use this selector.'};

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'da-adjustment-'));
  const source = path.join(directory, 'source'), data = path.join(directory, 'data');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'index.html'), '<!doctype html><link rel="stylesheet" href="shared.css"><link rel="stylesheet" href="home.css"><main class="home"><h1>Home fixture</h1><a href="detail.html">Details</a></main>');
  await fs.writeFile(path.join(source, 'detail.html'), '<!doctype html><link rel="stylesheet" href="shared.css"><link rel="stylesheet" href="detail.css"><main><h1>Detail fixture</h1><button>Install</button></main>');
  await fs.writeFile(path.join(source, 'shared.css'), 'body{margin:16px;font:16px Arial}h1{font-size:24px}.home h1{margin-bottom:16px}');
  await fs.writeFile(path.join(source, 'home.css'), '.home{max-width:700px}');
  await fs.writeFile(path.join(source, 'detail.css'), 'button{margin-top:16px}');
  const config = {version:1, siteType:'app', request:'Synthetic workflow fixture; not design acceptance', artifactRoot:'.', allowedPaths:['**/*.html','**/*.css','notes.txt'], widths:[320,393,1440], commands:{}, pages:[
    {id:'home', family:'home', route:'/index.html', dependsOn:['index.html','home.css']},
    {id:'detail', family:'detail', route:'/detail.html', dependsOn:['detail.html']},
  ], ...options};
  const task = await openTask({data,id:'trial',localSource:source,config});
  await prepare(data,'trial');
  t.after(async () => { await stopPreview(data,'trial'); await fs.rm(directory,{recursive:true,force:true}); });
  return {directory, source, data, config, task};
}

async function editPayload(data, file = 'shared.css', find = 'margin-bottom:16px', replace = 'margin-bottom:12px') {
  const task = await loadTask(data,'trial'), original = await fs.readFile(path.join(task.source,file),'utf8');
  return {candidate:task.candidates.at(-1).hash,scope,edits:[{file,expectedHash:digest(original),find,replace}]};
}

async function syntheticObservations(data) {
  const task = await loadTask(data,'trial');
  await recordObservations({data,id:'trial',candidate:task.candidates.at(-1).hash,observations:reviewChecks(task).filter(check=>check.kind==='visual').map(check=>({
    id:check.id,status:'pass',actor:'synthetic-protocol-observer',
    observations:Object.fromEntries(check.criteria.map(key=>[key,'Synthetic workflow assertion only; not a real visual acceptance.'])),
  }))});
}

async function until(check, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Automatic background delivery did not finish');
}

test('adjust returns a new stable preview before any browser review; acceptance checks remain intact', async t => {
  const {data,directory,source} = await fixture(t);
  const before = await loadTask(data,'trial');
  assert(before.checks.filter(check=>check.page==='home'&&check.kind==='visual').length > 100);
  const file = path.join(directory,'edits.json');
  await writeJSON(file,await editPayload(data));
  const started = performance.now();
  const result = await workbench(['adjust','--id','trial','--file',file,'--data',data]);
  t.diagnostic('Warm-workspace adjustment returned a ready preview in '+Math.round(performance.now()-started)+' ms, before any browser audit.');
  assert.equal(result.task.status,'adjustment-preview');
  assert.equal(result.task.reviewScope.kind,'adjustment');
  assert.equal(result.task.reviewScope.fullSiteAcceptance,'not-performed-by-this-adjustment');
  assert.equal(result.task.lastAudit,undefined);
  assert.deepEqual(result.task.counts,{'not-run':6});
  assert(result.preview.candidate !== before.candidates.at(-1).hash);
  assert.match(await (await fetch(result.preview.url+'/shared.css')).text(),/margin-bottom:12px/);
  assert.match(await fs.readFile(path.join(source,'shared.css'),'utf8'),/margin-bottom:16px/);
  assert.equal((await loadTask(data,'trial')).checks.length,before.checks.length);
  await assert.rejects(handoff(data,'trial'),/Required check/);
  await assert.rejects(feedback({data,id:'trial',candidate:result.preview.candidate,actor:'synthetic-designer',text:'Synthetic confirmation',decision:'approve',learningDecision:{action:'skip',reason:'Synthetic fixture has no reusable design lesson'}}),/before approval/);
  const next = await workbench(['cycle','--id','trial','--data',data]);
  assert.equal(next.preview.url,result.preview.url);
  assert.equal(next.preview.candidate,result.preview.candidate);
  const identity = await (await fetch(next.preview.url+'/__designer/status')).json();
  assert.equal(identity.reviewScope.kind,'adjustment');
});

test('unlocated feedback never invalidates the entire site; unknown inputs keep preview but require scope', async t => {
  const {data} = await fixture(t);
  let task = await loadTask(data,'trial');
  task = await feedback({data,id:'trial',candidate:task.candidates.at(-1).hash,actor:'synthetic-designer',text:'Adjust this small area'});
  assert.deepEqual(task.invalidated,[]);
  assert.equal(task.feedback.at(-1).scopePending,true);
  await fs.writeFile(path.join(task.source,'notes.txt'),'Unmapped source fixture');
  task = await prepareAdjustment({data,id:'trial'});
  assert(task.adjustment.coverage.gaps.length);
  assert.deepEqual(reviewChecks(task),[]);
  await assert.rejects(audit({data,id:'trial',executable:'/not-a-browser'}),/scope before recheck/);
  await assert.rejects(handoff(data,'trial'),/coverage/);
});

test('page-specific CSS is inferred without expansion; declared global dependencies still cover every call site', async t => {
  const {data} = await fixture(t);
  const payload = await editPayload(data,'home.css','700px','680px');
  delete payload.scope;
  let task = await prepareAdjustment({...payload,data,id:'trial'});
  assert.deepEqual(task.adjustment.pages,['home']);
  assert.equal(reviewChecks(task).length,6);
  const other = await fixture(t,{globalDependencies:['shared.css']});
  task = await prepareAdjustment({...await editPayload(other.data),data:other.data,id:'trial'});
  assert.deepEqual(new Set(task.adjustment.pages),new Set(['home','detail']));
  assert.deepEqual(task.adjustment.globalChanges,['shared.css']);
});

test('navigation links do not make destination resources dependencies of the linking page', async t => {
  const {data} = await fixture(t);
  const payload = await editPayload(data,'detail.css','16px','12px');
  delete payload.scope;
  const task = await prepareAdjustment({...payload,data,id:'trial'});
  assert.deepEqual(task.adjustment.pages,['detail']);
  assert.deepEqual(task.adjustment.coverage.gaps,[]);
  assert.equal(reviewChecks(task).length,6);
});

test('a declaration cannot approve a change owned entirely by another page', async t => {
  const {data} = await fixture(t);
  let task = await prepareAdjustment({...await editPayload(data,'detail.css','16px','12px'),data,id:'trial'});
  assert.equal(task.adjustment.coverage.confirmed,false);
  assert(task.adjustment.coverage.gaps.some(gap=>gap.includes('outside the declared scope')));
  await assert.rejects(handoff(data,'trial'),/coverage/);
  task = await prepareAdjustment({data,id:'trial',scope:{pages:['detail'],component:'detail button',reason:'detail.css is embedded only by detail.html; the home link does not embed its styles.'}});
  assert.equal(task.adjustment.coverage.confirmed,true);
  assert.deepEqual(task.adjustment.pages,['detail']);
});

test('inferred shared resource changes cover both call sites; direct page changes cannot be omitted', async t => {
  const {data} = await fixture(t);
  const payload = await editPayload(data);
  delete payload.scope;
  let task = await prepareAdjustment({...payload,data,id:'trial'});
  assert.deepEqual(new Set(task.adjustment.pages),new Set(['home','detail']));
  const other = await fixture(t);
  task = await prepareAdjustment({...await editPayload(other.data,'detail.html','Detail fixture','Changed detail fixture'),data:other.data,id:'trial'});
  assert.equal(task.adjustment.coverage.confirmed,false);
  assert(task.adjustment.coverage.gaps.some(gap=>gap.includes('Changed page detail')));
});

test('real scoped recheck ignores unrelated old/external records, preserves full acceptance, and learns only the confirmed adjustment', {skip:!executable}, async t => {
  const {data,directory} = await fixture(t);
  let task = await audit({data,id:'trial',executable});
  const fullCount = task.checks.length;
  assert.equal(task.lastAudit.executed,fullCount);
  assert.equal(task.lastAudit.visits,6);
  const acceptanceRepair = path.join(directory,'acceptance-repair.json');
  const acceptancePayload = await editPayload(data,'home.css','700px','690px');
  delete acceptancePayload.scope;
  await writeJSON(acceptanceRepair,acceptancePayload);
  const repaired = await workbench(['repair','--id','trial','--file',acceptanceRepair,'--data',data]);
  assert.equal(repaired.reviewScope.kind,'acceptance');
  assert.equal(repaired.lastAudit.executed,fullCount);
  task = await loadTask(data,'trial');
  for (const check of task.checks.filter(check=>check.page==='detail')) task.results[check.id] = {...task.results[check.id],observedAt:'2020-01-01T00:00:00Z',cacheSafe:false};
  await saveTask(data,task);
  const oldDetail = structuredClone(task.results['detail/393/layout']);
  task = await prepareAdjustment({...await editPayload(data),data,id:'trial'});
  task = await audit({data,id:'trial',executable});
  assert.equal(task.lastAudit.executed,6);
  assert.equal(task.lastAudit.visits,3);
  t.diagnostic('Full acceptance: '+fullCount+' checks / 6 page-width visits; scoped adjustment: 6 checks / 3 page-width visits.');
  assert.deepEqual(task.results['detail/393/layout'],oldDetail);
  assert.equal(reviewChecks(task).filter(check=>check.kind==='visual').length,3);
  await syntheticObservations(data);
  task = await loadTask(data,'trial');
  for (const check of reviewChecks(task)) task.results[check.id].observedAt='2020-01-01T00:00:00Z';
  await saveTask(data,task);
  const plan = await incrementalPlan(task,task.candidates.at(-1),task.lastAudit.environment);
  assert.equal(plan.execute.length,0);
  assert.equal(plan.reuse.length,6);
  await handoff(data,'trial');

  // Exercise the actual CLI, detached feedback worker, stdio MCP and delivery
  // supervisor against an offline private test service. No manual flush or
  // client initialization may bootstrap this test's background delivery.
  const store = new ExperienceStore(path.join(directory,'test-service'));
  let server = await startExperienceServer({store,host:'127.0.0.1',port:0}), active = true;
  const port = server.server.address().port, url = server.url;
  t.after(async()=>{ if(active) await server.close(); });
  await server.close(); active = false;
  const approvalFile = path.join(directory,'approval.json');
  await writeJSON(approvalFile,{candidate:task.candidates.at(-1).hash,actor:'synthetic-designer',text:'Synthetic exact candidate approval',decision:'approve',lessons:[{...lessonSpec(),component:'home heading',classification:'site-preference'}]});
  const started = performance.now();
  const result = await workbench(['feedback','--id','trial','--file',approvalFile,'--data',data,'--experience-url',url]);
  t.diagnostic('Offline approval returned in '+Math.round(performance.now()-started)+' ms; service was still stopped.');
  assert.equal(result.experienceSync,'queued');
  task = await loadTask(data,'trial');
  assert.equal(task.status,'approved');
  assert.equal(task.experienceDeliveries.length,1);
  assert.equal(task.experienceDeliveries[0].delivered,false);
  const deliveryFile = path.join(data,'tasks','trial','feedback-delivery.json');
  await until(async()=>JSON.parse(await fs.readFile(deliveryFile,'utf8')).status==='scheduled');
  const pending = JSON.parse(await fs.readFile(deliveryFile,'utf8'));
  assert.equal(pending.experience.pending,1);
  server = await startExperienceServer({store,host:'127.0.0.1',port}); active = true;
  await until(async()=>(await loadTask(data,'trial')).experienceDeliveries[0].delivered===true);
  // Wait for detached processes to finish before fixture cleanup.
  const queue = path.join(data,'experience-delivery',digest(url).slice(0,24));
  await until(async()=>{
    try { await fs.access(path.join(queue,'supervisor.lock')); return false; }
    catch(error) { if(error.code==='ENOENT') return true; throw error; }
  });
  assert.equal(task.approval.scope.kind,'adjustment');
  const lesson = taskLesson(task,{...lessonSpec(),component:'home heading',classification:'site-preference'},'synthetic-agent');
  assert.equal(lesson.verification.retested,true);
  assert.equal(lesson.verification.designerApproved,true);
  assert.deepEqual(lesson.scope.pages,['app:home']);
  assert.equal(lesson.source.checkIds.length,6);
  assert.throws(()=>taskLesson(task,{...lessonSpec(),checkIds:['detail/393/layout']},'synthetic-agent'),/scope exceeds/);

  const saved = await loadTask(data,'trial');
  assert.equal(saved.experienceDeliveries.filter(job=>job.delivered).length,1);
  assert.equal(saved.status,'approved');
  const learned = await store.search({site:task.repo,pages:['app:home'],includePending:true});
  assert(learned.cases.length > 0);
  assert.deepEqual((await store.search({site:task.repo,pages:['app:detail'],includePending:true})).cases,[]);

  await resumeAcceptance(data,'trial');
  task = await audit({data,id:'trial',executable});
  assert.equal(task.lastAudit.executed,fullCount);
  assert.equal(task.lastAudit.visits,6);
  assert.equal((await status(data,'trial')).reviewScope.kind,'acceptance');
});
