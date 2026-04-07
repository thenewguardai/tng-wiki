import { generateClaudeMd } from './claude-code.js';
import { generateAgentsMd } from './codex.js';
import { generateCursorRules } from './cursor.js';

export function generateSchema(agent, context) {
  switch (agent) {
    case 'claude-code':
      return { 'CLAUDE.md': generateClaudeMd(context) };
    case 'codex':
      return { 'AGENTS.md': generateAgentsMd(context) };
    case 'cursor':
      return { '.cursorrules': generateCursorRules(context) };
    case 'all':
      return {
        'CLAUDE.md': generateClaudeMd(context),
        'AGENTS.md': generateAgentsMd(context),
        '.cursorrules': generateCursorRules(context),
      };
    default:
      return { 'CLAUDE.md': generateClaudeMd(context) };
  }
}
