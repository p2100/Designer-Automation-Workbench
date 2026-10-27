import path from 'node:path';
import {defaultData} from '../lib/workbench.mjs';
import {connectLibrary,pullLibrary,bindLibraryTask,pushLibraryTask,libraryStatus,disconnectLibrary} from '../lib/library-client.mjs';

export async function library(args){
  const [action,...rest]=args,options={};
  if(!action||['help','--help'].includes(action))return {commands:{connect:'connect --url LIBRARY_OR_PREVIEW_URL [--project PROJECT_ID]',pull:'pull --url URL --project PROJECT_ID [--output NEW_DIRECTORY]',bind:'bind --url URL --project PROJECT_ID --id TASK_ID',push:'push --id TASK_ID',status:'status --id TASK_ID',disconnect:'disconnect --id TASK_ID'},note:'Local Agent connects directly to the internal site library, with no Harness, login or browser pairing. Agent manages site identity and private connection records; upload creates a new pending-review library version.'};
  for(let i=0;i<rest.length;i+=2){if(!rest[i].startsWith('--')||rest[i+1]===undefined)throw Error('Expected --key value');options[rest[i].slice(2)]=rest[i+1];}
  const input={...options,data:path.resolve(options.data||defaultData),clientName:options.name};
  const operation={connect:connectLibrary,pull:pullLibrary,bind:bindLibraryTask,push:pushLibraryTask,status:libraryStatus,disconnect:disconnectLibrary}[action];
  if(!operation)throw Error('Unknown library operation');return operation(input);
}
