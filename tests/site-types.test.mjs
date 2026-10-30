import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {root,command,readJSON,writeJSON,digest} from '../lib/io.mjs';
import {maintenanceContext,experiencePage} from '../lib/site-rules.mjs';
import {specialistContext} from '../bin/sites.mjs';
import {inspectSource} from '../bin/intake.mjs';
import {openTask,prepare,repair,handoff} from '../lib/workbench.mjs';
import {audit} from '../lib/audit.mjs';
import {feedbackCases} from '../lib/experience-task.mjs';
import {hash} from '../bin/common.mjs';

test('shared rule directory covers each registered clause exactly once without changing site boundaries',async()=>{
  const shared=await readJSON(path.join(root,'knowledge/shared/rules.json'));
  const directory=await fs.readFile(path.join(root,'knowledge/shared/README.md'),'utf8');
  const entries=[...directory.matchAll(/^\| (SHARED-[A-Z]+-\d+) \| \[[^\]]+\]\(([^)#]+)#([^)]+)\) \|$/gm)];
  const ids=shared.rules.map(rule=>rule.id);
  assert.equal(new Set(ids).size,ids.length,'registered rule IDs must be unique');
  assert.equal(entries.length,ids.length,'every registered rule must appear exactly once');
  assert.equal(new Set(entries.map(entry=>entry[1])).size,entries.length,'directory must not duplicate rule IDs');
  assert.deepEqual(entries.map(entry=>entry[1]).sort(),[...ids].sort());
  for(const [,id,file,anchor] of entries){
    const rule=shared.rules.find(item=>item.id===id);
    assert.equal(rule.source,'knowledge/shared/'+file,`${id} must link to its registered source`);
    assert.equal(rule.status,'active');
    assert.deepEqual(rule.pages,['*']);
    const source=await fs.readFile(path.join(root,rule.source),'utf8');
    assert.match(source,new RegExp('^## '+id+' · ','m'),`${id} must identify a real clause`);
    const heading=source.match(new RegExp('^## ('+id+' · .+)$','m'))[1];
    const slug=heading.toLowerCase().replace(/[\p{P}\p{S}]/gu,char=>char==='-'?'-':'').replace(/ /g,'-');
    assert.equal(anchor,slug,`${id} must link to its clause heading`);
  }
  assert.deepEqual(shared.siteTypes,['coupon','app','games']);
  for(const siteType of shared.siteTypes){
    const selected=await maintenanceContext(root,{siteType,page:'home'});
    for(const id of ids)assert.equal(selected.obligations.filter(rule=>rule.id===id).length,1,`${siteType}: ${id}`);
  }
});

test('maintenance providers share methods and keep all original generation bytes pinned',async()=>{
  const baseline=await readJSON(path.join(root,'compatibility/generation-baseline.json'));
  for(const item of baseline.files)assert.equal(hash(await fs.readFile(path.join(root,item.path))),item.sha256,item.path);
  for(const siteType of ['coupon','app','games']){
    const selected=await maintenanceContext(root,{siteType,page:'home'});
    assert(selected.read.includes('knowledge/shared/layout-and-space.md'));
    if(siteType!=='coupon')assert(!selected.read.some(p=>p.startsWith('knowledge/imported/')));
    assert(!selected.read.some(p=>p.startsWith('site-types/'+(siteType==='app'?'games':'app')+'/')));
  }
  const games=await maintenanceContext(root,{siteType:'games',page:'play',gameType:'web-play'});for(const id of ['inner-content-width-1200','mobile-font-maximum-24','play-no-desktop-fullscreen','play-image-generated-loading-art'])assert(games.obligations.some(r=>r.id===id),id);
});

test('Games generation and review load the current publishing experience and scoped rules',async()=>{
  const doc='site-types/games/core/web-game-publishing-experience.md';
  const author=await specialistContext(root,{siteType:'games',page:'home',role:'author',gameType:'web-play'});
  const review=await maintenanceContext(root,{siteType:'games',page:'home',gameType:'web-play'});
  assert(author.read.includes(doc));assert(review.read.includes(doc));
  for(const id of ['game-home-approved-tdk','game-original-brand-copy','sp-game-routing-and-delivery','sp-game-localized-delivery'])assert(review.obligations.some(rule=>rule.id===id),id);
  assert.equal(author.sourceVersion,'2026-10-30.3');
  assert(author.assets.some(asset=>asset.id==='games-designer-learning'));
  assert(author.designReferences.every(ref=>ref.status==='reference-only'&&ref.pages.includes('home')));
  const store=await maintenanceContext(root,{siteType:'games',page:'home',gameType:'store-referral'});
  assert(!store.obligations.some(rule=>rule.id==='sp-game-localized-delivery'));
});

test('MCP feedback scopes retain existing Coupon keys and isolate App/Games page families',()=>{
  for(const type of ['coupon','app','games']){
    const task={config:{siteType:type,pages:[{family:'home'}]},repo:'https://fixture.invalid/'+type,feedback:[{id:'f',candidate:'a'.repeat(64),decision:'revise',actor:'synthetic-designer',text:'Fixture feedback only'}]};
    assert.deepEqual(feedbackCases(task)[0].scope.pages,[experiencePage(type,'home')]);
  }
  assert.notEqual(experiencePage('app','home'),experiencePage('games','home'));assert.equal(experiencePage(undefined,'home'),'home');
});

test('real workbench selects Games, catches 1240px width and native form fonts, repairs and retains manual obligations',{skip:!process.env.SITE_BROWSER_EXECUTABLE},async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'da-sites-')),repo=path.join(directory,'repo'),data=path.join(directory,'data');t.after(()=>fs.rm(directory,{recursive:true,force:true}));await fs.mkdir(repo);
  await fs.writeFile(path.join(repo,'index.html'),'<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><main class="content"><h1>Sky Swarm fixture</h1><input value="Search"><select><option>Known game</option></select><section class="info">Game information fixture</section><button class="full">Fullscreen</button><a class="back" href="index.html">Back to detail</a></main></body></html>');
  await fs.writeFile(path.join(repo,'style.css'),'body{margin:0;font:16px Arial}.content{width:1000px;max-width:100%;margin:auto}h1{font-size:24px}input,select{font-size:32px}.info{width:100%}.full,.back{display:none}');
  await writeJSON(path.join(repo,'site.json'),{siteType:'games'});
  await command(['git','init','-b','main'],repo);await command(['git','add','.'],repo);await command(['git','-c','user.name=Fixture','-c','user.email=fixture@invalid.test','commit','-m','Synthetic protocol fixture\n\nPenny: recvix8sxn'],repo);
  assert.equal((await inspectSource(repo)).siteType,'games');
  const config={version:1,siteType:'games',gameType:'web-play',request:'Repair this synthetic layout fixture; no real gameplay acceptance',artifactRoot:'.',allowedPaths:['style.css'],widths:[393,1240],commands:{},pages:[{id:'play',family:'play',route:'/index.html',dependsOn:['index.html','style.css'],ownerSelectors:{contentContainer:'.content',bottomInformation:'.info',fullscreen:'.full',backToDetail:'.back'}}]};
  let task=await openTask({data,id:'games',repo,config});assert(task.contexts[0].read.includes('site-types/games/core/owner-standards-20261027.md'));assert(task.checks.some(c=>c.ruleId==='mobile-font-maximum-24'));assert.equal((await openTask({data,id:'games',repo,config})).reusedWorkspace,true);
  await prepare(data,'games');task=await audit({data,id:'games'});assert(task.results['play/1240/layout'].measurements.failures.some(f=>f.check==='inner-content-width-1200'));assert(task.results['play/393/layout'].measurements.failures.filter(f=>f.check==='mobile-font-maximum-24').length>=2);
  const css=await fs.readFile(path.join(task.source,'style.css'),'utf8');task=await repair({data,id:'games',candidate:task.candidates.at(-1).hash,edits:[{file:'style.css',expectedHash:digest(css),find:css,replace:css.replace('width:1000px','width:1200px').replace('font-size:32px','font-size:24px')}]});
  task=await audit({data,id:'games'});assert.equal(task.results['play/1240/layout'].status,'pass');assert.equal(task.results['play/393/layout'].status,'pass');assert(task.results['play/393/rule-mobile-font-maximum-24'].status==='needs-observation');await assert.rejects(handoff(data,'games'),/coverage|checks|observ/);
});

test('Games detail-to-play interaction checks the destination and invalidates when its HTML changes',{skip:!process.env.SITE_BROWSER_EXECUTABLE},async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'da-game-navigation-')),repo=path.join(directory,'repo'),data=path.join(directory,'data');t.after(()=>fs.rm(directory,{recursive:true,force:true}));await fs.mkdir(repo);
  const head='<!doctype html><style>body{margin:0;font:16px Arial}main{width:1200px;max-width:100%;margin:auto}h1{font-size:24px}.info{width:100%}</style>';
  await fs.writeFile(path.join(repo,'index.html'),head+'<main><div class="rail">Real bound recommendation fixture</div><h1 class="identity">Detail fixture</h1><div class="how"><p>Actual instruction fixture</p></div><a id="launch" href="play.html">Play</a></main>');
  await fs.writeFile(path.join(repo,'play.html'),head+'<main><h1>Play fixture</h1><section class="info">Game information fixture</section></main>');
  await writeJSON(path.join(repo,'site.json'),{siteType:'games'});await command(['git','init','-b','main'],repo);await command(['git','add','.'],repo);await command(['git','-c','user.name=Fixture','-c','user.email=fixture@invalid.test','commit','-m','Synthetic navigation fixture\n\nPenny: recvix8sxn'],repo);
  const config={version:1,siteType:'games',gameType:'web-play',request:'Test actual detail-to-play navigation; synthetic content only',artifactRoot:'.',allowedPaths:['play.html'],widths:[1240],commands:{},pages:[{id:'detail',family:'detail',route:'/index.html',dependsOn:['index.html'],ownerSelectors:{contentContainer:'main',identity:'.identity',topRecommendations:'.rail',howToPlay:'.how'},interactions:[{id:'launch',actions:[{type:'click',selector:'#launch'}],expected:[{type:'url',value:'/play.html'}]}]},{id:'play',family:'play',route:'/play.html',dependsOn:['play.html'],ownerSelectors:{contentContainer:'main',bottomInformation:'.info',fullscreen:'.full',backToDetail:'.back'}}]};
  await openTask({data,id:'navigation',repo,config});await prepare(data,'navigation');let task=await audit({data,id:'navigation'});const key='detail/1240/interaction-launch',before=task.results[key];assert.equal(before.status,'pass');assert.equal(before.measurements.games.page,'play');
  const html=await fs.readFile(path.join(task.source,'play.html'),'utf8');task=await repair({data,id:'navigation',candidate:task.candidates.at(-1).hash,edits:[{file:'play.html',expectedHash:digest(html),find:'Play fixture',replace:'Updated play fixture'}]});task=await audit({data,id:'navigation'});assert.equal(task.results[key].status,'pass');assert.notEqual(task.results[key].fingerprint,before.fingerprint);assert(!task.results[key].reusedFrom);
});
