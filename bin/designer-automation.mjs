#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {generate} from './generate.mjs';
import {workbench} from './workbench.mjs';
import {library} from './library.mjs';

export async function designerAutomation(args){
  if(!args.length||['help','--help'].includes(args[0]))return {
    generation:'generate start|status|direction|feedback|review',
    acceptance:'audit start (full rules and visual acceptance; default)',
    adjustment:'adjust --id ID --file adjustment.json → audit recheck → audit observe → audit handoff → audit feedback',
    maintenance:'audit inspect|checkout|open|start|cycle|adjust|recheck|feedback|handoff|status',
    library:'library connect|pull|bind|push|status',
    legacy:'Existing workbench actions remain available directly.',
    note:'Agent uses actual Image, source and browser capabilities; no generated page or visual approval is simulated.'};
  if(args[0]==='generate')return generate(args.slice(1));
  if(args[0]==='audit')return workbench(args.slice(1));
  if(args[0]==='library')return library(args.slice(1));
  return workbench(args);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await designerAutomation(process.argv.slice(2)),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
