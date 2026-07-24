// #43: cross-wiki wikilinks - [[slug:page]] parsing, read resolution through
// the registry, and ground's broken-link / unregistered-tally behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { parseCrossRef, extractCrossWikiLinks } from '../src/crosswiki.js';
import { checkGrounding } from '../src/ground.js';
import { listOrphanPages } from '../src/verbs.js';
import { scaffoldWiki } from '../src/init.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

test('parseCrossRef accepts slug:page and [[slug:page]] forms, rejects plain refs', () => {
  assert.deepEqual(parseCrossRef('shared:llama-server'), { slug: 'shared', page: 'llama-server' });
  assert.deepEqual(parseCrossRef('[[shared:systems/api.md]]'), { slug: 'shared', page: 'systems/api.md' });
  assert.deepEqual(parseCrossRef('[[shared:page|alias]]'), { slug: 'shared', page: 'page' });
  assert.equal(parseCrossRef('plain-page'), null);
  assert.equal(parseCrossRef('[[plain-page]]'), null);
  assert.equal(parseCrossRef('Not-A-Slug:page'), null, 'slugs are lowercase slugify output');
});

test('extractCrossWikiLinks skips fenced blocks and inline code', () => {
  const body = [
    'see [[shared:llama-server]] and [[other:page#heading]].',
    '```',
    '[[fenced:ignored]]',
    '```',
    'inline `[[inline:ignored]]` code, but [[real:one]] counts.',
    'plain [[wikilink]] never matches.',
  ].join('\n');
  const links = extractCrossWikiLinks(body, 10);
  assert.deepEqual(links, [
    { slug: 'shared', page: 'llama-server', line: 10 },
    { slug: 'other', page: 'page', line: 10 },
    { slug: 'real', page: 'one', line: 14 },
  ]);
});

// Two wikis in a fake home: 'alpha' (cwd wiki) and 'beta' (link target with a
// real page), registry registering both.
function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-cross-'));
  const wikis = {};
  for (const slug of ['alpha', 'beta']) {
    const p = join(home, 'wikis', slug);
    mkdirSync(p, { recursive: true });
    scaffoldWiki(p, { domain: 'blank', agent: 'claude-code', wikiName: slug });
    wikis[slug] = { name: slug, path: p, domain: 'blank', registered: new Date().toISOString() };
  }
  writeFileSync(join(home, 'wikis', 'beta', 'wiki', 'target-page.md'), [
    '---', 'title: Target', 'type: concept', 'created: 2026-07-24', 'updated: 2026-07-24',
    'sources:', '  - raw/t.md', 'tags: [t]', '---', '', '# Target', '', 'claim.[^raw/t.md]', '',
  ].join('\n'));
  writeFileSync(join(home, 'wikis', 'beta', 'raw', 't.md'), '# T\n');
  mkdirSync(join(home, '.tng-wiki'), { recursive: true });
  writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({ version: 1, default: 'alpha', wikis }));
  return { home, alpha: wikis.alpha.path, beta: wikis.beta.path };
}

test('read resolves slug:page and [[slug:page]] through the registry, overriding --wiki', () => {
  const { home, alpha } = makeHome();
  try {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    for (const ref of ['beta:target-page', '[[beta:target-page]]', 'beta:wiki/target-page.md']) {
      const r = spawnSync('node', [CLI, 'read', ref, '--wiki', 'alpha'], { cwd: alpha, env, encoding: 'utf8' });
      assert.equal(r.status, 0, `${ref}: ${r.stderr}`);
      assert.match(r.stdout, /# Target/);
    }
    const j = spawnSync('node', [CLI, 'read', 'beta:target-page', '--json'], { cwd: alpha, env, encoding: 'utf8' });
    const data = JSON.parse(j.stdout);
    assert.equal(data.wiki, 'beta');
    assert.equal(data.cross_wiki, true);
    assert.equal(data.path, 'target-page.md');

    const missing = spawnSync('node', [CLI, 'read', 'nope:target-page'], { cwd: alpha, env, encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /No wiki registered under slug "nope"/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('ground: resolvable link is clean, missing target is cross_wiki_broken (warn), unregistered slug tallies one warning', () => {
  const { home, alpha } = makeHome();
  try {
    writeFileSync(join(alpha, 'wiki', 'linker.md'), [
      '---', 'title: Linker', 'type: concept', 'created: 2026-07-24', 'updated: 2026-07-24',
      'sources:', '  - raw/l.md', 'tags: [t]', '---', '',
      '# Linker', '',
      'good link [[beta:target-page]].[^raw/l.md]',
      'broken link [[beta:no-such-page]].',
      'unregistered [[ghost:whatever]] and [[ghost:another]].',
      '',
    ].join('\n'));
    writeFileSync(join(alpha, 'raw', 'l.md'), '# L\n');

    const result = checkGrounding(alpha, { home });
    const broken = result.issues.filter((i) => i.issue === 'cross_wiki_broken');
    assert.equal(broken.length, 1, JSON.stringify(result.issues));
    assert.equal(broken[0].link, 'beta:no-such-page');

    const warn = result.warnings.find((w) => w.code === 'cross_wiki_unregistered');
    assert.ok(warn);
    assert.deepEqual(warn.wikis, ['ghost']);
    assert.equal(warn.count, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('cross-wiki links stay inert for orphans (documented: not inbound links)', () => {
  const { home, alpha } = makeHome();
  try {
    writeFileSync(join(alpha, 'wiki', 'lonely.md'), [
      '---', 'title: Lonely', 'type: concept', 'created: 2026-07-24', 'updated: 2026-07-24',
      'sources:', '  - raw/x.md', 'tags: [t]', '---', '', '# Lonely', '', 'claim.[^raw/x.md]', '',
    ].join('\n'));
    // a page in the SAME wiki linking to lonely only via a qualified form must
    // not count as inbound - the qualified form targets registries, not stems
    writeFileSync(join(alpha, 'wiki', 'pointer.md'), [
      '---', 'title: Pointer', 'type: concept', 'created: 2026-07-24', 'updated: 2026-07-24',
      'sources:', '  - raw/x.md', 'tags: [t]', '---', '', '# Pointer', '', 'see [[alpha:lonely]].[^raw/x.md]', '',
    ].join('\n'));
    const orphans = listOrphanPages(alpha).map((o) => o.path);
    assert.ok(orphans.includes('wiki/lonely.md'), `expected lonely in ${orphans}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('schema and doctrine document the qualified form', async () => {
  const { generateAgentsMd, generateDoctrine } = await import('../src/agents/index.js');
  const md = generateAgentsMd({ wikiName: 'x', domain: 'blank', wikiPath: '/tmp/x' });
  assert.match(md, /Cross-wiki links/);
  assert.match(md, /never evidence/);
  const doctrine = generateDoctrine({ wikiName: 'x' });
  assert.match(doctrine['grounding.md'], /cross_wiki_broken/);
});
