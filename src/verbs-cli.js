import pc from 'picocolors';
import {
  resolveWiki, queryIndex, readPage, searchWiki,
  listSources, listStalePages, listOrphanPages,
} from './verbs.js';

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

function firstPositional(args) {
  return args.find(a => !a.startsWith('--'));
}

function wikiFromArgs(args) {
  return resolveWiki(argValue(args, '--wiki'));
}

function maybeJson(args, data, render) {
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  render(data);
}

export async function runQuery(args) {
  const wiki = wikiFromArgs(args);
  const content = queryIndex(wiki.path);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ wiki: wiki.slug, path: 'wiki/index.md', content }, null, 2) + '\n');
  } else {
    process.stdout.write(content);
  }
}

export async function runRead(args) {
  const relPath = firstPositional(args);
  if (!relPath) {
    process.stderr.write('Usage: tng-wiki read <relative-path> [--wiki <slug>] [--json]\n');
    process.exit(1);
  }
  const wiki = wikiFromArgs(args);
  const content = readPage(wiki.path, relPath);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ wiki: wiki.slug, path: relPath, content }, null, 2) + '\n');
  } else {
    process.stdout.write(content);
  }
}

export async function runSearch(args) {
  const query = firstPositional(args);
  if (!query) {
    process.stderr.write('Usage: tng-wiki search <query> [--wiki <slug>] [--regex] [--include-raw] [--json]\n');
    process.exit(1);
  }
  const wiki = wikiFromArgs(args);
  const hits = searchWiki(wiki.path, query, {
    regex: args.includes('--regex'),
    includeRaw: args.includes('--include-raw'),
  });
  maybeJson(args, { wiki: wiki.slug, query, hits }, () => {
    for (const h of hits) {
      const tag = h.source === 'raw' ? pc.yellow('[raw] ') : pc.dim('[wiki]');
      process.stdout.write(`${tag} ${h.path}:${h.line}: ${h.text}\n`);
    }
  });
}

export async function runSources(args) {
  const wiki = wikiFromArgs(args);
  const sources = listSources(wiki.path, { uncompiledOnly: args.includes('--uncompiled') });
  maybeJson(args, { wiki: wiki.slug, sources }, () => {
    for (const s of sources) {
      const status = s.compiled ? pc.dim('[compiled]  ') : pc.yellow('[uncompiled]');
      const title = s.title ? `  ${pc.dim('—')} ${s.title}` : '';
      process.stdout.write(`${status} ${s.path}${title}\n`);
    }
  });
}

export async function runStale(args) {
  const wiki = wikiFromArgs(args);
  const pages = listStalePages(wiki.path);
  maybeJson(args, { wiki: wiki.slug, pages }, () => {
    for (const p of pages) {
      const count = p.count === 1 ? '1 marker' : `${p.count} markers`;
      process.stdout.write(`${p.path}  ${pc.dim(`(${count})`)}\n`);
    }
  });
}

export async function runOrphans(args) {
  const wiki = wikiFromArgs(args);
  const pages = listOrphanPages(wiki.path);
  maybeJson(args, { wiki: wiki.slug, pages }, () => {
    for (const p of pages) process.stdout.write(`${p.path}\n`);
  });
}
