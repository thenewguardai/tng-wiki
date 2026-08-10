// `tng-wiki log` - canonical emitter of the wiki/log.md entry format (#40).
// The generated schema specifies the shape (## [YYYY-MM-DDTHH:MM] type | desc
// plus Source / Pages created / Pages updated / Notes); this helper appends a
// correctly-formatted entry so librarian sessions stop hand-assembling it.
// Valid types are wiki-declarable, so they are read from the wiki's own files
// (`Types: ...` line) rather than hardcoded here: AGENTS.md / CLAUDE.md first
// (a hand-authored line below the schema fence overrides), then the generated
// .tng-wiki/doctrine/operations.md default (#52 moved it there). A wiki
// declaring no line anywhere accepts any type.
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import pc from 'picocolors';
import { resolveWiki } from './verbs.js';
import { warnIfLeased } from './lease.js';

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

// All values of a repeatable flag, in order.
function argValues(args, flag) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== flag) continue;
    const next = args[i + 1];
    if (next && !next.startsWith('--')) out.push(next);
  }
  return out;
}

const VALUE_FLAGS = new Set(['--wiki', '--type', '--desc', '--source', '--created', '--updated', '--notes', '--author']);

function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('--')) continue;
    out.push(a);
  }
  return out;
}

// The wiki schema's log-type vocabulary, or null when the schema doesn't
// declare one (custom schema, stripped section) - null means accept anything.
export function schemaLogTypes(wikiPath) {
  const candidates = ['AGENTS.md', 'CLAUDE.md', join('.tng-wiki', 'doctrine', 'operations.md')];
  for (const name of candidates) {
    const p = join(wikiPath, name);
    if (!existsSync(p)) continue;
    let text;
    try { text = readFileSync(p, 'utf8'); } catch { continue; }
    const m = text.match(/^Types:\s*(.+)$/m);
    if (!m) continue; // no declaration in this file - try the next one
    const types = [...m[1].matchAll(/`([^`]+)`/g)].map((t) => t[1]);
    return types.length > 0 ? types : null;
  }
  return null;
}

// Local wall-clock YYYY-MM-DDTHH:MM - log entries are a human ritual record,
// not a machine timestamp, so local time matches what the librarian sees.
function localStamp(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}`;
}

export async function runLog(args) {
  const extra = positionals(args);
  if (extra.length > 0) throw new Error(`unknown argument "${extra[0]}" - \`log\` takes no positional arguments.`);

  const type = argValue(args, '--type');
  const desc = argValue(args, '--desc');
  if (!type || !desc) {
    process.stderr.write('Usage: tng-wiki log --type <t> --desc "..." [--source <path>]... [--created <page>]... [--updated <page>]... [--author "..."] [--notes "..."] [--wiki <slug>] [--json]\n');
    process.exit(1);
  }

  const wiki = resolveWiki(argValue(args, '--wiki'));
  // Same rule as every mutating verb (#47): a write must name its target.
  if (wiki.via === 'default') {
    throw new Error(
      `refusing to append to the default wiki's log implicitly: you are not inside a wiki. ` +
      `Pass --wiki ${wiki.slug} to target it, or run from inside the wiki.`,
    );
  }

  warnIfLeased(wiki.path);

  const validTypes = schemaLogTypes(wiki.path);
  if (validTypes && !validTypes.includes(type)) {
    throw new Error(`"${type}" is not a log type this wiki's schema declares. Types: ${validTypes.join(', ')}`);
  }

  const logPath = join(wiki.path, 'wiki', 'log.md');
  if (!existsSync(logPath)) throw new Error(`Missing wiki/log.md in ${wiki.path}`);

  const stamp = localStamp();
  const fields = [];
  const sources = argValues(args, '--source');
  const created = argValues(args, '--created');
  const updated = argValues(args, '--updated');
  const author = argValue(args, '--author');
  const notes = argValue(args, '--notes');
  if (sources.length) fields.push(`- Source: ${sources.join(', ')}`);
  if (created.length) fields.push(`- Pages created: ${created.join(', ')}`);
  if (updated.length) fields.push(`- Pages updated: ${updated.join(', ')}`);
  if (author) fields.push(`- Author: ${author}`);
  if (notes) fields.push(`- Notes: ${notes}`);

  const existing = readFileSync(logPath, 'utf8');
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  const entry = `## [${stamp}] ${type} | ${desc}\n${fields.map((f) => `${f}\n`).join('')}`;
  appendFileSync(logPath, `${sep}${entry}`);

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({
      wiki: wiki.slug, timestamp: stamp, type, description: desc,
      ...(sources.length ? { sources } : {}), ...(created.length ? { created } : {}),
      ...(updated.length ? { updated } : {}), ...(author ? { author } : {}), ...(notes ? { notes } : {}),
    }, null, 2) + '\n');
    return;
  }
  process.stdout.write(`${pc.green('✓')} logged ${pc.bold(`[${stamp}] ${type}`)} ${pc.dim(`| ${desc}`)}\n`);
}
