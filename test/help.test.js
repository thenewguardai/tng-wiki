import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { COMMANDS, commandJson, manifest } from '../src/help.js';

test('manifest has the expected agent-onboarding shape', () => {
  const m = manifest('9.9.9');
  assert.equal(m.tool, 'tng-wiki');
  assert.equal(m.version, '9.9.9');
  assert.ok(Array.isArray(m.commands) && m.commands.length > 10);
  assert.ok(m.onboarding?.createNew && m.onboarding?.adoptExisting && m.onboarding?.orient);
  assert.ok(m.conventions && m.globalFlags.length);
  for (const c of m.commands) {
    assert.ok(c.name && c.group && c.summary && c.usage, `incomplete command: ${c.name}`);
    assert.ok(Array.isArray(c.flags) && Array.isArray(c.args) && Array.isArray(c.examples));
  }
});

test('commandJson returns one command spec with structured flags', () => {
  const c = commandJson('search');
  assert.equal(c.name, 'search');
  assert.deepEqual(c.flags.map((f) => f.name), ['--wiki', '--regex', '--include-raw', '--json']);
  assert.equal(commandJson('nope'), null);
});

test('COMMANDS names are unique', () => {
  const names = COMMANDS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
});

// Drift guard: the help spec and the CLI dispatch table must describe the same
// commands, so `help --json` can never go stale relative to what actually runs.
test('help spec and bin/cli.js dispatch stay in parity', () => {
  const cli = readFileSync(new URL('../bin/cli.js', import.meta.url), 'utf8');
  const dispatched = new Set([...cli.matchAll(/case '([a-z][a-z-]*)':/g)].map((m) => m[1]));
  const spec = new Set(COMMANDS.map((c) => c.name));
  for (const name of dispatched) assert.ok(spec.has(name), `dispatched but undocumented in help.js: ${name}`);
  for (const name of spec) {
    if (name === 'help') continue; // handled before the switch, not a case
    assert.ok(dispatched.has(name), `documented in help.js but not dispatched: ${name}`);
  }
});
