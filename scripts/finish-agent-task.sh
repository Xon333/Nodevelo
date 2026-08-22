#!/usr/bin/env bash
set -euo pipefail

die() {
  echo "finish-agent-task: $*" >&2
  return 1
}

validate_branch() {
  case "$1" in
    "") die "detached HEAD is not a task branch" ;;
    main) die "main is integration-only; finish from a claude/*, codex/*, or ox/* branch" ;;
    claude/*|codex/*|ox/*) ;;
    *) die "task branch must be named claude/*, codex/*, or ox/*" ;;
  esac
}

# Codex and ox use the PR as their handoff surface. Neither writer auto-merges; merge-agent-task
# records the other agent's current-head approval or an explicit user override. Legacy claude/*
# behavior stays unchanged.
requires_review() {
  [[ "$1" == "codex" || "$1" == "ox" ]]
}

reviewer_for() {
  case "$1" in
    codex) echo ox ;;
    ox) echo codex ;;
    *) return 1 ;;
  esac
}

main() {
  local branch command pr_url agent pr_body pr_number reviewer
  for command in git gh npm; do
    command -v "$command" >/dev/null || die "install $command first"
  done

  branch=$(git branch --show-current)
  validate_branch "$branch"
  agent="${branch%%/*}"
  [[ -z $(git status --porcelain) ]] || die "commit this task's files before finishing"
  gh auth status -h github.com >/dev/null 2>&1 || die "run: gh auth login -h github.com"

  npm run check
  git push -u origin HEAD
  pr_url=$(gh pr view --json url --jq .url 2>/dev/null || gh pr create --fill)
  pr_number=$(gh pr view --json number --jq .number)
  pr_body=$(gh pr view --json body --jq .body)

  if requires_review "$agent"; then
    reviewer=$(reviewer_for "$agent")
    gh pr edit "$pr_number" --body "$(printf '%s\n\nAgent: %s\n\nNeeds a %s review of the current head before merge (WORKFLOW.md § Reviewing an agent PR).\n' "$pr_body" "$agent" "$reviewer")"
    echo "PR opened, NOT auto-merged ($agent branches need a $reviewer review first): $pr_url"
    echo "After review, run: npm run merge:agent-task -- $pr_number --approve-as $reviewer"
  else
    gh pr merge --auto --squash --body "$(printf '%s\n\nAgent: %s\n' "$pr_body" "$agent")"
    echo "Auto-merge enabled: $pr_url"
  fi
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
