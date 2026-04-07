import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

export async function runStatus(args) {
  const root = resolve(args[0] || '.');

  // Check if this is a wiki
  const hasWiki = existsSync(join(root, 'wiki'));
  const hasRaw = existsSync(join(root, 'raw'));
  const hasSchema = existsSync(join(root, 'CLAUDE.md'))
    || existsSync(join(root, 'AGENTS.md'))
    || existsSync(join(root, '.cursorrules'));

  if (!hasWiki || !hasRaw) {
    p.log.error('Not a wiki directory. Run this from your wiki root, or pass the path as an argument.');
    p.log.info(`  ${pc.dim('$')} tng-wiki status /path/to/wiki`);
    return;
  }

  p.intro(pc.bgCyan(pc.black(' wiki status ')));

  // Count files
  const rawFiles = countMdFiles(join(root, 'raw'));
  const wikiPages = countMdFiles(join(root, 'wiki'));
  const outputFiles = existsSync(join(root, 'output')) ? countMdFiles(join(root, 'output')) : 0;

  // Check index
  const indexPath = join(root, 'wiki', 'index.md');
  const hasIndex = existsSync(indexPath);

  // Check log
  const logPath = join(root, 'wiki', 'log.md');
  const hasLog = existsSync(logPath);
  let lastOp = null;
  let opCount = 0;
  if (hasLog) {
    const log = readFileSync(logPath, 'utf8');
    const ops = log.match(/^## \[/gm);
    opCount = ops ? ops.length : 0;
    const lastMatch = log.match(/^## \[([^\]]+)\] (.+)$/m);
    if (lastMatch) lastOp = { date: lastMatch[1], desc: lastMatch[2] };
  }

  // Check for stale markers
  let staleCount = 0;
  if (hasWiki) {
    staleCount = countPattern(join(root, 'wiki'), /⚠️ STALE\?/g);
  }

  // Check uncompiled sources
  let uncompiledCount = 0;
  if (hasRaw) {
    uncompiledCount = countPattern(join(root, 'raw'), /compiled: false/g);
  }

  // Output
  console.log('');
  console.log(`  ${pc.bold('Wiki Health')}  ${pc.dim(root)}`);
  console.log('');
  console.log(`  ${pc.cyan('Sources (raw/):')}      ${rawFiles} markdown files`);
  console.log(`  ${pc.cyan('Wiki pages:')}          ${wikiPages} pages`);
  console.log(`  ${pc.cyan('Outputs:')}             ${outputFiles} files`);
  console.log(`  ${pc.cyan('Operations logged:')}   ${opCount}`);
  console.log('');

  if (uncompiledCount > 0) {
    console.log(`  ${pc.yellow('⚠')} ${uncompiledCount} uncompiled source${uncompiledCount > 1 ? 's' : ''} in raw/`);
  }
  if (staleCount > 0) {
    console.log(`  ${pc.yellow('⚠')} ${staleCount} stale marker${staleCount > 1 ? 's' : ''} in wiki/`);
  }
  if (!hasSchema) {
    console.log(`  ${pc.yellow('⚠')} No schema file found (CLAUDE.md / AGENTS.md / .cursorrules)`);
  }
  if (!hasIndex) {
    console.log(`  ${pc.yellow('⚠')} Missing wiki/index.md`);
  }
  if (lastOp) {
    console.log('');
    console.log(`  ${pc.dim('Last operation:')} ${lastOp.date} — ${lastOp.desc}`);
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
