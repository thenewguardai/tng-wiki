import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseInitArgs, buildHeadlessAuthorities, authorityPortabilityWarnings } from '../src/init.js';

test('parseInitArgs parses flags, trims path/domain values, and collects unknowns', () => {
  const o = parseInitArgs(['--yes', '--dir', ' ./w ', '--domain', 'blank', '--agent', 'codex', '--name', 'My Wiki', '--into-existing', '--no-integrations', '--xyz']);
  assert.equal(o.yes, true);
  assert.equal(o.dir, './w');        // trimmed — issue #7
  assert.equal(o.domain, 'blank');
  assert.equal(o.agent, 'codex');
  assert.equal(o.name, 'My Wiki');
  assert.equal(o.intoExisting, true);
  assert.equal(o.git, false);
  assert.equal(o.qmd, false);
  assert.deepEqual(o.unknown, ['--xyz']);
});

test('parseInitArgs recognizes --help / -h', () => {
  assert.equal(parseInitArgs(['--help']).help, true);
  assert.equal(parseInitArgs(['-h']).help, true);
});

test('parseInitArgs: a value flag missing its value does not swallow the next flag', () => {
  const o = parseInitArgs(['--domain', '--yes']);
  assert.equal(o.domain, '');
  assert.equal(o.yes, true);
});

test('parseInitArgs: --force and the --adopt alias', () => {
  assert.equal(parseInitArgs(['--force']).force, true);
  assert.equal(parseInitArgs(['--adopt']).intoExisting, true);
});

// --- code authorities in the headless path (issue #16) ---

test('parseInitArgs collects repeatable --code-authority values, trimmed', () => {
  const o = parseInitArgs(['--code-authority', ' ../legacy-app ', '--code-authority', '/opt/code']);
  assert.deepEqual(o.codeAuthorities, ['../legacy-app', '/opt/code']);
  assert.deepEqual(parseInitArgs([]).codeAuthorities, []);
});

test('buildHeadlessAuthorities derives names from the last path segment and applies default excludes', () => {
  const [a, b] = buildHeadlessAuthorities(['../legacy-app', '/home/u/code/portal']);
  assert.equal(a.name, 'legacy-app');
  assert.equal(a.path, '../legacy-app');
  assert.ok(Array.isArray(a.exclude) && a.exclude.includes('**/*.md'));
  assert.equal(b.name, 'portal');
  assert.equal(b.path, '/home/u/code/portal');
  assert.deepEqual(buildHeadlessAuthorities(['', '  ']), []); // empty values dropped
});

test('authorityPortabilityWarnings warns only for absolute paths (relative and ~ travel)', () => {
  const warnings = authorityPortabilityWarnings([
    { name: 'rel', path: '../legacy-app' },
    { name: 'home', path: '~/code/app' },
    { name: 'abs', path: '/home/u/code/app' },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"abs"/);
  assert.match(warnings[0], /won't resolve on other machines/);
});

test('init --yes with an absolute --code-authority warns on stderr, exits 0, and saves verbatim', () => {
  const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-init-home-'));
  const parent = mkdtempSync(join(tmpdir(), 'tng-wiki-init-'));
  const dir = join(parent, 'w');
  const absAuthority = join(parent, 'legacy-app'); // absolute, intentionally non-existent
  try {
    const run = spawnSync('node', [
      CLI, 'init', '--yes', '--dir', dir, '--domain', 'software-engineering',
      '--code-authority', absAuthority, '--code-authority', '../other-app', '--no-integrations',
    ], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
    });

    assert.equal(run.status, 0, run.stderr);                       // warning-only: exit 0
    assert.match(run.stderr, /absolute path/);                     // ...but it says so on stderr
    assert.match(run.stderr, /won't resolve on other machines/);
    assert.ok(!run.stderr.includes('other-app'));                  // relative path: no warning

    const meta = JSON.parse(readFileSync(join(dir, '.tng-wiki.json'), 'utf8'));
    assert.deepEqual(meta.code_authorities.map((a) => a.path), [absAuthority, '../other-app']);
    assert.equal(meta.code_authorities[0].name, 'legacy-app');     // saved verbatim, name from basename
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});
