// #39: machine-local advisory lease (claim/release), informational warnings on
// mutating verbs, and the documented merge story in doctrine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { claimLease, releaseLease, activeLease, leasesPath, DEFAULT_TTL_MINUTES } from '../src/lease.js';
import { scaffoldWiki } from '../src/init.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-lease-'));
  const wikiPath = join(home, 'wikis', 'demo');
  mkdirSync(wikiPath, { recursive: true });
  scaffoldWiki(wikiPath, { domain: 'blank', agent: 'claude-code', wikiName: 'Demo' });
  mkdirSync(join(home, '.tng-wiki'), { recursive: true });
  writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({
    version: 1, default: 'demo',
    wikis: { demo: { name: 'Demo', path: wikiPath, domain: 'blank', registered: new Date().toISOString() } },
  }));
  return { home, wikiPath };
}

test('claim / renew / foreign-conflict / expiry / release lifecycle', () => {
  const { home, wikiPath } = makeHome();
  try {
    const t0 = new Date('2026-07-24T10:00:00Z');
    const a = claimLease(wikiPath, { holder: 'session-a' }, home, t0);
    assert.equal(a.holder, 'session-a');
    assert.equal(a.expires_at, new Date(t0.getTime() + DEFAULT_TTL_MINUTES * 60_000).toISOString());

    // same holder renews (acquired_at preserved, expiry extended)
    const renewed = claimLease(wikiPath, { holder: 'session-a', ttlMinutes: 30 }, home, new Date('2026-07-24T10:10:00Z'));
    assert.equal(renewed.acquired_at, a.acquired_at);
    assert.equal(renewed.expires_at, '2026-07-24T10:40:00.000Z');

    // a different holder is blocked while unexpired...
    assert.throws(
      () => claimLease(wikiPath, { holder: 'session-b' }, home, new Date('2026-07-24T10:20:00Z')),
      /claimed by "session-a"/,
    );
    // ...can force...
    const forced = claimLease(wikiPath, { holder: 'session-b', force: true }, home, new Date('2026-07-24T10:20:00Z'));
    assert.equal(forced.holder, 'session-b');
    // ...and claims freely after expiry (lazy prune)
    const late = claimLease(wikiPath, { holder: 'session-c' }, home, new Date('2026-07-24T14:00:00Z'));
    assert.equal(late.holder, 'session-c');

    assert.equal(activeLease(wikiPath, home, new Date('2026-07-24T14:01:00Z')).holder, 'session-c');
    const released = releaseLease(wikiPath, home, new Date('2026-07-24T14:02:00Z'));
    assert.equal(released.holder, 'session-c');
    assert.equal(activeLease(wikiPath, home, new Date('2026-07-24T14:03:00Z')), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an expired lease reads as absent and a corrupt registry reads as empty', () => {
  const { home, wikiPath } = makeHome();
  try {
    claimLease(wikiPath, { holder: 'x', ttlMinutes: 1 }, home, new Date('2026-07-24T10:00:00Z'));
    assert.equal(activeLease(wikiPath, home, new Date('2026-07-24T10:02:00Z')), null);

    writeFileSync(leasesPath(home), 'not json');
    assert.equal(activeLease(wikiPath, home), null);
    assert.doesNotThrow(() => claimLease(wikiPath, { holder: 'y' }, home));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('claim/release CLI: happy path, foreign conflict, default-fallback refusal', () => {
  const { home, wikiPath } = makeHome();
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const claim = spawnSync('node', [CLI, 'claim', '--as', 'librarian-1', '--note', 'ingest pass'], { cwd: wikiPath, env, encoding: 'utf8' });
    assert.equal(claim.status, 0, claim.stderr);
    assert.match(claim.stdout, /claimed .*demo.* as "librarian-1"/);

    const foreign = spawnSync('node', [CLI, 'claim', '--as', 'librarian-2'], { cwd: wikiPath, env, encoding: 'utf8' });
    assert.equal(foreign.status, 1);
    assert.match(foreign.stderr, /claimed by "librarian-1"/);
    assert.match(foreign.stderr, /--force/);

    const neutral = join(home, 'neutral');
    mkdirSync(neutral);
    const implicit = spawnSync('node', [CLI, 'claim'], { cwd: neutral, env, encoding: 'utf8' });
    assert.equal(implicit.status, 1);
    assert.match(implicit.stderr, /refusing to claim the default wiki implicitly/);

    const release = spawnSync('node', [CLI, 'release'], { cwd: wikiPath, env, encoding: 'utf8' });
    assert.equal(release.status, 0, release.stderr);
    assert.match(release.stdout, /was held by "librarian-1"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('mutating verbs mention a held lease; read-only ground and exit codes are unaffected', () => {
  const { home, wikiPath } = makeHome();
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    claimLease(wikiPath, { holder: 'other-session' }, home);

    const mut = spawnSync('node', [CLI, 'ground', '--update-lock'], { cwd: wikiPath, env, encoding: 'utf8' });
    assert.equal(mut.status, 0, mut.stderr);
    assert.match(mut.stderr, /lease: "other-session" holds this wiki/);
    assert.ok(existsSync(join(wikiPath, 'wiki', '.tng-wiki.lock.json')), 'advisory - the write still happens');

    const ro = spawnSync('node', [CLI, 'ground'], { cwd: wikiPath, env, encoding: 'utf8' });
    assert.equal(ro.status, 0, ro.stderr);
    assert.ok(!/lease:/.test(ro.stderr), 'read-only runs stay quiet');

    const rounds = spawnSync('node', [CLI, 'rounds', '--json'], { cwd: wikiPath, env, encoding: 'utf8' });
    assert.equal(rounds.status, 0, rounds.stderr);
    assert.equal(JSON.parse(rounds.stdout).lease.holder, 'other-session');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('doctrine documents the merge story; schema teaches claim/release', async () => {
  const { generateAgentsMd, generateDoctrine } = await import('../src/agents/index.js');
  const doctrine = generateDoctrine({ wikiName: 'x' });
  assert.match(doctrine['grounding.md'], /## Merge Conflicts \(multi-machine wikis\)/);
  assert.match(doctrine['grounding.md'], /take ONE side wholesale/);
  assert.match(doctrine['grounding.md'], /cite_unlocked/);
  assert.match(doctrine['grounding.md'], /Never resolve a lockfile conflict by running `--update-lock` directly/);
  assert.match(doctrine['grounding.md'], /ground --fix-index/);

  const md = generateAgentsMd({ wikiName: 'x', domain: 'blank', wikiPath: '/tmp/x' });
  assert.match(md, /tng-wiki claim/);
  assert.match(md, /tng-wiki release/);
})
