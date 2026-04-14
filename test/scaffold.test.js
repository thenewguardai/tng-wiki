import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scaffoldWiki } from '../src/init.js';

function inTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'tng-wiki-scaffold-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('scaffoldWiki creates the full base layout for a blank wiki', () => {
  inTmp((root) => {
    scaffoldWiki(root, { domain: 'blank', agent: 'claude-code', wikiName: 'Demo' });

    for (const d of ['raw', 'wiki', 'output', 'raw/papers', 'wiki/entities']) {
      assert.ok(statSync(join(root, d)).isDirectory(), `missing dir: ${d}`);
    }
    assert.ok(existsSync(join(root, 'CLAUDE.md')));
    assert.ok(existsSync(join(root, 'wiki/index.md')));
    assert.ok(existsSync(join(root, 'wiki/log.md')));
    assert.ok(existsSync(join(root, '.gitignore')));

    const index = readFileSync(join(root, 'wiki/index.md'), 'utf8');
    assert.match(index, /^# Demo/);
  });
});

test('scaffoldWiki with agent:"all" writes CLAUDE.md, AGENTS.md, and .cursorrules', () => {
  inTmp((root) => {
    const { schemas } = scaffoldWiki(root, { domain: 'blank', agent: 'all', wikiName: 'Demo' });
    assert.deepEqual(schemas.sort(), ['.cursorrules', 'AGENTS.md', 'CLAUDE.md']);
    for (const f of schemas) {
      assert.ok(existsSync(join(root, f)), `missing schema file: ${f}`);
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
