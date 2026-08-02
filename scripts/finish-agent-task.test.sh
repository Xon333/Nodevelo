#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/finish-agent-task.sh"

validate_branch codex/example
validate_branch claude/example

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

echo "finish-agent-task guards pass"
