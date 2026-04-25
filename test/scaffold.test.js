import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync, lstatSync, readlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldWiki } from '../src/init.js';

function inTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-scaffold-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('scaffoldWiki creates the full base layout and writes AGENTS.md as canonical', () => {
  inTmp((root) => {
    const result = scaffoldWiki(root, { domain: 'blank', agent: 'claude-code', wikiName: 'Demo' });

    for (const d of ['raw', 'wiki', 'output', 'raw/papers', 'wiki/entities']) {
      assert.ok(statSync(join(root, d)).isDirectory(), `missing dir: ${d}`);
    }
    assert.ok(existsSync(join(root, 'AGENTS.md')));
    assert.equal(result.canonical, 'AGENTS.md');
    assert.ok(existsSync(join(root, 'wiki/index.md')));
    assert.ok(existsSync(join(root, 'wiki/log.md')));
    assert.ok(existsSync(join(root, '.gitignore')));
    assert.ok(existsSync(join(root, '.tng-wiki.json')));

    const index = readFileSync(join(root, 'wiki/index.md'), 'utf8');
    assert.match(index, /^# Demo/);

    const meta = JSON.parse(readFileSync(join(root, '.tng-wiki.json'), 'utf8'));
    assert.equal(meta.version, 1);
    assert.equal(meta.name, 'Demo');
    assert.equal(meta.domain, 'blank');
    // trusted_authorities ships empty — users opt in per wiki for Layer 3 external validation
    assert.deepEqual(meta.trusted_authorities, []);
    // code_authorities defaults to empty when caller doesn't supply any
    assert.deepEqual(meta.code_authorities, []);
  });
});

test('scaffoldWiki writes provided codeAuthorities (with optional ref) into .tng-wiki.json', () => {
  inTmp((root) => {
    const codeAuthorities = [
      {
        name: 'legacy-app',
        path: '../customer-portal-v1',
        description: 'Source impl being ported.',
        exclude: ['**/*.md', '**/*.test.*'],
        language: 'typescript',
        ref: 'v2.1.0',
      },
      {
        name: 'mobile-app',
        path: '../customer-portal-mobile',
      },
    ];
    scaffoldWiki(root, { domain: 'software-engineering', agent: 'claude-code', wikiName: 'Port', codeAuthorities });
    const meta = JSON.parse(readFileSync(join(root, '.tng-wiki.json'), 'utf8'));
    assert.deepEqual(meta.code_authorities, codeAuthorities);
  });
});

test('scaffoldWiki for claude-code creates a CLAUDE.md symlink (or copy) pointing at AGENTS.md', () => {
  inTmp((root) => {
    const { aliases } = scaffoldWiki(root, { domain: 'blank', agent: 'claude-code', wikiName: 'Demo' });
    assert.deepEqual(aliases.map(a => a.alias), ['CLAUDE.md']);
    const [{ kind }] = aliases;
    assert.ok(['symlink', 'copy'].includes(kind), `unexpected alias kind: ${kind}`);
    assert.ok(existsSync(join(root, 'CLAUDE.md')));
    if (kind === 'symlink') {
      assert.ok(lstatSync(join(root, 'CLAUDE.md')).isSymbolicLink());
      assert.equal(readlinkSync(join(root, 'CLAUDE.md')), 'AGENTS.md');
    } else {
      // on platforms without symlink permission (e.g. Windows w/o Dev Mode),
      // fall back to a copy — content must match
      assert.equal(
        readFileSync(join(root, 'CLAUDE.md'), 'utf8'),
        readFileSync(join(root, 'AGENTS.md'), 'utf8'),
      );
    }
  });
});

test('scaffoldWiki for codex writes AGENTS.md and no aliases (Codex reads it natively)', () => {
  inTmp((root) => {
    const { aliases } = scaffoldWiki(root, { domain: 'blank', agent: 'codex', wikiName: 'Demo' });
    assert.equal(aliases.length, 0);
    assert.ok(existsSync(join(root, 'AGENTS.md')));
    assert.ok(!existsSync(join(root, 'CLAUDE.md')));
    assert.ok(!existsSync(join(root, '.cursorrules')));
  });
});

test('scaffoldWiki for cursor adds a .cursorrules alias', () => {
  inTmp((root) => {
    const { aliases } = scaffoldWiki(root, { domain: 'blank', agent: 'cursor', wikiName: 'Demo' });
    assert.deepEqual(aliases.map(a => a.alias), ['.cursorrules']);
    assert.ok(existsSync(join(root, '.cursorrules')));
  });
});

test('scaffoldWiki with agent:"all" writes AGENTS.md plus CLAUDE.md + .cursorrules aliases', () => {
  inTmp((root) => {
    const { aliases } = scaffoldWiki(root, { domain: 'blank', agent: 'all', wikiName: 'Demo' });
    assert.deepEqual(aliases.map(a => a.alias).sort(), ['.cursorrules', 'CLAUDE.md']);
    for (const f of ['AGENTS.md', 'CLAUDE.md', '.cursorrules']) {
      assert.ok(existsSync(join(root, f)), `missing: ${f}`);
    }
  });
});

test('scaffoldWiki adds domain-specific directories on top of the base layout', () => {
  inTmp((root) => {
    scaffoldWiki(root, { domain: 'ai-research', agent: 'claude-code', wikiName: 'AI' });

    // base dirs still present
    assert.ok(existsSync(join(root, 'raw/papers')));
    // ai-research extras
    for (const d of ['raw/policy', 'wiki/protocols', 'wiki/opportunities', 'output/slides']) {
      assert.ok(existsSync(join(root, d)), `missing ai-research dir: ${d}`);
    }
  });
});

test('scaffoldWiki writes the seed source when the template provides one', () => {
  inTmp((root) => {
    scaffoldWiki(root, { domain: 'ai-research', agent: 'claude-code', wikiName: 'AI' });
    // ai-research ships a Karpathy announcement as a seed
    const seed = join(root, 'raw/announcements/2026-04-04-karpathy-llm-knowledge-bases.md');
    assert.ok(existsSync(seed), 'ai-research seed source missing');
    assert.match(readFileSync(seed, 'utf8'), /Karpathy/);
  });
});

test('scaffoldWiki writes no seed source for blank template', () => {
  inTmp((root) => {
    scaffoldWiki(root, { domain: 'blank', agent: 'claude-code', wikiName: 'Demo' });
    const countMd = (dir) => readdirSync(dir, { withFileTypes: true })
      .reduce((n, e) => n + (e.isDirectory()
        ? countMd(join(dir, e.name))
        : e.name.endsWith('.md') ? 1 : 0), 0);
    assert.equal(countMd(join(root, 'raw')), 0, 'blank template should leave raw/ empty');
  });
});

test('scaffoldWiki writes every template extraFile with non-empty content', () => {
  inTmp((root) => {
    scaffoldWiki(root, { domain: 'ai-research', agent: 'claude-code', wikiName: 'AI' });
    const walk = (dir) => readdirSync(dir, { withFileTypes: true })
      .flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
    const wikiFiles = walk(join(root, 'wiki'));
    // index.md + log.md guaranteed; ai-research has extraFiles beyond those
    const extras = wikiFiles.filter(f => !f.endsWith('index.md') && !f.endsWith('log.md'));
    assert.ok(extras.length > 0, 'expected ai-research to ship extraFiles in wiki/');
    for (const path of extras) {
      assert.ok(readFileSync(path, 'utf8').length > 0, `${path} is empty`);
    }
  });
});
