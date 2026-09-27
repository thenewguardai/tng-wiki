// `tng-wiki capture` (ADR 0001, docs/design/cross-machine-flow.md) - the one
// command a capturing session needs. It picks nothing and files nothing: the
// content lands as a NEW `_inbox/` file on the wiki's upstream branch, with
// frontmatter a librarian can route from (`captured_on`, `also:`), and the home
// host's librarian does the careful part. Capture must not fail over a name, a
// busy index, or a flaky network.
import { existsSync, readFileSync, writeFileSync, realpathSync } from 'fs';
import { join, relative, sep } from 'path';
import pc from 'picocolors';
import { resolveWiki } from './verbs.js';
import { loadRegistry, listWikis } from './registry.js';
import { splitFrontmatter, parseScalars } from './frontmatter.js';
import { localHost } from './host.js';
import {
  repoRootOf, upstreamOf, publishFile, commitLocal, queueCapture, flushOutbox,
} from './publish.js';

export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function slugifyTitle(title) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length <= 80) return slug;
  const cut = slug.slice(0, 80);
  return cut.slice(0, cut.lastIndexOf('-') > 40 ? cut.lastIndexOf('-') : 80);
}

// Plain words stay plain; anything YAML could read as syntax is double-quoted.
function yamlScalar(value) {
  return /^[A-Za-z0-9][A-Za-z0-9 ._()/+-]*$/.test(value) && !/\s$/.test(value) ? value : JSON.stringify(value);
}

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Complete the capture's frontmatter (never overwriting a key the author set)
// and derive its filename. Returns { content, title, name }.
export function prepareCapture(raw, { host, date, title: titleFlag = null, also = [], name = null }) {
  // CRLF input and an empty `---\n---` block would otherwise stack a second
  // frontmatter block above the author's.
  const normalized = raw.replace(/\r\n/g, '\n').replace(/^---\n---\n/, '');
  const { frontmatter, body } = splitFrontmatter(normalized);
  const scalars = parseScalars(frontmatter);
  const title = (scalars.title || titleFlag || body.match(/^#\s+(.+)$/m)?.[1] || '').replace(/\s+/g, ' ').trim();
  if (!title) throw new Error('the capture has no title - add a `# Heading`, a frontmatter `title:`, or pass --title "<title>".');
  const badSlug = also.find((a) => !SLUG_RE.test(a));
  if (badSlug) throw new Error(`--also "${badSlug}" is not a wiki slug.`);
  if (name != null && (/[\\/]/.test(name) || name.startsWith('.') || !name.trim())) {
    throw new Error(`--name "${name}" must be a plain file name (no directories, not hidden).`);
  }

  const has = (key) => new RegExp(`^${key}:`, 'm').test(frontmatter);
  if (also.length && has('also')) throw new Error('the note already has an `also:` list - edit it there, or drop --also.');
  const added = [];
  if (!has('title')) added.push(`title: ${yamlScalar(title)}`);
  if (!has('date')) added.push(`date: ${date}`);
  if (!has('captured_on')) added.push(`captured_on: ${host}`);
  if (also.length && !has('also')) added.push(`also: [${also.join(', ')}]`);
  const inner = [frontmatter, ...added].filter((l) => l !== '').join('\n');
  const content = `---\n${inner}\n---\n${body}`;

  const fileName = name
    ? (name.endsWith('.md') ? name : `${name}.md`)
    : `${date}-${slugifyTitle(title) || 'capture'}.md`;
  return { content, title, name: fileName };
}

// The `## Scope` text of a wiki's schema (below the fence), or null.
export function readScope(wikiPath) {
  const schema = join(wikiPath, 'AGENTS.md');
  if (!existsSync(schema)) return null;
  const m = readFileSync(schema, 'utf8').match(/^## Scope\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  const text = m?.[1]?.trim();
  return text && !text.startsWith('_Fill this in') ? text : null;
}

function captureTargets() {
  return listWikis(loadRegistry()).filter((w) => existsSync(join(w.path, '_inbox')));
}

const VALUE_FLAGS = new Set(['--wiki', '--file', '--title', '--name', '--also', '--trailer']);

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

function argValues(args, flag) {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag && args[i + 1]) out.push(args[++i]);
  return out;
}

function readContent(args) {
  const file = argValue(args, '--file');
  if (file) return readFileSync(file, 'utf8');
  if (!process.stdin.isTTY) {
    const text = readFileSync(0, 'utf8');
    if (text.trim()) return text;
  }
  throw new Error('nothing to capture - pass --file <path> or pipe the note on stdin.');
}

// Target: --wiki, or the wiki the cwd is inside. Never the registered default:
// a capture routed by accident is exactly the confusion this verb removes, so
// without a target it prints every hub's scope and asks for --wiki.
function captureWiki(args) {
  const wiki = resolveWiki(argValue(args, '--wiki'));
  if (wiki.via !== 'default') return wiki;
  const lines = captureTargets().map((w) => {
    const scope = readScope(w.path);
    return `  ${pc.bold(w.slug)}${scope ? `\n    ${pc.dim(scope.replace(/\s+/g, ' '))}` : ''}`;
  });
  process.stdout.write(`${pc.bold('Wikis that take captures')} ${pc.dim('(pick the best fit; name others with --also)')}\n${lines.join('\n')}\n`);
  throw new Error('capture needs a target: pass --wiki <slug> (see the scopes above), or run it from inside the wiki.');
}

export async function runCapture(args) {
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) { i++; continue; }
    if (!args[i].startsWith('--')) throw new Error(`unknown argument "${args[i]}" - \`capture\` takes no positional arguments. Pass the note with --file or stdin.`);
  }
  const wiki = captureWiki(args);
  const slug = wiki.slug ?? wiki.name;
  const inboxDir = join(wiki.path, '_inbox');
  if (!existsSync(inboxDir)) {
    throw new Error(`"${slug}" has no _inbox/ - it does not take captures. \`tng-wiki inbox\` lists the wikis that do.`);
  }

  const host = localHost();
  const also = argValues(args, '--also').flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
  const prepared = prepareCapture(readContent(args), {
    host, date: localDate(), title: argValue(args, '--title'), also, name: argValue(args, '--name'),
  });
  const trailers = [`Captured-On: ${host}`, ...argValues(args, '--trailer')];
  const message = `${slug} inbox: ${prepared.title}\n\n${trailers.join('\n')}\n`;

  const flushed = flushOutbox();
  const wikiReal = realpathSync(wiki.path);
  const root = repoRootOf(wikiReal);
  let result;
  if (!root) {
    let path = join(inboxDir, prepared.name);
    for (let n = 2; existsSync(path); n++) path = join(inboxDir, prepared.name.replace(/\.md$/, `-${n}.md`));
    writeFileSync(path, prepared.content);
    result = { status: 'written', path };
  } else {
    const relPath = [relative(root, wikiReal), '_inbox', prepared.name].filter(Boolean).join('/').split(sep).join('/');
    const job = { root, relPath, content: prepared.content, message };
    try {
      result = args.includes('--no-push') || !upstreamOf(root)
        ? { status: 'committed', ...commitLocal(job) }
        : { status: 'published', ...publishFile(job) };
    } catch (e) {
      // Whatever went wrong, the note is not lost: it waits in the outbox.
      result = { status: 'queued', path: relPath, kind: e.kind ?? 'error', error: e.message, outbox: queueCapture({ ...job, error: e.message, kind: e.kind ?? 'error' }) };
    }
  }
  result = { wiki: slug, title: prepared.title, also, ...result, outbox_flushed: flushed.published.length };

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  process.stdout.write(`${describeResult(result)}\n`);
  if (flushed.published.length) process.stdout.write(pc.dim(`  also published ${flushed.published.length} capture(s) queued earlier\n`));
  if (result.status !== 'queued') {
    process.stdout.write(pc.dim(`  the librarian for "${slug}" files it${also.length ? ` (and considers ${also.join(', ')})` : ''}; nothing else to do here\n`));
  }
}

const LOCAL_NOTE = {
  updated: '',
  ahead: '; this clone has unpublished commits - it arrives here on the next sync --push',
  blocked: '; could not fast-forward this clone (a lock or a file in the way) - tng-wiki sync picks it up',
};

function describeResult(r) {
  const where = pc.cyan(r.path);
  if (r.status === 'published') {
    const what = r.already ? 'already published' : 'published';
    return `${pc.green('✓')} ${what} ${where} ${pc.dim(`(${r.commit.slice(0, 7)}${LOCAL_NOTE[r.local] ?? ''})`)}`;
  }
  if (r.status === 'committed') return `${pc.green('✓')} committed ${where} ${pc.dim('(local only - this repo has no upstream, or --no-push)')}`;
  if (r.status === 'written') return `${pc.green('✓')} wrote ${where} ${pc.dim('(not a git repo)')}`;
  const why = r.kind === 'rejected'
    ? 'the remote refused it - fix the cause, then tng-wiki sync publishes it'
    : 'the next capture or sync publishes it';
  return `${pc.yellow('●')} saved, not yet published: ${where}\n  ${pc.dim(`${r.error} - ${why}. Do not capture it again.`)}`;
}
