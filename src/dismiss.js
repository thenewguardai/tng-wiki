// `tng-wiki dismiss raw/<path> --reason "..."` - record the one source state
// citations cannot derive (#54): reviewed, and nothing was worth compiling.
// A dismissed source leaves the ingest queue without pretending it was
// compiled. The record lives in `.tng-wiki/dismissals.json`, never in the
// source file itself - raw/ is immutable, no exceptions. Writes are rare
// (dismissal only, not per ingest), so the sidecar is not a merge hotspot.
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import pc from 'picocolors';
import { resolveWiki, rawCiters, readDismissals, DISMISSALS_RELPATH } from './verbs.js';
import { insideRoot } from './paths.js';
import { warnIfLeased } from './lease.js';

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--wiki' || a === '--reason' || a === '--by') { i++; continue; }
    if (a.startsWith('--')) continue;
    out.push(a);
  }
  return out;
}

function writeDismissals(wikiPath, dismissed) {
  const p = join(wikiPath, DISMISSALS_RELPATH);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ version: 1, dismissed }, null, 2) + '\n', 'utf8');
}

export async function runDismiss(args) {
  const pos = positionals(args);
  if (pos.length !== 1) {
    if (pos.length > 1) throw new Error(`unknown argument "${pos[1]}" - \`dismiss\` takes one positional argument (the raw/ source).`);
    process.stderr.write('Usage: tng-wiki dismiss raw/<path> --reason "<why>" [--by <who>] [--undo] [--wiki <slug>] [--json]\n');
    process.exit(1);
  }

  const wiki = resolveWiki(argValue(args, '--wiki'));
  // Same rule as graduate / ground's mutating flags (#47): a write names its target.
  if (wiki.via === 'default') {
    throw new Error(
      `refusing to dismiss via the default-wiki fallback: you are not inside a wiki, ` +
      `so this would record a verdict in "${wiki.slug}" implicitly. Pass --wiki ${wiki.slug} to target it, or run from inside the wiki.`,
    );
  }

  warnIfLeased(wiki.path);

  const rel = pos[0].replace(/^\.\//, '');
  if (rel !== 'raw' && !rel.startsWith('raw/')) {
    throw new Error(`dismiss takes a raw/ source path (got "${pos[0]}") - only ingest-queue sources have a compiled-or-not state.`);
  }
  const abs = join(wiki.path, rel);
  if (!insideRoot(resolve(join(wiki.path, 'raw')), resolve(abs))) throw new Error(`Path "${pos[0]}" escapes raw/.`);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`No such source: ${rel}.`);

  const dismissed = readDismissals(wiki.path);
  const undo = args.includes('--undo');

  if (undo) {
    if (!dismissed[rel]) throw new Error(`${rel} is not dismissed - nothing to undo.`);
    const prior = dismissed[rel];
    delete dismissed[rel];
    writeDismissals(wiki.path, dismissed);
    if (args.includes('--json')) {
      process.stdout.write(JSON.stringify({ wiki: wiki.slug, path: rel, undone: prior }, null, 2) + '\n');
      return;
    }
    process.stdout.write(`${pc.green('✓')} un-dismissed ${rel} ${pc.dim(`(was: ${prior.reason})`)} — back in the ingest queue\n`);
    return;
  }

  const reason = argValue(args, '--reason');
  if (!reason || !reason.trim()) {
    throw new Error('dismiss requires --reason "<why nothing was worth compiling>" - a dismissal without a why is the old flag wearing a new hat.');
  }

  // A cited source IS compiled - the citation outranks any verdict. Refuse
  // rather than record a dismissal that status derivation would ignore anyway.
  const citers = rawCiters(wiki.path).get(rel);
  if (citers?.size) {
    const pages = [...citers].sort().join(', ');
    throw new Error(`${rel} is cited by ${citers.size} page${citers.size === 1 ? '' : 's'} (${pages}) - it is compiled, not dismissible. Remove the citations first if the wiki truly no longer rests on it.`);
  }

  if (dismissed[rel]) {
    throw new Error(`${rel} is already dismissed (${dismissed[rel].date}: ${dismissed[rel].reason}). Pass --undo first to change the verdict.`);
  }

  const entry = { reason: reason.trim(), date: new Date().toISOString().slice(0, 10) };
  const by = argValue(args, '--by');
  if (by) entry.by = by;
  dismissed[rel] = entry;
  writeDismissals(wiki.path, dismissed);

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ wiki: wiki.slug, path: rel, dismissed: entry }, null, 2) + '\n');
    return;
  }
  process.stdout.write(`${pc.green('✓')} dismissed ${rel} ${pc.dim(`— ${entry.reason}`)}\n`);
  process.stdout.write(pc.dim(`  out of the ingest queue; recorded in ${DISMISSALS_RELPATH}. Undo: tng-wiki dismiss ${rel} --undo\n`));
}
