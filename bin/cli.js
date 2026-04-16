#!/usr/bin/env node

import { intro, outro, log } from '@clack/prompts';
import pc from 'picocolors';

const [,, command = 'init', ...args] = process.argv;

const BANNER = `
${pc.bold(pc.white('◆'))} ${pc.bold('The New Guard')} ${pc.dim('— LLM Wiki Scaffold')}
${pc.dim('  Intelligence that compounds. https://thenewguard.ai')}
`;

async function main() {
  switch (command) {
    case 'init': {
      console.log(BANNER);
      const { runInit } = await import('../src/init.js');
      await runInit(args);
      break;
    }
    case 'status': {
      console.log(BANNER);
      const { runStatus } = await import('../src/status.js');
      await runStatus(args);
      break;
    }
    case 'doctor': {
      console.log(BANNER);
      const { runDoctor } = await import('../src/doctor.js');
      await runDoctor(args);
      break;
    }
    case 'register': {
      const { runRegister } = await import('../src/registry-cli.js');
      await runRegister(args);
      break;
    }
    case 'unregister': {
      const { runUnregister } = await import('../src/registry-cli.js');
      await runUnregister(args);
      break;
    }
    case 'list': {
      const { runList } = await import('../src/registry-cli.js');
      await runList(args);
      break;
    }
    case 'set-default': {
      const { runSetDefault } = await import('../src/registry-cli.js');
      await runSetDefault(args);
      break;
    }
    case 'query': {
      const { runQuery } = await import('../src/verbs-cli.js');
      await runQuery(args);
      break;
    }
    case 'read': {
      const { runRead } = await import('../src/verbs-cli.js');
      await runRead(args);
      break;
    }
    case 'search': {
      const { runSearch } = await import('../src/verbs-cli.js');
      await runSearch(args);
      break;
    }
    case 'sources': {
      const { runSources } = await import('../src/verbs-cli.js');
      await runSources(args);
      break;
    }
    case 'stale': {
      const { runStale } = await import('../src/verbs-cli.js');
      await runStale(args);
      break;
    }
    case 'orphans': {
      const { runOrphans } = await import('../src/verbs-cli.js');
      await runOrphans(args);
      break;
    }
    case 'install-skill': {
      const { runInstallSkill } = await import('../src/skill-cli.js');
      await runInstallSkill(args);
      break;
    }
    case 'ground': {
      const { runGround } = await import('../src/verbs-cli.js');
      await runGround(args);
      break;
    }
    case 'drift': {
      const { runDrift } = await import('../src/verbs-cli.js');
      await runDrift(args);
      break;
    }
    case 'unsourced': {
      const { runUnsourced } = await import('../src/verbs-cli.js');
      await runUnsourced(args);
      break;
    }
    case 'unverified': {
      const { runUnverified } = await import('../src/verbs-cli.js');
      await runUnverified(args);
      break;
    }
    case 'help':
    case '--help':
    case '-h': {
      console.log(BANNER);
      console.log(`
${pc.bold('Usage:')} tng-wiki <command>

${pc.bold('Scaffolding:')}
  ${pc.cyan('init')}         Scaffold a new LLM wiki (interactive)

${pc.bold('Registry:')}
  ${pc.cyan('register')}     Register an existing wiki in the user registry
  ${pc.cyan('unregister')}   Remove a wiki from the registry (files untouched)
  ${pc.cyan('list')}         List registered wikis
  ${pc.cyan('set-default')}  Set the default wiki

${pc.bold('Wiki access (CLI verbs — stable, low-token, agent-friendly):')}
  ${pc.cyan('query')}        Print wiki/index.md for the default (or --wiki <slug>) wiki
  ${pc.cyan('read')}         Print a wiki page by path (relative to wiki/)
  ${pc.cyan('search')}       Case-insensitive search across wiki pages (--include-raw for deep search)
  ${pc.cyan('sources')}      List raw sources (--uncompiled for uncompiled only)

${pc.bold('Grounding & lint (the wiki health surface):')}
  ${pc.cyan('ground')}       Structural ground-check: attribution, dead cites, updated vs source mtime
  ${pc.cyan('drift')}        List pages with ⚠️ DRIFT? markers (semantic/external grounding output)
  ${pc.cyan('unsourced')}    List pages with ⚠️ UNSOURCED? markers
  ${pc.cyan('unverified')}   List pages with ⚠️ UNVERIFIED? markers
  ${pc.cyan('stale')}        List pages with ⚠️ STALE? markers
  ${pc.cyan('orphans')}      List wiki pages with no inbound wikilinks

${pc.bold('Agent integration:')}
  ${pc.cyan('install-skill')}  Install the Claude Code skill at ~/.claude/skills/tng-wiki

${pc.bold('Diagnostics:')}
  ${pc.cyan('status')}       Basic wiki health snapshot
  ${pc.cyan('doctor')}       Check local environment — agent, QMD, Obsidian, git
  ${pc.cyan('help')}         Show this help message

${pc.dim('Most verbs accept --wiki <slug> to target a specific registered wiki')}
${pc.dim('and --json to emit structured output (for MCP wrappers and scripts).')}

${pc.bold('Quick start:')}
  ${pc.dim('$')} npx tng-wiki init
  ${pc.dim('$')} cd my-wiki
  ${pc.dim('$')} claude "Read CLAUDE.md, then ingest the sources in raw/"

${pc.bold('Guide:')} ${pc.underline('https://thenewguard.ai/features/llm-wiki-guide')}
`);
      break;
    }
    case '--version':
    case '-v': {
      const { readFileSync } = await import('fs');
      const { fileURLToPath } = await import('url');
      const { dirname, join } = await import('path');
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
      console.log(pkg.version);
      break;
    }
    default: {
      console.log(BANNER);
      log.error(`Unknown command: ${command}`);
      console.log(`Run ${pc.cyan('tng-wiki help')} for available commands.`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  if (err.message === 'CANCELLED') {
    console.log('\n' + pc.dim('Cancelled.'));
    process.exit(0);
  }
  console.error(pc.red('Error:'), err.message);
  process.exit(1);
});
