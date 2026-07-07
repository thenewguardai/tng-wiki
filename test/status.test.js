import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { computeStatus, resolveStatusRoot } from '../src/status.js';
import { saveRegistry, emptyRegistry, registerWiki } from '../src/registry.js';

let dir;

function writeWiki(tree) {
  for (const [relPath, content] of Object.entries(tree)) {
    const full = join(dir, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tng-wiki-status-'));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('computeStatus returns isWiki:false when raw/ or wiki/ are missing', () => {
  const empty = mkdtempSync(join(tmpdir(), 'tng-wiki-empty-'));
  try {
    assert.deepEqual(computeStatus(empty), { isWiki: false, root: empty });
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('computeStatus counts markdown files, ops, stale markers, and uncompiled sources', () => {
  writeWiki({
    'CLAUDE.md': '# schema',
    'wiki/index.md': '# index',
    'wiki/log.md': [
      '# log',
      '## [2026-04-01T10:00:00] init | Wiki initialized',
      '## [2026-04-02T10:00:00] ingest | First source',
      '## [2026-04-03T10:00:00] query | Answered a question',
    ].join('\n'),
    'wiki/entities/acme.md': 'content ⚠️ STALE? old',
    'wiki/entities/beta.md': 'clean content',
    'wiki/entities/gamma.md': 'two ⚠️ STALE? and ⚠️ STALE? more',
    'raw/papers/a.md': '---\ncompiled: false\n---\nbody',
    'raw/papers/b.md': '---\ncompiled: true\n---\nbody',
    'raw/social/c.md': '---\ncompiled: false\n---\nbody',
    'output/briefings/draft.md': 'draft',
  });

  const s = computeStatus(dir);

  assert.equal(s.isWiki, true);
  assert.equal(s.rawFiles, 3);
  assert.equal(s.wikiPages, 5); // index.md + log.md + 3 entities
  assert.equal(s.groundablePages, 3); // ground exemptions drop index.md + log.md
  assert.equal(s.outputFiles, 1);
  assert.equal(s.opCount, 3);
  assert.deepEqual(s.lastOp, { date: '2026-04-03T10:00:00', desc: 'query | Answered a question' });
  assert.equal(s.hasSchema, true);
  assert.equal(s.hasIndex, true);
  assert.equal(s.staleCount, 3);
  assert.equal(s.uncompiledCount, 2);
  assert.equal(s.inboxCount, null); // no _inbox/ — this wiki doesn't use one
});

test('computeStatus counts _inbox items pending triage when the dir exists', () => {
  const boxed = mkdtempSync(join(tmpdir(), 'tng-wiki-inbox-'));
  try {
    mkdirSync(join(boxed, 'wiki'), { recursive: true });
    mkdirSync(join(boxed, 'raw'), { recursive: true });
    mkdirSync(join(boxed, '_inbox'), { recursive: true });
    assert.equal(computeStatus(boxed).inboxCount, 0);
    writeFileSync(join(boxed, '_inbox', 'capture.md'), '# dropped', 'utf8');
    writeFileSync(join(boxed, '_inbox', 'notes.txt'), 'non-markdown counts too', 'utf8');
    assert.equal(computeStatus(boxed).inboxCount, 2);
  } finally {
    rmSync(boxed, { recursive: true, force: true });
  }
});

test('computeStatus flags missing schema and missing index', () => {
  const bare = mkdtempSync(join(tmpdir(), 'tng-wiki-bare-'));
  try {
    mkdirSync(join(bare, 'wiki'), { recursive: true });
    mkdirSync(join(bare, 'raw'), { recursive: true });
    const s = computeStatus(bare);
    assert.equal(s.isWiki, true);
    assert.equal(s.hasSchema, false);
    assert.equal(s.hasIndex, false);
    assert.equal(s.opCount, 0);
    assert.equal(s.lastOp, null);
    assert.equal(s.rawFiles, 0);
    assert.equal(s.wikiPages, 0);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

// --- resolveStatusRoot (registry-aware resolution, same semantics as query) ---

test('resolveStatusRoot resolves --wiki <slug> through the registry from any cwd', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-status-home-'));
  try {
    const reg = registerWiki(emptyRegistry(), { name: 'Demo', path: '/tmp/demo-wiki', domain: 'blank' });
    saveRegistry(reg, home);
    const { root, slug } = resolveStatusRoot(['--wiki', 'demo'], home);
    assert.equal(root, resolve('/tmp/demo-wiki'));
    assert.equal(slug, 'demo');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resolveStatusRoot with no args uses the registered default', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-status-home-'));
  try {
    const reg = registerWiki(emptyRegistry(), { name: 'Demo', path: '/tmp/demo-wiki', domain: 'blank' });
    saveRegistry(reg, home);
    const { root, slug } = resolveStatusRoot([], home);
    assert.equal(root, resolve('/tmp/demo-wiki'));
    assert.equal(slug, 'demo');
    // flags alone (e.g. --json) still resolve the default
    assert.equal(resolveStatusRoot(['--json'], home).slug, 'demo');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resolveStatusRoot explicit path bypasses the registry', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-status-home-'));
  try {
    saveRegistry(emptyRegistry(), home); // no registered wikis at all
    const { root, slug } = resolveStatusRoot(['/tmp/explicit-wiki'], home);
    assert.equal(root, resolve('/tmp/explicit-wiki'));
    assert.equal(slug, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resolveStatusRoot matches query semantics: unknown slug and missing default throw', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-status-home-'));
  try {
    saveRegistry(emptyRegistry(), home);
    assert.throws(() => resolveStatusRoot(['--wiki', 'nope'], home), /No wiki registered/);
    assert.throws(() => resolveStatusRoot([], home), /No default wiki/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resolveStatusRoot rejects an explicit path combined with --wiki', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-status-home-'));
  try {
    const reg = registerWiki(emptyRegistry(), { name: 'Demo', path: '/tmp/demo-wiki', domain: 'blank' });
    saveRegistry(reg, home);
    assert.throws(
      () => resolveStatusRoot(['/tmp/explicit-wiki', '--wiki', 'demo'], home),
      /either a path .* or --wiki demo, not both/,
    );
    // flag-first ordering is rejected the same way
    assert.throws(
      () => resolveStatusRoot(['--wiki', 'demo', '/tmp/explicit-wiki'], home),
      /not both/,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resolveStatusRoot does not mistake the --wiki value for an explicit path', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-status-home-'));
  try {
    const reg = registerWiki(emptyRegistry(), { name: 'Demo', path: '/tmp/demo-wiki', domain: 'blank' });
    saveRegistry(reg, home);
    const { root } = resolveStatusRoot(['--wiki', 'demo', '--json'], home);
    assert.equal(root, resolve('/tmp/demo-wiki'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
