import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, relative, resolve } from 'path';
import { matchesAnyGlob } from './glob.js';
import { resolveConfigPath, pathForm, describePathValue } from './paths.js';
import { refResolves, fileExistsAtRef, readFileAtRef, fileCommitDateAtRef, fileCommitDate } from './git-read.js';

// Lines in a blob, ignoring a single trailing newline so a file with N lines
// (with or without a final \n) counts as N — keeps the last-line range check honest.
function countLines(content) {
  if (content === '') return 0;
  const n = content.split('\n').length;
  return content.endsWith('\n') ? n - 1 : n;
}

function readFileSafe(absPath) {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

export function loadCodeAuthorities(wikiPath) {
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

export function checkGrounding(wikiPath, { page, atRef = false } = {}) {
  const wikiDir = join(wikiPath, 'wiki');
  const allFiles = walkMd(wikiDir);
  const targets = page
    ? [join(wikiPath, page.startsWith('wiki/') ? page : `wiki/${page}`)]
    : allFiles.filter((f) => isGroundable(relative(wikiPath, f)));

  const codeAuthorities = loadCodeAuthorities(wikiPath);

  // Fail loudly on malformed config before any per-page work: a missing or
  // non-string authority path would otherwise resolve against the wiki root
  // and silently ground citations against the wiki itself. The CLI's top-level
  // catch renders this as a one-line error, not a stack trace.
  for (const a of codeAuthorities) {
    if (pathForm(a.path) === 'invalid') {
      throw new Error(
        `code authority "${a.name ?? '(unnamed)'}" has a malformed path in .tng-wiki.json `
        + `(${describePathValue(a.path)}) — expected a non-empty string. Fix it and re-run.`,
      );
    }
  }

  const authorityByName = new Map(codeAuthorities.map((a) => [a.name, a]));

  // Under --at-ref, resolve each ref'd authority's ref ONCE (the repo+ref pair is
  // page-independent). true -> read at ref; false -> code_ref_unresolvable.
  // Authorities without a ref, or any authority when !atRef, are absent here and
  // fall through to the working tree — the default Layer-1 behavior is untouched.
  const refResolvable = new Map();
  if (atRef) {
    for (const a of codeAuthorities) {
      if (!a.ref) continue;
      refResolvable.set(a.name, refResolves(resolveConfigPath(wikiPath, a.path), a.ref));
    }
  }

  const issues = [];

  // Foot-gun guard: on a plain (non --at-ref) run, a ref'd authority is still
  // checked against its WORKING TREE — the pin only applies under --at-ref.
  // Collect one warning per such authority, but only when a code: cite actually
  // reached it this run (a ref'd authority that nothing cites stays silent).
  const warnings = [];
  const warnedRefAuthorities = new Set();

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

    // page `updated` date — shared by the code and raw staleness checks below
    const updated = extractUpdated(frontmatter);

    // code authorities: per-cite exclude / existence / line-range / staleness.
    // Precedence matters: an excluded or missing cite short-circuits the rest so we
    // never count lines or commit dates for a file we shouldn't have cited or can't read.
    const refFlaggedThisPage = new Set();
    for (const c of citedCode) {
      if (!c.file) continue;  // whole-authority reference — no file to check
      const authority = authorityByName.get(c.authority);
      if (!authority) continue;  // unknown authority already flagged above

      // 1. exclude — a cite to an excluded path is wrong even if the file exists.
      if (matchesAnyGlob(c.file, authority.exclude)) {
        issues.push({ page: rel, issue: 'excluded_code_file', authority: c.authority, file: c.file, line: c.line });
        continue;
      }

      const repoAbs = resolveConfigPath(wikiPath, authority.path);
      const useRef = atRef && Boolean(authority.ref);

      // Working-tree consultation of a ref'd authority — warn once per authority
      // per run. Not an issue: exit code and findings stay unchanged.
      if (!atRef && authority.ref && !warnedRefAuthorities.has(authority.name)) {
        warnedRefAuthorities.add(authority.name);
        warnings.push({ code: 'working_tree_of_ref_authority', authority: authority.name, ref: authority.ref });
      }

      // 2. unresolvable ref — flag once per authority per page, then skip its cites.
      if (useRef && refResolvable.get(authority.name) === false) {
        if (!refFlaggedThisPage.has(authority.name)) {
          refFlaggedThisPage.add(authority.name);
          issues.push({ page: rel, issue: 'code_ref_unresolvable', authority: c.authority, ref: authority.ref });
        }
        continue;
      }

      // 3. existence (at the pinned ref under --at-ref, else the working tree).
      const exists = useRef
        ? fileExistsAtRef(repoAbs, authority.ref, c.file)
        : existsSync(resolve(repoAbs, c.file));
      if (!exists) {
        const issue = { page: rel, issue: 'missing_code_file', authority: c.authority, file: c.file, line: c.line };
        if (useRef) issue.ref = authority.ref;
        issues.push(issue);
        continue;
      }

      // 4. cited line range within the file's bounds.
      if (c.range) {
        const content = useRef
          ? readFileAtRef(repoAbs, authority.ref, c.file)
          : readFileSafe(resolve(repoAbs, c.file));
        const lineCount = content == null ? null : countLines(content);
        if (lineCount != null && (c.range.start > c.range.end || c.range.end > lineCount)) {
          const issue = {
            page: rel, issue: 'code_line_out_of_range',
            authority: c.authority, file: c.file, line: c.line,
            range: `L${c.range.start}-L${c.range.end}`, line_count: lineCount,
          };
          if (useRef) issue.ref = authority.ref;
          issues.push(issue);
        }
      }

      // 5. staleness (ref-only): page `updated` predates the file's last commit at ref.
      if (useRef && updated) {
        const commitDate = fileCommitDateAtRef(repoAbs, authority.ref, c.file);
        if (commitDate && commitDate.getTime() > updated.getTime()) {
          issues.push({
            page: rel, issue: 'code_updated_after_page',
            authority: c.authority, file: c.file, ref: authority.ref,
            page_updated: updated.toISOString().slice(0, 10),
            source_commit: commitDate.toISOString().slice(0, 10),
          });
        }
      }
    }

    // raw sources: page `updated` older than a cited raw source's last change.
    // Prefer the git commit-date (stable across clones — `git checkout` resets
    // filesystem mtimes, which would make every page look stale after a sync) and
    // fall back to mtime when the wiki is not a git repo or the file is untracked.
    // Compare at DATE granularity: `updated` is a date, so a same-day source edit
    // is not "stale".
    if (declared && updated) {
      const updatedDate = updated.toISOString().slice(0, 10);
      for (const d of declaredRaw) {
        const abs = join(wikiPath, d);
        if (!existsSync(abs)) continue;
        const sourceTime = fileCommitDate(wikiPath, d) ?? statSync(abs).mtime;
        const sourceDate = sourceTime.toISOString().slice(0, 10);
        if (sourceDate > updatedDate) {
          issues.push({
            page: rel,
            issue: 'source_updated_after_page',
            raw: d,
            page_updated: updatedDate,
            source_mtime: sourceDate,
          });
        }
      }
    }
  }

  return { scanned: targets.length, issues, warnings };
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
    const rel = relative(wikiPath, file);
    // Skip non-groundable files (index/log, _-prefixed templates, wiki/meta/*) so
    // a fresh scaffold's own example markers don't show up as real lint findings.
    if (!isGroundable(rel)) continue;
    const matches = readFileSync(file, 'utf8').match(pattern);
    if (matches) results.push({ path: rel, count: matches.length });
  }
  return results;
}
