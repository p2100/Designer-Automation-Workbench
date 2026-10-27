import {experiencePage} from './site-rules.mjs';

// Candidate projections have actual source approval but are not formal rules.
// Retracted entries and unrelated page/type scopes must never enter a task.
export function selectTaskExperience(result, config) {
  if (!['coupon','app','games'].includes(config.siteType))
    throw Error('Determine the actual site type before retrieving experience');
  const pages = new Set(config.pages.map(page => experiencePage(config.siteType,page.family)));
  return (result.cases || []).filter(entry => {
    if (!entry.scope?.pages?.some(page => pages.has(page))) return false;
    const validType = page => config.siteType === 'coupon' ? !page.includes(':') && page !== '*' : page.startsWith(config.siteType+':');
    if (!entry.scope.pages.every(validType)) return false;
    if (entry.status === 'active') return true;
    return entry.status === 'candidate' && !entry.scope.site &&
      entry.classification !== 'site-preference' && entry.learning?.transferable === true &&
      entry.approval?.decision === 'approve';
  }).map(entry => ({...entry, experienceUse:entry.status === 'candidate' ? 'reference-only' : 'active'}));
}
