import { today } from '../templates/shared.js';

const DOMAIN_SECTIONS = {
  'ai-research': aiResearchSchema,
  'competitive-intel': competitiveIntelSchema,
  'publication': publicationSchema,
  'business-ops': businessOpsSchema,
  'learning': learningSchema,
  'software-engineering': softwareEngineeringSchema,
  'blank': blankSchema,
};

export function generateAgentsMd({ domain, wikiName, template }) {
  const domainSchema = (DOMAIN_SECTIONS[domain] || blankSchema)();
  return `# ${wikiName}

${PREAMBLE}

${ARCHITECTURE(domain)}

${PAGE_CONVENTIONS}

${MARKER_TAXONOMY}

${domainSchema}

${OPERATIONS(domain)}

${INDEXING}

${LOGGING}

${GUARDRAILS}

${EVOLUTION}
`;
}

// --- Shared sections ---

const PREAMBLE = `## What This Is

This is an LLM-maintained knowledge base. You — the LLM agent — maintain the wiki. The human curates sources, directs analysis, and asks questions. You do everything else: summarizing, cross-referencing, filing, linting, flagging contradictions, maintaining indexes, and keeping the knowledge base healthy.

**The wiki is a persistent, compounding artifact.** Every source ingested and every query answered makes it richer. You never write from scratch — you build on what's already compiled.

Obsidian is the IDE. You are the programmer. The wiki is the codebase.`;

function ARCHITECTURE(domain) {
  return `## Architecture

\`\`\`
raw/          ← Immutable source material — you read, never modify
wiki/         ← LLM-compiled, LLM-maintained — you own this entirely
  index.md    ← Master table of contents (read first for every query)
  log.md      ← Append-only operation log
  meta/       ← Wiki health, coverage gaps, source stats
output/       ← Query results, drafts, visualizations
\`\`\`

**Three layers:**
- **Raw sources** — immutable. Articles, papers, transcripts, images. Your source of truth.
- **The wiki** — your domain. Summaries, entity pages, concept pages, cross-references. You create, update, and maintain everything here.
- **This schema** — operating instructions. Co-evolved by you and the human over time.`;
}

const PAGE_CONVENTIONS = `## Page Conventions

### Frontmatter

Every wiki page uses YAML frontmatter:

\`\`\`yaml
---
title: "Page Title"
type: entity              # varies by domain — see domain-specific section
created: ${today()}
updated: ${today()}
sources:                  # trust anchors for this page — raw paths or code authorities
  - raw/papers/foo.md
  - raw/announcements/bar.md
  - code:legacy-app         # optional, when the page cites a code authority (see .tng-wiki.json)
tags: []
confidence: medium        # high | medium | low
---
\`\`\`

\`sources\` is the **trust anchor** of the page. Grounding workflows re-open every raw file and re-read every code authority listed here to verify the page's claims. An empty \`sources:\` list means the page has no verifiable attribution — that's an \`⚠️ UNSOURCED?\` state, not normal.

### Per-Claim Citations

Every factual claim must cite at least one authority inline using footnote-style syntax. Two citation forms are supported:

**Raw-source citation** — the primary trust chain for \`raw/\`-derived claims:

\`\`\`markdown
Anthropic raised $8B in Series F.[^raw/announcements/2026-anthropic-series-f.md]
\`\`\`

**Code-authority citation** — for claims derived from or verified against a local code authority (see \`.tng-wiki.json → code_authorities\` and Layer 3B grounding):

\`\`\`markdown
The login flow uses OAuth2 implicit grant — no PKCE.[^code:legacy-app/src/auth/oauth.ts#L42-L58]
\`\`\`

- \`code:<authority>\` names a registered code authority.
- \`<path>\` is the file within that authority's tree.
- \`#L<start>-L<end>\` is a GitHub-style line anchor (optional; omit for whole-file claims, single-line: \`#L42\`). VS Code jumps to the line when the cite is a real link.

Multiple citations stack: \`[^raw/a.md][^code:legacy-app/src/x.ts#L10-L20]\`. Pair raw + code when both apply — raw is where the page *learned* the claim, code is the ground truth that *verifies* it.

Every path or authority cited inline must also appear in the frontmatter \`sources:\` list (raw as \`raw/<path>\`, code as \`code:<authority>\`) — that's the invariant \`tng-wiki ground\` checks. Claims without a citation are subject to \`⚠️ UNSOURCED?\` marking.

### Writing Style

- **Dense and scannable.** Use headers. Use tables. No fluff.
- **Show your work.** Every claim cites at least one source or is marked as inference.
- **Confidence markers** (inline, paired with the claim):
  - \`[confirmed]\` — multiple Tier 1–2 sources agree
  - \`[reported]\` — single Tier 1–2 source, or multiple Tier 3 sources
  - \`[inference]\` — logical deduction from cited evidence
  - \`[rumor]\` — Tier 4 only, treat with extreme caution
- **Numbers always have sources.** Never state a figure without attribution.
- Use Obsidian-style \`[[wikilinks]]\` for all internal cross-references.

### Source Quality Tiers

- **Tier 1 — Primary:** Official announcements, filings, court docs, peer-reviewed papers
- **Tier 2 — Quality reporting:** Established press with named sources, detailed expert analysis
- **Tier 3 — Commentary:** Newsletters, substacks, credible practitioner social media
- **Tier 4 — Aggregation/rumor:** Forums, anonymous sources, unverified claims

Prefer Tier 1-2 for factual claims. Tier 3-4 inform narrative and sentiment — mark them as such. A \`[confirmed]\` tag on a claim whose only cited source is Tier 3/4 will be flagged \`⚠️ UNVERIFIED?\` by grounding.`;

const MARKER_TAXONOMY = `## Marker Taxonomy

Inline markers make wiki health visible without running tools. Each has a specific meaning, a specific producer, and a specific resolution path. Never remove a marker without completing its resolution action and writing to \`log.md\`.

### \`⚠️ STALE?\`

- **Meaning:** The claim may be out of date. Time-based, not evidence-based.
- **Produced by:** Humans, or agents during Ingest/Query when they notice the underlying fact likely churns.
- **Resolution action:** Re-verify against a current source. If still accurate, remove the marker and bump \`updated\`. If changed, update the claim, add/replace citations, bump \`updated\`. Either way, log.

### \`⚠️ UNSOURCED?\`

- **Meaning:** The claim has no inline citation, or cites a path missing from frontmatter \`sources:\`.
- **Produced by:** \`tng-wiki ground\` (Layer 1, structural).
- **Resolution action:** Either find a raw source that supports the claim and add the citation + frontmatter entry, or reduce the claim's confidence tag (e.g. \`[reported]\` → \`[inference]\`), or remove the claim entirely. If no source can be found, the claim should not be stated as fact. Log.

### \`⚠️ UNVERIFIED?\`

- **Meaning:** Confidence tag is stronger than the cited source tier warrants — e.g. \`[confirmed]\` backed only by Tier 3/4.
- **Produced by:** \`tng-wiki ground\` (Layer 1, structural).
- **Resolution action:** Either (a) find a Tier 1–2 source and add the citation, or (b) downgrade the confidence tag to match the evidence. Log.

### \`⚠️ DRIFT?\`

- **Meaning:** The claim has diverged from what its cited raw source actually says. The marker includes evidence: \`⚠️ DRIFT? [source: <path> says "<what the source says>"; wiki says "<current claim>"; suggested: "<agent's proposed fix>"]\`
- **Produced by:** Layer 2 grounding (semantic re-verification) or Layer 3 grounding (external validation).
- **Resolution action — interactive reconcile:** For each marker, present the source evidence + current claim + suggested fix to the human. The human chooses \`accept\` / \`edit\` / \`reject\` / \`defer\`:
  - **accept:** Apply the suggested fix verbatim, remove the marker, bump \`updated\`, log.
  - **edit:** Apply a human-edited claim, remove the marker, bump \`updated\`, log.
  - **reject:** Remove the marker without changing the claim (the human has evidence the wiki is right and the marker is wrong — log the reasoning), optionally add a counter-citation.
  - **defer:** Leave the marker in place; log the defer with a reason.

Never auto-apply a \`⚠️ DRIFT?\` resolution without human approval. The marker exists precisely because the agent is uncertain which side is correct.`;

function OPERATIONS(domain) {
  const isPublication = domain === 'publication';
  const hasOpportunities = ['ai-research', 'publication', 'competitive-intel'].includes(domain);

  let ops = `## Operations

### Ingest

When the human drops a new source into \`raw/\` and asks you to process it:

1. **Read the source fully.** If it has images, read text first, then view images separately.
2. **Discuss key takeaways** with the human. What's new? What does it confirm or contradict?
3. **Integrate into existing wiki pages** — don't create a separate summary-per-source. A single source typically touches 5-15 pages.
4. **Cite every claim.** Every new or updated claim gets a \`[^raw/<path>]\` inline citation to the source it came from. Add the raw path to the page's frontmatter \`sources:\` list if not already present.
5. **Check for contradictions** — if new data conflicts with existing claims, flag with \`⚠️ DRIFT?\` and include both sides in the marker so the human can reconcile.
6. **Update \`wiki/index.md\`** — add or revise entries for changed pages.
7. **Append to \`wiki/log.md\`** — record what you did.
8. **Update frontmatter** — refresh \`updated\` date, adjust \`confidence\` based on evidence tier.

The human prefers to ingest one source at a time and stay involved unless they say otherwise.

### Query

When the human asks a question:

1. **Read \`wiki/index.md\` first** to identify relevant pages.
2. **Read relevant pages**, following cross-references as needed.
3. **Synthesize an answer** with citations to wiki pages and raw sources.
4. **Choose the right format:** Quick answer in chat, substantial analysis in \`output/\`, comparison tables, Marp slides, or matplotlib charts.
5. **File valuable outputs back.** If the answer is durable knowledge, ask: "Worth filing into the wiki?"

### Lint

When asked to health-check the wiki:

1. Contradictions — claims that conflict across pages
2. Stale claims — \`⚠️ STALE?\` markers or claims older than 2 weeks without fresh sourcing
3. Orphan pages — \`tng-wiki orphans\` — no inbound wikilinks
4. Missing pages — concepts mentioned but lacking their own page
5. Missing cross-references — pages that should link but don't
6. Thin pages — fewer than 3 sources or missing key sections
7. Coverage gaps — areas with few or no pages

Output a lint report. Suggest specific actions.

### Grounding

Ground-truth the wiki against its source material. Three layers, escalating in cost and thoroughness. Run them in order — Layer 1 before Layer 2, Layer 2 before Layer 3 — so cheap structural checks catch the easy problems before you pay for semantic re-reading.

#### Layer 1 — Structural (cheap, always safe)

Run \`tng-wiki ground [--page <path>]\`. Pure-CLI, zero-LLM. It catches:

- Pages with empty or missing \`sources:\` frontmatter (→ apply \`⚠️ UNSOURCED?\`)
- Inline \`[^raw/...]\` citations pointing at raw files that don't exist (→ fix the path, or remove the claim)
- Inline citations not registered in frontmatter \`sources:\` (undeclared cites — applies to both raw and \`code:<name>\` entries)
- Frontmatter \`sources:\` entries not cited inline (orphan declarations — the page added a source it never used)
- Pages whose \`updated\` is older than the mtime of a cited raw source (source changed after distillation — candidate for Layer 2)
- Inline \`[^code:<name>/...]\` citations where \`<name>\` is not a registered code authority in \`.tng-wiki.json\` (\`unknown_code_authority\`) or where the file path resolves to nothing on disk (\`missing_code_file\`)
- Confidence tag inflation: \`[confirmed]\` claims with only Tier 3/4 citations (→ apply \`⚠️ UNVERIFIED?\`)

Apply the appropriate markers inline. Log the pass with issue counts.

#### Layer 2 — Semantic re-verification (agent-driven)

You re-read each raw source and compare it against the wiki claims it's supposed to support. Where they diverge, you write a \`⚠️ DRIFT?\` marker that carries its own evidence so a human can reconcile without re-reading the source.

**Triage order when scope is a whole wiki:**

1. Pages flagged \`source_updated_after_page\` by Layer 1 (strongest signal of drift).
2. Pages with recent \`updated\` dates that changed without a new ingest log entry (possible manual edit without citation update).
3. Oldest pages with the most citations (long-tail decay).
4. Pages tagged \`[confirmed]\` extensively (highest stakes if drift exists).

Prefer per-page (\`--page <path>\`) runs when the user asks to verify something specific. Reserve whole-wiki passes for explicit ground-check requests or scheduled maintenance.

**Per-claim verification procedure:**

1. Read every raw source in frontmatter \`sources:\`.
2. For each claim in the wiki page, identify which cited source supports it (inline \`[^raw/...]\` is the mapping).
3. Does the source still say what the wiki says? Apply one of four outcomes:
   - **Supported** — no action.
   - **Partially supported** — the source supports a weaker claim than the wiki states. Either downgrade the wiki's confidence tag (\`[confirmed]\` → \`[reported]\`, etc.) or narrow the claim. Log.
   - **Drifted** — source and wiki disagree. Write \`⚠️ DRIFT?\` with source quote, current claim, and suggested fix (see below). Never auto-apply.
   - **Unsourceable** — the cited source does not support this claim at all. Write \`⚠️ UNSOURCED?\` inline and flag for human review — something was distilled incorrectly.

**\`⚠️ DRIFT?\` marker format (self-contained evidence):**

\`\`\`
⚠️ DRIFT? [source: raw/<path> says "<1–3 sentence quote, or a paraphrase if quoting is impractical>";
           wiki says "<current wiki claim>";
           suggested: "<your proposed fix — the exact replacement text>"]
\`\`\`

Keep quotes tight. Paraphrase long-form material. The marker should be readable in isolation — a human reviewing six months from now shouldn't need to re-open the source to understand the evidence.

**Dependency chains:** If wiki page A cites wiki page B which cites raw source C, treat as two separate links. Verify A→B (B supports A) and B→C (C supports B) as independent checks. Never shortcut A→C by assuming transitivity — intermediate distillations are where most drift hides.

**Batching:** A whole-wiki semantic pass on a 100-page wiki is expensive. Announce the scope before starting. Check in with the user every 10–20 pages with a running total ("12 pages verified, 3 drift markers applied so far — continue?").

#### Layer 3 — Authority validation (opt-in, scoped)

Cross-check wiki claims against external authority. Two kinds of authority exist; they're orthogonal and can both be configured per-wiki in \`.tng-wiki.json\`.

##### 3A. Web authorities

When the user asks you to verify against live external web sources, use \`WebFetch\` / \`WebSearch\` under strict rules:

**Authorized sources, in priority order:**

1. **URLs cited in the raw source itself** — the primary trust chain. If the raw source links to the vendor docs, fetch those docs.
2. **Per-wiki trusted authorities** — if the wiki's \`.tng-wiki.json\` lists a \`trusted_authorities\` array (e.g. \`["docs.python.org", "spec.commonmark.org"]\`), those domains are always authorized.
3. **Explicit user permission** — the user names a specific source in the ground-check request.

**Never:**
- Free-range \`WebSearch\` without specific authority targets. Unconstrained search latches onto the wrong voice and produces confident-wrong results.
- Trust a single external source to override a raw source without human review. External disagrees with raw = \`⚠️ DRIFT?\` for reconcile, not auto-rewrite.
- Refetch the same URL multiple times per ground run — cache per-URL within a single run.

**Procedure:**

1. For each claim in scope, identify the authority URL(s) it should be checked against.
2. Fetch each URL once. Summarize what it says about the claim.
3. Three possible outcomes per claim:
   - **External confirms wiki + raw:** note the concurrence in the log; no marker.
   - **External confirms wiki but contradicts raw:** the raw source is out of date. Apply \`⚠️ STALE?\` to the raw-file-level reference in the wiki's frontmatter comment, and flag for human review — may want to re-ingest from the current authority.
   - **External contradicts wiki:** apply \`⚠️ DRIFT?\` with both the raw-source quote and the external-source quote in the evidence. Reconcile interactively.

**Failure modes to handle gracefully:**

- **Unreachable / 404:** the authority URL moved. Mark the source with \`⚠️ STALE?\` and log — do not delete the citation.
- **Rate-limited:** back off and surface to the user rather than retrying blindly.
- **Two external authorities disagree:** record both, do not pick one silently, escalate to human.

##### 3B. Code authorities (local filesystem)

Use when the wiki is built around a real codebase — typical in reverse-engineering, porting, or M&A / IP-acquisition workflows where \`raw/\` holds AI-generated PRDs, overview docs, and implementation guides that may hallucinate, and the actual implementation is the ground truth the wiki needs to validate against.

**Configuration.** \`.tng-wiki.json\` lists each authoritative codebase in \`code_authorities\`:

\`\`\`json
"code_authorities": [
  {
    "name": "legacy-app",
    "path": "../customer-portal-v1",
    "description": "Source implementation being ported.",
    "exclude": ["**/*.md", "docs/**", "**/*.test.*", "**/node_modules/**", "**/dist/**"],
    "language": "typescript"
  }
]
\`\`\`

- \`name\` — short handle used in citations (\`[^code:legacy-app/...]\`).
- \`path\` — tree root, resolved relative to the wiki root.
- \`exclude\` — gitignore-style globs; skip these when traversing the authority.
- \`language\` — optional hint; helps you pick appropriate comment/doc syntax to ignore.
- \`ref\` — optional git ref (branch, tag, commit SHA). When set, read the authority *at that ref* instead of the working tree. See **Ref pinning** below.

**Tools.** \`Read\`, \`Grep\`, \`Glob\`. Not \`WebFetch\`. Code authorities are local filesystem; fetching is free and instant.

**Ref pinning.** When an authority has a \`ref\` field set, the user has frozen this authority to a specific point in history — typically because the source repo is actively evolving and they want grounding to be deterministic. In that case:

- Read individual files via \`git -C <path> show <ref>:<file>\` instead of \`Read\`. The output goes to stdout; pipe through your normal scope filter (ignore comments/docstrings/JSDoc/etc).
- Enumerate files via \`git -C <path> ls-tree -r --name-only <ref>\` instead of \`Glob\`.
- For text search, use \`git -C <path> grep <pattern> <ref>\` instead of \`Grep\`.
- The user's working-tree state is irrelevant under ref pinning — they may have switched branches, stashed work, or have uncommitted changes; none of it contaminates grounding.
- \`git show <ref>:<file>\` returning \`fatal: path '...' exists on disk, but not in '<ref>'\` means the cited file existed in the working tree (so Layer 1 \`tng-wiki ground\` passed) but does not exist at the pinned ref. Treat the cite as \`missing_code_file\` for the purposes of this Layer 3B run, surface to the user, and recommend either updating \`ref\` or removing the cite.
- Layer 1 (\`tng-wiki ground\`) does not honor \`ref\` — it always checks the working tree. This is deliberate: structural lint should be cheap and the working tree is the right snapshot for "does this path exist anywhere I can read it." Ref-vs-working-tree mismatches are surfaced during Layer 3B verification, not Layer 1.

When \`ref\` is unset (the default), read the working tree directly with \`Read\` / \`Grep\` / \`Glob\` as normal.

**Scope filter — implementation only.** The user has chosen a code authority because documentation is fallible. Return the favor: when treating a code file as authoritative, disregard its comments, docstrings, JSDoc, type-annotation descriptions, and any markdown/text files even if \`exclude\` did not catch them. Concretely, ignore:

- Single-line comments: \`// ...\`, \`# ...\`, \`-- ...\`.
- Block comments: \`/* ... */\`, \`""" ... """\`, \`''' ... '''\`, \`<!-- ... -->\`.
- Doc blocks: JSDoc (\`/** ... */\`), Python docstrings, rustdoc (\`/// ...\`), Javadoc, XML doc comments.
- Whole files: \`*.md\`, \`*.rst\`, \`*.txt\`, \`README\`, \`CHANGELOG\` — even if not excluded by config.

The implementation is authority. The comments may be stale or aspirational; the PRDs in \`raw/\` *already are*. You are not hunting for what the code *claims*, you are deriving what it *does*.

**Citation form.** When Discovery- or Ingest-phase work grounds a claim in code, emit an inline citation:

\`\`\`markdown
[^code:<authority-name>/<path-within-tree>[#L<start>[-L<end>]]]
\`\`\`

- \`<authority-name>\` matches a \`code_authorities\` entry.
- \`<path-within-tree>\` is the file path inside the authority's \`path\`.
- \`#L<start>-L<end>\` — GitHub-style line range anchor. Optional (omit for whole-file claims). Single line: \`#L42\`.

Frontmatter \`sources:\` must list \`code:<name>\` for every code authority the page cites — same invariant raw sources follow. Pair raw + code cites when both apply:

\`\`\`markdown
The login flow uses OAuth2 implicit grant — no PKCE.[^raw/prd-auth.md][^code:legacy-app/src/auth/oauth.ts#L42-L58]
\`\`\`

Engineers and future agents clicking the code citation in a capable editor (VS Code, GitHub preview) jump straight to the cited lines. Cite specifically — aim for ranges of 1–30 lines, not whole files, so the human following the cite lands on the evidence without re-hunting.

**Precedence — advisory.** Code is advisory authority, not absolute. Disagreement between code and raw or code and wiki produces a \`⚠️ DRIFT?\` marker with evidence; the human reconciles. Never auto-apply a code-derived correction.

**Procedure.**

1. For each claim in scope, identify which code authority (if any) could verify it. Not every claim has a code authority — e.g. "why" claims, strategic-context claims, and claims about external systems.
2. \`Read\` / \`Grep\` the authority for the cited or plausibly-relevant file. Honor \`exclude\` globs; ignore comments/docs per the scope filter.
3. Four possible outcomes:
   - **Code confirms wiki + raw:** log the concurrence. No marker. Add a \`[^code:...]\` citation alongside the existing \`[^raw/...]\` so the evidence chain is explicit.
   - **Code confirms wiki, contradicts raw:** the raw doc is a hallucination or out-of-date. Write \`⚠️ DRIFT?\` naming the raw source, with both raw and code quotes, and propose updating the wiki claim to match code (which it already matches — the marker flags the raw source as suspect so it gets re-ingested or retired).
   - **Code contradicts wiki:** the wiki propagated a raw-doc hallucination or distilled incorrectly. Write \`⚠️ DRIFT?\` with \`code:\` evidence line; the suggested fix reflects the code's behavior.
   - **Code silent on the claim:** the authority doesn't cover this. No marker; this is the boundary of what code can verify.

**DRIFT marker format — extended for code authority:**

\`\`\`
⚠️ DRIFT? [source: raw/prd-auth.md says "OAuth2 with PKCE";
           code: legacy-app/src/auth/oauth.ts#L42-L58 shows "implicit flow, no code_challenge parameter sent";
           wiki says "OAuth2 with PKCE";
           suggested: "OAuth2 implicit flow — legacy-app does not implement PKCE"]
\`\`\`

Keep code paraphrase tight — summarize what the implementation *does*, quote sparingly. The \`#L\` anchor gives the reader the exact landing spot.

**Failure modes to handle gracefully:**

- **Authority \`path\` missing or unreadable:** log; surface to the user as a configuration issue (the authority moved, permissions, git submodule not initialized). Do not mark pages — you can't verify.
- **\`exclude\` filters out every candidate file:** likely misconfigured globs. Report to the user.
- **Cited file moved or was deleted:** \`tng-wiki ground\` already flags this as \`missing_code_file\`. Resolve per structural lint — update the cite or mark \`⚠️ STALE?\` on the page pending human decision.
- **Two authorities disagree:** rare, but possible (e.g. a forked codebase and its upstream). Record both, escalate; do not silently prefer one.

### Reconcile Drifts

When the user asks you to reconcile, walk \`tng-wiki drift\` (and \`unsourced\` / \`unverified\`) output. For each marker:

1. \`tng-wiki read <page>\` to fetch the current page.
2. Extract the marker's evidence (source quote, current claim, suggested fix).
3. Present all three to the user in a compact form.
4. Ask: **accept / edit / reject / defer**. Support natural-language variations ("yes", "fix it", "no, the wiki is right", "skip this one").
5. Apply the chosen action:
   - **accept:** replace the claim with the suggested fix, remove the marker, bump \`updated\`, log.
   - **edit:** take the user's edited claim, replace, remove the marker, bump \`updated\`, log.
   - **reject:** remove the marker without changing the claim. Capture the user's reasoning in the log (the wiki was right; the external source was wrong; etc.). Optionally add a counter-citation.
   - **defer:** leave the marker in place. Log the defer with the user's reason.

After walking all markers, produce a summary: N accepted / N edited / N rejected / N deferred. If more than a handful were deferred, ask whether to schedule a follow-up.`;

  if (isPublication) {
    ops += `

### Issue Prep

When preparing a new issue:

1. Read the last 2-3 published issues from \`raw/issues/\`
2. Scan Recent Moves across all entity pages for the past week
3. Check narrative pages for new evidence
4. Check opportunity pages for score changes
5. Check contradictions for story angles
6. Generate a structured briefing of what moved, what matters, what's new
7. Flag potential deep dive topics

### Post-Publish

After publishing an issue:

1. Ingest the published issue into \`raw/issues/\`
2. Update entity pages with issue references
3. Update narrative pages with coverage notes
4. Track predictions or assessments for follow-up
5. Update \`wiki/meta/coverage-map.md\``;
  }

  return ops;
}

const INDEXING = `## Indexing

\`wiki/index.md\` is your primary navigation tool. It's a catalog of every page with a link, one-line summary, and metadata. Organized by category.

**Always read \`index.md\` first** when answering queries. At moderate scale (~100s of pages), this is sufficient without embedding-based search.

If QMD is available, use \`qmd query "..."\` via CLI or MCP for larger wikis.`;

const LOGGING = `## Logging

\`wiki/log.md\` is append-only. Format:

\`\`\`markdown
## [YYYY-MM-DDTHH:MM] type | Description
- Source: path/to/source
- Pages created: list
- Pages updated: list
- Notes: what happened
\`\`\`

Types: \`ingest\`, \`query\`, \`lint\`, \`issue-prep\`, \`post-publish\``;

const GUARDRAILS = `## What You Never Do

- **Never modify files in \`raw/\`.** Exception: setting \`compiled: true\` in frontmatter after processing.
- **Never delete wiki pages.** Update with corrections. Archive if truly obsolete.
- **Never invent sources.** Mark unsourced claims as \`[inference]\` or \`[unverified]\`.
- **Never skip the log.** Every operation gets a \`log.md\` entry.
- **Never skip the index.** Every new or changed page gets an \`index.md\` update.`;

const EVOLUTION = `## Evolution

This schema is a living document. As patterns emerge, suggest changes. Document agreed changes below.

### Changelog
- **${today()}:** Initial schema generated by tng-wiki CLI.`;

// --- Domain-specific sections ---

function aiResearchSchema() {
  return `## Domain: AI / Tech Research

### Page Types

**Entity pages** (\`wiki/entities/\`) — Companies, people, orgs. Include: overview, key facts, strategic position, recent moves (reverse-chronological), builder implications, contradictions, cross-references.

**Protocol pages** (\`wiki/protocols/\`) — Standards and specifications. Include: what it does, who's behind it, adoption status, technical summary, builder implications.

**Stack layer pages** (\`wiki/stack/\`) — Infrastructure layers (compute, models, orchestration, security, identity, tooling, deployment). Include: current state, key players, recent shifts, builder implications.

**Opportunity pages** (\`wiki/opportunities/\`) — Builder opportunities, scored per \`_scoring-criteria.md\`. Include: summary, scores, the gap, who's building, revenue model, stack requirements, signal watch.

**Narrative pages** (\`wiki/narratives/\`) — Recurring themes spanning multiple sources. Include: thesis, evidence chain, counter-evidence, implications.

**Timeline pages** (\`wiki/timelines/\`) — Chronological tracking of multi-event sagas.

**Contradiction pages** (\`wiki/contradictions/\`) — Where sources disagree. Gold for analysis.`;
}

function competitiveIntelSchema() {
  return `## Domain: Competitive Intelligence

### Page Types

**Company pages** (\`wiki/companies/\`) — Intelligence profiles. Include: overview, products, funding/revenue, strategic position, recent moves, SWOT summary, signal watch.

**Product pages** (\`wiki/products/\`) — Individual product tracking. Include: what it does, pricing, market position, strengths/weaknesses, competitive alternatives.

**Market pages** (\`wiki/markets/\`) — Market segments. Include: size, growth, key players, dynamics, entry barriers.

**SWOT pages** (\`wiki/swot/\`) — Deep SWOT analyses per company. Include: strengths, weaknesses, opportunities, threats, signal watch.

**Signal pages** (\`wiki/signals/\`) — Notable events: hiring moves, product launches, funding, partnerships, regulatory actions.`;
}

function publicationSchema() {
  return `## Domain: Publication / Newsletter

### Page Types

**Entity pages** (\`wiki/entities/\`) — Companies, people, orgs. Include: overview, key facts, strategic position, recent moves, builder implications, contradictions, cross-references. Track which published issues reference each entity.

**Protocol pages** (\`wiki/protocols/\`) — Standards and specs. Include: what, who, adoption, technical summary, builder implications.

**Stack layer pages** (\`wiki/stack/\`) — Infrastructure layers. Include: current state, key players, shifts, builder implications.

**Opportunity pages** (\`wiki/opportunities/\`) — Scored per \`_scoring-criteria.md\`.

**Narrative pages** (\`wiki/narratives/\`) — Multi-issue themes. Include: thesis, evidence chain, counter-evidence, publication coverage history, unexplored angles.

**Timeline pages** (\`wiki/timelines/\`) — Multi-event sagas tracked across issues.

**Contradiction pages** (\`wiki/contradictions/\`) — Story fuel.

### Publication-Specific Frontmatter

Entity pages include: \`published_in: [001, 003, 007]\` — tracking which issues reference the entity.

Narrative pages include: \`status: active | stale | resolved\` and \`angles_explored: []\` / \`angles_remaining: []\`.`;
}

function businessOpsSchema() {
  return `## Domain: Business Operations

### Page Types

**Project pages** (\`wiki/projects/\`) — Active and completed projects. Include: status, owner, timeline, decisions made, open questions, retrospective.

**Decision pages** (\`wiki/decisions/\`) — Key decisions and their context. Include: date, participants, options considered, decision made, rationale, outcome (updated later).

**People pages** (\`wiki/people/\`) — Team members and stakeholders. Include: role, key context, involvement in projects/decisions.

**Process pages** (\`wiki/processes/\`) — How things work. Include: description, owner, dependencies, known issues.

**Retrospective pages** (\`wiki/retrospectives/\`) — What we learned. Include: date, context, what went well, what didn't, action items.`;
}

function softwareEngineeringSchema() {
  return `## Domain: Software Engineering & Architecture

### Page Types

**Decision pages** (\`wiki/decisions/\`) — Architecture Decision Records (ADRs). Each page uses the ADR template (\`wiki/decisions/_adr-template.md\`). Include: **status** (\`proposed\` → \`accepted\` → \`deprecated\` or \`superseded\`), **context** (forces and constraints), **decision** (what was chosen, with citations), **consequences** (positive / negative / neutral), **alternatives considered**, **links**. Track relationships via \`supersedes:\` and \`superseded-by:\` frontmatter fields so the lineage is queryable.

**Component pages** (\`wiki/components/\`) — Services, libraries, modules. Include: **purpose**, **API surface**, **upstream/downstream dependencies**, **data stores**, **SLOs** (availability / latency / throughput), **linked runbooks**, **known tech debt**, **recent decisions** that shaped the component. Ownership lives in \`wiki/meta/ownership.md\`, not per-page.

**System pages** (\`wiki/systems/\`) — Higher-level groupings of components. Include: boundary definitions, data flow, cross-component interactions, failure modes.

**Pattern pages** (\`wiki/patterns/\`) — Reusable approaches. Include: description, **when to use** / **when not to use**, **tradeoffs**, example implementations, known instances in the codebase.

**Incident pages** (\`wiki/incidents/\`) — Postmortems following the incident template (\`wiki/incidents/_incident-template.md\`). Include: **severity** (P0–P3, see \`wiki/meta/severity-taxonomy.md\`), **timeline**, **root cause**, **contributing factors**, **resolution**, **action items** table with owners and status, links to any tech-debt items the incident exposed.

**Runbook pages** (\`wiki/runbooks/\`) — Operational procedures for humans or agents. Include: **trigger** (when to run this), **prerequisites**, **steps** (numbered, copy-pastable), **verification**, **rollback**. Link from the owning component.

**Tech debt pages** (\`wiki/tech-debt/\`) — Known compromises scored on the impact × effort grid (\`wiki/tech-debt/_scoring-criteria.md\`). Include: **impact** (Critical/High/Medium/Low), **effort** (S/M/L/XL), **what's blocked**, links to decisions that created or would resolve it.

### ADR Status Lifecycle

ADR statuses are intentional, not decorative:

- \`proposed\` — under review. No downstream code/docs should depend on the outcome yet.
- \`accepted\` — in effect. Record the acceptance date in the Status section.
- \`deprecated\` — no longer the preferred approach, but not yet replaced. New work should avoid it.
- \`superseded\` — replaced by a later ADR. Both ADRs get \`supersedes:\` / \`superseded-by:\` entries, and \`tng-wiki ground\` can verify the back-link is bidirectional.

Never delete an ADR. Deprecation and supersession preserve the historical context that made the original decision reasonable at the time.

### Operational Conventions

- **One decision per ADR.** If a review generates multiple decisions, file multiple ADRs that cross-link.
- **Cite the evidence.** Every ADR claim gets a \`[^raw/rfcs/...]\` or \`[^raw/prs/...]\` citation so grounding catches drift when the evidence moves.
- **Incidents always produce tech-debt entries** for latent issues exposed, even when the immediate fix is landed — future-you needs the trail.
- **Runbooks age fast.** Add \`⚠️ STALE?\` proactively if a runbook hasn't been exercised in two quarters.`;
}

function learningSchema() {
  return `## Domain: Learning / Deep Study

### Page Types

**Concept pages** (\`wiki/concepts/\`) — Core ideas. Include: definition, explanation, examples, connections to other concepts, open questions.

**People pages** (\`wiki/people/\`) — Thinkers, researchers, authors. Include: field, key contributions, notable works, connections.

**Connection pages** (\`wiki/connections/\`) — Non-obvious links between concepts. Include: the two (or more) concepts, the connection, why it matters, sources.

**Question pages** (\`wiki/questions/\`) — Open questions to investigate. Include: the question, current best understanding, what would resolve it, priority.`;
}

function blankSchema() {
  return `## Domain: Custom

### Page Types

Define your own page types as the wiki grows. Start with simple topic pages and let structure emerge from the content.`;
}
