import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateAgentsMd, schemaLayout, CANONICAL_SCHEMA_FILE } from '../src/agents/index.js';

const ctx = { domain: 'ai-research', wikiName: 'Test Wiki', template: {} };

test('generateAgentsMd produces an agent-neutral schema with no per-agent header', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /^# Test Wiki\n\n## What This Is/);
  assert.ok(!out.includes('designed for OpenAI Codex'));
  assert.ok(!out.includes('designed for Cursor'));
});

test('generateAgentsMd embeds domain-specific schema sections', () => {
  const aiResearch = generateAgentsMd({ ...ctx, domain: 'ai-research' });
  assert.match(aiResearch, /Opportunity pages/);
  assert.match(aiResearch, /Domain: AI \/ Tech Research/);

  const blank = generateAgentsMd({ ...ctx, domain: 'blank' });
  assert.ok(!blank.includes('Opportunity pages'));
});

test('CANONICAL_SCHEMA_FILE is AGENTS.md', () => {
  assert.equal(CANONICAL_SCHEMA_FILE, 'AGENTS.md');
});

test('schemaLayout(claude-code) adds CLAUDE.md as an alias', () => {
  assert.deepEqual(schemaLayout('claude-code'), {
    canonical: 'AGENTS.md',
    aliases: ['CLAUDE.md'],
  });
});

test('schemaLayout(codex) has no aliases — Codex reads AGENTS.md natively', () => {
  assert.deepEqual(schemaLayout('codex'), {
    canonical: 'AGENTS.md',
    aliases: [],
  });
});

test('schemaLayout(cursor) adds .cursorrules as an alias', () => {
  assert.deepEqual(schemaLayout('cursor'), {
    canonical: 'AGENTS.md',
    aliases: ['.cursorrules'],
  });
});

test('schemaLayout(all) adds both CLAUDE.md and .cursorrules aliases', () => {
  assert.deepEqual(schemaLayout('all'), {
    canonical: 'AGENTS.md',
    aliases: ['CLAUDE.md', '.cursorrules'],
  });
});

test('schemaLayout(unknown) returns no aliases rather than throwing', () => {
  assert.deepEqual(schemaLayout('does-not-exist'), {
    canonical: 'AGENTS.md',
    aliases: [],
  });
});
