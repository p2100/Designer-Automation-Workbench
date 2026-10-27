import {digest,requireText} from './io.mjs';
import {caseContent,caseId,capturedCase} from './experience-case.mjs';
import {experiencePage} from './site-rules.mjs';

export const marker='designer-creative-v1';
export const visualMarker='designer-visual-spec-v1';
const aspects=['layout','spacing','color','typography','components','imagery','interaction','responsive','other'];
export function visualSpec(input,{evidenceHash}={}) {
  if(input===undefined)return undefined;
  if(!input||typeof input!=='object'||!Array.isArray(input.observations)||!input.observations.length||input.observations.length>12)throw Error('Visual observations require 1–12 inspected details');
  const observations=input.observations.map(item=>{
    if(!item||!aspects.includes(item.aspect))throw Error('Unknown visual observation aspect');
    requireText(item.description,'Visual observation');
    if(item.description.length>600)throw Error('Visual observation is too long');
    return {aspect:item.aspect,description:item.description};
  });
  const applicability=requireText(input.applicability,'Visual applicability');
  const limits=requireText(input.limits,'Visual evidence limits');
  if(applicability.length>600||limits.length>600)throw Error('Visual context is too long');
  const hash=evidenceHash||input.evidenceHash;
  if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('Visual observations need an actual image evidence hash');
  return {observations,applicability,limits,evidenceHash:hash};
}
export function creativeCase(ref) {
  if(!['coupon','app','games'].includes(ref.siteType) || !ref.page || !ref.component || !ref.quote || !ref.observation || !['positive-reference','avoid-reference'].includes(ref.kind)) throw Error('Invalid creative reference');
  return caseContent({summary:ref.observation,cause:'Subjective designer feedback; cause not inferred',prevention:'Creative reference only; assess applicability, not a rule',actor:ref.actor,classification:'unclassified',scope:{pages:[experiencePage(ref.siteType,ref.page)],component:ref.component},evidence:[{candidate:ref.candidate,source:marker,siteType:ref.siteType,page:ref.page,component:ref.component,quote:ref.quote,kind:ref.kind,origin:ref.source,task:ref.task,feedbackId:ref.feedbackId,at:ref.at}],verification:{retested:false,designerApproved:false}});
}
export const isCreativeCase = entry => entry?.evidence?.some(e=>e.source===marker) === true;
export const isVisualSpecCase = entry => entry?.evidence?.some(e=>e.source===visualMarker) === true;
export function visualSpecCase(ref) {
  if(!ref.visualSpec||ref.kind!=='positive-reference')return null;
  const spec=visualSpec(ref.visualSpec);
  return caseContent({summary:'Visual observations from designer-satisfied work',cause:'Agent observation of actual image; not a proven outcome',prevention:'Adapt to the actual site; do not treat as a mandatory rule',actor:ref.actor,classification:'unclassified',scope:{pages:[experiencePage(ref.siteType,ref.page)],component:ref.component},evidence:[{candidate:ref.candidate,source:visualMarker,parent:caseId(creativeCase(ref)),siteType:ref.siteType,page:ref.page,spec}],verification:{retested:false,designerApproved:false}});
}
export function manageCreative(current,input,priorVisual) {
  if(!isCreativeCase(current))throw Error('Creative reference is absent');
  if(input.action==='inspect')return {reference:current};
  const op='op-'+digest(input).slice(0,32),prior=(current.creativeHistory||[]).find(h=>h.operationId===op);
  if(prior)return {reference:current,operationId:op,replayed:true};
  requireText(input.actor,'Actual designer');requireText(input.reason,'Actual correction or withdrawal reason');
  if(current.status!=='candidate'||!Number.isInteger(input.expectedRevision)||current.revision!==input.expectedRevision)throw Error('Creative reference revision is stale; inspect before changing it');
  if(!['replace','retract'].includes(input.action))throw Error('Unknown creative operation');
  let replacement;
  if(input.action==='replace'){
    requireText(input.observation,'Corrected observation');
    if(input.observation.length>1000)throw Error('Corrected observation is too long');
    const e=current.evidence.find(x=>x.source===marker);
    const kind=input.sentiment==='negative'?'avoid-reference':input.sentiment==='positive'?'positive-reference':e.kind;
    const evidence=current.evidence.map(x=>x.source===marker?{...x,kind}:x);
    evidence.push({candidate:e.candidate,source:'designer-creative-correction-v1',actor:input.actor,reason:input.reason,previous:current.id});
    if(input.visualSpec){
      const sameScope=priorVisual?.scope?.component===current.scope.component&&priorVisual?.scope?.pages?.length===1&&priorVisual.scope.pages[0]===current.scope.pages[0];
      const previous=sameScope&&priorVisual?.evidence?.find(v=>v.source===visualMarker&&(v.parent===current.id||(v.parent==='self'&&priorVisual.id===current.id))&&v.candidate===e.candidate&&v.siteType===e.siteType&&v.page===e.page);
      if(!previous)throw Error('Correcting visual observations requires an existing actual-image observation');
      const corrected=visualSpec(input.visualSpec,{evidenceHash:visualSpec(previous.spec).evidenceHash});
      evidence.push({candidate:e.candidate,source:visualMarker,parent:'self',siteType:e.siteType,page:e.page,spec:corrected});
    }
    replacement=capturedCase(caseContent({...current,summary:input.observation,actor:current.actor,evidence}));
  }
  const at=new Date().toISOString(), history={operationId:op,action:input.action,actor:input.actor,reason:input.reason,at,...(replacement?{replacement:replacement.id}:{})};
  const reference={...current,status:'conflict',revision:current.revision+1,creativeState:input.action==='replace'?'replaced':'retracted',creativeHistory:[...(current.creativeHistory||[]),history]};
  return {reference,replacement,operationId:op};
}
export function creativeSearch(result, entries, filter) {
  if(!filter.includeCreative)return result;
  const {siteType,pages,component,limit=30}=filter;
  if(!['coupon','app','games'].includes(siteType)||!Array.isArray(pages)||!pages.length||pages.some(p=>siteType==='coupon'?p==='*'||p.includes(':'):!p.startsWith(siteType+':')))throw Error('Creative search requires exactly one site type and its page keys');
  const selected=[],retired=[],specs=new Map();
  if(filter.includeVisualSpecs)for(const source of entries){
    for(const evidence of source.evidence||[]){
      if(evidence.source!==visualMarker||evidence.siteType!==siteType)continue;
      const parent=evidence.parent==='self'?source.id:evidence.parent;
      if(!/^case-[a-f0-9]{32}$/.test(parent||''))continue;
      const old=specs.get(parent);
      if(!old||(source.createdAt||'')>(old.source.createdAt||''))specs.set(parent,{source,evidence});
    }
  }
  for(const entry of entries){
    const e=entry.evidence?.find(x=>x.source===marker);
    if(e&&entry.status==='conflict'&&entry.creativeState&&e.siteType===siteType&&pages.includes(experiencePage(siteType,e.page)))retired.push(entry.id);
    if(entry.classification!=='unclassified'||entry.status!=='candidate'||!e||e.siteType!==siteType||!e.page||experiencePage(siteType,e.page)!==entry.scope?.pages?.[0]||entry.scope.pages.length!==1||!pages.includes(entry.scope.pages[0])||e.component!==entry.scope.component||!e.quote||!['positive-reference','avoid-reference'].includes(e.kind)||(component&&component!==e.component))continue;
    let spec;
    if(filter.includeVisualSpecs&&e.kind==='positive-reference'){
      const selectedSpec=specs.get(entry.id), evidence=selectedSpec?.evidence;
      if(evidence&&evidence.page===e.page&&evidence.candidate===e.candidate&&selectedSpec.source.scope?.component===entry.scope.component&&selectedSpec.source.scope?.pages?.length===1&&selectedSpec.source.scope.pages[0]===entry.scope.pages[0])try{spec=visualSpec(evidence.spec);}catch{}
    }
    selected.push({id:entry.id,revision:entry.revision,siteType,page:e.page,component:e.component,quote:e.quote,observation:entry.summary,kind:e.kind,candidate:e.candidate,actor:entry.actor,at:e.at,origin:e.origin,...(spec?{visualSpec:spec}:{}),...(entry.evidence.find(x=>x.source==='designer-creative-correction-v1')?{correction:entry.evidence.find(x=>x.source==='designer-creative-correction-v1')}:{}),experienceUse:'creative-reference'});
  }
  selected.sort((a,b)=>(b.at||'').localeCompare(a.at||'')||a.id.localeCompare(b.id));
  const creative=selected.slice(0,limit);retired.sort();
  return {...result,creative,...(filter.includeRetired?{creativeRetired:retired}:{}),creativeTruncated:selected.length>creative.length,hash:digest(filter.includeRetired?{cases:result.cases,creative,creativeRetired:retired}:{cases:result.cases,creative})};
}
