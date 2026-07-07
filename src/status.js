import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, relative, resolve } from 'path';
import { resolveWiki, listInboxItems, ritualReport } from './verbs.js';
import { walkMd } from './paths.js';
import { isGroundable } from './ground.js';

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
  // The number rounds/ground scan: wikiPages minus ground's structural
  // exemptions (index.md, log.md, _-prefixed templates, wiki/meta/*). Reported
  // alongside the raw file count so the two surfaces stop looking contradictory
  // (status said 32 while rounds said 25, with no explanation of either).
  const groundablePages = walkMd(join(root, 'wiki'))
    .filter((f) => isGroundable(relative(root, f)))
    .length;
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
  // Pending capture-dir triage (null = wiki has no _inbox/); mirrors rounds
  const inboxItems = listInboxItems(root);
  const inboxCount = inboxItems === null ? null : inboxItems.length;
  // Ritual meta-health (log age + git churn); mirrors rounds
  const ritual = ritualReport(root);

  return {
    isWiki: true,
    root,
    rawFiles,
    wikiPages,
    groundablePages,
    outputFiles,
    opCount,
    lastOp,
    hasSchema,
    hasIndex,
    staleCount,
    uncompiledCount,
    inboxCount,
    ritual,
  };
}

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

function firstPositional(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--wiki') { i++; continue; } // skip the flag's value
    if (a.startsWith('--')) continue;
    return a;
  }
  return undefined;
}

// Same wiki-resolution semantics as the verbs (query/read/search):
// --wiki <slug> targets a registered wiki from any cwd; bare `status` uses the
// registered default; an explicit path argument bypasses the registry entirely.
// A path *and* --wiki together is ambiguous (path bypasses the registry, the
// slug goes through it) — rejected explicitly rather than silently picking one.
export function resolveStatusRoot(args, home) {
  const slug = argValue(args, '--wiki');
  const explicit = firstPositional(args);
  if (slug && explicit) {
    throw new Error(`Pass either a path ("${explicit}") or --wiki ${slug}, not both — a path bypasses the registry, --wiki resolves through it.`);
  }
  if (explicit) return { root: resolve(explicit), slug: null };
  const wiki = resolveWiki(slug, home);
  return { root: wiki.path, slug: wiki.slug };
}

export async function runStatus(args) {
  const { root, slug } = resolveStatusRoot(args);
  const status = computeStatus(root);

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ wiki: slug, ...status }, null, 2) + '\n');
    return;
  }

  if (!status.isWiki) {
    p.log.error('Not a wiki directory. Run this from your wiki root, or pass the path as an argument.');
    p.log.info(`  ${pc.dim('$')} tng-wiki status /path/to/wiki`);
    return;
  }

  p.intro(pc.bgCyan(pc.black(' wiki status ')));

  console.log('');
  console.log(`  ${pc.bold('Wiki Health')}  ${pc.dim(slug ? `${slug} · ${status.root}` : status.root)}`);
  console.log('');
  console.log(`  ${pc.cyan('Sources (raw/):')}      ${status.rawFiles} markdown files`);
  console.log(`  ${pc.cyan('Wiki pages:')}          ${status.wikiPages} ${pc.dim(`(${status.groundablePages} groundable, the count rounds/ground scan)`)}`);
  console.log(`  ${pc.cyan('Outputs:')}             ${status.outputFiles} files`);
  console.log(`  ${pc.cyan('Operations logged:')}   ${status.opCount}`);
  console.log('');

  if (status.uncompiledCount > 0) {
    console.log(`  ${pc.yellow('⚠')} ${status.uncompiledCount} uncompiled source${status.uncompiledCount > 1 ? 's' : ''} in raw/`);
  }
  if (status.inboxCount > 0) {
    console.log(`  ${pc.yellow('⚠')} ${status.inboxCount} item${status.inboxCount > 1 ? 's' : ''} pending triage in _inbox/`);
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
  // Ritual meta-health: same yellow rule as rounds - both signals must agree
  // (stale log AND uncommitted churn) before it reads as a lapse.
  const rit = status.ritual;
  const churn = rit?.git ? rit.git.changed + rit.git.untracked : 0;
  if (churn > 0) {
    const lapsed = rit.last_log_days !== null && rit.last_log_days >= 14;
    const line = `  ${lapsed ? pc.yellow('⚠') : pc.dim('○')} uncommitted changes: ${rit.git.changed} changed + ${rit.git.untracked} untracked`;
    console.log(line);
  }
  if (status.lastOp) {
    console.log('');
    const age = rit?.last_log_days !== null && rit?.last_log_days > 0
      ? pc.dim(` (${rit.last_log_days}d ago)`) : '';
    console.log(`  ${pc.dim('Last operation:')} ${status.lastOp.date}${age} — ${status.lastOp.desc}`);
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
