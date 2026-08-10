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
- **\`tng-wiki search <term> [--wiki <slug> | --all-wikis] [--regex] [--include-raw] [--include-leads]\`** - case-insensitive search. By default searches compiled \`wiki/\` only. Pass \`--all-wikis\` to sweep every registered wiki in one invocation - hits are prefixed \`[<slug>]\`; this is the right form for "what do I know about X" when several wikis are registered. Pass \`--include-raw\` to also search archival \`raw/\` sources - each hit is tagged \`[wiki]\` or \`[raw]\`. Pass \`--include-leads\` to also search registered lead archives (\`.tng-wiki.json → lead_archives\`) - external, fallible doc trees; hits tagged \`[lead:<name>]\`. Leads are never citable.
- **\`tng-wiki read <page> [--wiki <slug>]\`** - fetches a specific page. Accepts a path relative to \`wiki/\` (e.g. \`entities/openai.md\`; \`.md\` optional, a leading \`wiki/\` is tolerated), a \`[[wikilink]]\`, a unique page stem (e.g. \`openai\`), or a cross-wiki reference \`<wiki-slug>:<page>\` (e.g. \`shared:llama-server\`) that resolves through the registry regardless of \`--wiki\`. Ambiguous stems error with the candidate list.
- **\`tng-wiki sources [--uncompiled] [--wiki <slug>]\`** - lists \`raw/\` files. Use \`--uncompiled\` to find sources the wiki hasn't ingested yet.
- **\`tng-wiki stale [--wiki <slug>]\`** - lint: pages with \`⚠️ STALE?\` markers.
- **\`tng-wiki orphans [--wiki <slug>]\`** - lint: pages with no inbound \`[[wikilinks]]\`.
- **\`tng-wiki ground [--wiki <slug>] [--page <path>] [--update-lock] [--fix-moved] [--fix-index] [--fix-dates]\`** - structural ground-check. Finds pages missing source attribution, inline citations pointing at non-existent raw files, declaration/citation mismatches, raw sources modified after the page's \`updated\` date, index-header drift, and warn-level convention findings (stale frontmatter \`updated\`, prose internal refs). When the wiki has a citation lockfile (\`wiki/.tng-wiki.lock.json\`), also reports per-citation churn: \`cite_content_changed\` (cited content edited since last verified - the surgical re-verification queue), \`cite_moved\` (content identical, line anchor shifted - fix with \`--fix-moved\`), and \`cite_unlocked\`. Run \`ground --update-lock\` after verifying/reconciling to bless current state - never run it on unverified content, and scope it with \`--page <p>\` to re-lock only the page you actually re-verified (other pages' lock entries are preserved). Zero-LLM - a work queue for you to drive Layer 2 semantic re-verification.
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

Wikis compound over time, which means claims drift - sources update, context changes, confidence inflates. Three escalating layers: **Layer 1 structural** (\`tng-wiki ground\` - zero-LLM pre-flight; with a committed lockfile it reports per-citation churn), **Layer 2 semantic** (you re-read each cited source against its claim; divergence becomes a \`⚠️ DRIFT?\` marker carrying its own evidence - never auto-applied), **Layer 3 authority validation** (opt-in: a web allow-list, or local \`code_authorities\` as advisory ground truth - never free-range web search).

**The full protocol lives in each wiki, not here:** \`.tng-wiki/doctrine/grounding.md\` carries the per-claim procedure, the \`⚠️ DRIFT?\` evidence format, ref-pinning, and the verification-first flow. When you \`cd\` into a wiki to ground or reconcile, read that first; the wiki's \`AGENTS.md\` carries only a compact summary.

### When to reach for grounding

- User says "reconcile", "ground-check", "verify the wiki", "is this still accurate", "re-check the sources"
- User asks whether a wiki claim is trustworthy, current, or properly sourced
- Before a publication or briefing pulls from wiki content - ground first, then author
- As part of **rounds** (see below) - the user may wire rounds to cron or the \`schedule\` skill

### Reconcile workflow (when handling \`⚠️ DRIFT?\` markers)

Enumerate work with \`tng-wiki drift\` (or \`unsourced\` / \`unverified\`), fetch pages with \`read\`, and use \`tng-wiki cite show <page> [--cite <n>] [--at-ref]\` to see each claim next to the exact lines it cites instead of re-hunting by hand. Present each marker's evidence + current claim + suggested fix; the user chooses **accept / edit / reject / defer**. Never auto-resolve a drift marker without human approval - the full loop is in \`.tng-wiki/doctrine/grounding.md\`.

## Rounds (wiki maintenance)

When the user says "do your rounds", "do wiki rounds", "wiki maintenance", or "housekeeping": the canonical procedure is the **Rounds section of the wiki's \`.tng-wiki/doctrine/operations.md\`** - \`cd\` into the wiki (path from \`tng-wiki list\`), read it, run it end to end, and report a short summary. In brief: coordinate (\`claim\` / \`sync\`) → ingest pending \`raw/\` and triage \`_inbox/\` → \`tng-wiki rounds\` dashboard plus lint verbs → work the \`cite_content_changed\` queue → reconcile → \`ground --update-lock\` (scoped \`--page\` when only some pages were re-verified) → update index, append log, report. Where this summary and the wiki's \`operations.md\` disagree, the doctrine file wins - it is the single source.

**Schema upgrades.** When \`tng-wiki doctor\` reports a wiki's schema was generated by an older CLI, suggest \`tng-wiki upgrade --dry-run --wiki <slug>\` (then the real run). It regenerates \`AGENTS.md\` + \`.tng-wiki/doctrine/\` while preserving hand-authored sections; the previous schema is backed up to \`.tng-wiki/backup/AGENTS.md\`. Have the user review \`git diff\` before committing.

**Shared wikis on a new machine.** When \`doctor\` shows code authorities "missing on this machine" (a wiki cloned from a teammate whose repos live at different paths), suggest \`tng-wiki localize\`. It records a gitignored \`.tng-wiki.local.json\` remapping each authority to the local path, or marking it "trusted" (accept the recorded verification as truth when the user doesn't have that checkout). Trusted authorities then show in \`ground\` as an informational "N citations trusted, not verifiable here (verified <ref>@<sha>)" line instead of errors - the read/search/query surface never needed the authorities, so a shared wiki is useful immediately regardless.

## What not to do

- **Never modify files directly via the filesystem.** The wiki is maintained inside a specific workflow (ingest / lint / ground) defined by each wiki's \`AGENTS.md\`. If the user asks you to update the wiki, \`cd\` into the wiki directory (from \`tng-wiki list\`) and follow the \`AGENTS.md\` instructions there.
- **One exception: \`_inbox/\` capture.** On wikis whose \`AGENTS.md\` defines the inbox capture contract, any session may drop NEW files into \`_inbox/\` - capture is cheap and owes no grounding, index, or log updates; a later librarian session triages them. The exception covers adding new capture files only: filing into \`wiki/\` / \`raw/\` / \`deliverables/\` stays librarian work (\`tng-wiki graduate <item>\` moves a capture to \`raw/\` when a page needs to cite it), and \`_inbox/\` is never a citable root.
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
  const exists = existsSync(file);
  if (exists && !force) {
    // The overwrite guard protects files the tool does not own. The managed
    // footer stamp marks ownership, so a stamped file refreshes freely - the
    // documented refresh path (doctor and the footer itself both say "refresh
    // with: tng-wiki install-skill") must work without --force (#50).
    const managed = readFileSync(file, 'utf8').includes('tng-wiki-skill-version:');
    if (!managed) {
      throw new Error(`SKILL.md already exists at ${file} and carries no tng-wiki version stamp - not tool-managed. Pass --force to overwrite.`);
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, SKILL_CONTENT, 'utf8');
  return { path: file, overwrote: exists };
}

export function uninstallSkill(claudeHome) {
  const dir = skillDir(claudeHome);
  if (!existsSync(dir)) {
    throw new Error(`No tng-wiki skill installed at ${dir}`);
  }
  rmSync(dir, { recursive: true, force: true });
  return { path: dir };
}
