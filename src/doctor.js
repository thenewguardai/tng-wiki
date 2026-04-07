import * as p from '@clack/prompts';
import pc from 'picocolors';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { detectObsidian } from './integrations/obsidian.js';

export async function runDoctor(args) {
  const root = resolve(args[0] || '.');

  p.intro(pc.bgCyan(pc.black(' tng-wiki doctor ')));
  console.log('');

  const checks = [];

  // Node version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1));
  checks.push({
    name: 'Node.js',
    ok: major >= 18,
    detail: major >= 18 ? nodeVersion : `${nodeVersion} — need >=18`,
  });

  // Git
  const gitOk = commandExists('git --version');
  checks.push({ name: 'Git', ok: gitOk, detail: gitOk ? trimCmd('git --version') : 'not found' });

  // Claude Code
  const claudeOk = commandExists('claude --version');
  checks.push({
    name: 'Claude Code',
    ok: claudeOk,
    detail: claudeOk ? trimCmd('claude --version') : 'not found — install: npm i -g @anthropic-ai/claude-code',
  });

  // Codex
  const codexOk = commandExists('codex --version');
  checks.push({
    name: 'OpenAI Codex',
    ok: codexOk,
    detail: codexOk ? trimCmd('codex --version') : pc.dim('not found (optional)'),
    optional: true,
  });

  // QMD
  const qmdOk = commandExists('qmd --version');
  checks.push({
    name: 'QMD',
    ok: qmdOk,
    detail: qmdOk ? trimCmd('qmd --version') : 'not found — install: npm i -g @tobilu/qmd',
    optional: true,
  });

  // Obsidian vault
  const vault = detectObsidian();
  checks.push({
    name: 'Obsidian vault',
    ok: !!vault,
    detail: vault || pc.dim('not detected in common locations'),
    optional: true,
  });

  // Wiki directory
  const isWiki = existsSync(join(root, 'wiki')) && existsSync(join(root, 'raw'));
  checks.push({
    name: 'Wiki directory',
    ok: isWiki,
    detail: isWiki ? root : pc.dim('not in a wiki directory — run tng-wiki init'),
  });

  // Schema file
  if (isWiki) {
    const hasSchema = existsSync(join(root, 'CLAUDE.md'))
      || existsSync(join(root, 'AGENTS.md'))
      || existsSync(join(root, '.cursorrules'));
    checks.push({
      name: 'Schema file',
      ok: hasSchema,
      detail: hasSchema ? 'found' : 'missing — run tng-wiki init',
    });
  }

  // Print results
  for (const check of checks) {
    const icon = check.ok ? pc.green('✓') : check.optional ? pc.yellow('○') : pc.red('✗');
    console.log(`  ${icon} ${pc.bold(check.name)}  ${pc.dim('—')}  ${check.detail}`);
  }

  const failures = checks.filter(c => !c.ok && !c.optional);
  console.log('');
  if (failures.length === 0) {
    p.outro(pc.green('Environment looks good.'));
  } else {
    p.outro(pc.yellow(`${failures.length} issue${failures.length > 1 ? 's' : ''} to fix.`));
  }
}

function commandExists(cmd) {
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function trimCmd(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString().trim().split('\n')[0];
  } catch {
    return '';
  }
}
