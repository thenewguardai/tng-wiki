// Machine-local advisory wiki lease (#39). Coordinates concurrent agent
// sessions on ONE machine sharing one checkout - the observed collision class:
// session A running `ground --update-lock` while session B is mid-ingest
// blesses content nobody verified. Cross-machine safety is a different problem
// with a different answer (the merge story in doctrine/grounding.md), so the
// lease deliberately lives OUTSIDE the repo, in ~/.tng-wiki/leases.json:
// nothing to commit, nothing to push, nothing to go stale in the wiki itself.
//
// Advisory means advisory: mutating verbs print an informational line when a
// lease is held; they never refuse. Expiry (TTL) is the only staleness
// mechanism - a dead session's lease simply ages out.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir, hostname, userInfo } from 'os';
import { join, resolve, dirname } from 'path';
import pc from 'picocolors';
import { resolveWiki } from './verbs.js';

export const DEFAULT_TTL_MINUTES = 120;

export function leasesPath(home = homedir()) {
  return join(home, '.tng-wiki', 'leases.json');
}

function loadLeases(home) {
  const p = leasesPath(home);
  if (!existsSync(p)) return { version: 1, leases: {} };
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    if (typeof data !== 'object' || data === null || typeof data.leases !== 'object' || data.leases === null) {
      return { version: 1, leases: {} };
    }
    return { version: 1, leases: data.leases };
  } catch {
    return { version: 1, leases: {} };
  }
}

function saveLeases(registry, home) {
  const p = leasesPath(home);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(registry, null, 2) + '\n');
}

function defaultHolder() {
  let user = 'unknown';
  try { user = userInfo().username; } catch { /* keep fallback */ }
  return `${user}@${hostname()}`;
}

function isExpired(lease, now) {
  return !lease.expires_at || new Date(lease.expires_at).getTime() <= now.getTime();
}

// Drop every expired lease (lazy cleanup - runs on any read or write).
function prune(registry, now) {
  for (const [key, lease] of Object.entries(registry.leases)) {
    if (isExpired(lease, now)) delete registry.leases[key];
  }
  return registry;
}

// The unexpired lease on `wikiPath`, or null.
export function activeLease(wikiPath, home = homedir(), now = new Date()) {
  const lease = loadLeases(home).leases[resolve(wikiPath)];
  return lease && !isExpired(lease, now) ? lease : null;
}

// Claim (or renew) the lease. Same holder renews; a different holder's
// unexpired lease blocks unless `force`. Returns the written lease.
export function claimLease(wikiPath, { holder = defaultHolder(), ttlMinutes = DEFAULT_TTL_MINUTES, note, force = false } = {}, home = homedir(), now = new Date()) {
  const key = resolve(wikiPath);
  const registry = prune(loadLeases(home), now);
  const existing = registry.leases[key];
  if (existing && existing.holder !== holder && !force) {
    const err = new Error(
      `wiki is claimed by "${existing.holder}" until ${existing.expires_at} - ` +
      `coordinate with that session, wait for expiry, or re-run with --force to take it over.`,
    );
    err.lease = existing;
    throw err;
  }
  const lease = {
    holder,
    acquired_at: existing?.holder === holder ? existing.acquired_at : now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
    ...(note ? { note } : {}),
  };
  registry.leases[key] = lease;
  saveLeases(registry, home);
  return lease;
}

// Release the lease. Returns the released lease, or null when none was held.
// Anyone may release - the lease is advisory, and requiring holder identity
// would just leave dead sessions' leases to age out instead of being cleared.
export function releaseLease(wikiPath, home = homedir(), now = new Date()) {
  const key = resolve(wikiPath);
  const registry = prune(loadLeases(home), now);
  const lease = registry.leases[key] ?? null;
  delete registry.leases[key];
  saveLeases(registry, home);
  return lease;
}

// One informational stderr line for mutating verbs. Never changes exit codes:
// the claiming session recognizes its own holder label; anyone else is being
// told to coordinate before writing.
export function warnIfLeased(wikiPath, home = homedir()) {
  const lease = activeLease(wikiPath, home);
  if (!lease) return;
  const until = lease.expires_at.slice(11, 16);
  process.stderr.write(
    `${pc.cyan('ℹ')} lease: "${lease.holder}" holds this wiki until ${until} UTC${lease.note ? ` (${lease.note})` : ''} - if that is not this session, coordinate before writing\n`,
  );
}

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

const VALUE_FLAGS = new Set(['--wiki', '--ttl', '--as', '--note']);

function rejectPositionals(verb, args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('--')) continue;
    throw new Error(`unknown argument "${a}" - \`${verb}\` takes no positional arguments. Did you mean --wiki ${a}?`);
  }
}

// Coordination writes name their target like every other write (#47).
function targetWiki(args, verb) {
  const wiki = resolveWiki(argValue(args, '--wiki'));
  if (wiki.via === 'default') {
    throw new Error(
      `refusing to ${verb} the default wiki implicitly: you are not inside a wiki. ` +
      `Pass --wiki ${wiki.slug} to target it, or run from inside the wiki.`,
    );
  }
  return wiki;
}

export async function runClaim(args) {
  rejectPositionals('claim', args);
  const wiki = targetWiki(args, 'claim');
  const ttlRaw = argValue(args, '--ttl');
  const ttlMinutes = ttlRaw === null ? DEFAULT_TTL_MINUTES : Number(ttlRaw);
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) throw new Error(`--ttl must be a positive number of minutes (got "${ttlRaw}").`);
  const lease = claimLease(wiki.path, {
    ...(argValue(args, '--as') ? { holder: argValue(args, '--as') } : {}),
    ttlMinutes,
    ...(argValue(args, '--note') ? { note: argValue(args, '--note') } : {}),
    force: args.includes('--force'),
  });
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ wiki: wiki.slug, path: wiki.path, ...lease }, null, 2) + '\n');
    return;
  }
  process.stdout.write(`${pc.green('✓')} claimed ${pc.bold(wiki.slug ?? wiki.name)} as "${lease.holder}" until ${lease.expires_at.slice(11, 16)} UTC ${pc.dim(`- release with: tng-wiki release${wiki.slug ? ` --wiki ${wiki.slug}` : ''}`)}\n`);
}

export async function runRelease(args) {
  rejectPositionals('release', args);
  const wiki = targetWiki(args, 'release');
  const lease = releaseLease(wiki.path);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ wiki: wiki.slug, path: wiki.path, released: lease }, null, 2) + '\n');
    return;
  }
  process.stdout.write(lease
    ? `${pc.green('✓')} released ${pc.bold(wiki.slug ?? wiki.name)} ${pc.dim(`(was held by "${lease.holder}")`)}\n`
    : `${pc.dim('no lease was held on')} ${pc.bold(wiki.slug ?? wiki.name)}\n`);
}
