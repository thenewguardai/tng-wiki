import {
  generateAgentsMd, generateDoctrine, DOCTRINE_DIR,
  SCHEMA_FENCE_CLOSE, SCHEMA_FENCE_OPEN_RE, schemaFenceOpen,
} from './agents-md.js';

export {
  generateAgentsMd, generateDoctrine, DOCTRINE_DIR,
  SCHEMA_FENCE_CLOSE, SCHEMA_FENCE_OPEN_RE, schemaFenceOpen,
};

const AGENT_ALIASES = {
  'claude-code': ['CLAUDE.md'],
  'codex': [],
  'cursor': ['.cursorrules'],
  'all': ['CLAUDE.md', '.cursorrules'],
};

export const CANONICAL_SCHEMA_FILE = 'AGENTS.md';

export function schemaLayout(agent) {
  return {
    canonical: CANONICAL_SCHEMA_FILE,
    aliases: AGENT_ALIASES[agent] ?? [],
  };
}
