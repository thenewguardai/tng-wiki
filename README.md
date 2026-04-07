# tng-wiki

**Scaffold an LLM-maintained knowledge base in under 10 minutes.**

Built by [The New Guard](https://thenewguard.ai). Inspired by [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

```
npx tng-wiki init
```

## What This Does

You pick a domain. You pick an agent. You get a fully structured wiki — directory scaffold, agent operating instructions, index, log, scoring frameworks, and a seed source ready for your first compile. Open it in Obsidian, point your agent at it, and go.

**The CLI makes zero LLM calls.** It scaffolds files and configures tools. Your agent is the intelligence.

## Why This Exists

Karpathy described the pattern. Dozens of people built Claude Code plugins. Nobody built the thing that gets a builder from "I just read about this" to "working wiki" in 10 minutes — with domain-specific templates, agent-agnostic schemas, and QMD search out of the box.

This is that thing.

## Quick Start

```bash
npx tng-wiki init
```

The interactive flow asks four questions:

1. **Domain** — AI Research, Competitive Intel, Publication, Business Ops, Learning, or Blank
2. **Agent** — Claude Code, OpenAI Codex, Cursor, or all three
3. **Location** — where to create the wiki (auto-detects Obsidian vaults)
4. **Integrations** — Git and/or QMD hybrid search

Then it scaffolds everything:

```
your-wiki/
├── raw/              ← Drop sources here (immutable)
├── wiki/             ← LLM-compiled, LLM-maintained
│   ├── index.md      ← Master table of contents
│   ├── log.md        ← Append-only operations log
│   └── ...           ← Domain-specific directories
├── output/           ← Query results, drafts, slides
├── CLAUDE.md         ← Agent operating instructions
└── .gitignore
```

Open in Obsidian. Drop your first sources into `raw/`. Then:

```bash
# Claude Code
cd your-wiki && claude "Read CLAUDE.md, then ingest the sources in raw/"

# OpenAI Codex
cd your-wiki && codex "Read AGENTS.md, then ingest the sources in raw/"
```

The agent reads the schema, processes the source, builds wiki pages, updates the index, and logs the operation. Your knowledge base is live.

## Domain Templates

Each template generates a tailored schema with domain-specific page types, directory structures, and workflows.

| Domain | Page Types | Special Features |
|--------|-----------|-----------------|
| **AI / Tech Research** | Entities, protocols, stack layers, opportunities (scored), narratives, timelines, contradictions | Opportunity scoring framework, source quality tiers |
| **Competitive Intel** | Companies, products, markets, SWOT analyses, signals | Signal type taxonomy, SWOT template |
| **Publication** | Everything in AI Research + issue tracking | Issue prep workflow, post-publish loop, editorial calendar |
| **Business Ops** | Projects, decisions, people, processes, retrospectives | Decision tracking, retrospective templates |
| **Learning** | Concepts, people, connections, open questions | Connection pages for non-obvious links |
| **Blank** | Topics | Minimal — structure emerges from content |

## Agent Support

The schema file is the single most important file in the wiki. It turns a generic LLM into a disciplined wiki maintainer. `tng-wiki` generates the right one for your agent:

| Agent | Schema File | Notes |
|-------|------------|-------|
| Claude Code | `CLAUDE.md` | Recommended. Karpathy uses this. |
| OpenAI Codex | `AGENTS.md` | Same content, Codex conventions. |
| Cursor | `.cursorrules` | Same content, Cursor conventions. |
| All | All three | Use if you switch between agents. |

## Commands

```bash
tng-wiki init          # Scaffold a new wiki (interactive)
tng-wiki status        # Wiki health: pages, sources, stale claims, last operation
tng-wiki doctor        # Environment check: agent, QMD, Obsidian, git
tng-wiki help          # Show help
```

## QMD Integration

[QMD](https://github.com/tobi/qmd) is a local search engine by Tobi Lütke (Shopify) that combines BM25 + vector search + LLM re-ranking, all on-device. At wiki scale beyond ~100 pages, you want it.

If you select QMD during `init` and it's installed, `tng-wiki` automatically:
- Registers your `wiki/` directory as a QMD collection
- Adds context metadata for better search results

Your agent can then use `qmd query "..."` via CLI or QMD's MCP server for search.

Install QMD: `npm i -g @tobilu/qmd`

## The Pattern

This implements Karpathy's three-layer architecture:

1. **Raw sources** → immutable. Articles, papers, transcripts, images.
2. **The wiki** → LLM-maintained. Summaries, entity pages, cross-references.
3. **The schema** → operating instructions. You and the LLM co-evolve this.

The key operations:

- **Ingest** — process a new source, integrate into existing wiki pages, update index and log
- **Query** — ask questions, get answers with citations, file valuable outputs back into the wiki
- **Lint** — health-check for contradictions, stale claims, orphans, missing pages, coverage gaps

The wiki compounds. Every source and every query makes it richer.

## Guide

Full walkthrough, architecture deep dive, and real-world usage:

**[thenewguard.ai/features/llm-wiki-guide](https://thenewguard.ai/features/llm-wiki-guide)**

## License

MIT

---

*Signal over noise. Built for builders who ship.*
*[The New Guard](https://thenewguard.ai)*
