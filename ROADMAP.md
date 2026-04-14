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

- Add automated tests for scaffold generation, status parsing, doctor checks, and integration failure handling.
- Refactor CLI commands so filesystem and parsing logic return plain objects and the terminal rendering layer stays thin and easy to test.
- Remove dead imports and other small code smells as part of regular maintenance.
- Add fixture-based regression tests for each template so template changes are intentional and reviewable.
- Standardize integration result objects so command summaries do not need to infer success from partial state.
- Trim the repo-root `CLAUDE.md` — the Architecture and Commands sections carry nice-to-know prose (lazy-import rationale, `npm start` / `--version` mentions) that a contributor can derive from `bin/cli.js` and `package.json`. Keep the load-bearing guidance.
- Tighten `CLAUDE.md` scope around obvious commands: drop `npm start` and `--version` from the Commands section and keep only the non-obvious bits (throwaway-path testing loop, "no build/tests/linter").
