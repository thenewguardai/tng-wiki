import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scaffoldWiki } from '../src/init.js';
import { saveRegistry, emptyRegistry, registerWiki } from '../src/registry.js';

const MCP_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tng-wiki-mcp.js');

function withEnv() {
  const home = mkdtempSync(join(tmpdir(), 'tng-wiki-mcp-home-'));
  const wikiParent = mkdtempSync(join(tmpdir(), 'tng-wiki-mcp-wiki-'));
  const wikiPath = join(wikiParent, 'demo');
  mkdirSync(wikiPath);
  scaffoldWiki(wikiPath, { domain: 'blank', agent: 'claude-code', wikiName: 'MCP Demo' });
  const reg = registerWiki(emptyRegistry(), { name: 'MCP Demo', path: wikiPath, domain: 'blank' });
  saveRegistry(reg, home);
  return {
    home,
    wikiPath,
    cleanup: () => {
      rmSync(home, { recursive: true, force: true });
      rmSync(wikiParent, { recursive: true, force: true });
    },
  };
}

async function mcpCall(home, requests) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [MCP_BIN], {
      env: { ...process.env, HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('error', reject);
    proc.on('close', () => {
      const lines = stdout.split('\n').filter(Boolean);
      const messages = lines.map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      resolve(messages);
    });
    for (const req of requests) proc.stdin.write(JSON.stringify(req) + '\n');
    proc.stdin.end();
  });
}

const INIT = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  },
};

const INITIALIZED = { jsonrpc: '2.0', method: 'notifications/initialized' };

test('MCP server lists all seven tools with names we ship', async () => {
  const env = withEnv();
  try {
    const msgs = await mcpCall(env.home, [INIT, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }]);
    const listMsg = msgs.find(m => m.id === 2);
    const names = listMsg.result.tools.map(t => t.name).sort();
    assert.deepEqual(names, ['list_wikis', 'orphans', 'query', 'read', 'search', 'sources', 'stale']);
  } finally {
    env.cleanup();
  }
});

test('MCP list_wikis tool returns the registered wiki', async () => {
  const env = withEnv();
  try {
    const msgs = await mcpCall(env.home, [
      INIT, INITIALIZED,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_wikis', arguments: {} } },
    ]);
    const resp = msgs.find(m => m.id === 3);
    const payload = JSON.parse(resp.result.content[0].text);
    assert.equal(payload.wikis.length, 1);
    assert.equal(payload.wikis[0].slug, 'mcp-demo');
    assert.equal(payload.wikis[0].isDefault, true);
  } finally {
    env.cleanup();
  }
});

test('MCP query tool returns the default wiki index when no slug is provided', async () => {
  const env = withEnv();
  try {
    const msgs = await mcpCall(env.home, [
      INIT, INITIALIZED,
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'query', arguments: {} } },
    ]);
    const resp = msgs.find(m => m.id === 4);
    const payload = JSON.parse(resp.result.content[0].text);
    assert.equal(payload.wiki, 'mcp-demo');
    assert.match(payload.content, /^# MCP Demo/);
  } finally {
    env.cleanup();
  }
});

test('MCP search tool returns hits in the expected shape', async () => {
  const env = withEnv();
  try {
    writeFileSync(join(env.wikiPath, 'wiki', 'entities', 'acme.md'), '# Acme\nMentions Karpathy', 'utf8');
    const msgs = await mcpCall(env.home, [
      INIT, INITIALIZED,
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'search', arguments: { query: 'Karpathy' } } },
    ]);
    const resp = msgs.find(m => m.id === 5);
    const payload = JSON.parse(resp.result.content[0].text);
    assert.equal(payload.query, 'Karpathy');
    assert.ok(payload.hits.length >= 1);
    assert.ok(payload.hits.some(h => h.path.endsWith('acme.md')));
  } finally {
    env.cleanup();
  }
});

test('MCP read tool rejects paths that escape the wiki directory', async () => {
  const env = withEnv();
  try {
    const msgs = await mcpCall(env.home, [
      INIT, INITIALIZED,
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'read', arguments: { path: '../../etc/passwd' } } },
    ]);
    const resp = msgs.find(m => m.id === 6);
    assert.equal(resp.result.isError, true);
    assert.match(resp.result.content[0].text, /escapes the wiki directory/);
  } finally {
    env.cleanup();
  }
});

test('MCP tool with unknown --wiki slug returns an isError result, not a crash', async () => {
  const env = withEnv();
  try {
    const msgs = await mcpCall(env.home, [
      INIT, INITIALIZED,
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'query', arguments: { wiki: 'does-not-exist' } } },
    ]);
    const resp = msgs.find(m => m.id === 7);
    assert.equal(resp.result.isError, true);
    assert.match(resp.result.content[0].text, /No wiki registered/);
  } finally {
    env.cleanup();
  }
});
