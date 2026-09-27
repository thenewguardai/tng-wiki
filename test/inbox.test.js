// `tng-wiki inbox`: pending _inbox/ captures across every registered wiki.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { scaffoldWiki } from '../src/init.js';
import { loadRegistry, registerWiki, saveRegistry } from '../src/registry.js';
import { collectInbox } from '../src/inbox.js';

const CLI = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin', 'cli.js');

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-inbox-'));
  let registry = loadRegistry(home);
  for (const name of ['alpha', 'beta']) {
    const p = join(home, 'wikis', name);
    mkdirSync(p, { recursive: true });
    scaffoldWiki(p, { domain: 'blank', agent: 'claude-code', wikiName: name });
    registry = registerWiki(registry, { name, path: p, domain: 'blank' });
  }
  saveRegistry(registry, home);
  const alphaInbox = join(home, 'wikis', 'alpha', '_inbox');
  mkdirSync(join(alphaInbox, 'nested'), { recursive: true });
  writeFileSync(join(alphaInbox, '2026-09-27-first.md'),
    '---\ntitle: First capture\ncaptured_on: legion\nalso: [beta, gamma]\n---\n# First capture\n');
  writeFileSync(join(alphaInbox, 'nested', 'note.md'), '# A heading only\n');
  writeFileSync(join(alphaInbox, '.gitkeep'), '');
  return home;
}

test('collectInbox lists every registered wiki, with titles, also hints, and origin host', () => {
  const home = makeHome();
  try {
    const result = collectInbox({ home });
    const alpha = result.wikis.find((w) => w.slug === 'alpha');
    const beta = result.wikis.find((w) => w.slug === 'beta');
    assert.equal(result.total, 2);
    assert.deepEqual(alpha.items.map((i) => i.path), ['2026-09-27-first.md', 'nested/note.md']);
    const first = alpha.items[0];
    assert.equal(first.title, 'First capture');
    assert.deepEqual(first.also, ['beta', 'gamma']);
    assert.equal(first.captured_on, 'legion');
    assert.equal(alpha.items[1].title, 'A heading only');
    assert.deepEqual(alpha.items[1].also, []);
    assert.equal(typeof first.age_days, 'number');
    assert.deepEqual(beta.items, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('collectInbox --wiki scopes to one wiki and rejects an unknown slug', () => {
  const home = makeHome();
  try {
    const result = collectInbox({ home, only: 'beta' });
    assert.deepEqual(result.wikis.map((w) => w.slug), ['beta']);
    assert.equal(result.total, 0);
    assert.throws(() => collectInbox({ home, only: 'nope' }), /No wiki registered under slug "nope"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('inbox CLI --json matches collectInbox', () => {
  const home = makeHome();
  try {
    const r = spawnSync('node', [CLI, 'inbox', '--json'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.total, 2);
    const text = spawnSync('node', [CLI, 'inbox'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    assert.match(text.stdout, /alpha/);
    assert.match(text.stdout, /First capture/);
    assert.match(text.stdout, /also: beta, gamma/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
