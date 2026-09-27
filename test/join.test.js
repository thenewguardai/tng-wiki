// `tng-wiki join <git-url>`: one command from a fresh machine to a working
// participant (clone or adopt, register this host's wikis, skill, PATH check).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { scaffoldWiki } from '../src/init.js';
import { stampSharing } from '../src/sharing.js';

const CLI = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin', 'cli.js');
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
};
const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { env: GIT_ENV, encoding: 'utf8', stdio: 'pipe' }).trim();

// Bare origin of a monorepo with a shared hub, this host's hub, another host's
// hub, and an unstamped one; one hub cites a code authority this machine lacks.
function makeOrigin() {
  const base = mkdtempSync(join(tmpdir(), 'tng-wiki-join-'));
  const seed = join(base, 'seed');
  for (const [name, stamp] of [['shared', 'shared'], ['mine', 'host:join-box'], ['theirs', 'host:other-box'], ['loose', null]]) {
    const p = join(seed, name);
    mkdirSync(p, { recursive: true });
    scaffoldWiki(p, { domain: 'blank', agent: 'claude-code', wikiName: name });
    if (stamp) stampSharing(p, stamp);
  }
  const meta = JSON.parse(readFileSync(join(seed, 'mine', '.tng-wiki.json'), 'utf8'));
  meta.code_authorities = [{ name: 'infra', path: '/nonexistent/infra' }];
  writeFileSync(join(seed, 'mine', '.tng-wiki.json'), JSON.stringify(meta, null, 2));
  git(base, ['init', '-q', '-b', 'main', seed]);
  git(seed, ['add', '-A']);
  git(seed, ['commit', '-q', '-m', 'seed']);
  const origin = join(base, 'wikis.git');
  execFileSync('git', ['clone', '-q', '--bare', seed, origin], { env: GIT_ENV });
  const home = join(base, 'home');
  mkdirSync(home);
  return { base, origin, home, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function joinCli(w, args) {
  return spawnSync('node', [CLI, 'join', ...args], {
    encoding: 'utf8', env: { ...GIT_ENV, HOME: w.home, TNG_WIKI_HOST: 'JOIN-BOX' },
  });
}

test('join clones, registers shared + this host\'s wikis, installs the skill, and names what needs localize', () => {
  const w = makeOrigin();
  try {
    const dest = join(w.home, 'wikis');
    const r = joinCli(w, [w.origin, '--path', dest, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.path, dest);
    assert.equal(out.cloned, true);
    assert.deepEqual(out.registered.map((x) => x.slug).sort(), ['mine', 'shared']);
    assert.deepEqual(out.skipped.map((x) => x.name).sort(), ['loose', 'theirs']);
    assert.deepEqual(out.localize, [{ wiki: 'mine', missing: ['infra'], command: 'tng-wiki localize --wiki mine --trust infra --yes' }]);
    assert.ok(existsSync(join(w.home, '.claude', 'skills', 'tng-wiki', 'SKILL.md')));
    const registry = JSON.parse(readFileSync(join(w.home, '.tng-wiki', 'registry.json'), 'utf8'));
    assert.deepEqual(Object.keys(registry.wikis).sort(), ['mine', 'shared']);
  } finally {
    w.cleanup();
  }
});

test('join adopts an existing clone of the same remote and refuses a different one', () => {
  const w = makeOrigin();
  try {
    const dest = join(w.home, 'wikis');
    execFileSync('git', ['clone', '-q', w.origin, dest], { env: GIT_ENV });
    const r = joinCli(w, [`${w.origin}/`, '--path', dest, '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).cloned, false);

    const other = join(w.home, 'other');
    execFileSync('git', ['init', '-q', other], { env: GIT_ENV });
    git(other, ['remote', 'add', 'origin', 'git@example.com:someone/else.git']);
    const bad = joinCli(w, [w.origin, '--path', other]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /already a clone of git@example\.com:someone\/else\.git/);
  } finally {
    w.cleanup();
  }
});

test('join requires a url', () => {
  const w = makeOrigin();
  try {
    const r = joinCli(w, []);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Usage: tng-wiki join <git-url>/);
  } finally {
    w.cleanup();
  }
});
