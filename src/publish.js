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
// Publishing is idempotent: when the target _inbox/ upstream already holds a
// file with the identical blob, the capture is already there and nothing is
// pushed. That makes overlapping outbox flushes and a kill between push and
// cleanup harmless.
//
// Anything that cannot be published now queues in ~/.tng-wiki/outbox/ (the
// content is never lost); the next capture or sync retries.
import { execFileSync } from 'child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync,
  rmSync, statSync, unlinkSync, writeFileSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import { dirname, join, posix } from 'path';

const PUSH_ATTEMPTS = 8;
const STALE_CLAIM_MS = 10 * 60_000;

export class TransportError extends Error {
  // kind: 'network' (retry later), 'rejected' (the remote refused - needs a
  // human), 'race' (lost every retry to other pushers), 'detached' (no branch
  // to publish from right now).
  constructor(stage, message, kind = 'network') {
    super(`${stage} failed: ${message}`);
    this.stage = stage;
    this.kind = kind;
  }
}

function git(root, args, { env, input, timeout = 60_000 } = {}) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input, timeout, env: env ?? process.env,
  }).trim();
}

function gitOk(root, args, opts) {
  try { git(root, args, opts); return true; } catch { return false; }
}

// The whole stderr, trimmed - the last line alone ("failed to push some
// refs") hides the reason a hook or server gave.
function stderrText(e) {
  const text = `${e.stderr ?? ''}`.trim() || e.message || 'git failed';
  return text.split('\n').map((l) => l.replace(/^(remote|error|fatal|hint):\s*/, '').trim()).filter(Boolean).slice(0, 6).join(' | ').slice(0, 600);
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function classifyPushError(stderr) {
  if (/\((fetch first|non-fast-forward)\)|non-fast-forward/i.test(stderr)) return 'race';
  if (/\[remote rejected\]|declined|protected branch|permission|denied|403|unauthorized/i.test(stderr)) return 'rejected';
  return 'network';
}

export function repoRootOf(dir) {
  try { return realpathSync(git(dir, ['rev-parse', '--show-toplevel'])); } catch { return null; }
}

// The checked-out branch, or null on a detached HEAD (e.g. mid-rebase).
export function headBranch(root) {
  try { return git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']); } catch { return null; }
}

// { remote, mergeRef, trackingRef } for the checked-out branch, or null when
// HEAD is detached or the branch tracks nothing.
export function upstreamOf(root) {
  const branch = headBranch(root);
  if (!branch) return null;
  try {
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
export function identityEnv(root, base = process.env) {
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

// Path of a file under `dirRel` in `treeish` whose blob is `blob`, or null.
function sameBlobIn(root, treeish, dirRel, blob) {
  let listing = '';
  try { listing = git(root, ['ls-tree', '-r', treeish, '--', `${dirRel}/`]); } catch { return null; }
  for (const line of listing.split('\n')) {
    const m = line.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
    if (m && m[1] === blob) return m[2];
  }
  return null;
}

// 'updated' (fast-forwarded), 'ahead' (this clone holds unpublished commits),
// or 'blocked' (the fast-forward failed: a lock, or a file in the way).
function fastForwardLocal(root, commit) {
  if (!gitOk(root, ['merge-base', '--is-ancestor', 'HEAD', commit])) return 'ahead';
  return gitOk(root, ['merge', '--ff-only', '--quiet', commit]) ? 'updated' : 'blocked';
}

// Commit `content` at `relPath` onto the upstream branch and push it.
// Returns { commit, path, local, already }. Throws TransportError when it
// cannot be published now (the caller queues).
export function publishFile({ root, relPath, content, message }) {
  if (!headBranch(root)) throw new TransportError('publish', 'HEAD is detached (a rebase in progress?)', 'detached');
  const up = upstreamOf(root);
  if (!up) throw new Error(`${root} has no upstream branch - nothing to publish to`);
  const env = identityEnv(root);
  const blob = git(root, ['hash-object', '-w', '--stdin'], { input: content });
  const dirRel = posix.dirname(relPath);
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    try {
      git(root, ['fetch', '--quiet', up.remote, `+${up.mergeRef}:${up.trackingRef}`], { timeout: 120_000 });
    } catch (e) {
      // another process in this clone holds the ref lock: local contention, retry
      if (/cannot lock ref|unable to create .*\.lock|File exists/i.test(`${e.stderr ?? ''}`) && attempt < PUSH_ATTEMPTS) {
        sleepMs(50 * attempt + Math.floor(Math.random() * 150));
        continue;
      }
      throw new TransportError('fetch', stderrText(e), 'network');
    }
    const base = git(root, ['rev-parse', up.trackingRef]);
    const existing = sameBlobIn(root, base, dirRel, blob);
    if (existing) return { commit: base, path: existing, local: fastForwardLocal(root, base), already: true };

    const path = freePath(root, base, relPath);
    const scratch = mkdtempSync(join(tmpdir(), 'tng-wiki-capture-'));
    const indexEnv = { ...env, GIT_INDEX_FILE: join(scratch, 'index') };
    let commit;
    try {
      git(root, ['read-tree', base], { env: indexEnv });
      git(root, ['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env: indexEnv });
      const tree = git(root, ['write-tree'], { env: indexEnv });
      commit = git(root, ['commit-tree', tree, '-p', base, '-F', '-'], { env, input: message });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    try {
      git(root, ['push', '--quiet', up.remote, `${commit}:${up.mergeRef}`], { timeout: 120_000 });
    } catch (e) {
      const why = stderrText(e);
      const kind = classifyPushError(`${e.stderr ?? ''}`);
      if (kind === 'race' && attempt < PUSH_ATTEMPTS) {
        sleepMs(50 * attempt + Math.floor(Math.random() * 150));
        continue;
      }
      throw new TransportError('push', why, kind);
    }
    // Pushing to the configured remote normally moves the tracking ref itself;
    // this is a courtesy, and a lock on it must not fail a published capture.
    gitOk(root, ['update-ref', up.trackingRef, commit]);
    return { commit, path, local: fastForwardLocal(root, commit), already: false };
  }
  throw new TransportError('push', `still racing other pushers after ${PUSH_ATTEMPTS} attempts`, 'race');
}

// No upstream: write the file and commit only that path, so other sessions'
// staged work stays staged. Returns { commit, path }. On failure the file is
// removed again (no stray untracked capture); the caller queues the content.
export function commitLocal({ root, relPath, content, message }) {
  if (!headBranch(root)) throw new TransportError('commit', 'HEAD is detached (a rebase in progress?)', 'detached');
  const hasHead = gitOk(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  const path = freePath(root, hasHead ? 'HEAD' : null, relPath);
  const abs = join(root, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  const env = identityEnv(root);
  try {
    git(root, ['add', '--', path], { env });
    git(root, ['commit', '--quiet', '--only', '-F', '-', '--', path], { env, input: message });
  } catch (e) {
    gitOk(root, ['reset', '--quiet', '--', path]);
    rmSync(abs, { force: true });
    throw new TransportError('commit', stderrText(e), 'network');
  }
  return { commit: git(root, ['rev-parse', 'HEAD']), path };
}

// ---- outbox ----

export function outboxDir(home = homedir()) {
  return join(home, '.tng-wiki', 'outbox');
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function queueCapture({ root, relPath, content, message, error, kind = null }, home = homedir()) {
  const dir = outboxDir(home);
  mkdirSync(dir, { recursive: true });
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
  const file = join(dir, `${id}.json`);
  const entry = { root, relPath, content, message, error, kind, attempts: 1, queued_at: new Date().toISOString() };
  writeAtomic(file, JSON.stringify(entry, null, 2) + '\n');
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

// Take ownership of an entry by renaming it, so overlapping flushes (several
// sessions starting at once) never publish the same entry concurrently. A
// claim older than STALE_CLAIM_MS belonged to a killed process and is retaken.
function claim(dir, name) {
  const target = join(dir, `${name}.claim-${process.pid}`);
  try {
    renameSync(join(dir, name), target);
    return target;
  } catch {
    return null;
  }
}

function staleClaims(dir) {
  return readdirSync(dir).filter((f) => /\.json\.claim-\d+$/.test(f)).filter((f) => {
    try { return Date.now() - statSync(join(dir, f)).mtimeMs > STALE_CLAIM_MS; } catch { return false; }
  });
}

// Publish every queued capture that can be published now.
// Returns { published: [{ relPath, commit, path, already }], pending: [{ relPath, reason }] }.
export function flushOutbox(home = homedir()) {
  const dir = outboxDir(home);
  const published = [];
  const pending = [];
  if (!existsSync(dir)) return { published, pending };
  for (const stale of staleClaims(dir)) {
    try { renameSync(join(dir, stale), join(dir, stale.replace(/\.claim-\d+$/, ''))); } catch { /* raced */ }
  }
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const claimed = claim(dir, name);
    if (!claimed) continue;
    let entry;
    try {
      entry = JSON.parse(readFileSync(claimed, 'utf8'));
    } catch (e) {
      renameSync(claimed, join(dir, name));
      pending.push({ relPath: name, reason: `unreadable: ${e.message}` });
      continue;
    }
    const release = (reason, kind) => {
      writeAtomic(claimed, JSON.stringify({ ...entry, error: reason, kind, attempts: (entry.attempts ?? 1) + 1, last_attempt: new Date().toISOString() }, null, 2) + '\n');
      renameSync(claimed, join(dir, name));
      pending.push({ relPath: entry.relPath, reason, kind });
    };
    if (!existsSync(entry.root)) { release(`repo missing: ${entry.root}`, 'network'); continue; }
    try {
      const done = upstreamOf(entry.root) ? publishFile(entry) : commitLocal(entry);
      unlinkSync(claimed);
      published.push({ relPath: entry.relPath, commit: done.commit, path: done.path, already: !!done.already });
    } catch (e) {
      release(e.message, e.kind ?? 'network');
    }
  }
  return { published, pending };
}
