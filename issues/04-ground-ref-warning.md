# ground: warn when checking the working tree of a ref'd authority (and document branch-ref vs SHA-ref semantics)

## Problem

When an authority has `ref` set, plain `tng-wiki ground` still checks the
working tree — the pin only applies under `--at-ref` (src/ground.js: the
`refResolvable` map is only populated `if (atRef)`). The field campaign
documented this and never got bitten, but it's a loaded foot-gun: "pinned, but
only if you remember the flag." Separately, the generated AGENTS.md describes
`ref` as freezing the authority "to a specific point in history," which is only
true for tag/SHA refs — every authority in the field config uses a *branch*
(`origin/develop`, `main`), which moves.

## Proposal — warning, not a default flip

Do **not** make `--at-ref` the default. Layer 1's contract is "cheap, always
safe": ref resolution touches git plumbing and can fail
(`code_ref_unresolvable`), which would turn the pre-flight check into something
that errors on a machine where the authority repo is mid-fetch or absent. Two
changes instead:

1. **One-line warning per ref'd authority** on a plain (non `--at-ref`) run
   that encounters `code:` cites into it:

   ```
   ⚠ authority "kpom-legacy" has ref "main" — checking the WORKING TREE; pass --at-ref for ref-pinned checks
   ```

   stderr in plain mode; in `--json`, a top-level
   `warnings: [{ code: 'working_tree_of_ref_authority', authority, ref }]`
   array so agents see it without scraping stderr. Emit once per authority per
   run, only when that authority was actually consulted.
2. **Docs correction** in the generated AGENTS.md ref-pinning section
   (src/agents/agents-md.js): branch refs are *tracking* refs — deterministic
   grounding against a branch requires recording the resolved SHA (which the
   citation-lockfile feature provides); tag/SHA refs are true pins. One
   sentence each; link the two behaviors.
3. **Optional opt-in** for users who do want ref-default: per-authority
   `"ground_default": "at-ref"` in `.tng-wiki.json`. When set, plain ground
   resolves that authority at its ref and the warning inverts
   (`checking at ref — pass --working-tree to override`). Keep this last; the
   warning alone closes the foot-gun.

## Acceptance criteria

- [ ] Plain ground + ref'd authority with cites → exactly one warning per
      authority; exit code unchanged; findings unchanged.
- [ ] `--at-ref` run → no warning.
- [ ] Authority with `ref` but zero cites consulted → no warning.
- [ ] `--json` carries the `warnings` array; existing JSON consumers
      unaffected (additive key only).
- [ ] AGENTS.md generator snapshot updated: branch-vs-SHA semantics present.
- [ ] (If #3 implemented) `ground_default: "at-ref"` honored per authority,
      mixed configs work, `--working-tree` overrides.
