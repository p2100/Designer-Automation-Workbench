import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {root,digest,command,readJSON,writeJSON} from '../lib/io.mjs';
import {checkoutRepository,openTask,loadTask,prepare} from '../lib/workbench.mjs';
import {taskLesson} from '../lib/experience-task.mjs';
import {ExperienceStore} from '../lib/experience.mjs';
import {startExperienceServer} from '../lib/experience-server.mjs';

async function fixture(t){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'da-local-source-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const original=path.join(temp,'Designer site'),data=path.join(temp,'data');
  await fs.mkdir(original);
  await fs.writeFile(path.join(original,'index.html'),'<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><main><h1>Actual local draft</h1></main></body></html>');
  await fs.writeFile(path.join(original,'style.css'),'body{margin:0}main{width:900px}');
  await fs.writeFile(path.join(original,'.env.local'),'PRIVATE_FIXTURE_DO_NOT_COPY');
  await fs.mkdir(path.join(original,'node_modules'));await fs.writeFile(path.join(original,'node_modules','unused.txt'),'dependency');
  await fs.mkdir(path.join(original,'.git'));await fs.writeFile(path.join(original,'.git','config'),'fixture metadata');
  const config={version:1,siteType:'coupon',request:'Fix overflow in the actual local draft',artifactRoot:'.',allowedPaths:['**/*.css'],widths:[320],commands:{},pages:[{id:'home',family:'home',route:'/index.html',dependsOn:['index.html','style.css']}]};
  return {temp,original,data,config};
}

test('local import captures current files once, isolates edits and never copies private dependencies',async t=>{
  const {original,data,config}=await fixture(t);
  const first=await checkoutRepository({data,id:'local',localSource:original});
  assert.equal(first.kind,'local');assert.match(first.repo,/^local:[a-f0-9]{64}$/);assert(!first.repo.includes(original));
  assert.match(first.revision,/^local-snapshot:[a-f0-9]{64}$/);
  assert.equal(await fs.readFile(path.join(first.source,'style.css'),'utf8'),'body{margin:0}main{width:900px}');
  for(const file of ['.git','.env.local','node_modules'])await assert.rejects(fs.stat(path.join(first.source,file)),{code:'ENOENT'});
  await fs.writeFile(path.join(original,'index.html'),'Original changed after import');
  const again=await checkoutRepository({data,id:'local',localSource:original});assert(again.reusedWorkspace);
  assert.match(await fs.readFile(path.join(again.source,'index.html'),'utf8'),/Actual local draft/);
  const later=await checkoutRepository({data,id:'later',localSource:original});
  assert.equal(later.repo,first.repo);assert.notEqual(later.snapshotHash,first.snapshotHash);
  const task=await openTask({data,id:'local',localSource:original,config});assert.equal(task.sourceKind,'local');
  assert.equal(task.repo,first.repo);assert(!JSON.stringify(task).includes(original));
  assert((await prepare(data,'local')).candidates.length===1);
  assert.throws(()=>taskLesson({...task,config:{...task.config,siteType:undefined}},{learning:{transferable:true}},'fixture'),/actual site type/);
});

test('local rebuild discards stale output in the copy while preserving the original output',async t=>{
  const {original,data,config}=await fixture(t);
  await fs.mkdir(path.join(original,'dist'));
  await fs.writeFile(path.join(original,'dist','stale.html'),'old output');
  await fs.writeFile(path.join(original,'build.mjs'),"import fs from 'node:fs/promises';await fs.mkdir('dist',{recursive:true});await fs.writeFile('dist/index.html','<!doctype html><html><body>fresh</body></html>');");
  config.artifactRoot='dist';config.commands={build:[process.execPath,'build.mjs']};
  const task=await openTask({data,id:'build',localSource:original,config});
  const result=await prepare(data,'build'),candidate=result.candidates.at(-1);
  assert(!candidate.artifacts['stale.html']);assert(candidate.artifacts['index.html']);
  assert.equal(await fs.readFile(path.join(original,'dist','stale.html'),'utf8'),'old output');
  assert.equal(task.sourceKind,'local');
});

test('local import rejects unsafe or ambiguous inputs without touching the source',async t=>{
  const {original,data,config}=await fixture(t);
  await assert.rejects(checkoutRepository({data,id:'both',repo:original,localSource:original}),/exactly one/);
  await assert.rejects(checkoutRepository({data,id:'ref',localSource:original,ref:'main'}),/cannot use a Git ref/);
  await assert.rejects(checkoutRepository({data:path.join(original,'nested'),id:'nested',localSource:original}),/must not contain one another/);
  await assert.rejects(fs.stat(path.join(original,'nested')),{code:'ENOENT'});
  await fs.symlink('style.css',path.join(original,'linked.css'));
  await assert.rejects(checkoutRepository({data,id:'symlink',localSource:original}),/Symlinks require/);
  await fs.unlink(path.join(original,'linked.css'));
  const imported=await checkoutRepository({data,id:'changed',localSource:original});
  await fs.writeFile(path.join(imported.source,'style.css'),'changed in workspace');
  await assert.rejects(openTask({data,id:'changed',localSource:original,config}),/changed before task registration/);
  assert.equal(await fs.readFile(path.join(original,'style.css'),'utf8'),'body{margin:0}main{width:900px}');
});

test('CLI imports local source, audits, repairs and rechecks the frozen candidate',{skip:!process.env.SITE_BROWSER_EXECUTABLE},async t=>{
  const {temp,original,data,config}=await fixture(t), configFile=path.join(temp,'config.json');
  await writeJSON(configFile,config);
  const store=new ExperienceStore(path.join(temp,'experience'));
  const seen=[];const search=store.search.bind(store);store.search=async input=>{seen.push(input);return search(input);};
  const service=await startExperienceServer({store,allowAnonymous:true,maintainerToken:'synthetic-maintainer-token-long-enough'});
  t.after(()=>service.close());
  const env={SITE_BROWSER_EXECUTABLE:process.env.SITE_BROWSER_EXECUTABLE,DA_EXPERIENCE_URL:service.url,DA_EXPERIENCE_TOKEN:''};
  const run=(...args)=>command([process.execPath,'bin/workbench.mjs',...args,'--data',data],root,{env,timeout:120000});
  await run('checkout','--id','local','--source',original);
  await run('start','--id','local','--source',original,'--config',configFile);
  let task=await loadTask(data,'local');assert.equal(task.results['home/320/layout'].status,'fail');
  assert(seen.length>0);assert(seen.every(x=>x.site===task.repo&&!JSON.stringify(x).includes(original)));
  const css=await fs.readFile(path.join(task.source,'style.css'),'utf8'),first=task.candidates.at(-1);
  const edit=path.join(temp,'edit.json');await writeJSON(edit,{candidate:first.hash,edits:[{file:'style.css',expectedHash:digest(css),find:'width:900px',replace:'max-width:900px;width:100%'}]});
  await run('repair','--id','local','--file',edit);
  task=await loadTask(data,'local');assert.notEqual(task.candidates.at(-1).hash,first.hash);
  assert.equal(task.results['home/320/layout'].status,'pass');
  assert.equal(await fs.readFile(path.join(original,'style.css'),'utf8'),css);
  assert.equal(await fs.readFile(path.join(first.directory,'site','style.css'),'utf8'),css);
  await run('cycle','--id','local');
  const last=await loadTask(data,'local');assert.equal(last.results['home/320/layout'].status,'pass');
  assert.notEqual(last.status,'approved');
  assert.match(await fs.readFile(path.join(original,'.env.local'),'utf8'),/PRIVATE_FIXTURE/);
});
