// #38: sharing metadata in the committed manifest, monorepo register, and
// `tng-wiki sync` (ff-only pull + per-wiki arrivals report).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir, hostname } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync, execFileSync } from 'node:child_process';
import { readSharing, stampSharing, relationTo } from '../src/sharing.js';
import { syncWikis } from '../src/sync.js';
import { scaffoldWiki } from '../src/init.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
};
function git(repo, gitArgs) {
  return execFileSync('git', ['-C', repo, ...gitArgs], { stdio: 'pipe', env: GIT_ENV, encoding: 'utf8' }).trim();
}

test('sharing: stamp, read, and relation derivation', () => {
  const root = mkdtempSync(join(tmpdir(), 'tng-wiki-sharing-'));
  try {
    scaffoldWiki(root, { domain: 'blank', agent: 'claude-code', wikiName: 'S' });
    assert.equal(readSharing(root), null);
    stampSharing(root, 'shared');
    assert.deepEqual(readSharing(root), { mode: 'shared' });
    assert.equal(relationTo(readSharing(root), 'anybox'), 'shared');
    stampSharing(root, 'host:legion');
    assert.equal(relationTo(readSharing(root), 'legion'), 'mine');
    assert.equal(relationTo(readSharing(root), 'workbox'), 'other-host');
    assert.equal(relationTo(null, 'anybox'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Fake home with a monorepo of three child wikis: one shared, one this host's,
// one another host's.
function makeMonorepoHome() {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-mono-'));
  const mono = join(home, 'wikis');
  for (const [name, stamp] of [['shared-w', 'shared'], ['mine-w', `host:${hostname()}`], ['theirs-w', 'host:some-other-box']]) {
    const p = join(mono, name);
    mkdirSync(p, { recursive: true });
    scaffoldWiki(p, { domain: 'blank', agent: 'claude-code', wikiName: name });
    stampSharing(p, stamp);
  }
  mkdirSync(join(home, '.tng-wiki'), { recursive: true });
  writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({ version: 1, default: null, wikis: {} }));
  return { home, mono };
}

test('monorepo register --yes registers shared + mine, skips another host\'s wiki', () => {
  const { home, mono } = makeMonorepoHome();
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const r = spawnSync('node', [CLI, 'register', mono, '--yes'], { cwd: home, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Registered .*shared-w/);
    assert.match(r.stdout, /Registered .*mine-w/);
    assert.match(r.stdout, /skipped theirs-w - stamped host:some-other-box/);

    const list = spawnSync('node', [CLI, 'list'], { cwd: home, env, encoding: 'utf8' });
    assert.match(list.stdout, /shared-w/);
    assert.match(list.stdout, /\[shared\]/);
    assert.ok(!/theirs-w/.test(list.stdout));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('register refuses another host\'s wiki without --force', () => {
  const { home, mono } = makeMonorepoHome();
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const refuse = spawnSync('node', [CLI, 'register', join(mono, 'theirs-w')], { cwd: home, env, encoding: 'utf8' });
    assert.equal(refuse.status, 1);
    assert.match(refuse.stderr, /another host's wiki/);
    assert.match(refuse.stderr, /--force/);

    const forced = spawnSync('node', [CLI, 'register', join(mono, 'theirs-w'), '--force'], { cwd: home, env, encoding: 'utf8' });
    assert.equal(forced.status, 0, forced.stderr);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Two clones of a bare origin, monorepo layout with one child wiki. Machine B
// pushes an _inbox arrival and a raw source; sync on machine A must ff-pull
// and attribute both to the child wiki.
function makeSyncFixture() {
  const base = mkdtempSync(join(tmpdir(), 'tng-wiki-sync-'));
  const origin = join(base, 'origin.git');
  // -b main on the bare too: otherwise its HEAD points at an unborn default
  // branch and clones check out nothing.
  execFileSync('git', ['init', '--bare', '-b', 'main', origin], { stdio: 'pipe', env: GIT_ENV });

  const seed = join(base, 'seed');
  mkdirSync(join(seed, 'child'), { recursive: true });
  scaffoldWiki(join(seed, 'child'), { domain: 'blank', agent: 'claude-code', wikiName: 'Child' });
  execFileSync('git', ['init', '-b', 'main', seed], { stdio: 'pipe', env: GIT_ENV });
  git(seed, ['add', '-A']);
  git(seed, ['commit', '-m', 'seed']);
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['push', '-u', 'origin', 'main']);

  const cloneA = join(base, 'a');
  const cloneB = join(base, 'b');
  execFileSync('git', ['clone', origin, cloneA], { stdio: 'pipe', env: GIT_ENV });
  execFileSync('git', ['clone', origin, cloneB], { stdio: 'pipe', env: GIT_ENV });

  const home = join(base, 'home');
  mkdirSync(join(home, '.tng-wiki'), { recursive: true });
  writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({
    version: 1, default: 'child',
    wikis: { child: { name: 'Child', path: join(cloneA, 'child'), domain: 'blank', registered: new Date().toISOString() } },
  }));
  return { base, origin, cloneA, cloneB, home };
}

test('sync ff-pulls and reports _inbox arrivals and raw additions per wiki', () => {
  const { base, cloneB, home } = makeSyncFixture();
  try {
    mkdirSync(join(cloneB, 'child', '_inbox'), { recursive: true });
    mkdirSync(join(cloneB, 'child', 'raw'), { recursive: true }); // git drops empty dirs on clone
    writeFileSync(join(cloneB, 'child', '_inbox', 'capture-from-b.md'), '# From B\n');
    writeFileSync(join(cloneB, 'child', 'raw', 'new-source.md'), '# New\n');
    git(cloneB, ['add', '-A']);
    git(cloneB, ['commit', '-m', 'b: capture + source']);
    git(cloneB, ['push']);

    const result = syncWikis({ home });
    assert.equal(result.repos.length, 1);
    assert.equal(result.repos[0].status, 'updated');
    const child = result.wikis.find((w) => w.slug === 'child');
    assert.deepEqual(child.arrivals, ['_inbox/capture-from-b.md']);
    assert.deepEqual(child.raw_added, ['raw/new-source.md']);

    const again = syncWikis({ home });
    assert.equal(again.repos[0].status, 'up-to-date');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('sync reports diverged repos without touching them and skips non-git wikis', () => {
  const { base, cloneA, cloneB, home } = makeSyncFixture();
  try {
    writeFileSync(join(cloneA, 'child', 'wiki', 'local.md'), 'local change\n');
    git(cloneA, ['add', '-A']);
    git(cloneA, ['commit', '-m', 'a: local']);
    writeFileSync(join(cloneB, 'child', 'wiki', 'remote.md'), 'remote change\n');
    git(cloneB, ['add', '-A']);
    git(cloneB, ['commit', '-m', 'b: remote']);
    git(cloneB, ['push']);

    const headBefore = git(cloneA, ['rev-parse', 'HEAD']);
    const result = syncWikis({ home });
    assert.equal(result.repos[0].status, 'diverged');
    assert.equal(git(cloneA, ['rev-parse', 'HEAD']), headBefore, 'diverged repo left untouched');

    const plain = join(base, 'plain-wiki');
    mkdirSync(plain, { recursive: true });
    scaffoldWiki(plain, { domain: 'blank', agent: 'claude-code', wikiName: 'Plain' });
    writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({
      version: 1, default: 'plain',
      wikis: { plain: { name: 'Plain', path: plain, domain: 'blank', registered: new Date().toISOString() } },
    }));
    const r2 = syncWikis({ home });
    assert.deepEqual(r2.skipped, [{ slug: 'plain', reason: 'not a git repo' }]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
