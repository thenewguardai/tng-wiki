# verbs: normalize `read` path forms; make `status` registry-aware

## Problem (carried from field dogfooding, previously noted)

1. `read` accepts exactly one path shape — relative to `wiki/`
   (src/verbs.js `readPage()`). Agents naturally pass `wiki/zone/page.md`
   (repo-relative), `zone/page` (no extension), or a bare `[[stem]]` from
   index/wikilinks; all fail with "Page not found" and the agent burns a turn
   probing.
2. `status` is not registry-aware: unlike `query`/`read`/`search` it doesn't
   resolve the registered default or accept `--wiki <slug>`, so it only works
   from inside a wiki directory.

## Proposal

**read** — accept, in order:
1. exact path relative to `wiki/` (current behavior, fast path);
2. same with `.md` appended;
3. the input minus a leading `wiki/` prefix (then forms 1–2);
4. unique stem match — reuse the lowercase stem map `listOrphanPages()` already
   builds; `[[…]]` wrapping stripped. Zero matches → current error listing the
   forms tried; multiple matches → error listing candidates.
The existing `../` escape guard applies after normalization, unchanged.

**status** — route through the same wiki-resolution helper the other verbs use
(registry default + `--wiki <slug>` + explicit-path fallback); add `--json`.
help.js gains the flags; the parity test enforces it.

## Acceptance criteria

- [ ] `read zone/page`, `read zone/page.md`, `read wiki/zone/page.md`,
      `read '[[page]]'`, `read page` (unique stem) all return the same page.
- [ ] Ambiguous stem → candidate list, exit non-zero.
- [ ] Escape guard still blocks `../../etc/passwd` in every form.
- [ ] `status --wiki <slug>` works from any cwd; bare `status` uses the
      registered default; both match `query`'s resolution semantics exactly.

