#!/usr/bin/env bash
set -euo pipefail

die() {
  echo "start-agent-task: $*" >&2
  exit 1
}

usage="usage: scripts/start-agent-task.sh <claude|codex|ox> <task-name>"

valid_agent() {
  case "$1" in
    claude|codex|ox) ;;
    *) return 1 ;;
  esac
}

main() {
  local agent="${1:-}" task="${2:-}" branch worktree
  valid_agent "$agent" || die "$usage"
  [[ -n "$task" ]] || die "$usage"

  branch="$agent/$task"
  worktree=".worktrees/${branch//\//-}"

  git fetch origin
  git worktree add "$worktree" -b "$branch" origin/main
  echo "start-agent-task: worktree ready at $worktree on branch $branch"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
