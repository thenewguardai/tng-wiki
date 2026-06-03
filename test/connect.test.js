import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConnectBlock, applyManagedBlock, removeManagedBlock } from '../src/connect.js';

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
