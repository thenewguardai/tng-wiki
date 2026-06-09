import { homedir } from 'os';
import { isAbsolute, join, relative, resolve, sep } from 'path';

// Shared resolver for paths read out of `.tng-wiki.json` (issue #16).
// A leading `~/` (or bare `~`) expands to the user's home directory — without
// this, `resolve(wikiRoot, '~/x')` treats `~` as a literal directory name and
// the failure surfaces as a confusing missing-file error. Everything else
// resolves against the wiki root, so relative paths stay fully portable.
// (`~user/x` is NOT expanded — that's shell-only syntax we don't emulate.)
export function resolveConfigPath(wikiRoot, p) {
  const str = String(p ?? '');
  if (str === '~') return homedir();
  if (str.startsWith('~/') || str.startsWith('~\\')) return join(homedir(), str.slice(2));
  return resolve(wikiRoot, str);
}

// Classify how a config path is written: 'relative' | 'home' (~-prefixed) | 'absolute'.
export function pathForm(p) {
  const str = String(p ?? '');
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
