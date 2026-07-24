import pc from 'picocolors';
import {
  resolveWiki, queryIndex, readPage, resolvePagePath, searchWiki, searchAllWikis,
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

// Every non-flag token, in order, skipping the values of value-taking flags.
function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--wiki' || a === '--page') { i++; continue; } // skip value-taking flags
    if (a.startsWith('--')) continue;
    out.push(a);
  }
  return out;
}

// Surplus positionals are an error, not noise: silently ignoring them let a
// mistyped invocation fall through wiki resolution and operate on the DEFAULT
// wiki - with --update-lock, a write to a wiki nobody named (#47).
function rejectSurplus(verb, args, allowed = 0, hint = null) {
  const extra = positionals(args).slice(allowed);
  if (extra.length === 0) return;
  const takes = allowed === 0 ? 'takes no positional arguments' : `takes only ${allowed} positional argument${allowed === 1 ? '' : 's'}`;
  throw new Error(`unknown argument "${extra[0]}" - \`${verb}\` ${takes}. ${hint ?? `Did you mean --wiki ${extra[0]}?`}`);
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
  rejectSurplus('query', args);
  const wiki = wikiFromArgs(args);
  const content = queryIndex(wiki.path);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ wiki: wiki.slug, path: 'wiki/index.md', content }, null, 2) + '\n');
  } else {
    process.stdout.write(content);
  }
}

export async function runRead(args) {
  rejectSurplus('read', args, 1);
  const relPath = positionals(args)[0];
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
  rejectSurplus('search', args, 1, 'Quote multi-word queries: tng-wiki search "two words".');
  const query = positionals(args)[0];
  if (!query) {
    process.stderr.write('Usage: tng-wiki search <query> [--wiki <slug> | --all-wikis] [--regex] [--include-raw] [--include-leads] [--json]\n');
    process.exit(1);
  }
  const opts = {
    regex: args.includes('--regex'),
    includeRaw: args.includes('--include-raw'),
    includeLeads: args.includes('--include-leads'),
  };
  const hitTag = (h) => (h.source === 'raw' ? pc.yellow('[raw] ')
    : h.source === 'lead' ? pc.magenta(`[lead:${h.archive}]`)
    : pc.dim('[wiki]'));

  if (args.includes('--all-wikis')) {
    if (argValue(args, '--wiki')) throw new Error('--all-wikis and --wiki are mutually exclusive - pass one or the other.');
    const { searched, hits, errors } = searchAllWikis(query, opts);
    if (searched.length === 0 && errors.length === 0) throw new Error('No wikis registered. Run `tng-wiki register` or `tng-wiki init` first.');
    maybeJson(args, { all_wikis: true, wikis: searched, query, hits, errors }, () => {
      for (const h of hits) {
        process.stdout.write(`${pc.cyan(`[${h.wiki}]`)} ${hitTag(h)} ${h.path}:${h.line}: ${h.text}\n`);
      }
      for (const e of errors) {
        process.stderr.write(`${pc.yellow('⚠')} ${e.wiki}: ${e.error}\n`);
      }
    });
    return;
  }

  const wiki = wikiFromArgs(args);
  const hits = searchWiki(wiki.path, query, opts);
  maybeJson(args, { wiki: wiki.slug, query, hits }, () => {
    for (const h of hits) {
      process.stdout.write(`${hitTag(h)} ${h.path}:${h.line}: ${h.text}\n`);
    }
  });
}

export async function runSources(args) {
  rejectSurplus('sources', args);
  const wiki = wikiFromArgs(args);
  const sources = listSources(wiki.path, { uncompiledOnly: args.includes('--uncompiled') });
  maybeJson(args, { wiki: wiki.slug, sources }, () => {
    for (const s of sources) {
      const status = s.compiled ? pc.dim('[compiled]  ') : pc.yellow('[uncompiled]');
      const title = s.title ? `  ${pc.dim('-')} ${s.title}` : '';
      process.stdout.write(`${status} ${s.path}${title}\n`);
    }
  });
}

export async function runStale(args) {
  rejectSurplus('stale', args);
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
  rejectSurplus('orphans', args);
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
  unknown_cite_root: 'cite root is not citable - only raw/ and code: resolve',
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
  cite_content_changed: 'cited content changed since last verified',
  cite_moved: 'cited content moved — anchor shifted (run `ground --fix-moved`)',
  cite_moved_ambiguous: 'locked content found at multiple locations — fix the anchor manually',
  cite_unlocked: 'citation not in the lockfile (lock with `ground --update-lock` after verifying)',
};

export async function runGround(args) {
  rejectSurplus('ground', args);
  const wiki = wikiFromArgs(args);
  const page = argValue(args, '--page');
  const atRef = args.includes('--at-ref');
  const updateLock = args.includes('--update-lock');
  const fixMoved = args.includes('--fix-moved');
  const fixIndex = args.includes('--fix-index');
  const fixDates = args.includes('--fix-dates');
  // A mutating run must name its target: standing inside the wiki or passing
  // --wiki both count, the registered-default fallback does not (#47).
  if ((updateLock || fixMoved || fixIndex || fixDates) && wiki.via === 'default') {
    const flag = updateLock ? '--update-lock' : fixMoved ? '--fix-moved' : fixIndex ? '--fix-index' : '--fix-dates';
    throw new Error(
      `refusing \`ground ${flag}\` via the default-wiki fallback: you are not inside a wiki, ` +
      `so this would write to "${wiki.slug}" implicitly. Pass --wiki ${wiki.slug} to target it, or run from inside the wiki.`,
    );
  }
  const result = checkGrounding(wiki.path, { ...(page ? { page } : {}), atRef, updateLock, fixMoved, fixIndex, fixDates });
  maybeJson(args, { wiki: wiki.slug, ...result }, () => {
    // Warnings go to stderr (findings stay on stdout); --json carries them in
    // the top-level `warnings` array instead.
    for (const w of result.warnings ?? []) {
      if (w.code === 'working_tree_of_ref_authority') {
        process.stderr.write(`${pc.yellow('⚠')} authority "${w.authority}" has ref "${w.ref}" — checking the WORKING TREE; pass --at-ref for ref-pinned checks\n`);
      } else if (w.code === 'trusted_authority') {
        const prov = w.verified_sha
          ? ` (verified ${w.verified_ref ? `${w.verified_ref}@` : ''}${w.verified_sha.slice(0, 7)})`
          : '';
        const n = w.cites === 1 ? '1 citation' : `${w.cites} citations`;
        process.stderr.write(`${pc.cyan('ℹ')} authority "${w.authority}": ${n} trusted, not verifiable here${prov} — no local checkout; run \`tng-wiki localize\` to point at one\n`);
      }
    }
    if (result.issues.length === 0) {
      process.stdout.write(`${pc.green('✓')} ${pc.dim(`${result.scanned} pages clean`)}\n`);
    } else {
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
          const target = i.cite
            ?? i.raw
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
          const moved = i.issue === 'cite_moved'
            ? pc.dim(` [${i.old_range} → ${i.new_range}]`)
            : i.issue === 'cite_moved_ambiguous'
              ? pc.dim(` [at ${i.candidate_ranges.join(', ')}]`)
              : '';
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
          process.stdout.write(`  ${issueTag}: ${label}${detail}${loc}${range}${moved}${ts}${fmStale}${headerDrift}${suggest}\n`);
        }
      }
      process.stdout.write(`\n${pc.dim(`${result.issues.length} issue(s) across ${byPage.size} page(s), ${result.scanned} scanned`)}\n`);
    }
    if (result.fixed_index) {
      const fi = result.fixed_index;
      process.stdout.write(`${pc.green('✓')} index header updated ${pc.dim(`(${fi.was_pages} pages, ${fi.was_date} → ${fi.pages} pages, ${fi.date})`)}\n`);
    }
    if (result.fixed_dates?.length) {
      process.stdout.write(`${pc.green('✓')} bumped \`updated\` on ${result.fixed_dates.length} page(s)\n`);
      for (const f of result.fixed_dates) {
        process.stdout.write(`  ${pc.dim(`${f.page}: ${f.from} → ${f.to}`)}\n`);
      }
    }
    if (result.fixed?.length) {
      process.stdout.write(`${pc.green('✓')} fixed ${result.fixed.length} moved cite anchor(s)\n`);
      for (const f of result.fixed) {
        process.stdout.write(`  ${pc.dim(`${f.page}: ${f.cite} [${f.old_range} → ${f.new_range}]`)}\n`);
      }
    }
    if (result.lock) {
      if (!result.lock.exists) {
        process.stdout.write(pc.dim('hint: run `tng-wiki ground --update-lock` to enable per-citation churn detection\n'));
      } else {
        for (const [name, a] of Object.entries(result.lock.authorities ?? {})) {
          if (!a.resolved_sha) continue;
          const refPart = a.ref ? `${a.ref}@` : '';
          const dirty = a.dirty ? pc.yellow(' (dirty)') : '';
          process.stdout.write(pc.dim(`verified against ${name} ${refPart}${a.resolved_sha.slice(0, 7)}`) + dirty + '\n');
        }
        if (updateLock && result.lock.written) {
          process.stdout.write(`${pc.green('✓')} lockfile updated ${pc.dim(`(${result.lock.citations_locked} citation(s) locked)`)}\n`);
        } else if (updateLock && !result.lock.written) {
          process.stdout.write(`${pc.yellow('!')} could not write wiki/.tng-wiki.lock.json\n`);
        }
      }
    }
  });
}

export async function runRounds(args) {
  rejectSurplus('rounds', args);
  const wiki = wikiFromArgs(args);
  const r = roundsReport(wiki.path);
  maybeJson(args, { wiki: wiki.slug, ...r }, () => {
    process.stdout.write(`${pc.bold('Wiki rounds')} ${pc.dim(`— ${wiki.slug} · ${r.scanned} groundable pages`)}\n\n`);
    const row = (label, n, hint) => {
      const count = n > 0 ? pc.yellow(String(n).padStart(3)) : pc.green('  0');
      process.stdout.write(`  ${count}  ${label}${n > 0 ? pc.dim(`  ${hint}`) : ''}\n`);
    };
    row('uncompiled sources (ingest)', r.uncompiled, 'tng-wiki sources --uncompiled');
    // Only wikis with an _inbox/ capture dir get the row — r.inbox is null elsewhere
    if (r.inbox !== null) row('inbox items pending triage (_inbox/)', r.inbox, 'file into wiki/ · deliverables/ · raw/');
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
    // Ritual meta-health: the loop itself can lapse while every marker reads
    // clean. Yellow only when both signals agree (stale log AND pending churn) -
    // an old log on an idle wiki, or churn mid-session, is normal.
    const rit = r.ritual;
    if (rit && (rit.last_log_days !== null || rit.git)) {
      const churn = rit.git ? rit.git.changed + rit.git.untracked : 0;
      const parts = [];
      if (rit.last_log_days !== null) {
        parts.push(`last log entry ${rit.last_log_days === 0 ? 'today' : `${rit.last_log_days}d ago`}`);
      }
      if (churn > 0) {
        parts.push(`uncommitted: ${rit.git.changed} changed + ${rit.git.untracked} untracked`);
      }
      if (parts.length > 0) {
        const lapsed = rit.last_log_days !== null && rit.last_log_days >= 14 && churn > 0;
        const line = `  Ritual: ${parts.join(' · ')}`;
        process.stdout.write(`\n${lapsed ? pc.yellow(line) : pc.dim(line)}\n`);
      }
    }
    const total = r.uncompiled + (r.inbox ?? 0) + r.ground + r.convention + r.orphans + r.unsourced + r.unverified + r.stale + r.drift;
    process.stdout.write('\n');
    process.stdout.write(total === 0
      ? `${pc.green('✓ Clean')} ${pc.dim('— nothing to do this round.')}\n`
      : `${pc.dim('Rounds = ingest pending → ground / orphans / unsourced / stale / drift → reconcile → update index.md + log.md → summarize.')}\n`);
  });
}

function runMarkerVerb(verb, args, lister) {
  rejectSurplus(verb, args);
  const wiki = wikiFromArgs(args);
  const pages = lister(wiki.path);
  maybeJson(args, { wiki: wiki.slug, pages }, () => {
    for (const p of pages) {
      const tag = p.count === 1 ? '1 marker' : `${p.count} markers`;
      process.stdout.write(`${p.path}  ${pc.dim(`(${tag})`)}\n`);
    }
  });
}

export const runDrift = (args) => runMarkerVerb('drift', args, listDriftPages);
export const runUnsourced = (args) => runMarkerVerb('unsourced', args, listUnsourcedPages);
export const runUnverified = (args) => runMarkerVerb('unverified', args, listUnverifiedPages);
