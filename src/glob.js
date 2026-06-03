// Dependency-free gitignore / minimatch-style glob matcher, used to honor a
// code authority's `exclude` list during grounding (Layer 1).
//
// IMPORTANT: this is a SINGLE left-to-right tokenizer on purpose. Do not refactor
// it into a chain of `String.prototype.replace` passes — a later pass (e.g. `*`)
// rewrites the regex tokens injected by an earlier pass (e.g. the `*` inside the
// `(?:.*/)?` emitted for `**/`), silently corrupting every pattern.

const REGEX_METACHARS = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

// Supported tokens (gitignore-flavored, path-relative to an authority tree):
//   **/  -> zero or more leading path segments     (?:.*/)?
//   **   -> anything, including slashes             .*
//   *    -> anything within a single segment        [^/]*
//   ?    -> a single non-slash character            [^/]
// Everything else is treated as a literal (regex metacharacters escaped).
export function globToRegExp(glob) {
  // Strip a single leading slash so an anchored pattern like `/src/*.ts` still
  // matches an authority-relative path such as `src/app.ts` (our cited file
  // paths are already relative to the authority's `path`, never rooted).
  const g = glob.startsWith('/') ? glob.slice(1) : glob;

  let out = '';
  for (let i = 0; i < g.length; ) {
    if (g.startsWith('**/', i)) { out += '(?:.*/)?'; i += 3; continue; }
    if (g.startsWith('**', i))  { out += '.*';        i += 2; continue; }
    const ch = g[i];
    if (ch === '*') { out += '[^/]*'; i += 1; continue; }
    if (ch === '?') { out += '[^/]';  i += 1; continue; }
    out += REGEX_METACHARS.has(ch) ? '\\' + ch : ch;
    i += 1;
  }
  return new RegExp('^' + out + '$');
}

// True if `file` (a path relative to an authority tree) matches any of `globs`.
// An empty or absent glob list never matches — an authority with no `exclude`
// excludes nothing.
export function matchesAnyGlob(file, globs = []) {
  if (!file || !Array.isArray(globs) || globs.length === 0) return false;
  return globs.some((g) => {
    try {
      return globToRegExp(g).test(file);
    } catch {
      return false;
    }
  });
}
