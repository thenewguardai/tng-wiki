// `tng-wiki capture` (ADR 0001): a capture commits straight onto the upstream
// branch through a private index, never touching the user's index or working
// tree, and queues in the outbox when the remote is unreachable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { scaffoldWiki } from '../src/init.js';
import { prepareCapture, slugifyTitle } from '../src/capture.js';

const CLI = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin', 'cli.js');
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const IDENTITY = {
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(repo, args, extra = {}) {
  return execFileSync('git', ['-C', repo, ...args], { env: { ...GIT_ENV, ...IDENTITY, ...extra }, encoding: 'utf8', stdio: 'pipe' }).trim();
}

// A bare origin holding a monorepo with one hub (`hub/`, with _inbox/), two
// clones (a = this machine, b = another machine), and a fake HOME whose
// registry points `hub` at clone a.
function makeWorld({ withRemote = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tng-wiki-capture-'));
  const origin = join(root, 'origin.git');
  const a = join(root, 'a');
  const home = join(root, 'home');
  mkdirSync(a, { recursive: true });
  git(a, ['init', '-q', '-b', 'main']);
  const hub = join(a, 'hub');
  mkdirSync(hub);
  scaffoldWiki(hub, { domain: 'blank', agent: 'claude-code', wikiName: 'hub' });
  mkdirSync(join(hub, '_inbox'), { recursive: true });
  writeFileSync(join(hub, '_inbox', '.gitkeep'), '');
  git(a, ['add', '-A']);
  git(a, ['commit', '-q', '-m', 'init']);
  let b = null;
  if (withRemote) {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env: GIT_ENV });
    git(a, ['remote', 'add', 'origin', origin]);
    git(a, ['push', '-q', '-u', 'origin', 'main']);
    b = join(root, 'b');
    execFileSync('git', ['clone', '-q', origin, b], { env: GIT_ENV });
  }
  mkdirSync(join(home, '.tng-wiki'), { recursive: true });
  writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({
    version: 1, default: 'hub',
    wikis: { hub: { name: 'hub', path: hub, domain: 'blank', registered: new Date().toISOString() } },
  }));
  return { root, origin, a, b, hub, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function capture(world, args, { input, cwd, env = {} } = {}) {
  return spawnSync('node', [CLI, 'capture', ...args], {
    cwd: cwd ?? world.root, input, encoding: 'utf8',
    env: { ...GIT_ENV, HOME: world.home, TNG_WIKI_HOST: 'travel-box', ...env },
  });
}

// --- content preparation (pure) ---

test('slugifyTitle makes short kebab names', () => {
  assert.equal(slugifyTitle('WebGL GPU timers: busy time, not cost!'), 'webgl-gpu-timers-busy-time-not-cost');
  assert.ok(slugifyTitle('word '.repeat(40)).length <= 80);
});

test('prepareCapture completes frontmatter without overwriting, and derives the name', () => {
  const fresh = prepareCapture('# A finding: with a colon\n\nBody.\n', {
    host: 'legion', date: '2026-09-27', also: ['shared', 'legion-ubuntu'],
  });
  assert.equal(fresh.title, 'A finding: with a colon');
  assert.equal(fresh.name, '2026-09-27-a-finding-with-a-colon.md');
  assert.match(fresh.content, /^---\ntitle: "A finding: with a colon"\ndate: 2026-09-27\ncaptured_on: legion\nalso: \[shared, legion-ubuntu\]\n---\n# A finding/);

  const kept = prepareCapture('---\ntitle: Mine\ndate: 2026-01-01\n---\nBody\n', { host: 'legion', date: '2026-09-27', title: 'Ignored' });
  assert.equal(kept.title, 'Mine');
  assert.match(kept.content, /^---\ntitle: Mine\ndate: 2026-01-01\ncaptured_on: legion\n---\nBody\n$/);

  assert.throws(() => prepareCapture('no heading, no title\n', { host: 'h', date: '2026-09-27' }), /--title/);
  assert.equal(prepareCapture('x\n', { host: 'h', date: '2026-09-27', title: 'T', name: 'custom' }).name, 'custom.md');
});

// --- transport ---

test('capture lands on origin without touching another session\'s staged work', () => {
  const w = makeWorld();
  try {
    writeFileSync(join(w.hub, 'wiki', 'in-progress.md'), 'librarian mid-edit\n');
    git(w.a, ['add', 'hub/wiki/in-progress.md']);
    writeFileSync(join(w.a, 'hub', 'AGENTS.md'), readFileSync(join(w.a, 'hub', 'AGENTS.md'), 'utf8') + '\nunstaged edit\n');
    const r = capture(w, ['--wiki', 'hub', '--trailer', 'Claude-Session: https://example/s'], { input: '# GPU timers lie\n\nDetail.\n' });
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout;
    assert.match(out, /published/);

    const rel = `hub/_inbox/${new Date().toLocaleDateString('en-CA')}-gpu-timers-lie.md`;
    const originLog = execFileSync('git', ['--git-dir', w.origin, 'log', '-1', '--format=%s%n%b', '--name-only'], { encoding: 'utf8' });
    assert.match(originLog, /^hub inbox: GPU timers lie/);
    assert.match(originLog, /Captured-On: travel-box/);
    assert.match(originLog, /Claude-Session: https:\/\/example\/s/);
    assert.match(originLog, new RegExp(rel.replace(/\./g, '\\.')));
    assert.doesNotMatch(originLog, /in-progress/);

    // the other session's work is exactly as it was; the capture fast-forwarded in
    const status = execFileSync('git', ['-C', w.a, 'status', '--porcelain'], { env: GIT_ENV, encoding: 'utf8' });
    assert.match(status, /^A  hub\/wiki\/in-progress\.md$/m);
    assert.match(status, /^ M hub\/AGENTS\.md$/m);
    assert.ok(existsSync(join(w.a, rel)));
    assert.equal(git(w.a, ['rev-parse', 'HEAD']), execFileSync('git', ['--git-dir', w.origin, 'rev-parse', 'main'], { encoding: 'utf8' }).trim());

    // the other machine sees it on its next pull
    git(w.b, ['pull', '-q', '--ff-only']);
    assert.ok(existsSync(join(w.b, rel)));
  } finally {
    w.cleanup();
  }
});

test('a name already taken on origin gets a numeric suffix', () => {
  const w = makeWorld();
  try {
    for (let n = 0; n < 2; n++) {
      const r = capture(w, ['--wiki', 'hub', '--name', 'same'], { input: '# Same\n' });
      assert.equal(r.status, 0, r.stderr);
    }
    assert.ok(existsSync(join(w.hub, '_inbox', 'same.md')));
    assert.ok(existsSync(join(w.hub, '_inbox', 'same-2.md')));
  } finally {
    w.cleanup();
  }
});

test('local commits not yet pushed: capture still publishes; the local branch is left for sync', () => {
  const w = makeWorld();
  try {
    writeFileSync(join(w.hub, 'wiki', 'librarian.md'), 'filed\n');
    git(w.a, ['add', '-A']);
    git(w.a, ['commit', '-q', '-m', 'librarian work']);
    const head = git(w.a, ['rev-parse', 'HEAD']);
    const r = capture(w, ['--wiki', 'hub', '--json'], { input: '# Diverged\n' });
    assert.equal(r.status, 0, r.stderr);
    const result = JSON.parse(r.stdout);
    assert.equal(result.status, 'published');
    assert.equal(result.local, 'pending');
    assert.equal(git(w.a, ['rev-parse', 'HEAD']), head);
    assert.equal(existsSync(join(w.hub, result.path.replace(/^hub\//, ''))), false, 'must not pre-write the file (it would block the later merge)');
  } finally {
    w.cleanup();
  }
});

test('no upstream: a path-only local commit that leaves other staged work staged', () => {
  const w = makeWorld({ withRemote: false });
  try {
    writeFileSync(join(w.hub, 'wiki', 'staged.md'), 'x\n');
    git(w.a, ['add', 'hub/wiki/staged.md']);
    const r = capture(w, ['--wiki', 'hub', '--json'], { input: '# Local only\n' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).status, 'committed');
    assert.match(git(w.a, ['log', '-1', '--name-only', '--format=%s']), /hub inbox: Local only\n\nhub\/_inbox\/.*-local-only\.md$/);
    assert.match(git(w.a, ['status', '--porcelain']), /^A  hub\/wiki\/staged\.md$/m);
  } finally {
    w.cleanup();
  }
});

test('unreachable remote: the capture queues in the outbox and sync publishes it later', () => {
  const w = makeWorld();
  try {
    git(w.a, ['remote', 'set-url', 'origin', join(w.root, 'nowhere.git')]);
    const r = capture(w, ['--wiki', 'hub', '--json'], { input: '# Offline finding\n' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).status, 'queued');
    const outbox = join(w.home, '.tng-wiki', 'outbox');
    assert.equal(readdirSync(outbox).length, 1);

    git(w.a, ['remote', 'set-url', 'origin', w.origin]);
    const s = spawnSync('node', [CLI, 'sync', '--json'], { encoding: 'utf8', env: { ...GIT_ENV, HOME: w.home } });
    assert.equal(s.status, 0, s.stderr);
    assert.equal(JSON.parse(s.stdout).outbox.published.length, 1);
    assert.equal(readdirSync(outbox).length, 0);
    assert.match(execFileSync('git', ['--git-dir', w.origin, 'log', '-1', '--format=%s'], { encoding: 'utf8' }), /Offline finding/);
  } finally {
    w.cleanup();
  }
});

// --- targeting ---

test('without --wiki outside any wiki: prints every hub scope and refuses to guess', () => {
  const w = makeWorld();
  try {
    const r = capture(w, [], { input: '# Where does this go\n', cwd: w.home });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /hub/);
    assert.match(r.stderr, /--wiki/);
  } finally {
    w.cleanup();
  }
});

test('a wiki without _inbox/ is refused', () => {
  const w = makeWorld();
  try {
    rmSync(join(w.hub, '_inbox'), { recursive: true, force: true });
    const r = capture(w, ['--wiki', 'hub'], { input: '# X\n' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /_inbox/);
  } finally {
    w.cleanup();
  }
});
