#!/usr/bin/env bash
set -euo pipefail

die() {
  echo "merge-agent-task: $*" >&2
  exit 1
}

usage="usage: scripts/merge-agent-task.sh <pr-number> [--approve-as <codex|ox>|--user-override]"

main() {
  local pr="${1:-}" mode="${2:-}" reviewer="${3:-}" state branch head writer expected comments marker
  command -v gh >/dev/null || die "install gh first"
  [[ "$pr" =~ ^[0-9]+$ ]] || die "$usage"

  case "$mode" in
    "") [[ $# -eq 1 ]] || die "$usage" ;;
    --approve-as) [[ $# -eq 3 && "$reviewer" =~ ^(codex|ox)$ ]] || die "$usage" ;;
    --user-override) [[ $# -eq 2 ]] || die "$usage" ;;
    *) die "$usage" ;;
  esac

  gh auth status -h github.com >/dev/null 2>&1 || die "run: gh auth login -h github.com"
  state=$(gh pr view "$pr" --json state --jq .state)
  [[ "$state" == OPEN ]] || die "PR #$pr is not open"

  branch=$(gh pr view "$pr" --json headRefName --jq .headRefName)
  head=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
  writer="${branch%%/*}"
  case "$writer" in
    codex) expected=ox ;;
    ox) expected=codex ;;
    *) die "PR #$pr must come from a codex/* or ox/* branch" ;;
  esac

  case "$mode" in
    --approve-as)
      [[ "$reviewer" == "$expected" ]] || die "$writer PRs require a $expected review"
      marker="Agent-Review: reviewer=$reviewer head=$head verdict=approved"
      gh pr comment "$pr" --body "$marker"
      ;;
    --user-override)
      marker="Agent-Review: reviewer=user head=$head verdict=override"
      gh pr comment "$pr" --body "$marker"
      ;;
    "")
      comments=$(gh pr view "$pr" --json comments --jq '.comments[].body')
      marker="Agent-Review: reviewer=$expected head=$head verdict=approved"
      if ! grep -Fxq "$marker" <<< "$comments"; then
        marker="Agent-Review: reviewer=user head=$head verdict=override"
        grep -Fxq "$marker" <<< "$comments" || die "PR #$pr needs a current-head $expected review or user override"
      fi
      ;;
  esac

  gh pr checks "$pr" --required
  gh pr merge --squash --delete-branch "$pr"
  echo "merge-agent-task: merged PR #$pr at $head"
}

main "$@"
