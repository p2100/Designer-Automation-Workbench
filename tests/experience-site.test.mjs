import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {optionalExperienceSite, resolveExperienceSite, taskExperienceSite} from '../lib/experience-site.mjs';
import {selectTaskExperience} from '../lib/experience-selection.mjs';
import {createApplicationPlan, recordApplications, verifyApplications} from '../lib/experience-application.mjs';
import {generationStart, generationReviewInput} from '../lib/generation.mjs';
import {pulledSourceIdentity} from '../lib/library-client.mjs';
import {ExperienceStore} from '../lib/experience.mjs';
import {startExperienceServer} from '../lib/experience-server.mjs';
import {command, digest, root, readJSON, snapshot, writeJSON} from '../lib/io.mjs';
import {sample, candidate, lessonSpec} from './experience-fixture.mjs';
import {taskLesson} from '../lib/experience-task.mjs';
import {openTask} from '../lib/workbench.mjs';

const site='appsignal-test', other='different-app-test';
const scopedLesson={id:'TEST-app-white',revision:1,status:'active',classification:'site-preference',scope:{site,pages:['app:home'],component:'canvas'},learning:{when:'TEST same brand revision',transferable:false},prevention:'TEST preserve this brand white canvas'};
const configFor=identity=>({version:1,siteType:'app',...(identity===undefined?{}:{site:identity}),request:'TEST inspect this app source',artifactRoot:'.',allowedPaths:['index.html','site.json'],commands:{},widths:[393],pages:[{id:'home',family:'home',route:'/index.html',dependsOn:['index.html']}]});
async function fixture(t){const temp=await fs.mkdtemp(path.join(os.tmpdir(),'da-site-identity-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));return {temp,data:path.join(temp,'data')};}

test('optional stable identity rejects empty/invalid/conflicting input and normalizes repository aliases',()=>{
 assert.equal(optionalExperienceSite(undefined),undefined);
 for(const invalid of ['', '  ',null,7,{},'two sites','site\nid','https://user:secret@example.test/repo'])assert.throws(()=>optionalExperienceSite(invalid));
 assert.equal(resolveExperienceSite({site:'git@github.com:Org/Repo.git',boundSite:'https://github.com/org/repo'}),'github.com/org/repo');
 assert.equal(optionalExperienceSite('/tmp/TEST Repository'),'/tmp/test repository');
 assert.throws(()=>resolveExperienceSite({site,boundSite:other}),/conflicts/);
 assert.equal(taskExperienceSite({repo:'local:'+digest('TEST checkout'),libraryProjectId:site,config:{site}}),site);
});

test('active brand preferences are kept only for the exact stable site, including an overbroad service result',()=>{
 const result={cases:[scopedLesson]};
 assert.equal(selectTaskExperience(result,configFor(site)).length,1);
 for(const identity of [undefined,other]){
  assert.deepEqual(selectTaskExperience(result,configFor(identity)),[]);
  assert.deepEqual(createApplicationPlan({siteType:'app',site:identity,pages:['home'],lessons:result.cases}).entries,[]);
 }
 const plan=createApplicationPlan({siteType:'app',site,pages:['home'],lessons:result.cases});
 assert.equal(plan.site,site);assert.equal(plan.entries.length,1);
 assert.throws(()=>recordApplications({plan,decisions:[],config:configFor(other),source:{},candidate,checks:[]}),/site identity/);
});

test('identity mismatch is stale even for an empty plan; historical plans without identity still verify',async()=>{
 const plan=createApplicationPlan({siteType:'app',site,pages:['home']});
 assert.equal((await verifyApplications({plan,task:{config:configFor(other)}})).status,'stale');
 assert.equal((await verifyApplications({plan,task:{config:configFor(site)}})).status,'verified');
 const historical=createApplicationPlan({siteType:'app',pages:['home']});
 assert.equal((await verifyApplications({plan:historical,task:{config:configFor(site)}})).status,'verified');
});

test('pulled source identity is resolved without exposing profile credentials and rejects ambiguous bindings',async t=>{
 const {temp,data}=await fixture(t),source=path.join(temp,'pulled');
 await fs.mkdir(source);
 const profile={origin:'http://library.test',projectId:site,pullSource:source,token:'TEST-private-token',binding:{siteType:'app'}};
 await writeJSON(path.join(data,'library/profiles/one.json'),profile);
 assert.deepEqual(await pulledSourceIdentity(data,source),{site,siteType:'app'});
 assert.equal(await pulledSourceIdentity(data,path.join(temp,'other')),undefined);
 await writeJSON(path.join(data,'library/profiles/two.json'),{...profile,projectId:other});
 await assert.rejects(pulledSourceIdentity(data,source),/conflicting library site identities/);
});

test('all site types bind the supplied identity into the actual generation query and frozen plan',async t=>{
 const {data}=await fixture(t);
 for(const siteType of ['coupon','app','games']){
  const actualSite='TEST-'+siteType,queries=[];
  const run=await generationStart({data,id:siteType,siteType,site:actualSite,request:'TEST actual site request',pages:['home'],client:{search:async query=>{queries.push(query);return {cases:[],source:'TEST query capture'};}}});
  assert.equal(queries[0].site,actualSite.toLowerCase());
  assert.equal(run.site,actualSite.toLowerCase());assert.equal(run.experiencePlan.site,run.site);
 }
});

test('CLI generation and maintenance retrieve same-site preference over MCP and preserve review identity',async t=>{
 const {temp,data}=await fixture(t),store=new ExperienceStore(path.join(temp,'service')),queries=[];
 const original=store.search.bind(store);store.search=async query=>{queries.push(structuredClone(query));return original(query);};
 await store.capture(sample({site,classification:'site-preference',scope:scopedLesson.scope,learning:{key:'test.app.white-canvas',when:'TEST same brand revision',exceptions:[],transferable:false},verification:{retested:true,designerApproved:true,candidate,pages:['app:home']}}));
 const service=await startExperienceServer({store,allowAnonymous:true});t.after(()=>service.close());
 const run=async(...args)=>JSON.parse((await command([process.execPath,'bin/designer-automation.mjs',...args,'--data',data],root,{env:{DA_EXPERIENCE_URL:service.url},timeout:120000})).output);
 const generated=await run('generate','start','--id','same','--site-type','app','--site',site,'--request','TEST app site','--pages','home');
 assert.equal(generated.experiencePlan.site,site);assert.equal(generated.experiencePlan.entries.length,1);assert.equal(generated.experiencePlan.entries[0].reference.classification,'site-preference');
 for(const [id,identity]of [['other',other],['unknown',undefined]]){const different=await run('generate','start','--id',id,'--site-type','app','--request','TEST app site','--pages','home',...(identity?['--site',identity]:[]));assert.equal(different.experiencePlan.entries.length,0);}
 await fs.writeFile(path.join(generated.source,'index.html'),'<!doctype html><main>TEST real source</main>');
 await writeJSON(path.join(generated.source,'site.json'),{siteType:'app'});
 const reviewConfig=path.join(temp,'review.json');await writeJSON(reviewConfig,configFor());
 const input=await generationReviewInput({data,id:'same',configFile:reviewConfig});assert.equal(input.config.site,site);
 const review=await run('generate','review','--id','same','--config',reviewConfig,'--action','open');
 assert.equal(review.experiencePlan.site,site);assert.equal(review.experiencePlan.entries.length,1);
 const task=await readJSON(path.join(data,'tasks/gen-same/task.json'));assert.equal(task.config.site,site);assert.equal(task.fullExperiencePlan.site,site);
 await writeJSON(reviewConfig,configFor(other));
 await assert.rejects(run('generate','review','--id','same','--config',reviewConfig),/site identity must match/);
 const source=path.join(temp,'maintenance');await fs.mkdir(source);await fs.writeFile(path.join(source,'index.html'),'<!doctype html><main>TEST maintenance</main>');await writeJSON(path.join(source,'site.json'),{siteType:'app'});
 const configFile=path.join(temp,'maintenance.json');await writeJSON(configFile,configFor(site));
 const maintenance=await run('audit','open','--id','optimize','--source',source,'--config',configFile);
 assert.equal(maintenance.experiencePlan.site,site);assert.equal(maintenance.experiencePlan.entries.length,1);
 const optimized=await readJSON(path.join(data,'tasks/optimize/task.json'));assert.equal(optimized.config.site,site);assert.match(optimized.repo,/^local:/);
 assert(queries.filter(query=>query.site===site).length>=2);
 const legacyConfig=path.join(temp,'legacy.json');await writeJSON(legacyConfig,configFor());
 await run('audit','open','--id','legacy','--source',source,'--config',legacyConfig);
 const legacyFile=path.join(data,'tasks/legacy/task.json'),legacy=await readJSON(legacyFile);
 delete legacy.config.site;
 legacy.experiencePlan=legacy.fullExperiencePlan=createApplicationPlan({siteType:'app',pages:['home']});
 legacy.libraryProjectId=site;
 await writeJSON(legacyFile,legacy);
 const before=await fs.readFile(legacyFile);
 const reopened=await run('audit','open','--id','legacy','--source',source,'--config',legacyConfig);
 assert.equal(reopened.experiencePlan.site,undefined);assert.deepEqual(await fs.readFile(legacyFile),before);
 const profile={origin:'http://library.invalid.test',projectId:site,pullSource:source,token:'TEST-private-token',expiresAt:Date.now()+60000,binding:{siteType:'app',sourceFiles:await snapshot(source),baseBuild:'TEST-base'}};
 await writeJSON(path.join(data,'library/profiles/TEST-profile.json'),profile);
 const boundReopened=await run('audit','open','--id','legacy','--source',source,'--config',legacyConfig);
 assert.equal(boundReopened.experiencePlan.site,undefined);assert.deepEqual(await fs.readFile(legacyFile),before);
 await assert.rejects(run('audit','open','--id','conflict','--source',source,'--config',configFile,'--site',other),/conflicts/);
 await writeJSON(configFile,configFor(''));
 await assert.rejects(run('audit','open','--id','empty','--source',source,'--config',configFile),/Site identity/);
});

test('an existing local Git repository path containing spaces retains its original identity',async t=>{
 const {temp,data}=await fixture(t),repo=path.join(temp,'TEST Local Repository');await fs.mkdir(repo);
 await fs.writeFile(path.join(repo,'index.html'),'<!doctype html><main>TEST repository path</main>');await writeJSON(path.join(repo,'site.json'),{siteType:'app'});
 await command(['git','init','-b','main'],repo);await command(['git','add','.'],repo);
 // This is disposable fixture history, not a delivery code commit.
 await command(['git','-c','user.name=TEST Fixture','-c','user.email=fixture@invalid.test','commit','-m','TEST fixture\n\nPenny: recvyw1qqx'],repo);
 const before=await snapshot(repo),task=await openTask({data,id:'space-path',repo,config:configFor()});
 assert.equal(task.config.site,repo.toLowerCase());assert.equal(task.experiencePlan.site,task.config.site);
 assert.deepEqual(await snapshot(repo),before);
});

test('new feedback lessons use the stable central identity while retaining local provenance classification',()=>{
 const task={id:'TEST-task',repo:'local:'+digest('TEST isolated checkout'),sourceKind:'local',config:{siteType:'app',site,pages:[{id:'home',family:'home'}]},candidates:[{hash:candidate,source:{},artifactHash:candidate}],checks:[{id:'home/393/layout',page:'home'}],results:{'home/393/layout':{candidate,status:'pass'}},events:[],feedback:[{id:'revise',decision:'revise',candidate,text:'TEST correction'},{id:'approve',decision:'approve',candidate}],approval:{candidate,actor:'TEST designer',text:'TEST exact approval',at:'2026-11-02T00:00:00Z'}};
 const entry=taskLesson(task,{...lessonSpec(),classification:'site-preference',learning:{...lessonSpec().learning,transferable:false}},'TEST agent');
 assert.equal(entry.scope.site,site);assert.equal(entry.source.site,site);assert.equal(entry.classification,'site-preference');
 const localReference=taskLesson(task,lessonSpec(),'TEST agent');assert.equal(localReference.classification,'local-reference');assert.equal(localReference.source.site,task.repo);assert(localReference.evidence.some(item=>item.site===site));
});
