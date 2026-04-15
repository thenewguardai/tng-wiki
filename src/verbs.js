import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import { loadRegistry, getDefault, getWiki } from './registry.js';

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

export function searchWiki(wikiPath, query, { regex = false } = {}) {
  if (!query) return [];
  const pattern = regex
    ? new RegExp(query, 'i')
    : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const wikiDir = join(wikiPath, 'wiki');
  const hits = [];
  for (const file of walkMd(wikiDir)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (pattern.test(line)) {
        hits.push({
          path: relative(wikiPath, file),
          line: i + 1,
          text: line.trim(),
        });
      }
    });
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
    const content = readFileSync(file, 'utf8');
    const matches = content.match(/⚠️ STALE\?/g);
    if (matches) {
      results.push({
        path: relative(wikiPath, file),
        count: matches.length,
      });
    }
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

  // Orphans: pages with zero inbound links, excluding structural pages
  const STRUCTURAL = new Set(['wiki/index.md', 'wiki/log.md']);
  return files
    .map(f => relative(wikiPath, f))
    .filter(rel => !STRUCTURAL.has(rel) && !inbound.has(rel))
    .map(path => ({ path }));
}
