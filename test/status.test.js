import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { computeStatus } from '../src/status.js';

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
  assert.equal(s.outputFiles, 1);
  assert.equal(s.opCount, 3);
  assert.deepEqual(s.lastOp, { date: '2026-04-03T10:00:00', desc: 'query | Answered a question' });
  assert.equal(s.hasSchema, true);
  assert.equal(s.hasIndex, true);
  assert.equal(s.staleCount, 3);
  assert.equal(s.uncompiledCount, 2);
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
