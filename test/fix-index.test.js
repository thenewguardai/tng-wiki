// #40: `ground --fix-index` deterministically repairs index_header_drift -
// the check already measures the true page count and newest page date, so the
// fixer just writes them back into the scaffold header.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkGrounding } from '../src/ground.js';
import { scaffoldWiki } from '../src/init.js';

function makeDriftedWiki() {
  const root = mkdtempSync(join(tmpdir(), 'tng-wiki-fixindex-'));
  scaffoldWiki(root, { domain: 'blank', agent: 'claude-code', wikiName: 'Fix' });
  // one real page the scaffold header (Total pages: 0) does not know about
  writeFileSync(join(root, 'wiki', 'p.md'), [
    '---', 'title: P', 'type: concept', 'created: 2026-07-23', 'updated: 2026-07-23',
    'sources:', '  - raw/a.md', 'tags: [t]', '---', '',
    '# P', '', 'claim.[^raw/a.md]', '',
  ].join('\n'));
  writeFileSync(join(root, 'raw', 'a.md'), '# A\n');
  return root;
}

test('ground --fix-index rewrites the header and clears the finding', () => {
  const root = makeDriftedWiki();
  try {
    const before = checkGrounding(root);
    const drift = before.issues.find((i) => i.issue === 'index_header_drift');
    assert.ok(drift, `expected drift in ${JSON.stringify(before.issues)}`);

    const fixed = checkGrounding(root, { fixIndex: true });
    assert.ok(!fixed.issues.some((i) => i.issue === 'index_header_drift'), 'finding is consumed by the fix');
    assert.equal(fixed.fixed_index.pages, drift.actual_pages);
    assert.equal(fixed.fixed_index.was_pages, drift.expected_pages);

    const header = readFileSync(join(root, 'wiki', 'index.md'), 'utf8');
    assert.match(header, new RegExp(`_Last updated: \\d{4}-\\d{2}-\\d{2} \\| Total pages: ${drift.actual_pages}`));

    const after = checkGrounding(root);
    assert.ok(!after.issues.some((i) => i.issue === 'index_header_drift'), 'drift stays fixed on the next run');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fix-index leaves the rest of the header line and file intact', () => {
  const root = makeDriftedWiki();
  try {
    const original = readFileSync(join(root, 'wiki', 'index.md'), 'utf8');
    assert.match(original, /Total sources: 0_/);
    checkGrounding(root, { fixIndex: true });
    const patched = readFileSync(join(root, 'wiki', 'index.md'), 'utf8');
    assert.match(patched, /Total sources: 0_/, 'sources segment untouched');
    assert.equal(patched.split('\n').length, original.split('\n').length, 'no lines added or removed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fix-index is a no-op flag when the header is already correct', () => {
  const root = makeDriftedWiki();
  try {
    checkGrounding(root, { fixIndex: true });
    const again = checkGrounding(root, { fixIndex: true });
    assert.equal(again.fixed_index, undefined, 'nothing to fix, nothing reported fixed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
