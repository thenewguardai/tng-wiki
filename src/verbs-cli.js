import pc from 'picocolors';
import {
  resolveWiki, queryIndex, readPage, resolvePagePath, searchWiki,
  listSources, listStalePages, listOrphanPages, roundsReport,
} from './verbs.js';
import {
  checkGrounding, WARN_ISSUES, listDriftPages, listUnsourcedPages, listUnverifiedPages,
} from './ground.js';

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

function firstPositional(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--wiki' || a === '--page') { i++; continue; } // skip value-taking flags
    if (a.startsWith('--')) continue;
    return a;
  }
  return undefined;
}

function wikiFromArgs(args) {
  return resolveWiki(argValue(args, '--wiki'));
}

function maybeJson(args, data, render) {
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  render(data);
}

export async function runQuery(args) {
  const wiki = wikiFromArgs(args);
  const content = queryIndex(wiki.path);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ wiki: wiki.slug, path: 'wiki/index.md', content }, null, 2) + '\n');
  } else {
    process.stdout.write(content);
  }
}

export async function runRead(args) {
  const relPath = firstPositional(args);
  if (!relPath) {
    process.stderr.write('Usage: tng-wiki read <page> [--wiki <slug>] [--json]\n');
    process.exit(1);
  }
  const wiki = wikiFromArgs(args);
  const resolved = resolvePagePath(wiki.path, relPath);
  const content = readPage(wiki.path, resolved);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ wiki: wiki.slug, path: resolved, content }, null, 2) + '\n');
  } else {
    process.stdout.write(content);
  }
}

export async function runSearch(args) {
  const query = firstPositional(args);
  if (!query) {
    process.stderr.write('Usage: tng-wiki search <query> [--wiki <slug>] [--regex] [--include-raw] [--include-leads] [--json]\n');
    process.exit(1);
  }
  const wiki = wikiFromArgs(args);
  const hits = searchWiki(wiki.path, query, {
    regex: args.includes('--regex'),
    includeRaw: args.includes('--include-raw'),
    includeLeads: args.includes('--include-leads'),
  });
  maybeJson(args, { wiki: wiki.slug, query, hits }, () => {
    for (const h of hits) {
      const tag = h.source === 'raw' ? pc.yellow('[raw] ')
        : h.source === 'lead' ? pc.magenta(`[lead:${h.archive}]`)
        : pc.dim('[wiki]');
      process.stdout.write(`${tag} ${h.path}:${h.line}: ${h.text}\n`);
    }
  });
}

export async function runSources(args) {
  const wiki = wikiFromArgs(args);
  const sources = listSources(wiki.path, { uncompiledOnly: args.includes('--uncompiled') });
  maybeJson(args, { wiki: wiki.slug, sources }, () => {
    for (const s of sources) {
      const status = s.compiled ? pc.dim('[compiled]  ') : pc.yellow('[uncompiled]');
      const title = s.title ? `  ${pc.dim('—')} ${s.title}` : '';
      process.stdout.write(`${status} ${s.path}${title}\n`);
    }
  });
}

export async function runStale(args) {
  const wiki = wikiFromArgs(args);
  const pages = listStalePages(wiki.path);
  maybeJson(args, { wiki: wiki.slug, pages }, () => {
    for (const p of pages) {
      const count = p.count === 1 ? '1 marker' : `${p.count} markers`;
      process.stdout.write(`${p.path}  ${pc.dim(`(${count})`)}\n`);
    }
  });
}

export async function runOrphans(args) {
  const wiki = wikiFromArgs(args);
  const pages = listOrphanPages(wiki.path);
  maybeJson(args, { wiki: wiki.slug, pages }, () => {
    for (const p of pages) process.stdout.write(`${p.path}\n`);
  });
}

const ISSUE_LABEL = {
  empty_sources: 'empty or missing frontmatter `sources:`',
  missing_raw: 'cited raw file does not exist',
  undeclared_cite: 'cited inline but not in frontmatter `sources:`',
  orphan_source_decl: 'declared in frontmatter but not cited inline',
  source_updated_after_page: 'raw source modified after page `updated`',
  page_not_found: 'page does not exist',
  unknown_code_authority: '`code:<name>` authority not registered in `.tng-wiki.json`',
  missing_code_file: 'cited code file does not exist in the authority tree',
  excluded_code_file: 'cited code file is excluded by the authority `exclude` globs',
  code_line_out_of_range: 'cited line range exceeds the file',
  code_updated_after_page: 'code authority modified after page `updated`',
  code_ref_unresolvable: 'authority `ref` is not a resolvable git ref',
  index_header_drift: '`index.md` header count/date does not match the wiki',
  frontmatter_updated_stale: 'page changed after frontmatter `updated` — bump the date',
  prose_internal_ref: 'internal page referenced in prose — use a [[wikilink]]',
  cited_lead_archive: 'citation resolves into a lead archive — leads are never citable sources',
  missing_lead: '`leads:` entry points at a file the archive no longer has',
  unknown_lead_archive: '`leads:` entry names an archive not registered in `.tng-wiki.json`',
};

export async function runGround(args) {
  const wiki = wikiFromArgs(args);
  const page = argValue(args, '--page');
  const atRef = args.includes('--at-ref');
  const result = checkGrounding(wiki.path, { ...(page ? { page } : {}), atRef });
  maybeJson(args, { wiki: wiki.slug, ...result }, () => {
    // Warnings go to stderr (findings stay on stdout); --json carries them in
    // the top-level `warnings` array instead.
    for (const w of result.warnings ?? []) {
      if (w.code === 'working_tree_of_ref_authority') {
        process.stderr.write(`${pc.yellow('⚠')} authority "${w.authority}" has ref "${w.ref}" — checking the WORKING TREE; pass --at-ref for ref-pinned checks\n`);
      }
    }
    if (result.issues.length === 0) {
      process.stdout.write(`${pc.green('✓')} ${pc.dim(`${result.scanned} pages clean`)}\n`);
      return;
    }
    const byPage = new Map();
    for (const i of result.issues) {
      if (!byPage.has(i.page)) byPage.set(i.page, []);
      byPage.get(i.page).push(i);
    }
    for (const [p, issues] of byPage) {
      process.stdout.write(`${pc.bold(p)}\n`);
      for (const i of issues) {
        const label = ISSUE_LABEL[i.issue] ?? i.issue;
        const filePart = i.file ? (i.ref ? `${i.file}@${i.ref}` : i.file) : null;
        const target = i.raw
          ?? i.matched
          ?? i.lead
          ?? (i.authority && filePart ? `${i.authority}/${filePart}` : null)
          ?? (i.authority && i.ref ? `${i.authority}@${i.ref}` : null)
          ?? i.authority
          ?? (i.archive && i.file ? `${i.archive}/${i.file}` : null)
          ?? i.archive
          ?? null;
        const detail = target ? ` ${pc.dim('→')} ${target}` : '';
        const loc = i.line ? pc.dim(` (line ${i.line})`) : '';
        const range = i.issue === 'code_line_out_of_range' && i.line_count != null
          ? pc.dim(` [${i.range} vs ${i.line_count} lines]`) : '';
        const stamp = i.source_mtime ?? i.source_commit;
        const ts = stamp ? pc.dim(` (page ${i.page_updated}, source ${stamp})`) : '';
        const fmStale = i.issue === 'frontmatter_updated_stale'
          ? pc.dim(` (updated ${i.updated}, last commit ${i.last_commit})`) : '';
        const headerDrift = i.issue === 'index_header_drift'
          ? pc.dim(` (header: ${i.expected_pages} pages, ${i.header_date}; actual: ${i.actual_pages} pages, ${i.newest_page_date})`) : '';
        const suggest = i.suggest ? pc.dim(` — suggest ${i.suggest}`) : '';
        // warn-level lead-provenance findings render dimmed with a (warn) tag;
        // convention findings (WARN_ISSUES) render cyan; errors stay yellow.
        const issueTag = i.level === 'warn' ? pc.dim(`${i.issue} (warn)`)
          : WARN_ISSUES.has(i.issue) ? pc.cyan(i.issue)
          : pc.yellow(i.issue);
        process.stdout.write(`  ${issueTag}: ${label}${detail}${loc}${range}${ts}${fmStale}${headerDrift}${suggest}\n`);
      }
    }
    process.stdout.write(`\n${pc.dim(`${result.issues.length} issue(s) across ${byPage.size} page(s), ${result.scanned} scanned`)}\n`);
  });
}

export async function runRounds(args) {
  const wiki = wikiFromArgs(args);
  const r = roundsReport(wiki.path);
  maybeJson(args, { wiki: wiki.slug, ...r }, () => {
    process.stdout.write(`${pc.bold('Wiki rounds')} ${pc.dim(`— ${wiki.slug} · ${r.scanned} pages`)}\n\n`);
    const row = (label, n, hint) => {
      const count = n > 0 ? pc.yellow(String(n).padStart(3)) : pc.green('  0');
      process.stdout.write(`  ${count}  ${label}${n > 0 ? pc.dim(`  ${hint}`) : ''}\n`);
    };
    row('uncompiled sources (ingest)', r.uncompiled, 'tng-wiki sources --uncompiled');
    row('ground issues', r.ground, 'tng-wiki ground');
    row('convention warnings', r.convention, 'tng-wiki ground');
    row('orphan pages', r.orphans, 'tng-wiki orphans');
    row('⚠️ UNSOURCED?', r.unsourced, 'tng-wiki unsourced');
    row('⚠️ UNVERIFIED?', r.unverified, 'tng-wiki unverified');
    row('⚠️ STALE?', r.stale, 'tng-wiki stale');
    row('⚠️ DRIFT?', r.drift, 'tng-wiki drift');
    if (r.rejection_notes > 0) {
      // informational, not a to-do: audit artifact of verification-first campaigns
      const label = r.rejection_notes === 1 ? 'rejection log' : 'rejection logs';
      process.stdout.write(`  ${pc.cyan(String(r.rejection_notes).padStart(3))}  ${label} ${pc.dim('(verification-first audit trail — deliverables/*_NOTES_*.md)')}\n`);
    }
    const total = r.uncompiled + r.ground + r.convention + r.orphans + r.unsourced + r.unverified + r.stale + r.drift;
    process.stdout.write('\n');
    process.stdout.write(total === 0
      ? `${pc.green('✓ Clean')} ${pc.dim('— nothing to do this round.')}\n`
      : `${pc.dim('Rounds = ingest pending → ground / orphans / unsourced / stale / drift → reconcile → update index.md + log.md → summarize.')}\n`);
  });
}

function runMarkerVerb(args, lister) {
  const wiki = wikiFromArgs(args);
  const pages = lister(wiki.path);
  maybeJson(args, { wiki: wiki.slug, pages }, () => {
    for (const p of pages) {
      const tag = p.count === 1 ? '1 marker' : `${p.count} markers`;
      process.stdout.write(`${p.path}  ${pc.dim(`(${tag})`)}\n`);
    }
  });
}

export const runDrift = (args) => runMarkerVerb(args, listDriftPages);
export const runUnsourced = (args) => runMarkerVerb(args, listUnsourcedPages);
export const runUnverified = (args) => runMarkerVerb(args, listUnverifiedPages);
