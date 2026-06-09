import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runChecks, recommendNextStep } from '../src/doctor.js';

function fakeDeps(overrides = {}) {
  return {
    commandExists: () => true,
    trimCmd: (cmd) => `${cmd} 1.0.0`,
    detectObsidian: () => '/home/user/Obsidian',
    nodeVersion: 'v20.0.0',
    ...overrides,
  };
}

function checkByName(checks, name) {
  return checks.find(c => c.name === name);
}

test('runChecks flags Node < 18 as a required failure', () => {
  const checks = runChecks('/tmp', fakeDeps({ nodeVersion: 'v16.14.0' }));
  const node = checkByName(checks, 'Node.js');
  assert.equal(node.ok, false);
  assert.ok(!node.optional);
  assert.match(node.detail, /need >=18/);
});

test('runChecks accepts Node >= 18', () => {
  const checks = runChecks('/tmp', fakeDeps({ nodeVersion: 'v20.11.0' }));
  assert.equal(checkByName(checks, 'Node.js').ok, true);
});

test('runChecks marks git/claude absence as required failures, qmd/codex/obsidian as optional', () => {
  const checks = runChecks('/tmp', fakeDeps({ commandExists: () => false, detectObsidian: () => null }));

  assert.equal(checkByName(checks, 'Git').ok, false);
  assert.ok(!checkByName(checks, 'Git').optional);

  assert.equal(checkByName(checks, 'Claude Code').ok, false);
  assert.ok(!checkByName(checks, 'Claude Code').optional);

  assert.equal(checkByName(checks, 'OpenAI Codex').optional, true);
  assert.equal(checkByName(checks, 'QMD').optional, true);
  assert.equal(checkByName(checks, 'Obsidian location').optional, true);
});

test('runChecks on a non-wiki directory flags missing wiki and omits schema check', () => {
  const bare = mkdtempSync(join(tmpdir(), 'tng-wiki-doc-'));
  try {
    const checks = runChecks(bare, fakeDeps());
    assert.equal(checkByName(checks, 'Wiki directory').ok, false);
    assert.equal(checkByName(checks, 'Schema file'), undefined);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

test('runChecks on a wiki directory with schema passes both wiki and schema checks', () => {
  const wiki = mkdtempSync(join(tmpdir(), 'tng-wiki-doc-'));
  try {
    mkdirSync(join(wiki, 'wiki'));
    mkdirSync(join(wiki, 'raw'));
    writeFileSync(join(wiki, 'CLAUDE.md'), '# schema');
    const checks = runChecks(wiki, fakeDeps());
    assert.equal(checkByName(checks, 'Wiki directory').ok, true);
    assert.equal(checkByName(checks, 'Schema file').ok, true);
  } finally {
    rmSync(wiki, { recursive: true, force: true });
  }
});

test('runChecks on a wiki directory missing every schema file flags the schema check', () => {
  const wiki = mkdtempSync(join(tmpdir(), 'tng-wiki-doc-'));
  try {
    mkdirSync(join(wiki, 'wiki'));
    mkdirSync(join(wiki, 'raw'));
    const checks = runChecks(wiki, fakeDeps());
    assert.equal(checkByName(checks, 'Schema file').ok, false);
  } finally {
    rmSync(wiki, { recursive: true, force: true });
  }
});

// --- code-authority rows (issue #16) ---

function makeWikiDir(authorities) {
  const wiki = mkdtempSync(join(tmpdir(), 'tng-wiki-doc-'));
  mkdirSync(join(wiki, 'wiki'));
  mkdirSync(join(wiki, 'raw'));
  writeFileSync(join(wiki, 'CLAUDE.md'), '# schema');
  if (authorities) {
    writeFileSync(join(wiki, '.tng-wiki.json'), JSON.stringify({ version: 1, code_authorities: authorities }));
  }
  return wiki;
}

test('runChecks adds an optional row per code authority with path form and existence', () => {
  const wiki = makeWikiDir([
    { name: 'sibling', path: 'authority-src' },          // relative, exists
    { name: 'machine', path: '/nonexistent/elsewhere' }, // absolute, missing
  ]);
  try {
    mkdirSync(join(wiki, 'authority-src'));
    const checks = runChecks(wiki, fakeDeps());

    const sibling = checkByName(checks, 'Code authority "sibling"');
    assert.equal(sibling.ok, true);
    assert.equal(sibling.optional, true);
    assert.match(sibling.detail, /relative path, exists/);
    assert.ok(!sibling.detail.includes("won't travel"));

    const machine = checkByName(checks, 'Code authority "machine"');
    assert.equal(machine.ok, false);
    assert.equal(machine.optional, true);
    assert.match(machine.detail, /absolute path, missing on this machine/);
    assert.match(machine.detail, /⚠ won't travel across machines/);
  } finally {
    rmSync(wiki, { recursive: true, force: true });
  }
});

test('runChecks resolves ~ authority paths against the home directory', () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'tng-wiki-doc-home-'));
  const wiki = makeWikiDir([{ name: 'home-tree', path: '~/legacy-app' }]);
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  try {
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    mkdirSync(join(fakeHome, 'legacy-app'));
    const row = checkByName(runChecks(wiki, fakeDeps()), 'Code authority "home-tree"');
    assert.equal(row.ok, true);
    assert.match(row.detail, /~ path, exists/);
    assert.ok(!row.detail.includes("won't travel")); // ~ travels (per-user)
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldProfile;
    rmSync(wiki, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('runChecks emits no authority rows without .tng-wiki.json or code_authorities', () => {
  const wiki = makeWikiDir(null);
  try {
    const rows = runChecks(wiki, fakeDeps()).filter((c) => c.name.startsWith('Code authority'));
    assert.deepEqual(rows, []);
  } finally {
    rmSync(wiki, { recursive: true, force: true });
  }
});

// --- recommendNextStep (the orientation an onboarding agent reads) ---

test('recommendNextStep: no wikis, not a wiki dir -> create or adopt', () => {
  const r = recommendNextStep({ root: '/tmp/x', isWiki: false, wikis: [] });
  assert.match(r, /No wikis registered/);
  assert.match(r, /init --yes/);
});

test('recommendNextStep: wikis exist, not a wiki dir -> query one', () => {
  const r = recommendNextStep({ root: '/tmp/x', isWiki: false, wikis: [{ slug: 'research', path: '/w/research' }] });
  assert.match(r, /1 wiki\(s\) registered \(research\)/);
  assert.match(r, /tng-wiki query/);
});

test('recommendNextStep: inside a registered wiki -> query it by slug', () => {
  const r = recommendNextStep({ root: '/w/research', isWiki: true, wikis: [{ slug: 'research', path: '/w/research' }] });
  assert.match(r, /registered as "research"/);
});

test('recommendNextStep: inside an unregistered wiki dir -> register it', () => {
  const r = recommendNextStep({ root: '/w/new', isWiki: true, wikis: [] });
  assert.match(r, /not registered/);
  assert.match(r, /tng-wiki register \./);
});
