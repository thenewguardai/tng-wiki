// The librarian home host (ADR 0001, docs/design/cross-machine-flow.md). A
// wiki's committed manifest may name ONE host (`librarian`) that writes its
// compiled state: pages it files, the lockfile, the log, graduations, schema
// upgrades. Every other host is a capturer - it reads, and it captures with
// `tng-wiki capture`. With one writer of compiled state, multi-machine merges
// only ever see new, uniquely named capture files.
//
// Unset means unassigned: no role, nothing refused (the pre-0.15 behavior).
// `--off-host` is the explicit escape for maintaining a wiki away from home.
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import pc from 'picocolors';
import { localHost, sameHost } from './host.js';
import { resolveWiki } from './verbs.js';

function manifestPath(wikiPath) {
  return join(wikiPath, '.tng-wiki.json');
}

export function readLibrarian(wikiPath) {
  const p = manifestPath(wikiPath);
  if (!existsSync(p)) return null;
  try {
    const value = JSON.parse(readFileSync(p, 'utf8')).librarian;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

// Stamp (or with null, remove) the librarian host in the committed manifest.
export function setLibrarian(wikiPath, host) {
  const p = manifestPath(wikiPath);
  if (!existsSync(p)) throw new Error(`No .tng-wiki.json manifest in ${wikiPath} - cannot set a librarian.`);
  const meta = JSON.parse(readFileSync(p, 'utf8'));
  if (host) meta.librarian = host;
  else delete meta.librarian;
  writeFileSync(p, JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

// { librarian, role } where role is 'librarian' | 'capturer' | null (unset).
export function seatFor(wikiPath, host = localHost()) {
  const librarian = readLibrarian(wikiPath);
  if (!librarian) return { librarian: null, role: null };
  return { librarian, role: sameHost(librarian, host) ? 'librarian' : 'capturer' };
}

// Refuse a compiled-state write on a capturer seat unless `--off-host`.
export function assertLibrarianSeat(wikiPath, args, verb, host = localHost(), slug = null) {
  const { librarian, role } = seatFor(wikiPath, host);
  if (role !== 'capturer' || args.includes('--off-host')) return;
  const target = slug ? ` --wiki ${slug}` : '';
  throw new Error(
    `refusing \`${verb}\` here: this wiki's librarian host is "${librarian}" and this machine is "${host}" (a capturer). ` +
    `Capture instead - \`tng-wiki capture${target} --file <note.md>\` lands it in _inbox/ for the librarian. ` +
    `If "${librarian}" is unavailable and you mean to maintain the wiki from here, re-run with --off-host.`,
  );
}

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

export async function runLibrarian(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--wiki' || args[i] === '--set') { i++; continue; }
    if (!args[i].startsWith('--')) throw new Error(`unknown argument "${args[i]}" - \`librarian\` takes no positional arguments. Did you mean --wiki ${args[i]}?`);
  }
  const wiki = resolveWiki(argValue(args, '--wiki'));
  const setTo = args.includes('--set-here') ? localHost() : argValue(args, '--set');
  const clear = args.includes('--clear');
  if ((setTo || clear) && wiki.via === 'default') {
    throw new Error(`refusing to change the default wiki's librarian implicitly: you are not inside a wiki. Pass --wiki ${wiki.slug}.`);
  }
  if (args.includes('--set') && !setTo) throw new Error('--set needs a hostname (or use --set-here).');
  if (setTo) setLibrarian(wiki.path, setTo);
  if (clear) setLibrarian(wiki.path, null);

  const host = localHost();
  const { librarian, role } = seatFor(wiki.path, host);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ wiki: wiki.slug, librarian, host, role }, null, 2) + '\n');
    return;
  }
  const name = pc.bold(wiki.slug ?? wiki.name);
  if (!librarian) {
    process.stdout.write(`${name}: no librarian host set ${pc.dim('- any machine may maintain it. Set one with: tng-wiki librarian --wiki <slug> --set <host>')}\n`);
  } else if (role === 'librarian') {
    process.stdout.write(`${name}: ${pc.green('librarian seat')} ${pc.dim(`- this machine (${host}) files, grounds and publishes this wiki`)}\n`);
  } else {
    process.stdout.write(`${name}: ${pc.cyan('capturer seat')} ${pc.dim(`- librarian is "${librarian}"; from ${host}, add knowledge with tng-wiki capture`)}\n`);
  }
  if (setTo || clear) process.stdout.write(pc.dim('  .tng-wiki.json changed - commit it so every clone agrees\n'));
}
