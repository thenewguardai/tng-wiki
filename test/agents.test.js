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

test('generateAgentsMd teaches the four-marker taxonomy with resolution actions', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /## Marker Taxonomy/);
  for (const marker of ['⚠️ STALE?', '⚠️ UNSOURCED?', '⚠️ UNVERIFIED?', '⚠️ DRIFT?']) {
    assert.ok(out.includes(marker), `missing marker section: ${marker}`);
  }
});

test('generateAgentsMd documents per-claim citations and sources as a path list', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /\[\^raw\/announcements\/2026-anthropic-series-f\.md\]/);
  assert.match(out, /sources:[ \t]*#[^\n]*\n\s*-\s*raw\//);
});

test('generateAgentsMd includes Grounding and Reconcile Drifts operations', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /### Grounding/);
  assert.match(out, /### Reconcile Drifts/);
  assert.match(out, /Layer 1 — Structural/);
  assert.match(out, /Layer 2 — Semantic re-verification/);
  assert.match(out, /Layer 3 — Authority validation/);
});

test('generateAgentsMd Layer 2 documents triage order, per-claim outcomes, and dependency chains', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /Triage order when scope is a whole wiki/);
  assert.match(out, /Supported/);
  assert.match(out, /Partially supported/);
  assert.match(out, /Drifted/);
  assert.match(out, /Unsourceable/);
  assert.match(out, /Dependency chains/);
});

test('generateAgentsMd Layer 3A documents the web authority priority and forbids free-range search', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /3A\. Web authorities/);
  assert.match(out, /URLs cited in the raw source itself/);
  assert.match(out, /trusted_authorities/);
  assert.match(out, /Never.*[Ff]ree-range/s);
  assert.match(out, /Rate-limited/);
});

test('generateAgentsMd Layer 3B documents code authorities for reverse-engineering workflows', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /3B\. Code authorities/);
  assert.match(out, /code_authorities/);
  assert.match(out, /\[\^code:legacy-app\/src\/auth\/oauth\.ts#L42-L58\]/);
  assert.match(out, /disregard its comments, docstrings, JSDoc/);
  // advisory precedence — never auto-apply
  assert.match(out, /advisory/i);
  assert.match(out, /Never auto-apply/);
});

test('generateAgentsMd Layer 3B documents the optional `ref` field for git-pinned reads', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /Ref pinning/);
  assert.match(out, /git -C <path> show <ref>:<file>/);
  assert.match(out, /git -C <path> ls-tree/);
  // explicit note that Layer 1 ground does not honor ref
  assert.match(out, /Layer 1.*does not honor `ref`/s);
});

test('generateAgentsMd teaches both raw and code inline citation forms', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /\[\^raw\/announcements\/2026-anthropic-series-f\.md\]/);
  assert.match(out, /\[\^code:legacy-app\/src\/auth\/oauth\.ts#L42-L58\]/);
  // frontmatter example includes a code: entry
  assert.match(out, /- code:legacy-app/);
});

test('generateAgentsMd Layer 1 lists unknown_code_authority and missing_code_file checks', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /unknown_code_authority/);
  assert.match(out, /missing_code_file/);
});

test('generateAgentsMd software-engineering domain has ADR + component + incident page types', () => {
  const out = generateAgentsMd({ ...ctx, domain: 'software-engineering' });
  assert.match(out, /Domain: Software Engineering & Architecture/);
  assert.match(out, /Decision pages.*wiki\/decisions/s);
  assert.match(out, /Component pages.*wiki\/components/s);
  assert.match(out, /Incident pages.*wiki\/incidents/s);
  assert.match(out, /ADR Status Lifecycle/);
  assert.match(out, /supersedes/);
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
