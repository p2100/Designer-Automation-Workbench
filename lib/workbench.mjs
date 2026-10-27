import {durableJSON} from './durable-json.mjs';
import {stageFeedback} from './experience-task.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateLessonSpecs} from './experience-case.mjs';
import {root, digest, readJSON, writeJSON, exists, inside, safeId, requireText, snapshot, changedFiles, glob, command, locked, ignoredSourceEntry} from './io.mjs';
import {checkPackage} from '../bin/common.mjs';
import {context} from '../bin/knowledge.mjs';
import {maintenanceContext,ruleChecks} from './site-rules.mjs';
import {inspectSource} from '../bin/intake.mjs';
import {creativePoints,searchCreative} from './creative-memory.mjs';

export const defaultData = path.join(root, '.designer-data');
export const taskDirectory = (data, id) => path.join(data, 'tasks', safeId(id));
export const loadTask = (data, id) => readJSON(path.join(taskDirectory(data, id), 'task.json'));
const save = (data, task) => durableJSON(path.join(taskDirectory(data, task.id), 'task.json'), task);
const event = (task, type, details = {}) => ({...task, events: [...task.events, {type, at: new Date().toISOString(), ...details}]});
const mutate = (data, id, operation) => locked(taskDirectory(data, id), async () => operation(await loadTask(data, id)));
const matchesAny = (patterns, file) => patterns.some(pattern => glob(pattern, file));

export function validateConfig(config) {
  if (config.version !== 1 || !Array.isArray(config.pages) || !config.pages.length) throw Error('Config needs version 1 and actual pages');
  requireText(config.request, 'Original request');
  if(config.siteType&&!['coupon','app','games'].includes(config.siteType))throw Error('Unknown site type');
  if (!Array.isArray(config.allowedPaths) || !config.allowedPaths.length) throw Error('Declare authorized source paths');
  for (const pattern of config.allowedPaths) inside('/scope', pattern);
  if (config.artifactRoot !== '.') inside('/artifact', config.artifactRoot);
  const routes = new Set();
  for (const page of config.pages) {
    safeId(page.id); requireText(page.family, 'Page family');
    if (!page.route?.startsWith('/') || page.route.includes('?') || page.route.includes('#')) throw Error('Page route must be an explicit local path');
    inside('/routes', page.route.slice(1));
    if (routes.has(page.route)) throw Error('Duplicate route'); routes.add(page.route);
    if (!Array.isArray(page.dependsOn) || !page.dependsOn.length) throw Error('Declare actual source dependencies per page');
    for (const pattern of page.dependsOn) inside('/dependencies', pattern);
    for (const interaction of page.interactions || []) {
      safeId(interaction.id);
      if (!interaction.actions?.length || !interaction.expected?.length) throw Error('Interaction needs actual actions and expectations');
    }
  }
  for (const width of [...(config.widths || [320,393,1440]), ...(config.breakpoints || [])]) if (!Number.isInteger(width) || width < 240 || width > 3840) throw Error('Invalid viewport width');
  for (const argv of Object.values(config.commands || {})) if (!Array.isArray(argv) || !argv.length || argv.some(s => typeof s !== 'string')) throw Error('Commands must be argv arrays');
  return config;
}

export function checksFor(config) {
  const widths = new Set(config.widths || [320,393,1440]);
  for (const point of config.breakpoints || []) for (const width of [point-1,point,point+1]) if (width >= 240) widths.add(width);
  return config.pages.flatMap(page => [...widths].sort((a,b) => a-b).flatMap(width => [
    {id: page.id + '/' + width + '/layout', kind: 'layout', page: page.id, route: page.route, width, state: 'initial', dependsOn: page.dependsOn},
    {id: page.id + '/' + width + '/visual', kind: 'visual', page: page.id, route: page.route, width, state: 'initial', dependsOn: page.dependsOn,
      criteria: page.visualCriteria || ['purposeAndHierarchy','capacityAndSpacing','alignmentAndBalance','brandAndColor','responsiveComposition']},
    ...(page.interactions || []).map(interaction => ({...interaction, id: page.id + '/' + width + '/interaction-' + interaction.id, kind: 'interaction', page: page.id, route: page.route, width, state: interaction.id, dependsOn: page.dependsOn}))
  ]));
}

async function pinRules(data) {
  const checked = await checkPackage(root), directory = path.join(data, 'rules', checked.manifestHash);
  if (!await exists(path.join(directory, 'manifest.json'))) {
    const manifest = await readJSON(path.join(root, 'manifest.json'));
    for (const file of [...manifest.files, {path: 'manifest.json'}]) {
      const destination = inside(directory, file.path); await fs.mkdir(path.dirname(destination), {recursive: true});
      await fs.copyFile(inside(root, file.path), destination);
    }
  }
  if ((await checkPackage(directory)).manifestHash !== checked.manifestHash) throw Error('Pinned rule package changed');
  return {...checked, directory};
}

function validateRepository(repo) {
  requireText(repo, 'Repository');
  if (path.isAbsolute(repo)) return;
  if (/^[\w.-]+@[\w.-]+:[\w./-]+$/.test(repo)) return;
  const url = new URL(repo);
  if (!['https:', 'ssh:'].includes(url.protocol) || url.password || (url.username && url.protocol === 'https:') || url.search || url.hash) throw Error('Use a credential-free HTTPS/SSH repository URL or local repository path');
}

async function localSiteIdentity(data, source) {
  return locked(path.join(data,'local-identity'),async()=>{
    const file=path.join(data,'local-identity.json');
    if(!await exists(file))await writeJSON(file,{salt:randomUUID()});
    const {salt}=await readJSON(file);
    if(typeof salt!=='string'||!salt)throw Error('Local identity is invalid; preserve it and diagnose');
    return 'local:'+digest({salt,source});
  });
}

function containsPath(parent, child) {
  const relative=path.relative(parent,child);
  return relative==='' || (!path.isAbsolute(relative) && relative!=='..' && !relative.startsWith('..'+path.sep));
}

async function canonicalFuturePath(input) {
  let current=path.resolve(input),suffix=[];
  for(;;){
    try{return path.resolve(await fs.realpath(current),...suffix);}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      const parent=path.dirname(current);
      if(parent===current)throw error;
      suffix.unshift(path.basename(current));current=parent;
    }
  }
}

export async function checkoutRepository({data = defaultData,id,repo,ref,localSource}) {
  safeId(id);
  if(Boolean(repo)===Boolean(localSource))throw Error('Provide exactly one Git repository or local source directory');
  if(repo)validateRepository(repo);
  if(localSource && ref)throw Error('A local source snapshot cannot use a Git ref');
  const inputSource=localSource ? path.resolve(localSource) : null;
  if(inputSource){
    const original=await canonicalFuturePath(inputSource), dataRoot=await canonicalFuturePath(data);
    if(containsPath(original,dataRoot)||containsPath(path.join(dataRoot,'workspaces'),original))throw Error('Local source and workbench workspaces must not contain one another');
  }
  if (ref && (ref.startsWith('-') || /[\s~^:?*\[\\]/.test(ref))) throw Error('Use an explicit branch/tag name');
  const recordFile = path.join(data,'checkouts',id+'.json');
  return locked(path.join(data,'checkouts',id),async () => {
    if (await exists(recordFile)) {
      const record = await readJSON(recordFile);
      if (localSource ? record.kind!=='local' || record.inputSource!==inputSource : record.kind==='local' || record.repo!==repo || record.ref!==(ref || null)) throw Error('Checkout identity differs; use another ID');
      if (!await exists(record.source)) throw Error('Registered checkout is missing');
      return {...record,reusedWorkspace:true};
    }
    const source = path.join(data,'workspaces',id);
    if (await exists(source)) throw Error('Unregistered workspace exists; preserve it and use a new ID');
    await fs.mkdir(path.dirname(source),{recursive:true});
    if(localSource){
      const original=await fs.realpath(inputSource), stat=await fs.stat(original);
      if(!stat.isDirectory())throw Error('Local source must be a directory');
      const workspaceParent=await fs.realpath(path.dirname(source));
      if(containsPath(original,workspaceParent)||containsPath(workspaceParent,original))throw Error('Local source and workbench workspaces must not contain one another');
      const before=await snapshot(original), snapshotHash=digest(before);
      const staging=await fs.mkdtemp(path.join(workspaceParent,'.'+id+'-import-'));
      try{
        await fs.cp(original,staging,{recursive:true,filter:async file=>{
          if(file===original)return true;
          if(ignoredSourceEntry(path.basename(file)))return false;
          if((await fs.lstat(file)).isSymbolicLink())throw Error('Symlinks require an explicit adapter: '+path.relative(original,file));
          return true;
        }});
        if(digest(await snapshot(original))!==snapshotHash||digest(await snapshot(staging))!==snapshotHash)throw Error('Local source changed during import; retry from a stable source');
        const identity=await localSiteIdentity(data,original);
        await fs.rename(staging,source);
        const record={id,kind:'local',inputSource,repo:identity,ref:null,source,revision:'local-snapshot:'+snapshotHash,snapshotHash};
        await writeJSON(recordFile,record);return record;
      }finally{await fs.rm(staging,{recursive:true,force:true});}
    }
    await command(['git','-c','core.hooksPath=/dev/null','clone','--no-hardlinks',...(ref ? ['--branch',ref] : []),'--',repo,source],data);
    const record = {id,repo,ref:ref || null,source,revision:(await command(['git','rev-parse','HEAD'],source)).output};
    await writeJSON(recordFile,record); return record;
  });
}

export async function openTask({data = defaultData, id, repo, ref, localSource, config, lessons = [], teamCreative = [], experienceMeta = {}}) {
  safeId(id); validateConfig(config);
  const checkout=await checkoutRepository({data,id,repo,ref,localSource}),detected=await inspectSource(checkout.source);
  if(config.siteType&&detected.classification==='declared-with-source-evidence'&&detected.siteType!==config.siteType)throw Error('Site type conflicts with actual source declaration');
  if(!config.siteType&&detected.siteType)config={...config,siteType:detected.siteType};
  if (ref && (ref.startsWith('-') || /[\s~^:?*\[\\]/.test(ref))) throw Error('Use an explicit branch/tag name');
  const directory = taskDirectory(data, id);
  return locked(directory, async () => {
    if (await exists(path.join(directory, 'task.json'))) {
      const current = await loadTask(data, id);
      if (current.repo !== checkout.repo || current.ref !== (ref || null) || digest(current.config) !== digest(config)) throw Error('Task identity or scope differs; create another task');
      if (!await exists(current.source)) throw Error('Task workspace is missing');
      return {...current, reusedWorkspace: true};
    }
    const rules = await pinRules(data), {source,revision} = checkout;
    if (checkout.kind==='local') {
      if(digest(await snapshot(source))!==checkout.snapshotHash)throw Error('Imported workspace changed before task registration');
    } else if ((await command(['git','status','--porcelain'],source)).output) throw Error('Initial checkout has local changes; preserve them and register another task');
    const initialSource = await snapshot(source, config.artifactRoot === '.' ? [] : [config.artifactRoot]);
    const contexts = [];
    for (const family of new Set(config.pages.map(page => page.family))) contexts.push(await maintenanceContext(rules.directory,{siteType:config.siteType||'coupon',page:family,gameType:config.gameType}));
    const baseChecks=checksFor(config);
    const creative = config.siteType ? await searchCreative(data,{siteType:config.siteType,pages:[...new Set(config.pages.map(p=>p.family))]}) : {references:[],issues:[],scope:'unknown-site-type'};
    creative.teamReferences=structuredClone(teamCreative);creative.teamSource=experienceMeta.source||'unknown';
    const task = {version: 1, workflow: 'audit-repair', id, repo:checkout.repo, sourceKind:checkout.kind||'git', ref: ref || null, revision, source, config, rules, contexts,
      checks: [...baseChecks,...ruleChecks(config,contexts,baseChecks)], lessons: structuredClone(lessons), lessonsHash: digest(lessons), creative, experienceMeta:structuredClone(experienceMeta), initialSource, candidates: [], results: {}, feedback: [],
      coverage: {confirmed: false, gaps: ['Agent must reconcile actual modules, business states and applicable rules before handoff']}, status: 'opened', events: []};
    await save(data, event(task, 'opened', {revision}));
    return task;
  });
}

async function installOnce(data, task) {
  if (!task.config.commands?.install) return;
  const inputs = {};
  for (const name of ['package.json','package-lock.json','pnpm-lock.yaml','yarn.lock']) if (await exists(path.join(task.source, name))) inputs[name] = digest(await fs.readFile(path.join(task.source, name)));
  const key = digest({inputs, argv: task.config.commands.install, node: process.version});
  const file = path.join(taskDirectory(data, task.id), 'install.json');
  if (await exists(file) && (await readJSON(file)).key === key && await exists(path.join(task.source, 'node_modules'))) return;
  await command(task.config.commands.install, task.source, {timeout: 300000});
  await writeJSON(file, {key});
}

export async function prepareCandidate(data, task) {
  await installOnce(data, task);
  const source = await snapshot(task.source, task.config.artifactRoot === '.' ? [] : [task.config.artifactRoot]);
  const outside = changedFiles(task.initialSource, source).filter(file => !matchesAny(task.config.allowedPaths, file));
  if (outside.length) throw Error('Source changes outside authorized paths: ' + outside.join(', '));
  const sourceHash = digest(source), buildKey = digest({sourceHash, commands: task.config.commands, node: process.version});
  const previous = task.candidates.at(-1);
  if (previous?.buildKey === buildKey) {
    const currentArtifacts = await snapshot(path.resolve(task.source, task.config.artifactRoot));
    if (digest(currentArtifacts) === previous.artifactHash) return {...task, reusedBuild: true};
  }
  if (task.config.commands?.build) {
    // Imported local directories can contain output from an older build. Clear
    // only the declared output in the isolated copy so stale routes cannot be
    // mistaken for products of this build; never touch the original source.
    if(task.sourceKind==='local' && task.config.artifactRoot!=='.')await fs.rm(inside(task.source,task.config.artifactRoot),{recursive:true,force:true});
    await command(task.config.commands.build, task.source, {timeout: 300000});
  }
  const afterBuildSource = await snapshot(task.source, task.config.artifactRoot === '.' ? [] : [task.config.artifactRoot]);
  if (digest(afterBuildSource) !== sourceHash) throw Error('Build changed source inputs; inspect changes and prepare again');
  const artifactRoot = path.resolve(task.source, task.config.artifactRoot), artifacts = await snapshot(artifactRoot);
  for (const page of task.config.pages) if (!artifacts[page.route.slice(1)] && !task.config.spa) throw Error('Route is absent from actual output: ' + page.route);
  const unlisted = Object.keys(artifacts).filter(file => file.endsWith('.html') && !task.config.pages.some(page => page.route === '/' + file));
  if (unlisted.length && !task.config.excludedRoutesReason && !task.config.spa) throw Error('Declare actual extra routes or scoped exclusion: ' + unlisted.join(', '));
  const hash = digest({source, artifacts, config: task.config, rules: task.rules.manifestHash, lessons: task.lessonsHash});
  const directory = path.join(taskDirectory(data, task.id), 'candidates', hash);
  if (!await exists(path.join(directory, 'candidate.json'))) {
    for (const file of Object.keys(artifacts)) { const dest = inside(path.join(directory, 'site'), file); await fs.mkdir(path.dirname(dest), {recursive: true}); await fs.copyFile(inside(artifactRoot, file), dest); }
    await writeJSON(path.join(directory, 'candidate.json'), {hash, source, artifacts});
  }
  const candidate = {hash, directory, source, artifacts, artifactHash: digest(artifacts), buildKey};
  const next = event({...task, candidates: [...task.candidates.filter(c => c.hash !== hash), candidate], status: 'candidate', approval: null}, 'candidate', {hash});
  await save(data, next); return next;
}
export const prepare = (data, id) => mutate(data, id, task => prepareCandidate(data, task));

export async function verifyCandidate(task) {
  if ((await checkPackage(task.rules.directory)).manifestHash !== task.rules.manifestHash) throw Error('Pinned rule package changed');
  const candidate = task.candidates.at(-1); if (!candidate) throw Error('Prepare a candidate first');
  if (digest(await snapshot(path.join(candidate.directory, 'site'))) !== candidate.artifactHash) throw Error('Frozen candidate changed');
  const source = await snapshot(task.source, task.config.artifactRoot === '.' ? [] : [task.config.artifactRoot]);
  if (digest(source) !== digest(candidate.source)) throw Error('Source changed since candidate; prepare a new candidate');
  return candidate;
}

export async function repair({data = defaultData, id, candidate: expectedCandidate, edits}) {
  return mutate(data, id, async task => {
    const candidate = await verifyCandidate(task);
    if (candidate.hash !== expectedCandidate) throw Error('Repair targets a stale candidate');
    if (!Array.isArray(edits) || !edits.length) throw Error('Repair needs exact edits');
    const files = new Map();
    for (const edit of edits) {
      if (!matchesAny(task.config.allowedPaths, edit.file)) throw Error('Repair outside authorized paths: ' + edit.file);
      const file = inside(task.source, edit.file), original = await fs.readFile(file, 'utf8');
      if (edit.expectedHash !== digest(original)) throw Error('Repair input hash changed: ' + edit.file);
      const before = files.get(file)?.after ?? original;
      requireText(edit.find, 'Exact old text');
      if (before.split(edit.find).length !== 2 || typeof edit.replace !== 'string') throw Error('Repair must match exactly once: ' + edit.file);
      files.set(file, {before: original, after: before.replace(edit.find, edit.replace)});
    }
    const written = [];
    try { for (const [file, value] of files) { await fs.writeFile(file, value.after); written.push(file); } }
    catch (error) { for (const file of written) await fs.writeFile(file, files.get(file).before); throw error; }
    const next = event({...task, status: 'repairing', approval: null}, 'repair', {files: edits.map(e => e.file), from: candidate.hash});
    await save(data, next);
    return prepareCandidate(data, next);
  });
}

export async function confirmCoverage({data = defaultData, id, actor, notes, gaps = []}) {
  return mutate(data, id, async task => {
    await verifyCandidate(task); requireText(actor, 'Coverage actor'); requireText(notes, 'Actual inventory and rule reconciliation');
    const next = event({...task, coverage: {confirmed: !gaps.length, actor, notes, gaps}}, 'coverage');
    await save(data, next); return next;
  });
}

export async function recordObservations({data = defaultData, id, candidate: expectedCandidate, observations}) {
  return mutate(data, id, async task => {
    const candidate = await verifyCandidate(task);
    if (candidate.hash !== expectedCandidate) throw Error('Observation targets a stale candidate');
    if (!Array.isArray(observations) || !observations.length || new Set(observations.map(o=>o.id)).size !== observations.length) throw Error('Observations need unique nonempty check IDs');
    const results = {...task.results};
    for (const observation of observations) {
      const check = task.checks.find(c => c.id === observation.id), current = results[observation.id];
      if (!check || check.kind !== 'visual' || current?.candidate !== candidate.hash || !current.evidence?.length) throw Error('Observe the actual captured visual check first');
      if (!['pass','fail','not-run'].includes(observation.status)) throw Error('Invalid observation status');
      if (!check.criteria.every(key => typeof observation.observations?.[key] === 'string' && observation.observations[key].trim())) throw Error('Record actual observations for all visual criteria');
      requireText(observation.actor, 'Actual observation actor');
      results[check.id] = {...current, status:observation.status,actor:observation.actor,observations:observation.observations,candidate: candidate.hash, kind: check.kind};
    }
    const next = event({...task, results, status: 'reviewing'}, 'observations', {checks: observations.map(o => o.id)});
    await save(data, next); return next;
  });
}

export async function feedback({data = defaultData, id, candidate: expectedCandidate, actor, text, decision = 'revise', checkIds, lessons, learningDecision, creativeObservations}) {
  return mutate(data, id, async task => {
    const candidate = await verifyCandidate(task);
    if (expectedCandidate !== candidate.hash) throw Error('Feedback targets a stale candidate');
    requireText(actor, 'Actual designer'); requireText(text, 'Designer feedback');
    if (!['revise','approve','note'].includes(decision)) throw Error('Invalid designer decision');
    if (decision === 'approve' && task.status !== 'awaiting-designer') throw Error('Complete checks and present this candidate before approval');
    const extracted = decision === 'approve' ? (lessons || (task.lessonDrafts || []).filter(d=>d.candidate === candidate.hash).map(d=>d.lesson)) : [];
    validateLessonSpecs(extracted);
    if(learningDecision?.action==='skip'){requireText(learningDecision.reason,'Concrete reason not to extract a reusable lesson');if(learningDecision.reason.trim().length<10||extracted.length)throw Error('Explain why this correction is not reusable, and omit fabricated lessons');}
    if (decision === 'approve' && (task.feedback.some(f=>f.decision === 'revise') || task.events.some(e=>e.type === 'repair')) && !extracted.length && learningDecision?.action!=='skip') throw Error('Agent must extract a verified reusable lesson or record a concrete skip reason; no additional designer confirmation is needed');
    const affected = checkIds || task.checks.map(c => c.id);
    if (!Array.isArray(affected) || !affected.length || new Set(affected).size !== affected.length) throw Error('Feedback needs a nonempty unique affected-check list');
    if (affected.some(id => !task.checks.some(c => c.id === id))) throw Error('Feedback references unknown checks');
    const affectedPages=[...new Set(task.checks.filter(c=>affected.includes(c.id)).map(c=>task.config.pages.find(p=>p.id===c.page)?.family).filter(Boolean))];
    const points=creativePoints(creativeObservations,{siteType:task.config.siteType,pages:affectedPages,text});
    if(decision==='note' && !points.length) throw Error('A note needs a specific positive creative observation');
    if(decision==='note' && points.some(p=>p.kind!=='positive-reference'))throw Error('Use revise for negative feedback that requires an adjustment');
    const entry = {id: 'feedback-' + (task.feedback.length + 1), actor, text, decision, candidate: candidate.hash, checkIds: affected, ...(points.length?{creativePoints:points}:{}), ...(decision === 'approve' ? {lessons:extracted,...(learningDecision?{learningDecision}:{})} : {}), at: new Date().toISOString()};
    const next = event({...task, feedback: [...task.feedback, entry], status: decision === 'note' ? task.status : decision === 'approve' ? 'approved' : 'needs-adjustment',
      invalidated: decision === 'note' ? task.invalidated : decision === 'revise' ? [...new Set([...(task.invalidated || []), ...affected])] : [],
      approval: decision === 'note' ? task.approval : decision === 'approve' ? {candidate: candidate.hash, actor, text, at: entry.at} : null}, 'feedback', {feedbackId: entry.id});
    const staged = decision==='note' ? next : stageFeedback(next);
    await save(data, staged); return staged;
  });
}

export async function handoff(data, id) {
  return mutate(data, id, async task => {
    const candidate = await verifyCandidate(task);
    if (task.invalidated?.length) throw Error('Designer feedback requires affected checks to be revisited');
    if (!task.coverage.confirmed || task.coverage.gaps.length) throw Error('Actual coverage and state reconciliation remain incomplete');
    for (const check of task.checks) {
      const result = task.results[check.id];
      if (result?.candidate !== candidate.hash || result.status !== 'pass') throw Error('Required check is failed, unexecuted or stale: ' + check.id);
      for (const evidence of result.evidence) if (digest(await fs.readFile(evidence.path)) !== evidence.hash) throw Error('Evidence changed: ' + check.id);
    }
    const next = event({...task, status: 'awaiting-designer', presented: candidate.hash}, 'handoff', {candidate: candidate.hash});
    await save(data, next); return next;
  });
}

export {save as saveTask, mutate as mutateTask, event as taskEvent};
