// `sync --push` (the librarian's publish step, ADR 0001), unpushed-commit
// reporting, and `sync --quiet` for session-start hooks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { scaffoldWiki } from '../src/init.js';
import { syncWikis } from '../src/sync.js';
import { setLibrarian } from '../src/librarian.js';

const CLI = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin', 'cli.js');
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe', env: GIT_ENV, encoding: 'utf8' }).trim();
}

function commitFile(repo, rel, content, msg) {
  mkdirSync(join(repo, rel, '..'), { recursive: true });
  writeFileSync(join(repo, rel), content);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', msg]);
}

function makeFixture() {
  const base = mkdtempSync(join(tmpdir(), 'tng-wiki-syncpush-'));
  const origin = join(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: GIT_ENV });
  const seed = join(base, 'seed');
  mkdirSync(join(seed, 'hub'), { recursive: true });
  scaffoldWiki(join(seed, 'hub'), { domain: 'blank', agent: 'claude-code', wikiName: 'Hub' });
  git(base, ['init', '-q', '-b', 'main', seed]);
  git(seed, ['add', '-A']);
  git(seed, ['commit', '-q', '-m', 'seed']);
  git(seed, ['remote', 'add', 'origin', origin]);
  git(seed, ['push', '-q', '-u', 'origin', 'main']);
  const a = join(base, 'a');
  const b = join(base, 'b');
  execFileSync('git', ['clone', '-q', origin, a], { env: GIT_ENV });
  execFileSync('git', ['clone', '-q', origin, b], { env: GIT_ENV });
  const home = join(base, 'home');
  mkdirSync(join(home, '.tng-wiki'), { recursive: true });
  writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({
    version: 1, default: 'hub',
    wikis: { hub: { name: 'Hub', path: join(a, 'hub'), domain: 'blank', registered: new Date().toISOString() } },
  }));
  const originHead = () => execFileSync('git', ['--git-dir', origin, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  return { base, origin, a, b, home, originHead, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('local commits without --push are reported as ahead and stay local', () => {
  const f = makeFixture();
  try {
    commitFile(f.a, 'hub/wiki/filed.md', 'x\n', 'librarian: filed');
    const before = f.originHead();
    const r = syncWikis({ home: f.home });
    assert.equal(r.repos[0].status, 'ahead');
    assert.equal(r.repos[0].ahead, 1);
    assert.equal(f.originHead(), before);
  } finally {
    f.cleanup();
  }
});

test('--push publishes ahead-only commits', () => {
  const f = makeFixture();
  try {
    commitFile(f.a, 'hub/wiki/filed.md', 'x\n', 'librarian: filed');
    const r = syncWikis({ home: f.home, push: true });
    assert.equal(r.repos[0].status, 'pushed');
    assert.equal(f.originHead(), git(f.a, ['rev-parse', 'HEAD']));
  } finally {
    f.cleanup();
  }
});

test('--push on a diverged repo rebases local commits over incoming captures, pushes, and reports arrivals', () => {
  const f = makeFixture();
  try {
    commitFile(f.a, 'hub/wiki/filed.md', 'x\n', 'librarian: filed');
    commitFile(f.b, 'hub/_inbox/from-b.md', '# From b\n', 'hub inbox: from b');
    git(f.b, ['push', '-q']);
    writeFileSync(join(f.a, 'hub', 'untracked-note.txt'), 'untracked files do not block the rebase\n');

    const r = syncWikis({ home: f.home, push: true });
    assert.equal(r.repos[0].status, 'rebased');
    assert.equal(f.originHead(), git(f.a, ['rev-parse', 'HEAD']));
    assert.ok(existsSync(join(f.a, 'hub', '_inbox', 'from-b.md')));
    assert.match(git(f.a, ['log', '-1', '--format=%s']), /librarian: filed/);
    assert.deepEqual(r.wikis.find((w) => w.slug === 'hub').arrivals, ['_inbox/from-b.md']);
  } finally {
    f.cleanup();
  }
});

test('--push refuses to rebase over uncommitted tracked edits, and never stashes', () => {
  const f = makeFixture();
  try {
    commitFile(f.a, 'hub/wiki/filed.md', 'x\n', 'librarian: filed');
    commitFile(f.b, 'hub/_inbox/from-b.md', '# From b\n', 'hub inbox: from b');
    git(f.b, ['push', '-q']);
    writeFileSync(join(f.a, 'hub', 'wiki', 'filed.md'), 'mid-edit\n');
    const head = git(f.a, ['rev-parse', 'HEAD']);

    const r = syncWikis({ home: f.home, push: true });
    assert.equal(r.repos[0].status, 'dirty');
    assert.equal(git(f.a, ['rev-parse', 'HEAD']), head);
    assert.equal(git(f.a, ['stash', 'list']), '');
  } finally {
    f.cleanup();
  }
});

test('--push aborts a conflicting rebase and leaves the clone as it was', () => {
  const f = makeFixture();
  try {
    commitFile(f.a, 'hub/wiki/log.md', 'a side\n', 'a: log');
    commitFile(f.b, 'hub/wiki/log.md', 'b side\n', 'b: log');
    git(f.b, ['push', '-q']);
    const head = git(f.a, ['rev-parse', 'HEAD']);

    const r = syncWikis({ home: f.home, push: true });
    assert.equal(r.repos[0].status, 'conflict');
    assert.deepEqual(r.repos[0].conflicts, ['hub/wiki/log.md']);
    assert.equal(git(f.a, ['rev-parse', 'HEAD']), head);
    assert.equal(existsSync(join(f.a, '.git', 'rebase-merge')), false);
    assert.equal(git(f.a, ['status', '--porcelain']), '');
    assert.equal(git(f.a, ['worktree', 'list']).split('\n').length, 1, 'temporary rebase worktree left behind');
  } finally {
    f.cleanup();
  }
});

test('sync --quiet prints nothing when there is nothing to say, and the arrival when there is', () => {
  const f = makeFixture();
  try {
    const run = () => spawnSync('node', [CLI, 'sync', '--quiet'], { encoding: 'utf8', env: { ...GIT_ENV, HOME: f.home } });
    let r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
    commitFile(f.b, 'hub/_inbox/from-b.md', '# From b\n', 'hub inbox: from b');
    git(f.b, ['push', '-q']);
    r = run();
    assert.match(r.stdout, /inbox arrival: _inbox\/from-b\.md/);
  } finally {
    f.cleanup();
  }
});

test('--push refuses to publish compiled-state commits for a wiki this machine only captures for', () => {
  const f = makeFixture();
  const saved = process.env.TNG_WIKI_HOST;
  try {
    process.env.TNG_WIKI_HOST = 'travel-box';
    setLibrarian(join(f.a, 'hub'), 'home-box');
    git(f.a, ['add', '-A']);
    git(f.a, ['commit', '-q', '-m', 'stamp librarian']);
    const before = f.originHead();
    let r = syncWikis({ home: f.home, push: true });
    assert.equal(r.repos[0].status, 'off-seat');
    assert.match(r.repos[0].error, /librarian is "home-box"/);
    assert.equal(f.originHead(), before);

    // a capture committed by hand into the capturer's _inbox/ is fine to publish
    git(f.a, ['reset', '-q', '--hard', 'origin/main']);
    commitFile(f.a, 'hub/_inbox/by-hand.md', '# By hand\n', 'hub inbox: by hand');
    r = syncWikis({ home: f.home, push: true });
    assert.equal(r.repos[0].status, 'pushed');

    commitFile(f.a, 'hub/wiki/page.md', 'x\n', 'page');
    assert.equal(syncWikis({ home: f.home, push: true, offHost: true }).repos[0].status, 'pushed');
  } finally {
    if (saved === undefined) delete process.env.TNG_WIKI_HOST; else process.env.TNG_WIKI_HOST = saved;
    f.cleanup();
  }
});

test('one broken repo does not stop the sweep', () => {
  const f = makeFixture();
  try {
    // a second registered wiki whose repo has an unborn HEAD
    const broken = join(f.base, 'broken');
    mkdirSync(join(broken, 'w'), { recursive: true });
    scaffoldWiki(join(broken, 'w'), { domain: 'blank', agent: 'claude-code', wikiName: 'Broken' });
    git(f.base, ['init', '-q', '-b', 'main', broken]);
    const registry = JSON.parse(readFileSync(join(f.home, '.tng-wiki', 'registry.json'), 'utf8'));
    registry.wikis = { broken: { name: 'Broken', path: join(broken, 'w'), domain: 'blank', registered: new Date().toISOString() }, ...registry.wikis };
    writeFileSync(join(f.home, '.tng-wiki', 'registry.json'), JSON.stringify(registry));
    commitFile(f.b, 'hub/_inbox/from-b.md', '# From b\n', 'hub inbox: from b');
    git(f.b, ['push', '-q']);

    const r = syncWikis({ home: f.home });
    const byRoot = Object.fromEntries(r.repos.map((x) => [x.wikis[0], x.status]));
    assert.equal(byRoot.broken, 'error');
    assert.equal(byRoot.hub, 'updated');
  } finally {
    f.cleanup();
  }
});

test('on a capturer seat, arrivals are not a triage prompt: --quiet stays silent, plain sync names the librarian', () => {
  const f = makeFixture();
  try {
    setLibrarian(join(f.b, 'hub'), 'home-box');
    commitFile(f.b, 'hub/_inbox/from-b.md', '# From b\n', 'hub inbox: from b + librarian');
    git(f.b, ['push', '-q']);
    // CI forces color; compare the text, not the escapes
    const strip = (t) => t.replace(/\x1B\[[0-9;]*m/g, '');
    const run = (args, host) => {
      const r = spawnSync('node', [CLI, 'sync', ...args], { encoding: 'utf8', env: { ...GIT_ENV, HOME: f.home, TNG_WIKI_HOST: host } });
      return { ...r, stdout: strip(r.stdout) };
    };
    const quiet = run(['--quiet'], 'travel-box');
    assert.equal(quiet.status, 0, quiet.stderr);
    assert.doesNotMatch(quiet.stdout, /triage|inbox arrival/);

    commitFile(f.b, 'hub/_inbox/second.md', '# Second\n', 'hub inbox: second');
    git(f.b, ['push', '-q']);
    const plain = run([], 'travel-box');
    assert.match(plain.stdout, /1 new capture\(s\) - filed by home-box/);
    assert.doesNotMatch(plain.stdout, /triage/);

    commitFile(f.b, 'hub/_inbox/third.md', '# Third\n', 'hub inbox: third');
    git(f.b, ['push', '-q']);
    assert.match(run(['--quiet'], 'home-box').stdout, /inbox arrival: _inbox\/third\.md - triage/);
  } finally {
    f.cleanup();
  }
});
