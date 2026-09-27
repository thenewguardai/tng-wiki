// `tng-wiki upgrade --all`: one sweep over every registered wiki on this machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { scaffoldWiki } from '../src/init.js';
import { loadRegistry, registerWiki, saveRegistry } from '../src/registry.js';
import { upgradeTargets } from '../src/upgrade.js';

const CLI = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin', 'cli.js');

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-upgrade-all-'));
  let registry = loadRegistry(home);
  for (const name of ['alpha', 'beta']) {
    const p = join(home, 'wikis', name);
    mkdirSync(p, { recursive: true });
    scaffoldWiki(p, { domain: 'blank', agent: 'claude-code', wikiName: name });
    registry = registerWiki(registry, { name, path: p, domain: 'blank' });
  }
  registry = registerWiki(registry, { name: 'gone', path: join(home, 'wikis', 'gone'), domain: 'blank' });
  saveRegistry(registry, home);
  return home;
}

function run(home, args) {
  return spawnSync('node', [CLI, 'upgrade', ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
}

test('upgradeTargets: every registered wiki whose path exists, missing ones reported', () => {
  const home = makeHome();
  try {
    const { targets, skipped } = upgradeTargets({ home });
    assert.deepEqual(targets.map((t) => t.slug), ['alpha', 'beta']);
    assert.deepEqual(skipped, [{ slug: 'gone', reason: 'path missing' }]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('upgrade --all --dry-run --json reports each wiki and writes nothing', () => {
  const home = makeHome();
  try {
    const schemaPath = join(home, 'wikis', 'alpha', 'AGENTS.md');
    writeFileSync(schemaPath, readFileSync(schemaPath, 'utf8').replace(/# /, '# stale '));
    const before = readFileSync(schemaPath, 'utf8');
    const r = run(home, ['--all', '--dry-run', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.deepEqual(parsed.wikis.map((w) => w.wiki), ['alpha', 'beta']);
    assert.ok(parsed.wikis.every((w) => w.dryRun === true));
    assert.deepEqual(parsed.skipped, [{ slug: 'gone', reason: 'path missing' }]);
    assert.equal(readFileSync(schemaPath, 'utf8'), before);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('upgrade --all refuses --domain, --wiki and a path', () => {
  const home = makeHome();
  try {
    for (const extra of [['--domain', 'blank'], ['--wiki', 'alpha'], [join(home, 'wikis', 'alpha')]]) {
      const r = run(home, ['--all', ...extra]);
      assert.notEqual(r.status, 0, `accepted --all with ${extra.join(' ')}`);
      assert.match(r.stderr, /--all/);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
