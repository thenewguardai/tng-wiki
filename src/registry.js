import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

export const REGISTRY_VERSION = 1;

export function registryPath(home = homedir()) {
  return join(home, '.tng-wiki', 'registry.json');
}

export function emptyRegistry() {
  return { version: REGISTRY_VERSION, default: null, wikis: {} };
}

export function loadRegistry(home = homedir()) {
  const path = registryPath(home);
  if (!existsSync(path)) return emptyRegistry();
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof data !== 'object' || data === null) return emptyRegistry();
    return {
      version: data.version ?? REGISTRY_VERSION,
      default: data.default ?? null,
      wikis: data.wikis ?? {},
    };
  } catch {
    return emptyRegistry();
  }
}

export function saveRegistry(registry, home = homedir()) {
  const path = registryPath(home);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  return path;
}

export function slugifyName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function registerWiki(registry, { name, path, domain, slug }) {
  const resolvedPath = resolve(path);
  const finalSlug = slug || slugifyName(name);
  if (!finalSlug) throw new Error('Cannot derive a registry slug from empty name');

  const existing = Object.entries(registry.wikis).find(([, w]) => resolve(w.path) === resolvedPath);
  if (existing && existing[0] !== finalSlug) {
    throw new Error(`Path already registered under slug "${existing[0]}"`);
  }

  const next = {
    ...registry,
    wikis: {
      ...registry.wikis,
      [finalSlug]: {
        name,
        path: resolvedPath,
        domain,
        registered: new Date().toISOString(),
      },
    },
  };

  if (!next.default) next.default = finalSlug;
  return next;
}

export function unregisterWiki(registry, slug) {
  if (!registry.wikis[slug]) {
    throw new Error(`No wiki registered under slug "${slug}"`);
  }
  const { [slug]: _removed, ...rest } = registry.wikis;
  const nextDefault = registry.default === slug
    ? (Object.keys(rest)[0] ?? null)
    : registry.default;
  return { ...registry, wikis: rest, default: nextDefault };
}

export function setDefault(registry, slug) {
  if (!registry.wikis[slug]) {
    throw new Error(`No wiki registered under slug "${slug}"`);
  }
  return { ...registry, default: slug };
}

export function listWikis(registry) {
  return Object.entries(registry.wikis).map(([slug, wiki]) => ({
    slug,
    ...wiki,
    isDefault: registry.default === slug,
  }));
}

export function getWiki(registry, slug) {
  const wiki = registry.wikis[slug];
  return wiki ? { slug, ...wiki, isDefault: registry.default === slug } : null;
}

export function getDefault(registry) {
  return registry.default ? getWiki(registry, registry.default) : null;
}
