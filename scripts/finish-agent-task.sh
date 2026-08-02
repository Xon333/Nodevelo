#!/usr/bin/env bash
set -euo pipefail

die() {
  echo "finish-agent-task: $*" >&2
  return 1
}

validate_branch() {
  case "$1" in
    "") die "detached HEAD is not a task branch" ;;
    main) die "main is integration-only; finish from a claude/* or codex/* branch" ;;
    claude/*|codex/*) ;;
    *) die "task branch must be named claude/* or codex/*" ;;
  esac
}

main() {
  local branch command pr_url
  for command in git gh npm; do
    command -v "$command" >/dev/null || die "install $command first"
  done

  branch=$(git branch --show-current)
  validate_branch "$branch"
  [[ -z $(git status --porcelain) ]] || die "commit this task's files before finishing"
  gh auth status -h github.com >/dev/null 2>&1 || die "run: gh auth login -h github.com"

  npm run check
  git push -u origin HEAD
  pr_url=$(gh pr view --json url --jq .url 2>/dev/null || gh pr create --fill)
  gh pr merge --auto --squash
  echo "Auto-merge enabled: $pr_url"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
