import path from 'node:path';
import fs from 'node:fs/promises';
import {changedFiles, glob, inside, requireText} from './io.mjs';

export const reviewChecks = task => task.adjustment
  ? task.checks.filter(check => task.adjustment.checkIds.includes(check.id))
  : task.checks;

export const reviewCoverage = task => task.adjustment?.coverage || task.coverage;

export function reviewScope(task) {
  return task.adjustment ? {
    kind: 'adjustment', pages: task.adjustment.pages,
    component: task.adjustment.component, reason: task.adjustment.reason,
    changedFiles: task.adjustment.changedFiles,
    fullSiteAcceptance: 'not-performed-by-this-adjustment',
  } : {kind: 'acceptance', pages: task.config.pages.map(page => page.id)};
}

function pageIds(task, values = []) {
  return values.map(value => {
    const page = task.config.pages.find(item => item.id === value || item.route === value);
    if (!page) throw Error('Adjustment references an unknown page: ' + value);
    return page.id;
  });
}

// Local HTML/CSS/module references locate page-specific output without treating
// every stylesheet or image as a global dependency. Unknown inputs stay visible.
async function outputDependencies(candidate, page) {
  const found = new Set(), pending = [page.route.slice(1)];
  while (pending.length) {
    const file = pending.pop();
    if (found.has(file) || !candidate.artifacts[file]) continue;
    found.add(file);
    if (!/\.(?:html|css|[cm]?js)$/.test(file)) continue;
    const text = await fs.readFile(inside(path.join(candidate.directory, 'site'), file), 'utf8');
    const references = [...text.matchAll(/(?:\burl\(\s*["']?|@import\s+["']|\b(?:from|import)\s*["']|\bimport\(\s*["'])([^"'\s)>]+)/g)].map(match=>match[1]);
    if (file.endsWith('.html')) {
      // Navigation does not make the destination's styles/data a dependency of
      // the current page. Only resources actually embedded by the page count.
      for (const tag of text.matchAll(/<(script|img|iframe|source|video|audio|embed|input|track|link|image|use)\b[^>]*>/gi)) {
        const attribute = /^(link|image|use)$/i.test(tag[1]) ? 'href' : 'src';
        const value = tag[0].match(new RegExp('\\b'+attribute+'\\s*=\\s*["\']([^"\']+)','i'));
        if (value) references.push(value[1]);
        const srcset = tag[0].match(/\bsrcset\s*=\s*["']([^"']+)/i);
        if (srcset) references.push(...srcset[1].split(',').map(item=>item.trim().split(/\s+/)[0]));
      }
    }
    for (const value of references) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(value)) continue;
      const relative = value.split(/[?#]/)[0];
      const target = path.posix.normalize(relative.startsWith('/') ? relative.slice(1) : path.posix.join(path.posix.dirname(file), relative));
      if (!target.startsWith('../')) pending.push(target);
    }
  }
  return found;
}

export async function adjustmentPlan(task, before, scope = {}) {
  const candidate = task.candidates.at(-1);
  for (const key of ['pages','checkIds','ruleIds','layoutCheckIds'])
    if (scope[key] !== undefined && (!Array.isArray(scope[key]) || scope[key].some(value => typeof value !== 'string' || !value))) throw Error('Adjustment '+key+' must be an array of actual identifiers');
  const previous = task.adjustment;
  const unfinished = previous && previous.approvedCandidate !== before?.hash;
  const baseline = unfinished ? task.candidates.find(item => item.hash === previous.baseline) || before : before;
  const sourceChanges = changedFiles(baseline?.source || task.initialSource, candidate.source);
  const outputChanges = baseline ? changedFiles(baseline.artifacts, candidate.artifacts) : [];
  const knownChecks = new Map(task.checks.map(check => [check.id, check]));
  for (const id of scope.checkIds || []) if (!knownChecks.has(id)) throw Error('Adjustment references an unknown check: ' + id);
  const requested = [...pageIds(task, scope.pages), ...(scope.checkIds || []).map(id => knownChecks.get(id).page)];
  const declared = requested.length > 0;
  if (declared) {
    requireText(scope.reason, 'Explain the actual affected component and all its call sites');
    requireText(scope.component, 'Actual adjustment component');
  }
  const affected = new Set(requested), unknown = [], global = [];
  const dependencies = new Map();
  for (const page of task.config.pages) dependencies.set(page.id, await outputDependencies(candidate, page));
  for (const file of [...new Set([...sourceChanges, ...outputChanges])]) {
    if ((task.config.globalDependencies || []).some(pattern => glob(pattern, file))) {
      global.push(file);
      for (const page of task.config.pages) affected.add(page.id);
      continue;
    }
    const owners = task.config.pages.filter(page => page.dependsOn.some(pattern => glob(pattern, file)) || dependencies.get(page.id).has(file));
    if (declared) {
      if (owners.length && !owners.some(page=>affected.has(page.id))) unknown.push(file+' is used by '+owners.map(page=>page.id).join(', ')+', outside the declared scope');
      // A directly changed page cannot be omitted by a component declaration.
      for (const page of task.config.pages.filter(page=>page.route.slice(1)===file))
        if (!affected.has(page.id)) unknown.push('Changed page '+page.id+' is outside the declared scope');
      continue;
    }
    if (owners.length) for (const page of owners) affected.add(page.id);
    else unknown.push(file);
  }
  // Unfinished corrections remain in scope across successive draft previews.
  if (unfinished && previous.coverage.confirmed) for (const page of previous.pages) affected.add(page);
  for (const id of task.pendingAdjustment?.checkIds || []) affected.add(knownChecks.get(id).page);
  const gaps = [];
  if (!affected.size) gaps.push('Agent must locate the requested component and declare pages, component and reason; do not start a full-site audit.');
  if (unknown.length) gaps.push('Map the changed inputs to actual call sites: ' + unknown.join(', '));
  const explicitRules = new Set([...(scope.ruleIds || []), ...(scope.checkIds || []).map(id => knownChecks.get(id).ruleId).filter(Boolean)]);
  for (const ruleId of explicitRules) if (!task.checks.some(check => affected.has(check.page) && check.ruleId === ruleId)) throw Error('Unknown or out-of-scope adjustment rule: ' + ruleId);
  for (const id of scope.layoutCheckIds || []) if (!task.config.pages.some(page => affected.has(page.id) && page.layoutChecks?.some(check => check.id === id))) throw Error('Unknown adjustment layout check: ' + id);
  const checks = task.checks.filter(check => affected.has(check.page) && (!check.ruleId || explicitRules.has(check.ruleId)));
  return {
    candidate: candidate.hash, baseline: baseline?.hash || null,
    pages: [...affected], component: scope.component || previous?.component || 'changed page components',
    reason: scope.reason || 'Affected page dependencies inferred from the actual source and output changes',
    changedFiles: sourceChanges, outputChanges, globalChanges: global,
    ...(scope.layoutCheckIds ? {layoutCheckIds:scope.layoutCheckIds} : {}),
    checkIds: checks.map(check => check.id),
    coverage: {confirmed: declared && !gaps.length, notes: scope.reason || '', gaps},
  };
}
