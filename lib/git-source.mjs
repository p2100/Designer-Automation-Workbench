import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {readJSON,writeJSON,exists,command} from './io.mjs';
import {libraryAddress} from './library-client.mjs';
import {clientIdentityHeaders} from './client-identity.mjs';
import {gitSourceProtocol,buildCommands,sourceOutputs,sourceAllowed,sourcePath,sourceSnapshot,inspectPugSource,sha256,githubRepository,canonicalRepository} from './git-source-contract.mjs';

const planFile=(data,id)=>{if(!/^[a-z0-9-]{1,80}$/i.test(id||''))throw Error('Invalid Git-source plan');return path.join(data,'git-source','plans',id,'plan.json');};
async function request(origin,action,{token,body}={}){
  const payload=body?gzipSync(Buffer.from(JSON.stringify(body))):undefined;
  const response=await fetch(origin+'/v2/api/designer-library/'+action,{method:body?'POST':'GET',redirect:'error',headers:{...clientIdentityHeaders(),...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json','Content-Encoding':'gzip'}:{})},body:payload,signal:AbortSignal.timeout(180000)});
  const result=await response.json().catch(()=>{throw Error('Central library response is invalid; local source remains saved');});
  if(!response.ok)throw Object.assign(Error(response.status===405&&action.startsWith('git-')?'中央站点库尚未升级 Pug Git 接口，请更新站点库服务；本地源码和改稿已保留。':result.error||'Central library rejected Git source'),{status:response.status});return result;
}
const connectionFile=(data,address)=>path.join(data,'git-source','connections',sha256(address)+'.json');
async function connection(data,address,{refresh=false}={}){
  const file=connectionFile(data,address);let value=await readJSON(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!value||value.expiresAt<Date.now()||refresh){const connected=await request(address.origin,'connect',{body:{projectId:address.projectId,clientName:'sitefly-designer-automation Git source',purpose:'git-source'}});value={...address,...connected};await writeJSON(file,value);}
  return value;
}
async function git(root,args){return (await command(['git','-C',root,...args],root,{timeout:120000,maxBytes:8_000_000})).output;}
export async function repositoryFor(context,{run=command}={}){
  const fullName=githubRepository(context.repository);
  let metadata,created=false;
  try{metadata=JSON.parse((await run(['gh','api','repos/'+fullName],process.cwd())).output);}
  catch(error){
    if(!/\(HTTP 404\)/.test(error.message))throw Error('GitHub 建仓连接不可用：请使用本机已登录且有组织权限的 gh，或由 Agent 的 GitHub 工具创建准确私有仓库后重试。'+error.message);
    await run(['gh','repo','create',fullName,'--private','--description','Editable Pug source for '+context.name],process.cwd());created=true;
    metadata=JSON.parse((await run(['gh','api','repos/'+fullName],process.cwd())).output);
  }
  if(metadata.full_name?.toLowerCase()!==fullName.toLowerCase()||metadata.archived||metadata.permissions?.push===false||!context.source&&!metadata.private)throw Error('Repository identity, private visibility or write permission does not match');
  return {repository:context.repository,created,private:metadata.private,url:metadata.html_url};
}
async function templateCheckout(data,context,input){
  const target=input?await fs.realpath(input):path.join(data,'git-source','templates',context.template.commit);
  if(!await exists(target)){
    await fs.mkdir(path.dirname(target),{recursive:true});
    const remote=context.repository.startsWith('git@github.com:')?context.template.repository.replace(/^https:\/\/github\.com\//,'git@github.com:'):context.template.repository;
    await command(['git','-c','core.autocrlf=false','clone','--no-checkout',remote,target],path.dirname(target),{timeout:120000});
    await git(target,['config','core.autocrlf','false']);
    await git(target,['checkout','--detach',context.template.commit]);
  }
  if(await git(target,['rev-parse','HEAD'])!==context.template.commit||await git(target,['status','--porcelain']))throw Error('Use a clean checkout of the exact selected site-template commit');
  return target;
}
export async function prepareGitSource({data,url,project,template,id='git-'+randomUUID(),ensureRepository=true,'repository-ready':repositoryReady}){
  data=path.resolve(data);const address=libraryAddress(url,project),file=planFile(data,id),root=path.dirname(file);
  if(await exists(file))throw Error('Plan already exists; continue it with status instead of preparing again');
  await fs.mkdir(root,{recursive:true});const clock=path.join(root,'execution-clock.json');
  try{await fs.writeFile(clock,JSON.stringify({startedAt:new Date().toISOString(),event:'Before first library/source/template read',id,projectId:address.projectId},null,2),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  const connected=await connection(data,address,{refresh:true}),context=await request(address.origin,'git-context',{token:connected.token});
  if(context.protocol!==gitSourceProtocol)throw Error('Update the central library for Pug Git onboarding');
  if(ensureRepository&&!context.source&&repositoryReady!=='true')await repositoryFor(context);
  const checkout=path.join(root,'project'),sourceDirectory=context.source?.sourceDirectory;
  if(sourceDirectory&&sourceDirectory!=='sitefly-design')throw Error('Unsupported registered Pug source directory');
  const source=sourceDirectory?path.join(checkout,sourceDirectory):checkout;
  const input=path.join(root,'input'),templateRoot=await templateCheckout(data,context,template);
  await fs.mkdir(root,{recursive:true});
  if(context.source){
    await command(['git','-c','core.autocrlf=false','clone','--branch',context.branch,context.repository,checkout],root,{timeout:120000});
    if(sourceDirectory&&!(await fs.lstat(source)).isDirectory())throw Error('Registered Pug source directory is missing or not a directory');
    await git(source,['config','core.autocrlf','false']);
    await git(source,['merge-base','--is-ancestor',context.previousCommit,'HEAD']);
    if(context.draft){
      if(await git(source,['rev-parse','HEAD'])!==context.draft.baseCommit)throw Error('Git and the shared uncommitted preview both changed; preserve this checkout and perform a three-way merge before editing');
      const exported=await request(address.origin,'git-checkout',{token:connected.token,body:{}});
      if(exported.kind!=='git-draft'||exported.context.binding.baseBuild!==context.binding.baseBuild)throw Error('Shared preview changed during checkout');
      const current=new Set(exported.files.map(row=>row.path)),tracked=(await git(source,['ls-files','-z'])).split('\0').filter(Boolean);
      for(const name of tracked)if(!current.has(name)){if(!sourceAllowed(name)||sourceOutputs.has(name.split('/')[0]))throw Error('Registered repository contains unsupported source');await fs.rm(path.join(source,sourcePath(name)));}
      for(const row of exported.files){sourcePath(row.path);if(!sourceAllowed(row.path)||sourceOutputs.has(row.path.split('/')[0]))throw Error('Draft contains unsupported source');const bytes=Buffer.from(row.content,'base64');if(sha256(bytes)!==row.sha256||context.binding.sourceFiles[row.path]!==row.sha256)throw Error('Shared draft checksum mismatch');const to=path.join(source,row.path);await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,bytes);}
      if(exported.files.length!==Object.keys(context.binding.sourceFiles).length)throw Error('Shared draft is incomplete');
    }
  }else{
    const heads=await command(['git','ls-remote','--heads',context.repository],root,{timeout:60000});
    if(heads.output.trim())throw Error('Existing unbound repository is nonempty; reconcile its actual history before onboarding, never overwrite it');
    const exported=await request(address.origin,'git-checkout',{token:connected.token,body:{}});
    if(exported.context.binding.baseBuild!==context.binding.baseBuild)throw Error('The selected library build changed');
    await fs.mkdir(input,{recursive:true});
    for(const entry of exported.files){sourcePath(entry.path);if(!sourceAllowed(entry.path))throw Error('Original source contains a private path');const bytes=Buffer.from(entry.content,'base64');if(sha256(bytes)!==entry.sha256||context.binding.sourceFiles[entry.path]!==entry.sha256)throw Error('Original source checksum mismatch');const to=path.join(input,entry.path);await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,bytes,{flag:'wx'});}
    if(exported.files.length!==Object.keys(context.binding.sourceFiles).length)throw Error('Original source is incomplete');
    await fs.mkdir(source,{recursive:true});
    const tracked=(await git(templateRoot,['ls-files','-z'])).split('\0').filter(Boolean).filter(name=>sourceAllowed(name)&&!sourceOutputs.has(name.split('/')[0]));
    for(const name of tracked){const from=path.join(templateRoot,name),stat=await fs.lstat(from);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Template has unsupported entries');const to=path.join(source,name);await fs.mkdir(path.dirname(to),{recursive:true});if(/\.(?:js|mjs|json|pug|css|md|txt|ya?ml)$/.test(name)||name==='.gitignore')await fs.writeFile(to,(await fs.readFile(from,'utf8')).replace(/\r\n/g,'\n').replace(/[\t ]+$/gm,''));else await fs.copyFile(from,to);}
    const pkg=await readJSON(path.join(source,'package.json'));pkg.name=context.slug;await writeJSON(path.join(source,'package.json'),pkg);
    const ignoreFile=path.join(source,'.gitignore'),inherited=await fs.readFile(ignoreFile,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
    await fs.writeFile(ignoreFile,inherited.split('\n').filter(line=>! /^\/?(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(line.trim())).join('\n')+'\nnode_modules/\njsonData/\nsites/\nstaticSites/\npagesPugFn/\napi_cache/\n.designer-data/\n.env*\n.npmrc\n');
  }
  const plan={version:1,id,origin:address.origin,projectId:context.projectId,context,source,input:context.source?null:input,inputFiles:context.source?null:context.binding.sourceFiles,templateRoot,createdAt:new Date().toISOString()};await writeJSON(file,plan);
  await fs.writeFile(path.join(root,'AGENTS.md'),'Read the installed sitefly-designer-automation core/git-source.md. Work only in the source directory returned by prepare. Original input/ is immutable. Preserve the exact selected layout, data, assets and interactions. Use real reusable Pug pages, four template builds and representative browser checks. Resolve Penny before the final authorized commit. Publish once after all edits; registration is separate from domain deployment.\n');
  return {status:context.source?'formal-git-ready':'needs-pug-conversion',id,projectId:context.projectId,source,input:plan.input,templateCommit:context.template.commit,repository:context.repository,branch:context.branch,referencePreviewUrl:address.origin+context.referencePreviewPath,routes:context.routes,contract:{format:'site-template-pug',projectId:context.projectId,buildId:context.binding.baseBuild,sourceHash:context.binding.baseSourceHash,templateCommit:context.template.commit,defaultLanguage:'us',home:'us/index.html',staticOutput:'staticSites',dataMode:'snapshot',dataSource:'data/snapshot.json',clientDataSource:'data/snapshot.json',routes:context.routes.map(original=>({original,output:'us/'+original,template:'template/pages/REPLACE.pug'}))},next:'Read core/git-source.md; convert only when needed, then verify and inspect actual previews before the final Git/Penny commit and publish.'};
}
export async function gitSourceStatus({data,id,url,project}){
  if(id){const plan=await readJSON(planFile(data,id)),proof=await readJSON(path.join(path.dirname(planFile(data,id)),'verification.json')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});return {id,projectId:plan.projectId,source:plan.source,repository:plan.context.repository,verification:proof};}
  const address=libraryAddress(url,project);let connected=await connection(data,address);
  try{return await request(address.origin,'git-context',{token:connected.token});}
  catch(error){if(error.status!==401&&!(error.status===409&&/重新连接/.test(error.message)))throw error;connected=await connection(data,address,{refresh:true});return request(address.origin,'git-context',{token:connected.token});}
}
async function runBuild(root,commandName,log){
  const output=await fs.open(log,'w',0o600),npm=process.platform==='win32'?'npm.cmd':'npm';
    try{await new Promise((resolve,reject)=>{const child=spawn(npm,['run',commandName],{cwd:root,env:process.env,stdio:['ignore',output.fd,output.fd],shell:process.platform==='win32'});const timer=setTimeout(()=>child.kill(),600000);child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Actual Pug '+commandName+' did not pass; see the private plan build log'));});});}finally{await output.close();}
}
export async function verifyGitSource({data,id}){
  const file=planFile(data,id),plan=await readJSON(file),checked=await inspectPugSource(plan.source,plan.context),checks=[];
  if(plan.input)for(const [name,expected]of Object.entries(plan.inputFiles||plan.context.binding.sourceFiles))if(sha256(await fs.readFile(path.join(plan.input,sourcePath(name))))!==expected)throw Error('Original input changed; preserve the immutable source reference');
  for(const name of buildCommands){await runBuild(plan.source,name,path.join(path.dirname(file),name+'-private.log'));checks.push({command:'npm run '+name,status:'passed'});}
  if((await sourceSnapshot(plan.source)).sha256!==checked.source.sha256)throw Error('Build changed source; inspect it and verify again before committing');
  const output=path.join(plan.source,checked.contract.staticOutput);
  // The template's HTML minifier legitimately removes optional head/body tags.
  for(const row of checked.contract.routes){const html=await fs.readFile(path.join(output,row.output),'utf8');if(!/<html\b/i.test(html)||!/<(?:main|h1|article|iframe|section|div)\b/i.test(html))throw Error('Real route output is empty or missing: '+row.output);}
  const proof={version:1,status:'pug-build-verified',sourceHash:checked.source.sha256,artifactHash:(await sourceSnapshot(output)).sha256,routeCount:checked.contract.routes.length,checks,at:new Date().toISOString(),visualReview:'caller-must-verify'};await writeJSON(path.join(path.dirname(file),'verification.json'),proof);return proof;
}
export async function publishGitSource({data,id,push=true}){
  const file=planFile(data,id),plan=await readJSON(file),proof=await readJSON(path.join(path.dirname(file),'verification.json')),checked=await inspectPugSource(plan.source,plan.context);
  if(proof.sourceHash!==checked.source.sha256||proof.status!=='pug-build-verified'||(await sourceSnapshot(path.join(plan.source,checked.contract.staticOutput))).sha256!==proof.artifactHash)throw Error('Verified source or output changed; verify the actual Pug project again');
  const gitRoot=await git(plan.source,['rev-parse','--show-toplevel']),sourceDirectory=plan.context.source?.sourceDirectory;
  if(sourceDirectory&&sourceDirectory!=='sitefly-design')throw Error('Unsupported registered Pug source directory');
  if(path.resolve(gitRoot,sourceDirectory||'.')!==path.resolve(plan.source)||await git(plan.source,['status','--porcelain']))throw Error('Commit only the registered Pug project first and keep the working tree clean');
  if(canonicalRepository(await git(plan.source,['remote','get-url','origin']))!==canonicalRepository(plan.context.repository)||await git(plan.source,['branch','--show-current'])!==plan.context.branch)throw Error('Git repository or branch does not match the selected plan');
  const tracked=(await git(plan.source,['ls-files','-z'])).split('\0').filter(Boolean);
  if(tracked.length!==checked.source.files.length||tracked.some(name=>!sourceAllowed(name)||sourceOutputs.has(name.split('/')[0]))||checked.source.files.some(row=>!tracked.includes(row.file)))throw Error('Commit all editable source, excluding build output, dependencies and private configuration');
  const commit=await git(plan.source,['rev-parse','HEAD']),message=await git(plan.source,['log','-1','--format=%B']),penny=message.match(/^Penny: (recv[a-z0-9]+|[a-f0-9]{24})\s*$/m)?.[1];
  if(!penny)throw Error('Resolve Penny and commit with the exact Penny trailer before publishing');
  if(push)await git(plan.source,['push','origin','HEAD:refs/heads/'+plan.context.branch]);
  const remote=(await git(plan.source,['ls-remote','origin','refs/heads/'+plan.context.branch])).split(/\s+/)[0];if(remote!==commit)throw Error('Remote SHA differs; library address has not been updated');
  const pendingPath=path.join(path.dirname(file),'registration.json');let payload=await readJSON(pendingPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!payload||payload.commit!==commit||payload.sourceHash!==checked.source.sha256||payload.baseBuild!==plan.context.binding.baseBuild||payload.verification.artifactHash!==proof.artifactHash){payload={version:1,requestId:'git-'+randomUUID(),projectId:plan.projectId,baseBuild:plan.context.binding.baseBuild,baseSourceHash:plan.context.binding.baseSourceHash,previousCommit:plan.context.previousCommit,repository:plan.context.repository,branch:plan.context.branch,commit,pennyTask:penny,sourceHash:checked.source.sha256,verification:proof,files:await Promise.all(checked.source.files.map(async row=>({path:row.file,sha256:row.sha256,content:(await fs.readFile(path.join(plan.source,row.file))).toString('base64')})))};await writeJSON(pendingPath,payload);}
  const address={origin:plan.origin,projectId:plan.projectId};let connected=await connection(data,address),result;
  try{result=await request(plan.origin,'git-register',{token:connected.token,body:payload});}
  catch(error){if(error.status!==401)throw error;connected=await connection(data,address,{refresh:true});result=await request(plan.origin,'git-register',{token:connected.token,body:payload});}
  await writeJSON(path.join(path.dirname(file),'result.json'),result);plan.context={...plan.context,source:result.source,previousCommit:result.commit};await writeJSON(file,plan);return {...result,pennyTask:penny,next:'Record the actual Git commit, checks and registration result in Penny. Preserve existing preview/approval; this did not deploy a domain.'};
}
export async function captureGitSource({data,id}){
  const file=planFile(data,id),plan=await readJSON(file),proof=await readJSON(path.join(path.dirname(file),'verification.json')),checked=await inspectPugSource(plan.source,plan.context),output=path.join(plan.source,checked.contract.staticOutput);
  if(!plan.context.source||proof.sourceHash!==checked.source.sha256||(await sourceSnapshot(output)).sha256!==proof.artifactHash)throw Error('Use the registered Git source and verify the current source/output before capturing a preview');
  if(canonicalRepository(await git(plan.source,['remote','get-url','origin']))!==canonicalRepository(plan.context.repository)||await git(plan.source,['rev-parse','HEAD'])!==plan.context.source.commit)throw Error('Preview must start from the registered Git commit; reconcile Git first');
  const pending=path.join(path.dirname(file),'capture.json'),artifact=await sourceSnapshot(output);let payload=await readJSON(pending).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(!payload||payload.verification.sourceHash!==proof.sourceHash||payload.verification.artifactHash!==proof.artifactHash){const encode=async(root,rows)=>Promise.all(rows.map(async row=>({path:row.file,sha256:row.sha256,content:(await fs.readFile(path.join(root,row.file))).toString('base64')})));payload={version:1,requestId:'capture-'+randomUUID(),projectId:plan.projectId,baseBuild:plan.context.binding.baseBuild,baseSourceHash:plan.context.binding.baseSourceHash,baseCommit:plan.context.source.commit,repository:plan.context.repository,verification:proof,files:await encode(plan.source,checked.source.files),artifacts:await encode(output,artifact.files)};await writeJSON(pending,payload);}
  const address={origin:plan.origin,projectId:plan.projectId};let connected=await connection(data,address),result;
  try{result=await request(plan.origin,'git-capture',{token:connected.token,body:payload});}catch(error){if(error.status!==401)throw error;connected=await connection(data,address,{refresh:true});result=await request(plan.origin,'git-capture',{token:connected.token,body:payload});}
  plan.context.binding=result.binding;await writeJSON(file,plan);await writeJSON(path.join(path.dirname(file),'capture-result.json'),result);return {...result,previewUrl:plan.origin+'/v2/current/'+encodeURIComponent(plan.projectId)+'/'+checked.contract.home,versionPreviewUrl:plan.origin+result.previewPath,committed:false,next:'Refresh this same preview URL for subsequent edits. Review the actual page; commit and publish once after the requested edits are finished.'};
}
