import fs from 'node:fs/promises';
import path from 'node:path';
import {digest,exists,readJSON,requireText} from './io.mjs';
import {visualSpec} from './team-creative.mjs';

const types = ['coupon','app','games'];
// Agent-provided observations must quote actual feedback, and stay within the
// actual task's type and page. The local copy is the source for team references, not a rule.
export function creativePoints(points, {siteType, pages, text}) {
  if (points === undefined) return [];
  if (!types.includes(siteType)) throw Error('Creative feedback needs a confirmed site type');
  if (!Array.isArray(points) || points.length > 20) throw Error('Creative points must be an array of at most 20 items');
  return points.map(point => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) throw Error('Invalid creative point');
    for (const key of ['page','component','quote','observation']) requireText(point[key], 'Creative '+key);
    if (!pages.includes(point.page)) throw Error('Creative point page is outside this task');
    if (!text.includes(point.quote)) throw Error('Creative point must quote the actual designer feedback');
    if (point.quote.length > 1000 || point.observation.length > 1000 || point.component.length > 120) throw Error('Creative point is too long');
    const sentiment=point.sentiment||(point.kind==='avoid-reference'?'negative':'positive');
    if(!['positive','negative'].includes(sentiment))throw Error('Creative sentiment must be positive or negative');
    const spec=visualSpec(point.visualSpec);
    if(spec&&sentiment!=='positive')throw Error('Visual specification requires a positive designer reference');
    return {page:point.page,component:point.component,quote:point.quote,observation:point.observation,kind:sentiment==='negative'?'avoid-reference':'positive-reference',...(spec?{visualSpec:spec}:{})};
  });
}

async function verifiedImage(file,expected,cache) {
  const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.size>20*1024*1024)return false;
  const key=[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
  const cached=cache?.get(file);
  const hash=cached?.key===key?cached.hash:digest(await fs.readFile(file));
  if(cache)cache.set(file,{key,hash});
  return hash===expected;
}
async function collect(data, folder, filename, type, pages, result, issues, cache) {
  const directory=path.join(data,folder);
  if (!(await exists(directory))) return;
  for (const entry of await fs.readdir(directory,{withFileTypes:true})) {
    if (!entry.isDirectory()) continue;
    const file=path.join(directory,entry.name,filename);
    if (!(await exists(file))) continue;
    try {
      const record=await readJSON(file), siteType=folder==='tasks'?record.config?.siteType:record.siteType;
      if (siteType!==type) continue;
      const validPages=folder==='tasks'?record.config?.pages?.map(p=>p.family):record.pages;
      for (const feedback of record.feedback || []) {
        try {
          const points=creativePoints(feedback.creativePoints,{siteType,pages:validPages||[],text:feedback.text||''});
          if(!points.length)continue;
          if(folder==='generation'){
            const direction=record.directions?.find(d=>d.hash===feedback.candidate);
            const parent=path.resolve(directory,entry.name,'directions');
            if(!direction||!/^\w[\w-]*$/.test(entry.name)||!(/^[a-f0-9]{64}$/).test(direction.hash)||![direction.hash+'.png',direction.hash+'.jpg',direction.hash+'.webp'].includes(path.basename(direction.file||''))||path.dirname(path.resolve(direction.file||''))!==parent)throw Error('Invalid direction evidence path');
            if(!await verifiedImage(direction.file,direction.hash,cache))throw Error('Direction evidence unavailable or changed');
            if(points.some(point=>point.page!==direction.page))throw Error('Direction page mismatch');
          } else {
            const candidate=record.candidates?.find(c=>c.hash===feedback.candidate);
            if(!candidate?.directory||!(/^[a-f0-9]{64}$/).test(feedback.candidate)||path.resolve(candidate.directory)!==path.resolve(directory,entry.name,'candidates',feedback.candidate)||!await exists(path.join(candidate.directory,'site')))throw Error('Candidate evidence unavailable');
          }
          for (const point of points) if (pages.includes(point.page)) {
            let verified=!point.visualSpec;
            if(point.visualSpec && folder==='generation') verified=point.visualSpec.evidenceHash===feedback.candidate;
            if(point.visualSpec && folder==='tasks') {
              const directory=path.join(data,'tasks',entry.name,'evidence',feedback.candidate);
              try {
                for(const file of await fs.readdir(directory)){
                  if(!/^[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp)$/i.test(file))continue;
                  if(await verifiedImage(path.join(directory,file),point.visualSpec.evidenceHash,cache)){verified=true;break;}
                }
              }catch{}
            }
            if(!verified)issues.push({source:folder,id:entry.name,reason:'Cannot verify visual observation screenshot'});
            const {visualSpec:spec,...base}=point;
            result.push({...base,...(verified&&spec?{visualSpec:spec}:{}),siteType,source:folder==='tasks'?'maintenance':'generation',task:record.id,
              feedbackId:feedback.id,candidate:feedback.candidate,actor:feedback.actor,at:feedback.at});
          }
        } catch { issues.push({source:folder,id:entry.name,reason:'Cannot verify creative feedback evidence'}); }
      }
    } catch { issues.push({source:folder,id:entry.name,reason:'Cannot read or validate creative feedback'}); }
  }
}

export async function searchCreative(data,{siteType,pages,evidenceCache}) {
  if (!types.includes(siteType) || !Array.isArray(pages) || !pages.length || pages.some(p=>typeof p!=='string'||!p))
    throw Error('Creative search needs an explicit site type and page families');
  const items=[],issues=[];
  await collect(data,'tasks','task.json',siteType,pages,items,issues,evidenceCache);
  await collect(data,'generation','run.json',siteType,pages,items,issues,evidenceCache);
  items.sort((a,b)=>(b.at||'').localeCompare(a.at||''));
  return {references:items,issues,scope:'local-installation',notice:'Designer statements are local references, not formal rules or authenticated identities.'};
}
