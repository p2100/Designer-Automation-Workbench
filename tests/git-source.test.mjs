import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {repositoryFor} from '../lib/git-source.mjs';
import {inspectPugSource,sha256,sourceSnapshot} from '../lib/git-source-contract.mjs';
import {libraryAddress} from '../lib/library-client.mjs';
import {designerAutomation} from '../bin/designer-automation.mjs';
import {connectLibrary} from '../lib/library-client.mjs';
import http from 'node:http';

test('unified Agent entry accepts the actual shared preview URL and exposes Git operations',async()=>{
 assert.deepEqual(libraryAddress('http://192.168.12.9:4187/v2/site-preview/example/site/index.html'),{origin:'http://192.168.12.9:4187',projectId:'example'});
 assert.match((await designerAutomation([])).gitSource,/git-source/);
 assert.ok((await designerAutomation(['git-source','help'])).commands.publish);
});
test('ordinary library connect routes an already registered site to the Pug workflow instead of reporting a permission failure',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-git-routing-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));
 const server=http.createServer((req,res)=>{res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'GIT_SOURCE_REQUIRED',error:'本站已接入正式 Git 源码'}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const result=await connectLibrary({data,url:'http://127.0.0.1:'+server.address().port+'/v2/site-preview/example/site/index.html'});assert.equal(result.status,'formal-git-required');assert.equal(result.projectId,'example');assert.match(result.next,/git-source prepare/);assert.match(result.next,/verify\/capture/);
});
test('missing repository creates one private repository; authentication failures never create anything',async()=>{
 const context={repository:'git@github.com:p2100/example.git',name:'Example',source:null},calls=[];let created=false;
 const run=async argv=>{calls.push(argv);if(argv[1]==='repo'){assert.ok(argv.includes('--private'));created=true;return {output:''};}if(!created)throw Error('gh: Not Found (HTTP 404)');return {output:JSON.stringify({full_name:'p2100/example',private:true,permissions:{push:true}})};};
 assert.equal((await repositoryFor(context,{run})).created,true);assert.equal(calls.filter(argv=>argv[1]==='repo').length,1);
 calls.length=0;await assert.rejects(repositoryFor(context,{run:async argv=>{calls.push(argv);throw Error('HTTP 403');}}),/GitHub/);assert.equal(calls.length,1);
 await assert.rejects(repositoryFor(context,{run:async()=>({output:JSON.stringify({full_name:'p2100/example',private:false,permissions:{push:true}})})}),/private/);
});
test('Pug validation rejects wrapped HTML, altered builders and incomplete route maps',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-pug-contract-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const put=async(name,content)=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof content==='string'?content:JSON.stringify(content));};
 const context={projectId:'example',routes:['index.html'],template:{commit:'a'.repeat(40),indexHash:sha256('template entry'),core:'3.0.36',scripts:Object.fromEntries(['getData','compileFn','buildFn','buildStatic'].map(x=>[x,'node index.js']))}};
 const pkg={name:'example',dependencies:{'pug-site-core':'3.0.36'},scripts:context.template.scripts};
 const contract={format:'site-template-pug',projectId:'example',templateCommit:context.template.commit,defaultLanguage:'us',home:'us/index.html',staticOutput:'staticSites',dataSource:'data/snapshot.json',clientDataSource:'data/snapshot.json',routes:[{original:'index.html',output:'us/index.html',template:'template/pages/index.pug'}]};
 await put('index.js','template entry');await put('package.json',pkg);await put('getData.js','export async function get_index_data(language){return {title:"Example"}}');await put('data/snapshot.json',{title:'Example'});await put('docs/site-git-source.json',contract);
 await put('template/common/base.pug','doctype html\nhtml\n  body\n    block body\n');await put('template/components/title.pug','h1= data.title\n');const page='extends /common/base.pug\nblock body\n  include /components/title.pug\n';await put('template/pages/index.pug',page);
 assert.equal((await inspectPugSource(root,context)).contract.routes.length,1);
 await put('template/pages/index.pug','<html><body>export</body></html>');await assert.rejects(inspectPugSource(root,context),/HTML/);
 await put('template/pages/index.pug',page+'  != data.html\n');await assert.rejects(inspectPugSource(root,context),/unescaped/);
 await put('template/pages/index.pug',page);await put('package.json',{...pkg,scripts:{...pkg.scripts,postbuildStatic:'node old-html.js'}});await assert.rejects(inspectPugSource(root,context),/commands/);
 await put('package.json',pkg);await put('docs/site-git-source.json',{...contract,routes:[]});await assert.rejects(inspectPugSource(root,context),/route/);
 await put('docs/site-git-source.json',contract);const before=await sourceSnapshot(root);await put('node_modules/private.txt','not source');assert.equal((await sourceSnapshot(root)).sha256,before.sha256);
});
