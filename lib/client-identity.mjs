import {hostname} from 'node:os';
import {readFileSync} from 'node:fs';

const {version}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
export function clientIdentityHeaders(){
  // The library observes the address itself. No local interfaces, account,
  // credentials, home directory or caller-supplied IP are transmitted.
  return {'X-Designer-Client':Buffer.from(JSON.stringify({hostname:hostname().slice(0,200),version})).toString('base64url')};
}
