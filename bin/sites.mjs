import path from 'node:path';
import {inside,readJSON,packageRoot} from './common.mjs';

export const siteTypes=['coupon','app','games'];
export function projectSiteType(project){
  const type=project.siteType||'coupon'; // Historical Harness tasks are Coupon.
  if(!siteTypes.includes(type))throw Error('Unknown site type: '+type);
  return type;
}
export async function siteCatalogue(root=packageRoot,type='coupon'){
  if(!siteTypes.includes(type))throw Error('Unknown site type: '+type);
  if(type==='coupon')return readJSON(path.join(root,'config/page-contracts.json'));
  if(type==='app'){
    const base='site-types/app',index=await readJSON(inside(root,base+'/knowledge/index.json'));
    const data=await readJSON(inside(root,base+'/contracts/module-data.json'));
    return {pages:Object.fromEntries(Object.keys(index.pages).map(page=>[page,{modules:data.modules.filter(m=>m.required&&(m.pages.includes('*')||m.pages.includes(page))).map(m=>m.id)}])),states:{}};
  }
  return {pages:Object.fromEntries(['home','list','category','genres','collection','detail','play','information'].map(page=>[page,{modules:[]}])),states:{}};
}
export function requiredModules(catalogue,page,type){
  const family=page.family||page.id,modules=catalogue.pages[family]?.modules;
  if(!modules)throw Error('Unknown '+type+' page: '+page.id);
  if(type==='app'&&family==='information'){
    if(!['about','contact','privacy','disclaimer','not-found','terms'].includes(page.kind))throw Error('App information page needs its actual kind');
    return modules.filter(id=>!id.startsWith('information.')||id==='information.'+page.kind);
  }
  return modules;
}
export async function specialistRules(root,type,page,gameType){
  if(type==='coupon')return [];
  const base='site-types/'+type,file=type==='app'?'/contracts/requirements.json':'/core/owner-requirements.json';
  const source=await readJSON(inside(root,base+file));
  return source.rules.filter(r=>(r.pages.includes('*')||r.pages.includes(page))&&(!r.types||!gameType||gameType==='mixed'||r.types.includes(gameType))).map(r=>({
    ...r,ruleSource:base+'/'+(r.source||'core/owner-requirements.json'),version:source.version,
    condition:r.when||(r.types?'capability='+r.types.join('|'):'always'),level:r.level||'hard'
  }));
}
export async function specialistContext(root,{siteType,page,role,gameType}){
  const base='site-types/'+siteType,catalogue=await siteCatalogue(root,siteType);
  if(!catalogue.pages[page])throw Error('Unknown '+siteType+' page: '+page);
  if(siteType==='app'){
    const index=await readJSON(inside(root,base+'/knowledge/index.json'));
    const entries=[...index.common,...index.conditional].filter(e=>e.status==='active'&&e.roles.includes(role));
    return {read:[...new Set([...entries.map(e=>base+'/'+e.path),base+'/core/review.md',base+'/'+index.pages[page].path])],
      assets:[{id:'app-module-data',path:base+'/contracts/module-data.json',kind:'asset'},{id:'app-requirements',path:base+'/contracts/requirements.json',kind:'asset'}],
      readiness:{business:'active',detail:index.pages[page].status},gaps:[],sourceVersion:index.version};
  }
  if(gameType&&!['web-play','store-referral','mixed'].includes(gameType))throw Error('Unknown Games capability branch');
  if(page==='play'&&gameType==='store-referral')throw Error('Store-referral has no play page');
  const pageFile=['list','category','genres','collection'].includes(page)?'list':page;
  const branches=gameType&&gameType!=='mixed'?[gameType]:['web-play','store-referral'];
  const learning=await readJSON(inside(root,base+'/core/designer-learning.json'));
  return {read:[base+'/AGENTS.md',base+'/core/start.md',base+'/core/quality.md',base+'/core/workflow.md',base+'/core/owner-games-rules.md',base+'/core/owner-standards-20261027.md',base+'/core/experience-adoption-20261028.md',base+'/core/acceptance-application.md',base+'/core/acceptance-experience-20261028.md',base+'/core/designer-learning.md',base+'/core/web-game-publishing-experience.md',base+'/docs/portable-review.md',...branches.map(t=>base+'/site-types/'+t+'.md'),base+'/pages/'+pageFile+'.md'],
    assets:[{id:'games-owner-requirements',path:base+'/core/owner-requirements.json',kind:'asset'},{id:'games-readonly-inspector',path:base+'/bin/inspect-games.mjs',kind:'asset'},{id:'games-designer-learning',path:base+'/core/designer-learning.json',kind:'asset'}],
    designReferences:learning.entries.filter(entry=>entry.status==='reference-only'&&entry.pages.includes(page)),referenceUse:'Assess component conditions and exceptions; refresh current central references and retired IDs. References are not extra owner obligations or acceptance.',
    readiness:{business:'active',detail:'active'},gaps:gameType?[]:['Verify each real entity capability; both branches remain in coverage until resolved.'],sourceVersion:(await readJSON(inside(root,base+'/core/owner-requirements.json'))).version};
}
