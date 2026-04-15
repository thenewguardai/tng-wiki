import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync, readFileSync } from 'fs';
import { resolve, join, basename } from 'path';
import {
  loadRegistry, saveRegistry, registerWiki, unregisterWiki,
  setDefault as setDefaultInRegistry, listWikis, registryPath,
} from './registry.js';

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

export async function runRegister(args) {
  const pathArg = args.find(a => !a.startsWith('--')) ?? '.';
  const root = resolve(pathArg);
  const nameOverride = argValue(args, '--name');
  const domainOverride = argValue(args, '--domain');
  const makeDefault = args.includes('--default');

  const meta = readWikiMetadata(root);
  const entry = {
    name: nameOverride ?? meta.name,
    path: meta.path,
    domain: domainOverride ?? meta.domain ?? 'blank',
  };

  let registry = loadRegistry();
  registry = registerWiki(registry, entry);
  if (makeDefault) registry = setDefaultInRegistry(registry, slugOf(registry, entry.path));
  saveRegistry(registry);

  const slug = slugOf(registry, entry.path);
  console.log(`${pc.green('✓')} Registered ${pc.bold(slug)} ${pc.dim(`(${entry.path})`)}`);
  if (registry.default === slug) console.log(`  ${pc.dim('Set as default.')}`);
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
    console.log(`  ${marker} ${pc.bold(w.slug.padEnd(24))} ${pc.dim(w.domain.padEnd(18))} ${w.path}`);
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
