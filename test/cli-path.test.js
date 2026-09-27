// doctor's non-interactive PATH check and the --install-shim wrapper: the
// recurring `tng-wiki: command not found` in ssh / agent-harness shells.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { nonInteractiveCheck, installShim, shimScript, SHIM_MARKER } from '../src/cli-path.js';

const CLI = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin', 'cli.js');
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;

function fakeHome() {
  return mkdtempSync(join(tmpdir(), 'tng-wiki-clipath-'));
}

test('shimScript execs absolute node and cli paths, so no PATH or nvm is needed', () => {
  const text = shimScript({ nodePath: '/opt/node/bin/node', cliPath: '/opt/tng/bin/cli.js' });
  assert.match(text, /^#!\/bin\/sh\n/);
  assert.ok(text.includes(SHIM_MARKER));
  assert.match(text, /exec "\/opt\/node\/bin\/node" "\/opt\/tng\/bin\/cli\.js" "\$@"/);
});

test('installShim writes an executable wrapper that runs, and refuses to clobber a foreign file', () => {
  const home = fakeHome();
  try {
    const result = installShim({ home, nodePath: process.execPath, cliPath: CLI });
    assert.equal(result.path, join(home, '.local', 'bin', 'tng-wiki'));
    assert.ok(statSync(result.path).mode & 0o100);
    const run = spawnSync(result.path, ['--version'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^\d+\.\d+\.\d+/);
    // re-running refreshes our own shim
    assert.doesNotThrow(() => installShim({ home, nodePath: process.execPath, cliPath: CLI }));
    writeFileSync(result.path, '#!/bin/sh\necho someone else\n');
    assert.throws(() => installShim({ home, nodePath: process.execPath, cliPath: CLI }), /not a tng-wiki shim/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('nonInteractiveCheck: fails with the exact fix when .bashrc only sets PATH after its interactive guard', { skip: !hasBash }, () => {
  const home = fakeHome();
  try {
    const bin = join(home, 'tools');
    mkdirSync(bin);
    writeFileSync(join(bin, 'tng-wiki'), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
    chmodSync(join(bin, 'tng-wiki'), 0o755);
    writeFileSync(join(home, '.bashrc'), `case $- in *i*) ;; *) return;; esac\nexport PATH="${bin}:$PATH"\n`);
    const bad = nonInteractiveCheck({ home });
    assert.equal(bad.ok, false);
    assert.match(bad.fix.join('\n'), /tng-wiki doctor --install-shim/);
    assert.match(bad.fix.join('\n'), /\.local\/bin/);

    // after the shim plus a PATH line above the guard, the same shell finds it
    installShim({ home, nodePath: process.execPath, cliPath: CLI });
    writeFileSync(join(home, '.bashrc'), `case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac\n` + readFileSync(join(home, '.bashrc'), 'utf8'));
    const good = nonInteractiveCheck({ home });
    assert.equal(good.ok, true, good.detail);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
