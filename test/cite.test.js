import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldWiki } from '../src/init.js';
import { citeShow, extractClaim, citeKey } from '../src/cite.js';
import { SKILL_CONTENT } from '../src/skill.js';
import { commandJson } from '../src/help.js';

function makeWiki() {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-cite-'));
  scaffoldWiki(dir, { domain: 'blank', agent: 'claude-code', wikiName: 'Cite Demo' });
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

// --- claim extraction ---

test('extractClaim takes the sentence from the previous boundary up to the marker', () => {
  const line = 'First sentence here. Build a 367-day candidate calendar via a recursive CTE.[^code:app/src/a.sql#L17-L24]';
  const claim = extractClaim(line, line.indexOf('[^'));
  assert.equal(claim, 'Build a 367-day candidate calendar via a recursive CTE.');
});

test('extractClaim from line start when there is no earlier sentence', () => {
  const line = 'Implicit flow, no PKCE.[^code:app/src/auth.ts#L42]';
  assert.equal(extractClaim(line, line.indexOf('[^')), 'Implicit flow, no PKCE.');
});

test('extractClaim shares the claim across stacked cites and strips trailing markers', () => {
  const line = 'Two refs back this claim.[^raw/a.md][^raw/b.md]';
  const first = line.indexOf('[^raw/a.md]');
  const second = line.indexOf('[^raw/b.md]');
  assert.equal(extractClaim(line, first), 'Two refs back this claim.');
  assert.equal(extractClaim(line, second), 'Two refs back this claim.');
});

test('extractClaim treats an earlier mid-line cite marker as a boundary', () => {
  const line = 'First claim.[^raw/a.md] Second claim here.[^raw/b.md]';
  assert.equal(extractClaim(line, line.indexOf('[^raw/b.md]')), 'Second claim here.');
});

test('extractClaim scopes to the table cell containing the cite', () => {
  const line = '| window calc | uses a recursive CTE[^code:app/src/a.sql#L17-L24] | yes |';
  assert.equal(extractClaim(line, line.indexOf('[^')), 'uses a recursive CTE');
});

// --- citeKey ---

test('citeKey reconstructs canonical raw, ranged, single-line, whole-file, and authority-only keys', () => {
  assert.equal(citeKey({ kind: 'raw', path: 'raw/a.md' }), 'raw/a.md');
  assert.equal(citeKey({ kind: 'code', authority: 'app', file: 'src/a.ts', range: { start: 4, end: 9 } }), 'code:app/src/a.ts#L4-L9');
  assert.equal(citeKey({ kind: 'code', authority: 'app', file: 'src/a.ts', range: { start: 4, end: 4 } }), 'code:app/src/a.ts#L4');
  assert.equal(citeKey({ kind: 'code', authority: 'app', file: 'src/a.ts' }), 'code:app/src/a.ts');
  assert.equal(citeKey({ kind: 'code', authority: 'app', file: null }), 'code:app');
});

// --- citeShow: fixture page covering raw / ranged / whole-file / stacked / table cites ---

function makeFixture() {
  const dir = makeWiki();
  writeFile(dir, 'raw/papers/a.md', Array.from({ length: 30 }, (_, i) => `raw line ${i + 1}`).join('\n') + '\n');
  writeFile(dir, 'raw/papers/b.md', 'short raw\n');
  writeFile(dir, 'authority-src/src/a.sql', Array.from({ length: 24 }, (_, i) => `sql line ${i + 1}`).join('\n') + '\n');
  writeFile(dir, 'authority-src/src/whole.ts', Array.from({ length: 50 }, (_, i) => `ts line ${i + 1}`).join('\n') + '\n');
  setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src' }]);
  writeFile(dir, 'wiki/entities/fixture.md', [
    '---',
    'title: Fixture',
    'updated: 2099-01-01',
    'sources:',
    '  - raw/papers/a.md',
    '  - raw/papers/b.md',
    '  - code:app',
    '---',
    '',
    'Intro sentence. The calendar is built by a recursive CTE.[^code:app/src/a.sql#L17-L24]',
    '',
    'The whole module is authoritative.[^code:app/src/whole.ts]',
    '',
    'Two sources back this.[^raw/papers/a.md][^raw/papers/b.md]',
    '',
    '| feature | evidence |',
    '| --- | --- |',
    '| calendar | seeded from @start_date[^code:app/src/a.sql#L17] |',
  ].join('\n'));
  return dir;
}

test('citeShow renders raw, code-ranged, code-whole-file, stacked, and table-cell cites in document order', () => {
  const dir = makeFixture();
  try {
    const entries = citeShow(dir, 'entities/fixture.md');
    assert.equal(entries.length, 5);
    assert.deepEqual(entries.map((e) => e.index), [1, 2, 3, 4, 5]);
    assert.deepEqual(entries.map((e) => e.cite), [
      'code:app/src/a.sql#L17-L24',
      'code:app/src/whole.ts',
      'raw/papers/a.md',
      'raw/papers/b.md',
      'code:app/src/a.sql#L17',
    ]);

    // [1] code-ranged: exact range, claim from previous sentence boundary
    assert.equal(entries[0].kind, 'code');
    assert.equal(entries[0].claim, 'The calendar is built by a recursive CTE.');
    assert.equal(entries[0].claim_line, 10);
    assert.deepEqual(entries[0].range, { start: 17, end: 24 });
    assert.equal(entries[0].lines.length, 8);
    assert.equal(entries[0].lines[0], 'sql line 17');
    assert.equal(entries[0].lines[7], 'sql line 24');
    assert.equal(entries[0].error, null);

    // [2] code whole-file: first 20 lines by default, truncated
    assert.equal(entries[1].range, null);
    assert.equal(entries[1].lines.length, 20);
    assert.equal(entries[1].lines[0], 'ts line 1');
    assert.equal(entries[1].truncated, true);
    assert.equal(entries[1].claim, 'The whole module is authoritative.');

    // [3]+[4] stacked raw cites share the claim sentence
    assert.equal(entries[2].kind, 'raw');
    assert.equal(entries[2].claim, 'Two sources back this.');
    assert.equal(entries[3].claim, 'Two sources back this.');
    assert.equal(entries[2].lines.length, 20); // 30-line raw file, default context
    assert.equal(entries[2].truncated, true);
    assert.deepEqual(entries[3].lines, ['short raw']);
    assert.equal(entries[3].truncated, false);

    // [5] table-cell cite: claim scoped to its cell, single-line range
    assert.equal(entries[4].claim, 'seeded from @start_date');
    assert.deepEqual(entries[4].range, { start: 17, end: 17 });
    assert.deepEqual(entries[4].lines, ['sql line 17']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('citeShow --context widens raw and whole-file cites but not ranged ones', () => {
  const dir = makeFixture();
  try {
    const entries = citeShow(dir, 'entities/fixture.md', { context: 30 });
    assert.equal(entries[2].lines.length, 30);
    assert.equal(entries[2].truncated, false);
    assert.equal(entries[1].lines.length, 30);
    assert.equal(entries[0].lines.length, 8); // ranged cite unaffected
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('citeShow --cite filters by index and by literal key, keeping original indices', () => {
  const dir = makeFixture();
  try {
    const byIndex = citeShow(dir, 'entities/fixture.md', { only: '3' });
    assert.equal(byIndex.length, 1);
    assert.equal(byIndex[0].index, 3);
    assert.equal(byIndex[0].cite, 'raw/papers/a.md');

    const byKey = citeShow(dir, 'entities/fixture.md', { only: 'code:app/src/a.sql#L17-L24' });
    assert.equal(byKey.length, 1);
    assert.equal(byKey[0].index, 1);

    assert.deepEqual(citeShow(dir, 'entities/fixture.md', { only: 'nope' }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('citeShow accepts wiki/-prefixed page paths (composes with ground --page output)', () => {
  const dir = makeFixture();
  try {
    const a = citeShow(dir, 'entities/fixture.md');
    const b = citeShow(dir, 'wiki/entities/fixture.md');
    assert.deepEqual(a, b);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('citeShow returns [] for a page with no citations and throws for a missing page', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'wiki/entities/plain.md', '---\ntitle: P\n---\nNo cites here.');
    assert.deepEqual(citeShow(dir, 'entities/plain.md'), []);
    assert.throws(() => citeShow(dir, 'entities/gone.md'), /Page not found/);
    assert.throws(() => citeShow(dir, '../secrets.md'), /escapes the wiki directory/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- per-cite degradation ---

test('citeShow degrades per-cite: missing targets carry ground finding names, good cites still resolve', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'authority-src/src/real.ts', 'export const ok = 1;\n');
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src' }]);
    writeFile(dir, 'wiki/entities/mixed.md', [
      '---',
      'sources:',
      '  - code:app',
      '---',
      'Good claim.[^code:app/src/real.ts#L1]',
      'Dead code cite.[^code:app/src/gone.ts#L1-L9]',
      'Dead raw cite.[^raw/papers/gone.md]',
      'Ghost authority.[^code:ghost/src/a.ts]',
      'Range past EOF.[^code:app/src/real.ts#L99-L120]',
    ].join('\n'));

    const entries = citeShow(dir, 'entities/mixed.md');
    assert.equal(entries.length, 5);
    assert.equal(entries[0].error, null);
    assert.deepEqual(entries[0].lines, ['export const ok = 1;']);
    assert.equal(entries[1].error, 'missing_code_file');
    assert.equal(entries[2].error, 'missing_raw');
    assert.equal(entries[3].error, 'unknown_code_authority');
    assert.equal(entries[4].error, 'code_line_out_of_range');
    // errored cites still report claim + location so a human can jump
    assert.equal(entries[1].claim, 'Dead code cite.');
    assert.equal(entries[1].claim_line, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('citeShow flags code_line_out_of_range like checkGrounding: end past EOF and inverted ranges, never silent truncation', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'authority-src/src/small.ts', 'line 1\nline 2\nline 3\nline 4\nline 5\n');
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src' }]);
    writeFile(dir, 'wiki/entities/range.md', [
      '---',
      'sources:',
      '  - code:app',
      '---',
      'End past EOF.[^code:app/src/small.ts#L2-L999]',
      'Inverted range.[^code:app/src/small.ts#L4-L2]',
      'Exactly at EOF.[^code:app/src/small.ts#L3-L5]',
    ].join('\n'));

    const entries = citeShow(dir, 'entities/range.md');
    // valid start but end past EOF: per-cite error, no truncated slice
    assert.equal(entries[0].error, 'code_line_out_of_range');
    assert.deepEqual(entries[0].lines, []);
    assert.equal(entries[0].truncated, false);
    // start > end is out of range too (matches checkGrounding)
    assert.equal(entries[1].error, 'code_line_out_of_range');
    // a range ending exactly at EOF is fine
    assert.equal(entries[2].error, null);
    assert.deepEqual(entries[2].lines, ['line 3', 'line 4', 'line 5']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('citeShow refuses raw cites that escape the wiki root via ..', () => {
  const dir = makeWiki();
  try {
    // a real file just outside the wiki root that the cite tries to reach
    writeFileSync(join(dir, '..', 'cite-escape-secret.txt'), 'top secret\n');
    writeFile(dir, 'wiki/entities/esc.md', [
      '---',
      'title: Esc',
      '---',
      'Sneaky claim.[^raw/../../cite-escape-secret.txt]',
    ].join('\n'));

    const [e] = citeShow(dir, 'entities/esc.md');
    assert.equal(e.error, 'path_escapes_root');
    assert.deepEqual(e.lines, []);
  } finally {
    rmSync(join(dir, '..', 'cite-escape-secret.txt'), { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('citeShow refuses code cites that escape the authority root via .. (working tree and --at-ref)', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'authority-src/src/a.ts', 'x\n');
    writeFile(dir, 'outside-authority/secrets.txt', 'hunter2\n'); // inside wiki, outside the authority
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', ref: 'v1' }]);
    writeFile(dir, 'wiki/entities/esc.md', [
      '---',
      'sources:',
      '  - code:app',
      '---',
      'Sneaky claim.[^code:app/../outside-authority/secrets.txt]',
    ].join('\n'));

    const [tree] = citeShow(dir, 'entities/esc.md');
    assert.equal(tree.error, 'path_escapes_root');
    assert.deepEqual(tree.lines, []);

    // the guard fires before the ref route too
    const [atRef] = citeShow(dir, 'entities/esc.md', { atRef: true });
    assert.equal(atRef.error, 'path_escapes_root');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('citeShow handles a whole-authority cite (no file) without lines or error', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'authority-src/src/a.ts', 'x\n');
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src' }]);
    writeFile(dir, 'wiki/entities/w.md', '---\nsources:\n  - code:app\n---\nWhole tree.[^code:app]');
    const [e] = citeShow(dir, 'entities/w.md');
    assert.equal(e.cite, 'code:app');
    assert.equal(e.file, null);
    assert.equal(e.error, null);
    assert.deepEqual(e.lines, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- --at-ref ---

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(repo, gitArgs) {
  execFileSync('git', ['-C', repo, ...gitArgs], { stdio: 'pipe', env: GIT_ENV });
}

test('citeShow --at-ref shows ref content that differs from the working tree', () => {
  const dir = makeWiki();
  try {
    const repo = join(dir, 'authority-src');
    mkdirSync(repo, { recursive: true });
    git(repo, ['init', '-b', 'main']);
    writeFile(dir, 'authority-src/src/a.ts', 'old line 1\nold line 2\nold line 3\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'v1']);
    git(repo, ['tag', 'v1']);
    // diverge the working tree (uncommitted)
    writeFileSync(join(repo, 'src/a.ts'), 'new line 1\nnew line 2\nnew line 3\n');
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', ref: 'v1' }]);
    writeFile(dir, 'wiki/entities/r.md', '---\nsources:\n  - code:app\n---\nClaim.[^code:app/src/a.ts#L1-L2]');

    const tree = citeShow(dir, 'entities/r.md');
    assert.deepEqual(tree[0].lines, ['new line 1', 'new line 2']);

    const atRef = citeShow(dir, 'entities/r.md', { atRef: true });
    assert.deepEqual(atRef[0].lines, ['old line 1', 'old line 2']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('citeShow --at-ref flags code_ref_unresolvable per-cite for a bad ref', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'authority-src/src/a.ts', 'x\n'); // plain dir, never git init-ed
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', ref: 'v1' }]);
    writeFile(dir, 'wiki/entities/c.md', '---\nsources:\n  - code:app\n---\nClaim.[^code:app/src/a.ts]');
    const [e] = citeShow(dir, 'entities/c.md', { atRef: true });
    assert.equal(e.error, 'code_ref_unresolvable');
    // default mode is untouched by the bad ref
    assert.equal(citeShow(dir, 'entities/c.md')[0].error, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- JSON shape + surface parity ---

test('citeShow entries carry the documented --json shape', () => {
  const dir = makeFixture();
  try {
    for (const e of citeShow(dir, 'entities/fixture.md')) {
      assert.deepEqual(Object.keys(e), [
        'index', 'cite', 'kind', 'authority', 'file', 'range',
        'claim', 'claim_line', 'lines', 'truncated', 'error',
      ]);
      assert.ok(Number.isInteger(e.index) && e.index >= 1);
      assert.ok(['raw', 'code'].includes(e.kind));
      assert.ok(Array.isArray(e.lines) && e.lines.every((l) => typeof l === 'string'));
      assert.ok(Number.isInteger(e.claim_line));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('help.js documents cite with the expected flags', () => {
  const c = commandJson('cite');
  assert.ok(c);
  assert.equal(c.group, 'Grounding & lint');
  assert.deepEqual(c.flags.map((f) => f.name), ['--wiki', '--at-ref', '--cite', '--context', '--json']);
});

test('generated SKILL.md mentions cite show in the reconcile workflow', () => {
  const reconcile = SKILL_CONTENT.split('### Reconcile workflow')[1];
  assert.ok(reconcile, 'reconcile workflow section exists');
  assert.match(reconcile, /cite show/);
});
