import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFrontmatter, parseScalars, extractListKey } from '../src/frontmatter.js';

// splitFrontmatter and the list-key forms are exercised in depth via their
// ground.js re-export/wrappers (ground.test.js, leads.test.js); this file
// covers the scalar parser that moved out of verbs.js.

test('parseScalars maps scalar keys, strips quotes, coerces booleans', () => {
  const fm = 'title: "Quoted Title"\ncompiled: false\ntype: paper\nflag: true';
  assert.deepEqual(parseScalars(fm), {
    title: 'Quoted Title',
    compiled: false,
    type: 'paper',
    flag: true,
  });
});

test('parseScalars on an empty frontmatter block returns an empty map', () => {
  assert.deepEqual(parseScalars(''), {});
  // and composes with splitFrontmatter on a page without frontmatter
  assert.deepEqual(parseScalars(splitFrontmatter('just a body').frontmatter), {});
});

test('parseScalars ignores list items and indented lines (scalars only)', () => {
  const fm = 'sources:\n  - raw/a.md\ncompiled: true';
  const out = parseScalars(fm);
  assert.equal(out.compiled, true);
  assert.equal(out.sources, ''); // key seen, value on following lines - not a scalar
  // list keys are extractListKey's job
  assert.deepEqual(extractListKey(fm, 'sources'), ['raw/a.md']);
});
