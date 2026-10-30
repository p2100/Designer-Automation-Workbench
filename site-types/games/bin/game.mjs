#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, verifyPackage, validateTask, createPlan, selectDesignReferences, initRun, freezeCandidate, verifyRun, validateReview, packPackage } from '../lib/contract.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22+ required');
const [command, ...args] = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf('--' + flag); if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Missing --' + flag); return args[index + 1]; };
try {
  let result;
  if (command === 'check') result = { status: 'ok', files: (await verifyPackage(root)).files.length };
  else if (command === 'context') {
    const type = value('type'), page = value('page'), role = value('role'), stage = value('stage');
    if (!['web-play', 'store-referral'].includes(type) || !['home','list','category','genres','detail','play','information','collection'].includes(page) || !['author','independent-reviewer'].includes(role) || !['resolve','plan','make','check','review','deliver'].includes(stage)) throw new Error('Unknown context');
    if (type === 'store-referral' && page === 'play') throw new Error('Store referral has no play page');
    const pageFile = ['category','genres','collection'].includes(page) ? 'list' : page;
    result = { type, page, role, stage, read: ['AGENTS.md','README.md','core/start.md','core/owner-games-rules.md','core/web-game-publishing-experience.md','core/acceptance-application.md','core/acceptance-experience-20261028.md','core/owner-standards-20261027.md','core/owner-requirements.json','core/quality.md','core/workflow.md','core/designer-learning.md','docs/portable-review.md','site-types/' + type + '.md','pages/' + pageFile + '.md'] .map((file) => path.join(root,file)), assets:[path.join(root,'bin/inspect-games.mjs'),path.join(root,'core/designer-learning.json')], designReferences:selectDesignReferences(page), referenceUse:'Assess the current component, conditions and exceptions; refresh central same-type references and retired IDs. No automatic promotion to hard rules or acceptance.' };
  } else if (command === 'plan') result = createPlan(validateTask(await readJson(value('task'))));
  else if (command === 'init') result = await initRun(root, value('task'), path.resolve(value('output')));
  else if (command === 'freeze') result = await freezeCandidate(path.resolve(value('candidate')), path.resolve(value('run')));
  else if (command === 'verify') result = await verifyRun(path.resolve(value('run')));
  else if (command === 'review') { const run = path.resolve(value('run')); result = await validateReview(run, await readJson(value('review'))); await writeJson(path.join(run,'review-integrity.json'),result); }
  else if (command === 'pack') result = { copiedFiles: await packPackage(root,path.resolve(value('output'))) };
  else throw new Error('Usage: game.mjs check|context|init|plan|freeze|verify|review|pack');
  console.log(JSON.stringify(result,null,2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
