import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generationStart,generationStatus,generationDirection,generationFeedback,generationReviewInput,generationGamesPlan} from '../lib/generation.mjs';
import {searchCreative} from '../lib/creative-memory.mjs';
import {openTask,prepare,feedback} from '../lib/workbench.mjs';
import {writeJSON} from '../lib/io.mjs';
import {root,command,readJSON} from '../lib/io.mjs';
import {ExperienceStore} from '../lib/experience.mjs';
import {startExperienceServer} from '../lib/experience-server.mjs';

const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=','base64');
const silent={search:async()=>({cases:[],source:'fixture'})};
async function fixture(t){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'da-generation-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));return {temp,data:path.join(temp,'data')};}

test('Games generation freezes live experience with actual route and component quality plan',async t=>{
  const {temp,data}=await fixture(t),reference={id:'case-'+'a'.repeat(32),siteType:'games',page:'home',observation:'Check actual card capacity',experienceUse:'creative-reference'};
  const client={search:async()=>({cases:[],creative:[reference],source:'fixture',creativeTruncated:false})};
  const run=await generationStart({data,id:'quality',siteType:'games',gameType:'store-referral',request:'Synthetic game store',pages:['home','detail'],client});
  assert.equal(run.gamesQuality.status,'awaiting-route-and-module-inventory');
  const reviewFile=path.join(temp,'review-config.json');await writeJSON(reviewFile,{siteType:'games',pages:[{family:'home',route:'/index.html'}]});await assert.rejects(generationReviewInput({data,id:'quality',configFile:reviewFile}),/quality plan/);
  const task=await readJSON(path.join(root,'site-types/games/examples/task.json'));const taskFile=path.join(temp,'game-task.json');await writeJSON(taskFile,task);
  const result=await generationGamesPlan({data,id:'quality',taskFile});assert.equal(result.status,'planned');
  const plan=await readJSON(path.join(result.planPath,'plan.json'));assert.equal(plan.qualityWorkflow,2);assert(plan.items.some(item=>item.referenceId===reference.id));assert.equal(plan.items.filter(item=>item.family==='acceptance-01-40').length,40);
  await fs.writeFile(path.join(run.source,'index.html'),'<h1>Fixture</h1>');assert.equal((await generationReviewInput({data,id:'quality',configFile:reviewFile})).source,run.source);
  await assert.rejects(generationGamesPlan({data,id:'quality',taskFile}),/already exists/);
});

test('one generation entry loads matching author rules and freezes the portable package',async t=>{
  const {data}=await fixture(t);
  for(const type of ['coupon','app','games']){
    const pages=type==='coupon'?['home','offer-detail']:['home','detail'];
    const run=await generationStart({data,id:type,siteType:type,request:'Synthetic actual site brief',pages,client:silent});
    assert.equal(run.status,'awaiting-agent-design');
    assert.equal((await fs.readdir(run.source)).length,0);
    assert.deepEqual(run.pages,pages);
    for(const context of run.contexts){
      assert(context.read.includes('core/creative-generation.md'));
      assert(context.read.includes('knowledge/shared/layout-and-space.md'));
      if(type==='app')assert(context.read.some(p=>p.startsWith('site-types/app/')));
      if(type==='games')assert(context.read.includes('site-types/games/core/web-game-publishing-experience.md'));
      if(type!=='coupon')assert(!context.read.some(p=>p.startsWith('knowledge/imported/')));
    }
    await assert.rejects(generationStart({data,id:type,siteType:type,request:'Second task',pages,client:silent}),/already exists/);
  }
  await assert.rejects(generationStart({data,id:'unknown',request:'Ambiguous product',client:silent}),/actual site type/);
  await assert.rejects(generationStart({data,id:'wrong-type',siteType:'app',request:'Create a coupon site',client:silent}),/conflicts with the explicit product/);
  const inferred=await generationStart({data,id:'inferred',request:'Build a coupon site',pages:['home'],client:silent});assert.equal(inferred.siteType,'coupon');
  await assert.rejects(generationStart({data,id:'mix',siteType:'app',request:'App',pages:['home','play'],client:silent}),/Unknown page family/);
  await assert.rejects(generationStart({data,id:'store',siteType:'games',request:'Store only',gameType:'store-referral',pages:['home','play'],client:silent}),/do not have a play/);
  const full=await generationStart({data,id:'full-app',siteType:'app',request:'Complete app site',client:silent});
  for(const page of ['home','detail','version','article','category','information'])assert(full.pages.includes(page));
  const store=await generationStart({data,id:'full-store',siteType:'games',request:'Store referral',gameType:'store-referral',client:silent});
  assert(!store.pages.includes('play'));assert(store.pages.includes('detail'));
  const coupon=await generationStart({data,id:'full-coupon',siteType:'coupon',request:'Complete coupon site',client:silent});assert(coupon.pages.includes('offer-detail'));assert(coupon.pages.includes('store-detail'));
  await fs.appendFile(path.join(inferred.rules.directory,'core/creative-generation.md'),'\nfixture mutation');
  await assert.rejects(generationStatus(data,'inferred'),/differs from manifest|Frozen generation rules changed/);
});

test('one CLI carries an App direction and real feedback into a new same-type task and browser review',{skip:!process.env.SITE_BROWSER_EXECUTABLE},async t=>{
  const {temp,data}=await fixture(t),store=new ExperienceStore(path.join(temp,'store'));
  const service=await startExperienceServer({store,allowAnonymous:true});t.after(()=>service.close());
  const env={DA_EXPERIENCE_URL:service.url,SITE_BROWSER_EXECUTABLE:process.env.SITE_BROWSER_EXECUTABLE,DA_PLAYWRIGHT_MODULE:process.env.DA_PLAYWRIGHT_MODULE||import.meta.resolve('playwright-core')};
  const run=async(...args)=>JSON.parse((await command([process.execPath,'bin/designer-automation.mjs','generate',...args,'--data',data],root,{env,timeout:120000})).output);
  const first=await run('start','--id','first','--site-type','app','--request','Synthetic app site','--pages','home');
  const imageFile=path.join(temp,'direction.png');await fs.writeFile(imageFile,image);
  const direction=await run('direction','--id','first','--page','home','--image',imageFile,'--prompt','Synthetic test image');
  await run('feedback','--id','first','--target',direction.id,'--page','home','--actor','designer','--text','I like the card arrangement','--quote','I like the card arrangement','--component','cards','--observation','Card arrangement is clear');
  await fs.writeFile(path.join(first.source,'site.json'),JSON.stringify({siteType:'app'}));
  await fs.writeFile(path.join(first.source,'index.html'),'<!doctype html><html><body><main><h1>Actual synthetic app source</h1></main></body></html>');
  const config={version:1,siteType:'app',request:'Review synthetic app',artifactRoot:'.',allowedPaths:['index.html'],widths:[393],commands:{},pages:[{id:'home',family:'home',route:'/index.html',dependsOn:['index.html']}]};
  const configFile=path.join(temp,'agent-config.json');await writeJSON(configFile,config);
  const review=await run('review','--id','first','--config',configFile,'--action','start');
  assert.equal(review.status,'reviewing');assert(review.candidate);assert.notEqual(review.status,'approved');assert.equal(review.generation.homeDirection,'recorded');
  const task=await readJSON(path.join(data,'tasks/gen-first/task.json'));
  const feedbackFile=path.join(temp,'feedback.json');await writeJSON(feedbackFile,{candidate:task.candidates.at(-1).hash,actor:'designer',decision:'note',text:'I like this heading',creativeObservations:[{page:'home',component:'heading',quote:'I like this heading',observation:'Heading is clear'}]});
  const note=JSON.parse((await command([process.execPath,'bin/designer-automation.mjs','audit','feedback','--id','gen-first','--file',feedbackFile,'--data',data],root,{env})).output);
  assert.equal(note.creativeFeedback,'saved-local');assert.notEqual(note.status,'approved');
  const second=await run('start','--id','next','--site-type','app','--request','Another app site','--pages','home');
  assert.equal(second.creative.references.length,2);
  const other=await run('start','--id','game','--site-type','games','--request','Different game site','--pages','home');
  assert.equal(other.creative.references.length,0);
});

test('explicit designer satisfaction on a real registered direction is learned only for matching type and page',async t=>{
  const {temp,data}=await fixture(t),source=path.join(temp,'image.png');await fs.writeFile(source,image);
  await generationStart({data,id:'first',siteType:'games',request:'Synthetic game design',pages:['home','detail'],client:silent});
  const direction=await generationDirection({data,id:'first',image:source,prompt:'Synthetic image fixture only'});
  await assert.rejects(generationFeedback({data,id:'first',target:direction.id,page:'home',actor:'designer',text:'I like this card grouping',quote:'not said',component:'cards',observation:'Compact grouping'}),/quote the actual/);
  await generationFeedback({data,id:'first',target:direction.id,page:'home',actor:'designer',text:'I like this card grouping',quote:'I like this card grouping',component:'cards',observation:'Compact grouping'});
  const same=await generationStart({data,id:'next',siteType:'games',request:'Another game design',pages:['home'],client:silent});
  assert.equal(same.creative.references.length,1);
  assert.equal(same.creative.references[0].candidate,direction.hash);
  assert.equal(same.creative.references[0].observation,'Compact grouping');
  assert.equal((await generationStart({data,id:'app',siteType:'app',request:'An app site',pages:['home'],client:silent})).creative.references.length,0);
  assert.equal((await searchCreative(data,{siteType:'games',pages:['detail']})).references.length,0);
  assert.equal((await searchCreative(path.join(temp,'different-designer'),{siteType:'games',pages:['home']})).references.length,0);
  assert.equal((await generationStatus(data,'first')).feedback.length,1);
  await generationFeedback({data,id:'first',target:direction.id,page:'home',actor:'designer',text:'I dislike the dark background',quote:'I dislike the dark background',component:'background',observation:'Dark background was rejected here',sentiment:'negative'});
  const memories=await searchCreative(data,{siteType:'games',pages:['home']});
  assert(memories.references.some(point=>point.kind==='avoid-reference'));
  assert.equal((await generationStatus(data,'first')).status,'needs-design-revision');
  await fs.appendFile(direction.file,'modified');
  const damaged=await searchCreative(data,{siteType:'games',pages:['home']});
  assert.equal(damaged.references.length,0);assert(damaged.issues.length>0);
  await assert.rejects(generationFeedback({data,id:'first',target:direction.id,page:'home',actor:'designer',text:'I like this',quote:'I like this',component:'cards',observation:'Card design'}),/intact actual direction/);
  await fs.writeFile(source,'not an image');await assert.rejects(generationDirection({data,id:'first',image:source,prompt:'Broken'}),/actual PNG/);
});

test('positive notes on a maintained site persist without approving it or invalidating checks',async t=>{
  const {temp,data}=await fixture(t),source=path.join(temp,'source');await fs.mkdir(source);
  await fs.writeFile(path.join(source,'index.html'),'<!doctype html><main>Fixture</main>');
  const config={version:1,siteType:'coupon',request:'Synthetic site',artifactRoot:'.',allowedPaths:['index.html'],widths:[393],commands:{},pages:[{id:'home',family:'home',route:'/index.html',dependsOn:['index.html']}]};
  let task=await openTask({data,id:'original',localSource:source,config});task=await prepare(data,'original');
  const original=task.status;
  task=await feedback({data,id:'original',candidate:task.candidates.at(-1).hash,actor:'designer',decision:'note',text:'I like this title spacing',creativeObservations:[{page:'home',component:'heading',quote:'I like this title spacing',observation:'Heading spacing feels clear'}]});
  assert.equal(task.status,original);assert.equal(task.approval??null,null);assert.equal(task.experienceDeliveries?.length||0,0);
  assert.equal((await searchCreative(data,{siteType:'coupon',pages:['home']})).references.length,1);
  assert.equal((await searchCreative(data,{siteType:'app',pages:['home']})).references.length,0);
  const next=await openTask({data,id:'next',localSource:source,config});assert.equal(next.creative.references.length,1);
  await assert.rejects(feedback({data,id:'original',candidate:task.candidates.at(-1).hash,actor:'designer',decision:'note',text:'looks fine'}),/specific positive/);
  await assert.rejects(feedback({data,id:'original',candidate:task.candidates.at(-1).hash,actor:'designer',decision:'note',text:'I dislike it',creativeObservations:[{page:'home',component:'heading',quote:'I dislike it',observation:'Rejected heading',sentiment:'negative'}]}),/Use revise/);
});

test('generation hands actual source to the existing review entry without accepting empty or wrong-type sources',async t=>{
  const {temp,data}=await fixture(t);
  const run=await generationStart({data,id:'review',siteType:'app',request:'Synthetic app',pages:['home','detail'],client:silent});
  const config={version:1,siteType:'app',request:'Review synthetic app',artifactRoot:'.',allowedPaths:['index.html'],widths:[393],commands:{},pages:[{id:'home',family:'home',route:'/index.html',dependsOn:['index.html']}]};
  const configFile=path.join(temp,'review.json');await writeJSON(configFile,config);
  await assert.rejects(generationReviewInput({data,id:'review',configFile}),/No actual site source/);
  await fs.writeFile(path.join(run.source,'index.html'),'<!doctype html><main>Actual test source</main>');
  const input=await generationReviewInput({data,id:'review',configFile});assert.equal(input.source,run.source);assert.equal(input.id,'gen-review');assert.deepEqual(input.unreviewedPages,['detail']);assert.equal(input.homeDirection,'not-run');
  await writeJSON(configFile,{...config,siteType:'coupon'});await assert.rejects(generationReviewInput({data,id:'review',configFile}),/site type must match/);
});
