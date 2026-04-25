import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const SKILL_NAME = 'tng-wiki';

export function skillDir(claudeHome = join(homedir(), '.claude')) {
  return join(claudeHome, 'skills', SKILL_NAME);
}

export function skillFile(claudeHome) {
  return join(skillDir(claudeHome), 'SKILL.md');
}

export const SKILL_CONTENT = `---
name: tng-wiki
description: Query the user's tng-wiki knowledge base. Use when the user asks about topics from their personal wiki, references prior research, says "check my wiki" or "what do I know about X", mentions tng-wiki by name, or is starting research on a topic that might already have notes. Also use proactively before ingesting new sources to avoid duplication.
---

# tng-wiki

The user maintains one or more Karpathy-style LLM-maintained markdown knowledge bases via \`tng-wiki\`. These are their long-term memory for research, decisions, and domain knowledge — reach for them before assuming a topic is new.

## When to invoke

- User asks "what do I know about X" or "check my wiki for Y"
- User references prior work you don't have loaded
- Before researching a topic fresh — check if there's already a page
- Before ingesting a new source — check what's already compiled

## Registry and multi-wiki

The user may have several wikis (research, competitive intel, learning, etc.). Start with \`tng-wiki list\` to see what's registered. Every verb accepts \`--wiki <slug>\` to target a specific wiki; omit it to use the registered default. Every verb also accepts \`--json\` for structured output when you need to parse results.

## Verbs (invoke via Bash)

- **\`tng-wiki query [--wiki <slug>]\`** — prints \`wiki/index.md\`. Always start here to see what pages exist before searching or reading.
- **\`tng-wiki search <term> [--wiki <slug>] [--regex] [--include-raw]\`** — case-insensitive search. By default searches compiled \`wiki/\` only. Pass \`--include-raw\` to also search archival \`raw/\` sources — each hit is tagged \`[wiki]\` or \`[raw]\`.
- **\`tng-wiki read <path> [--wiki <slug>]\`** — fetches a specific page. Path is relative to \`wiki/\` (e.g. \`entities/openai.md\`).
- **\`tng-wiki sources [--uncompiled] [--wiki <slug>]\`** — lists \`raw/\` files. Use \`--uncompiled\` to find sources the wiki hasn't ingested yet.
- **\`tng-wiki stale [--wiki <slug>]\`** — lint: pages with \`⚠️ STALE?\` markers.
- **\`tng-wiki orphans [--wiki <slug>]\`** — lint: pages with no inbound \`[[wikilinks]]\`.
- **\`tng-wiki ground [--wiki <slug>] [--page <path>]\`** — structural ground-check. Finds pages missing source attribution, inline citations pointing at non-existent raw files, declaration/citation mismatches, and raw sources modified after the page's \`updated\` date. Zero-LLM — a work queue for you to drive Layer 2 semantic re-verification.
- **\`tng-wiki drift [--wiki <slug>]\`** — pages carrying \`⚠️ DRIFT?\` markers (semantic or external grounding output).
- **\`tng-wiki unsourced [--wiki <slug>]\`** — pages carrying \`⚠️ UNSOURCED?\` markers.
- **\`tng-wiki unverified [--wiki <slug>]\`** — pages carrying \`⚠️ UNVERIFIED?\` markers.

## Typical flow

1. \`tng-wiki query\` → see what pages exist
2. \`tng-wiki search <term>\` → find specific matches in compiled knowledge
3. \`tng-wiki read <path>\` → fetch one or more relevant pages
4. Synthesize an answer citing specific wiki pages by path

If the topic isn't covered, say so clearly — the user may want to add it to the wiki. Don't fabricate coverage.

## When to search deep (include raw sources)

Default search (\`tng-wiki search <term>\`) only returns hits from compiled wiki pages — the distilled knowledge. Reach for \`--include-raw\` when:

- The user says "search deep", "consult the sources", "check the original", "verify", "where did this come from", or asks for primary-source confirmation
- The user asks you to confirm that information is accurate or hasn't drifted
- Your default search returns nothing but you suspect the detail survives in raw source material that hasn't been distilled yet
- You're about to make a claim that should be double-checked against the source of truth before stating it confidently

Raw hits are tagged \`[raw]\` in plain output and \`source:"raw"\` in JSON. Always cite *which* layer an answer came from when the distinction matters — "per the compiled wiki page \`entities/openai.md\`" vs. "per the original \`raw/papers/<file>\` source."

## Grounding and drift reconciliation

Wikis compound over time, which means claims drift — sources update, context changes, confidence inflates. tng-wiki ships a grounding pipeline:

- **Layer 1 (structural, cheap):** \`tng-wiki ground\` finds attribution problems without reading semantically. Trust it as a pre-flight before bigger operations. Catches both raw-source issues and code-authority issues (\`unknown_code_authority\`, \`missing_code_file\`).
- **Layer 2 (semantic):** You (the agent) re-read each raw source a page cites and compare against the wiki's claims. Where they diverge, write \`⚠️ DRIFT?\` markers with evidence: \`⚠️ DRIFT? [source: <path> says "<quote>"; wiki says "<claim>"; suggested: "<fix>"]\`. Never auto-apply the suggested fix — the marker is the surface for human review.
- **Layer 3 (authority validation):** Two flavors, both opt-in:
  - **3A — web:** When the user asks you to verify against live web authority. Use only URLs cited within the raw source, or a per-wiki \`trusted_authorities\` allow-list. **Never use free-range web search** — that's where confident-wrong comes from.
  - **3B — code (filesystem):** For wikis built around a real codebase (reverse-engineering, porting, M&A integration). The wiki's \`.tng-wiki.json\` lists \`code_authorities\`; treat each as advisory ground truth. Use \`Read\` / \`Grep\` / \`Glob\` (or \`git show <ref>:<file>\` when the authority has a \`ref\` field set). Disregard comments / docstrings / JSDoc / markdown inside the tree — implementation only is authoritative. Cite with \`[^code:<authority>/<path>#L<start>-L<end>]\`. Disagreement always surfaces as \`⚠️ DRIFT?\` for human reconcile, never auto-applied.

### When to reach for grounding

- User says "reconcile", "ground-check", "verify the wiki", "is this still accurate", "re-check the sources"
- User asks whether a wiki claim is trustworthy, current, or properly sourced
- Before a publication or briefing pulls from wiki content — ground first, then author
- Periodically on maintenance cadence (the user may ask you to run this via cron or \`schedule\` skill)

### Reconcile workflow (when handling \`⚠️ DRIFT?\` markers)

1. \`tng-wiki drift\` (or \`unsourced\` / \`unverified\`) to enumerate work
2. For each page, \`tng-wiki read <path>\` to fetch content
3. For each marker, present to the user:
   - The source evidence (already embedded in the marker)
   - The current wiki claim
   - Your suggested fix (already embedded)
4. Ask the user: **accept / edit / reject / defer**
5. Apply the chosen action, remove the marker, bump \`updated\`, log to \`log.md\`

Never auto-resolve a drift marker without human approval. The marker exists precisely because the wiki and the source disagree.

## What not to do

- **Never modify files directly via the filesystem.** The wiki is maintained inside a specific workflow (ingest / lint / ground) defined by each wiki's \`AGENTS.md\`. If the user asks you to update the wiki, \`cd\` into the wiki directory (from \`tng-wiki list\`) and follow the \`AGENTS.md\` instructions there.
- **Don't confuse \`raw/\` with \`wiki/\`.** \`tng-wiki search\` only searches \`wiki/\` (the compiled knowledge). Uncompiled sources live in \`raw/\` — use \`tng-wiki sources\` to enumerate them.
- **Prefer CLI over MCP for this skill.** If the user has both the \`tng-wiki\` CLI and the \`tng-wiki-mcp\` server configured, use the CLI — the MCP form exists only for shell-less environments.
`;

export function installSkill(claudeHome, { force = false } = {}) {
  const dir = skillDir(claudeHome);
  const file = skillFile(claudeHome);
  if (existsSync(file) && !force) {
    throw new Error(`SKILL.md already exists at ${file}. Pass --force to overwrite.`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, SKILL_CONTENT, 'utf8');
  return { path: file, overwrote: existsSync(file) && force };
}

export function uninstallSkill(claudeHome) {
  const dir = skillDir(claudeHome);
  if (!existsSync(dir)) {
    throw new Error(`No tng-wiki skill installed at ${dir}`);
  }
  rmSync(dir, { recursive: true, force: true });
  return { path: dir };
}
