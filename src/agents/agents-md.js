import { today } from '../templates/shared.js';

const DOMAIN_SECTIONS = {
  'ai-research': aiResearchSchema,
  'competitive-intel': competitiveIntelSchema,
  'publication': publicationSchema,
  'business-ops': businessOpsSchema,
  'learning': learningSchema,
  'blank': blankSchema,
};

export function generateAgentsMd({ domain, wikiName, template }) {
  const domainSchema = (DOMAIN_SECTIONS[domain] || blankSchema)();
  return `# ${wikiName}

${PREAMBLE}

${ARCHITECTURE(domain)}

${PAGE_CONVENTIONS}

${domainSchema}

${OPERATIONS(domain)}

${INDEXING}

${LOGGING}

${GUARDRAILS}

${EVOLUTION}
`;
}

// --- Shared sections ---

const PREAMBLE = `## What This Is

This is an LLM-maintained knowledge base. You — the LLM agent — maintain the wiki. The human curates sources, directs analysis, and asks questions. You do everything else: summarizing, cross-referencing, filing, linting, flagging contradictions, maintaining indexes, and keeping the knowledge base healthy.

**The wiki is a persistent, compounding artifact.** Every source ingested and every query answered makes it richer. You never write from scratch — you build on what's already compiled.

Obsidian is the IDE. You are the programmer. The wiki is the codebase.`;

function ARCHITECTURE(domain) {
  return `## Architecture

\`\`\`
raw/          ← Immutable source material — you read, never modify
wiki/         ← LLM-compiled, LLM-maintained — you own this entirely
  index.md    ← Master table of contents (read first for every query)
  log.md      ← Append-only operation log
  meta/       ← Wiki health, coverage gaps, source stats
output/       ← Query results, drafts, visualizations
\`\`\`

**Three layers:**
- **Raw sources** — immutable. Articles, papers, transcripts, images. Your source of truth.
- **The wiki** — your domain. Summaries, entity pages, concept pages, cross-references. You create, update, and maintain everything here.
- **This schema** — operating instructions. Co-evolved by you and the human over time.`;
}

const PAGE_CONVENTIONS = `## Page Conventions

### Frontmatter

Every wiki page uses YAML frontmatter:

\`\`\`yaml
---
title: "Page Title"
type: entity              # varies by domain — see domain-specific section
created: ${today()}
updated: ${today()}
sources: 0                # count of raw sources informing this page
tags: []
confidence: medium        # high | medium | low
---
\`\`\`

### Writing Style

- **Dense and scannable.** Use headers. Use tables. No fluff.
- **Show your work.** Every claim links to a source or is marked as inference.
- **Confidence markers** (inline):
  - \`[confirmed]\` — multiple reliable sources agree
  - \`[reported]\` — single source, unverified
  - \`[inference]\` — logical deduction from evidence
  - \`[rumor]\` — unconfirmed
- **Numbers always have sources.** Never state a figure without attribution.
- Use Obsidian-style \`[[wikilinks]]\` for all internal cross-references.
- Mark potentially stale claims with \`⚠️ STALE?\` inline.

### Source Quality Tiers

- **Tier 1 — Primary:** Official announcements, filings, court docs, peer-reviewed papers
- **Tier 2 — Quality reporting:** Established press with named sources, detailed expert analysis
- **Tier 3 — Commentary:** Newsletters, substacks, credible practitioner social media
- **Tier 4 — Aggregation/rumor:** Forums, anonymous sources, unverified claims

Prefer Tier 1-2 for factual claims. Tier 3-4 inform narrative and sentiment — mark them as such.`;

function OPERATIONS(domain) {
  const isPublication = domain === 'publication';
  const hasOpportunities = ['ai-research', 'publication', 'competitive-intel'].includes(domain);

  let ops = `## Operations

### Ingest

When the human drops a new source into \`raw/\` and asks you to process it:

1. **Read the source fully.** If it has images, read text first, then view images separately.
2. **Discuss key takeaways** with the human. What's new? What does it confirm or contradict?
3. **Integrate into existing wiki pages** — don't create a separate summary-per-source. A single source typically touches 5-15 pages.
4. **Check for contradictions** — if new data conflicts with existing claims, flag it.
5. **Update \`wiki/index.md\`** — add or revise entries for changed pages.
6. **Append to \`wiki/log.md\`** — record what you did.
7. **Update frontmatter** — increment \`sources\` count, update \`updated\` date, adjust \`confidence\`.

The human prefers to ingest one source at a time and stay involved unless they say otherwise.

### Query

When the human asks a question:

1. **Read \`wiki/index.md\` first** to identify relevant pages.
2. **Read relevant pages**, following cross-references as needed.
3. **Synthesize an answer** with citations to wiki pages and raw sources.
4. **Choose the right format:** Quick answer in chat, substantial analysis in \`output/\`, comparison tables, Marp slides, or matplotlib charts.
5. **File valuable outputs back.** If the answer is durable knowledge, ask: "Worth filing into the wiki?"

### Lint

When asked to health-check the wiki:

1. Contradictions — claims that conflict across pages
2. Stale claims — \`⚠️ STALE?\` markers or claims older than 2 weeks without fresh sourcing
3. Orphan pages — no inbound links
4. Missing pages — concepts mentioned but lacking their own page
5. Missing cross-references — pages that should link but don't
6. Thin pages — fewer than 3 sources or missing key sections
7. Coverage gaps — areas with few or no pages

Output a lint report. Suggest specific actions.`;

  if (isPublication) {
    ops += `

### Issue Prep

When preparing a new issue:

1. Read the last 2-3 published issues from \`raw/issues/\`
2. Scan Recent Moves across all entity pages for the past week
3. Check narrative pages for new evidence
4. Check opportunity pages for score changes
5. Check contradictions for story angles
6. Generate a structured briefing of what moved, what matters, what's new
7. Flag potential deep dive topics

### Post-Publish

After publishing an issue:

1. Ingest the published issue into \`raw/issues/\`
2. Update entity pages with issue references
3. Update narrative pages with coverage notes
4. Track predictions or assessments for follow-up
5. Update \`wiki/meta/coverage-map.md\``;
  }

  return ops;
}

const INDEXING = `## Indexing

\`wiki/index.md\` is your primary navigation tool. It's a catalog of every page with a link, one-line summary, and metadata. Organized by category.

**Always read \`index.md\` first** when answering queries. At moderate scale (~100s of pages), this is sufficient without embedding-based search.

If QMD is available, use \`qmd query "..."\` via CLI or MCP for larger wikis.`;

const LOGGING = `## Logging

\`wiki/log.md\` is append-only. Format:

\`\`\`markdown
## [YYYY-MM-DDTHH:MM] type | Description
- Source: path/to/source
- Pages created: list
- Pages updated: list
- Notes: what happened
\`\`\`

Types: \`ingest\`, \`query\`, \`lint\`, \`issue-prep\`, \`post-publish\``;

const GUARDRAILS = `## What You Never Do

- **Never modify files in \`raw/\`.** Exception: setting \`compiled: true\` in frontmatter after processing.
- **Never delete wiki pages.** Update with corrections. Archive if truly obsolete.
- **Never invent sources.** Mark unsourced claims as \`[inference]\` or \`[unverified]\`.
- **Never skip the log.** Every operation gets a \`log.md\` entry.
- **Never skip the index.** Every new or changed page gets an \`index.md\` update.`;

const EVOLUTION = `## Evolution

This schema is a living document. As patterns emerge, suggest changes. Document agreed changes below.

### Changelog
- **${today()}:** Initial schema generated by tng-wiki CLI.`;

// --- Domain-specific sections ---

function aiResearchSchema() {
  return `## Domain: AI / Tech Research

### Page Types

**Entity pages** (\`wiki/entities/\`) — Companies, people, orgs. Include: overview, key facts, strategic position, recent moves (reverse-chronological), builder implications, contradictions, cross-references.

**Protocol pages** (\`wiki/protocols/\`) — Standards and specifications. Include: what it does, who's behind it, adoption status, technical summary, builder implications.

**Stack layer pages** (\`wiki/stack/\`) — Infrastructure layers (compute, models, orchestration, security, identity, tooling, deployment). Include: current state, key players, recent shifts, builder implications.

**Opportunity pages** (\`wiki/opportunities/\`) — Builder opportunities, scored per \`_scoring-criteria.md\`. Include: summary, scores, the gap, who's building, revenue model, stack requirements, signal watch.

**Narrative pages** (\`wiki/narratives/\`) — Recurring themes spanning multiple sources. Include: thesis, evidence chain, counter-evidence, implications.

**Timeline pages** (\`wiki/timelines/\`) — Chronological tracking of multi-event sagas.

**Contradiction pages** (\`wiki/contradictions/\`) — Where sources disagree. Gold for analysis.`;
}

function competitiveIntelSchema() {
  return `## Domain: Competitive Intelligence

### Page Types

**Company pages** (\`wiki/companies/\`) — Intelligence profiles. Include: overview, products, funding/revenue, strategic position, recent moves, SWOT summary, signal watch.

**Product pages** (\`wiki/products/\`) — Individual product tracking. Include: what it does, pricing, market position, strengths/weaknesses, competitive alternatives.

**Market pages** (\`wiki/markets/\`) — Market segments. Include: size, growth, key players, dynamics, entry barriers.

**SWOT pages** (\`wiki/swot/\`) — Deep SWOT analyses per company. Include: strengths, weaknesses, opportunities, threats, signal watch.

**Signal pages** (\`wiki/signals/\`) — Notable events: hiring moves, product launches, funding, partnerships, regulatory actions.`;
}

function publicationSchema() {
  return `## Domain: Publication / Newsletter

### Page Types

**Entity pages** (\`wiki/entities/\`) — Companies, people, orgs. Include: overview, key facts, strategic position, recent moves, builder implications, contradictions, cross-references. Track which published issues reference each entity.

**Protocol pages** (\`wiki/protocols/\`) — Standards and specs. Include: what, who, adoption, technical summary, builder implications.

**Stack layer pages** (\`wiki/stack/\`) — Infrastructure layers. Include: current state, key players, shifts, builder implications.

**Opportunity pages** (\`wiki/opportunities/\`) — Scored per \`_scoring-criteria.md\`.

**Narrative pages** (\`wiki/narratives/\`) — Multi-issue themes. Include: thesis, evidence chain, counter-evidence, publication coverage history, unexplored angles.

**Timeline pages** (\`wiki/timelines/\`) — Multi-event sagas tracked across issues.

**Contradiction pages** (\`wiki/contradictions/\`) — Story fuel.

### Publication-Specific Frontmatter

Entity pages include: \`published_in: [001, 003, 007]\` — tracking which issues reference the entity.

Narrative pages include: \`status: active | stale | resolved\` and \`angles_explored: []\` / \`angles_remaining: []\`.`;
}

function businessOpsSchema() {
  return `## Domain: Business Operations

### Page Types

**Project pages** (\`wiki/projects/\`) — Active and completed projects. Include: status, owner, timeline, decisions made, open questions, retrospective.

**Decision pages** (\`wiki/decisions/\`) — Key decisions and their context. Include: date, participants, options considered, decision made, rationale, outcome (updated later).

**People pages** (\`wiki/people/\`) — Team members and stakeholders. Include: role, key context, involvement in projects/decisions.

**Process pages** (\`wiki/processes/\`) — How things work. Include: description, owner, dependencies, known issues.

**Retrospective pages** (\`wiki/retrospectives/\`) — What we learned. Include: date, context, what went well, what didn't, action items.`;
}

function learningSchema() {
  return `## Domain: Learning / Deep Study

### Page Types

**Concept pages** (\`wiki/concepts/\`) — Core ideas. Include: definition, explanation, examples, connections to other concepts, open questions.

**People pages** (\`wiki/people/\`) — Thinkers, researchers, authors. Include: field, key contributions, notable works, connections.

**Connection pages** (\`wiki/connections/\`) — Non-obvious links between concepts. Include: the two (or more) concepts, the connection, why it matters, sources.

**Question pages** (\`wiki/questions/\`) — Open questions to investigate. Include: the question, current best understanding, what would resolve it, priority.`;
}

function blankSchema() {
  return `## Domain: Custom

### Page Types

Define your own page types as the wiki grows. Start with simple topic pages and let structure emerge from the content.`;
}
