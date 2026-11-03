import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import lex from 'pug-lexer';
import parse from 'pug-parser';

export const gitSourceProtocol='pug-git-source-v1';
export const buildCommands=['getData','compileFn','buildFn','buildStatic'];
export const sourceOutputs=new Set(['.git','node_modules','jsonData','sites','staticSites','pagesPugFn','api_cache','evidence']);
export const sha256=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export const sourceAllowed=file=>!file.split('/').some(part=>/^(?:\.git|\.env(?:\..*)?|\.dev\.vars(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.aws|\.ssh|node_modules|\.designer-data|\.codex|\.DS_Store)$/.test(part))&&!/\.(?:pem|key|sqlite\d?|db)$/i.test(file);
export function sourcePath(value){
  if(typeof value!=='string'||!value||value.includes('\\')||value.startsWith('/')||/^[a-z]:/i.test(value)||/[\x00-\x1f]/.test(value)||value.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid source path');
  return value;
}
export const canonicalRepository=value=>value.replace(/^git@github\.com:/,'https://github.com/').replace(/\.git$/,'').toLowerCase();
export function githubRepository(value){
  if(typeof value!=='string'||! /^(?:git@github\.com:|https:\/\/github\.com\/)[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]+(?:\.git)?$/i.test(value))throw Error('Use an exact credential-free GitHub repository');
  return canonicalRepository(value).replace('https://github.com/','');
}
export async function sourceSnapshot(root){
  const rows=[];
  async function visit(prefix=''){
    for(const entry of await fs.readdir(path.join(root,prefix),{withFileTypes:true})){
      const file=prefix?prefix+'/'+entry.name:entry.name;
      if(!sourceAllowed(file)||!prefix&&sourceOutputs.has(entry.name))continue;
      sourcePath(file);
      if(entry.isSymbolicLink())throw Error('Source symlinks are not supported: '+file);
      if(entry.isDirectory())await visit(file);
      else if(entry.isFile()){const bytes=await fs.readFile(path.join(root,file));rows.push({file,bytes:bytes.length,sha256:sha256(bytes)});}
      else throw Error('Unsupported source entry: '+file);
    }
  }
  await visit();rows.sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0);
  return {sha256:sha256(rows),files:rows};
}
function walk(node,visit){if(!node||typeof node!=='object')return;visit(node);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(item=>walk(item,visit));else if(value&&typeof value==='object')walk(value,visit);}
export async function inspectPugSource(root,context){
  const source=await sourceSnapshot(root),files=new Set(source.files.map(x=>x.file));
  const json=async name=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
  const contract=await json('docs/site-git-source.json'),pkg=await json('package.json'),baseline=context.template;
  if(contract.format!=='site-template-pug'||contract.projectId!==context.projectId)throw Error('Pug contract targets a different site or format');
  if(!baseline||sha256(await fs.readFile(path.join(root,'index.js')))!==baseline.indexHash||pkg.dependencies?.['pug-site-core']!==baseline.core)throw Error('Use the exact site-template entry and pug-site-core range');
  for(const command of buildCommands)if(pkg.scripts?.[command]!==baseline.scripts[command]||pkg.scripts?.['pre'+command]||pkg.scripts?.['post'+command])throw Error('The actual template build commands must remain unchanged');
  if(['preinstall','install','postinstall','prepare'].some(name=>pkg.scripts?.[name]))throw Error('Extra dependency lifecycle scripts are not allowed');
  if(contract.templateCommit!==baseline.commit)throw Error('Pug template provenance does not match the selected baseline');
  if(!/^[a-z][a-z0-9_-]*$/i.test(contract.defaultLanguage||'')||contract.home!==contract.defaultLanguage+'/index.html')throw Error('Declare the real language-prefixed home page');
  for(const value of [contract.staticOutput,contract.dataSource,contract.clientDataSource])sourcePath(value);
  if(contract.staticOutput!=='staticSites'||contract.dataSource!==contract.clientDataSource||!files.has(contract.dataSource))throw Error('SSR and browser must share the same actual data source');
  const expected=[...context.routes].sort(),routes=contract.routes;
  if(!Array.isArray(routes)||routes.length!==expected.length||JSON.stringify(routes.map(x=>x.original).sort())!==JSON.stringify(expected)||new Set(routes.map(x=>x.output)).size!==routes.length)throw Error('Every original route needs exactly one real Pug output');
  for(const row of routes){
    sourcePath(row.original);sourcePath(row.output);sourcePath(row.template);
    if(!row.output.endsWith('.html')||!row.template.startsWith('template/pages/')||!row.template.endsWith('.pug')||!files.has(row.template))throw Error('Route must point to an actual Pug page and HTML output');
  }
  if(!routes.some(row=>row.output===contract.home))throw Error('Home page is absent from the route map');
  const pugs=source.files.filter(row=>row.file.endsWith('.pug'));
  if(!pugs.some(row=>row.file.startsWith('template/common/'))||!pugs.some(row=>row.file.startsWith('template/components/')))throw Error('Real common layouts and reusable components are required');
  let composition=false,components=false;
  for(const row of pugs){
    const text=await fs.readFile(path.join(root,row.file),'utf8'),ast=parse(lex(text,{filename:row.file}),{filename:row.file});
    walk(ast,node=>{
      if(node.type==='Text'&&/^\s*<\/?[a-z!]/i.test(node.val||'')||node.type==='Include'&&/\.html?$/i.test(node.file?.path||''))throw Error('Raw HTML cannot be wrapped or renamed as Pug: '+row.file);
      if(node.type==='Code'&&node.buffer&&node.mustEscape===false&&!/^(?:data\.)?(?:clientPayloadJson|publicPayloadJson)$/.test(node.val||''))throw Error('Whole-page unescaped HTML output is not allowed');
      if(['Extends','Include','Mixin'].includes(node.type))composition=true;
      if(node.type==='Include'&&/(?:^|\/)components\//.test(node.file?.path||'')||node.type==='Mixin'&&node.call)components=true;
    });
  }
  if(!composition||!components)throw Error('Pug pages must actually use shared layouts and components');
  if(source.files.some(row=>row.file.endsWith('.html')&&!row.file.startsWith('docs/'))||source.files.some(row=>/(?:^|\/)offline\.js$/.test(row.file)))throw Error('HTML exports and old offline runtimes are not editable Pug source');
  const adapter=await fs.readFile(path.join(root,'getData.js'),'utf8');
  if(/new\.sp\.com|gen_router_xxx|["']detail_["']/.test(adapter))throw Error('Replace template demo data with actual site data');
  return {source,contract};
}
