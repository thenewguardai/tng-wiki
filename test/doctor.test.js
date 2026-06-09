import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runChecks, recommendNextStep, versionCheck, runDoctor } from '../src/doctor.js';
import { installSkill } from '../src/skill.js';
import { installedVersion } from '../src/version.js';

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

// --- versionCheck (installed vs latest vs pinned; latest is injected — no network) ---

test('versionCheck reads pinned_version from the wiki .tng-wiki.json and flags a violation', () => {
  const wiki = mkdtempSync(join(tmpdir(), 'tng-wiki-doc-'));
  try {
    writeFileSync(join(wiki, '.tng-wiki.json'), JSON.stringify({ version: 1, pinned_version: '0.4.x' }));
    const v = versionCheck(wiki, { installed: '0.5.0', fetchLatest: () => null });
    assert.equal(v.installed, '0.5.0');
    assert.equal(v.latest, 'unreachable');
    assert.equal(v.pinned, '0.4.x');
    assert.equal(v.annotations.length, 1);
    assert.equal(v.annotations[0].level, 'warn');
    assert.match(v.annotations[0].message, /installed 0\.5\.0 violates pin 0\.4\.x/);
  } finally {
    rmSync(wiki, { recursive: true, force: true });
  }
});

test('versionCheck without a pin is informational only (no warnings)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-doc-'));
  try {
    const v = versionCheck(dir, { installed: '0.5.0', fetchLatest: () => '0.6.0' });
    assert.equal(v.pinned, null);
    assert.ok(v.annotations.every((a) => a.level !== 'warn'));
    assert.match(v.annotations[0].message, /update available/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('versionCheck defaults installed to the package.json version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-doc-'));
  try {
    const v = versionCheck(dir, { fetchLatest: () => null });
    assert.equal(v.installed, installedVersion());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- runDoctor --json (offline: fetchLatest -> null; never hangs, never throws) ---

async function doctorJson(root, deps) {
  const chunks = [];
  const realWrite = process.stdout.write;
  process.stdout.write = (s) => { chunks.push(s); return true; };
  try {
    await runDoctor([root, '--json'], deps);
  } finally {
    process.stdout.write = realWrite;
  }
  return JSON.parse(chunks.join(''));
}

test('runDoctor --json reports version + skill blocks; offline -> latest "unreachable"', async () => {
  const wiki = mkdtempSync(join(tmpdir(), 'tng-wiki-doc-'));
  const claudeHome = mkdtempSync(join(tmpdir(), 'tng-wiki-home-'));
  try {
    writeFileSync(join(wiki, '.tng-wiki.json'), JSON.stringify({ version: 1, pinned_version: '0.4.x' }));
    const out = await doctorJson(wiki, {
      ...fakeDeps(),
      installed: '0.4.2',
      fetchLatest: () => null,
      claudeHome,
    });
    assert.deepEqual(
      { installed: out.version.installed, latest: out.version.latest, pinned: out.version.pinned },
      { installed: '0.4.2', latest: 'unreachable', pinned: '0.4.x' },
    );
    assert.equal(out.version.annotations[0].level, 'ok'); // 0.4.2 matches 0.4.x
    assert.deepEqual(out.skill, { installed: false, fresh: false });
    assert.equal(out.skillInstalled, false);
  } finally {
    rmSync(wiki, { recursive: true, force: true });
    rmSync(claudeHome, { recursive: true, force: true });
  }
});

test('runDoctor --json flags a stale installed skill', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-doc-'));
  const claudeHome = mkdtempSync(join(tmpdir(), 'tng-wiki-home-'));
  try {
    // Simulate a SKILL.md installed by an older version (different content).
    installSkill(claudeHome);
    writeFileSync(join(claudeHome, 'skills', 'tng-wiki', 'SKILL.md'), '# old generation\n');
    const out = await doctorJson(dir, { ...fakeDeps(), fetchLatest: () => null, claudeHome });
    assert.deepEqual(out.skill, { installed: true, fresh: false });

    // Re-running install-skill restores freshness.
    installSkill(claudeHome, { force: true });
    const out2 = await doctorJson(dir, { ...fakeDeps(), fetchLatest: () => null, claudeHome });
    assert.deepEqual(out2.skill, { installed: true, fresh: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(claudeHome, { recursive: true, force: true });
  }
});
