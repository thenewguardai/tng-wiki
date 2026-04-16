import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  installSkill, uninstallSkill, skillFile, skillDir,
  SKILL_CONTENT, SKILL_NAME,
} from '../src/skill.js';

function inHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-skill-'));
  try { return fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}

test('installSkill writes SKILL.md under ~/.claude/skills/tng-wiki', () => {
  inHome((home) => {
    const result = installSkill(home);
    assert.equal(result.path, skillFile(home));
    assert.ok(existsSync(result.path));
    const content = readFileSync(result.path, 'utf8');
    assert.equal(content, SKILL_CONTENT);
  });
});

test('installSkill writes a valid SKILL.md frontmatter block', () => {
  // content lives under ~/.claude/skills/tng-wiki/SKILL.md per docs
  assert.equal(SKILL_NAME, 'tng-wiki');
  assert.match(SKILL_CONTENT, /^---\nname: tng-wiki\ndescription: .+\n---\n/s);
});

test('installSkill description stays under the 1,536-char skill-listing cap', () => {
  const match = SKILL_CONTENT.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'SKILL.md must start with frontmatter');
  const descMatch = match[1].match(/^description:\s*(.+)$/m);
  assert.ok(descMatch, 'frontmatter must include a description');
  assert.ok(
    descMatch[1].length < 1536,
    `description is ${descMatch[1].length} chars; Claude Code truncates at 1,536`,
  );
});

test('installSkill refuses to overwrite an existing SKILL.md without --force', () => {
  inHome((home) => {
    installSkill(home);
    assert.throws(() => installSkill(home), /already exists/);
  });
});

test('installSkill(force: true) overwrites an existing SKILL.md', () => {
  inHome((home) => {
    installSkill(home);
    // modify and re-install
    const path = skillFile(home);
    writeFileSync(path, '# stomped\n', 'utf8');
    installSkill(home, { force: true });
    assert.equal(readFileSync(path, 'utf8'), SKILL_CONTENT);
  });
});

test('uninstallSkill removes the skill directory', () => {
  inHome((home) => {
    installSkill(home);
    assert.ok(existsSync(skillDir(home)));
    const result = uninstallSkill(home);
    assert.equal(result.path, skillDir(home));
    assert.ok(!existsSync(skillDir(home)));
  });
});

test('uninstallSkill throws when nothing is installed', () => {
  inHome((home) => {
    assert.throws(() => uninstallSkill(home), /No tng-wiki skill installed/);
  });
});
