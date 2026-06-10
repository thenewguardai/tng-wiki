import pc from 'picocolors';

// Single source of truth for the CLI surface. Drives three things so they can
// never drift: the human `tng-wiki help`, per-command `tng-wiki <cmd> --help`,
// and the machine-readable `tng-wiki help --json` manifest agents read to onboard
// without probing every verb with --help.

// Reused flags
const WIKI = { name: '--wiki', value: '<slug>', desc: 'target a specific registered wiki (default: the registered default)' };
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
      { name: '--domain', value: '<d>', desc: 'ai-research | competitive-intel | publication | business-ops | learning | software-engineering | blank (default: blank)' },
      { name: '--agent', value: '<a>', desc: 'claude-code | codex | cursor | all (default: claude-code)' },
      { name: '--name', value: '<n>', desc: 'wiki name (default: derived from domain)' },
      { name: '--git', desc: 'initialize a git repo (default: off in --yes mode)' },
      { name: '--qmd', desc: 'register a QMD collection (default: off)' },
      { name: '--no-integrations', desc: 'shorthand for --no-git --no-qmd' },
      { name: '--into-existing', alias: '--adopt', desc: 'adopt a non-empty dir: never overwrite existing files, merge .gitignore' },
      { name: '--force', desc: 'replace an existing registry entry of the same name' },
    ],
    examples: [
      'tng-wiki init',
      'tng-wiki init --yes --dir ./my-wiki --domain software-engineering --name "My Wiki"',
      'tng-wiki init --yes --dir . --into-existing --no-integrations',
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
    usage: 'tng-wiki search <query> [--wiki <slug>] [--regex] [--include-raw] [--json]',
    args: [{ name: 'query', required: true, desc: 'search term (quote multi-word)' }],
    flags: [WIKI, { name: '--regex', desc: 'interpret the query as a regular expression' }, { name: '--include-raw', desc: 'also search archival raw/ sources' }, JSON_FLAG],
    examples: ['tng-wiki search "openai"', 'tng-wiki search "PKCE" --include-raw'],
  },
  {
    name: 'sources', group: 'Wiki access', summary: 'List raw sources',
    usage: 'tng-wiki sources [--uncompiled] [--wiki <slug>] [--json]',
    args: [], flags: [{ name: '--uncompiled', desc: 'only sources not yet marked compiled (the ingest queue)' }, WIKI, JSON_FLAG],
    examples: ['tng-wiki sources --uncompiled'],
  },
  {
    name: 'ground', group: 'Grounding & lint',
    summary: 'Structural ground-check: attribution, dead cites, staleness, code authorities (zero-LLM)',
    usage: 'tng-wiki ground [--page <path>] [--at-ref] [--wiki <slug>] [--json]',
    args: [], flags: [
      { name: '--page', value: '<path>', desc: 'scope the check to a single page' },
      { name: '--at-ref', desc: "resolve code-authority citations at each authority's pinned git ref" },
      WIKI, JSON_FLAG,
    ],
    examples: ['tng-wiki ground', 'tng-wiki ground --at-ref --json'],
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
    args: [{ name: 'path', required: false, desc: 'explicit wiki directory (bypasses the registry — mutually exclusive with --wiki; default: the registered default wiki)' }],
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
