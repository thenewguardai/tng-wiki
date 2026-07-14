import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { scaffoldWiki } from '../src/init.js';
import {
  applyLocalizeActions, authorityStatuses, leadArchiveStatuses,
  writeLocalOverrides, ensureGitignored, resolveLocalizeTarget, runLocalize,
} from '../src/localize.js';
import { loadLocalOverrides } from '../src/ground.js';
import { saveRegistry, emptyRegistry, registerWiki } from '../src/registry.js';

function makeWiki() {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-localize-'));
  scaffoldWiki(dir, { domain: 'blank', agent: 'claude-code', wikiName: 'Loc Demo' });
  return dir;
}

function setAuthorities(dir, authorities, leads = []) {
  const p = join(dir, '.tng-wiki.json');
  const meta = JSON.parse(readFileSync(p, 'utf8'));
  meta.code_authorities = authorities;
  meta.lead_archives = leads;
  writeFileSync(p, JSON.stringify(meta, null, 2));
}

// --- applyLocalizeActions (pure) ---

test('applyLocalizeActions merges sets, trusts, and clears; prunes an empty family', () => {
  let ov = applyLocalizeActions({}, { sets: { a: '~/a' }, trusts: ['b'] });
  assert.deepEqual(ov.code_authorities, { a: { path: '~/a' }, b: { trusted: true } });

  // trust replaces a prior path for the same name
  ov = applyLocalizeActions(ov, { trusts: ['a'] });
  assert.deepEqual(ov.code_authorities.a, { trusted: true });

  // clear removes it; clearing the last entry prunes the family key entirely
  ov = applyLocalizeActions(ov, { clears: ['a', 'b'] });
  assert.equal('code_authorities' in ov, false);
});

test('applyLocalizeActions targets the named family and leaves the input untouched', () => {
  const input = { code_authorities: { x: { trusted: true } } };
  const out = applyLocalizeActions(input, { family: 'lead_archives', sets: { arch: '~/leads' } });
  assert.deepEqual(out.lead_archives, { arch: { path: '~/leads' } });
  assert.deepEqual(out.code_authorities, { x: { trusted: true } }); // preserved
  assert.deepEqual(input, { code_authorities: { x: { trusted: true } } }); // not mutated
});

// --- authorityStatuses ---

test('authorityStatuses classifies ok / missing / trusted / invalid', () => {
  const dir = makeWiki();
  try {
    mkdirSync(join(dir, '..', 'present-repo'), { recursive: true });
    setAuthorities(dir, [
      { name: 'here', path: '../present-repo' },
      { name: 'gone', path: '/nowhere/at/all' },
      { name: 'remote', path: '/also/nowhere' },
      { name: 'broken', path: '' },
    ]);
    writeLocalOverrides(dir, { code_authorities: { remote: { trusted: true } } });
    const byName = Object.fromEntries(authorityStatuses(dir).map((s) => [s.name, s.state]));
    assert.equal(byName.here, 'ok');
    assert.equal(byName.gone, 'missing');
    assert.equal(byName.remote, 'trusted');
    assert.equal(byName.broken, 'invalid');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(join(dir, '..', 'present-repo'), { recursive: true, force: true });
  }
});

test('leadArchiveStatuses never reports trusted (leads are not trust anchors)', () => {
  const dir = makeWiki();
  try {
    setAuthorities(dir, [], [{ name: 'arch', path: '/nowhere' }]);
    // even if someone hand-wrote trusted for a lead, it degrades to missing
    writeLocalOverrides(dir, { lead_archives: { arch: { trusted: true } } });
    const [s] = leadArchiveStatuses(dir);
    assert.equal(s.state, 'missing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- writeLocalOverrides + gitignore safety ---

test('writeLocalOverrides stamps version:1 and ensures .gitignore covers the local file', () => {
  const dir = makeWiki();
  try {
    // simulate a pre-feature wiki whose .gitignore lacks the rule
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8');
    const p = writeLocalOverrides(dir, { code_authorities: { a: { trusted: true } } });
    assert.ok(existsSync(p));
    assert.equal(JSON.parse(readFileSync(p, 'utf8')).version, 1);
    assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.tng-wiki\.local\.json$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureGitignored is idempotent', () => {
  const dir = makeWiki();
  try {
    const first = ensureGitignored(dir);   // scaffold already ignores it -> false
    assert.equal(first, false);
    const before = readFileSync(join(dir, '.gitignore'), 'utf8');
    ensureGitignored(dir);
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), before); // unchanged
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- resolveLocalizeTarget ---

// --- runLocalize headless behaviors (#36) ---

test('runLocalize --json is non-interactive and prints JSON status (#36-2)', async () => {
  const dir = makeWiki();
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { chunks.push(String(s)); return true; };
  try {
    setAuthorities(dir, [{ name: 'x', path: '/nowhere' }]);
    await runLocalize([dir, '--json']); // must NOT drop into the wizard (would hang on non-TTY)
    process.stdout.write = orig;
    const out = JSON.parse(chunks.join(''));
    assert.equal(out.root, dir);
    assert.equal(out.authorities[0].state, 'missing');
  } finally {
    process.stdout.write = orig;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runLocalize rejects an empty --set path instead of writing a dead override (#36-3)', async () => {
  const dir = makeWiki();
  try {
    await assert.rejects(() => runLocalize([dir, '--set', 'x=']), /non-empty path/);
    assert.deepEqual(loadLocalOverrides(dir), {}); // nothing written
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runLocalize --set writes the override headlessly', async () => {
  const dir = makeWiki();
  const orig = process.stdout.write;
  process.stdout.write = () => true;
  try {
    setAuthorities(dir, [{ name: 'legacy', path: '/nowhere' }]);
    await runLocalize([dir, '--set', 'legacy=../legacy-app', '--json']);
    process.stdout.write = orig;
    assert.equal(loadLocalOverrides(dir).code_authorities.legacy.path, '../legacy-app');
  } finally {
    process.stdout.write = orig;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveLocalizeTarget follows the shared order and rejects path + --wiki together', () => {
  const wiki = makeWiki();
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-loc-home-'));
  try {
    saveRegistry(registerWiki(emptyRegistry(), { name: 'Def', path: wiki, domain: 'blank' }), home);
    assert.equal(resolveLocalizeTarget([wiki], { cwd: '/', home }).root, wiki); // explicit path
    assert.equal(resolveLocalizeTarget([], { cwd: wiki, home }).root, wiki);     // cwd-wiki
    assert.throws(() => resolveLocalizeTarget([wiki, '--wiki', 'def'], { cwd: '/', home }), /not both/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(wiki, { recursive: true, force: true });
  }
});
