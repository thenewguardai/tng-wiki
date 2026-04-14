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
    case 'help':
    case '--help':
    case '-h': {
      console.log(BANNER);
      console.log(`
${pc.bold('Usage:')} tng-wiki <command>

${pc.bold('Commands:')}
  ${pc.cyan('init')}      Scaffold a new LLM wiki (interactive)
  ${pc.cyan('status')}    Show a basic wiki health snapshot
  ${pc.cyan('doctor')}    Check local environment — agent, QMD, Obsidian, git
  ${pc.cyan('help')}      Show this help message

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
