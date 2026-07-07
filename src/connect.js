import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import pc from 'picocolors';
import { resolveWiki } from './verbs.js';
import { resolveConfigPath } from './paths.js';

// Make agent sessions in OTHER repos aware of a registered wiki by writing a
// managed nudge block into a local, git-excluded agent file (e.g. CLAUDE.local.md).
// The block tells sessions to search the wiki before re-deriving knowledge and to
// hand keepable output back to it. The file is added to .git/info/exclude (not the
// tracked .gitignore) so it stays per-machine and never enters shared git history.

const START = '<!-- tng-wiki:connect -->';
const END = '<!-- /tng-wiki:connect -->';

// agent -> which local file(s) to write. CLAUDE.local.md is Claude Code's
// auto-loaded, conventionally-untracked override file.
const AGENT_FILES = {
  'claude-code': ['CLAUDE.local.md'],
  'codex': ['AGENTS.local.md'],
  'cursor': ['CLAUDE.local.md'],
  'all': ['CLAUDE.local.md', 'AGENTS.local.md'],
};

// Normalize a wiki description for embedding mid-sentence in the connect block:
// fold em/en dashes to hyphens (the block is written verbatim into other repos'
// agent files, where em-dashes read as machine-generated, even when the dash came
// from the user's own .tng-wiki.json), collapse whitespace, and trim trailing
// sentence punctuation so a description ending in "." does not collide with the
// text that follows (avoids "...sm_120 quirks. is registered at ...").
function cleanScope(description) {
  return description.trim()
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[.;,\s]+$/, '');
}

export function buildConnectBlock({ slug, name, domain, description, path, inbox = false }) {
  const scope = description && description.trim() ? ` It covers ${cleanScope(description)}.` : '';
  // "blank" is the catch-all domain slug, not a meaningful label; omit the domain
  // clause for it so the sentence reads as prose instead of leaking a placeholder.
  const domainClause = domain && domain !== 'blank' ? ` for **${domain}**` : '';
  // When the wiki has an _inbox/ (code-archaeology and other librarian-style
  // wikis), offer the cheap capture path first: dropping a file in costs nothing,
  // and a later librarian session does the careful grounding and filing.
  const handoff = inbox
    ? `When a session produces durable, keepable research or decisions, hand them off rather than letting them evaporate. Cheapest path: drop the file into \`${path}/_inbox/\` and a later librarian session there grounds and files it (capture is cheap, filing is careful). Heavier path: \`cd ${path}\`, follow its \`AGENTS.md\` to ingest, or tell the maintaining agent to "do wiki rounds".`
    : `When a session produces durable, keepable research or decisions, hand them off to the wiki rather than letting them evaporate: \`cd ${path}\`, follow its \`AGENTS.md\` to ingest, or tell the maintaining agent to "do wiki rounds".`;
  return [
    START,
    `## Knowledge wiki: ${name} (\`${slug}\`)`,
    '',
    `A tng-wiki knowledge base${domainClause} is registered on this machine at \`${path}\`.${scope}`,
    '',
    'Before re-deriving domain knowledge, search it first; the registry makes these work from any directory:',
    '',
    '```bash',
    `tng-wiki query  --wiki ${slug}            # index / table of contents`,
    `tng-wiki search "<topic>" --wiki ${slug}  # find compiled knowledge`,
    '```',
    '',
    handoff,
    '',
    '_Managed by `tng-wiki connect`. Edits inside this block are overwritten; remove with `tng-wiki connect <this-repo> --remove`._',
    END,
  ].join('\n');
}

// Insert or replace the managed block in `existing`. Idempotent: a second apply
// updates the block in place rather than stacking copies.
export function applyManagedBlock(existing, block) {
  if (!existing) return block + '\n';
  const s = existing.indexOf(START);
  const e = existing.indexOf(END);
  if (s !== -1 && e !== -1 && e > s) {
    return existing.slice(0, s) + block + existing.slice(e + END.length);
  }
  const base = existing.endsWith('\n') ? existing : existing + '\n';
  return base + '\n' + block + '\n';
}

// Strip the managed block, returning '' if nothing else remains.
export function removeManagedBlock(existing) {
  if (!existing) return '';
  const s = existing.indexOf(START);
  const e = existing.indexOf(END);
  if (s === -1 || e === -1 || e < s) return existing;
  const before = existing.slice(0, s).replace(/\n+$/, '');
  const after = existing.slice(e + END.length).replace(/^\n+/, '');
  const joined = [before, after].filter(Boolean).join('\n\n');
  return joined ? joined + '\n' : '';
}

function readWikiDescription(wikiPath) {
  try {
    const meta = JSON.parse(readFileSync(join(wikiPath, '.tng-wiki.json'), 'utf8'));
    return typeof meta.description === 'string' ? meta.description : '';
  } catch { return ''; }
}

function gitExcludeAdd(repoRoot, filename) {
  const gitDir = join(repoRoot, '.git');
  if (!existsSync(gitDir) || !statSync(gitDir).isDirectory()) {
    return { ok: false, reason: 'not a git repo — skipped .git/info/exclude' };
  }
  const infoDir = join(gitDir, 'info');
  const excludePath = join(infoDir, 'exclude');
  let content = '';
  try { content = readFileSync(excludePath, 'utf8'); } catch { /* none yet */ }
  if (content.split('\n').map((l) => l.trim()).includes(filename)) return { ok: true, already: true };
  mkdirSync(infoDir, { recursive: true });
  const base = content && !content.endsWith('\n') ? content + '\n' : content;
  writeFileSync(excludePath, base + filename + '\n', 'utf8');
  return { ok: true };
}

function gitExcludeRemove(repoRoot, filename) {
  const excludePath = join(repoRoot, '.git', 'info', 'exclude');
  if (!existsSync(excludePath)) return;
  const kept = readFileSync(excludePath, 'utf8').split('\n').filter((l) => l.trim() !== filename);
  writeFileSync(excludePath, kept.join('\n'), 'utf8');
}

function parseConnectArgs(args) {
  const opts = { remove: false, help: false, repo: '.', unknown: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const value = () => (args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : '');
    switch (a) {
      case '-h': case '--help': opts.help = true; break;
      case '--remove': opts.remove = true; break;
      case '--wiki': opts.wiki = value(); break;
      case '--agent': opts.agent = value(); break;
      default:
        if (a.startsWith('--')) opts.unknown.push(a);
        else opts.repo = a;
    }
  }
  return opts;
}

function printConnectHelp() {
  console.log(`
${pc.bold('Usage:')} tng-wiki connect [repo-path] [--wiki <slug>] [--agent claude-code|codex|cursor|all] [--remove]

Make agent sessions in another repo aware of a registered wiki. Writes a managed
nudge block into a local, git-excluded agent file (e.g. CLAUDE.local.md) telling
sessions to search the wiki before re-deriving knowledge and to hand keepable
output back to it.

  ${pc.cyan('repo-path')}     target repo (default: current directory)
  ${pc.cyan('--wiki')}        which registered wiki (default: the default wiki)
  ${pc.cyan('--agent')}       file flavor (default: claude-code → CLAUDE.local.md)
  ${pc.cyan('--remove')}      remove the managed block (and its .git/info/exclude entry)
  ${pc.cyan('--help, -h')}    show this help

The nudge file is added to .git/info/exclude (not the tracked .gitignore), so it
stays per-machine and never enters shared git history.
`);
}

export async function runConnect(args) {
  const opts = parseConnectArgs(args);
  if (opts.help) { printConnectHelp(); return; }
  if (opts.unknown.length) {
    console.error(pc.red('Error:'), `unknown connect flag(s): ${opts.unknown.join(', ')}`);
    process.exit(1);
  }

  const repoRoot = resolve(opts.repo);
  if (!existsSync(repoRoot)) { console.error(pc.red('Error:'), `target repo not found: ${repoRoot}`); process.exit(1); }

  const agent = opts.agent || 'claude-code';
  const files = AGENT_FILES[agent];
  if (!files) { console.error(pc.red('Error:'), `unknown --agent "${agent}". One of: ${Object.keys(AGENT_FILES).join(', ')}`); process.exit(1); }

  let wiki;
  try { wiki = resolveWiki(opts.wiki); }
  catch (err) { console.error(pc.red('Error:'), err.message); process.exit(1); }

  if (opts.remove) {
    let any = false;
    for (const f of files) {
      const full = join(repoRoot, f);
      if (!existsSync(full)) continue;
      any = true;
      const next = removeManagedBlock(readFileSync(full, 'utf8'));
      if (next.trim() === '') { rmSync(full); console.log(`${pc.green('✓')} removed ${pc.cyan(f)} ${pc.dim('(was only the managed block)')}`); }
      else { writeFileSync(full, next, 'utf8'); console.log(`${pc.green('✓')} removed tng-wiki block from ${pc.cyan(f)}`); }
      gitExcludeRemove(repoRoot, f);
    }
    if (!any) console.log(pc.dim('Nothing to remove.'));
    return;
  }

  // Registry paths are normally stored absolute, but expand `~` for hand-edited
  // entries so the description lookup and the written block point at a real path.
  const wikiPath = resolveConfigPath(process.cwd(), wiki.path);
  const description = readWikiDescription(wikiPath);
  const inbox = existsSync(join(wikiPath, '_inbox'));
  const block = buildConnectBlock({ slug: wiki.slug, name: wiki.name, domain: wiki.domain, description, path: wikiPath, inbox });

  for (const f of files) {
    const full = join(repoRoot, f);
    const existing = existsSync(full) ? readFileSync(full, 'utf8') : '';
    const verb = existing.includes(START) ? 'updated' : 'wrote';
    writeFileSync(full, applyManagedBlock(existing, block), 'utf8');
    const ex = gitExcludeAdd(repoRoot, f);
    const exNote = ex.ok ? (ex.already ? 'already git-excluded' : 'added to .git/info/exclude') : ex.reason;
    console.log(`${pc.green('✓')} ${verb} ${pc.cyan(f)} ${pc.dim(`(${exNote})`)}`);
  }
  console.log(`  ${pc.dim(`Sessions in ${repoRoot} will be pointed at wiki "${wiki.slug}" (${wikiPath}).`)}`);
}
