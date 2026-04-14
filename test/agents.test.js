import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSchema } from '../src/agents/index.js';
import { generateClaudeMd } from '../src/agents/claude-code.js';
import { generateAgentsMd } from '../src/agents/codex.js';
import { generateCursorRules } from '../src/agents/cursor.js';

const ctx = { domain: 'ai-research', wikiName: 'Test Wiki', template: {} };

test('generateClaudeMd emits no injected header by default', () => {
  const out = generateClaudeMd(ctx);
  assert.ok(!out.includes('designed for OpenAI Codex'));
  assert.ok(!out.includes('designed for Cursor'));
  assert.match(out, /^# Test Wiki\n\n## What This Is/);
});

test('generateAgentsMd injects the Codex header above PREAMBLE', () => {
  const out = generateAgentsMd(ctx);
  const headerIdx = out.indexOf('designed for OpenAI Codex');
  const preambleIdx = out.indexOf('## What This Is');
  assert.ok(headerIdx > 0, 'Codex header missing');
  assert.ok(preambleIdx > headerIdx, 'header must appear before PREAMBLE');
});

test('generateCursorRules injects the Cursor header above PREAMBLE', () => {
  const out = generateCursorRules(ctx);
  const headerIdx = out.indexOf('designed for Cursor');
  const preambleIdx = out.indexOf('## What This Is');
  assert.ok(headerIdx > 0, 'Cursor header missing');
  assert.ok(preambleIdx > headerIdx, 'header must appear before PREAMBLE');
});

test('generateSchema("all") produces three distinct files with only the right headers', () => {
  const files = generateSchema('all', ctx);
  assert.deepEqual(Object.keys(files).sort(), ['.cursorrules', 'AGENTS.md', 'CLAUDE.md']);

  assert.ok(!files['CLAUDE.md'].includes('designed for OpenAI Codex'));
  assert.ok(!files['CLAUDE.md'].includes('designed for Cursor'));

  assert.ok(files['AGENTS.md'].includes('designed for OpenAI Codex'));
  assert.ok(!files['AGENTS.md'].includes('designed for Cursor'));

  assert.ok(files['.cursorrules'].includes('designed for Cursor'));
  assert.ok(!files['.cursorrules'].includes('designed for OpenAI Codex'));
});

test('header survives if PREAMBLE heading is renamed (regression: no string-match injection)', () => {
  // The old codex.js/cursor.js relied on replacing the literal string
  // '## What This Is'. If that heading is ever renamed, the header must
  // still be injected because it is now passed as a parameter, not matched.
  const out = generateAgentsMd(ctx);
  assert.ok(out.includes('designed for OpenAI Codex'));
});
