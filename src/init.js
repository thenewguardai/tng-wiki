import * as p from '@clack/prompts';
import pc from 'picocolors';
import { resolve, join } from 'path';
import { mkdirSync, existsSync, writeFileSync, readdirSync } from 'fs';
import { generateSchema } from './agents/index.js';
import { getTemplate } from './templates/index.js';
import { setupGit } from './integrations/git.js';
import { setupQmd } from './integrations/qmd.js';
import { detectObsidian } from './integrations/obsidian.js';

const DOMAINS = [
  { value: 'ai-research',       label: 'AI / Tech Research',       hint: 'tracking the landscape, models, protocols, infrastructure' },
  { value: 'competitive-intel',  label: 'Competitive Intelligence', hint: 'companies, products, market moves, SWOT' },
  { value: 'publication',        label: 'Publication / Newsletter', hint: 'research → content pipeline with issue prep' },
  { value: 'business-ops',       label: 'Business Operations',      hint: 'meetings, decisions, strategy, team knowledge' },
  { value: 'learning',           label: 'Learning / Deep Study',    hint: 'books, courses, papers, building expertise' },
  { value: 'blank',              label: 'Blank',                    hint: 'just the structure, I\'ll customize' },
];

const AGENTS = [
  { value: 'claude-code', label: 'Claude Code',       hint: 'generates CLAUDE.md' },
  { value: 'codex',       label: 'OpenAI Codex',      hint: 'generates AGENTS.md' },
  { value: 'cursor',      label: 'Cursor',            hint: 'generates .cursorrules' },
  { value: 'all',         label: 'Multiple / Other',  hint: 'generates all schema files' },
];

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

  // --- Execute ---
  const root = resolve(targetDir || defaultPath);
  const s = p.spinner();

  s.start('Scaffolding wiki...');

  // Create directory structure
  const dirs = [
    'raw/announcements', 'raw/papers', 'raw/social', 'raw/transcripts', 'raw/assets',
    'wiki/entities', 'wiki/meta',
    'output/briefings', 'output/research',
  ];

  // Add domain-specific directories
  const template = getTemplate(domain);
  const allDirs = [...dirs, ...template.extraDirs];

  for (const dir of allDirs) {
    mkdirSync(join(root, dir), { recursive: true });
  }

  s.message('Writing schema...');

  // Generate agent schema file(s)
  const schemas = generateSchema(agent, { domain, wikiName, template });
  for (const [filename, content] of Object.entries(schemas)) {
    writeFileSync(join(root, filename), content, 'utf8');
  }

  s.message('Writing wiki scaffold...');

  // Write index.md
  writeFileSync(join(root, 'wiki', 'index.md'), template.indexMd(wikiName), 'utf8');

  // Write log.md
  writeFileSync(join(root, 'wiki', 'log.md'), template.logMd(wikiName, domain), 'utf8');

  // Write domain-specific files (scoring criteria, page templates, etc.)
  for (const [relPath, content] of Object.entries(template.extraFiles)) {
    const fullPath = join(root, relPath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content, 'utf8');
  }

  // Write seed source
  if (template.seedSource) {
    const seedPath = join(root, 'raw', template.seedSource.path);
    mkdirSync(join(seedPath, '..'), { recursive: true });
    writeFileSync(seedPath, template.seedSource.content, 'utf8');
  }

  // Write .gitignore
  writeFileSync(join(root, '.gitignore'), GITIGNORE, 'utf8');

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

  s.stop(pc.green('✓ Wiki scaffolded'));

  // --- Summary ---
  const results = [
    `${pc.green('✓')} Directory structure created`,
    `${pc.green('✓')} ${schemaFileName(agent)} generated ${pc.dim(`(${domainLabel(domain)} template)`)}`,
    `${pc.green('✓')} wiki/index.md initialized`,
    `${pc.green('✓')} wiki/log.md initialized`,
  ];

  if (template.extraFiles && Object.keys(template.extraFiles).length > 0) {
    results.push(`${pc.green('✓')} ${Object.keys(template.extraFiles).length} template files installed`);
  }

  if (template.seedSource) {
    results.push(`${pc.green('✓')} Seed source added to raw/ ${pc.dim('— your first ingest')}`);
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
    console.log(`  ${pc.dim('3.')} Run: ${pc.cyan(`cd ${root} && claude "Read CLAUDE.md, then ingest the sources in raw/"`)}`);
  } else if (agent === 'codex') {
    console.log(`  ${pc.dim('3.')} Run: ${pc.cyan(`cd ${root} && codex "Read AGENTS.md, then ingest the sources in raw/"`)}`);
  } else {
    console.log(`  ${pc.dim('3.')} Point your agent at this directory and tell it to read the schema file`);
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

function schemaFileName(agent) {
  const names = {
    'claude-code': 'CLAUDE.md',
    'codex': 'AGENTS.md',
    'cursor': '.cursorrules',
    'all': 'CLAUDE.md + AGENTS.md + .cursorrules',
  };
  return names[agent] || 'schema';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function trimError(err) {
  return err.toString().trim().split('\n').filter(Boolean)[0];
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
