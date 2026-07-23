// #46: search --all-wikis sweeps every registered wiki, tagging hits per wiki.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { searchAllWikis } from '../src/verbs.js';
import { scaffoldWiki } from '../src/init.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

// Two registered wikis, each with one page containing "tokenizer"; a third
// registration points at a path that no longer exists.
function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-searchall-'));
  const wikis = {};
  for (const slug of ['alpha', 'beta']) {
    const p = join(home, 'wikis', slug);
    mkdirSync(p, { recursive: true });
    scaffoldWiki(p, { domain: 'blank', agent: 'claude-code', wikiName: slug });
    writeFileSync(join(p, 'wiki', 'topic.md'), [
      '---', `title: ${slug} topic`, 'type: concept', 'created: 2026-07-23', 'updated: 2026-07-23',
      'sources:', '  - raw/a.md', 'tags: [t]', '---', '',
      `# ${slug} topic`, '', `the tokenizer notes of ${slug}.[^raw/a.md]`, '',
    ].join('\n'));
    wikis[slug] = { name: slug, path: p, domain: 'blank', registered: new Date().toISOString() };
  }
  wikis.ghost = { name: 'ghost', path: join(home, 'nope'), domain: 'blank', registered: new Date().toISOString() };
  mkdirSync(join(home, '.tng-wiki'), { recursive: true });
  writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({ version: 1, default: 'alpha', wikis }));
  return home;
}

test('searchAllWikis aggregates hits per wiki and degrades broken registrations to errors', () => {
  const home = makeHome();
  try {
    const { searched, hits, errors } = searchAllWikis('tokenizer', {}, home);
    assert.deepEqual(searched.sort(), ['alpha', 'beta', 'ghost'].filter((s) => s !== 'ghost').sort());
    assert.equal(hits.length, 2);
    assert.deepEqual(hits.map((h) => h.wiki).sort(), ['alpha', 'beta']);
    for (const h of hits) assert.match(h.text, /tokenizer/);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].wiki, 'ghost');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('CLI --all-wikis prefixes hits with the wiki slug; --json carries wiki per hit', () => {
  const home = makeHome();
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const r = spawnSync('node', [CLI, 'search', 'tokenizer', '--all-wikis'], { cwd: home, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[alpha\]/);
    assert.match(r.stdout, /\[beta\]/);
    assert.match(r.stderr, /ghost/, 'broken registration surfaces on stderr');

    const j = spawnSync('node', [CLI, 'search', 'tokenizer', '--all-wikis', '--json'], { cwd: home, env, encoding: 'utf8' });
    assert.equal(j.status, 0, j.stderr);
    const data = JSON.parse(j.stdout);
    assert.equal(data.all_wikis, true);
    assert.deepEqual(data.hits.map((h) => h.wiki).sort(), ['alpha', 'beta']);
    assert.equal(data.errors[0].wiki, 'ghost');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('--all-wikis and --wiki are mutually exclusive', () => {
  const home = makeHome();
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const r = spawnSync('node', [CLI, 'search', 'tokenizer', '--all-wikis', '--wiki', 'alpha'], { cwd: home, env, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /mutually exclusive/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
