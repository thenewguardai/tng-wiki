import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  PKG_NAME, installedVersion, parseSemver, compareSemver, satisfiesPin,
  readPinnedVersion, fetchLatestVersion, buildVersionReport,
} from '../src/version.js';

function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-ver-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

// --- installedVersion ---

test('installedVersion matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(installedVersion(), pkg.version);
  assert.equal(PKG_NAME, pkg.name);
});

// --- parseSemver / compareSemver ---

test('parseSemver handles plain, v-prefixed, and prerelease versions', () => {
  assert.deepEqual(parseSemver('0.5.0'), [0, 5, 0]);
  assert.deepEqual(parseSemver('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseSemver('1.2.3-beta.1'), [1, 2, 3]);
  assert.equal(parseSemver('0.5'), null);
  assert.equal(parseSemver('garbage'), null);
  assert.equal(parseSemver(''), null);
  assert.equal(parseSemver(null), null);
});

test('compareSemver orders versions and returns null on junk', () => {
  assert.equal(compareSemver('0.4.0', '0.5.0'), -1);
  assert.equal(compareSemver('0.5.0', '0.5.0'), 0);
  assert.equal(compareSemver('0.10.0', '0.9.9'), 1);
  assert.equal(compareSemver('1.0.0', '0.99.99'), 1);
  assert.equal(compareSemver('nope', '0.5.0'), null);
});

// --- satisfiesPin: the minimal range matcher ---

test('satisfiesPin: exact version', () => {
  assert.equal(satisfiesPin('0.4.0', '0.4.0'), true);
  assert.equal(satisfiesPin('0.4.1', '0.4.0'), false);
});

test('satisfiesPin: x-ranges (0.4.x / 0.4.* / 0.x / 0 / *)', () => {
  assert.equal(satisfiesPin('0.4.7', '0.4.x'), true);
  assert.equal(satisfiesPin('0.5.0', '0.4.x'), false);
  assert.equal(satisfiesPin('0.4.7', '0.4.*'), true);
  assert.equal(satisfiesPin('0.9.9', '0.x'), true);
  assert.equal(satisfiesPin('1.0.0', '0.x'), false);
  assert.equal(satisfiesPin('0.9.9', '0'), true);
  assert.equal(satisfiesPin('99.0.0', '*'), true);
  assert.equal(satisfiesPin('99.0.0', 'x'), true);
});

test('satisfiesPin: caret ranges', () => {
  // ^0.4.0 -> >=0.4.0 <0.5.0 (0.x carets stay within the minor)
  assert.equal(satisfiesPin('0.4.0', '^0.4.0'), true);
  assert.equal(satisfiesPin('0.4.9', '^0.4.0'), true);
  assert.equal(satisfiesPin('0.5.0', '^0.4.0'), false);
  assert.equal(satisfiesPin('0.3.9', '^0.4.0'), false);
  // ^1.2.3 -> >=1.2.3 <2.0.0
  assert.equal(satisfiesPin('1.9.0', '^1.2.3'), true);
  assert.equal(satisfiesPin('1.2.2', '^1.2.3'), false);
  assert.equal(satisfiesPin('2.0.0', '^1.2.3'), false);
  // ^0.0.3 -> >=0.0.3 <0.0.4
  assert.equal(satisfiesPin('0.0.3', '^0.0.3'), true);
  assert.equal(satisfiesPin('0.0.4', '^0.0.3'), false);
});

test('satisfiesPin: tilde ranges', () => {
  assert.equal(satisfiesPin('0.4.5', '~0.4.1'), true);
  assert.equal(satisfiesPin('0.4.0', '~0.4.1'), false);
  assert.equal(satisfiesPin('0.5.0', '~0.4.1'), false);
  assert.equal(satisfiesPin('1.2.9', '~1.2.3'), true);
  assert.equal(satisfiesPin('1.3.0', '~1.2.3'), false);
});

test('satisfiesPin returns null on unrecognized ranges or versions', () => {
  assert.equal(satisfiesPin('0.5.0', '>=0.4.0'), null);
  assert.equal(satisfiesPin('0.5.0', '0.4.0 - 0.6.0'), null);
  assert.equal(satisfiesPin('0.5.0', 'latest'), null);
  assert.equal(satisfiesPin('0.5.0', ''), null);
  assert.equal(satisfiesPin('not-a-version', '0.4.x'), null);
});

// --- readPinnedVersion ---

test('readPinnedVersion reads pinned_version from .tng-wiki.json', () => {
  inDir((dir) => {
    writeFileSync(join(dir, '.tng-wiki.json'), JSON.stringify({ version: 1, pinned_version: '0.4.x' }));
    assert.equal(readPinnedVersion(dir), '0.4.x');
  });
});

test('readPinnedVersion returns null when absent, blank, non-string, or malformed', () => {
  inDir((dir) => {
    assert.equal(readPinnedVersion(dir), null); // no file

    writeFileSync(join(dir, '.tng-wiki.json'), JSON.stringify({ version: 1 }));
    assert.equal(readPinnedVersion(dir), null); // no key

    writeFileSync(join(dir, '.tng-wiki.json'), JSON.stringify({ pinned_version: '   ' }));
    assert.equal(readPinnedVersion(dir), null); // blank

    writeFileSync(join(dir, '.tng-wiki.json'), JSON.stringify({ pinned_version: 4 }));
    assert.equal(readPinnedVersion(dir), null); // non-string

    writeFileSync(join(dir, '.tng-wiki.json'), 'not json');
    assert.equal(readPinnedVersion(dir), null); // malformed
  });
});

// --- fetchLatestVersion (exec injected — never hits the network in tests) ---

test('fetchLatestVersion returns the trimmed version from npm view', () => {
  const calls = [];
  const latest = fetchLatestVersion({ exec: (cmd, timeout) => { calls.push({ cmd, timeout }); return '0.6.0\n'; } });
  assert.equal(latest, '0.6.0');
  assert.match(calls[0].cmd, /npm view @thenewguard\/tng-wiki version/);
  assert.equal(calls[0].timeout, 2000);
});

test('fetchLatestVersion returns null when npm fails (offline) or emits junk', () => {
  assert.equal(fetchLatestVersion({ exec: () => { throw new Error('ETIMEDOUT'); } }), null);
  assert.equal(fetchLatestVersion({ exec: () => 'npm ERR! network' }), null);
  assert.equal(fetchLatestVersion({ exec: () => '' }), null);
});

// --- buildVersionReport: the three annotations ---

function levels(report) { return report.annotations.map((a) => a.level); }

test('report without a pin and reachable newer latest -> informational only', () => {
  const r = buildVersionReport({ installed: '0.5.0', latest: '0.6.0', pinned: null });
  assert.equal(r.latest, '0.6.0');
  assert.equal(r.pinned, null);
  assert.deepEqual(levels(r), ['info']);
  assert.match(r.annotations[0].message, /update available: 0\.5\.0 → 0\.6\.0/);
});

test('report without a pin and up-to-date -> no annotations', () => {
  const r = buildVersionReport({ installed: '0.5.0', latest: '0.5.0', pinned: null });
  assert.deepEqual(r.annotations, []);
});

test('report offline -> latest "unreachable", no annotations, no failure', () => {
  const r = buildVersionReport({ installed: '0.5.0', latest: null, pinned: null });
  assert.equal(r.latest, 'unreachable');
  assert.deepEqual(r.annotations, []);
});

test('report: installed matches pin -> ✓ annotation', () => {
  const r = buildVersionReport({ installed: '0.4.2', latest: '0.4.2', pinned: '0.4.x' });
  assert.deepEqual(levels(r), ['ok']);
  assert.match(r.annotations[0].message, /matches pin 0\.4\.x/);
});

test('report: installed violates pin -> ⚠ annotation', () => {
  const r = buildVersionReport({ installed: '0.5.0', latest: null, pinned: '0.4.x' });
  assert.deepEqual(levels(r), ['warn']);
  assert.match(r.annotations[0].message, /installed 0\.5\.0 violates pin 0\.4\.x/);
});

test('report: newer latest inside the pin -> ok + "update available (pin allows)"', () => {
  const r = buildVersionReport({ installed: '0.4.0', latest: '0.4.3', pinned: '0.4.x' });
  assert.deepEqual(levels(r), ['ok', 'info']);
  assert.match(r.annotations[1].message, /update available \(pin allows\): 0\.4\.0 → 0\.4\.3/);
});

test('report: newer latest outside the pin -> no update nudge', () => {
  const r = buildVersionReport({ installed: '0.4.0', latest: '0.5.0', pinned: '0.4.x' });
  assert.deepEqual(levels(r), ['ok']);
});

test('report: unrecognized pin -> warn, but no false violation', () => {
  const r = buildVersionReport({ installed: '0.5.0', latest: '0.5.0', pinned: '>=0.4.0' });
  assert.deepEqual(levels(r), ['warn']);
  assert.match(r.annotations[0].message, /unrecognized pinned_version/);
});
