// Integration tests for the per-citation content lockfile (issue #14):
// `ground --update-lock` / `--fix-moved`, cite_content_changed / cite_moved /
// cite_moved_ambiguous / cite_unlocked findings, and deterministic ref recording
// in the lockfile `authorities` block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldWiki } from '../src/init.js';
import { checkGrounding } from '../src/ground.js';
import { readLock, LOCK_RELPATH } from '../src/lock.js';
import { roundsReport } from '../src/verbs.js';

function makeWiki() {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-glock-'));
  scaffoldWiki(dir, { domain: 'blank', agent: 'claude-code', wikiName: 'Lock Demo' });
  return dir;
}

function writeFile(wikiRoot, relPath, content) {
  const full = join(wikiRoot, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function setCodeAuthorities(wikiRoot, authorities) {
  const metaPath = join(wikiRoot, '.tng-wiki.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  meta.code_authorities = authorities;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(repo, gitArgs, extraEnv = {}) {
  return execFileSync('git', ['-C', repo, ...gitArgs], {
    stdio: 'pipe', encoding: 'utf8', env: { ...GIT_ENV, ...extraEnv },
  });
}

function initRepo(repo) {
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-b', 'main']);
}

function commitAll(repo, msg, date = '2025-06-01T12:00:00') {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', msg], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
}

const numberedLines = (n, prefix = 'line') =>
  Array.from({ length: n }, (_, i) => `${prefix}-${i + 1}`).join('\n') + '\n';

// Keep the scaffold index header honest with the page count so full-wiki runs
// don't pick up an unrelated index_header_drift finding.
function setIndexPages(dir, n) {
  const indexPath = join(dir, 'wiki/index.md');
  writeFileSync(indexPath, readFileSync(indexPath, 'utf8').replace(/Total pages: \d+/, `Total pages: ${n}`));
}

// A standard fixture: code authority with a 20-line unique file, one page with
// two stacked range cites into it.
function codeFixture(dir) {
  writeFile(dir, 'authority-src/src/f.sql', numberedLines(20));
  setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src' }]);
  writeFile(dir, 'wiki/entities/p.md',
    '---\ntitle: P\nupdated: 2099-01-01\nsources:\n  - code:app\n---\n' +
    'Stacked.[^code:app/src/f.sql#L2-L3][^code:app/src/f.sql#L10-L11]');
  setIndexPages(dir, 1);
}

// --- no lockfile: behavior identical to today + hint ---

test('no lockfile: findings identical to a lockless run, lock.exists false, no cite_* findings', () => {
  const dir = makeWiki();
  try {
    codeFixture(dir);
    const result = checkGrounding(dir, { page: 'entities/p.md' });
    assert.deepEqual(result.issues, []);              // snapshot: same as pre-lockfile behavior
    assert.equal(result.lock.exists, false);          // drives the one-line hint
    assert.ok(!existsSync(join(dir, LOCK_RELPATH)));  // never created implicitly
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- --update-lock bootstrap ---

test('--update-lock creates a valid lockfile; immediate re-run reports zero churn findings', () => {
  const dir = makeWiki();
  try {
    codeFixture(dir);
    writeFile(dir, 'raw/specs/foo.md', 'spec body\n');
    writeFile(dir, 'wiki/entities/r.md',
      '---\ntitle: R\nupdated: 2099-01-01\nsources:\n  - raw/specs/foo.md\n---\nClaim.[^raw/specs/foo.md]');
    setIndexPages(dir, 2);

    const first = checkGrounding(dir, { updateLock: true });
    assert.equal(first.lock.written, true);
    assert.equal(first.lock.exists, true);

    const lock = readLock(dir);
    assert.equal(lock.version, 1);
    const pCites = lock.citations['wiki/entities/p.md'];
    assert.ok(pCites['code:app/src/f.sql#L2-L3']?.hash.startsWith('sha256:'));
    assert.ok(pCites['code:app/src/f.sql#L10-L11']?.hash.startsWith('sha256:'));
    assert.ok(lock.citations['wiki/entities/r.md']['raw/specs/foo.md']?.hash.startsWith('sha256:'));
    assert.ok(lock.authorities.app);

    const again = checkGrounding(dir);
    assert.deepEqual(again.issues.filter((i) => i.issue.startsWith('cite_')), []);
    assert.deepEqual(again.issues, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- per-citation churn: surgical, not file-granular ---

test('editing a cited line -> cite_content_changed for that cite only; sibling cite into the same file stays silent', () => {
  const dir = makeWiki();
  try {
    codeFixture(dir);
    checkGrounding(dir, { updateLock: true });

    // edit line 2 in place (same line count -> nothing moved)
    const lines = numberedLines(20).split('\n');
    lines[1] = 'EDITED';
    writeFile(dir, 'authority-src/src/f.sql', lines.join('\n'));

    const { issues } = checkGrounding(dir, { page: 'entities/p.md' });
    const churn = issues.filter((i) => i.issue === 'cite_content_changed');
    assert.equal(churn.length, 1);
    assert.equal(churn[0].cite, 'code:app/src/f.sql#L2-L3');
    assert.equal(churn[0].range, 'L2-L3');
    assert.match(churn[0].locked_sha, /^sha256:/);
    assert.match(churn[0].current_sha, /^sha256:/);
    assert.notEqual(churn[0].locked_sha, churn[0].current_sha);
    // sibling cite into the same file: silent
    assert.ok(!issues.some((i) => i.cite === 'code:app/src/f.sql#L10-L11'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('whitespace-only change to a cited range is invisible (normalized hashing)', () => {
  const dir = makeWiki();
  try {
    codeFixture(dir);
    checkGrounding(dir, { updateLock: true });
    const lines = numberedLines(20).split('\n');
    lines[1] = lines[1] + '   \t';  // trailing whitespace only
    writeFile(dir, 'authority-src/src/f.sql', lines.join('\n'));
    assert.deepEqual(checkGrounding(dir, { page: 'entities/p.md' }).issues, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- cite_moved + --fix-moved ---

test('inserting lines above a cited range -> cite_moved with correct new_range; --fix-moved repairs page + lock; next run clean', () => {
  const dir = makeWiki();
  try {
    codeFixture(dir);
    checkGrounding(dir, { updateLock: true });

    // insert 3 lines at the top: cited content shifts down by 3
    writeFile(dir, 'authority-src/src/f.sql', 'new-a\nnew-b\nnew-c\n' + numberedLines(20));

    const before = checkGrounding(dir, { page: 'entities/p.md' });
    const moved = before.issues.filter((i) => i.issue === 'cite_moved');
    assert.equal(moved.length, 2);
    const m = moved.find((i) => i.cite === 'code:app/src/f.sql#L2-L3');
    assert.equal(m.old_range, 'L2-L3');
    assert.equal(m.new_range, 'L5-L6');
    assert.ok(!before.issues.some((i) => i.issue === 'cite_content_changed'));

    const fixRun = checkGrounding(dir, { page: 'entities/p.md', fixMoved: true });
    assert.equal(fixRun.fixed.length, 2);
    assert.ok(!fixRun.issues.some((i) => i.issue === 'cite_moved'));

    // page anchors rewritten
    const pageText = readFileSync(join(dir, 'wiki/entities/p.md'), 'utf8');
    assert.match(pageText, /\[\^code:app\/src\/f\.sql#L5-L6\]/);
    assert.match(pageText, /\[\^code:app\/src\/f\.sql#L13-L14\]/);
    assert.ok(!pageText.includes('#L2-L3'));

    // lock entries moved to the new keys
    const lock = readLock(dir);
    const cites = lock.citations['wiki/entities/p.md'];
    assert.ok(cites['code:app/src/f.sql#L5-L6']);
    assert.ok(!cites['code:app/src/f.sql#L2-L3']);

    // subsequent run is clean
    assert.deepEqual(checkGrounding(dir, { page: 'entities/p.md' }).issues, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate content blocks -> cite_moved_ambiguous with candidate ranges, and --fix-moved does not touch the page', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'authority-src/src/dup.sql', 'alpha\nbeta\nmid\nend\n');
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src' }]);
    writeFile(dir, 'wiki/entities/d.md',
      '---\ntitle: D\nupdated: 2099-01-01\nsources:\n  - code:app\n---\nClaim.[^code:app/src/dup.sql#L1-L2]');
    checkGrounding(dir, { updateLock: true });

    // shift the block down AND duplicate it
    writeFile(dir, 'authority-src/src/dup.sql', 'pre\nalpha\nbeta\nmid\nalpha\nbeta\nend\n');

    const { issues } = checkGrounding(dir, { page: 'entities/d.md', fixMoved: true });
    const amb = issues.find((i) => i.issue === 'cite_moved_ambiguous');
    assert.ok(amb);
    assert.deepEqual(amb.candidate_ranges, ['L2-L3', 'L5-L6']);
    assert.ok(!issues.some((i) => i.issue === 'cite_moved'));
    // no auto-fix: page anchor unchanged
    assert.match(readFileSync(join(dir, 'wiki/entities/d.md'), 'utf8'), /#L1-L2\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('single-line anchors (#L42) lock, move, and fix correctly', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'authority-src/src/one.sql', numberedLines(50));
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src' }]);
    writeFile(dir, 'wiki/entities/s.md',
      '---\ntitle: S\nupdated: 2099-01-01\nsources:\n  - code:app\n---\nClaim.[^code:app/src/one.sql#L42]');
    checkGrounding(dir, { updateLock: true });
    assert.ok(readLock(dir).citations['wiki/entities/s.md']['code:app/src/one.sql#L42']);

    writeFile(dir, 'authority-src/src/one.sql', 'inserted\n' + numberedLines(50));
    const { issues } = checkGrounding(dir, { page: 'entities/s.md' });
    const m = issues.find((i) => i.issue === 'cite_moved');
    assert.equal(m.new_range, 'L43-L43');

    checkGrounding(dir, { page: 'entities/s.md', fixMoved: true });
    assert.match(readFileSync(join(dir, 'wiki/entities/s.md'), 'utf8'), /#L43\]/);
    assert.deepEqual(checkGrounding(dir, { page: 'entities/s.md' }).issues, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- whole-file and raw cites ---

test('whole-file and raw/ cites hash and verify; content change -> cite_content_changed with range null', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'authority-src/src/whole.ts', 'export const a = 1;\n');
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src' }]);
    writeFile(dir, 'raw/specs/spec.md', 'original spec\n');
    writeFile(dir, 'wiki/entities/w.md',
      '---\ntitle: W\nupdated: 2099-01-01\nsources:\n  - code:app\n  - raw/specs/spec.md\n---\n' +
      'Code.[^code:app/src/whole.ts] Raw.[^raw/specs/spec.md]');
    checkGrounding(dir, { updateLock: true });
    assert.deepEqual(checkGrounding(dir, { page: 'entities/w.md' }).issues, []);

    writeFile(dir, 'authority-src/src/whole.ts', 'export const a = 2;\n');
    writeFile(dir, 'raw/specs/spec.md', 'rewritten spec\n');
    const { issues } = checkGrounding(dir, { page: 'entities/w.md' });
    const churn = issues.filter((i) => i.issue === 'cite_content_changed');
    assert.deepEqual(churn.map((i) => i.cite).sort(), ['code:app/src/whole.ts', 'raw/specs/spec.md']);
    assert.ok(churn.every((i) => i.range === null));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- cite_unlocked ---

test('cite_unlocked fires for unlocked cites when a lockfile exists, never when it does not', () => {
  const dir = makeWiki();
  try {
    codeFixture(dir);
    checkGrounding(dir, { updateLock: true });

    // a new page with a cite that was never locked
    writeFile(dir, 'raw/specs/new.md', 'body\n');
    writeFile(dir, 'wiki/entities/new.md',
      '---\ntitle: N\nupdated: 2099-01-01\nsources:\n  - raw/specs/new.md\n  - code:app\n---\n' +
      'A.[^raw/specs/new.md] B.[^code:app/src/f.sql#L7-L8]');
    const { issues } = checkGrounding(dir, { page: 'entities/new.md' });
    const unlocked = issues.filter((i) => i.issue === 'cite_unlocked').map((i) => i.cite).sort();
    assert.deepEqual(unlocked, ['code:app/src/f.sql#L7-L8', 'raw/specs/new.md']);

    // locking the page clears it
    checkGrounding(dir, { page: 'entities/new.md', updateLock: true });
    assert.deepEqual(checkGrounding(dir, { page: 'entities/new.md' }).issues, []);
    // and the page-scoped update preserved the other page's entries
    assert.ok(readLock(dir).citations['wiki/entities/p.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- deterministic refs: authorities block, --at-ref, dirty flag ---

test('--at-ref with a branch ref: lock authorities block records the resolved SHA; working-tree runs record HEAD + dirty', () => {
  const dir = makeWiki();
  try {
    const repo = join(dir, 'authority-src');
    initRepo(repo);
    writeFile(dir, 'authority-src/src/a.ts', numberedLines(30));
    commitAll(repo, 'base');
    const mainSha = git(repo, ['rev-parse', 'main']).trim();
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', ref: 'main' }]);
    writeFile(dir, 'wiki/entities/a.md',
      '---\ntitle: A\nupdated: 2099-01-01\nsources:\n  - code:app\n---\nClaim.[^code:app/src/a.ts#L5-L9]');

    // --at-ref run records the resolved ref SHA
    const refRun = checkGrounding(dir, { page: 'entities/a.md', atRef: true, updateLock: true });
    assert.equal(refRun.lock.written, true);
    let lock = readLock(dir);
    assert.equal(lock.authorities.app.ref, 'main');
    assert.equal(lock.authorities.app.resolved_sha, mainSha);
    assert.equal(lock.authorities.app.dirty, false);
    assert.ok(lock.authorities.app.resolved_at);

    // re-run at the ref: zero churn
    assert.deepEqual(checkGrounding(dir, { page: 'entities/a.md', atRef: true }).issues, []);

    // working-tree run with an uncommitted change: HEAD + dirty true
    writeFileSync(join(repo, 'src/extra.ts'), 'uncommitted\n');
    checkGrounding(dir, { page: 'entities/a.md', updateLock: true });
    lock = readLock(dir);
    assert.equal(lock.authorities.app.resolved_sha, mainSha); // HEAD == main here
    assert.equal(lock.authorities.app.dirty, true);
    // citation entries record which SHA they were hashed at
    assert.equal(lock.citations['wiki/entities/a.md']['code:app/src/a.ts#L5-L9'].hashed_at_sha, mainSha);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--at-ref hashes the cited range at the ref, not the working tree', () => {
  const dir = makeWiki();
  try {
    const repo = join(dir, 'authority-src');
    initRepo(repo);
    writeFile(dir, 'authority-src/src/a.ts', numberedLines(10));
    commitAll(repo, 'v1');
    git(repo, ['tag', 'v1']);
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', ref: 'v1' }]);
    writeFile(dir, 'wiki/entities/a.md',
      '---\ntitle: A\nupdated: 2099-01-01\nsources:\n  - code:app\n---\nClaim.[^code:app/src/a.ts#L2-L3]');
    checkGrounding(dir, { page: 'entities/a.md', atRef: true, updateLock: true });

    // mutate the working tree only — at the ref nothing changed
    writeFileSync(join(repo, 'src/a.ts'), 'EDIT\n' + numberedLines(10));
    assert.deepEqual(checkGrounding(dir, { page: 'entities/a.md', atRef: true }).issues, []);
    // a working-tree run sees the shift
    assert.ok(checkGrounding(dir, { page: 'entities/a.md' }).issues
      .some((i) => i.issue === 'cite_moved'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cite_content_changed replaces code_updated_after_page for locked cites; unlocked cites keep the fallback', () => {
  const dir = makeWiki();
  try {
    const repo = join(dir, 'authority-src');
    initRepo(repo);
    writeFile(dir, 'authority-src/src/a.ts', numberedLines(10));
    writeFile(dir, 'authority-src/src/b.ts', numberedLines(10));
    commitAll(repo, 'c', '2025-06-01T12:00:00');
    git(repo, ['tag', 'v1']);
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', ref: 'v1' }]);
    // page updated long before the commit at the ref -> staleness would fire
    writeFile(dir, 'wiki/entities/s.md',
      '---\ntitle: S\nupdated: 2020-01-01\nsources:\n  - code:app\n---\n' +
      'A.[^code:app/src/a.ts#L1-L2] B.[^code:app/src/b.ts#L1-L2]');

    // no lockfile: fallback fires for both cites
    const before = checkGrounding(dir, { page: 'entities/s.md', atRef: true }).issues;
    assert.equal(before.filter((i) => i.issue === 'code_updated_after_page').length, 2);

    // lock only cite A by hand-pruning the bootstrap lock
    checkGrounding(dir, { page: 'entities/s.md', atRef: true, updateLock: true });
    const lockPathAbs = join(dir, LOCK_RELPATH);
    const lock = JSON.parse(readFileSync(lockPathAbs, 'utf8'));
    delete lock.citations['wiki/entities/s.md']['code:app/src/b.ts#L1-L2'];
    writeFileSync(lockPathAbs, JSON.stringify(lock, null, 2));

    const after = checkGrounding(dir, { page: 'entities/s.md', atRef: true }).issues;
    const stale = after.filter((i) => i.issue === 'code_updated_after_page');
    assert.equal(stale.length, 1);                       // only the unlocked cite
    assert.equal(stale[0].file, 'src/b.ts');
    assert.ok(after.some((i) => i.issue === 'cite_unlocked' && i.cite === 'code:app/src/b.ts#L1-L2'));
    assert.ok(!after.some((i) => i.issue === 'cite_content_changed')); // locked cite: content unchanged -> silent
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- rounds integration ---

test('roundsReport counts the new per-citation findings in its ground total', () => {
  const dir = makeWiki();
  try {
    codeFixture(dir);
    checkGrounding(dir, { updateLock: true });
    const clean = roundsReport(dir).ground;

    const lines = numberedLines(20).split('\n');
    lines[1] = 'EDITED';
    writeFile(dir, 'authority-src/src/f.sql', lines.join('\n'));
    assert.equal(roundsReport(dir).ground, clean + 1);   // one cite_content_changed
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
