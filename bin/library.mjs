import path from 'node:path';
import {defaultData} from '../lib/workbench.mjs';
import {connectLibrary,pullLibrary,bindLibraryTask,prepareLibraryUpload,pushLibraryTask,libraryStatus,disconnectLibrary,recordLibraryFeedback} from '../lib/library-client.mjs';
import {readJSON} from '../lib/io.mjs';

export async function library(args){
  const [action,...rest]=args,options={};
  if(!action||['help','--help'].includes(action))return {commands:{connect:'connect --url LIBRARY_OR_PREVIEW_URL [--project PROJECT_ID]',pull:'pull --url URL --project PROJECT_ID [--output NEW_DIRECTORY]',bind:'bind --url URL --project PROJECT_ID --id TASK_ID',prepare:'prepare --url URL --project PROJECT_ID --id UPLOAD_ID --source SOURCE --artifacts BUILT_SITE --site-type TYPE',feedback:'feedback --id UPLOAD_ID --file ACTUAL_DESIGNER_FEEDBACK_JSON',push:'push --id TASK_OR_UPLOAD_ID [--file ACTUAL_HUMAN_CONFIRMATION_JSON]',status:'status --id TASK_ID',disconnect:'disconnect --id TASK_ID'},note:'首次询问是否上传当前版本并标记人工审核通过；确认后直接入库并可下载，不要求审核任务、coverage、handoff或重复页面检查。Agent记录真实确认，不要求设计师填JSON。'};
  for(let i=0;i<rest.length;i+=2){if(!rest[i].startsWith('--')||rest[i+1]===undefined)throw Error('Expected --key value');options[rest[i].slice(2)]=rest[i+1];}
  const input={...options,data:path.resolve(options.data||defaultData),clientName:options.name,siteType:options['site-type'],...(options.file?{[action==='feedback'?'feedback':'approval']:await readJSON(path.resolve(options.file))}:{})};
  const operation={connect:connectLibrary,pull:pullLibrary,bind:bindLibraryTask,prepare:prepareLibraryUpload,push:pushLibraryTask,feedback:recordLibraryFeedback,status:libraryStatus,disconnect:disconnectLibrary}[action];
  if(!operation)throw Error('Unknown library operation');return operation(input);
}
