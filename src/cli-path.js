// Does `tng-wiki` resolve where agents actually run it? Interactive terminals
// load nvm / npm-prefix PATH entries from ~/.bashrc, but `ssh host cmd`, login
// shells, and agent harness shells stop at .bashrc's interactive guard - the
// recurring `tng-wiki: command not found`. A plain symlink is not enough: the
// CLI's `#!/usr/bin/env node` needs node on PATH too. The fix is a tiny shim
// with absolute node + CLI paths in ~/.local/bin (which also survives an nvm
// default-version switch), plus ~/.local/bin on PATH ABOVE the guard.
import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const SHIM_MARKER = '# tng-wiki shim (tng-wiki doctor --install-shim)';
const MINIMAL_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
export const PATH_LINE = 'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac';

export function shimScript({ nodePath, cliPath }) {
  return `#!/bin/sh\n${SHIM_MARKER}: absolute paths, so it runs without nvm or an npm prefix on PATH.\nexec "${nodePath}" "${cliPath}" "$@"\n`;
}

export function currentCliPath() {
  return realpathSync(process.argv[1]);
}

// Write ~/.local/bin/tng-wiki. Refreshes an existing tng-wiki shim; refuses to
// replace anything else. Returns { path, replaced }.
export function installShim({ home = homedir(), nodePath = process.execPath, cliPath = currentCliPath() } = {}) {
  const dir = join(home, '.local', 'bin');
  const path = join(dir, 'tng-wiki');
  const replaced = existsSync(path);
  if (replaced && !readFileSync(path, 'utf8').includes(SHIM_MARKER)) {
    throw new Error(`${path} exists and is not a tng-wiki shim - move it aside first, then re-run.`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, shimScript({ nodePath, cliPath }));
  chmodSync(path, 0o755);
  return { path, replaced };
}

// Simulate a non-interactive shell (minimal PATH, ~/.bashrc sourced the way
// `ssh host cmd` sources it) and run `tng-wiki --version`.
// Returns { ok, detail, fix: string[] } or null where bash is unavailable.
export function nonInteractiveCheck({ home = homedir() } = {}) {
  if (process.platform === 'win32') return null;
  const script = '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc" >/dev/null 2>&1; command -v tng-wiki && tng-wiki --version';
  const r = spawnSync('bash', ['-c', script], {
    encoding: 'utf8', timeout: 15_000,
    env: { HOME: home, USER: process.env.USER ?? '', PATH: MINIMAL_PATH },
  });
  if (r.error) return null;
  const [resolved, version] = (r.stdout ?? '').trim().split('\n');
  if (r.status === 0 && version) return { ok: true, detail: `${resolved} (${version})`, fix: [] };
  return {
    ok: false,
    detail: resolved ? `${resolved} found but does not run (node not on PATH?)` : 'not found in a non-interactive shell (ssh host cmd, agent harnesses)',
    fix: [
      'tng-wiki doctor --install-shim      # ~/.local/bin/tng-wiki -> absolute node + CLI paths',
      '# then make this the FIRST line of ~/.bashrc (above its interactive guard):',
      PATH_LINE,
    ],
  };
}
