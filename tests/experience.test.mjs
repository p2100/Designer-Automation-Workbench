import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {ExperienceStore, ExperienceClient} from '../lib/experience.mjs';
import {
  startExperienceServer,
  isInternalAddress,
} from '../lib/experience-server.mjs';
import {sample} from './experience-fixture.mjs';
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'da-mcp-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const store = new ExperienceStore(path.join(dir, 'shared')),
    service = await startExperienceServer({
      store,
      allowAnonymous: true,
      maintainerToken: 'synthetic-maintainer-token-long-enough',
    });
  t.after(() => service.close());
  return {dir, store, service};
}
test('anonymous MCP captures governed lessons and corrects them without maintainer credentials', async (t) => {
  const {service} = await fixture(t);
  const client = new Client({name: 'synthetic-designer', version: '1'});
  await client.connect(
    new StreamableHTTPClientTransport(new URL(service.url + '/mcp')),
  );
  t.after(() => client.close());
  const health = await fetch(service.url + '/health').then((r) => r.json());
  assert.equal(health.version, client.getServerVersion().version);
  assert.equal(health.version, '0.8.0');
  assert.deepEqual(
    (await client.listTools()).tools.map((t) => t.name),
    ['experience_search', 'experience_capture', 'experience_manage'],
  );
  const saved = JSON.parse(
    (
      await client.callTool({
        name: 'experience_capture',
        arguments: {case: sample()},
      })
    ).content[0].text,
  );
  assert.equal(saved.shared, true);
  const target = saved.lessons.find((l) => l.scope.site);
  const withdrawn = await client.callTool({
    name: 'experience_manage',
    arguments: {
      action: 'retract',
      id: target.id,
      expectedRevision: target.revision,
      actor: 'synthetic-designer',
      reason: 'Synthetic withdrawal',
    },
  });
  assert(!withdrawn.isError);
  const found = await client.callTool({
    name: 'experience_search',
    arguments: {pages: ['home'], site: 'fixture-a'},
  });
  assert.equal(JSON.parse(found.content[0].text).cases.length, 0);
  assert.equal((await fetch(service.url + '/v1/admin/snapshot')).status, 403);
});
test('MCP stdio entry uses the same central store and exposes automatic delivery status', async (t) => {
  const {dir, service} = await fixture(t),
    client = new Client({name: 'synthetic-stdio', version: '1'});
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('bin/experience-mcp.mjs')],
      env: {
        ...process.env,
        DA_EXPERIENCE_URL: service.url,
        DA_EXPERIENCE_TOKEN: '',
        DA_EXPERIENCE_CLIENT_DATA: path.join(dir, 'client'),
      },
    }),
  );
  t.after(() => client.close());
  assert.deepEqual(
    (await client.listTools()).tools.map((t) => t.name),
    [
      'experience_search',
      'experience_capture',
      'experience_manage',
      'experience_status',
    ],
  );
  const result = await client.callTool({
    name: 'experience_capture',
    arguments: {case: sample()},
  });
  assert.equal(JSON.parse(result.content[0].text).shared, true);
});
test('query cache remains conditional and server-backed', async (t) => {
  const {dir, service} = await fixture(t),
    client = new ExperienceClient({
      url: service.url,
      cache: path.join(dir, 'cache'),
    });
  t.after(() => client.close());
  await client.capture(sample());
  assert.equal((await client.search({site: 'fixture-a'})).cases.length, 1);
  assert.equal(
    (await client.search({site: 'fixture-a'})).source,
    'remote-cache',
  );
});
test('anonymous access is limited to actual private/loopback peers', () => {
  for (const a of [
    '127.0.0.1',
    '10.0.0.1',
    '172.18.188.6',
    '192.168.1.1',
    '::1',
    'fd12::1',
    '::ffff:192.168.1.1',
  ])
    assert(isInternalAddress(a));
  for (const a of ['8.8.8.8', '172.32.0.1', '2001:4860::1', 'localhost', ''])
    assert.equal(isInternalAddress(a), false);
});
