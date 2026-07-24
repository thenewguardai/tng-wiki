// Shared-vs-host-specific wiki metadata (#38). The concept lives in the wiki's
// COMMITTED manifest (`.tng-wiki.json` -> `sharing`), not in any machine's
// registry: it travels with the repo, so every machine derives its own
// relationship to the wiki by comparing hostnames. Values:
//   "shared"        - maintained from multiple machines
//   "host:<name>"   - specific to one host; other machines should not register it
// An absent field means unstamped - no behavior changes.
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { hostname } from 'os';
import { join } from 'path';

// Parsed `sharing` value: null | {mode:'shared'} | {mode:'host', host}.
export function readSharing(wikiPath) {
  const metaPath = join(wikiPath, '.tng-wiki.json');
  if (!existsSync(metaPath)) return null;
  let raw;
  try { raw = JSON.parse(readFileSync(metaPath, 'utf8')).sharing; } catch { return null; }
  if (raw === 'shared') return { mode: 'shared' };
  if (typeof raw === 'string' && raw.startsWith('host:') && raw.length > 5) {
    return { mode: 'host', host: raw.slice(5) };
  }
  return null;
}

// Stamp `sharing` into the committed manifest. `value` is the raw string form
// ('shared' | 'host:<name>'). Throws when the wiki has no manifest.
export function stampSharing(wikiPath, value) {
  const metaPath = join(wikiPath, '.tng-wiki.json');
  if (!existsSync(metaPath)) throw new Error(`No .tng-wiki.json manifest in ${wikiPath} - cannot stamp sharing.`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  meta.sharing = value;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

// This machine's relationship to a wiki: null (unstamped) | 'shared' | 'mine'
// | 'other-host'.
export function relationTo(sharing, localHost = hostname()) {
  if (!sharing) return null;
  if (sharing.mode === 'shared') return 'shared';
  return sharing.host === localHost ? 'mine' : 'other-host';
}
