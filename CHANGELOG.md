# Changelog

All notable changes to `tng-wiki` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-06-10

### Added
- **Per-citation content lockfile** (`wiki/.tng-wiki.lock.json`, committed). `tng-wiki ground` reports per-citation churn instead of per-file churn: `cite_content_changed` (the surgical re-verification queue), `cite_moved` (content identical, `#L` anchor shifted — auto-repair with `ground --fix-moved`), `cite_moved_ambiguous`, and `cite_unlocked`. `ground --update-lock` blesses verified state; each run records which SHA every authority ref resolved to (plus a dirty flag), so branch refs become deterministic — "verified against `develop@5e36f17`" — without forcing SHA refs. Never created implicitly. (#14)
- **`tng-wiki cite show <page>`** — claim-next-to-evidence review in one command: every citation rendered with the claim sentence that carries it and the exact cited source lines (raw and code-authority cites; `--at-ref`, `--cite <n|key>`, `--context <lines>`, `--json`). Citations are containment-checked — a cite that resolves outside the wiki or authority root errors (`path_escapes_root`) instead of reading the file. (#19)
- **`lead_archives`** — first-class config for external, untrusted doc archives (`.tng-wiki.json → lead_archives`). Leads are searchable (`search --include-leads`, hits tagged `[lead:<name>]`; MCP parity via `include_leads`) but structurally non-citable: `cited_lead_archive` is an error-level ground finding, and `leads:` frontmatter provenance gets warn-level `missing_lead` / `unknown_lead_archive`. Generated AGENTS.md gains a "Leads, Never Sources" section when archives are configured; `init` supports them via wizard and repeatable `--lead <name>=<path>`. (#15)
- **New zero-LLM lint findings on the ground surface:** `index_header_drift` (the `wiki/index.md` scaffold header's page count/date vs reality, computed with two batched git calls), plus warn-level `frontmatter_updated_stale` (page file changed after its frontmatter `updated`, +1-day grace) and `prose_internal_ref` (internal pages referenced in prose instead of `[[wikilinks]]`, with a suggested fix). `rounds` counts warn-level findings under a new `convention` bucket. (#18, #21)
- **`code-archaeology` domain** — the reverse-engineering scaffold: `wiki/meta/` seed pages (glossary, ecosystem, project-status, open-threads, patterns), frozen `deliverables/` with DISCOVERY/ANALYSIS/DESIGN/NOTES skeletons (NOTES carries the rejection-log table), `_inbox/`, `raw/samples|specs|scripts`, and an AGENTS domain section teaching the verification-first flow. `init` strongly suggests configuring `code_authorities` for this domain. (#22)
- **`~` expansion and path portability.** `.tng-wiki.json` paths expand a leading `~` via a shared resolver (`src/paths.js`); malformed (non-string/empty) paths now fail loudly instead of silently resolving to the wiki root. Interactive `init` offers to convert absolute authority paths to portable relative form; headless `init` gains repeatable `--code-authority <path>` (absolute paths warn on stderr). `doctor` shows each authority's path form, existence, and a portability warning. (#16)
- **`ground` warns when checking the working tree of a ref'd authority** on plain (non `--at-ref`) runs — one line per authority on stderr, `warnings: [{ code: 'working_tree_of_ref_authority', … }]` in `--json` — so the pin-not-checked case is never silent. Generated AGENTS.md now distinguishes tag/SHA refs (true pins) from branch refs (tracks). (#17)
- **`doctor` version block** — installed vs latest on npm (2s timeout, `unreachable` offline, never fails) vs the new optional `.tng-wiki.json` `pinned_version` (semver range, no new dependency), with ✓/⚠/ℹ annotations; also detects a stale installed skill (`⚠ skill is stale — run tng-wiki install-skill`). `init` suggests `pinned_version` for engineering-shaped domains. (#24)
- **`read` accepts every natural page reference**, tried in order: the exact path relative to `wiki/` (fast path), the same with `.md` appended, the input minus a leading `wiki/` prefix (both forms), and finally a unique page-stem match (`[[wikilink]]` wrapping, aliases, and anchors stripped; case-insensitive; Windows `\` separators normalized). Zero matches error with the forms tried; ambiguous stems error with the candidate list. The `../` escape guard applies to every normalized form. The MCP `read` tool inherits the same normalization. (#20)
- **`status` is registry-aware** — it resolves the registered default like `query` does, accepts `--wiki <slug>` from any cwd, keeps the explicit-path argument as a registry bypass (passing both errors), and gained `--json` for structured output. (#20)
- **Docs: two canonical flows.** README documents ingest-first (markers as the health surface) vs verification-first (the rejection log as the audit surface — *"we verified it" without a list of what failed verification is evidence nothing was looked for*); generated AGENTS.md names the option; `rounds` counts `deliverables/*_NOTES_*.md` rejection logs as an informational line. (#23)

### Changed
- Bare `tng-wiki status` now reports the registered **default wiki** rather than the current directory; pass a path (`tng-wiki status .`) for the old behavior. (#20)
- `scaffoldWiki` writes the index header's `Total pages:` to the template's real initial page count, so domains shipping seeded meta pages lint clean on day 0. (#18)
- `tng-wiki ground` may surface new findings on existing wikis after upgrade (`index_header_drift`, warn-level convention findings, lead-archive findings where configured). Warn-level findings never change exit codes. (#18, #21, #15)

## [0.5.0] - 2026-06-05

### Added
- **`tng-wiki help --json` — a machine-readable command manifest.** Every command with its group, summary, usage, args, flags, and examples, plus `conventions`, `globalFlags`, and an `onboarding` block of copy-pasteable create / adopt / register / connect recipes. One call gives an agent the whole surface instead of probing each verb with `--help`.
- **Consistent `--help` on every command** (human) and `--help --json` (structured); `tng-wiki help <command>` also works. Help, per-command help, and the manifest are all driven from one spec (`src/help.js`) so they can't drift — guarded by a parity test against the CLI dispatch table.
- **`tng-wiki doctor` now orients you.** It reports registry state and whether the Claude Code skill is installed, and prints the **recommended next command** for the current directory (create / adopt / register / query). Add `--json` for the structured form.
- **Skill + generated `AGENTS.md` gained a setup section** — how to create, adopt, register, and connect a wiki (not just query/maintain one), so an agent onboarding a fresh machine doesn't have to probe.

### Changed
- Top-level `tng-wiki help` is generated from the command spec (always in sync) and includes an "Agent quick start" pointer to `help --json` and `doctor`. The hand-maintained help block and `init`'s separate help text are gone.

## [0.4.0] - 2026-06-03

### Added
- **`tng-wiki connect <repo>`** — make agent sessions in *other* repos aware of a registered wiki. Writes a managed nudge block into a local agent file (`CLAUDE.local.md` for Claude Code, `AGENTS.local.md` for Codex) telling sessions to search the wiki before re-deriving knowledge and to hand keepable output back to it. The file is added to the repo's `.git/info/exclude` (not the tracked `.gitignore`), so it stays per-machine and out of shared history. Idempotent (re-running updates the block in place), `--remove` deletes it, `--wiki`/`--agent` select the wiki and file flavor. (#10)
- **`tng-wiki rounds`** — a zero-LLM maintenance dashboard: counts of uncompiled sources plus `ground` / `orphans` / `unsourced` / `unverified` / `stale` / `drift`. The CLI anchor for the named "rounds" ritual. (#11)
- **"Rounds" as a first-class operation** in the generated `AGENTS.md` (`### Rounds`), the Claude Code skill (`SKILL.md` trigger phrases + a Rounds section), and the README — defining the maintenance bundle so an agent runs it from one phrase ("do your rounds"). (#11)
- **`.tng-wiki.json` gains an optional `description`** field, surfaced by `connect` into other repos' agent files. The `init` epilogue now points at `connect` and `install-skill`. (#10)

### Fixed
- **Marker lint verbs (`stale` / `drift` / `unsourced` / `unverified`) now honor the `ground` exemptions** (`_`-prefixed templates, `wiki/meta/*`), so a fresh scaffold's own example markers no longer surface as findings — and `rounds` reads clean on a new wiki. (extends #5)

## [0.3.2] - 2026-06-03

### Added
- **Non-interactive `init`** — `tng-wiki init --yes --dir <path>` (with optional `--domain`, `--agent`, `--name`, `--git`/`--qmd`/`--no-integrations`) scaffolds a wiki without prompts, so an agent can run it headless. `init --help` now prints usage, unknown flags error instead of being swallowed into the wizard, and a non-TTY `init` without `--yes` fails fast rather than hanging on the prompt. (#3, #4)
- **`--into-existing` (alias `--adopt`)** — adopt tng-wiki into a non-empty directory: existing files are preserved (and reported as skipped), and an existing `.gitignore` is merged rather than overwritten. (#4)

### Fixed
- **`orphans` honors the same exemptions as `ground`** (`_`-prefixed templates, `wiki/meta/*`) — a fresh scaffold reports zero orphans instead of flagging its own seed files. (#5)
- **Generated `.gitignore` now covers `node_modules/` and secrets** (`.env`/`*.env`, `.secrets/`, `*.pem`, `*.key`). (#6)
- **`init` trims the target-directory answer** — a pasted leading space no longer scaffolds into a space-named directory inside the current repo. (#7)
- **Registry overwrite guard** — when a slug already points at a different path, the wizard prompts before replacing, non-interactive `--yes` requires `--force`, and either path prints an explicit "Replacing registry entry ..." line instead of silently flipping it. (#8)

## [0.3.1] - 2026-06-03

### Fixed
- **Raw-source staleness (`source_updated_after_page`) now uses the cited raw file's git commit-date** instead of filesystem mtime, compared at date granularity. `git clone` / `checkout` resets mtimes, which previously made every raw-cited page look stale after syncing a wiki to another machine; commit-dates are stable across clones. The date-granularity comparison also stops a same-day source edit from flagging a freshly-distilled page. Falls back to mtime when the wiki is not a git repo or the file is untracked.

## [0.3.0] - 2026-06-03

### Added
- **`tng-wiki ground` now enforces `exclude` and (opt-in) `ref`.** Two always-on structural checks: `excluded_code_file` (an inline `[^code:name/file]` whose file matches the authority's `exclude` globs) and `code_line_out_of_range` (a `#L<start>-L<end>` anchor that exceeds the cited file, or an inverted range). A new `--at-ref` flag resolves code citations at each authority's pinned `ref` via git instead of the working tree, adding `missing_code_file` at the ref, `code_updated_after_page` (the ref-side parallel to raw mtime staleness), and `code_ref_unresolvable` (ref or repo unresolvable, reported once per authority). Default `ground` stays working-tree-based by design. The MCP `ground` tool gains an `at_ref` boolean. Implemented with a dependency-free glob matcher (`src/glob.js`) and pure git readers (`src/git-read.js`).
- **Interactive `init` prompt for `code_authorities`** on the Software Engineering and Blank domains. After the existing prompts, `tng-wiki init` asks whether you have a reference codebase to ground against. If yes, it loops collecting `{ name, path, description?, language?, exclude?, ref? }` per authority — name defaults to the path basename, exclude globs default per language hint (TypeScript/JavaScript, Python, Go, Rust, or generic), and the loop offers "add another?" so multi-authority wikis are first-class. Closes the dogfood gap where users had to hand-edit `.tng-wiki.json` after every `init`.
- **`code_authorities[].ref` — optional git-ref pinning.** Each authority entry now accepts a `ref` field (branch, tag, or commit SHA). When set, the maintaining agent reads via `git -C <path> show <ref>:<file>` (and `ls-tree`/`grep` against `<ref>`) instead of the working tree, so the user's checkout state — stashed changes, branch switches, uncommitted work — does not contaminate grounding. Layer 1 (`tng-wiki ground`) still always checks the working tree by design; ref-vs-working-tree mismatches surface during Layer 3B verification with file-not-found at the pinned ref handled gracefully. AGENTS.md Layer 3B documents the full procedure.

### Changed
- `tng-wiki ground` may surface new issues on existing wikis after upgrade: a page citing an `exclude`d code file (e.g. `[^code:app/README.md]` against an authority that excludes `**/*.md`) or an out-of-range `#L` anchor now reports `excluded_code_file` / `code_line_out_of_range`. These flag citations that were already wrong; correct citations are unaffected. The `--at-ref` checks are opt-in and never change default output.

## [0.2.0] - 2026-04-23

### Added
- **Grounding Pipeline — Phase 4: Code authorities as a Layer 3 target.** Layer 3 splits into 3A (web) and 3B (code). 3B treats a local codebase as advisory ground truth, built for reverse-engineering, porting, and M&A / IP-acquisition workflows where `raw/` holds AI-generated Discovery docs (PRDs, overviews, implementation guides) that may hallucinate and the real implementation is what the wiki needs to validate against.
  - **`.tng-wiki.json` gains `code_authorities: []`** — each entry `{ name, path, description?, exclude?, language? }`. `name` is the short handle used in citations; `path` is the tree root relative to the wiki; `exclude` is gitignore-style globs for the agent to honor; `language` is an optional hint.
  - **Inline citation form** — `[^code:<authority>/<path>[#L<start>[-L<end>]]]`. GitHub-style `#L` anchors: clickable in VS Code (opens the file on the cited line) and GitHub preview. Pair with `[^raw/...]` when both apply — raw is where the page learned the claim, code is the ground truth that verifies it.
  - **Frontmatter `sources:`** — extended to accept `code:<name>` entries alongside `raw/<path>`. Invariant preserved: every inline citation must be declared in frontmatter, and `tng-wiki ground` enforces it for both kinds.
  - **`tng-wiki ground` gains two structural checks** — `unknown_code_authority` (cited authority not in `.tng-wiki.json`) and `missing_code_file` (cited file path doesn't resolve on disk).
  - **Layer 3B workflow in AGENTS.md** — tool selection (Read/Grep/Glob, not WebFetch), scope filter (disregard comments/docstrings/JSDoc and all markdown/text inside the tree), advisory precedence (disagreement is `⚠️ DRIFT?` for reconcile, never auto-applied), extended DRIFT marker with `code:` evidence line, and graceful handling of missing paths / excluded-everything / cited-file-gone / conflicting authorities.
  - **Software Engineering template** ships a scaffolded ADR — `wiki/decisions/_adr-code-authority-example.md` — that documents the pattern end-to-end with config snippet, citation form, and consequences/alternatives.
- **Software Engineering & Architecture domain.** New `init` template for engineering teams. Seven page types: ADRs (with `proposed → accepted → deprecated → superseded` status lifecycle and `supersedes:` / `superseded-by:` relation tracking), components (owner, SLOs, dependencies), systems (higher-level groupings), patterns (when to use / tradeoffs), incidents (P0–P3 severity, timeline, root cause, action items), runbooks, tech debt (impact × effort scored). Ships with ADR/component/incident templates, tech-debt scoring grid, severity taxonomy, and an ownership register. Seed source is an actual ADR from this project ("Adopt AGENTS.md as canonical agent schema"). Uses the grounding pipeline natively from day one.
- **Grounding pipeline — Phases 2 & 3 (agent-driven workflows in `AGENTS.md`).** Layers 2 (semantic re-verification) and 3 (external validation) are specified as detailed agent procedures rather than CLI code — because the semantic work requires an LLM and the CLI principle is "zero LLM calls." Every domain's generated `AGENTS.md` now includes:
  - **Layer 2 triage order** (pages flagged by Layer 1 first, then recent un-logged edits, then oldest/most-cited, then `[confirmed]`-heavy).
  - **Four per-claim outcomes** (Supported / Partially supported — downgrade confidence / Drifted — `⚠️ DRIFT?` marker / Unsourceable — `⚠️ UNSOURCED?`).
  - **`⚠️ DRIFT?` evidence format** — self-contained source quote + current claim + suggested fix so reconcile needs no round-trip to the raw source.
  - **Dependency chains** — wiki A → wiki B → raw C verified as independent links, no transitivity shortcuts.
  - **Batching etiquette** — announce scope, check in every 10–20 pages.
  - **Layer 3 authority priority** — (1) URLs cited in raw sources, (2) per-wiki `trusted_authorities`, (3) explicit user permission. Explicit ban on free-range `WebSearch`.
  - **Layer 3 failure modes** — unreachable URLs, rate limits, conflicting authorities — documented with required agent responses.
  - **Reconcile Drifts workflow** — per-marker accept / edit / reject / defer flow including natural-language user responses and a final summary.
- **`.tng-wiki.json` gains `trusted_authorities: []`** — per-wiki opt-in allow-list for Layer 3 external validation. Empty by default so agents can only reach URLs already cited in raw sources until you authorize more.
- **Grounding pipeline — Phase 1.** Three-layer approach to keeping LLM-maintained wikis honest over time, with the CLI doing only the structural (zero-LLM) work and agents driving Layers 2–3 via AGENTS.md-documented workflows.
  - **Schema:** wiki page frontmatter `sources:` is now a YAML list of raw paths (replacing the legacy numeric count), and every factual claim gets an inline `[^raw/<path>]` footnote-style citation. The `sources:` list is the trust anchor every grounding workflow walks.
  - **Marker taxonomy:** four markers (`⚠️ STALE?`, `⚠️ UNSOURCED?`, `⚠️ UNVERIFIED?`, `⚠️ DRIFT?`), each with dedicated meaning / producer / resolution-action documentation in every generated `AGENTS.md`.
  - **`tng-wiki ground [--wiki <slug>] [--page <path>] [--json]`** — Layer 1 structural check (zero-LLM). Detects empty/missing frontmatter sources, inline citations pointing at non-existent raw files, undeclared citations (inline but not in frontmatter), orphan declarations (frontmatter-only, never cited inline), and raw sources modified after the page's `updated` date. Skips `wiki/index.md`, `wiki/log.md`, `_`-prefixed template files, and `wiki/meta/*`.
  - **`tng-wiki drift` / `unsourced` / `unverified`** — pattern-matching lint verbs for the new markers, mirroring the shape of the existing `stale` / `orphans`. Feed the reconcile workflow.
  - **MCP tools:** `ground`, `drift`, `unsourced`, `unverified` added to `tng-wiki-mcp` for shell-less hosts. Total MCP tool count: 11 (was 7).
  - **AGENTS.md workflow:** new `### Grounding` operation documents all three layers; new `### Reconcile Drifts` workflow walks the interactive accept / edit / reject / defer flow that `⚠️ DRIFT?` markers feed into. Ingest step now requires per-claim citations and `⚠️ DRIFT?` on newly-contradicted claims rather than silent overwrites.
  - **Skill:** Claude Code skill teaches the grounding vocabulary, when to reach for `ground` / `drift` / `unsourced` / `unverified`, and the reconcile workflow — all while never auto-applying drift fixes.
- **`tng-wiki search --include-raw`** — opt-in deep search that also scans `raw/` source material. Each hit is tagged `[wiki]` or `[raw]` in plain output and `source: "wiki"|"raw"` in `--json`, so callers always know which layer produced the match. Use when verifying claims, consulting originals, or when a detail might live in archival source that hasn't been distilled into a wiki page yet. Default behavior unchanged — `search` without the flag still returns only compiled wiki content.
- MCP `search` tool gains matching `include_raw` boolean parameter.
- Claude Code skill teaches when to reach for deep search ("search deep", "consult the sources", "verify", "confirm this is accurate", no compiled hit found).
- **AGENTS.md-primary schema generation.** A single canonical `AGENTS.md` covers Claude Code (falls back to AGENTS.md when no CLAUDE.md is present), OpenAI Codex, Cursor, opencode, hermes-agent, OpenClaw, Aider, and any other agent that reads the [agents.md convention](https://agents.md/). Per-agent aliases (`CLAUDE.md`, `.cursorrules`) are created as symlinks to `AGENTS.md`, with a file-copy fallback on platforms without symlink permission. ([`9668e6e`](../../commit/9668e6e))
- **Multi-wiki registry at `~/.tng-wiki/registry.json`.** One user, many wikis. New commands: `tng-wiki register [path]`, `tng-wiki unregister <slug>`, `tng-wiki list`, `tng-wiki set-default <slug>`. `tng-wiki init` auto-registers newly scaffolded wikis; the first registered wiki becomes the default. Every scaffolded wiki gets a `.tng-wiki.json` metadata file (version, name, domain, created date) so `register` on an existing directory can recover its context. ([`75125b5`](../../commit/75125b5))
- **CLI verb surface for ambient wiki access:** `query`, `read`, `search`, `sources`, `stale`, `orphans`. Every verb accepts `--wiki <slug>` (defaults to the registry default) and `--json` (structured output for scripts and MCP wrappers). Line-oriented plain-text output by default so agents parse them fluently and Unix tools can pipe them. Zero-token-cost when idle — agents only pay when they invoke a verb. ([`8046702`](../../commit/8046702))
- **`tng-wiki-mcp` binary** — second `bin` entry in the same npm package. MCP server over stdio exposing seven tools (`list_wikis`, `query`, `read`, `search`, `sources`, `stale`, `orphans`) for agent environments without shell access: Claude Desktop, ChatGPT Desktop, Docker MCP Toolkit, web chat UIs. One `npm i -g @thenewguard/tng-wiki` installs both binaries. Routes through the same registry as the CLI. ([`6705063`](../../commit/6705063))
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
