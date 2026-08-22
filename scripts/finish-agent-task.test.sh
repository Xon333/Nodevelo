#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/finish-agent-task.sh"

validate_branch codex/example
validate_branch claude/example
validate_branch ox/example

if validate_branch main 2>/dev/null; then
  echo "main must be rejected" >&2
  exit 1
fi

if validate_branch "" 2>/dev/null; then
  echo "detached HEAD must be rejected" >&2
  exit 1
fi

if validate_branch feature/example 2>/dev/null; then
  echo "unnamespaced branches must be rejected" >&2
  exit 1
fi

if ! requires_review codex; then
  echo "codex branches must require review" >&2
  exit 1
fi

if ! requires_review ox; then
  echo "ox branches must require review" >&2
  exit 1
fi

if requires_review claude; then
  echo "claude branches must not require review" >&2
  exit 1
fi

[[ $(reviewer_for codex) == ox ]]
[[ $(reviewer_for ox) == codex ]]

echo "finish-agent-task guards pass"
