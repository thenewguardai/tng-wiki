import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join, relative, resolve, sep } from 'path';

// Valid config paths are non-empty strings; surrounding whitespace is noise
// from hand-edited JSON and is trimmed. Anything else (missing key, null,
// number, blank string) returns null so callers can fail loudly instead of
// silently resolving to the wiki root.
function validConfigPath(p) {
  if (typeof p !== 'string') return null;
  const str = p.trim();
  return str === '' ? null : str;
}

// Human-readable repr of a malformed config value for error messages / doctor
// rows: `undefined`, `null`, `123`, `""`, `"   "`, `{...}`.
export function describePathValue(p) {
  return p === undefined ? 'undefined' : JSON.stringify(p);
}

// Shared resolver for paths read out of `.tng-wiki.json` (issue #16).
// A leading `~/` (or bare `~`) expands to the user's home directory — without
// this, `resolve(wikiRoot, '~/x')` treats `~` as a literal directory name and
// the failure surfaces as a confusing missing-file error. Everything else
// resolves against the wiki root, so relative paths stay fully portable.
// (`~user/x` is NOT expanded — that's shell-only syntax we don't emulate.)
// Throws on non-string / blank input: coercing a missing path to '' would
// silently resolve to the wiki root and make grounding/doctor operate on the
// wiki itself instead of flagging the malformed config.
export function resolveConfigPath(wikiRoot, p) {
  const str = validConfigPath(p);
  if (str === null) {
    throw new TypeError(`Invalid config path: expected a non-empty string, got ${describePathValue(p)}`);
  }
  if (str === '~') return homedir();
  if (str.startsWith('~/') || str.startsWith('~\\')) return join(homedir(), str.slice(2));
  return resolve(wikiRoot, str);
}

// Classify how a config path is written: 'relative' | 'home' (~-prefixed) |
// 'absolute' | 'invalid' (non-string or blank — malformed config must not pass
// as 'relative', or doctor/init warnings would mask it).
export function pathForm(p) {
  const str = validConfigPath(p);
  if (str === null) return 'invalid';
  if (str === '~' || str.startsWith('~/') || str.startsWith('~\\')) return 'home';
  return isAbsolute(str) ? 'absolute' : 'relative';
}

// For an absolute path entered at init: suggest the wiki-relative equivalent
// when it stays within a small depth (≤ maxUp leading `..` segments) of the
// wiki root. Returns the suggestion with forward slashes (portable config
// form) or null when the path escapes too far / sits on another root entirely
// (path.relative returns an absolute path across Windows drives).
export function suggestRelative(wikiRoot, absPath, maxUp = 4) {
  const rel = relative(resolve(wikiRoot), resolve(wikiRoot, absPath));
  if (!rel || isAbsolute(rel)) return null;
  const segments = rel.split(sep);
  let up = 0;
  while (up < segments.length && segments[up] === '..') up++;
  if (up > maxUp) return null;
  return segments.join('/');
}

// Containment guard via relative() rather than startsWith(root + sep): a root
// that already ends with the separator (e.g. `/` or `C:\`) would make
// `root + sep` unmatchable and silently disarm the guard (false negatives).
// Returns true for absPath === root and anything strictly inside it. Both args
// must already be absolute/resolved. The one traversal guard the grounding,
// cite, and verb surfaces share.
export function insideRoot(root, absPath) {
  const rel = relative(root, absPath);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

// Recursively collect `.md` files under `dir` (absolute paths), skipping
// dotfiles and dot-directories. Missing dir -> []. Shared by grounding and the
// verb search/walk surface so both see exactly the same file set.
export function walkMd(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMd(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}
