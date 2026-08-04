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
echo "sync: main up to date with origin, stale worktrees pruned"
