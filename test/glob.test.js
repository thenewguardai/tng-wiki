import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, matchesAnyGlob } from '../src/glob.js';

// Mirrors the per-language defaults in src/init.js EXCLUDE_DEFAULTS so the
// matcher is exercised against exactly the globs init writes into .tng-wiki.json.

test('**/*.md matches markdown at any depth, including bare and nested', () => {
  const globs = ['**/*.md'];
  assert.ok(matchesAnyGlob('README.md', globs));
  assert.ok(matchesAnyGlob('docs/guide.md', globs));
  assert.ok(matchesAnyGlob('a/b/c/notes.md', globs));
  assert.ok(!matchesAnyGlob('src/app.ts', globs));
  assert.ok(!matchesAnyGlob('readme.mdx', globs));
});

test('**/*.test.* requires the middle .test. segment', () => {
  const globs = ['**/*.test.*'];
  assert.ok(matchesAnyGlob('oauth.test.ts', globs));
  assert.ok(matchesAnyGlob('src/auth/oauth.test.js', globs));
  assert.ok(!matchesAnyGlob('oauth.test', globs));     // no trailing extension
  assert.ok(!matchesAnyGlob('oauth.ts', globs));
});

test('**/node_modules/** matches dirs at any depth but not the bare dir name', () => {
  const globs = ['**/node_modules/**'];
  assert.ok(matchesAnyGlob('node_modules/left-pad/index.js', globs));
  assert.ok(matchesAnyGlob('packages/app/node_modules/x/y.js', globs));
  assert.ok(!matchesAnyGlob('node_modules', globs));
  assert.ok(!matchesAnyGlob('src/node_modules_helper.ts', globs));
});

test('docs/** matches everything under docs but NOT docs itself', () => {
  const globs = ['docs/**'];
  assert.ok(matchesAnyGlob('docs/intro.md', globs));
  assert.ok(matchesAnyGlob('docs/a/b/c.md', globs));
  assert.ok(!matchesAnyGlob('docs', globs));
  assert.ok(!matchesAnyGlob('docsite/x.md', globs));
});

test('python/go/rust defaults', () => {
  assert.ok(matchesAnyGlob('test_login.py', ['**/test_*.py']));
  assert.ok(matchesAnyGlob('app/test_login.py', ['**/test_*.py']));
  assert.ok(!matchesAnyGlob('login.py', ['**/test_*.py']));
  assert.ok(matchesAnyGlob('oauth_test.go', ['**/*_test.go']));
  assert.ok(matchesAnyGlob('target/debug/app', ['**/target/**']));
  assert.ok(matchesAnyGlob('crates/x/target/y', ['**/target/**']));
});

test('* stays within a single path segment', () => {
  assert.ok(globToRegExp('src/*.ts').test('src/app.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/sub/app.ts'));
});

test('? matches exactly one non-slash character', () => {
  assert.ok(globToRegExp('a?.ts').test('ab.ts'));
  assert.ok(!globToRegExp('a?.ts').test('a.ts'));
  assert.ok(!globToRegExp('a?.ts').test('a/.ts'));
});

test('a leading slash is stripped so anchored patterns match relative paths', () => {
  assert.ok(matchesAnyGlob('src/app.ts', ['/src/*.ts']));
});

test('literal dots are escaped, not treated as any-char', () => {
  const re = globToRegExp('config.json');
  assert.ok(re.test('config.json'));
  assert.ok(!re.test('configxjson'));
});

test('empty or absent glob lists never match', () => {
  assert.ok(!matchesAnyGlob('anything.md', []));
  assert.ok(!matchesAnyGlob('anything.md', undefined));
  assert.ok(!matchesAnyGlob('', ['**/*.md']));
});
