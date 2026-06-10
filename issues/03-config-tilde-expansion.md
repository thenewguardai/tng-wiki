# config: expand `~` in authority paths; init should warn when an absolute path is entered

## Problem

`code_authorities[].path` is resolved with `resolve(wikiPath, a.path)`
(src/ground.js, `checkGrounding()`), so relative paths are fully portable —
but nothing expands `~`, and `init`'s prompt deliberately preserves the
user-entered string (src/init.js, `promptCodeAuthorities()`, the
"keep the user-entered string" comment). Net effect observed in the field: a
user typed five absolute `/home/<user>/...` paths at the prompt, init saved
them verbatim with no warning, and the wiki silently became single-machine.
`~/...` paths would be worse: `resolve(wikiRoot, '~/x')` treats `~` as a
literal directory name and the failure is a confusing `missing_code_file`.

## Proposal

1. **One shared resolver.** `resolveConfigPath(wikiRoot, p)` in a small
   `src/paths.js`: expand a leading `~/` (or bare `~`) to `os.homedir()`,
   otherwise `resolve(wikiRoot, p)`. Use it everywhere a `.tng-wiki.json` path
   is consumed: `ground` (authority paths), `connect`, `doctor`, and the
   `lead_archives` feature when it lands.
2. **init nudge.** In `promptCodeAuthorities()`, when the entered path is
   absolute: compute `relative(wikiRoot, entered)`; if the result doesn't
   escape a small depth (heuristic: ≤ 4 leading `..` segments), offer
   "Store as relative (`<computed>`) so the config travels across machines?
   [Y/n]" defaulting to yes. If the user declines or the path is on another
   root entirely, save as entered but print a one-line portability warning.
   Same logic in the headless path when authorities arrive via flags
   (warning only — no prompt under `--yes`).
3. **doctor check.** `doctor` adds a row per authority: path form
   (relative / `~` / absolute) + exists/missing on this machine. Absolute paths
   get a `⚠ won't travel across machines` annotation.

## Acceptance criteria

- [ ] `~/x` authority path resolves to `$HOME/x` in ground, connect, doctor.
- [ ] Relative-path behavior is unchanged (regression snapshot on the
      existing ground fixtures).
- [ ] init interactive: absolute path → conversion offer → stored relative on
      accept, stored verbatim + warning on decline.
- [ ] init `--yes`: absolute authority path produces a stderr warning, exit 0.
- [ ] doctor flags absolute authority paths.
- [ ] Windows: `~` expansion uses `homedir()`; path comparisons use
      `path.resolve` (no string-prefix assumptions beyond what readPage
      already does).
