import fs from 'node:fs/promises';
import path from 'node:path';
import {digest,exists,readJSON,requireText} from './io.mjs';

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
    return {page:point.page,component:point.component,quote:point.quote,observation:point.observation,kind:sentiment==='negative'?'avoid-reference':'positive-reference'};
  });
}

async function collect(data, folder, filename, type, pages, result, issues) {
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
            const stat=await fs.lstat(direction.file);
            if(!stat.isFile()||stat.size>20*1024*1024||digest(await fs.readFile(direction.file))!==direction.hash)throw Error('Direction evidence unavailable or changed');
            if(points.some(point=>point.page!==direction.page))throw Error('Direction page mismatch');
          } else {
            const candidate=record.candidates?.find(c=>c.hash===feedback.candidate);
            if(!candidate?.directory||!(/^[a-f0-9]{64}$/).test(feedback.candidate)||path.resolve(candidate.directory)!==path.resolve(directory,entry.name,'candidates',feedback.candidate)||!await exists(path.join(candidate.directory,'site')))throw Error('Candidate evidence unavailable');
          }
          for (const point of points) if (pages.includes(point.page)) result.push({
            ...point,siteType,source:folder==='tasks'?'maintenance':'generation',task:record.id,
            feedbackId:feedback.id,candidate:feedback.candidate,actor:feedback.actor,at:feedback.at,
          });
        } catch { issues.push({source:folder,id:entry.name,reason:'Cannot verify creative feedback evidence'}); }
      }
    } catch { issues.push({source:folder,id:entry.name,reason:'Cannot read or validate creative feedback'}); }
  }
}

export async function searchCreative(data,{siteType,pages}) {
  if (!types.includes(siteType) || !Array.isArray(pages) || !pages.length || pages.some(p=>typeof p!=='string'||!p))
    throw Error('Creative search needs an explicit site type and page families');
  const items=[],issues=[];
  await collect(data,'tasks','task.json',siteType,pages,items,issues);
  await collect(data,'generation','run.json',siteType,pages,items,issues);
  items.sort((a,b)=>(b.at||'').localeCompare(a.at||''));
  return {references:items,issues,scope:'local-installation',notice:'Designer statements are local references, not formal rules or authenticated identities.'};
}
