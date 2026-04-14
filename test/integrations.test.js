import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { setupGit } from '../src/integrations/git.js';
import { setupQmd, slugifyWikiName } from '../src/integrations/qmd.js';
import { detectObsidian } from '../src/integrations/obsidian.js';

// --- git ---

test('setupGit creates a repo with an initial commit and never throws', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-git-ok-'));
  try {
    writeFileSync(join(dir, 'README.md'), '# hi', 'utf8');
    const result = await setupGit(dir);
    assert.equal(result.attempted, true);
    assert.equal(result.success, true);
    assert.ok(existsSync(join(dir, '.git')));
    const log = execSync('git log --oneline', { cwd: dir }).toString();
    assert.match(log, /init: scaffold wiki with tng-wiki/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setupGit returns a failure result (never throws) when given a non-existent path', async () => {
  const result = await setupGit('/definitely/does/not/exist/tng-wiki-xyz');
  assert.equal(result.attempted, true);
  assert.equal(result.success, false);
  assert.equal(typeof result.error, 'string');
});

// --- qmd ---

test('slugifyWikiName lowercases and dash-separates', () => {
  assert.equal(slugifyWikiName('My AI Research Wiki!'), 'my-ai-research-wiki');
  assert.equal(slugifyWikiName('  Edge--Cases__  '), 'edge-cases');
});

test('setupQmd reports installed:false when qmd --version fails', async () => {
  const result = await setupQmd('/tmp/fake', 'Demo Wiki', {
    exec: (cmd) => {
      if (cmd.startsWith('qmd --version')) throw new Error('not found');
      throw new Error('should not reach');
    },
  });
  assert.deepEqual(result, {
    installed: false,
    configured: false,
    slug: 'demo-wiki',
    wikiDir: '/tmp/fake/wiki',
  });
});

test('setupQmd configures collection + context when qmd is available', async () => {
  const calls = [];
  const result = await setupQmd('/tmp/fake', 'Demo Wiki', {
    exec: (cmd) => { calls.push(cmd); },
  });
  assert.equal(result.installed, true);
  assert.equal(result.configured, true);
  assert.equal(result.slug, 'demo-wiki');
  assert.equal(calls.length, 3);
  assert.match(calls[1], /qmd collection add "\/tmp\/fake\/wiki" --name "demo-wiki"/);
  assert.match(calls[2], /qmd context add qmd:\/\/demo-wiki/);
});

test('setupQmd reports configured:false with error when collection setup fails', async () => {
  const result = await setupQmd('/tmp/fake', 'Demo Wiki', {
    exec: (cmd) => {
      if (cmd.startsWith('qmd --version')) return;
      throw new Error('collection failed');
    },
  });
  assert.equal(result.installed, true);
  assert.equal(result.configured, false);
  assert.match(result.error, /collection failed/);
});

// --- obsidian ---

test('detectObsidian returns null when no candidate directories exist', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-obs-none-'));
  try {
    assert.equal(detectObsidian(home), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('detectObsidian returns parent when an existing vault is found', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-obs-vault-'));
  try {
    const vault = join(home, 'Documents', 'Obsidian');
    mkdirSync(join(vault, '.obsidian'), { recursive: true });
    assert.equal(detectObsidian(home), join(home, 'Documents'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('detectObsidian returns the container itself when a child is a vault', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-obs-cont-'));
  try {
    const container = join(home, 'Documents', 'Obsidian');
    mkdirSync(join(container, 'my-vault', '.obsidian'), { recursive: true });
    assert.equal(detectObsidian(home), container);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
