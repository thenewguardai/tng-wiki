// The librarian home host (ADR 0001): one host writes a wiki's compiled state;
// every other host is a capturer and the mutating verbs refuse there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { scaffoldWiki } from '../src/init.js';
import { readLibrarian, setLibrarian, seatFor, assertLibrarianSeat } from '../src/librarian.js';

const CLI = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin', 'cli.js');

function makeWiki() {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-librarian-'));
  scaffoldWiki(dir, { domain: 'blank', agent: 'claude-code', wikiName: 'Lib' });
  return dir;
}

function makeHome(wikiPath) {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-librarian-home-'));
  mkdirSync(join(home, '.tng-wiki'), { recursive: true });
  writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({
    version: 1, default: 'lib',
    wikis: { lib: { name: 'Lib', path: wikiPath, domain: 'blank', registered: new Date().toISOString() } },
  }));
  return home;
}

function run(home, argv, host) {
  return spawnSync('node', [CLI, ...argv], {
    env: { ...process.env, HOME: home, TNG_WIKI_HOST: host }, encoding: 'utf8',
  });
}

test('unset librarian: no seat, nothing refused', () => {
  const dir = makeWiki();
  try {
    assert.equal(readLibrarian(dir), null);
    assert.deepEqual(seatFor(dir, 'anybox'), { librarian: null, role: null });
    assert.doesNotThrow(() => assertLibrarianSeat(dir, [], 'log', 'anybox'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setLibrarian stamps the committed manifest; seat compares hosts case-insensitively', () => {
  const dir = makeWiki();
  try {
    setLibrarian(dir, 'legion-ubuntu');
    assert.equal(JSON.parse(readFileSync(join(dir, '.tng-wiki.json'), 'utf8')).librarian, 'legion-ubuntu');
    assert.deepEqual(seatFor(dir, 'Legion-Ubuntu'), { librarian: 'legion-ubuntu', role: 'librarian' });
    assert.deepEqual(seatFor(dir, 'LEGION5090'), { librarian: 'legion-ubuntu', role: 'capturer' });
    setLibrarian(dir, null);
    assert.equal(readLibrarian(dir), null);
    assert.equal('librarian' in JSON.parse(readFileSync(join(dir, '.tng-wiki.json'), 'utf8')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assertLibrarianSeat refuses a capturer seat, names capture, and --off-host overrides', () => {
  const dir = makeWiki();
  try {
    setLibrarian(dir, 'legion-ubuntu');
    assert.throws(
      () => assertLibrarianSeat(dir, [], 'graduate', 'legion5090', 'lib'),
      /graduate.*librarian host is "legion-ubuntu".*tng-wiki capture --wiki lib.*--off-host/s,
    );
    assert.doesNotThrow(() => assertLibrarianSeat(dir, ['--off-host'], 'graduate', 'legion5090'));
    assert.doesNotThrow(() => assertLibrarianSeat(dir, [], 'graduate', 'legion-ubuntu'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mutating verbs refuse on a capturer seat; read verbs and --off-host still work', () => {
  const dir = makeWiki();
  const home = makeHome(dir);
  try {
    setLibrarian(dir, 'home-box');
    for (const argv of [
      ['ground', '--wiki', 'lib', '--update-lock'],
      ['ground', '--wiki', 'lib', '--fix-index'],
      ['log', '--wiki', 'lib', '--type', 'note', '--desc', 'x'],
      ['upgrade', '--wiki', 'lib', '--dry-run'],
    ]) {
      const r = run(home, argv, 'travel-box');
      assert.notEqual(r.status, 0, `${argv.join(' ')} ran on a capturer seat`);
      assert.match(r.stderr, /librarian host is "home-box"/, argv.join(' '));
    }
    assert.equal(run(home, ['ground', '--wiki', 'lib'], 'travel-box').status, 0);
    assert.equal(run(home, ['ground', '--wiki', 'lib', '--fix-index', '--off-host'], 'travel-box').status, 0);
    assert.equal(run(home, ['ground', '--wiki', 'lib', '--fix-index'], 'HOME-BOX').status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('librarian verb shows and sets the seat', () => {
  const dir = makeWiki();
  const home = makeHome(dir);
  try {
    let r = run(home, ['librarian', '--wiki', 'lib', '--set', 'home-box'], 'travel-box');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readLibrarian(dir), 'home-box');
    r = run(home, ['librarian', '--wiki', 'lib', '--json'], 'travel-box');
    assert.deepEqual(JSON.parse(r.stdout), { wiki: 'lib', librarian: 'home-box', host: 'travel-box', role: 'capturer' });
    r = run(home, ['librarian', '--wiki', 'lib', '--set-here'], 'travel-box');
    assert.equal(readLibrarian(dir), 'travel-box');
    r = run(home, ['librarian', '--wiki', 'lib', '--clear'], 'travel-box');
    assert.equal(readLibrarian(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('rounds and list report the seat', () => {
  const dir = makeWiki();
  const home = makeHome(dir);
  try {
    setLibrarian(dir, 'home-box');
    const rounds = JSON.parse(run(home, ['rounds', '--wiki', 'lib', '--json'], 'travel-box').stdout);
    assert.deepEqual(rounds.seat, { librarian: 'home-box', role: 'capturer' });
    assert.match(run(home, ['rounds', '--wiki', 'lib'], 'travel-box').stdout, /capturer seat: "home-box"/);
    assert.match(run(home, ['list'], 'travel-box').stdout, /\[capturer · librarian: home-box\]/);
    assert.match(run(home, ['list'], 'home-box').stdout, /\[librarian here\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
