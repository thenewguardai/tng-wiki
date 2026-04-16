import pc from 'picocolors';
import { homedir } from 'os';
import { join } from 'path';
import { installSkill, uninstallSkill, skillFile } from './skill.js';

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

function resolveClaudeHome(args) {
  const override = argValue(args, '--claude-home');
  return override ?? join(homedir(), '.claude');
}

export async function runInstallSkill(args) {
  const claudeHome = resolveClaudeHome(args);

  if (args.includes('--uninstall')) {
    const { path } = uninstallSkill(claudeHome);
    console.log(`${pc.green('✓')} Removed ${pc.bold(path)}`);
    return;
  }

  const result = installSkill(claudeHome, { force: args.includes('--force') });
  console.log(`${pc.green('✓')} Installed tng-wiki skill ${pc.dim(`→ ${result.path}`)}`);
  console.log(`  ${pc.dim('Claude Code picks it up within the current session (live change detection).')}`);
  console.log(`  ${pc.dim('Verify with')} ${pc.cyan('/tng-wiki')} ${pc.dim('in a Claude Code session, or ask a wiki question.')}`);
}
