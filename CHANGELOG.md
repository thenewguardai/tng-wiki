# Changelog

All notable changes to `tng-wiki` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **AGENTS.md-primary schema generation.** A single canonical `AGENTS.md` covers Claude Code (falls back to AGENTS.md when no CLAUDE.md is present), OpenAI Codex, Cursor, opencode, hermes-agent, OpenClaw, Aider, and any other agent that reads the [agents.md convention](https://agents.md/). Per-agent aliases (`CLAUDE.md`, `.cursorrules`) are created as symlinks to `AGENTS.md`, with a file-copy fallback on platforms without symlink permission. ([`9668e6e`](../../commit/9668e6e))
- **Multi-wiki registry at `~/.tng-wiki/registry.json`.** One user, many wikis. New commands: `tng-wiki register [path]`, `tng-wiki unregister <slug>`, `tng-wiki list`, `tng-wiki set-default <slug>`. `tng-wiki init` auto-registers newly scaffolded wikis; the first registered wiki becomes the default. Every scaffolded wiki gets a `.tng-wiki.json` metadata file (version, name, domain, created date) so `register` on an existing directory can recover its context. ([`75125b5`](../../commit/75125b5))
- **CLI verb surface for ambient wiki access:** `query`, `read`, `search`, `sources`, `stale`, `orphans`. Every verb accepts `--wiki <slug>` (defaults to the registry default) and `--json` (structured output for scripts and MCP wrappers). Line-oriented plain-text output by default so agents parse them fluently and Unix tools can pipe them. Zero-token-cost when idle — agents only pay when they invoke a verb. ([`8046702`](../../commit/8046702))
- **`tng-wiki-mcp` binary** — second `bin` entry in the same npm package. MCP server over stdio exposing seven tools (`list_wikis`, `query`, `read`, `search`, `sources`, `stale`, `orphans`) for agent environments without shell access: Claude Desktop, ChatGPT Desktop, Docker MCP Toolkit, web chat UIs. One `npm i -g tng-wiki` installs both binaries. Routes through the same registry as the CLI. ([`6705063`](../../commit/6705063))
- **`tng-wiki install-skill`** — writes a Claude Code skill to `~/.claude/skills/tng-wiki/SKILL.md` that teaches every Claude Code session the verb vocabulary, when to invoke each, and the typical query flow. Supports `--force` to update, `--uninstall` to remove, and `--claude-home <path>` to target a non-standard Claude config location. Claude Code picks up the skill within the current session via live change detection — no restart.
- **97-test suite** (`node --test`, zero test deps beyond the runtime) covering scaffold generation, template shape for every domain, status parsing, doctor environment checks, registry operations, CLI verbs, MCP JSON-RPC roundtrip, and integration-failure paths for git / qmd / obsidian.
- **Repo hygiene:** top-level `.gitignore` (`node_modules/`, `*.log`, `.DS_Store`); repo-level `CLAUDE.md` documenting the CLI architecture for contributors (distinct from the per-wiki `CLAUDE.md` that scaffolded wikis receive as an AGENTS.md alias).

### Changed
- **Extracted pure entry points** from the interactive command modules to make them testable without driving prompts or printing to stdout: `scaffoldWiki(root, opts)` from `runInit`, `computeStatus(root)` from `runStatus`, `runChecks(root, deps)` from `runDoctor` with injectable `commandExists` / `trimCmd` / `detectObsidian` / `nodeVersion`. `setupQmd` and `detectObsidian` accept injectable dependencies so integration-failure paths are deterministically testable.
- **README** reorganized with a "Wiki Access Verbs" section (copy-paste example for every verb) and an "Ambient Cross-Project Access" section (setup paths for terminal agents, shell-less chat-app agents, and cross-machine scenarios via git sync / SSH / HTTP / MCP).
- **ROADMAP** captures architectural decisions with commit SHAs, a "Why CLI-first and not MCP-first" rationale with research citations, and a "Distributed / remote wiki access" section.
- **`tng-wiki init` prompt hints** now describe the AGENTS.md + alias model rather than the old three-parallel-generators model.

### Removed
- Per-agent schema generators (`src/agents/codex.js`, `src/agents/cursor.js`). Superseded by the AGENTS.md + symlink-alias model.
- Accidental `node_modules/` tracking from the initial commit (35 files).

## [0.1.0] - 2026-04-07

### Added
- Initial scaffold: `tng-wiki init` interactive flow that generates a Karpathy-pattern LLM-maintained knowledge base (`raw/` + `wiki/` + `output/` + agent schema file).
- Six domain templates: **AI / Tech Research**, **Competitive Intelligence**, **Publication / Newsletter**, **Business Operations**, **Learning**, **Blank** — each with tailored directory layouts, index schemas, log formats, and (where applicable) a seed source and scoring criteria.
- Three per-agent schema generators (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`) produced by string-replacement header-swapping on a shared core. Superseded by the AGENTS.md-primary model in the next release.
- Integrations: **Git** (auto-`init` + first commit on scaffold), **QMD** (collection registration + context metadata when `qmd` is installed), **Obsidian** (vault-location detection for sensible default paths).
- `tng-wiki status` — wiki health snapshot (markdown counts, stale markers, last logged operation).
- `tng-wiki doctor` — environment check for agent CLIs, QMD, Obsidian location, and git.
