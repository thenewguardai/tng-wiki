// #40, second wave: `ground --fix-dates` (deterministic updated-bump to the
// measured last-change date) and `tng-wiki log` (canonical emitter of the
// schema's log-entry format, types read from the wiki's own schema).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { checkGrounding } from '../src/ground.js';
import { schemaLogTypes } from '../src/log-cli.js';
import { scaffoldWiki } from '../src/init.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

function makeWiki() {
  const root = mkdtempSync(join(tmpdir(), 'tng-wiki-logdates-'));
  scaffoldWiki(root, { domain: 'blank', agent: 'claude-code', wikiName: 'LD' });
  writeFileSync(join(root, 'raw', 'a.md'), '# A\n');
  // updated: far in the past; the file's mtime is now -> frontmatter_updated_stale
  writeFileSync(join(root, 'wiki', 'p.md'), [
    '---', 'title: P', 'type: concept', 'created: 2026-07-01', 'updated: 2026-07-01',
    'sources:', '  - raw/a.md', 'tags: [t]', '---', '',
    '# P', '', 'claim.[^raw/a.md]', '',
  ].join('\n'));
  return root;
}

test('ground --fix-dates bumps updated to the measured date and consumes the finding', () => {
  const root = makeWiki();
  try {
    const before = checkGrounding(root);
    const stale = before.issues.find((i) => i.issue === 'frontmatter_updated_stale');
    assert.ok(stale, `expected staleness in ${JSON.stringify(before.issues)}`);

    const fixed = checkGrounding(root, { fixDates: true });
    assert.ok(!fixed.issues.some((i) => i.issue === 'frontmatter_updated_stale'));
    assert.equal(fixed.fixed_dates.length, 1);
    assert.equal(fixed.fixed_dates[0].from, '2026-07-01');

    const expected = statSync(join(root, 'wiki', 'p.md')).mtime.toISOString().slice(0, 10);
    assert.equal(fixed.fixed_dates[0].to, expected, 'writes exactly what the check measures (mtime fallback here)');
    const page = readFileSync(join(root, 'wiki', 'p.md'), 'utf8');
    assert.match(page, new RegExp(`^updated: ${expected}$`, 'm'));
    assert.match(page, /^created: 2026-07-01$/m, 'created untouched');

    const after = checkGrounding(root);
    assert.ok(!after.issues.some((i) => i.issue === 'frontmatter_updated_stale'), 'stays fixed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--fix-dates with no stale pages reports nothing fixed', () => {
  const root = makeWiki();
  try {
    checkGrounding(root, { fixDates: true });
    const again = checkGrounding(root, { fixDates: true });
    assert.equal(again.fixed_dates, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('schemaLogTypes reads the Types line from the generated schema', () => {
  const root = makeWiki();
  try {
    assert.deepEqual(schemaLogTypes(root), ['ingest', 'query', 'lint', 'issue-prep', 'post-publish']);
    assert.equal(schemaLogTypes(join(root, 'raw')), null, 'no schema file -> null (accept anything)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('log appends a correctly-formatted entry with the provided fields', () => {
  const root = makeWiki();
  try {
    const r = spawnSync('node', [CLI, 'log',
      '--type', 'ingest', '--desc', 'compiled the Q3 brief',
      '--source', 'raw/a.md', '--source', 'raw/b.md',
      '--created', 'wiki/p.md', '--author', 'work-machine session (claude-fable-5)',
      '--notes', 'clean run',
    ], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);

    const log = readFileSync(join(root, 'wiki', 'log.md'), 'utf8');
    assert.match(log, /^## \[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\] ingest \| compiled the Q3 brief$/m);
    assert.match(log, /^- Source: raw\/a\.md, raw\/b\.md$/m);
    assert.match(log, /^- Pages created: wiki\/p\.md$/m);
    assert.match(log, /^- Author: work-machine session \(claude-fable-5\)$/m);
    assert.match(log, /^- Notes: clean run$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('log validates --type against the schema vocabulary and requires type/desc', () => {
  const root = makeWiki();
  try {
    const bad = spawnSync('node', [CLI, 'log', '--type', 'bogus', '--desc', 'x'], { cwd: root, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /not a log type this wiki's schema declares/);
    assert.match(bad.stderr, /ingest, query, lint/);

    const noDesc = spawnSync('node', [CLI, 'log', '--type', 'ingest'], { cwd: root, encoding: 'utf8' });
    assert.equal(noDesc.status, 1);
    assert.match(noDesc.stderr, /Usage: tng-wiki log/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('log and ground --fix-dates refuse the default-wiki fallback', () => {
  const root = makeWiki();
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-logdates-home-'));
  try {
    mkdirSync(join(home, '.tng-wiki'), { recursive: true });
    writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({
      version: 1, default: 'ld',
      wikis: { ld: { name: 'LD', path: root, domain: 'blank', registered: new Date().toISOString() } },
    }));
    const neutral = join(home, 'neutral');
    mkdirSync(neutral);
    const env = { ...process.env, HOME: home, USERPROFILE: home };

    const l = spawnSync('node', [CLI, 'log', '--type', 'ingest', '--desc', 'x'], { cwd: neutral, env, encoding: 'utf8' });
    assert.equal(l.status, 1);
    assert.match(l.stderr, /refusing to append to the default wiki's log/);

    const g = spawnSync('node', [CLI, 'ground', '--fix-dates'], { cwd: neutral, env, encoding: 'utf8' });
    assert.equal(g.status, 1);
    assert.match(g.stderr, /refusing `ground --fix-dates`/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
