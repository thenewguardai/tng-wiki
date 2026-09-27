// `tng-wiki sync` (#38, ADR 0001) - sync the git repos behind registered
// wikis and report what arrived, per wiki: `_inbox/` arrivals prominently (the
// triage queue), plus counts for new raw/ sources, wiki/ page changes, and
// lockfile movement. Plain sync only fast-forwards and reports local commits
// that were never published; `--push` is the librarian's publish step (push,
// rebasing over incoming captures when diverged). Captures queued offline are
// flushed first. Monorepos are handled naturally: wikis are grouped by git
// root, each root is synced once, and the diff is attributed to wikis by path.
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, relative } from 'path';
import pc from 'picocolors';
import { loadRegistry, listWikis } from './registry.js';
import { flushOutbox, upstreamOf, identityEnv } from './publish.js';

function git(repoDir, gitArgs, { timeout = 60_000, env = process.env } = {}) {
  return execFileSync('git', ['-C', repoDir, ...gitArgs], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, env,
  }).trim();
}

function gitRoot(dir) {
  try { return git(dir, ['rev-parse', '--show-toplevel']); } catch { return null; }
}

function tryGit(root, args, opts) {
  try { return { ok: true, out: git(root, args, opts) }; } catch (e) { return { ok: false, error: `${e.stderr ?? e.message ?? ''}`.trim().split('\n').filter(Boolean).at(-1) ?? 'git failed' }; }
}

// Sync one repo root with its upstream. Fast-forward only unless `push`:
//   behind only            -> fast-forward               'updated'
//   ahead only             -> 'ahead' (report), or push  'pushed'
//   diverged               -> 'diverged' (report), or with push: rebase the
//                             local commits onto upstream and push 'rebased'.
//                             Safe by design (ADR 0001): with one librarian per
//                             wiki, the only incoming changes are new capture
//                             files. Refuses over uncommitted tracked edits
//                             ('dirty' - never stashes); a conflicting rebase is
//                             aborted and reported ('conflict').
// Returns { status, before, after, ahead, behind, incoming_base?, conflicts?, error? }.
function syncRepo(root, { push = false } = {}) {
  const before = git(root, ['rev-parse', 'HEAD']);
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
  if (behind === 0) {
    if (!push) return { status: 'ahead', ...base, after: before };
    const pushed = pushNow();
    return pushed.ok ? { status: 'pushed', ...base, after: before } : { status: 'error', ...base, after: before, error: pushed.error };
  }
  if (!push) return { status: 'diverged', ...base, after: before };

  if (git(root, ['status', '--porcelain', '--untracked-files=no']) !== '') {
    return { status: 'dirty', ...base, after: before, error: 'uncommitted tracked changes - commit (or finish) them, then sync --push again' };
  }
  const incomingBase = git(root, ['merge-base', 'HEAD', up.trackingRef]);
  const incomingTip = git(root, ['rev-parse', up.trackingRef]);
  const rebased = tryGit(root, ['rebase', '--quiet', up.trackingRef], { env: identityEnv(root) });
  if (!rebased.ok) {
    const conflicts = tryGit(root, ['diff', '--name-only', '--diff-filter=U']);
    tryGit(root, ['rebase', '--abort']);
    return {
      status: 'conflict', ...base, after: git(root, ['rev-parse', 'HEAD']),
      conflicts: conflicts.ok && conflicts.out ? conflicts.out.split('\n') : [], error: rebased.error,
    };
  }
  const after = git(root, ['rev-parse', 'HEAD']);
  const pushed = pushNow();
  const incoming = { incoming_base: incomingBase, incoming_tip: incomingTip };
  if (!pushed.ok) return { status: 'error', ...base, after, ...incoming, error: `rebased, but push failed: ${pushed.error}` };
  return { status: 'rebased', ...base, after, ...incoming };
}

// Attribute `git diff --name-status before..after` to the repo's wikis.
function attributeChanges(root, before, after, wikisInRepo) {
  const perWiki = new Map(wikisInRepo.map((w) => [w.slug, {
    slug: w.slug, arrivals: [], raw_added: [], wiki_changed: 0, lock_changed: false,
  }]));
  const out = git(root, ['diff', '--name-status', before, after]);
  if (!out) return [...perWiki.values()];
  for (const line of out.split('\n')) {
    const parts = line.split('\t');
    const status = parts[0][0];
    const file = parts.at(-1);  // rename lines are "Rnn\told\tnew" - take the new path
    for (const w of wikisInRepo) {
      const prefix = relative(root, resolve(w.path));
      const rel = prefix === '' ? file : file.startsWith(`${prefix}/`) ? file.slice(prefix.length + 1) : null;
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

export function syncWikis({ only = null, home, push = false } = {}) {
  const wikis = listWikis(loadRegistry(home)).filter((w) => (only ? w.slug === only : true));
  if (only && wikis.length === 0) throw new Error(`No wiki registered under slug "${only}". Run \`tng-wiki list\`.`);

  const repos = new Map();  // root -> { wikis: [], skipped? }
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
    const result = syncRepo(root, { push });
    repoResults.push({ root, wikis: inRepo.map((w) => w.slug), ...result });
    // incoming changes: the fast-forward range, or for a rebase the upstream
    // side (merge-base .. the tip the local commits were replayed onto)
    if (result.status === 'updated') wikiResults.push(...attributeChanges(root, result.before, result.after, inRepo));
    if (result.incoming_tip) wikiResults.push(...attributeChanges(root, result.incoming_base, result.incoming_tip, inRepo));
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
  const result = syncWikis({ only: argValue(args, '--wiki'), push: args.includes('--push') });

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
