// #47: surplus positionals are errors, and mutating ground runs refuse the
// default-wiki fallback. Before this, `tng-wiki ground <typo> --update-lock`
// run outside any wiki silently wrote the DEFAULT wiki's lockfile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { resolveWiki } from '../src/verbs.js';
import { scaffoldWiki } from '../src/init.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

// Fake home with one registered default wiki; returns { home, wikiPath, neutral }.
function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-strict-home-'));
  const wikiPath = join(home, 'wikis', 'demo');
  mkdirSync(wikiPath, { recursive: true });
  scaffoldWiki(wikiPath, { domain: 'blank', agent: 'claude-code', wikiName: 'Demo' });
  mkdirSync(join(home, '.tng-wiki'), { recursive: true });
  writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({
    version: 1,
    default: 'demo',
    wikis: { demo: { name: 'Demo', path: wikiPath, domain: 'blank', registered: new Date().toISOString() } },
  }));
  const neutral = join(home, 'neutral');
  mkdirSync(neutral);
  return { home, wikiPath, neutral };
}

function run(argv, { home, cwd }) {
  return spawnSync('node', [CLI, ...argv], {
    cwd,
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });
}

test('resolveWiki reports how the wiki was resolved (via)', () => {
  const { home, wikiPath, neutral } = makeHome();
  try {
    assert.equal(resolveWiki('demo', home, { cwd: neutral }).via, 'flag');
    assert.equal(resolveWiki(null, home, { cwd: wikiPath }).via, 'cwd');
    assert.equal(resolveWiki(null, home, { cwd: join(wikiPath, 'wiki') }).via, 'cwd');
    assert.equal(resolveWiki(null, home, { cwd: neutral }).via, 'default');
    assert.equal(resolveWiki(null, home, { cwd: null }).via, 'default');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('no-positional verbs reject surplus positionals instead of falling through', () => {
  const { home, neutral } = makeHome();
  try {
    for (const verb of ['ground', 'rounds', 'sources', 'stale', 'orphans', 'drift', 'unsourced', 'unverified', 'query']) {
      const r = run([verb, 'stray-arg'], { home, cwd: neutral });
      assert.equal(r.status, 1, `${verb} should fail on a surplus positional`);
      assert.match(r.stderr, /unknown argument "stray-arg"/, `${verb} stderr: ${r.stderr}`);
      assert.match(r.stderr, /--wiki stray-arg/, `${verb} should hint at --wiki`);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('search rejects a second positional with a quoting hint, read rejects a second page', () => {
  const { home, neutral } = makeHome();
  try {
    const s = run(['search', 'two', 'words'], { home, cwd: neutral });
    assert.equal(s.status, 1);
    assert.match(s.stderr, /unknown argument "words"/);
    assert.match(s.stderr, /Quote multi-word queries/);

    const r = run(['read', 'index', 'log'], { home, cwd: neutral });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown argument "log"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('ground --update-lock refuses the default-wiki fallback and writes nothing', () => {
  const { home, wikiPath, neutral } = makeHome();
  try {
    const r = run(['ground', '--update-lock'], { home, cwd: neutral });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing `ground --update-lock` via the default-wiki fallback/);
    assert.match(r.stderr, /--wiki demo/);
    assert.ok(!existsSync(join(wikiPath, 'wiki', '.tng-wiki.lock.json')), 'lockfile must not be created');

    const f = run(['ground', '--fix-moved'], { home, cwd: neutral });
    assert.equal(f.status, 1);
    assert.match(f.stderr, /refusing `ground --fix-moved`/);

    const i = run(['ground', '--fix-index'], { home, cwd: neutral });
    assert.equal(i.status, 1);
    assert.match(i.stderr, /refusing `ground --fix-index`/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('ground --update-lock still works from inside the wiki and via --wiki', () => {
  const { home, wikiPath, neutral } = makeHome();
  try {
    const inside = run(['ground', '--update-lock'], { home, cwd: wikiPath });
    assert.equal(inside.status, 0, inside.stderr);
    assert.ok(existsSync(join(wikiPath, 'wiki', '.tng-wiki.lock.json')));

    const flagged = run(['ground', '--update-lock', '--wiki', 'demo'], { home, cwd: neutral });
    assert.equal(flagged.status, 0, flagged.stderr);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('plain read-only ground keeps resolving the default from anywhere', () => {
  const { home, neutral } = makeHome();
  try {
    const r = run(['ground'], { home, cwd: neutral });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
