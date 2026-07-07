// Read-only git helpers for `tng-wiki ground --at-ref`: resolve cited code files
// at an authority's pinned ref instead of the working tree.
//
// Every function is pure and NEVER throws — failures (not a repo, bad ref, file
// absent at ref) return false / null so the caller can map them to a structural
// grounding issue rather than crash the lint run.
//
// We use `execFileSync` with an argument array (not the `execSync` shell pattern
// the rest of the repo uses for fixed commands) on purpose: `ref` and `file` come
// from `.tng-wiki.json` and from inline citations, so they may contain spaces or
// shell metacharacters. An argument array passes them verbatim with no quoting.

import { execFileSync } from 'child_process';

function git(repoDir, args, { capture = false } = {}) {
  return execFileSync('git', ['-C', repoDir, ...args], {
    stdio: capture ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'ignore', 'ignore'],
    encoding: 'utf8',
  });
}

// Does `ref` resolve to a commit in the repo at `repoDir`? False when the path is
// not a git repo or the ref is unknown — the caller treats that as code_ref_unresolvable.
export function refResolves(repoDir, ref) {
  try {
    git(repoDir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { capture: true });
    return true;
  } catch {
    return false;
  }
}

// SHA that `ref` resolves to in the repo at `repoDir` (pass 'HEAD' for the
// working-tree tip), or null when the path is not a git repo / the ref is
// unknown. Recorded in the lockfile `authorities` block so branch refs become
// deterministic ("verified against develop@5e36f17").
export function resolveRefSha(repoDir, ref) {
  try {
    const out = git(repoDir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { capture: true }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// Does the working tree at `repoDir` have uncommitted changes? Null when the
// path is not a git repo (callers treat that as "unknown", not dirty).
export function repoIsDirty(repoDir) {
  try {
    return git(repoDir, ['status', '--porcelain'], { capture: true }).trim().length > 0;
  } catch {
    return null;
  }
}

// Working-tree churn for the wiki's own repo: entries `git status` sees as
// modified/staged (changed) vs untracked. Null when `repoDir` is not a git
// repo - callers render nothing rather than "0", since the absence of git is
// not cleanliness. Feeds the ritual meta-health line in rounds/status: a wiki
// whose pages read clean can still be weeks behind on its commit discipline.
export function workingTreeCounts(repoDir) {
  try {
    const lines = git(repoDir, ['status', '--porcelain'], { capture: true })
      .split('\n')
      .filter(Boolean);
    const untracked = lines.filter((l) => l.startsWith('??')).length;
    return { changed: lines.length - untracked, untracked };
  } catch {
    return null;
  }
}

// Does `file` exist in the tree at `ref`?
export function fileExistsAtRef(repoDir, ref, file) {
  try {
    git(repoDir, ['cat-file', '-e', `${ref}:${file}`]);
    return true;
  } catch {
    return false;
  }
}

// Contents of `file` at `ref`, or null if it cannot be read.
export function readFileAtRef(repoDir, ref, file) {
  try {
    return git(repoDir, ['show', `${ref}:${file}`], { capture: true });
  } catch {
    return null;
  }
}

// Commit date of the most recent commit touching `file` up to `ref`, as a Date,
// or null if the file has no history at that ref (treat as not-stale).
export function fileCommitDateAtRef(repoDir, ref, file) {
  try {
    const out = git(repoDir, ['log', '-1', '--format=%cI', ref, '--', file], { capture: true }).trim();
    if (!out) return null;
    const d = new Date(out);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// Commit date of the most recent commit touching `file` at HEAD, as a Date, or
// null if `repoDir` is not a git repo or the file is untracked / has no history.
// Unlike filesystem mtime, this survives `git clone` (which resets mtimes), so it
// is the reliable staleness signal for a git-synced wiki.
export function fileCommitDate(repoDir, file) {
  return fileCommitDateAtRef(repoDir, 'HEAD', file);
}

// Repo-relative paths of files committed at HEAD under `dir`, as a Set, or null
// when `repoDir` is not a git repo or has no commits yet — callers treat every
// file as uncommitted (mtime fallback) in that case.
export function filesAtHead(repoDir, dir) {
  try {
    const out = git(repoDir, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', dir], { capture: true });
    return new Set(out.split('\0').filter(Boolean));
  } catch {
    return null;
  }
}

// Pathspecs per `git log` call below — well under OS arg-length limits even with
// long wiki paths, while keeping the process count O(pages / chunk), not O(pages).
const PATHSPEC_CHUNK = 500;

// Newest commit date across `files` (repo-relative paths) at HEAD, as a Date, or
// null when none of them has history. `git log -1` already returns the most
// recent commit touching ANY of its pathspecs, so this is one process per chunk
// of files instead of one per file.
export function newestCommitDate(repoDir, files) {
  let newest = null;
  for (let i = 0; i < files.length; i += PATHSPEC_CHUNK) {
    try {
      const out = git(
        repoDir,
        ['log', '-1', '--format=%cI', 'HEAD', '--', ...files.slice(i, i + PATHSPEC_CHUNK)],
        { capture: true },
      ).trim();
      if (!out) continue;
      const d = new Date(out);
      if (!isNaN(d.getTime()) && (newest === null || d > newest)) newest = d;
    } catch {
      // best-effort: a failed chunk contributes no date
    }
  }
  return newest;
}
