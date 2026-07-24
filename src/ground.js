import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, relative, resolve, dirname } from 'path';
import { matchesAnyGlob } from './glob.js';
import { resolveConfigPath, pathForm, describePathValue, insideRoot, walkMd } from './paths.js';
import {
  refResolves, fileExistsAtRef, readFileAtRef, fileCommitDateAtRef, fileCommitDate,
  filesAtHead, newestCommitDate, resolveRefSha, repoIsDirty,
} from './git-read.js';
import {
  readLock, writeLock, normalizeLines, hashLines, citeKey, rangeAnchor, rangeLabel,
  sliceRange, findContentMatches,
} from './lock.js';
import { splitFrontmatter, extractListKey } from './frontmatter.js';

// Re-exported for existing importers (cite.js, tests) - the implementation
// moved to the shared frontmatter module.
export { splitFrontmatter } from './frontmatter.js';

// Warn-level findings: hygiene/convention signals, not attribution breaks.
// Renderers color them differently and `rounds` counts them under `convention`;
// they never change exit codes.
export const WARN_ISSUES = new Set(['frontmatter_updated_stale', 'prose_internal_ref']);

// The page-count formula the index header is lint-checked against. Stated in the
// `index_header_drift` finding so the maintaining agent fixes the header to the
// same definition the lint uses.
const PAGE_COUNT_FORMULA = 'all wiki/**/*.md except index.md, log.md, and _-prefixed files';

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

function loadWikiMeta(wikiPath) {
  const metaPath = join(wikiPath, '.tng-wiki.json');
  if (!existsSync(metaPath)) return {};
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    return {};
  }
}

// Machine-local, gitignored companion to .tng-wiki.json. Written by
// `tng-wiki localize` when a wiki is handed to a teammate whose authority
// repos live at different paths (or who doesn't have them at all). Never
// committed - the shared manifest stays canonical for WHICH authorities exist;
// this only remaps a path or marks an authority trusted-remote on THIS machine.
// Shape: { code_authorities: { "<name>": { path? , trusted? } }, lead_archives: {...} }.
export function loadLocalOverrides(wikiPath) {
  const p = join(wikiPath, '.tng-wiki.local.json');
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

// Apply a config family's local overrides. `path` (non-empty string) remaps the
// resolved location for this machine; `trusted: true` marks the entry
// trusted-remote (accept the recorded verification as truth, skip local checks).
// Overrides only annotate entries that exist in the committed manifest -
// unknown names in the local file are ignored, so a stale local file can never
// invent an authority.
function applyOverrides(entries, overrideMap) {
  const ov = (overrideMap && typeof overrideMap === 'object') ? overrideMap : {};
  return entries.map((e) => {
    const o = ov[e.name];
    if (!o || typeof o !== 'object') return e;
    const next = { ...e };
    if (typeof o.path === 'string' && o.path.trim() !== '') {
      next.path = o.path;
      next.localPathOverride = true;
    }
    if (o.trusted === true) next.trusted = true;
    return next;
  });
}

export function loadCodeAuthorities(wikiPath) {
  const meta = loadWikiMeta(wikiPath);
  const list = Array.isArray(meta.code_authorities) ? meta.code_authorities : [];
  return applyOverrides(list, loadLocalOverrides(wikiPath).code_authorities);
}

// External, fallible doc archives ("leads, never sources"). Each entry:
// { name, path, description? } — path resolved relative to the wiki root,
// same as code_authorities.path. Local overrides can remap the path so a
// teammate points leads at their own copies (trusted is meaningless for leads -
// they are never citable regardless - so only `path` is honored).
export function loadLeadArchives(wikiPath) {
  const meta = loadWikiMeta(wikiPath);
  const list = Array.isArray(meta.lead_archives) ? meta.lead_archives : [];
  return applyOverrides(list, loadLocalOverrides(wikiPath).lead_archives);
}


export function extractSources(frontmatter) {
  return extractListKey(frontmatter, 'sources');
}

// `leads:` — structured provenance ("distilled from lead X"), explicitly NOT a
// source. Entries take the form `<archive-name>:<relative-path-within-archive>`.
// Exempt from every `sources:` invariant.
export function extractLeads(frontmatter) {
  return extractListKey(frontmatter, 'leads') ?? [];
}

// True when `changeTime` lands more than a day after the page's `updated` date,
// comparing UTC calendar dates with a +1-day grace. `updated:` is a local
// calendar date; a source committed in the evening west of UTC rolls to the
// next UTC day, so a bare `sourceDate > updatedDate` would flag genuinely
// same-day work as stale. The grace absorbs that. Shared by
// source_updated_after_page and frontmatter_updated_stale so the two staleness
// checks can't drift apart (they did: only the latter had the grace).
export function isStaleAfterGrace(updated, changeTime) {
  const graceCutoff = new Date(updated.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return changeTime.toISOString().slice(0, 10) > graceCutoff;
}

export function extractCitations(body, bodyStartLine = 1) {
  const hits = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = i + bodyStartLine;
    for (const m of lines[i].matchAll(/\[\^([^\]]+)\]/g)) {
      const token = m[1];
      if (token.startsWith('raw/')) {
        hits.push({ kind: 'raw', path: token, line });
        continue;
      }
      // Code citations: code:<authority>[/<file-path>][#L<start>[-L<end>]]
      // The GitHub-style #L anchor is optional; when absent, the cite points at a whole file.
      if (token.startsWith('code:')) {
        const cm = token.match(/^code:([^\/]+)(?:\/([^#]+))?(?:#L(\d+)(?:-L(\d+))?)?$/);
        if (cm) {
          const [, authority, file, lStart, lEnd] = cm;
          const hit = {
            kind: 'code',
            path: `code:${authority}`,   // matches the frontmatter `sources:` key
            authority,
            file: file || null,
            line,
          };
          if (lStart) hit.range = { start: Number(lStart), end: lEnd ? Number(lEnd) : Number(lStart) };
          hits.push(hit);
        } else {
          hits.push({ kind: 'unknown', path: token, line });
        }
        continue;
      }
      // Path-shaped tokens under any other root (`_inbox/`, a typo'd prefix, an
      // absolute path) are citation INTENT the engine cannot resolve. Surface
      // them as kind 'unknown' instead of skipping - an invisible cite made
      // orphan_source_decl report the opposite of what was on the page (#48).
      // Plain markdown footnotes ([^1], [^note]) have no slash and stay exempt.
      if (token.includes('/')) hits.push({ kind: 'unknown', path: token, line });
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

// Stem (filename minus .md, lowercased) → wiki-relative path for every wiki page.
// Single source of truth shared by `orphans` ([[wikilink]] resolution) and the
// `prose_internal_ref` lint (inline-code stem matching) — keep them in lockstep.
export function buildStemMap(files, wikiPath) {
  const pageByStem = new Map();
  for (const file of files) {
    const rel = relative(wikiPath, file);
    pageByStem.set(stemOf(rel).toLowerCase(), rel);
  }
  return pageByStem;
}

function stemOf(relPath) {
  return relPath.split('/').pop().replace(/\.md$/, '');
}

// raw/ and deliverables/ hold *files*, not pages — path references to them are
// correct as-is and never `prose_internal_ref` candidates.
const FILE_ARTIFACT_SEGMENTS = new Set(['raw', 'deliverables']);

function isFileArtifactPath(target) {
  return target.split('/').some((seg) => FILE_ARTIFACT_SEGMENTS.has(seg));
}

// Lint the wikilink convention: internal pages referenced in prose — either as
// inline-code tokens (`page.md`, Pattern A) or as markdown links to relative .md
// paths resolving to wiki pages (Pattern B) — instead of [[wikilinks]]. Fenced
// code blocks are skipped; citation markers ([^raw/...] / [^code:...]) match
// neither pattern by construction.
function findProseInternalRefs({ pageRel, pageAbs, body, bodyStartLine, stemByPage, wikiFiles, wikiPath }) {
  const out = [];
  const push = (line, matched, targetRel) => out.push({
    page: pageRel, issue: 'prose_internal_ref', line, matched, suggest: `[[${stemOf(targetRel)}]]`,
  });

  const lines = body.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (/^\s{0,3}(```|~~~)/.test(text)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const lineNo = i + bodyStartLine;

    // Pattern A: `<stem>.md` inline-code tokens matching a known page stem
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const token = m[1].trim();
      if (!/^\S+\.md$/.test(token) || isFileArtifactPath(token)) continue;
      const targetRel = stemByPage.get(stemOf(token).toLowerCase());
      if (targetRel && targetRel !== pageRel) push(lineNo, m[0], targetRel);
    }

    // Pattern B: markdown links whose target is a relative .md path resolving to
    // a wiki page (strip inline code first so `[x](y.md)` examples stay silent)
    const noInlineCode = text.replace(/`[^`]*`/g, '');
    for (const m of noInlineCode.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[2].split('#')[0];
      if (!target.endsWith('.md')) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue; // URL or absolute path
      if (isFileArtifactPath(target)) continue;
      const resolved = [resolve(dirname(pageAbs), target), resolve(wikiPath, target)]
        .find((abs) => wikiFiles.has(abs));
      if (!resolved) continue;
      const targetRel = relative(wikiPath, resolved);
      if (targetRel !== pageRel) push(lineNo, m[0], targetRel);
    }
  }
  return out;
}

// Parse the scaffold header line of wiki/index.md and compare its page count and
// date against reality. Header absent or customized → null (don't impose the
// scaffold header on customized indexes). The date only drifts when the header is
// *behind* the newest page — an index legitimately bumped after the last page
// edit is not rot.
function checkIndexHeader(wikiPath, allFiles) {
  const indexAbs = join(wikiPath, 'wiki', 'index.md');
  const content = readFileSafe(indexAbs);
  if (content == null) return null;
  const header = content.match(/^_Last updated:\s*(\d{4}-\d{2}-\d{2})\s*\|\s*Total pages:\s*(\d+)/m);
  if (!header) return null;

  const [, headerDate, headerPagesRaw] = header;
  const headerPages = Number(headerPagesRaw);

  // Page count = isGroundable() pages PLUS wiki/meta/* content pages (real pages,
  // just grounding-exempt) — i.e. PAGE_COUNT_FORMULA.
  const countable = allFiles.filter((f) => {
    const basename = relative(wikiPath, f).split('/').pop();
    return !STRUCTURAL_BASENAMES.has(basename) && !basename.startsWith('_');
  });

  // Newest page date = max over countable files of (git last-commit date for
  // committed files, mtime otherwise) — same reduction as a per-file
  // `fileCommitDate(f) ?? mtime`, but with TWO git processes (ls-tree + a batched
  // `git log -1`) instead of one per page. Uncommitted pages, or every page when
  // the wiki is not a git repo, contribute their mtime as before.
  let newest = null;
  const consider = (time) => {
    const date = time.toISOString().slice(0, 10);
    if (newest === null || date > newest) newest = date;
  };
  const committed = filesAtHead(wikiPath, 'wiki');
  const committedRel = [];
  for (const f of countable) {
    const rel = relative(wikiPath, f);
    if (committed?.has(rel)) committedRel.push(rel);
    else consider(statSync(f).mtime);
  }
  if (committedRel.length > 0) {
    const commitTime = newestCommitDate(wikiPath, committedRel);
    if (commitTime) consider(commitTime);
  }

  if (headerPages === countable.length && (newest === null || headerDate >= newest)) return null;
  return {
    page: 'wiki/index.md',
    issue: 'index_header_drift',
    expected_pages: headerPages,
    actual_pages: countable.length,
    header_date: headerDate,
    newest_page_date: newest,
    formula: PAGE_COUNT_FORMULA,
  };
}

export function checkGrounding(wikiPath, { page, atRef = false, updateLock = false, fixMoved = false, fixIndex = false, fixDates = false } = {}) {
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

  // Lead archives: external untrusted doc trees. Anything resolving inside one
  // is a lead, never a source — citing it is an error-level finding.
  const leadArchives = loadLeadArchives(wikiPath);
  const archiveByName = new Map(leadArchives.map((a) => [a.name, a]));
  const archiveRoots = leadArchives.map((a) => ({ name: a.name, root: resolve(wikiPath, a.path) }));
  const leadArchiveOf = (absPath) =>
    archiveRoots.find(({ root }) => insideRoot(root, absPath))?.name ?? null;

  // Under --at-ref, resolve each ref'd authority's ref ONCE (the repo+ref pair is
  // page-independent). true -> read at ref; false -> code_ref_unresolvable.
  // Authorities without a ref, or any authority when !atRef, are absent here and
  // fall through to the working tree — the default Layer-1 behavior is untouched.
  const refResolvable = new Map();
  if (atRef) {
    for (const a of codeAuthorities) {
      if (!a.ref || a.trusted) continue; // trusted-remote: no local repo to resolve against
      refResolvable.set(a.name, refResolves(resolveConfigPath(wikiPath, a.path), a.ref));
    }
  }

  // Trusted-remote authorities (marked in .tng-wiki.local.json): the machine
  // doesn't have the checkout and the user accepted the recorded verification
  // as truth. Their cites skip every local check; we tally them per authority
  // and emit one informational warning per run with the lockfile's provenance.
  const trustedCiteCounts = new Map();

  // Shared by the prose_internal_ref lint: the orphans stem map plus a resolved
  // file set for markdown-link targets.
  const stemByPage = buildStemMap(allFiles, wikiPath);
  const wikiFiles = new Set(allFiles.map((f) => resolve(f)));

  // Per-citation content lockfile (wiki/.tng-wiki.lock.json). When present,
  // locked cites get surgical churn detection (cite_content_changed / cite_moved)
  // and the file-granular code_updated_after_page check is suppressed for them.
  // When absent, behavior is identical to before the lockfile existed — the lock
  // is never created implicitly (--update-lock is the explicit verification act).
  const lock = readLock(wikiPath);
  const lockActive = lock !== null;
  const trackLock = lockActive || updateLock;
  const lockEntryFor = (rel, key) => lock?.citations?.[rel]?.[key] ?? null;

  // Authority git state (which SHA the ref — or HEAD on working-tree runs —
  // resolves to, plus the dirty flag), computed once per authority actually
  // cited. Feeds the lockfile `authorities` block so branch refs become
  // deterministic ("verified against develop@5e36f17").
  const authorityState = new Map();
  const authorityStateFor = (a) => {
    if (!authorityState.has(a.name)) {
      const repoAbs = resolveConfigPath(wikiPath, a.path);
      const useRef = atRef && Boolean(a.ref);
      authorityState.set(a.name, {
        ref: a.ref ?? null,
        resolved_sha: resolveRefSha(repoAbs, useRef ? a.ref : 'HEAD'),
        resolved_at: new Date().toISOString(),
        dirty: useRef ? false : (repoIsDirty(repoAbs) ?? false),
      });
    }
    return authorityState.get(a.name);
  };

  const newCitations = {};  // page -> cite key -> lock entry, collected for --update-lock
  const moveFixes = [];     // cite_moved fixes to apply on --fix-moved

  const issues = [];
  const fixedDates = [];  // --fix-dates repairs, reported instead of their findings (#40)

  // Foot-gun guard: on a plain (non --at-ref) run, a ref'd authority is still
  // checked against its WORKING TREE — the pin only applies under --at-ref.
  // Collect one warning per such authority, but only when a code: cite actually
  // reached it this run (a ref'd authority that nothing cites stays silent).
  const warnings = [];
  const warnedRefAuthorities = new Set();

  for (const file of targets) {
    const rel = relative(wikiPath, file);
    const lockSeen = new Set();  // cite keys are unique per (page, cite-string)

    if (!existsSync(file)) {
      issues.push({ page: rel, issue: 'page_not_found' });
      continue;
    }

    const content = readFileSync(file, 'utf8');
    const { frontmatter, body, bodyStartLine } = splitFrontmatter(content);
    const declared = extractSources(frontmatter);
    const extracted = extractCitations(body, bodyStartLine);
    const cited = extracted.filter((c) => c.kind !== 'unknown');

    // Cite tokens under an unrecognized root never reach the checks below -
    // flag them here so they fail loudly instead of vanishing (#48).
    for (const c of extracted) {
      if (c.kind !== 'unknown') continue;
      const issue = { page: rel, issue: 'unknown_cite_root', cite: c.path, line: c.line };
      if (c.path.startsWith('_inbox/')) {
        issue.suggest = `tng-wiki graduate ${c.path.slice('_inbox/'.length)} - then cite the raw/ path it prints`;
      }
      issues.push(issue);
    }

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
      // resolved target inside a registered lead archive — a lead is never a
      // source, regardless of whether the file exists (it usually does)
      const archive = leadArchiveOf(resolve(wikiPath, refPath));
      if (archive) {
        const citedHere = citedRaw.filter((c) => c.path === refPath);
        if (citedHere.length > 0) {
          for (const c of citedHere) {
            issues.push({ page: rel, issue: 'cited_lead_archive', archive, raw: refPath, line: c.line });
          }
        } else {
          issues.push({ page: rel, issue: 'cited_lead_archive', archive, raw: refPath });
        }
        continue;
      }
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

    // per-citation lock churn for raw cites: the hash input is the whole
    // (normalized) raw file. Moves don't apply — there is no line anchor.
    if (trackLock) {
      for (const c of citedRaw) {
        const key = citeKey(c);
        if (lockSeen.has(key)) continue;
        lockSeen.add(key);
        const raw = readFileSafe(join(wikiPath, c.path));
        if (raw == null) continue;  // missing_raw already flagged above
        const currentHash = hashLines(normalizeLines(raw));
        const entry = lockEntryFor(rel, key);
        if (entry?.hash && entry.hash !== currentHash) {
          issues.push({
            page: rel, issue: 'cite_content_changed', cite: key, file: c.path,
            range: null, locked_sha: entry.hash, current_sha: currentHash,
          });
        } else if (lockActive && !entry) {
          issues.push({ page: rel, issue: 'cite_unlocked', cite: key });
        }
        if (updateLock) (newCitations[rel] ??= {})[key] = { hash: currentHash };
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
          const issue = { page: rel, issue: 'orphan_source_decl', raw: d };
          if (d.startsWith('_inbox/')) {
            issue.suggest = `_inbox/ is not a citable root - tng-wiki graduate ${d.slice('_inbox/'.length)} and declare the raw/ path`;
          }
          issues.push(issue);
        }
      }
    }

    // unknown code authority (frontmatter declares `code:<name>` not in .tng-wiki.json).
    // A lead archive declared as if it were an authority is the sharper finding —
    // the page is treating untrusted leads as a trust anchor.
    const citedCodeNames = new Set(citedCode.map((c) => c.authority));
    for (const d of declaredCode) {
      const name = d.slice('code:'.length);
      if (archiveByName.has(name) && !authorityByName.has(name)) {
        // inline cites of the same archive are flagged per-cite below (with lines)
        if (!citedCodeNames.has(name)) {
          issues.push({ page: rel, issue: 'cited_lead_archive', archive: name, raw: d });
        }
      } else if (!authorityByName.has(name)) {
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
      // 0. lead archive cited via the [^code:<name>/...] form — the most likely
      // shape of "cited a lead as if it were an authority". Flag per-cite (with
      // the line), regardless of whether a file path is present.
      if (archiveByName.has(c.authority) && !authorityByName.has(c.authority)) {
        const issue = { page: rel, issue: 'cited_lead_archive', archive: c.authority, line: c.line };
        if (c.file) issue.file = c.file;
        issues.push(issue);
        continue;
      }

      const authorityForCite = authorityByName.get(c.authority);
      // Trusted-remote: no local checkout to verify against. Count the cite
      // (whole-authority refs included) and skip all file/range/lock checks -
      // the recorded lockfile verification stands in for a local re-check.
      if (authorityForCite?.trusted) {
        trustedCiteCounts.set(c.authority, (trustedCiteCounts.get(c.authority) ?? 0) + 1);
        // Preserve inherited verification: an --update-lock run rebuilds the
        // citation map from newCitations, so a trusted cite that skips the
        // lock-tracking block below would be dropped - stripping the hash a
        // teammate without the checkout can't recompute, and re-flagging it
        // cite_unlocked on a machine that later DOES have the repo. Carry the
        // existing locked entry forward untouched.
        if (updateLock && c.file) {
          const tkey = citeKey(c);
          const entry = lockEntryFor(rel, tkey);
          if (entry) (newCitations[rel] ??= {})[tkey] = entry;
        }
        continue;
      }

      if (!c.file) continue;  // whole-authority reference — no file to check
      const authority = authorityForCite;
      if (!authority) continue;  // unknown authority already flagged above

      const repoAbs = resolveConfigPath(wikiPath, authority.path);

      // 1a. resolved target inside a registered lead archive (e.g. an authority
      // whose tree overlaps an archive) — leads are never citable.
      const archive = leadArchiveOf(resolve(repoAbs, c.file));
      if (archive) {
        issues.push({ page: rel, issue: 'cited_lead_archive', archive, authority: c.authority, file: c.file, line: c.line });
        continue;
      }

      // 1b. exclude — a cite to an excluded path is wrong even if the file exists.
      if (matchesAnyGlob(c.file, authority.exclude)) {
        issues.push({ page: rel, issue: 'excluded_code_file', authority: c.authority, file: c.file, line: c.line });
        continue;
      }

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

      // 4. cited line range within the file's bounds. The content is also the
      //    lock-hash input, so read it once for both checks.
      const needContent = Boolean(c.range) || trackLock;
      const content = needContent
        ? (useRef ? readFileAtRef(repoAbs, authority.ref, c.file) : readFileSafe(resolve(repoAbs, c.file)))
        : null;
      let rangeValid = true;
      if (c.range) {
        const lineCount = content == null ? null : countLines(content);
        if (lineCount != null && (c.range.start > c.range.end || c.range.end > lineCount)) {
          rangeValid = false;
          const issue = {
            page: rel, issue: 'code_line_out_of_range',
            authority: c.authority, file: c.file, line: c.line,
            range: `L${c.range.start}-L${c.range.end}`, line_count: lineCount,
          };
          if (useRef) issue.ref = authority.ref;
          issues.push(issue);
        }
      }

      // 5. per-citation lock churn: hash the normalized cited range (whole file
      //    when no anchor) and compare to the locked hash. On mismatch, look for
      //    the locked content elsewhere in the file to tell a move (anchor shift,
      //    content identical) from a real edit (cite_content_changed).
      const key = citeKey(c);
      if (trackLock && content != null && rangeValid && !lockSeen.has(key)) {
        lockSeen.add(key);
        const lines = normalizeLines(content);
        const currentHash = hashLines(c.range ? sliceRange(lines, c.range) : lines);
        const entry = lockEntryFor(rel, key);
        let recordKey = key;
        let recordHash = currentHash;
        if (entry?.hash && entry.hash !== currentHash) {
          const matches = c.range
            ? findContentMatches(lines, entry.hash, c.range.end - c.range.start + 1)
            : [];
          if (matches.length === 1) {
            const newRange = matches[0];
            if (fixMoved) {
              moveFixes.push({
                rel, absPage: file, authority: c.authority, citedFile: c.file,
                oldKey: key, oldRange: c.range, newRange, hash: entry.hash,
                sha: authorityStateFor(authority).resolved_sha,
              });
              // --update-lock in the same run records the post-fix state
              recordKey = `code:${c.authority}/${c.file}${rangeAnchor(newRange)}`;
              recordHash = entry.hash;
            } else {
              issues.push({
                page: rel, issue: 'cite_moved', cite: key, file: c.file,
                old_range: rangeLabel(c.range), new_range: rangeLabel(newRange),
              });
            }
          } else if (matches.length > 1) {
            issues.push({
              page: rel, issue: 'cite_moved_ambiguous', cite: key, file: c.file,
              candidate_ranges: matches.map(rangeLabel),
            });
          } else {
            issues.push({
              page: rel, issue: 'cite_content_changed', cite: key, file: c.file,
              range: c.range ? rangeLabel(c.range) : null,
              locked_sha: entry.hash, current_sha: currentHash,
            });
          }
        } else if (lockActive && !entry) {
          // info-level: lockfile exists but this cite was never locked
          issues.push({ page: rel, issue: 'cite_unlocked', cite: key });
        }
        const st = authorityStateFor(authority);  // touched -> authorities block refresh
        if (updateLock) {
          const newEntry = { hash: recordHash };
          if (st.resolved_sha) newEntry.hashed_at_sha = st.resolved_sha;
          (newCitations[rel] ??= {})[recordKey] = newEntry;
        }
      }

      // 6. staleness (ref-only): page `updated` predates the file's last commit
      //    at ref. Suppressed for locked cites — cite_content_changed is the
      //    surgical replacement; this stays as the fallback for unlocked cites.
      if (useRef && updated && !(lockActive && lockEntryFor(rel, key))) {
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
        if (isStaleAfterGrace(updated, sourceTime)) {
          issues.push({
            page: rel,
            issue: 'source_updated_after_page',
            raw: d,
            page_updated: updatedDate,
            source_mtime: sourceTime.toISOString().slice(0, 10),
          });
        }
      }
    }

    // `leads:` provenance — warn-level only, never errors. Archives evolve, so a
    // vanished lead file is informational (missing_lead); an unregistered archive
    // name is a config smell (unknown_lead_archive). Both carry level:'warn' so
    // rounds can exclude them from the ground-issue count.
    for (const lead of extractLeads(frontmatter)) {
      const colon = lead.indexOf(':');
      const archiveName = colon === -1 ? lead : lead.slice(0, colon);
      const leadPath = colon === -1 ? '' : lead.slice(colon + 1).trim();
      const archive = archiveByName.get(archiveName);
      if (!archive) {
        issues.push({ page: rel, issue: 'unknown_lead_archive', level: 'warn', lead, archive: archiveName });
        continue;
      }
      if (!leadPath || !existsSync(resolve(resolve(wikiPath, archive.path), leadPath))) {
        issues.push({ page: rel, issue: 'missing_lead', level: 'warn', lead, archive: archiveName });
      }
    }

    // The remaining checks only apply to groundable pages — a --page run pointed
    // at an exempt file (index.md, _template, wiki/meta/*) skips them.
    if (!isGroundable(rel)) continue;

    // frontmatter `updated` hygiene (warn-level): the page file itself changed —
    // git last-commit date, mtime fallback (same pattern as raw staleness above) —
    // after the date the page claims. +1-day grace absorbs same-day timezone
    // noise. Matters because every staleness check above keys on `updated`.
    if (updated) {
      const pageTime = fileCommitDate(wikiPath, rel) ?? statSync(file).mtime;
      if (isStaleAfterGrace(updated, pageTime)) {
        const finding = {
          page: rel,
          issue: 'frontmatter_updated_stale',
          updated: updated.toISOString().slice(0, 10),
          last_commit: pageTime.toISOString().slice(0, 10),
        };
        // --fix-dates: set `updated` to the value this check measures (git
        // commit date, mtime fallback) - deterministic and honest ("this file
        // last changed at T"); whether the change was substantive stays a
        // Layer 2 judgment (#40). Scoped by --page like every check here.
        if (fixDates) {
          const fmEnd = content.indexOf('\n---', 3);
          const head = fmEnd === -1 ? null : content.slice(0, fmEnd);
          const patched = head === null ? null : head.replace(/^updated:.*$/m, `updated: ${finding.last_commit}`);
          if (patched !== null && patched !== head) {
            writeFileSync(file, patched + content.slice(fmEnd));
            fixedDates.push({ page: rel, from: finding.updated, to: finding.last_commit });
          } else {
            issues.push(finding);  // no rewritable `updated:` line - report instead
          }
        } else {
          issues.push(finding);
        }
      }
    }

    // wikilink convention (warn-level): internal pages referenced in prose
    issues.push(...findProseInternalRefs({
      pageRel: rel, pageAbs: file, body, bodyStartLine, stemByPage, wikiFiles, wikiPath,
    }));
  }

  // Trusted-remote authorities: one informational warning per authority that
  // had cites this run, carrying the lockfile provenance so the reader sees
  // WHAT verification they're inheriting ("verified against develop@8d280c2").
  // A warning, not an issue: exit code and issue counts are untouched.
  for (const [name, cites] of trustedCiteCounts) {
    const authState = lock?.authorities?.[name];
    warnings.push({
      code: 'trusted_authority',
      authority: name,
      cites,
      verified_ref: authState?.ref ?? null,
      verified_sha: authState?.resolved_sha ?? null,
    });
  }

  // Wiki-level check: the index.md scaffold header vs reality. Skipped on --page
  // runs — they're scoped to a single page's own invariants.
  // --fix-index rewrites the header to the measured values instead of reporting
  // the drift: the check already computes the ground truth (page count per
  // PAGE_COUNT_FORMULA, newest page date), so the repair is deterministic (#40).
  let fixedIndex = null;
  if (!page) {
    const headerIssue = checkIndexHeader(wikiPath, allFiles);
    if (headerIssue && fixIndex) {
      const indexAbs = join(wikiPath, 'wiki', 'index.md');
      const date = headerIssue.newest_page_date ?? headerIssue.header_date;
      const content = readFileSync(indexAbs, 'utf8');
      const patched = content.replace(
        /^(_Last updated:\s*)\d{4}-\d{2}-\d{2}(\s*\|\s*Total pages:\s*)\d+/m,
        `$1${date}$2${headerIssue.actual_pages}`,
      );
      writeFileSync(indexAbs, patched);
      fixedIndex = { pages: headerIssue.actual_pages, date, was_pages: headerIssue.expected_pages, was_date: headerIssue.header_date };
    } else if (headerIssue) {
      issues.push(headerIssue);
    }
  }

  // --fix-moved: rewrite each shifted #L anchor in the page to the new range.
  // This is the only safe auto-fix — the content is identical (the locked hash
  // matched at exactly one other location); only line numbers shifted.
  // cite_content_changed is never auto-fixed; it feeds the Layer-2 human workflow.
  const fixed = [];
  if (moveFixes.length > 0) {
    const byPage = new Map();
    for (const f of moveFixes) {
      if (!byPage.has(f.absPage)) byPage.set(f.absPage, []);
      byPage.get(f.absPage).push(f);
      fixed.push({ page: f.rel, cite: f.oldKey, old_range: rangeLabel(f.oldRange), new_range: rangeLabel(f.newRange) });
    }
    for (const [absPage, fixes] of byPage) {
      let pageContent = readFileSync(absPage, 'utf8');
      for (const f of fixes) {
        const escaped = `code:${f.authority}/${f.citedFile}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // a single-line lock key (#L42) may appear in the page as #L42 or #L42-L42
        const oldAnchor = f.oldRange.start === f.oldRange.end
          ? `#L${f.oldRange.start}(?:-L${f.oldRange.start})?`
          : `#L${f.oldRange.start}-L${f.oldRange.end}`;
        const re = new RegExp(`\\[\\^${escaped}${oldAnchor}\\]`, 'g');
        pageContent = pageContent.replace(re, `[^code:${f.authority}/${f.citedFile}${rangeAnchor(f.newRange)}]`);
      }
      writeFileSync(absPage, pageContent);
    }
  }

  // Lockfile write-back.
  // - --update-lock rebuilds the citation entries (page-scoped runs merge into
  //   the existing map so other pages' locks survive).
  // - Otherwise an existing lockfile still gets its `authorities` block refreshed
  //   on any run that touches code cites, and --fix-moved entry moves persist.
  // Never creates a lockfile implicitly.
  const lockResult = { exists: lockActive };
  if (updateLock) {
    let citations;
    if (page) {
      citations = { ...(lock?.citations ?? {}) };
      for (const t of targets) {
        const trel = relative(wikiPath, t);
        if (newCitations[trel]) citations[trel] = newCitations[trel];
        else delete citations[trel];
      }
    } else {
      citations = newCitations;
    }
    const authorities = { ...(lock?.authorities ?? {}), ...Object.fromEntries(authorityState) };
    lockResult.written = writeLock(wikiPath, { authorities, citations });
    lockResult.exists = lockResult.exists || lockResult.written;
    lockResult.citations_locked = Object.values(citations).reduce((n, m) => n + Object.keys(m).length, 0);
    lockResult.authorities = authorities;
  } else if (lockActive) {
    // A flagless (read-only) `ground` must NOT rewrite the lockfile - a
    // lint/report shouldn't dirty a tracked file, and `rounds` reports the
    // wiki's own working-tree churn, so a self-inflicted rewrite would pollute
    // that signal. Still surface the merged authorities for the "verified
    // against X@sha" display - but only when an authority was actually consulted
    // this run (authorityState populated), so a --page run over a page with no
    // code cites doesn't print "verified against" for authorities it never
    // touched. Only --fix-moved (a mutating op) persists.
    if (authorityState.size > 0) {
      lockResult.authorities = { ...lock.authorities, ...Object.fromEntries(authorityState) };
    }
    if (moveFixes.length > 0) {
      const authorities = { ...lock.authorities, ...Object.fromEntries(authorityState) };
      lockResult.authorities = authorities;
      const citations = lock.citations;
      for (const f of moveFixes) {
        const pageCites = citations[f.rel];
        if (!pageCites) continue;
        delete pageCites[f.oldKey];
        const entry = { hash: f.hash };
        if (f.sha) entry.hashed_at_sha = f.sha;
        pageCites[`code:${f.authority}/${f.citedFile}${rangeAnchor(f.newRange)}`] = entry;
      }
      lockResult.written = writeLock(wikiPath, { authorities, citations });
    }
  }

  const result = { scanned: targets.length, issues, warnings, lock: lockResult };
  if (fixMoved) result.fixed = fixed;
  if (fixedIndex) result.fixed_index = fixedIndex;
  if (fixDates && fixedDates.length > 0) result.fixed_dates = fixedDates;
  return result;
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
