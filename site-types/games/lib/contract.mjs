import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import ownerContract from '../core/owner-requirements.json' with {type:'json'};
import designerLearning from '../core/designer-learning.json' with {type:'json'};
export const selectDesignReferences = page => designerLearning.entries.filter(entry => entry.status === 'reference-only' && entry.pages.includes(page));
export const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
export const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
export const writeJson = async (file, data) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n'); };
export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.isAbsolute(value) || value.split('/').some((part) => !part || part === '..' || part === '.')) throw new Error('Unsafe relative path: ' + value);
  return value;
}
export async function inventory(root) {
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('Symlinks are not portable: ' + root);
  const records = [];
  async function visit(folder) {
    for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symlinks are not portable: ' + target);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) { const bytes = await fs.readFile(target); records.push({ path: path.relative(root, target).split(path.sep).join('/'), bytes: bytes.length, sha256: sha(bytes) }); }
      else throw new Error('Unsupported file: ' + target);
    }
  }
  await visit(root);
  return records;
}
export const digest = (files) => sha(JSON.stringify(files));
export async function assertNew(target) {
  try { await fs.lstat(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Output already exists: ' + target);
}
async function canonicalTarget(target) {
  const suffix = []; let current = path.resolve(target);
  for (;;) {
    try { return path.join(await fs.realpath(current), ...suffix); }
    catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(current); if (parent === current) throw error; suffix.unshift(path.basename(current)); current = parent; }
  }
}
async function assertOutside(root, target) {
  const canonicalRoot = await fs.realpath(root), canonicalOutput = await canonicalTarget(target);
  if (canonicalOutput === canonicalRoot || canonicalOutput.startsWith(canonicalRoot + path.sep)) throw new Error('Output must be outside the source package');
}
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
export function validateTask(task) {
  requireValue(task.version === 1, 'Task version must be 1');
  requireValue(typeof task.id === 'string' && /^[a-z0-9-]+$/.test(task.id), 'Task id required');
  requireValue(['web-play', 'store-referral'].includes(task.type), 'Unknown product type');
  requireValue(typeof task.audience === 'string' && task.audience.length >= 10, 'Audience and purpose required');
  requireValue(task.language === 'en', 'This package targets English sites');
  requireValue(typeof task.author === 'string' && task.author.trim(), 'Declared author required');
  for (const key of ['sources', 'samples', 'routes', 'modules', 'viewports', 'breakpoints', 'capabilities']) requireValue(Array.isArray(task[key]) && (key === 'breakpoints' || task[key].length), key + ' required');
  const samples = new Set(task.samples.map((sample) => sample.id));
  requireValue(samples.size === task.samples.length, 'Duplicate sample id');
  for (const source of task.sources) { const url = new URL(source.url); requireValue(url.protocol === 'https:', 'Source must use https'); requireValue(source.id && source.checkedAt, 'Source id and checkedAt required'); }
  const sources = new Set(task.sources.map((source) => source.id));
  for (const sample of task.samples) {
    requireValue(sample.title && sample.sourceIds?.length && sample.sourceIds.every((id) => sources.has(id)), 'Source-linked sample required');
    if (task.type === 'web-play') requireValue(sample.runtime && sample.inputClaims && sample.verificationStatus, 'Runtime, input claim and verification status required');
    else {
      requireValue(!sample.runtime && !sample.playUrl, 'Store referral cannot contain a play destination');
      requireValue(Array.isArray(sample.stores) && sample.stores.length, 'Official store destinations required');
      for (const store of sample.stores) {
        const url = new URL(store.url);
        requireValue(url.protocol === 'https:' && ((store.platform === 'ios' && url.hostname === 'apps.apple.com' && /\/id\d+$/.test(url.pathname)) || (store.platform === 'android' && url.hostname === 'play.google.com' && url.pathname === '/store/apps/details' && url.searchParams.get('id') === store.productId)), 'Invalid official store identity');
        if (store.platform === 'ios') requireValue(url.pathname.endsWith('/id' + store.productId), 'App Store product id mismatch');
        requireValue(store.region && store.checkedAt, 'Store region/date required');
      }
    }
  }
  const routes = new Set();
  for (const route of task.routes) { safeRelative(route.path); requireValue(!routes.has(route.path), 'Duplicate route'); routes.add(route.path); requireValue(['home', 'list', 'category', 'genres', 'detail', 'play', 'information', 'collection'].includes(route.page), 'Unknown page type'); if (task.type === 'store-referral') requireValue(route.page !== 'play', 'Store referral cannot have play pages'); }
  const modules = new Set();
  for (const module of task.modules) {
    requireValue(typeof module.id === 'string' && /^[a-z0-9-]+$/.test(module.id) && !modules.has(module.id), 'Unique module id required'); modules.add(module.id);
    requireValue(routes.has(module.route) && module.job && module.family, 'Module route/job/family required');
    requireValue(module.states?.length && module.samples?.length && module.samples.every((id) => samples.has(id)), 'Module samples/states required');
    requireValue(module.states.every((state) => typeof state === 'string' && /^[a-z0-9-]+$/.test(state)) && new Set(module.states).size === module.states.length, 'Unique state ids required');
  }
  requireValue(new Set(task.viewports.map((viewport) => viewport.id)).size === task.viewports.length, 'Duplicate viewport id');
  for (const viewport of task.viewports) requireValue(typeof viewport.id === 'string' && /^[a-z0-9-]+$/.test(viewport.id) && Number.isInteger(viewport.width) && viewport.width >= 280 && Number.isInteger(viewport.height) && viewport.height >= 280, 'Invalid viewport');
  for (const breakpoint of task.breakpoints) requireValue(Number.isInteger(breakpoint) && breakpoint >= 280, 'Invalid breakpoint');
  for (const capability of task.capabilities) requireValue(capability.name && ['available', 'unavailable', 'not-probed'].includes(capability.status), 'Capability status required');
  requireValue(task.delivery?.source === true && task.delivery?.evidence === true, 'Source and evidence delivery required');
  return task;
}
export function createPlan(task) {
  validateTask(task);
  const viewports = [...task.viewports];
  for (const width of task.breakpoints.flatMap((value) => [value - 1, value, value + 1])) if (!viewports.some((viewport) => viewport.width === width)) viewports.push({ id: 'bp-' + width, width, height: 900 });
  requireValue(new Set(viewports.map((viewport) => viewport.id)).size === viewports.length, 'Viewport id collides with a breakpoint id');
  const items = task.modules.flatMap((module) => viewports.flatMap((viewport) => module.states.map((state) => ({ id: [module.id, viewport.id, state].join(':'), module: module.id, route: module.route, family: module.family, samples: module.samples, viewport, state }))));
  for(const route of task.routes)for(const rule of ownerContract.rules.filter(rule=>(rule.pages.includes('*')||rule.pages.includes(route.page))&&(!rule.types||rule.types.includes(task.type))))for(const viewport of viewports)items.push({id:['owner',rule.id,route.path,viewport.id].join(':'),module:rule.id,route:route.path,family:'owner-games-contract',samples:task.modules.filter(module=>module.route===route.path).flatMap(module=>module.samples),viewport,state:'owner-contract',requirement:rule.requirement,when:rule.when||'always',level:rule.level||'required',source:rule.source||'core/owner-requirements.json'});
  const designReferences={version:designerLearning.version,source:'core/designer-learning.json',status:'reference-only',byRoute:task.routes.map(route=>({route:route.path,page:route.page,ids:selectDesignReferences(route.page).map(entry=>entry.id)}))};
  return { version: 1, taskId: task.id, type: task.type, ownerContract:ownerContract.version, designReferences, routes: task.routes, viewports, items, rule: 'Representative visual and owner-contract coverage plus exhaustive route/link/media checks; unavailable execution remains not-run. Design references are scoped aids, not additional owner-contract obligations or proof of acceptance.' };
}
export async function verifyPackage(root) {
  const manifest = await readJson(path.join(root, 'manifest.json'));
  requireValue(manifest.version === 1 && manifest.files.length > 0, 'Invalid package manifest');
  const actual = (await inventory(root)).filter((item) => item.path !== 'manifest.json');
  requireValue(digest(actual) === digest(manifest.files), 'Package files differ from public manifest');
  return manifest;
}
export async function initRun(packageRoot, taskFile, output) {
  await assertOutside(packageRoot, output);
  await verifyPackage(packageRoot); const task = validateTask(await readJson(taskFile)); await assertNew(output);
  await fs.mkdir(output, { recursive: true });
  await fs.cp(packageRoot, path.join(output, 'rules'), { recursive: true, errorOnExist: true });
  await writeJson(path.join(output, 'inputs/task.json'), task);
  const plan = createPlan(task); await writeJson(path.join(output, 'plan.json'), plan);
  await fs.mkdir(path.join(output, 'evidence'));
  await writeJson(path.join(output, 'run.json'), { version: 1, taskId: task.id, createdAt: new Date().toISOString(), taskSha256: sha(await fs.readFile(path.join(output, 'inputs/task.json'))), planSha256: sha(await fs.readFile(path.join(output, 'plan.json'))), rulesDigest: digest(await inventory(path.join(output, 'rules'))) });
  return plan;
}
export async function verifyInputs(run) {
  const record = await readJson(path.join(run, 'run.json'));
  requireValue(record.taskSha256 === sha(await fs.readFile(path.join(run, 'inputs/task.json'))), 'Frozen task changed');
  requireValue(record.planSha256 === sha(await fs.readFile(path.join(run, 'plan.json'))), 'Frozen plan changed');
  requireValue(record.rulesDigest === digest(await inventory(path.join(run, 'rules'))), 'Frozen rules changed');
  return record;
}
export async function freezeCandidate(candidate, run) {
  await assertOutside(candidate, run);
  await verifyInputs(run); await assertNew(path.join(run, 'candidate'));
  const files = await inventory(candidate); requireValue(files.length > 0, 'Empty candidate');
  await fs.cp(candidate, path.join(run, 'candidate'), { recursive: true, errorOnExist: true });
  const copied = await inventory(path.join(run, 'candidate')); requireValue(digest(files) === digest(copied), 'Candidate changed during copy');
  const record = { version: 1, frozenAt: new Date().toISOString(), candidateDigest: digest(copied), files: copied };
  await writeJson(path.join(run, 'candidate.json'), record); return record;
}
export async function verifyRun(run, options = { review: true }) {
  await verifyInputs(run); const record = await readJson(path.join(run, 'candidate.json'));
  requireValue(record.candidateDigest === digest(await inventory(path.join(run, 'candidate'))), 'Frozen candidate changed');
  if (options.review) {
    let receipt;
    try { receipt = await readJson(path.join(run, 'review-integrity.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (receipt) {
      requireValue(receipt.reviewSha256 === sha(JSON.stringify(receipt.reviewSnapshot)), 'Saved review changed');
      await validateReview(run, receipt.reviewSnapshot);
    }
  }
  return record;
}
export async function validateReview(run, review) {
  const candidate = await verifyRun(run, { review: false }), task = await readJson(path.join(run, 'inputs/task.json')), plan = await readJson(path.join(run, 'plan.json'));
  requireValue(review.candidateDigest === candidate.candidateDigest, 'Review belongs to another candidate');
  requireValue(typeof review.reviewer === 'string' && review.reviewer.trim() && review.reviewer.trim() !== task.author.trim() && review.role === 'independent-reviewer', 'Independent declared reviewer required');
  const expected = new Set([...plan.items.map((item) => item.id), 'exhaustive-routes', 'cross-site-distinction']);
  requireValue(Array.isArray(review.items) && review.items.length === expected.size, 'Incomplete review coverage');
  for (const item of review.items) {
    requireValue(expected.delete(item.id), 'Unexpected/duplicate review item');
    const expectedItem=plan.items.find(check=>check.id===item.id),conditionalAbsence=item.status==='not-applicable'&&expectedItem?.when&&expectedItem.when!=='always'&&typeof item.reason==='string'&&item.reason.trim();
    requireValue((item.status === 'pass'||conditionalAbsence) && typeof item.observation === 'string' && item.observation.trim() && item.evidence?.length, 'Unresolved/not-run review item: ' + item.id);
    for (const evidence of item.evidence) { safeRelative(evidence.path); requireValue(evidence.path.startsWith('evidence/'), 'Evidence must be in run/evidence'); const absolute = path.resolve(await fs.realpath(run), evidence.path); const stat = await fs.lstat(absolute); requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && await fs.realpath(absolute) === absolute, 'Missing or linked evidence'); requireValue(sha(await fs.readFile(absolute)) === evidence.sha256, 'Evidence hash mismatch'); }
  }
  requireValue(Array.isArray(review.issues), 'Issue list required');
  for (const issue of review.issues) requireValue(['P0','P1','P2','P3'].includes(issue.priority) && ['open','closed'].includes(issue.status) && typeof issue.description === 'string' && issue.description.trim(), 'Invalid review issue');
  requireValue(!review.issues.some((issue) => ['P0', 'P1', 'P2'].includes(issue.priority) && issue.status !== 'closed'), 'Unresolved review issues');
  return { status: 'record-integrity-checked', candidateDigest: candidate.candidateDigest, reviewer: review.reviewer, checkedAt: new Date().toISOString(), reviewSnapshot: structuredClone(review), reviewSha256: sha(JSON.stringify(review)), limitation: 'Does not certify factual honesty, aesthetics, real independence, physical device behavior or user acceptance.' };
}
export async function packPackage(root, output) {
  await assertOutside(root, output);
  const manifest = await verifyPackage(root); await assertNew(output); await fs.mkdir(output, { recursive: true });
  for (const item of [...manifest.files, { path: 'manifest.json' }]) { safeRelative(item.path); const target = path.join(output, item.path); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(path.join(root, item.path), target); }
  await verifyPackage(output); return manifest.files.length + 1;
}
