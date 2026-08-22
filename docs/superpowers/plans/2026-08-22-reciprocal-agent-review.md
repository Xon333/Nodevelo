# Reciprocal Agent Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ADR-0014 so Codex and ox can write isolated tasks while the other agent, or an explicit user override, gates the current PR head before merge.

**Architecture:** Keep the existing shell workflow. Extend branch validation to `ox/*`, add one `merge-agent-task.sh` public command that records or validates a head-SHA-bound PR comment, checks required CI, and squash-merges, then update the canonical workflow docs.

**Tech Stack:** Bash, GitHub CLI, npm scripts, Markdown.

## Global Constraints

- Preserve legacy `claude/*` behavior; ADR-0014 governs `codex/*` and `ox/*`.
- No new dependencies.
- A writer cannot approve its own PR.
- New commits invalidate reciprocal approval because the marker contains the exact head SHA.
- A user override must be explicit, PR-scoped, and recorded on the PR.

---

### Task 1: Recognize Codex and ox writers

**Files:**
- Modify: `scripts/start-agent-task.sh`
- Create: `scripts/start-agent-task.test.sh`
- Modify: `scripts/finish-agent-task.sh`
- Modify: `scripts/finish-agent-task.test.sh`

**Interfaces:**
- Consumes: `npm run start:agent-task -- <agent> <task-name>` and the current branch name.
- Produces: `ox/<task>` worktrees and `reviewer_for codex|ox` reciprocal ownership.

- [ ] **Step 1: Write the failing guard tests**

Add a start-script assertion that `ox` is accepted, plus finish-script assertions that `validate_branch ox/example` succeeds, both `codex` and `ox` require review, and `reviewer_for codex`/`reviewer_for ox` return `ox`/`codex`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/finish-agent-task.test.sh`

Expected: failure because `ox/*` and `reviewer_for` are unsupported.

- [ ] **Step 3: Implement the minimum identity changes**

Allow `ox` in `start-agent-task.sh`; allow `ox/*` in `validate_branch`; make `requires_review` true for `codex` and `ox`; add:

```bash
reviewer_for() {
  case "$1" in
    codex) echo ox ;;
    ox) echo codex ;;
    *) return 1 ;;
  esac
}
```

Update the PR handoff text to name the reciprocal reviewer and `npm run merge:agent-task`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/finish-agent-task.test.sh`

Expected: `finish-agent-task guards pass`.

### Task 2: Gate merge on the current head

**Files:**
- Create: `scripts/merge-agent-task.sh`
- Create: `scripts/merge-agent-task.test.sh`
- Modify: `package.json`

**Interfaces:**
- Consumes: `npm run merge:agent-task -- <PR> [--approve-as codex|ox|--user-override]`.
- Produces: structured comments `Agent-Review: reviewer=<name> head=<sha> verdict=<approved|override>` and a squash merge only after required checks pass.

- [ ] **Step 1: Write failing CLI tests**

Use a temporary `gh` executable on `PATH` to exercise the script boundary. Cover: missing approval rejected, stale SHA rejected, the expected reciprocal agent can approve and merge, the writer cannot approve, and `--user-override` records the override and merges.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bash scripts/merge-agent-task.test.sh`

Expected: failure because `scripts/merge-agent-task.sh` does not exist.

- [ ] **Step 3: Implement the merge command**

Read PR state, head branch, and head SHA with `gh pr view`; derive the required reviewer from `codex/*` or `ox/*`; accept only an exact current-head reciprocal marker or current invocation's `--user-override`; run `gh pr checks <PR> --required`; then run `gh pr merge --squash --delete-branch <PR>`.

- [ ] **Step 4: Wire the checks**

Add `merge:agent-task` and one `test:agent-workflow` npm script that runs the start/finish and merge shell tests. Include that test in `npm run check`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:agent-workflow`

Expected: all three shell test scripts report success.

### Task 3: Align the operating law

**Files:**
- Modify: `AGENTS.md`
- Modify: `WORKFLOW.md`
- Modify: `ARCHIVE.md`
- Modify: `docs/COMPASS.md`
- Modify: `docs/DECISIONS.md`

**Interfaces:**
- Consumes: ADR-0014 and the implemented npm commands.
- Produces: one non-contradictory Codex + opencode runbook with load-bearing anchors preserved.

- [ ] **Step 1: Update the canonical instructions**

Document optional joint planning, `codex/*`/`ox/*` writer identity, reciprocal current-head review, `merge:agent-task`, explicit user override, and disjoint-only concurrency. Mark ADR-0014 implemented.

- [ ] **Step 2: Update inbound anchors**

Rename the workflow heading to `Codex + opencode workflow` and update the historical ARCHIVE link that points at the old heading.

- [ ] **Step 3: Verify the complete change**

Run: `npm run check`

Expected: TypeScript, lint, 113+ Vitest files, agent-workflow tests, sync tests, and link checks all pass.
