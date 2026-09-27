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
    for (const body of ['first', 'second']) {
      const r = capture(w, ['--wiki', 'hub', '--name', 'same'], { input: `# Same\n\n${body}\n` });
      assert.equal(r.status, 0, r.stderr);
    }
    assert.ok(existsSync(join(w.hub, '_inbox', 'same.md')));
    assert.ok(existsSync(join(w.hub, '_inbox', 'same-2.md')));
  } finally {
    w.cleanup();
  }
});

test('publishing is idempotent: identical content already upstream is not pushed twice', () => {
  const w = makeWorld();
  try {
    const first = JSON.parse(capture(w, ['--wiki', 'hub', '--json'], { input: '# Twice\n' }).stdout);
    const again = capture(w, ['--wiki', 'hub'], { input: '# Twice\n' });
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already published/);
    const files = execFileSync('git', ['--git-dir', w.origin, 'ls-tree', '-r', '--name-only', 'main', '--', 'hub/_inbox/'], { encoding: 'utf8' });
    assert.equal(files.split('\n').filter((f) => f.includes('twice')).length, 1);
    assert.ok(files.includes(first.path));
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
    assert.equal(result.local, 'ahead');
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

// --- regressions from the 2026-09-27 transport review ---

test('human output for a queued capture and a non-git wiki: exit 0, no crash, says not to re-capture', () => {
  const w = makeWorld();
  try {
    git(w.a, ['remote', 'set-url', 'origin', join(w.root, 'nowhere.git')]);
    const queued = capture(w, ['--wiki', 'hub'], { input: '# Offline\n' });
    assert.equal(queued.status, 0, queued.stderr);
    assert.match(queued.stdout, /saved, not yet published/);
    assert.match(queued.stdout, /Do not capture it again/);

    rmSync(join(w.a, '.git'), { recursive: true, force: true });
    const written = capture(w, ['--wiki', 'hub'], { input: '# No git\n' });
    assert.equal(written.status, 0, written.stderr);
    assert.match(written.stdout, /wrote .*not a git repo/);
  } finally {
    w.cleanup();
  }
});

test('overlapping outbox flushes publish each queued capture exactly once', async () => {
  const w = makeWorld();
  try {
    git(w.a, ['remote', 'set-url', 'origin', join(w.root, 'nowhere.git')]);
    for (const n of [1, 2, 3]) capture(w, ['--wiki', 'hub', '--json'], { input: `# Note ${n}\n` });
    git(w.a, ['remote', 'set-url', 'origin', w.origin]);
    const { spawn } = await import('node:child_process');
    const runs = [1, 2, 3].map(() => new Promise((done) => {
      const child = spawn('node', [CLI, 'sync', '--quiet'], { env: { ...GIT_ENV, HOME: w.home } });
      child.on('close', done);
    }));
    await Promise.all(runs);
    // contention may leave an entry queued for the next sync; never duplicated, never lost
    spawnSync('node', [CLI, 'sync', '--quiet'], { env: { ...GIT_ENV, HOME: w.home } });
    const files = execFileSync('git', ['--git-dir', w.origin, 'ls-tree', '-r', '--name-only', 'main', '--', 'hub/_inbox/'], { encoding: 'utf8' })
      .split('\n').filter((f) => f.includes('-note-'));
    assert.equal(files.length, 3, files.join('\n'));
    assert.equal(readdirSync(join(w.home, '.tng-wiki', 'outbox')).length, 0);
  } finally {
    w.cleanup();
  }
});

test('a wiki registered through a symlink publishes to the right path', () => {
  const w = makeWorld();
  try {
    const link = join(w.root, 'link');
    execFileSync('ln', ['-s', w.a, link]);
    writeFileSync(join(w.home, '.tng-wiki', 'registry.json'), JSON.stringify({
      version: 1, default: 'hub',
      wikis: { hub: { name: 'hub', path: join(link, 'hub'), domain: 'blank', registered: new Date().toISOString() } },
    }));
    const r = JSON.parse(capture(w, ['--wiki', 'hub', '--json'], { input: '# Via link\n' }).stdout);
    assert.equal(r.status, 'published');
    assert.match(r.path, /^hub\/_inbox\/.*-via-link\.md$/);
  } finally {
    w.cleanup();
  }
});

test('detached HEAD (e.g. mid-rebase): the capture queues instead of landing on a dangling commit', () => {
  const w = makeWorld();
  try {
    git(w.a, ['checkout', '-q', '--detach']);
    const r = JSON.parse(capture(w, ['--wiki', 'hub', '--json'], { input: '# Detached\n' }).stdout);
    assert.equal(r.status, 'queued');
    assert.equal(r.kind, 'detached');
  } finally {
    w.cleanup();
  }
});

test('a push the remote rejects (hook, protected branch) is not retried in a loop and says why', () => {
  const w = makeWorld();
  try {
    const counter = join(w.root, 'hook-count');
    writeFileSync(join(w.origin, 'hooks', 'pre-receive'), `#!/bin/sh\necho x >> "${counter}"\necho "branch is protected" >&2\nexit 1\n`, { mode: 0o755 });
    const r = JSON.parse(capture(w, ['--wiki', 'hub', '--json'], { input: '# Refused\n' }).stdout);
    assert.equal(r.status, 'queued');
    assert.equal(r.kind, 'rejected');
    assert.match(r.error, /branch is protected/);
    assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 1);
  } finally {
    w.cleanup();
  }
});

test('a failed local commit leaves no stray file and keeps the note in the outbox', () => {
  const w = makeWorld({ withRemote: false });
  try {
    writeFileSync(join(w.a, '.git', 'index.lock'), '');
    const r = JSON.parse(capture(w, ['--wiki', 'hub', '--json'], { input: '# Locked\n' }).stdout);
    assert.equal(r.status, 'queued');
    assert.equal(git(w.a, ['status', '--porcelain', '--untracked-files=all']).includes('locked'), false);
    assert.equal(readdirSync(join(w.home, '.tng-wiki', 'outbox')).length, 1);
  } finally {
    w.cleanup();
  }
});

test('prepareCapture edge cases: CRLF, empty frontmatter, YAML-looking titles, bad --also / --name', () => {
  const crlf = prepareCapture('---\r\ntitle: Windows note\r\n---\r\nBody\r\n', { host: 'h', date: '2026-09-27' });
  assert.equal(crlf.title, 'Windows note');
  assert.equal((crlf.content.match(/^---$/gm) ?? []).length, 2);
  const empty = prepareCapture('---\n---\n# Heading\n', { host: 'h', date: '2026-09-27' });
  assert.equal((empty.content.match(/^---$/gm) ?? []).length, 2);
  assert.match(prepareCapture('x\n', { host: 'h', date: '2026-09-27', title: '- item' }).content, /^title: "- item"$/m);
  assert.match(prepareCapture('x\n', { host: 'h', date: '2026-09-27', title: 'two\nlines' }).content, /^title: two lines$/m);
  assert.throws(() => prepareCapture('# T\n', { host: 'h', date: 'd', also: ['a]b'] }), /not a wiki slug/);
  assert.throws(() => prepareCapture('---\nalso: [x]\n---\n# T\n', { host: 'h', date: 'd', also: ['y'] }), /already has an `also:`/);
  assert.throws(() => prepareCapture('# T\n', { host: 'h', date: 'd', name: '../../escape' }), /plain file name/);
});
