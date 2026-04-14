import * as p from '@clack/prompts';
import pc from 'picocolors';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { detectObsidian as realDetectObsidian } from './integrations/obsidian.js';

function realCommandExists(cmd) {
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function realTrimCmd(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString().trim().split('\n')[0];
  } catch {
    return '';
  }
}

export function runChecks(root, deps = {}) {
  const {
    commandExists = realCommandExists,
    trimCmd = realTrimCmd,
    detectObsidian = realDetectObsidian,
    nodeVersion = process.version,
  } = deps;

  const checks = [];

  const major = parseInt(nodeVersion.slice(1));
  checks.push({
    name: 'Node.js',
    ok: major >= 18,
    detail: major >= 18 ? nodeVersion : `${nodeVersion} — need >=18`,
  });

  const gitOk = commandExists('git --version');
  checks.push({ name: 'Git', ok: gitOk, detail: gitOk ? trimCmd('git --version') : 'not found' });

  const claudeOk = commandExists('claude --version');
  checks.push({
    name: 'Claude Code',
    ok: claudeOk,
    detail: claudeOk ? trimCmd('claude --version') : 'not found — install: npm i -g @anthropic-ai/claude-code',
  });

  const codexOk = commandExists('codex --version');
  checks.push({
    name: 'OpenAI Codex',
    ok: codexOk,
    detail: codexOk ? trimCmd('codex --version') : 'not found (optional)',
    optional: true,
  });

  const qmdOk = commandExists('qmd --version');
  checks.push({
    name: 'QMD',
    ok: qmdOk,
    detail: qmdOk ? trimCmd('qmd --version') : 'not found — install: npm i -g @tobilu/qmd',
    optional: true,
  });

  const obsidianLocation = detectObsidian();
  checks.push({
    name: 'Obsidian location',
    ok: !!obsidianLocation,
    detail: obsidianLocation || 'not detected in common locations',
    optional: true,
  });

  const isWiki = existsSync(join(root, 'wiki')) && existsSync(join(root, 'raw'));
  checks.push({
    name: 'Wiki directory',
    ok: isWiki,
    detail: isWiki ? root : 'not in a wiki directory — run tng-wiki init',
  });

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

  return checks;
}

export async function runDoctor(args) {
  const root = resolve(args[0] || '.');

  p.intro(pc.bgCyan(pc.black(' tng-wiki doctor ')));
  console.log('');

  const checks = runChecks(root);

  for (const check of checks) {
    const icon = check.ok ? pc.green('✓') : check.optional ? pc.yellow('○') : pc.red('✗');
    const detail = check.optional && !check.ok ? pc.dim(check.detail) : check.detail;
    console.log(`  ${icon} ${pc.bold(check.name)}  ${pc.dim('—')}  ${detail}`);
  }

  const failures = checks.filter(c => !c.ok && !c.optional);
  console.log('');
  if (failures.length === 0) {
    p.outro(pc.green('Environment looks good.'));
  } else {
    p.outro(pc.yellow(`${failures.length} issue${failures.length > 1 ? 's' : ''} to fix.`));
  }
}
