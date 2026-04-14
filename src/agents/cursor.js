import { generateClaudeMd } from './claude-code.js';

const CURSOR_HEADER = `> This file is designed for Cursor. The same wiki can also be used with Claude Code (CLAUDE.md) or OpenAI Codex (AGENTS.md).`;

export function generateCursorRules(context) {
  return generateClaudeMd({ ...context, header: CURSOR_HEADER });
}
