// `tng-wiki split --dry-run` (#51): analyze what extracting a subset of a wiki
// into its own wiki would carry, so a boundary change is a report before it is
// a mutation. v1 is dry-run ONLY - the mutating split does not exist yet; the
// report is what makes a manual split safe in the meantime.
//
// The analysis is the load-bearing part: which raw/ sources travel (and which
// are shared with staying pages and must be COPIED, not moved), which lockfile
// entries transplant (re-locking in the destination would forge verification
// the new wiki never performed - entries must travel verbatim), which manifest
// entries (code authorities / lead archives) the moved pages depend on, which
// [[wikilinks]] cross the new boundary in each direction, and which staying
// claims are about to lean on a cross-wiki reference (references, never
// evidence - the orphaned-claim risk the doctrine warns about).

import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, dirname, join, relative, resolve } from 'path';
import pc from 'picocolors';
import { resolveWiki, pageStemMap } from './verbs.js';
import { matchesAnyGlob } from './glob.js';
import { walkMd, insideRoot, pathForm, resolveConfigPath } from './paths.js';
import {
  extractSources, extractLeads, extractCitations, isGroundable,
  loadCodeAuthorities, loadLeadArchives,
} from './ground.js';
import { splitFrontmatter } from './frontmatter.js';
import { readLock, citeKey } from './lock.js';
import { loadRegistry, getWiki, slugifyName } from './registry.js';

const STRUCTURAL = new Set(['index.md', 'log.md']);

// Selector forms per user input (a page path, a page stem-path, or a zone
// directory): the literal, the literal + `.md`, and the literal as a directory
// prefix. `zones/comp`, `zones/comp/`, `zones/comp/**`, and
// `zones/comp/policy.md` all mean what they look like they mean.
function selectorGlobs(input) {
  const s = String(input).trim().replace(/^wiki\//, '').replace(/\/+$/, '');
  return { input, globs: [s, `${s}.md`, `${s}/**`] };
}

// [[wikilink]] occurrences in a page body: [{ target, line }]. Fenced code
// blocks and inline code spans are skipped (same discipline as
// extractCrossWikiLinks); already-qualified [[slug:page]] links are excluded -
// they name their wiki explicitly and no boundary change affects them.
export function extractWikilinks(body, bodyStartLine = 1) {
  const links = [];
  const lines = body.split('\n');
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fenced = !fenced; continue; }
    if (fenced) continue;
    const text = lines[i].replace(/`[^`]*`/g, '');
    for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
      const target = m[1].trim();
      if (/^[a-z0-9][a-z0-9-]*:/.test(target)) continue;
      links.push({ target, line: i + bodyStartLine });
    }
  }
  return links;
}

const stemOf = (p) => p.split('/').pop().replace(/\.md$/, '').toLowerCase();

// Non-dot FILES directly inside `dir` (no recursion) - the raw/ residue scan.
function filesIn(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// All non-dot files under `dir`, recursively (any extension - _inbox/ and
// deliverables/ are not markdown-only).
function countFiles(dir) {
  if (!existsSync(dir)) return null;
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.isFile()) n++;
    }
  };
  walk(dir);
  return n;
}

// Pure analysis. `selectors` match page paths relative to wiki/ (a leading
// `wiki/` is tolerated). Returns a plain report object; throws only on inputs
// that make the whole analysis meaningless (no pages matched).
export function planSplit(wikiPath, { selectors, intoPath, destSlug, sourceSlug = null, home } = {}) {
  const wikiDir = join(wikiPath, 'wiki');
  const allPages = walkMd(wikiDir).map((f) => relative(wikiPath, f).replace(/\\/g, '/'));
  const candidates = allPages.filter((rel) => !STRUCTURAL.has(rel.split('/').pop()));

  const parsed = selectors.map(selectorGlobs);
  const moved = new Set();
  const unmatched = [];
  for (const { input, globs } of parsed) {
    let hit = false;
    for (const rel of candidates) {
      if (matchesAnyGlob(rel.replace(/^wiki\//, ''), globs)) { moved.add(rel); hit = true; }
    }
    if (!hit) unmatched.push(input);
  }
  if (moved.size === 0) {
    throw new Error(`--pages matched no pages (tried: ${selectors.join(', ')}). Selectors match paths under wiki/, e.g. zones/compliance or entities/acme.md.`);
  }
  const staying = candidates.filter((rel) => !moved.has(rel));

  // Scan cites/links per page. Only groundable pages carry claims worth
  // analyzing - a moved _template travels as a file but its example cites and
  // links must not pollute the report.
  const scan = (rel) => {
    const content = readFileSync(join(wikiPath, rel), 'utf8');
    const { frontmatter, body, bodyStartLine } = splitFrontmatter(content);
    const declared = extractSources(frontmatter) ?? [];
    const cites = extractCitations(body, bodyStartLine).filter((c) => c.kind !== 'unknown');
    const raw = new Set([
      ...declared.filter((d) => d.startsWith('raw/')),
      ...cites.filter((c) => c.kind === 'raw').map((c) => c.path),
    ]);
    const authorities = new Set([
      ...declared.filter((d) => d.startsWith('code:')).map((d) => d.slice('code:'.length)),
      ...cites.filter((c) => c.kind === 'code').map((c) => c.authority),
    ]);
    const leadNames = new Set(extractLeads(frontmatter).map((l) => {
      const colon = l.indexOf(':');
      return colon === -1 ? l : l.slice(0, colon);
    }));
    return { rel, cites, raw, authorities, leadNames, links: extractWikilinks(body, bodyStartLine) };
  };
  const movedScans = [...moved].filter(isGroundable).map(scan);
  const stayingScans = staying.filter(isGroundable).map(scan);

  // --- raw/ sources: move when only moved pages reference them, copy when a
  // staying page still needs them (two copies beats a broken trust chain on
  // either side - the report names the divergence risk).
  const stayingRawCiters = new Map();
  for (const s of stayingScans) {
    for (const r of s.raw) {
      if (!stayingRawCiters.has(r)) stayingRawCiters.set(r, []);
      stayingRawCiters.get(r).push(s.rel);
    }
  }
  const rawMove = [];
  const rawCopy = [];
  const rawMissing = [];
  const carriedRaw = new Set();
  for (const s of movedScans) {
    for (const r of s.raw) {
      if (carriedRaw.has(r)) continue;
      carriedRaw.add(r);
      if (!existsSync(join(wikiPath, r))) { rawMissing.push(r); continue; }
      const stayers = stayingRawCiters.get(r);
      if (stayers) rawCopy.push({ path: r, staying_citers: stayers.length });
      else rawMove.push(r);
    }
  }

  // Residue: files sharing a directory with a carried raw file but carried by
  // nothing - the "zone partition" leftovers the issue asks the report to NAME
  // so the human finishes the job deliberately.
  const residue = [];
  const seenDirs = new Set();
  for (const r of [...rawMove, ...rawCopy.map((c) => c.path)]) {
    const dir = dirname(r);
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);
    const left = filesIn(join(wikiPath, dir)).filter((name) => !carriedRaw.has(`${dir}/${name}`));
    if (left.length > 0) residue.push({ dir, files: left.sort() });
  }

  // --- lockfile transplant: the entries under each moved page travel verbatim
  // (hash + hashed_at_sha are the verification the wiki actually performed),
  // plus the `authorities` provenance rows for authorities the moved pages cite.
  const lock = readLock(wikiPath);
  const movedAuthorityNames = new Set(movedScans.flatMap((s) => [...s.authorities]));
  let lockReport;
  if (lock === null) {
    lockReport = { present: false, entries: 0, pages_locked: 0, unlocked_cites: 0, authorities: [] };
  } else {
    let entries = 0;
    let pagesLocked = 0;
    let unlocked = 0;
    for (const s of movedScans) {
      const pageLock = lock.citations[s.rel] ?? {};
      const n = Object.keys(pageLock).length;
      if (n > 0) { entries += n; pagesLocked++; }
      const keys = new Set();
      for (const c of s.cites) {
        if (c.kind === 'code' && !c.file) continue; // whole-authority refs are never locked
        keys.add(citeKey(c));
      }
      for (const k of keys) if (!pageLock[k]) unlocked++;
    }
    lockReport = {
      present: true,
      entries,
      pages_locked: pagesLocked,
      unlocked_cites: unlocked,
      authorities: [...movedAuthorityNames].filter((n) => lock.authorities[n]).sort(),
    };
  }

  // --- manifest carry-over: code_authorities / lead_archives the moved pages
  // actually depend on. Paths are wiki-root-relative in the manifest, so a
  // relative path that resolves here will NOT resolve from the destination
  // root - the report states the form so the human re-bases or localizes.
  const authoritiesByName = new Map(loadCodeAuthorities(wikiPath).map((a) => [a.name, a]));
  const authorities = [];
  const unknownAuthorities = [];
  for (const name of [...movedAuthorityNames].sort()) {
    const a = authoritiesByName.get(name);
    if (!a) { unknownAuthorities.push(name); continue; }
    const form = pathForm(a.path);
    let resolvable = false;
    try {
      resolvable = form !== 'invalid' && existsSync(resolveConfigPath(wikiPath, a.path));
    } catch { /* malformed path - stays unresolvable */ }
    authorities.push({ name, path: a.path ?? null, form, ref: a.ref ?? null, trusted: a.trusted === true, resolvable });
  }
  const movedLeadNames = new Set(movedScans.flatMap((s) => [...s.leadNames]));
  const leadArchives = loadLeadArchives(wikiPath)
    .filter((a) => movedLeadNames.has(a.name))
    .map((a) => ({ name: a.name, path: a.path ?? null, form: pathForm(a.path) }));

  // --- link boundary analysis. Stems resolve through the same map orphans
  // uses; a stem matching pages on BOTH sides is ambiguous and left to the
  // human rather than guessed at.
  const stemMap = pageStemMap(wikiPath); // stem -> [rel] (rel includes wiki/)
  const classify = (target) => {
    const cands = (stemMap.get(stemOf(target)) ?? []).map((r) => r.replace(/\\/g, '/'));
    if (cands.length === 0) return 'dangling';
    const m = cands.some((r) => moved.has(r));
    const s = cands.some((r) => !moved.has(r));
    return m && s ? 'ambiguous' : m ? 'moved' : 'staying';
  };
  let internal = 0;
  const outbound = [];
  const inbound = [];
  const ambiguous = [];
  for (const sc of movedScans) {
    for (const l of sc.links) {
      const c = classify(l.target);
      if (c === 'moved') internal++;
      else if (c === 'staying') outbound.push({ page: sc.rel, target: l.target, line: l.line });
      else if (c === 'ambiguous') ambiguous.push({ page: sc.rel, target: l.target, line: l.line, direction: 'outbound' });
    }
  }
  for (const sc of stayingScans) {
    for (const l of sc.links) {
      const c = classify(l.target);
      if (c === 'moved') inbound.push({ page: sc.rel, target: l.target, line: l.line });
      else if (c === 'ambiguous') ambiguous.push({ page: sc.rel, target: l.target, line: l.line, direction: 'inbound' });
    }
  }

  // --- index rows referencing moved pages (stem wikilink or literal path)
  let indexRows = 0;
  const indexAbs = join(wikiDir, 'index.md');
  if (existsSync(indexAbs)) {
    const movedStems = new Set([...moved].map(stemOf));
    const movedSubs = [...moved].map((r) => r.replace(/^wiki\//, ''));
    for (const line of readFileSync(indexAbs, 'utf8').split('\n')) {
      const lower = line.toLowerCase();
      const linksMoved = [...lower.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)]
        .some((m) => movedStems.has(stemOf(m[1].trim())));
      if (linksMoved || movedSubs.some((p) => line.includes(p))) indexRows++;
    }
  }

  // --- destination sanity
  const intoAbs = resolve(intoPath);
  const registered = getWiki(loadRegistry(home), destSlug);
  const dest = {
    path: intoAbs,
    slug: destSlug,
    exists: existsSync(intoAbs),
    is_wiki: existsSync(join(intoAbs, '.tng-wiki.json')),
    inside_source: insideRoot(resolve(wikiPath), intoAbs),
    contains_source: insideRoot(intoAbs, resolve(wikiPath)),
    slug_conflict: registered && resolve(registered.path) !== intoAbs ? registered.path : null,
  };

  return {
    source: { slug: sourceSlug, path: resolve(wikiPath) },
    dest,
    selectors,
    unmatched_selectors: unmatched,
    pages: [...moved].sort(),
    staying_count: staying.length,
    raw: { move: rawMove.sort(), copy: rawCopy.sort((a, b) => a.path.localeCompare(b.path)), missing: rawMissing.sort(), residue },
    lock: lockReport,
    authorities,
    unknown_authorities: unknownAuthorities,
    lead_archives: leadArchives,
    links: { internal, outbound, inbound, ambiguous },
    index_rows: indexRows,
    unanalyzed: { inbox: countFiles(join(wikiPath, '_inbox')), deliverables: countFiles(join(wikiPath, 'deliverables')) },
  };
}

// ---- CLI ----

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

function argValues(args, flag) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== flag) continue;
    const next = args[i + 1];
    if (next && !next.startsWith('--')) out.push(next);
  }
  return out;
}

function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--wiki' || a === '--pages' || a === '--into' || a === '--name') { i++; continue; }
    if (a.startsWith('--')) continue;
    out.push(a);
  }
  return out;
}

export async function runSplit(args) {
  const extra = positionals(args);
  if (extra.length > 0) {
    throw new Error(`unknown argument "${extra[0]}" - \`split\` takes no positional arguments. Pass selectors with --pages and the destination with --into.`);
  }

  const selectors = argValues(args, '--pages');
  const into = argValue(args, '--into');
  if (selectors.length === 0 || !into) {
    process.stderr.write('Usage: tng-wiki split --pages <glob|zone> [--pages ...] --into <path> [--name <slug>] [--wiki <slug>] --dry-run [--json]\n');
    process.exit(1);
  }
  if (!args.includes('--dry-run')) {
    throw new Error(
      'split is dry-run only for now: pass --dry-run. It reports what would move, which lock entries '
      + 'transplant, which links become cross-wiki, and which staying claims lose in-wiki support (#51). '
      + 'The mutating split is not implemented yet.',
    );
  }

  const wiki = resolveWiki(argValue(args, '--wiki'));
  // Same rule as ground's mutating flags (#47): even the dry run of a boundary
  // change must name its wiki - analyzing "whatever the default is" invites
  // acting on the wrong wiki next.
  if (wiki.via === 'default') {
    throw new Error(
      `refusing \`split\` via the default-wiki fallback: you are not inside a wiki, so this would analyze `
      + `"${wiki.slug}" implicitly. Pass --wiki ${wiki.slug} to target it, or run from inside the wiki.`,
    );
  }

  const destSlug = slugifyName(argValue(args, '--name') ?? basename(resolve(into)));
  if (!destSlug) throw new Error('Cannot derive a destination slug - pass --name <slug>.');

  const plan = planSplit(wiki.path, { selectors, intoPath: into, destSlug, sourceSlug: wiki.slug });

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ wiki: wiki.slug, dry_run: true, ...plan }, null, 2) + '\n');
    return;
  }
  renderPlan(plan);
}

function renderPlan(plan) {
  const out = (s = '') => process.stdout.write(s + '\n');
  const srcLabel = plan.source.slug ?? plan.source.path;
  const destStem = (t) => t.replace(/\.md$/, '');
  out(`${pc.bold('Split dry run')} ${pc.dim(`— ${srcLabel} → ${plan.dest.slug} @ ${plan.dest.path}`)}`);

  // destination blockers first - if these are wrong nothing below matters
  if (plan.dest.inside_source) out(`  ${pc.red('✗')} destination is INSIDE the source wiki - a split cannot nest the new wiki in the old one`);
  if (plan.dest.contains_source) out(`  ${pc.red('✗')} destination CONTAINS the source wiki - pick a sibling path`);
  if (plan.dest.slug_conflict) out(`  ${pc.yellow('!')} slug "${plan.dest.slug}" is already registered at ${plan.dest.slug_conflict} - pass --name to pick another`);
  if (plan.dest.is_wiki) out(`  ${pc.yellow('!')} destination is already a wiki - split would merge into it, which is out of scope; pick a fresh path`);
  for (const s of plan.unmatched_selectors) out(`  ${pc.yellow('!')} selector matched nothing: ${s}`);

  out();
  out(`${pc.bold('Pages')} ${pc.dim(`— ${plan.pages.length} move, ${plan.staying_count} stay`)}`);
  for (const p of plan.pages) out(`  ${p}`);

  out();
  const r = plan.raw;
  out(`${pc.bold('Raw sources')} ${pc.dim(`— ${r.move.length} move, ${r.copy.length} copy (shared), ${r.missing.length} missing`)}`);
  for (const p of r.move) out(`  ${pc.green('move')}  ${p}`);
  for (const c of r.copy) out(`  ${pc.cyan('copy')}  ${c.path} ${pc.dim(`(still cited by ${c.staying_citers} staying page${c.staying_citers === 1 ? '' : 's'} - two copies will diverge; consider which side keeps the canonical one)`)}`);
  for (const p of r.missing) out(`  ${pc.yellow('!')} missing ${p} ${pc.dim('(cited but absent - a pre-existing ground failure)')}`);
  for (const res of r.residue) out(`  ${pc.dim(`left behind in ${res.dir}/: ${res.files.join(', ')}`)}`);

  out();
  out(pc.bold('Lock transplant'));
  if (!plan.lock.present) {
    out(`  ${pc.dim('no lockfile - nothing to transplant; the destination starts unlocked (run ground --update-lock there after verifying)')}`);
  } else {
    out(`  ${pc.green('✓')} ${plan.lock.entries} locked citation(s) across ${plan.lock.pages_locked} page(s) transfer verbatim ${pc.dim('(never re-lock in the destination - that would forge verification this wiki performed)')}`);
    if (plan.lock.authorities.length > 0) out(`  ${pc.dim(`authority provenance rows carried: ${plan.lock.authorities.join(', ')}`)}`);
    if (plan.lock.unlocked_cites > 0) out(`  ${pc.yellow('!')} ${plan.lock.unlocked_cites} cited-but-unlocked citation(s) arrive unlocked`);
  }

  if (plan.authorities.length + plan.unknown_authorities.length + plan.lead_archives.length > 0) {
    out();
    out(pc.bold('Manifest carry-over'));
    for (const a of plan.authorities) {
      const bits = [a.path, a.form, a.ref ? `ref ${a.ref}` : null, a.trusted ? 'trusted' : null].filter(Boolean).join(', ');
      const rebase = a.form === 'relative' ? ' - a wiki-relative path will NOT resolve from the destination root; re-base it or `tng-wiki localize` there' : '';
      const unres = a.resolvable ? '' : ` ${pc.yellow('(unresolvable here)')}`;
      out(`  code authority "${a.name}" ${pc.dim(`(${bits})${rebase}`)}${unres}`);
    }
    for (const n of plan.unknown_authorities) out(`  ${pc.yellow('!')} cited authority "${n}" is not in .tng-wiki.json ${pc.dim('(pre-existing ground failure)')}`);
    for (const l of plan.lead_archives) out(`  lead archive "${l.name}" ${pc.dim(`(${l.path}, ${l.form})`)}`);
  }

  out();
  const L = plan.links;
  out(`${pc.bold('Links')} ${pc.dim(`— ${L.internal} internal (move together, unchanged)`)}`);
  if (L.outbound.length > 0) {
    out(`  outbound: moved pages referencing staying pages - rewrite to ${pc.cyan(`[[${plan.source.slug ?? '<source-slug>'}:...]]`)}`);
    for (const l of L.outbound) out(`    ${l.page}:${l.line} ${pc.dim(`[[${l.target}]] → [[${plan.source.slug ?? '<source-slug>'}:${destStem(l.target)}]]`)}`);
  }
  if (L.inbound.length > 0) {
    out(`  inbound: staying pages referencing moved pages - rewrite to ${pc.cyan(`[[${plan.dest.slug}:...]]`)} ${pc.yellow('(orphaned-claim risk: cross-wiki links are references, never evidence)')}`);
    for (const l of L.inbound) out(`    ${l.page}:${l.line} ${pc.dim(`[[${l.target}]] → [[${plan.dest.slug}:${destStem(l.target)}]]`)}`);
  }
  if (L.ambiguous.length > 0) {
    out(`  ${pc.yellow('ambiguous')}: stems matching pages on BOTH sides - resolve by hand`);
    for (const l of L.ambiguous) out(`    ${l.page}:${l.line} [[${l.target}]]`);
  }
  if (plan.source.slug === null && L.outbound.length > 0) {
    out(`  ${pc.yellow('!')} source wiki is not registered - outbound rewrites need a slug; register it first`);
  }

  out();
  out(`${pc.bold('Index & log')} ${pc.dim(`— ${plan.index_rows} index.md row(s) reference moved pages; a split rewrites them and logs on both sides`)}`);

  const un = plan.unanalyzed;
  if ((un.inbox ?? 0) > 0 || (un.deliverables ?? 0) > 0) {
    const parts = [];
    if (un.inbox) parts.push(`_inbox/ (${un.inbox} item${un.inbox === 1 ? '' : 's'})`);
    if (un.deliverables) parts.push(`deliverables/ (${un.deliverables} file${un.deliverables === 1 ? '' : 's'})`);
    out(`${pc.bold('Not analyzed')} ${pc.dim(`— ${parts.join(', ')}: not partitioned by this report; move what belongs to the extracted zone by hand`)}`);
  }

  out();
  out(`${pc.dim('Dry run - nothing was written. The mutating split is not implemented yet (#51); use this report to perform the split by hand, transplanting the listed lock entries verbatim.')}`);
}
