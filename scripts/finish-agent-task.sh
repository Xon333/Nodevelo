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

# A codex/* branch can't safely auto-merge itself unreviewed (see ROADMAP.md's workout-library
# entry, 2026-08-04: an unreviewed Codex PR shipped 1/10 of its own plan with the other 9 silently
# untracked). Legacy claude/* behavior remains available for compatibility, but Claude work is deferred
# in the active workflow.
requires_review() {
  [[ "$1" == "codex" ]]
}

main() {
  local branch command pr_url agent pr_body pr_number
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
    gh pr edit "$pr_number" --body "$(printf '%s\n\nAgent: %s\n\nNeeds an opencode ox alpha review before merge (WORKFLOW.md § Reviewing a codex PR) — not auto-merged.\n' "$pr_body" "$agent")"
    echo "PR opened, NOT auto-merged (codex branches need an opencode ox alpha review first): $pr_url"
    echo "Ask opencode ox alpha to review PR #$pr_number, then 'gh pr merge --squash $pr_number' to approve, or 'gh pr review $pr_number --request-changes' to send it back."
  else
    gh pr merge --auto --squash --body "$(printf '%s\n\nAgent: %s\n' "$pr_body" "$agent")"
    echo "Auto-merge enabled: $pr_url"
  fi
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  main "$@"
fi
