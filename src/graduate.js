// `tng-wiki graduate <item>` - move an `_inbox/` capture into `raw/` so pages
// can cite it (#37). `_inbox/` is the cheap capture zone, not a citable root:
// a page that needs the artifact as evidence graduates it first, then cites
// the raw/ path this verb prints. Filename is preserved unless `--as` renames
// on the way in (#57) - capturing sessions can't see raw/, so name collisions
// are a designed-for case, not user error; the rename is recorded as
// `graduated_from:` frontmatter so provenance survives it.
import { existsSync, mkdirSync, renameSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname, basename, extname } from 'path';
import pc from 'picocolors';
import { resolveWiki } from './verbs.js';
import { insideRoot } from './paths.js';
import { warnIfLeased } from './lease.js';
import { splitFrontmatter } from './frontmatter.js';

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
    if (a === '--wiki' || a === '--to' || a === '--as') { i++; continue; }
    if (a.startsWith('--')) continue;
    out.push(a);
  }
  return out;
}

// First free `<stem>-2<ext>`, `<stem>-3<ext>`, ... beside a taken destination,
// for prefilling the collision error's `--as` suggestion.
function suggestFreeName(destDir, name) {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; n < 100; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!existsSync(join(destDir, candidate))) return candidate;
  }
  return null;
}

// Record the pre-rename name in the graduated file's frontmatter (markdown
// only - other file types have no frontmatter to carry it). A missing block
// gets a minimal one; graduation is the transition into raw/, so this is the
// one moment the write doesn't violate raw/ immutability.
function stampGraduatedFrom(destAbs, fromRel) {
  const content = readFileSync(destAbs, 'utf8');
  const { frontmatter } = splitFrontmatter(content);
  const stamped = frontmatter
    ? content.replace(/^---\n([\s\S]*?)\n---/, `---\n$1\ngraduated_from: ${fromRel}\n---`)
    : `---\ngraduated_from: ${fromRel}\n---\n${content}`;
  writeFileSync(destAbs, stamped, 'utf8');
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
    process.stderr.write('Usage: tng-wiki graduate <inbox-item> [--to raw/<dir>] [--as <filename>] [--wiki <slug>] [--json]\n');
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

  warnIfLeased(wiki.path);

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
  // `--as` renames on the way in (#57): a capturing session names its item
  // blind to raw/, so a collision is not evidence of a duplicate.
  const asName = argValue(args, '--as');
  if (asName !== null && (asName !== basename(asName) || asName.startsWith('.') || asName === '')) {
    throw new Error(`--as takes a bare filename (got "${asName}") - pick the directory with --to.`);
  }
  const destName = asName ?? basename(item);
  const dest = join(wiki.path, toRel, destName);
  if (!insideRoot(resolve(join(wiki.path, 'raw')), resolve(dest))) throw new Error(`Destination "${toRel}" escapes raw/.`);
  if (existsSync(dest)) {
    const free = suggestFreeName(join(wiki.path, toRel), destName);
    const rerun = free
      ? ` If it is not a duplicate (e.g. an addendum that reused the name), rename it on the way in:\n  tng-wiki graduate ${pos[0]}${argValue(args, '--to') ? ` --to ${toRel}` : ''} --as ${free}`
      : '';
    throw new Error(`Refusing to overwrite ${toRel}/${destName} - it already exists.${rerun}`);
  }

  mkdirSync(dirname(dest), { recursive: true });
  renameSync(src, dest);

  const renamed = destName !== basename(item);
  if (renamed && extname(destName) === '.md') stampGraduatedFrom(dest, `_inbox/${item}`);

  const citable = `${toRel}/${destName}`;
  if (args.includes('--json')) {
    const out = { wiki: wiki.slug, from: `_inbox/${item}`, to: citable };
    if (renamed) out.renamed = true;
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }
  process.stdout.write(`${pc.green('✓')} graduated _inbox/${item} ${pc.dim('→')} ${citable}\n`);
  if (renamed) process.stdout.write(pc.dim(`  renamed from ${basename(item)}${extname(destName) === '.md' ? '; original name recorded as graduated_from: frontmatter' : ''}\n`));
  process.stdout.write(pc.dim(`  cite it as [^${citable}] and add ${citable} to the citing page's \`sources:\` list\n`));
}
