import fs from 'node:fs/promises';
import path from 'node:path';
import {readJSON} from '../lib/io.mjs';
import {MongoExperienceStore} from '../lib/experience-mongo.mjs';
import {backupDocument,readBackup,writeBackup} from '../lib/experience-backup.mjs';
import {validateStoredCase} from '../lib/experience-case.mjs';
import {summarizeExperienceInventory} from '../lib/experience-inventory.mjs';

const action = process.argv[2], options = {};
for (let i=3;i<process.argv.length;i+=2) {
  if (!process.argv[i].startsWith('--') || !process.argv[i+1]) throw Error('Use ACTION --config PRIVATE_FILE [--input FILE] [--target restore_NAME]');
  options[process.argv[i].slice(2)] = process.argv[i+1];
}
try {
  if (!options.config) throw Error('A private --config file is required');
  const config = await readJSON(path.resolve(options.config));
  if (!config.mongo?.uri || !config.mongo.database) throw Error('Explicit MongoDB configuration is required');
  let result;
  if (action === 'inventory') {
    if (!config.maintainerToken) throw Error('Configure maintainerToken');
    const response = await fetch('http://127.0.0.1:'+config.port+'/v1/admin/snapshot',{headers:{authorization:'Bearer '+config.maintainerToken},signal:AbortSignal.timeout(60000)});
    if (!response.ok) throw Error('Snapshot endpoint HTTP '+response.status);
    result = summarizeExperienceInventory(await response.json());
  } else if (action === 'backup') {
    if (!config.backup?.directory || !config.maintainerToken) throw Error('Configure backup.directory and maintainerToken');
    const url = 'http://127.0.0.1:'+config.port+'/v1/admin/snapshot';
    const response = await fetch(url,{headers:{authorization:'Bearer '+config.maintainerToken},signal:AbortSignal.timeout(60000)});
    if (!response.ok) throw Error('Snapshot endpoint HTTP '+response.status);
    const document = await response.json();
    result = await writeBackup(config.backup.directory,document,{retentionDays:config.backup.retentionDays || 30});
  } else if (action === 'verify') {
    const archive = await readBackup(path.resolve(options.input));
    result = {valid:true,count:archive.count,lessonCount:archive.lessonCount || 0,hash:archive.hash,createdAt:archive.createdAt,source:archive.source};
  } else if (action === 'status') {
    const files = (await fs.readdir(config.backup.directory)).filter(f=>/^experience-.*\.json\.gz$/.test(f)).sort();
    if (!files.length) throw Error('No verified backup is available');
    const file = path.join(config.backup.directory,files.at(-1)), archive = await readBackup(file);
    const ageHours = (Date.now()-Date.parse(archive.createdAt))/3600000;
    result = {file,count:archive.count,hash:archive.hash,ageHours,overdue:ageHours > 8};
    if (result.overdue) process.exitCode = 1;
  } else if (action === 'restore' || action === 'import-json') {
    // Validate the entire input before opening a database connection.
    const source = action === 'restore' ? await readBackup(path.resolve(options.input)) : await readJSON(path.resolve(options.input));
    if (!Array.isArray(source.cases) || (action === 'import-json' && source.version !== 1)) throw Error('Invalid legacy experience export');
    source.cases.forEach(validateStoredCase);
    const store = await MongoExperienceStore.connect(config.mongo);
    try {
      if (action === 'restore') result = await store.restoreInto(options.target,source);
      else {
        // Preserve an independently recoverable copy of the exact legacy input.
        const archive = await writeBackup(config.backup.directory,backupDocument(source,{legacy:'store.json'}),{retentionDays:config.backup.retentionDays || 30});
        result = {...await store.importCases(source.cases),legacyBackup:archive.file};
      }
    } finally { await store.close(); }
  } else throw Error('Use inventory, backup, verify, status, restore or import-json');
  console.log(JSON.stringify(result,null,2));
} catch (error) {
  console.error('Experience administration: '+String(error.message).replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi,'[private MongoDB connection]'));
  process.exitCode = 1;
}
