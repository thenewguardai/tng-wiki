# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

`tng-wiki` is a Node.js CLI that scaffolds LLM-maintained knowledge bases (per Karpathy's LLM wiki pattern). **The CLI makes zero LLM calls** — it writes directory structures, agent schema files, and template content to disk. The intelligence lives in the agent that later operates on the scaffolded wiki.

Two CLAUDE.md audiences exist in this codebase and must not be conflated:

- **This file** — instructions for Claude Code working on the `tng-wiki` CLI source.
- **Generated `CLAUDE.md` files** — produced by `src/agents/claude-code.js` and written into user-scaffolded wikis. Those are the product's primary output and tell a *different* agent how to maintain a wiki. When you edit `src/agents/claude-code.js`, you are editing downstream operating instructions, not this file.

## Commands

```bash
npm start                 # runs bin/cli.js (defaults to `init`)
node bin/cli.js init      # scaffold a new wiki (interactive)
node bin/cli.js status    # wiki health snapshot (run in a scaffolded wiki)
node bin/cli.js doctor    # environment check (node, git, agent CLIs, qmd)
node bin/cli.js --version
```

There is **no build step** (plain ESM, `"type": "module"`), **no test suite**, and **no linter configured**. Adding tests is called out in `ROADMAP.md` as outstanding hygiene. Node >=18 is required.

To exercise the `init` flow end-to-end without polluting the repo, run it against a throwaway path and inspect the output:

```bash
node bin/cli.js init        # then pick a temp path when prompted
node bin/cli.js status /tmp/scratch-wiki
```

## Architecture

The CLI has three layers, each cleanly separable:

### 1. Command dispatch (`bin/cli.js`)

A single switch statement on `argv[2]` that lazy-imports `src/{init,status,doctor}.js`. Lazy imports keep startup fast and let `--version` / `help` avoid loading the template trees. Uncaught rejections with message `'CANCELLED'` (thrown when a `@clack/prompts` prompt is cancelled) exit 0 silently — preserve this convention if you add new commands.

### 2. Command implementations (`src/init.js`, `src/status.js`, `src/doctor.js`)

These do all filesystem work and terminal rendering in one module each. `runInit` is the main flow and is the coordinator that composes the other three subsystems (agents + templates + integrations). `ROADMAP.md` notes that these should eventually be split so parsing/filesystem logic returns plain objects and rendering stays thin — prefer pulling data computation into pure helpers when you touch these files.

### 3. Three pluggable subsystems

**Agents** (`src/agents/`) — produce schema files for the scaffolded wiki.
- `claude-code.js` is the canonical generator and owns all the real schema content (PREAMBLE, ARCHITECTURE, PAGE_CONVENTIONS, OPERATIONS, INDEXING, LOGGING, GUARDRAILS, EVOLUTION plus a per-domain schema block).
- `codex.js` and `cursor.js` currently wrap `generateClaudeMd` and swap the header. `ROADMAP.md` flags this as a known limitation — they should become genuinely agent-specific. Until that lands, treat changes to `claude-code.js` as changes to *all three* outputs.
- `src/agents/index.js` maps the agent choice (`claude-code` / `codex` / `cursor` / `all`) to a filename → content dict. `all` emits all three files.

**Templates** (`src/templates/`) — per-domain scaffolds. Each domain (`ai-research`, `competitive-intel`, `publication`, `business-ops`, `learning`, `blank`) exports a `template` object with the same shape:
```
{ extraDirs: string[],
  indexMd: (wikiName) => string,
  logMd: (wikiName, domain) => string,
  extraFiles: { [relPath]: content },
  seedSource?: { path, content } }
```
`src/templates/shared.js` provides `makeIndexMd`, `makeLogMd`, `today`, and `frontmatter` — use these so generated files stay consistent across domains. `src/templates/index.js` is the registry; new domains are added there and in `src/init.js`'s `DOMAINS` list **and** in `src/agents/claude-code.js`'s `DOMAIN_SECTIONS` map. These three places must stay in sync.

**Integrations** (`src/integrations/`) — best-effort local setup. Each returns a structured result object (never throws) so `runInit` can render success/failure/partial states. `git.js` runs `git init` + initial commit with fallback author env vars. `qmd.js` registers the wiki as a QMD collection, returning `{ installed, configured }`. `obsidian.js` scans common vault locations to suggest a default wiki path. If you add an integration, match the "return result object, never throw" pattern — `runInit` relies on it.

## Key Conventions

- **ESM only** — use `import` / `export`, `import.meta.url` for path resolution (see `bin/cli.js` `--version` handler).
- **Terminal UI** — `@clack/prompts` for interactive prompts (`p.select`, `p.text`, `p.multiselect`, `p.spinner`) and `picocolors` for coloring. Check `p.isCancel(value)` after every prompt and throw `new Error('CANCELLED')` — `bin/cli.js` catches this and exits cleanly.
- **Zero LLM calls** — if you find yourself wanting to call an LLM from the CLI, stop. The CLI scaffolds; the agent thinks. Anything smart belongs in the generated schema file, not the CLI.
- **No network calls** during `init` beyond what integrations (git, qmd) do locally. The CLI should work offline.
- **Generated content is the product.** Template strings, schema text, and seed sources are the user-visible output — treat them with the same care as source code. Changes to wording in `src/agents/claude-code.js` or `src/templates/*/template.js` reshape what every downstream wiki agent reads.
