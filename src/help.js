import pc from 'picocolors';

// Single source of truth for the CLI surface. Drives three things so they can
// never drift: the human `tng-wiki help`, per-command `tng-wiki <cmd> --help`,
// and the machine-readable `tng-wiki help --json` manifest agents read to onboard
// without probing every verb with --help.

// Reused flags
const WIKI = { name: '--wiki', value: '<slug>', desc: 'target a specific registered wiki (default: the wiki the cwd is inside, else the registered default)' };
const JSON_FLAG = { name: '--json', desc: 'structured, machine-readable output' };

export const COMMANDS = [
  {
    name: 'init', group: 'Scaffolding',
    summary: 'Scaffold a new LLM wiki (interactive, or headless with --yes)',
    usage: 'tng-wiki init                 # interactive\n       tng-wiki init --yes --dir <path> [--domain <d>] [--agent <a>] [--name <n>] [--no-integrations]',
    args: [],
    flags: [
      { name: '--yes', alias: '-y', desc: 'run headless with no prompts (requires --dir) — the agent path' },
      { name: '--dir', value: '<path>', desc: 'where to create the wiki' },
      { name: '--domain', value: '<d>', desc: 'ai-research | competitive-intel | publication | business-ops | learning | software-engineering | code-archaeology | blank (default: blank)' },
      { name: '--agent', value: '<a>', desc: 'claude-code | codex | cursor | all (default: claude-code)' },
      { name: '--name', value: '<n>', desc: 'wiki name (default: derived from domain)' },
      { name: '--code-authority', value: '<path>', desc: 'repeatable: code tree to ground against (Layer 3B) — prefer wiki-relative paths; absolute paths warn' },
      { name: '--git', desc: 'initialize a git repo (default: off in --yes mode)' },
      { name: '--qmd', desc: 'register a QMD collection (default: off)' },
      { name: '--no-integrations', desc: 'shorthand for --no-git --no-qmd' },
      { name: '--into-existing', alias: '--adopt', desc: 'adopt a non-empty dir: never overwrite existing files, merge .gitignore' },
      { name: '--force', desc: 'replace an existing registry entry of the same name' },
      { name: '--lead', value: '<name>=<path>', desc: 'register an external lead archive (repeatable, --yes mode) — searchable with `search --include-leads`, never citable' },
    ],
    examples: [
      'tng-wiki init',
      'tng-wiki init --yes --dir ./my-wiki --domain software-engineering --name "My Wiki"',
      'tng-wiki init --yes --dir . --into-existing --no-integrations',
      'tng-wiki init --yes --dir ./wiki --domain software-engineering --lead ai-archive=../legacy/ai-docs',
    ],
  },
  {
    name: 'register', group: 'Registry',
    summary: 'Register an existing wiki directory in the user registry',
    usage: 'tng-wiki register [path] [--force] [--name <n>] [--default]',
    args: [{ name: 'path', required: false, desc: 'wiki directory (default: current directory)' }],
    flags: [
      { name: '--force', desc: 'replace an existing same-slug entry that points elsewhere' },
      { name: '--name', value: '<n>', desc: 'override the registry name/slug' },
      { name: '--default', desc: 'set this wiki as the default' },
    ],
    examples: ['tng-wiki register .', 'tng-wiki register ~/wikis/research --default'],
  },
  {
    name: 'unregister', group: 'Registry',
    summary: 'Remove a wiki from the registry (files left untouched)',
    usage: 'tng-wiki unregister <slug>',
    args: [{ name: 'slug', required: true, desc: 'registry slug (see `tng-wiki list`)' }],
    flags: [], examples: ['tng-wiki unregister research'],
  },
  {
    name: 'list', group: 'Registry', summary: 'List registered wikis',
    usage: 'tng-wiki list', args: [], flags: [], examples: ['tng-wiki list'],
  },
  {
    name: 'set-default', group: 'Registry', summary: 'Set the default wiki',
    usage: 'tng-wiki set-default <slug>',
    args: [{ name: 'slug', required: true, desc: 'registry slug' }], flags: [], examples: ['tng-wiki set-default research'],
  },
  {
    name: 'query', group: 'Wiki access', summary: "Print the wiki's index (wiki/index.md) — start here",
    usage: 'tng-wiki query [--wiki <slug>] [--json]', args: [], flags: [WIKI, JSON_FLAG],
    examples: ['tng-wiki query', 'tng-wiki query --wiki research'],
  },
  {
    name: 'read', group: 'Wiki access', summary: 'Print a wiki page by path, [[wikilink]], or unique page stem',
    usage: 'tng-wiki read <page> [--wiki <slug>] [--json]',
    args: [{ name: 'page', required: true, desc: 'path under wiki/ (`.md` optional, leading `wiki/` tolerated), a [[wikilink]], or a unique page stem' }],
    flags: [WIKI, JSON_FLAG],
    examples: ['tng-wiki read entities/openai.md', 'tng-wiki read entities/openai', 'tng-wiki read openai', "tng-wiki read '[[openai]]'"],
  },
  {
    name: 'search', group: 'Wiki access', summary: 'Case-insensitive search across wiki pages',
    usage: 'tng-wiki search <query> [--wiki <slug>] [--regex] [--include-raw] [--include-leads] [--json]',
    args: [{ name: 'query', required: true, desc: 'search term (quote multi-word)' }],
    flags: [
      WIKI,
      { name: '--regex', desc: 'interpret the query as a regular expression' },
      { name: '--include-raw', desc: 'also search archival raw/ sources' },
      { name: '--include-leads', desc: 'also search registered lead archives (.tng-wiki.json lead_archives) — hits tagged [lead:<name>]; leads are never citable' },
      JSON_FLAG,
    ],
    examples: ['tng-wiki search "openai"', 'tng-wiki search "PKCE" --include-raw', 'tng-wiki search "RAPS" --include-leads'],
  },
  {
    name: 'graduate', group: 'Wiki access',
    summary: 'Move an _inbox/ capture into raw/ so pages can cite it (_inbox/ is not a citable root)',
    usage: 'tng-wiki graduate <inbox-item> [--to raw/<dir>] [--wiki <slug>] [--json]',
    args: [{ name: 'inbox-item', required: true, desc: 'file under _inbox/, with or without the _inbox/ prefix' }],
    flags: [
      { name: '--to', value: '<raw/dir>', desc: 'destination directory under raw/ (default: raw/captures)' },
      WIKI, JSON_FLAG,
    ],
    examples: ['tng-wiki graduate session-notes.md', 'tng-wiki graduate briefs/q3-brief.md --to raw/briefs'],
  },
  {
    name: 'sources', group: 'Wiki access', summary: 'List raw sources',
    usage: 'tng-wiki sources [--uncompiled] [--wiki <slug>] [--json]',
    args: [], flags: [{ name: '--uncompiled', desc: 'only sources not yet marked compiled (the ingest queue)' }, WIKI, JSON_FLAG],
    examples: ['tng-wiki sources --uncompiled'],
  },
  {
    name: 'ground', group: 'Grounding & lint',
    summary: 'Structural ground-check: attribution, dead cites, staleness, code authorities, lead archives, per-citation churn (zero-LLM)',
    usage: 'tng-wiki ground [--page <path>] [--at-ref] [--update-lock] [--fix-moved] [--wiki <slug>] [--json]',
    args: [], flags: [
      { name: '--page', value: '<path>', desc: 'scope the check to a single page' },
      { name: '--at-ref', desc: "resolve code-authority citations at each authority's pinned git ref" },
      { name: '--update-lock', desc: 'record per-citation content hashes + authority SHAs in wiki/.tng-wiki.lock.json — run after verify/reconcile to bless current state' },
      { name: '--fix-moved', desc: 'rewrite #L anchors for cites whose locked content moved unchanged (the only safe auto-fix; updates the lockfile)' },
      WIKI, JSON_FLAG,
    ],
    examples: ['tng-wiki ground', 'tng-wiki ground --at-ref --json', 'tng-wiki ground --update-lock', 'tng-wiki ground --fix-moved'],
  },
  {
    name: 'cite', group: 'Grounding & lint',
    summary: 'Show each citation in a page next to the exact source lines it cites (claim-by-evidence review)',
    usage: 'tng-wiki cite show <page> [--wiki <slug>] [--at-ref] [--cite <n|key>] [--context <lines>] [--json]',
    args: [
      { name: 'show', required: true, desc: 'subcommand (only `show` exists today)' },
      { name: 'page', required: true, desc: 'page path under wiki/, e.g. entities/openai.md (a wiki/ prefix is also accepted)' },
    ],
    flags: [
      WIKI,
      { name: '--at-ref', desc: "read code-authority citations at each authority's pinned git ref instead of the working tree" },
      { name: '--cite', value: '<n|key>', desc: 'limit to one citation, by index from the listing or by literal cite key' },
      { name: '--context', value: '<lines>', desc: 'lines shown for raw and whole-file cites (default: 20); ranged cites always show the exact range' },
      JSON_FLAG,
    ],
    examples: [
      'tng-wiki cite show entities/auth.md',
      'tng-wiki cite show entities/auth.md --cite 3',
      'tng-wiki cite show entities/auth.md --at-ref --json',
    ],
  },
  { name: 'drift', group: 'Grounding & lint', summary: 'List pages carrying ⚠️ DRIFT? markers', usage: 'tng-wiki drift [--wiki <slug>] [--json]', args: [], flags: [WIKI, JSON_FLAG], examples: ['tng-wiki drift'] },
  { name: 'unsourced', group: 'Grounding & lint', summary: 'List pages carrying ⚠️ UNSOURCED? markers', usage: 'tng-wiki unsourced [--wiki <slug>] [--json]', args: [], flags: [WIKI, JSON_FLAG], examples: ['tng-wiki unsourced'] },
  { name: 'unverified', group: 'Grounding & lint', summary: 'List pages carrying ⚠️ UNVERIFIED? markers', usage: 'tng-wiki unverified [--wiki <slug>] [--json]', args: [], flags: [WIKI, JSON_FLAG], examples: ['tng-wiki unverified'] },
  { name: 'stale', group: 'Grounding & lint', summary: 'List pages carrying ⚠️ STALE? markers', usage: 'tng-wiki stale [--wiki <slug>] [--json]', args: [], flags: [WIKI, JSON_FLAG], examples: ['tng-wiki stale'] },
  { name: 'orphans', group: 'Grounding & lint', summary: 'List wiki pages with no inbound [[wikilinks]]', usage: 'tng-wiki orphans [--wiki <slug>] [--json]', args: [], flags: [WIKI, JSON_FLAG], examples: ['tng-wiki orphans'] },
  {
    name: 'rounds', group: 'Grounding & lint',
    summary: 'Maintenance dashboard — the lint counts behind "do your rounds"',
    usage: 'tng-wiki rounds [--wiki <slug>] [--json]', args: [], flags: [WIKI, JSON_FLAG],
    examples: ['tng-wiki rounds', 'tng-wiki rounds --json'],
  },
  {
    name: 'upgrade', group: 'Scaffolding',
    summary: 'Regenerate a wiki\'s schema + doctrine after a CLI update, preserving hand-authored sections',
    usage: 'tng-wiki upgrade [path] [--wiki <slug>] [--domain <d>] [--dry-run] [--json]',
    args: [{ name: 'path', required: false, desc: 'explicit wiki directory (default: the wiki the cwd is inside, else the registered default)' }],
    flags: [
      WIKI,
      { name: '--domain', value: '<d>', desc: 're-domain the wiki while upgrading (e.g. software-engineering → code-archaeology); updates .tng-wiki.json and the registry' },
      { name: '--dry-run', desc: 'report what would change without writing anything' },
      JSON_FLAG,
    ],
    examples: ['tng-wiki upgrade --dry-run', 'tng-wiki upgrade', 'tng-wiki upgrade --wiki research --domain code-archaeology'],
  },
  {
    name: 'localize', group: 'Scaffolding',
    summary: 'Reconcile a shared wiki with THIS machine: remap or trust code authorities whose paths differ',
    usage: 'tng-wiki localize [path] [--wiki <slug>] [--set <name>=<path>]... [--trust <name>]... [--clear <name>]... [--yes] [--json]',
    args: [{ name: 'path', required: false, desc: 'explicit wiki directory (default: the wiki the cwd is inside, else the registered default)' }],
    flags: [
      WIKI,
      { name: '--set', value: '<name>=<path>', desc: 'repeatable: point a code authority at its local path on this machine' },
      { name: '--trust', value: '<name>', desc: "repeatable: accept the author's recorded verification as truth; skip local checks (no checkout needed)" },
      { name: '--clear', value: '<name>', desc: 'repeatable: remove a local override (back to unresolved)' },
      { name: '--yes', desc: 'non-interactive: apply --set/--trust/--clear (or just report status) without prompting' },
      JSON_FLAG,
    ],
    examples: [
      'tng-wiki localize',
      'tng-wiki localize --set foglifter-ng=~/dev/foglifter-ng --trust kpom-legacy',
      'tng-wiki localize --yes --json',
    ],
  },
  {
    name: 'install-skill', group: 'Agent integration',
    summary: 'Install the Claude Code skill (teaches every session the verbs)',
    usage: 'tng-wiki install-skill [--force] [--uninstall]',
    args: [], flags: [{ name: '--force', desc: 'overwrite an existing skill' }, { name: '--uninstall', desc: 'remove the installed skill' }],
    examples: ['tng-wiki install-skill'],
  },
  {
    name: 'connect', group: 'Agent integration',
    summary: 'Point agent sessions in another repo at a wiki (writes a git-excluded CLAUDE.local.md)',
    usage: 'tng-wiki connect [repo-path] [--wiki <slug>] [--agent <a>] [--remove]',
    args: [{ name: 'repo-path', required: false, desc: 'target repo (default: current directory)' }],
    flags: [WIKI, { name: '--agent', value: '<a>', desc: 'claude-code | codex | cursor | all (default: claude-code)' }, { name: '--remove', desc: 'remove the managed block and its .git/info/exclude entry' }],
    examples: ['tng-wiki connect ~/code/some-app --wiki research'],
  },
  {
    name: 'status', group: 'Diagnostics', summary: 'Basic wiki health snapshot',
    usage: 'tng-wiki status [path] [--wiki <slug>] [--json]',
    args: [{ name: 'path', required: false, desc: 'explicit wiki directory (bypasses the registry — mutually exclusive with --wiki; default: the wiki the cwd is inside, else the registered default)' }],
    flags: [WIKI, JSON_FLAG],
    examples: ['tng-wiki status', 'tng-wiki status --wiki research', 'tng-wiki status --json'],
  },
  {
    name: 'doctor', group: 'Diagnostics',
    summary: 'Environment + registry check with the recommended next step (orient here)',
    usage: 'tng-wiki doctor [path] [--json]', args: [{ name: 'path', required: false, desc: 'directory to inspect (default: current)' }], flags: [JSON_FLAG],
    examples: ['tng-wiki doctor', 'tng-wiki doctor --json'],
  },
  {
    name: 'help', group: 'Diagnostics',
    summary: 'Show help; `help --json` emits the full machine-readable command manifest',
    usage: 'tng-wiki help [command] [--json]',
    args: [{ name: 'command', required: false, desc: 'show detailed help for one command' }],
    flags: [JSON_FLAG],
    examples: ['tng-wiki help', 'tng-wiki help --json', 'tng-wiki help search', 'tng-wiki search --help'],
  },
];

const BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));
const GROUP_ORDER = ['Scaffolding', 'Registry', 'Wiki access', 'Grounding & lint', 'Agent integration', 'Diagnostics'];

export function hasCommand(name) {
  return BY_NAME.has(name);
}

// Agent onboarding recipes — copy-pasteable, so a session can set up or adopt a
// wiki from one read instead of probing.
export const ONBOARDING = {
  orient: 'tng-wiki doctor                     # state of this dir + the recommended next step',
  commandSurface: 'tng-wiki help --json               # this manifest: every command, flag, and example',
  createNew: 'tng-wiki init --yes --dir <path> --domain <d> --agent claude-code --name "<name>"',
  adoptExisting: 'tng-wiki init --yes --dir . --into-existing --no-integrations',
  registerExisting: 'tng-wiki register <path>            # if the wiki already exists on disk',
  query: 'tng-wiki query --wiki <slug>        # then search/read; --wiki omitted uses the default',
  connectOtherRepo: 'tng-wiki connect <repo> --wiki <slug>  # make sessions in another repo aware of it',
  rounds: 'tng-wiki rounds --wiki <slug>       # maintenance dashboard ("do your rounds")',
};

function commandToJson(c) {
  return {
    name: c.name,
    group: c.group,
    summary: c.summary,
    usage: c.usage,
    args: c.args ?? [],
    flags: (c.flags ?? []).map((f) => ({ name: f.name, alias: f.alias ?? null, value: f.value ?? null, description: f.desc })),
    examples: c.examples ?? [],
  };
}

export function commandJson(name) {
  const c = BY_NAME.get(name);
  return c ? commandToJson(c) : null;
}

export function manifest(version) {
  return {
    tool: 'tng-wiki',
    version: version ?? null,
    summary: 'Scaffold and maintain LLM-maintained markdown knowledge bases. Zero-LLM CLI; the agent is the intelligence.',
    conventions: {
      wikiFlag: 'Most verbs accept --wiki <slug> to target a registered wiki; omit it to use the default.',
      jsonFlag: 'Most verbs accept --json for structured output.',
      registry: 'Wikis are registered in ~/.tng-wiki/registry.json and reachable by slug from any directory.',
      perCommandHelp: 'Every command supports --help (add --json for the structured form).',
    },
    onboarding: ONBOARDING,
    globalFlags: [
      { name: '--wiki', value: '<slug>', description: WIKI.desc },
      { name: '--json', value: null, description: JSON_FLAG.desc },
      { name: '--help', alias: '-h', value: null, description: 'show help for the command (with --json for the structured form)' },
      { name: '--version', alias: '-v', value: null, description: 'print the tng-wiki version' },
    ],
    commands: COMMANDS.map(commandToJson),
  };
}

// ---- human renderers ----

export function renderCommandHelp(name) {
  const c = BY_NAME.get(name);
  if (!c) { console.log(`Unknown command: ${name}`); return; }
  const out = [];
  out.push(`${pc.bold(c.name)} ${pc.dim('— ' + c.summary)}`);
  out.push('');
  out.push(`${pc.bold('Usage:')} ${c.usage}`);
  if (c.args?.length) {
    out.push('');
    out.push(pc.bold('Arguments:'));
    for (const a of c.args) out.push(`  ${pc.cyan(a.name.padEnd(14))} ${a.desc}${a.required ? '' : pc.dim(' (optional)')}`);
  }
  if (c.flags?.length) {
    out.push('');
    out.push(pc.bold('Flags:'));
    for (const f of c.flags) {
      const label = `${f.name}${f.value ? ' ' + f.value : ''}${f.alias ? ', ' + f.alias : ''}`;
      out.push(`  ${pc.cyan(label.padEnd(22))} ${f.desc}`);
    }
  }
  if (c.examples?.length) {
    out.push('');
    out.push(pc.bold('Examples:'));
    for (const e of c.examples) out.push(`  ${pc.dim('$')} ${e}`);
  }
  console.log(out.join('\n'));
}

export function renderTopHelp() {
  const out = [];
  out.push(`${pc.bold('Usage:')} tng-wiki <command> [options]`);
  out.push('');
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  for (const group of GROUP_ORDER) {
    const cmds = COMMANDS.filter((c) => c.group === group);
    if (!cmds.length) continue;
    out.push(pc.bold(group + ':'));
    for (const c of cmds) out.push(`  ${pc.cyan(c.name.padEnd(width))}  ${c.summary}`);
    out.push('');
  }
  out.push(pc.dim('Most verbs accept --wiki <slug> and --json. Every command supports --help.'));
  out.push('');
  out.push(pc.bold('Agent quick start:'));
  out.push(`  ${pc.dim('$')} tng-wiki help --json     ${pc.dim('# full command surface, machine-readable')}`);
  out.push(`  ${pc.dim('$')} tng-wiki doctor          ${pc.dim('# state of this directory + recommended next step')}`);
  out.push('');
  out.push(`${pc.bold('Guide:')} ${pc.underline('https://thenewguard.ai/features/llm-wiki-guide')}`);
  console.log(out.join('\n'));
}
