import fs from 'node:fs/promises';
import path from 'node:path';
import {digest, glob, inside, requireText, snapshot} from './io.mjs';
import {experienceMatchesSite, optionalExperienceSite} from './experience-site.mjs';

const siteTypes = ['coupon', 'app', 'games'];
const decisionsAllowed = ['adopted', 'not-applicable', 'conflict'];
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
const hash = value => digest(canonical(value));
const unique = values => [...new Set(values)];
const familyKey = (type, family) => type === 'coupon' ? family : type + ':' + family;
const familyFor = (type, key) => type === 'coupon' ? (!key.includes(':') && key !== '*' ? key : null)
  : key.startsWith(type + ':') ? key.slice(type.length + 1) : null;

function strings(values, label, {empty = false} = {}) {
  if (!Array.isArray(values) || (!empty && !values.length) || values.some(value => typeof value !== 'string' || !value.trim()) || unique(values).length !== values.length)
    throw Error(label + ' must be a unique list of actual identifiers');
  return [...values];
}

function pageFamilies(pages) {
  const families = pages.map(page => typeof page === 'string' ? page : page?.family);
  if (!families.length || families.some(family => typeof family !== 'string' || !family.trim())) throw Error('Application page families must name actual page families');
  return unique(families).sort();
}

function creativeContent(reference) {
  // Local evidence and the team API project the same case differently. Freeze
  // its actual statement and evidence identity, not transport-only metadata.
  return canonical({id: reference.id, revision: reference.revision ?? 0, siteType: reference.siteType, page: reference.page,
    component: reference.component, kind: reference.kind, quote: reference.quote, observation: reference.observation,
    summary: reference.summary || reference.observation || '', guidance: reference.prevention || reference.guidance || reference.observation || '',
    candidate: reference.candidate, actor: reference.actor, at: reference.at, origin: reference.origin || reference.source,
    visualSpec: reference.visualSpec, correction: reference.correction});
}

function referenceEntry(reference, kind, pages, siteType) {
  const scoped = kind === 'lesson' ? reference.scope.pages.map(page => familyFor(siteType, page)) : [reference.page];
  const applicable = unique(scoped.filter(page => pages.includes(page))).sort();
  if (!applicable.length) return null;
  const content = kind === 'creative' ? creativeContent(reference) : reference;
  const contentHash = hash(content);
  const referenceId = reference.id || (kind === 'creative' ? 'local-creative-' + contentHash : null);
  requireText(referenceId, 'Experience reference ID');
  const revision = reference.revision ?? 0;
  if (!Number.isInteger(revision) || revision < 0) throw Error('Experience reference revision must be a nonnegative integer');
  return {referenceId, revision, contentHash, kind, experienceUse: kind === 'creative' ? 'creative-reference' : reference.status === 'active' ? 'active' : 'reference-only',
    pages: applicable, component: reference.scope?.component || reference.component || null,
    summary: content.summary || content.observation || '', guidance: content.guidance || content.prevention || content.observation || '',
    when: reference.learning?.when || reference.visualSpec?.applicability || '', exceptions: reference.learning?.exceptions || [],
    reference: structuredClone(content)};
}

function newestReferences(entries) {
  const found = new Map();
  for (const entry of entries) {
    const key = entry.kind + ':' + entry.referenceId, previous = found.get(key);
    if (previous?.revision === entry.revision && previous.contentHash !== entry.contentHash)
      throw Error('The same experience ID and revision have different content');
    if (!previous || previous.revision < entry.revision) found.set(key, entry);
  }
  return [...found.values()];
}

function relevance(entry, request) {
  const text = (entry.component + ' ' + entry.summary + ' ' + entry.guidance + ' ' + entry.when).normalize('NFKC').toLowerCase();
  const terms = unique(request.normalize('NFKC').toLowerCase().match(/[a-z0-9][a-z0-9_-]+|[\u3400-\u9fff]{2,}/g) || []);
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function assertPlan(plan) {
  if (plan?.version !== 1 || !siteTypes.includes(plan.siteType) || !Array.isArray(plan.entries)) throw Error('Invalid experience application plan');
  const {hash: expected, ...body} = plan;
  if (!sha256(expected) || hash(body) !== expected) throw Error('Experience application plan changed');
  for (const entry of plan.entries) if (hash(entry.reference) !== entry.contentHash) throw Error('Frozen experience content changed');
  return plan;
}

/** Freeze applicable experience without treating subjective references as rules. */
export function createApplicationPlan({siteType, site, pages, lessons = [], creative = [], request = '', limit = 5}) {
  if (!siteTypes.includes(siteType)) throw Error('Determine the actual site type before planning experience applications');
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) throw Error('Creative reference limit must be between 0 and 100');
  if (!Array.isArray(pages) || !Array.isArray(lessons) || !Array.isArray(creative) || typeof request !== 'string') throw Error('Invalid experience application inputs');
  site = optionalExperienceSite(site);
  const families = pageFamilies(pages);
  const applicableLessons = lessons.filter(entry => experienceMatchesSite(entry, site) && entry.scope?.pages?.length && entry.scope.pages.every(page => typeof page === 'string' && familyFor(siteType, page)) &&
    (entry.status === 'active' || entry.status === 'candidate' && !entry.scope.site && entry.classification !== 'site-preference' && entry.learning?.transferable === true && entry.approval?.decision === 'approve'))
    .map(entry => referenceEntry(entry, 'lesson', families, siteType)).filter(Boolean);
  const applicableCreative = newestReferences(creative.filter(entry => entry.siteType === siteType && families.includes(entry.page) &&
    ['positive-reference', 'avoid-reference'].includes(entry.kind) && !entry.creativeState && !['retracted', 'conflict'].includes(entry.status))
    .map(entry => referenceEntry(entry, 'creative', families, siteType)));
  const ranked = applicableCreative.map(entry => ({entry, score: relevance(entry, request)})).sort((a, b) => b.score - a.score ||
    (b.entry.reference.at || '').localeCompare(a.entry.reference.at || '') || a.entry.referenceId.localeCompare(b.entry.referenceId));
  const selected = ranked.slice(0, limit).map(item => item.entry);
  const entries = [...newestReferences(applicableLessons).sort((a, b) => a.referenceId.localeCompare(b.referenceId)), ...selected];
  const body = {version: 1, siteType, ...(site === undefined ? {} : {site}), pages: families, entries, totalCreative: applicableCreative.length, omittedCreative: applicableCreative.length - selected.length,
    selection: {method: 'request-term-overlap-then-recency', limit}, limits: 'Application evidence verifies bindings and files; it does not certify aesthetics or human approval.'};
  return {...body, hash: hash(body)};
}

/** Select actual review families while retaining the original plan's scope. */
export function scopeApplicationPlan(plan, pages) {
  assertPlan(plan);
  if (!Array.isArray(pages)) throw Error('Application scope needs actual page families');
  const selected = pageFamilies(pages);
  if (selected.some(page => !plan.pages.includes(page))) throw Error('Application scope includes an unknown or differently typed page family');
  const entries = plan.entries.filter(entry => entry.pages.some(page => selected.includes(page)))
    .map(entry => ({...structuredClone(entry), pages: entry.pages.filter(page => selected.includes(page))}));
  const inactive = plan.entries.filter(entry => !entries.some(current => current.referenceId === entry.referenceId));
  const originalPages = plan.scope?.originalPages || plan.pages;
  const inactiveReferenceIds = unique([...(plan.scope?.inactiveReferenceIds || []), ...inactive.map(entry => entry.referenceId)]);
  const {hash: previousHash, ...body} = plan;
  const scoped = {...body, pages: selected, entries, originalPlanHash: plan.originalPlanHash || previousHash,
    scope: {kind: selected.length === originalPages.length ? 'declared-page-families' : 'partial-page-families', originalPages: [...originalPages],
      inactivePages: originalPages.filter(page => !selected.includes(page)), inactiveReferences: inactiveReferenceIds.length, inactiveReferenceIds,
      partiallyScopedReferences: entries.filter(entry => (entry.kind === 'lesson' ? entry.reference.scope.pages.map(page => familyFor(plan.siteType, page)) : [entry.reference.page])
        .filter(page => originalPages.includes(page)).length !== entry.pages.length).length}};
  return {...scoped, hash: hash(scoped)};
}

function checkSnapshot(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw Error('Actual candidate source snapshot is required');
  for (const [file, value] of Object.entries(source)) { inside('/source', file); if (!sha256(value)) throw Error('Invalid source snapshot hash'); }
}

function expectedPages(entry, config) {
  return config.pages.filter(page => entry.pages.includes(page.family));
}

function bindDecision(input, entry, config, source, checks) {
  if (input.revision !== entry.revision || input.contentHash !== entry.contentHash) throw Error('Application references a stale experience revision or content');
  if (!decisionsAllowed.includes(input.decision)) throw Error('Choose adopted, not-applicable or conflict for each experience');
  requireText(input.reason, 'Concrete application reason');
  if (input.reason.trim().length < 8) throw Error('Explain the actual applicability, implementation or conflict');
  const base = {referenceId: entry.referenceId, revision: entry.revision, contentHash: entry.contentHash, decision: input.decision, reason: input.reason};
  if (input.decision !== 'adopted') return base;
  requireText(input.component, 'Actual implemented component');
  const pages = strings(input.pages, 'Applied pages'), implementationPaths = strings(input.implementationPaths, 'Implementation paths'), checkIds = strings(input.checkIds, 'Application checks');
  const actualPages = expectedPages(entry, config);
  if (!actualPages.length || pages.length !== actualPages.length || pages.some(id => !actualPages.some(page => page.id === id)))
    throw Error('Adoption must cover all declared call pages for the applicable page families');
  for (const file of implementationPaths) {
    inside('/source', file);
    if (!Object.hasOwn(source, file)) throw Error('Implementation path is absent from the candidate source: ' + file);
    if (!config.allowedPaths?.some(pattern => glob(pattern, file))) throw Error('Implementation path is outside authorized source paths: ' + file);
  }
  const boundChecks = checkIds.map(id => checks.find(check => check.id === id));
  if (boundChecks.some(check => !check || !pages.includes(check.page))) throw Error('Application references an unknown or unrelated check');
  for (const page of actualPages) {
    if (!boundChecks.some(check => check.page === page.id)) throw Error('Application checks omit an applicable call page: ' + page.id);
    const dependencies = [...(page.dependsOn || []), ...(config.globalDependencies || [])];
    if (!implementationPaths.some(file => dependencies.some(pattern => glob(pattern, file)))) throw Error('Implementation paths do not belong to the declared page: ' + page.id);
  }
  return {...base, pages: [...pages].sort(), component: input.component, implementationPaths: [...implementationPaths].sort(),
    implementationHashes: Object.fromEntries([...implementationPaths].sort().map(file => [file, source[file]])), checkIds: [...checkIds].sort()};
}

/** Record Agent decisions; current browser checks are verified separately. */
export function recordApplications({plan, decisions, config, source, candidate, checks = []}) {
  assertPlan(plan); checkSnapshot(source);
  if (!sha256(candidate)) throw Error('Applications must bind to an actual candidate hash');
  if (config?.siteType !== plan.siteType || !Array.isArray(config.pages) || !Array.isArray(checks) || !Array.isArray(decisions)) throw Error('Application site type and actual page/check contracts are required');
  if (plan.site !== undefined && optionalExperienceSite(config.site) !== plan.site) throw Error('Application site identity does not match the frozen plan');
  const ids = decisions.map(decision => decision.referenceId);
  if (unique(ids).length !== ids.length) throw Error('Duplicate experience application decisions');
  const recorded = decisions.map(input => {
    const entry = plan.entries.find(item => item.referenceId === input.referenceId);
    if (!entry) throw Error('Application references experience outside the frozen plan');
    return bindDecision(input, entry, config, source, checks);
  });
  const pending = plan.entries.filter(entry => !ids.includes(entry.referenceId)).map(entry => entry.referenceId);
  return {version: 1, planHash: plan.hash, candidate, sourceHash: hash(source), decisions: recorded, pending,
    status: pending.length ? 'pending' : recorded.some(item => item.decision === 'conflict') ? 'conflict' : 'recorded'};
}

async function verifyEvidence(result, directory) {
  if (!result.evidence?.length) throw Error('The passing check has no actual evidence');
  const parent = await fs.realpath(directory);
  for (const evidence of result.evidence) {
    if (!sha256(evidence.hash) || typeof evidence.path !== 'string' || path.dirname(path.resolve(evidence.path)) !== path.resolve(directory)) throw Error('Evidence must belong to the exact candidate evidence directory');
    const stat = await fs.lstat(evidence.path);
    if (!stat.isFile() || stat.isSymbolicLink() || path.dirname(await fs.realpath(evidence.path)) !== parent) throw Error('Evidence is not an intact candidate file');
    if (digest(await fs.readFile(evidence.path)) !== evidence.hash) throw Error('Application evidence changed');
  }
}

/** Verify current candidate bindings and intact evidence, without granting approval. */
export async function verifyApplications({plan, task}) {
  const failures = [], verified = [], pending = [];
  const result = status => ({status, verified, pending, failures, visualAcceptance: 'not-certified-by-application-evidence'});
  try { assertPlan(plan); } catch (error) { failures.push(error.message); return result('stale'); }
  if (task.config?.siteType !== plan.siteType) { failures.push('Application plan belongs to a different site type'); return result('stale'); }
  if (plan.site !== undefined && optionalExperienceSite(task.config?.site) !== plan.site) { failures.push('Application plan belongs to a different site identity'); return result('stale'); }
  if (!plan.entries.length) return result('verified');
  const applications = task.experienceApplications, candidate = task.candidates?.at(-1);
  if (!applications) { pending.push(...plan.entries.map(entry => entry.referenceId)); return result('pending'); }
  if (!candidate || applications.planHash !== plan.hash || applications.candidate !== candidate.hash || applications.sourceHash !== hash(candidate.source)) {
    failures.push('Applications belong to a different plan, candidate or source snapshot'); return result('stale');
  }
  try {
    const excluded = task.config.artifactRoot === '.' ? [] : [task.config.artifactRoot];
    if (hash(await snapshot(task.source, excluded)) !== hash(candidate.source)) throw Error('Implementation source changed after the application candidate');
    if (hash(await snapshot(path.join(candidate.directory, 'site'))) !== hash(candidate.artifacts)) throw Error('Frozen candidate artifacts changed');
    const config = task.adjustment ? {...task.config, pages: task.config.pages.filter(page => task.adjustment.pages.includes(page.id))} : task.config;
    const checks = task.adjustment ? task.checks.filter(check => task.adjustment.checkIds.includes(check.id)) : task.checks;
    recordApplications({plan, decisions: applications.decisions, config, source: candidate.source, candidate: candidate.hash, checks});
  } catch (error) { failures.push(error.message); return result('stale'); }
  const directory = path.join(path.dirname(path.dirname(candidate.directory)), 'evidence', candidate.hash);
  for (const entry of plan.entries) {
    const applied = applications.decisions.find(item => item.referenceId === entry.referenceId);
    if (!applied) { pending.push(entry.referenceId); continue; }
    if (applied.decision === 'conflict') { failures.push(entry.referenceId + ': unresolved experience conflict'); continue; }
    if (applied.decision === 'not-applicable') { verified.push({referenceId: entry.referenceId, decision: applied.decision}); continue; }
    try {
      for (const file of applied.implementationPaths) if (applied.implementationHashes?.[file] !== candidate.source[file]) throw Error('Recorded implementation file hash changed: ' + file);
      for (const id of applied.checkIds) {
        const observed = task.results?.[id];
        if (observed?.candidate !== candidate.hash || observed.status !== 'pass' || task.invalidated?.includes(id)) throw Error('Application check is missing, stale, invalidated or not passed: ' + id);
        await verifyEvidence(observed, directory);
      }
      verified.push({referenceId: entry.referenceId, decision: applied.decision, checkIds: applied.checkIds});
    } catch (error) { failures.push(entry.referenceId + ': ' + error.message); }
  }
  return result(failures.length ? 'conflict' : pending.length ? 'pending' : 'verified');
}
