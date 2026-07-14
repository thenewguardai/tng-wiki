import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { scaffoldWiki } from '../src/init.js';
import {
  resolveWiki, queryIndex, readPage, resolvePagePath, pageStemMap, searchWiki,
  listSources, listStalePages, listOrphanPages, listRejectionNotes, listInboxItems,
  ritualReport, roundsReport,
} from '../src/verbs.js';
import { saveRegistry, emptyRegistry, registerWiki } from '../src/registry.js';
import { checkGrounding } from '../src/ground.js';

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

test('resolveWiki: the wiki the cwd is inside outranks the registered default', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-home-'));
  const inside = makeWiki({ wikiName: 'Inside' });
  const other = makeWiki({ wikiName: 'Other' });
  try {
    let reg = registerWiki(emptyRegistry(), { name: 'Other', path: other, domain: 'blank' });
    reg = registerWiki(reg, { name: 'Inside', path: inside, domain: 'blank' });
    saveRegistry(reg, home); // default is 'other' (registered first)

    // standing inside a registered non-default wiki resolves THAT wiki
    assert.equal(resolveWiki(null, home, { cwd: inside }).slug, 'inside');
    // ancestor directories count (git-style)
    assert.equal(resolveWiki(null, home, { cwd: join(inside, 'wiki') }).slug, 'inside');
    // an explicit slug still outranks the cwd
    assert.equal(resolveWiki('other', home, { cwd: inside }).slug, 'other');
    // outside any wiki, the registered default wins
    assert.equal(resolveWiki(null, home, { cwd: tmpdir() }).slug, 'other');
    // cwd: null disables detection entirely (the MCP server's mode)
    assert.equal(resolveWiki(null, home, { cwd: null }).slug, 'other');
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(inside, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('resolveWiki resolves an UNREGISTERED cwd wiki with a null slug', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-home-'));
  const unregistered = makeWiki({ wikiName: 'Rogue' });
  try {
    saveRegistry(emptyRegistry(), home);
    const wiki = resolveWiki(null, home, { cwd: unregistered });
    assert.equal(wiki.slug, null);
    assert.equal(wiki.path, unregistered);
    // outside any wiki with an empty registry, the old error still applies
    assert.throws(() => resolveWiki(null, home, { cwd: tmpdir() }), /No default wiki/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(unregistered, { recursive: true, force: true });
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

test('readPage accepts every normalized path form and resolves to the same page', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'wiki/entities/acme.md', '# Acme\nbody');
    const forms = [
      'entities/acme.md',     // exact (fast path)
      'entities/acme',        // .md appended
      'wiki/entities/acme.md',// leading wiki/ stripped
      'wiki/entities/acme',   // leading wiki/ stripped + .md appended
      'acme',                 // unique stem
      '[[acme]]',             // wikilink wrapping stripped
      '[[Acme]]',             // stem match is case-insensitive
      '[[acme|Acme Corp]]',   // wikilink alias stripped
      '[[acme#History]]',     // wikilink anchor stripped
    ];
    for (const form of forms) {
      assert.match(readPage(dir, form), /^# Acme/, `form failed: ${form}`);
      assert.equal(resolvePagePath(dir, form), 'entities/acme.md', `form normalized wrong: ${form}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolvePagePath: Windows-style \\ separators normalize like /', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'wiki/entities/acme.md', '# Acme\nbody');
    const forms = [
      'entities\\acme.md',      // exact path, backslash separators
      'entities\\acme',         // + .md appended
      'wiki\\entities\\acme.md',// leading wiki\ stripped
      'wiki\\entities\\acme',   // leading wiki\ stripped + .md appended
    ];
    for (const form of forms) {
      assert.equal(resolvePagePath(dir, form), 'entities/acme.md', `form normalized wrong: ${form}`);
      assert.match(readPage(dir, form), /^# Acme/, `form failed: ${form}`);
    }
    // a backslash-pathed input is pathed, not bare — no stem fallback to a
    // same-named page in a different directory
    assert.throws(
      () => resolvePagePath(dir, 'zone-x\\acme'),
      /Page not found: zone-x\\acme \(tried: zone-x\/acme, zone-x\/acme\.md\)$/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readPage escape guard blocks ..\\ escapes after separator normalization', () => {
  const dir = makeWiki();
  try {
    for (const form of ['..\\..\\etc\\passwd', 'wiki\\..\\..\\etc\\passwd', '..\\etc/passwd', '[[..\\..\\etc\\passwd]]']) {
      assert.throws(() => readPage(dir, form), /escapes the wiki directory/, `form not blocked: ${form}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolvePagePath: ambiguous stem errors with the candidate list', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'wiki/zone-a/dup.md', '# A');
    writePage(dir, 'wiki/zone-b/dup.md', '# B');
    assert.throws(
      () => readPage(dir, 'dup'),
      (err) => /Ambiguous page "dup"/.test(err.message)
        && err.message.includes('wiki/zone-a/dup.md')
        && err.message.includes('wiki/zone-b/dup.md'),
    );
    // a fuller path still disambiguates
    assert.match(readPage(dir, 'zone-a/dup'), /^# A/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolvePagePath: zero matches errors with the forms tried', () => {
  const dir = makeWiki();
  try {
    // pathed input: lists every normalized form tried, no stem fallback
    assert.throws(
      () => readPage(dir, 'wiki/zone/nope'),
      /Page not found: wiki\/zone\/nope \(tried: wiki\/zone\/nope, wiki\/zone\/nope\.md, zone\/nope, zone\/nope\.md\)/,
    );
    // bare input: also reports that no page stem matched
    assert.throws(
      () => readPage(dir, 'nope'),
      /Page not found: nope \(tried: nope, nope\.md; no page stem matches "nope"\)/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readPage escape guard blocks ../ in every normalized form', () => {
  const dir = makeWiki();
  try {
    for (const form of ['../../etc/passwd', 'wiki/../../etc/passwd', '[[../../etc/passwd]]', '../etc/passwd']) {
      assert.throws(() => readPage(dir, form), /escapes the wiki directory/, `form not blocked: ${form}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pageStemMap maps lowercase stems to every page sharing them', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'wiki/zone-a/Dup.md', '# A');
    writePage(dir, 'wiki/zone-b/dup.md', '# B');
    const map = pageStemMap(dir);
    assert.deepEqual(map.get('dup').sort(), ['wiki/zone-a/Dup.md', 'wiki/zone-b/dup.md']);
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

test('listOrphanPages applies ground exemptions — fresh SE scaffold templates/meta are not orphans', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-verbs-'));
  try {
    scaffoldWiki(dir, { domain: 'software-engineering', agent: 'claude-code', wikiName: 'Eng' });
    const orphans = listOrphanPages(dir).map(o => o.path);
    assert.ok(!orphans.some(p => p.split('/').pop().startsWith('_')), `_-prefixed flagged: ${orphans.join(', ')}`);
    assert.ok(!orphans.some(p => p.startsWith('wiki/meta/')), `wiki/meta flagged: ${orphans.join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roundsReport reads clean on a fresh code-archaeology scaffold (seeded meta exempt)', () => {
  const dir = makeWiki({ domain: 'code-archaeology', wikiName: 'Dig' });
  try {
    const r = roundsReport(dir);
    assert.equal(r.uncompiled, 0); // no seed source — leads arrive via _inbox/
    assert.equal(r.ground, 0);
    assert.equal(r.orphans, 0);
    assert.equal(r.unsourced, 0);
    assert.equal(r.unverified, 0);
    assert.equal(r.stale, 0);
    assert.equal(r.drift, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roundsReport returns counts and skips template/meta example markers', () => {
  const dir = makeWiki({ domain: 'software-engineering', wikiName: 'Eng' });
  try {
    const r = roundsReport(dir);
    assert.equal(typeof r.scanned, 'number');
    // fresh scaffold: its own SE template example markers must not count
    assert.equal(r.stale, 0);
    assert.equal(r.drift, 0);
    assert.equal(r.orphans, 0);
    // a real groundable page with a marker IS counted
    writePage(dir, 'wiki/entities/old.md', 'x ⚠️ STALE?');
    assert.equal(roundsReport(dir).stale, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- ritual meta-health ---

test('ritualReport measures log recency by file time, not entry syntax (#35); git null outside a repo', () => {
  const dir = makeWiki();
  try {
    const r = ritualReport(dir);
    // scaffold log was just written -> recent by mtime
    assert.equal(r.last_log_days, 0);
    // no git repo: churn unknown, not "clean"
    assert.equal(r.git, null);

    // Format-agnostic: a log whose entries use a NON-canonical shape (bullets,
    // not `## [date]`) still reads current, because recency is file-time, not a
    // heading scrape. The old parser reported this as stale (found no headings).
    const logPath = join(dir, 'wiki', 'log.md');
    writeFileSync(logPath, '# Operations Log\n\n- **2026-07-14 - ingest:** did a thing\n', 'utf8');
    const bullety = ritualReport(dir);
    assert.equal(bullety.last_log_days, 0, 'bullet-form entries must not read as stale');

    // And an old FILE (regardless of entry content) reads stale via mtime.
    utimesSync(logPath, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
    const stalled = ritualReport(dir);
    assert.ok(stalled.last_log_days > 2000, `expected years of lapse, got ${stalled.last_log_days}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ritualReport counts working-tree churn in a git-tracked wiki', () => {
  const dir = makeWiki();
  try {
    execFileSync('git', ['-C', dir, 'init', '-q']);
    execFileSync('git', ['-C', dir, 'add', '-A']);
    execFileSync('git', ['-C', dir, '-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'init']);
    assert.deepEqual(ritualReport(dir).git, { changed: 0, untracked: 0 });
    writePage(dir, 'wiki/dropped-capture.md', '# untracked page');
    writeFileSync(join(dir, 'wiki', 'index.md'), '# modified index', 'utf8');
    assert.deepEqual(ritualReport(dir).git, { changed: 1, untracked: 1 });
    // roundsReport carries the same object
    assert.deepEqual(roundsReport(dir).ritual.git, { changed: 1, untracked: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- rejection logs (verification-first audit artifact) ---

test('listRejectionNotes matches *_NOTES_*.md under deliverables/, recursively', () => {
  const dir = makeWiki();
  try {
    // no deliverables/ at all — additive default, nothing reported
    assert.deepEqual(listRejectionNotes(dir), []);
    writePage(dir, 'deliverables/auth_NOTES_2026-06-01.md', '# Rejection log');
    writePage(dir, 'deliverables/q2/billing_NOTES_2026-06-02.md', '# Rejection log');
    writePage(dir, 'deliverables/summary.md', '# Not a rejection log');
    writePage(dir, 'wiki/entities/x_NOTES_y.md', '# Wrong directory — not a deliverable');
    // marker in a directory name only — must match the filename, not the full path
    writePage(dir, 'deliverables/auth_NOTES_archive/readme.md', '# Not a rejection log');
    const paths = listRejectionNotes(dir).map(n => n.path);
    assert.deepEqual(paths.sort(), [
      'deliverables/auth_NOTES_2026-06-01.md',
      'deliverables/q2/billing_NOTES_2026-06-02.md',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- _inbox pending triage ---

test('listInboxItems distinguishes "no inbox" from "empty inbox" and counts recursively', () => {
  const dir = makeWiki();
  try {
    // blank scaffold has no _inbox/ — null, not []
    assert.equal(listInboxItems(dir), null);
    mkdirSync(join(dir, '_inbox'));
    writeFileSync(join(dir, '_inbox', '.gitkeep'), '', 'utf8'); // dotfiles ignored
    assert.deepEqual(listInboxItems(dir), []);
    writePage(dir, '_inbox/rca-draft.md', '# RCA capture');
    writeFileSync(join(dir, '_inbox', 'notes.txt'), 'not markdown — still pending triage', 'utf8');
    writePage(dir, '_inbox/batch/divergence-audit.md', '# nested capture');
    const paths = listInboxItems(dir).map(i => i.path).sort();
    assert.deepEqual(paths, ['_inbox/batch/divergence-audit.md', '_inbox/notes.txt', '_inbox/rca-draft.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roundsReport surfaces inbox: null without _inbox/, a count with it', () => {
  const dir = makeWiki();
  try {
    assert.equal(roundsReport(dir).inbox, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // code-archaeology scaffolds _inbox/ — a fresh one reads 0, drops count
  const dig = makeWiki({ domain: 'code-archaeology', wikiName: 'Dig' });
  try {
    assert.equal(roundsReport(dig).inbox, 0);
    writePage(dig, '_inbox/lead.md', '# dropped capture');
    assert.equal(roundsReport(dig).inbox, 1);
  } finally {
    rmSync(dig, { recursive: true, force: true });
  }
});

test('roundsReport includes rejection_notes without touching marker counts', () => {
  const dir = makeWiki();
  try {
    assert.equal(roundsReport(dir).rejection_notes, 0);
    writePage(dir, 'deliverables/auth_NOTES_2026-06-01.md', '# Rejection log ⚠️ STALE?');
    const r = roundsReport(dir);
    assert.equal(r.rejection_notes, 1);
    // informational only — deliverables never feed the marker/ground counts
    assert.equal(r.stale, 0);
    assert.equal(r.ground, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('roundsReport splits warn-level ground findings into the convention bucket', () => {
  const dir = makeWiki();
  try {
    writePage(dir, 'wiki/entities/target.md',
      '---\ntitle: T\nupdated: 2099-01-01\nsources: [raw/s.md]\n---\nCited.[^raw/s.md]\nBack-ref [[noisy]].');
    writePage(dir, 'raw/s.md', 'body');
    // one error-level finding (empty_sources) + two warn-level findings
    // (frontmatter_updated_stale via 2020 date, prose_internal_ref)
    writePage(dir, 'wiki/entities/noisy.md',
      '---\ntitle: N\nupdated: 2020-01-01\n---\nSee `target.md` and [[target]].');
    const r = roundsReport(dir);
    assert.equal(r.convention, 2);
    const ground = checkGrounding(dir);
    assert.equal(r.ground + r.convention, ground.issues.length);
    assert.ok(ground.issues.some((i) => i.issue === 'frontmatter_updated_stale'));
    assert.ok(ground.issues.some((i) => i.issue === 'prose_internal_ref'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rounds CLI prints the rejection-log line only when ≥1 exists; --json is additive', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-home-'));
  const dir = makeWiki();
  try {
    const reg = registerWiki(emptyRegistry(), { name: 'Demo', path: dir, domain: 'blank' });
    saveRegistry(reg, home);
    const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
    const run = (...args) => execFileSync(process.execPath, [cli, 'rounds', ...args], {
      // FORCE_COLOR/NO_COLOR: CI environments set CI=true, which flips
      // picocolors to ANSI output and breaks the plain-text regexes below
      // (same guard as leads.test.js).
      env: { ...process.env, HOME: home, FORCE_COLOR: '0', NO_COLOR: '1' },
      encoding: 'utf8',
    });

    assert.ok(!run().includes('rejection log'), 'no rejection-log line on a wiki without deliverables/');

    writePage(dir, 'deliverables/auth_NOTES_2026-06-01.md', '# Rejection log');
    assert.match(run(), /1 {2}rejection log .*deliverables\/\*_NOTES_\*\.md/);

    const json = JSON.parse(run('--json'));
    assert.equal(json.rejection_notes, 1);
    assert.equal(typeof json.stale, 'number'); // existing keys untouched
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
