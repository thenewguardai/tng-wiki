import * as p from '@clack/prompts';
import pc from 'picocolors';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { detectObsidian as realDetectObsidian } from './integrations/obsidian.js';
import { loadRegistry, listWikis } from './registry.js';
import { skillStatus } from './skill.js';
import {
  installedVersion, fetchLatestVersion, readPinnedVersion, buildVersionReport,
} from './version.js';

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

// The single most useful thing for an onboarding agent: given the current
// directory + registry state, what command should it run next? Pure (no fs) so
// it's unit-testable.
export function recommendNextStep({ root, isWiki, wikis }) {
  const registered = isWiki ? wikis.find((w) => resolve(w.path) === resolve(root)) : null;
  if (isWiki && registered) {
    return `This wiki is registered as "${registered.slug}". Query it: tng-wiki query --wiki ${registered.slug}`;
  }
  if (isWiki) {
    return 'This is a tng-wiki directory but not registered. Register it: tng-wiki register .';
  }
  if (wikis.length > 0) {
    const slugs = wikis.map((w) => w.slug).join(', ');
    return `${wikis.length} wiki(s) registered (${slugs}). Query one with tng-wiki query --wiki <slug>, or create a new wiki: tng-wiki init --yes --dir <path> --domain <d>`;
  }
  return 'No wikis registered yet. Create one: tng-wiki init --yes --dir <path> --domain <d> --agent claude-code  (or adopt this directory: tng-wiki init --yes --dir . --into-existing)';
}

// installed vs latest vs pinned for the directory under inspection. `latest`
// hits the npm registry (2s cap, null offline) unless a fake is injected.
export function versionCheck(root, deps = {}) {
  const {
    installed = installedVersion(),
    fetchLatest = fetchLatestVersion,
    pinned = readPinnedVersion(root),
  } = deps;
  return buildVersionReport({ installed, latest: fetchLatest(), pinned });
}

export async function runDoctor(args, deps = {}) {
  const root = resolve(args.find((a) => !a.startsWith('-')) || '.');
  const checks = runChecks(root, deps);
  const isWiki = existsSync(join(root, 'wiki')) && existsSync(join(root, 'raw'));
  const wikis = listWikis(loadRegistry());
  const skill = skillStatus(deps.claudeHome);
  const version = versionCheck(root, deps);
  const recommendation = recommendNextStep({ root, isWiki, wikis });

  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({
      root,
      version,
      checks: checks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail, optional: !!c.optional })),
      registry: { count: wikis.length, wikis: wikis.map((w) => ({ slug: w.slug, path: w.path, domain: w.domain, default: w.isDefault })) },
      skillInstalled: skill.installed,
      skill,
      recommendation,
    }, null, 2) + '\n');
    return;
  }

  p.intro(pc.bgCyan(pc.black(' tng-wiki doctor ')));
  console.log('');

  for (const check of checks) {
    const icon = check.ok ? pc.green('✓') : check.optional ? pc.yellow('○') : pc.red('✗');
    const detail = check.optional && !check.ok ? pc.dim(check.detail) : check.detail;
    console.log(`  ${icon} ${pc.bold(check.name)}  ${pc.dim('—')}  ${detail}`);
  }

  // Version: installed vs latest on npm vs the wiki's optional pin
  console.log('');
  const latestStr = version.latest === 'unreachable' ? pc.dim('unreachable') : version.latest;
  const pinStr = version.pinned ? ` · pinned ${version.pinned}` : '';
  console.log(`  ${pc.green('●')} ${pc.bold('Version')}  ${pc.dim('—')}  installed ${version.installed} · latest ${latestStr}${pinStr}`);
  for (const a of version.annotations) {
    const icon = a.level === 'ok' ? pc.green('✓') : a.level === 'warn' ? pc.yellow('⚠') : pc.cyan('ℹ');
    console.log(`      ${icon} ${a.level === 'warn' ? pc.yellow(a.message) : a.message}`);
  }

  // Orientation: registry + skill + the recommended next command
  console.log('');
  console.log(`  ${pc.green('●')} ${pc.bold('Registry')}  ${pc.dim('—')}  ${wikis.length ? wikis.map((w) => w.slug).join(', ') : pc.dim('no wikis registered')}`);
  const skillIcon = !skill.installed ? pc.yellow('○') : skill.fresh ? pc.green('✓') : pc.yellow('⚠');
  const skillDetail = !skill.installed
    ? pc.dim('not installed — run tng-wiki install-skill')
    : skill.fresh
      ? 'installed'
      : pc.yellow('skill is stale — run tng-wiki install-skill');
  console.log(`  ${skillIcon} ${pc.bold('Claude Code skill')}  ${pc.dim('—')}  ${skillDetail}`);
  console.log('');
  console.log(`  ${pc.bold(pc.cyan('→ Next:'))} ${recommendation}`);

  const failures = checks.filter((c) => !c.ok && !c.optional);
  console.log('');
  if (failures.length === 0) {
    p.outro(pc.green('Environment looks good.'));
  } else {
    p.outro(pc.yellow(`${failures.length} issue${failures.length > 1 ? 's' : ''} to fix.`));
  }
}
