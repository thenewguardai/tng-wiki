# ADR 0001: Captures commit straight to origin; each hub has one home librarian

- Status: accepted
- Date: 2026-09-27
- Design: [cross-machine-flow.md](../design/cross-machine-flow.md)

## Context

Wikis maintained from several machines drifted apart (46 unpushed commits on one clone,
53 behind on another, an earlier 84-commit reconcile done by hand). Capturing sessions
were asked to make filing, routing and push decisions they could not make safely, and
shared one git index with concurrent librarian sessions. Two instruction sources gave
capturers conflicting contracts.

## Decision

1. `tng-wiki capture` lands a new `_inbox/` file directly on the upstream branch via a
   private temporary index and pushes it, retrying on races, never touching the user's
   index or working tree. Offline captures queue in `~/.tng-wiki/outbox/`.
2. Each wiki names a home host in its committed manifest (`librarian`). Only that host
   writes compiled state; other hosts are capturers and the mutating verbs refuse there
   unless `--off-host`.
3. The librarian publishes with `tng-wiki sync --push` (rebase onto upstream, push).
   Every session starts from a fast-forward `sync --quiet`.
4. Cross-hub routing is the librarian's job; capturers give one hub plus `also:` hints.

## Consequences

- Pushing to a private wiki repo is routine and pre-authorized by the maintainer.
- Merge conflicts need two writers of compiled state; with one librarian per hub the
  only concurrent writes are new, uniquely named files.
- Off-home maintenance is possible but explicit (`--off-host`).
- Wikis without a `librarian` field behave exactly as before.
