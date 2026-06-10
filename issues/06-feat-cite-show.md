# feat: `tng-wiki cite show <page>` — claim-next-to-evidence review in one command

## Problem

During distillation and human review, checking a page's citations means
re-hunting every cite by hand — the field campaign's agents ran
`sed -n 'X,Yp'` against authority files **hundreds of times**, and a human
reviewing a page has no way to see each claim next to the lines it cites
without doing the same. This is also the natural review surface for the
citation-lockfile feature's `cite_content_changed` queue.

## Proposal

```
tng-wiki cite show <page> [--wiki <slug>] [--at-ref] [--cite <n|key>] [--context <lines>] [--json]
```

For each citation in the page (reuse `extractCitations()`):

```
[3] code:kpom-legacy/kp-scom/db-kpom/f_fetch_next_maintenance_window.sql#L17-L24
    claim (page L41): "Build a 367-day candidate calendar from @start_date via a recursive CTE…"
    ── cited lines ─────────────────────────────────────────────
    17 | WITH calendar AS (
    …
    24 | )
```

- **Claim extraction**: the sentence containing the cite — text from the
  previous sentence boundary (or line start) up to the cite marker, trimmed.
  Heuristic is fine; include the page line number so the human can jump.
- **Cited lines**: working tree by default; `--at-ref` reads via the existing
  `git show` path (src/git-read.js). `raw/` cites print the first N lines of
  the raw file (whole-file cites likewise, default 20, `--context` to widen).
- `--cite <n|key>` limits to one citation (by index from the listing, or by
  literal key) — the surface the reconcile workflow drives.
- `--json`: `[{ index, cite, kind, authority, file, range, claim, claim_line,
  lines: ["…"] }]`.
- Errors per-cite, not per-run: a missing file prints the same finding name
  ground uses (`missing_code_file`) inline and continues.
- Page path resolution: same forms as `read` (see verb-hygiene issue) so the
  two compose.

## Acceptance criteria

- [ ] Renders raw, code-ranged, code-whole-file, and stacked cites from a
      fixture page (including cites inside table cells).
- [ ] `--at-ref` shows ref content that differs from the working tree.
- [ ] `--json` shape stable and documented; help.js entry + parity test.
- [ ] Missing-target cites degrade per-cite.
- [ ] Generated SKILL.md mentions `cite show` in the reconcile workflow.

