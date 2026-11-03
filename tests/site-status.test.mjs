import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {hostname} from 'node:os';
import {clientIdentityHeaders} from '../lib/client-identity.mjs';
import {designerAutomation} from '../bin/designer-automation.mjs';

test('the Agent entry exposes status updates without source preparation or deployment',async()=>{
  assert.match((await designerAutomation([])).siteStatus,/show\|update\|retry/);
  const help=await designerAutomation(['site-status','help']);assert.match(help.commands.update,/--domain/);assert.match(help.note,/no Harness/i);
  assert.match(help.commands.clients,/hostname/);
  await assert.rejects(designerAutomation(['site-status','update','--status','online']),/actor/);
  await assert.rejects(designerAutomation(['site-status','update','--actor','Developer','--note','Report','--status','online']),/domain/);
  await assert.rejects(designerAutomation(['site-status','update','--owner-freeze','false']),/supported/);
});

test('automatic computer metadata contains hostname and release version without supplying a claimed IP',async()=>{
  const headers=clientIdentityHeaders(),value=JSON.parse(Buffer.from(headers['X-Designer-Client'],'base64url').toString('utf8'));
  assert.equal(value.hostname,hostname().slice(0,200));assert.equal(value.version,JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8')).version);assert.deepEqual(Object.keys(value).sort(),['hostname','version']);
});

test('an unconfirmed response preserves the exact private request for retry rather than silently replacing its revision',async t=>{
  const data=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-site-status-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));
  const writes=[];let version=1,attempt=0;
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;
    const view={projectId:'example',currentBuild:'b-original',revision:String(version).repeat(64),state:'development',onlineUrl:null};
    let result;
    if(req.url.endsWith('/connect')){assert.equal(JSON.parse(body).purpose,'site-status');result={token:'t'.repeat(43),expiresAt:Date.now()+60000,binding:view};}
    else if(req.method==='GET')result=view;
    else{
      const input=JSON.parse(body);writes.push(input);attempt++;
      if(attempt===1){version=2;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'temporary unavailable'}));return;}
      result={...view,status:'updated',state:'online',onlineUrl:'https://example.com/',reused:true};
    }
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/v2/current/example/index.html',request='status-retry-00000001';
  await assert.rejects(designerAutomation(['site-status','update','--data',data,'--url',url,'--status','online','--domain','example.com','--actor','Synthetic developer','--note','Actual isolated test','--request',request]),/site-status retry/);
  const result=await designerAutomation(['site-status','retry','--data',data,'--url',url,'--request',request]);assert.equal(result.status,'updated');assert.equal(result.harnessUsed,false);assert.deepEqual(writes[0],writes[1]);assert.equal(writes[1].revision,'1'.repeat(64));
  const root=path.join(data,'site-status'),scope=(await fs.readdir(root))[0],requestFile=path.join(root,scope,'requests',request+'.json');assert.equal((await fs.stat(requestFile)).mode&0o777,0o600);assert.equal(JSON.parse(await fs.readFile(requestFile,'utf8')).status,'synced');
});
