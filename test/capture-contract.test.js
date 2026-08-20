// #48 / #37 / #42: the _inbox capture contract. Cites under unrecognized
// roots surface as unknown_cite_root instead of vanishing; `graduate` moves
// an _inbox capture into raw/; skill + schema document the contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { extractCitations, checkGrounding } from '../src/ground.js';
import { scaffoldWiki } from '../src/init.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

test('extractCitations classifies unrecognized path-shaped roots as unknown, exempts footnotes', () => {
  const body = [
    'raw cite.[^raw/notes/a.md]',
    'code cite.[^code:app/src/x.js#L3-L9]',
    'inbox cite.[^_inbox/capture.md]',
    'typo cite.[^ra/typo.md]',
    'malformed code cite.[^code:]',
    'a real footnote.[^1] and another.[^note]',
  ].join('\n');
  const hits = extractCitations(body);
  const kinds = hits.map((h) => `${h.kind}:${h.path}`);
  assert.deepEqual(kinds, [
    'raw:raw/notes/a.md',
    'code:code:app',
    'unknown:_inbox/capture.md',
    'unknown:ra/typo.md',
    'unknown:code:',
  ]);
  const code = hits.find((h) => h.kind === 'code');
  assert.equal(code.file, 'src/x.js');
  assert.deepEqual(code.range, { start: 3, end: 9 });
});

function makeWiki() {
  const root = mkdtempSync(join(tmpdir(), 'tng-wiki-capture-'));
  scaffoldWiki(root, { domain: 'blank', agent: 'claude-code', wikiName: 'Cap' });
  mkdirSync(join(root, '_inbox'), { recursive: true });
  writeFileSync(join(root, '_inbox', 'capture.md'), '# Captured\n');
  return root;
}

test('ground reports unknown_cite_root with a graduate hint for _inbox cites', () => {
  const root = makeWiki();
  try {
    writeFileSync(join(root, 'wiki', 'p.md'), [
      '---', 'title: P', 'type: concept', 'created: 2026-07-23', 'updated: 2026-07-23',
      'sources:', '  - _inbox/capture.md', 'tags: [t]', '---', '',
      '# P', '', 'claim.[^_inbox/capture.md]', '',
    ].join('\n'));
    const { issues } = checkGrounding(root);
    const unknown = issues.find((i) => i.issue === 'unknown_cite_root');
    assert.ok(unknown, `expected unknown_cite_root in ${JSON.stringify(issues)}`);
    assert.equal(unknown.cite, '_inbox/capture.md');
    assert.match(unknown.suggest, /tng-wiki graduate capture\.md/);
    const orphan = issues.find((i) => i.issue === 'orphan_source_decl');
    assert.ok(orphan, 'declaration is still an orphan (the inbox cite does not count)');
    assert.match(orphan.suggest, /_inbox\/ is not a citable root/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graduate moves an _inbox item to raw/captures and prints the citable path', () => {
  const root = makeWiki();
  try {
    const r = spawnSync('node', [CLI, 'graduate', 'capture.md'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /raw\/captures\/capture\.md/);
    assert.match(r.stdout, /\[\^raw\/captures\/capture\.md\]/);
    assert.ok(existsSync(join(root, 'raw', 'captures', 'capture.md')));
    assert.ok(!existsSync(join(root, '_inbox', 'capture.md')));
    assert.equal(readFileSync(join(root, 'raw', 'captures', 'capture.md'), 'utf8'), '# Captured\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graduate accepts the _inbox/ prefix, honors --to under raw/, rejects escapes and overwrites', () => {
  const root = makeWiki();
  try {
    const to = spawnSync('node', [CLI, 'graduate', '_inbox/capture.md', '--to', 'raw/briefs', '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(to.status, 0, to.stderr);
    assert.deepEqual(JSON.parse(to.stdout), { wiki: null, from: '_inbox/capture.md', to: 'raw/briefs/capture.md' });

    writeFileSync(join(root, '_inbox', 'capture.md'), 'again\n');
    const clash = spawnSync('node', [CLI, 'graduate', 'capture.md', '--to', 'raw/briefs'], { cwd: root, encoding: 'utf8' });
    assert.equal(clash.status, 1);
    assert.match(clash.stderr, /Refusing to overwrite/);

    const outside = spawnSync('node', [CLI, 'graduate', 'capture.md', '--to', 'output/x'], { cwd: root, encoding: 'utf8' });
    assert.equal(outside.status, 1);
    assert.match(outside.stderr, /--to must be under raw\//);

    const escape = spawnSync('node', [CLI, 'graduate', '../wiki/index.md'], { cwd: root, encoding: 'utf8' });
    assert.equal(escape.status, 1);
    assert.match(escape.stderr, /escapes _inbox\//);

    const missing = spawnSync('node', [CLI, 'graduate', 'nope.md'], { cwd: root, encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /_inbox\/ contains: capture\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graduate --as renames on the way in, records graduated_from:, and prefills collisions (#57)', () => {
  const root = makeWiki();
  try {
    // collision error carries a ready-to-run --as suggestion
    mkdirSync(join(root, 'raw', 'captures'), { recursive: true });
    writeFileSync(join(root, 'raw', 'captures', 'capture.md'), 'the earlier capture\n');
    const clash = spawnSync('node', [CLI, 'graduate', 'capture.md'], { cwd: root, encoding: 'utf8' });
    assert.equal(clash.status, 1);
    assert.match(clash.stderr, /Refusing to overwrite/);
    assert.match(clash.stderr, /tng-wiki graduate capture\.md --as capture-2\.md/);

    // --as resolves it: file lands under the new name with provenance stamped
    const renamed = spawnSync('node', [CLI, 'graduate', 'capture.md', '--as', 'capture-addendum.md', '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(renamed.status, 0, renamed.stderr);
    assert.deepEqual(JSON.parse(renamed.stdout), {
      wiki: null, from: '_inbox/capture.md', to: 'raw/captures/capture-addendum.md', renamed: true,
    });
    const content = readFileSync(join(root, 'raw', 'captures', 'capture-addendum.md'), 'utf8');
    assert.match(content, /^---\ngraduated_from: _inbox\/capture\.md\n---\n# Captured\n$/);
    assert.ok(!existsSync(join(root, '_inbox', 'capture.md')));

    // existing frontmatter gains the key instead of a second block
    writeFileSync(join(root, '_inbox', 'fm.md'), '---\ntitle: FM\n---\nbody\n');
    const fm = spawnSync('node', [CLI, 'graduate', 'fm.md', '--as', 'fm-renamed.md'], { cwd: root, encoding: 'utf8' });
    assert.equal(fm.status, 0, fm.stderr);
    assert.equal(readFileSync(join(root, 'raw', 'captures', 'fm-renamed.md'), 'utf8'),
      '---\ntitle: FM\ngraduated_from: _inbox/fm.md\n---\nbody\n');

    // non-markdown files rename without a stamp; --as never takes a path
    writeFileSync(join(root, '_inbox', 'shot.png'), 'not-really-a-png');
    const bin = spawnSync('node', [CLI, 'graduate', 'shot.png', '--as', 'shot-2.png'], { cwd: root, encoding: 'utf8' });
    assert.equal(bin.status, 0, bin.stderr);
    assert.equal(readFileSync(join(root, 'raw', 'captures', 'shot-2.png'), 'utf8'), 'not-really-a-png');
    writeFileSync(join(root, '_inbox', 'x.md'), 'x\n');
    const pathy = spawnSync('node', [CLI, 'graduate', 'x.md', '--as', 'sub/x.md'], { cwd: root, encoding: 'utf8' });
    assert.equal(pathy.status, 1);
    assert.match(pathy.stderr, /--as takes a bare filename/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graduate refuses the default-wiki fallback', () => {
  const root = makeWiki();
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-capture-home-'));
  try {
    mkdirSync(join(home, '.tng-wiki'), { recursive: true });
    writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({
      version: 1, default: 'cap',
      wikis: { cap: { name: 'Cap', path: root, domain: 'blank', registered: new Date().toISOString() } },
    }));
    const neutral = join(home, 'neutral');
    mkdirSync(neutral);
    const r = spawnSync('node', [CLI, 'graduate', 'capture.md'], {
      cwd: neutral, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to graduate via the default-wiki fallback/);
    assert.ok(existsSync(join(root, '_inbox', 'capture.md')), 'file must not move');

    const flagged = spawnSync('node', [CLI, 'graduate', 'capture.md', '--wiki', 'cap'], {
      cwd: neutral, env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8',
    });
    assert.equal(flagged.status, 0, flagged.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('skill documents the _inbox capture exception; schema teaches graduate', async () => {
  const { SKILL_CONTENT } = await import('../src/skill.js');
  assert.match(SKILL_CONTENT, /One exception: `_inbox\/` capture/);
  assert.match(SKILL_CONTENT, /never a citable root/);

  const { generateAgentsMd, generateDoctrine } = await import('../src/agents/index.js');
  const md = generateAgentsMd({ wikiName: 'x', domain: 'code-archaeology', wikiPath: '/tmp/x' });
  assert.match(md, /tng-wiki graduate <item>/);
  assert.match(md, /never a citable root/);
  const doctrine = generateDoctrine({ wikiName: 'x' });
  assert.match(doctrine['grounding.md'], /unknown_cite_root/);
  assert.match(doctrine['grounding.md'], /tng-wiki graduate <item>/);
});
