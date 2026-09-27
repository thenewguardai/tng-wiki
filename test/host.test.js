// Host identity for committed host fields: case-insensitive, overridable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostname } from 'os';
import { localHost, sameHost } from '../src/host.js';
import { relationTo } from '../src/sharing.js';

function withHostEnv(value, fn) {
  const saved = process.env.TNG_WIKI_HOST;
  if (value === undefined) delete process.env.TNG_WIKI_HOST; else process.env.TNG_WIKI_HOST = value;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.TNG_WIKI_HOST; else process.env.TNG_WIKI_HOST = saved;
  }
}

test('localHost: OS hostname by default, TNG_WIKI_HOST overrides, blank override ignored', () => {
  withHostEnv(undefined, () => assert.equal(localHost(), hostname()));
  withHostEnv('legion-ubuntu', () => assert.equal(localHost(), 'legion-ubuntu'));
  withHostEnv('   ', () => assert.equal(localHost(), hostname()));
});

test('sameHost: case- and whitespace-insensitive, never matches empty', () => {
  assert.equal(sameHost('Legion-Ubuntu', 'legion-ubuntu'), true);
  assert.equal(sameHost('LEGION5090', 'legion5090 '), true);
  assert.equal(sameHost('legion', 'legion5090'), false);
  assert.equal(sameHost('', ''), false);
  assert.equal(sameHost(null, 'legion'), false);
});

test('relationTo: a host stamp matches the machine regardless of case', () => {
  assert.equal(relationTo({ mode: 'host', host: 'legion-ubuntu' }, 'Legion-Ubuntu'), 'mine');
  withHostEnv('LEGION', () => assert.equal(relationTo({ mode: 'host', host: 'legion' }), 'mine'));
});
