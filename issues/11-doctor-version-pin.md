# doctor: report installed vs latest vs pinned version

## Problem

Wikis are encouraged to pin the tool release (deliberate ops decision —
"don't debug your own tool instead of client work"), and the skill + generated
AGENTS.md describe verb behavior that evolves across versions. In the field:
machine on 0.4.0, npm at 0.5.0, installed skill one generation stale — and
nothing surfaces any of it. Multi-machine use multiplies the skew.

## Proposal

1. `doctor` adds a version block:
   - installed (already known from package.json);
   - latest on npm — `npm view @thenewguard/tng-wiki version`, 2s timeout,
     `unreachable` offline (doctor must never hang or fail on network);
   - pinned — new optional `.tng-wiki.json` key `"pinned_version": "0.4.x"`
     (semver range). Compare and annotate: `✓ matches pin`,
     `⚠ installed 0.5.0 violates pin 0.4.x`, `ℹ update available (pin allows)`.
2. **Skill freshness**: doctor already checks the skill is installed; also
   compare the installed SKILL.md against what the current version would
   generate (hash or embedded version stamp from src/skill.js) →
   `⚠ skill is stale — run tng-wiki install-skill`.
3. `init` mentions `pinned_version` in the epilogue when scaffolding for
   engineering-shaped domains.

## Acceptance criteria

- [ ] `doctor` (and `--json`) show installed/latest/pinned with the three
      annotations; offline → `latest: unreachable`, exit 0.
- [ ] Stale-skill detection fires after a version bump until `install-skill`
      is re-run.
- [ ] No `pinned_version` key → behavior is informational only (installed vs
      latest), no warnings.
