import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {digest,readJSON,writeJSON,exists,inside,changedFiles,locked} from './io.mjs';
import {loadTask,verifyCandidate} from './workbench.mjs';
import {reviewCoverage} from './adjustment.mjs';

const projectId=value=>{if(!/^[a-z][a-z0-9-]{0,63}$/.test(value||''))throw Error('Specify the actual library project ID');return value;};
export function libraryAddress(input,project){
  const url=new URL(input);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw Error('Use a credential-free HTTP(S) library URL');
  return {origin:url.origin,projectId:projectId(project||url.pathname.match(/^\/v2\/(?:preview|current)\/([^/]+)/)?.[1])};
}
const profilePath=(data,address)=>path.join(data,'library','profiles',digest(address)+'.json');
const bindingPath=(data,id)=>{if(!/^[\w-]{1,80}$/.test(id||''))throw Error('Invalid task ID');return path.join(data,'library','tasks',id+'.json');};
async function request(origin,action,{token,body,compress=false}={}){
  const headers={...(token?{Authorization:'Bearer '+token}:{})};
  let payload;
  if(body){headers['Content-Type']='application/json';payload=JSON.stringify(body);if(compress){headers['Content-Encoding']='gzip';payload=gzipSync(payload);}}
  const response=await fetch(origin+'/v2/api/designer-library/'+action,{method:body?'POST':'GET',headers,body:payload,redirect:'error',signal:AbortSignal.timeout(120000)});
  let result;
  try{result=JSON.parse(await response.text());}catch{throw Object.assign(Error(response.status===404?'站点库尚未升级回传接口，请先更新站点库服务。':'站点库响应格式异常，尚未确认回传结果。'),{status:response.status});}
  if(!response.ok)throw Object.assign(Error(result.error||'Library request rejected'),{status:response.status});return result;
}
export async function connectLibrary({data,url,project,clientName='设计师本地 Agent'}){
  const address=libraryAddress(url,project),file=profilePath(data,address);
  return locked(file,async()=>{
    let profile=await exists(file)?await readJSON(file):{...address};
    if(profile.token&&profile.expiresAt>Date.now()){
      try{const checked=await request(address.origin,'binding',{token:profile.token});return {status:'connected',projectId:profile.projectId,siteType:checked.binding.siteType,baseBuild:profile.binding.baseBuild,currentBuild:checked.currentBuild,stale:checked.stale,expiresAt:profile.expiresAt};}
      catch(error){if(error.status!==401)throw error;}
    }
    const connected=await request(address.origin,'connect',{body:{projectId:address.projectId,clientName}});
    profile={...profile,...address,token:connected.token,expiresAt:connected.expiresAt,binding:connected.binding};await writeJSON(file,profile);
    return {status:'connected',projectId:address.projectId,siteType:connected.binding.siteType,baseBuild:connected.binding.baseBuild,expiresAt:profile.expiresAt};
  });
}
async function profileFor({data,url,project,id}){
  const address=url?libraryAddress(url,project):await readJSON(bindingPath(data,id)).catch(error=>{if(error.code==='ENOENT')throw Error('此任务尚未连接站点库；先 library connect，再 library bind。');throw error;});
  const file=profilePath(data,address),profile=await readJSON(file).catch(error=>{if(error.code==='ENOENT')throw Error('请先 library connect 连接目标站点。');throw error;});
  if(!profile.token||profile.expiresAt<Date.now())throw Error('站点连接已过期，请重新 library connect。');
  return {address,file,profile};
}
export async function libraryStatus(options){const {profile}=await profileFor(options),result=await request(profile.origin,'binding',{token:profile.token});return {status:'connected',projectId:profile.projectId,siteType:result.binding.siteType,baseBuild:profile.binding.baseBuild,currentBuild:result.currentBuild,stale:result.stale,expiresAt:profile.expiresAt};}
export async function disconnectLibrary(options){const {profile,file}=await profileFor(options);await request(profile.origin,'disconnect',{token:profile.token,body:{}});await fs.rm(file);return {status:'disconnected',projectId:profile.projectId};}
function safeName(name){
  if(typeof name!=='string'||!name||name.startsWith('/')||/^[a-z]:/i.test(name)||/[\u0000-\u001f]/.test(name)||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..'||/^(?:\.git|\.env(?:\..*)?|\.designer-data|node_modules)$/.test(p)))throw Error('Unsafe library file path');
  return name;
}
export async function pullLibrary(options){
  const {data,output}=options,{profile,file}=await profileFor(options);
  const source=path.resolve(output||path.join(data,'library','sources',profile.projectId+'-'+randomUUID()));
  if(await exists(source))throw Error('目标目录已存在，保留原文件并选择新的源码目录。');
  const response=await request(profile.origin,'checkout',{token:profile.token,body:{}});
  const entries=new Map();
  for(const entry of response.files){safeName(entry.path);const bytes=Buffer.from(entry.content,'base64');if(entries.has(entry.path)||digest(bytes)!==entry.sha256||response.binding.sourceFiles[entry.path]!==entry.sha256)throw Error('Library source checksum mismatch');entries.set(entry.path,bytes);}
  if(entries.size!==Object.keys(response.binding.sourceFiles).length)throw Error('Incomplete library source');
  try{
    await fs.mkdir(source,{recursive:true});
    for(const [name,bytes]of entries){const target=inside(source,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});}
    profile.binding=response.binding;profile.pullSource=source;await writeJSON(file,profile);
    return {status:'downloaded',projectId:profile.projectId,siteType:profile.binding.siteType,baseBuild:profile.binding.baseBuild,source,next:'Agent 读取本站原有构建/页面规则，用 audit start --source 此目录准备任务；原库及下载源码不会被直接修改。'};
  }catch(error){await fs.rm(source,{recursive:true,force:true});throw error;}
}
function checkBaseline(task,profile){
  if(task.config.siteType!==profile.binding.siteType)throw Error('本地任务站型与站点库目标不一致，不能绑定。');
  const baseline=profile.syncedTask===task.id?profile.localSource:task.initialSource;
  for(const [name,sha]of Object.entries(profile.binding.sourceFiles))if(baseline[name]!==sha)throw Error('本地源码起点与站点库不一致：'+name+'。请从库中拉取源码后合并本地调整，已保留原任务。');
  return baseline;
}
export async function bindLibraryTask(options){
  const {data,id}=options,{address,profile}=await profileFor(options),task=await loadTask(data,id);
  checkBaseline(task,profile);await writeJSON(bindingPath(data,id),address);
  return {status:'bound',id,projectId:profile.projectId,siteType:profile.binding.siteType,autoUpload:'After the designer approves this exact completed candidate.'};
}
export async function bindPulledSource(data,id,localSource){
  if(!localSource)return;
  const directory=path.join(data,'library','profiles');
  for(const name of await fs.readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){
    const profile=await readJSON(path.join(directory,name));
    if(profile.pullSource&&path.resolve(profile.pullSource)===path.resolve(localSource))return bindLibraryTask({data,id,url:profile.origin,project:profile.projectId});
  }
}
async function encodeFiles(root,inventory){
  const files=[];let bytes=0;
  for(const name of Object.keys(inventory).sort()){
    safeName(name);const content=await fs.readFile(inside(root,name));bytes+=content.length;
    if(bytes>192*1024*1024||content.length>32*1024*1024)throw Error('回传包超过大小限制，尚未上传。');
    if(digest(content)!==inventory[name])throw Error('文件已改变，请重新构建并复查候选：'+name);
    files.push({path:name,sha256:inventory[name],content:content.toString('base64')});
  }
  return files;
}
export async function pushLibraryTask(options){
  const {data,id}=options;
  if(options.url)await bindLibraryTask(options);
  const {file,profile}=await profileFor(options);
  return locked(file,()=>locked(path.join(data,'tasks',id),async()=>{
    const task=await loadTask(data,id),candidate=await verifyCandidate(task);
    const coverage=reviewCoverage(task);
    if(!['awaiting-designer','approved'].includes(task.status)||task.presented!==candidate.hash||!coverage.confirmed||coverage.gaps.length)throw Error('请先完成当前候选的检查和交接，再更新站点库。');
    const pending=path.join(data,'library','pending',id+'.json');let payload;
    if(await exists(pending)){
      payload=await readJSON(pending);
      if(payload.candidateHash!==candidate.hash)throw Error('前一个候选上传回执待确认，请先处理原回传记录。');
    }else{
      const baseline=checkBaseline(task,profile),changes=changedFiles(baseline,candidate.source),before={},updateInventory={},deletes=[];
      for(const name of changes){before[name]=profile.binding.sourceFiles[name]||null;if(candidate.source[name])updateInventory[name]=candidate.source[name];else deletes.push(name);}
      payload={version:1,requestId:'upload-'+randomUUID(),projectId:profile.projectId,siteType:profile.binding.siteType,baseBuild:profile.binding.baseBuild,baseSourceHash:profile.binding.baseSourceHash,candidateHash:candidate.hash,before,updates:await encodeFiles(task.source,updateInventory),deletes,artifacts:await encodeFiles(path.join(candidate.directory,'site'),candidate.artifacts)};
      await writeJSON(pending,payload);
    }
    const result=await request(profile.origin,'push',{token:profile.token,body:payload,compress:true});
    profile.binding=result.binding;profile.syncedTask=id;profile.localSource=candidate.source;profile.lastUpload={candidate:candidate.hash,buildId:result.buildId,previewUrl:new URL(result.previewPath,profile.origin).href};
    await writeJSON(file,profile);await fs.rm(pending,{force:true});
    return {status:result.status,projectId:result.projectId,siteType:result.siteType,buildId:result.buildId,previewUrl:profile.lastUpload.previewUrl,reviewStatus:result.reviewStatus,downloadable:result.downloadable,reused:result.reused===true};
  }));
}
export async function uploadAfterApproval(data,id){
  if(!await exists(bindingPath(data,id)))return {status:'not-connected'};
  try{return await pushLibraryTask({data,id});}catch(error){return {status:'pending',error:error.message,next:'本地认可和经验记录已保存。Agent 处理连接或版本冲突后，用 library push --id 重试；不会覆盖其他更新。'};}
}
