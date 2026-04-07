import { generateClaudeMd } from './claude-code.js';

export function generateAgentsMd(context) {
  // Same content as CLAUDE.md with Codex-specific header
  const content = generateClaudeMd(context);
  // Replace the first line and add Codex note
  return content.replace(
    '## What This Is',
    `> This file is designed for OpenAI Codex. The same wiki can also be used with Claude Code (CLAUDE.md) or Cursor (.cursorrules).

## What This Is`
  );
}
