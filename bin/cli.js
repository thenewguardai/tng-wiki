#!/usr/bin/env node

import { log } from '@clack/prompts';
import pc from 'picocolors';

const [,, command = 'init', ...args] = process.argv;

const BANNER = `
${pc.bold(pc.white('◆'))} ${pc.bold('The New Guard')} ${pc.dim('— LLM Wiki Scaffold')}
${pc.dim('  Intelligence that compounds. https://thenewguard.ai')}
`;

async function getVersion() {
  const { readFileSync } = await import('fs');
  const { fileURLToPath } = await import('url');
  const { dirname, join } = await import('path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;
}

async function main() {
  const { hasCommand, renderTopHelp, renderCommandHelp, manifest, commandJson } = await import('../src/help.js');
  const wantsJson = args.includes('--json');
  const wantsHelp = args.includes('--help') || args.includes('-h');

  if (command === '--version' || command === '-v') {
    console.log(await getVersion());
    return;
  }

  // `help` / `--help` / `-h`  (optionally a command name and/or --json)
  if (command === 'help' || command === '--help' || command === '-h') {
    const sub = args.find((a) => !a.startsWith('-'));
    if (wantsJson) {
      process.stdout.write(JSON.stringify(sub && hasCommand(sub) ? commandJson(sub) : manifest(await getVersion()), null, 2) + '\n');
    } else {
      console.log(BANNER);
      if (sub && hasCommand(sub)) renderCommandHelp(sub); else renderTopHelp();
    }
    return;
  }

  // per-command help: `tng-wiki <cmd> --help [--json]`
  if (hasCommand(command) && wantsHelp) {
    if (wantsJson) process.stdout.write(JSON.stringify(commandJson(command), null, 2) + '\n');
    else { console.log(BANNER); renderCommandHelp(command); }
    return;
  }

  switch (command) {
    case 'init': {
      console.log(BANNER);
      const { runInit } = await import('../src/init.js');
      await runInit(args);
      break;
    }
    case 'status': {
      if (!wantsJson) console.log(BANNER);
      const { runStatus } = await import('../src/status.js');
      await runStatus(args);
      break;
    }
    case 'doctor': {
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
    case 'rounds': {
      const { runRounds } = await import('../src/verbs-cli.js');
      await runRounds(args);
      break;
    }
    case 'connect': {
      const { runConnect } = await import('../src/connect.js');
      await runConnect(args);
      break;
    }
    case 'upgrade': {
      const { runUpgrade } = await import('../src/upgrade.js');
      await runUpgrade(args);
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
    case 'cite': {
      const { runCite } = await import('../src/cite.js');
      await runCite(args);
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
    default: {
      console.log(BANNER);
      log.error(`Unknown command: ${command}`);
      console.log(`Run ${pc.cyan('tng-wiki help')} for available commands, or ${pc.cyan('tng-wiki help --json')} for the machine-readable manifest.`);
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
