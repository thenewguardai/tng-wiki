import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

export function computeStatus(root) {
  const hasWiki = existsSync(join(root, 'wiki'));
  const hasRaw = existsSync(join(root, 'raw'));
  const hasSchema = existsSync(join(root, 'CLAUDE.md'))
    || existsSync(join(root, 'AGENTS.md'))
    || existsSync(join(root, '.cursorrules'));

  if (!hasWiki || !hasRaw) {
    return { isWiki: false, root };
  }

  const rawFiles = countMdFiles(join(root, 'raw'));
  const wikiPages = countMdFiles(join(root, 'wiki'));
  const outputFiles = existsSync(join(root, 'output')) ? countMdFiles(join(root, 'output')) : 0;

  const hasIndex = existsSync(join(root, 'wiki', 'index.md'));

  const logPath = join(root, 'wiki', 'log.md');
  const hasLog = existsSync(logPath);
  let lastOp = null;
  let opCount = 0;
  if (hasLog) {
    const log = readFileSync(logPath, 'utf8');
    const ops = [...log.matchAll(/^## \[([^\]]+)\] (.+)$/gm)];
    opCount = ops.length;
    const lastMatch = ops.at(-1);
    if (lastMatch) lastOp = { date: lastMatch[1], desc: lastMatch[2] };
  }

  const staleCount = countPattern(join(root, 'wiki'), /⚠️ STALE\?/g);
  const uncompiledCount = countPattern(join(root, 'raw'), /compiled: false/g);

  return {
    isWiki: true,
    root,
    rawFiles,
    wikiPages,
    outputFiles,
    opCount,
    lastOp,
    hasSchema,
    hasIndex,
    staleCount,
    uncompiledCount,
  };
}

export async function runStatus(args) {
  const root = resolve(args[0] || '.');
  const status = computeStatus(root);

  if (!status.isWiki) {
    p.log.error('Not a wiki directory. Run this from your wiki root, or pass the path as an argument.');
    p.log.info(`  ${pc.dim('$')} tng-wiki status /path/to/wiki`);
    return;
  }

  p.intro(pc.bgCyan(pc.black(' wiki status ')));

  console.log('');
  console.log(`  ${pc.bold('Wiki Health')}  ${pc.dim(status.root)}`);
  console.log('');
  console.log(`  ${pc.cyan('Sources (raw/):')}      ${status.rawFiles} markdown files`);
  console.log(`  ${pc.cyan('Wiki pages:')}          ${status.wikiPages} pages`);
  console.log(`  ${pc.cyan('Outputs:')}             ${status.outputFiles} files`);
  console.log(`  ${pc.cyan('Operations logged:')}   ${status.opCount}`);
  console.log('');

  if (status.uncompiledCount > 0) {
    console.log(`  ${pc.yellow('⚠')} ${status.uncompiledCount} uncompiled source${status.uncompiledCount > 1 ? 's' : ''} in raw/`);
  }
  if (status.staleCount > 0) {
    console.log(`  ${pc.yellow('⚠')} ${status.staleCount} stale marker${status.staleCount > 1 ? 's' : ''} in wiki/`);
  }
  if (!status.hasSchema) {
    console.log(`  ${pc.yellow('⚠')} No schema file found (CLAUDE.md / AGENTS.md / .cursorrules)`);
  }
  if (!status.hasIndex) {
    console.log(`  ${pc.yellow('⚠')} Missing wiki/index.md`);
  }
  if (status.lastOp) {
    console.log('');
    console.log(`  ${pc.dim('Last operation:')} ${status.lastOp.date} — ${status.lastOp.desc}`);
  }

  console.log('');
}

function countMdFiles(dir) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      count += countMdFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      count++;
    }
  }
  return count;
}

function countPattern(dir, pattern) {
  if (!existsSync(dir)) return 0;
  let count = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      count += countPattern(full, pattern);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      try {
        const content = readFileSync(full, 'utf8');
        const matches = content.match(pattern);
        if (matches) count += matches.length;
      } catch { /* skip */ }
    }
  }
  return count;
}
