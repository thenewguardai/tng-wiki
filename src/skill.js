import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { installedVersion } from './version.js';

export const SKILL_NAME = 'tng-wiki';

export function skillDir(claudeHome = join(homedir(), '.claude')) {
  return join(claudeHome, 'skills', SKILL_NAME);
}

export function skillFile(claudeHome) {
  return join(skillDir(claudeHome), 'SKILL.md');
}

export const SKILL_CONTENT = `---
name: tng-wiki
description: Query the user's tng-wiki knowledge base. Use when the user asks about topics from their personal wiki, references prior research, says "check my wiki" or "what do I know about X", mentions tng-wiki by name, or is starting research on a topic that might already have notes. Also use proactively before ingesting new sources to avoid duplication, and for wiki maintenance - trigger on "do your rounds", "wiki rounds", "wiki maintenance", or "housekeeping".
---

# tng-wiki

The user maintains one or more Karpathy-style LLM-maintained markdown knowledge bases via \`tng-wiki\`. These are their long-term memory for research, decisions, and domain knowledge - reach for them before assuming a topic is new.

## When to invoke

- User asks "what do I know about X" or "check my wiki for Y"
- User references prior work you don't have loaded
- Before researching a topic fresh - check if there's already a page
- Before ingesting a new source - check what's already compiled

## Registry and multi-wiki

The user may have several wikis (research, competitive intel, learning, etc.). Start with \`tng-wiki list\` to see what's registered. Every verb accepts \`--wiki <slug>\` to target a specific wiki; omit it and the verb targets the wiki the current directory is inside (git-style, ancestor directories count), falling back to the registered default when you're not standing in one. Every verb also accepts \`--json\` for structured output when you need to parse results.

## Setting up a wiki (when there isn't one yet)

If the user wants a *new* wiki, or to adopt the current project into one, scaffold it yourself - \`init\` has a non-interactive mode, so you don't need a TTY:

- **See the whole surface in one call:** \`tng-wiki help --json\` lists every command, flag, and example. \`tng-wiki doctor\` reports this directory's state and the recommended next command. Reach for these instead of probing each verb with \`--help\`.
- **Create a new wiki:** \`tng-wiki init --yes --dir <path> --domain <d> --agent claude-code --name "<name>"\` (domains: ai-research, competitive-intel, publication, business-ops, learning, software-engineering, code-archaeology, blank).
- **Adopt an existing repo/dir:** \`tng-wiki init --yes --dir . --into-existing --no-integrations\` - never overwrites existing files; merges \`.gitignore\`.
- **Register a wiki already on disk:** \`tng-wiki register <path>\`.
- **Make other repos aware of a wiki:** \`tng-wiki connect <repo> --wiki <slug>\` writes a git-excluded \`CLAUDE.local.md\` nudge.

## Verbs (invoke via Bash)

- **\`tng-wiki query [--wiki <slug>]\`** - prints \`wiki/index.md\`. Always start here to see what pages exist before searching or reading.
- **\`tng-wiki search <term> [--wiki <slug>] [--regex] [--include-raw] [--include-leads]\`** - case-insensitive search. By default searches compiled \`wiki/\` only. Pass \`--include-raw\` to also search archival \`raw/\` sources - each hit is tagged \`[wiki]\` or \`[raw]\`. Pass \`--include-leads\` to also search registered lead archives (\`.tng-wiki.json → lead_archives\`) - external, fallible doc trees; hits tagged \`[lead:<name>]\`. Leads are never citable.
- **\`tng-wiki read <page> [--wiki <slug>]\`** - fetches a specific page. Accepts a path relative to \`wiki/\` (e.g. \`entities/openai.md\`; \`.md\` optional, a leading \`wiki/\` is tolerated), a \`[[wikilink]]\`, or a unique page stem (e.g. \`openai\`). Ambiguous stems error with the candidate list.
- **\`tng-wiki sources [--uncompiled] [--wiki <slug>]\`** - lists \`raw/\` files. Use \`--uncompiled\` to find sources the wiki hasn't ingested yet.
- **\`tng-wiki stale [--wiki <slug>]\`** - lint: pages with \`⚠️ STALE?\` markers.
- **\`tng-wiki orphans [--wiki <slug>]\`** - lint: pages with no inbound \`[[wikilinks]]\`.
- **\`tng-wiki ground [--wiki <slug>] [--page <path>] [--update-lock] [--fix-moved]\`** - structural ground-check. Finds pages missing source attribution, inline citations pointing at non-existent raw files, declaration/citation mismatches, raw sources modified after the page's \`updated\` date, index-header drift, and warn-level convention findings (stale frontmatter \`updated\`, prose internal refs). When the wiki has a citation lockfile (\`wiki/.tng-wiki.lock.json\`), also reports per-citation churn: \`cite_content_changed\` (cited content edited since last verified - the surgical re-verification queue), \`cite_moved\` (content identical, line anchor shifted - fix with \`--fix-moved\`), and \`cite_unlocked\`. Run \`ground --update-lock\` after verifying/reconciling to bless current state - never run it on unverified content. Zero-LLM - a work queue for you to drive Layer 2 semantic re-verification.
- **\`tng-wiki cite show <page> [--wiki <slug>] [--at-ref] [--cite <n|key>] [--context <lines>]\`** - claim-next-to-evidence review: prints every citation in a page with the claim sentence that carries it and the exact source lines it cites (raw and code-authority cites alike). Use it instead of hand-running \`sed -n 'X,Yp'\` against authority files.
- **\`tng-wiki drift [--wiki <slug>]\`** - pages carrying \`⚠️ DRIFT?\` markers (semantic or external grounding output).
- **\`tng-wiki unsourced [--wiki <slug>]\`** - pages carrying \`⚠️ UNSOURCED?\` markers.
- **\`tng-wiki unverified [--wiki <slug>]\`** - pages carrying \`⚠️ UNVERIFIED?\` markers.
- **\`tng-wiki rounds [--wiki <slug>]\`** - maintenance dashboard: counts of uncompiled sources, \`_inbox/\` items pending triage (librarian-style wikis), plus ground / convention warnings / orphans / unsourced / unverified / stale / drift, and a ritual meta-health line (days since the last \`log.md\` entry + the wiki repo's uncommitted churn - a lapsed maintenance loop is a finding even when every marker reads clean). The anchor for "do your rounds".

## Typical flow

1. \`tng-wiki query\` → see what pages exist
2. \`tng-wiki search <term>\` → find specific matches in compiled knowledge
3. \`tng-wiki read <path>\` → fetch one or more relevant pages
4. Synthesize an answer citing specific wiki pages by path

If the topic isn't covered, say so clearly - the user may want to add it to the wiki. Don't fabricate coverage.

## When to search deep (include raw sources)

Default search (\`tng-wiki search <term>\`) only returns hits from compiled wiki pages - the distilled knowledge. Reach for \`--include-raw\` when:

- The user says "search deep", "consult the sources", "check the original", "verify", "where did this come from", or asks for primary-source confirmation
- The user asks you to confirm that information is accurate or hasn't drifted
- Your default search returns nothing but you suspect the detail survives in raw source material that hasn't been distilled yet
- You're about to make a claim that should be double-checked against the source of truth before stating it confidently

Raw hits are tagged \`[raw]\` in plain output and \`source:"raw"\` in JSON. Always cite *which* layer an answer came from when the distinction matters - "per the compiled wiki page \`entities/openai.md\`" vs. "per the original \`raw/papers/<file>\` source."

## Lead archives (\`--include-leads\`)

Some wikis register external, fallible doc archives in \`.tng-wiki.json → lead_archives\` - e.g. a directory of AI-generated discovery docs in another repo. Reach for \`tng-wiki search <term> --include-leads\` when:

- The user names a registered lead archive, or says "check the leads", "search the archive", "what did the discovery docs say"
- A default (and \`--include-raw\`) search misses but the topic plausibly lives in pre-distillation discovery material
- You're orienting in a reverse-engineering / M&A wiki and need candidate places to look before grounding

Lead hits are tagged \`[lead:<name>]\` in plain output and \`source:"lead", archive:"<name>"\` in JSON; \`--include-leads\` and \`--include-raw\` are independent and combine. **Leads are never sources**: never cite a lead inline or in frontmatter \`sources:\` (\`tng-wiki ground\` errors with \`cited_lead_archive\`). Re-ground anything a lead suggests against \`code_authorities\` or \`raw/\` before it enters the wiki, and record provenance with \`leads:\` frontmatter (\`<archive>:<relative-path>\`).

## Grounding and drift reconciliation

Wikis compound over time, which means claims drift - sources update, context changes, confidence inflates. tng-wiki ships a grounding pipeline:

- **Layer 1 (structural, cheap):** \`tng-wiki ground\` finds attribution problems without reading semantically. Trust it as a pre-flight before bigger operations. Catches both raw-source issues and code-authority issues (\`unknown_code_authority\`, \`missing_code_file\`).
- **Layer 2 (semantic):** You (the agent) re-read each raw source a page cites and compare against the wiki's claims. Where they diverge, write \`⚠️ DRIFT?\` markers with evidence: \`⚠️ DRIFT? [source: <path> says "<quote>"; wiki says "<claim>"; suggested: "<fix>"]\`. Never auto-apply the suggested fix - the marker is the surface for human review.
- **Layer 3 (authority validation):** Two flavors, both opt-in:
  - **3A - web:** When the user asks you to verify against live web authority. Use only URLs cited within the raw source, or a per-wiki \`trusted_authorities\` allow-list. **Never use free-range web search** - that's where confident-wrong comes from.
  - **3B - code (filesystem):** For wikis built around a real codebase (reverse-engineering, porting, M&A integration). The wiki's \`.tng-wiki.json\` lists \`code_authorities\`; treat each as advisory ground truth. Use \`Read\` / \`Grep\` / \`Glob\` (or \`git show <ref>:<file>\` when the authority has a \`ref\` field set). Disregard comments / docstrings / JSDoc / markdown inside the tree - implementation only is authoritative. Cite with \`[^code:<authority>/<path>#L<start>-L<end>]\`. Disagreement always surfaces as \`⚠️ DRIFT?\` for human reconcile, never auto-applied.

**Full protocol per wiki.** Each scaffolded wiki carries the complete grounding + reconcile doctrine - per-claim procedure, \`⚠️ DRIFT?\` evidence format, ref-pinning, verification-first flow - in \`.tng-wiki/doctrine/grounding.md\`. When you \`cd\` into a wiki to ground or reconcile, read that first; the wiki's \`AGENTS.md\` carries only a compact summary.

### When to reach for grounding

- User says "reconcile", "ground-check", "verify the wiki", "is this still accurate", "re-check the sources"
- User asks whether a wiki claim is trustworthy, current, or properly sourced
- Before a publication or briefing pulls from wiki content - ground first, then author
- As part of **rounds** (see below) - the user may wire rounds to cron or the \`schedule\` skill

### Reconcile workflow (when handling \`⚠️ DRIFT?\` markers)

1. \`tng-wiki drift\` (or \`unsourced\` / \`unverified\`) to enumerate work
2. For each page, \`tng-wiki read <path>\` to fetch content
3. \`tng-wiki cite show <path>\` to see each claim next to the exact lines it cites - add \`--cite <n>\` to focus one citation and \`--at-ref\` to pin code authorities to their refs. This replaces re-hunting every cite by hand.
4. For each marker, present to the user:
   - The source evidence (already embedded in the marker, verifiable via \`cite show\`)
   - The current wiki claim
   - Your suggested fix (already embedded)
5. Ask the user: **accept / edit / reject / defer**
6. Apply the chosen action, remove the marker, bump \`updated\`, log to \`log.md\`

Never auto-resolve a drift marker without human approval. The marker exists precisely because the wiki and the source disagree.

## Rounds (wiki maintenance)

When the user says "do your rounds", "do wiki rounds", "wiki maintenance", or "housekeeping", run the full maintenance bundle and report a short summary:

1. Ingest anything pending in \`raw/\` (\`tng-wiki sources --uncompiled\`), and triage anything sitting in \`_inbox/\` when the wiki has one (the rounds dashboard counts it).
2. Run \`tng-wiki rounds\` for the lint counts at a glance, then \`ground\` / \`orphans\` / \`unsourced\` / \`unverified\` / \`stale\` / \`drift\` for detail.
3. Review \`cite_content_changed\` findings - that is the per-citation re-verification queue; re-check each against the authority. Run \`tng-wiki ground --fix-moved\` to repair shifted \`#L\` anchors (safe: content unchanged).
4. Reconcile what's safely reconcilable; surface the \`⚠️\` markers that need the user.
5. After reconcile, finish with \`tng-wiki ground --update-lock\` to record the newly verified state in the lockfile.
6. Update \`wiki/index.md\` and append a \`wiki/log.md\` entry.
7. Report what changed and what still needs human judgment.

Each wiki's \`AGENTS.md\` defines rounds precisely - \`cd\` into the wiki dir (from \`tng-wiki list\`) and follow it for the maintenance steps.

**Schema upgrades.** When \`tng-wiki doctor\` reports a wiki's schema was generated by an older CLI, suggest \`tng-wiki upgrade --dry-run --wiki <slug>\` (then the real run). It regenerates \`AGENTS.md\` + \`.tng-wiki/doctrine/\` while preserving hand-authored sections; the previous schema is backed up to \`.tng-wiki/backup/AGENTS.md\`. Have the user review \`git diff\` before committing.

## What not to do

- **Never modify files directly via the filesystem.** The wiki is maintained inside a specific workflow (ingest / lint / ground) defined by each wiki's \`AGENTS.md\`. If the user asks you to update the wiki, \`cd\` into the wiki directory (from \`tng-wiki list\`) and follow the \`AGENTS.md\` instructions there.
- **Don't confuse \`raw/\` with \`wiki/\`.** \`tng-wiki search\` only searches \`wiki/\` (the compiled knowledge). Uncompiled sources live in \`raw/\` - use \`tng-wiki sources\` to enumerate them.
- **Prefer CLI over MCP for this skill.** If the user has both the \`tng-wiki\` CLI and the \`tng-wiki-mcp\` server configured, use the CLI - the MCP form exists only for shell-less environments.

<!-- tng-wiki-skill-version: ${installedVersion()} - doctor compares this file against the installed CLI; refresh with: tng-wiki install-skill -->
`;

// Freshness check for doctor: is the installed SKILL.md byte-identical to what
// this version of the CLI would generate? The version stamp embedded in
// SKILL_CONTENT guarantees a mismatch after any version bump until
// `tng-wiki install-skill` is re-run.
export function skillStatus(claudeHome) {
  const file = skillFile(claudeHome);
  if (!existsSync(file)) return { installed: false, fresh: false };
  try {
    return { installed: true, fresh: readFileSync(file, 'utf8') === SKILL_CONTENT };
  } catch {
    return { installed: true, fresh: false };
  }
}

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
