// `tng-wiki capture` (ADR 0001, docs/design/cross-machine-flow.md) - the one
// command a capturing session needs. It picks nothing and files nothing: the
// content lands as a NEW `_inbox/` file on the wiki's upstream branch, with
// frontmatter a librarian can route from (`captured_on`, `also:`), and the home
// host's librarian does the careful part. Capture must not fail over a name, a
// busy index, or a flaky network.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, relative, sep } from 'path';
import pc from 'picocolors';
import { resolveWiki } from './verbs.js';
import { loadRegistry, listWikis } from './registry.js';
import { splitFrontmatter, parseScalars } from './frontmatter.js';
import { localHost } from './host.js';
import {
  repoRootOf, upstreamOf, publishFile, commitLocal, queueCapture, flushOutbox, TransportError,
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

function yamlScalar(value) {
  return /[:#[\]{}&*!|>'"%@`,]|^\s|\s$/.test(value) ? JSON.stringify(value) : value;
}

// Complete the capture's frontmatter (never overwriting a key the author set)
// and derive its filename. Returns { content, title, name }.
export function prepareCapture(raw, { host, date, title: titleFlag = null, also = [], name = null }) {
  const { frontmatter, body } = splitFrontmatter(raw);
  const scalars = parseScalars(frontmatter);
  const title = scalars.title || titleFlag || body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (!title) throw new Error('the capture has no title - add a `# Heading`, a frontmatter `title:`, or pass --title "<title>".');

  const has = (key) => new RegExp(`^${key}:`, 'm').test(frontmatter);
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
  const root = repoRootOf(wiki.path);
  let result;
  if (!root) {
    let path = join(inboxDir, prepared.name);
    for (let n = 2; existsSync(path); n++) path = join(inboxDir, prepared.name.replace(/\.md$/, `-${n}.md`));
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(path, prepared.content);
    result = { status: 'written', path };
  } else {
    const relPath = [relative(root, wiki.path), '_inbox', prepared.name].filter(Boolean).join('/').split(sep).join('/');
    const job = { root, relPath, content: prepared.content, message };
    if (args.includes('--no-push') || !upstreamOf(root)) {
      result = { status: 'committed', ...commitLocal(job) };
    } else {
      try {
        result = { status: 'published', ...publishFile(job) };
      } catch (e) {
        if (!(e instanceof TransportError)) throw e;
        result = { status: 'queued', path: relPath, error: e.message, outbox: queueCapture({ ...job, error: e.message }) };
      }
    }
  }
  result = { wiki: slug, title: prepared.title, also, ...result, outbox_flushed: flushed.published.length };

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  const where = pc.cyan(result.path);
  const line = {
    published: `${pc.green('✓')} published ${where} ${pc.dim(`(${result.commit.slice(0, 7)}${result.local === 'pending' ? '; this clone has unpushed commits - it arrives here on the next sync --push' : ''})`)}`,
    committed: `${pc.green('✓')} committed ${where} ${pc.dim('(local only - this repo has no upstream, or --no-push)')}`,
    written: `${pc.green('✓')} wrote ${where} ${pc.dim('(not a git repo)')}`,
    queued: `${pc.yellow('●')} queued ${where} ${pc.dim(`- ${result.error}; the next capture or sync publishes it`)}`,
  }[result.status];
  process.stdout.write(`${line}\n`);
  if (flushed.published.length) process.stdout.write(pc.dim(`  also published ${flushed.published.length} capture(s) queued earlier\n`));
  process.stdout.write(pc.dim(`  the librarian for "${slug}" files it${also.length ? ` (and considers ${also.join(', ')})` : ''}; nothing else to do here\n`));
}
