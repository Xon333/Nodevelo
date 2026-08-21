#!/usr/bin/env bash
set -euo pipefail

sync_script=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sync.sh
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

repo="$tmp_dir/repo with spaces"
remote="$tmp_dir/origin.git"
mkdir -p "$repo"
git init --bare "$remote" >/dev/null
git -C "$repo" init -b main >/dev/null
git -C "$repo" config user.email test@example.com
git -C "$repo" config user.name "Sync test"
printf 'initial\n' > "$repo/README.md"
git -C "$repo" add README.md
git -C "$repo" commit -m initial >/dev/null
git -C "$repo" remote add origin "$remote"
git -C "$repo" push -u origin main >/dev/null

git -C "$repo" worktree add "$repo/.worktrees/codex-squash" -b codex/squash origin/main >/dev/null
printf 'squashed\n' > "$repo/.worktrees/codex-squash/feature.txt"
git -C "$repo/.worktrees/codex-squash" add feature.txt
git -C "$repo/.worktrees/codex-squash" commit -m feature >/dev/null
git -C "$repo" checkout main >/dev/null
git -C "$repo" merge --squash codex/squash >/dev/null
git -C "$repo" commit -m "squash feature" >/dev/null
git -C "$repo" push origin main >/dev/null

git -C "$repo" worktree add "$repo/.worktrees/codex-unmerged" -b codex/unmerged origin/main >/dev/null
printf 'not merged\n' > "$repo/.worktrees/codex-unmerged/unmerged.txt"
git -C "$repo/.worktrees/codex-unmerged" add unmerged.txt
git -C "$repo/.worktrees/codex-unmerged" commit -m "unmerged feature" >/dev/null

git -C "$repo" worktree add "$repo/.worktrees/codex-dirty" -b codex/dirty origin/main >/dev/null
printf 'uncommitted\n' > "$repo/.worktrees/codex-dirty/dirty.txt"

(cd "$repo" && bash "$sync_script") >/dev/null

[[ ! -e "$repo/.worktrees/codex-squash" ]] || {
  echo "sync left a clean squash-merged worktree behind" >&2
  exit 1
}
! git -C "$repo" show-ref --verify --quiet refs/heads/codex/squash || {
  echo "sync left the squash-merged local branch behind" >&2
  exit 1
}
[[ -e "$repo/.worktrees/codex-unmerged" ]] || {
  echo "sync removed an unmerged worktree" >&2
  exit 1
}
[[ -e "$repo/.worktrees/codex-dirty" ]] || {
  echo "sync removed a dirty worktree" >&2
  exit 1
}

echo "sync squash-merge cleanup passed"
