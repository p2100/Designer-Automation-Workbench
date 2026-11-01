import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {digest, snapshot} from '../lib/io.mjs';
import {createApplicationPlan, scopeApplicationPlan, recordApplications, verifyApplications} from '../lib/experience-application.mjs';

const key = (type, family = 'home') => type === 'coupon' ? family : type + ':' + family;
const lesson = (type, id = 'lesson-capacity', extra = {}) => ({id, revision: 2, status: 'active', summary: 'TEST preserve card content capacity',
  prevention: 'TEST check long and short card contents in the actual text track', scope: {pages: [key(type)], component: 'card'}, learning: {when: 'TEST narrow viewport', exceptions: []}, ...extra});
const creative = (type, id, extra = {}) => ({id, revision: 1, siteType: type, page: 'home', component: 'card', kind: 'avoid-reference',
  observation: 'TEST quiet card decoration', at: '2026-11-01T00:00:00.000Z', ...extra});

async function fixture(t, type = 'app') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'da-application-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const source = path.join(directory, 'source'); await fs.mkdir(source);
  const files = {'index.html': '<main>TEST first call page</main>', 'alternate.html': '<main>TEST second call page</main>', 'cards.css': '.card { min-width: 0 }'};
  for (const [file, content] of Object.entries(files)) await fs.writeFile(path.join(source, file), content);
  const sourceFiles = await snapshot(source), candidateHash = digest({TEST: type, sourceFiles});
  const candidateDirectory = path.join(directory, 'task', 'candidates', candidateHash);
  await fs.mkdir(path.join(candidateDirectory, 'site'), {recursive: true});
  for (const [file, content] of Object.entries(files)) await fs.writeFile(path.join(candidateDirectory, 'site', file), content);
  const evidenceDirectory = path.join(directory, 'task', 'evidence', candidateHash); await fs.mkdir(evidenceDirectory, {recursive: true});
  const evidenceFile = path.join(evidenceDirectory, 'TEST-observation.json');
  const bytes = JSON.stringify({TEST: 'protocol fixture only, not a visual acceptance'}); await fs.writeFile(evidenceFile, bytes);
  const config = {siteType: type, artifactRoot: '.', allowedPaths: ['*.html', '*.css'], pages: [
    {id: 'home-a', family: 'home', route: '/index.html', dependsOn: ['index.html', 'cards.css']},
    {id: 'home-b', family: 'home', route: '/alternate.html', dependsOn: ['alternate.html', 'cards.css']},
  ]};
  const checks = config.pages.map(page => ({id: page.id + '/393/layout', page: page.id, kind: 'layout', dependsOn: page.dependsOn}));
  const candidate = {hash: candidateHash, directory: candidateDirectory, source: sourceFiles, artifacts: sourceFiles, artifactHash: digest(sourceFiles)};
  const results = Object.fromEntries(checks.map(check => [check.id, {candidate: candidateHash, status: 'pass', evidence: [{path: evidenceFile, hash: digest(bytes)}]}]));
  const task = {source, config, checks, candidates: [candidate], results, invalidated: []};
  const plan = createApplicationPlan({siteType: type, pages: ['home'], lessons: [lesson(type)]});
  const entry = plan.entries[0];
  const decision = {referenceId: entry.referenceId, revision: entry.revision, contentHash: entry.contentHash, decision: 'adopted',
    reason: 'TEST card implementation binds both declared call pages', component: 'card', pages: ['home-a', 'home-b'], implementationPaths: ['cards.css'], checkIds: checks.map(check => check.id)};
  const record = decisions => recordApplications({plan, decisions, config, source: sourceFiles, candidate: candidateHash, checks});
  return {directory, task, candidate, plan, decision, record, evidenceFile};
}

test('all three types preserve every applicable lesson while limiting subjective references', () => {
  for (const type of ['coupon', 'app', 'games']) {
    const lessons = Array.from({length: 7}, (_, i) => lesson(type, 'lesson-' + i));
    const references = [creative(type, 'recent-unrelated'), creative(type, 'older-relevant', {observation: 'TEST title overflow and capacity', at: '2020-01-01T00:00:00.000Z'}), creative(type, 'omitted')];
    const wrong = type === 'app' ? 'games' : 'app';
    const plan = createApplicationPlan({siteType: type, pages: ['home'], request: 'title overflow capacity', limit: 1,
      lessons: [...lessons, lesson(wrong, 'wrong-type'), lesson(type, 'wrong-page', {scope: {pages: [key(type, 'detail')]}}), lesson(type, 'withdrawn', {status: 'retracted'})],
      creative: [...references, creative(wrong, 'wrong-creative'), creative(type, 'withdrawn-creative', {creativeState: 'retracted'})]});
    assert.equal(plan.entries.filter(entry => entry.kind === 'lesson').length, 7, type);
    assert.equal(plan.entries.filter(entry => entry.kind === 'creative').length, 1, type);
    assert.equal(plan.entries.at(-1).referenceId, 'older-relevant');
    assert.equal(plan.omittedCreative, 2); assert.equal(plan.totalCreative, 3);
    assert(plan.entries.every(entry => entry.contentHash.length === 64));
  }
});

test('approved transferable candidates remain reference-only and unconfirmed candidates are excluded', () => {
  const approved = lesson('games', 'candidate', {status: 'candidate', learning: {transferable: true}, approval: {decision: 'approve'}});
  const plan = createApplicationPlan({siteType: 'games', pages: ['home'], lessons: [approved, {...approved, id: 'unconfirmed', approval: undefined}]});
  assert.equal(plan.entries.length, 1); assert.equal(plan.entries[0].experienceUse, 'reference-only');
  assert.throws(() => createApplicationPlan({siteType: 'games', pages: ['home'], lessons: [lesson('games'), lesson('games', 'lesson-capacity', {prevention: 'Different text at same revision'})]}), /same experience ID and revision/);
  const local = createApplicationPlan({siteType: 'app', pages: ['home'], creative: [creative('app', undefined)]});
  assert.match(local.entries[0].referenceId, /^local-creative-/); assert.equal(local.entries[0].revision, 1);
});

test('local and team projections of the same creative statement merge without hiding actual content conflicts', () => {
  const common = creative('app', 'case-shared', {quote: 'TEST I like this arrangement', candidate: digest('TEST direction'), actor: 'TEST designer'});
  const local = {...common, source: 'generation', task: 'local-task', feedbackId: 'feedback-1'};
  const team = {...common, origin: 'generation', experienceUse: 'creative-reference'};
  const plan = createApplicationPlan({siteType: 'app', pages: ['home'], creative: [team, local]});
  assert.equal(plan.entries.length, 1); assert.equal(plan.totalCreative, 1); assert.equal(plan.entries[0].reference.origin, 'generation');
  assert.equal(plan.entries[0].reference.task, undefined);
  assert.equal(createApplicationPlan({siteType: 'app', pages: ['home'], creative: [local, team]}).hash, plan.hash);
  assert.throws(() => createApplicationPlan({siteType: 'app', pages: ['home'], creative: [team, {...local, observation: 'TEST actually different arrangement'}]}), /same experience ID and revision/);
  assert.throws(() => createApplicationPlan({siteType: 'app', pages: ['home'], creative: [team, {...local, quote: 'TEST a different actual statement'}]}), /same experience ID and revision/);
  assert.throws(() => createApplicationPlan({siteType: 'app', pages: ['home'], creative: [team, {...local, summary: 'TEST actually different summary'}]}), /same experience ID and revision/);
  assert.throws(() => createApplicationPlan({siteType: 'app', pages: ['home'], creative: [team, {...local, guidance: 'TEST actually different guidance'}]}), /same experience ID and revision/);
});

test('empty plans are explicit and malformed plans cannot be recorded', () => {
  const plan = createApplicationPlan({siteType: 'coupon', pages: ['home']}); assert.deepEqual(plan.entries, []);
  assert.throws(() => createApplicationPlan({siteType: 'unknown', pages: ['home']}), /actual site type/);
  assert.throws(() => createApplicationPlan({siteType: 'coupon', pages: ['home'], limit: -1}), /limit/);
  assert.throws(() => recordApplications({plan: {...plan, omittedCreative: 9}, decisions: []}), /plan changed/);
});

test('even an empty inherited plan cannot verify a task of a different site type', async () => {
  const plan = createApplicationPlan({siteType: 'coupon', pages: ['home']});
  assert.equal((await verifyApplications({plan, task: {config: {siteType: 'app'}}})).status, 'stale');
});

test('review scoping freezes a new hash, retains inactive obligations and never mutates the original plan', () => {
  const plan = createApplicationPlan({siteType: 'app', pages: [{id: 'home-a', family: 'home'}, {id: 'home-b', family: 'home'}, {id: 'detail', family: 'detail'}], lessons: [lesson('app'),
    lesson('app', 'detail-only', {scope: {pages: ['app:detail'], component: 'gallery'}}),
    lesson('app', 'shared', {scope: {pages: ['app:home', 'app:detail'], component: 'card'}})]});
  const before = structuredClone(plan), scoped = scopeApplicationPlan(plan, ['home', 'home']);
  assert.deepEqual(plan, before); assert.notEqual(scoped.hash, plan.hash); assert.equal(scoped.originalPlanHash, plan.hash);
  assert.deepEqual(scoped.pages, ['home']); assert.equal(scoped.entries.length, 2);
  assert(scoped.entries.every(entry => entry.pages.length === 1 && entry.pages[0] === 'home'));
  assert.deepEqual(scoped.scope.inactivePages, ['detail']); assert.equal(scoped.scope.inactiveReferences, 1);
  assert.deepEqual(scoped.scope.inactiveReferenceIds, ['detail-only']); assert.equal(scoped.scope.partiallyScopedReferences, 1);
  assert.throws(() => recordApplications({plan: {...scoped, pages: ['detail']}, decisions: []}), /plan changed/);
});

test('scoping rejects empty, unknown and cross-type page keys and cannot restore an excluded obligation', () => {
  const plan = createApplicationPlan({siteType: 'games', pages: ['home', 'detail'], lessons: [lesson('games')]});
  for (const pages of [[], ['unknown'], ['app:home'], ['games:home']]) assert.throws(() => scopeApplicationPlan(plan, pages), /page families|unknown or differently typed/);
  const scoped = scopeApplicationPlan(plan, ['home']);
  assert.throws(() => scopeApplicationPlan(scoped, ['detail']), /unknown or differently typed/);
  const repeated = scopeApplicationPlan(scoped, ['home']);
  assert.equal(repeated.originalPlanHash, plan.hash); assert.deepEqual(repeated.scope.originalPages, plan.pages);
  assert.deepEqual(repeated.scope.inactivePages, ['detail']); assert.equal(repeated.scope.kind, 'partial-page-families');
});

test('scoped adoption verifies only actual review pages and preserves full-plan coverage as inactive', async t => {
  const sample = await fixture(t);
  const full = createApplicationPlan({siteType: 'app', pages: ['home', 'detail'], lessons: [lesson('app'), lesson('app', 'detail-only', {scope: {pages: ['app:detail'], component: 'gallery'}})]});
  const plan = scopeApplicationPlan(full, ['home']), entry = plan.entries[0];
  sample.task.experienceApplications = recordApplications({plan, decisions: [{...sample.decision, referenceId: entry.referenceId, revision: entry.revision, contentHash: entry.contentHash}],
    config: sample.task.config, source: sample.candidate.source, candidate: sample.candidate.hash, checks: sample.task.checks});
  assert.equal((await verifyApplications({plan, task: sample.task})).status, 'verified');
  assert.equal(plan.scope.inactiveReferences, 1); assert.equal(plan.scope.kind, 'partial-page-families');
});

test('Coupon, App and Games adoption verifies real files and exact candidate evidence without claiming approval', async t => {
  for (const type of ['coupon', 'app', 'games']) {
    const {task, plan, decision, record} = await fixture(t, type);
    task.experienceApplications = record([decision]);
    const result = await verifyApplications({plan, task});
    assert.equal(result.status, 'verified', type); assert.equal(result.verified.length, 1);
    assert.equal(result.visualAcceptance, 'not-certified-by-application-evidence');
    assert.equal(task.approval, undefined);
  }
});

test('adoption cannot omit another route in the same component family or bind unrelated checks', async t => {
  const {decision, record} = await fixture(t);
  assert.throws(() => record([{...decision, pages: ['home-a'], checkIds: ['home-a/393/layout']}]), /all declared call pages/);
  assert.throws(() => record([{...decision, checkIds: ['home-a/393/layout']}]), /omit an applicable call page/);
  assert.throws(() => record([{...decision, checkIds: ['unknown/393/layout']}]), /unknown or unrelated check/);
  assert.throws(() => record([{...decision, implementationPaths: ['index.html']}]), /do not belong to the declared page/);
});

test('an adjustment verifies actual affected calls without claiming unreviewed same-family routes', async t => {
  const {task, plan, decision, candidate} = await fixture(t);
  task.adjustment = {pages: ['home-a'], checkIds: ['home-a/393/layout']};
  const config = {...task.config, pages: task.config.pages.filter(page => page.id === 'home-a')};
  const checks = task.checks.filter(check => task.adjustment.checkIds.includes(check.id));
  task.experienceApplications = recordApplications({plan, decisions: [{...decision, pages: ['home-a'], checkIds: ['home-a/393/layout']}], config,
    source: candidate.source, candidate: candidate.hash, checks});
  delete task.results['home-b/393/layout'];
  assert.equal((await verifyApplications({plan, task})).status, 'verified');
  task.adjustment = null;
  assert.equal((await verifyApplications({plan, task})).status, 'stale');
});

test('adoption rejects missing, unauthorized and unsafe source paths, stale revisions, duplicates and empty reasons', async t => {
  const {decision, record, task, plan, candidate} = await fixture(t);
  assert.throws(() => record([{...decision, implementationPaths: ['missing.css']}]), /absent from the candidate source/);
  assert.throws(() => record([{...decision, implementationPaths: ['../outside.css']}]), /Unsafe relative path/);
  assert.throws(() => record([{...decision, revision: 99}]), /stale experience/);
  assert.throws(() => record([{...decision, reason: 'ok'}]), /actual applicability/);
  assert.throws(() => record([decision, decision]), /Duplicate/);
  assert.throws(() => recordApplications({plan, decisions: [decision], config: {...task.config, allowedPaths: ['*.html']}, source: candidate.source, candidate: candidate.hash, checks: task.checks}), /outside authorized source/);
});

test('unresolved decisions and conflicts stay visible; applicability reasons do not create approval', async t => {
  const {task, plan, decision, record} = await fixture(t);
  task.experienceApplications = record([]);
  assert.equal((await verifyApplications({plan, task})).status, 'pending');
  task.experienceApplications = record([{...decision, decision: 'conflict', reason: 'TEST current requirement conflicts with the previous reference'}]);
  assert.equal((await verifyApplications({plan, task})).status, 'conflict');
  task.experienceApplications = record([{...decision, decision: 'not-applicable', reason: 'TEST actual component has no title track matching this reference'}]);
  assert.equal((await verifyApplications({plan, task})).status, 'verified'); assert.equal(task.approval, undefined);
});

test('missing, stale, failed or invalidated checks never verify adoption', async t => {
  for (const mutation of [
    task => { delete task.results['home-a/393/layout']; },
    task => { task.results['home-a/393/layout'].candidate = digest('old candidate'); },
    task => { task.results['home-a/393/layout'].status = 'fail'; },
    task => { task.invalidated = ['home-a/393/layout']; },
    task => { task.results['home-a/393/layout'].evidence = []; },
  ]) {
    const {task, plan, decision, record} = await fixture(t); task.experienceApplications = record([decision]); mutation(task);
    assert.equal((await verifyApplications({plan, task})).status, 'conflict');
  }
});

test('candidate changes, source changes and frozen output changes invalidate prior application records', async t => {
  for (const mutate of [
    async ({task}) => { task.candidates.at(-1).hash = digest('new candidate'); },
    async ({task}) => fs.appendFile(path.join(task.source, 'cards.css'), ' .card { color:red }'),
    async ({candidate}) => fs.appendFile(path.join(candidate.directory, 'site', 'cards.css'), ' .card { color:red }'),
  ]) {
    const sample = await fixture(t); sample.task.experienceApplications = sample.record([sample.decision]); await mutate(sample);
    assert.equal((await verifyApplications(sample)).status, 'stale');
  }
});

test('tampered evidence and external evidence paths cannot verify adoption', async t => {
  const first = await fixture(t); first.task.experienceApplications = first.record([first.decision]);
  await fs.appendFile(first.evidenceFile, 'tampered'); assert.equal((await verifyApplications(first)).status, 'conflict');
  const second = await fixture(t); second.task.experienceApplications = second.record([second.decision]);
  const outside = path.join(second.directory, 'outside.json'); await fs.writeFile(outside, 'TEST outside candidate evidence');
  second.task.results['home-a/393/layout'].evidence = [{path: outside, hash: digest(await fs.readFile(outside))}];
  assert.equal((await verifyApplications(second)).status, 'conflict');
});

test('experience content and implementation record fingerprints cannot be silently changed', async t => {
  const {task, plan, decision, record} = await fixture(t); task.experienceApplications = record([decision]);
  task.experienceApplications.decisions[0].implementationHashes['cards.css'] = digest('different');
  assert.equal((await verifyApplications({plan, task})).status, 'conflict');
  plan.entries[0].reference.prevention = 'Changed historical guidance';
  assert.equal((await verifyApplications({plan, task})).status, 'stale');
});
