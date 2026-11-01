import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inspectPortableDelivery,requirePortableDelivery} from '../lib/portable-delivery.mjs';
import {prepareLibraryUpload,pushLibraryTask} from '../lib/library-client.mjs';
import {digest,snapshot,writeJSON,exists,readJSON} from '../lib/io.mjs';

async function artifact(t,files){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'TEST-portable-delivery-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const [name,bytes] of Object.entries(files)){const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
  return root;
}
test('nested HTML and reachable CSS remain portable without reading unused assets or changing bytes',async t=>{
  const root=await artifact(t,{
    'index.html':'<meta http-equiv="refresh" content="0;url=en/index.html?entry=1#main">',
    'en/index.html':'<link rel="stylesheet" href="../assets/site.css?v=1"><body data-root="../"><a href="offers/one/">Offer</a><form action="search/index.html"><img src="../assets/logo mark.svg"></form><script src="../assets/app.js"></script>',
    'en/offers/one/index.html':'<a href="../../index.html#main">Home</a>',
    'en/search/index.html':'<a href="?q=a&amp;sort=b">Query</a>',
    'assets/site.css':'@import "detail.css" screen; .card{background:url("./picture.webp?v=2#x")} @font-face{src:url(./font.woff2)}',
    'assets/detail.css':'@import url(site.css); .box{background: url(data:image/svg+xml,a)}',
    'assets/logo mark.svg':'svg','assets/picture.webp':'image','assets/font.woff2':'font','assets/app.js':'/* actual script file */',
    'assets/unused.css':'.unused{background:url(/not-used.png)}',
  });
  const before=await snapshot(root),report=await requirePortableDelivery(root,before);
  assert.equal(report.status,'passed');assert.equal(report.htmlCount,4);assert.equal(report.referencedCssCount,2);assert.deepEqual(report.failures,[]);
  assert.equal(report.artifactHash,digest(before));assert.deepEqual(await snapshot(root),before);
});
test('the actual Tagtally root-path failure blocks stylesheet, module, navigation, form, data-root and refresh',async t=>{
  const root=await artifact(t,{'en/index.html':'<link rel="stylesheet" href="/assets/site.css"><script src="/assets/app.mjs"></script><a href="/en/stores/">Stores</a><form action="/en/search/"></form><body data-root="/"><meta content="0;url=/en/" http-equiv="refresh">','assets/site.css':'','assets/app.mjs':''});
  const report=await inspectPortableDelivery(root);assert.equal(report.status,'blocked');
  assert.deepEqual(new Set(report.failures.map(f=>f.role)),new Set(['href','src','action','data-root','refresh']));
  assert(report.failures.every(f=>f.reason==='escapes deployed version prefix'));
  await assert.rejects(requirePortableDelivery(root),error=>error.code==='NON_PORTABLE_ARTIFACT'&&error.report.failures.length===6);
});
test('local missing targets include referenced fonts and CSS imports but ignore external destinations',async t=>{
  const root=await artifact(t,{'index.html':'<link rel=stylesheet href="assets/main.css"><img src="missing.webp"><a href="missing/">Go</a><form action="missing-search.html"></form>','assets/main.css':'@import "missing.css"; @font-face{src:url(missing.woff2)}'});
  const report=await inspectPortableDelivery(root);assert.equal(report.failures.length,5);
  assert(report.failures.every(f=>f.reason==='target is absent from artifact'));
  assert(report.failures.some(f=>f.target==='assets/missing.woff2'));
});
test('external schemes, protocol-relative references, fragments and query parameters retain their meanings',async t=>{
  const root=await artifact(t,{'index.html':'<a href="#main">Skip</a><a href="?q=a&amp;b=c">Search</a><a href="https://example.com/shop?x=1&amp;y=2">Store</a><a href="mailto:team@example.com">Mail</a><a href="tel:+123">Call</a><img src="data:image/png;base64,abc"><script src="//cdn.example.com/app.js"></script><video poster="https://cdn.example.com/poster.jpg"></video><a href="blob:https://example.com/x">Media</a>'});
  assert.equal((await requirePortableDelivery(root)).references,1);
});
test('inline and imported CSS use their actual document or stylesheet directory',async t=>{
  const root=await artifact(t,{'en/index.html':'<style>.a{background:url(../assets/a.png)}</style><div style="background:url(../assets/b.png)"></div><link rel="preload" as="style" href="../assets/preload.css">','assets/a.png':'a','assets/b.png':'b','assets/preload.css':'.x{background:url(./c.png)}','assets/c.png':'c'});
  assert.equal((await requirePortableDelivery(root)).referencedCssCount,1);
  await fs.writeFile(path.join(root,'assets/preload.css'),'.x{background:url(/escapes.png)}');
  assert.equal((await inspectPortableDelivery(root)).failures[0].reason,'escapes deployed version prefix');
});
test('a relative base is respected while escaped base URLs and encoded root paths are blocked',async t=>{
  const root=await artifact(t,{'en/deep/index.html':'<base href="../../"><a href="en/index.html">Home</a>','en/index.html':'<a href="&#x2f;assets/file.png">Root</a><img src="%bad"><img src="../../outside.png">','assets/file.png':'image'});
  const report=await inspectPortableDelivery(root);assert.equal(report.failures.length,3);
  assert(report.failures.some(f=>f.role==='href'&&f.reason==='escapes deployed version prefix'));
  assert(report.failures.some(f=>f.reason==='invalid local URL'));
  await fs.writeFile(path.join(root,'en/deep/index.html'),'<base href="https://external.example/">');
  assert((await inspectPortableDelivery(root)).failures.some(f=>f.role==='base'));
});
test('HTML comments and script strings are not mistaken for active markup',async t=>{
  const root=await artifact(t,{'index.html':'<!-- <img src="/comment.png"> --><script>const sample = \'<a href="/string">\';</script><a href="#main">Main</a>'});
  assert.equal((await requirePortableDelivery(root)).references,0);
});
test('commented and scripted style samples do not enter the reachable CSS graph',async t=>{
  const root=await artifact(t,{'index.html':'<!-- <style>.old{background:url(/comment.png)}</style> --><script>const sample = \'<style>.sample{background:url(/string.png)}</style>\';</script><style data-note="a > b">.live{background:url(./live.png)}</style>','live.png':'image'});
  const report=await requirePortableDelivery(root);assert.equal(report.references,1);assert.deepEqual(report.failures,[]);
});
test('greater-than signs in quoted attributes cannot hide an escaping resource',async t=>{
  const root=await artifact(t,{'index.html':'<img alt="a > b" src="/broken.png"><img alt=\'a < b\' src=\'/other.png\'><script data-example="a > b" src="/bad-script.js">const sample = \'<img src="/inactive.png">\';</script>'});
  const report=await inspectPortableDelivery(root);assert.equal(report.failures.length,3);
  assert.deepEqual(report.failures.map(f=>f.value),['/broken.png','/other.png','/bad-script.js']);
});
async function libraryFixture(t,html){
  const root=await artifact(t,{'source/index.mjs':'source','output/index.html':html}),data=path.join(root,'private'),source=path.join(root,'source'),output=path.join(root,'output');
  const sourceFiles=await snapshot(source),address={origin:'http://library.test',projectId:'coupon-one'},id='trial';
  await writeJSON(path.join(data,'library/profiles',digest(address)+'.json'),{...address,token:'TEST only',expiresAt:Date.now()+60000,binding:{siteType:'coupon',sourceFiles,baseBuild:'before'}});
  return {root,data,source,output,address,id,options:{data,id,url:address.origin,project:address.projectId,source,artifacts:output,siteType:'coupon'}};
}
test('prepare blocks a bad artifact before confirmation, frozen-candidate or upload records exist',async t=>{
  const f=await libraryFixture(t,'<link rel="stylesheet" href="/assets/broken.css">');
  const before=await snapshot(f.output);
  await assert.rejects(prepareLibraryUpload(f.options),error=>error.code==='NON_PORTABLE_ARTIFACT');
  assert.deepEqual(await snapshot(f.output),before);
  for(const part of ['uploads/trial.json','approvals/trial.json','pending/trial.json','candidates/trial'])assert.equal(await exists(path.join(f.data,'library',part)),false,part);
});
test('prepare and same-candidate retry preserve the single exact approval without starting an audit',async t=>{
  const f=await libraryFixture(t,'<a href="#main">Main</a>'),first=await prepareLibraryUpload(f.options);
  assert.equal(first.status,'confirmation-required');
  const approval={decision:'approve',candidate:first.candidate,actor:'TEST designer',text:'TEST exact upload authorization',at:new Date().toISOString(),...f.address};
  await writeJSON(path.join(f.data,'library/approvals',f.id+'.json'),approval);
  const second=await prepareLibraryUpload(f.options);
  assert.equal(second.candidate,first.candidate);assert.equal(second.confirmation,'recorded');assert.equal(second.status,'prepared');assert.equal(await exists(path.join(f.data,'tasks',f.id)),false);
});
test('push rechecks a legacy frozen bad package before confirmation or remote requests and keeps pending state intact',async t=>{
  const f=await libraryFixture(t,'<img src="/broken.png">'),artifacts=await snapshot(f.output),sourceFiles=await snapshot(f.source),hash=digest({source:sourceFiles,artifacts}),directory=path.join(f.data,'legacy-candidate');
  await fs.mkdir(path.join(directory,'site'),{recursive:true});await fs.copyFile(path.join(f.output,'index.html'),path.join(directory,'site/index.html'));
  await writeJSON(path.join(f.data,'library/tasks',f.id+'.json'),f.address);
  await writeJSON(path.join(f.data,'library/uploads',f.id+'.json'),{id:f.id,kind:'library-upload',source:f.source,output:f.output,config:{siteType:'coupon',artifactRoot:'.'},initialSource:sourceFiles,candidates:[{hash,directory,source:sourceFiles,artifacts,artifactHash:digest(artifacts)}]});
  const pending={requestId:'TEST existing pending',candidateHash:hash};await writeJSON(path.join(f.data,'library/pending',f.id+'.json'),pending);
  await assert.rejects(pushLibraryTask({data:f.data,id:f.id}),error=>error.code==='NON_PORTABLE_ARTIFACT');
  assert.deepEqual(await readJSON(path.join(f.data,'library/pending',f.id+'.json')),pending);assert.equal(await exists(path.join(f.data,'library/approvals',f.id+'.json')),false);
  const approval={decision:'approve',candidate:hash,actor:'TEST designer',text:'TEST previous authorization',at:new Date().toISOString(),...f.address};await writeJSON(path.join(f.data,'library/approvals',f.id+'.json'),approval);
  await assert.rejects(pushLibraryTask({data:f.data,id:f.id}),error=>error.code==='NON_PORTABLE_ARTIFACT');
  assert.deepEqual(await readJSON(path.join(f.data,'library/approvals',f.id+'.json')),approval);assert.deepEqual(await readJSON(path.join(f.data,'library/pending',f.id+'.json')),pending);
  const profileFile=path.join(f.data,'library/profiles',digest(f.address)+'.json'),profile=await readJSON(profileFile);
  const result={status:'uploaded',projectId:f.address.projectId,reviewStatus:'approved',downloadable:true};
  await writeJSON(profileFile,{...profile,syncedTask:f.id,lastUpload:{candidate:hash,result,finishedAt:'2026-11-01T00:00:00.000Z'}});
  const reused=await pushLibraryTask({data:f.data,id:f.id});assert.equal(reused.reused,true);assert.equal(reused.status,'uploaded');
  assert.deepEqual(await readJSON(path.join(f.data,'library/pending',f.id+'.json')),pending);
});
