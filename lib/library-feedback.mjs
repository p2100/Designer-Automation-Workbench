import {experiencePage} from './site-rules.mjs';

// Raw statements remain unclassified facts until separately verified.
export function libraryFeedbackEntries(record,recordId) {
  return record.items.flatMap((item,index)=>item.pages?.length?[{
    summary:item.summary,cause:'Pending investigation; preserve actual feedback',
    prevention:'Pending verified correction; do not treat raw feedback as a rule',
    actor:record.actor,classification:'unclassified',
    scope:{site:record.projectId,pages:item.pages.map(page=>experiencePage(record.siteType,page)),...(item.component?{component:item.component}:{})},
    evidence:[{candidate:record.candidate,feedback:item.quote,originalFeedback:record.text,feedbackRecord:recordId,item:index,baseBuild:record.baseBuild}],
    verification:{retested:false,designerApproved:false}
  }]:[]);
}
