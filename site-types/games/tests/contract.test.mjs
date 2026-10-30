import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, validateTask, createPlan, selectDesignReferences, inventory, sha, verifyPackage, packPackage, initRun, freezeCandidate, verifyRun, validateReview } from '../lib/contract.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = () => readJson(path.join(root, 'examples/task.json'));
const temporary = async (t) => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'game-contract-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; };
test('public package reproduces in a clean directory, rejects tampering and preexisting output', async (t) => {
  const dir = await temporary(t), copy = path.join(dir, 'portable');
  await packPackage(root, copy); await verifyPackage(copy);
  await assert.rejects(packPackage(root, copy), /already exists/);
  await fs.appendFile(path.join(copy, 'core/quality.md'), 'drift');
  await assert.rejects(verifyPackage(copy), /differ/);
});
test('unknown type, unofficial store, mismatched product identity and play contamination rejected', async () => {
  const task = await example();
  for (const mutate of [x => x.type = 'coupon', x => x.samples[0].stores[0].url = 'https://download.example.com/store/apps/details?id=com.mojang.minecraftpe', x => x.samples[0].stores[0].productId = 'other.game', x => x.samples[0].playUrl = 'runtime/other.html', x => x.routes[0].path = '../outside.html']) {
    const invalid = structuredClone(task); mutate(invalid); assert.throws(() => validateTask(invalid));
  }
});
test('plan retains breakpoint neighbors and every module state', async () => {
  const plan = createPlan(await example());
  assert.deepEqual(plan.viewports.filter(v => v.id.startsWith('bp-')).map(v => v.width), [699,700,701]);
  assert.equal(plan.items.filter(x=>x.family!=='owner-games-contract').length, 24); assert.equal(new Set(plan.items.map(x => x.id)).size,plan.items.length);
});
test('immutable run, exact candidate and complete independent evidence gates', async (t) => {
  const dir = await temporary(t), run = path.join(dir,'run'), candidate = path.join(dir,'site');
  const plan = await initRun(root,path.join(root,'examples/task.json'),run);
  await fs.mkdir(candidate); await fs.writeFile(path.join(candidate,'index.html'),'<h1>Real candidate</h1>');
  const frozen = await freezeCandidate(candidate,run); await verifyRun(run);
  await assert.rejects(freezeCandidate(candidate,run),/already exists/);
  await fs.writeFile(path.join(run,'evidence/observation.txt'),'Test fixture record, not actual visual acceptance.');
  const evidence = {path:'evidence/observation.txt',sha256:sha(await fs.readFile(path.join(run,'evidence/observation.txt')))};
  const review = {role:'independent-reviewer',reviewer:'fixture-reviewer',candidateDigest:frozen.candidateDigest,items:[...plan.items.map(x=>x.id),'exhaustive-routes','cross-site-distinction'].map(id=>({id,status:'pass',observation:'Fixture only',evidence:[evidence]})),issues:[]};
  assert.equal((await validateReview(run,review)).status,'record-integrity-checked');
  const missing = structuredClone(review); missing.items.pop(); await assert.rejects(validateReview(run,missing),/coverage/);
  const self = {...review,reviewer:'receiving-author-agent'}; await assert.rejects(validateReview(run,self),/Independent/);
  const pending=structuredClone(review); pending.items[0].status='not-run'; await assert.rejects(validateReview(run,pending),/not-run/);
  const other={...review,candidateDigest:'wrong'}; await assert.rejects(validateReview(run,other),/another candidate/);
  await fs.appendFile(path.join(run,'candidate/index.html'),'drift'); await assert.rejects(verifyRun(run),/candidate changed/);
  await fs.appendFile(path.join(run,'inputs/task.json'),' '); await assert.rejects(verifyRun(run),/task changed/);
});
test('symlink payloads rejected', async(t)=>{const dir=await temporary(t);await fs.symlink('/tmp',path.join(dir,'linked'));await assert.rejects(inventory(dir),/Symlinks/);});
test('same-width short and tall viewports both remain in evidence coverage',async()=>{const task=await example();task.viewports.push({id:'short-phone',width:393,height:400});const plan=createPlan(task);assert.equal(plan.viewports.filter(x=>x.width===393).length,2);assert.equal(plan.items.filter(x=>x.viewport.id==='short-phone'&&x.family!=='owner-games-contract').length,4);assert(plan.items.some(x=>x.viewport.id==='short-phone'&&x.family==='owner-games-contract'));});
test('current owner contract requires routed page checks at every viewport',async()=>{const task=await example(),plan=createPlan(task),owned=plan.items.filter(x=>x.family==='owner-games-contract');assert.equal(plan.ownerContract,(await readJson(path.join(root,'core/owner-requirements.json'))).version);for(const route of task.routes.filter(x=>['home','detail','play'].includes(x.page)))for(const viewport of plan.viewports)assert(owned.some(x=>x.route===route.path&&x.viewport.id===viewport.id));assert(!owned.some(x=>x.module.startsWith('playable-')));assert(owned.some(x=>x.module==='download-gallery-height'));assert(owned.some(x=>x.module==='detail-capability-route'));});
test('SP route and language checks are included for web-play review plans',async()=>{const task=await example(),web=structuredClone(task);web.type='web-play';for(const sample of web.samples)Object.assign(sample,{runtime:'https://example.com/game/',inputClaims:['fixture'],verificationStatus:'not-run'});const plan=createPlan(web);for(const id of ['sp-game-routing-and-delivery','sp-game-localized-delivery']){const item=plan.items.find(x=>x.module===id);assert(item,id+' missing');assert.equal(item.source,'core/web-game-publishing-experience.md');assert.match(item.when,/SP-connected/);}assert(!createPlan(task).items.some(x=>x.module==='sp-game-localized-delivery'));});
test('web-play plans include approved homepage TDK and original brand-copy checks',async()=>{const task=await example();task.type='web-play';for(const sample of task.samples)Object.assign(sample,{runtime:'https://example.com/game/',inputClaims:['fixture'],verificationStatus:'not-run'});const plan=createPlan(task);for(const id of ['game-home-approved-tdk','game-original-brand-copy']){const item=plan.items.find(x=>x.module===id);assert(item,id+' missing');assert.equal(item.source,'core/web-game-publishing-experience.md');}assert(plan.items.filter(x=>x.module==='game-home-approved-tdk').every(x=>x.route==='index.html'));});
test('known repeated-card defects become plan requirements beyond a single reported location',async()=>{
  const task=await example(),plan=createPlan(task);
  for(const route of task.routes.filter(x=>['home','detail'].includes(x.page)))for(const viewport of plan.viewports)for(const rule of ['game-card-single-line','game-card-caption-alignment','game-card-spacing-capacity','component-wide-sweep','search-result-capacity','game-action-label-capacity','current-preview-and-artifact']){
    assert(plan.items.some(x=>x.module===rule&&x.route===route.path&&x.viewport.id===viewport.id),`${rule} missing for ${route.path}/${viewport.id}`);
  }
  assert(plan.items.some(x=>x.module==='component-wide-sweep'&&x.requirement.includes('lower recommendations')));
  assert(plan.items.some(x=>x.module==='search-result-capacity'&&x.requirement.includes('long-name')));
});
test('web-play plans require game semantics, width containment, truthful loading and independent inner pages',()=>{
  const task={version:1,id:'web-quality-fixture',type:'web-play',audience:'Fixture for a real source-linked game discovery flow; not live acceptance.',language:'en',author:'fixture-author',sources:[{id:'mzgen',url:'https://mzgen.com/game/detail/sky_swarm_19.html',checkedAt:'2026-10-26T00:00:00Z'}],samples:[{id:'sky',title:'Sky Swarm',sourceIds:['mzgen'],runtime:'https://mzgen.com/new-game/sky-swarm/index.html',inputClaims:['Source keyboard input; test fixture only'],verificationStatus:'not-run-fixture'}],routes:[{path:'index.html',page:'home'},{path:'game/sky.html',page:'detail'},{path:'play/sky.html',page:'play'}],modules:[{id:'identity',route:'game/sky.html',job:'Real identity and action',family:'game-identity',samples:['sky'],states:['rest']}],viewports:[{id:'pc',width:1440,height:1000},{id:'phone',width:393,height:844},{id:'narrow',width:320,height:844}],breakpoints:[700],capabilities:[{name:'browser',status:'not-probed'}],delivery:{source:true,evidence:true}};
  const plan=createPlan(task);
  for(const route of task.routes)for(const viewport of plan.viewports)for(const rule of ['approved-reference-precedence','multi-site-inner-page-distinction','game-hover-semantics','source-core-module-whitelist'])assert(plan.items.some(x=>x.module===rule&&x.route===route.path&&x.viewport.id===viewport.id),`${rule} missing`);
  for(const viewport of plan.viewports)for(const rule of ['game-stage-width-containment','brand-loading-and-readiness'])assert(plan.items.some(x=>x.module===rule&&x.route==='play/sky.html'&&x.viewport.id===viewport.id),`${rule} missing`);
  const layout=plan.items.find(x=>x.module==='playable-layout');assert.match(layout.requirement,/current task's approved reference/);assert.match(layout.requirement,/do not apply an earlier/);
});
test('duplicate coverage identities cannot silently collapse',async()=>{const task=await example();task.modules[0].states.push('loaded');assert.throws(()=>createPlan(task),/Unique state/);task.modules[0].states.pop();task.viewports.push({...task.viewports[0]});assert.throws(()=>createPlan(task),/Duplicate viewport/);});
test('a symlink ancestor cannot place package output inside the source rules',async(t)=>{const dir=await temporary(t),copy=path.join(dir,'rules'),alias=path.join(dir,'alias');await packPackage(root,copy);await fs.symlink(copy,alias);await assert.rejects(packPackage(copy,path.join(alias,'nested-output')),/outside/);await verifyPackage(copy);});
test('missing identifiers are not coerced to the word undefined',async()=>{for(const mutate of [x=>delete x.id,x=>delete x.modules[0].id,x=>delete x.viewports[0].id]){const task=await example();mutate(task);assert.throws(()=>validateTask(task));}});

test('complete games plans carry information pages and the current no-category homepage checks',async()=>{const plan=createPlan(await example());for(const id of ['home-discovery-distinction','home-no-category-module','home-full-width-gutters','required-information-pages','section-browse-brand-controls'])assert(plan.items.some(x=>x.module===id),id+' missing');assert(!plan.items.some(x=>x.route==='index.html'&&x.module==='home-category-truth-and-links'));});

test('required homepage history and introduction are planned for every home viewport only',async()=>{const task=await example(),plan=createPlan(task);for(const id of ['home-recently-viewed-required','home-brand-introduction-required']){for(const route of task.routes.filter(x=>x.page==='home'))for(const viewport of plan.viewports)assert(plan.items.some(x=>x.module===id&&x.route===route.path&&x.viewport.id===viewport.id),id+' missing');assert(!plan.items.some(x=>x.module===id&&!task.routes.some(r=>r.path===x.route&&r.page==='home')));}const history=plan.items.find(x=>x.module==='home-recently-viewed-required');assert.match(history.requirement,/clear/);assert.match(history.requirement,/real/i);const introduction=plan.items.find(x=>x.module==='home-brand-introduction-required');assert.match(introduction.requirement,/brand/i);assert.match(introduction.requirement,/dedicated/i);});

test('designer learning stays scoped and is not promoted into mandatory owner coverage',async()=>{const learning=await readJson(path.join(root,'core/designer-learning.json')),plan=createPlan(await example());assert.equal(learning.entries.length,learning.uniqueTopics);assert.equal(new Set(learning.entries.flatMap(e=>e.sources.map(s=>s.id))).size,learning.sourceReferences);for(const e of learning.entries){assert.equal(e.status,'reference-only');assert(e.checks.length&&e.exceptions.length&&e.sources.length);assert(!plan.items.some(x=>x.module===e.id));}assert(selectDesignReferences('play').some(e=>e.id==='loading-handoff'));assert(!selectDesignReferences('information').some(e=>e.id==='runtime-orientation'));for(const route of plan.designReferences.byRoute)assert.deepEqual(route.ids,selectDesignReferences(route.page).map(e=>e.id));assert.equal(plan.designReferences.status,'reference-only');});

test("global Games standards remain in every actual page/viewport plan",async()=>{const task=await example(),plan=createPlan(task);for(const route of task.routes)for(const viewport of plan.viewports)for(const rule of ["mobile-font-maximum-24","mobile-all-targets-pressed-feedback","full-container-natural-text-wrap","module-heading-without-description","image-generated-linear-game-icons"])assert(plan.items.some(item=>item.module===rule&&item.route===route.path&&item.viewport.id===viewport.id),rule+" missing");});
