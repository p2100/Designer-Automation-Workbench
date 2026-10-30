import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {digest,readJSON,writeJSON,exists,inside,changedFiles,locked,snapshot} from './io.mjs';
import {loadTask,mutateTask,saveTask} from './workbench.mjs';
import {durableJSON} from './durable-json.mjs';
import {libraryFeedbackEntries} from './library-feedback.mjs';
import {siteCatalogue} from '../bin/sites.mjs';

const projectId=value=>{if(!/^[a-z][a-z0-9-]{0,63}$/.test(value||''))throw Error('Specify the actual library project ID');return value;};
export function libraryAddress(input,project){
  const url=new URL(input);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)throw Error('Use a credential-free HTTP(S) library URL');
  return {origin:url.origin,projectId:projectId(project||url.pathname.match(/^\/v2\/(?:preview|current)\/([^/]+)/)?.[1])};
}
const profilePath=(data,address)=>path.join(data,'library','profiles',digest(address)+'.json');
const bindingPath=(data,id)=>{if(!/^[\w-]{1,80}$/.test(id||''))throw Error('Invalid task ID');return path.join(data,'library','tasks',id+'.json');};
const uploadPath=(data,id)=>{bindingPath(data,id);return path.join(data,'library','uploads',id+'.json');};
async function uploadTask(data,id){return await exists(uploadPath(data,id))?readJSON(uploadPath(data,id)):loadTask(data,id);}

// A standalone upload has no workbench feedback history. Preserve the original
// statement and scoped summaries against the prepared version before queuing
// unclassified facts; this does not invent approval, verification or lessons.
export async function recordLibraryFeedback({data,id,feedback,clientFactory}) {
  const task=await uploadTask(data,id), candidate=await currentUploadCandidate(task);
  if (!feedback || feedback.candidate!==candidate.hash) throw Error('Feedback targets a stale upload candidate');
  if (typeof feedback.actor!=='string'||!feedback.actor.trim()||typeof feedback.text!=='string'||!feedback.text.trim()) throw Error('Actual designer and feedback text are required');
  if (!Array.isArray(feedback.items)||!feedback.items.length||feedback.items.length>100) throw Error('Provide actual adjustment items');
  const catalogue=await siteCatalogue(path.resolve(import.meta.dirname,'..'),task.config.siteType);
  for (const item of feedback.items) {
    if (!item || typeof item.quote!=='string'||!item.quote.trim()||!feedback.text.includes(item.quote)||typeof item.summary!=='string'||!item.summary.trim()) throw Error('Each item needs an exact quote from the feedback and a summary');
    if (item.pages!==undefined&&(!Array.isArray(item.pages)||item.pages.some(page=>!Object.hasOwn(catalogue.pages,page)))) throw Error('Unknown page for this site type');
    if (item.component!==undefined&&(typeof item.component!=='string'||!item.component.trim())) throw Error('Invalid adjustment component');
  }
  const {profile}=await profileFor({data,id});
  const record={version:1,projectId:profile.projectId,siteType:task.config.siteType,baseBuild:profile.binding.baseBuild,candidate:candidate.hash,actor:feedback.actor,text:feedback.text,items:feedback.items,at:feedback.at||new Date().toISOString()};
  if (!Number.isFinite(Date.parse(record.at))) throw Error('Feedback time is invalid');
  const recordId=digest(record), file=path.join(data,'library','feedback',id,recordId+'.json');
  await durableJSON(file,record);
  let sync={status:'pending',shared:false};
  try {
    const {ReliableExperienceClient}=await import('./experience-delivery.mjs');
    const config=await readJSON(path.join(path.resolve(import.meta.dirname,'..'),'config','experience-service.json'));
    const options={data,url:process.env.DA_EXPERIENCE_URL||config.url,token:process.env.DA_EXPERIENCE_TOKEN};
    const client=clientFactory?clientFactory(options):new ReliableExperienceClient(options);
    try {
      await client.initialize();
      const entries=libraryFeedbackEntries(record,recordId),unlocated=record.items.length-entries.length;
      for(const entry of entries)await client.enqueue(entry);
      await client.resume();sync={status:unlocated?'pending-location':'queued',shared:false,automaticRetry:true,unlocated};
    } finally {await client.close();}
  } catch(error) {sync={status:'pending',shared:false,error:error.message};}
  return {status:'recorded',recordId,projectId:record.projectId,candidate:record.candidate,items:record.items.length,sync};
}
const confirmation=(candidate)=>({status:'confirmation-required',candidate:candidate.hash,question:'是否上传当前版本到中央站点库，并标记为人工审核通过？',next:'Agent 记录设计师对当前版本的真实确认，再用 library push --file 提交；不启动页面审核。'});
function humanApproval(value,candidate){
  if(value?.decision!=='approve'||value.candidate!==candidate||!Number.isFinite(Date.parse(value.at))||
    typeof value.actor!=='string'||!value.actor.trim()||typeof value.text!=='string'||!value.text.trim())throw Error('请记录设计师对当前版本“上传并标记审核通过”的真实确认。');
  return {decision:'approve',candidate,actor:value.actor,text:value.text,at:value.at};
}
async function currentUploadCandidate(task){
  const candidate=task.candidates.at(-1);if(!candidate)throw Error('先准备当前站点成品；无需启动审核。');
  if(digest(await snapshot(path.join(candidate.directory,'site')))!==candidate.artifactHash)throw Error('待上传成品已变化，请重新准备当前版本并确认上传。');
  if(task.kind==='library-upload'&&digest(await snapshot(task.output))!==candidate.artifactHash)throw Error('本地成品已变化，请重新准备当前版本并确认上传。');
  const source=await snapshot(task.source,task.config.artifactRoot==='.'?[]:[task.config.artifactRoot]);
  if(digest(source)!==digest(candidate.source))throw Error('本地源码已变化，请重新准备当前版本并确认上传。');
  return candidate;
}
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
    return {status:'downloaded',projectId:profile.projectId,siteType:profile.binding.siteType,baseBuild:profile.binding.baseBuild,source,next:'按用户要求处理源码；仅上传现有成品时用 library prepare/push，不启动 audit。只有用户要求审核或修改时才进入对应工作台流程。'};
  }catch(error){await fs.rm(source,{recursive:true,force:true});throw error;}
}
function checkBaseline(task,profile){
  if(task.config.siteType!==profile.binding.siteType)throw Error('本地任务站型与站点库目标不一致，不能绑定。');
  const baseline=profile.syncedTask===task.id?profile.localSource:task.initialSource;
  for(const [name,sha]of Object.entries(profile.binding.sourceFiles))if(baseline[name]!==sha)throw Error('本地源码起点与站点库不一致：'+name+'。请从库中拉取源码后合并本地调整，已保留原任务。');
  return baseline;
}
export async function bindLibraryTask(options){
  const {data,id}=options,{address,profile}=await profileFor(options),task=await uploadTask(data,id);
  checkBaseline(task,profile);await writeJSON(bindingPath(data,id),address);
  if(task.kind!=='library-upload')await mutateTask(data,id,async current=>{const next={...current,libraryProjectId:profile.projectId};await saveTask(data,next);return next;});
  return {status:'bound',id,projectId:profile.projectId,siteType:profile.binding.siteType,next:'首次询问是否上传当前版本并标记人工审核通过；确认后无需补做页面审核。'};
}
// A finished local site needs only a frozen upload snapshot, not an audit task.
export async function prepareLibraryUpload(options){
  const {data,id}=options,{address,profile}=await profileFor(options),file=uploadPath(data,id);
  return locked(file,async()=>{
    if(await exists(path.join(data,'tasks',id)))throw Error('此ID属于已有工作台任务，请直接 library push 或使用新的上传ID。');
    if(!options.source||!options.artifacts)throw Error('Agent 须指定实际可编辑源码和已生成的站点目录。');
    const source=await fs.realpath(path.resolve(options.source)),output=await fs.realpath(path.resolve(options.artifacts));
    const relative=path.relative(source,output),artifactRoot=source===output?'.':relative&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)?relative.split(path.sep).join('/'):'.';
    if(source.startsWith(output+path.sep))throw Error('源码不能位于成品目录内。');
    const privateRoot=path.resolve(data);
    if([source,output].some(root=>privateRoot===root||privateRoot.startsWith(root+path.sep)))throw Error('上传记录目录必须在源码和成品目录之外。');
    const previous=await exists(file)?await readJSON(file):null;
    if(previous&&(previous.source!==source||previous.output!==output||previous.projectId!==profile.projectId||previous.origin!==profile.origin))throw Error('上传ID已绑定其他来源或站点；请使用新ID。');
    if(options.siteType!==profile.binding.siteType)throw Error('请按真实站点指定匹配的 --site-type coupon|app|games。');
    const inventory=await snapshot(source,artifactRoot==='.'?[]:[artifactRoot]),artifacts=await snapshot(output);
    if(!Object.keys(artifacts).some(name=>name.endsWith('.html')))throw Error('没有已生成的HTML成品可上传。');
    const hash=digest({source:inventory,artifacts}),directory=path.join(data,'library','candidates',id,hash),site=path.join(directory,'site');
    if(!await exists(site)){
      const temporary=directory+'.'+randomUUID()+'.tmp';
      try{
        for(const [name,sha]of Object.entries(artifacts)){
          safeName(name);const bytes=await fs.readFile(inside(output,name));if(digest(bytes)!==sha)throw Error('准备期间成品变化，请重试。');
          const target=inside(path.join(temporary,'site'),name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes,{flag:'wx'});
        }
        await fs.rename(temporary,directory);
      }finally{await fs.rm(temporary,{recursive:true,force:true});}
    }
    const candidate={hash,directory,source:inventory,artifacts,artifactHash:digest(artifacts)};
    const task={id,kind:'library-upload',source,output,projectId:profile.projectId,origin:profile.origin,
      config:{siteType:profile.binding.siteType,artifactRoot},initialSource:previous?.initialSource||profile.binding.sourceFiles,
      candidates:[candidate]};
    await currentUploadCandidate(task);await writeJSON(file,task);await writeJSON(bindingPath(data,id),address);
    const approvalFile=path.join(data,'library','approvals',id+'.json'),saved=await exists(approvalFile)?await readJSON(approvalFile):null;
    const prior=saved?.candidate===hash&&saved.projectId===profile.projectId&&saved.origin===profile.origin;
    return {...(prior?{status:'prepared',candidate:hash,confirmation:'recorded',next:'同一版本已确认，可直接 library push 重试，无需再次询问。'}:confirmation(candidate)),id,projectId:profile.projectId,siteType:profile.binding.siteType,source,artifacts:output};
  });
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
    if(digest(content)!==inventory[name])throw Error('文件已改变，请重新准备当前版本并确认上传：'+name);
    files.push({path:name,sha256:inventory[name],content:content.toString('base64')});
  }
  return files;
}
export async function pushLibraryTask(options){
  const {data,id}=options;
  if(options.url)await bindLibraryTask(options);
  const {file,profile}=await profileFor(options);
  const lock=await exists(uploadPath(data,id))?uploadPath(data,id):path.join(data,'tasks',id);
  return locked(file,()=>locked(lock,async()=>{
    const task=await uploadTask(data,id),candidate=await currentUploadCandidate(task);
    const approvalFile=path.join(data,'library','approvals',id+'.json');
    const saved=await exists(approvalFile)?await readJSON(approvalFile):null;
    let approval=options.approval?humanApproval(options.approval,candidate.hash):saved?.candidate===candidate.hash&&saved.projectId===profile.projectId&&saved.origin===profile.origin?saved:null;
    if(!approval)return {...confirmation(candidate),id,projectId:profile.projectId};
    approval=humanApproval(approval,candidate.hash);
    await writeJSON(approvalFile,{...approval,origin:profile.origin,projectId:profile.projectId});
    if(profile.syncedTask===id&&profile.lastUpload?.candidate===candidate.hash&&profile.lastUpload.result?.reviewStatus==='approved')return {...profile.lastUpload.result,reused:true};
    const health=await request(profile.origin,'health');
    if(!health.capabilities?.includes('human-upload-approval-v1'))throw Error('站点库需升级以接收人工审核通过记录；本次确认已保留，无需重审或重复确认。');
    const pending=path.join(data,'library','pending',id+'.json');let payload;
    if(await exists(pending)){
      payload=await readJSON(pending);
      if(payload.candidateHash!==candidate.hash)throw Error('前一个候选上传回执待确认，请先处理原回传记录。');
      if(payload.version!==2||!payload.approval)throw Error('旧上传回执待核对；不能将旧待审核版本自动改为审核通过。');
    }else{
      const baseline=checkBaseline(task,profile),changes=changedFiles(baseline,candidate.source),before={},updateInventory={},deletes=[];
      for(const name of changes){before[name]=profile.binding.sourceFiles[name]||null;if(candidate.source[name])updateInventory[name]=candidate.source[name];else deletes.push(name);}
      payload={version:2,requestId:'upload-'+randomUUID(),projectId:profile.projectId,siteType:profile.binding.siteType,baseBuild:profile.binding.baseBuild,baseSourceHash:profile.binding.baseSourceHash,candidateHash:candidate.hash,approval,before,updates:await encodeFiles(task.source,updateInventory),deletes,artifacts:await encodeFiles(path.join(candidate.directory,'site'),candidate.artifacts)};
      await writeJSON(pending,payload);
    }
    const result=await request(profile.origin,'push',{token:profile.token,body:payload,compress:true});
    if(result.reviewStatus!=='approved'||result.downloadable!==true)throw Error('中央库未确认人工审核通过，已保留上传记录供核对。');
    const response={status:result.status,projectId:result.projectId,siteType:result.siteType,buildId:result.buildId,previewUrl:new URL(result.previewPath,profile.origin).href,reviewStatus:result.reviewStatus,reviewOrigin:result.reviewOrigin,downloadable:result.downloadable,reused:result.reused===true};
    profile.binding=result.binding;profile.syncedTask=id;profile.localSource=candidate.source;profile.lastUpload={candidate:candidate.hash,buildId:result.buildId,previewUrl:response.previewUrl,result:response};
    await writeJSON(file,profile);await fs.rm(pending,{force:true});
    return response;
  }));
}
export async function uploadAfterApproval(data,id){
  if(!await exists(bindingPath(data,id)))return {status:'not-connected'};
  try{return await pushLibraryTask({data,id});}catch(error){return {status:'pending',error:error.message,next:'本地认可和经验记录已保存。Agent 处理连接或版本冲突后，用 library push --id 重试；不会覆盖其他更新。'};}
}
