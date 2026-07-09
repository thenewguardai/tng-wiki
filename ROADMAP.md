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

## Fifth + Sixth External Reviews (received 2026-07-09, inspected 0.8.0)

Two follow-up reviews of 0.8.0; the second re-ran an adversarial battery against the upgrade machinery. Disposition:

- **Both confirmed the 0.7.0/0.8.0 fixes held** (qmd hardening, schema over-claim correction, positioning reframe, doctrine split token measurement ~8.2k -> ~3.6k always-on, CI/coverage/trusted-publishing hygiene) and retracted the fourth review's "single-line programs" artifact.
- **One real new defect, fixed same day**: a stray close marker pasted inside the fenced block makes the splice strand stale generated text as user content. `upgrade` now reports a `Fence anomaly` warning (warn, not guess - the right marker is undecidable); the review's tamper battery is committed as regression tests in upgrade.test.js.
- **Frontmatter parser duplication (verbs.js vs ground.js)**: consolidated into `src/frontmatter.js`, same treatment insideRoot/walkMd got.
- **Open UX decision**: read-only verbs resolve the registered default from anywhere (deliberate, 0.6.0), while `upgrade` resolves cwd-first - the reviewer ran `rounds` inside one wiki and got another. Options: unify all verbs to explicit > --wiki > cwd-wiki > default (behavior change, needs a minor bump), or print a notice when cwd is a different registered wiki than the one resolved.
- **Still deferred**: 10k-page lock-hashing benchmark; splitting ground.js into frontmatter/citations/authorities/lock-checks/convention-lints modules (the file is coherent but remains the complexity sink).

## Fourth External Review (received 2026-07-08, inspected 0.6.0)

Disposition, for the record - the review arrived two releases stale and mixed real findings with tooling artifacts:

- **Endorsed the positioning pivot** independently: "strong wiki operating system for disciplined agents, weak productized wiki compiler" is the same diagnosis the 0.7.0 reframe already acted on. Its ecosystem/star-count claims remain unverifiable (same caveat as the first three reviews).
- **Two findings were real but already fixed in 0.7.0** before the review was read: the qmd.js execSync injection (its proposed diff nearly matches what shipped) and the package.json repository URL typo.
- **One priority finding was a fetch artifact, not a fact**: it claimed core files are "single-line programs" (registry.js "3 lines", ground.js "59") and ranked reformatting as its #2 fix. Real counts: registry.js 112, doctor.js 246, connect.js 213, verbs.js 313, ground.js 836 - all conventional multi-line JS. The reviewer's pipeline lost newlines. Lesson worth keeping: verify a reviewer's raw observations before acting on its recommendations.
- **Actionable residue, shipped 2026-07-08**: push/PR test CI (test.yml; the release workflow's first run had already caught a real CI-only bug), a zero-dependency coverage script (`npm run coverage`, native node - 91.3% line / 90.1% branch / 94.0% funcs at time of adding), and a lockfile refresh clearing 5 transitive audit findings (fast-uri / hono / ip-address / qs - all in MCP SDK HTTP-transport chains the stdio-only server never exercises; the review's "upgrade off 1.29.0" remedy was wrong, 1.29.0 is latest).
- **Deferred**: benchmarking `ground` lock-mode hashing on 10k+ page vaults (reasonable observation, personal/team scale is fine today).

## Schema Lifecycle (shipped 2026-07-07, post-0.7.0)

Dogfood review of the maintainer's wiki surfaced four gaps; all shipped in one batch (see CHANGELOG Unreleased):

- **`tng-wiki upgrade` + managed schema fences.** The 0.7.0 doctrine split made every pre-0.7.0 wiki stale with no migration path, and hand-authored schema extensions (the dogfood wiki's `## Repository-Specific Contract`) made naive regeneration destructive. Generated schemas now carry `connect`-style fence markers; `upgrade` splices fenced wikis byte-preservingly, heading-merges legacy ones, rewrites doctrine, stamps `schema_version`, and supports `--domain` re-domaining. `doctor` flags wikis whose stamp trails the installed CLI.
- **`_inbox/` visibility.** rounds/status counted pending ingest only from `raw/`; librarian-style wikis capture through `_inbox/` (12 items had backed up unseen).
- **Ritual meta-health.** Markers can read clean while the loop itself lapses (4 weeks of stalled log + uncommitted edits, invisible). rounds/status now report log age + working-tree churn.
- **Page-count coherence.** status (all files) and rounds (groundable) contradicted each other without explanation; both now label their notions and share the same walker.

Follow-ups worth considering: an `upgrade --all` sweep over every registered wiki; a `doctor` hint when `_inbox/` exists but the domain section doesn't teach librarian duties; fencing the doctrine files too if users start editing them.

## Improvement Ideas

- **Code-authority follow-ups (deferred from Phase 4).**
  - ~~Interactive `init` prompt for `code_authorities` on the Software Engineering and Blank domains.~~ **Shipped 2026-04-25.**
  - ~~Git-ref pinning: `{ name, path, ref: "v2.1.0" }` so authorities can be frozen at a specific commit/tag.~~ **Shipped 2026-04-25.**
  - `tng-wiki ground --against-code <name>` guided entry point for Layer 3B verification runs. Layer 3B is agent-driven today; a CLI shortcut would let the agent (or a human) kick off a scoped pass without prose.
  - Per-language comment-handling rules in config, for codebases where the default "ignore comments/docstrings/JSDoc" filter needs tighter language-specific treatment.
  - ~~Line-range validation in `tng-wiki ground` — today `missing_code_file` checks path existence but not that the cited `#L<start>-L<end>` range is within the file's line count.~~ **Shipped 2026-06-03 (`code_line_out_of_range`).**
  - ~~`exclude`-glob validation: flag inline citations that point at files the agent would skip per the authority's `exclude` list.~~ **Shipped 2026-06-03 (`excluded_code_file`).**
  - ~~Opt-in ref-pinned `tng-wiki ground --at-ref` — Layer-1 structural checks resolved at each authority's `ref` (adds `missing_code_file` at-ref, `code_updated_after_page`, `code_ref_unresolvable`).~~ **Shipped 2026-06-03.**
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
- ~~Trim and correct the repo-root `CLAUDE.md`: it had drifted (claimed "no test suite"; pointed at the removed `claude-code.js` / `codex.js` / `cursor.js` generators; described a three-command CLI).~~ **Resynced 2026-07-06** to the single `agents-md.js` generator + `schemaLayout` aliasing, the doctrine split, and the real verb / registry / grounding / MCP surface; `npm test` / `npm run smoke` added to Commands. Trimming remaining nice-to-know prose is still fair game.

## Positioning (open decision, raised 2026-07-06)

Three independent external reviews of v0.6.0, cross-checked against the code, converged on one diagnosis: **tng-wiki is a verification layer packaged as a scaffolder.** The engineering value, and the one feature no competitor has - the per-claim citation lockfile (move-aware, ref-pinned churn detection that answers "which *claims* changed since a human verified them") - lives in `ground` / `lock` / `cite`. But the name, tagline ("Scaffold an LLM-maintained knowledge base in under 10 minutes"), keywords, and domain templates all foreground `init`, the run-once scaffolder - the commoditized part (a gist paste plus any agent does it).

Consequences, not aesthetics:

- **Discovery mismatch.** Someone whose problem is "my AI wiki silently goes stale" - exactly what the lockfile solves - never finds the tool, because it does not describe itself that way.
- **Adoption gate.** `ground` / `lock` / `cite` only run on tng-wiki-scaffolded wikis (they need the `[^raw/...]` / `[^code:...]` citation syntax). The moat is locked behind the commodity on-ramp.
- **Evaluation frame.** Labeled a "Karpathy wiki," it gets dinged for thin ingest/search vs claude-obsidian; labeled a verification layer, those gaps stop counting (you do not fault a linter for not being an editor).

Caveat: the reviews disagree on the competitive landscape (star counts, who "won" scaffolding) and none was verifiable, so hold the "scaffolding race is lost" claim loosely. The strategic logic holds regardless.

Options (escalating cost):

1. **Reframe only** (~1 hr): rewrite the README intro + `package.json` description + keywords to lead with citation-integrity / grounding; scaffolding becomes the on-ramp. The lean schema (doctrine split, 2026-07-06) now makes "hardens a wiki you already have" more true.
2. **Make verification adoptable into any wiki** (weeks): `adopt` / stronger `--into-existing` so `ground` / `lock` / `cite` run on wikis tng-wiki did not scaffold (including claude-obsidian vaults). The barrier is the citation syntax, so the missing piece is a migration / annotation assist. Biggest strategic upside: converts the moat into reach.
3. **Split the package**: extract `ground` / `lock` / `cite` as a standalone tool; the scaffolder becomes a thin front. Cleanest separation, likely premature.
4. **Do nothing**: fine if tng-wiki is mainly for the maintainer's own code-archaeology use.

Recommendation: 1 now, 2 as the real bet, led by the code-archaeology wedge (fallible AI-generated `raw/` + codebase-as-truth + verification-first) - the novel inversion all three reviews flagged and the maintainer's actual use case. 3 and 4 depend on the crux question: **is tng-wiki mainly for the maintainer, or for outside adopters?** That answer decides whether positioning matters at all.
