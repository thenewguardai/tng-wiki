# Roadmap

## Architectural Direction (decided 2026-04-14, refined 2026-04-15)

Pivot from "CLAUDE.md generator" to "AGENTS.md-standard wiki scaffolder with ambient cross-project access." Motivation: AGENTS.md has consolidated as the portable schema across Claude Code, Codex, Cursor, opencode, hermes-agent, and OpenClaw; current per-directory scope blocks ambient use across the many projects a developer touches.

Five milestones, in order:

1. **AGENTS.md-primary generator.** `tng-wiki init` writes `AGENTS.md` as the canonical schema file and creates `CLAUDE.md` + `.cursorrules` as symlinks (file copies on platforms without symlink permission). Collapses the three parallel generators; covers 7+ agents with one file. **Shipped 2026-04-15 (commit 9668e6e).**
2. **Multi-wiki registry.** `~/.tng-wiki/registry.json` lists installed wikis with `{name, path, domain, registered}`. `tng-wiki register / unregister / list / set-default` commands; `init` auto-registers. Every wiki gets a `.tng-wiki.json` metadata file. **Shipped 2026-04-15 (commit 75125b5).**
3. **CLI verb surface.** `tng-wiki query / read / search / sources / stale / orphans` with `--wiki <slug>` routing through the registry. This is the ambient-access story for every terminal agent (Claude Code, Codex, opencode, OpenClaw, hermes-agent): the agent invokes tng-wiki via its Bash tool, paying zero token overhead when idle.
4. **`tng-wiki-mcp` binary (same package, second `bin` entry).** Thin MCP-over-stdio wrapper that declares each CLI verb as an MCP tool and shells out. Covers the shell-less environments the CLI cannot reach: Claude Desktop, ChatGPT Desktop, Docker MCP Toolkit, any web-only chat UI. Ships copy-paste config snippets for each target host.
5. **`tng-wiki install-skill`.** Writes `~/.claude/skills/tng-wiki/SKILL.md` that teaches Claude Code the CLI verbs (lightweight discovery, zero MCP token cost). Supports `--force` / `--uninstall` / `--claude-home`. **Shipped 2026-04-16.**

## Grounding Pipeline (in progress, 2026-04-16)

Three-layer approach to keeping wikis honest against source material and external authority.

- **Phase 1A — Schema + Marker Taxonomy + AGENTS.md workflow.** `sources:` frontmatter as YAML list, `[^raw/<path>]` inline citations, four-marker taxonomy with per-marker resolution actions, new `### Grounding` + `### Reconcile Drifts` operations. **Shipped 2026-04-16 ([`a692b94`](../../commit/a692b94)).**
- **Phase 1B+1C — `ground` verb + marker lint verbs.** `tng-wiki ground` Layer 1 structural check (5 issue classes, page-scoped, JSON output). `drift`, `unsourced`, `unverified` lint verbs mirror `stale`/`orphans`. MCP tools extended from 7 to 11. **Shipped 2026-04-16 ([`c080257`](../../commit/c080257)).**
- **Phase 1D — Docs consolidation.** README grounding section with copy-paste examples, CHANGELOG entry, skill teaches full grounding vocabulary. **Shipped 2026-04-16.**
- **Phase 2 — Semantic re-verification (agent-driven).** Documented as a workflow inside each `AGENTS.md`. Expanded triage order, per-claim outcomes, `⚠️ DRIFT?` evidence format, dependency-chain verification, batching etiquette. **Shipped 2026-04-16.**
- **Phase 3 — External validation (opt-in, expensive).** Agent cross-checks claims against live external sources, restricted to URLs cited within the raw source or per-wiki `trusted_authorities`. Never free-range web search. `.tng-wiki.json` extended with `trusted_authorities: []`. **Shipped 2026-04-16.**
- **Phase 4 — Code authorities in Layer 3.** Layer 3 split into 3A (web) and 3B (code). 3B treats a local codebase as advisory ground truth for reverse-engineering / porting / M&A-integration wikis where `raw/` holds AI-generated PRDs (fallible) and the implementation is the authority the wiki validates against. `.tng-wiki.json` gains `code_authorities: []`; frontmatter `sources:` accepts `code:<name>` entries; inline citation form `[^code:<authority>/<path>#L<start>-L<end>]` uses GitHub-style anchors for VS Code and GitHub click-through. Two new `ground` structural checks: `unknown_code_authority`, `missing_code_file`. SE template ships a scaffolded example ADR. **Shipped 2026-04-23 (v0.2.0).**

## Software Engineering & Architecture Domain

Seven-page-type template (Decisions / Components / Systems / Patterns / Incidents / Runbooks / Tech Debt) with ADR status lifecycle and supersedes chain, P0–P3 severity taxonomy, ownership register, and tech-debt impact × effort scoring grid. Uses the grounding pipeline natively. **Shipped 2026-04-16.**

### Why CLI-first and not MCP-first

Research on 2025-2026 ecosystem (Anthropic's ["Code execution with MCP"](https://www.anthropic.com/engineering/code-execution-with-mcp) Nov 2025, Armin Ronacher's ["Skills vs MCP"](https://lucumr.pocoo.org/2025/12/13/skills-vs-mcp/) Dec 2025, [onlycli.github.io benchmark](https://onlycli.github.io/OnlyCLI/blog/mcp-token-cost-benchmark/)) converged on a clear conclusion for markdown-wiki use cases:

- **Token overhead is real and measured.** Anthropic reports 98.7% token reduction (150K → 2K) moving from MCP schemas to on-demand code; one benchmark shows 32× ratio (44K MCP / 1.4K CLI) for the same task. A 6-8 tool MCP would inject 3-10K tokens per session, always on.
- **Anthropic's direction.** Skills (Oct 2025) shipped CLI-first via the Bash tool; "Code execution with MCP" proposes making MCP behave more like a CLI.
- **Security.** CLI inherits the harness's allow/deny rules — smaller, better-understood surface than long-lived MCP servers with ambient credentials. Tool-poisoning incidents (Supabase / Cursor MCP, mid-2025) are real.
- **No structured-output advantage lost.** Markdown *is* the structured output agents consume fluently.

MCP still ships (milestone 4) because shell-less environments (Claude Desktop, ChatGPT Desktop, web UIs) cannot invoke the CLI. Users pay the MCP token cost only in those environments, by opt-in.

### Distributed / remote wiki access

The recommended patterns when agent and wiki live on different machines:

1. **Git sync (99% case)** — wikis are git-tracked by default; remote machine clones.
2. **SSH + CLI (single-shot queries, no sync)** — `ssh wiki-host tng-wiki search "..."` via Bash. Zero new code.
3. **Thin HTTP wrapper (multi-user team)** — ~50 lines of `http.createServer` over the CLI verbs if SSH is impractical.
4. **MCP (shell-less remote clients)** — milestone 4 covers this.

Third-party bridges like [any-cli-mcp-server](https://lobehub.com/mcp/eirikb-any-cli-mcp-server) or [mcp2cli (reverse)](https://github.com/knowsuchagency/mcp2cli) exist for additional adapter cases; we don't need to build generic wrappers.

### Documentation rigor

Every new verb / command / integration point ships with a README entry containing:
- **What it does** (one sentence)
- **Signature** (arguments, flags, default behavior)
- **Copy-paste example** (command + expected output shape)
- **Config snippet** (for MCP hosts, skill hosts, or remote setups — whichever applies)

Split to `docs/` once README crosses ~250 lines.

## Improvement Ideas

- **Code-authority follow-ups (deferred from Phase 4).**
  - ~~Interactive `init` prompt for `code_authorities` on the Software Engineering and Blank domains.~~ **Shipped 2026-04-25.**
  - ~~Git-ref pinning: `{ name, path, ref: "v2.1.0" }` so authorities can be frozen at a specific commit/tag.~~ **Shipped 2026-04-25.**
  - `tng-wiki ground --against-code <name>` guided entry point for Layer 3B verification runs. Layer 3B is agent-driven today; a CLI shortcut would let the agent (or a human) kick off a scoped pass without prose.
  - Per-language comment-handling rules in config, for codebases where the default "ignore comments/docstrings/JSDoc" filter needs tighter language-specific treatment.
  - Line-range validation in `tng-wiki ground` — today `missing_code_file` checks path existence but not that the cited `#L<start>-L<end>` range is within the file's line count.
  - `exclude`-glob validation: flag inline citations that point at files the agent would skip per the authority's `exclude` list.
- Add a non-interactive `init` mode so the scaffold can be created from scripts and CI, not only through prompts.
- Expand `status` into a real wiki health check that can detect broken wikilinks, missing frontmatter, orphan pages, pages missing from the index, and uncompiled raw sources across more than markdown files.
- Expand the lint surface (`stale` / `orphans` are milestone 3; add `contradictions`, `coverage-gaps`, `thin-pages` as follow-ups so the full lint vocabulary in `AGENTS.md` has a CLI counterpart).
- Improve integration setup flows so Git and QMD can surface actionable remediation steps when local setup fails.
- Add example fixture outputs for each domain template to make the generated structure easier to review and document.
- Let domain templates own their full `raw/` layout. `src/init.js` currently writes a hardcoded base set (`raw/announcements`, `raw/papers`, `raw/social`, `raw/transcripts`, `raw/assets`) and then merges `template.extraDirs` on top, so a domain that wants a different raw layout has to work around the defaults instead of declaring them.

## Engineering Hygiene

- Tests now cover scaffold generation (`scaffoldWiki`), status parsing (`computeStatus`), doctor checks (`runChecks`), template shape, and integration failure handling (git / qmd / obsidian). Still needed: end-to-end test for the interactive `runInit` prompts and the summary renderer. Consider a terminal-output snapshot test for `runDoctor` / `runStatus` rendering.
- `computeStatus`, `runChecks`, and `scaffoldWiki` are extracted as pure entry points. `runInit`'s summary block and `runDoctor`'s rendering loop still mix logic and output — next refactor pass should split those too.
- Remove dead imports and other small code smells as part of regular maintenance.
- Add fixture-based regression tests for each template so template changes are intentional and reviewable.
- Standardize integration result objects so command summaries do not need to infer success from partial state. Git returns `{attempted, success, error?}`; qmd returns `{installed, configured, slug, wikiDir, error?}` — the two shapes should converge.
- Trim the repo-root `CLAUDE.md` — the Architecture and Commands sections carry nice-to-know prose (lazy-import rationale, `npm start` / `--version` mentions) that a contributor can derive from `bin/cli.js` and `package.json`. Keep the load-bearing guidance.
- Tighten `CLAUDE.md` scope around obvious commands: drop `npm start` and `--version` from the Commands section and keep only the non-obvious bits (throwaway-path testing loop, "no build/tests/linter").
