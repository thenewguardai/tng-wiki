// `tng-wiki sync` (#38, ADR 0001) - sync the git repos behind registered
// wikis and report what arrived, per wiki: `_inbox/` arrivals prominently (the
// triage queue), plus counts for new raw/ sources, wiki/ page changes, and
// lockfile movement. Plain sync only fast-forwards and reports local commits
// that were never published; `--push` is the librarian's publish step (push,
// rebasing over incoming captures when diverged). Captures queued offline are
// flushed first. Monorepos are handled naturally: wikis are grouped by git
// root, each root is synced once, and the diff is attributed to wikis by path.
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import pc from 'picocolors';
import { loadRegistry, listWikis } from './registry.js';
import { flushOutbox, upstreamOf, identityEnv, headBranch } from './publish.js';
import { seatFor } from './librarian.js';

function git(repoDir, gitArgs, { timeout = 60_000, env = process.env } = {}) {
  return execFileSync('git', ['-C', repoDir, ...gitArgs], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, env,
  }).trim();
}

function gitRoot(dir) {
  try { return realpathSync(git(dir, ['rev-parse', '--show-toplevel'])); } catch { return null; }
}

function tryGit(root, args, opts) {
  try { return { ok: true, out: git(root, args, opts) }; } catch (e) { return { ok: false, error: `${e.stderr ?? e.message ?? ''}`.trim().split('\n').filter(Boolean).at(-1) ?? 'git failed' }; }
}

// Repo-relative prefix of a wiki (realpath'd: the registry may hold a symlink).
function wikiPrefix(root, wikiPath) {
  let real = wikiPath;
  try { real = realpathSync(wikiPath); } catch { /* keep as registered */ }
  return relative(root, real).split('\\').join('/');
}

function relInWiki(prefix, file) {
  if (prefix === '') return file;
  return file.startsWith(`${prefix}/`) ? file.slice(prefix.length + 1) : null;
}

// Local commits that write compiled state into a wiki this machine only
// captures for (anything outside its _inbox/). `sync --push` refuses to
// publish those without --off-host (ADR 0001).
function offSeatWrites(root, fromRef, wikisInRepo) {
  const changed = tryGit(root, ['diff', '--name-only', fromRef, 'HEAD']);
  if (!changed.ok || !changed.out) return [];
  const capturerWikis = wikisInRepo
    .map((w) => ({ w, seat: seatFor(w.path), prefix: wikiPrefix(root, w.path) }))
    .filter((x) => x.seat.role === 'capturer');
  const out = [];
  for (const file of changed.out.split('\n')) {
    for (const { w, seat, prefix } of capturerWikis) {
      const rel = relInWiki(prefix, file);
      if (rel !== null && !rel.startsWith('_inbox/')) out.push({ wiki: w.slug, librarian: seat.librarian, file });
    }
  }
  return out;
}

// Rebase HEAD's local commits onto `onto` in a throwaway detached worktree,
// so the user's working tree never holds a rebase in progress and an aborted
// rebase can never reset anyone's edits. Returns { ok, head } or
// { ok: false, conflicts, error }.
function rebaseAside(root, onto) {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-rebase-'));
  const added = tryGit(root, ['worktree', 'add', '--quiet', '--detach', dir, 'HEAD']);
  if (!added.ok) { rmSync(dir, { recursive: true, force: true }); return { ok: false, conflicts: [], error: added.error }; }
  try {
    const rebased = tryGit(dir, ['rebase', '--quiet', '--no-autostash', onto], { env: identityEnv(root) });
    if (rebased.ok) return { ok: true, head: git(dir, ['rev-parse', 'HEAD']) };
    const conflicts = tryGit(dir, ['diff', '--name-only', '--diff-filter=U']);
    tryGit(dir, ['rebase', '--abort']);
    return { ok: false, conflicts: conflicts.ok && conflicts.out ? conflicts.out.split('\n') : [], error: rebased.error };
  } finally {
    tryGit(root, ['worktree', 'remove', '--force', dir]);
    rmSync(dir, { recursive: true, force: true });
    tryGit(root, ['worktree', 'prune']);
  }
}

// Sync one repo root with its upstream. Fast-forward only unless `push`:
//   behind only            -> fast-forward               'updated'
//   ahead only             -> 'ahead' (report), or push  'pushed'
//   diverged               -> 'diverged' (report), or with push: rebase the
//                             local commits onto upstream and push 'rebased'.
//                             Safe by design (ADR 0001): with one librarian per
//                             wiki, the only incoming changes are new capture
//                             files. Refuses over staged or modified tracked
//                             files ('dirty' - never stashes); rebases in a
//                             throwaway worktree and moves the branch with
//                             `reset --keep`, which refuses rather than
//                             overwrites a concurrent edit; a conflicting
//                             rebase leaves the clone exactly as it was.
//   with push, local commits writing compiled state into a wiki this machine
//   only captures for                       -> 'off-seat' (unless offHost)
// Returns { status, before, after, ahead, behind, incoming_base?, incoming_tip?,
// conflicts?, off_seat?, error? }.
function syncRepo(root, { push = false, offHost = false, wikisInRepo = [] } = {}) {
  const before = git(root, ['rev-parse', 'HEAD']);
  const branch = headBranch(root);
  if (!branch) return { status: 'error', before, after: before, error: 'HEAD is detached (a rebase in progress?) - finish it first' };
  const up = upstreamOf(root);
  if (!up) return { status: 'no-upstream', before, after: before };
  const fetched = tryGit(root, ['fetch', '--quiet', up.remote, `+${up.mergeRef}:${up.trackingRef}`], { timeout: 120_000 });
  if (!fetched.ok) return { status: 'error', before, after: before, error: fetched.error };

  const [ahead, behind] = git(root, ['rev-list', '--left-right', '--count', `HEAD...${up.trackingRef}`]).split(/\s+/).map(Number);
  const base = { before, ahead, behind };
  const pushNow = () => tryGit(root, ['push', '--quiet', up.remote, `HEAD:${up.mergeRef}`], { timeout: 120_000 });

  if (ahead === 0 && behind === 0) return { status: 'up-to-date', ...base, after: before };
  if (ahead === 0) {
    const ff = tryGit(root, ['merge', '--ff-only', '--quiet', up.trackingRef]);
    if (!ff.ok) return { status: 'error', ...base, after: before, error: ff.error };
    return { status: 'updated', ...base, after: git(root, ['rev-parse', 'HEAD']) };
  }
  if (!push) return { status: behind === 0 ? 'ahead' : 'diverged', ...base, after: before };

  const incomingBase = git(root, ['merge-base', 'HEAD', up.trackingRef]);
  if (!offHost) {
    const offSeat = offSeatWrites(root, incomingBase, wikisInRepo);
    if (offSeat.length) {
      return { status: 'off-seat', ...base, after: before, off_seat: offSeat, error: `local commits change ${offSeat[0].wiki}, whose librarian is "${offSeat[0].librarian}" - publish from there, or re-run with --off-host` };
    }
  }
  if (behind === 0) {
    const pushed = pushNow();
    return pushed.ok ? { status: 'pushed', ...base, after: before } : { status: 'error', ...base, after: before, error: pushed.error };
  }

  if (git(root, ['status', '--porcelain', '--untracked-files=no']) !== '') {
    return { status: 'dirty', ...base, after: before, error: 'uncommitted tracked changes - commit (or finish) them, then sync --push again' };
  }
  const incomingTip = git(root, ['rev-parse', up.trackingRef]);
  const rebased = rebaseAside(root, incomingTip);
  if (!rebased.ok) return { status: 'conflict', ...base, after: before, conflicts: rebased.conflicts, error: rebased.error };
  if (git(root, ['rev-parse', 'HEAD']) !== before) {
    return { status: 'error', ...base, after: before, error: 'another session committed during sync - run sync --push again' };
  }
  const moved = tryGit(root, ['reset', '--quiet', '--keep', rebased.head]);
  if (!moved.ok) return { status: 'error', ...base, after: before, error: `rebased, but could not move the branch (a concurrent edit?): ${moved.error}` };
  const incoming = { incoming_base: incomingBase, incoming_tip: incomingTip };
  const pushed = pushNow();
  if (!pushed.ok) return { status: 'error', ...base, after: rebased.head, ...incoming, error: `rebased, but push failed: ${pushed.error}` };
  return { status: 'rebased', ...base, after: rebased.head, ...incoming };
}

// Attribute `git diff --name-status before..after` to the repo's wikis.
function attributeChanges(root, before, after, wikisInRepo) {
  const perWiki = new Map(wikisInRepo.map((w) => [w.slug, {
    slug: w.slug, arrivals: [], raw_added: [], wiki_changed: 0, lock_changed: false,
  }]));
  const out = git(root, ['diff', '--name-status', before, after]);
  if (!out) return [...perWiki.values()];
  const prefixes = wikisInRepo.map((w) => [w, wikiPrefix(root, w.path)]);
  for (const line of out.split('\n')) {
    const parts = line.split('\t');
    const status = parts[0][0];
    const file = parts.at(-1);  // rename lines are "Rnn\told\tnew" - take the new path
    for (const [w, prefix] of prefixes) {
      const rel = relInWiki(prefix, file);
      if (rel === null) continue;
      const bucket = perWiki.get(w.slug);
      if (rel.startsWith('_inbox/') && status === 'A') bucket.arrivals.push(rel);
      else if (rel.startsWith('raw/') && status === 'A') bucket.raw_added.push(rel);
      else if (rel.startsWith('wiki/')) {
        if (rel.endsWith('.tng-wiki.lock.json')) bucket.lock_changed = true;
        else bucket.wiki_changed += 1;
      }
      break;  // wikis in one repo do not nest; first prefix match wins
    }
  }
  return [...perWiki.values()];
}

export function syncWikis({ only = null, home, push = false, offHost = false } = {}) {
  const wikis = listWikis(loadRegistry(home)).filter((w) => (only ? w.slug === only : true));
  if (only && wikis.length === 0) throw new Error(`No wiki registered under slug "${only}". Run \`tng-wiki list\`.`);

  const repos = new Map();  // root -> { wikis: [] }
  const skipped = [];
  for (const w of wikis) {
    if (!existsSync(w.path)) { skipped.push({ slug: w.slug, reason: 'path missing' }); continue; }
    const root = gitRoot(w.path);
    if (!root) { skipped.push({ slug: w.slug, reason: 'not a git repo' }); continue; }
    if (!repos.has(root)) repos.set(root, { wikis: [] });
    repos.get(root).wikis.push(w);
  }

  // Captures queued while offline go first, so this sync's pull brings them home.
  const outbox = flushOutbox(home);

  const repoResults = [];
  const wikiResults = [];
  for (const [root, { wikis: inRepo }] of repos) {
    let result;
    try {
      result = syncRepo(root, { push, offHost, wikisInRepo: inRepo });
    } catch (e) {
      // one broken repo (unborn HEAD, unrelated histories) must not stop the sweep
      result = { status: 'error', error: `${e.stderr ?? e.message ?? ''}`.trim().split('\n').at(-1) };
    }
    repoResults.push({ root, wikis: inRepo.map((w) => w.slug), ...result });
    // incoming changes: the fast-forward range, or for a rebase the upstream
    // side (merge-base .. the tip the local commits were replayed onto)
    try {
      if (result.status === 'updated') wikiResults.push(...attributeChanges(root, result.before, result.after, inRepo));
      if (result.incoming_tip) wikiResults.push(...attributeChanges(root, result.incoming_base, result.incoming_tip, inRepo));
    } catch { /* attribution is a report, never a reason to fail the sync */ }
  }
  return { repos: repoResults, wikis: wikiResults, skipped, outbox };
}

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

export async function runSync(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--wiki') { i++; continue; }
    if (!args[i].startsWith('--')) throw new Error(`unknown argument "${args[i]}" - \`sync\` takes no positional arguments. Did you mean --wiki ${args[i]}?`);
  }
  const result = syncWikis({ only: argValue(args, '--wiki'), push: args.includes('--push'), offHost: args.includes('--off-host') });

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  // --quiet (session-start hooks): only what someone should act on or know.
  const quiet = args.includes('--quiet');
  const out = (line) => process.stdout.write(line + '\n');

  for (const r of result.repos) {
    const label = pc.bold(r.root);
    const n = (k) => `${k} commit${k === 1 ? '' : 's'}`;
    if (r.status === 'up-to-date') { if (!quiet) out(`${pc.green('✓')} ${label} ${pc.dim('up to date')}`); }
    else if (r.status === 'updated') out(`${pc.green('✓')} ${label} ${pc.dim(`${r.before.slice(0, 7)} → ${r.after.slice(0, 7)}`)}`);
    else if (r.status === 'pushed') out(`${pc.green('✓')} ${label} ${pc.dim(`pushed ${n(r.ahead)}`)}`);
    else if (r.status === 'rebased') out(`${pc.green('✓')} ${label} ${pc.dim(`rebased ${n(r.ahead)} onto ${n(r.behind)} from upstream, pushed`)}`);
    else if (r.status === 'ahead') out(`${pc.yellow('⚠')} ${label} ${pc.yellow(`${n(r.ahead)} not pushed`)} ${pc.dim('- the librarian publishes with tng-wiki sync --push')}`);
    else if (r.status === 'diverged') out(`${pc.yellow('⚠')} ${label} ${pc.yellow(`diverged (${r.ahead} local, ${r.behind} upstream)`)} ${pc.dim('- tng-wiki sync --push rebases the local commits and publishes')}`);
    else if (r.status === 'dirty') out(`${pc.yellow('⚠')} ${label} ${pc.yellow('not rebased:')} ${r.error}`);
    else if (r.status === 'off-seat') out(`${pc.yellow('⚠')} ${label} ${pc.yellow('not pushed:')} ${r.error}`);
    else if (r.status === 'conflict') out(`${pc.yellow('⚠')} ${label} ${pc.yellow(`rebase conflict in ${r.conflicts.join(', ') || 'unknown files'} - aborted, clone unchanged`)} ${pc.dim('(see .tng-wiki/doctrine/grounding.md, Merge Conflicts)')}`);
    else if (r.status === 'no-upstream') { if (!quiet) out(pc.dim(`○ ${r.root} no upstream - skipped`)); }
    else out(`${pc.yellow('⚠')} ${label} ${pc.yellow(r.error ?? 'sync failed')}`);
  }
  if (!quiet) for (const s of result.skipped) out(pc.dim(`○ ${s.slug}: ${s.reason} - skipped`));
  for (const p of result.outbox.published) out(`${pc.green('✓')} published queued capture ${pc.cyan(p.path)}`);
  for (const p of result.outbox.pending) out(`${pc.yellow('●')} capture still queued: ${p.relPath} ${pc.dim(`- ${p.reason}`)}`);

  const touched = result.wikis.filter((w) => w.arrivals.length || w.raw_added.length || w.wiki_changed || w.lock_changed);
  for (const w of touched) {
    out(`\n${pc.bold(w.slug)}`);
    for (const a of w.arrivals) out(`  ${pc.cyan('●')} inbox arrival: ${a} ${pc.dim('- triage: file into wiki/ · deliverables/ · raw/ (tng-wiki graduate)')}`);
    if (w.raw_added.length) out(`  ${w.raw_added.length} new raw source(s) ${pc.dim('- tng-wiki sources --uncompiled')}`);
    if (w.wiki_changed) out(`  ${w.wiki_changed} wiki page(s) changed`);
    if (w.lock_changed) out(`  ${pc.dim('lockfile changed - run tng-wiki ground to see per-citation state')}`);
  }
  if (!quiet && result.repos.some((r) => r.status === 'updated' || r.status === 'rebased') && touched.length === 0) {
    out(pc.dim('\npulled changes touch no registered wiki content'));
  }
}
