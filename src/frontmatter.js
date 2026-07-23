// Shared frontmatter primitives - the single place that knows what a page's
// YAML block looks like. ground.js (citation/lint engine) and verbs.js
// (sources listing) previously each owned their own boundary regex and parser;
// an external review flagged the drift risk, and consolidating here removes it
// (same treatment insideRoot/walkMd got in paths.js).

// Split a page into its frontmatter text and body. `bodyStartLine` is the
// 1-indexed line where the body starts in the original file, so citation
// findings can report real line numbers.
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

// Parser for top-level frontmatter list keys (`sources:`, `leads:`). Handles
// inline arrays, block lists, scalars, and quoted entries identically so the
// two keys can never drift in what they accept. Returns null when the key is
// absent (callers distinguish "no key" from "empty list").
export function extractListKey(frontmatter, key) {
  const lines = frontmatter.split('\n');
  const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (idx === -1) return null;
  const line = lines[idx];

  // inline array form: `<key>: [a, b]` or `<key>: []`
  const inline = line.match(new RegExp(`^${key}:\\s*\\[(.*)\\]`));
  if (inline) {
    return inline[1].trim()
      ? inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
      : [];
  }

  // scalar form: legacy `sources: 3` (count) - treat as empty, it's a migration target
  const scalar = line.slice(key.length + 1).replace(/#.*$/, '').trim();
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

// Scalar key/value map of a frontmatter block: quotes stripped, `true`/`false`
// coerced to booleans, everything else a string. The reader listSources uses
// for `compiled:` / `title:` / `type:` - deliberately simpler than a YAML
// parser, matching what the generated templates emit.
export function parseScalars(frontmatter) {
  const out = {};
  for (const raw of frontmatter.split('\n')) {
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
