import {digest} from './io.mjs';
import {caseContent} from './experience-case.mjs';
import {experiencePage} from './site-rules.mjs';
export const marker='designer-creative-v1';
export function creativeCase(ref) {
  if(!['coupon','app','games'].includes(ref.siteType) || !ref.page || !ref.component || !ref.quote || !ref.observation || !['positive-reference','avoid-reference'].includes(ref.kind)) throw Error('Invalid creative reference');
  return caseContent({summary:ref.observation,cause:'Subjective designer feedback; cause not inferred',prevention:'Creative reference only; assess applicability, not a rule',actor:ref.actor,classification:'unclassified',scope:{pages:[experiencePage(ref.siteType,ref.page)],component:ref.component},evidence:[{candidate:ref.candidate,source:marker,siteType:ref.siteType,page:ref.page,component:ref.component,quote:ref.quote,kind:ref.kind,origin:ref.source,task:ref.task,feedbackId:ref.feedbackId,at:ref.at}],verification:{retested:false,designerApproved:false}});
}
export const isCreativeCase = entry => entry?.evidence?.some(e=>e.source===marker) === true;
export function creativeSearch(result, entries, filter) {
  if(!filter.includeCreative)return result;
  const {siteType,pages,component,limit=30}=filter;
  if(!['coupon','app','games'].includes(siteType)||!Array.isArray(pages)||!pages.length||pages.some(p=>siteType==='coupon'?p==='*'||p.includes(':'):!p.startsWith(siteType+':')))throw Error('Creative search requires exactly one site type and its page keys');
  const selected=[];
  for(const entry of entries){
    const e=entry.evidence?.find(x=>x.source===marker);
    if(entry.classification!=='unclassified'||entry.status!=='candidate'||!e||e.siteType!==siteType||!e.page||experiencePage(siteType,e.page)!==entry.scope?.pages?.[0]||entry.scope.pages.length!==1||!pages.includes(entry.scope.pages[0])||e.component!==entry.scope.component||!e.quote||!['positive-reference','avoid-reference'].includes(e.kind)||(component&&component!==e.component))continue;
    selected.push({id:entry.id,siteType,page:e.page,component:e.component,quote:e.quote,observation:entry.summary,kind:e.kind,candidate:e.candidate,actor:entry.actor,at:e.at,origin:e.origin,experienceUse:'creative-reference'});
  }
  selected.sort((a,b)=>(b.at||'').localeCompare(a.at||'')||a.id.localeCompare(b.id));
  const creative=selected.slice(0,limit);
  return {...result,creative,creativeTruncated:selected.length>creative.length,hash:digest({cases:result.cases,creative})};
}
