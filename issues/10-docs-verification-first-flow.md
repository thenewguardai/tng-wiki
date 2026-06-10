# docs: document the verification-first flow and the rejection log as a first-class audit artifact

## Problem

README/AGENTS document one canonical flow: ingest raw sources → compile →
verify later, with the marker taxonomy (STALE/UNSOURCED/DRIFT) as the health
surface. A real campaign ran the **inverse** — premise-refute first, validate
against code authorities, distill only `[confirmed]` claims, and log what
failed — producing ~zero markers and inventing the **rejection log** (a NOTES
deliverable listing every rejected/corrected/downgraded lead claim with
dispositions) as the audit artifact instead. The flow is arguably the
higher-rigor one and the docs don't acknowledge it exists.

## Proposal (docs + one tiny tool touch)

1. **README**: a "Two canonical flows" subsection — ingest-first (markers as
   health surface) vs verification-first (rejection log as audit surface),
   when each fits (trusted sources & speed vs fallible leads & rigor).
2. **Generated AGENTS.md**: in the grounding/operations area, name the
   verification-first option and the rejection-log pattern with its core
   argument: *"we verified it" without a list of what failed verification is
   evidence nothing was looked for.* One paragraph; the code-archaeology
   template (companion issue) carries the full treatment.
3. **`rounds`**: count rejection-log NOTES deliverables when present
   (filename match `*_NOTES_*.md` under `deliverables/`) as an informational
   line — makes the audit artifact visible on the dashboard. Zero-LLM,
   additive, no behavior change for wikis without deliverables/.

## Acceptance criteria

- [ ] README section merged; AGENTS generator snapshot updated.
- [ ] `rounds` shows the NOTES count only when ≥1 exists; `--json` additive.
- [ ] No changes to marker behavior.

