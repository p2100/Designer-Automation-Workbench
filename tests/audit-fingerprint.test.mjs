import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,glob,compileGlob} from '../lib/io.mjs';
import {fingerprintFor,createFingerprintComputer,incrementalPlan} from '../lib/audit.mjs';

// Retained 0.13.0 algorithm: exact digest compatibility is the assertion.
function legacy(task,candidate,check,environment){
  const destinations=(check.expected||[]).filter(e=>e.type==='url').map(e=>new URL(e.value,'http://candidate').pathname);
  const destinationPages=task.config.pages.filter(p=>destinations.includes(p.route));
  const dependencies=[...check.dependsOn,...destinationPages.flatMap(p=>p.dependsOn)];
  const specific=file=>dependencies.some(pattern=>glob(pattern,file));
  const global=file=>/\.(?:css|[cm]?js|json|lock)$/.test(file)||(task.config.globalDependencies||[]).some(pattern=>glob(pattern,file))||!task.checks.some(c=>c.dependsOn.some(pattern=>glob(pattern,file)));
  const source=Object.fromEntries(Object.entries(candidate.source).filter(([file])=>specific(file)||global(file)));
  const artifacts=Object.fromEntries(Object.entries(candidate.artifacts).filter(([file])=>!file.endsWith('.html')||file===check.route.slice(1)||destinations.some(route=>file===route.slice(1))||(task.config.spa&&file==='index.html')));
  const review=task.adjustment?{kind:'adjustment',pages:task.adjustment.pages,component:task.adjustment.component,checkIds:task.adjustment.checkIds,layoutCheckIds:task.adjustment.layoutCheckIds}:'acceptance';
  return digest({check,source,artifacts,rules:task.rules.manifestHash,lessons:task.lessonsHash,environment,checker:2,config:task.config,review});
}
const environment={browser:'TEST',os:'TEST'};
function fixture(){
  const pages=['home','detail','other'].map(id=>({id,route:'/'+id+'.html',dependsOn:[id+'.html','images/'+id+'.png']}));
  const checks=pages.map(page=>({id:page.id+'/320/layout',page:page.id,route:page.route,dependsOn:page.dependsOn}));
  const task={config:{pages,globalDependencies:['shared/**']},checks,rules:{manifestHash:'rules'},lessonsHash:'lessons',results:{}};
  const source=Object.fromEntries(['home.html','detail.html','other.html','images/home.png','images/detail.png','images/other.png','unknown.png','shared/template.txt','site.css','runtime.mjs','data.json','package-lock.lock'].map(file=>[file,digest(file)]));
  return {task,candidate:{source,artifacts:{...source,'index.html':digest('spa')}},checks};
}
test('compiled glob preserves wildcard, recursive, root and escaped-character matching',()=>{
  for(const pattern of ['**/*.html','src/**','file*.js','a.b+[x].txt','assets/**/icon.*'])for(const file of ['index.html','a/index.html','src/x/y','file.js','a.b+[x].txt','assets/icon.png','assets/x/icon.svg'])assert.equal(compileGlob(pattern).test(file),glob(pattern,file));
});
test('plan-local caches preserve every 0.13 fingerprint byte, including destinations, SPA and adjustment scope',()=>{
  for(const adjustment of [false,true])for(const spa of [false,true]){
    const {task,candidate,checks}=fixture();task.config.spa=spa;
    if(adjustment)task.adjustment={pages:['home'],component:'TEST family',checkIds:[checks[0].id],layoutCheckIds:['capacity']};
    checks.push({...checks[0],id:'navigation',expected:[{type:'url',value:'/detail.html?q=x'}]});
    const compute=createFingerprintComputer(task,candidate,environment);
    for(const check of checks){const expected=legacy(task,candidate,check,environment);assert.equal(compute(check),expected);assert.equal(fingerprintFor(task,candidate,check,environment),expected);}
  }
});
test('a later plan invalidates changed unknown assets, global/config/destination inputs without leaking caches',()=>{
  const {task,candidate,checks}=fixture(),before=fingerprintFor(task,candidate,checks[0],environment);
  candidate.source['unknown.png']=digest('changed');assert.notEqual(fingerprintFor(task,candidate,checks[0],environment),before);
  const after=fingerprintFor(task,candidate,checks[0],environment);candidate.source['images/other.png']=digest('other only');assert.equal(fingerprintFor(task,candidate,checks[0],environment),after);
  task.config.globalDependencies.push('images/**');assert.notEqual(fingerprintFor(task,candidate,checks[0],environment),after);
});
test('large inactive rule inventories produce identical planning fingerprints without quadratic rescanning',async t=>{
  const {task,candidate,checks}=fixture();
  task.checks=Array.from({length:2400},(_,i)=>({...checks[i%3],id:'rule-'+i}));
  for(let i=0;i<140;i++)candidate.source['unmapped/image-'+i+'.png']=digest(i);
  task.adjustment={pages:['home','detail','other'],component:'TEST',checkIds:task.checks.slice(0,4).map(c=>c.id)};
  const active=task.checks.slice(0,4),oldStart=performance.now(),expected=active.map(check=>legacy(task,candidate,check,environment)),oldMs=performance.now()-oldStart;
  const start=performance.now(),plan=await incrementalPlan(task,candidate,environment),newMs=performance.now()-start;
  assert.deepEqual(plan.execute.map(item=>item.fingerprint),expected);assert.equal(plan.execute.length,4);assert.equal(plan.reuse.length,0);
  t.diagnostic(JSON.stringify({sourceFiles:Object.keys(candidate.source).length,allChecks:task.checks.length,activeChecks:4,legacyMs:Math.round(oldMs),optimizedMs:Math.round(newMs),speedup:Math.round(oldMs/Math.max(newMs,0.01))}));
  assert(newMs<oldMs/3,'Plan should avoid repeated full inactive-rule inventory scans');
});
