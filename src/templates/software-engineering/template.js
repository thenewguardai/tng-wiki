import { makeIndexMd, makeLogMd, today, frontmatter } from '../shared.js';

export const softwareEngineeringTemplate = {
  extraDirs: [
    'raw/prs',
    'raw/rfcs',
    'raw/incidents',
    'raw/arch-reviews',
    'raw/talks',
    'wiki/decisions',
    'wiki/components',
    'wiki/systems',
    'wiki/patterns',
    'wiki/incidents',
    'wiki/runbooks',
    'wiki/tech-debt',
    'output/diagrams',
    'output/reports',
  ],

  indexMd: (wikiName) => makeIndexMd(wikiName, [
    { title: 'Decisions (ADRs)', columns: ['Status', 'Date', 'Supersedes', 'Updated'] },
    { title: 'Components', columns: ['Owner', 'Status', 'SLO', 'Updated'] },
    { title: 'Systems', columns: ['Summary', 'Components', 'Updated'] },
    { title: 'Patterns', columns: ['When to Use', 'Tradeoffs', 'Updated'] },
    { title: 'Incidents', columns: ['Severity', 'Date', 'Root Cause', 'Status'] },
    { title: 'Runbooks', columns: ['Component', 'Owner', 'Last Drilled'] },
    { title: 'Tech Debt', columns: ['Impact', 'Effort', 'Blocks', 'Updated'] },
  ]),

  logMd: makeLogMd,

  seedSource: {
    path: 'rfcs/2026-04-15-adr-template-demo.md',
    content: `${frontmatter({
      title: 'ADR-0001: Adopt AGENTS.md as canonical agent schema',
      source: 'tng-wiki project',
      url: 'https://github.com/thenewguard/tng-wiki',
      date: '2026-04-15',
      clipped: today(),
      type: 'rfc',
      compiled: false,
      tags: ['adr', 'schema', 'agents-md'],
    })}
# ADR-0001: Adopt AGENTS.md as canonical agent schema

## Status

Accepted — 2026-04-15

## Context

The \`tng-wiki\` CLI originally generated three parallel schema files (CLAUDE.md, AGENTS.md, .cursorrules), each a near-copy of the same content with a different per-agent header. Every schema change had to touch all three generators. String-matching header injection in codex.js/cursor.js was fragile — renaming the target heading silently broke the injection.

Meanwhile the [agents.md convention](https://agents.md/) has consolidated as the portable schema across Claude Code, Codex, Cursor, opencode, hermes-agent, OpenClaw, Aider, and others. Claude Code falls back to AGENTS.md when no CLAUDE.md is present and follows symlinks transparently.

## Decision

Treat \`AGENTS.md\` as the single canonical schema file. Generate \`CLAUDE.md\` and \`.cursorrules\` as symlinks (file copies on platforms without symlink permission).

## Consequences

**Positive:**
- One source of truth. Edit AGENTS.md, every alias sees the change.
- Covers 7+ agents out of the box.
- Deletes ~100 lines of per-agent generator code and the fragile string-replacement pattern.

**Negative:**
- Filesystems without symlink permission need the copy fallback (detected, handled automatically).
- Users who had customized per-agent content lose the per-agent header seam. They can re-introduce by editing a specific alias file instead of the canonical.

## Alternatives considered

- **Keep parallel generators:** preserves per-agent specialization, but the agents.md convention has made that specialization unnecessary.
- **Ship only AGENTS.md, no aliases:** users with agents that hard-require a specific filename (e.g. Cursor's \`.cursorrules\`) would need manual setup.

## Links

- [agents.md spec](https://agents.md/)
- Commit \`9668e6e\` (implementation)
`,
  },

  extraFiles: {
    'wiki/decisions/_adr-template.md': `---
title: "ADR-NNNN: <decision title>"
type: decision
status: proposed   # proposed | accepted | deprecated | superseded
created: ${today()}
updated: ${today()}
supersedes: []     # list of ADR paths this decision replaces
superseded-by: []  # populated when a later ADR replaces this one
sources:
  # - raw/rfcs/...
  # - raw/prs/...
tags: [adr]
---

# ADR-NNNN: <decision title>

## Status

<proposed | accepted — DATE | deprecated — DATE | superseded by [[ADR-NNNN]] — DATE>

## Context

What forces are at play? What constraints shape the decision? What was the trigger?

## Decision

What did we decide? State it clearly. Cite the sources that informed the decision.[^raw/rfcs/...]

## Consequences

### Positive

- …

### Negative

- …

### Neutral / ongoing

- …

## Alternatives considered

- **Option A:** why not.
- **Option B:** why not.

## Links

- [[related-adr]]
- [[affected-component]]
`,

    'wiki/components/_component-template.md': `---
title: "<component name>"
type: component
owner: "<team or person>"
status: active     # active | deprecated | planned
sla_tier: standard # critical | standard | best-effort
created: ${today()}
updated: ${today()}
sources:
  # - raw/prs/...
  # - raw/arch-reviews/...
tags: [component]
---

# <component name>

## Purpose

One paragraph: what it does, who uses it.

## API surface

Key endpoints, libraries, or public contracts. Link to generated docs where available.

## Dependencies

- Upstream: [[component-a]], external APIs
- Downstream: [[component-b]], who calls this

## Data stores

Databases, caches, message queues, filesystems.

## SLOs

- Availability: <e.g. 99.9%>
- Latency: <e.g. p99 < 200ms>
- Throughput: <e.g. 1k rps sustained>

## Runbooks

- [[runbooks/<component>-oncall]]
- [[runbooks/<component>-disaster-recovery]]

## Known issues / tech debt

- [[tech-debt/<item>]]

## Recent decisions

- [[decisions/ADR-NNNN]]
`,

    'wiki/incidents/_incident-template.md': `---
title: "INC-YYYY-MM-DD-<slug>: <one-line summary>"
type: incident
severity: P2      # P0 | P1 | P2 | P3 — see meta/severity-taxonomy.md
date: ${today()}
duration_minutes: null
components: []
status: open      # open | mitigated | resolved | postmortem-published
created: ${today()}
updated: ${today()}
sources:
  # - raw/incidents/...
tags: [incident]
---

# INC-YYYY-MM-DD-<slug>

## Summary

One paragraph: what broke, who was affected, how long.

## Timeline

- \`HH:MM\` event
- \`HH:MM\` event
- \`HH:MM\` mitigated
- \`HH:MM\` resolved

## Root cause

What actually caused it. Cite the investigation evidence.[^raw/incidents/...]

## Contributing factors

Things that made it worse or harder to detect.

## Resolution

How it was stopped, short-term.

## Action items

| Action | Owner | Due | Status |
|---|---|---|---|
| … | … | … | open / closed |

## Follow-up tech debt

- [[tech-debt/<item>]]
`,

    'wiki/tech-debt/_scoring-criteria.md': `---
title: "Tech Debt Scoring"
type: meta
created: ${today()}
updated: ${today()}
---

# Tech Debt Scoring

Score every tech-debt entry on two axes. Keep the grid in mind when prioritizing — \`high impact × low effort\` is the "do it now" quadrant.

## Impact (what does this cost us?)

- **Critical** — blocking a shipping workstream, causing incidents, or legally/compliance-exposed.
- **High** — regularly slows multiple teams; active source of on-call toil.
- **Medium** — occasional friction; slows one team.
- **Low** — cosmetic or rarely encountered.

## Effort (what would it cost to fix?)

- **S** — under a day, one person.
- **M** — under a week, one person, or under a day with two.
- **L** — multi-week, coordination needed.
- **XL** — quarter-scale, significant refactor or migration.

## Format in tech-debt pages

\`\`\`yaml
impact: High
effort: M
blocks: [[decisions/ADR-0042]]
\`\`\`
`,

    'wiki/meta/severity-taxonomy.md': `---
title: "Incident Severity Taxonomy"
type: meta
created: ${today()}
updated: ${today()}
---

# Incident Severity

| Sev | Definition | Response |
|---|---|---|
| **P0** | Total outage of a critical service; active customer impact at scale. | Page immediately. War room. Leadership notified within 15 min. |
| **P1** | Major degradation; significant customer impact but service partially functional. | Page primary on-call. Leadership notified within 1 hr. |
| **P2** | Minor degradation or edge-case outage; workaround exists. | Triage within business hours. Fix in the current week. |
| **P3** | No customer impact; internal-only or latent issue. | Track as a ticket. No paging. |

Every incident gets a postmortem if P0/P1 (within 5 business days), optional for P2, rarely for P3.
`,

    'wiki/meta/ownership.md': `---
title: "Component Ownership"
type: meta
created: ${today()}
updated: ${today()}
---

# Component Ownership

Authoritative mapping of components to owning teams/people. Update whenever ownership transfers — and always log the transfer in [[log]].

| Component | Team / Owner | Escalation | Last Reviewed |
|---|---|---|---|
| *(populate as components are filed into the wiki)* | | | |
`,
  },
};
