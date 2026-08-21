#!/usr/bin/env bash
set -euo pipefail

hook_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
hook="$hook_dir/block-dangerous-git.sh"

expect_status() {
  local expected=$1
  local command=$2
  local actual=0

  printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg value "$command" '$value')" | "$hook" >/dev/null 2>&1 || actual=$?
  [[ $actual -eq $expected ]] || {
    echo "expected status $expected, got $actual: $command" >&2
    exit 1
  }
}

expect_status 2 'git push origin main'
expect_status 2 'git checkout -b claude/example'
expect_status 2 'git worktree add .worktrees/example -b claude/example origin/main'
expect_status 2 'gh pr create --fill'
expect_status 0 'npm run finish:agent-task'
expect_status 0 'git status --short'
expect_status 0 'gh pr merge --squash 123'

echo 'git guardrail checks passed'
