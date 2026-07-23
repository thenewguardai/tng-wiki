// Per-citation content lockfile for `tng-wiki ground`.
//
// The lockfile (`wiki/.tng-wiki.lock.json`, COMMITTED: it is verification state
// that must travel with the wiki, analogous to a package lockfile) pins, per
// citation, what the cited content was when it was last human-verified (a
// normalized sha256), plus, per code authority, which SHA the configured ref
// resolved to. `ground` uses it to report per-citation churn
// (`cite_content_changed` / `cite_moved`) instead of per-file churn, and to make
// branch refs deterministic ("verified against develop@5e36f17").
//
// Every function here is pure or fail-soft: a missing / corrupt /
// unsupported-version lockfile reads as null and an unwritable lockfile reports
// `false`; ground never crashes on lock state.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export const LOCK_RELPATH = 'wiki/.tng-wiki.lock.json';
export const LOCK_VERSION = 1;

export function lockPath(wikiPath) {
  return join(wikiPath, LOCK_RELPATH);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Parsed lockfile, normalized to `{ version, updated_at, authorities, citations }`,
// or null when absent / unreadable / malformed (treated as "no lockfile").
// A recognizable lockfile whose `version` isn't the supported LOCK_VERSION is
// also treated as absent (schema changes must never silently feed wrong-shape
// data into churn detection), but gets a one-line stderr notice so the user
// knows their lock state is being ignored (and that `--update-lock` would
// rewrite it at the current version).
export function readLock(wikiPath) {
  try {
    const lock = JSON.parse(readFileSync(lockPath(wikiPath), 'utf8'));
    if (!isPlainObject(lock)) return null;
    if (lock.version !== LOCK_VERSION) {
      process.stderr.write(
        `tng-wiki: ignoring ${LOCK_RELPATH} - unsupported lock version ${JSON.stringify(lock.version ?? null)} ` +
        `(this tng-wiki supports version ${LOCK_VERSION}); \`ground --update-lock\` would rewrite it\n`,
      );
      return null;
    }
    return {
      version: lock.version,
      updated_at: typeof lock.updated_at === 'string' ? lock.updated_at : null,
      authorities: isPlainObject(lock.authorities) ? lock.authorities : {},
      citations: isPlainObject(lock.citations) ? lock.citations : {},
    };
  } catch {
    return null;
  }
}

// Write the lockfile. Returns true on success, false when the path is unwritable
// (read-only checkout); callers surface that instead of throwing mid-lint.
export function writeLock(wikiPath, { authorities = {}, citations = {} } = {}) {
  const lock = {
    version: LOCK_VERSION,
    updated_at: new Date().toISOString(),
    authorities,
    citations,
  };
  try {
    writeFileSync(lockPath(wikiPath), JSON.stringify(lock, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

// Hash-input normalization: split into lines (ignoring a single trailing newline,
// mirroring ground's countLines), strip trailing whitespace per line. This makes
// whitespace-only commits invisible to churn detection.
export function normalizeLines(text) {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n').map((l) => l.replace(/[ \t\r]+$/, ''));
}

export function hashLines(lines) {
  return 'sha256:' + createHash('sha256').update(lines.join('\n')).digest('hex');
}

// Canonical lock key for a parsed citation (an extractCitations() hit): the
// literal cite string: `raw/<path>`, `code:<authority>/<file>`, or
// `code:<authority>/<file>#L<s>[-L<e>]`. Single-line anchors canonicalize to
// `#L<n>` so `#L42` and `#L42-L42` share one entry.
export function citeKey(c) {
  if (c.kind === 'raw') return c.path;
  let key = `code:${c.authority}${c.file ? `/${c.file}` : ''}`;
  if (c.range) key += rangeAnchor(c.range);
  return key;
}

// `#L<s>` / `#L<s>-L<e>` anchor text for a `{ start, end }` range.
export function rangeAnchor(range) {
  return range.start === range.end ? `#L${range.start}` : `#L${range.start}-L${range.end}`;
}

// Human-readable `L<s>-L<e>` form used in finding fields (matches the existing
// code_line_out_of_range `range` field shape).
export function rangeLabel(range) {
  return `L${range.start}-L${range.end}`;
}

// Slice a 1-indexed inclusive line range out of a normalized line array.
export function sliceRange(lines, range) {
  return lines.slice(range.start - 1, range.end);
}

// All windows of `windowLen` lines whose normalized hash equals `lockedHash`,
// i.e. where did the locked content move to? Returns 1-indexed inclusive ranges.
// Exactly one match -> cite_moved; several -> cite_moved_ambiguous.
export function findContentMatches(lines, lockedHash, windowLen) {
  if (windowLen <= 0) return [];
  const out = [];
  for (let start = 0; start + windowLen <= lines.length; start++) {
    if (hashLines(lines.slice(start, start + windowLen)) === lockedHash) {
      out.push({ start: start + 1, end: start + windowLen });
    }
  }
  return out;
}
