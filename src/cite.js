// `tng-wiki cite show <page>` — claim-next-to-evidence review in one command.
//
// For each citation in a page (reusing ground's extractCitations), pull out the
// claim sentence that carries the cite and print it next to the exact source
// lines the cite points at. Working tree by default; `--at-ref` reads code
// authorities at their pinned git ref via the same plumbing `ground --at-ref`
// uses. Errors degrade per-cite (same finding names ground uses), never per-run.

import { readFileSync, existsSync } from 'fs';
import { resolve, sep } from 'path';
import pc from 'picocolors';
import { resolveWiki } from './verbs.js';
import { splitFrontmatter, extractCitations, loadCodeAuthorities } from './ground.js';
import { refResolves, readFileAtRef } from './git-read.js';

const DEFAULT_CONTEXT = 20;

// Same marker regexes extractCitations scans with — used here only to recover
// each cite's column so the claim can be sliced out of the line.
const RAW_RE = /\[\^(raw\/[^\]]+)\]/g;
const CODE_RE = /\[\^code:([^\/\]]+)(?:\/([^\]#]+))?(?:#L(\d+)(?:-L(\d+))?)?\]/g;

// ---- pure helpers ----

// The sentence containing the cite: text from the previous sentence boundary
// (or line start) up to the cite marker, trimmed. Boundaries are sentence ends
// followed by whitespace, earlier cite markers (stacked cites share a claim
// prefix we don't want twice), and `|` so cites inside table cells stay scoped
// to their cell. Heuristic by design — the page line number rides along so a
// human can always jump to the real thing.
export function extractClaim(lineText, markerStart) {
  let head = lineText.slice(0, markerStart);
  // strip trailing cite markers so a stacked cite's claim is prose, not markers
  head = head.replace(/(?:\[\^[^\]]+\]\s*)+$/, '');
  let from = 0;
  for (const m of head.matchAll(/[.!?](?=\s)|\[\^[^\]]+\]|\|/g)) {
    from = m.index + m[0].length;
  }
  return head.slice(from).trim();
}

// Canonical cite key — what `--cite <key>` matches and what the listing prints.
export function citeKey(c) {
  if (c.kind === 'raw') return c.path;
  let key = `code:${c.authority}`;
  if (c.file) key += `/${c.file}`;
  if (c.range) key += `#L${c.range.start}${c.range.end !== c.range.start ? `-L${c.range.end}` : ''}`;
  return key;
}

// Lines of a blob, ignoring a single trailing newline (cf. ground's countLines).
function linesOf(content) {
  const lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function readFileSafe(absPath) {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

// `..` escape guard (cf. verbs.js): a cite path must resolve strictly inside
// its root. Returns the absolute path, or null when the cite escapes.
function resolveWithin(root, relPath) {
  const rootAbs = resolve(root);
  const target = resolve(rootAbs, relPath);
  return target.startsWith(rootAbs + sep) ? target : null;
}

// Page path resolution — same forms `read` accepts (relative to wiki/), plus a
// `wiki/`-prefixed form so it composes with ground's --page output.
function resolvePagePath(wikiPath, page) {
  const wikiDir = resolve(wikiPath, 'wiki');
  const rel = page.startsWith('wiki/') ? page.slice('wiki/'.length) : page;
  const target = resolve(wikiDir, rel);
  if (!target.startsWith(wikiDir + sep)) {
    throw new Error(`Page path "${page}" escapes the wiki directory`);
  }
  if (!existsSync(target)) throw new Error(`Page not found: ${page}`);
  return target;
}

// ---- core (pure data; rendering lives in runCite) ----

// Returns [{ index, cite, kind, authority, file, range, claim, claim_line,
// lines, truncated, error }] — the documented `--json` shape. `error` is null,
// a ground finding name (missing_raw, missing_code_file,
// unknown_code_authority, code_ref_unresolvable, code_line_out_of_range), or
// path_escapes_root for a `..` cite that resolves outside its root; errors
// degrade per-cite, never abort the run.
export function citeShow(wikiPath, page, { atRef = false, context = DEFAULT_CONTEXT, only = null } = {}) {
  const abs = resolvePagePath(wikiPath, page);
  const { body, bodyStartLine } = splitFrontmatter(readFileSync(abs, 'utf8'));
  const cites = extractCitations(body, bodyStartLine);
  const bodyLines = body.split('\n');

  // Recover each cite's column: extractCitations emits per-line raw matches
  // then code matches, in regex order — pair them with a fresh positional scan
  // of the same regexes, then sort into document order.
  const byLine = new Map();
  for (const c of cites) {
    if (!byLine.has(c.line)) byLine.set(c.line, []);
    byLine.get(c.line).push(c);
  }
  for (const [lineNo, lineCites] of byLine) {
    const text = bodyLines[lineNo - bodyStartLine] ?? '';
    const rawCols = [...text.matchAll(RAW_RE)].map((m) => m.index);
    const codeCols = [...text.matchAll(CODE_RE)].map((m) => m.index);
    let r = 0, k = 0;
    for (const c of lineCites) c.col = c.kind === 'raw' ? rawCols[r++] ?? 0 : codeCols[k++] ?? 0;
  }
  cites.sort((a, b) => a.line - b.line || a.col - b.col);

  const authorityByName = new Map(loadCodeAuthorities(wikiPath).map((a) => [a.name, a]));
  // Resolve each ref'd authority's ref once (cf. checkGrounding) — only under --at-ref.
  const refResolvable = new Map();
  if (atRef) {
    for (const a of authorityByName.values()) {
      if (a.ref) refResolvable.set(a.name, refResolves(resolve(wikiPath, a.path), a.ref));
    }
  }

  const entries = cites.map((c, i) => {
    const text = bodyLines[c.line - bodyStartLine] ?? '';
    const entry = {
      index: i + 1,
      cite: citeKey(c),
      kind: c.kind,
      authority: c.kind === 'code' ? c.authority : null,
      file: c.kind === 'code' ? c.file : c.path,
      range: c.range ?? null,
      claim: extractClaim(text, c.col),
      claim_line: c.line,
      lines: [],
      truncated: false,
      error: null,
    };
    Object.assign(entry, resolveCitedLines(wikiPath, c, authorityByName, refResolvable, { atRef, context }));
    return entry;
  });

  if (only == null) return entries;
  return /^\d+$/.test(only)
    ? entries.filter((e) => e.index === Number(only))
    : entries.filter((e) => e.cite === only);
}

function resolveCitedLines(wikiPath, c, authorityByName, refResolvable, { atRef, context }) {
  if (c.kind === 'raw') {
    const rawAbs = resolveWithin(wikiPath, c.path);
    if (rawAbs == null) return { error: 'path_escapes_root' };
    const content = readFileSafe(rawAbs);
    if (content == null) return { error: 'missing_raw' };
    const all = linesOf(content);
    return { lines: all.slice(0, context), truncated: all.length > context };
  }

  // code cite
  if (!c.file) return {}; // whole-authority reference — no file lines to show
  const authority = authorityByName.get(c.authority);
  if (!authority) return { error: 'unknown_code_authority' };

  const repoAbs = resolve(wikiPath, authority.path);
  // guard before either read route — `git show <ref>:<path>` would follow `..` too
  const fileAbs = resolveWithin(repoAbs, c.file);
  if (fileAbs == null) return { error: 'path_escapes_root' };

  const useRef = atRef && Boolean(authority.ref);
  if (useRef && refResolvable.get(authority.name) === false) {
    return { error: 'code_ref_unresolvable' };
  }

  const content = useRef
    ? readFileAtRef(repoAbs, authority.ref, c.file)
    : readFileSafe(fileAbs);
  if (content == null) return { error: 'missing_code_file' };

  const all = linesOf(content);
  if (!c.range) return { lines: all.slice(0, context), truncated: all.length > context };
  // mirror checkGrounding's bounds check — report, don't silently truncate
  if (c.range.start > c.range.end || c.range.end > all.length) {
    return { error: 'code_line_out_of_range' };
  }
  return { lines: all.slice(c.range.start - 1, c.range.end), truncated: false };
}

// ---- CLI ----

const ERROR_LABEL = {
  missing_raw: 'cited raw file does not exist',
  missing_code_file: 'cited code file does not exist in the authority tree',
  unknown_code_authority: '`code:<name>` authority not registered in `.tng-wiki.json`',
  code_ref_unresolvable: 'authority `ref` is not a resolvable git ref',
  code_line_out_of_range: 'cited line range is inverted or extends past the end of the file',
  path_escapes_root: 'cite path resolves outside its root via `..` — refusing to read it',
};

const VALUE_FLAGS = new Set(['--wiki', '--cite', '--context']);

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (VALUE_FLAGS.has(args[i])) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

const USAGE = 'Usage: tng-wiki cite show <page> [--wiki <slug>] [--at-ref] [--cite <n|key>] [--context <lines>] [--json]\n';

export async function runCite(args) {
  const [sub, page] = positionals(args);
  if (sub !== 'show' || !page) {
    process.stderr.write(USAGE);
    process.exit(1);
  }
  const contextArg = argValue(args, '--context');
  const context = contextArg == null ? DEFAULT_CONTEXT : Number(contextArg);
  if (!Number.isInteger(context) || context < 1) {
    process.stderr.write(`Invalid --context value: ${contextArg}\n`);
    process.exit(1);
  }
  const only = argValue(args, '--cite');

  const wiki = resolveWiki(argValue(args, '--wiki'));
  const entries = citeShow(wiki.path, page, { atRef: args.includes('--at-ref'), context, only });

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
    return;
  }

  if (entries.length === 0) {
    if (only != null) {
      process.stderr.write(`No citation matching --cite ${only} in ${page}\n`);
      process.exit(1);
    }
    process.stdout.write(pc.dim(`No citations found in ${page}\n`));
    return;
  }

  for (const e of entries) {
    const claim = e.claim.length > 120 ? e.claim.slice(0, 119) + '…' : e.claim;
    process.stdout.write(`${pc.bold(`[${e.index}]`)} ${pc.cyan(e.cite)}\n`);
    process.stdout.write(`    claim ${pc.dim(`(page L${e.claim_line})`)}: ${claim ? `"${claim}"` : pc.dim('(no claim text found)')}\n`);
    if (e.error) {
      process.stdout.write(`    ${pc.yellow('✗')} ${pc.yellow(e.error)}: ${ERROR_LABEL[e.error] ?? e.error}\n\n`);
      continue;
    }
    if (e.kind === 'code' && !e.file) {
      process.stdout.write(`    ${pc.dim('(whole-authority cite — no file lines to show)')}\n\n`);
      continue;
    }
    process.stdout.write(`    ${pc.dim('── cited lines ─────────────────────────────────────────────')}\n`);
    const start = e.range ? e.range.start : 1;
    const width = String(start + e.lines.length - 1).length;
    e.lines.forEach((line, i) => {
      process.stdout.write(`    ${pc.dim(String(start + i).padStart(width))} ${pc.dim('|')} ${line}\n`);
    });
    if (e.truncated) process.stdout.write(`    ${pc.dim(`… (first ${e.lines.length} lines — widen with --context)`)}\n`);
    process.stdout.write('\n');
  }
  process.stdout.write(pc.dim(`${entries.length} citation(s) in ${page}\n`));
}
