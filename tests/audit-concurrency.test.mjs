import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright-core';
import {openTask,prepare,validateConfig} from '../lib/workbench.mjs';
import {audit} from '../lib/audit.mjs';

const executable=process.env.SITE_BROWSER_EXECUTABLE;

test('audit concurrency is bounded and invalid limits are rejected',()=>{
  const config={version:1,siteType:'app',request:'TEST',artifactRoot:'.',allowedPaths:['**/*.html'],pages:[{id:'home',family:'home',route:'/index.html',dependsOn:['index.html']}]};
  for(const auditConcurrency of [0,5,1.5])assert.throws(()=>validateConfig({...config,auditConcurrency}),/concurrency/);
});

test('parallel real-browser visits preserve every result and serialized clipboard actions',{skip:!executable},async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'da-parallel-')),source=path.join(temp,'source'),data=path.join(temp,'data');
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));await fs.mkdir(source);
  for(const name of ['index','detail'])await fs.writeFile(path.join(source,name+'.html'),`<!doctype html><style>body{margin:16px;font:16px Arial}button{min-height:44px}</style><main><h1>TEST ${name}</h1><button id="state" onclick="this.textContent='Done'">Test</button><button id="copy" onclick="navigator.clipboard.writeText('${name}')">Copy fixture text</button></main>`);
  const reports=[];
  for(const auditConcurrency of [1,2]){
    const pages=['index','detail'].map((name,index)=>({id:name,family:index?'detail':'home',route:'/'+name+'.html',dependsOn:[name+'.html'],interactions:[
      {id:'state',actions:[{type:'click',selector:'#state'}],expected:[{type:'text',selector:'#state',value:'Done'}]},
      {id:'copy',actions:[{type:'click',selector:'#copy'}],expected:[{type:'clipboard',value:name}]},
    ]}));
    const config={version:1,siteType:'app',request:'TEST real-browser concurrency equivalence',artifactRoot:'.',allowedPaths:['**/*.html'],widths:[320,393,1440],auditConcurrency,pages};
    const id='parallel-'+auditConcurrency;await openTask({data,id,localSource:source,config});await prepare(data,id);
    let active=0,peak=0;
    const browserFactory=async()=>{
      const browser=await chromium.launch({executablePath:executable,headless:true});
      return {version:()=>browser.version(),close:()=>browser.close(),newContext:async options=>{
        const context=await browser.newContext(options),close=context.close.bind(context);active++;peak=Math.max(peak,active);
        context.close=async()=>{try{return await close();}finally{active--;}};return context;
      }};
    };
    const task=await audit({data,id,browserFactory});assert.equal(active,0);assert(peak<=auditConcurrency);
    assert.equal(task.lastAudit.visits,18);
    const outcomes=Object.fromEntries(Object.entries(task.results).map(([key,result])=>[key,result.status]));
    for(const page of pages)for(const width of config.widths)assert.equal(outcomes[page.id+'/'+width+'/interaction-copy'],'pass');
    reports.push({concurrency:auditConcurrency,peak,durationMs:task.lastAudit.durationMs,visits:task.lastAudit.visits,outcomes});
  }
  assert.deepEqual(reports[0].outcomes,reports[1].outcomes);assert.equal(reports[1].peak,2);
  const summary=reports.map(({outcomes,...report})=>report);t.diagnostic(JSON.stringify(summary));
  if(process.env.DA_AUDIT_BENCHMARK_REPORT)await fs.writeFile(process.env.DA_AUDIT_BENCHMARK_REPORT,JSON.stringify({at:new Date().toISOString(),reports:summary,coverageEqual:true,limit:'Technical browser fixture timing; not a real designer two-hour acceptance'},null,2)+'\n');
});
