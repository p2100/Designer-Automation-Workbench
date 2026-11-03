import path from 'node:path';
import {defaultData} from '../lib/workbench.mjs';
import {prepareGitSource,verifyGitSource,publishGitSource,gitSourceStatus,repositoryFor,captureGitSource} from '../lib/git-source.mjs';

export async function gitSource(args){
  const [action,...rest]=args,options={};
  if(!action||['help','--help'].includes(action))return {commands:{prepare:'prepare --url PREVIEW_URL [--project ID] [--id PLAN] [--template EXACT_TEMPLATE] [--repository-ready true]',status:'status --id PLAN | --url PREVIEW_URL',repository:'repository --url PREVIEW_URL',verify:'verify --id PLAN',capture:'capture --id PLAN (update preview without committing)',publish:'publish --id PLAN',register:'register --id PLAN'},note:'Read core/git-source.md. Actual Pug conversion and browser checks are performed by the Agent. Missing repositories default to private. Commit once with a real Penny task, then publish; no Harness or domain deployment.'};
  for(let i=0;i<rest.length;i+=2){if(!rest[i].startsWith('--')||rest[i+1]===undefined)throw Error('Expected --key value');options[rest[i].slice(2)]=rest[i+1];}
  const input={...options,data:path.resolve(options.data||defaultData)};
  if(action==='repository')return repositoryFor(await gitSourceStatus(input));
  const operation={prepare:prepareGitSource,status:gitSourceStatus,verify:verifyGitSource,capture:captureGitSource,publish:publishGitSource,register:options=>publishGitSource({...options,push:false})}[action];
  if(!operation)throw Error('Unknown Git-source operation');return operation(input);
}
