import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readWikiMetadata } from '../src/registry-cli.js';

test('readWikiMetadata throws when AGENTS.md is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-cli-'));
  try {
    assert.throws(() => readWikiMetadata(dir), /Not a tng-wiki directory/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readWikiMetadata reads .tng-wiki.json when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-cli-'));
  try {
    writeFileSync(join(dir, 'AGENTS.md'), '# schema');
    writeFileSync(join(dir, '.tng-wiki.json'), JSON.stringify({
      version: 1, name: 'My Wiki', domain: 'ai-research',
    }));
    const meta = readWikiMetadata(dir);
    assert.equal(meta.name, 'My Wiki');
    assert.equal(meta.domain, 'ai-research');
    assert.equal(meta.path, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readWikiMetadata falls back to basename + null domain when .tng-wiki.json is absent', () => {
  const parent = mkdtempSync(join(tmpdir(), 'tng-wiki-cli-'));
  const dir = join(parent, 'my-wiki');
  try {
    mkdirSync(dir);
    writeFileSync(join(dir, 'AGENTS.md'), '# schema');
    const meta = readWikiMetadata(dir);
    assert.equal(meta.name, 'my-wiki');
    assert.equal(meta.domain, null);
    assert.equal(meta.path, dir);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('readWikiMetadata tolerates a malformed .tng-wiki.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-cli-'));
  try {
    writeFileSync(join(dir, 'AGENTS.md'), '# schema');
    writeFileSync(join(dir, '.tng-wiki.json'), 'not json');
    const meta = readWikiMetadata(dir);
    assert.equal(meta.domain, null);
    assert.ok(meta.name.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
