#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {designerAutomation} from './designer-automation.mjs';

export {designerAutomation as siteflyDesignerAutomation};
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await designerAutomation(process.argv.slice(2)),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
