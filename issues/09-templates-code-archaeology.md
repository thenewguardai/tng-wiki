# templates: `code-archaeology` domain — the reverse-engineering scaffold the SE template isn't

## Problem (field report — discussion-grade proposal)

The `software-engineering` template scaffolds team-engineering shapes:
decisions/ components/ systems/ patterns/ incidents/ runbooks/ tech-debt
(src/templates/software-engineering/template.js → `extraDirs`, `indexMd`
section tables, and the AGENTS domain section). A real reverse-engineering /
code-archaeology campaign (6 days, 22 grounded pages against 5 code
authorities) deleted **nearly everything it generated** and hand-built a
different shape. The generated AGENTS.md already tells the Layer-3B
reverse-engineering story; the scaffold doesn't match it.

## What the campaign actually built (the proposed template)

A ninth entry in src/templates/index.js, `code-archaeology`, with
`supportsCodeAuthorities` true (init should strongly suggest configuring
authorities — they're the point):

**extraDirs**
```
wiki/meta/            # seeded, grounding-exempt by existing isGroundable()
deliverables/
_inbox/
raw/samples/  raw/specs/  raw/scripts/
templates/
```
Zone subdirectories under `wiki/` are domain-specific — the AGENTS section
instructs creating them per system/area rather than scaffolding guesses.

**Seeded meta pages** (`wiki/meta/`): `glossary.md`, `ecosystem.md`
(system/repo map), `project-status.md` (phase context — kept out of AGENTS.md
because it rots), `open-threads.md` (open-findings ledger with a standing
librarian duty to register and close threads), `patterns.md` (verification
lessons learned).

**Deliverable doc templates** (`templates/`): `DISCOVERY.md`, `ANALYSIS.md`,
`DESIGN.md`, `NOTES.md` — with the naming convention
`YYYYMMDD_Topic_TYPE_vX.Y.md` stated in the AGENTS section, plus the
versioning rule: git covers working revisions; a new `_vX.Y` file only for
externally-shared milestones; deliverables are never retro-edited.

**indexMd**: the standard catalog + a "Deliverables Shelf" section; none of
the SE section tables.

**AGENTS domain section** (template.md), the load-bearing content:
- the **wiki vs deliverables split** — evergreen code-verified pages vs dated
  frozen audit trail (deliverables/raw grounding-exempt);
- **leads, never sources** — AI-generated docs anywhere are leads; every
  carried claim re-grounded against a code authority (composes with the
  `lead_archives` config issue);
- the **provenance block** convention on distilled pages (lead consulted,
  authority + ref verified against, corrections made vs the lead);
- the **verification-first flow** (premise-refute → validate → distill only
  `[confirmed]` → log rejections) and the **rejection log** NOTES deliverable
  as the audit artifact — see the companion docs issue;
- code-wins precedence, scope filter, and the existing Layer-3B story
  unchanged.

## Acceptance criteria

- [ ] `tng-wiki init --yes --domain code-archaeology` scaffolds the above;
      `rounds` reads clean on the fresh scaffold (seed files exempt, per #5).
- [ ] Template registered in src/templates/index.js; help.js `--domain`
      enum updated; templates.test.js + scaffold.test.js coverage matching the
      existing per-template patterns.
- [ ] AGENTS generator consumes it with no generator changes (template
      interface only: extraDirs / indexMd / logMd / seedSource / extraFiles /
      md).
- [ ] SE template untouched.

Label suggestion: open as a discussion/proposal first if maintainer prefers —
the directory and seed-page set generalize from one campaign (n=1) and may
want a second opinion before freezing.

