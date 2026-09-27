// `tng-wiki join <git-url>` - one command from a fresh machine to a working
// participant in a shared wiki repo (ADR 0001). Onboarding a machine used to be
// a hand-run clone / register x N / localize / install-skill sequence that
// sessions rediscovered each time. join clones (or adopts an existing clone of
// the same remote), registers the wikis meant for this host (sharing stamps
// decide, exactly as `register --yes`), installs the Claude Code skill, names
// the code authorities that still need `localize`, and runs the
// non-interactive PATH check. It never trusts or remaps an authority on its
// own - that is the human's call, so it prints the command instead.
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { basename, join, resolve } from 'path';
import pc from 'picocolors';
import { isMonorepo, registerChildren, registerOne } from './registry-cli.js';
import { authorityStatuses } from './localize.js';
import { installSkill } from './skill.js';
import { nonInteractiveCheck } from './cli-path.js';
import { seatFor } from './librarian.js';

function normalizeRemote(url) {
  return String(url).trim().replace(/\/+$/, '').replace(/\.git$/, '');
}

function defaultPath(url) {
  const name = basename(normalizeRemote(url).replace(/^.*:/, ''));
  return join(homedir(), name || 'wiki');
}

// Clone into `dir`, or adopt it when it is already a clone of `url`.
function cloneOrAdopt(url, dir) {
  if (!existsSync(dir)) {
    execFileSync('git', ['clone', '--quiet', url, dir], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 });
    return true;
  }
  let current;
  try {
    current = execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error(`${dir} exists and is not a git clone with an origin - pass --path <empty-or-matching-dir>.`);
  }
  if (normalizeRemote(current) !== normalizeRemote(url)) {
    throw new Error(`${dir} is already a clone of ${current}, not ${url} - pass --path to clone somewhere else.`);
  }
  return false;
}

export async function joinRepo(url, { path } = {}) {
  const dir = resolve(path ?? defaultPath(url));
  const cloned = cloneOrAdopt(url, dir);

  const registered = [];
  const skipped = [];
  if (isMonorepo(dir)) {
    for (const r of await registerChildren(dir, { yes: true })) {
      if (r.skipped) skipped.push({ name: basename(r.child), reason: r.reason });
      else registered.push({ slug: r.slug, path: r.child });
    }
  } else if (existsSync(join(dir, '.tng-wiki.json'))) {
    const { slug } = registerOne(dir, {});
    registered.push({ slug, path: dir });
  } else {
    throw new Error(`${dir} holds no wiki (no .tng-wiki.json at the root or one level down).`);
  }

  const localize = [];
  for (const w of registered) {
    const missing = authorityStatuses(w.path).filter((a) => a.state === 'missing').map((a) => a.name);
    if (missing.length) {
      localize.push({ wiki: w.slug, missing, command: `tng-wiki localize --wiki ${w.slug} ${missing.map((m) => `--trust ${m}`).join(' ')} --yes` });
    }
  }

  let skill;
  try { skill = { ok: true, ...installSkill() }; } catch (e) { skill = { ok: false, error: e.message }; }

  return {
    path: dir, cloned, registered, skipped, localize, skill,
    seats: registered.map((w) => ({ wiki: w.slug, ...seatFor(w.path) })),
    cli_path: nonInteractiveCheck(),
  };
}

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

export async function runJoin(args) {
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--path') { i++; continue; }
    if (!args[i].startsWith('--')) positionals.push(args[i]);
  }
  if (positionals.length !== 1) {
    throw new Error('Usage: tng-wiki join <git-url> [--path <dir>] [--json]');
  }
  const result = await joinRepo(positionals[0], { path: argValue(args, '--path') });

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  const out = (line) => process.stdout.write(line + '\n');
  out(`${pc.green('✓')} ${result.cloned ? 'cloned' : 'using existing clone'} ${pc.bold(result.path)}`);
  for (const r of result.registered) out(`${pc.green('✓')} registered ${pc.bold(r.slug)}`);
  for (const s of result.skipped) out(pc.dim(`○ skipped ${s.name} - ${s.reason}`));
  for (const s of result.seats) {
    if (s.role === 'capturer') out(pc.dim(`  ${s.wiki}: capturer seat (librarian: ${s.librarian}) - add knowledge with tng-wiki capture`));
    else if (s.role === 'librarian') out(pc.dim(`  ${s.wiki}: librarian seat - this machine files it`));
  }
  if (result.localize.length) {
    out(`\n${pc.yellow('⚠')} code authorities not present on this machine - trust the recorded verification, or remap with --set <name>=<path>:`);
    for (const l of result.localize) out(`  ${pc.cyan(l.command)}`);
  }
  out(result.skill.ok ? `${pc.green('✓')} Claude Code skill ${result.skill.overwrote ? 'refreshed' : 'installed'} ${pc.dim(result.skill.path)}` : `${pc.yellow('⚠')} skill not installed: ${result.skill.error}`);
  if (result.cli_path && !result.cli_path.ok) {
    out(`${pc.yellow('⚠')} tng-wiki is ${result.cli_path.detail}. Fix:`);
    for (const line of result.cli_path.fix) out(`  ${pc.cyan(line)}`);
  }
  out(pc.dim('\nNext: tng-wiki inbox to see pending captures; tng-wiki capture --wiki <slug> to add one.'));
}
