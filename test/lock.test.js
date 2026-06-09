import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  LOCK_RELPATH, lockPath, readLock, writeLock,
  normalizeLines, hashLines, citeKey, rangeAnchor, rangeLabel,
  sliceRange, findContentMatches,
} from '../src/lock.js';

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-lock-'));
  mkdirSync(join(dir, 'wiki'), { recursive: true });
  return dir;
}

// --- normalization + hashing ---

test('normalizeLines strips trailing whitespace per line and one trailing newline', () => {
  assert.deepEqual(normalizeLines('a  \nb\t\nc'), ['a', 'b', 'c']);
  assert.deepEqual(normalizeLines('a\nb\n'), ['a', 'b']);   // trailing \n ignored (mirrors countLines)
  assert.deepEqual(normalizeLines('a\r\nb\r\n'), ['a', 'b']); // CRLF tolerated
});

test('hashLines is whitespace-invariant under normalization but content-sensitive', () => {
  const a = hashLines(normalizeLines('foo\nbar\n'));
  const b = hashLines(normalizeLines('foo   \nbar\t'));
  const c = hashLines(normalizeLines('foo\nbaz\n'));
  assert.equal(a, b);          // whitespace-only difference is invisible
  assert.notEqual(a, c);       // real edit changes the hash
  assert.match(a, /^sha256:[0-9a-f]{64}$/);
});

// --- cite keys ---

test('citeKey produces the literal cite string for raw, whole-file, and ranged cites', () => {
  assert.equal(citeKey({ kind: 'raw', path: 'raw/specs/foo.md' }), 'raw/specs/foo.md');
  assert.equal(citeKey({ kind: 'code', authority: 'app', file: 'src/a.ts' }), 'code:app/src/a.ts');
  assert.equal(
    citeKey({ kind: 'code', authority: 'app', file: 'src/a.ts', range: { start: 17, end: 24 } }),
    'code:app/src/a.ts#L17-L24',
  );
});

test('citeKey canonicalizes single-line anchors so #L42 and #L42-L42 share one entry', () => {
  const single = citeKey({ kind: 'code', authority: 'app', file: 'x.sql', range: { start: 42, end: 42 } });
  assert.equal(single, 'code:app/x.sql#L42');
});

test('rangeAnchor and rangeLabel render ranges consistently', () => {
  assert.equal(rangeAnchor({ start: 5, end: 9 }), '#L5-L9');
  assert.equal(rangeAnchor({ start: 5, end: 5 }), '#L5');
  assert.equal(rangeLabel({ start: 5, end: 9 }), 'L5-L9');
});

// --- range slicing + move detection ---

test('sliceRange extracts a 1-indexed inclusive range', () => {
  assert.deepEqual(sliceRange(['a', 'b', 'c', 'd'], { start: 2, end: 3 }), ['b', 'c']);
});

test('findContentMatches locates moved content and reports all candidate ranges', () => {
  const locked = hashLines(['beta', 'gamma']);
  // unique match, shifted down by 2
  assert.deepEqual(
    findContentMatches(['x', 'y', 'beta', 'gamma', 'z'], locked, 2),
    [{ start: 3, end: 4 }],
  );
  // duplicate blocks -> two candidates
  assert.deepEqual(
    findContentMatches(['beta', 'gamma', 'mid', 'beta', 'gamma'], locked, 2),
    [{ start: 1, end: 2 }, { start: 4, end: 5 }],
  );
  // absent -> none
  assert.deepEqual(findContentMatches(['a', 'b'], locked, 2), []);
});

// --- lockfile io ---

test('writeLock + readLock round-trip; lockfile lives at wiki/.tng-wiki.lock.json', () => {
  const dir = makeDir();
  try {
    const citations = { 'wiki/entities/a.md': { 'raw/specs/foo.md': { hash: 'sha256:abc' } } };
    const authorities = { app: { ref: 'main', resolved_sha: 'deadbeef', resolved_at: '2026-06-09T00:00:00Z', dirty: false } };
    assert.equal(writeLock(dir, { authorities, citations }), true);
    assert.equal(lockPath(dir), join(dir, LOCK_RELPATH));

    const lock = readLock(dir);
    assert.equal(lock.version, 1);
    assert.ok(lock.updated_at);
    assert.deepEqual(lock.citations, citations);
    assert.deepEqual(lock.authorities, authorities);

    // raw JSON on disk is valid and pretty-printed
    const onDisk = JSON.parse(readFileSync(join(dir, LOCK_RELPATH), 'utf8'));
    assert.equal(onDisk.version, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readLock returns null on a missing or corrupt lockfile (never throws)', () => {
  const dir = makeDir();
  try {
    assert.equal(readLock(dir), null);
    writeFileSync(join(dir, LOCK_RELPATH), '{not json');
    assert.equal(readLock(dir), null);
    writeFileSync(join(dir, LOCK_RELPATH), '[1,2]');
    assert.equal(readLock(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
