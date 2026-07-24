// `tng-wiki sync` (#38) - pull the git repos behind registered wikis
// (fast-forward ONLY - sync never creates a merge commit; diverged repos are
// reported with a pointer at the doctrine merge story) and report what
// arrived, per wiki: `_inbox/` arrivals prominently (the triage queue), plus
// counts for new raw/ sources, wiki/ page changes, and lockfile movement.
// Monorepos are handled naturally: wikis are grouped by git root, each root is
// pulled once, and the diff is attributed to wikis by path prefix.
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, relative } from 'path';
import pc from 'picocolors';
import { loadRegistry, listWikis } from './registry.js';

function git(repoDir, gitArgs, { timeout = 60_000 } = {}) {
  return execFileSync('git', ['-C', repoDir, ...gitArgs], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout,
  }).trim();
}

function gitRoot(dir) {
  try { return git(dir, ['rev-parse', '--show-toplevel']); } catch { return null; }
}

// Classify a failed `git pull --ff-only` from its stderr.
function classifyPullError(e) {
  const text = `${e.stderr ?? ''}${e.message ?? ''}`;
  if (/fast-forward/i.test(text) || /divergent branches/i.test(text)) return 'diverged';
  if (/no tracking information|no remote repository specified|does not appear to be a git repository/i.test(text)) return 'no-upstream';
  return 'error';
}

// Pull one repo root. Returns { status, before, after, error? } where status is
// 'updated' | 'up-to-date' | 'diverged' | 'no-upstream' | 'error'.
function pullRepo(root) {
  const before = git(root, ['rev-parse', 'HEAD']);
  try {
    git(root, ['pull', '--ff-only'], { timeout: 120_000 });
  } catch (e) {
    return { status: classifyPullError(e), before, after: before, error: (e.stderr ?? e.message ?? '').trim().split('\n').at(-1) };
  }
  const after = git(root, ['rev-parse', 'HEAD']);
  return { status: after === before ? 'up-to-date' : 'updated', before, after };
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

export function syncWikis({ only = null, home } = {}) {
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

  const repoResults = [];
  const wikiResults = [];
  for (const [root, { wikis: inRepo }] of repos) {
    const pull = pullRepo(root);
    repoResults.push({ root, wikis: inRepo.map((w) => w.slug), ...pull });
    if (pull.status === 'updated') wikiResults.push(...attributeChanges(root, pull.before, pull.after, inRepo));
  }
  return { repos: repoResults, wikis: wikiResults, skipped };
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
  const result = syncWikis({ only: argValue(args, '--wiki') });

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  for (const r of result.repos) {
    const label = pc.bold(r.root);
    if (r.status === 'up-to-date') process.stdout.write(`${pc.green('✓')} ${label} ${pc.dim('up to date')}\n`);
    else if (r.status === 'updated') process.stdout.write(`${pc.green('✓')} ${label} ${pc.dim(`${r.before.slice(0, 7)} → ${r.after.slice(0, 7)}`)}\n`);
    else if (r.status === 'diverged') process.stdout.write(`${pc.yellow('⚠')} ${label} ${pc.yellow('diverged - merge manually')} ${pc.dim('(see .tng-wiki/doctrine/grounding.md, Merge Conflicts)')}\n`);
    else if (r.status === 'no-upstream') process.stdout.write(`${pc.dim(`○ ${r.root} no upstream - skipped`)}\n`);
    else process.stdout.write(`${pc.yellow('⚠')} ${label} ${pc.yellow(r.error ?? 'pull failed')}\n`);
  }
  for (const s of result.skipped) process.stdout.write(pc.dim(`○ ${s.slug}: ${s.reason} - skipped\n`));

  const touched = result.wikis.filter((w) => w.arrivals.length || w.raw_added.length || w.wiki_changed || w.lock_changed);
  for (const w of touched) {
    process.stdout.write(`\n${pc.bold(w.slug)}\n`);
    for (const a of w.arrivals) process.stdout.write(`  ${pc.cyan('●')} inbox arrival: ${a} ${pc.dim('- triage: file into wiki/ · deliverables/ · raw/ (tng-wiki graduate)')}\n`);
    if (w.raw_added.length) process.stdout.write(`  ${w.raw_added.length} new raw source(s) ${pc.dim('- tng-wiki sources --uncompiled')}\n`);
    if (w.wiki_changed) process.stdout.write(`  ${w.wiki_changed} wiki page(s) changed\n`);
    if (w.lock_changed) process.stdout.write(`  ${pc.dim('lockfile changed - run tng-wiki ground to see per-citation state')}\n`);
  }
  if (result.repos.some((r) => r.status === 'updated') && touched.length === 0) {
    process.stdout.write(pc.dim('\npulled changes touch no registered wiki content\n'));
  }
}
