import { generateClaudeMd } from './claude-code.js';

const CODEX_HEADER = `> This file is designed for OpenAI Codex. The same wiki can also be used with Claude Code (CLAUDE.md) or Cursor (.cursorrules).`;

export function generateAgentsMd(context) {
  return generateClaudeMd({ ...context, header: CODEX_HEADER });
}
