import fs from 'node:fs/promises';
import path from 'node:path';
import {digest, root} from '../../../lib/io.mjs';

// These are protocol fixtures. Entity identities come from checked-in source
// records; test button feedback makes no coupon, install or runtime claims.
const identities = {
  coupon: {
    label: 'manomano.co.uk',
    evidence: 'knowledge/imported/skills/site-data/references/live-verification.md',
    evidenceText: '/merchants/manomano.co.uk',
  },
  app: {
    label: 'Gmail',
    evidence: 'site-types/app/docs/reference-audit-20261026.md',
    evidenceText: 'com_google_android_gm.html',
  },
  games: {
    label: 'Minecraft',
    evidence: 'site-types/games/examples/task.json',
    evidenceText: 'com.mojang.minecraftpe',
  },
};

export const testFeedback = 'TEST replay: changing the action label moves the neighbouring identity text. Keep the action track stable in every card at phone and desktop widths.';
export const testApproval = 'TEST protocol replay only: I confirm this exact fixture candidate after its measured action-state checks. This is not business design approval.';

const baseStyles = `*{box-sizing:border-box}body{margin:0;padding:16px;font:16px/1.4 Arial,sans-serif;color:#182335;background:#f5f7fa}main{max-width:720px;margin:auto}h1{font-size:24px}.cards{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}.card{display:flex;align-items:center;gap:12px;padding:12px;background:#fff;border:1px solid #bac6d5}.identity{min-width:0}.identity span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.action{flex-shrink:0;min-height:44px;padding:8px 12px;font:14px Arial,sans-serif}.note{font-size:14px}`;

export const stableActionStyles = '.action{inline-size:144px;block-size:44px;white-space:nowrap}';

export function actionProbeScript() {
  return `const cards=[...document.querySelectorAll('.card')];
for(const card of cards){const button=card.querySelector('button');button.addEventListener('click',()=>{button.textContent='Test completed';document.querySelector('#probe-status').textContent='Test completed';});}`;
}

export async function createReplaySource(directory, siteType, {stable = false} = {}) {
  const identity = identities[siteType];
  if (!identity) throw Error('Unsupported replay site type');
  const evidence = await fs.readFile(path.join(root, identity.evidence), 'utf8');
  if (!evidence.includes(identity.evidenceText)) throw Error('Replay identity source changed');
  await fs.mkdir(directory, {recursive: true});
  const labels = [identity.label, identity.label + ' — checked-in source record for layout replay'];
  const cards = labels.map((label, index) => `<article class="card" data-replay-id="record-${index}"><button class="action" type="button">Test</button><div class="identity"><span>${label}</span><small>TEST layout interaction</small></div></article>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><title>${siteType} experience replay</title></head><body><main><h1>${siteType} · TEST experience replay</h1><p class="note">Isolated protocol test. No offer, download or game execution is claimed.</p><section class="cards" aria-label="Test action family">${cards}</section><p id="probe-status" role="status">not-run</p></main><script src="actions.js"></script></body></html>`;
  const files = {
    'site.json': JSON.stringify({siteType, testFixture: true}),
    'identity-source.json': JSON.stringify({...identity, evidenceHash: digest(evidence), use: 'Identity label only; no business facts inferred'}),
    'index.html': html,
    'style.css': baseStyles + (stable ? stableActionStyles : ''),
    'actions.js': actionProbeScript(),
  };
  await Promise.all(Object.entries(files).map(([file, content]) => fs.writeFile(path.join(directory, file), content)));
  return {directory, siteType, identity, files};
}

export function replayConfig(siteType) {
  return {
    version: 1,
    siteType,
    workflow: 'adjustment',
    request: 'TEST protocol replay of an action-label layout defect; scoped fixture checks, not full-site business acceptance',
    artifactRoot: '.',
    allowedPaths: ['index.html', 'style.css', 'actions.js', 'site.json', 'identity-source.json'],
    widths: [320, 393, 1440],
    commands: {},
    adjustment: {pages: ['home'], component: 'action-card', reason: 'Both action-card call sites on this fixture home page share the changing action label.'},
    pages: [{
      id: 'home',
      family: 'home',
      route: '/index.html',
      dependsOn: ['index.html', 'style.css', 'actions.js'],
      interactions: [0, 1].map(index => ({
        id: 'action-' + index,
        actions: [{type: 'click', selector: `[data-replay-id="record-${index}"] button`}],
        expected: [
          {type: 'text', selector: '#probe-status', value: 'Test completed'},
          {type: 'stable', selector: `[data-replay-id="record-${index}"] .identity`, properties: ['x', 'y'], maxDelta: 1},
        ],
      })),
    }],
  };
}

export function actionLesson(checkIds) {
  return {
    summary: 'Reserve the changing action track so neighbouring identity text remains stationary',
    cause: 'The action width was intrinsic to its current label, so its longer feedback label displaced the adjacent identity group',
    prevention: 'Reserve a 144px action track for the measured Test and Test completed states; keep its 44px height and leave a min-width:0 identity track. Recheck every card at 320px, 393px and 1440px after clicking.',
    classification: 'general',
    component: 'action-card',
    checkIds,
    learning: {
      key: 'action.feedback-track-stability',
      when: 'An action label changes beside an identity group in this horizontally arranged card family',
      exceptions: ['144px is a measured test-fixture budget, not a universal site-button width'],
      transferable: true,
    },
  };
}

export async function measureActionFamily(page) {
  const results = [];
  for (const width of [320, 393, 1440]) {
    await page.setViewportSize({width, height: 900});
    await page.reload({waitUntil: 'load'});
    for (const index of [0, 1]) {
      const card = page.locator(`[data-replay-id="record-${index}"]`);
      const before = await card.locator('.identity').boundingBox();
      await card.locator('button').click();
      const after = await card.locator('.identity').boundingBox();
      const shift = Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y));
      results.push({width, index, shift, pass: shift <= 1});
    }
  }
  return results;
}
