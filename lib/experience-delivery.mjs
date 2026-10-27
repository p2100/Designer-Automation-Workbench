import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';
import {ExperienceClient} from './experience-client.mjs';
import {
  experienceCaseSchema,
  experienceManageSchema,
} from './experience-schema.mjs';
import {z} from 'zod';
import {caseContent, caseId} from './experience-case.mjs';
import {managementId} from './experience-policy.mjs';
import {recoverTaskDeliveries, markTaskDelivered} from './experience-task.mjs';
import {durableJSON} from './durable-json.mjs';
import {digest, exists, readJSON, locked, root} from './io.mjs';
import {searchCreative} from './creative-memory.mjs';
import {creativeCase,visualSpecCase} from './team-creative.mjs';
import {siteCatalogue} from '../bin/sites.mjs';
const busy = (error) => error.message.startsWith('Another operation is active');
const names = async (directory) =>
  (await exists(directory))
    ? (await fs.readdir(directory))
        .filter((f) => /^(case|op)-[a-f0-9]{32}\.json$/.test(f))
        .sort()
    : [];
const operationId = (record) =>
  record.action === 'manage'
    ? managementId(record.input)
    : caseId(record.entry);
export class ReliableExperienceClient {
  constructor({
    url,
    token,
    data = path.join(root, '.designer-data'),
    timeout = 8000,
    retryMin = 2000,
    retryMax = 60000,
    autoWorker = true,
  }) {
    this.remote = new ExperienceClient({url, token, timeout});
    this.data = data;
    this.autoWorker = autoWorker;
    this.directory = path.join(
      data,
      'experience-delivery',
      digest(this.remote.url).slice(0, 24),
    );
    this.outbox = path.join(this.directory, 'outbox');
    this.rejected = path.join(this.directory, 'rejected');
    this.configFile = path.join(this.directory, 'connection.json');
    this.recoveryCache = new Map();
    this.creativeEvidenceCache = new Map();
    this.settings = {
      url: this.remote.url,
      token: token || null,
      data,
      timeout,
      retryMin,
      retryMax,
    };
    this.remote.cache = path.join(this.directory, 'cache');
  }
  async receipt(id) {
    const file = path.join(this.directory, 'receipts', id + '.json');
    return (await exists(file)) ? readJSON(file) : null;
  }
  async initialize() {
    if (!this.ready)
      this.ready = (async () => {
        await durableJSON(this.configFile, this.settings);
        const legacy = path.join(this.data, 'outbox');
        for (const name of await names(legacy)) {
          try {
            const entry = caseContent(
              experienceCaseSchema.parse(
                (await readJSON(path.join(legacy, name))).entry,
              ),
            );
            await this.enqueue(entry);
            await fs.unlink(path.join(legacy, name));
          } catch (error) {
            await this.quarantine(path.join(legacy, name), name, error);
          }
        }
        await this.recover();
        await this.recoverCreative();
      })().catch((error) => {
        this.ready = null;
        throw error;
      });
    return this.ready;
  }
  async recover() {
    if (!this.recovering)
      this.recovering = recoverTaskDeliveries(
        this.data,
        (entry, task) => this.enqueue(entry, task),
        (id) => this.receipt(id),
        this.recoveryCache,
      ).finally(() => {
        this.recovering = null;
      });
    return this.recovering;
  }
  async recoverCreative() {
    for(const siteType of ['coupon','app','games']) {
      const catalogue=await siteCatalogue(root,siteType);
      const found=await searchCreative(this.data,{siteType,pages:Object.keys(catalogue.pages),evidenceCache:this.creativeEvidenceCache});
      for(const ref of found.references){
        try {
          const entry=creativeCase(ref), id=caseId(entry);
          if(!await this.receipt(id))await this.enqueue(entry);
          const spec=visualSpecCase(ref);if(spec&&!await this.receipt(caseId(spec)))await this.enqueue(spec);
        } catch(error) {
          await durableJSON(path.join(this.data,'experience-recovery-errors','creative-'+digest(ref).slice(0,24)+'.json'),{error:error.message,at:new Date().toISOString()});
        }
      }
    }
    this.creativeScannedAt=Date.now();
  }
  async enqueue(entry, task) {
    return this.enqueueOperation({
      action: 'capture',
      entry,
      ...(task ? {task} : {}),
    });
  }
  async enqueueOperation(record) {
    const id = operationId(record),
      file = path.join(this.outbox, id + '.json');
    if (!(await exists(file)))
      await durableJSON(file, {
        ...record,
        id,
        queuedAt: new Date().toISOString(),
      });
    return id;
  }
  async resume() {
    await this.initialize();
    await this.recover();
    if(Date.now()-(this.creativeScannedAt||0)>5000) await this.recoverCreative();
    if ((await names(this.outbox)).length) await this.startWorker();
  }
  async workerRunning() {
    try {
      const {pid} = await readJSON(
        path.join(this.directory, 'supervisor.lock', 'owner.json'),
      );
      if (!Number.isInteger(pid) || pid < 1) return false;
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (['ESRCH', 'ENOENT'].includes(error.code)) return false;
      if (error.code === 'EPERM') return true;
      throw error;
    }
  }
  async startWorker() {
    if (!this.autoWorker || (await this.workerRunning())) return;
    const child = spawn(
      process.execPath,
      [path.join(root, 'bin/experience-worker.mjs'), this.configFile],
      {detached: true, stdio: 'ignore', windowsHide: true},
    );
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
  }
  async submit(record) {
    await this.initialize();
    const id = await this.enqueueOperation(record);
    if (!(await this.workerRunning())) {
      const result = await this.flush();
      if (result.receipts[id]) return {...result.receipts[id], sync: 'saved'};
    }
    const saved = await this.receipt(id);
    if (!(await exists(path.join(this.outbox, id + '.json'))) && saved)
      return {
        ...saved,
        sync: saved.status === 'rejected' ? 'rejected' : 'saved',
      };
    if (await exists(path.join(this.rejected, id + '.json')))
      throw Error(
        'Experience operation rejected; its original record and reason are retained locally',
      );
    await this.startWorker();
    return {
      id,
      status: 'pending-delivery',
      sync: 'queued',
      shared: false,
      automaticRetry: true,
    };
  }
  capture(input) {
    return this.submit({
      action: 'capture',
      entry: caseContent(experienceCaseSchema.parse(input)),
    });
  }
  async manage(input) {
    const parsed = z.object(experienceManageSchema).parse(input);
    if (parsed.action === 'inspect') {
      await this.initialize();
      return this.remote.manage(parsed);
    }
    return this.submit({action: 'manage', input: parsed});
  }
  async search(filter) {
    await this.resume();
    return this.remote.search(filter);
  }
  async syncStatus() {
    await this.resume();
    const f = path.join(this.directory, 'status.json'),
      last = (await exists(f)) ? await readJSON(f) : {};
    const rejected = await names(this.rejected);
    return {
      ...last,
      pending: (await names(this.outbox)).length,
      rejected: rejected.length,
      issues: await Promise.all(
        rejected.slice(-20).map(async (n) => {
          const r = await readJSON(path.join(this.rejected, n));
          return {id: n.replace('.json', ''), reason: r.reason};
        }),
      ),
      supervisorRunning: await this.workerRunning(),
      automaticRetry: true,
    };
  }
  async quarantine(file, name, error, record) {
    if (!(await exists(file))) return;
    const raw = await fs.readFile(file, 'utf8');
    await durableJSON(path.join(this.rejected, name), {
      raw,
      reason: error.message,
      rejectedAt: new Date().toISOString(),
    });
    if (record?.task) {
      const id = name.slice(0, -5),
        rejection = {
          id,
          status: 'rejected',
          shared: false,
          review: {required: true, reasons: [error.message]},
        };
      await durableJSON(path.join(this.directory, 'receipts', name), rejection);
      await markTaskDelivered(this.data, record.task.taskId, id, rejection);
    }
    await fs.unlink(file);
  }
  async flush() {
    await this.initialize();
    await this.recover();
    const receipts = {};
    try {
      return await locked(path.join(this.directory, 'delivery'), async () => {
        let lastError = null;
        const queue = [];
        for (const name of await names(this.outbox)) {
          const file = path.join(this.outbox, name);
          try {
            const record = await readJSON(file);
            if (!record.action) record.action = 'capture';
            queue.push({name, file, record});
          } catch (error) {
            if (error.code === 'ENOENT') continue;
            lastError = error.message;
            if (error instanceof SyntaxError)
              await this.quarantine(file, name, error);
          }
        }
        queue.sort(
          (a, b) =>
            (a.record.queuedAt || '').localeCompare(b.record.queuedAt || '') ||
            a.name.localeCompare(b.name),
        );
        for (const {name, file, record} of queue) {
          try {
            const result =
              record.action === 'manage'
                ? await this.remote.manage(record.input)
                : await this.remote.capture(record.entry);
            const id = operationId(record);
            receipts[id] = result;
            await durableJSON(
              path.join(this.directory, 'receipts', id + '.json'),
              result,
            );
            if (record.task)
              await markTaskDelivered(
                this.data,
                record.task.taskId,
                id,
                result,
              );
            await fs.unlink(file);
          } catch (error) {
            lastError = error.message;
            if (error.retryable === false) {
              await this.quarantine(file, name, error, record);
              continue;
            }
            if (error.deferred === true) continue;
            break;
          }
        }
        const pending = (await names(this.outbox)).length,
          f = path.join(this.directory, 'status.json'),
          previous = (await exists(f)) ? await readJSON(f) : {};
        await durableJSON(f, {
          ...previous,
          lastAttempt: new Date().toISOString(),
          ...(Object.keys(receipts).length
            ? {lastSuccess: new Date().toISOString()}
            : {}),
          lastError,
          pending,
        });
        return {receipts, pending};
      });
    } catch (error) {
      if (busy(error))
        return {receipts, pending: (await names(this.outbox)).length};
      throw error;
    }
  }
  async close() {
    await this.remote.close();
  }
}
export async function runDeliveryWorker(configFile) {
  const config = await readJSON(configFile),
    client = new ReliableExperienceClient({...config, autoWorker: false});
  try {
    await client.initialize();
    await locked(path.join(client.directory, 'worker'), async () => {
      let delay = config.retryMin;
      while (true) {
        try {
          const result = await client.flush();
          if (!result.pending) return;
          delay = Object.keys(result.receipts).length
            ? config.retryMin
            : Math.min(config.retryMax, delay * 2);
        } catch (error) {
          await durableJSON(path.join(client.directory, 'worker-error.json'), {
            at: new Date().toISOString(),
            message: error.message,
          }).catch(() => {});
        }
        await pause(delay);
      }
    });
  } catch (error) {
    if (!busy(error)) throw error;
  } finally {
    await client.close();
  }
}
export async function superviseDelivery(configFile) {
  const config = await readJSON(configFile),
    client = new ReliableExperienceClient({...config, autoWorker: false});
  let completed = false;
  try {
    await client.initialize();
    await locked(path.join(client.directory, 'supervisor'), async () => {
      let restarts = 0;
      while ((await names(client.outbox)).length) {
        const child = spawn(
          process.execPath,
          [path.join(root, 'bin/experience-worker-once.mjs'), configFile],
          {stdio: 'ignore', windowsHide: true},
        );
        await durableJSON(
          path.join(client.directory, 'supervisor-status.json'),
          {
            at: new Date().toISOString(),
            pid: process.pid,
            workerPid: child.pid,
            restarts,
          },
        );
        const code = await new Promise((resolve) => {
          child.once('error', () => resolve(1));
          child.once('exit', resolve);
        });
        if (!(await names(client.outbox)).length) return;
        if (code !== 0) restarts++;
        await pause(
          Math.min(config.retryMax, config.retryMin * Math.max(1, restarts)),
        );
      }
    });
    completed = true;
  } catch (error) {
    if (!busy(error)) throw error;
  } finally {
    await client.close();
    if (completed && (await names(client.outbox)).length)
      await new ReliableExperienceClient(config).startWorker();
  }
}
