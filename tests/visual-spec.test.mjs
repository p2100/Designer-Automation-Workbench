import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generationStart,generationDirection,generationFeedback} from '../lib/generation.mjs';
import {searchCreative} from '../lib/creative-memory.mjs';
import {openTask,prepare,feedback,saveTask} from '../lib/workbench.mjs';
import {digest,command,root} from '../lib/io.mjs';
import {ExperienceStore} from '../lib/experience-memory.mjs';
import {ReliableExperienceClient} from '../lib/experience-delivery.mjs';
import {ExperienceClient} from '../lib/experience-client.mjs';
import {creativeCase,visualSpecCase} from '../lib/team-creative.mjs';
import {startExperienceServer} from '../lib/experience-server.mjs';
import {backupDocument,writeBackup,readBackup} from '../lib/experience-backup.mjs';

const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL1sAAAAASUVORK5CYII=','base64');
const quiet={search:async()=>({cases:[],source:'fixture'})};
const spec={observations:[{aspect:'layout',description:'Fixture: one visible pixel'},{aspect:'spacing',description:'Fixture: no surrounding content'}],applicability:'Synthetic single-pixel fixture',limits:'Only one synthetic image was inspected'};

test('image-based text observations survive offline delivery and are isolated by type and page without uploading the image',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'da-visual-text-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const data=path.join(dir,'designer-a'),other=path.join(dir,'designer-b'),store=new ExperienceStore(path.join(dir,'shared'));
 let service=await startExperienceServer({store,allowAnonymous:true});const url=service.url,port=service.server.address().port;await service.close();
 await generationStart({data,id:'first',siteType:'games',request:'Synthetic game',pages:['home','detail'],client:quiet});const f=path.join(dir,'direction.png');await fs.writeFile(f,image);
 const direction=await generationDirection({data,id:'first',image:f,prompt:'Synthetic fixture'});
 await assert.rejects(generationFeedback({data,id:'first',target:direction.id,page:'home',actor:'designer',text:'I like this',quote:'not said',component:'cards',observation:'Clear cards',visualSpec:spec}),/actual designer feedback/);
 await generationFeedback({data,id:'first',target:direction.id,page:'home',actor:'designer',text:'I like this',quote:'I like this',component:'cards',observation:'Clear cards',visualSpec:spec});
 const a=new ReliableExperienceClient({url,data,autoWorker:false,timeout:300});t.after(()=>a.close());await a.resume();assert.equal((await a.flush()).pending,2);
 service=await startExperienceServer({store,allowAnonymous:true,port});t.after(()=>service.close());assert.equal((await a.flush()).pending,0);
 const b=new ReliableExperienceClient({url,data:other,autoWorker:false,timeout:1000});t.after(()=>b.close());
 const find=(siteType,page)=>b.search({siteType,pages:[siteType==='coupon'?page:siteType+':'+page],includeCreative:true,includeRetired:true,includeVisualSpecs:true});
 const found=await find('games','home');assert.equal(found.creative.length,1);assert.deepEqual(found.creative[0].visualSpec,{...spec,evidenceHash:direction.hash});assert.equal(found.cases.length,0);
 assert.equal((await find('games','detail')).creative.length,0);assert.equal((await find('app','home')).creative.length,0);assert.equal((await find('coupon','home')).creative.length,0);
 const next=await generationStart({data:other,id:'new',siteType:'games',request:'Another game',pages:['home'],client:b});assert.equal(next.creative.teamReferences[0].visualSpec.evidenceHash,direction.hash);
 const state=await store.read();assert.equal(state.cases.length,2);assert(!JSON.stringify(state).includes(image.toString('base64')));assert(!JSON.stringify(state).includes(f));
 const archive=await writeBackup(path.join(dir,'backups'),backupDocument(state,{fixture:true}));assert.equal((await readBackup(archive.file)).cases.length,2);
});

test('correction revises visual text with provenance and withdrawal suppresses shared and local references',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'da-visual-revise-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const data=path.join(dir,'data');
 const store=new ExperienceStore(path.join(dir,'central')),server=await startExperienceServer({store,allowAnonymous:true});t.after(()=>server.close());
 await generationStart({data,id:'first',siteType:'app',request:'App',pages:['home'],client:quiet});const f=path.join(dir,'i.png');await fs.writeFile(f,image);const d=await generationDirection({data,id:'first',image:f,prompt:'fixture'});
 await generationFeedback({data,id:'first',target:d.id,page:'home',actor:'first designer',text:'I like it',quote:'I like it',component:'cards',observation:'Clear cards',visualSpec:spec});
 const c=new ReliableExperienceClient({url:server.url,data,autoWorker:false});t.after(()=>c.close());await c.resume();await c.flush();
 const search=()=>c.search({siteType:'app',pages:['app:home'],includeCreative:true,includeRetired:true,includeVisualSpecs:true});const initial=(await search()).creative[0];
 const revisedSpec={...spec,observations:[{aspect:'spacing',description:'Corrected observation'}]};
 const action={action:'replace',id:initial.id,expectedRevision:initial.revision,actor:'reviewer',reason:'Correct the spacing description',observation:'Corrected card grouping',visualSpec:revisedSpec};
 const changed=await c.manage(action);assert.equal(changed.sync,'saved');const current=(await search()).creative;assert.equal(current.length,1);assert.equal(current[0].visualSpec.observations[0].description,'Corrected observation');assert.equal(current[0].visualSpec.evidenceHash,d.hash);assert.equal(current[0].actor,'first designer');assert.equal(current[0].correction.actor,'reviewer');
 const history=await c.manage({action:'inspect',id:initial.id});assert.equal(history.reference.creativeHistory[0].reason,action.reason);
 await assert.rejects(store.manage({...action,observation:'stale correction'}),/stale/);
 await c.manage({action:'retract',id:current[0].id,expectedRevision:current[0].revision,actor:'reviewer',reason:'No longer applicable'});assert.equal((await search()).creative.length,0);
 const after=await generationStart({data,id:'after',siteType:'app',request:'App again',pages:['home'],client:c});assert.equal(after.creative.references.length,0);assert.equal(after.creative.teamReferences.length,0);
});

test('maintenance visual observations require a matching intact screenshot of the candidate and page',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'da-visual-maintenance-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const data=path.join(dir,'data'),source=path.join(dir,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'index.html'),'<!doctype html><main>fixture</main>');
 const config={version:1,siteType:'coupon',request:'Fixture',artifactRoot:'.',allowedPaths:['index.html'],widths:[393],commands:{},pages:[{id:'home',family:'home',route:'/index.html',dependsOn:['index.html']}]};
 let task=await openTask({data,id:'original',localSource:source,config});task=await prepare(data,'original');const candidate=task.candidates.at(-1).hash;
 const args={data,id:'original',candidate,actor:'designer',decision:'note',text:'I like this',creativeObservations:[{page:'home',component:'cards',quote:'I like this',observation:'Clear cards',visualSpec:spec}]};
 await assert.rejects(feedback(args),/intact actual screenshot/);
 const check=task.checks.find(c=>c.page==='home'),parent=path.join(data,'tasks','original','evidence',candidate);await fs.mkdir(parent,{recursive:true});const file=path.join(parent,'fixture.png');await fs.writeFile(file,image);
 task.results[check.id]={candidate,evidence:[{path:file,hash:digest(image)}]};await saveTask(data,task);
 const noted=await feedback(args);assert.equal(noted.feedback.at(-1).creativePoints[0].visualSpec.evidenceHash,digest(image));assert.notEqual(noted.status,'approved');
 await fs.appendFile(file,'changed');const found=await searchCreative(data,{siteType:'coupon',pages:['home']});assert.equal(found.references.length,1);assert.equal(found.references[0].visualSpec,undefined);assert(found.issues.some(i=>i.reason.includes('screenshot')));
});

test('designer unified CLI records an inspected text specification and automatically sends it through local MCP',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'da-visual-cli-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const data=path.join(dir,'data'),store=new ExperienceStore(path.join(dir,'central')),service=await startExperienceServer({store,allowAnonymous:true});t.after(()=>service.close());
 const run=async(...args)=>JSON.parse((await command([process.execPath,'bin/designer-automation.mjs','generate',...args,'--data',data],root,{env:{DA_EXPERIENCE_URL:service.url},timeout:30000})).output);
 await run('start','--id','first','--site-type','app','--request','Synthetic app','--pages','home');
 const imageFile=path.join(dir,'fixture.png'),specFile=path.join(dir,'spec.json');await fs.writeFile(imageFile,image);await fs.writeFile(specFile,JSON.stringify(spec));
 const direction=await run('direction','--id','first','--page','home','--image',imageFile,'--prompt','Synthetic test');
 const recorded=await run('feedback','--id','first','--target',direction.id,'--page','home','--actor','designer','--text','I like this','--quote','I like this','--component','cards','--observation','Clear cards','--visual-spec',specFile);assert.equal(recorded.visualLearning,'recorded');
 const deadline=Date.now()+10000;let state;do{state=await store.read();if(state.cases.length>=2)break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);assert.equal(state.cases.length,2);assert(!JSON.stringify(state).includes(image.toString('base64')));
});

test('older central service keeps visual text and corrections queued until upgraded',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'da-visual-old-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new ExperienceStore(path.join(dir,'store')),server=await startExperienceServer({store,allowAnonymous:true});t.after(()=>server.close());
 const ref={siteType:'app',page:'home',component:'cards',quote:'I like it',observation:'Clear cards',kind:'positive-reference',candidate:'a'.repeat(64),actor:'designer',source:'generation',task:'fixture',feedbackId:'feedback-1',at:'2026-10-27T00:00:00.000Z',visualSpec:{...spec,evidenceHash:'a'.repeat(64)}};
 const saved=await store.capture(creativeCase(ref)),client=new ExperienceClient({url:server.url});t.after(()=>client.close());const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>String(url).endsWith('/health')?new Response(JSON.stringify({status:'ok',service:'designer-automation-experience',capabilities:['creative-reference-v1']})):original(url,options);t.after(()=>{globalThis.fetch=original});
 const result=await client.search({siteType:'app',pages:['app:home'],includeCreative:true,includeVisualSpecs:true,includeRetired:true});assert.equal(result.creative.length,1);assert.match(result.warning,/upgrade/);
 await assert.rejects(client.capture(visualSpecCase(ref)),e=>e.retryable===true&&e.deferred===true);
 await assert.rejects(client.manage({action:'retract',id:saved.id,expectedRevision:1,actor:'designer',reason:'Wrong'}),e=>e.retryable===true&&e.deferred===true);
 assert.equal((await store.read()).cases.length,1);
});
