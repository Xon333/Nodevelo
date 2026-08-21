# Workflow cheat sheet

Personal quick-reference. Full conventions live in [AGENTS.md](AGENTS.md); [CLAUDE.md](CLAUDE.md)
only imports them.

## Daily loop

1. **Start:** on `main`, run `npm run sync` first (stale local `main`/worktrees read as wrong state,
   not just outdated — this bit us once). Open Claude Desktop, Codex Desktop, or T3 Code normally.
   Implementation belongs in the app's isolated task worktree, never directly on `main` — start one
   with `npm run start:agent-task -- <claude|codex> <task-name>`. Resuming prior work →
   `read CONTINUE.md and continue`.
2. **Work.** Pick a task with `/whats-next` if unsure what's highest-leverage.
3. **Finish:** ask the agent to “finish and integrate this task.” It commits its files and runs
   `npm run finish:agent-task`; GitHub checks and merges it. If the session is unfinished or running
   long, use `/handoff` instead.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Main dev server, port 3000 — your daily driver |
| `npm run check` | `tsc --noEmit` + lint + full test suite in one shot |
| `npm run sync` | Fetch, fast-forward local `main`, prune stale worktrees — run at the start of every session on `main` |
| `npm run start:agent-task -- <claude\|codex> <task-name>` | Create a disposable worktree on a guaranteed-correct `claude/<task>`/`codex/<task>` branch off current `origin/main` |
| `npm run finish:agent-task` | Verify, push, open a PR, and enable squash auto-merge for the current task branch |
| `npm run reset:today` | Clears `today-analysis.json` so the next sync recomputes from scratch (dev server must already be running) |
| `npm run dev:preview` | Port 3100 — used automatically by Claude's preview tool, kept off your port 3000 so the two never collide |

## Hybrid Claude + Codex workflow

### What is automatic

- Claude and Codex implementation tasks use disposable worktrees based on current `origin/main`:
  `claude/<task>` and `codex/<task>`, created via `npm run start:agent-task`.
- `npm run finish:agent-task` refuses `main`, detached HEAD, unnamed branches, dirty files, failed
  checks, and missing GitHub authentication.
- On a valid committed task branch it runs `npm run check`, pushes, and opens a pull request, stamping
  the PR body `Agent: claude` or `Agent: codex` (derived from the branch prefix) so `git log` on `main`
  shows which agent shipped what without grepping branch history.
- `claude/*` branches then get squash auto-merge enabled immediately. `codex/*` branches do **not** —
  the PR is opened and left there; see "Reviewing a codex PR" below.
- GitHub repeats `npm run check`; protected `main` merges only after that check passes (for `claude/*`
  branches, this and the Claude review already done in-session are the only gates). Merged remote task
  branches are deleted automatically — **local** worktrees/branches are not; `npm run sync` prunes
  those.

Opening or closing an app does **not** create a pull request by itself. Research, review, and planning
sessions with no committed code produce no PR. The finish command is the integration trigger — and the
*only* sanctioned one. A manual `git push` + `gh pr create`/`gh pr merge` skips both the branch-naming
and check gates; it has happened once (a bare `codex` branch, PR #3) and must not recur for either
agent.

### Normal use

1. Open either desktop app normally, or select Claude/Codex inside T3 Code. On `main`, run
   `npm run sync` first.
2. Start the task with `npm run start:agent-task -- <claude|codex> <task-name>`. For parallel work,
   give the other agent a task touching different files.
3. Let the agent implement and verify in its isolated worktree.
4. Say **“finish and integrate this task”** if it does not do so automatically.
5. **Claude tasks:** GitHub owns the rest — PR → CI → squash merge → remote branch cleanup.
   **Codex tasks:** the PR opens but waits — see "Reviewing a codex PR" below. Run `npm run sync` next
   session to clean up the local worktree/branch either way.

You do not pull, merge, or rebase normal agent tasks. A branch being behind `main` is harmless unless
GitHub reports a real conflict or the combined CI check fails.

### Reviewing a codex PR

Codex and Claude don't share a live session — there's no direct link for one to ask the other to
review in real time. The PR itself is the handoff: `finish:agent-task` opens it and stops instead of
auto-merging, and a human asks a Claude session (any session, any time later) to review it before it
merges.

1. Ask Claude: "review PR #`<n>`."
2. Claude reads the real diff (`gh pr diff <n>`), not just the PR description, against: `AGENTS.md`'s
   4 recurring bug classes, `docs/INVARIANTS.md`, and whether every caller/persistence/UI path the
   PR's own plan doc (if any, under `docs/superpowers/plans/`) promised actually landed — or whether
   the gap is now recorded in `ROADMAP.md`/`todo.md` rather than silently missing. (This exact check
   caught the workout-library module shipping unwired and untracked, 2026-08-04 — see
   [ROADMAP.md](ROADMAP.md) "Later.")
3. Approve + merge: `gh pr merge --squash <n>`. Send back: `gh pr review <n> --request-changes -b
   "..."` — Codex reads the review comments next session.

### Two agents at once

- **Disjoint files/subsystems:** Claude and Codex may implement concurrently.
- **Same files or tightly coupled behavior:** use one agent as writer and the other as reviewer.
- **Research versus implementation:** research can run anywhere read-only; only the implementation
  session owns a task branch.
- T3 Code is an optional control surface. It follows the same branch and finish-command contract; the
  repository does not depend on T3 Code.
- **Dry-run exercised 2026-08-15 (PRs #72–#74, detail in [ARCHIVE.md](ARCHIVE.md)).** The mechanical
  half held under real simultaneous access: `codex/*` and `claude/*` worktrees created off the same
  `origin/main` at once, a real `codex` process running independently while a genuine Claude task ran
  concurrently in a separate worktree, and `finish:agent-task`'s per-prefix behavior (`claude/*`
  auto-merges, `codex/*` opens a PR and stops) both fired correctly. The same-file writer/reviewer
  fallback held too — Codex was the sole writer on one file, Claude never opened a competing branch on
  it, only reviewed the finished PR. **Still not proven:** genuine two-human/two-session concurrency —
  this run was single-orchestrator (one Claude session drove both agents via headless `codex exec`),
  so races a live human-driven Codex Desktop/T3 Code session might introduce weren't exercised.

### When automation stops

| Stop | What happens |
|---|---|
| Uncommitted files | Agent commits only its own files, then retries the finish command |
| Tests or lint errors | Implementing agent fixes its branch; nothing merges |
| Merge conflict | One agent reconciles both changes deliberately; never choose a side automatically |
| Codex PR awaiting review | Ask Claude to review it (above), then merge or request changes manually |
| GitHub login expired | Run `gh auth login -h github.com` once, then retry |
| Task is unfinished | Use `/handoff`; do not open a partial PR merely to end a session |

`main` is an integration mirror, not a workspace. If a tool opens the primary checkout on `main`, use
it for reading only and start an isolated task before editing — meaning `npm run start:agent-task` or
`EnterWorktree`, not `git checkout -b` run by hand in that same directory. The primary checkout is the
one shared directory every session for this project opens; git holds only one working-tree state per
directory, so a manual branch switch there is visible to every other concurrent session on disk,
instantly (bit us once, 2026-08-05 — see `AGENTS.md` § Parallel agent integration).

## Skills (`/name`)

| Skill | Use when |
|---|---|
| `/whats-next` | "What should we work on?" — reads ROADMAP + todo, ranks by leverage, can split across two sessions |
| `/diagnosing-bugs` | A bug is broken, failing, or slow — establish a tight reproduction before theorising |
| `/tdd` | Implement a feature or bug fix in red → green vertical slices |
| `/code-review` | Review a branch or PR against both repository standards and its originating spec |
| `/hostile-review` | The "senior dev who hates this implementation" review → assigns IDs → routes into todo.md |
| `/docs-sweep` | README/ROADMAP/ARCHIVE/todo have drifted or need restructuring |
| `/triage-audit` | You pasted a big external AI review/audit and want it ground-truthed before acting on it |
| `/handoff` | Wrapping up, or the session's getting long — hand off cleanly instead of losing state to a limit |
| `/verification-before-completion` | Before claiming a task is fixed, complete, or passing |

## Standing rules worth remembering

- **CONTINUE.md** is hands-off except via `/handoff` — don't let a session rewrite it proactively.
- **ROADMAP IDs** (`#1–4`, `§5–7`, `Track A–C`) — append new ones, never renumber; other docs link to them.
- **Concurrent sessions**: `main` is integration-only. Claude and Codex work in disposable native
  worktrees; full operating guide: [Hybrid Claude + Codex workflow](#hybrid-claude--codex-workflow).
- **Migration flags / "today" dates / LLM-path smoke tests / stale pointers** — the 4 recurring bug classes in
  AGENTS.md. Check them on relevant changes.

## Block-turnover runbook

**Block-turnover runbook** → moved to [docs/RECIPES.md](docs/RECIPES.md#turn-over-a-block-end--retrospective--next-block).
