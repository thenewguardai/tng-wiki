#!/usr/bin/env bash
# file-issues.sh — file the tng-wiki issue pack against thenewguardai/tng-wiki.
#
# Run from the directory containing the issues/ folder, on a machine where
# `gh auth status` succeeds (Legion).
#
#   ./file-issues.sh            # file everything
#   ./file-issues.sh --dry-run  # print what would be filed
#   ./file-issues.sh 01 05 06   # file a subset by number prefix
#
# Each issues/NN-*.md file becomes one issue: title = first line (sans '# '),
# body = the rest. Idempotence guard: skips any file whose exact title already
# exists open OR closed in the repo.

set -euo pipefail

REPO="thenewguardai/tng-wiki"
ISSUE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/issues"
DRY_RUN=0

args=()
for a in "$@"; do
  if [[ "$a" == "--dry-run" ]]; then DRY_RUN=1; else args+=("$a"); fi
done

command -v gh >/dev/null || { echo "ERROR: gh CLI not found" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "ERROR: gh not authenticated (run: gh auth login)" >&2; exit 1; }
[[ -d "$ISSUE_DIR" ]] || { echo "ERROR: $ISSUE_DIR not found" >&2; exit 1; }

# Existing titles (open + closed) for the idempotence guard.
existing="$(gh issue list --repo "$REPO" --state all --limit 200 --json title --jq '.[].title')"

# Select files: all, or those matching the given number prefixes.
shopt -s nullglob
files=()
if [[ ${#args[@]} -eq 0 ]]; then
  files=("$ISSUE_DIR"/*.md)
else
  for n in "${args[@]}"; do
    for f in "$ISSUE_DIR"/"$n"-*.md; do files+=("$f"); done
  done
fi
[[ ${#files[@]} -gt 0 ]] || { echo "No issue files matched." >&2; exit 1; }

filed=0 skipped=0
for f in "${files[@]}"; do
  title="$(head -1 "$f" | sed 's/^#\s*//')"
  if grep -qxF "$title" <<< "$existing"; then
    echo "SKIP  (exists) $title"
    ((skipped++)) || true
    continue
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "WOULD FILE     $title"
    continue
  fi
  body="$(tail -n +2 "$f")"
  url="$(gh issue create --repo "$REPO" --title "$title" --body "$body")"
  echo "FILED          $url"
  ((filed++)) || true
  sleep 1   # be gentle with the API
done

echo
echo "Done: $filed filed, $skipped skipped."
[[ $DRY_RUN -eq 1 ]] && echo "(dry run — nothing was created)"
exit 0
