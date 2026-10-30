#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {readJSON} from '../lib/io.mjs';
import {defaultData} from '../lib/workbench.mjs';
import {ExperienceBridgeClient} from '../lib/experience-bridge.mjs';
import {generationStart,generationStatus,generationDirection,generationFeedback,generationReviewInput,generationGamesPlan} from '../lib/generation.mjs';
import {workbench} from './workbench.mjs';

export async function generate(args){
  const [action,...rest]=args,options={};
  if(!action||['help','--help'].includes(action))return {
    entry:'Agent first identifies actual site type, then uses this entry for Coupon, App or Games. Designers speak naturally; Agent prepares options and any review configuration.',
    commands:{start:'start --request TEXT --site-type coupon|app|games [--game-type web-play|store-referral|mixed] [--id ID]',status:'status --id ID','games-plan':'games-plan --id ID --task ACTUAL_GAME_TASK_JSON',direction:'direction --id ID --page PAGE --image FILE --prompt TEXT',feedback:'feedback --id ID --target DIRECTION_ID --page PAGE --actor DESIGNER --text ACTUAL_FEEDBACK --quote EXACT_TEXT --component COMPONENT --observation OBSERVED_POINT [--sentiment positive|negative] [--visual-spec AGENT_FILE]',review:'review --id ID --config AGENT_CONFIG [--action open|start]'},
    limitation:'This prepares and records an Agent workflow. The host Agent must actually generate images, implement source and inspect results; no aesthetic or user acceptance is fabricated.'};
  for(let i=0;i<rest.length;i+=2){if(!rest[i].startsWith('--')||rest[i+1]===undefined)throw Error('Expected --key value');options[rest[i].slice(2)]=rest[i+1];}
  const data=path.resolve(options.data||defaultData),id=options.id;
  if(action==='start'){
    const client=new ExperienceBridgeClient({data,url:options['experience-url']||process.env.DA_EXPERIENCE_URL,token:process.env.DA_EXPERIENCE_TOKEN});
    try{return await generationStart({data,id:id||'site-'+randomUUID(),siteType:options['site-type'],request:options.request,gameType:options['game-type'],pages:options.pages?.split(',').filter(Boolean),client});}finally{await client.close();}
  }
  if(action==='status')return generationStatus(data,id);
  if(action==='games-plan')return generationGamesPlan({data,id,taskFile:options.task});
  if(action==='direction')return generationDirection({data,id,page:options.page||'home',image:options.image,prompt:options.prompt});
  if(action==='feedback'){
    const recorded=await generationFeedback({data,id,actor:options.actor,text:options.text,page:options.page,component:options.component,quote:options.quote,observation:options.observation,target:options.target,sentiment:options.sentiment,visualSpec:options['visual-spec']?await readJSON(path.resolve(options['visual-spec'])):undefined});
    const client=new ExperienceBridgeClient({data,url:options['experience-url']||process.env.DA_EXPERIENCE_URL,token:process.env.DA_EXPERIENCE_TOKEN});
    try {const sync=await client.call('experience_status',{});return {...recorded,teamSync:sync.pending?'queued':'check-delivery-status',pending:sync.pending,rejected:sync.rejected};}
    catch(error){return {...recorded,teamSync:'pending-local',warning:error.message};}finally{await client.close();}
  }
  if(action==='review'){
    if(!['open','start'].includes(options.action||'open'))throw Error('Review action must be open or start');
    const input=await generationReviewInput({data,id,configFile:options.config});
    const review=await workbench([options.action||'open','--id',input.id,'--source',input.source,'--config',input.configFile,'--data',data]);
    return {...review,generation:{id,homeDirection:input.homeDirection,unreviewedPages:input.unreviewedPages,notice:'A direction is not visual approval; other page families remain unreviewed until checked or explicitly excluded.'}};
  }
  throw Error('Unknown generation action');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await generate(process.argv.slice(2)),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
