import { makeIndexMd, makeLogMd, today, frontmatter } from '../shared.js';

export const competitiveIntelTemplate = {
  extraDirs: [
    'raw/earnings-signals',
    'raw/product-launches',
    'raw/hiring-signals',
    'wiki/companies',
    'wiki/products',
    'wiki/markets',
    'wiki/swot',
    'wiki/signals',
    'wiki/comparisons',
    'output/reports',
  ],

  indexMd: (wikiName) => makeIndexMd(wikiName, [
    { title: 'Companies', columns: ['Summary', 'Sources', 'Threat Level', 'Updated'] },
    { title: 'Products', columns: ['Company', 'Category', 'Status', 'Updated'] },
    { title: 'Markets', columns: ['Summary', 'Size', 'Growth', 'Updated'] },
    { title: 'SWOT Analyses', columns: ['Company', 'Last Reviewed', 'Updated'] },
    { title: 'Signals', columns: ['Type', 'Severity', 'Updated'] },
    { title: 'Comparisons', columns: ['Summary', 'Updated'] },
  ]),

  logMd: makeLogMd,

  seedSource: null,

  extraFiles: {
    'wiki/swot/_template.md': `${frontmatter({
      title: 'SWOT Template',
      type: 'meta',
      created: today(),
    })}
# SWOT Analysis: {Company Name}

## Strengths
_What they do well. Competitive advantages. Moats._

## Weaknesses
_Where they're vulnerable. Technical debt. Talent gaps. Strategic blind spots._

## Opportunities
_Market shifts in their favor. Adjacent moves. Partnership potential._

## Threats
_Competitors. Regulation. Technology shifts. Customer churn risks._

## Signal Watch
_Events that would materially change this assessment._
`,

    'wiki/signals/_types.md': `${frontmatter({
      title: 'Signal Types',
      type: 'meta',
      created: today(),
    })}
# Signal Types

- **Hiring** — Job postings, leadership changes, team expansions/contractions
- **Product** — Launches, pivots, deprecations, pricing changes
- **Financial** — Earnings, funding rounds, capex changes, acquisitions
- **Strategic** — Partnerships, platform shifts, market entry/exit
- **Technical** — Architecture changes, open-sourcing, API changes
- **Regulatory** — Compliance moves, legal actions, policy responses
`,
  },
};
