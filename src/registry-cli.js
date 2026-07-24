import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync, readFileSync } from 'fs';
import { resolve, join, basename } from 'path';
import {
  loadRegistry, saveRegistry, registerWiki, unregisterWiki,
  setDefault as setDefaultInRegistry, listWikis, registryPath,
} from './registry.js';
import { isTempPath } from './paths.js';
import { readSharing, stampSharing, relationTo } from './sharing.js';
import { hostname } from 'os';
import { readdirSync } from 'fs';

export function readWikiMetadata(root) {
  if (!existsSync(join(root, 'AGENTS.md'))) {
    throw new Error(`Not a tng-wiki directory (no AGENTS.md found): ${root}`);
  }
  const metaPath = join(root, '.tng-wiki.json');
  if (existsSync(metaPath)) {
    try {
      const data = JSON.parse(readFileSync(metaPath, 'utf8'));
      return { name: data.name, path: root, domain: data.domain };
    } catch { /* fall through */ }
  }
  return { name: basename(root), path: root, domain: null };
}

// Register one wiki dir: stamp sharing if asked, refuse another host's wiki
// unless forced (#38 - "don't register the other host's wiki" is metadata now,
// not README convention), then add it to the registry.
function registerOne(root, { nameOverride, domainOverride, stamp, force }) {
  if (stamp) stampSharing(root, stamp);
  const sharing = readSharing(root);
  const relation = relationTo(sharing);
  if (relation === 'other-host' && !force) {
    throw new Error(
      `${root} is stamped "host:${sharing.host}" and this machine is "${hostname()}" - ` +
      `it is another host's wiki. Pass --force to register it anyway.`,
    );
  }
  const meta = readWikiMetadata(root);
  const entry = {
    name: nameOverride ?? meta.name,
    path: meta.path,
    domain: domainOverride ?? meta.domain ?? 'blank',
  };
  let registry = loadRegistry();
  registry = registerWiki(registry, entry);
  saveRegistry(registry);
  return { slug: slugOf(loadRegistry(), entry.path), entry, relation };
}

// Depth-1 child dirs of `root` that are wikis (have a .tng-wiki.json).
function childWikis(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => join(root, e.name))
      .filter((p) => existsSync(join(p, '.tng-wiki.json')));
  } catch {
    return [];
  }
}

export async function runRegister(args) {
  const pathArg = args.find(a => !a.startsWith('--')) ?? '.';
  const root = resolve(pathArg);
  const nameOverride = argValue(args, '--name');
  const domainOverride = argValue(args, '--domain');
  const makeDefault = args.includes('--default');
  const force = args.includes('--force');
  const yes = args.includes('--yes');

  const shared = args.includes('--shared');
  const hostIdx = args.indexOf('--host');
  const hostVal = hostIdx === -1 ? null : (argValue(args, '--host') ?? hostname());
  if (shared && hostVal) throw new Error('--shared and --host are mutually exclusive.');
  const stamp = shared ? 'shared' : hostVal ? `host:${hostVal}` : null;

  // Monorepo mode: the path is not itself a wiki but contains child wikis at
  // depth 1 - enumerate them, honoring each child's sharing stamp (#38).
  if (!existsSync(join(root, 'AGENTS.md')) && childWikis(root).length > 0) {
    if (stamp) throw new Error('--shared/--host stamp a single wiki - run register per child to stamp, or stamp then re-run on the root.');
    for (const child of childWikis(root)) {
      const relation = relationTo(readSharing(child));
      if (relation === 'other-host') {
        console.log(`  ${pc.dim(`skipped ${basename(child)} - stamped host:${readSharing(child).host} (another host's wiki)`)}`);
        continue;
      }
      if (relation === null && yes) {
        console.log(`  ${pc.dim(`skipped ${basename(child)} - unstamped (no sharing field); register it individually or stamp it`)}`);
        continue;
      }
      if (relation === null) {
        const go = await p.confirm({ message: `${basename(child)} has no sharing stamp - register it on this machine?` });
        if (p.isCancel(go)) throw new Error('CANCELLED');
        if (!go) { console.log(`  ${pc.dim(`skipped ${basename(child)}`)}`); continue; }
      }
      const { slug } = registerOne(child, { force });
      console.log(`${pc.green('✓')} Registered ${pc.bold(slug)} ${pc.dim(`(${child})`)}${relation ? pc.dim(` [${relation}]`) : ''}`);
    }
    return;
  }

  const { slug, entry } = registerOne(root, { nameOverride, domainOverride, stamp, force });
  let registry = loadRegistry();
  if (makeDefault) { registry = setDefaultInRegistry(registry, slug); saveRegistry(registry); }
  console.log(`${pc.green('✓')} Registered ${pc.bold(slug)} ${pc.dim(`(${entry.path})`)}${stamp ? pc.dim(` [${stamp}]`) : ''}`);
  if (loadRegistry().default === slug) console.log(`  ${pc.dim('Set as default.')}`);
}

export async function runUnregister(args) {
  const slug = args[0];
  if (!slug) {
    p.log.error('Usage: tng-wiki unregister <slug>');
    process.exit(1);
  }
  let registry = loadRegistry();
  registry = unregisterWiki(registry, slug);
  saveRegistry(registry);
  console.log(`${pc.green('✓')} Removed ${pc.bold(slug)} from the registry ${pc.dim('(files untouched)')}`);
}

export async function runList() {
  const registry = loadRegistry();
  const wikis = listWikis(registry);
  if (wikis.length === 0) {
    console.log(`  ${pc.dim('No wikis registered.')}`);
    console.log(`  ${pc.dim('Registry:')} ${registryPath()}`);
    return;
  }

  console.log('');
  console.log(`  ${pc.bold('Registered wikis')} ${pc.dim(`— ${registryPath()}`)}`);
  console.log('');
  for (const w of wikis) {
    const marker = w.isDefault ? pc.green('★') : ' ';
    const temp = isTempPath(w.path)
      ? ` ${pc.yellow('⚠ temp path')} ${pc.dim(`- likely ephemeral; tng-wiki unregister ${w.slug}`)}`
      : '';
    const sharing = readSharing(w.path);
    const relation = relationTo(sharing);
    const badge = relation === 'shared' ? ` ${pc.cyan('[shared]')}`
      : relation === 'mine' ? ` ${pc.dim(`[host:${sharing.host}]`)}`
      : relation === 'other-host' ? ` ${pc.yellow(`[host:${sharing.host} - another host's wiki]`)}`
      : '';
    console.log(`  ${marker} ${pc.bold(w.slug.padEnd(24))} ${pc.dim(w.domain.padEnd(18))} ${w.path}${badge}${temp}`);
  }
  console.log('');
}

export async function runSetDefault(args) {
  const slug = args[0];
  if (!slug) {
    p.log.error('Usage: tng-wiki set-default <slug>');
    process.exit(1);
  }
  let registry = loadRegistry();
  registry = setDefaultInRegistry(registry, slug);
  saveRegistry(registry);
  console.log(`${pc.green('✓')} Default wiki set to ${pc.bold(slug)}`);
}

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

function slugOf(registry, path) {
  const resolved = resolve(path);
  return Object.entries(registry.wikis).find(([, w]) => resolve(w.path) === resolved)?.[0];
}
