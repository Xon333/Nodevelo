#!/usr/bin/env bash
set -euo pipefail

die() {
  echo "start-agent-task: $*" >&2
  exit 1
}

agent="${1:-}"
task="${2:-}"
case "$agent" in
  claude|codex) ;;
  *) die "usage: scripts/start-agent-task.sh <claude|codex> <task-name>" ;;
esac
[[ -n "$task" ]] || die "usage: scripts/start-agent-task.sh <claude|codex> <task-name>"

branch="$agent/$task"
worktree=".worktrees/${branch//\//-}"

git fetch origin
git worktree add "$worktree" -b "$branch" origin/main
echo "start-agent-task: worktree ready at $worktree on branch $branch"
