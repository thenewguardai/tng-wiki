import * as p from '@clack/prompts';
import pc from 'picocolors';
import { resolve, join, isAbsolute } from 'path';
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, symlinkSync } from 'fs';
import { generateAgentsMd, schemaLayout, CANONICAL_SCHEMA_FILE } from './agents/index.js';
import { getTemplate } from './templates/index.js';
import { setupGit } from './integrations/git.js';
import { setupQmd } from './integrations/qmd.js';
import { detectObsidian } from './integrations/obsidian.js';
import { loadRegistry, saveRegistry, registerWiki, registryConflict, slugifyName } from './registry.js';
import { resolveConfigPath, pathForm, suggestRelative } from './paths.js';

const DOMAINS = [
  { value: 'ai-research',           label: 'AI / Tech Research',            hint: 'tracking the landscape, models, protocols, infrastructure' },
  { value: 'competitive-intel',     label: 'Competitive Intelligence',      hint: 'companies, products, market moves, SWOT' },
  { value: 'publication',           label: 'Publication / Newsletter',      hint: 'research → content pipeline with issue prep' },
  { value: 'business-ops',          label: 'Business Operations',           hint: 'meetings, decisions, strategy, team knowledge' },
  { value: 'learning',              label: 'Learning / Deep Study',         hint: 'books, courses, papers, building expertise' },
  { value: 'software-engineering',  label: 'Software Engineering & Architecture', hint: 'ADRs, components, systems, patterns, incidents, runbooks, tech debt' },
  { value: 'blank',                 label: 'Blank',                         hint: 'just the structure, I\'ll customize' },
];

const AGENTS = [
  { value: 'claude-code', label: 'Claude Code',       hint: 'AGENTS.md + CLAUDE.md alias' },
  { value: 'codex',       label: 'OpenAI Codex',      hint: 'AGENTS.md (read natively)' },
  { value: 'cursor',      label: 'Cursor',            hint: 'AGENTS.md + .cursorrules alias' },
  { value: 'all',         label: 'Multiple / Other',  hint: 'AGENTS.md + CLAUDE.md + .cursorrules' },
];

const BASE_DIRS = [
  'raw/announcements', 'raw/papers', 'raw/social', 'raw/transcripts', 'raw/assets',
  'wiki/entities', 'wiki/meta',
  'output/briefings', 'output/research',
];

export function writeSchemaAlias(root, aliasName, canonical = CANONICAL_SCHEMA_FILE, content) {
  const aliasPath = join(root, aliasName);
  if (existsSync(aliasPath)) return { alias: aliasName, kind: 'skipped' };
  try {
    symlinkSync(canonical, aliasPath, 'file');
    return { alias: aliasName, kind: 'symlink' };
  } catch {
    writeFileSync(aliasPath, content, 'utf8');
    return { alias: aliasName, kind: 'copy' };
  }
}

export function scaffoldWiki(root, { domain, agent, wikiName, codeAuthorities = [], intoExisting = false }) {
  const template = getTemplate(domain);
  const skipped = [];

  // In --into-existing (adopt) mode we never clobber a file the user already has;
  // we record what we left alone so the caller can report it. Default mode writes
  // unconditionally, exactly as before.
  const putFile = (rel, content) => {
    const full = join(root, rel);
    if (intoExisting && existsSync(full)) { skipped.push(rel); return false; }
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
    return true;
  };

  for (const dir of [...BASE_DIRS, ...template.extraDirs]) {
    mkdirSync(join(root, dir), { recursive: true });
  }

  const schemaContent = generateAgentsMd({ domain, wikiName, template });
  const { canonical, aliases } = schemaLayout(agent);

  putFile(canonical, schemaContent);
  const aliasResults = aliases.map(a => writeSchemaAlias(root, a, canonical, schemaContent));

  putFile(join('wiki', 'index.md'), template.indexMd(wikiName));
  putFile(join('wiki', 'log.md'), template.logMd(wikiName, domain));

  for (const [relPath, content] of Object.entries(template.extraFiles)) {
    putFile(relPath, content);
  }

  if (template.seedSource) {
    putFile(join('raw', template.seedSource.path), template.seedSource.content);
  }

  writeGitignoreFile(root, intoExisting, skipped);

  putFile(
    '.tng-wiki.json',
    JSON.stringify({
      version: 1,
      name: wikiName,
      domain,
      // One-line summary of what this wiki covers. Surfaced by `tng-wiki connect`
      // into other repos' agent files. Empty by default — fill it in.
      description: '',
      created: new Date().toISOString(),
      // Web domains whose trust chain is authorized for Layer 3A authority validation.
      // Empty by default — agents can only fetch URLs already cited in raw sources
      // until you add entries here. Example: ["docs.python.org", "spec.commonmark.org"]
      trusted_authorities: [],
      // Local code trees treated as authoritative ground truth for Layer 3B.
      // Useful when the wiki is reverse-engineering a codebase: raw/ holds the
      // fallible AI-generated docs, code_authorities names the implementation
      // you're treating as truth. Each entry: { name, path, description?, exclude?, language?, ref? }.
      // `ref` (optional) pins reads to a git ref (branch / tag / commit SHA)
      // so the working-tree state of the source repo doesn't contaminate grounding.
      // Example:
      //   [{
      //     "name": "legacy-app",
      //     "path": "../customer-portal-v1",
      //     "description": "Source implementation being ported.",
      //     "exclude": ["**/*.md", "docs/**", "**/*.test.*", "**/node_modules/**"],
      //     "language": "typescript",
      //     "ref": "v2.1.0"
      //   }]
      code_authorities: codeAuthorities,
    }, null, 2) + '\n',
  );

  return { template, canonical, aliases: aliasResults, skipped };
}

// Write the generated .gitignore, or — in adopt mode against an existing one —
// append only the lines it's missing rather than clobbering the user's file.
function writeGitignoreFile(root, intoExisting, skipped) {
  const full = join(root, '.gitignore');
  if (intoExisting && existsSync(full)) {
    const existing = readFileSync(full, 'utf8');
    const have = new Set(existing.split('\n').map((l) => l.trim()).filter(Boolean));
    const additions = GITIGNORE.split('\n').filter((l) => l.trim() && !have.has(l.trim()));
    if (additions.length === 0) { skipped.push('.gitignore'); return; }
    const base = existing.endsWith('\n') ? existing : existing + '\n';
    writeFileSync(full, base + '\n# Added by tng-wiki\n' + additions.join('\n') + '\n', 'utf8');
    return;
  }
  writeFileSync(full, GITIGNORE, 'utf8');
}

export async function runInit(args) {
  const opts = parseInitArgs(args);
  if (opts.help) {
    const { renderCommandHelp } = await import('./help.js');
    renderCommandHelp('init');
    return;
  }
  if (opts.unknown.length) {
    console.error(pc.red('Error:'), `unknown init flag(s): ${opts.unknown.join(', ')}`);
    console.log(`Run ${pc.cyan('tng-wiki init --help')} for usage.`);
    process.exit(1);
  }
  if (opts.yes) return runInitNonInteractive(opts);
  if (!process.stdout.isTTY) {
    console.error(pc.red('Error:'), 'init is interactive and needs a TTY.');
    console.log(`For non-interactive / agent use, pass ${pc.cyan('--yes')} with flags, e.g.:`);
    console.log(`  ${pc.cyan('tng-wiki init --yes --dir ./my-wiki --domain blank --agent claude-code')}`);
    console.log(`Run ${pc.cyan('tng-wiki init --help')} for all options.`);
    process.exit(1);
  }
  return runInitWizard(opts);
}

export function parseInitArgs(args) {
  const opts = { help: false, yes: false, intoExisting: false, force: false, git: false, qmd: false, integrationsSet: false, codeAuthorities: [], unknown: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const value = () => (args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : '');
    switch (a) {
      case '-h': case '--help': opts.help = true; break;
      case '-y': case '--yes': opts.yes = true; break;
      case '--into-existing': case '--adopt': opts.intoExisting = true; break;
      case '--force': opts.force = true; break;
      case '--git': opts.git = true; opts.integrationsSet = true; break;
      case '--no-git': opts.git = false; opts.integrationsSet = true; break;
      case '--qmd': opts.qmd = true; opts.integrationsSet = true; break;
      case '--no-qmd': opts.qmd = false; opts.integrationsSet = true; break;
      case '--no-integrations': opts.git = false; opts.qmd = false; opts.integrationsSet = true; break;
      case '--domain': opts.domain = value().trim(); break;
      case '--agent': opts.agent = value().trim(); break;
      case '--dir': opts.dir = value().trim(); break;
      case '--name': opts.name = value(); break;
      case '--code-authority': opts.codeAuthorities.push(value().trim()); break;
      default: opts.unknown.push(a);
    }
  }
  return opts;
}


const VALID_DOMAINS = new Set(DOMAINS.map((d) => d.value));
const VALID_AGENTS = new Set(AGENTS.map((a) => a.value));

async function runInitNonInteractive(opts) {
  const fail = (msg) => { console.error(pc.red('Error:'), msg); process.exit(1); };

  if (!opts.dir) fail('--yes requires --dir <path> (where to create the wiki).');
  const domain = opts.domain || 'blank';
  const agent = opts.agent || 'claude-code';
  if (!VALID_DOMAINS.has(domain)) fail(`unknown --domain "${domain}". One of: ${[...VALID_DOMAINS].join(', ')}`);
  if (!VALID_AGENTS.has(agent)) fail(`unknown --agent "${agent}". One of: ${[...VALID_AGENTS].join(', ')}`);
  const wikiName = (opts.name ?? '').trim() || domainToName(domain);

  const root = resolve(opts.dir);
  if (existsSync(root)) {
    let nonEmpty = false;
    try { nonEmpty = readdirSync(root).length > 0; } catch { /* unreadable — treat as empty */ }
    if (nonEmpty && !opts.intoExisting) {
      fail(`directory exists and is not empty: ${root}\n  Pass --into-existing to adopt tng-wiki into it (existing files are preserved).`);
    }
  }

  // Registry collision guard (issue #8): refuse to silently flip an existing slug.
  const reg = loadRegistry();
  const conflictPath = registryConflict(reg, { name: wikiName, path: root });
  if (conflictPath && !opts.force) {
    fail(`registry slug "${slugifyName(wikiName)}" already points at ${conflictPath}.\n  Re-run with --force to replace it, or choose a different --name.`);
  }

  // Code authorities from repeatable --code-authority flags. Headless is
  // warning-only (issue #16): an absolute path is saved verbatim, but we say so
  // on stderr because the config stops travelling across machines.
  const codeAuthorities = buildHeadlessAuthorities(opts.codeAuthorities);
  for (const warning of authorityPortabilityWarnings(codeAuthorities)) {
    console.error(pc.yellow('Warning:'), warning);
  }

  const { canonical, skipped } = scaffoldWiki(root, { domain, agent, wikiName, codeAuthorities, intoExisting: opts.intoExisting });

  if (opts.git) await setupGit(root);
  if (opts.qmd) await setupQmd(root, wikiName);

  if (conflictPath) console.log(pc.yellow(`Replacing registry entry "${slugifyName(wikiName)}": ${conflictPath} → ${root}`));
  let registered = false;
  try { saveRegistry(registerWiki(reg, { name: wikiName, path: root, domain })); registered = true; }
  catch (err) { console.log(pc.yellow(`○ Could not register: ${trimError(err.message)}`)); }

  console.log(`${pc.green('✓')} Scaffolded ${pc.cyan(domainLabel(domain))} wiki at ${pc.cyan(root)} ${pc.dim(`(${canonical})`)}`);
  if (skipped.length) console.log(`  ${pc.dim(`left ${skipped.length} existing file(s) untouched: ${skipped.join(', ')}`)}`);
  if (registered) console.log(`${pc.green('✓')} Registered as ${pc.bold(slugifyName(wikiName))}`);
}

async function runInitWizard(opts) {
  p.intro(pc.bgCyan(pc.black(' tng-wiki init ')));

  // --- Domain selection ---
  const domain = await p.select({
    message: 'What are you building a knowledge base for?',
    options: DOMAINS,
  });
  if (p.isCancel(domain)) throw new Error('CANCELLED');

  // --- Agent selection ---
  const agent = await p.select({
    message: 'Which agent will maintain your wiki?',
    options: AGENTS,
  });
  if (p.isCancel(agent)) throw new Error('CANCELLED');

  // --- Location ---
  const obsidianLocation = detectObsidian();
  const defaultPath = obsidianLocation
    ? join(obsidianLocation, `${domain}-wiki`)
    : `./${domain}-wiki`;

  const targetDir = await p.text({
    message: 'Where should we create the wiki?',
    placeholder: defaultPath,
    defaultValue: defaultPath,
    validate: (val) => {
      const cleaned = (val ?? '').trim() || defaultPath;
      const resolved = resolve(cleaned);
      if (existsSync(resolved)) {
        try {
          if (readdirSync(resolved).length > 0) {
            return 'Directory exists and is not empty. Choose a different path (or re-run with --into-existing to adopt).';
          }
        } catch { /* ok */ }
      }
    },
  });
  if (p.isCancel(targetDir)) throw new Error('CANCELLED');

  // --- Wiki name ---
  const wikiName = await p.text({
    message: 'Give your wiki a name',
    placeholder: domainToName(domain),
    defaultValue: domainToName(domain),
  });
  if (p.isCancel(wikiName)) throw new Error('CANCELLED');

  // --- Optional integrations ---
  const extras = await p.multiselect({
    message: 'Set up integrations?',
    options: [
      { value: 'git',  label: 'Git — version history for your wiki',          hint: 'recommended' },
      { value: 'qmd',  label: 'QMD — hybrid search (BM25 + vector + rerank)', hint: 'recommended for 50+ sources' },
    ],
    required: false,
  });
  if (p.isCancel(extras)) throw new Error('CANCELLED');

  const useGit = extras.includes('git');
  const useQmd = extras.includes('qmd');

  // --- Code authorities (Layer 3B): only offered on engineering-shaped domains ---
  const root = resolve((targetDir ?? '').trim() || defaultPath);
  const codeAuthorities = supportsCodeAuthorities(domain)
    ? await promptCodeAuthorities(root)
    : [];

  // --- Registry collision guard (issue #8): decide before scaffolding ---
  const existingRegistry = loadRegistry();
  const conflictPath = registryConflict(existingRegistry, { name: wikiName, path: root });
  let replaceRegistry = true;
  if (conflictPath) {
    const ok = await p.confirm({
      message: `Registry slug "${slugifyName(wikiName)}" already points at ${conflictPath}. Replace it with this wiki?`,
      initialValue: false,
    });
    if (p.isCancel(ok)) throw new Error('CANCELLED');
    replaceRegistry = ok;
  }

  // --- Execute ---
  const s = p.spinner();

  s.start('Scaffolding wiki...');

  const { template, canonical, aliases } = scaffoldWiki(root, { domain, agent, wikiName, codeAuthorities });

  s.message('Setting up integrations...');

  // Git
  let gitStatus = null;
  if (useGit) {
    gitStatus = await setupGit(root);
  }

  // QMD
  let qmdStatus = null;
  if (useQmd) {
    qmdStatus = await setupQmd(root, wikiName);
  }

  // Registry
  let registryStatus = null;
  if (replaceRegistry) {
    try {
      const reg = registerWiki(existingRegistry, { name: wikiName, path: root, domain });
      saveRegistry(reg);
      registryStatus = { success: true, isDefault: reg.default && reg.wikis[reg.default].path === root };
    } catch (err) {
      registryStatus = { success: false, error: err.message };
    }
  } else {
    registryStatus = { success: false, error: `kept existing entry "${slugifyName(wikiName)}" (${conflictPath})` };
  }

  s.stop(pc.green('✓ Wiki scaffolded'));

  // --- Summary ---
  const results = [
    `${pc.green('✓')} Directory structure created`,
    `${pc.green('✓')} ${canonical} generated ${pc.dim(`(${domainLabel(domain)} template)`)}`,
  ];
  for (const { alias, kind } of aliases) {
    const tag = kind === 'symlink' ? 'symlink → ' + canonical
      : kind === 'copy' ? 'copy of ' + canonical + ' (symlink unavailable)'
      : 'already existed, left alone';
    results.push(`${pc.green('✓')} ${alias} ${pc.dim(`(${tag})`)}`);
  }
  results.push(`${pc.green('✓')} wiki/index.md initialized`);
  results.push(`${pc.green('✓')} wiki/log.md initialized`);

  if (template.extraFiles && Object.keys(template.extraFiles).length > 0) {
    results.push(`${pc.green('✓')} ${Object.keys(template.extraFiles).length} template files installed`);
  }

  if (template.seedSource) {
    results.push(`${pc.green('✓')} Seed source added to raw/ ${pc.dim('— your first ingest')}`);
  }

  if (codeAuthorities.length > 0) {
    const names = codeAuthorities.map((a) => a.name).join(', ');
    const noun = codeAuthorities.length === 1 ? 'code authority' : 'code authorities';
    results.push(`${pc.green('✓')} ${codeAuthorities.length} ${noun} configured ${pc.dim(`(${names})`)}`);
  }

  if (useGit) {
    if (gitStatus?.success) {
      results.push(`${pc.green('✓')} Git initialized with first commit`);
    } else {
      results.push(`${pc.red('✗')} Git setup failed`);
      if (gitStatus?.error) {
        results.push(`  ${pc.dim(trimError(gitStatus.error))}`);
      }
    }
  }

  if (useQmd) {
    if (qmdStatus?.configured) {
      results.push(`${pc.green('✓')} QMD collection registered`);
    } else if (qmdStatus?.installed) {
      results.push(`${pc.yellow('○')} QMD detected, but collection setup failed`);
      if (qmdStatus?.error) {
        results.push(`  ${pc.dim(trimError(qmdStatus.error))}`);
      }
    } else {
      results.push(`${pc.yellow('○')} QMD not found — install with: ${pc.cyan('npm i -g @tobilu/qmd')}`);
      results.push(`  ${pc.dim('Then run:')} ${pc.cyan(`qmd collection add ${join(root, 'wiki')} --name ${slugify(wikiName)}`)}`);
    }
  }

  if (registryStatus?.success) {
    const defaultTag = registryStatus.isDefault ? pc.dim(' (default)') : '';
    results.push(`${pc.green('✓')} Added to tng-wiki registry${defaultTag}`);
  } else if (registryStatus?.error) {
    results.push(`${pc.yellow('○')} Could not register wiki: ${pc.dim(trimError(registryStatus.error))}`);
  }

  console.log('');
  for (const line of results) {
    console.log(`  ${line}`);
  }

  console.log('');
  console.log(pc.bold('  Next steps:'));
  console.log('');
  console.log(`  ${pc.dim('1.')} Open ${pc.cyan(root)} in Obsidian`);
  console.log(`  ${pc.dim('2.')} Drop your first sources into ${pc.cyan('raw/')}`);

  if (agent === 'claude-code' || agent === 'all') {
    console.log(`  ${pc.dim('3.')} Run: ${pc.cyan(`cd ${root} && claude "Read AGENTS.md, then ingest the sources in raw/"`)}`);
  } else if (agent === 'codex') {
    console.log(`  ${pc.dim('3.')} Run: ${pc.cyan(`cd ${root} && codex "Read AGENTS.md, then ingest the sources in raw/"`)}`);
  } else {
    console.log(`  ${pc.dim('3.')} Point your agent at this directory and tell it to read AGENTS.md`);
  }
  console.log(`  ${pc.dim('4.')} Make other repos aware: ${pc.cyan(`tng-wiki connect <repo> --wiki ${slugify(wikiName)}`)}`);
  console.log(`  ${pc.dim('5.')} Teach every agent session the verbs: ${pc.cyan('tng-wiki install-skill')}`);

  console.log('');
  console.log(`  ${pc.bold('Guide:')} ${pc.underline('https://thenewguard.ai/features/llm-wiki-guide')}`);
  console.log('');

  p.outro(pc.green('Your wiki is ready. Go build something.'));
}

// --- Helpers ---

function domainToName(domain) {
  const names = {
    'ai-research': 'AI Research Wiki',
    'competitive-intel': 'Competitive Intelligence Wiki',
    'publication': 'Publication Research Wiki',
    'business-ops': 'Business Operations Wiki',
    'learning': 'Learning Wiki',
    'blank': 'My Wiki',
  };
  return names[domain] || 'My Wiki';
}

function domainLabel(domain) {
  return DOMAINS.find(d => d.value === domain)?.label || domain;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function trimError(err) {
  return err.toString().trim().split('\n').filter(Boolean)[0];
}

// --- Code authorities (Layer 3B) ---

// Domains where Layer 3B (codebase as advisory ground truth) is a meaningful pattern.
// AI-research / publication / business-ops / etc. distill from documents, not code.
function supportsCodeAuthorities(domain) {
  return domain === 'software-engineering' || domain === 'blank';
}

const LANGUAGE_OPTIONS = [
  { value: 'typescript', label: 'TypeScript / JavaScript' },
  { value: 'python',     label: 'Python' },
  { value: 'go',         label: 'Go' },
  { value: 'rust',       label: 'Rust' },
  { value: 'other',      label: 'Other / mixed (skip language hint)' },
];

// Per-language exclude defaults — keep tight, targeting build artifacts, deps,
// and tests. Markdown/RST are always excluded since they're documentation, not
// implementation truth.
const EXCLUDE_DEFAULTS = {
  typescript: ['**/*.md', '**/*.test.*', '**/*.spec.*', '**/node_modules/**', '**/dist/**', '**/build/**'],
  python:     ['**/*.md', '**/*.rst', '**/test_*.py', '**/*_test.py', '**/__pycache__/**', '**/.venv/**', '**/venv/**', '**/dist/**'],
  go:         ['**/*.md', '**/*_test.go', '**/vendor/**'],
  rust:       ['**/*.md', '**/target/**'],
  other:      ['**/*.md', '**/*.rst', '**/node_modules/**', '**/dist/**'],
};

// Build code_authorities entries from repeatable `--code-authority <path>` flags
// (headless --yes path). Name derives from the last path segment, mirroring the
// interactive prompt's default; excludes fall back to the language-agnostic set.
export function buildHeadlessAuthorities(paths = []) {
  return paths
    .filter((s) => s && s.trim())
    .map((s) => {
      const path = s.trim();
      return {
        name: path.split(/[\\/]/).filter(Boolean).pop() || 'code',
        path,
        exclude: EXCLUDE_DEFAULTS.other,
      };
    });
}

// One warning line per non-portable (absolute) authority path. Pure so both the
// headless path and tests can use it; `~` and relative forms are portable.
export function authorityPortabilityWarnings(authorities) {
  return authorities
    .filter((a) => pathForm(a.path) === 'absolute')
    .map((a) => `code authority "${a.name}" uses an absolute path (${a.path}) — it won't resolve on other machines. Prefer a path relative to the wiki.`);
}

export async function promptCodeAuthorities(wikiRoot) {
  const wants = await p.confirm({
    message: 'Have a reference codebase to ground against? (e.g. porting, reverse-engineering, M&A integration)',
    initialValue: false,
  });
  if (p.isCancel(wants)) throw new Error('CANCELLED');
  if (!wants) return [];

  const authorities = [];
  let addAnother = true;

  while (addAnother) {
    const path = await p.text({
      message: `Path to the codebase (relative to wiki, or absolute):`,
      placeholder: '../legacy-app',
      validate: (val) => {
        if (!val || !val.trim()) return 'Path is required.';
      },
    });
    if (p.isCancel(path)) throw new Error('CANCELLED');

    let entryPath = path.trim();

    // Absolute-path nudge (issue #16): relative paths travel across machines.
    // When the entered path stays within reach of the wiki (≤ 4 leading `..`
    // segments), offer to store the relative form; otherwise — or on decline —
    // save verbatim with a one-line portability warning.
    if (isAbsolute(entryPath)) {
      const suggestion = suggestRelative(wikiRoot, entryPath);
      let storeRelative = false;
      if (suggestion) {
        const useRelative = await p.confirm({
          message: `Store as relative (${pc.cyan(suggestion)}) so the config travels across machines?`,
          initialValue: true,
        });
        if (p.isCancel(useRelative)) throw new Error('CANCELLED');
        storeRelative = useRelative;
      }
      if (storeRelative) {
        entryPath = suggestion;
      } else {
        p.log.warn(`Absolute path saved verbatim — this code authority won't resolve on other machines.`);
      }
    }

    // Resolve to absolute for an existence check (expanding a leading `~`), but
    // persist the user-facing string so the config preserves the path intent.
    const resolved = resolveConfigPath(wikiRoot, entryPath);
    const pathExists = existsSync(resolved);
    if (!pathExists) {
      p.log.warn(`Path not found yet: ${pc.dim(resolved)} — saving anyway (you may be scaffolding before cloning the source).`);
    }

    const defaultName = entryPath.split(/[\\/]/).filter(Boolean).pop() || 'code';
    const name = await p.text({
      message: 'Short name (used in citations like [^code:<name>/...]):',
      placeholder: defaultName,
      defaultValue: defaultName,
      validate: (val) => {
        // Empty is fine — clack substitutes defaultValue when validation passes
        // on empty input. Validating a non-empty value blocks junk like spaces.
        if (val && !/^[a-z0-9][a-z0-9_-]*$/i.test(val)) {
          return 'Use letters, numbers, dashes, underscores only.';
        }
      },
    });
    if (p.isCancel(name)) throw new Error('CANCELLED');

    const description = await p.text({
      message: 'Description (optional, shown in .tng-wiki.json for future-you):',
      placeholder: 'Source implementation being ported',
      defaultValue: '',
    });
    if (p.isCancel(description)) throw new Error('CANCELLED');

    const language = await p.select({
      message: 'Primary language? (drives default exclude globs)',
      options: LANGUAGE_OPTIONS,
    });
    if (p.isCancel(language)) throw new Error('CANCELLED');

    const ref = await p.text({
      message: 'Pin to a git ref? (branch / tag / commit, blank for HEAD)',
      placeholder: 'v2.1.0',
      defaultValue: '',
    });
    if (p.isCancel(ref)) throw new Error('CANCELLED');

    const entry = {
      name: name.trim(),
      path: entryPath,
    };
    if (description && description.trim()) entry.description = description.trim();
    entry.exclude = EXCLUDE_DEFAULTS[language] ?? EXCLUDE_DEFAULTS.other;
    if (language && language !== 'other') entry.language = language;
    if (ref && ref.trim()) entry.ref = ref.trim();

    authorities.push(entry);

    addAnother = await p.confirm({
      message: 'Add another code authority?',
      initialValue: false,
    });
    if (p.isCancel(addAnother)) throw new Error('CANCELLED');
  }

  return authorities;
}

const GITIGNORE = `# Dependencies
node_modules/

# Secrets — wikis accumulate raw scripts/captures where credentials hide
.env
*.env
.env.*
.secrets/
*.pem
*.key

# OS
.DS_Store
Thumbs.db

# Obsidian
.obsidian/workspace.json
.obsidian/workspace-mobile.json

# QMD cache (rebuild with qmd embed)
.qmd/

# Editor
*.swp
*.swo
*~
`;
