// `tng-wiki split --dry-run` (#51): the boundary-change analysis. Fixture: a
// wiki with a compliance zone (two pages), a staying handbook page, a shared
// raw source, a code authority, and a real lockfile built by ground
// --update-lock - then planSplit extracts the zone and we assert every section
// of the report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync } from 'fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { scaffoldWiki } from '../src/init.js';
import { checkGrounding } from '../src/ground.js';
import { planSplit, extractWikilinks } from '../src/split.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

function writeFile(root, relPath, content) {
  const full = join(root, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-split-'));
  scaffoldWiki(dir, { domain: 'blank', agent: 'claude-code', wikiName: 'Split Demo' });

  // code authority with a citable file
  const repo = join(dir, 'authority');
  writeFile(dir, 'authority/src/a.js', 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
  const metaPath = join(dir, '.tng-wiki.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  meta.code_authorities = [{ name: 'eng', path: 'authority' }];
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  // raw sources: one zone-private, one shared with a staying page, one residue file
  writeFile(dir, 'raw/comp/policy-src.md', '---\ntitle: Policy Source\ncompiled: true\n---\npolicy evidence\n');
  writeFile(dir, 'raw/shared/notes.md', '---\ntitle: Shared Notes\ncompiled: true\n---\nshared evidence\n');
  writeFile(dir, 'raw/comp/leftover.txt', 'zone residue not cited by anything\n');

  // moved zone: two pages, linked to each other and outward
  writeFile(dir, 'wiki/zones/comp/policy.md', [
    '---',
    'title: Policy',
    'updated: 2026-08-01',
    'sources:',
    '  - raw/comp/policy-src.md',
    '  - code:eng',
    '---',
    'Claim about policy.[^raw/comp/policy-src.md]',
    'Code-backed claim.[^code:eng/src/a.js#L1-L2]',
    'See [[audit]] and the [[handbook]].',
    '',
  ].join('\n'));
  writeFile(dir, 'wiki/zones/comp/audit.md', [
    '---',
    'title: Audit',
    'updated: 2026-08-01',
    'sources:',
    '  - raw/shared/notes.md',
    '---',
    'Audit claim.[^raw/shared/notes.md]',
    '',
  ].join('\n'));

  // staying page: cites the shared raw source, links a moved page
  writeFile(dir, 'wiki/handbook.md', [
    '---',
    'title: Handbook',
    'updated: 2026-08-01',
    'sources:',
    '  - raw/shared/notes.md',
    '---',
    'Handbook claim.[^raw/shared/notes.md]',
    'Compliance details live in [[policy]].',
    '',
  ].join('\n'));

  // index rows referencing a moved and a staying page
  appendFileSync(join(dir, 'wiki', 'index.md'), '\n- [[policy]] - compliance policy\n- [[handbook]] - the handbook\n');

  // real lockfile: 3 citations (2 raw + 1 code) across the three pages
  const ground = checkGrounding(dir, { updateLock: true });
  assert.equal(ground.lock.written, true);
  return dir;
}

function plan(dir, overrides = {}) {
  return planSplit(dir, {
    selectors: ['zones/comp'],
    intoPath: join(dir, '..', 'comp-wiki'),
    destSlug: 'comp-wiki',
    sourceSlug: 'split-demo',
    home: mkdtempSync(join(tmpdir(), 'tng-wiki-split-home-')),
    ...overrides,
  });
}

test('planSplit partitions pages, raw sources, lock entries, and links', (t) => {
  const dir = makeFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = plan(dir);

  // pages: the zone moves, the handbook stays
  assert.deepEqual(p.pages, ['wiki/zones/comp/audit.md', 'wiki/zones/comp/policy.md']);
  assert.ok(p.staying_count >= 1);
  assert.deepEqual(p.unmatched_selectors, []);

  // raw: zone-private moves, shared copies (still cited by the handbook), residue named
  assert.deepEqual(p.raw.move, ['raw/comp/policy-src.md']);
  assert.deepEqual(p.raw.copy, [{ path: 'raw/shared/notes.md', staying_citers: 1 }]);
  assert.deepEqual(p.raw.missing, []);
  assert.deepEqual(p.raw.residue, [{ dir: 'raw/comp', files: ['leftover.txt'] }]);

  // lock: policy has 2 entries (raw + code), audit has 1; authority provenance carried
  assert.equal(p.lock.present, true);
  assert.equal(p.lock.entries, 3);
  assert.equal(p.lock.pages_locked, 2);
  assert.equal(p.lock.unlocked_cites, 0);
  assert.deepEqual(p.lock.authorities, ['eng']);

  // manifest carry-over: the eng authority, relative path flagged as such
  assert.equal(p.authorities.length, 1);
  assert.equal(p.authorities[0].name, 'eng');
  assert.equal(p.authorities[0].form, 'relative');
  assert.equal(p.authorities[0].resolvable, true);
  assert.deepEqual(p.unknown_authorities, []);

  // links: audit<-policy is internal; handbook link goes outbound; policy link inbound
  assert.equal(p.links.internal, 1);
  assert.deepEqual(p.links.outbound, [{ page: 'wiki/zones/comp/policy.md', target: 'handbook', line: 10 }]);
  assert.deepEqual(p.links.inbound, [{ page: 'wiki/handbook.md', target: 'policy', line: 8 }]);
  assert.deepEqual(p.links.ambiguous, []);

  // index rows: only the [[policy]] row references a moved page
  assert.equal(p.index_rows, 1);
});

test('planSplit reports unlocked cites and absent lockfile honestly', (t) => {
  const dir = makeFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // a new cite added after the lock run arrives unlocked
  appendFileSync(join(dir, 'wiki/zones/comp/policy.md'), 'New claim.[^code:eng/src/a.js#L3]\n');
  const withNew = plan(dir);
  assert.equal(withNew.lock.unlocked_cites, 1);
  assert.equal(withNew.lock.entries, 3); // existing entries still transplant

  // no lockfile at all -> present:false, nothing to transplant
  rmSync(join(dir, 'wiki', '.tng-wiki.lock.json'));
  const noLock = plan(dir);
  assert.equal(noLock.lock.present, false);
  assert.equal(noLock.lock.entries, 0);
});

test('planSplit selector forms and failure modes', (t) => {
  const dir = makeFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // exact page path and stem path both select
  const one = plan(dir, { selectors: ['zones/comp/policy.md'] });
  assert.deepEqual(one.pages, ['wiki/zones/comp/policy.md']);
  const stem = plan(dir, { selectors: ['wiki/zones/comp/policy'] });
  assert.deepEqual(stem.pages, ['wiki/zones/comp/policy.md']);

  // a selector that matches nothing is reported when others match...
  const mixed = plan(dir, { selectors: ['zones/comp', 'nope/**'] });
  assert.deepEqual(mixed.unmatched_selectors, ['nope/**']);
  // ...and throws when nothing matches at all
  assert.throws(() => plan(dir, { selectors: ['nope/**'] }), /matched no pages/);

  // index.md / log.md are structural and never selectable
  const grabAll = plan(dir, { selectors: ['**'] });
  assert.ok(!grabAll.pages.some((p) => p.endsWith('/index.md') || p.endsWith('/log.md')));
});

test('planSplit flags destination problems', (t) => {
  const dir = makeFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const nested = plan(dir, { intoPath: join(dir, 'sub-wiki') });
  assert.equal(nested.dest.inside_source, true);

  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-split-home-'));
  writeFile(home, '.tng-wiki/registry.json', JSON.stringify({
    version: 1, default: 'other', wikis: { 'comp-wiki': { name: 'Other', path: '/somewhere/else', domain: 'blank' } },
  }));
  const conflict = plan(dir, { home });
  assert.equal(conflict.dest.slug_conflict, '/somewhere/else');
});

test('extractWikilinks skips fences, inline code, and qualified links', () => {
  const body = [
    'A [[real-link]] here.',
    '```',
    'a [[fenced-link]] is not a link',
    '```',
    'inline `[[code-link]]` is not a link',
    'a [[shared:cross-wiki]] link names its wiki already',
  ].join('\n');
  assert.deepEqual(extractWikilinks(body, 1), [{ target: 'real-link', line: 1 }]);
});

test('CLI: split refuses to run without --dry-run and renders the report with it', (t) => {
  const dir = makeFixture();
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-split-home-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  const env = { ...process.env, HOME: home };
  const run = (args, opts = {}) => execFileSync(process.execPath, [CLI, 'split', ...args], {
    cwd: dir, env, encoding: 'utf8', stdio: 'pipe', ...opts,
  });

  // no --dry-run -> hard error naming the limitation
  assert.throws(
    () => run(['--pages', 'zones/comp', '--into', join(dir, '..', 'comp-wiki')]),
    (err) => /dry-run only/.test(String(err.stderr)),
  );

  // --dry-run --json -> full structured report
  const out = run(['--pages', 'zones/comp', '--into', join(dir, '..', 'comp-wiki'), '--dry-run', '--json']);
  const report = JSON.parse(out);
  assert.equal(report.dry_run, true);
  assert.equal(report.pages.length, 2);
  assert.equal(report.lock.entries, 3);
  assert.equal(report.dest.slug, 'comp-wiki');

  // human render mentions the load-bearing warnings
  const human = run(['--pages', 'zones/comp', '--into', join(dir, '..', 'comp-wiki'), '--dry-run']);
  assert.match(human, /Split dry run/);
  assert.match(human, /transfer verbatim/);
  assert.match(human, /orphaned-claim risk/);
  assert.match(human, /nothing was written/i);
});
