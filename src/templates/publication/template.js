import { makeIndexMd, makeLogMd, today, frontmatter } from '../shared.js';

export const publicationTemplate = {
  extraDirs: [
    'raw/earnings-signals',
    'raw/policy',
    'raw/repos',
    'raw/issues',
    'raw/deep-dives',
    'wiki/protocols',
    'wiki/stack',
    'wiki/opportunities',
    'wiki/narratives',
    'wiki/timelines',
    'wiki/contradictions',
    'wiki/comparisons',
    'output/slides',
    'output/charts',
    'output/issue-drafts',
  ],

  indexMd: (wikiName) => makeIndexMd(wikiName, [
    { title: 'Entities', columns: ['Summary', 'Sources', 'Confidence', 'Updated'] },
    { title: 'Protocols', columns: ['Summary', 'Sources', 'Updated'] },
    { title: 'Stack Layers', columns: ['Summary', 'Sources', 'Updated'] },
    { title: 'Opportunities', columns: ['Tier', 'Market Size', 'Window', 'Updated'] },
    { title: 'Narratives', columns: ['Status', 'Evidence Points', 'Updated'] },
    { title: 'Published Issues', columns: ['Date', 'Headline', 'Key Topics'] },
    { title: 'Contradictions', columns: ['Summary', 'Severity', 'Updated'] },
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
      tags: ['knowledge-management', 'llm-tooling', 'karpathy'],
    })}
# LLM Knowledge Bases — Andrej Karpathy

Karpathy describes a system where LLMs incrementally compile raw sources into a structured markdown wiki — summaries, backlinks, concept articles, cross-links — replacing traditional RAG for personal-scale knowledge bases (~100 articles, ~400K words). Outputs filed back into the wiki create a compounding knowledge base. He calls it "an incredible new product waiting to be built."

Key tools: Obsidian (frontend), Web Clipper (ingest), Marp (slides), QMD (search at scale).
Follow-up gist: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
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

- **Market Size:** S (<$100M) / M ($100M-$1B) / L ($1B-$10B) / XL (>$10B)
- **Barriers to Entry:** Low / Medium / High
- **Time to First Dollar:** Weeks / Months / Quarters
- **Competitive Density:** Empty / Sparse / Crowded / Saturated
- **Durability:** Flash (<6mo) / Cycle (1-3yr) / Structural (>3yr)

**Tiers:** 1 = Move Now (3+ strong) | 2 = Watch Closely | 3 = Too Early/Late
`,

    'wiki/meta/coverage-map.md': `${frontmatter({
      title: 'Coverage Map',
      type: 'meta',
      created: today(),
      updated: today(),
    })}
# Coverage Map

Track what's well-covered vs. thin vs. blind spots. Updated during lint passes.
`,

    'wiki/meta/editorial-calendar.md': `${frontmatter({
      title: 'Editorial Calendar',
      type: 'meta',
      created: today(),
      updated: today(),
    })}
# Editorial Calendar

Track published issues, deep dive pipeline, and topic queue.

## Published Issues
_Ingest published issues into raw/issues/ to populate this._

## Deep Dive Pipeline
_Narratives or entities with enough evidence for feature treatment._

## Topic Queue
_Ideas surfaced from lint passes, queries, and reader signals._
`,
  },
};
