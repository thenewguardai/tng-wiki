import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { basename, join, relative, resolve, sep } from 'path';
import { loadRegistry, getDefault, getWiki } from './registry.js';
import { insideRoot, walkMd } from './paths.js';
import { isGroundable, checkGrounding, WARN_ISSUES, listDriftPages, listUnsourcedPages, listUnverifiedPages, loadLeadArchives } from './ground.js';
import { workingTreeCounts } from './git-read.js';
import { splitFrontmatter, parseScalars } from './frontmatter.js';

export function resolveWiki(slug, home) {
  const registry = loadRegistry(home);
  if (slug) {
    const wiki = getWiki(registry, slug);
    if (!wiki) throw new Error(`No wiki registered under slug "${slug}". Run \`tng-wiki list\` to see registered wikis.`);
    return wiki;
  }
  const def = getDefault(registry);
  if (!def) throw new Error('No default wiki registered. Pass --wiki <slug> or run `tng-wiki register` / `tng-wiki init` first.');
  return def;
}

export function queryIndex(wikiPath) {
  const indexPath = join(wikiPath, 'wiki', 'index.md');
  if (!existsSync(indexPath)) throw new Error(`Missing wiki/index.md in ${wikiPath}`);
  return readFileSync(indexPath, 'utf8');
}

// Normalize a page reference to a path relative to wiki/. Accepts, in order:
//   1. the exact path relative to wiki/ (fast path);
//   2. the same with `.md` appended;
//   3. the input minus a leading `wiki/` prefix (then forms 1–2);
//   4. a unique page-stem match (the lowercase stem map listOrphanPages uses),
//      with `[[…]]` wikilink wrapping stripped.
// Zero matches → error listing the forms tried; multiple stem matches → error
// listing the candidates. The `../` escape guard applies after normalization.
// Windows-style `\` separators are folded to `/` up front so prefix-stripping,
// bare-input detection, and the escape guard all see one canonical form.
export function resolvePagePath(wikiPath, input) {
  const wikiDir = resolve(join(wikiPath, 'wiki'));
  let cleaned = String(input).trim();
  const wikilink = cleaned.match(/^\[\[([^\]]+)\]\]$/);
  if (wikilink) cleaned = wikilink[1].split(/[|#]/)[0].trim();
  cleaned = cleaned.replace(/\\/g, '/');

  const forms = [];
  const addForm = (f) => {
    if (!f) return;
    if (!forms.includes(f)) forms.push(f);
    if (!f.endsWith('.md') && !forms.includes(f + '.md')) forms.push(f + '.md');
  };
  addForm(cleaned);
  if (cleaned.startsWith('wiki/')) addForm(cleaned.slice('wiki/'.length));

  // prevent ../ escape — applied to every normalized form
  const guard = (form) => {
    const target = resolve(wikiDir, form);
    if (!insideRoot(wikiDir, target)) {
      throw new Error(`Page path "${input}" escapes the wiki directory`);
    }
    return target;
  };

  for (const form of forms) {
    const target = guard(form);
    if (existsSync(target) && statSync(target).isFile()) return form;
  }

  // Stem lookup only for bare names — a pathed input matching a same-named
  // page in a *different* directory would be a silent misresolution.
  const stem = cleaned.replace(/\.md$/i, '').toLowerCase();
  if (!stem.includes('/')) {
    const matches = pageStemMap(wikiPath).get(stem) ?? [];
    if (matches.length > 1) {
      throw new Error(`Ambiguous page "${input}" — matches: ${matches.join(', ')}. Pass a fuller path.`);
    }
    if (matches.length === 1) {
      // pageStemMap paths come from path.relative, so fold OS separators too
      const form = matches[0].replace(/\\/g, '/').replace(/^wiki\//, '');
      guard(form);
      return form;
    }
    throw new Error(`Page not found: ${input} (tried: ${forms.join(', ')}; no page stem matches "${stem}")`);
  }
  throw new Error(`Page not found: ${input} (tried: ${forms.join(', ')})`);
}

export function readPage(wikiPath, relPath) {
  const form = resolvePagePath(wikiPath, relPath);
  return readFileSync(resolve(join(wikiPath, 'wiki'), form), 'utf8');
}

export function searchWiki(wikiPath, query, { regex = false, includeRaw = false, includeLeads = false } = {}) {
  if (!query) return [];
  const pattern = regex
    ? new RegExp(query, 'i')
    : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const hits = [];
  const scan = (dir, source, { base = wikiPath, extra = {} } = {}) => {
    for (const file of walkMd(dir)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (pattern.test(line)) {
          hits.push({
            source,
            ...extra,
            path: relative(base, file),
            line: i + 1,
            text: line.trim(),
          });
        }
      });
    }
  };

  scan(join(wikiPath, 'wiki'), 'wiki');
  if (includeRaw) scan(join(wikiPath, 'raw'), 'raw');
  if (includeLeads) {
    // Registered lead archives (.tng-wiki.json lead_archives) — external,
    // untrusted doc trees. Hit paths are relative to the archive root so they
    // match the `leads:` frontmatter form `<archive>:<relative-path>`.
    // Independent of includeRaw; both may be on at once.
    // Archives are fallible external inputs: a root that exists but is not a
    // directory (ENOTDIR) or is unreadable (EACCES) degrades to "missing" and
    // is skipped, rather than crashing the whole search. The wiki's own tree
    // (scanned above) keeps strict behavior.
    for (const a of loadLeadArchives(wikiPath)) {
      const root = resolve(wikiPath, a.path);
      try {
        scan(root, 'lead', { base: root, extra: { archive: a.name } });
      } catch (err) {
        if (!err?.code) throw err; // only swallow filesystem-level failures
      }
    }
  }

  return hits;
}

export function listSources(wikiPath, { uncompiledOnly = false } = {}) {
  const rawDir = join(wikiPath, 'raw');
  const results = [];
  for (const file of walkMd(rawDir)) {
    const content = readFileSync(file, 'utf8');
    const fm = parseScalars(splitFrontmatter(content).frontmatter);
    const compiled = fm.compiled === true;
    if (uncompiledOnly && compiled) continue;
    results.push({
      path: relative(wikiPath, file),
      compiled,
      title: fm.title ?? null,
      type: fm.type ?? null,
    });
  }
  return results;
}

export function listStalePages(wikiPath) {
  const wikiDir = join(wikiPath, 'wiki');
  const results = [];
  for (const file of walkMd(wikiDir)) {
    const rel = relative(wikiPath, file);
    if (!isGroundable(rel)) continue; // skip templates/meta example markers (cf. scanMarker)
    const matches = readFileSync(file, 'utf8').match(/⚠️ STALE\?/g);
    if (matches) results.push({ path: rel, count: matches.length });
  }
  return results;
}

// Lowercase filename-stem → wiki-relative paths (e.g. "acme" → ["wiki/entities/acme.md"]).
// Shared by listOrphanPages (inbound wikilink resolution) and resolvePagePath
// (bare-stem / [[wikilink]] page lookup).
export function pageStemMap(wikiPath) {
  const map = new Map();
  for (const file of walkMd(join(wikiPath, 'wiki'))) {
    const rel = relative(wikiPath, file);
    const stem = file.split(sep).pop().replace(/\.md$/, '').toLowerCase();
    if (!map.has(stem)) map.set(stem, []);
    map.get(stem).push(rel);
  }
  return map;
}

export function listOrphanPages(wikiPath) {
  const wikiDir = join(wikiPath, 'wiki');
  const files = walkMd(wikiDir);
  const pageByStem = pageStemMap(wikiPath);

  // Count inbound [[wikilinks]] per page; an ambiguous stem credits every candidate
  const inbound = new Map();
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const m of content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
      const target = m[1].trim().toLowerCase();
      for (const rel of pageByStem.get(target) ?? []) {
        inbound.set(rel, (inbound.get(rel) ?? 0) + 1);
      }
    }
  }

  // Orphans: groundable pages with zero inbound links. Reuse ground's
  // exemptions (index.md, log.md, _-prefixed templates, wiki/meta/*) so a fresh
  // scaffold's own seed/template files aren't reported as orphans.
  return files
    .map(f => relative(wikiPath, f))
    .filter(rel => isGroundable(rel) && !inbound.has(rel))
    .map(path => ({ path }));
}

// _inbox/ is the cheap capture path on librarian-style wikis (code-archaeology,
// or any wiki that adopts the pattern): any session may drop a file there; a
// later librarian session triages it into wiki/ / deliverables/ / raw/. Pending
// items are work exactly like uncompiled raw/ sources, but they are not
// markdown-only and carry no frontmatter, so they get their own counter instead
// of flowing through listSources. Returns null when the wiki has no _inbox/ at
// all — callers distinguish "this wiki doesn't use an inbox" from "inbox empty".
// Dotfiles (.gitkeep) are ignored.
export function listInboxItems(wikiPath) {
  const inboxDir = join(wikiPath, '_inbox');
  if (!existsSync(inboxDir)) return null;
  const items = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) items.push({ path: relative(wikiPath, full) });
    }
  };
  walk(inboxDir);
  return items;
}

// Rejection logs — NOTES deliverables produced by verification-first campaigns
// (every rejected/corrected/downgraded lead claim with its disposition). They
// live under deliverables/ and match `*_NOTES_*.md`. A verification-first wiki
// shows ~zero markers by construction, so these files are its audit surface.
export function listRejectionNotes(wikiPath) {
  return walkMd(join(wikiPath, 'deliverables'))
    .filter(f => /_NOTES_/.test(basename(f)))
    .map(f => ({ path: relative(wikiPath, f) }));
}

// Ritual meta-health - the maintenance loop itself can lapse invisibly: every
// marker reads clean while log.md stalls and edits pile up uncommitted (the
// dogfood wiki went four weeks like this before anything surfaced it). Two
// zero-LLM signals: the date of the last log.md operation, and the wiki repo's
// own working-tree churn. Informational only - never changes exit codes.
export function ritualReport(wikiPath) {
  let lastLogDate = null;
  let lastLogDays = null;
  const logPath = join(wikiPath, 'wiki', 'log.md');
  if (existsSync(logPath)) {
    const ops = [...readFileSync(logPath, 'utf8').matchAll(/^## \[([^\]]+)\]/gm)];
    const last = ops.at(-1);
    if (last) {
      lastLogDate = last[1];
      const d = new Date(last[1]);
      if (!isNaN(d.getTime())) {
        lastLogDays = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
      }
    }
  }
  return {
    last_log_date: lastLogDate,
    last_log_days: lastLogDays,
    // { changed, untracked } for the wiki's own repo, or null when not git-tracked
    git: workingTreeCounts(wikiPath),
  };
}

// "Rounds" maintenance dashboard — zero-LLM counts the named bundle anchors on:
// pending ingest + structural lint surfaces. Gives `tng-wiki rounds` (and cron/
// scripts) a single number per category and the agent something to drive.
export function roundsReport(wikiPath) {
  const ground = checkGrounding(wikiPath);
  // Warn-level ground findings (frontmatter_updated_stale, prose_internal_ref)
  // are hygiene/convention signals, not attribution breaks — they get their own
  // bucket so `ground` stays the hard-failure count.
  const convention = ground.issues.filter((i) => WARN_ISSUES.has(i.issue) || i.level === 'warn').length;
  const inboxItems = listInboxItems(wikiPath);
  return {
    scanned: ground.scanned,
    uncompiled: listSources(wikiPath, { uncompiledOnly: true }).length,
    // null = wiki has no _inbox/ capture dir (most domains); a number = pending triage
    inbox: inboxItems === null ? null : inboxItems.length,
    ground: ground.issues.length - convention,
    convention,
    orphans: listOrphanPages(wikiPath).length,
    unsourced: listUnsourcedPages(wikiPath).length,
    unverified: listUnverifiedPages(wikiPath).length,
    stale: listStalePages(wikiPath).length,
    drift: listDriftPages(wikiPath).length,
    // informational, not a to-do count — audit artifact of verification-first flows
    rejection_notes: listRejectionNotes(wikiPath).length,
    // informational meta-health of the maintenance loop itself (log age, git churn)
    ritual: ritualReport(wikiPath),
  };
}
