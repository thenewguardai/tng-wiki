import pc from 'picocolors';
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, unlinkSync, symlinkSync,
} from 'fs';
import { basename, join, resolve } from 'path';
import {
  generateAgentsMd, generateDoctrine, DOCTRINE_DIR, CANONICAL_SCHEMA_FILE,
  SCHEMA_FENCE_CLOSE, SCHEMA_FENCE_OPEN_RE,
} from './agents/index.js';
import { getTemplate, DOMAIN_KEYS } from './templates/index.js';
import { installedVersion } from './version.js';
import { loadRegistry, saveRegistry } from './registry.js';
import { resolveWiki } from './verbs.js';

// `tng-wiki upgrade` regenerates a wiki's schema in place after a CLI update,
// without clobbering anything the user wrote. Three cases:
//
//   fenced  - the schema carries the managed markers (scaffolds from the fence
//             era): everything between the markers is replaced verbatim; any
//             content the user added above or below survives byte-for-byte.
//   legacy  - no markers (pre-fence scaffolds): generator-owned `##` sections
//             are identified by heading and replaced; unknown `##` sections
//             (hand-authored contracts, house rules) are carried below the new
//             fenced block, in their original order.
//   created - no schema file at all: the fenced schema is written fresh.
//
// Every path also rewrites `.tng-wiki/doctrine/` (generator-owned by
// definition), refreshes copy-mode alias files, stamps `schema_version` in
// `.tng-wiki.json`, and backs the original schema up to
// `.tng-wiki/backup/AGENTS.md` before touching it - git remains the primary
// safety net, the backup covers un-committed wikis.

const BACKUP_REL = join('.tng-wiki', 'backup', CANONICAL_SCHEMA_FILE);

// Alias files that may shadow the canonical schema, from schemaLayout's union.
const ALIAS_FILES = ['CLAUDE.md', '.cursorrules'];

// Top-level `##` headings of `content`, in order.
function headingsOf(content) {
  return [...content.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
}

// Is `heading` one the generator has ever owned? The live set is derived from
// the freshly generated schema (which automatically covers the current domain
// section and conditional blocks like "Leads, Never Sources"), plus:
//   - every `Domain: ...` heading, so re-domaining a wiki (--domain) treats the
//     OLD domain's section as generated rather than salvaging it;
//   - headings older generators emitted that the current one no longer does
//     (the 0.7.0 doctrine split moved "Marker Taxonomy" out of the schema).
function isGeneratedHeading(heading, currentHeadings) {
  if (currentHeadings.has(heading)) return true;
  if (/^Domain: /.test(heading)) return true;
  return heading === 'Marker Taxonomy';
}

// Legacy (unfenced) salvage: return the full text of every `##` section whose
// heading the generator never owned. Content before the first `##` (the H1
// title and preamble) is generated and therefore dropped; user edits made
// INSIDE generated sections are not detectable here - they live on in the
// backup and in git history, and the CLI says so.
export function salvageUserSections(oldContent, newSchema) {
  const currentHeadings = new Set(headingsOf(newSchema));
  const sections = [];
  let current = null;
  for (const line of oldContent.split('\n')) {
    const m = line.match(/^## (.+)$/);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[1].trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections
    .filter((s) => !isGeneratedHeading(s.heading, currentHeadings))
    .map((s) => ({ heading: s.heading, text: s.lines.join('\n').trimEnd() }));
}

// Fenced merge: replace the managed region, keep the user's prefix/suffix
// byte-for-byte. Returns null when the markers are missing or malformed so the
// caller can fall back to legacy salvage.
export function spliceFencedSchema(oldContent, newSchema) {
  const open = oldContent.match(SCHEMA_FENCE_OPEN_RE);
  if (!open) return null;
  const closeIdx = oldContent.indexOf(SCHEMA_FENCE_CLOSE);
  if (closeIdx === -1 || closeIdx < open.index) return null;
  const prefix = oldContent.slice(0, open.index);
  let suffix = oldContent.slice(closeIdx + SCHEMA_FENCE_CLOSE.length);
  if (suffix.trim() === '') suffix = '\n';
  return prefix + newSchema.trimEnd() + suffix;
}

function readManifest(root) {
  const manifestPath = join(root, '.tng-wiki.json');
  if (!existsSync(manifestPath)) {
    throw new Error(
      `${root} has no .tng-wiki.json - not a tng-wiki wiki. `
      + 'Use `tng-wiki init --into-existing` to adopt a directory; `upgrade` only refreshes an existing scaffold.',
    );
  }
  try {
    return { manifestPath, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) };
  } catch (e) {
    throw new Error(`Could not parse ${manifestPath}: ${e.message}`);
  }
}

// Core upgrade. Pure decision logic up front; writes gated behind dryRun so
// `--dry-run` reports exactly what a real run would do. `home` overrides the
// registry location (tests only).
export function upgradeWiki(root, { domain: domainOverride = null, dryRun = false, home } = {}) {
  const { manifestPath, manifest } = readManifest(root);

  if (domainOverride && !DOMAIN_KEYS.includes(domainOverride)) {
    throw new Error(`Unknown --domain "${domainOverride}". One of: ${DOMAIN_KEYS.join(', ')}`);
  }
  const previousDomain = manifest.domain ?? null;
  const domain = domainOverride ?? previousDomain ?? 'blank';
  const wikiName = manifest.name || basename(root);
  const leadArchives = Array.isArray(manifest.lead_archives) ? manifest.lead_archives : [];

  const newSchema = generateAgentsMd({ domain, wikiName, template: getTemplate(domain), leadArchives });

  // Locate the existing schema. AGENTS.md is canonical since the 2026-04-15
  // pivot; a pre-pivot wiki may only have CLAUDE.md as a regular file - treat
  // that as the source and convert it to an alias afterward.
  const canonicalPath = join(root, CANONICAL_SCHEMA_FILE);
  const legacyClaudeIsSource = !existsSync(canonicalPath)
    && existsSync(join(root, 'CLAUDE.md'))
    && !lstatSync(join(root, 'CLAUDE.md')).isSymbolicLink();
  const sourcePath = existsSync(canonicalPath)
    ? canonicalPath
    : (legacyClaudeIsSource ? join(root, 'CLAUDE.md') : null);
  const oldContent = sourcePath ? readFileSync(sourcePath, 'utf8') : null;

  let mode;
  let merged;
  let salvaged = [];
  if (oldContent === null) {
    mode = 'created';
    merged = newSchema;
  } else {
    const spliced = spliceFencedSchema(oldContent, newSchema);
    if (spliced !== null) {
      mode = 'fenced';
      merged = spliced;
    } else {
      mode = 'legacy';
      salvaged = salvageUserSections(oldContent, newSchema);
      merged = salvaged.length > 0
        ? `${newSchema}\n${salvaged.map((s) => s.text).join('\n\n')}\n`
        : newSchema;
    }
  }

  // Alias plan: symlinks flow automatically; byte-identical copies are
  // refreshed; anything else was user-customized and is left alone (reported).
  const aliases = [];
  for (const alias of ALIAS_FILES) {
    const aliasPath = join(root, alias);
    if (aliasPath === sourcePath) continue; // legacy CLAUDE.md source handled below
    if (!existsSync(aliasPath) && !isSymlink(aliasPath)) continue;
    if (isSymlink(aliasPath)) {
      aliases.push({ file: alias, action: 'symlink-untouched' });
    } else if (oldContent !== null && readFileSync(aliasPath, 'utf8') === oldContent) {
      aliases.push({ file: alias, action: 'copy-refreshed' });
    } else {
      aliases.push({ file: alias, action: 'diverged-left-alone' });
    }
  }
  if (legacyClaudeIsSource) aliases.push({ file: 'CLAUDE.md', action: 'converted-to-alias' });

  const doctrine = generateDoctrine({ wikiName });
  const schemaVersion = installedVersion();

  const result = {
    root,
    wikiName,
    mode,
    domain,
    previousDomain,
    domainChanged: domainOverride !== null && domainOverride !== previousDomain,
    salvaged: salvaged.map((s) => s.heading),
    backup: oldContent !== null ? BACKUP_REL : null,
    doctrine: Object.keys(doctrine).map((f) => join(DOCTRINE_DIR, f)),
    aliases,
    schemaVersion,
    registrySynced: false,
    dryRun,
  };

  if (dryRun) return result;

  // 1. Backup, then write the merged canonical schema.
  if (oldContent !== null) {
    const backupPath = join(root, BACKUP_REL);
    mkdirSync(join(backupPath, '..'), { recursive: true });
    writeFileSync(backupPath, oldContent, 'utf8');
  }
  writeFileSync(canonicalPath, merged, 'utf8');

  // 2. Legacy CLAUDE.md source becomes an alias of the new canonical file.
  if (legacyClaudeIsSource) {
    const claudePath = join(root, 'CLAUDE.md');
    unlinkSync(claudePath);
    try {
      symlinkSync(CANONICAL_SCHEMA_FILE, claudePath, 'file');
    } catch {
      writeFileSync(claudePath, merged, 'utf8'); // platforms without symlink permission
    }
  }

  // 3. Refresh copy-mode aliases (symlinks already point at the new content).
  for (const a of aliases) {
    if (a.action === 'copy-refreshed') writeFileSync(join(root, a.file), merged, 'utf8');
  }

  // 4. Doctrine is generator-owned wholesale: rewrite both files.
  for (const [name, content] of Object.entries(doctrine)) {
    const target = join(root, DOCTRINE_DIR, name);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }

  // 5. Stamp the manifest (and the new domain, when re-domaining).
  manifest.schema_version = schemaVersion;
  if (result.domainChanged) manifest.domain = domain;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // 6. Keep the registry's domain in sync when it changed.
  if (result.domainChanged) {
    const registry = loadRegistry(home);
    const entry = Object.entries(registry.wikis)
      .find(([, w]) => resolve(w.path) === resolve(root));
    if (entry) {
      registry.wikis[entry[0]] = { ...entry[1], domain };
      saveRegistry(registry, home);
      result.registrySynced = true;
    }
  }

  return result;
}

function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
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
    if (a === '--wiki' || a === '--domain') { i++; continue; } // skip value-taking flags
    if (a.startsWith('--')) continue;
    return a;
  }
  return undefined;
}

// Target resolution, most-specific first: explicit path > --wiki <slug> >
// the cwd when it is itself a wiki > the registered default. A mutating
// command run bare inside a wiki must obviously target THAT wiki, which is
// why cwd outranks the registered default here (status, being read-only,
// resolves default-first).
export function resolveUpgradeRoot(args, { cwd = process.cwd(), home } = {}) {
  const slug = argValue(args, '--wiki');
  const explicit = firstPositional(args);
  if (slug && explicit) {
    throw new Error(`Pass either a path ("${explicit}") or --wiki ${slug}, not both.`);
  }
  if (explicit) return { root: resolve(explicit), slug: null };
  if (!slug && existsSync(join(cwd, '.tng-wiki.json'))) return { root: cwd, slug: null };
  const wiki = resolveWiki(slug, home);
  return { root: wiki.path, slug: wiki.slug };
}

export async function runUpgrade(args) {
  const { root, slug } = resolveUpgradeRoot(args);
  const result = upgradeWiki(root, {
    domain: argValue(args, '--domain'),
    dryRun: args.includes('--dry-run'),
  });

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({ wiki: slug, ...result }, null, 2) + '\n');
    return;
  }

  const verb = result.dryRun ? 'would write' : 'wrote';
  console.log('');
  console.log(`  ${pc.bold('Schema upgrade')}  ${pc.dim(slug ? `${slug} · ${root}` : root)}${result.dryRun ? pc.yellow('  (dry run)') : ''}`);
  console.log('');
  const modeLabel = {
    fenced: 'managed block replaced; content outside the markers untouched',
    legacy: 'pre-fence schema rebuilt; unknown sections carried over',
    created: 'no schema found; fenced schema written fresh',
  }[result.mode];
  console.log(`  ${pc.cyan('Mode:')}     ${result.mode} ${pc.dim(`(${modeLabel})`)}`);
  console.log(`  ${pc.cyan('Schema:')}   ${verb} ${CANONICAL_SCHEMA_FILE} ${pc.dim(`(generator v${result.schemaVersion}, domain ${result.domain})`)}`);
  if (result.domainChanged) {
    console.log(`  ${pc.cyan('Domain:')}   ${result.previousDomain ?? '(none)'} → ${result.domain}${result.registrySynced ? pc.dim(' (registry synced)') : ''}`);
  }
  if (result.salvaged.length > 0) {
    console.log(`  ${pc.cyan('Kept:')}     ${result.salvaged.length} hand-authored section(s) moved below the managed block:`);
    for (const h of result.salvaged) console.log(`             ${pc.dim('##')} ${h}`);
  }
  console.log(`  ${pc.cyan('Doctrine:')} ${verb} ${result.doctrine.join(', ')}`);
  for (const a of result.aliases) {
    const note = {
      'symlink-untouched': 'symlink, follows the canonical file',
      'copy-refreshed': result.dryRun ? 'copy alias, would refresh' : 'copy alias, refreshed',
      'diverged-left-alone': 'differs from the old schema - left alone, review manually',
      'converted-to-alias': 'was the schema itself (pre-AGENTS.md wiki) - now an alias',
    }[a.action];
    console.log(`  ${pc.cyan('Alias:')}    ${a.file} ${pc.dim(`(${note})`)}`);
  }
  if (result.backup) {
    console.log(`  ${pc.cyan('Backup:')}   ${result.dryRun ? 'would save' : 'saved'} previous schema to ${result.backup}`);
  }
  console.log('');
  if (result.mode === 'legacy') {
    console.log(`  ${pc.yellow('!')} Legacy merge is heading-based: edits made INSIDE generated sections are not carried over.`);
    console.log(`    Review with ${pc.cyan('git diff ' + CANONICAL_SCHEMA_FILE)} (or against ${result.backup ?? 'the backup'}) before committing.`);
  } else if (!result.dryRun) {
    console.log(`  ${pc.dim('Review with')} ${pc.cyan('git diff')} ${pc.dim('and commit the refreshed schema.')}`);
  }
  console.log('');
}
