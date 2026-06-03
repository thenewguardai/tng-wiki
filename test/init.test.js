import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInitArgs } from '../src/init.js';

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
