import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Single source of truth for "what version am I" + the minimal semver-range
// logic doctor needs to compare installed vs latest vs a wiki's pin.
// Deliberately not a dependency: we only need exact versions, x-ranges
// (0.4.x / 0.4.* / 0.x / *), caret (^0.4.0) and tilde (~0.4.0) forms.

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
);

export const PKG_NAME = pkg.name;

export function installedVersion() {
  return pkg.version;
}

// 'v1.2.3' / '1.2.3' (+ optional prerelease/build suffix, which we ignore for
// ordering — doctor compares published releases) -> [1, 2, 3], or null.
export function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmpTriples(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// -1 / 0 / 1, or null if either side isn't parseable.
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  return cmpTriples(pa, pb);
}

// Does `version` satisfy the pin `range`? Supported forms:
//   1.2.3 (exact) · 0.4.x / 0.4.* / 0.x / 0 / * (wildcards) · ^0.4.0 · ~0.4.0
// Returns true / false, or null when the range (or version) is unrecognized —
// callers should surface that rather than silently passing or failing the pin.
export function satisfiesPin(version, range) {
  const v = parseSemver(version);
  if (!v) return null;
  const r = String(range ?? '').trim();
  if (!r) return null;
  if (r === '*' || r.toLowerCase() === 'x') return true;

  const caret = r.startsWith('^');
  const tilde = r.startsWith('~');
  const body = caret || tilde ? r.slice(1) : r;
  const m = /^v?(\d+)(?:\.(\d+|x|\*)(?:\.(\d+|x|\*))?)?$/i.exec(body);
  if (!m) return null;

  const isWild = (s) => s === undefined || s === '*' || s.toLowerCase() === 'x';
  const major = Number(m[1]);

  if (!caret && !tilde) {
    if (isWild(m[2])) return v[0] === major;                       // 0.x / 0
    const minor = Number(m[2]);
    if (isWild(m[3])) return v[0] === major && v[1] === minor;     // 0.4.x
    return v[0] === major && v[1] === minor && v[2] === Number(m[3]); // exact
  }

  const minor = isWild(m[2]) ? 0 : Number(m[2]);
  const patch = isWild(m[3]) ? 0 : Number(m[3]);
  const lower = [major, minor, patch];
  let upper;
  if (tilde) upper = [major, minor + 1, 0];                        // ~1.2.3 -> <1.3.0
  else if (major > 0) upper = [major + 1, 0, 0];                   // ^1.2.3 -> <2.0.0
  else if (minor > 0) upper = [0, minor + 1, 0];                   // ^0.4.0 -> <0.5.0
  else upper = [0, 0, patch + 1];                                  // ^0.0.3 -> <0.0.4
  return cmpTriples(v, lower) >= 0 && cmpTriples(v, upper) < 0;
}

// Optional `"pinned_version"` key in the wiki's .tng-wiki.json. Never throws.
export function readPinnedVersion(root) {
  const metaPath = join(root, '.tng-wiki.json');
  if (!existsSync(metaPath)) return null;
  try {
    const pinned = JSON.parse(readFileSync(metaPath, 'utf8')).pinned_version;
    return typeof pinned === 'string' && pinned.trim() ? pinned.trim() : null;
  } catch {
    return null;
  }
}

function realExec(cmd, timeout) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], timeout }).toString();
}

// Latest published version on npm. 2s hard timeout; any failure (offline,
// registry down, npm missing) -> null. Doctor must never hang or exit nonzero
// because of the network.
export function fetchLatestVersion({ exec = realExec, timeoutMs = 2000 } = {}) {
  try {
    const out = exec(`npm view ${PKG_NAME} version`, timeoutMs);
    const v = String(out).trim().split('\n').pop().trim();
    return parseSemver(v) ? v : null;
  } catch {
    return null;
  }
}

// Pure annotation logic, shared by doctor's text and --json renderings.
// `latest` is a version string or null (unreachable). Returns:
//   { installed, latest: <version|'unreachable'>, pinned: <range|null>,
//     annotations: [{ level: 'ok'|'warn'|'info', message }] }
export function buildVersionReport({ installed, latest, pinned }) {
  const annotations = [];
  const updateAvailable = latest !== null && compareSemver(latest, installed) === 1;

  if (pinned) {
    const ok = satisfiesPin(installed, pinned);
    if (ok === null) {
      annotations.push({
        level: 'warn',
        message: `unrecognized pinned_version "${pinned}" — use a form like 0.4.x, ^0.4.0 or ~0.4.0`,
      });
    } else if (ok) {
      annotations.push({ level: 'ok', message: `installed ${installed} matches pin ${pinned}` });
    } else {
      annotations.push({ level: 'warn', message: `installed ${installed} violates pin ${pinned}` });
    }
    if (ok !== null && updateAvailable && satisfiesPin(latest, pinned) === true) {
      annotations.push({
        level: 'info',
        message: `update available (pin allows): ${installed} → ${latest}`,
      });
    }
  } else if (updateAvailable) {
    // No pin: purely informational, never a warning.
    annotations.push({ level: 'info', message: `update available: ${installed} → ${latest}` });
  }

  return {
    installed,
    latest: latest ?? 'unreachable',
    pinned: pinned ?? null,
    annotations,
  };
}
