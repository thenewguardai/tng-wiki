import { makeIndexMd, makeLogMd, today, frontmatter } from '../shared.js';

export const aiResearchTemplate = {
  extraDirs: [
    'raw/earnings-signals',
    'raw/policy',
    'raw/repos',
    'wiki/protocols',
    'wiki/stack',
    'wiki/opportunities',
    'wiki/narratives',
    'wiki/timelines',
    'wiki/contradictions',
    'wiki/comparisons',
    'output/slides',
    'output/charts',
  ],

  indexMd: (wikiName) => makeIndexMd(wikiName, [
    { title: 'Entities', columns: ['Summary', 'Sources', 'Confidence', 'Updated'] },
    { title: 'Protocols', columns: ['Summary', 'Sources', 'Confidence', 'Updated'] },
    { title: 'Stack Layers', columns: ['Summary', 'Sources', 'Confidence', 'Updated'] },
    { title: 'Opportunities', columns: ['Tier', 'Market Size', 'Window', 'Updated'] },
    { title: 'Narratives', columns: ['Status', 'Evidence Points', 'Updated'] },
    { title: 'Timelines', columns: ['Summary', 'Updated'] },
    { title: 'Contradictions', columns: ['Summary', 'Severity', 'Updated'] },
    { title: 'Comparisons', columns: ['Summary', 'Updated'] },
  ]),

  logMd: makeLogMd,

  seedSource: {
    path: 'announcements/2026-04-04-karpathy-llm-knowledge-bases.md',
    content: `${frontmatter({
      title: 'Karpathy: LLM Knowledge Bases',
      source: 'Andrej Karpathy (@karpathy)',
      url: 'https://x.com/karpathy/status/2039805659525644595',
      date: '2026-04-03',
      clipped: today(),
      type: 'social',
      compiled: false,
      tags: ['knowledge-management', 'obsidian', 'llm-tooling', 'karpathy'],
    })}
# LLM Knowledge Bases — Andrej Karpathy

## Key Claims

- A large fraction of recent token throughput is going into manipulating knowledge (markdown + images) rather than code
- Raw sources are collected into a \`raw/\` directory, then an LLM incrementally "compiles" a wiki
- The wiki includes summaries, backlinks, concept articles, and cross-links
- At ~100 articles / ~400K words, the LLM handles Q&A without vector databases
- The LLM auto-maintains index files and brief summaries for navigation
- Outputs (markdown, Marp slides, matplotlib charts) get filed back into the wiki
- LLM "health checks" find inconsistencies, impute missing data, suggest new articles
- Future direction: synthetic data generation + fine-tuning to internalize knowledge into weights
- "There is room here for an incredible new product instead of a hacky collection of scripts"

## Tools Mentioned

- **Obsidian** — IDE frontend for viewing raw data, wiki, and visualizations
- **Obsidian Web Clipper** — browser extension to convert web articles to markdown
- **Marp** — markdown-based slide deck format with Obsidian plugin
- **matplotlib** — chart/visualization generation

## Follow-up

On April 4, 2026, Karpathy published a GitHub gist ("LLM Wiki") expanding the concept into a full architecture document — an "idea file" designed to be pasted into any LLM agent.

Gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

Key additions in the gist:
- Three-layer architecture: raw sources → wiki → schema (CLAUDE.md / AGENTS.md)
- Two special files: index.md (content-oriented catalog) and log.md (chronological operations)
- QMD recommended for search at scale (hybrid BM25 + vector + LLM re-ranking)
- Dataview plugin for dynamic queries over frontmatter
- Git for version history
- The "idea file" concept: share the idea, not the code — the recipient's agent builds it

## Significance

This post went massively viral and spawned dozens of implementations within 48 hours. It represents a shift from using LLMs primarily for code generation toward using them for knowledge compilation and maintenance. The pattern bypasses traditional RAG (vector databases, embedding pipelines) in favor of structured markdown that the LLM navigates via index files.
`,
  },

  extraFiles: {
    'wiki/opportunities/_scoring-criteria.md': `${frontmatter({
      title: 'Opportunity Scoring Criteria',
      type: 'meta',
      created: today(),
      updated: today(),
    })}
# Opportunity Scoring Criteria

## Dimensions

### Market Size
- **S** — Niche / <$100M TAM
- **M** — Meaningful / $100M–$1B TAM
- **L** — Large / $1B–$10B TAM
- **XL** — Massive / >$10B TAM

### Barriers to Entry
- **Low** — MVP in weeks, no specialized expertise required
- **Medium** — Requires domain knowledge or meaningful engineering
- **High** — Deep expertise, capital, regulatory navigation, or proprietary data

### Time to First Dollar
- **Weeks** — Revenue within 2-6 weeks
- **Months** — 2-6 months
- **Quarters** — 6-18 months

### Competitive Density
- **Empty** — Greenfield, no known players
- **Sparse** — <5 players, all early
- **Crowded** — 10+ players, some with traction
- **Saturated** — Dominated by incumbents

### Durability
- **Flash** — Window closes in <6 months
- **Cycle** — 1-3 years before commoditization
- **Structural** — Persists >3 years

## Tier Assignment

- **Tier 1 — Move Now:** 3+ strong dimensions. Highlight prominently.
- **Tier 2 — Watch Closely:** 2-3 strong dimensions with caveats. Track for catalyst events.
- **Tier 3 — Too Early or Too Late:** Market unformed or competition saturated.
`,

    'wiki/meta/coverage-map.md': `${frontmatter({
      title: 'Coverage Map',
      type: 'meta',
      created: today(),
      updated: today(),
    })}
# Coverage Map

What's well-covered vs. thin in this wiki.

## Dense Coverage
_No areas compiled yet._

## Thin Coverage
_No areas compiled yet._

## Blind Spots
_Run a lint pass to identify._
`,

    'wiki/meta/source-quality.md': `${frontmatter({
      title: 'Source Quality Guide',
      type: 'meta',
      created: today(),
      updated: today(),
    })}
# Source Quality Tiers

- **Tier 1 — Primary:** Company blogs, SEC filings, court docs, official announcements, peer-reviewed papers
- **Tier 2 — Quality reporting:** Established tech press with named sources, detailed expert analysis
- **Tier 3 — Commentary:** Newsletters, substacks, credible practitioner social media
- **Tier 4 — Aggregation/rumor:** Forums, anonymous sources, unverified claims

Always prefer Tier 1-2 for factual claims. Tier 3-4 inform narrative and sentiment — mark them as such.
`,
  },
};
