import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, lstatSync, unlinkSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldWiki } from '../src/init.js';
import { upgradeWiki, salvageUserSections, spliceFencedSchema, resolveUpgradeRoot } from '../src/upgrade.js';
import { generateAgentsMd, SCHEMA_FENCE_CLOSE, SCHEMA_FENCE_OPEN_RE, DOCTRINE_DIR } from '../src/agents/index.js';
import { getTemplate } from '../src/templates/index.js';
import { installedVersion } from '../src/version.js';
import { saveRegistry, emptyRegistry, registerWiki } from '../src/registry.js';

const CONTRACT = `## Repository-Specific Contract

House rules the generator knows nothing about.

### Filing Rules

| Content | Destination |
|---------|-------------|
| RCAs    | deliverables/ |
`;

function makeWiki({ domain = 'software-engineering', agent = 'claude-code', wikiName = 'Up Test' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-upgrade-'));
  scaffoldWiki(dir, { domain, agent, wikiName });
  return dir;
}

function manifest(dir) {
  return JSON.parse(readFileSync(join(dir, '.tng-wiki.json'), 'utf8'));
}

// Simulate a pre-fence (0.7.0 and earlier) schema: current generated content
// with the fence markers stripped, exactly as old generators wrote it.
function defence(content) {
  return content
    .split('\n')
    .filter((l) => !SCHEMA_FENCE_OPEN_RE.test(l) && l !== SCHEMA_FENCE_CLOSE)
    .join('\n')
    .replace(/^\n+/, '');
}

// --- fenced path ---

test('upgradeWiki (fenced) replaces the managed block and preserves user content outside it', () => {
  const dir = makeWiki();
  try {
    // user appends a hand-authored contract below the fence, and a note above it
    const schemaPath = join(dir, 'AGENTS.md');
    const original = readFileSync(schemaPath, 'utf8');
    writeFileSync(schemaPath, `<!-- reviewed by matt -->\n${original}\n${CONTRACT}`, 'utf8');

    const result = upgradeWiki(dir);
    assert.equal(result.mode, 'fenced');
    assert.deepEqual(result.salvaged, []);

    const upgraded = readFileSync(schemaPath, 'utf8');
    assert.ok(upgraded.startsWith('<!-- reviewed by matt -->\n'), 'prefix above the fence must survive');
    assert.ok(upgraded.includes('## Repository-Specific Contract'), 'suffix below the fence must survive');
    assert.ok(upgraded.includes('| RCAs    | deliverables/ |'), 'suffix content byte-preserved');
    // regenerated block is present exactly once
    assert.equal(upgraded.match(/## What This Is/g).length, 1);
    // backup of the pre-upgrade file exists
    assert.equal(readFileSync(join(dir, result.backup), 'utf8').includes('## Repository-Specific Contract'), true);
    // manifest stamped
    assert.equal(manifest(dir).schema_version, installedVersion());
    // doctrine rewritten
    assert.ok(existsSync(join(dir, DOCTRINE_DIR, 'grounding.md')));
    assert.ok(existsSync(join(dir, DOCTRINE_DIR, 'markers.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgradeWiki is idempotent on a fenced wiki with user suffix', () => {
  const dir = makeWiki();
  try {
    const schemaPath = join(dir, 'AGENTS.md');
    writeFileSync(schemaPath, readFileSync(schemaPath, 'utf8') + '\n' + CONTRACT, 'utf8');
    upgradeWiki(dir);
    const once = readFileSync(schemaPath, 'utf8');
    upgradeWiki(dir);
    const twice = readFileSync(schemaPath, 'utf8');
    assert.equal(once, twice, 'a second upgrade must be a no-op');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- legacy (unfenced) path ---

test('upgradeWiki (legacy) rebuilds generated sections and carries hand-authored ones below the fence', () => {
  const dir = makeWiki();
  try {
    const schemaPath = join(dir, 'AGENTS.md');
    // simulate a pre-fence wiki: strip fences, append the hand-written contract
    const legacy = defence(readFileSync(schemaPath, 'utf8')) + '\n' + CONTRACT;
    writeFileSync(schemaPath, legacy, 'utf8');

    const result = upgradeWiki(dir);
    assert.equal(result.mode, 'legacy');
    assert.deepEqual(result.salvaged, ['Repository-Specific Contract']);

    const upgraded = readFileSync(schemaPath, 'utf8');
    // now fenced, generated content exactly once, contract after the close marker
    assert.match(upgraded, SCHEMA_FENCE_OPEN_RE);
    assert.equal(upgraded.match(/## What This Is/g).length, 1);
    const closeIdx = upgraded.indexOf(SCHEMA_FENCE_CLOSE);
    assert.ok(upgraded.indexOf('## Repository-Specific Contract') > closeIdx, 'salvaged section sits below the managed block');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgradeWiki (legacy) treats historical generator headings as generated, not user content', () => {
  const dir = makeWiki();
  try {
    const schemaPath = join(dir, 'AGENTS.md');
    // pre-0.7.0 schemas inlined the full taxonomy; it must be dropped, not salvaged
    const legacy = defence(readFileSync(schemaPath, 'utf8'))
      + '\n## Marker Taxonomy\n\nOld inlined taxonomy text.\n';
    writeFileSync(schemaPath, legacy, 'utf8');
    const result = upgradeWiki(dir);
    assert.deepEqual(result.salvaged, []);
    assert.ok(!readFileSync(schemaPath, 'utf8').includes('Old inlined taxonomy text.'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- re-domaining ---

test('upgradeWiki --domain re-domains the wiki and drops the old domain section', () => {
  const dir = makeWiki({ domain: 'software-engineering' });
  try {
    const home = mkdtempSync(join(tmpdir(), 'tng-wiki-upgrade-home-'));
    try {
      saveRegistry(registerWiki(emptyRegistry(), { name: 'Up Test', path: dir, domain: 'software-engineering' }), home);
      const result = upgradeWiki(dir, { domain: 'code-archaeology', home });
      assert.equal(result.domainChanged, true);
      assert.equal(result.registrySynced, true);
      assert.equal(manifest(dir).domain, 'code-archaeology');

      const upgraded = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
      assert.ok(upgraded.includes('## Domain: Code Archaeology / Reverse Engineering'));
      assert.ok(!upgraded.includes('## Domain: Software Engineering & Architecture'), 'old domain section must not be salvaged');

      const reg = JSON.parse(readFileSync(join(home, '.tng-wiki', 'registry.json'), 'utf8'));
      assert.equal(reg.wikis['up-test'].domain, 'code-archaeology');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgradeWiki rejects an unknown --domain', () => {
  const dir = makeWiki();
  try {
    assert.throws(() => upgradeWiki(dir, { domain: 'nope' }), /Unknown --domain/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- dry run ---

test('upgradeWiki --dry-run reports the plan and writes nothing', () => {
  const dir = makeWiki();
  try {
    const schemaPath = join(dir, 'AGENTS.md');
    const legacy = defence(readFileSync(schemaPath, 'utf8')) + '\n' + CONTRACT;
    writeFileSync(schemaPath, legacy, 'utf8');
    const before = readFileSync(schemaPath, 'utf8');
    const manifestBefore = readFileSync(join(dir, '.tng-wiki.json'), 'utf8');

    const result = upgradeWiki(dir, { dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.mode, 'legacy');
    assert.deepEqual(result.salvaged, ['Repository-Specific Contract']);

    assert.equal(readFileSync(schemaPath, 'utf8'), before, 'schema untouched');
    assert.equal(readFileSync(join(dir, '.tng-wiki.json'), 'utf8'), manifestBefore, 'manifest untouched');
    assert.ok(!existsSync(join(dir, '.tng-wiki', 'backup')), 'no backup written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- aliases ---

test('upgradeWiki leaves symlink aliases alone and refreshes byte-identical copy aliases', () => {
  const dir = makeWiki({ agent: 'all' }); // CLAUDE.md + .cursorrules aliases
  try {
    const schemaPath = join(dir, 'AGENTS.md');
    // convert .cursorrules to copy-mode (as on platforms without symlinks)
    const original = readFileSync(schemaPath, 'utf8');
    unlinkSync(join(dir, '.cursorrules'));
    writeFileSync(join(dir, '.cursorrules'), original, 'utf8');

    const result = upgradeWiki(dir);
    const byFile = Object.fromEntries(result.aliases.map((a) => [a.file, a.action]));
    assert.equal(byFile['CLAUDE.md'], 'symlink-untouched');
    assert.equal(byFile['.cursorrules'], 'copy-refreshed');
    assert.equal(
      readFileSync(join(dir, '.cursorrules'), 'utf8'),
      readFileSync(schemaPath, 'utf8'),
      'copy alias refreshed to the new schema',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgradeWiki leaves a diverged copy alias untouched and says so', () => {
  const dir = makeWiki({ agent: 'claude-code' });
  try {
    unlinkSync(join(dir, 'CLAUDE.md'));
    writeFileSync(join(dir, 'CLAUDE.md'), '# my own customized claude file\n', 'utf8');
    const result = upgradeWiki(dir);
    const byFile = Object.fromEntries(result.aliases.map((a) => [a.file, a.action]));
    assert.equal(byFile['CLAUDE.md'], 'diverged-left-alone');
    assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '# my own customized claude file\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgradeWiki converts a pre-AGENTS.md wiki (CLAUDE.md as the schema) to canonical + alias', () => {
  const dir = makeWiki({ agent: 'claude-code' });
  try {
    // simulate the pre-pivot layout: CLAUDE.md is the real file, no AGENTS.md
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    unlinkSync(join(dir, 'CLAUDE.md'));
    unlinkSync(join(dir, 'AGENTS.md'));
    writeFileSync(join(dir, 'CLAUDE.md'), defence(content) + '\n' + CONTRACT, 'utf8');

    const result = upgradeWiki(dir);
    assert.equal(result.mode, 'legacy');
    assert.deepEqual(result.salvaged, ['Repository-Specific Contract']);
    assert.ok(existsSync(join(dir, 'AGENTS.md')), 'canonical schema created');
    const claudeStat = lstatSync(join(dir, 'CLAUDE.md'));
    const claudeContent = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    assert.ok(claudeStat.isSymbolicLink() || claudeContent === readFileSync(join(dir, 'AGENTS.md'), 'utf8'));
    assert.ok(claudeContent.includes('## Repository-Specific Contract'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- guards + resolution ---

test('upgradeWiki refuses a directory without .tng-wiki.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-notawiki-'));
  try {
    assert.throws(() => upgradeWiki(dir), /not a tng-wiki wiki/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveUpgradeRoot: explicit path > cwd-wiki > registered default; path + --wiki rejected', () => {
  const wiki = makeWiki();
  const other = makeWiki({ wikiName: 'Other' });
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-upgrade-home-'));
  try {
    saveRegistry(registerWiki(emptyRegistry(), { name: 'Reg Default', path: other, domain: 'blank' }), home);
    // explicit path wins
    assert.equal(resolveUpgradeRoot([wiki], { cwd: '/', home }).root, wiki);
    // cwd that is a wiki wins over the registered default
    assert.equal(resolveUpgradeRoot([], { cwd: wiki, home }).root, wiki);
    // bare invocation outside any wiki falls back to the registered default
    assert.equal(resolveUpgradeRoot([], { cwd: '/', home }).root, other);
    // --domain value is not mistaken for a positional path
    assert.equal(resolveUpgradeRoot(['--domain', 'blank'], { cwd: wiki, home }).root, wiki);
    assert.throws(() => resolveUpgradeRoot([wiki, '--wiki', 'reg-default'], { cwd: '/', home }), /not both/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(wiki, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

// --- helpers ---

test('spliceFencedSchema returns null on unfenced or malformed input', () => {
  const template = getTemplate('blank');
  const fresh = generateAgentsMd({ domain: 'blank', wikiName: 'X', template });
  assert.equal(spliceFencedSchema('# no fences here\n', fresh), null);
  // close before open = malformed
  assert.equal(spliceFencedSchema(`${SCHEMA_FENCE_CLOSE}\n<!-- tng-wiki:schema v0.0.0 domain=blank | x -->\n`, fresh), null);
});

test('salvageUserSections keeps unknown sections in order and drops Domain:-prefixed ones', () => {
  const template = getTemplate('blank');
  const fresh = generateAgentsMd({ domain: 'blank', wikiName: 'X', template });
  const old = [
    '# X', '',
    '## What This Is', 'generated text', '',
    '## Domain: Something Retired', 'old domain block', '',
    '## House Rules', 'mine', '',
    '## Escalation', 'also mine', '',
  ].join('\n');
  const salvaged = salvageUserSections(old, fresh);
  assert.deepEqual(salvaged.map((s) => s.heading), ['House Rules', 'Escalation']);
  assert.match(salvaged[0].text, /^## House Rules\nmine$/);
});
