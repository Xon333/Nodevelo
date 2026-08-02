# Dual-Agent Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude and Codex finish isolated tasks through verified, automatically merged pull requests without user-managed Git operations.

**Architecture:** Both apps work on disposable namespaced branches while `main` remains integration-only. A dependency-free shell command performs local preflight, verification, push, PR creation, and auto-merge; GitHub Actions repeats the verification before GitHub integrates the PR.

**Tech Stack:** POSIX shell, Git, GitHub CLI, npm, GitHub Actions

## Global Constraints

- Preserve every existing uncommitted file and stage only files changed by this implementation.
- Neither agent implements work directly on `main` after migration.
- Add no package dependency and no T3 Code-specific integration.
- Never automate conflict resolution, check bypasses, force pushes, or staging.
- Keep the existing `npm run check` command as the single verification authority.

---

## File map

- `scripts/finish-agent-task.sh` — validates task state and submits the current branch for automatic integration.
- `scripts/finish-agent-task.test.sh` — dependency-free checks for the script's branch guard.
- `package.json` — exposes both shell commands through npm.
- `.github/workflows/check.yml` — runs the existing verification gate on pull requests.
- `AGENTS.md` — portable Claude/Codex integration contract.
- `CLAUDE.md` — removes the old shared-main rule and points Claude at the portable contract.
- `WORKFLOW.md` — user-facing normal workflow.
- `docs/INVARIANTS.md` — replaces the shared-checkout invariant with integration-only `main`.

### Task 1: Guarded finish command

**Files:**
- Create: `scripts/finish-agent-task.sh`
- Create: `scripts/finish-agent-task.test.sh`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run finish:agent-task` and `npm run test:finish-agent-task`.
- Requires: a clean named branch, `git`, `gh`, `npm`, and valid GitHub CLI authentication.

- [ ] **Step 1: Write the failing shell test**

Create `scripts/finish-agent-task.test.sh`:

```bash
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/finish-agent-task.test.sh`

Expected: FAIL because `scripts/finish-agent-task.sh` does not exist.

- [ ] **Step 3: Implement the minimal finish command**

Create `scripts/finish-agent-task.sh`:

```bash
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
  local command
  for command in git gh npm; do
    command -v "$command" >/dev/null || die "install $command first"
  done

  local branch pr_url
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
```

- [ ] **Step 4: Expose and run the checks**

Add these entries to `package.json`'s existing `scripts` object:

```json
"test:finish-agent-task": "bash scripts/finish-agent-task.test.sh",
"finish:agent-task": "bash scripts/finish-agent-task.sh"
```

Run: `npm run test:finish-agent-task`

Expected: `finish-agent-task guards pass`.

Run: `npm run finish:agent-task`

Expected on the current checkout: FAIL with `main is integration-only` before tests, pushes, or remote changes.

- [ ] **Step 5: Commit Task 1**

```bash
git add scripts/finish-agent-task.sh scripts/finish-agent-task.test.sh package.json
git commit -m "feat(workflow): automate verified agent task submission"
```

### Task 2: CI and shared workflow contract

**Files:**
- Create: `.github/workflows/check.yml`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `WORKFLOW.md`
- Modify: `docs/INVARIANTS.md`

**Interfaces:**
- Consumes: `npm run check` and `npm run finish:agent-task` from Task 1.
- Produces: the required GitHub `check` job and one consistent cross-tool workflow.

- [ ] **Step 1: Add pull-request verification**

Create `.github/workflows/check.yml`:

```yaml
name: check

on:
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check
```

Validate syntax without adding a dependency:

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/check.yml", aliases: true); puts "workflow YAML valid"'
```

Expected: `workflow YAML valid`.

- [ ] **Step 2: Replace the portable concurrency rule**

Append this section to `AGENTS.md`, retaining the Next.js and recurring-bug rules:

```markdown
# Parallel agent integration

- `main` is integration-only. Implementation work runs in a fresh disposable worktree on
  `claude/<task>` or `codex/<task>`, based on current `origin/main`.
- Parallel tasks must own disjoint files. If tasks overlap, use one writer and the other agent as
  reviewer.
- Stage only files touched by the active task; never `git add -A` or `git add .`.
- Finish committed work with `npm run finish:agent-task`. GitHub owns verification and integration;
  the user does not manually merge normal tasks.
- Never bypass checks, force-push `main`, or automatically choose a side in a merge conflict.
```

- [ ] **Step 3: Remove conflicting Claude-only policy**

In `CLAUDE.md`, replace the existing `Concurrent Agents` bullet with:

```markdown
- **Concurrent Agents**: Follow AGENTS.md's integration-only `main` policy. Use Claude's native
  disposable worktree for implementation, keep task ownership disjoint, and finish through
  `npm run finish:agent-task`.
```

Leave model-routing and all unrelated Claude instructions unchanged.

- [ ] **Step 4: Update the daily workflow**

In `WORKFLOW.md`, replace the shared-main concurrency bullet with:

```markdown
- **Concurrent sessions**: `main` is integration-only. Claude and Codex work in disposable native
  worktrees on namespaced branches, then run `npm run finish:agent-task`; GitHub checks and merges
  automatically. Assign overlapping files to one writer and use the other agent as reviewer.
```

Add this command row:

```markdown
| `npm run finish:agent-task` | Verify, push, open a PR, and enable squash auto-merge for the current task branch |
```

- [ ] **Step 5: Replace invariant 29**

Replace invariant 29 in `docs/INVARIANTS.md` with:

```markdown
29. **`main` is integration-only.** Claude and Codex implementation tasks use fresh disposable
    worktrees on namespaced branches. Each task stages only its own files and finishes through
    `npm run finish:agent-task`; failed checks and merge conflicts are never bypassed or resolved by
    discarding one side.
```

- [ ] **Step 6: Verify consistency and commit Task 2**

Run:

```bash
rg -n "trunk-based|direct on main|no per-session branches|shared checkout" AGENTS.md CLAUDE.md WORKFLOW.md docs/INVARIANTS.md
```

Expected: no matches describing the retired workflow.

Run: `npm run check`

Expected: typecheck, lint, and tests all pass.

```bash
git add .github/workflows/check.yml AGENTS.md CLAUDE.md WORKFLOW.md docs/INVARIANTS.md
git commit -m "docs(workflow): adopt isolated dual-agent integration"
```

### Task 3: GitHub configuration and live path

**Files:**
- No repository file changes.

**Interfaces:**
- Consumes: the `check` workflow, task branches, and finish command from Tasks 1–2.
- Produces: protected integration-only `main`, automatic squash merges, and remote branch cleanup.

- [ ] **Step 1: Restore GitHub CLI authentication**

Run: `gh auth login -h github.com -w`

Expected: browser authentication succeeds, followed by `gh auth status` reporting `Xon333` logged in.

- [ ] **Step 2: Publish the approved workflow implementation**

Run: `git push origin main`

Expected: the design and implementation commits are published, including the pull-request workflow.
This is the final direct push to `main`; protection is enabled below.

- [ ] **Step 3: Enable repository merge settings**

Run:

```bash
gh api --method PATCH repos/Xon333/Nodevelo \
  -f allow_auto_merge=true \
  -f allow_squash_merge=true \
  -f allow_merge_commit=false \
  -f allow_rebase_merge=false \
  -f delete_branch_on_merge=true
```

Expected: returned repository JSON contains `allow_auto_merge: true`, `allow_squash_merge: true`,
and `delete_branch_on_merge: true`.

- [ ] **Step 4: Protect `main` after the CI workflow exists remotely**

Run:

```bash
gh api --method PUT repos/Xon333/Nodevelo/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["check"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON
```

Expected: returned protection JSON requires `check`, linear history, and disallows force pushes and
deletion. If GitHub rejects protection because the account plan does not support it, retain CI and
auto-merge, report that exact limitation, and do not invent a bypass.

- [ ] **Step 5: Run one disposable live smoke task**

Create the worktree outside the dirty primary checkout:

```bash
git fetch origin main
git worktree add .worktrees/workflow-smoke -b codex/workflow-smoke origin/main
cd .worktrees/workflow-smoke
git commit --allow-empty -m "test(workflow): verify automated integration"
npm run finish:agent-task
```

Expected: local checks pass, a PR URL is printed, GitHub runs `check`, and the PR squash-merges
without a manual merge.

- [ ] **Step 6: Confirm and clean up the smoke worktree**

From the primary checkout after GitHub reports the PR merged:

```bash
git fetch origin main
git worktree remove .worktrees/workflow-smoke
git branch -D codex/workflow-smoke
git status --short
```

Expected: the worktree and local smoke branch are removed; the pre-existing uncommitted files in the
primary checkout remain unchanged.

Do not pull `main` while the primary checkout contains unrelated uncommitted work. Its local branch
may be fast-forwarded later when that work is committed or moved safely.
