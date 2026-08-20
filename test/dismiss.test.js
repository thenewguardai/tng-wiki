// `tng-wiki dismiss` (#54): the explicit record for "reviewed, nothing worth
// compiling" - the one source state the derived-compiled model cannot compute
// from citations. Sidecar-only writes; raw/ is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { scaffoldWiki } from '../src/init.js';
import { listSources } from '../src/verbs.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.js');

function makeWiki() {
  const root = mkdtempSync(join(tmpdir(), 'tng-wiki-dismiss-'));
  scaffoldWiki(root, { domain: 'blank', agent: 'claude-code', wikiName: 'Dis' });
  mkdirSync(join(root, 'raw', 'captures'), { recursive: true });
  writeFileSync(join(root, 'raw', 'captures', 'dud.md'), '---\ntitle: Dud\n---\nnothing here\n');
  return root;
}

const run = (root, args) => spawnSync('node', [CLI, 'dismiss', ...args], { cwd: root, encoding: 'utf8' });

test('dismiss records the verdict, moves the source out of the queue, and --undo reverses it', () => {
  const root = makeWiki();
  try {
    const raw = readFileSync(join(root, 'raw', 'captures', 'dud.md'), 'utf8');

    const r = run(root, ['raw/captures/dud.md', '--reason', 'superseded by the 08-14 capture', '--by', 'test-agent', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.path, 'raw/captures/dud.md');
    assert.equal(out.dismissed.reason, 'superseded by the 08-14 capture');
    assert.equal(out.dismissed.by, 'test-agent');
    assert.match(out.dismissed.date, /^\d{4}-\d{2}-\d{2}$/);

    // raw/ untouched; sidecar holds the record; status derives dismissed
    assert.equal(readFileSync(join(root, 'raw', 'captures', 'dud.md'), 'utf8'), raw);
    const sidecar = JSON.parse(readFileSync(join(root, '.tng-wiki', 'dismissals.json'), 'utf8'));
    assert.equal(sidecar.dismissed['raw/captures/dud.md'].reason, 'superseded by the 08-14 capture');
    const s = listSources(root).find((x) => x.path === 'raw/captures/dud.md');
    assert.equal(s.status, 'dismissed');
    assert.equal(listSources(root, { uncompiledOnly: true }).length, 0);

    // double-dismiss refuses with the standing verdict; --undo restores the queue
    const again = run(root, ['raw/captures/dud.md', '--reason', 'other']);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already dismissed .*superseded/);
    const undo = run(root, ['raw/captures/dud.md', '--undo']);
    assert.equal(undo.status, 0, undo.stderr);
    assert.equal(listSources(root, { uncompiledOnly: true }).length, 1);
    assert.equal(run(root, ['raw/captures/dud.md', '--undo']).status, 1); // nothing to undo
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dismiss requires a reason, a raw/ path, an existing file, and refuses cited sources', () => {
  const root = makeWiki();
  try {
    const noReason = run(root, ['raw/captures/dud.md']);
    assert.equal(noReason.status, 1);
    assert.match(noReason.stderr, /requires --reason/);

    const notRaw = run(root, ['wiki/index.md', '--reason', 'x']);
    assert.equal(notRaw.status, 1);
    assert.match(notRaw.stderr, /takes a raw\/ source path/);

    const escape = run(root, ['raw/../wiki/index.md', '--reason', 'x']);
    assert.equal(escape.status, 1);
    assert.match(escape.stderr, /escapes raw\//);

    const missing = run(root, ['raw/captures/nope.md', '--reason', 'x']);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /No such source/);

    // a cited source is compiled - the citation outranks any verdict
    writeFileSync(join(root, 'wiki', 'p.md'), '---\ntitle: P\nsources:\n  - raw/captures/dud.md\n---\nclaim.[^raw/captures/dud.md]\n');
    const cited = run(root, ['raw/captures/dud.md', '--reason', 'x']);
    assert.equal(cited.status, 1);
    assert.match(cited.stderr, /cited by 1 page \(wiki\/p\.md\)/);
    assert.match(cited.stderr, /compiled, not dismissible/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dismiss refuses the default-wiki fallback (#47 rule)', () => {
  const root = makeWiki();
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-dismiss-home-'));
  const outside = mkdtempSync(join(tmpdir(), 'tng-wiki-dismiss-out-'));
  try {
    mkdirSync(join(home, '.tng-wiki'), { recursive: true });
    writeFileSync(join(home, '.tng-wiki', 'registry.json'), JSON.stringify({
      version: 1, default: 'dis', wikis: { dis: { name: 'Dis', path: root, domain: 'blank' } },
    }));
    const env = { ...process.env, HOME: home };
    const r = spawnSync('node', [CLI, 'dismiss', 'raw/captures/dud.md', '--reason', 'x'], { cwd: outside, env, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to dismiss via the default-wiki fallback/);

    const targeted = spawnSync('node', [CLI, 'dismiss', 'raw/captures/dud.md', '--reason', 'x', '--wiki', 'dis'], { cwd: outside, env, encoding: 'utf8' });
    assert.equal(targeted.status, 0, targeted.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
