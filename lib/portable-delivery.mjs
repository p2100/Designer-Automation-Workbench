import fs from 'node:fs/promises';
import path from 'node:path';
import {digest,inside,snapshot} from './io.mjs';

const origin='https://portable-delivery.invalid';
const prefix='/v2/preview/portable-check/current/site/';
const decodeEntities=value=>value.replace(/&(?:#(x[\da-f]+|\d+)|amp|quot|apos|lt|gt|sol|colon);/gi,(all,code)=>{
  if(code){const point=Number.parseInt(code[0].toLowerCase()==='x'?code.slice(1):code,code[0].toLowerCase()==='x'?16:10);return point>0&&point<=0x10ffff?String.fromCodePoint(point):'\ufffd';}
  return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',sol:'/',colon:':'}[all.slice(1,-1).toLowerCase()];
});
function attributes(source){
  const result=new Map();
  for(const match of source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)){
    const key=match[1].toLowerCase();if(!result.has(key))result.set(key,decodeEntities(match[2]??match[3]??match[4]));
  }
  return result;
}
const external=value=>/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);

// Read the exact artifact only. This is target integrity under a nested library
// URL, not a page audit, browser run, design approval, or external-link crawler.
export async function inspectPortableDelivery(directory,inventory){
  const files=inventory||await snapshot(directory),names=Object.keys(files),known=new Set(names),failures=[];
  const cssQueue=[],seenCss=new Set();let references=0,htmlCount=0;
  const fail=(file,role,value,reason,target)=>failures.push({file,role,value,reason,...(target?{target}:{})});
  function reference(file,value,role,baseUrl){
    value=decodeEntities(value).trim();
    if(!value||value.startsWith('#')||external(value)||/^(?:var|env)\(/i.test(value))return;
    references++;
    let url,pathname;
    try{url=new URL(value,baseUrl);pathname=path.posix.normalize(decodeURIComponent(url.pathname));}
    catch{fail(file,role,value,'invalid local URL');return;}
    if(url.origin!==origin||!pathname.startsWith(prefix)){fail(file,role,value,'escapes deployed version prefix');return;}
    let target=pathname.slice(prefix.length);
    if(role==='data-root'){
      const root=target&&!target.endsWith('/')?target+'/':target;
      if(root&&!names.some(name=>name.startsWith(root)))fail(file,role,value,'site root is absent from artifact',root);
      return;
    }
    if(!target||target.endsWith('/'))target+='index.html';
    if(!known.has(target)){fail(file,role,value,'target is absent from artifact',target);return;}
    return target;
  }
  function cssReferences(file,source,baseUrl){
    source=source.replace(/\/\*[\s\S]*?\*\//g,'');
    for(const match of source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi)){
      const target=reference(file,match[1]??match[2]??match[3],'css-url',baseUrl);
      if(target&&/\.css$/i.test(target))cssQueue.push(target);
    }
    for(const match of source.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)){
      const target=reference(file,match[1]??match[2],'css-import',baseUrl);if(target)cssQueue.push(target);
    }
  }
  for(const file of names.filter(name=>/\.html?$/i.test(name))){
    htmlCount++;
    const source=await fs.readFile(inside(directory,file),'utf8'),documentUrl=origin+prefix+file;
    const structure=source.replace(/<!--[\s\S]*?-->/g,'').replace(/(<script\b(?:"[^"]*"|'[^']*'|[^"'<>])*>)[\s\S]*?<\/script\s*>/gi,'$1</script>');
    const markup=structure.replace(/(<style\b(?:"[^"]*"|'[^']*'|[^"'<>])*>)[\s\S]*?<\/style\s*>/gi,'$1</style>');
    const tags=[...markup.matchAll(/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^"'<>])*)>/gi)].map(m=>({name:m[1].toLowerCase(),attrs:attributes(m[2])}));
    let baseUrl=documentUrl;
    const base=tags.find(tag=>tag.name==='base'&&tag.attrs.has('href'))?.attrs.get('href');
    if(base!==undefined){
      try{const resolved=new URL(base,documentUrl),pathname=path.posix.normalize(decodeURIComponent(resolved.pathname));if(resolved.origin!==origin||!pathname.startsWith(prefix))fail(file,'base',base,'base URL escapes deployed version prefix');else baseUrl=resolved.href;}
      catch{fail(file,'base',base,'invalid base URL');}
    }
    for(const tag of tags){
      for(const role of ['href','src','action','poster','data-root']){
        if(!tag.attrs.has(role)||(tag.name==='base'&&role==='href'))continue;
        const target=reference(file,tag.attrs.get(role),role,baseUrl);
        if(target&&tag.name==='link'&&role==='href'&&(/(?:^|\s)stylesheet(?:\s|$)/i.test(tag.attrs.get('rel')||'')||tag.attrs.get('as')==='style'))cssQueue.push(target);
      }
      if(tag.name==='meta'&&(tag.attrs.get('http-equiv')||'').toLowerCase()==='refresh'){
        const value=(tag.attrs.get('content')||'').match(/(?:^|;)\s*url\s*=\s*(.*?)\s*$/i)?.[1];
        if(value!==undefined)reference(file,value.replace(/^(['"])([\s\S]*)\1$/,'$2'),'refresh',baseUrl);
      }
      if(tag.attrs.has('style'))cssReferences(file,tag.attrs.get('style'),baseUrl);
    }
    for(const match of structure.matchAll(/<style\b(?:"[^"]*"|'[^']*'|[^"'<>])*>([\s\S]*?)<\/style\s*>/gi))cssReferences(file,match[1],baseUrl);
  }
  while(cssQueue.length){
    const file=cssQueue.shift();if(seenCss.has(file))continue;seenCss.add(file);
    cssReferences(file,await fs.readFile(inside(directory,file),'utf8'),origin+prefix+file);
  }
  return {status:failures.length?'blocked':'passed',artifactHash:digest(files),htmlCount,referencedCssCount:seenCss.size,references,failures,limits:'Literal HTML href/src/action/poster/data-root/refresh and reachable CSS references only. Srcset, runtime scripts, remote uptime, visuals and interactions are outside this static check.'};
}

export async function requirePortableDelivery(directory,inventory){
  const report=await inspectPortableDelivery(directory,inventory);
  if(report.failures.length){
    const sample=report.failures.slice(0,5).map(item=>`${item.file} ${item.role}=${item.value} (${item.reason})`).join('; ');
    throw Object.assign(Error('成品无法在中央版本目录中完整打开；请从源码修复并重新构建当前版本。未改动成品、未上传。 '+sample),{code:'NON_PORTABLE_ARTIFACT',report});
  }
  return report;
}
