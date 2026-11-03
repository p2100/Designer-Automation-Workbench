import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {libraryAddress,libraryRequest} from './library-client.mjs';
import {digest,exists,readJSON,locked} from './io.mjs';
import {durableJSON} from './durable-json.mjs';

const states={development:'development',online:'online',offline:'offline','开发中':'development','已上线':'online','已下线':'offline'};
function addressFor({url,project}){return libraryAddress(url,project);}
const directory=(data,address)=>path.join(data,'site-status',digest(address));
function requestPath(root,request){if(!/^status-[a-z0-9-]{8,56}$/.test(request||''))throw Error('Invalid status request ID');return path.join(root,'requests',request+'.json');}
async function connection(options){
  const address=addressFor(options),root=directory(options.data,address),file=path.join(root,'connection.json');
  return locked(file,async()=>{
    let profile=await exists(file)?await readJSON(file):null;
    if(profile?.token&&profile.expiresAt>Date.now()){
      try{return {address,root,profile,view:await libraryRequest(address.origin,'site-status',{token:profile.token})};}
      catch(error){if(error.status!==401)throw error;}
    }
    const connected=await libraryRequest(address.origin,'connect',{body:{projectId:address.projectId,clientName:'Designer-Automation status Agent',purpose:'site-status'}});
    profile={...address,token:connected.token,expiresAt:connected.expiresAt};await durableJSON(file,profile);
    return {address,root,profile,view:connected.binding};
  });
}
export async function showSiteStatus(options){return (await connection(options)).view;}
async function send(connection,file,record){
  try{
    const result=await libraryRequest(connection.address.origin,'site-status',{token:connection.profile.token,body:record.payload});
    await durableJSON(file,{...record,status:'synced',result});
    return {...result,requestId:record.payload.requestId,harnessUsed:false};
  }catch(error){throw Error(error.message+'\n状态尚未确认同步；保留了本地请求 '+record.payload.requestId+'，使用 site-status retry 重试同一请求。');}
}
export async function updateSiteStatus(options){
  const state=states[options.status];
  if(!state||typeof options.actor!=='string'||!options.actor.trim()||typeof options.note!=='string'||!options.note.trim())throw Error('请指定 --status development|online|offline、真实 --actor 和 --note 上线/状态更新说明。');
  if(state==='online'&&!options.domain)throw Error('登记已上线时请提供 --domain 正式域名。');
  if(options.commit&&!/^[a-f0-9]{40}$/.test(options.commit))throw Error('--commit 须为开发人员提供的完整上线 Git SHA；未知时不填。');
  const connected=await connection(options),requestId=options.request||'status-'+randomUUID(),file=requestPath(connected.root,requestId);
  const intent={state,onlineUrl:options.domain||null,actor:options.actor,note:options.note,deployedCommit:options.commit||null};
  return locked(file,async()=>{
    if(await exists(file)){
      const prior=await readJSON(file);
      if(prior.intentHash!==digest(intent))throw Error('此请求标识已用于其他状态内容，请保留原记录并使用新请求标识。');
      return send(connected,file,prior);
    }
    const payload={version:1,projectId:connected.address.projectId,requestId,revision:connected.view.revision,baseBuild:connected.view.currentBuild,...intent};
    const record={status:'pending',createdAt:new Date().toISOString(),intentHash:digest(intent),payload};
    await durableJSON(file,record);return send(connected,file,record);
  });
}
export async function retrySiteStatus(options){
  const connected=await connection(options),file=requestPath(connected.root,options.request);
  return locked(file,async()=>send(connected,file,await readJSON(file)));
}
