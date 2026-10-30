import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {libraryAddress,uploadAfterApproval,recordLibraryFeedback} from '../lib/library-client.mjs';
import {digest,snapshot,writeJSON} from '../lib/io.mjs';
import {designerAutomation} from '../bin/designer-automation.mjs';

test('library identity comes from an explicit project or exact preview/current URL',()=>{
 assert.deepEqual(libraryAddress('http://192.168.12.9:4187/v2/preview/game-alpha/b-current/alpha/index.html'),{origin:'http://192.168.12.9:4187',projectId:'game-alpha'});
 assert.equal(libraryAddress('https://library.example/v2/current/app-one/').projectId,'app-one');
 assert.equal(libraryAddress('https://library.example/v2/','coupon-one').projectId,'coupon-one');
 for(const url of ['file:///tmp/source','https://user:secret@example.com/v2/current/alpha/','https://example.com/','https://example.com/v2/current/../','http://example.com/v2/current/alpha/#fragment'])assert.throws(()=>libraryAddress(url));
});
test('standalone feedback keeps exact statement and scoped items on the correct candidate, then queues unverified facts',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'da-feedback-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const data=path.join(dir,'data'),source=path.join(dir,'source'),output=path.join(dir,'output'),site=path.join(dir,'candidate','site');
 for(const p of [source,output,site])await fs.mkdir(p,{recursive:true});
 await fs.writeFile(path.join(source,'index.html'),'source');await fs.writeFile(path.join(output,'index.html'),'output');await fs.writeFile(path.join(site,'index.html'),'output');
 const sourceFiles=await snapshot(source),artifacts=await snapshot(output),hash=digest({source:sourceFiles,artifacts});
 const address={origin:'http://example.test',projectId:'game-alpha'};
 await writeJSON(path.join(data,'library','tasks','trial.json'),address);
 await writeJSON(path.join(data,'library','profiles',digest(address)+'.json'),{...address,token:'fixture',expiresAt:Date.now()+100000,binding:{baseBuild:'build-before',siteType:'games'}});
 await writeJSON(path.join(data,'library','uploads','trial.json'),{id:'trial',kind:'library-upload',source,output,config:{siteType:'games',artifactRoot:'.'},candidates:[{hash,directory:path.dirname(site),source:sourceFiles,artifactHash:digest(artifacts)}]});
 const entries=[],clientFactory=()=>({initialize:async()=>{},enqueue:async x=>entries.push(x),resume:async()=>{},close:async()=>{}});
 const feedback={candidate:hash,actor:'Designer',text:'首页卡片间距太大；详情按钮太小',at:'2026-10-30T04:00:00.000Z',items:[{quote:'首页卡片间距太大',summary:'缩小卡片间距',pages:['home'],component:'cards'},{quote:'详情按钮太小',summary:'增加按钮容量',pages:['detail'],component:'button'}]};
 const result=await recordLibraryFeedback({data,id:'trial',feedback,clientFactory});assert.equal(result.sync.status,'queued');assert.equal(result.sync.shared,false);assert.equal(entries.length,2);assert.equal(entries[0].evidence[0].originalFeedback,feedback.text);assert.equal(entries[0].evidence[0].baseBuild,'build-before');assert.equal(entries[0].verification.designerApproved,false);
 const stored=JSON.parse(await fs.readFile(path.join(data,'library','feedback','trial',result.recordId+'.json')));assert.equal(stored.text,feedback.text);assert.equal(stored.candidate,hash);
 const unknown=await recordLibraryFeedback({data,id:'trial',feedback:{...feedback,items:[{quote:'首页卡片间距太大',summary:'等待定位'}]},clientFactory});assert.equal(unknown.sync.status,'pending-location');assert.equal(unknown.sync.unlocated,1);
 await assert.rejects(recordLibraryFeedback({data,id:'trial',feedback:{...feedback,items:[{...feedback.items[0],quote:'伪造'}]},clientFactory}),/exact quote/);
 const pending=await recordLibraryFeedback({data,id:'trial',feedback,clientFactory:()=>({initialize:async()=>{throw Error('offline fixture')},close:async()=>{}})});assert.equal(pending.sync.status,'pending');assert.equal(pending.recordId,result.recordId);
 await fs.writeFile(path.join(output,'index.html'),'changed');await assert.rejects(recordLibraryFeedback({data,id:'trial',feedback,clientFactory}),/已变化/);
});
test('unconnected maintenance tasks never upload or change learning records',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'da-library-not-connected-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));
 assert.deepEqual(await uploadAfterApproval(data,'task-one'),{status:'not-connected'});assert.deepEqual(await fs.readdir(data),[]);
 const help=await designerAutomation(['library','help']);assert(help.commands.connect);assert(help.commands.push);
 await assert.rejects(designerAutomation(['library','push','--id']),/Expected --key value/);
});
