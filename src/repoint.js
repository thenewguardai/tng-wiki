// Repoint suggestions for code cites whose locked content changed: where did
// the locked `#L<s>-L<e>` lines go? Maps the range through the hunks of
// `git diff -U0 <hashed_at_sha>` the way an editor tracks lines through edits.
// A suggestion only - the lines still need re-verification before anyone
// rewrites the anchor; `ground --fix-moved` stays the only automatic rewrite.

import { readFileAtRef, diffUnifiedZero } from './git-read.js';
import { normalizeLines, hashLines, sliceRange } from './lock.js';

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// `-U0` hunk headers -> [{ oldStart, oldLen, newStart, newLen }]. An omitted
// count means 1. A zero oldLen is an insertion after oldStart; a zero newLen is
// a deletion after new line newStart.
export function parseHunks(diffText) {
  const hunks = [];
  for (const line of diffText.split('\n')) {
    const m = line.match(HUNK_RE);
    if (!m) continue;
    hunks.push({
      oldStart: Number(m[1]),
      oldLen: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]),
      newLen: m[4] === undefined ? 1 : Number(m[4]),
    });
  }
  return hunks;
}

// New line number for old line `x`. `side` picks which end of a replacement a
// line inside a changed hunk maps to, so a range keeps covering the edit.
function mapLine(x, hunks, side) {
  let offset = 0;
  for (const h of hunks) {
    if (h.oldLen === 0) {
      if (x <= h.oldStart) return x + offset;
      offset += h.newLen;
      continue;
    }
    const oldEnd = h.oldStart + h.oldLen - 1;
    if (x < h.oldStart) return x + offset;
    if (x <= oldEnd) {
      if (h.newLen === 0) return side === 'start' ? h.newStart + 1 : h.newStart;
      return side === 'start' ? h.newStart : h.newStart + h.newLen - 1;
    }
    offset += h.newLen - h.oldLen;
  }
  return x + offset;
}

function touchesRange(h, range) {
  if (h.oldLen === 0) return h.oldStart >= range.start && h.oldStart < range.end;
  const oldEnd = h.oldStart + h.oldLen - 1;
  return h.oldStart <= range.end && oldEnd >= range.start;
}

// { range, edited } for the lines `range` now occupies, or null when every line
// of it was deleted. `edited` is true when any hunk touches the range.
export function mapRange(range, hunks) {
  const start = mapLine(range.start, hunks, 'start');
  const end = mapLine(range.end, hunks, 'end');
  if (end < start) return null;
  return { range: { start, end }, edited: hunks.some((h) => touchesRange(h, range)) };
}

// Suggestion for a locked code cite whose content changed, or null. Trusted
// only when the locked range at `fromSha` reproduces the locked hash - a lock
// taken on uncommitted content has no base in history to diff from.
export function suggestRepoint({ repoDir, file, range, lockedHash, fromSha, toRef = null }) {
  if (!fromSha || !range) return null;
  const base = readFileAtRef(repoDir, fromSha, file);
  if (base == null) return null;
  if (hashLines(sliceRange(normalizeLines(base), range)) !== lockedHash) return null;
  const diff = diffUnifiedZero(repoDir, fromSha, toRef, file);
  if (diff == null) return null;
  return mapRange(range, parseHunks(diff));
}
