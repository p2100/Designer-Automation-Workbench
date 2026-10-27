import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {digest, exists, readJSON, writeJSON} from './io.mjs';
import {experienceCaseSchema} from './experience-schema.mjs';
import {caseContent, caseId} from './experience-case.mjs';

export class ExperienceDeliveryError extends Error {
  constructor(message, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}
export class ExperienceClient {
  constructor({
    url,
    token = process.env.DA_EXPERIENCE_TOKEN,
    cache,
    timeout = 8000,
  }) {
    const base = new URL(url);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw Error('Use a credential-free service address');
    this.url = base.href.replace(/\/mcp\/?$/, '').replace(/\/$/, '');
    this.token = token;
    this.cache = cache;
    this.timeout = timeout;
  }
  async connect() {
    if (!this.connection)
      this.connection = (async () => {
        const client = new Client({
          name: 'designer-automation-client',
          version: '0.4.0',
        });
        const transport = new StreamableHTTPClientTransport(
          new URL(this.url + '/mcp'),
          {
            requestInit: {
              headers: this.token
                ? {authorization: 'Bearer ' + this.token}
                : {},
            },
            reconnectionOptions: {maxRetries: 0},
          },
        );
        this.client = client;
        try {
          await client.connect(transport, {timeout: this.timeout});
          return client;
        } catch (error) {
          await client.close().catch(() => {});
          this.connection = null;
          throw error;
        }
      })();
    return this.connection;
  }
  async close() {
    const client = this.client;
    this.client = null;
    this.connection = null;
    await client?.close().catch(() => {});
  }
  async call(name, args) {
    try {
      const client = await this.connect(),
        result = await client.callTool({name, arguments: args}, undefined, {
          timeout: this.timeout,
        });
      const content = result.content?.find((c) => c.type === 'text')?.text;
      if (result.isError) {
        let failure;
        try {
          failure = JSON.parse(content);
        } catch {
          failure = {message: content};
        }
        throw new ExperienceDeliveryError(
          failure.message || 'Experience tool rejected the record',
          failure.retryable === true,
        );
      }
      return JSON.parse(content);
    } catch (error) {
      await this.close();
      if (error instanceof ExperienceDeliveryError) throw error;
      throw new ExperienceDeliveryError(
        'MCP connection unavailable; the local record is retained',
        true,
      );
    }
  }
  async search(filter = {}) {
    const selected = Object.fromEntries(
      Object.entries({
        pages: filter.pages || [],
        site: filter.site,
        query: filter.query,
        key: filter.key,
        component: filter.component,
        includePending: filter.includePending,
        limit: filter.limit,
      }).filter(([, value]) => value !== undefined),
    );
    const file =
      this.cache &&
      path.join(this.cache, digest({url: this.url, ...selected}) + '.json');
    const cached = file && (await exists(file)) ? await readJSON(file) : null;
    try {
      const data = await this.call('experience_search', {
        ...selected,
        ...(cached ? {knownHash: cached.hash} : {}),
      });
      if (data.notModified && cached && data.hash === cached.hash)
        return {...cached, source: 'remote-cache'};
      if (
        !Array.isArray(data.cases) ||
        data.hash !== digest(data.cases) ||
        data.cases.some(
          (c) =>
            ![
              'active',
              ...(filter.includePending ? ['candidate', 'retracted'] : []),
            ].includes(c.status),
        )
      )
        throw new ExperienceDeliveryError('Invalid shared experience response');
      if (file) await writeJSON(file, data);
      return {...data, source: 'remote'};
    } catch (error) {
      if (error.retryable === false) throw error;
      if (cached)
        return {...cached, source: 'offline-cache', warning: error.message};
      return {
        cases: [],
        hash: digest([]),
        source: 'unavailable',
        warning: error.message,
      };
    }
  }
  async manage(input) {
    return this.call('experience_manage', input);
  }
  async capture(input) {
    let entry;
    try {
      entry = caseContent(experienceCaseSchema.parse(input));
    } catch (error) {
      throw new ExperienceDeliveryError(error.message, false);
    }
    if (entry.classification === 'local-reference') {
      let health;
      try {
        const response = await fetch(this.url + '/health', {
          headers: this.token ? {authorization: 'Bearer ' + this.token} : {},
          signal: AbortSignal.timeout(this.timeout),
        });
        if (!response.ok) throw Error('Health check unavailable');
        health = await response.json();
      } catch {
        throw new ExperienceDeliveryError('Shared service unavailable; local reference remains queued', true);
      }
      if (health.service !== 'designer-automation-experience' || !health.capabilities?.includes('local-type-reference-v1')) {
        const error = new ExperienceDeliveryError('Shared service needs an upgrade for ZIP type references; record remains queued', true);
        error.deferred = true;
        throw error;
      }
    }
    const result = await this.call('experience_capture', {case: entry});
    if (
      result.id !== caseId(entry) ||
      !['active', 'candidate', 'conflict'].includes(result.status)
    )
      throw new ExperienceDeliveryError(
        'Shared service has not acknowledged the confirmed lesson; retry after service recovery',
        true,
      );
    return result;
  }
}
