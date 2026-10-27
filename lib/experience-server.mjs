import packageInfo from '../package.json' with {type: 'json'};
import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  experienceCaseSchema,
  experienceSearchSchema,
  experienceManageSchema,
} from './experience-schema.mjs';
import {MongoExperienceStore} from './experience-mongo.mjs';
import {backupDocument} from './experience-backup.mjs';

const same = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const output = (data) => ({
  content: [{type: 'text', text: JSON.stringify(data)}],
});
export function isInternalAddress(address = '') {
  const normalized = address
    .toLowerCase()
    .replace(/^::ffff:/, '')
    .split('%')[0];
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  return (
    isIP(normalized) === 6 &&
    (normalized === '::1' ||
      /^f[cd][0-9a-f]{2}:/.test(normalized) ||
      /^fe[89ab][0-9a-f]:/.test(normalized))
  );
}
export function experienceMcp(store) {
  const server = new McpServer(
    {name: 'designer-automation-experience', version: packageInfo.version},
    {
      instructions:
        'First determine the actual product type and page. Search using that type’s page keys; includePending may return approved transferable candidate projections as reference only, never treat retracted results as usable. Confirm component, applicability and exceptions. Capture actual feedback as a draft. After the designer explicitly approves the exact retested candidate, extract scoped lessons with actual approval and evidence. Local ZIP corrections can yield same-type references, but local identities cannot prove independent sites and cannot activate global rules. Two independently approved verifiable source sites are needed for active cross-site conclusions. Inspect, withdraw or replace incorrect conclusions. Never invent confirmation, evidence or causes. Experience cannot override versioned business rules. Queued is not yet shared.',
    },
  );
  server.registerTool(
    'experience_search',
    {
      description:
        'Read lessons for actual type-specific page families. With includeCreative, includeVisualSpecs and explicit siteType return subjective reference and actual-image text observations separately, not mandatory rules. Use includeRetired to suppress withdrawn local references. With includePending, approved transferable candidates are references only; exclude retracted results.',
      inputSchema: experienceSearchSchema,
    },
    async (args) => {
      const result = await store.search(args);
      return output(
        args.knownHash === result.hash
          ? {hash: result.hash, revision: result.revision, notModified: true}
          : result,
      );
    },
  );
  server.registerTool(
    'experience_capture',
    {
      description:
        'Save actual feedback or a verified scoped principle. Confirmed transferable ZIP/local corrections can create a same-type candidate reference; local paths do not count as independent sites for global activation. Contradictions stay pending. Vague or unscoped data is not an active lesson. Report queued as pending, not shared.',
      inputSchema: {case: experienceCaseSchema},
    },
    async (args) => {
      try {
        return output(await store.capture(args.case));
      } catch (error) {
        return {
          ...output({
            message: error.message,
            retryable: error.name?.startsWith('Mongo') === true,
          }),
          isError: true,
        };
      }
    },
  );
  if (store.manage)
    server.registerTool(
      'experience_manage',
      {
        description:
          'Inspect the reusable conclusion and evidence/history. Withdraw or correct a creative reference with actor, reason and expected revision (for replacement supply observation and optional sentiment); for lessons use an approved correction. No maintainer required. Conflicts remain pending until explicitly resolved.',
        inputSchema: experienceManageSchema,
      },
      async (args) => {
        try {
          return output(await store.manage(args));
        } catch (error) {
          return {
            ...output({
              message: error.message,
              retryable: error.name?.startsWith('Mongo') === true,
            }),
            isError: true,
          };
        }
      },
    );
  if (store.syncStatus)
    server.registerTool(
      'experience_status',
      {
        description:
          'Read automatic delivery status; never request manual sync.',
        inputSchema: {},
      },
      async () => output(await store.syncStatus()),
    );
  return server;
}

async function body(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1_000_000) throw Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function startExperienceServer({
  mongo,
  store: injectedStore,
  host = '127.0.0.1',
  port = 0,
  token,
  maintainerToken,
  allowAnonymous = false,
  allowedOrigins = [],
}) {
  if (typeof allowAnonymous !== 'boolean')
    throw Error('allowAnonymous must be a boolean');
  if (
    !allowAnonymous &&
    !['127.0.0.1', 'localhost', '::1'].includes(host) &&
    (!token || token.length < 24)
  )
    throw Error(
      'Network binding requires a writer token or explicit internal anonymous mode',
    );
  if (token && maintainerToken && same(token, maintainerToken))
    throw Error('Use distinct writer and maintainer tokens');
  const store =
    injectedStore || (await MongoExperienceStore.connect(mongo || {}));
  const server = http.createServer(async (request, response) => {
    const send = (status, data, headers = {}) => {
      response.writeHead(status, {
        'content-type': 'application/json',
        ...headers,
      });
      response.end(data === undefined ? undefined : JSON.stringify(data));
    };
    try {
      const url = new URL(request.url, 'http://service');
      if (
        request.headers.origin &&
        !allowedOrigins.includes(request.headers.origin)
      ) {
        send(403, {error: 'Origin is not allowed'});
        return;
      }
      const supplied = request.headers.authorization?.replace(/^Bearer /, ''),
        maintainer = Boolean(
          maintainerToken && same(supplied, maintainerToken),
        );
      if (
        allowAnonymous &&
        !maintainer &&
        !isInternalAddress(request.socket.remoteAddress)
      ) {
        send(403, {
          error: 'Anonymous access is limited to the internal network',
        });
        return;
      }
      if (!allowAnonymous && token && !same(supplied, token) && !maintainer) {
        send(
          401,
          {error: 'Authentication required'},
          {'www-authenticate': 'Bearer'},
        );
        return;
      }
      if (url.pathname === '/health' && request.method === 'GET') {
        try {
          send(200, {
            status: 'ok',
            service: 'designer-automation-experience',
            version: packageInfo.version,
            capabilities: ['local-type-reference-v1','creative-reference-v1','creative-text-spec-v1'],
            ...((await store.health?.()) || {backend: 'local-test'}),
          });
        } catch {
          send(503, {
            status: 'unavailable',
            service: 'designer-automation-experience',
          });
        }
        return;
      }
      if (url.pathname === '/mcp') {
        if (request.method !== 'POST') {
          send(405, {error: 'Use MCP POST'}, {allow: 'POST'});
          return;
        }
        const mcp = experienceMcp(store),
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });
        response.on('close', () => {
          void transport.close();
          void mcp.close();
        });
        await mcp.connect(transport);
        await transport.handleRequest(request, response, await body(request));
        return;
      }
      if (url.pathname === '/v1/admin/snapshot' && request.method === 'GET') {
        if (!maintainer) {
          send(403, {error: 'Maintainer credentials required'});
          return;
        }
        send(
          200,
          backupDocument(await store.read(), {
            database: store.database,
            collection: store.collectionName,
          }),
        );
        return;
      }
      if (url.pathname === '/v1/lessons' && request.method === 'GET') {
        const result = await store.search({
          pages: (url.searchParams.get('pages') || '')
            .split(',')
            .filter(Boolean),
          site: url.searchParams.get('site') || undefined,
        });
        const etag = '"' + result.hash + '"';
        if (request.headers['if-none-match'] === etag)
          send(304, undefined, {etag});
        else send(200, result, {etag});
        return;
      }
      if (url.pathname === '/v1/cases' && request.method === 'POST') {
        send(200, await store.capture(await body(request)));
        return;
      }
      if (url.pathname === '/v1/publish' && request.method === 'POST') {
        send(410, {
          error: 'Use scoped experience_capture or experience_manage',
        });
        return;
      }
      send(404, {error: 'Unknown endpoint'});
    } catch (error) {
      if (!response.headersSent) send(400, {error: error.message});
      else response.end();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    await store.close?.();
    throw error;
  }
  return {
    server,
    store,
    url:
      'http://' +
      (host.includes(':') ? '[' + host + ']' : host) +
      ':' +
      server.address().port,
    close: async () => {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeIdleConnections();
      });
      await store.close?.();
    },
  };
}
