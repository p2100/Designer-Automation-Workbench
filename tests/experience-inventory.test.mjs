import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {summarizeExperienceInventory} from '../lib/experience-inventory.mjs';
import {caseContent,capturedCase} from '../lib/experience-case.mjs';
import {sample} from './experience-fixture.mjs';

const fixture = () => {
  const entry=sample();
  delete entry.approval;
  entry.verification.designerApproved=false;
  entry.actor='private-fixture-person';
  return {createdAt:'2026-10-27T00:00:00Z',cases:[capturedCase(caseContent(entry)),capturedCase(caseContent(entry))],lessons:[]};
};

test('inventory keeps all cases intact and reports repeated keys as review signals only',()=>{
  const snapshot=fixture(), before=JSON.stringify(snapshot), result=summarizeExperienceInventory(snapshot);
  assert.equal(result.cases,2);
  assert.equal(result.lessons,0);
  assert.equal(result.casesWithoutExactConfirmation,2);
  assert.equal(result.casesWithLearningGaps,2);
  assert.equal(result.repeatedCaseKeys,1);
  assert.match(result.note,/do not prove duplicates/);
  assert.equal(JSON.stringify(snapshot),before);
  assert(!JSON.stringify(result).includes('private-fixture-person'));
  assert(!JSON.stringify(result).includes('capacity.long-title'));
  assert.throws(()=>summarizeExperienceInventory({cases:[]}),/full cases-and-lessons/);
});

test('administrator inventory makes one authenticated read and does not expose configuration',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'da-inventory-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const requests=[];
  const server=http.createServer((req,res)=>{
    requests.push({method:req.method,path:req.url,authorization:req.headers.authorization});
    res.setHeader('content-type','application/json');res.end(JSON.stringify(fixture()));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const config=path.join(directory,'config.json');
  await fs.writeFile(config,JSON.stringify({port:server.address().port,maintainerToken:'private-fixture-token',mongo:{uri:'mongodb://private-fixture-secret',database:'fixture'}}));
  const {stdout,stderr}=await promisify(execFile)(process.execPath,['scripts/experience-admin.mjs','inventory','--config',config]);
  assert.equal(stderr,'');
  assert.equal(JSON.parse(stdout).cases,2);
  assert(!stdout.includes('private-fixture'));
  assert.deepEqual(requests,[{method:'GET',path:'/v1/admin/snapshot',authorization:'Bearer private-fixture-token'}]);
});
