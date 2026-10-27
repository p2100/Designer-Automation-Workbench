import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {MongoExperienceStore} from '../lib/experience-mongo.mjs';
import {ExperienceClient} from '../lib/experience.mjs';
import {startExperienceServer} from '../lib/experience-server.mjs';
import {
  backupDocument,
  writeBackup,
  readBackup,
} from '../lib/experience-backup.mjs';
import {digest, readJSON} from '../lib/io.mjs';
import {sample} from './experience-fixture.mjs';
import {creativeCase,visualSpecCase} from '../lib/team-creative.mjs';
const file = process.env.DA_EXPERIENCE_TEST_CONFIG,
  options = {skip: !file};
async function fixture(t) {
  const {mongo} = await readJSON(file),
    suffix = randomBytes(8).toString('hex'),
    config = {...mongo, collection: 'test_' + suffix},
    store = await MongoExperienceStore.connect(config),
    restored = 'restore_test_' + suffix;
  t.after(async () => {
    try {
      await store.collection.drop();
      await store.client
        .db(store.database)
        .collection(restored)
        .drop()
        .catch((e) => {
          if (e.code !== 26) throw e;
        });
    } finally {
      await store.close();
    }
  });
  return {store, config, restored};
}
test(
  'Mongo keeps local ZIP references type-scoped and cannot promote local copies',
  options,
  async (t) => {
    const {store} = await fixture(t);
    for(const digit of ['1','2']) {
      const site='local:'+digit.repeat(64);
      const input=sample({site,classification:'local-reference',scope:{site,pages:['games:home'],component:'offer-card'}});
      input.verification.pages=['games:home'];
      await store.capture(input);
    }
    const games=await store.search({site:'local:'+'3'.repeat(64),pages:['games:home'],includePending:true});
    assert.equal(games.cases.length,1);
    assert.equal(games.cases[0].status,'candidate');
    assert.equal((await store.search({site:'local:'+'3'.repeat(64),pages:['games:home']})).cases.length,0);
    assert.equal((await store.search({site:'local:'+'3'.repeat(64),pages:['app:home'],includePending:true})).cases.length,0);
  },
);
test(
  'Mongo transactions merge concurrent retries and independent evidence without duplicate conclusions',
  options,
  async (t) => {
    const {store, config} = await fixture(t),
      peer = await MongoExperienceStore.connect(config);
    t.after(() => peer.close());
    const rows = await Promise.all(
      Array.from({length: 12}, () => store.capture(sample())),
    );
    assert.equal(new Set(rows.map((c) => c.id)).size, 1);
    assert.equal((await store.read()).cases.length, 1);
    await Promise.all(
      Array.from({length: 6}, (_, i) =>
        peer.capture(sample({task: 'independent-' + i})),
      ),
    );
    const local = await store.search({site: 'fixture-a'});
    assert.equal(local.cases.length, 1);
    assert.equal(local.cases[0].supportCount, 7);
    await peer.capture(sample({site: 'fixture-b'}));
    assert.equal((await store.search({site: 'fixture-c'})).cases.length, 1);
  },
);
test(
  'Mongo correction and withdrawal atomically invalidate projections and reject stale editors',
  options,
  async (t) => {
    const {store} = await fixture(t),
      first = await store.capture(sample());
    await store.capture(sample({site: 'fixture-b'}));
    const target = first.lessons.find((l) => l.scope.site);
    const updated = sample({
      task: 'replacement',
      prevention:
        'Allow full title expansion with an accessible explicit toggle on the card',
    });
    const conflict = await store.capture(updated);
    assert.equal(conflict.status, 'conflict');
    const edited = await store.manage({
      action: 'replace',
      id: target.id,
      expectedRevision: 1,
      actor: 'designer',
      reason: 'Synthetic actual correction',
      case: updated,
    });
    assert.equal(edited.lesson.revision, 2);
    assert.equal((await store.search({site: 'fixture-c'})).cases.length, 0);
    await assert.rejects(
      store.manage({
        action: 'retract',
        id: target.id,
        expectedRevision: 1,
        actor: 'designer',
        reason: 'stale',
      }),
      /stale/,
    );
    const withdraw = {
      action: 'retract',
      id: target.id,
      expectedRevision: 2,
      actor: 'designer',
      reason: 'Synthetic withdrawal',
    };
    await store.manage(withdraw);
    assert.equal((await store.manage(withdraw)).replayed, true);
    assert.equal((await store.search({site: 'fixture-a'})).cases.length, 0);
  },
);
test(
  'snapshots restore case evidence, merged lessons, withdrawals and version history together',
  options,
  async (t) => {
    const {store, restored} = await fixture(t),
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'da-restore-'));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const first = await store.capture(sample());
    const target = first.lessons.find((l) => l.scope.site);
    await store.manage({
      action: 'retract',
      id: target.id,
      expectedRevision: 1,
      actor: 'designer',
      reason: 'Synthetic withdrawal for restore test',
    });
    const state = await store.read(),
      written = await writeBackup(
        root,
        backupDocument(state, {database: store.database}),
      ),
      archive = await readBackup(written.file);
    const result = await store.restoreInto(restored, archive);
    assert.equal(result.hash, archive.hash);
    assert.equal(result.lessonCount, 2);
    assert.equal(result.count, 1);
    const targetStore = new MongoExperienceStore(
      store.client,
      store.database,
      restored,
    );
    assert.equal(
      (await targetStore.manage({action: 'inspect', id: target.id})).status,
      'retracted',
    );
    assert.equal(
      (await targetStore.search({site: 'fixture-a'})).cases.length,
      0,
    );
    await assert.rejects(store.restoreInto(restored, archive));
    assert.deepEqual(await store.read(), state);
  },
);
test(
  'real anonymous MCP clients use governed Mongo records across service instances',
  options,
  async (t) => {
    const {store, config} = await fixture(t);
    const service = await startExperienceServer({
      mongo: config,
      allowAnonymous: true,
    });
    t.after(() => service.close());
    const client = new ExperienceClient({url: service.url});
    t.after(() => client.close());
    const saved = await client.capture(sample());
    assert.equal(saved.shared, true);
    const peer = await startExperienceServer({
      mongo: config,
      allowAnonymous: true,
    });
    t.after(() => peer.close());
    const reader = new ExperienceClient({url: peer.url});
    t.after(() => reader.close());
    assert.equal((await reader.search({site: 'fixture-a'})).cases.length, 1);
    const id = saved.lessons.find((l) => l.scope.site).id;
    await reader.manage({
      action: 'retract',
      id,
      expectedRevision: 1,
      actor: 'designer',
      reason: 'Synthetic withdrawal via another Agent',
    });
    assert.equal((await client.search({site: 'fixture-a'})).cases.length, 0);
    assert.equal((await store.read()).cases.length, 1);
  },
);

test('Mongo persists creative references with type and page isolation', options, async t => {
  const {store}=await fixture(t);
  const entry=creativeCase({siteType:'games',page:'home',component:'cards',quote:'I like the cards',observation:'Clear card grouping',kind:'positive-reference',candidate:'a'.repeat(64),actor:'designer',source:'generation',task:'fixture',feedbackId:'feedback-1',at:'2026-10-27T00:00:00.000Z'});
  await store.capture(entry);await store.capture(entry);
  const games=await store.search({siteType:'games',pages:['games:home'],includeCreative:true});
  assert.equal(games.creative.length,1);assert.equal(games.cases.length,0);
  assert.equal((await store.search({siteType:'app',pages:['app:home'],includeCreative:true})).creative.length,0);
  assert.equal((await store.search({siteType:'games',pages:['games:detail'],includeCreative:true})).creative.length,0);
  assert.equal((await store.read()).cases.length,1);
});

test('Mongo retains scoped visual text and creative corrections without images',options,async t=>{
 const {store,restored}=await fixture(t);const spec={observations:[{aspect:'layout',description:'Synthetic visible arrangement'}],applicability:'Synthetic home',limits:'Only one fixture',evidenceHash:'b'.repeat(64)};
 const ref={siteType:'games',page:'home',component:'cards',quote:'I like this',observation:'Clear grouping',kind:'positive-reference',candidate:'a'.repeat(64),actor:'designer',source:'generation',task:'fixture',feedbackId:'feedback-1',at:'2026-10-27T00:00:00.000Z',visualSpec:spec};
 const captured=await store.capture(creativeCase(ref));await store.capture(visualSpecCase(ref));
 const find=(siteType,page)=>store.search({siteType,pages:[siteType==='coupon'?page:siteType+':'+page],includeCreative:true,includeRetired:true,includeVisualSpecs:true});
 assert.equal((await find('games','home')).creative[0].visualSpec.observations[0].description,'Synthetic visible arrangement');assert.equal((await find('app','home')).creative.length,0);
 const corrected={observations:[{aspect:'spacing',description:'Corrected fixture spacing'}],applicability:spec.applicability,limits:spec.limits};
 const result=await store.manage({action:'replace',id:captured.id,expectedRevision:1,actor:'reviewer',reason:'Correct fixture',observation:'Corrected grouping',visualSpec:corrected});
 const current=(await find('games','home')).creative[0];assert.equal(current.visualSpec.observations[0].description,'Corrected fixture spacing');assert.equal(current.visualSpec.evidenceHash,spec.evidenceHash);
 await store.manage({action:'retract',id:current.id,expectedRevision:1,actor:'reviewer',reason:'Withdraw fixture'});assert.equal((await find('games','home')).creative.length,0);
 const backup=backupDocument(await store.read(),{fixture:true});await store.restoreInto(restored,backup);const restoredStore=new MongoExperienceStore(store.client,store.database,restored);assert.equal((await restoredStore.search({siteType:'games',pages:['games:home'],includeCreative:true,includeRetired:true,includeVisualSpecs:true})).creative.length,0);
 assert.equal(result.reference.creativeState,'replaced');
});
