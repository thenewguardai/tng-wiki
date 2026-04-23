import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, relative, resolve } from 'path';

function loadCodeAuthorities(wikiPath) {
  const metaPath = join(wikiPath, '.tng-wiki.json');
  if (!existsSync(metaPath)) return [];
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    return Array.isArray(meta.code_authorities) ? meta.code_authorities : [];
  } catch {
    return [];
  }
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

export function splitFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: '', body: content, bodyStartLine: 1 };
  // consumed text includes the fences + inner + trailing \n; count its newlines
  // to get the 1-indexed line where the body starts in the original file.
  const bodyStartLine = match[0].split('\n').length;
  return {
    frontmatter: match[1],
    body: content.slice(match[0].length),
    bodyStartLine,
  };
}

export function extractSources(frontmatter) {
  const lines = frontmatter.split('\n');
  const idx = lines.findIndex((l) => /^sources:/.test(l));
  if (idx === -1) return null;
  const line = lines[idx];

  // inline array form: `sources: [a, b]` or `sources: []`
  const inline = line.match(/^sources:\s*\[(.*)\]/);
  if (inline) {
    return inline[1].trim()
      ? inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      : [];
  }

  // scalar form: legacy `sources: 3` (count) — treat as empty, it's a migration target
  const scalar = line.replace(/^sources:\s*/, '').replace(/#.*$/, '').trim();
  if (scalar && !scalar.startsWith('[')) {
    if (/^\d+$/.test(scalar)) return [];
    return [scalar.replace(/^["']|["']$/g, '')];
  }

  // block list form (with or without trailing comment on the key line)
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s+-\s+(.+?)\s*(?:#.*)?$/);
    if (!m) break;
    out.push(m[1].replace(/^["']|["']$/g, ''));
  }
  return out;
}

export function extractCitations(body, bodyStartLine = 1) {
  const hits = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = i + bodyStartLine;
    for (const m of lines[i].matchAll(/\[\^(raw\/[^\]]+)\]/g)) {
      hits.push({ kind: 'raw', path: m[1], line });
    }
    // Code citations: [^code:<authority>/<file-path>[#L<start>[-L<end>]]]
    // The GitHub-style #L anchor is optional; when absent, the cite points at a whole file.
    for (const m of lines[i].matchAll(/\[\^code:([^\/\]]+)(?:\/([^\]#]+))?(?:#L(\d+)(?:-L(\d+))?)?\]/g)) {
      const [, authority, file, lStart, lEnd] = m;
      const hit = {
        kind: 'code',
        path: `code:${authority}`,   // matches the frontmatter `sources:` key
        authority,
        file: file || null,
        line,
      };
      if (lStart) hit.range = { start: Number(lStart), end: lEnd ? Number(lEnd) : Number(lStart) };
      hits.push(hit);
    }
  }
  return hits;
}

function extractUpdated(frontmatter) {
  const m = frontmatter.match(/^updated:\s*([^\s#]+)/m);
  if (!m) return null;
  const parsed = new Date(m[1]);
  return isNaN(parsed.getTime()) ? null : parsed;
}

const STRUCTURAL_BASENAMES = new Set(['index.md', 'log.md']);

export function isGroundable(relPath) {
  const basename = relPath.split('/').pop();
  if (STRUCTURAL_BASENAMES.has(basename)) return false;
  // leading-underscore convention: template/meta files users shouldn't index
  if (basename.startsWith('_')) return false;
  // wiki/meta/* holds wiki health artifacts (coverage maps, source quality rubrics),
  // not factual claims — exclude the whole directory
  if (relPath.startsWith('wiki/meta/')) return false;
  return true;
}

export function checkGrounding(wikiPath, { page } = {}) {
  const wikiDir = join(wikiPath, 'wiki');
  const allFiles = walkMd(wikiDir);
  const targets = page
    ? [join(wikiPath, page.startsWith('wiki/') ? page : `wiki/${page}`)]
    : allFiles.filter((f) => isGroundable(relative(wikiPath, f)));

  const codeAuthorities = loadCodeAuthorities(wikiPath);
  const authorityByName = new Map(codeAuthorities.map((a) => [a.name, a]));

  const issues = [];

  for (const file of targets) {
    const rel = relative(wikiPath, file);

    if (!existsSync(file)) {
      issues.push({ page: rel, issue: 'page_not_found' });
      continue;
    }

    const content = readFileSync(file, 'utf8');
    const { frontmatter, body, bodyStartLine } = splitFrontmatter(content);
    const declared = extractSources(frontmatter);
    const cited = extractCitations(body, bodyStartLine);

    if (declared === null || declared.length === 0) {
      issues.push({ page: rel, issue: 'empty_sources' });
    }

    const citedRaw = cited.filter((c) => c.kind === 'raw');
    const citedCode = cited.filter((c) => c.kind === 'code');

    const declaredRaw = (declared || []).filter((d) => !d.startsWith('code:'));
    const declaredCode = (declared || []).filter((d) => d.startsWith('code:'));

    // missing raw files (union of declared + cited)
    const allRawPaths = new Set([...declaredRaw, ...citedRaw.map((c) => c.path)]);
    for (const refPath of allRawPaths) {
      if (!existsSync(join(wikiPath, refPath))) {
        const citedHere = citedRaw.filter((c) => c.path === refPath);
        if (citedHere.length > 0) {
          for (const c of citedHere) {
            issues.push({ page: rel, issue: 'missing_raw', raw: refPath, line: c.line });
          }
        } else {
          issues.push({ page: rel, issue: 'missing_raw', raw: refPath });
        }
      }
    }

    // undeclared inline citations (cited inline, not in frontmatter `sources:`)
    // Applies uniformly to raw and code cites — both must be declared in frontmatter.
    if (declared !== null) {
      const declaredSet = new Set(declared);
      const seen = new Set();
      for (const c of cited) {
        if (!declaredSet.has(c.path) && !seen.has(c.path)) {
          seen.add(c.path);
          issues.push({ page: rel, issue: 'undeclared_cite', raw: c.path, line: c.line });
        }
      }
    }

    // orphan declarations (in frontmatter, never cited inline)
    if (declared !== null) {
      const citedSet = new Set(cited.map((c) => c.path));
      for (const d of declared) {
        if (!citedSet.has(d)) {
          issues.push({ page: rel, issue: 'orphan_source_decl', raw: d });
        }
      }
    }

    // unknown code authority (frontmatter declares `code:<name>` not in .tng-wiki.json)
    for (const d of declaredCode) {
      const name = d.slice('code:'.length);
      if (!authorityByName.has(name)) {
        issues.push({ page: rel, issue: 'unknown_code_authority', authority: name });
      }
    }

    // missing code file (inline `[^code:<name>/<path>...]` resolves to nothing on disk)
    for (const c of citedCode) {
      if (!c.file) continue;  // whole-authority reference — no file to check
      const authority = authorityByName.get(c.authority);
      if (!authority) continue;  // unknown authority already flagged above
      const abs = resolve(wikiPath, authority.path, c.file);
      if (!existsSync(abs)) {
        issues.push({
          page: rel,
          issue: 'missing_code_file',
          authority: c.authority,
          file: c.file,
          line: c.line,
        });
      }
    }

    // page updated before raw source mtime
    const updated = extractUpdated(frontmatter);
    if (declared && updated) {
      for (const d of declaredRaw) {
        const abs = join(wikiPath, d);
        if (existsSync(abs)) {
          const mtime = statSync(abs).mtime;
          if (mtime.getTime() > updated.getTime()) {
            issues.push({
              page: rel,
              issue: 'source_updated_after_page',
              raw: d,
              page_updated: updated.toISOString().slice(0, 10),
              source_mtime: mtime.toISOString().slice(0, 10),
            });
          }
        }
      }
    }
  }

  return { scanned: targets.length, issues };
}

// ---- Pattern-matching lint verbs (for Phase 1C) ----

export function listDriftPages(wikiPath) {
  return scanMarker(wikiPath, /⚠️ DRIFT\?/g);
}

export function listUnsourcedPages(wikiPath) {
  return scanMarker(wikiPath, /⚠️ UNSOURCED\?/g);
}

export function listUnverifiedPages(wikiPath) {
  return scanMarker(wikiPath, /⚠️ UNVERIFIED\?/g);
}

function scanMarker(wikiPath, pattern) {
  const wikiDir = join(wikiPath, 'wiki');
  const results = [];
  for (const file of walkMd(wikiDir)) {
    const content = readFileSync(file, 'utf8');
    const matches = content.match(pattern);
    if (matches) {
      results.push({ path: relative(wikiPath, file), count: matches.length });
    }
  }
  return results;
}
