#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import {
  resolveWiki, queryIndex, readPage, searchWiki,
  listSources, listStalePages, listOrphanPages,
} from '../src/verbs.js';
import { loadRegistry, listWikis } from '../src/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const server = new McpServer({
  name: 'tng-wiki',
  version: pkg.version,
});

function ok(data) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  };
}

function err(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function withWiki(wiki, fn) {
  try {
    const resolved = resolveWiki(wiki ?? null);
    return fn(resolved);
  } catch (e) {
    return err(e.message);
  }
}

server.registerTool(
  'list_wikis',
  {
    title: 'List registered wikis',
    description: 'Returns every wiki registered in ~/.tng-wiki/registry.json with slug, path, domain, and default flag. Call this first to see what wikis are available before calling other tools with a specific --wiki slug.',
    inputSchema: {},
  },
  async () => ok({ wikis: listWikis(loadRegistry()) }),
);

server.registerTool(
  'query',
  {
    title: 'Read wiki index',
    description: 'Returns the content of wiki/index.md for the target wiki. This is the master table of contents — always call this first when answering any question about a wiki, to see what pages exist.',
    inputSchema: {
      wiki: z.string().optional().describe('Registry slug of the target wiki. Omit to use the default wiki.'),
    },
  },
  async ({ wiki }) => withWiki(wiki, (w) => ok({
    wiki: w.slug, path: 'wiki/index.md', content: queryIndex(w.path),
  })),
);

server.registerTool(
  'read',
  {
    title: 'Read a wiki page',
    description: 'Returns the full content of a specific wiki page by its path (relative to wiki/). Paths that escape the wiki directory (e.g., "../foo") are rejected.',
    inputSchema: {
      path: z.string().describe('Path relative to wiki/, e.g. "entities/openai.md" or "opportunities/agents-market.md".'),
      wiki: z.string().optional().describe('Registry slug of the target wiki. Omit to use the default wiki.'),
    },
  },
  async ({ path, wiki }) => withWiki(wiki, (w) => {
    try {
      return ok({ wiki: w.slug, path, content: readPage(w.path, path) });
    } catch (e) {
      return err(e.message);
    }
  }),
);

server.registerTool(
  'search',
  {
    title: 'Search wiki pages',
    description: 'Case-insensitive search across wiki pages. Returns grep-style hits tagged source:"wiki" by default. Pass include_raw=true to also search raw/ sources — use this for deep searches, source-verification ("confirm this", "consult the official docs"), or when a compiled answer is missing and you suspect the detail survives in the archival source.',
    inputSchema: {
      query: z.string().describe('Search term. Substring by default; pass regex=true for regex patterns.'),
      wiki: z.string().optional().describe('Registry slug of the target wiki. Omit to use the default wiki.'),
      regex: z.boolean().optional().describe('Interpret `query` as a regex pattern. Default: false.'),
      include_raw: z.boolean().optional().describe('Also search raw/ source material, not just compiled wiki/ pages. Each hit is tagged source:"wiki" or source:"raw". Default: false.'),
    },
  },
  async ({ query, wiki, regex, include_raw }) => withWiki(wiki, (w) => ok({
    wiki: w.slug, query, hits: searchWiki(w.path, query, { regex: !!regex, includeRaw: !!include_raw }),
  })),
);

server.registerTool(
  'sources',
  {
    title: 'List raw sources',
    description: 'Enumerates files under raw/ with compiled status, title, and type parsed from YAML frontmatter. Use uncompiled_only=true to find sources the wiki has not yet ingested.',
    inputSchema: {
      wiki: z.string().optional().describe('Registry slug of the target wiki. Omit to use the default wiki.'),
      uncompiled_only: z.boolean().optional().describe('Only return sources with `compiled: false` in frontmatter. Default: false.'),
    },
  },
  async ({ wiki, uncompiled_only }) => withWiki(wiki, (w) => ok({
    wiki: w.slug, sources: listSources(w.path, { uncompiledOnly: !!uncompiled_only }),
  })),
);

server.registerTool(
  'stale',
  {
    title: 'List stale pages',
    description: 'Returns wiki pages marked with the ⚠️ STALE? inline marker, plus the count of markers in each. Used for lint workflows.',
    inputSchema: {
      wiki: z.string().optional().describe('Registry slug of the target wiki. Omit to use the default wiki.'),
    },
  },
  async ({ wiki }) => withWiki(wiki, (w) => ok({
    wiki: w.slug, pages: listStalePages(w.path),
  })),
);

server.registerTool(
  'orphans',
  {
    title: 'List orphan pages',
    description: 'Returns wiki pages that no other page links to via [[wikilinks]], excluding structural pages (index.md, log.md). Used for lint workflows.',
    inputSchema: {
      wiki: z.string().optional().describe('Registry slug of the target wiki. Omit to use the default wiki.'),
    },
  },
  async ({ wiki }) => withWiki(wiki, (w) => ok({
    wiki: w.slug, pages: listOrphanPages(w.path),
  })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
