import { generateClaudeMd } from './claude-code.js';

export function generateCursorRules(context) {
  const content = generateClaudeMd(context);
  return content.replace(
    '## What This Is',
    `> This file is designed for Cursor. The same wiki can also be used with Claude Code (CLAUDE.md) or OpenAI Codex (AGENTS.md).

## What This Is`
  );
}
