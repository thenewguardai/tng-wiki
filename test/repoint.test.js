// Repoint suggestions: map a locked #L range through `git diff -U0` hunks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHunks, mapRange } from '../src/repoint.js';

test('parseHunks reads -U0 headers, defaulting omitted counts to 1', () => {
  const diff = [
    'diff --git a/f b/f',
    '@@ -3,0 +4,2 @@ ctx',
    '+a', '+b',
    '@@ -10 +12 @@',
    '-x', '+y',
    '@@ -20,3 +21,0 @@',
  ].join('\n');
  assert.deepEqual(parseHunks(diff), [
    { oldStart: 3, oldLen: 0, newStart: 4, newLen: 2 },
    { oldStart: 10, oldLen: 1, newStart: 12, newLen: 1 },
    { oldStart: 20, oldLen: 3, newStart: 21, newLen: 0 },
  ]);
});

test('mapRange: lines inserted above shift the range, not flagged edited', () => {
  const hunks = [{ oldStart: 3, oldLen: 0, newStart: 4, newLen: 2 }];
  assert.deepEqual(mapRange({ start: 10, end: 14 }, hunks), { range: { start: 12, end: 16 }, edited: false });
});

test('mapRange: an edit inside the range keeps its bounds and flags edited', () => {
  const hunks = [
    { oldStart: 3, oldLen: 0, newStart: 4, newLen: 2 },   // +2 above
    { oldStart: 12, oldLen: 1, newStart: 14, newLen: 3 },  // one line became three
  ];
  assert.deepEqual(mapRange({ start: 10, end: 14 }, hunks), { range: { start: 12, end: 18 }, edited: true });
});

test('mapRange: an edit touching the range boundary maps into the replacement', () => {
  const hunks = [{ oldStart: 8, oldLen: 3, newStart: 8, newLen: 1 }];  // 8-10 collapsed to 8
  assert.deepEqual(mapRange({ start: 10, end: 15 }, hunks), { range: { start: 8, end: 13 }, edited: true });
});

test('mapRange: a range deleted outright has no suggestion', () => {
  const hunks = [{ oldStart: 10, oldLen: 5, newStart: 9, newLen: 0 }];
  assert.equal(mapRange({ start: 10, end: 14 }, hunks), null);
});

test('mapRange: changes below the range leave it alone', () => {
  const hunks = [{ oldStart: 30, oldLen: 2, newStart: 30, newLen: 5 }];
  assert.deepEqual(mapRange({ start: 10, end: 14 }, hunks), { range: { start: 10, end: 14 }, edited: false });
});

test('mapRange: an insertion strictly inside the range flags edited and widens it', () => {
  const hunks = [{ oldStart: 11, oldLen: 0, newStart: 12, newLen: 2 }];
  assert.deepEqual(mapRange({ start: 10, end: 14 }, hunks), { range: { start: 10, end: 16 }, edited: true });
});
