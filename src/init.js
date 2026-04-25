import * as p from '@clack/prompts';
import pc from 'picocolors';
import { resolve, join } from 'path';
import { mkdirSync, existsSync, writeFileSync, readdirSync, symlinkSync } from 'fs';
import { generateAgentsMd, schemaLayout, CANONICAL_SCHEMA_FILE } from './agents/index.js';
import { getTemplate } from './templates/index.js';
import { setupGit } from './integrations/git.js';
import { setupQmd } from './integrations/qmd.js';
import { detectObsidian } from './integrations/obsidian.js';
import { loadRegistry, saveRegistry, registerWiki } from './registry.js';

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

export function scaffoldWiki(root, { domain, agent, wikiName, codeAuthorities = [] }) {
  const template = getTemplate(domain);

  for (const dir of [...BASE_DIRS, ...template.extraDirs]) {
    mkdirSync(join(root, dir), { recursive: true });
  }

  const schemaContent = generateAgentsMd({ domain, wikiName, template });
  const { canonical, aliases } = schemaLayout(agent);

  writeFileSync(join(root, canonical), schemaContent, 'utf8');
  const aliasResults = aliases.map(a => writeSchemaAlias(root, a, canonical, schemaContent));

  writeFileSync(join(root, 'wiki', 'index.md'), template.indexMd(wikiName), 'utf8');
  writeFileSync(join(root, 'wiki', 'log.md'), template.logMd(wikiName, domain), 'utf8');

  for (const [relPath, content] of Object.entries(template.extraFiles)) {
    const fullPath = join(root, relPath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }

  if (template.seedSource) {
    const seedPath = join(root, 'raw', template.seedSource.path);
    mkdirSync(join(seedPath, '..'), { recursive: true });
    writeFileSync(seedPath, template.seedSource.content, 'utf8');
  }

  writeFileSync(join(root, '.gitignore'), GITIGNORE, 'utf8');

  writeFileSync(
    join(root, '.tng-wiki.json'),
    JSON.stringify({
      version: 1,
      name: wikiName,
      domain,
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
    'utf8',
  );

  return { template, canonical, aliases: aliasResults };
}

export async function runInit(args) {
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
      const resolved = resolve(val || defaultPath);
      if (existsSync(resolved)) {
        try {
          if (readdirSync(resolved).length > 0) {
            return 'Directory exists and is not empty. Choose a different path.';
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
  const root = resolve(targetDir || defaultPath);
  const codeAuthorities = supportsCodeAuthorities(domain)
    ? await promptCodeAuthorities(root)
    : [];

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
  try {
    const reg = registerWiki(loadRegistry(), { name: wikiName, path: root, domain });
    saveRegistry(reg);
    registryStatus = { success: true, isDefault: reg.default && reg.wikis[reg.default].path === root };
  } catch (err) {
    registryStatus = { success: false, error: err.message };
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

    // Resolve to absolute for an existence check, but keep the user-entered string
    // so the persisted config preserves the relative path intent.
    const resolved = resolve(wikiRoot, path);
    const pathExists = existsSync(resolved);
    if (!pathExists) {
      p.log.warn(`Path not found yet: ${pc.dim(resolved)} — saving anyway (you may be scaffolding before cloning the source).`);
    }

    const defaultName = path.split(/[\\/]/).filter(Boolean).pop() || 'code';
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
      path,
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

const GITIGNORE = `# OS
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
