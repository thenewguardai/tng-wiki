# Roadmap

## Improvement Ideas

- Add a non-interactive `init` mode so the scaffold can be created from scripts and CI, not only through prompts.
- Make generated schema files genuinely agent-specific instead of reusing the Claude version with a short header swap.
- Expand `status` into a real wiki health check that can detect broken wikilinks, missing frontmatter, orphan pages, pages missing from the index, and uncompiled raw sources across more than markdown files.
- Add a first-class `lint` command so contradiction checks, stale markers, coverage gaps, and other maintenance workflows exist in the CLI rather than only in generated instructions.
- Improve integration setup flows so Git and QMD can surface actionable remediation steps when local setup fails.
- Add example fixture outputs for each domain template to make the generated structure easier to review and document.

## Engineering Hygiene

- Add automated tests for scaffold generation, status parsing, doctor checks, and integration failure handling.
- Refactor CLI commands so filesystem and parsing logic return plain objects and the terminal rendering layer stays thin and easy to test.
- Remove dead imports and other small code smells as part of regular maintenance.
- Add fixture-based regression tests for each template so template changes are intentional and reviewable.
- Standardize integration result objects so command summaries do not need to infer success from partial state.
