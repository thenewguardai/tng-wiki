# Roadmap

## Improvement Ideas

- Add a non-interactive `init` mode so the scaffold can be created from scripts and CI, not only through prompts.
- Make generated schema files genuinely agent-specific instead of reusing the Claude version with a short header swap.
- Expand `status` into a real wiki health check that can detect broken wikilinks, missing frontmatter, orphan pages, pages missing from the index, and uncompiled raw sources across more than markdown files.
- Add a first-class `lint` command so contradiction checks, stale markers, coverage gaps, and other maintenance workflows exist in the CLI rather than only in generated instructions.
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
