# tng-wiki

**Scaffold an LLM-maintained knowledge base in under 10 minutes.**

Built by [The New Guard](https://thenewguard.ai). Inspired by [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

```
npx tng-wiki init
```

## What This Does

You pick a domain. You pick an agent. You get a structured wiki scaffold — directory layout, agent operating instructions, index, log, scoring frameworks, and a seed source ready for your first compile. Open it in Obsidian, point your agent at it, and go.

**The CLI makes zero LLM calls.** It scaffolds files and configures tools. Your agent is the intelligence.

## Why This Exists

Karpathy described the pattern. Dozens of people built Claude Code plugins. Nobody built the thing that gets a builder from "I just read about this" to "working wiki scaffold" in 10 minutes — with domain-specific templates, agent-agnostic schemas, and QMD-ready setup.

This is that thing.

## Quick Start

```bash
npx tng-wiki init
```

The interactive flow asks four questions:

1. **Domain** — AI Research, Competitive Intel, Publication, Business Ops, Learning, or Blank
2. **Agent** — Claude Code, OpenAI Codex, Cursor, or all three
3. **Location** — where to create the wiki (suggests a default path from common Obsidian locations)
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
├── AGENTS.md         ← Canonical agent operating instructions
├── CLAUDE.md         ← Symlink → AGENTS.md (for Claude Code)
├── .cursorrules      ← Symlink → AGENTS.md (for Cursor)
└── .gitignore
```

Open in Obsidian. Drop your first sources into `raw/`. Then:

```bash
# Claude Code
cd your-wiki && claude "Read AGENTS.md, then ingest the sources in raw/"

# OpenAI Codex
cd your-wiki && codex "Read AGENTS.md, then ingest the sources in raw/"
```

The agent reads the schema, processes the source, builds wiki pages, updates the index, and logs the operation. The CLI gives you the scaffold; the agent runs the workflow.

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

`AGENTS.md` is the canonical schema file — the [agents.md](https://agents.md/) convention is read natively by Claude Code, OpenAI Codex, Cursor, opencode, hermes-agent, OpenClaw, Aider, and others. `tng-wiki init` always writes `AGENTS.md` and creates per-agent filename aliases (symlinks where the filesystem supports them, file copies otherwise) so each agent finds the file it expects to find.

| Agent | File it reads | How `tng-wiki` provides it |
|-------|--------------|----------------------------|
| Claude Code | `CLAUDE.md` | Symlink → `AGENTS.md` |
| OpenAI Codex | `AGENTS.md` | Direct |
| Cursor | `.cursorrules` | Symlink → `AGENTS.md` |
| opencode / hermes-agent / OpenClaw / Aider / others | `AGENTS.md` | Direct |

One schema, every agent. Edit `AGENTS.md`; every alias sees the change.

## Commands

```bash
tng-wiki init                 # Scaffold a new wiki (interactive)
tng-wiki register [path]      # Register an existing wiki in the user registry
tng-wiki unregister <slug>    # Remove a wiki from the registry (files untouched)
tng-wiki list                 # List registered wikis (★ marks the default)
tng-wiki set-default <slug>   # Set the default wiki
tng-wiki status               # Basic wiki health snapshot
tng-wiki doctor               # Environment check: agent CLIs, QMD, Obsidian, git
tng-wiki help                 # Show help
```

## The Registry — one user, many wikis

`tng-wiki` keeps a user-level registry at `~/.tng-wiki/registry.json` listing every wiki you've scaffolded or registered. `init` adds new wikis automatically; the first becomes the default.

```bash
tng-wiki list
#   ★ ai-research    ai-research    ~/Documents/Obsidian/ai-research-wiki
#     comp-intel     competitive-intel  ~/work/comp-intel-wiki
```

The registry is the foundation for ambient, cross-project access — a forthcoming MCP server (`tng-wiki-mcp`) will expose every registered wiki's `query` / `ingest` / `lint` verbs to any MCP-capable agent (Claude Code, Codex, opencode, OpenClaw, …) regardless of the directory you're working in.

## QMD Integration

[QMD](https://github.com/tobi/qmd) is a local search engine by Tobi Lütke (Shopify) that combines BM25 + vector search + LLM re-ranking, all on-device. At wiki scale beyond ~100 pages, you want it.

If you select QMD during `init` and it's installed, `tng-wiki` attempts to:
- Register your `wiki/` directory as a QMD collection
- Add context metadata for better search results

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
