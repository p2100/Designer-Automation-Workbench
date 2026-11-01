import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {gunzipSync} from 'node:zlib';
import {digest,snapshot,writeJSON,readJSON} from '../lib/io.mjs';
import {pushLibraryTask,bindLibraryTask} from '../lib/library-client.mjs';
import {deliverFeedback,recoverFeedbackDeliveries,acknowledgeLibraryUpload} from '../lib/feedback-delivery.mjs';
import {createAdjustmentClock,adjustmentTiming} from '../lib/adjustment-clock.mjs';

async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'TEST-library-receipt-')),data=path.join(directory,'data'),source=path.join(directory,'source'),site=path.join(directory,'candidate/site');
  for(const dir of [source,site]){await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'index.html'),'TEST protocol only');}
  const sourceFiles=await snapshot(source),artifacts=await snapshot(site),candidate=digest({source:sourceFiles,artifacts});
  let pushes=0;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url.endsWith('/health'))return res.end(JSON.stringify({capabilities:['human-upload-approval-v1']}));
    const chunks=[];for await(const part of req)chunks.push(part);let bytes=Buffer.concat(chunks);if(req.headers['content-encoding']==='gzip')bytes=gunzipSync(bytes);
    const body=JSON.parse(bytes);pushes++;res.end(JSON.stringify({status:'uploaded',projectId:body.projectId,siteType:'app',buildId:'TEST-build',previewPath:'/v2/current/test-project/index.html',reviewStatus:'approved',downloadable:true,binding:{siteType:'app',sourceFiles,baseBuild:'TEST-build'}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const id='trial',address={origin:'http://127.0.0.1:'+server.address().port,projectId:'test-project'},approval={decision:'approve',candidate,actor:'TEST designer',text:'TEST synthetic exact confirmation',at:new Date().toISOString()};
  const task={id,source,config:{siteType:'app',artifactRoot:'.'},initialSource:sourceFiles,candidates:[{hash:candidate,directory:path.dirname(site),source:sourceFiles,artifacts,artifactHash:digest(artifacts)}],approval,feedback:[{id:'feedback-1',...approval}],adjustmentClock:createAdjustmentClock('TEST synthetic start',Date.now()-60000)};
  const taskFile=path.join(data,'tasks',id,'task.json'),delivery=path.join(data,'tasks',id,'feedback-delivery.json');
  await writeJSON(taskFile,task);await writeJSON(path.join(data,'library/tasks',id+'.json'),address);
  await writeJSON(path.join(data,'library/profiles',digest(address)+'.json'),{...address,token:'TEST',expiresAt:Date.now()+60000,binding:{siteType:'app',sourceFiles,baseBuild:'TEST-before'}});
  const client={call:async()=>({pending:0}),close:async()=>{}};
  return {data,id,address,feedbackId:'feedback-1',approval,task,taskFile,delivery,client,pushes:()=>pushes};
}
test('one actual direct push recovers terminal confirmation-required and stops the exact task clock without replaying experience',async t=>{
  const f=await fixture(t),first=await deliverFeedback(f);assert.equal(first.channels.library.status,'confirmation-required');
  const experience=first.channels.experience;
  const pushed=await pushLibraryTask(f);assert.equal(pushed.status,'uploaded');
  const state=await readJSON(f.delivery);assert.equal(state.channels.library.status,'uploaded');assert.deepEqual(state.channels.experience,experience);
  assert.equal(adjustmentTiming(f.task,state).status,'completed');assert.equal(f.pushes(),1);
  const originalFinish=state.channels.library.finishedAt;
  assert.equal((await pushLibraryTask(f)).reused,true);assert.equal(f.pushes(),1);
  assert.equal((await readJSON(f.delivery)).channels.library.finishedAt,originalFinish);
});
test('MCP recovery reconciles a successful durable profile receipt after an interrupted task acknowledgment',async t=>{
  const f=await fixture(t),before=await deliverFeedback(f);await pushLibraryTask(f);
  await writeJSON(f.delivery,before); // Simulate crash after profile fsync and before job ack.
  let launches=0;const resumed=await recoverFeedbackDeliveries({...f,launch:async()=>{launches++;return {};}});
  assert.deepEqual(resumed.errors,[]);assert.equal(launches,0);assert.equal((await readJSON(f.delivery)).channels.library.status,'uploaded');assert.equal(f.pushes(),1);
});
test('connecting after a not-connected terminal job and pushing the same approved candidate reconciles without another confirmation',async t=>{
  const f=await fixture(t);await fs.rm(path.join(f.data,'library/tasks',f.id+'.json'));
  assert.equal((await deliverFeedback(f)).channels.library.status,'not-connected');
  await bindLibraryTask({...f,url:f.address.origin,project:f.address.projectId});
  await pushLibraryTask(f);assert.equal((await readJSON(f.delivery)).channels.library.status,'uploaded');assert.equal(f.pushes(),1);
});
test('a different human quote or current candidate never inherits the uploaded job receipt',async t=>{
  const f=await fixture(t);await deliverFeedback(f);
  await writeJSON(f.taskFile,{...f.task,approval:{...f.approval,text:'TEST different authorization'}});
  await pushLibraryTask(f);assert.equal((await readJSON(f.delivery)).channels.library.status,'confirmation-required');
  await writeJSON(f.taskFile,{...f.task,candidates:[{...f.task.candidates[0],hash:digest('TEST different candidate')} ]});
  await recoverFeedbackDeliveries({...f,launch:async()=>{throw Error('terminal job must not replay');}});
  assert.equal((await readJSON(f.delivery)).channels.library.status,'confirmation-required');
});
test('wrong origin/project, absent approval and unsuccessful receipts cannot complete the task timer',async t=>{
  const f=await fixture(t),before=await deliverFeedback(f);await pushLibraryTask(f);
  const confirmationFile=path.join(f.data,'library/approvals',f.id+'.json'),confirmation=await readJSON(confirmationFile);
  const uploaded=(await readJSON(f.delivery)).channels.library;
  for(const variant of ['origin','project','approval','pending','not-downloadable']){
    await writeJSON(f.delivery,before);await writeJSON(f.taskFile,variant==='approval'?{...f.task,approval:null}:f.task);
    await writeJSON(confirmationFile,{...confirmation,...(variant==='origin'?{origin:'http://wrong-origin.invalid'}:{}),...(variant==='project'?{projectId:'wrong-project'}:{})});
    const result={...uploaded.result,...(variant==='pending'?{status:'pending'}:{}),...(variant==='not-downloadable'?{downloadable:false}:{})};
    await acknowledgeLibraryUpload({data:f.data,id:f.id,candidate:f.approval.candidate,result,finishedAt:uploaded.finishedAt});
    const state=await readJSON(f.delivery);assert.equal(state.channels.library.status,'confirmation-required',variant);
    assert.equal(adjustmentTiming(await readJSON(f.taskFile),state).status,'in-progress',variant);
  }
});
