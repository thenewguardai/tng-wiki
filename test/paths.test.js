import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'os';
import { join, resolve, sep } from 'path';
import { resolveConfigPath, pathForm, suggestRelative } from '../src/paths.js';

// os.homedir() reads $HOME (POSIX) / %USERPROFILE% (Windows) at call time, so
// tests can fake the home directory by swapping the env vars.
function withFakeHome(home, fn) {
  const old = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try { return fn(); } finally {
    process.env.HOME = old.HOME;
    process.env.USERPROFILE = old.USERPROFILE;
  }
}

// --- resolveConfigPath ---

test('resolveConfigPath expands ~/x to <home>/x', () => {
  withFakeHome(join(sep, 'fake', 'home'), () => {
    assert.equal(resolveConfigPath('/w', '~/code/app'), join(sep, 'fake', 'home', 'code', 'app'));
  });
});

test('resolveConfigPath expands bare ~ to the home directory', () => {
  withFakeHome(join(sep, 'fake', 'home'), () => {
    assert.equal(resolveConfigPath('/w', '~'), join(sep, 'fake', 'home'));
  });
});

test('resolveConfigPath resolves relative paths against the wiki root (unchanged behavior)', () => {
  assert.equal(resolveConfigPath('/w/wiki', '../legacy-app'), resolve('/w/wiki', '../legacy-app'));
  assert.equal(resolveConfigPath('/w/wiki', 'authority-src'), resolve('/w/wiki', 'authority-src'));
});

test('resolveConfigPath leaves absolute paths alone', () => {
  assert.equal(resolveConfigPath('/w', '/opt/code'), resolve('/opt/code'));
});

test('resolveConfigPath does NOT expand ~user paths (shell-only syntax)', () => {
  // `~bob/x` resolves against the wiki root as a literal directory name
  assert.equal(resolveConfigPath('/w', '~bob/x'), resolve('/w', '~bob/x'));
});

test('resolveConfigPath uses the real homedir() by default', () => {
  assert.equal(resolveConfigPath('/w', '~/x'), join(homedir(), 'x'));
});

// --- pathForm ---

test('pathForm classifies relative / home / absolute paths', () => {
  assert.equal(pathForm('../legacy-app'), 'relative');
  assert.equal(pathForm('src/app'), 'relative');
  assert.equal(pathForm('~'), 'home');
  assert.equal(pathForm('~/code/app'), 'home');
  assert.equal(pathForm('/home/u/code'), 'absolute');
  assert.equal(pathForm('~bob/x'), 'relative'); // not tilde-expansion syntax we support
});

// --- suggestRelative ---

test('suggestRelative converts a nearby absolute path to a wiki-relative one', () => {
  assert.equal(suggestRelative('/home/u/wikis/port', '/home/u/wikis/legacy-app'), '../legacy-app');
  assert.equal(suggestRelative('/home/u/wikis/port', '/home/u/code/app'), '../../code/app');
  assert.equal(suggestRelative('/home/u/wikis/port', '/home/u/wikis/port/vendored'), 'vendored');
});

test('suggestRelative allows up to 4 leading .. segments, rejects deeper escapes', () => {
  const wiki = '/a/b/c/d/e/wiki';
  assert.equal(suggestRelative(wiki, '/a/b/x'), '../../../../x');          // 4 × ..
  assert.equal(suggestRelative(wiki, '/a/x'), null);                       // 5 × .. — too far
});

test('suggestRelative returns null for the wiki root itself (nothing to suggest)', () => {
  assert.equal(suggestRelative('/w', '/w'), null);
});
