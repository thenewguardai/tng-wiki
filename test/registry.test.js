import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  emptyRegistry, loadRegistry, saveRegistry, registryPath,
  registerWiki, unregisterWiki, setDefault, listWikis, getWiki, getDefault,
  slugifyName,
} from '../src/registry.js';

function inHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-registry-'));
  try { return fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

test('loadRegistry returns an empty registry when no file exists', () => {
  inHome((home) => {
    assert.deepEqual(loadRegistry(home), emptyRegistry());
    assert.ok(!existsSync(registryPath(home)));
  });
});

test('saveRegistry + loadRegistry round-trips through disk', () => {
  inHome((home) => {
    const reg = registerWiki(emptyRegistry(), { name: 'AI Research', path: '/tmp/ai', domain: 'ai-research' });
    saveRegistry(reg, home);
    assert.deepEqual(loadRegistry(home), reg);
    // file is JSON, human-editable
    const raw = JSON.parse(readFileSync(registryPath(home), 'utf8'));
    assert.equal(raw.version, 1);
  });
});

test('loadRegistry returns an empty registry when file is corrupt', () => {
  inHome((home) => {
    saveRegistry(emptyRegistry(), home);
    writeFileSync(registryPath(home), '{ this is not json', 'utf8');
    assert.deepEqual(loadRegistry(home), emptyRegistry());
  });
});

test('registerWiki slugifies the name and uses the first wiki as the default', () => {
  const reg = registerWiki(emptyRegistry(), { name: 'AI Research Wiki!', path: '/tmp/ai', domain: 'ai-research' });
  assert.deepEqual(Object.keys(reg.wikis), ['ai-research-wiki']);
  assert.equal(reg.default, 'ai-research-wiki');
  assert.equal(reg.wikis['ai-research-wiki'].domain, 'ai-research');
});

test('registerWiki resolves relative paths to absolute', () => {
  const reg = registerWiki(emptyRegistry(), { name: 'Demo', path: '.', domain: 'blank' });
  assert.ok(reg.wikis.demo.path.startsWith('/'), `expected absolute path, got ${reg.wikis.demo.path}`);
});

test('registerWiki keeps the existing default when adding a second wiki', () => {
  let reg = registerWiki(emptyRegistry(), { name: 'First', path: '/tmp/a', domain: 'blank' });
  reg = registerWiki(reg, { name: 'Second', path: '/tmp/b', domain: 'ai-research' });
  assert.equal(reg.default, 'first');
  assert.deepEqual(Object.keys(reg.wikis).sort(), ['first', 'second']);
});

test('registerWiki throws when the same path is registered under a new slug', () => {
  const reg = registerWiki(emptyRegistry(), { name: 'Alpha', path: '/tmp/shared', domain: 'blank' });
  assert.throws(
    () => registerWiki(reg, { name: 'Beta', path: '/tmp/shared', domain: 'blank' }),
    /Path already registered/,
  );
});

test('registerWiki allows re-registering the same slug (idempotent update)', () => {
  let reg = registerWiki(emptyRegistry(), { name: 'AI', path: '/tmp/ai', domain: 'ai-research' });
  reg = registerWiki(reg, { name: 'AI', path: '/tmp/ai', domain: 'ai-research', slug: 'ai' });
  assert.deepEqual(Object.keys(reg.wikis), ['ai']);
});

test('unregisterWiki removes the entry and reassigns the default when needed', () => {
  let reg = registerWiki(emptyRegistry(), { name: 'First', path: '/tmp/a', domain: 'blank' });
  reg = registerWiki(reg, { name: 'Second', path: '/tmp/b', domain: 'blank' });
  reg = unregisterWiki(reg, 'first');
  assert.deepEqual(Object.keys(reg.wikis), ['second']);
  assert.equal(reg.default, 'second');
});

test('unregisterWiki sets default to null when removing the last wiki', () => {
  let reg = registerWiki(emptyRegistry(), { name: 'Only', path: '/tmp/only', domain: 'blank' });
  reg = unregisterWiki(reg, 'only');
  assert.deepEqual(reg.wikis, {});
  assert.equal(reg.default, null);
});

test('unregisterWiki throws on unknown slug', () => {
  assert.throws(() => unregisterWiki(emptyRegistry(), 'nope'), /No wiki registered/);
});

test('setDefault changes the default; throws on unknown slug', () => {
  let reg = registerWiki(emptyRegistry(), { name: 'First', path: '/tmp/a', domain: 'blank' });
  reg = registerWiki(reg, { name: 'Second', path: '/tmp/b', domain: 'blank' });
  reg = setDefault(reg, 'second');
  assert.equal(reg.default, 'second');
  assert.throws(() => setDefault(reg, 'nope'), /No wiki registered/);
});

test('listWikis returns an array with slug + isDefault flags', () => {
  let reg = registerWiki(emptyRegistry(), { name: 'First', path: '/tmp/a', domain: 'blank' });
  reg = registerWiki(reg, { name: 'Second', path: '/tmp/b', domain: 'ai-research' });
  const list = listWikis(reg);
  assert.equal(list.length, 2);
  assert.ok(list.find(w => w.slug === 'first').isDefault);
  assert.ok(!list.find(w => w.slug === 'second').isDefault);
});

test('getDefault returns the default wiki or null when registry is empty', () => {
  assert.equal(getDefault(emptyRegistry()), null);
  const reg = registerWiki(emptyRegistry(), { name: 'Only', path: '/tmp/only', domain: 'blank' });
  assert.equal(getDefault(reg).slug, 'only');
});

test('getWiki returns null for unknown slugs', () => {
  const reg = registerWiki(emptyRegistry(), { name: 'Only', path: '/tmp/only', domain: 'blank' });
  assert.equal(getWiki(reg, 'nope'), null);
  assert.equal(getWiki(reg, 'only').slug, 'only');
});

test('slugifyName handles punctuation and leading/trailing noise', () => {
  assert.equal(slugifyName('  My Weird!! Wiki.  '), 'my-weird-wiki');
  assert.equal(slugifyName('---A---'), 'a');
});
