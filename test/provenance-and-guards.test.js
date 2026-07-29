// #45 (missing_author opt-in lint), #49 (drift_relocked backstop), and
// #50 (install-skill honors the managed stamp).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkGrounding } from '../src/ground.js';
import { installSkill, skillFile, SKILL_CONTENT } from '../src/skill.js';
import { scaffoldWiki } from '../src/init.js';

function makeWiki() {
  const root = mkdtempSync(join(tmpdir(), 'tng-wiki-prov-'));
  scaffoldWiki(root, { domain: 'blank', agent: 'claude-code', wikiName: 'P' });
  writeFileSync(join(root, 'raw', 'a.md'), '# A\n');
  return root;
}

function writePage(root, name, extraFm = []) {
  writeFileSync(join(root, 'wiki', name), [
    '---', `title: ${name}`, 'type: capture', 'created: 2026-07-29', 'updated: 2026-07-29',
    'sources:', '  - raw/a.md', 'tags: [t]', ...extraFm, '---', '',
    `# ${name}`, '', 'claim.[^raw/a.md]', '',
  ].join('\n'));
}

test('missing_author fires only for configured types, only when author is absent', () => {
  const root = makeWiki();
  try {
    writePage(root, 'anon-capture.md');
    writePage(root, 'signed-capture.md', ['author: "work-machine session (claude-fable-5)"']);

    // no config -> no findings, ever
    const unconfigured = checkGrounding(root);
    assert.ok(!unconfigured.issues.some((i) => i.issue === 'missing_author'));

    const metaPath = join(root, '.tng-wiki.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    meta.require_author_types = ['capture', 'exchange'];
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    const configured = checkGrounding(root);
    const hits = configured.issues.filter((i) => i.issue === 'missing_author');
    assert.equal(hits.length, 1, JSON.stringify(configured.issues));
    assert.equal(hits[0].page, 'wiki/anon-capture.md');
    assert.equal(hits[0].type, 'capture');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a full --update-lock over cite_content_changed drift warns (drift_relocked)', () => {
  const root = makeWiki();
  try {
    writePage(root, 'p.md');
    // bless current state, then edit the cited source to create drift
    checkGrounding(root, { updateLock: true });
    writeFileSync(join(root, 'raw', 'a.md'), '# A\nchanged since verification\n');

    const drifted = checkGrounding(root);
    assert.ok(drifted.issues.some((i) => i.issue === 'cite_content_changed'), JSON.stringify(drifted.issues));

    const relock = checkGrounding(root, { updateLock: true });
    const warn = relock.warnings.find((w) => w.code === 'drift_relocked');
    assert.ok(warn, JSON.stringify(relock.warnings));
    assert.equal(warn.count, 1);
    assert.equal(warn.cites[0].page, 'wiki/p.md');

    // the write happened (advisory warning, not a refusal) - drift is gone next run
    const after = checkGrounding(root);
    assert.ok(!after.issues.some((i) => i.issue === 'cite_content_changed'));
    assert.ok(!after.warnings?.some((w) => w.code === 'drift_relocked'), 'no warning without --update-lock');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('install-skill refreshes a stamped skill without force, guards unstamped files', () => {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-skill-'));
  try {
    const first = installSkill(home);
    assert.equal(first.overwrote, false);

    // the documented refresh path: run it again, no --force
    const refresh = installSkill(home);
    assert.equal(refresh.overwrote, true);
    assert.equal(readFileSync(skillFile(home), 'utf8'), SKILL_CONTENT);

    // a file WITHOUT the stamp is not tool-managed - guard stays
    writeFileSync(skillFile(home), '# my own skill\n');
    assert.throws(() => installSkill(home), /no tng-wiki version stamp/);
    const forced = installSkill(home, { force: true });
    assert.equal(forced.overwrote, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
