// Git transport for captures (ADR 0001). A capture is one NEW file; it lands on
// the upstream branch through a private GIT_INDEX_FILE (read-tree the fetched
// upstream tip, add the blob, write-tree, commit-tree, push the SHA), so the
// user's index and working tree - where concurrent sessions stage their own
// work - are never touched. A push race is retried on the new tip; a new unique
// path can never conflict. Afterwards the local branch fast-forwards when it
// can (verified to carry unrelated staged and dirty changes along); when it
// holds unpushed commits it is left for `sync --push`. The file is never
// pre-written into the working tree: an untracked file at an incoming path
// aborts a later merge.
//
// Unreachable remotes queue the capture in ~/.tng-wiki/outbox/, flushed by the
// next capture or sync.
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { dirname, join } from 'path';

const PUSH_ATTEMPTS = 5;

export class TransportError extends Error {
  constructor(stage, message) {
    super(`${stage} failed: ${message}`);
    this.stage = stage;
  }
}

function git(root, args, { env, input, timeout = 60_000 } = {}) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input, timeout, env: env ?? process.env,
  }).trim();
}

function gitOk(root, args) {
  try { git(root, args); return true; } catch { return false; }
}

function stderrOf(e) {
  return `${e.stderr ?? ''}`.trim().split('\n').filter(Boolean).at(-1) ?? e.message;
}

export function repoRootOf(dir) {
  try { return git(dir, ['rev-parse', '--show-toplevel']); } catch { return null; }
}

// { remote, mergeRef, trackingRef } for the checked-out branch, or null when
// HEAD is detached or the branch tracks nothing.
export function upstreamOf(root) {
  try {
    const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    const remote = git(root, ['config', `branch.${branch}.remote`]);
    const mergeRef = git(root, ['config', `branch.${branch}.merge`]);
    const trackingRef = git(root, ['rev-parse', '--symbolic-full-name', '@{u}']);
    if (!remote || !mergeRef || !trackingRef) return null;
    return { remote, mergeRef, trackingRef };
  } catch {
    return null;
  }
}

// The user's git identity when configured; a neutral fallback otherwise, so a
// fresh machine can still capture.
function identityEnv(root, base = process.env) {
  let email = '';
  try { email = git(root, ['config', 'user.email']); } catch { /* unset */ }
  if (email || base.GIT_AUTHOR_EMAIL) return base;
  return {
    ...base,
    GIT_AUTHOR_NAME: base.GIT_AUTHOR_NAME || 'tng-wiki',
    GIT_AUTHOR_EMAIL: 'wiki@localhost',
    GIT_COMMITTER_NAME: base.GIT_COMMITTER_NAME || 'tng-wiki',
    GIT_COMMITTER_EMAIL: base.GIT_COMMITTER_EMAIL || 'wiki@localhost',
  };
}

function withSuffix(relPath, n) {
  if (n === 1) return relPath;
  const dot = relPath.lastIndexOf('.');
  const slash = relPath.lastIndexOf('/');
  return dot > slash ? `${relPath.slice(0, dot)}-${n}${relPath.slice(dot)}` : `${relPath}-${n}`;
}

// First of relPath, relPath-2, ... free both in `treeish` and the working tree.
function freePath(root, treeish, relPath) {
  for (let n = 1; n < 100; n++) {
    const candidate = withSuffix(relPath, n);
    if (existsSync(join(root, candidate))) continue;
    if (treeish && gitOk(root, ['cat-file', '-e', `${treeish}:${candidate}`])) continue;
    return candidate;
  }
  throw new Error(`no free name near ${relPath}`);
}

function fastForwardLocal(root, commit) {
  if (!gitOk(root, ['merge-base', '--is-ancestor', 'HEAD', commit])) return 'pending';
  return gitOk(root, ['merge', '--ff-only', '--quiet', commit]) ? 'updated' : 'pending';
}

// Commit `content` at `relPath` onto the upstream branch and push it.
// Returns { commit, path, local: 'updated' | 'pending' }. Throws TransportError
// when the remote is unreachable (the caller queues).
export function publishFile({ root, relPath, content, message }) {
  const up = upstreamOf(root);
  if (!up) throw new Error(`${root} has no upstream branch - nothing to publish to`);
  const env = identityEnv(root);
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    try {
      git(root, ['fetch', '--quiet', up.remote, `+${up.mergeRef}:${up.trackingRef}`], { timeout: 120_000 });
    } catch (e) {
      throw new TransportError('fetch', stderrOf(e));
    }
    const base = git(root, ['rev-parse', up.trackingRef]);
    const path = freePath(root, base, relPath);
    const scratch = mkdtempSync(join(tmpdir(), 'tng-wiki-capture-'));
    const indexEnv = { ...env, GIT_INDEX_FILE: join(scratch, 'index') };
    let commit;
    try {
      git(root, ['read-tree', base], { env: indexEnv });
      const blob = git(root, ['hash-object', '-w', '--stdin'], { input: content });
      git(root, ['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env: indexEnv });
      const tree = git(root, ['write-tree'], { env: indexEnv });
      commit = git(root, ['commit-tree', tree, '-p', base, '-F', '-'], { env, input: message });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    try {
      git(root, ['push', '--quiet', up.remote, `${commit}:${up.mergeRef}`], { timeout: 120_000 });
    } catch (e) {
      const why = stderrOf(e);
      const raced = /non-fast-forward|fetch first|rejected/i.test(`${e.stderr ?? ''}`);
      if (raced && attempt < PUSH_ATTEMPTS) continue;
      throw new TransportError('push', why);
    }
    git(root, ['update-ref', up.trackingRef, commit]);
    return { commit, path, local: fastForwardLocal(root, commit) };
  }
  throw new TransportError('push', `still racing after ${PUSH_ATTEMPTS} attempts`);
}

// No upstream: write the file and commit only that path, so other sessions'
// staged work stays staged. Returns { commit, path }.
export function commitLocal({ root, relPath, content, message }) {
  const hasHead = gitOk(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  const path = freePath(root, hasHead ? 'HEAD' : null, relPath);
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
  const env = identityEnv(root);
  git(root, ['add', '--', path], { env });
  git(root, ['commit', '--quiet', '--only', '-F', '-', '--', path], { env, input: message });
  return { commit: git(root, ['rev-parse', 'HEAD']), path };
}

// ---- outbox ----

export function outboxDir(home = homedir()) {
  return join(home, '.tng-wiki', 'outbox');
}

export function queueCapture({ root, relPath, content, message, error }, home = homedir()) {
  const dir = outboxDir(home);
  mkdirSync(dir, { recursive: true });
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
  const file = join(dir, `${id}.json`);
  writeFileSync(file, JSON.stringify({ root, relPath, content, message, error, queued_at: new Date().toISOString() }, null, 2) + '\n');
  return file;
}

export function listOutbox(home = homedir()) {
  const dir = outboxDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const file = join(dir, f);
    try {
      return { file, ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch (e) {
      return { file, invalid: e.message };
    }
  });
}

// Publish every queued capture that can be published now.
// Returns { published: [{ relPath, commit, path }], pending: [{ relPath, reason }] }.
export function flushOutbox(home = homedir()) {
  const published = [];
  const pending = [];
  for (const entry of listOutbox(home)) {
    if (entry.invalid) { pending.push({ relPath: entry.file, reason: `unreadable: ${entry.invalid}` }); continue; }
    if (!existsSync(entry.root)) { pending.push({ relPath: entry.relPath, reason: `repo missing: ${entry.root}` }); continue; }
    try {
      const done = upstreamOf(entry.root)
        ? publishFile(entry)
        : commitLocal(entry);
      unlinkSync(entry.file);
      published.push({ relPath: entry.relPath, commit: done.commit, path: done.path });
    } catch (e) {
      pending.push({ relPath: entry.relPath, reason: e.message });
    }
  }
  return { published, pending };
}
