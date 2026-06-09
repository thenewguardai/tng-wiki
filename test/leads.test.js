import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scaffoldWiki, parseInitArgs, parseLeadFlags } from '../src/init.js';
import { extractLeads, checkGrounding, loadLeadArchives } from '../src/ground.js';
import { searchWiki, roundsReport } from '../src/verbs.js';
import { generateAgentsMd } from '../src/agents/index.js';
import { SKILL_CONTENT } from '../src/skill.js';
import { commandJson } from '../src/help.js';
import { saveRegistry, emptyRegistry, registerWiki } from '../src/registry.js';

const CLI_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

function makeWiki() {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-leads-'));
  scaffoldWiki(dir, { domain: 'blank', agent: 'claude-code', wikiName: 'Leads Demo' });
  return dir;
}

function writeFile(wikiRoot, relPath, content) {
  const full = join(wikiRoot, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

function setLeadArchives(wikiRoot, archives) {
  const metaPath = join(wikiRoot, '.tng-wiki.json');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  meta.lead_archives = archives;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

// --- frontmatter parsing ---

test('extractLeads parses inline, block, and quoted forms', () => {
  // inline array
  assert.deepEqual(
    extractLeads('leads: [arch:a.md, arch:b.md]'),
    ['arch:a.md', 'arch:b.md'],
  );
  // block list
  assert.deepEqual(
    extractLeads('title: X\nleads:\n  - arch:a.md\n  - arch:sub/b.md\ntags: []'),
    ['arch:a.md', 'arch:sub/b.md'],
  );
  // quoted entries (both forms)
  assert.deepEqual(
    extractLeads('leads:\n  - "arch:20260504_RAPS_Analysis2.md"\n  - \'arch:b.md\''),
    ['arch:20260504_RAPS_Analysis2.md', 'arch:b.md'],
  );
  assert.deepEqual(extractLeads('leads: ["arch:a.md"]'), ['arch:a.md']);
  // absent key — empty, never null (leads are optional)
  assert.deepEqual(extractLeads('title: X'), []);
});

test('extractLeads does not bleed into or out of adjacent sources block', () => {
  const fm = 'sources:\n  - raw/a.md\nleads:\n  - arch:x.md\nupdated: 2026-01-01';
  assert.deepEqual(extractLeads(fm), ['arch:x.md']);
});

// --- cited_lead_archive (error-level) ---

test('ground flags cited_lead_archive when an inline [^raw/...] cite resolves into a lead archive', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'raw/ai-archive/doc.md', 'archived analysis');
    setLeadArchives(dir, [{ name: 'arch', path: 'raw/ai-archive' }]);
    writeFile(dir, 'wiki/entities/a.md',
      '---\nsources:\n  - raw/ai-archive/doc.md\n---\nClaim.[^raw/ai-archive/doc.md]');
    const { issues } = checkGrounding(dir, { page: 'entities/a.md' });
    const hit = issues.find((i) => i.issue === 'cited_lead_archive');
    assert.ok(hit);
    assert.equal(hit.archive, 'arch');
    assert.equal(hit.raw, 'raw/ai-archive/doc.md');
    assert.equal(hit.line, 5); // frontmatter is lines 1-4
    // error-level: no warn marker
    assert.notEqual(hit.level, 'warn');
    // the file exists inside the archive — must not also be missing_raw
    assert.ok(!issues.some((i) => i.issue === 'missing_raw'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ground flags cited_lead_archive on a frontmatter sources: entry resolving into an archive (declared-only)', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, '../lead-docs/analysis.md', 'lead body');
    setLeadArchives(dir, [{ name: 'kpom', path: '../lead-docs' }]);
    writeFile(dir, 'raw/papers/ok.md', 'body');
    writeFile(dir, 'wiki/entities/b.md',
      '---\nsources:\n  - raw/papers/ok.md\n  - ../lead-docs/analysis.md\n---\nClaim.[^raw/papers/ok.md]');
    const { issues } = checkGrounding(dir, { page: 'entities/b.md' });
    const hit = issues.find((i) => i.issue === 'cited_lead_archive');
    assert.ok(hit);
    assert.equal(hit.archive, 'kpom');
    assert.equal(hit.raw, '../lead-docs/analysis.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dir, '..', 'lead-docs'), { recursive: true, force: true });
  }
});

test('ground flags cited_lead_archive (not unknown_code_authority) when an archive is cited as a code authority', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, '../lead-docs/analysis.md', 'lead body');
    setLeadArchives(dir, [{ name: 'kpom', path: '../lead-docs' }]);
    writeFile(dir, 'wiki/entities/c.md',
      '---\nsources:\n  - code:kpom\n---\nClaim.[^code:kpom/analysis.md]');
    const { issues } = checkGrounding(dir, { page: 'entities/c.md' });
    const hits = issues.filter((i) => i.issue === 'cited_lead_archive');
    assert.equal(hits.length, 1); // per-cite, not duplicated for the declared entry
    assert.equal(hits[0].archive, 'kpom');
    assert.equal(hits[0].file, 'analysis.md');
    assert.equal(hits[0].line, 5);
    assert.ok(!issues.some((i) => i.issue === 'unknown_code_authority'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dir, '..', 'lead-docs'), { recursive: true, force: true });
  }
});

test('ground flags cited_lead_archive when a real code authority cite resolves inside an archive', () => {
  const dir = makeWiki();
  try {
    // authority tree containing a nested lead archive
    writeFile(dir, 'authority-src/src/real.ts', 'export const ok = 1;');
    writeFile(dir, 'authority-src/ai-docs/overview.md', 'generated doc');
    const metaPath = join(dir, '.tng-wiki.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    meta.code_authorities = [{ name: 'app', path: 'authority-src' }];
    meta.lead_archives = [{ name: 'ai-docs', path: 'authority-src/ai-docs' }];
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    writeFile(dir, 'wiki/entities/d.md',
      '---\nsources:\n  - code:app\n---\nOK.[^code:app/src/real.ts]\nBad.[^code:app/ai-docs/overview.md]');
    const { issues } = checkGrounding(dir, { page: 'entities/d.md' });
    const hit = issues.find((i) => i.issue === 'cited_lead_archive');
    assert.ok(hit);
    assert.equal(hit.archive, 'ai-docs');
    assert.equal(hit.authority, 'app');
    assert.equal(hit.file, 'ai-docs/overview.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- leads: provenance validation (warn-level) ---

test('ground: valid leads entries produce no findings and are exempt from sources invariants', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, '../lead-docs/analysis.md', 'lead body');
    setLeadArchives(dir, [{ name: 'kpom', path: '../lead-docs' }]);
    writeFile(dir, 'raw/papers/real.md', 'body');
    writeFile(dir, 'wiki/entities/clean.md',
      '---\ntitle: C\nupdated: 2099-01-01\nsources:\n  - raw/papers/real.md\nleads:\n  - kpom:analysis.md\n---\nClaim.[^raw/papers/real.md]');
    const { issues } = checkGrounding(dir, { page: 'entities/clean.md' });
    // no orphan_source_decl / undeclared_cite / anything from the leads entry
    assert.deepEqual(issues, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dir, '..', 'lead-docs'), { recursive: true, force: true });
  }
});

test('ground warns missing_lead when the referenced archive file is gone', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, '../lead-docs/exists.md', 'still here');
    setLeadArchives(dir, [{ name: 'kpom', path: '../lead-docs' }]);
    writeFile(dir, 'raw/papers/real.md', 'body');
    writeFile(dir, 'wiki/entities/e.md',
      '---\ntitle: E\nupdated: 2099-01-01\nsources:\n  - raw/papers/real.md\nleads:\n  - kpom:vanished.md\n---\nClaim.[^raw/papers/real.md]');
    const { issues } = checkGrounding(dir, { page: 'entities/e.md' });
    const hit = issues.find((i) => i.issue === 'missing_lead');
    assert.ok(hit);
    assert.equal(hit.level, 'warn');
    assert.equal(hit.lead, 'kpom:vanished.md');
    assert.equal(hit.archive, 'kpom');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dir, '..', 'lead-docs'), { recursive: true, force: true });
  }
});

test('ground warns unknown_lead_archive when the archive name is not registered', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, 'raw/papers/real.md', 'body');
    writeFile(dir, 'wiki/entities/f.md',
      '---\ntitle: F\nupdated: 2099-01-01\nsources:\n  - raw/papers/real.md\nleads:\n  - ghost:doc.md\n---\nClaim.[^raw/papers/real.md]');
    const { issues } = checkGrounding(dir, { page: 'entities/f.md' });
    const hit = issues.find((i) => i.issue === 'unknown_lead_archive');
    assert.ok(hit);
    assert.equal(hit.level, 'warn');
    assert.equal(hit.archive, 'ghost');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rounds does not count warn-level lead findings as ground issues', () => {
  const dir = makeWiki();
  try {
    setLeadArchives(dir, [{ name: 'kpom', path: '../lead-docs-nope' }]);
    writeFile(dir, 'raw/papers/real.md', 'body');
    // page is otherwise clean; only a missing_lead warn + unknown archive warn
    writeFile(dir, 'wiki/entities/g.md',
      '---\ntitle: G\nupdated: 2099-01-01\nsources:\n  - raw/papers/real.md\nleads:\n  - kpom:gone.md\n  - ghost:doc.md\n---\nClaim.[^raw/papers/real.md]\nSee [[index]].');
    const { issues } = checkGrounding(dir, { page: 'entities/g.md' });
    assert.equal(issues.length, 2);
    assert.ok(issues.every((i) => i.level === 'warn'));
    assert.equal(roundsReport(dir).ground, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- wikis without lead_archives are unaffected ---

test('a wiki without lead_archives produces no lead findings, even with leads-shaped paths', () => {
  const dir = makeWiki();
  try {
    // no lead_archives key manipulation beyond the scaffold default ([])
    assert.deepEqual(loadLeadArchives(dir), []);
    writeFile(dir, 'raw/papers/real.md', 'body');
    writeFile(dir, 'wiki/entities/h.md',
      '---\ntitle: H\nupdated: 2099-01-01\nsources:\n  - raw/papers/real.md\n---\nClaim.[^raw/papers/real.md]');
    const { issues } = checkGrounding(dir, { page: 'entities/h.md' });
    assert.deepEqual(issues, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- search --include-leads ---

test('searchWiki includeLeads returns tagged hits with archive-relative paths', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, '../lead-docs/sub/analysis.md', 'The RAPS module handles licensing');
    setLeadArchives(dir, [{ name: 'kpom', path: '../lead-docs' }]);

    // off by default
    assert.equal(searchWiki(dir, 'RAPS').length, 0);
    // independent of includeRaw
    assert.equal(searchWiki(dir, 'RAPS', { includeRaw: true }).length, 0);

    const hits = searchWiki(dir, 'RAPS', { includeLeads: true });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].source, 'lead');
    assert.equal(hits[0].archive, 'kpom');
    assert.equal(hits[0].path, 'sub/analysis.md'); // relative to the archive root
    assert.equal(hits[0].line, 1);
    assert.match(hits[0].text, /RAPS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dir, '..', 'lead-docs'), { recursive: true, force: true });
  }
});

test('searchWiki includeLeads and includeRaw combine, wiki hits first', () => {
  const dir = makeWiki();
  try {
    writeFile(dir, '../lead-docs/a.md', 'lead mentions Karpathy');
    setLeadArchives(dir, [{ name: 'kpom', path: '../lead-docs' }]);
    writeFile(dir, 'wiki/entities/k.md', 'compiled Karpathy');
    writeFile(dir, 'raw/papers/k.md', 'raw Karpathy');
    const hits = searchWiki(dir, 'Karpathy', { includeRaw: true, includeLeads: true });
    assert.deepEqual(hits.map((h) => h.source), ['wiki', 'raw', 'lead']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dir, '..', 'lead-docs'), { recursive: true, force: true });
  }
});

test('searchWiki includeLeads tolerates a missing archive path', () => {
  const dir = makeWiki();
  try {
    setLeadArchives(dir, [{ name: 'kpom', path: '../never-cloned' }]);
    assert.deepEqual(searchWiki(dir, 'anything', { includeLeads: true }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- CLI: plain + --json forms ---

test('CLI search --include-leads tags hits [lead:<name>] in plain output and source:"lead" in --json', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-leads-home-'));
  const dir = makeWiki();
  try {
    writeFile(dir, '../lead-docs/analysis.md', 'The RAPS module handles licensing');
    setLeadArchives(dir, [{ name: 'kpom', path: '../lead-docs' }]);
    saveRegistry(registerWiki(emptyRegistry(), { name: 'Leads Demo', path: dir, domain: 'blank' }), home);
    const env = { ...process.env, HOME: home, FORCE_COLOR: '0', NO_COLOR: '1' };

    const plain = execFileSync('node', [CLI_BIN, 'search', 'RAPS', '--include-leads'], { env }).toString();
    assert.match(plain, /\[lead:kpom\] analysis\.md:1:/);

    const json = JSON.parse(execFileSync('node', [CLI_BIN, 'search', 'RAPS', '--include-leads', '--json'], { env }).toString());
    assert.equal(json.hits.length, 1);
    assert.equal(json.hits[0].source, 'lead');
    assert.equal(json.hits[0].archive, 'kpom');

    // without the flag: no hits
    const off = JSON.parse(execFileSync('node', [CLI_BIN, 'search', 'RAPS', '--json'], { env }).toString());
    assert.equal(off.hits.length, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dir, '..', 'lead-docs'), { recursive: true, force: true });
  }
});

// --- generated docs ---

test('generateAgentsMd emits the Leads, Never Sources section iff lead_archives is non-empty', () => {
  const ctx = { domain: 'software-engineering', wikiName: 'Port', template: {} };
  const without = generateAgentsMd(ctx);
  assert.ok(!without.includes('Leads, Never Sources'));
  assert.ok(!without.includes('--include-leads'));
  // omitted param and explicit [] are byte-identical
  assert.equal(without, generateAgentsMd({ ...ctx, leadArchives: [] }));

  const archives = [{ name: 'kpom-ai-archive', path: '../../kp/KPOM-Legacy/Compliance/AI', description: 'Legacy AI-generated discovery docs' }];
  const out = generateAgentsMd({ ...ctx, leadArchives: archives });
  assert.match(out, /## Leads, Never Sources/);
  assert.match(out, /\*\*kpom-ai-archive\*\*/);
  assert.match(out, /--include-leads/);
  assert.match(out, /cited_lead_archive/);
  assert.match(out, /missing_lead/);
  assert.match(out, /unknown_lead_archive/);
  // provenance form taught with the archive's own name
  assert.match(out, /leads:\n {4}- kpom-ai-archive:/);
});

test('SKILL.md gains the --include-leads trigger guidance', () => {
  assert.match(SKILL_CONTENT, /--include-leads/);
  assert.match(SKILL_CONTENT, /\[lead:<name>\]/);
  assert.match(SKILL_CONTENT, /cited_lead_archive/);
});

// --- scaffold + init flags ---

test('scaffoldWiki writes lead_archives into .tng-wiki.json (default empty)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-leads-scaffold-'));
  try {
    scaffoldWiki(dir, { domain: 'blank', agent: 'claude-code', wikiName: 'Demo' });
    const meta = JSON.parse(readFileSync(join(dir, '.tng-wiki.json'), 'utf8'));
    assert.deepEqual(meta.lead_archives, []);

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);
    const leadArchives = [{ name: 'kpom', path: '../lead-docs', description: 'leads only' }];
    scaffoldWiki(dir, { domain: 'software-engineering', agent: 'claude-code', wikiName: 'Port', leadArchives });
    const meta2 = JSON.parse(readFileSync(join(dir, '.tng-wiki.json'), 'utf8'));
    assert.deepEqual(meta2.lead_archives, leadArchives);
    // the generated schema carries the guardrail section
    assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /## Leads, Never Sources/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseInitArgs collects repeatable --lead flags', () => {
  const o = parseInitArgs(['--yes', '--dir', './w', '--lead', 'a=../docs/a', '--lead', 'b=../docs/b']);
  assert.deepEqual(o.lead, ['a=../docs/a', 'b=../docs/b']);
  assert.deepEqual(parseInitArgs(['--yes']).lead, []);
});

test('parseLeadFlags parses name=path specs and reports malformed ones', () => {
  const fails = [];
  const archives = parseLeadFlags(['kpom=../../kp/AI', 'other=/abs/path'], (msg) => fails.push(msg));
  assert.deepEqual(archives, [
    { name: 'kpom', path: '../../kp/AI' },
    { name: 'other', path: '/abs/path' },
  ]);
  assert.equal(fails.length, 0);

  for (const bad of ['no-equals', '=path-only', 'name-only=']) {
    const errs = [];
    parseLeadFlags([bad], (msg) => errs.push(msg));
    assert.equal(errs.length, 1, `expected failure for "${bad}"`);
    assert.match(errs[0], /--lead expects <name>=<path>/);
  }
});

test('help.js documents --include-leads on search and --lead on init', () => {
  const search = commandJson('search');
  assert.ok(search.flags.some((f) => f.name === '--include-leads'));
  const init = commandJson('init');
  const lead = init.flags.find((f) => f.name === '--lead');
  assert.ok(lead);
  assert.equal(lead.value, '<name>=<path>');
});
