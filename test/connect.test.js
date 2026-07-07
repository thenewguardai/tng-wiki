import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildConnectBlock, applyManagedBlock, removeManagedBlock } from '../src/connect.js';
import { scaffoldWiki } from '../src/init.js';

const wiki = { slug: 'infra', name: 'Infra', domain: 'software-engineering', description: 'local infra', path: '/home/x/wiki' };
const blockCount = (s) => (s.match(/<!-- tng-wiki:connect -->/g) || []).length;

test('buildConnectBlock includes name, slug, domain, description, path, and search guidance', () => {
  const b = buildConnectBlock(wiki);
  assert.match(b, /Infra/);
  assert.match(b, /`infra`/);
  assert.match(b, /software-engineering/);
  assert.match(b, /local infra/);
  assert.match(b, /\/home\/x\/wiki/);
  assert.match(b, /tng-wiki search/);
  assert.match(b, /<!-- tng-wiki:connect -->/);
});

test('buildConnectBlock omits the description clause when there is no description', () => {
  const b = buildConnectBlock({ ...wiki, description: '' });
  assert.match(b, /\*\*software-engineering\*\* is registered/);
  assert.ok(!b.includes('**software-engineering** —'));
});

test('buildConnectBlock omits the domain clause for the blank catch-all domain', () => {
  const b = buildConnectBlock({ ...wiki, domain: 'blank' });
  assert.ok(!b.includes('for **blank**'));
  assert.match(b, /A tng-wiki knowledge base is registered on this machine/);
  // a real domain still gets its clause
  assert.match(buildConnectBlock(wiki), /for \*\*software-engineering\*\* is registered/);
});

test('buildConnectBlock never emits an em-dash (it is written into other repos)', () => {
  // with and without a description, and with a description that itself contains one
  assert.ok(!buildConnectBlock(wiki).includes('—'));
  assert.ok(!buildConnectBlock({ ...wiki, description: '' }).includes('—'));
  assert.ok(!buildConnectBlock({ ...wiki, description: 'a — b' }).includes('—'));
});

test('buildConnectBlock does not run a period-terminated description into the next word', () => {
  // regression: "...Blackwell sm_120 quirks. is registered at ..." (doubled punctuation)
  const b = buildConnectBlock({ ...wiki, description: 'Blackwell sm_120 quirks.' });
  assert.ok(!b.includes('quirks. is registered'));
  assert.match(b, /It covers Blackwell sm_120 quirks\./);
  // exactly one period after the scope clause, never two
  assert.ok(!b.includes('quirks..'));
});

test('buildConnectBlock surfaces the _inbox drop-off only when the wiki has one', () => {
  const without = buildConnectBlock(wiki);
  assert.ok(!without.includes('_inbox'));
  assert.match(without, /follow its `AGENTS\.md`/);

  const withInbox = buildConnectBlock({ ...wiki, inbox: true });
  assert.match(withInbox, /\/home\/x\/wiki\/_inbox\//);
  assert.match(withInbox, /capture is cheap, filing is careful/);
  assert.ok(!withInbox.includes('—'));
});

test('applyManagedBlock inserts into empty, then updates in place (idempotent)', () => {
  const once = applyManagedBlock('', buildConnectBlock(wiki));
  assert.equal(blockCount(once), 1);
  const twice = applyManagedBlock(once, buildConnectBlock({ ...wiki, description: 'changed' }));
  assert.equal(blockCount(twice), 1);       // no stacking
  assert.match(twice, /changed/);
  assert.ok(!twice.includes('local infra')); // old block replaced
});

test('applyManagedBlock appends below existing unrelated content', () => {
  const out = applyManagedBlock('# My repo notes\n\nstuff\n', buildConnectBlock(wiki));
  assert.match(out, /^# My repo notes/);
  assert.equal(blockCount(out), 1);
});

test('removeManagedBlock strips the block, preserving other content', () => {
  // only-block -> empty
  assert.equal(removeManagedBlock(applyManagedBlock('', buildConnectBlock(wiki))), '');
  // content + block -> content
  const stripped = removeManagedBlock(applyManagedBlock('# Notes\n\nkeep me\n', buildConnectBlock(wiki)));
  assert.match(stripped, /# Notes/);
  assert.match(stripped, /keep me/);
  assert.ok(!stripped.includes('tng-wiki:connect'));
});

// --- ~ expansion in registry wiki paths (issue #16) ---

test('connect expands a ~ wiki path from the registry before reading the description', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-conn-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'tng-wiki-conn-repo-'));
  try {
    // wiki lives under the fake home; the registry refers to it via `~/...`
    const wikiPath = join(home, 'wikis', 'demo');
    mkdirSync(wikiPath, { recursive: true });
    scaffoldWiki(wikiPath, { domain: 'blank', agent: 'claude-code', wikiName: 'Demo' });
    const meta = JSON.parse(readFileSync(join(wikiPath, '.tng-wiki.json'), 'utf8'));
    meta.description = 'tilde-resolved wiki';
    writeFileSync(join(wikiPath, '.tng-wiki.json'), JSON.stringify(meta, null, 2));

    mkdirSync(join(home, '.tng-wiki'), { recursive: true });
    writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({
      version: 1,
      default: 'demo',
      wikis: { demo: { name: 'Demo', path: '~/wikis/demo', domain: 'blank', registered: new Date().toISOString() } },
    }));

    const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
    const run = spawnSync('node', [CLI, 'connect', repo, '--wiki', 'demo'], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);

    const block = readFileSync(join(repo, 'CLAUDE.local.md'), 'utf8');
    assert.ok(block.includes(wikiPath), 'block should embed the expanded path');
    assert.ok(!block.includes('`~/wikis/demo`'), 'block should not embed the raw ~ path');
    assert.match(block, /tilde-resolved wiki/); // description was readable through the expanded path
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});
