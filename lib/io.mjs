import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

export const root = path.resolve(import.meta.dirname, '..');
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const readJSON = file => fs.readFile(file, 'utf8').then(JSON.parse);
export const exists = file => fs.access(file).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; });
export const requireText = (value, name) => { if (typeof value !== 'string' || !value.trim()) throw Error(name + ' is required'); return value; };
export const safeId = value => { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value || '')) throw Error('Invalid ID'); return value; };
export function inside(directory, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw Error('Unsafe relative path');
  return path.join(directory, relative);
}
export async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
  await fs.rename(temporary, file);
}
const ignored = new Set(['.git', 'node_modules', '.designer-data', '.DS_Store']);
export const ignoredSourceEntry = name => ignored.has(name) || /^\.env(?:\.|$)/.test(name);
export async function snapshot(directory, excluded = [], relative = '') {
  const result = {};
  for (const entry of (await fs.readdir(path.join(directory, relative), {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name))) {
    const name = relative ? relative + '/' + entry.name : entry.name;
    if (ignoredSourceEntry(entry.name) || excluded.some(p => name === p || name.startsWith(p + '/'))) continue;
    if (entry.isSymbolicLink()) throw Error('Symlinks require an explicit adapter: ' + name);
    if (entry.isDirectory()) Object.assign(result, await snapshot(directory, excluded, name));
    else if (entry.isFile()) result[name] = digest(await fs.readFile(path.join(directory, name)));
  }
  return result;
}
export const changedFiles = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name]).sort();
export function glob(pattern, value) {
  const parts = pattern.split('**').map(part => part.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'));
  const regex = parts.join('.*').replace(/\.\*\//g, '(?:.*/)?');
  return new RegExp('^' + regex + '$').test(value);
}
export function command(argv, cwd, {timeout = 120000, env = {}, maxBytes = 2_000_000} = {}) {
  if (!Array.isArray(argv) || !argv.length || argv.some(arg => typeof arg !== 'string')) throw Error('Command must be an argv array; shell strings are not accepted');
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {cwd, env: {...process.env, ...env, GIT_TERMINAL_PROMPT: '0'}, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '', settled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(Error('Command timed out: ' + argv[0])); }, timeout);
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; if (output.length > maxBytes) { child.kill('SIGKILL'); finish(Error('Command output exceeded limit')); } });
    child.on('error', error => finish(error));
    child.on('exit', code => finish(code === 0 ? null : Error('Command failed: ' + argv[0] + ' (exit ' + code + ')\n' + output.slice(-4000)), {output: output.trim()}));
  });
}
export async function locked(directory, action) {
  const lock = directory + '.lock';
  await fs.mkdir(path.dirname(lock), {recursive: true});
  try { await fs.mkdir(lock); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let stale = false;
    try {
      const owner = await readJSON(path.join(lock,'owner.json'));
      if (!Number.isInteger(owner.pid) || owner.pid < 1) throw Error('Invalid operation lock');
      try { process.kill(owner.pid,0); } catch (failure) { if (failure.code === 'ESRCH') stale = true; else throw failure; }
    } catch (failure) {
      if (failure.code !== 'ENOENT') throw failure;
      stale = Date.now()-(await fs.stat(lock)).mtimeMs > 60000 && !(await fs.readdir(lock)).length;
    }
    if (!stale) throw Error('Another operation is active; do not run task mutations concurrently');
    try { await fs.unlink(path.join(lock,'owner.json')); } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
    await fs.rmdir(lock); await fs.mkdir(lock);
  }
  try {
    await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}),{flag:'wx'});
    return await action();
  } finally { await fs.unlink(path.join(lock,'owner.json')).catch(() => {}); await fs.rmdir(lock); }
}
