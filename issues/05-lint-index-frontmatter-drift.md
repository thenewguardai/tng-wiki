# lint: zero-LLM batch — index header drift + frontmatter `updated` vs git history

## Problem

Two cheap invariants nothing checks, both proven failures in the field wiki:

1. **Index header rot.** `wiki/index.md` opens with
   `_Last updated: 2026-06-03 | Total pages: 4 | Total sources: 0_` while the
   body lists 23 pages. The LLM is instructed to maintain the header
   ("Never skip the index"); nothing verifies it. Instruction without lint
   doesn't hold — that's the tool's own thesis.
2. **Frontmatter `updated` drift.** Nothing flags a page whose git last-commit
   date is newer than its frontmatter `updated:` — i.e. the page was edited
   without bumping the date the entire grounding system keys on
   (`source_updated_after_page` / `code_updated_after_page` both compare
   against `updated`, so a stale `updated` silently *widens* churn detection
   in the wrong direction).

## Proposal

Two new structural findings in `checkGrounding()` (they belong on the ground
surface — they're attribution-integrity checks — and `rounds` picks them up
for free via `roundsReport()`):

| issue | check | fields |
|---|---|---|
| `index_header_drift` | parse the scaffold header line in `wiki/index.md` (`Total pages: N` and the `Last updated:` date); compare N against the actual page count and the date against the newest page's git last-commit date (mtime fallback when not a git repo, matching the existing pattern) | `expected_pages`, `actual_pages`, `header_date`, `newest_page_date` |
| `frontmatter_updated_stale` | per groundable page: git last-commit date of the page file > frontmatter `updated` (+ 1-day grace to avoid same-day timezone noise); mtime fallback | `page`, `updated`, `last_commit` |

Definitions:

- **Page count** = files under `wiki/` passing the existing `isGroundable()`
  filter **plus** `wiki/meta/*` content pages (they're real pages, just
  grounding-exempt) — i.e. all `wiki/**/*.md` except `index.md`, `log.md`, and
  `_`-prefixed files. State the formula in the finding output so the
  maintaining agent fixes the header to the same definition.
- Header line absent or in a non-scaffold format → skip silently
  (`index_header_drift` only fires when the scaffold pattern is present and
  wrong; don't impose the header on customized indexes).
- `frontmatter_updated_stale` is **warn-level** (it's a hygiene signal, not an
  attribution break); `index_header_drift` is a normal finding.

Generated AGENTS.md: one line in the Indexing section noting the header is
lint-checked and stating the page-count formula.

## Acceptance criteria

- [ ] Fixture with stale header counts/date → `index_header_drift` with
      correct expected/actual; fixing the header clears it.
- [ ] Custom index without the scaffold header line → no finding.
- [ ] Page committed after its `updated` date → `frontmatter_updated_stale`;
      same-day edits don't fire (grace window).
- [ ] Non-git wiki: both checks fall back to mtime, consistent with
      `source_updated_after_page`'s existing fallback.
- [ ] `rounds` counts include both; `--json` shapes documented.
- [ ] No new dependencies; git dates via the existing child-process pattern.
