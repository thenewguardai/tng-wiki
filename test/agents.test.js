import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateAgentsMd, generateDoctrine, schemaLayout, CANONICAL_SCHEMA_FILE,
  SCHEMA_FENCE_CLOSE, SCHEMA_FENCE_OPEN_RE,
} from '../src/agents/index.js';
import { installedVersion } from '../src/version.js';

const ctx = { domain: 'ai-research', wikiName: 'Test Wiki', template: {} };

test('generateAgentsMd produces an agent-neutral schema with no per-agent header', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /^<!-- tng-wiki:schema /);
  assert.match(out, /# Test Wiki\n\n## What This Is/);
  assert.ok(!out.includes('designed for OpenAI Codex'));
  assert.ok(!out.includes('designed for Cursor'));
});

test('generateAgentsMd fences the whole schema as a managed region', () => {
  const out = generateAgentsMd(ctx);
  // opening marker: first line, carries generator version + domain
  const openMatch = out.match(SCHEMA_FENCE_OPEN_RE);
  assert.ok(openMatch, 'missing opening schema fence');
  assert.equal(out.indexOf(openMatch[0]), 0, 'opening fence must be the first line');
  assert.ok(openMatch[0].includes(`v${installedVersion()}`), 'fence must record the generator version');
  assert.ok(openMatch[0].includes('domain=ai-research'), 'fence must record the domain');
  // closing marker: last non-blank line, nothing generated after it
  assert.ok(out.trimEnd().endsWith(SCHEMA_FENCE_CLOSE), 'schema must end at the closing fence');
});

test('generateAgentsMd embeds domain-specific schema sections', () => {
  const aiResearch = generateAgentsMd({ ...ctx, domain: 'ai-research' });
  assert.match(aiResearch, /Opportunity pages/);
  assert.match(aiResearch, /Domain: AI \/ Tech Research/);

  const blank = generateAgentsMd({ ...ctx, domain: 'blank' });
  assert.ok(!blank.includes('Opportunity pages'));
});

test('generateAgentsMd carries the compact marker legend with all four markers and a doctrine pointer', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /## Markers/);
  for (const marker of ['⚠️ STALE?', '⚠️ UNSOURCED?', '⚠️ UNVERIFIED?', '⚠️ DRIFT?']) {
    assert.ok(out.includes(marker), `missing marker in legend: ${marker}`);
  }
  // the full taxonomy is deferred to on-demand doctrine, not the always-on schema
  assert.ok(!out.includes('## Marker Taxonomy'), 'full taxonomy should not be in AGENTS.md');
  assert.match(out, /\.tng-wiki\/doctrine\/markers\.md/);
});

test('generateDoctrine markers.md holds the full four-marker taxonomy with resolution actions', () => {
  const markers = generateDoctrine(ctx)['markers.md'];
  assert.match(markers, /## Marker Taxonomy/);
  for (const marker of ['⚠️ STALE?', '⚠️ UNSOURCED?', '⚠️ UNVERIFIED?', '⚠️ DRIFT?']) {
    assert.ok(markers.includes(marker), `missing marker section: ${marker}`);
  }
  // UNVERIFIED is an agent (Layer 2) judgment, not something `tng-wiki ground` detects
  assert.match(markers, /Layer 2 grounding \(semantic\)/);
});

test('generateAgentsMd documents per-claim citations and sources as a path list', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /\[\^raw\/announcements\/2026-anthropic-series-f\.md\]/);
  assert.match(out, /sources:[ \t]*#[^\n]*\n\s*-\s*raw\//);
});

test('generateAgentsMd keeps a compact 3-layer grounding summary and defers the protocol to doctrine', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /### Grounding/);
  assert.match(out, /Layer 1 - Structural/);
  assert.match(out, /Layer 2 - Semantic/);
  assert.match(out, /Layer 3 - Authority validation/);
  assert.match(out, /\.tng-wiki\/doctrine\/grounding\.md/);
  // the deep protocol is deferred, not always-on
  assert.ok(!out.includes('### Reconcile Drifts'), 'reconcile detail belongs in doctrine, not AGENTS.md');
  assert.ok(!out.includes('Triage order when scope is a whole wiki'), 'Layer 2 triage belongs in doctrine');
});

test('generateDoctrine grounding.md names the verification-first flow and the rejection-log audit pattern', () => {
  const g = generateDoctrine(ctx)['grounding.md'];
  assert.match(g, /Verification-first option/);
  assert.match(g, /rejection log/);
  assert.match(g, /deliverables\/\*_NOTES_\*\.md/);
  // the core argument, verbatim
  assert.match(g, /"we verified it" without a list of what failed verification is evidence nothing was looked for/);
});

test('generateDoctrine grounding.md includes Grounding and Reconcile Drifts with all three layers', () => {
  const g = generateDoctrine(ctx)['grounding.md'];
  assert.match(g, /## Grounding/);
  assert.match(g, /### Reconcile Drifts/);
  assert.match(g, /Layer 1 - Structural/);
  assert.match(g, /Layer 2 - Semantic re-verification/);
  assert.match(g, /Layer 3 - Authority validation/);
});

test('generateDoctrine grounding.md Layer 2 documents triage order, per-claim outcomes, and dependency chains', () => {
  const g = generateDoctrine(ctx)['grounding.md'];
  assert.match(g, /Triage order when scope is a whole wiki/);
  assert.match(g, /Supported/);
  assert.match(g, /Partially supported/);
  assert.match(g, /Drifted/);
  assert.match(g, /Unsourceable/);
  assert.match(g, /Dependency chains/);
});

test('generateDoctrine grounding.md Layer 3A documents the web authority priority and forbids free-range search', () => {
  const g = generateDoctrine(ctx)['grounding.md'];
  assert.match(g, /3A\. Web authorities/);
  assert.match(g, /URLs cited in the raw source itself/);
  assert.match(g, /trusted_authorities/);
  assert.match(g, /Never.*[Ff]ree-range/s);
  assert.match(g, /Rate-limited/);
});

test('generateDoctrine grounding.md Layer 3B documents code authorities for reverse-engineering workflows', () => {
  const g = generateDoctrine(ctx)['grounding.md'];
  assert.match(g, /3B\. Code authorities/);
  assert.match(g, /code_authorities/);
  assert.match(g, /\[\^code:legacy-app\/src\/auth\/oauth\.ts#L42-L58\]/);
  assert.match(g, /disregard its comments, docstrings, JSDoc/);
  // advisory precedence - never auto-apply
  assert.match(g, /advisory/i);
  assert.match(g, /Never auto-apply/);
});

test('generateDoctrine grounding.md Layer 3B documents the optional `ref` field for git-pinned reads', () => {
  const g = generateDoctrine(ctx)['grounding.md'];
  assert.match(g, /Ref pinning/);
  assert.match(g, /git -C <path> show <ref>:<file>/);
  assert.match(g, /git -C <path> ls-tree/);
  // explicit note that Layer 1 ground does not honor ref
  assert.match(g, /Layer 1.*does not honor `ref`/s);
});

test('generateDoctrine grounding.md documents branch-ref (tracking) vs tag/SHA-ref (true pin) semantics', () => {
  const g = generateDoctrine(ctx)['grounding.md'];
  // tag/SHA refs are true pins; branch refs track and move
  assert.match(g, /tag or commit-SHA refs.*true pins/is);
  assert.match(g, /branch refs.*\*tracks\*, not pins/is);
  // deterministic grounding against a branch = the lockfile records the resolved SHA
  assert.match(g, /resolved_sha/);
  // the plain-run warning is documented so agents know to heed it
  assert.match(g, /working_tree_of_ref_authority/);
});

test('generateAgentsMd teaches both raw and code inline citation forms', () => {
  const out = generateAgentsMd(ctx);
  assert.match(out, /\[\^raw\/announcements\/2026-anthropic-series-f\.md\]/);
  assert.match(out, /\[\^code:legacy-app\/src\/auth\/oauth\.ts#L42-L58\]/);
  // frontmatter example includes a code: entry
  assert.match(out, /- code:legacy-app/);
});

test('generateDoctrine grounding.md Layer 1 lists unknown_code_authority and missing_code_file checks', () => {
  const g = generateDoctrine(ctx)['grounding.md'];
  assert.match(g, /unknown_code_authority/);
  assert.match(g, /missing_code_file/);
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

test('generateAgentsMd code-archaeology domain teaches the verification-first story', () => {
  const out = generateAgentsMd({ ...ctx, domain: 'code-archaeology' });
  assert.match(out, /Domain: Code Archaeology \/ Reverse Engineering/);
  // wiki vs deliverables split + naming/versioning rule
  assert.match(out, /Wiki vs Deliverables/);
  assert.match(out, /YYYYMMDD_Topic_TYPE_vX\.Y\.md/);
  assert.match(out, /never retro-edited/);
  // leads, never sources + provenance block
  assert.match(out, /Leads, Never Sources/);
  assert.match(out, /leads, never sources/i);
  assert.match(out, /Provenance Block/);
  assert.match(out, /Corrections vs lead/);
  // verification-first flow + rejection log
  assert.match(out, /Verification-First Flow/);
  assert.match(out, /Premise-refute/);
  assert.match(out, /\[confirmed\]/);
  assert.match(out, /rejection log/i);
  assert.match(out, /open-threads\.md/);
  // zones created per-system, code-wins precedence, Layer-3B story intact
  assert.match(out, /deliberately no per-system zones/);
  assert.match(out, /Code wins/);
  assert.match(out, /⚠️ DRIFT\?/);
});

test('generateAgentsMd code-archaeology domain spells out librarian duties and a filing table', () => {
  const out = generateAgentsMd({ ...ctx, domain: 'code-archaeology' });
  assert.match(out, /### Librarian Duties \(standing, every session\)/);
  // the every-session checklist
  assert.match(out, /Triage `_inbox\/`/);
  // the two guardrails ported from the dogfooded contract
  assert.match(out, /Scan staged content for secrets before any commit/);
  assert.match(out, /Ask before moving or renaming any file you did not create/);
  // the filing-rules table maps content to a destination surface
  assert.match(out, /Filing rules: where new content goes/);
  assert.match(out, /\| Content \| Destination \|/);
});

test('generated schema and doctrine never contain an em-dash or en-dash (the tool eats its own no-em-dash rule)', () => {
  for (const domain of ['software-engineering', 'code-archaeology', 'ai-research', 'blank']) {
    const out = generateAgentsMd({
      ...ctx,
      domain,
      // a user-authored description carrying an em-dash must still come out clean
      leadArchives: [{ name: 'arch', path: '/a', description: 'predecessor notes — leads only' }],
    });
    assert.ok(!/[—–]/.test(out), `em/en-dash leaked into ${domain} schema`);
  }
  // the doctrine files carry the moved grounding + marker prose; hold them to the same rule
  for (const [name, content] of Object.entries(generateDoctrine({ wikiName: 'Test Wiki' }))) {
    assert.ok(!/[—–]/.test(content), `em/en-dash leaked into doctrine ${name}`);
  }
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
