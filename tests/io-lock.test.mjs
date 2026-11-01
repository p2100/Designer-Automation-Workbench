import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {locked, writeJSON} from '../lib/io.mjs';

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'da-lock-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  return path.join(root, 'operation');
}
async function retryBusy(directory, operation) {
  for (let attempt = 0; attempt < 500; attempt++) {
    try {return await locked(directory, operation);}
    catch (error) {if (!error.message.startsWith('Another operation')) throw error; await pause(1);}
  }
  throw Error('Lock contention did not settle');
}

test('concurrent lock contenders never read a partial owner or overlap critical sections', async t => {
  const directory = await fixture(t); let active = 0, completed = 0;
  await Promise.all(Array.from({length: 12}, async () => {
    for (let turn = 0; turn < 8; turn++) await retryBusy(directory, async () => {
      active++; assert.equal(active, 1);
      const owner = JSON.parse(await fs.readFile(path.join(directory + '.lock', 'owner.json')));
      assert.equal(owner.pid, process.pid); await pause(1);
      completed++; active--;
    });
  }));
  assert.equal(completed, 96); assert.equal(active, 0);
});

test('concurrent recovery of a dead owner preserves the first new active owner', async t => {
  const directory = await fixture(t), lock = directory + '.lock';
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {stdio: ['pipe', 'ignore', 'ignore']});
  await once(child, 'spawn'); const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  await writeJSON(path.join(lock, 'owner.json'), {pid: child.pid});
  let active = 0, completed = 0;
  await Promise.all(Array.from({length: 12}, () => retryBusy(directory, async () => {
    active++; assert.equal(active, 1); await pause(3); completed++; active--;
  })));
  assert.equal(completed, 12);
});

test('fresh empty locks and active owners stay protected while old empty locks recover', async t => {
  const directory = await fixture(t), lock = directory + '.lock';
  await fs.mkdir(lock); await assert.rejects(locked(directory, async () => {}), /Another operation/);
  const expired = new Date(Date.now() - 61000); await fs.utimes(lock, expired, expired);
  assert.equal(await locked(directory, async () => 'recovered'), 'recovered');
  await writeJSON(path.join(lock, 'owner.json'), {pid: process.pid});
  await assert.rejects(locked(directory, async () => {throw Error('must not execute');}), /Another operation/);
  assert.equal(JSON.parse(await fs.readFile(path.join(lock, 'owner.json'))).pid, process.pid);
});

test('invalid legacy owner and business JSON failures are reported without rewriting their data', async t => {
  const directory = await fixture(t), lock = directory + '.lock';
  await fs.mkdir(lock); await fs.writeFile(path.join(lock, 'owner.json'), '{broken');
  await assert.rejects(locked(directory, async () => {}), SyntaxError);
  assert.equal(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'), '{broken');
  await fs.rm(lock, {recursive: true});
  const failure = new SyntaxError('business JSON is corrupt');
  await assert.rejects(locked(directory, async () => {throw failure;}), error => error === failure);
  await assert.rejects(fs.access(lock), {code: 'ENOENT'});
});

test('a crash before publishing the atomic owner can recover without deleting unrelated lock files', async t => {
  const directory = await fixture(t), lock = directory + '.lock';
  await fs.mkdir(lock); await fs.writeFile(path.join(lock, 'owner.json.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.tmp'), '{interrupted');
  const expired = new Date(Date.now() - 61000); await fs.utimes(lock, expired, expired);
  assert.equal(await locked(directory, async () => 'recovered'), 'recovered');
  await fs.mkdir(lock); await fs.writeFile(path.join(lock, 'unrelated.txt'), 'preserve'); await fs.utimes(lock, expired, expired);
  await assert.rejects(locked(directory, async () => {}), /Another operation/);
  assert.equal(await fs.readFile(path.join(lock, 'unrelated.txt'), 'utf8'), 'preserve');
});
