import { makeIndexMd, makeLogMd, today } from '../shared.js';

// Code Archaeology / Reverse Engineering — the verification-first scaffold.
//
// Shape learned from a real campaign (issue #22): the wiki holds evergreen
// code-verified pages; deliverables/ holds dated frozen documents; _inbox/
// receives AI-generated leads that must never be trusted directly. Zone
// subdirectories under wiki/ are deliberately NOT scaffolded — the agent
// creates them per system/area as the territory becomes known, and registers
// each one in wiki/meta/ecosystem.md.
export const codeArchaeologyTemplate = {
  extraDirs: [
    'wiki/meta',
    'deliverables',
    '_inbox',
    'raw/samples',
    'raw/specs',
    'raw/scripts',
    'templates',
  ],

  indexMd: (wikiName) => makeIndexMd(wikiName, [
    { title: 'Pages', columns: ['Zone', 'Summary', 'Confidence', 'Updated'] },
    { title: 'Deliverables Shelf', columns: ['Type', 'Date', 'Version', 'Status'] },
  ]),

  logMd: makeLogMd,

  seedSource: null,

  extraFiles: {
    'wiki/meta/glossary.md': `---
title: "Glossary"
type: meta
created: ${today()}
updated: ${today()}
---

# Glossary

Domain and codebase terms, alphabetized. Add a term the first time it earns a definition — and prefer the meaning the *implementation* gives it over what any document claims it means. When a lead and the code use the same word differently, record both and mark which one the wiki uses.

| Term | Meaning (as the code uses it) | First verified at |
|---|---|---|
| *(populate as terms are encountered)* | | |
`,

    'wiki/meta/ecosystem.md': `---
title: "Ecosystem Map"
type: meta
created: ${today()}
updated: ${today()}
---

# Ecosystem Map

Authoritative map of every system, repo, and service this campaign touches. Register a system here the first time it appears — even before it has wiki pages. When a system accumulates enough verified knowledge to deserve pages, create its zone directory \`wiki/<zone>/\` and record the zone here.

| System / Repo | Role | Code authority? | Wiki zone | Notes |
|---|---|---|---|---|
| *(populate as systems are encountered)* | | | | |

- **Code authority?** — yes/no: is it registered in \`.tng-wiki.json → code_authorities\`? Systems we make claims about *should* be. If a system can't be an authority (no source access), say so here — its claims stay \`[reported]\` at best.
- **Wiki zone** — the \`wiki/\` subdirectory holding its pages, once created.
`,

    'wiki/meta/project-status.md': `---
title: "Project Status"
type: meta
created: ${today()}
updated: ${today()}
---

# Project Status

Phase context lives here — *not* in AGENTS.md — because it rots. This page is expected to churn; update it at the start or end of every working session. It is grounding-exempt: no citations required.

## Current phase

*(e.g. "Discovery: mapping the auth subsystem of legacy-app")*

## Active focus

- *(what's being verified right now)*

## Recently completed

- *(last few finished threads / shipped deliverables)*

## Blocked / waiting

- *(what needs the human, source access, or an upstream answer)*
`,

    'wiki/meta/open-threads.md': `---
title: "Open Threads"
type: meta
created: ${today()}
updated: ${today()}
---

# Open Threads

The open-findings ledger. **Standing librarian duty:** any unresolved question, suspicious finding, or claim you couldn't settle gets registered here the moment you notice it — and gets closed here, with a one-line resolution, the moment it's settled. Closing a thread without recording the resolution is the same as never having investigated it.

| # | Thread | Opened | Status | Resolution |
|---|---|---|---|---|
| 1 | *(example: does the retry path honor the timeout config?)* | ${today()} | open | |

- **Status:** \`open\` → \`closed\` (or \`wontfix\` with a reason).
- Closing a thread also gets a \`wiki/log.md\` entry.
- Review this table at the start of every rounds pass — stale open threads are the campaign's real backlog.
`,

    'wiki/meta/patterns.md': `---
title: "Verification Patterns"
type: meta
created: ${today()}
updated: ${today()}
---

# Verification Patterns

Lessons learned about *how this codebase lies to you* — and how to catch it. Append a dated entry whenever a verification surprises you: what the lead claimed, what the code actually showed, and the generalizable lesson. Future verification passes read this first.

## Format

\`\`\`markdown
### ${today()} — <short lesson title>
- **Lead claimed:** <the plausible-but-wrong claim>
- **Code showed:** <what the authority actually does> (cite: code:<authority>/<path>#L..)
- **Lesson:** <the generalizable verification heuristic>
\`\`\`

## Entries

*(none yet — the first rejection that teaches you something belongs here)*
`,

    'templates/DISCOVERY.md': `# <Topic> — Discovery

> Deliverable skeleton. Copy into \`deliverables/\` as \`YYYYMMDD_<Topic>_DISCOVERY_v1.0.md\`, then fill in.
> A DISCOVERY answers: **what exists?** Inventory and map, not deep mechanics.

## Scope

What system/area this covers, and what it deliberately excludes.

## Method

Which authorities were read, at what ref, with what tooling. Which leads were consulted (leads are listed for provenance — nothing here rests on them).

## Inventory

| Item | Location (authority/path) | Role | Confidence |
|---|---|---|---|

## Structure map

How the pieces relate — entry points, boundaries, data flow at the map level.

## Open threads raised

Register each in \`wiki/meta/open-threads.md\`; list them here for the frozen record.

## Provenance

- Leads consulted:
- Verified against:
- Corrections vs leads:
`,

    'templates/ANALYSIS.md': `# <Topic> — Analysis

> Deliverable skeleton. Copy into \`deliverables/\` as \`YYYYMMDD_<Topic>_ANALYSIS_v1.0.md\`, then fill in.
> An ANALYSIS answers: **how does it actually work?** Mechanics, invariants, edge cases — every claim code-cited.

## Question

The specific behavior or mechanism under analysis, and why it matters now.

## Findings

Each finding: the claim, the code evidence (\`[^code:<authority>/<path>#L..]\`), and confidence. Findings that contradict a lead say so explicitly.

## Edge cases & failure modes

What happens at the boundaries — verified, not inferred.

## What the leads got wrong

Corrections vs any AI-generated docs consulted (full detail belongs in the rejection-log NOTES deliverable).

## Open threads raised

Register each in \`wiki/meta/open-threads.md\`.

## Provenance

- Leads consulted:
- Verified against:
- Corrections vs leads:
`,

    'templates/DESIGN.md': `# <Topic> — Design

> Deliverable skeleton. Copy into \`deliverables/\` as \`YYYYMMDD_<Topic>_DESIGN_v1.0.md\`, then fill in.
> A DESIGN answers: **what should we build?** A proposal grounded in verified behavior, not in leads.

## Goal

What this design achieves (port, replacement, integration, fix).

## Constraints from verified behavior

The verified facts the design must honor — each one citing the wiki page or code authority that establishes it. A design constraint resting on an unverified lead is marked as such and treated as a risk.

## Proposed design

The shape of the solution. Diagrams welcome.

## Compatibility & risks

Where the design deviates from observed behavior, and what could invalidate it.

## Alternatives considered

- **Option A:** why not.
- **Option B:** why not.

## Provenance

- Leads consulted:
- Verified against:
- Corrections vs leads:
`,

    'templates/NOTES.md': `# <Topic> — Notes

> Deliverable skeleton. Copy into \`deliverables/\` as \`YYYYMMDD_<Topic>_NOTES_v1.0.md\`.
> NOTES hold working state — including the **rejection log**, the audit artifact proving verification happened. A campaign with an empty rejection log either had perfect leads (unlikely) or wasn't verifying.

## Working notes

Running observations, dead ends, probe results (\`raw/scripts/\` holds the rerunnable probes).

## Rejection log

Every lead claim that died under verification gets a row. This is the deliverable that makes "leads, never sources" auditable.

| Claim (from lead) | Lead | Authority checked | Why rejected | Date |
|---|---|---|---|---|

## Deferred / unverifiable

Claims that could be neither confirmed nor refuted — registered in \`wiki/meta/open-threads.md\`, listed here for the frozen record.

## Provenance

- Leads consulted:
- Verified against:
- Corrections vs leads:
`,
  },
};
