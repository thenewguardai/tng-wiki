import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
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
    { path: 'raw/a.md', line: 2 },
    { path: 'raw/b.md', line: 3 },
    { path: 'raw/c.md', line: 3 },
  ]);
  // bodyStartLine offsets to produce file-relative numbers
  assert.deepEqual(extractCitations(body, 5), [
    { path: 'raw/a.md', line: 6 },
    { path: 'raw/b.md', line: 7 },
    { path: 'raw/c.md', line: 7 },
  ]);
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
