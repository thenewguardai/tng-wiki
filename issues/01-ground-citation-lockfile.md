# ground: per-citation content lockfile — surgical re-verification + deterministic refs

## Problem

Two compounding gaps, surfaced by a 6-day / 22-page / ~30-commit grounding campaign
(foglifter-notes-and-artifacts):

1. **Churn detection is file-granular.** The only signal that a cited authority
   changed is `code_updated_after_page` (file commit-date vs page `updated`).
   One touch anywhere in a 5,000-line proc flags every page citing it and says
   nothing about *which citations* to re-check. Re-verification is all-or-nothing,
   which makes grounding against an active branch feel unaffordable.
2. **Branch refs are tracks, not pins.** In practice users set
   `ref: "origin/develop"` / `ref: "main"` (all 5 authorities in the field wiki do).
   The generated AGENTS.md describes `ref` as "frozen to a specific point in
   history," but a branch ref moves on every fetch. Users compensate manually
   (the field campaign hand-recorded `HEAD 5e36f17` in a NOTES doc).

## Proposal

A committed lockfile that pins, per citation, **what the cited content was when it
was last verified** — plus, per authority, **which SHA the ref resolved to**.
`ground` then reports per-citation churn instead of per-file churn, and branch
refs become deterministic ("verified against develop@5e36f17") without forcing
users onto SHA refs.

### Lockfile

`wiki/.tng-wiki.lock.json`, **committed** (it is verification state that must
travel with the wiki — analogous to a package lockfile). Schema:

```json
{
  "version": 1,
  "updated_at": "2026-06-09T17:00:00Z",
  "authorities": {
    "kpom-legacy": {
      "ref": "main",
      "resolved_sha": "5e36f17...",
      "resolved_at": "2026-06-09T17:00:00Z",
      "dirty": false
    }
  },
  "citations": {
    "wiki/kpom-legacy/mw/maintenance-windows.md": {
      "code:kpom-legacy/kp-scom/db-kpom/f_fetch_next_maintenance_window.sql#L17-L24": {
        "hash": "sha256:ab12...",
        "hashed_at_sha": "5e36f17..."
      },
      "raw/specs/foo.md": {
        "hash": "sha256:cd34..."
      }
    }
  }
}
```

- **Citation key** = the literal cite string as parsed by
  `extractCitations()` (`src/ground.js`) — `code:<authority>/<file>#L<s>-L<e>`,
  `code:<authority>/<file>` (whole-file), or `raw/<path>`.
- **Hash input**: the cited line range (or whole file when no anchor; or the whole
  raw file for `raw/` cites), normalized: split lines, strip trailing whitespace
  per line, join with `\n`. Normalization makes whitespace-only commits invisible.
- **`authorities` block**: written on every ground run that touches code cites.
  Working-tree runs record `HEAD` + `dirty: true|false`
  (`git -C <path> rev-parse HEAD`, `git -C <path> status --porcelain`).
  `--at-ref` runs record the resolved ref SHA (reuse the existing once-per-run
  resolution in `checkGrounding()` — the `refResolvable` map, src/ground.js ~L145).

### New finding types (match existing snake_case `{ page, issue, ... }` shape)

| issue | emitted when | extra fields |
|---|---|---|
| `cite_content_changed` | hash of current cited range ≠ locked hash | `cite`, `file`, `range`, `locked_sha`, `current_sha` |
| `cite_moved` | locked content not at the locked range, but found at **exactly one** other location in the same file (exact normalized match) | `cite`, `old_range`, `new_range` |
| `cite_moved_ambiguous` | locked content found at 2+ locations | `cite`, `candidate_ranges` |
| `cite_unlocked` | citation exists in a page but has no lockfile entry (info-level; suppressed entirely when no lockfile exists) | `cite` |

`cite_content_changed` replaces `code_updated_after_page` as the actionable
signal **when a lock entry exists**; keep `code_updated_after_page` as the
fallback for unlocked cites so behavior without a lockfile is unchanged.

### New flags on `ground`

- `--update-lock` — (re)write hashes + authority SHAs for everything currently
  clean. Bootstraps the lockfile on first run. Never runs implicitly: the lock
  records *human-verified* state, so updating it is an explicit act, typically
  after ingest or reconcile.
- `--fix-moved` — for each `cite_moved`, rewrite the `#L` anchor in the page to
  `new_range` and update the lock entry. This is the **only safe auto-fix**
  (content is byte-identical; only line numbers shifted). Log counts in output.
  `cite_content_changed` is never auto-fixed — it feeds the existing
  Layer-2 `⚠️ DRIFT?` human workflow.

### Behavior matrix

- No lockfile → ground behaves exactly as today + one-line hint
  (`run ground --update-lock to enable per-citation churn detection`).
- Lockfile present, cite locked, content unchanged at range → silent.
- Range shifted, content identical, unique match → `cite_moved`.
- Content changed → `cite_content_changed` (per-citation work queue).
- `--at-ref` → hash at the ref via the existing `git show <ref>:<file>` path
  (`src/git-read.js`); record ref SHA.

### Docs

- Generated AGENTS.md (src/agents/agents-md.js): correct the ref-pinning prose —
  distinguish branch refs (tracking; lockfile supplies determinism) from
  tag/SHA refs (true pins). Add the lockfile to the grounding section: Layer 1
  now answers "which citations changed since last verified," and `--update-lock`
  belongs at the end of ingest/reconcile.
- SKILL.md (src/skill.js): rounds step gains "review `cite_content_changed`
  findings; run `--fix-moved`; finish with `--update-lock` after reconcile."

## Acceptance criteria

- [ ] `ground --update-lock` creates a valid lockfile on the test fixture wiki;
      re-running ground immediately after reports zero churn findings.
- [ ] Editing a cited line → `cite_content_changed` for that cite only; sibling
      cites into the same file stay silent.
- [ ] Inserting lines above a cited range → `cite_moved` with correct
      `new_range`; `--fix-moved` rewrites the page anchor and the lock entry;
      subsequent run is clean.
- [ ] Duplicate content blocks → `cite_moved_ambiguous`, no auto-fix.
- [ ] Whole-file and `raw/` cites hash and verify.
- [ ] No lockfile → output identical to current behavior (snapshot test) + hint.
- [ ] `--json` includes the new finding types; `rounds` counts them.
- [ ] help.js spec entries for the new flags (parity test passes).
- [ ] Works under `--at-ref` with a branch ref; `authorities` block records the
      resolved SHA; `dirty` flag set when working tree has uncommitted changes.

## Notes for the implementer

- Hashing: `node:crypto` sha256; no new deps.
- The lockfile read/write should live in a new `src/lock.js` with unit tests
  mirroring the `test/ground.test.js` fixture style.
- Citation keys are already unique per (page, cite-string); if the same cite
  string appears twice in one page, one lock entry covers both (same content).
- Real-world parser inputs to test against: stacked cites
  (`[^code:a/x.sql#L301-L327][^code:a/x.sql#L1746-L1763]`), cites inside
  markdown table cells, anchors >L1800, single-line `#L42`.
