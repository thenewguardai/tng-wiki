# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

`tng-wiki` is a Node.js CLI that scaffolds LLM-maintained knowledge bases (per Karpathy's LLM wiki pattern). **The CLI makes zero LLM calls** - it writes directory structures, agent schema files, and template content to disk. The intelligence lives in the agent that later operates on the scaffolded wiki.

Two CLAUDE.md audiences exist in this codebase and must not be conflated:

- **This file** - instructions for Claude Code working on the `tng-wiki` CLI source.
- **Generated schema files** - produced by `src/agents/agents-md.js` and written into user-scaffolded wikis. The canonical output is `AGENTS.md`; `CLAUDE.md` / `.cursorrules` are symlink aliases to it (see `schemaLayout` in `src/agents/index.js`). Those files are the product's primary output and tell a *different* agent how to maintain a wiki. When you edit `src/agents/agents-md.js`, you are editing downstream operating instructions, not this file.

## Commands

```bash
npm start                 # runs bin/cli.js (defaults to `init`)
npm test                  # run the full suite (Node's built-in runner, zero deps)
npm run smoke             # fast sanity: --check both bins + print --version
node bin/cli.js init      # scaffold a new wiki (interactive)
node bin/cli.js status    # wiki health snapshot (run in a scaffolded wiki)
node bin/cli.js doctor    # environment check (node, git, agent CLIs, qmd)
node bin/cli.js --version
```

There is **no build step** (plain ESM, `"type": "module"`) and **no linter configured**. Tests use Node's built-in runner (`node --test`, zero test dependencies) and live in `test/*.test.js`. `npm test` runs the whole suite; `npm run smoke` is a fast `--check` + `--version` pass. Both gate `prepublishOnly`, and `npm test` gates `preversion`, so a green suite is required to publish or bump. Node >=18 is required.

To exercise the `init` flow end-to-end without polluting the repo, run it against a throwaway path and inspect the output:

```bash
node bin/cli.js init        # then pick a temp path when prompted
node bin/cli.js status /tmp/scratch-wiki
```

## Architecture

The CLI has three layers, each cleanly separable:

### 1. Command dispatch (`bin/cli.js`)

A single `switch` on `argv[2]` that lazy-imports the module for whichever command ran: `init` / `status` / `doctor`; the registry commands (`register` / `unregister` / `list` / `set-default` → `registry-cli.js`); the read-only verbs (`query` / `read` / `search` / `sources` / `stale` / `orphans` / `rounds` / `ground` / `drift` / `unsourced` / `unverified` → `verbs-cli.js`); and `cite` / `connect` / `install-skill`. `help` (and `--help` / `-h`, optionally `--json`) is served from `src/help.js`'s manifest. Lazy imports keep startup fast and let `--version` / `help` avoid loading the template trees. Uncaught rejections with message `'CANCELLED'` (thrown when a `@clack/prompts` prompt is cancelled) exit 0 silently - preserve this convention if you add new commands. The second bin entry, `bin/tng-wiki-mcp.js`, exposes the read-only verbs as MCP-over-stdio tools for shell-less hosts.

### 2. Command implementations (`src/init.js`, `src/status.js`, `src/doctor.js`, `src/verbs.js`, `src/registry.js`, `src/ground.js`, `src/cite.js`, `src/lock.js`)

These do all filesystem work and terminal rendering. `runInit` is the main scaffolding flow and is the coordinator that composes the other three subsystems (agents + templates + integrations). `ROADMAP.md` notes that the renderers should eventually be split so parsing/filesystem logic returns plain objects and rendering stays thin - prefer pulling data computation into pure helpers when you touch these files. The read-only query surface lives in `src/verbs.js` (pure logic) behind `src/verbs-cli.js` (rendering) and is mirrored by the MCP server. The citation-integrity engine - `src/ground.js` (structural checks), `src/lock.js` (the per-citation content lockfile), `src/cite.js` (claim-next-to-evidence review), and `src/git-read.js` (fail-soft git plumbing via `execFileSync`) - is the project's real center of gravity; the same "pure logic returns plain objects" discipline applies.

### 3. Three pluggable subsystems

**Agents** (`src/agents/`) - produce the schema file for the scaffolded wiki.
- `agents-md.js` is the single canonical generator. `generateAgentsMd` builds the always-on `AGENTS.md` (PREAMBLE, ARCHITECTURE, PAGE_CONVENTIONS, a compact `MARKER_LEGEND`, OPERATIONS with a condensed grounding summary, INDEXING, LOGGING, GUARDRAILS, EVOLUTION, plus a per-domain block from the `DOMAIN_SECTIONS` map). The heavy, on-demand doctrine - the full three-layer grounding + reconcile protocol (`GROUNDING_DOCTRINE`) and the full marker taxonomy (`MARKER_TAXONOMY`) - is emitted separately by `generateDoctrine` into each wiki's `.tng-wiki/doctrine/` (`DOCTRINE_DIR`), so the always-on schema stays lean and just points there. The 2026-04-15 pivot (see `ROADMAP.md` milestone 1) collapsed the former per-agent generators into this one file: `AGENTS.md` is the portable schema every supported agent reads.
- `src/agents/index.js` re-exports `generateAgentsMd` and owns `schemaLayout(agent)`, which maps the agent choice (`claude-code` / `codex` / `cursor` / `all`) to the canonical `AGENTS.md` plus any alias files (`CLAUDE.md`, `.cursorrules`). `init` writes `AGENTS.md` once and symlinks the aliases to it (copying when symlink permission is unavailable).

**Templates** (`src/templates/`) - per-domain scaffolds. Each domain (`ai-research`, `competitive-intel`, `publication`, `business-ops`, `learning`, `software-engineering`, `code-archaeology`, `blank`) exports a `template` object with the same shape:
```
{ extraDirs: string[],
  indexMd: (wikiName) => string,
  logMd: (wikiName, domain) => string,
  extraFiles: { [relPath]: content },
  seedSource?: { path, content } }
```
`src/templates/shared.js` provides `makeIndexMd`, `makeLogMd`, `today`, and `frontmatter` - use these so generated files stay consistent across domains. `src/templates/index.js` is the registry; new domains are added there and in `src/init.js`'s `DOMAINS` list **and** in `src/agents/agents-md.js`'s `DOMAIN_SECTIONS` map. These three places must stay in sync.

**Integrations** (`src/integrations/`) - best-effort local setup. Each returns a structured result object (never throws) so `runInit` can render success/failure/partial states. `git.js` runs `git init` + initial commit with fallback author env vars. `qmd.js` registers the wiki as a QMD collection, returning `{ installed, configured }`. `obsidian.js` scans common vault locations to suggest a default wiki path. If you add an integration, match the "return result object, never throw" pattern - `runInit` relies on it.

## Key Conventions

- **ESM only** - use `import` / `export`, `import.meta.url` for path resolution (see `bin/cli.js` `--version` handler).
- **Terminal UI** - `@clack/prompts` for interactive prompts (`p.select`, `p.text`, `p.multiselect`, `p.spinner`) and `picocolors` for coloring. Check `p.isCancel(value)` after every prompt and throw `new Error('CANCELLED')` - `bin/cli.js` catches this and exits cleanly.
- **Zero LLM calls** - if you find yourself wanting to call an LLM from the CLI, stop. The CLI scaffolds; the agent thinks. Anything smart belongs in the generated schema file, not the CLI.
- **No network calls** during `init` beyond what integrations (git, qmd) do locally. The CLI should work offline.
- **Generated content is the product.** Template strings, schema text, and seed sources are the user-visible output - treat them with the same care as source code. Changes to wording in `src/agents/agents-md.js` or `src/templates/*/template.js` reshape what every downstream wiki agent reads.
