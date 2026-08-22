#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/start-agent-task.sh"

valid_agent codex
valid_agent ox

if valid_agent other; then
  echo "unknown agents must be rejected" >&2
  exit 1
fi

echo "start-agent-task guards pass"
