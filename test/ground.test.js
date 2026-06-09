import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldWiki } from '../src/init.js';
import {
  splitFrontmatter, extractSources, extractCitations, checkGrounding,
  listDriftPages, listUnsourcedPages, listUnverifiedPages,
} from '../src/ground.js';

function makeWiki() {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-ground-'));
  scaffoldWiki(dir, { domain: 'blank', agent: 'claude-code', wikiName: 'Ground Demo' });
  return dir;
}

function writeFile(wikiRoot, relPath, content) {
  const full = join(wikiRoot, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

// --- parsers ---

test('splitFrontmatter separates YAML block from body', () => {
  const { frontmatter, body } = splitFrontmatter('---\ntitle: Foo\n---\nbody text');
  assert.match(frontmatter, /^title: Foo$/);
  assert.equal(body, 'body text');
});

test('splitFrontmatter returns empty frontmatter when none present', () => {
  const { frontmatter, body } = splitFrontmatter('just body');
  assert.equal(frontmatter, '');
  assert.equal(body, 'just body');
});

test('extractSources handles block list form', () => {
  const sources = extractSources('sources:\n  - raw/a.md\n  - raw/b.md\ntags: []');
  assert.deepEqual(sources, ['raw/a.md', 'raw/b.md']);
});

test('extractSources handles inline array form', () => {
  assert.deepEqual(extractSources('sources: [raw/a.md, raw/b.md]'), ['raw/a.md', 'raw/b.md']);
  assert.deepEqual(extractSources('sources: []'), []);
});

test('extractSources returns null when sources key is absent', () => {
  assert.equal(extractSources('title: Foo\ntags: []'), null);
});

test('extractSources tolerates trailing comments on the key line', () => {
  const sources = extractSources('sources:   # trust anchor\n  - raw/a.md\n  - raw/b.md');
  assert.deepEqual(sources, ['raw/a.md', 'raw/b.md']);
});

test('extractSources treats a legacy numeric count as an empty list (migration path)', () => {
  assert.deepEqual(extractSources('sources: 3'), []);
});

test('extractCitations finds [^raw/...] citations with file-relative line numbers', () => {
  const body = 'Line one.\nClaim with ref.[^raw/a.md]\nTwo refs[^raw/b.md][^raw/c.md]';
  // bodyStartLine defaults to 1 — body-only input
  assert.deepEqual(extractCitations(body), [
    { kind: 'raw', path: 'raw/a.md', line: 2 },
    { kind: 'raw', path: 'raw/b.md', line: 3 },
    { kind: 'raw', path: 'raw/c.md', line: 3 },
  ]);
  // bodyStartLine offsets to produce file-relative numbers
  assert.deepEqual(extractCitations(body, 5), [
    { kind: 'raw', path: 'raw/a.md', line: 6 },
    { kind: 'raw', path: 'raw/b.md', line: 7 },
    { kind: 'raw', path: 'raw/c.md', line: 7 },
  ]);
});

test('extractCitations recognizes [^code:<name>/<path>#L<start>-L<end>] with GitHub-style anchors', () => {
  const body = 'Claim.[^code:legacy-app/src/auth/oauth.ts#L42-L58]';
  assert.deepEqual(extractCitations(body), [{
    kind: 'code',
    path: 'code:legacy-app',
    authority: 'legacy-app',
    file: 'src/auth/oauth.ts',
    range: { start: 42, end: 58 },
    line: 1,
  }]);
});

test('extractCitations recognizes single-line and whole-file code citations', () => {
  const singleLine = extractCitations('Claim.[^code:app/src/a.ts#L42]');
  assert.equal(singleLine[0].range.start, 42);
  assert.equal(singleLine[0].range.end, 42);

  const wholeFile = extractCitations('Claim.[^code:app/src/a.ts]');
  assert.equal(wholeFile[0].file, 'src/a.ts');
  assert.ok(!wholeFile[0].range);

  const authorityOnly = extractCitations('Claim.[^code:app]');
  assert.equal(authorityOnly[0].authority, 'app');
  assert.equal(authorityOnly[0].file, null);
});

// --- checkGrounding ---

test('checkGrounding flags empty_sources on pages without a sources list', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'wiki/entities/a.md', '---\ntitle: A\n---\nClaim.');
    const { issues } = checkGrounding(dir);
    const hit = issues.find((i) => i.page === 'wiki/entities/a.md' && i.issue === 'empty_sources');
    assert.ok(hit);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkGrounding flags undeclared_cite when inline ref is not in frontmatter', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'raw/papers/ok.md', 'body');
    writeFile(dir, 'wiki/entities/b.md', '---\nsources:\n  - raw/papers/ok.md\n---\nClaim uses [^raw/papers/other.md].');
    writeFile(dir, 'raw/papers/other.md', 'body');
    const { issues } = checkGrounding(dir);
    const hit = issues.find((i) => i.issue === 'undeclared_cite' && i.raw === 'raw/papers/other.md');
    assert.ok(hit);
    // file-relative: frontmatter occupies lines 1-4, citation is on line 5
    assert.equal(hit.line, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkGrounding flags orphan_source_decl when frontmatter lists a source never cited', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'raw/papers/cited.md', 'body');
    writeFile(dir, 'raw/papers/orphan.md', 'body');
    writeFile(dir, 'wiki/entities/c.md', '---\nsources:\n  - raw/papers/cited.md\n  - raw/papers/orphan.md\n---\nOne cite.[^raw/papers/cited.md]');
    const { issues } = checkGrounding(dir);
    const hit = issues.find((i) => i.issue === 'orphan_source_decl' && i.raw === 'raw/papers/orphan.md');
    assert.ok(hit);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkGrounding flags missing_raw when a cited or declared source file does not exist', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'wiki/entities/d.md', '---\nsources:\n  - raw/papers/missing.md\n---\nClaim.[^raw/papers/missing.md]');
    const { issues } = checkGrounding(dir);
    const hits = issues.filter((i) => i.issue === 'missing_raw' && i.raw === 'raw/papers/missing.md');
    assert.ok(hits.length >= 1);
    // inline citation line captured; file-relative (frontmatter lines 1-4, body starts at 5)
    assert.ok(hits.some((h) => h.line === 5));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkGrounding flags source_updated_after_page when raw mtime is newer than page updated', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'raw/papers/new.md', 'body');
    // bump the raw file's mtime to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    utimesSync(join(dir, 'raw/papers/new.md'), tomorrow, tomorrow);

    writeFile(dir, 'wiki/entities/e.md', '---\nupdated: 2020-01-01\nsources:\n  - raw/papers/new.md\n---\nClaim.[^raw/papers/new.md]');
    const { issues } = checkGrounding(dir);
    const hit = issues.find((i) => i.issue === 'source_updated_after_page');
    assert.ok(hit);
    assert.equal(hit.raw, 'raw/papers/new.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkGrounding excludes structural pages (index.md, log.md)', () => {
  const dir = makeWiki();
  try {
    // index.md and log.md exist from scaffoldWiki but have no `sources:` —
    // they must NOT be flagged
    const { issues } = checkGrounding(dir);
    assert.ok(!issues.some((i) => i.page === 'wiki/index.md'));
    assert.ok(!issues.some((i) => i.page === 'wiki/log.md'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkGrounding excludes _-prefixed template files and wiki/meta/*', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'wiki/_template.md', '---\ntitle: Template\n---\nNo sources by design.');
    writeFile(dir, 'wiki/opportunities/_scoring-criteria.md', '---\ntitle: Scoring\n---\nNo sources by design.');
    writeFile(dir, 'wiki/meta/coverage-map.md', '---\ntitle: Coverage\n---\nNo sources by design.');
    const { issues } = checkGrounding(dir);
    assert.ok(!issues.some((i) => i.page === 'wiki/_template.md'));
    assert.ok(!issues.some((i) => i.page === 'wiki/opportunities/_scoring-criteria.md'));
    assert.ok(!issues.some((i) => i.page === 'wiki/meta/coverage-map.md'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkGrounding with --page scopes to a single file', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'wiki/entities/scoped.md', '---\ntitle: S\n---\nClaim.');
    writeFile(dir, 'wiki/entities/other.md', '---\ntitle: O\n---\nClaim.');
    const { scanned, issues } = checkGrounding(dir, { page: 'entities/scoped.md' });
    assert.equal(scanned, 1);
    assert.ok(issues.every((i) => i.page === 'wiki/entities/scoped.md'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkGrounding returns zero issues on a clean page', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'raw/papers/clean.md', 'body');
    writeFile(dir, 'wiki/entities/clean.md', '---\ntitle: C\nupdated: 2099-01-01\nsources:\n  - raw/papers/clean.md\n---\nCited claim.[^raw/papers/clean.md]');
    const { issues } = checkGrounding(dir, { page: 'entities/clean.md' });
    assert.deepEqual(issues, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- code authorities ---

function setCodeAuthorities(wikiRoot, authorities) {
  const metaPath = join(wikiRoot, '.tng-wiki.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  meta.code_authorities = authorities;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

test('checkGrounding flags unknown_code_authority when frontmatter names an authority not in .tng-wiki.json', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'wiki/entities/c.md', '---\nsources:\n  - code:ghost\n---\nClaim.[^code:ghost/src/a.ts]');
    const { issues } = checkGrounding(dir);
    const hit = issues.find((i) => i.issue === 'unknown_code_authority' && i.authority === 'ghost');
    assert.ok(hit);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkGrounding flags missing_code_file when a code citation resolves to nothing on disk', () => {
  const dir = makeWiki();
  try {
    // stand up a fake code authority tree alongside the wiki
    writeFile(dir, '../legacy-app/src/real.ts', 'export const ok = 1;');
    setCodeAuthorities(dir, [{ name: 'legacy', path: '../legacy-app' }]);
    writeFile(dir, 'wiki/entities/c.md', '---\nsources:\n  - code:legacy\n---\nClaim.[^code:legacy/src/gone.ts#L1-L10]');
    const { issues } = checkGrounding(dir);
    const hit = issues.find((i) => i.issue === 'missing_code_file' && i.file === 'src/gone.ts');
    assert.ok(hit);
    assert.equal(hit.authority, 'legacy');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dir, '..', 'legacy-app'), { recursive: true, force: true });
  }
});

test('checkGrounding is clean on a page cited purely against a registered code authority', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, '../legacy-app/src/auth/oauth.ts', Array(100).fill('line').join('\n'));
    setCodeAuthorities(dir, [{ name: 'legacy', path: '../legacy-app' }]);
    writeFile(dir, 'wiki/entities/auth.md',
      '---\ntitle: Auth\nupdated: 2099-01-01\nsources:\n  - code:legacy\n---\n' +
      'Implicit flow, no PKCE.[^code:legacy/src/auth/oauth.ts#L42-L58]');
    const { issues } = checkGrounding(dir, { page: 'entities/auth.md' });
    assert.deepEqual(issues, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dir, '..', 'legacy-app'), { recursive: true, force: true });
  }
});

test('checkGrounding expands ~/ in authority paths to the home directory (issue #16)', () => {
  const dir = makeWiki();
  const fakeHome = mkdtempSync(join(tmpdir(), 'tng-wiki-home-'));
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  try {
    // os.homedir() reads $HOME (POSIX) / %USERPROFILE% (Windows) at call time
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    writeFile(fakeHome, 'legacy-app/src/a.ts', Array.from({ length: 50 }, (_, i) => `l${i + 1}`).join('\n'));
    setCodeAuthorities(dir, [{ name: 'legacy', path: '~/legacy-app' }]);
    writeFile(dir, 'wiki/entities/h.md',
      '---\ntitle: H\nupdated: 2099-01-01\nsources:\n  - code:legacy\n---\nClaim.[^code:legacy/src/a.ts#L1-L10]');
    // without expansion, resolve(wikiRoot, '~/legacy-app') treats `~` as a
    // literal directory and this would flag missing_code_file
    assert.deepEqual(checkGrounding(dir, { page: 'entities/h.md' }).issues, []);
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldProfile;
    rmSync(dir, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('checkGrounding flags undeclared_cite when an inline [^code:...] has no frontmatter entry', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, '../legacy-app/src/a.ts', 'x');
    setCodeAuthorities(dir, [{ name: 'legacy', path: '../legacy-app' }]);
    writeFile(dir, 'wiki/entities/u.md',
      '---\nsources: []\n---\nClaim.[^code:legacy/src/a.ts]');
    const { issues } = checkGrounding(dir);
    const hit = issues.find((i) => i.issue === 'undeclared_cite' && i.raw === 'code:legacy');
    assert.ok(hit);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dir, '..', 'legacy-app'), { recursive: true, force: true });
  }
});

// --- marker verbs ---

test('listDriftPages / listUnsourcedPages / listUnverifiedPages each match only their marker', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'wiki/entities/drift.md', 'body ⚠️ DRIFT? [evidence] more');
    writeFile(dir, 'wiki/entities/unsourced.md', 'body ⚠️ UNSOURCED? another ⚠️ UNSOURCED?');
    writeFile(dir, 'wiki/entities/unverified.md', 'body ⚠️ UNVERIFIED?');
    writeFile(dir, 'wiki/entities/stale.md', 'body ⚠️ STALE?');

    const drift = listDriftPages(dir);
    assert.equal(drift.length, 1);
    assert.equal(drift[0].path, 'wiki/entities/drift.md');

    const uns = listUnsourcedPages(dir);
    assert.equal(uns.length, 1);
    assert.equal(uns[0].count, 2);

    const unv = listUnverifiedPages(dir);
    assert.equal(unv.length, 1);
    assert.equal(unv[0].path, 'wiki/entities/unverified.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- code authorities: exclude globs + line ranges (always-on) ---

test('checkGrounding flags excluded_code_file when a cite targets an excluded path', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'authority-src/README.md', '# docs\n');
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', exclude: ['**/*.md'] }]);
    writeFile(dir, 'wiki/entities/x.md',
      '---\nsources:\n  - code:app\n---\nClaim.[^code:app/README.md]');
    const { issues } = checkGrounding(dir, { page: 'entities/x.md' });
    const excl = issues.filter((i) => i.issue === 'excluded_code_file');
    assert.equal(excl.length, 1);
    assert.equal(excl[0].file, 'README.md');
    assert.ok(!issues.some((i) => i.issue === 'missing_code_file')); // file exists, not missing
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excluded_code_file takes precedence — an excluded path that is also absent flags only excluded', () => {
  const dir = makeWiki();
  try {
    mkdirSync(join(dir, 'authority-src'), { recursive: true }); // empty authority tree
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', exclude: ['**/*.md'] }]);
    writeFile(dir, 'wiki/entities/x.md',
      '---\nsources:\n  - code:app\n---\nClaim.[^code:app/docs/gone.md]');
    const { issues } = checkGrounding(dir, { page: 'entities/x.md' });
    assert.ok(issues.some((i) => i.issue === 'excluded_code_file' && i.file === 'docs/gone.md'));
    assert.ok(!issues.some((i) => i.issue === 'missing_code_file'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkGrounding flags code_line_out_of_range when the cited range exceeds the file', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'authority-src/src/a.ts', Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n'));
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src' }]);
    writeFile(dir, 'wiki/entities/over.md',
      '---\ntitle: O\nupdated: 2099-01-01\nsources:\n  - code:app\n---\nClaim.[^code:app/src/a.ts#L5-L20]');
    const over = checkGrounding(dir, { page: 'entities/over.md' }).issues;
    assert.ok(over.some((i) => i.issue === 'code_line_out_of_range' && i.file === 'src/a.ts'));

    writeFile(dir, 'wiki/entities/inbounds.md',
      '---\ntitle: K\nupdated: 2099-01-01\nsources:\n  - code:app\n---\nClaim.[^code:app/src/a.ts#L1-L10]');
    assert.deepEqual(checkGrounding(dir, { page: 'entities/inbounds.md' }).issues, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('code_line_out_of_range is skipped on a missing file (only missing_code_file)', () => {
  const dir = makeWiki();
  try {
    mkdirSync(join(dir, 'authority-src'), { recursive: true });
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src' }]);
    writeFile(dir, 'wiki/entities/m.md',
      '---\nsources:\n  - code:app\n---\nClaim.[^code:app/src/gone.ts#L1-L9999]');
    const { issues } = checkGrounding(dir, { page: 'entities/m.md' });
    assert.ok(issues.some((i) => i.issue === 'missing_code_file'));
    assert.ok(!issues.some((i) => i.issue === 'code_line_out_of_range'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- code authorities at a git ref (--at-ref) ---

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(repo, gitArgs, extraEnv = {}) {
  execFileSync('git', ['-C', repo, ...gitArgs], { stdio: 'pipe', env: { ...GIT_ENV, ...extraEnv } });
}

function initRepo(repo) {
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-b', 'main']);
}

function commitAll(repo, msg, date = '2025-06-01T12:00:00') {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', msg], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
}

test('--at-ref: clean when the cited file exists at the pinned ref', () => {
  const dir = makeWiki();
  try {
    const repo = join(dir, 'authority-src');
    initRepo(repo);
    writeFile(dir, 'authority-src/src/a.ts', Array.from({ length: 60 }, (_, i) => `l${i + 1}`).join('\n'));
    commitAll(repo, 'v1');
    git(repo, ['tag', 'v1.0.0']);
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', ref: 'v1.0.0' }]);
    writeFile(dir, 'wiki/entities/auth.md',
      '---\ntitle: A\nupdated: 2099-01-01\nsources:\n  - code:app\n---\nClaim.[^code:app/src/a.ts#L42-L58]');
    assert.deepEqual(checkGrounding(dir, { page: 'entities/auth.md', atRef: true }).issues, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--at-ref: file present in working tree but absent at ref -> missing_code_file with ref; default ignores ref', () => {
  const dir = makeWiki();
  try {
    const repo = join(dir, 'authority-src');
    initRepo(repo);
    writeFile(dir, 'authority-src/src/keep.ts', 'export const keep = 1;\n');
    commitAll(repo, 'base');
    git(repo, ['tag', 'v0']);
    // add a file to the working tree only (never committed at v0)
    writeFileSync(join(repo, 'src/new.ts'), 'export const n = 1;\n');
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', ref: 'v0' }]);
    writeFile(dir, 'wiki/entities/n.md',
      '---\ntitle: N\nupdated: 2099-01-01\nsources:\n  - code:app\n---\nClaim.[^code:app/src/new.ts]');

    const miss = checkGrounding(dir, { page: 'entities/n.md', atRef: true }).issues
      .find((i) => i.issue === 'missing_code_file');
    assert.ok(miss);
    assert.equal(miss.ref, 'v0');
    assert.equal(miss.file, 'src/new.ts');

    // default mode: ref ignored, working tree has the file -> clean (backwards-compat)
    assert.deepEqual(checkGrounding(dir, { page: 'entities/n.md' }).issues, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--at-ref: line range is checked against file content at the ref', () => {
  const dir = makeWiki();
  try {
    const repo = join(dir, 'authority-src');
    initRepo(repo);
    writeFile(dir, 'authority-src/src/a.ts', Array.from({ length: 5 }, (_, i) => `l${i + 1}`).join('\n'));
    commitAll(repo, 'short');
    git(repo, ['tag', 'v1']);
    // grow the working-tree copy to 50 lines (uncommitted)
    writeFileSync(join(repo, 'src/a.ts'), Array.from({ length: 50 }, (_, i) => `l${i + 1}`).join('\n'));
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', ref: 'v1' }]);
    writeFile(dir, 'wiki/entities/r.md',
      '---\ntitle: R\nupdated: 2099-01-01\nsources:\n  - code:app\n---\nClaim.[^code:app/src/a.ts#L1-L40]');

    assert.ok(checkGrounding(dir, { page: 'entities/r.md', atRef: true }).issues
      .some((i) => i.issue === 'code_line_out_of_range')); // 40 > 5 at ref
    assert.deepEqual(checkGrounding(dir, { page: 'entities/r.md' }).issues, []); // 40 <= 50 in tree
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--at-ref: code_updated_after_page fires when the page predates the ref commit, clean otherwise', () => {
  const dir = makeWiki();
  try {
    const repo = join(dir, 'authority-src');
    initRepo(repo);
    writeFile(dir, 'authority-src/src/a.ts', 'export const a = 1;\n');
    commitAll(repo, 'c', '2025-06-01T12:00:00');
    git(repo, ['tag', 'v1']);
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', ref: 'v1' }]);

    writeFile(dir, 'wiki/entities/stale.md',
      '---\ntitle: S\nupdated: 2020-01-01\nsources:\n  - code:app\n---\nClaim.[^code:app/src/a.ts]');
    const hit = checkGrounding(dir, { page: 'entities/stale.md', atRef: true }).issues
      .find((i) => i.issue === 'code_updated_after_page');
    assert.ok(hit);
    assert.match(hit.source_commit, /^\d{4}-\d{2}-\d{2}$/);

    writeFile(dir, 'wiki/entities/fresh.md',
      '---\ntitle: F\nupdated: 2099-01-01\nsources:\n  - code:app\n---\nClaim.[^code:app/src/a.ts]');
    assert.ok(!checkGrounding(dir, { page: 'entities/fresh.md', atRef: true }).issues
      .some((i) => i.issue === 'code_updated_after_page'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--at-ref: code_ref_unresolvable is flagged once per authority for a bad ref, and file checks are skipped', () => {
  const dir = makeWiki();
  try {
    const repo = join(dir, 'authority-src');
    initRepo(repo);
    writeFile(dir, 'authority-src/src/a.ts', 'x\n');
    commitAll(repo, 'c');
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', ref: 'nope' }]);
    writeFile(dir, 'wiki/entities/b.md',
      '---\nsources:\n  - code:app\n---\nTwo cites.[^code:app/src/a.ts][^code:app/src/a.ts#L1]');
    const issues = checkGrounding(dir, { page: 'entities/b.md', atRef: true }).issues;
    const unres = issues.filter((i) => i.issue === 'code_ref_unresolvable');
    assert.equal(unres.length, 1); // once, despite two cites
    assert.equal(unres[0].ref, 'nope');
    assert.ok(!issues.some((i) => i.issue === 'missing_code_file')); // can't read at a bad ref
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--at-ref: a non-git authority path with a ref flags code_ref_unresolvable without crashing', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'authority-src/src/a.ts', 'x\n'); // plain dir, never `git init`-ed
    setCodeAuthorities(dir, [{ name: 'app', path: 'authority-src', ref: 'v1' }]);
    writeFile(dir, 'wiki/entities/c.md',
      '---\nsources:\n  - code:app\n---\nClaim.[^code:app/src/a.ts]');
    assert.ok(checkGrounding(dir, { page: 'entities/c.md', atRef: true }).issues
      .some((i) => i.issue === 'code_ref_unresolvable' && i.ref === 'v1'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--at-ref: ref-d and working-tree authorities coexist in one run', () => {
  const dir = makeWiki();
  try {
    const repo = join(dir, 'reffed');
    initRepo(repo);
    writeFile(dir, 'reffed/src/a.ts', Array.from({ length: 80 }, (_, i) => `l${i + 1}`).join('\n'));
    commitAll(repo, 'c');
    git(repo, ['tag', 'v1']);
    writeFile(dir, 'plain/src/b.ts', Array.from({ length: 30 }, (_, i) => `l${i + 1}`).join('\n'));
    setCodeAuthorities(dir, [
      { name: 'reffed', path: 'reffed', ref: 'v1' },
      { name: 'plain', path: 'plain' },
    ]);
    writeFile(dir, 'wiki/entities/mix.md',
      '---\ntitle: M\nupdated: 2099-01-01\nsources:\n  - code:reffed\n  - code:plain\n---\n' +
      'A.[^code:reffed/src/a.ts#L10-L20]\nB.[^code:plain/src/b.ts#L1-L5]');
    assert.deepEqual(checkGrounding(dir, { page: 'entities/mix.md', atRef: true }).issues, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- raw-source staleness: git commit-date + date granularity ---

test('raw staleness uses git commit-date, not mtime (survives clone mtime reset)', () => {
  const dir = makeWiki();
  try {
    git(dir, ['init', '-b', 'main']); // make the WIKI itself a git repo
    writeFile(dir, 'raw/papers/src.md', 'body');
    commitAll(dir, 'add source', '2020-01-01 12:00:00 +0000'); // commit-date 2020
    // simulate a post-clone mtime reset: bump the file's mtime far into the future
    const future = new Date('2099-01-01T00:00:00Z');
    utimesSync(join(dir, 'raw/papers/src.md'), future, future);
    writeFile(dir, 'wiki/entities/p.md',
      '---\nupdated: 2026-01-01\nsources:\n  - raw/papers/src.md\n---\nClaim.[^raw/papers/src.md]');
    // commit-date 2020 < page updated 2026 -> NOT stale, despite mtime = 2099
    assert.ok(!checkGrounding(dir, { page: 'entities/p.md' }).issues
      .some((i) => i.issue === 'source_updated_after_page'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('raw staleness flags when a source commit-date is newer than the page updated', () => {
  const dir = makeWiki();
  try {
    git(dir, ['init', '-b', 'main']);
    writeFile(dir, 'raw/papers/src.md', 'body');
    commitAll(dir, 'future source', '2099-01-01 12:00:00 +0000');
    writeFile(dir, 'wiki/entities/p.md',
      '---\nupdated: 2020-01-01\nsources:\n  - raw/papers/src.md\n---\nClaim.[^raw/papers/src.md]');
    const hit = checkGrounding(dir, { page: 'entities/p.md' }).issues
      .find((i) => i.issue === 'source_updated_after_page');
    assert.ok(hit);
    assert.ok(hit.source_mtime > '2020-01-01');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('raw staleness does not fire when source and page share the same date (date granularity)', () => {
  const dir = makeWiki();
  try {
    git(dir, ['init', '-b', 'main']);
    writeFile(dir, 'raw/papers/src.md', 'body');
    commitAll(dir, 'same day', '2026-06-03 12:00:00 +0000');
    writeFile(dir, 'wiki/entities/p.md',
      '---\nupdated: 2026-06-03\nsources:\n  - raw/papers/src.md\n---\nClaim.[^raw/papers/src.md]');
    assert.ok(!checkGrounding(dir, { page: 'entities/p.md' }).issues
      .some((i) => i.issue === 'source_updated_after_page'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marker lint verbs skip _-prefixed templates and wiki/meta/*', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'wiki/_template.md', 'example ⚠️ DRIFT? and ⚠️ STALE?');
    writeFile(dir, 'wiki/meta/notes.md', 'health ⚠️ UNSOURCED?');
    writeFile(dir, 'wiki/entities/real.md', 'claim ⚠️ DRIFT?');
    assert.deepEqual(listDriftPages(dir).map((p) => p.path), ['wiki/entities/real.md']);
    assert.equal(listUnsourcedPages(dir).length, 0); // only the exempt meta file had it
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
