import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {libraryAddress,uploadAfterApproval} from '../lib/library-client.mjs';
import {designerAutomation} from '../bin/designer-automation.mjs';

test('library identity comes from an explicit project or exact preview/current URL',()=>{
 assert.deepEqual(libraryAddress('http://192.168.12.9:4187/v2/preview/game-alpha/b-current/alpha/index.html'),{origin:'http://192.168.12.9:4187',projectId:'game-alpha'});
 assert.equal(libraryAddress('https://library.example/v2/current/app-one/').projectId,'app-one');
 assert.equal(libraryAddress('https://library.example/v2/','coupon-one').projectId,'coupon-one');
 for(const url of ['file:///tmp/source','https://user:secret@example.com/v2/current/alpha/','https://example.com/','https://example.com/v2/current/../','http://example.com/v2/current/alpha/#fragment'])assert.throws(()=>libraryAddress(url));
});
test('unconnected maintenance tasks never upload or change learning records',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'da-library-not-connected-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));
 assert.deepEqual(await uploadAfterApproval(data,'task-one'),{status:'not-connected'});assert.deepEqual(await fs.readdir(data),[]);
 const help=await designerAutomation(['library','help']);assert(help.commands.connect);assert(help.commands.push);
 await assert.rejects(designerAutomation(['library','push','--id']),/Expected --key value/);
});
