// #44: wikis registered under a system temp root are flagged as likely
// ephemeral - the advisory layer suggests `unregister`, not schema upgrades.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir, homedir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { isTempPath } from '../src/paths.js';
import { schemaReport } from '../src/doctor.js';
import { scaffoldWiki } from '../src/init.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

test('isTempPath: temp roots yes, home and lookalike prefixes no', () => {
  assert.equal(isTempPath(join(tmpdir(), 'scratch-wiki')), true);
  assert.equal(isTempPath('/tmp/x/y'), true);
  assert.equal(isTempPath('/var/tmp/x'), true);
  assert.equal(isTempPath('/tmp'), true);
  assert.equal(isTempPath(join(homedir(), 'wikis', 'real')), false);
  assert.equal(isTempPath('/tmpfoo/wiki'), false, 'prefix must respect path boundaries');
  assert.equal(isTempPath('/home/user/tmp/wiki'), false, 'a tmp segment mid-path is not a temp root');
});

test('schemaReport carries the wiki path so the renderer can flag temp wikis', () => {
  const report = schemaReport([{ slug: 's', path: '/tmp/w' }], '0.10.0');
  assert.equal(report[0].path, '/tmp/w');
});

test('list tags a temp-path wiki and suggests unregister', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-temp-home-'));
  try {
    const wikiPath = join(home, 'wikis', 'scratch'); // home itself is under tmp, so this reads as temp
    mkdirSync(wikiPath, { recursive: true });
    scaffoldWiki(wikiPath, { domain: 'blank', agent: 'claude-code', wikiName: 'Scratch' });
    mkdirSync(join(home, '.tng-wiki'), { recursive: true });
    writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({
      version: 1, default: 'scratch',
      wikis: { scratch: { name: 'Scratch', path: wikiPath, domain: 'blank', registered: new Date().toISOString() } },
    }));
    const r = spawnSync('node', [CLI, 'list'], {
      cwd: home, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /temp path/);
    assert.match(r.stdout, /tng-wiki unregister scratch/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
