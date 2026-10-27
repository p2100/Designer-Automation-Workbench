import {learningGaps} from './experience-policy.mjs';

// Aggregate counts only; do not print feedback, people, sites or keys.
export function summarizeExperienceInventory(document) {
  if (!Array.isArray(document.cases) || !Array.isArray(document.lessons))
    throw Error('Inventory requires a full cases-and-lessons snapshot');
  const countBy = (items, classify) => items.reduce((result, item) => {
    const key = classify(item);
    result[key] = (result[key] || 0) + 1;
    return result;
  }, Object.create(null));
  const cases = document.cases, lessons = document.lessons;
  const keyCounts = new Map();
  for (const item of cases) if (item.learning?.key)
    keyCounts.set(item.learning.key, (keyCounts.get(item.learning.key) || 0) + 1);
  return {
    snapshotAt: document.createdAt,
    cases: cases.length,
    lessons: lessons.length,
    caseStatuses: countBy(cases, item => item.status || 'unknown'),
    lessonStatuses: countBy(lessons, item => item.status || 'unknown'),
    lessonScopes: countBy(lessons, item => item.scope?.site ? 'site' : 'global'),
    caseClassification: countBy(cases, item => item.classification || 'unknown'),
    casesWithoutExactConfirmation: cases.filter(item => !item.approval).length,
    casesWithLearningGaps: cases.filter(item => learningGaps(item).length > 0).length,
    repeatedCaseKeys: [...keyCounts.values()].filter(count => count > 1).length,
    note: 'Repeated keys require evidence and scope review; counts do not prove duplicates. Local unsent queues are excluded.',
  };
}
