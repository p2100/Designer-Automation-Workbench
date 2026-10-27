import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generationStart,generationDirection,generationFeedback} from '../lib/generation.mjs';
import {ExperienceStore} from '../lib/experience-memory.mjs';
import {startExperienceServer} from '../lib/experience-server.mjs';
import {ReliableExperienceClient} from '../lib/experience-delivery.mjs';
import {ExperienceClient} from '../lib/experience-client.mjs';
import {creativeCase} from '../lib/team-creative.mjs';

const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=','base64');
const quiet={search:async()=>({cases:[],source:'fixture'})};
test('verified creative feedback is automatically retried and shared across computers only for its type and page',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'da-team-creative-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const data=path.join(dir,'designer-a'),other=path.join(dir,'designer-b'),store=new ExperienceStore(path.join(dir,'central'));
  const service=await startExperienceServer({store,allowAnonymous:true});const port=service.server.address().port,url=service.url;await service.close();
  await generationStart({data,id:'draft',siteType:'games',request:'Game design',pages:['home','detail'],client:quiet});
  const file=path.join(dir,'direction.png');await fs.writeFile(file,image);
  const direction=await generationDirection({data,id:'draft',page:'home',image:file,prompt:'Test direction'});
  await generationFeedback({data,id:'draft',target:direction.id,page:'home',actor:'designer',text:'I like this spacing',quote:'I like this spacing',component:'cards',observation:'Spacious cards'});
  const first=new ReliableExperienceClient({url,data,timeout:200,autoWorker:false});t.after(()=>first.close());
  await first.resume();let result=await first.flush();assert.equal(result.pending,1);assert.equal((await store.read()).cases.length,0);
  const running=await startExperienceServer({store,allowAnonymous:true,port});t.after(()=>running.close());
  result=await first.flush();assert.equal(result.pending,0);assert.equal((await store.read()).cases.length,1);
  const second=new ReliableExperienceClient({url,data:other,timeout:1000,autoWorker:false});t.after(()=>second.close());
  const find=async(type,page)=>second.search({siteType:type,pages:[type==='coupon'?page:type+':'+page],includeCreative:true,includePending:true,limit:100});
  const found=await find('games','home');assert.equal(found.creative.length,1);assert.equal(found.creative[0].observation,'Spacious cards');assert.equal(found.creative[0].experienceUse,'creative-reference');assert.equal(found.cases.length,0);
  assert.equal((await find('games','detail')).creative.length,0);assert.equal((await find('app','home')).creative.length,0);assert.equal((await find('coupon','home')).creative.length,0);
  const next=await generationStart({data:other,id:'next',siteType:'games',request:'Another game',pages:['home'],client:second});assert.equal(next.creative.teamReferences.length,1);
  const third=new ReliableExperienceClient({url,data,timeout:1000,autoWorker:false});t.after(()=>third.close());await third.resume();await third.flush();assert.equal((await store.read()).cases.length,1);
  await assert.rejects(store.search({siteType:'app',pages:['games:home'],includeCreative:true}),/one site type/);
});

test('damaged historic evidence does not enter team library',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'da-team-invalid-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const data=path.join(dir,'a');
 const store=new ExperienceStore(path.join(dir,'central')),server=await startExperienceServer({store,allowAnonymous:true});t.after(()=>server.close());
 await generationStart({data,id:'bad',siteType:'app',request:'App',pages:['home'],client:quiet});const file=path.join(dir,'i.png');await fs.writeFile(file,image);const d=await generationDirection({data,id:'bad',image:file,prompt:'fixture'});
 await generationFeedback({data,id:'bad',target:d.id,page:'home',actor:'designer',text:'I like it',quote:'I like it',component:'cards',observation:'Clear cards'});await fs.appendFile(d.file,'damage');
 const client=new ReliableExperienceClient({url:server.url,data,autoWorker:false});t.after(()=>client.close());await client.resume();await client.flush();assert.equal((await store.read()).cases.length,0);
});

test('old shared service leaves creative cases queued and does not claim team search',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'da-team-old-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store=new ExperienceStore(path.join(dir,'central')),service=await startExperienceServer({store,allowAnonymous:true});t.after(()=>service.close());
 const client=new ExperienceClient({url:service.url,timeout:500});t.after(()=>client.close());
 const original=globalThis.fetch;globalThis.fetch=async (url,opts)=>String(url).endsWith('/health')?new Response(JSON.stringify({status:'ok',service:'designer-automation-experience',capabilities:['local-type-reference-v1']})):original(url,opts);t.after(()=>{globalThis.fetch=original});
 const found=await client.search({siteType:'app',pages:['app:home'],includeCreative:true});assert.deepEqual(found.creative,[]);assert.equal(found.creativeSource,'unavailable');
 const entry=creativeCase({siteType:'app',page:'home',component:'cards',quote:'I like it',observation:'Clear cards',kind:'positive-reference',candidate:'a'.repeat(64),actor:'designer',source:'generation',task:'fixture',feedbackId:'feedback-1',at:'2026-10-27T00:00:00.000Z'});
 await assert.rejects(client.capture(entry), error=>error.retryable===true && error.deferred===true);assert.equal((await store.read()).cases.length,0);
});
