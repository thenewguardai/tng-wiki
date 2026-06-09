import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { loadRegistry, getDefault, getWiki } from './registry.js';
import { isGroundable, checkGrounding, listDriftPages, listUnsourcedPages, listUnverifiedPages, loadLeadArchives } from './ground.js';

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

export function readPage(wikiPath, relPath) {
  const wikiDir = join(wikiPath, 'wiki');
  const target = resolve(wikiDir, relPath);
  // prevent ../ escape
  if (!target.startsWith(resolve(wikiDir) + sep) && target !== resolve(wikiDir)) {
    throw new Error(`Page path "${relPath}" escapes the wiki directory`);
  }
  if (!existsSync(target)) throw new Error(`Page not found: ${relPath}`);
  return readFileSync(target, 'utf8');
}

function walkMd(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMd(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
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
    for (const a of loadLeadArchives(wikiPath)) {
      const root = resolve(wikiPath, a.path);
      scan(root, 'lead', { base: root, extra: { archive: a.name } });
    }
  }

  return hits;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out = {};
  for (const raw of match[1].split('\n')) {
    const m = raw.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    const cleaned = value.trim().replace(/^["'](.*)["']$/, '$1');
    out[key] = cleaned === 'true' ? true
      : cleaned === 'false' ? false
      : cleaned;
  }
  return out;
}

export function listSources(wikiPath, { uncompiledOnly = false } = {}) {
  const rawDir = join(wikiPath, 'raw');
  const results = [];
  for (const file of walkMd(rawDir)) {
    const content = readFileSync(file, 'utf8');
    const fm = parseFrontmatter(content);
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

export function listOrphanPages(wikiPath) {
  const wikiDir = join(wikiPath, 'wiki');
  const files = walkMd(wikiDir);

  // Build a name-index of every page (stem of the filename)
  const pageByStem = new Map();
  for (const file of files) {
    const rel = relative(wikiPath, file);
    const stem = file.split('/').pop().replace(/\.md$/, '');
    pageByStem.set(stem.toLowerCase(), rel);
  }

  // Count inbound [[wikilinks]] per page
  const inbound = new Map();
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const m of content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
      const target = m[1].trim().toLowerCase();
      if (pageByStem.has(target)) {
        const rel = pageByStem.get(target);
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

// "Rounds" maintenance dashboard — zero-LLM counts the named bundle anchors on:
// pending ingest + structural lint surfaces. Gives `tng-wiki rounds` (and cron/
// scripts) a single number per category and the agent something to drive.
export function roundsReport(wikiPath) {
  const ground = checkGrounding(wikiPath);
  return {
    scanned: ground.scanned,
    uncompiled: listSources(wikiPath, { uncompiledOnly: true }).length,
    // warn-level findings (missing_lead / unknown_lead_archive) are informational
    // — they never count as ground issues in the rounds dashboard
    ground: ground.issues.filter((i) => i.level !== 'warn').length,
    orphans: listOrphanPages(wikiPath).length,
    unsourced: listUnsourcedPages(wikiPath).length,
    unverified: listUnverifiedPages(wikiPath).length,
    stale: listStalePages(wikiPath).length,
    drift: listDriftPages(wikiPath).length,
  };
}
