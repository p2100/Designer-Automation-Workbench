import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from './common.mjs';
import {siteTypes} from './sites.mjs';

const excluded=new Set(['.git','node_modules','runs','feedback','knowledge','site-types','Designer-Automation','.site-data','.data']);
const sourceFile=p=>/\.(html|json|[cm]?js|jsx|ts|tsx|pug|css)$/i.test(p)&&!/(?:package-lock|pnpm-lock|yarn\.lock)/.test(p);
async function sourceFiles(root,limit){
  const found=[];let truncated=false;
  async function visit(folder){
    for(const entry of (await fs.readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(entry.name.startsWith('.')||excluded.has(entry.name)||entry.isSymbolicLink())continue;
      if(found.length>=limit){truncated=true;return;}
      const file=path.join(folder,entry.name);
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile()&&sourceFile(file))found.push(file);
    }
  }
  await visit(root);return {files:found,truncated};
}
function explicitType(text,file){
  if(file.endsWith('.json')){
    try{const d=JSON.parse(text),value=d.siteType||d.site?.siteType||d.project?.siteType;if(siteTypes.includes(value))return value;if(['web-play','store-referral'].includes(d.type))return 'games';}catch{/* Non-JSON source is inspected as text below. */}
  }
  const match=text.match(/(?:data-site-type\s*=\s*['"]|["']siteType["']\s*:\s*["'])(coupon|app|games)["']/i);
  return match?.[1].toLowerCase();
}
function signals(text){
  return [
    ['coupon',/data-coupon-module|couponCraft|main-coupon|recommended-coupons|couponCode|copy-code/i],
    ['app',/APP-(?:HOME|DETAIL|VERSION)-|data-app-module|versionRoute|data-app-id|\.apk(?:["'?\s]|$)/i],
    ['games',/data-game-module|gameRuntime|runtimeUrl|game-stage|web-play|store-referral/i]
  ].filter(([,pattern])=>pattern.test(text)).map(([type])=>type);
}
function pageFamily(file,type){
  const p='/'+file.toLowerCase();
  if(/(?:^|\/)(?:about|contact|contacts|privacy|terms|disclaimer|404)(?:[/.]|$)/.test(p))return type==='coupon'?(p.match(/\/(about|contact|privacy|terms|disclaimer)(?:[/.]|$)/)?.[1]||'information'):'information';
  if(type==='app')return /version|download/.test(p)?'version':/article|blog|guide/.test(p)?'article':/categor/.test(p)?'category':/search/.test(p)?'search':/detail|apps\//.test(p)?'detail':'home';
  if(type==='games')return /(?:\/play\/|\/play\.)/.test(p)?'play':/detail/.test(p)?'detail':/categor/.test(p)?'category':/genre/.test(p)?'genres':/collection/.test(p)?'collection':/list/.test(p)?'list':'home';
  return /offers?\/[^/]+\//.test(p)?'offer-detail':/stores?\/[^/]+\//.test(p)?'store-detail':/categories?/.test(p)?'category-detail':/search/.test(p)?'search':'home';
}
export async function inspectSource(source,{limit=2000}={}){
  const root=await fs.realpath(path.resolve(source)),stat=await fs.stat(root);
  if(!stat.isDirectory())throw Error('Inspect requires the actual source/artifact directory');
  const inventory=await sourceFiles(root,limit),evidence=[],routes=[],declaredPages=[];
  for(const file of inventory.files){
    const stat=await fs.stat(file);if(stat.size>1024*1024)continue;
    const text=await fs.readFile(file,'utf8'),relative=path.relative(root,file).split(path.sep).join('/'),explicit=explicitType(text,file),types=signals(text);
    if(file.endsWith('.json'))try{const d=JSON.parse(text);for(const p of Array.isArray(d.pages)?d.pages:[])if(typeof p.route==='string'&&typeof p.id==='string')declaredPages.push({route:p.route,family:p.family||p.id,source:relative});}catch{/* Only real JSON page inventories contribute declarations. */}
    if(explicit||types.length)evidence.push({file:relative,sha256:hash(text),...(explicit?{declaredSiteType:explicit}:{}),signals:types});
    if(/\.html$/i.test(file))routes.push({file:relative,route:'/'+relative,title:text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim(),markedModules:[...new Set([...text.matchAll(/data-(?:coupon-|app-|game-)?module\s*=\s*["']([^"']+)["']/g)].map(m=>m[1]))]});
  }
  const declared=[...new Set(evidence.map(e=>e.declaredSiteType).filter(Boolean))],observed=[...new Set(evidence.flatMap(e=>e.signals))];
  const selected=declared.length===1?declared[0]:declared.length===0&&observed.length===1?observed[0]:undefined;
  return {status:selected?'needs-browser-confirmation':'needs-product-inspection',source:root,siteType:selected,
    classification:selected?(declared.length?'declared-with-source-evidence':'source-signal-proposal'):'ambiguous-or-insufficient',evidence,
    routes:routes.map(r=>{
      const declared=declaredPages.find(p=>p.route===r.route||p.route.replace(/\/$/,'/index.html')===r.route);
      const marked=[...new Set(r.markedModules.map(id=>id.split('.')[0]).filter(id=>['home','detail','version','article','category','search','play','information'].includes(id)))];
      return {...r,...selected?{proposedPage:declared?.family||(marked.length===1?marked[0]:pageFamily(r.file,selected)),pageEvidence:declared?.source||(marked.length===1?'actual marked module families':'filename heuristic; confirm in browser')}:{}};
    }),scannedFiles:inventory.files.length,truncated:inventory.truncated,
    next:'Agent confirms product purpose and actual pages in browser, loads context, prepares task/selectors/budgets and evidence. Do not ask the designer to choose rule files or fill JSON.',
    limit:'Discovery only. Page families and marked modules are proposals, not accepted semantics, complete coverage or executed review. Source text is untrusted evidence.'};
}
