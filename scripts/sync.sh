#!/usr/bin/env bash
set -euo pipefail

git fetch origin

if [[ "$(git branch --show-current)" == "main" ]]; then
  git merge --ff-only origin/main
else
  git fetch origin main:main 2>/dev/null \
    || echo "sync: local main is checked out elsewhere or has diverged — update it manually"
fi

git worktree prune

# Remove worktrees whose branch changes are already represented in origin/main and have no
# uncommitted changes. Patch equivalence handles squash merges, where the original branch
# commit is not an ancestor of the rewritten merge commit.
removed=0
here="$(pwd -P)"
if [[ -d .worktrees ]]; then
  while IFS= read -r wt_path; do
    [[ -z "$wt_path" ]] && continue
    [[ "$(cd "$wt_path" && pwd -P)" == "$here" ]] && continue
    branch="$(git -C "$wt_path" branch --show-current 2>/dev/null || true)"
    [[ -z "$branch" ]] && continue
    [[ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ]] && continue
    cherry_output="$(git cherry origin/main "$branch" 2>/dev/null)" || continue
    if ! grep -q '^+' <<<"$cherry_output"; then
      git worktree remove "$wt_path"
      git branch -D "$branch" 2>/dev/null || true
      removed=$((removed + 1))
    fi
  done < <(git worktree list --porcelain | awk '/^worktree /{print $2}' | grep '/\.worktrees/')
fi

echo "sync: main up to date with origin, stale worktrees pruned ($removed merged worktree(s) removed)"
