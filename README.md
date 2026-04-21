# tng-wiki

**Scaffold an LLM-maintained knowledge base in under 10 minutes.**

Built by [The New Guard](https://thenewguard.ai). Inspired by [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

```
npx tng-wiki init
```

## What You Get Out of the Box

- **7 domain templates** — AI Research, Competitive Intel, Publication, Business Ops, Learning, Software Engineering & Architecture, or Blank. Each ships a tailored schema, directory layout, and page types.
- **Agent-agnostic schema** — one canonical `AGENTS.md` with per-agent aliases (`CLAUDE.md`, `.cursorrules`) for Claude Code, OpenAI Codex, Cursor, opencode, hermes-agent, OpenClaw, Aider, and anything else that reads the [agents.md](https://agents.md/) convention.
- **Multi-wiki registry** — one user, many wikis. Reach any registered wiki from any directory by slug.
- **Wiki access verbs** — `query`, `read`, `search` (with `--include-raw` deep search), `sources` — plain-text by default, `--json` for scripts and MCP.
- **Three-layer grounding pipeline** — structural lint (`ground`), agent-driven semantic re-verification (`⚠️ DRIFT?`), and opt-in external validation under strict authority rules. Marker lint verbs: `drift`, `stale`, `unsourced`, `unverified`, `orphans`.
- **Claude Code skill** — `tng-wiki install-skill` teaches every Claude Code session the verbs and when to use them. Zero token cost until invoked.
- **MCP server** — `tng-wiki-mcp` ships alongside the CLI for shell-less agents (Claude Desktop, ChatGPT Desktop, web UIs).
- **QMD hybrid search** — optional BM25 + vector + LLM re-rank integration for wikis past ~100 pages.
- **Git + Obsidian ready** — `git init` with initial commit on scaffold; suggests a default path from common Obsidian vault locations.
- **Zero LLM calls in the CLI** — it scaffolds files and configures tools. Your agent is the intelligence.

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
| **Software Engineering & Architecture** | ADRs (with status lifecycle + supersedes chain), components, systems, patterns, incidents (P0–P3 severity), runbooks, tech debt (impact × effort scored) | ADR template, incident template, component template, severity taxonomy, ownership register, tech-debt scoring grid |
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
# Scaffolding
tng-wiki init                       # Scaffold a new wiki (interactive)

# Registry
tng-wiki register [path]            # Register an existing wiki
tng-wiki unregister <slug>          # Remove from the registry (files untouched)
tng-wiki list                       # List registered wikis (★ marks default)
tng-wiki set-default <slug>         # Set the default wiki

# Wiki access (the verbs your agent will call)
tng-wiki query      [--wiki <slug>] [--json]
tng-wiki read       <path> [--wiki <slug>] [--json]
tng-wiki search     <query> [--wiki <slug>] [--regex] [--include-raw] [--json]
tng-wiki sources    [--wiki <slug>] [--uncompiled] [--json]

# Grounding + lint (keeping the wiki honest)
tng-wiki ground     [--wiki <slug>] [--page <path>] [--json]   # structural ground-check
tng-wiki drift      [--wiki <slug>] [--json]                   # ⚠️ DRIFT?      markers
tng-wiki unsourced  [--wiki <slug>] [--json]                   # ⚠️ UNSOURCED?  markers
tng-wiki unverified [--wiki <slug>] [--json]                   # ⚠️ UNVERIFIED? markers
tng-wiki stale      [--wiki <slug>] [--json]                   # ⚠️ STALE?      markers
tng-wiki orphans    [--wiki <slug>] [--json]                   # pages with no inbound wikilinks

# Agent integration
tng-wiki install-skill              # Install the Claude Code skill (~/.claude/skills/tng-wiki)
                                    #   [--force] overwrite  [--uninstall] remove

# Diagnostics
tng-wiki status                     # Basic wiki health snapshot
tng-wiki doctor                     # Environment check: agent CLIs, QMD, git
tng-wiki help
```

## The Registry — one user, many wikis

`tng-wiki` keeps a user-level registry at `~/.tng-wiki/registry.json` listing every wiki you've scaffolded or registered. `init` adds new wikis automatically; the first becomes the default. Every registered wiki is reachable from any working directory by its slug.

```bash
tng-wiki list
#   ★ ai-research    ai-research         ~/Documents/Obsidian/ai-research-wiki
#     comp-intel     competitive-intel   ~/work/comp-intel-wiki
```

## Wiki Access Verbs

These are the commands an agent invokes (via its Bash tool) to read and navigate a wiki. They're intentionally plain-text and line-oriented by default so agents can parse them fluently and Unix tools can pipe them. Every verb accepts `--wiki <slug>` (defaults to the registry default) and `--json` (machine-readable structured output for scripts and MCP wrappers).

### `query` — read the wiki's index

Prints `wiki/index.md` for the chosen wiki. An agent's first call when answering any question about the wiki.

```bash
$ tng-wiki query
# AI Research Wiki — Index

_Last updated: 2026-04-15 | Total pages: 23 | Total sources: 41_
...

$ tng-wiki query --wiki comp-intel
# Competitive Intelligence Wiki — Index
...

$ tng-wiki query --json | jq .wiki
"ai-research"
```

### `read` — fetch a specific page

Prints the content of a wiki page by its path relative to `wiki/`. Refuses paths that escape the wiki directory.

```bash
$ tng-wiki read entities/openai.md
---
title: "OpenAI"
type: entity
...

$ tng-wiki read opportunities/wiki-mcp-server.md --wiki ai-research
...
```

### `search` — case-insensitive search across wiki pages

Prints `[wiki] path:line: matching text` (grep-compatible). Use `--regex` for regex patterns. By default searches only compiled `wiki/` content — that's the canonical distilled knowledge.

Pass `--include-raw` to **search deep** into archival `raw/` sources as well. Use this when verifying claims, consulting originals, or when a detail might live in uncompiled source material. Each hit is tagged `[wiki]` or `[raw]` so you always know which layer it came from.

```bash
$ tng-wiki search karpathy
[wiki] wiki/narratives/llm-knowledge-bases.md:12: Karpathy described the pattern
[wiki] wiki/timelines/llm-tooling-2026.md:8: Karpathy post catalyzes wave of clones

$ tng-wiki search karpathy --include-raw
[wiki] wiki/narratives/llm-knowledge-bases.md:12: Karpathy described the pattern
[raw]  raw/announcements/2026-04-04-karpathy-llm-knowledge-bases.md:5: "There is room here for an incredible new product..."

$ tng-wiki search "v\d+\.\d+\.\d+" --regex --wiki ai-research
[wiki] wiki/entities/anthropic.md:42: Claude 4.6 (released v4.6.0)

$ tng-wiki search karpathy --include-raw --json | jq '.hits | group_by(.source) | map({source: .[0].source, count: length})'
[{"source": "raw", "count": 3}, {"source": "wiki", "count": 2}]
```

### `sources` — list raw source files

Enumerates everything under `raw/` with `compiled` status from frontmatter. `--uncompiled` filters to sources the wiki hasn't ingested yet — useful for an agent to drive the ingest loop.

```bash
$ tng-wiki sources --uncompiled
[uncompiled] raw/announcements/2026-04-15-openai-new-model.md  — OpenAI announces GPT-6
[uncompiled] raw/papers/2026-karpathy-followup.md              — Karpathy on LLM knowledge compounding

$ tng-wiki sources --json | jq '.sources | map(select(.compiled == false)) | length'
2
```

### `stale` — list pages with `⚠️ STALE?` markers

```bash
$ tng-wiki stale
wiki/entities/anthropic.md    (3 markers)
wiki/opportunities/ide-for-agents.md  (1 marker)
```

### `orphans` — pages with no inbound wikilinks

Lists pages nothing else in the wiki links to (excluding structural pages `wiki/index.md` and `wiki/log.md`). Helpful for linting coverage — a well-connected wiki has few orphans.

```bash
$ tng-wiki orphans
wiki/entities/some-forgotten-entity.md
wiki/opportunities/_scoring-criteria.md
```

## Grounding — keeping the wiki honest over time

LLM-maintained wikis drift. Claims age, sources update, confidence inflates past the evidence, citations go stale. `tng-wiki` ships a three-layer grounding pipeline to catch and reconcile drift without auto-repairing its way into deeper errors.

**Schema invariant:** every wiki page carries a frontmatter `sources:` list of raw paths, and every factual claim cites one of them inline using footnote syntax:

```markdown
---
sources:
  - raw/announcements/2026-anthropic-series-f.md
  - raw/papers/anthropic-origins.md
---

Anthropic raised $8B in Series F.[^raw/announcements/2026-anthropic-series-f.md]
The company was founded in 2021.[^raw/papers/anthropic-origins.md]
```

The `sources:` list is the trust anchor. Every grounding workflow walks it. The four markers (`⚠️ STALE?`, `⚠️ UNSOURCED?`, `⚠️ UNVERIFIED?`, `⚠️ DRIFT?`) are documented with specific resolution actions inside every generated `AGENTS.md` — agents follow those instructions, not a README.

### Layer 1 — `ground` (structural, zero-LLM)

```bash
$ tng-wiki ground
wiki/entities/openai.md
  empty_sources: empty or missing frontmatter `sources:`
wiki/entities/anthropic.md
  missing_raw: cited raw file does not exist → raw/papers/deleted.md (line 12)
  undeclared_cite: cited inline but not in frontmatter `sources:` → raw/social/tweet.md (line 8)
  source_updated_after_page: raw source modified after page `updated` (page 2026-02-01, source 2026-04-15)

3 issue(s) across 2 page(s), 47 scanned

$ tng-wiki ground --page entities/openai.md          # scope to one page
$ tng-wiki ground --json | jq '.issues | group_by(.issue)'    # structured for agents + scripts
```

Detects five classes of structural issue: empty/missing `sources:`, inline citations pointing at non-existent raw files, undeclared citations (inline but not in frontmatter), orphan declarations (frontmatter-only, never cited), and raw sources whose mtime is newer than the page's `updated` date. Skips `wiki/index.md`, `wiki/log.md`, `_`-prefixed template files, and `wiki/meta/*`.

### Layer 2 — semantic re-verification (agent-driven)

Agents re-read raw sources, compare against wiki claims, and emit `⚠️ DRIFT?` markers where they diverge:

```markdown
Claim that may have drifted.[^raw/papers/source.md] ⚠️ DRIFT?
[source: raw/papers/source.md says "released Q2 2026";
 wiki says "released Q1 2026";
 suggested: "released Q2 2026"]
```

The marker is self-contained evidence. Reconcile interactively:

```bash
$ tng-wiki drift
wiki/entities/anthropic.md  (2 markers)
wiki/entities/openai.md  (1 marker)
```

The agent walks each marker with the user — **accept / edit / reject / defer** — and removes it on resolution. Never auto-apply.

The full Layer 2 workflow (triage order, per-claim outcomes, dependency chains between wiki pages, batching etiquette for large runs) is documented in every generated `AGENTS.md` under `## Operations → ### Grounding → Layer 2`. Agents follow that guidance directly.

### Layer 3 — external validation (opt-in)

When you ask an agent to check claims against live external authority, it uses `WebFetch` / `WebSearch` under strict authority rules — never free-range search, which is where confident-wrong creeps in.

**Authority priority**, highest first:

1. URLs cited within the raw source itself (the primary trust chain).
2. Domains listed in the wiki's `.tng-wiki.json` under `trusted_authorities`:

   ```json
   {
     "version": 1,
     "name": "AI Research Wiki",
     "domain": "ai-research",
     "trusted_authorities": ["docs.anthropic.com", "openai.com", "arxiv.org"]
   }
   ```
3. Explicit sources the user names in the ground-check request.

Empty `trusted_authorities` (the default on `init`) means Layer 3 can only reach URLs cited in raw sources. Opt in per-wiki when you want your agent to consult specific authorities automatically.

Outcomes map to three actions — confirm (no marker), external-wiki agree / external-raw disagree (`⚠️ STALE?` on raw, flag for re-ingest), external-wiki disagree (`⚠️ DRIFT?` with both raw and external quotes for reconcile). Full workflow lives in `AGENTS.md → ### Grounding → Layer 3`.

### Marker lint verbs

```bash
$ tng-wiki stale        # ⚠️ STALE?       (time-based, human/agent-written)
$ tng-wiki unsourced    # ⚠️ UNSOURCED?   (ground Layer 1)
$ tng-wiki unverified   # ⚠️ UNVERIFIED?  (ground Layer 1)
$ tng-wiki drift        # ⚠️ DRIFT?       (Layer 2/3)
```

All accept `--wiki <slug>` and `--json`. Output shape is `path (N markers)` for parity with the existing `stale`/`orphans` verbs.

## Ambient Cross-Project Access

Once your wiki is registered, it's reachable from any project you're working in. How to plumb it into your agent depends on whether the agent has shell access.

### Terminal agents (Claude Code, Codex, opencode, OpenClaw, hermes-agent)

These can invoke `tng-wiki` directly via their Bash tool. No MCP server, no schema tokens burned per session — the agent pays nothing until it actually uses a verb.

**Claude Code — install the skill (recommended):**

```bash
tng-wiki install-skill
# ✓ Installed tng-wiki skill → ~/.claude/skills/tng-wiki/SKILL.md
```

This writes a Claude Code skill that teaches every future session the verbs and when to use them. Claude Code picks it up within the current session via live change detection (no restart). You can invoke the skill directly with `/tng-wiki` or let Claude load it automatically when your question matches the skill description. Re-run with `--force` to update after an upgrade, or `--uninstall` to remove.

**Other terminal agents** — drop a one-liner in your project's `AGENTS.md`:

```markdown
## Knowledge Base

Your long-term memory is a tng-wiki. Start any research task with
`tng-wiki query` to see the index. Use `tng-wiki search <term>` and
`tng-wiki read <path>` to navigate. Pass `--wiki <slug>` to target
a specific registered wiki (list them with `tng-wiki list`).
```

### Shell-less / chat-app agents (Claude Desktop, ChatGPT Desktop, web UIs)

These can only call MCP servers — no Bash. `tng-wiki-mcp` ships alongside `tng-wiki` (same `npm i -g tng-wiki` installs both) and exposes seven MCP tools: `list_wikis`, `query`, `read`, `search`, `sources`, `stale`, `orphans`. Each tool routes through the registry so every wiki you've registered is reachable by slug.

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "tng-wiki": {
      "command": "tng-wiki-mcp",
      "args": []
    }
  }
}
```

Restart Claude Desktop. The tools appear under the server name `tng-wiki`.

**Claude Code** (you'd only enable this if you want MCP specifically rather than the direct CLI, which is usually more token-efficient) — `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "tng-wiki": { "command": "tng-wiki-mcp" }
  }
}
```

**Codex / opencode / OpenClaw** — each has its own MCP config file (`~/.codex/mcp.json`, `~/.config/opencode/mcp.json`, `~/.openclaw/openclaw.json → mcp.servers`). Same shape.

**Docker MCP Toolkit** — add a custom server pointing at your installed binary. See [Docker's MCP Toolkit CLI docs](https://docs.docker.com/ai/mcp-catalog-and-toolkit/cli/).

> **Why you'd use CLI over MCP when you have the choice:** MCP tool schemas are injected into the agent's context every session. Typical cost is 3-10K tokens for a 7-tool server, paid whether you use it or not. The CLI path pays zero tokens until you invoke a verb. So: use CLI in shell-capable environments, MCP only where CLI isn't reachable.

### Cross-machine (wiki on one box, agent on another)

- **Git sync** — the wiki is git-tracked; `git clone` on the remote machine and `git pull` to keep fresh. Natural versioning, offline-friendly.
- **SSH + CLI** — `ssh wiki-host "tng-wiki search karpathy --wiki ai-research"` for ad-hoc queries without a full clone.
- **Thin HTTP wrapper** — wrap the CLI in ~50 lines of `http.createServer` if you want multiple remote agents hitting one wiki without SSH.
- **MCP for remote chat-app agents** — same `tng-wiki-mcp` binary; run it on the wiki host and point remote MCP clients at it.

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
