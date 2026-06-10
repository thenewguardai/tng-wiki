# lint: flag non-wikilink internal references (`prose_internal_ref`)

## Problem

`orphans` counts only `[[wikilinks]]` (src/verbs.js, the
`/\[\[([^\]|#]+)…\]\]/g` matcher) — correct and by design. But pages in the
field wiki cross-reference in prose ("see `bigfix-sync.md`", "Cross-refs
(prose): maintenance-window-timing.md"), which makes heavily-linked pages
invisible to the link graph and pollutes `orphans` output. The generated
AGENTS.md already mandates wikilinks for all internal cross-references; the
violation is what goes undetected. **Don't** expand the orphan parser to a
second link grammar — lint the convention instead.

## Proposal

New warn-level finding `prose_internal_ref` on the ground/lint surface, per
groundable page:

- **Pattern A**: inline-code tokens `` `<stem>.md` `` where `<stem>`
  case-insensitively matches a known wiki page stem (reuse the orphans stem
  map).
- **Pattern B**: markdown links `[text](<target>)` whose target is a relative
  `.md` path resolving to a wiki page.
- **Exclusions**: targets inside fenced code blocks; matches that are part of
  a `[^raw/...]`/`[^code:...]` citation; `deliverables/` and `raw/` path
  references (those are *files*, correctly referenced as paths, not pages);
  the ground exemption set (`index.md`, `log.md`, `_`-prefixed, `wiki/meta/*`)
  — index.md legitimately mixes link styles.
- Output: `{ page, issue: 'prose_internal_ref', line, matched, suggest:
  '[[<stem>]]' }`. Counted in `rounds` under a `convention` bucket (or folded
  into ground warn-level counts — implementer's call, but visible in rounds).
- Generated AGENTS.md: one line in Writing Style noting the rule is
  lint-enforced.

## Acceptance criteria

- [ ] Fixture page with `` `bigfix-sync.md` `` in prose → finding with the
      `[[bigfix-sync]]` suggestion; same text inside a fenced block → silent.
- [ ] `[see sync](../mw/bigfix-sync.md)` → finding; `[doc](deliverables/x.md)`
      and `[^raw/…]` citations → silent.
- [ ] Stem matching shares the orphans map (one source of truth; covered by a
      shared-fixture test).
- [ ] Warn-level: exit code unchanged; visible in `rounds` and `--json`.
