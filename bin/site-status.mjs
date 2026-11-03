import path from 'node:path';
import {defaultData} from '../lib/workbench.mjs';
import {showSiteStatus,updateSiteStatus,retrySiteStatus,listSiteClients} from '../lib/site-status.mjs';

export async function siteStatus(args){
  const [action,...rest]=args,options={};
  if(!action||['help','--help'].includes(action))return {commands:{show:'show --url PREVIEW_URL [--project ID]',clients:'clients --url PREVIEW_URL [--project ID] (observed IP, reported hostname/version and last use)',update:'update --url PREVIEW_URL --status development|online|offline --actor ACTUAL_PERSON --note ACTUAL_REPORT [--domain example.com] [--commit FULL_DEPLOYED_SHA] [--request status-REQUEST_ID]',retry:'retry --url PREVIEW_URL --request status-REQUEST_ID'},note:'Read core/site-status.md. Updates the central preview library metadata directly; no Harness, source upload, Git commit or domain deployment. Existing freezes remain.'};
  const allowed=['url','project','data','status','domain','actor','note','commit','request'];
  for(let i=0;i<rest.length;i+=2){const key=rest[i].slice(2);if(!rest[i].startsWith('--')||rest[i+1]===undefined||!allowed.includes(key)||Object.hasOwn(options,key))throw Error('Expected supported --key value');options[key]=rest[i+1];}
  const operation={show:showSiteStatus,update:updateSiteStatus,retry:retrySiteStatus,clients:listSiteClients}[action];
  if(!operation)throw Error('Unknown site-status operation');
  return operation({...options,data:path.resolve(options.data||defaultData)});
}
