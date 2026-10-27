import path from 'node:path';
import {context} from '../bin/knowledge.mjs';
import {readJSON} from '../bin/common.mjs';
import {specialistContext,specialistRules,siteTypes} from '../bin/sites.mjs';
export const experiencePage=(type,page)=>!type||type==='coupon'?page:type+':'+page;
export async function maintenanceContext(root,{siteType='coupon',page,gameType}){
  if(!siteTypes.includes(siteType))throw Error('Unknown site type: '+siteType);
  const shared=await readJSON(path.join(root,'knowledge/shared/rules.json'));
  const selected=siteType==='coupon'?await context({root,page,mode:'preserve',adapter:'generic',role:'reviewer',stage:'review'}):await specialistContext(root,{siteType,page,role:'reviewer',gameType});
  const rules=await specialistRules(root,siteType,page,gameType);
  return {...selected,siteType,page,maintenanceVersion:'2026-10-27.4',read:[...new Set(['core/maintenance.md','core/experience.md','core/site-quality.md',...shared.rules.map(r=>r.source),...selected.read])],obligations:[...shared.rules.map(r=>({id:r.id,requirement:r.id,ruleSource:r.source,condition:'always'})),...rules],enabled:selected.enabled||[],limit:'Agent prepares bindings and evidence. Existing designer approval/MCP sharing remains required.'};
}
export function ruleChecks(config,contexts,baseChecks){
  if(!config.siteType)return [];
  const checks=[];
  for(const page of config.pages){const selected=contexts.find(c=>c.page===page.family);for(const base of baseChecks.filter(c=>c.page===page.id&&c.kind==='visual'))for(const rule of selected.obligations)checks.push({...base,id:page.id+'/'+base.width+'/rule-'+rule.id,criteria:['applicability','actualFinding','evidenceAndScope'],ruleId:rule.id,ruleSource:rule.ruleSource||rule.source,ruleRequirement:rule.requirement,condition:rule.condition||rule.when||'always'});}
  return checks;
}
