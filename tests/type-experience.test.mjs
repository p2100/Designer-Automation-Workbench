import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {ExperienceStore} from '../lib/experience.mjs';
import {taskLesson} from '../lib/experience-task.mjs';
import {selectTaskExperience} from '../lib/experience-selection.mjs';
import {experiencePage} from '../lib/site-rules.mjs';
import {candidate,lessonSpec,sample} from './experience-fixture.mjs';
import {root,command,readJSON,writeJSON} from '../lib/io.mjs';
import {ExperienceBridgeClient} from '../lib/experience-bridge.mjs';
import {startExperienceServer} from '../lib/experience-server.mjs';
import {ReliableExperienceClient} from '../lib/experience-delivery.mjs';
import http from 'node:http';
import {caseContent,caseId} from '../lib/experience-case.mjs';

const local = n => 'local:'+String(n).repeat(64);
function approvedTask(type,site=local(1)) {
  return {id:'fixture',repo:site,sourceKind:'local',config:{siteType:type,pages:[{id:'home',family:'home'}]},
    candidates:[{hash:candidate,source:{},artifactHash:candidate}],checks:[{id:'home/393/layout',page:'home'}],
    results:{'home/393/layout':{candidate,status:'pass'}},events:[],
    feedback:[{id:'f1',decision:'revise',candidate,text:'Synthetic correction'}, {id:'f2',decision:'approve',candidate}],
    approval:{candidate,actor:'synthetic-designer',text:'Synthetic candidate approval',at:'2026-10-26T00:00:00.000Z'}};
}
async function storeFixture(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'da-type-lessons-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  return new ExperienceStore(directory);
}

test('approved local feedback becomes a reference for the same type and page, not other types',async t=>{
  const store=await storeFixture(t);
  for (const [type,n] of [['coupon',1],['app',2],['games',3]]) {
    const entry=taskLesson(approvedTask(type,local(n)),lessonSpec(), 'agent');
    assert.equal(entry.classification,'local-reference');
    assert.deepEqual(entry.scope.pages,[experiencePage(type,'home')]);
    await store.capture(entry);
  }
  for (const type of ['coupon','app','games']) {
    const config={siteType:type,pages:[{family:'home'}]};
    const result=await store.search({site:local(9),pages:[experiencePage(type,'home')],includePending:true});
    const selected=selectTaskExperience(result,config);
    assert.equal(selected.length,1,type);
    assert.equal(selected[0].status,'candidate');
    assert.equal(selected[0].experienceUse,'reference-only');
    assert.deepEqual(selected[0].scope.pages,[experiencePage(type,'home')]);
    assert.equal((await store.search({site:local(9),pages:[experiencePage(type,'home')]})).cases.length,0);
    assert.equal((await store.search({site:local(9),pages:[experiencePage(type,'detail')],includePending:true})).cases.length,0);
  }
});

test('local copies cannot establish independent sources or activate a global rule',async t=>{
  const store=await storeFixture(t);
  await store.capture(taskLesson(approvedTask('games',local(1)),lessonSpec(),'agent'));
  await store.capture(taskLesson(approvedTask('games',local(2)),lessonSpec(),'agent'));
  const result=await store.search({site:local(3),pages:['games:home'],includePending:true});
  assert.equal(result.cases.length,1);
  assert.equal(result.cases[0].status,'candidate');
  assert.equal((await store.search({site:local(3),pages:['games:home']})).cases.length,0);
  for(const site of ['fixture-git-one','fixture-git-two']) {
    const git=sample({site,scope:{site,pages:['games:home'],component:'offer-card'}});
    git.verification.pages=['games:home'];
    await store.capture(git);
    const active=await store.search({site:local(3),pages:['games:home']});
    assert.equal(active.cases.length,site==='fixture-git-one'?0:1);
  }
});

test('unconfirmed, brand preference, mixed types and withdrawn conclusions never become references',async t=>{
  const store=await storeFixture(t), unapproved=approvedTask('app');
  unapproved.approval=null;
  assert.equal((await store.capture(taskLesson(unapproved,lessonSpec(),'agent'))).shared,false);
  const preference=taskLesson(approvedTask('app',local(2)),{...lessonSpec(),classification:'site-preference'},'agent');
  await store.capture(preference);
  assert.equal((await store.search({site:local(3),pages:['app:home'],includePending:true})).cases.length,0);
  const mixed=sample({site:local(3),classification:'local-reference',scope:{site:local(3),pages:['home','app:home'],component:'offer-card'}});
  await assert.rejects(store.capture(mixed),/one explicit site type/);
  const receipt=await store.capture(taskLesson(approvedTask('app',local(4)),lessonSpec(),'agent'));
  const own=receipt.lessons.find(item=>item.scope.site);
  await store.manage({action:'retract',id:own.id,expectedRevision:own.revision,actor:'synthetic-designer',reason:'Synthetic correction'});
  const r=await store.search({site:local(8),pages:['app:home'],includePending:true});
  assert.deepEqual(selectTaskExperience(r,{siteType:'app',pages:[{family:'home'}]}),[]);
  assert.throws(()=>selectTaskExperience(r,{pages:[{family:'home'}]}),/actual site type/);
});

test('the new local reference classification is rejected by the old service schema',()=>{
  const entry=taskLesson(approvedTask('coupon'),lessonSpec(),'agent');
  const oldClassification=z.enum(['general','site-preference','hard-failure','unclassified']);
  assert.equal(oldClassification.safeParse(entry.classification).success,false);
});

test('old service leaves ZIP reference queued and upgrade delivers it without losing feedback',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'da-reference-upgrade-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const requests=[];
  const old=http.createServer((req,res)=>{
    requests.push(req.url);res.setHeader('content-type','application/json');
    res.end(JSON.stringify({status:'ok',service:'designer-automation-experience',version:'0.4.0'}));
  });
  await new Promise(resolve=>old.listen(0,'127.0.0.1',resolve));
  const port=old.address().port;
  const client=new ReliableExperienceClient({url:'http://127.0.0.1:'+port,data:path.join(temp,'client'),autoWorker:false});
  t.after(()=>client.close());
  const entry=taskLesson(approvedTask('games'),lessonSpec(),'agent');
  const pending=await client.capture(entry);
  assert.equal(pending.sync,'queued');
  assert.deepEqual(requests,['/health']);
  assert.equal((await client.syncStatus()).pending,1);
  assert.equal((await client.syncStatus()).rejected,0);
  // A deferred feature upgrade must not block other otherwise deliverable records.
  const capture=client.remote.capture.bind(client.remote);
  client.remote.capture=async input=>input.classification==='local-reference' ? capture(input) : {id:caseId(caseContent(input)),status:'candidate',shared:false};
  const other=await client.capture(sample({task:'independent-feedback'}));
  assert.equal(other.sync,'saved');
  assert.equal((await client.syncStatus()).pending,1);
  client.remote.capture=capture;
  await new Promise(resolve=>old.close(resolve));
  const store=new ExperienceStore(path.join(temp,'store'));
  const service=await startExperienceServer({store,allowAnonymous:true,port});
  t.after(()=>service.close());
  const flushed=await client.flush();
  assert.equal(flushed.pending,0);
  assert.equal((await store.search({pages:['games:home'],site:local(9),includePending:true})).cases.length,1);
});

test('real MCP and workbench load a local-source reference only for the matching type',async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'da-type-workbench-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const store=new ExperienceStore(path.join(temp,'store'));
  const service=await startExperienceServer({store,allowAnonymous:true,maintainerToken:'synthetic-maintainer-token-long-enough'});
  t.after(()=>service.close());
  const bridge=new ExperienceBridgeClient({data:path.join(temp,'author'),url:service.url,token:''});
  t.after(()=>bridge.close());
  const captured=await bridge.capture(taskLesson(approvedTask('games'),lessonSpec(),'agent'));
  assert.equal(captured.sync,'saved');
  const env={DA_EXPERIENCE_URL:service.url,DA_EXPERIENCE_TOKEN:''};
  for(const type of ['games','app','coupon']) {
    const source=path.join(temp,type), data=path.join(temp,'data-'+type);
    await fs.mkdir(source);await writeJSON(path.join(source,'site.json'),{siteType:type});
    await fs.writeFile(path.join(source,'index.html'),'<!doctype html><main>Fixture</main>');
    const config={version:1,siteType:type,request:'Synthetic local-source test',artifactRoot:'.',allowedPaths:['index.html'],widths:[393],commands:{},pages:[{id:'home',family:'home',route:'/index.html',dependsOn:['index.html']}]};
    const configFile=path.join(temp,type+'-config.json');await writeJSON(configFile,config);
    const opened=await command([process.execPath,'bin/workbench.mjs','open','--id','test','--source',source,'--config',configFile,'--data',data],root,{env});
    assert.equal(JSON.parse(opened.output).lessons.length,type==='games'?1:0);
    const task=await readJSON(path.join(data,'tasks/test/task.json'));
    assert.equal(task.lessons.length,type==='games'?1:0,type);
    if(type==='games')assert.equal(task.lessons[0].experienceUse,'reference-only');
  }
  const wrong=path.join(temp,'wrong.json');
  await writeJSON(wrong,{version:1,siteType:'app',request:'Wrong type',artifactRoot:'.',allowedPaths:['index.html'],widths:[393],commands:{},pages:[{id:'home',family:'home',route:'/index.html',dependsOn:['index.html']}]});
  await assert.rejects(command([process.execPath,'bin/workbench.mjs','open','--id','wrong','--source',path.join(temp,'games'),'--config',wrong,'--data',path.join(temp,'wrong-data')],root,{env}),/conflicts with actual source declarations/);
  const ambiguous=path.join(temp,'ambiguous');await fs.mkdir(ambiguous);
  await fs.writeFile(path.join(ambiguous,'index.html'),'<!doctype html><main>Unknown product</main>');
  const unknown=path.join(temp,'unknown.json');
  await writeJSON(unknown,{version:1,request:'Determine actual product',artifactRoot:'.',allowedPaths:['index.html'],widths:[393],commands:{},pages:[{id:'home',family:'home',route:'/index.html',dependsOn:['index.html']}]});
  await assert.rejects(command([process.execPath,'bin/workbench.mjs','open','--id','unknown','--source',ambiguous,'--config',unknown,'--data',path.join(temp,'unknown-data')],root,{env}),/Site type is ambiguous/);
});
