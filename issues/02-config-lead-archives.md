# config: lead_archives — first-class support for external, untrusted doc archives

## Problem

The tool models trusted code (`code_authorities`) and in-repo sources (`raw/`),
but the reverse-engineering / M&A workflow the README markets centers on a third
thing it has no concept for: an **external, fallible doc archive** — e.g. a
192-doc directory of AI-generated analyses living in another repo. The field
wiki hand-rolls the guardrails in AGENTS.md prose ("leads, never sources; never
cite; verify before carrying") and hand-writes provenance blockquotes on every
distilled page. Prose guardrails don't fail loudly; config-backed ones do.

## Proposal

### Config — `.tng-wiki.json`

```json
"lead_archives": [
  {
    "name": "kpom-ai-archive",
    "path": "../../kp/KPOM-Legacy/Compliance/AI",
    "description": "Legacy AI-generated discovery docs — leads only, never citable"
  }
]
```

`path` resolved like `code_authorities.path` (relative to wiki root; see also
the `~`-expansion issue — both config families should share one resolver).

### Behavior

1. **Searchable.** `tng-wiki search <term> --include-leads` extends the search
   surface to registered lead archives. Hits tagged `[lead:<name>]` in plain
   output, `source: "lead", archive: "<name>"` in `--json`. Independent of
   `--include-raw`; both may be passed.
2. **Never citable — enforced.** New ground finding `cited_lead_archive`
   (error-level): any inline citation whose resolved target falls inside a
   registered lead archive path. Also fires on frontmatter `sources:` entries
   resolving into an archive. This converts the most important prose rule into
   a structural check.
3. **Provenance — structured, optional.** New frontmatter key:

   ```yaml
   leads:
     - kpom-ai-archive:20260504_RAPS_Analysis2.md
   ```

   Form: `<archive-name>:<relative-path-within-archive>`. Purely informational
   ("distilled from lead X") — replaces the hand-written provenance blockquote
   as the machine-readable record. Ground validation: warn-level
   `missing_lead` when the referenced file doesn't exist (archives evolve;
   never error), `unknown_lead_archive` when the archive name isn't registered.
   `leads:` entries are exempt from the `sources:` invariants — a lead is
   explicitly *not* a source.
4. **Generated docs.** When `lead_archives` is configured, the generated
   AGENTS.md emits a "Leads, never sources" section (search with
   `--include-leads`; never cite; every carried claim re-grounded against
   `code_authorities` or `raw/`; record provenance via `leads:` frontmatter).
   SKILL.md gains the `--include-leads` trigger guidance.
5. **init/adopt.** `promptCodeAuthorities`-style optional prompt loop for lead
   archives on engineering-shaped domains; headless flags
   (`--lead <name>=<path>`, repeatable) for `--yes` mode.

## Acceptance criteria

- [ ] `search --include-leads` returns tagged hits from a fixture archive;
      plain and `--json` forms.
- [ ] A page citing `[^raw/...]`-style or `[^code:...]`-style path that
      resolves inside a lead archive → `cited_lead_archive`.
- [ ] `leads:` frontmatter parses in inline, block, and quoted forms (reuse
      `extractSources()` parsing approach in src/ground.js).
- [ ] `missing_lead` / `unknown_lead_archive` warn without failing the run;
      `rounds` does not count warn-level lead findings as ground issues.
- [ ] Generated AGENTS.md/SKILL.md sections appear iff `lead_archives` is
      non-empty (template snapshot tests).
- [ ] help.js entries updated; parity test passes.
- [ ] Wikis without `lead_archives` are byte-identical in behavior and output.
