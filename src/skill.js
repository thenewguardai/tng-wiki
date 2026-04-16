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
- **\`tng-wiki search <term> [--wiki <slug>] [--regex]\`** — case-insensitive search across wiki pages. Returns grep-style \`path:line: text\`.
- **\`tng-wiki read <path> [--wiki <slug>]\`** — fetches a specific page. Path is relative to \`wiki/\` (e.g. \`entities/openai.md\`).
- **\`tng-wiki sources [--uncompiled] [--wiki <slug>]\`** — lists \`raw/\` files. Use \`--uncompiled\` to find sources the wiki hasn't ingested yet.
- **\`tng-wiki stale [--wiki <slug>]\`** — lint: pages with \`⚠️ STALE?\` markers.
- **\`tng-wiki orphans [--wiki <slug>]\`** — lint: pages with no inbound \`[[wikilinks]]\`.

## Typical flow

1. \`tng-wiki query\` → see what pages exist
2. \`tng-wiki search <term>\` → find specific matches
3. \`tng-wiki read <path>\` → fetch one or more relevant pages
4. Synthesize an answer citing specific wiki pages by path

If the topic isn't covered, say so clearly — the user may want to add it to the wiki. Don't fabricate coverage.

## What not to do

- **Never modify files directly via the filesystem.** The wiki is maintained inside a specific workflow (ingest / lint) defined by each wiki's \`AGENTS.md\`. If the user asks you to update the wiki, \`cd\` into the wiki directory (from \`tng-wiki list\`) and follow the \`AGENTS.md\` instructions there.
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
