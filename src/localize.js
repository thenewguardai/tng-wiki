import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { resolveConfigPath, pathForm } from './paths.js';
import { loadCodeAuthorities, loadLeadArchives, loadLocalOverrides } from './ground.js';
import { resolveWiki } from './verbs.js';

// `tng-wiki localize` reconciles a shared wiki with THIS machine. When a wiki
// is handed to a teammate, its `code_authorities` / `lead_archives` point at
// the original author's paths - and the teammate may not have every repo at
// all. localize walks each one and records, in a gitignored
// `.tng-wiki.local.json`, either a local path remap or a "trusted" mark
// (accept the recorded verification as truth; don't re-check locally). The
// committed `.tng-wiki.json` is never touched - it stays canonical for the team.

const LOCAL_FILE = '.tng-wiki.local.json';

// Per-authority reconciliation status on this machine. `state` is one of:
//   ok        - resolves to an existing local path (nothing to do)
//   trusted   - marked trusted-remote in the local file
//   missing   - path does not exist here and it isn't trusted (needs a choice)
//   invalid   - malformed path in the committed manifest
export function authorityStatuses(wikiPath) {
  return loadCodeAuthorities(wikiPath).map((a) => classify(wikiPath, a));
}

export function leadArchiveStatuses(wikiPath) {
  // Leads are never citable, so "trusted" is meaningless for them - only a path
  // remap matters. A missing lead archive just isn't searchable here.
  return loadLeadArchives(wikiPath).map((a) => {
    const s = classify(wikiPath, a);
    return s.state === 'trusted' ? { ...s, state: 'missing' } : s;
  });
}

function classify(wikiPath, entry) {
  const base = {
    name: entry.name,
    path: entry.path,
    trusted: entry.trusted === true,
    overridden: entry.localPathOverride === true,
  };
  if (entry.trusted === true) return { ...base, state: 'trusted', exists: false };
  const form = pathForm(entry.path);
  if (form === 'invalid') return { ...base, state: 'invalid', exists: false };
  const exists = existsSync(resolveConfigPath(wikiPath, entry.path));
  return { ...base, state: exists ? 'ok' : 'missing', exists };
}

// Merge a set of actions into the existing local-override object and return the
// next object (pure - callers persist it). Actions:
//   sets:   { "<name>": "<path>" }  -> remap to a local path
//   trusts: ["<name>", ...]         -> mark trusted-remote (drops any path)
//   clears: ["<name>", ...]         -> remove the override (back to unresolved)
// `family` is 'code_authorities' or 'lead_archives'. Empty families are pruned
// so the file stays minimal.
export function applyLocalizeActions(existing, { family = 'code_authorities', sets = {}, trusts = [], clears = [] } = {}) {
  const next = existing && typeof existing === 'object' ? structuredClone(existing) : {};
  const map = { ...(next[family] || {}) };
  for (const [name, path] of Object.entries(sets)) map[name] = { path };
  for (const name of trusts) map[name] = { trusted: true };
  for (const name of clears) delete map[name];
  if (Object.keys(map).length > 0) next[family] = map;
  else delete next[family];
  return next;
}

export function writeLocalOverrides(wikiPath, obj) {
  const path = join(wikiPath, LOCAL_FILE);
  writeFileSync(path, JSON.stringify({ version: 1, ...obj }, null, 2) + '\n', 'utf8');
  ensureGitignored(wikiPath);
  return path;
}

// The local file is per-machine and must never be committed. New scaffolds
// already ignore it (init's GITIGNORE), but a wiki created before this feature
// won't - so localize appends the rule if it's missing. Idempotent.
export function ensureGitignored(wikiPath) {
  const giPath = join(wikiPath, '.gitignore');
  const line = LOCAL_FILE;
  let existing = '';
  if (existsSync(giPath)) {
    existing = readFileSync(giPath, 'utf8');
    if (existing.split('\n').some((l) => l.trim() === line)) return false;
  }
  const base = existing === '' || existing.endsWith('\n') ? existing : existing + '\n';
  writeFileSync(giPath, `${base}\n# Machine-local wiki config (tng-wiki localize) - never commit\n${line}\n`, 'utf8');
  return true;
}

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : null;
}

// All values for a repeatable flag, e.g. --set a=x --set b=y -> ['a=x','b=y'].
function collectFlag(args, flag) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1] && !args[i + 1].startsWith('--')) out.push(args[++i]);
  }
  return out;
}

function firstPositional(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--wiki' || a === '--set' || a === '--trust' || a === '--clear') { i++; continue; }
    if (a.startsWith('--')) continue;
    return a;
  }
  return undefined;
}

// Same resolution order as every other verb (explicit path > --wiki > cwd-wiki
// > registered default); resolveWiki owns the cwd logic.
export function resolveLocalizeTarget(args, { cwd = process.cwd(), home } = {}) {
  const slug = argValue(args, '--wiki');
  const explicit = firstPositional(args);
  if (slug && explicit) throw new Error(`Pass either a path ("${explicit}") or --wiki ${slug}, not both.`);
  if (explicit) return { root: resolve(explicit), slug: null };
  const wiki = resolveWiki(slug, home, { cwd });
  return { root: wiki.path, slug: wiki.slug };
}

export async function runLocalize(args) {
  const { root, slug } = resolveLocalizeTarget(args);
  if (!existsSync(join(root, '.tng-wiki.json'))) {
    throw new Error(`${root} has no .tng-wiki.json - not a tng-wiki wiki. Nothing to localize.`);
  }

  const setPairs = collectFlag(args, '--set').map((s) => {
    const eq = s.indexOf('=');
    if (eq === -1) throw new Error(`--set expects <name>=<path>, got "${s}"`);
    const name = s.slice(0, eq);
    const path = s.slice(eq + 1).trim();
    // An empty path (often a shell mis-expansion, e.g. --set legacy=$UNSET) would
    // persist a dead { path: "" } that load-time silently ignores - the command
    // reports success while nothing changes. Reject it; --clear is the way to remove.
    if (path === '') throw new Error(`--set ${name}= needs a non-empty path; use --clear ${name} to remove an override`);
    return [name, path];
  });
  const trusts = collectFlag(args, '--trust');
  const clears = collectFlag(args, '--clear');
  // --json alone means "report status, don't prompt" - without this it would drop
  // into the interactive wizard and hang on a piped (non-TTY) stdin.
  const headless = setPairs.length > 0 || trusts.length > 0 || clears.length > 0
    || args.includes('--yes') || args.includes('--json');

  if (headless) {
    const next = applyLocalizeActions(loadLocalOverrides(root), {
      sets: Object.fromEntries(setPairs), trusts, clears,
    });
    if (setPairs.length || trusts.length || clears.length) writeLocalOverrides(root, next);
    return report(root, slug, args.includes('--json'));
  }

  // Interactive wizard: one prompt per unresolved code authority, then per
  // unresolved lead archive (leads get path/skip only - they are never trust
  // anchors, so "trust as-is" is meaningless for them).
  p.intro(pc.bgCyan(pc.black(' tng-wiki localize ')));
  const authorities = authorityStatuses(root);
  const leads = leadArchiveStatuses(root);
  const unresolvedAuth = authorities.filter((s) => s.state === 'missing' || s.state === 'invalid');
  const unresolvedLeads = leads.filter((s) => s.state === 'missing' || s.state === 'invalid');

  if (authorities.length === 0 && leads.length === 0) {
    p.log.info('This wiki declares no code authorities or lead archives — nothing machine-specific to reconcile.');
    p.outro('Done.');
    return;
  }
  if (unresolvedAuth.length === 0 && unresolvedLeads.length === 0) {
    p.log.success('Every code authority and lead archive already resolves on this machine.');
    p.outro('Nothing to do.');
    return;
  }

  let overrides = loadLocalOverrides(root);

  if (unresolvedAuth.length > 0) {
    p.log.info(`${authorities.length - unresolvedAuth.length} of ${authorities.length} code authorities resolve here; reconciling ${unresolvedAuth.length}.`);
    for (const s of unresolvedAuth) {
      const choice = await p.select({
        message: `Authority ${pc.bold(s.name)} — ${pc.dim(s.path)} ${pc.yellow('(not found here)')}`,
        options: [
          { value: 'path', label: 'I have it locally', hint: 'enter the path on this machine' },
          { value: 'trust', label: 'Trust as-is', hint: "accept the author's verification; don't re-check here" },
          { value: 'skip', label: 'Skip for now', hint: 'leave unresolved; ground will still flag it' },
        ],
      });
      if (p.isCancel(choice)) throw new Error('CANCELLED');
      if (choice === 'path') {
        const val = await promptPath(s.name, root);
        if (val) overrides = applyLocalizeActions(overrides, { sets: { [s.name]: val } });
      } else if (choice === 'trust') {
        overrides = applyLocalizeActions(overrides, { trusts: [s.name] });
      }
    }
  }

  if (unresolvedLeads.length > 0) {
    p.log.info(`Reconciling ${unresolvedLeads.length} lead archive(s) — leads are searchable, never citable, so path-only.`);
    for (const s of unresolvedLeads) {
      const choice = await p.select({
        message: `Lead archive ${pc.bold(s.name)} — ${pc.dim(s.path)} ${pc.yellow('(not found here)')}`,
        options: [
          { value: 'path', label: 'I have it locally', hint: 'enter the path on this machine' },
          { value: 'skip', label: 'Skip for now', hint: "leave it; you just can't search this archive here" },
        ],
      });
      if (p.isCancel(choice)) throw new Error('CANCELLED');
      if (choice === 'path') {
        const val = await promptPath(s.name, root);
        if (val) overrides = applyLocalizeActions(overrides, { family: 'lead_archives', sets: { [s.name]: val } });
      }
    }
  }

  writeLocalOverrides(root, overrides);
  p.outro(`Saved ${pc.cyan(LOCAL_FILE)} ${pc.dim('(gitignored — machine-local)')}. Run ${pc.cyan('tng-wiki doctor')} to confirm.`);
}

// Shared "enter a local path" prompt for the wizard. Returns the trimmed value,
// or null when the user left it blank (treated as skip). Warns (doesn't block)
// when the path isn't there yet - the user may be about to clone it.
async function promptPath(name, root) {
  const entered = await p.text({
    message: `Local path for ${name}`,
    placeholder: '~/dev/the-repo or ../sibling-repo',
  });
  if (p.isCancel(entered)) throw new Error('CANCELLED');
  const val = String(entered).trim();
  if (val === '') { p.log.warn('Empty path — skipped.'); return null; }
  if (!existsSync(resolveConfigPath(root, val))) {
    p.log.warn(`Path not found yet: ${pc.dim(val)} — saving anyway (you may be about to clone it).`);
  }
  return val;
}

function report(root, slug, asJson) {
  const authorities = authorityStatuses(root);
  const leads = leadArchiveStatuses(root);
  if (asJson) {
    process.stdout.write(JSON.stringify({ wiki: slug, root, authorities, lead_archives: leads }, null, 2) + '\n');
    return;
  }
  const label = { ok: pc.green('ok'), trusted: pc.cyan('trusted'), missing: pc.yellow('missing'), invalid: pc.red('invalid') };
  console.log('');
  console.log(`  ${pc.bold('Localization')}  ${pc.dim(slug ? `${slug} · ${root}` : root)}`);
  console.log('');
  for (const s of authorities) {
    const note = s.overridden ? pc.dim(' (local path)') : '';
    console.log(`  ${label[s.state] ?? s.state}  ${s.name}${note}  ${pc.dim(s.path)}`);
  }
  if (leads.length) {
    console.log('');
    for (const s of leads) console.log(`  ${label[s.state] ?? s.state}  ${pc.dim('[lead]')} ${s.name}  ${pc.dim(s.path)}`);
  }
  console.log('');
}
