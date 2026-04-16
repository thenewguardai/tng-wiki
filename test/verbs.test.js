import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldWiki } from '../src/init.js';
import {
  resolveWiki, queryIndex, readPage, searchWiki,
  listSources, listStalePages, listOrphanPages,
} from '../src/verbs.js';
import { saveRegistry, emptyRegistry, registerWiki } from '../src/registry.js';

function makeWiki({ domain = 'blank', agent = 'claude-code', wikiName = 'Demo' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-verbs-'));
  scaffoldWiki(dir, { domain, agent, wikiName });
  return dir;
}

function writePage(wikiRoot, relPath, content) {
  const full = join(wikiRoot, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

// --- resolveWiki ---

test('resolveWiki returns the default when no slug is provided', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-home-'));
  try {
    const reg = registerWiki(emptyRegistry(), { name: 'Only', path: '/tmp/only', domain: 'blank' });
    saveRegistry(reg, home);
    const wiki = resolveWiki(null, home);
    assert.equal(wiki.slug, 'only');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resolveWiki throws a helpful error when no default is registered', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-home-'));
  try {
    assert.throws(() => resolveWiki(null, home), /No default wiki/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('resolveWiki throws when an unknown slug is passed', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-home-'));
  try {
    saveRegistry(emptyRegistry(), home);
    assert.throws(() => resolveWiki('nope', home), /No wiki registered/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// --- queryIndex / readPage ---

test('queryIndex returns wiki/index.md content', () => {
  const dir = makeWiki({ wikiName: 'Indexing Demo' });
  try {
    const out = queryIndex(dir);
    assert.match(out, /^# Indexing Demo/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readPage returns a specific page; rejects ../ escape', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'wiki/entities/acme.md', '# Acme\nbody');
    const out = readPage(dir, 'entities/acme.md');
    assert.match(out, /^# Acme/);
    assert.throws(() => readPage(dir, '../etc/passwd'), /escapes the wiki directory/);
    assert.throws(() => readPage(dir, 'missing.md'), /Page not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- searchWiki ---

test('searchWiki finds case-insensitive substring matches with source/path/line/text shape', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'wiki/entities/acme.md', '# Acme\nLaunched Karpathy-style wiki\nmore stuff');
    writePage(dir, 'wiki/entities/beta.md', '# Beta\nnothing related');
    const hits = searchWiki(dir, 'karpathy');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].source, 'wiki');
    assert.equal(hits[0].path, 'wiki/entities/acme.md');
    assert.equal(hits[0].line, 2);
    assert.match(hits[0].text, /Karpathy/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('searchWiki defaults to wiki/ only; raw/ hits require includeRaw', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'raw/papers/source.md', 'body mentions Karpathy and nothing else relevant');
    // without includeRaw: no hits (wiki/ is empty of the term)
    const wikiOnly = searchWiki(dir, 'Karpathy');
    assert.equal(wikiOnly.length, 0);

    // with includeRaw: finds the raw hit, tagged source:'raw'
    const deep = searchWiki(dir, 'Karpathy', { includeRaw: true });
    assert.equal(deep.length, 1);
    assert.equal(deep[0].source, 'raw');
    assert.equal(deep[0].path, 'raw/papers/source.md');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('searchWiki with includeRaw returns wiki hits before raw hits', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'wiki/entities/a.md', 'compiled knowledge: Karpathy pattern');
    writePage(dir, 'raw/papers/src.md', 'raw source: Karpathy original post');
    const hits = searchWiki(dir, 'Karpathy', { includeRaw: true });
    assert.equal(hits.length, 2);
    // wiki hits scanned first, then raw
    assert.equal(hits[0].source, 'wiki');
    assert.equal(hits[1].source, 'raw');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('searchWiki with regex interprets the pattern', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'wiki/entities/a.md', 'released 1.2.3 today');
    const hits = searchWiki(dir, '\\d+\\.\\d+\\.\\d+', { regex: true });
    assert.equal(hits.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- listSources ---

test('listSources returns raw files with compiled/title/type parsed from frontmatter', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'raw/papers/alpha.md', '---\ntitle: Alpha Paper\ncompiled: false\ntype: paper\n---\nbody');
    writePage(dir, 'raw/papers/beta.md', '---\ntitle: Beta Paper\ncompiled: true\n---\nbody');
    const all = listSources(dir);
    assert.equal(all.length, 2);
    const alpha = all.find(s => s.path.endsWith('alpha.md'));
    assert.equal(alpha.compiled, false);
    assert.equal(alpha.title, 'Alpha Paper');
    assert.equal(alpha.type, 'paper');

    const uncompiled = listSources(dir, { uncompiledOnly: true });
    assert.equal(uncompiled.length, 1);
    assert.ok(uncompiled[0].path.endsWith('alpha.md'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- listStalePages ---

test('listStalePages reports pages with ⚠️ STALE? markers and the match count', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'wiki/entities/old.md', 'Stuff ⚠️ STALE? and more ⚠️ STALE?');
    writePage(dir, 'wiki/entities/fresh.md', 'recent content');
    const stale = listStalePages(dir);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].path, 'wiki/entities/old.md');
    assert.equal(stale[0].count, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- listOrphanPages ---

test('listOrphanPages identifies pages with no inbound [[wikilinks]], excluding structural pages', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'wiki/entities/acme.md', '# Acme\nSee also [[beta]]');
    writePage(dir, 'wiki/entities/beta.md', '# Beta\nLinked from acme');
    writePage(dir, 'wiki/entities/gamma.md', '# Gamma\nNobody links to me');
    const orphans = listOrphanPages(dir);
    const paths = orphans.map(o => o.path);
    assert.ok(paths.includes('wiki/entities/gamma.md'));
    assert.ok(!paths.includes('wiki/entities/beta.md'));
    // index.md and log.md are structural; never orphans
    assert.ok(!paths.includes('wiki/index.md'));
    assert.ok(!paths.includes('wiki/log.md'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listOrphanPages treats [[link|alias]] and [[link#anchor]] as valid inbound links', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'wiki/entities/target.md', '# Target');
    writePage(dir, 'wiki/entities/source.md', 'ref via alias [[target|T]] and anchor [[target#Intro]]');
    const orphans = listOrphanPages(dir).map(o => o.path);
    assert.ok(!orphans.includes('wiki/entities/target.md'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
