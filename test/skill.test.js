import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  installSkill, uninstallSkill, skillFile, skillDir, skillStatus,
  SKILL_CONTENT, SKILL_NAME,
} from '../src/skill.js';
import { installedVersion } from '../src/version.js';

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

// --- freshness (issue #24): the stamp + skillStatus drive doctor's stale check ---

test('SKILL_CONTENT embeds the current package version as a stamp', () => {
  // The stamp guarantees the content changes on every release, so a version
  // bump makes previously-installed skills compare stale until re-installed.
  assert.ok(
    SKILL_CONTENT.includes(`tng-wiki-skill-version: ${installedVersion()}`),
    'SKILL.md must carry the generating version',
  );
});

test('skillStatus: not installed', () => {
  inHome((home) => {
    assert.deepEqual(skillStatus(home), { installed: false, fresh: false });
  });
});

test('skillStatus: freshly installed skill is fresh', () => {
  inHome((home) => {
    installSkill(home);
    assert.deepEqual(skillStatus(home), { installed: true, fresh: true });
  });
});

test('skillStatus: skill from another generation is stale until re-installed', () => {
  inHome((home) => {
    installSkill(home);
    // Simulate a SKILL.md written by an older release (e.g. different stamp).
    writeFileSync(skillFile(home), SKILL_CONTENT.replace(installedVersion(), '0.0.1'), 'utf8');
    assert.deepEqual(skillStatus(home), { installed: true, fresh: false });

    installSkill(home, { force: true });
    assert.deepEqual(skillStatus(home), { installed: true, fresh: true });
  });
});
