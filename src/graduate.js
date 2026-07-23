// `tng-wiki graduate <item>` - move an `_inbox/` capture into `raw/` so pages
// can cite it (#37). `_inbox/` is the cheap capture zone, not a citable root:
// a page that needs the artifact as evidence graduates it first, then cites
// the raw/ path this verb prints. Filename is preserved; provenance travels
// with the file content itself.
import { existsSync, mkdirSync, renameSync, readdirSync, statSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import pc from 'picocolors';
import { resolveWiki } from './verbs.js';
import { insideRoot } from './paths.js';

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
    if (a === '--wiki' || a === '--to') { i++; continue; }
    if (a.startsWith('--')) continue;
    out.push(a);
  }
  return out;
}

// Top-level-relative paths of every file under _inbox/ (for the miss message).
function listInbox(inboxDir, prefix = '') {
  const out = [];
  for (const e of readdirSync(inboxDir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listInbox(join(inboxDir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

export async function runGraduate(args) {
  const pos = positionals(args);
  if (pos.length !== 1) {
    if (pos.length > 1) throw new Error(`unknown argument "${pos[1]}" - \`graduate\` takes one positional argument (the _inbox item).`);
    process.stderr.write('Usage: tng-wiki graduate <inbox-item> [--to raw/<dir>] [--wiki <slug>] [--json]\n');
    process.exit(1);
  }

  const wiki = resolveWiki(argValue(args, '--wiki'));
  // Same rule as ground's mutating flags (#47): a write must name its target.
  if (wiki.via === 'default') {
    throw new Error(
      `refusing to graduate via the default-wiki fallback: you are not inside a wiki, ` +
      `so this would move a file in "${wiki.slug}" implicitly. Pass --wiki ${wiki.slug} to target it, or run from inside the wiki.`,
    );
  }

  const inboxDir = join(wiki.path, '_inbox');
  if (!existsSync(inboxDir)) throw new Error(`"${wiki.slug ?? wiki.name}" has no _inbox/ directory - nothing to graduate.`);

  const item = pos[0].replace(/^_inbox\//, '');
  const src = join(inboxDir, item);
  if (!insideRoot(resolve(inboxDir), resolve(src))) throw new Error(`Item path "${pos[0]}" escapes _inbox/.`);
  if (!existsSync(src) || !statSync(src).isFile()) {
    const have = listInbox(inboxDir);
    const listing = have.length ? ` _inbox/ contains: ${have.join(', ')}` : ' _inbox/ is empty.';
    throw new Error(`No such inbox item: _inbox/${item}.${listing}`);
  }

  // Destination must live under raw/ - producing a citable path is the point.
  const toRel = (argValue(args, '--to') ?? 'raw/captures').replace(/\/+$/, '');
  if (toRel !== 'raw' && !toRel.startsWith('raw/')) {
    throw new Error(`--to must be under raw/ (got "${toRel}") - pages cite raw/, so graduating anywhere else defeats the purpose.`);
  }
  const dest = join(wiki.path, toRel, basename(item));
  if (!insideRoot(resolve(join(wiki.path, 'raw')), resolve(dest))) throw new Error(`Destination "${toRel}" escapes raw/.`);
  if (existsSync(dest)) throw new Error(`Refusing to overwrite ${toRel}/${basename(item)} - it already exists.`);

  mkdirSync(dirname(dest), { recursive: true });
  renameSync(src, dest);

  const citable = `${toRel}/${basename(item)}`;
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ wiki: wiki.slug, from: `_inbox/${item}`, to: citable }, null, 2) + '\n');
    return;
  }
  process.stdout.write(`${pc.green('✓')} graduated _inbox/${item} ${pc.dim('→')} ${citable}\n`);
  process.stdout.write(pc.dim(`  cite it as [^${citable}] and add ${citable} to the citing page's \`sources:\` list\n`));
}
