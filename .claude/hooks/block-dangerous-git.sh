#!/usr/bin/env bash
set -euo pipefail

input=$(cat)
command=$(jq -r '.tool_input.command // ""' <<<"$input")

blocked_patterns=(
  'git[[:space:]]+push([[:space:]]|$)'
  'git[[:space:]]+reset[[:space:]]+--hard([[:space:]]|$)'
  'git[[:space:]]+clean[[:space:]]+-[^[:space:]]*f'
  'git[[:space:]]+branch[[:space:]]+-[dD]([[:space:]]|$)'
  'git[[:space:]]+(checkout|switch)([[:space:]]|$)'
  'git[[:space:]]+restore[[:space:]]+\.'
  'git[[:space:]]+worktree[[:space:]]+(add|remove)([[:space:]]|$)'
  'gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)'
)

for pattern in "${blocked_patterns[@]}"; do
  if grep -Eq "$pattern" <<<"$command"; then
    echo "BLOCKED: use npm run start:agent-task / finish:agent-task; direct git or PR workflow mutation is outside agent authority." >&2
    exit 2
  fi
done

exit 0
