import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createAdjustmentClock,adjustmentTiming,getOrStartAdjustmentClock} from '../lib/adjustment-clock.mjs';
import {workbench} from '../bin/workbench.mjs';
import {ExperienceBridgeClient} from '../lib/experience-bridge.mjs';

const started=Date.parse('2026-11-01T06:00:00Z');
const candidate='current';
const task={adjustmentClock:createAdjustmentClock('test',started),candidates:[{hash:candidate}],approval:{candidate}};

test('designer approval and queued delivery do not stop the two-hour clock',()=>{
  assert.equal(adjustmentTiming(task,{},started+60000).status,'in-progress');
  assert.equal(adjustmentTiming(task,{deliveries:{one:{candidate,library:{status:'queued'}}}},started+60000).withinBudget,null);
  assert.equal(adjustmentTiming(task,{},started+121*60000).status,'over-budget');
});

test('only the successful receipt for the approved current candidate completes elapsed time',()=>{
  const finishedAt=new Date(started+100*60000).toISOString();
  const delivery={deliveries:{one:{candidate,library:{status:'uploaded',finishedAt}}}};
  const measured=adjustmentTiming(task,delivery,started+200*60000);
  assert.equal(measured.status,'completed');assert.equal(measured.elapsedMs,100*60000);assert.equal(measured.withinBudget,true);
  assert.equal(adjustmentTiming({...task,candidates:[{hash:'new'}]},delivery,started+200*60000).status,'over-budget');
  assert.equal(adjustmentTiming({...task,approval:null},delivery,started+200*60000).status,'over-budget');
});

test('a late upload is retained as a completed over-budget result and absent start is never invented',()=>{
  const finishedAt=new Date(started+121*60000).toISOString();
  assert.equal(adjustmentTiming(task,{deliveries:{one:{candidate,library:{status:'uploaded',finishedAt}}}}).withinBudget,false);
  assert.equal(adjustmentTiming({candidates:[{hash:candidate}]},{}).status,'not-started');
  assert.equal(adjustmentTiming({adjustmentClock:task.adjustmentClock},{deliveries:{one:{library:{status:'uploaded',finishedAt}}}},started+60000).status,'in-progress');
});

async function fixture(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'da-adjustment-clock-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  return {directory,data:path.join(directory,'data')};
}

const savedClock=(data,id)=>path.join(data,'adjustment-clocks',id+'.json');
const taskFile=(data,id)=>path.join(data,'tasks',id,'task.json');
const read=file=>fs.readFile(file,'utf8').then(JSON.parse);
async function write(file,value) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,JSON.stringify(value));
}

test('the local clock retains retry time and preserves an already registered task clock',async t=>{
  const {data}=await fixture(t),id='retained';
  const first=await getOrStartAdjustmentClock({data,id,basis:'first-command',now:started});
  assert.deepEqual(await getOrStartAdjustmentClock({data,id,basis:'retry-command',now:started+60000}),first);
  const existing=createAdjustmentClock('existing-task-clock',started-60000);
  await write(taskFile(data,id),{id,adjustmentClock:existing});
  assert.deepEqual(await getOrStartAdjustmentClock({data,id,basis:'later-command',now:started+120000}),existing);
  assert.deepEqual(await read(savedClock(data,id)),existing);
});

for (const firstAction of ['open','start']) {
  test('CLI '+firstAction+' persists adjustment start before failed checkout and reuses it after real registration',async t=>{
    const {directory,data}=await fixture(t),id='checkout-retry-'+firstAction;
    const source=path.join(directory,'not-created-yet'),configFile=path.join(directory,'config.json');
    const config={version:1,siteType:'app',workflow:'adjustment',request:'TEST failed local checkout and retry, no network',artifactRoot:'.',allowedPaths:['index.html','site.json'],commands:{},pages:[{id:'home',family:'home',route:'/index.html',dependsOn:['index.html']}]};
    await write(configFile,config);
    let searches=0;
    t.mock.method(ExperienceBridgeClient.prototype,'search',async()=>{
      searches++;
      assert.deepEqual(await read(savedClock(data,id)),first);
      return {cases:[],creative:[],creativeRetired:[],source:'offline-test-fixture'};
    });
    const common=['--id',id,'--source',source,'--config',configFile,'--data',data];
    const receivedBefore=Date.now();
    // Explicit --mode and config.workflow both take the pre-checkout path.
    await assert.rejects(workbench([firstAction,...common,...(firstAction==='open'?['--mode','adjustment']:[])]),/ENOENT|no such file/i);
    const first=await read(savedClock(data,id));
    assert(Date.parse(first.startedAt)>=receivedBefore && Date.parse(first.startedAt)<=Date.now());
    assert.match(first.basis,/cli-.*received/);
    assert.equal(searches,0,'Checkout failed before any experience request');
    await assert.rejects(fs.access(taskFile(data,id)),{code:'ENOENT'});
    await fs.mkdir(source);
    await fs.writeFile(path.join(source,'index.html'),'<!doctype html><main>TEST local clock retry</main>');
    await write(path.join(source,'site.json'),{siteType:'app'});
    await workbench(['open',...common]);
    assert.equal(searches,1);
    assert.deepEqual((await read(taskFile(data,id))).adjustmentClock,first);
    assert.deepEqual(await read(savedClock(data,id)),first);
    await workbench(['open',...common]);
    assert.deepEqual((await read(taskFile(data,id))).adjustmentClock,first);
    assert.deepEqual(await workbench(['timer-start','--id',id,'--data',data]),first);
  });
}

test('adjustment commands persist their received start before later payload or candidate failures',async t=>{
  const {directory,data}=await fixture(t);
  for(const action of ['adjust','repair','cycle','feedback']) {
    const id='received-'+action;
    if(action!=='adjust')await write(taskFile(data,id),{id,config:{workflow:action==='feedback'?'acceptance':'adjustment'},events:[],rules:{directory:path.join(directory,'missing-rules')},candidates:[]});
    const payload=path.join(directory,'payload-'+action+'.json');
    if(action==='feedback')await write(payload,{decision:'revise',actor:'TEST',text:'TEST correction',candidate:'not-prepared'});
    const before=Date.now();
    await assert.rejects(workbench([action,'--id',id,'--data',data,'--file',payload]));
    const clock=await read(savedClock(data,id));
    assert(Date.parse(clock.startedAt)>=before && Date.parse(clock.startedAt)<=Date.now());
    assert.match(clock.basis,/cli-.*received/);
    await assert.rejects(workbench([action,'--id',id,'--data',data,'--file',payload]));
    assert.deepEqual(await read(savedClock(data,id)),clock);
  }
});

test('acceptance repairs and cycles do not start a designer clock for initial source generation',async t=>{
  const {directory,data}=await fixture(t);
  for(const action of ['repair','cycle']) {
    const id='acceptance-'+action;
    await write(taskFile(data,id),{id,config:{workflow:'acceptance'},events:[]});
    await assert.rejects(workbench([action,'--id',id,'--data',data,'--file',path.join(directory,'missing-payload.json')]));
    await assert.rejects(fs.access(savedClock(data,id)),{code:'ENOENT'});
    assert.equal((await read(taskFile(data,id))).adjustmentClock,undefined);
  }
});
