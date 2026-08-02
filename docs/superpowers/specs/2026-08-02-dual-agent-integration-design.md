# Dual-agent integration workflow

**Status:** Approved design (pre-implementation)  
**Date:** 2026-08-02

## Goal

Let the user open Claude Code Desktop, Codex Desktop, or T3 Code normally and assign work without
manually coordinating commits, pulls, rebases, or merges.

The normal path must be:

> Open an app → assign one task → the agent verifies its work → GitHub merges it automatically.

The user intervenes only when checks fail, two tasks genuinely conflict, or a change needs human
judgment before merging.

## Architecture

`main` is integration-only. Neither Claude nor Codex implements work directly on it.

Each task runs in a disposable worktree on a fresh branch from `origin/main`:

- Claude: `claude/<task>`
- Codex: `codex/<task>`

Both native desktop apps keep their own worktree/session management. T3 Code remains an optional
control surface over the same Git protocol; the repository does not depend on it.

GitHub is the integration authority:

1. The agent commits only files it changed.
2. A shared finish command runs the repository verification gate.
3. The command pushes the branch, creates a pull request, and enables squash auto-merge.
4. GitHub Actions runs the same verification gate on the pull request.
5. GitHub merges after required checks pass against current `main`.
6. Conflicts or failed checks stop the automatic path and are reported instead of bypassed.

Branches do not continuously synchronize with `main`. A task starts fresh; GitHub evaluates it
against current `main` when it is ready. A branch update is required only for a real conflict or a
repository rule that requires the branch to be current.

## Repository changes

### Shared agent contract

Update the portable agent instructions and workflow cheat sheet to state:

- `main` is integration-only.
- Every implementation task uses a fresh disposable worktree and namespaced branch.
- Agents stage only files they touched.
- Agents finish through the shared command rather than asking the user to merge.
- Agents never bypass failed checks or force-push `main`.
- Parallel tasks should touch disjoint files; overlapping work becomes one-writer/one-reviewer.

Claude-only configuration may specify its native worktree defaults. Cross-tool policy remains in
`AGENTS.md`, not duplicated as divergent Claude/Codex instructions.

### Finish command

Add a small repository script exposed as `npm run finish:agent-task`. It must:

1. Refuse to run on `main` or a detached HEAD.
2. Refuse to run with uncommitted tracked or untracked changes.
3. Require an existing task commit; it does not stage or commit files automatically.
4. Run `npm run check`.
5. Push the current branch to `origin`.
6. Create a pull request when one does not exist.
7. Enable squash auto-merge and remote-branch deletion.
8. Print the pull-request URL and final state.

The script uses shell, Git, and GitHub CLI already present in the workflow. It adds no dependency.
It must fail with a concise recovery instruction when GitHub authentication is missing.

### Continuous integration

Add one GitHub Actions workflow triggered for pull requests. It installs the locked dependencies
with `npm ci` and runs `npm run check` on the supported Node version.

Configure GitHub to:

- allow squash merging and auto-merge;
- require a pull request for `main`;
- require the CI check;
- block force pushes and branch deletion;
- avoid mandatory human approval for ordinary changes.

A merge queue is deliberately excluded. Two agents do not create enough merge volume to justify
the additional configuration.

## Normal use

The user opens either native desktop app and assigns a task normally. The agent creates or uses its
isolated task worktree, implements the change, commits its own files, then runs the shared finish
command. No manual Git operation is part of the successful path.

T3 Code may launch either CLI against isolated branches and use the same finish command. Switching
interfaces does not change repository policy.

## Failure handling

- **Authentication missing:** stop before pushing and tell the user to run `gh auth login` once.
- **Dirty worktree:** stop and identify that the task must be committed before finishing.
- **Verification failure:** stop; the implementing agent fixes its branch.
- **Merge conflict:** disable the automatic path for that PR and assign one agent to reconcile both
  changes deliberately.
- **Another task merged first:** let GitHub retest the combined result; do not rebase merely because
  the branch is behind.
- **GitHub unavailable:** leave the verified local commit and report the exact retry command.

No automation may discard work, reset a branch, stage unrelated files, bypass checks, or resolve a
semantic conflict by choosing one side automatically.

## Verification

Implementation is complete when:

- the finish script rejects `main`, detached HEAD, dirty state, and missing GitHub authentication;
- its non-network decision logic has one small runnable test;
- the pull-request workflow runs `npm run check`;
- repository instructions consistently describe the new integration-only model;
- one disposable test branch completes the push → PR → CI → auto-merge path;
- both native apps can still open the project normally without a custom launcher.

## Deliberate exclusions

- No permanent `codex` or `claude` branch.
- No custom orchestration service.
- No automatic conflict resolution.
- No merge queue until pull-request volume demonstrates a need.
- No dependency on T3 Code; it remains an optional interface.
