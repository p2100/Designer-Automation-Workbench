import fs from 'node:fs/promises';
import path from 'node:path';
import {root,digest,exists,readJSON,requireText,safeId,locked,snapshot} from './io.mjs';
import {durableJSON} from './durable-json.mjs';
import {checkPackage,inside} from '../bin/common.mjs';
import {context} from '../bin/knowledge.mjs';
import {siteCatalogue,specialistContext} from '../bin/sites.mjs';
import {experiencePage} from './site-rules.mjs';
import {selectTaskExperience} from './experience-selection.mjs';
import {creativePoints,searchCreative} from './creative-memory.mjs';

const types=['coupon','app','games'];
export function requestSiteTypes(request){
  return [
    ['coupon',/\bcoupons?\b|优惠券|折扣码/i],
    ['app',/\bapps?\b|应用站|应用商店|应用下载/i],
    ['games',/\bgames?\b|游戏|小游戏/i],
  ].filter(([,pattern])=>pattern.test(request)).map(([type])=>type);
}
const location=(data,id)=>path.join(data,'generation',safeId(id));
const file=(data,id)=>path.join(location(data,id),'run.json');
export async function generationStatus(data,id){
  const run=await readJSON(file(data,id));
  if(run.id!==id||path.resolve(run.source||'')!==path.resolve(location(data,id),'source')||path.resolve(run.rules?.directory||'')!==path.resolve(location(data,id),'rules')||(await checkPackage(run.rules.directory)).manifestHash!==run.rules.manifestHash)
    throw Error('Frozen generation rules changed; preserve evidence and start a new run');
  return run;
}

export async function generationStart({data,id,siteType,request,gameType,pages,client}) {
  safeId(id);if(id.length>76)throw Error('Generation ID must leave room for the review task prefix');requireText(request,'Actual site request');
  const detected=requestSiteTypes(request);
  if(!siteType&&detected.length===1)siteType=detected[0];
  if(!types.includes(siteType))throw Error('Agent must determine the actual site type: coupon, app or games');
  if(detected.length===1&&detected[0]!==siteType)throw Error('Requested site type conflicts with the explicit product wording; inspect the actual product');
  if(siteType!=='games'&&gameType)throw Error('Game capability only applies to Games sites');
  if(siteType==='games'&&gameType&&!['web-play','store-referral','mixed'].includes(gameType))throw Error('Unknown game capability');
  const catalogue=await siteCatalogue(root,siteType),explicit=Boolean(pages?.length);
  pages=explicit?pages:Object.keys(catalogue.pages);
  if(siteType==='games'&&gameType==='store-referral'&&pages.includes('play')){
    if(explicit)throw Error('Store-referral sites do not have a play page');
    pages=pages.filter(p=>p!=='play');
  }
  if(!pages.includes('home')||new Set(pages).size!==pages.length)throw Error('Generation pages must include home exactly once');
  if(pages.some(p=>!catalogue.pages[p]))throw Error('Unknown page family for '+siteType);
  const checked=await checkPackage(root),directory=location(data,id);
  return locked(directory,async()=>{
    if(await exists(directory))throw Error('Generation ID already exists; preserve it and use another ID');
    await fs.mkdir(directory,{recursive:false,mode:0o700});
    const frozen=path.join(directory,'rules'),manifest=await readJSON(path.join(root,'manifest.json'));
    for(const item of [...manifest.files,{path:'manifest.json'}]){
      const target=inside(frozen,item.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(inside(root,item.path),target);
    }
    if((await checkPackage(frozen)).manifestHash!==checked.manifestHash)throw Error('Frozen generation package mismatch');
    const shared=await readJSON(path.join(frozen,'knowledge/shared/rules.json'));
    const contexts=[];
    for(const page of pages){
      const selected=siteType==='coupon'?await context({root:frozen,page,mode:'new-design',role:'author',adapter:'generic',stage:'all'}):await specialistContext(frozen,{siteType,page,role:'author',gameType});
      contexts.push({page,...selected,read:[...new Set(['core/generation-default.md','core/creative-generation.md','core/creative-learning.md','core/experience.md',...shared.rules.map(r=>r.source),...selected.read])]});
    }
    const keys=pages.map(p=>experiencePage(siteType,p));
    const found=client?await client.search({pages:keys,includePending:true,includeCreative:true,siteType,limit:100}):{cases:[],source:'not-connected'};
    const creative=await searchCreative(data,{siteType,pages});
    creative.teamReferences=found.creative||[];creative.teamSource=found.creativeSource||found.source||'unknown';creative.teamTruncated=found.creativeTruncated===true;if(found.warning)creative.teamWarning=found.warning;
    const config={siteType,pages:pages.map(family=>({family}))};
    const source=path.join(directory,'source');await fs.mkdir(source);
    const run={version:1,id,siteType,request,siteTypeSignals:detected,gameType:gameType||null,pages,source,rules:{directory:frozen,manifestHash:checked.manifestHash},contexts,
      experience:{source:found.source||'unknown',truncated:found.truncated===true,lessons:selectTaskExperience(found,config)},creative,directions:[],feedback:[],status:'awaiting-agent-design',createdAt:new Date().toISOString(),
      next:['Inspect actual product/data and capabilities','Generate and inspect an Image homepage direction','Design each applicable page with real content','Implement source, then start workbench review'],
      limits:['This prepares an Agent workflow; no image, site, review or acceptance is fabricated.']};
    await durableJSON(file(data,id),run);return run;
  });
}

function imageType(bytes){
  if(bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.readUInt32BE(8)===13&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0&&bytes.includes(Buffer.from('IEND')))return 'png';
  if(bytes.length>=8&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.lastIndexOf(Buffer.from([255,217]))>2)return 'jpg';
  if(bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8<=bytes.length&&['VP8 ','VP8L','VP8X'].includes(bytes.toString('ascii',12,16)))return 'webp';
  throw Error('Direction must be an actual PNG, JPEG or WebP image');
}
async function intactDirection(data,id,direction){
  if(!direction||!(/^[a-f0-9]{64}$/).test(direction.hash)||!['.png','.jpg','.webp'].includes(path.extname(direction.file||''))||path.basename(direction.file||'')!==direction.hash+path.extname(direction.file||'')||path.dirname(path.resolve(direction.file||''))!==path.resolve(location(data,id),'directions'))return false;
  try{const stat=await fs.lstat(direction.file);return stat.isFile()&&stat.size<=20*1024*1024&&digest(await fs.readFile(direction.file))===direction.hash;}catch{return false;}
}
export async function generationDirection({data,id,page='home',image,prompt}){
  return locked(location(data,id),async()=>{
    const run=await generationStatus(data,id);if(!run.pages.includes(page))throw Error('Direction page is outside this generation task');
    requireText(image,'Image path');requireText(prompt,'Actual image prompt or source');
    const resolved=await fs.realpath(path.resolve(image)),stat=await fs.stat(resolved);
    if(!stat.isFile()||stat.size>20*1024*1024)throw Error('Direction image must be a file under 20 MiB');
    const bytes=await fs.readFile(resolved),type=imageType(bytes),hash=digest(bytes),directory=path.join(location(data,id),'directions');
    await fs.mkdir(directory,{recursive:true});const target=path.join(directory,hash+'.'+type);
    if(!await exists(target))await fs.copyFile(resolved,target,fs.constants.COPYFILE_EXCL);
    if(digest(await fs.readFile(target))!==hash)throw Error('Direction copy mismatch');
    const direction={id:'direction-'+digest({page,hash}).slice(0,24),page,hash,file:target,prompt,createdAt:new Date().toISOString()};
    const next={...run,directions:[...run.directions.filter(d=>d.id!==direction.id),direction],status:'direction-recorded'};
    await durableJSON(file(data,id),next);return direction;
  });
}
export async function generationFeedback({data,id,actor,text,page,component,quote,observation,target,sentiment='positive'}){
  return locked(location(data,id),async()=>{
    const run=await generationStatus(data,id);requireText(actor,'Actual designer');requireText(text,'Actual designer feedback');
    const direction=run.directions.find(d=>d.id===target && d.page===page);
    if(!await intactDirection(data,id,direction))throw Error('Feedback requires an intact actual direction for this page');
    const points=creativePoints([{page,component,quote,observation,sentiment}],{siteType:run.siteType,pages:run.pages,text});
    const entry={id:'feedback-'+(run.feedback.length+1),actor,text,candidate:direction.hash,creativePoints:points,decision:'note',at:new Date().toISOString()};
    await durableJSON(file(data,id),{...run,feedback:[...run.feedback,entry],status:sentiment==='negative'?'needs-design-revision':run.status});return {id:entry.id,scope:'local-installation',status:'recorded',candidate:direction.hash};
  });
}

export async function generationReviewInput({data,id,configFile}){
  requireText(configFile,'Actual review configuration');
  const run=await generationStatus(data,id),config=await readJSON(path.resolve(configFile));
  if(config.siteType!==run.siteType)throw Error('Review site type must match the generation task');
  if(!Array.isArray(config.pages)||!config.pages.length)throw Error('Review needs actual page families and routes');
  if(config.pages.some(p=>!run.pages.includes(p.family)))throw Error('Review contains a page family outside the generation task');
  const source=await snapshot(run.source);
  if(!Object.keys(source).some(p=>/\.(html|pug|jsx?|tsx?|css)$/i.test(p)))throw Error('No actual site source exists yet; Agent must implement it first');
  const direction=run.directions.find(d=>d.page==='home');
  let homeDirection='not-run';
  if(direction)homeDirection=await intactDirection(data,id,direction)?'recorded':'unavailable';
  const covered=new Set(config.pages.map(p=>p.family)),unreviewedPages=run.pages.filter(page=>!covered.has(page));
  return {source:run.source,config,configFile:path.resolve(configFile),id:'gen-'+id,homeDirection,unreviewedPages};
}
