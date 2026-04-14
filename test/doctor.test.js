import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runChecks } from '../src/doctor.js';

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
