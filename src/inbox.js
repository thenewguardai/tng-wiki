// `tng-wiki inbox` - pending `_inbox/` captures across every registered wiki
// (or one, with --wiki). The librarian's triage queue in one call, replacing
// the per-hub `ls` loops agents kept hand-rolling. Read-only.
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import pc from 'picocolors';
import { loadRegistry, listWikis } from './registry.js';
import { splitFrontmatter, parseScalars, extractListKey } from './frontmatter.js';
import { fileCommitDate } from './git-read.js';

const DAY_MS = 86_400_000;

// Paths under `dir`, relative to it, sorted; dotfiles (.gitkeep) skipped.
function walkInbox(dir, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkInbox(join(dir, e.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

function describeItem(wikiPath, rel, now) {
  const abs = join(wikiPath, '_inbox', rel);
  let title = null;
  let also = [];
  let capturedOn = null;
  if (rel.endsWith('.md')) {
    const content = readFileSync(abs, 'utf8');
    const { frontmatter, body } = splitFrontmatter(content);
    const scalars = parseScalars(frontmatter);
    title = scalars.title || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || null;
    also = extractListKey(frontmatter, 'also') ?? [];
    capturedOn = scalars.captured_on || null;
  }
  const since = fileCommitDate(wikiPath, join('_inbox', rel)) ?? statSync(abs).mtime;
  return {
    path: rel,
    title,
    also,
    captured_on: capturedOn,
    age_days: Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS)),
  };
}

export function collectInbox({ only = null, home, now = new Date() } = {}) {
  const wikis = listWikis(loadRegistry(home)).filter((w) => (only ? w.slug === only : true));
  if (only && wikis.length === 0) throw new Error(`No wiki registered under slug "${only}". Run \`tng-wiki list\`.`);
  const results = wikis.map((w) => {
    const inboxDir = join(w.path, '_inbox');
    const hasInbox = existsSync(inboxDir);
    return {
      slug: w.slug,
      path: w.path,
      has_inbox: hasInbox,
      items: hasInbox ? walkInbox(inboxDir).map((rel) => describeItem(w.path, rel, now)) : [],
    };
  });
  return { wikis: results, total: results.reduce((n, w) => n + w.items.length, 0) };
}

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

export async function runInbox(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--wiki') { i++; continue; }
    if (!args[i].startsWith('--')) throw new Error(`unknown argument "${args[i]}" - \`inbox\` takes no positional arguments. Did you mean --wiki ${args[i]}?`);
  }
  const result = collectInbox({ only: argValue(args, '--wiki') });
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  for (const w of result.wikis) {
    if (!w.has_inbox) continue;
    const count = w.items.length;
    process.stdout.write(`${pc.bold(w.slug)} ${pc.dim(`${count} pending`)}\n`);
    for (const item of w.items) {
      const meta = [
        `${item.age_days}d`,
        item.captured_on ? `from ${item.captured_on}` : null,
        item.also.length ? `also: ${item.also.join(', ')}` : null,
      ].filter(Boolean).join(' · ');
      process.stdout.write(`  ${pc.cyan('●')} ${item.path}${item.title ? ` ${pc.dim('-')} ${item.title}` : ''} ${pc.dim(`(${meta})`)}\n`);
    }
  }
  process.stdout.write(result.total === 0
    ? pc.dim('no pending captures\n')
    : pc.dim(`\n${result.total} pending - a librarian session on each wiki's home host triages them (see .tng-wiki/doctrine/operations.md)\n`));
}
