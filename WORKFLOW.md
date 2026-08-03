# Workflow cheat sheet

Personal quick-reference. Full conventions live in [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md);
this is just the daily-use summary.

## Daily loop

1. **Start:** open Claude Desktop, Codex Desktop, or T3 Code normally. Implementation belongs in the
   app's isolated task worktree, never directly on `main`. Resuming prior work →
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
| `npm run finish:agent-task` | Verify, push, open a PR, and enable squash auto-merge for the current task branch |
| `npm run reset:today` | Clears `today-analysis.json` so the next sync recomputes from scratch (dev server must already be running) |
| `npm run dev:preview` | Port 3100 — used automatically by Claude's preview tool, kept off your port 3000 so the two never collide |

## Hybrid Claude + Codex workflow

### What is automatic

- Claude and Codex implementation tasks use disposable worktrees based on current `origin/main`:
  `claude/<task>` and `codex/<task>`.
- `npm run finish:agent-task` refuses `main`, detached HEAD, unnamed branches, dirty files, failed
  checks, and missing GitHub authentication.
- On a valid committed task branch it runs `npm run check`, pushes, opens a pull request, and enables
  squash auto-merge.
- GitHub repeats `npm run check`; protected `main` merges only after that check passes. Merged remote
  task branches are deleted automatically.

Opening or closing an app does **not** create a pull request by itself. Research, review, and planning
sessions with no committed code produce no PR. The finish command is the integration trigger.

### Normal use

1. Open either desktop app normally, or select Claude/Codex inside T3 Code.
2. Give it one bounded task. For parallel work, give the other agent a task touching different files.
3. Let the agent implement and verify in its isolated worktree.
4. Say **“finish and integrate this task”** if it does not do so automatically.
5. GitHub owns the rest: PR → CI → squash merge → remote branch cleanup.

You do not pull, merge, or rebase normal agent tasks. A branch being behind `main` is harmless unless
GitHub reports a real conflict or the combined CI check fails.

### Two agents at once

- **Disjoint files/subsystems:** Claude and Codex may implement concurrently.
- **Same files or tightly coupled behavior:** use one agent as writer and the other as reviewer.
- **Research versus implementation:** research can run anywhere read-only; only the implementation
  session owns a task branch.
- T3 Code is an optional control surface. It follows the same branch and finish-command contract; the
  repository does not depend on T3 Code.

### When automation stops

| Stop | What happens |
|---|---|
| Uncommitted files | Agent commits only its own files, then retries the finish command |
| Tests or lint errors | Implementing agent fixes its branch; nothing merges |
| Merge conflict | One agent reconciles both changes deliberately; never choose a side automatically |
| GitHub login expired | Run `gh auth login -h github.com` once, then retry |
| Task is unfinished | Use `/handoff`; do not open a partial PR merely to end a session |

`main` is an integration mirror, not a workspace. If a tool opens the primary checkout on `main`, use
it for reading only and start an isolated task before editing.

## Skills (`/name`)

| Skill | Use when |
|---|---|
| `/whats-next` | "What should we work on?" — reads ROADMAP + todo, ranks by leverage, can split across two sessions |
| `/hostile-review` | The "senior dev who hates this implementation" review → assigns IDs → routes into todo.md |
| `/docs-sweep` | README/ROADMAP/ARCHIVE/todo have drifted or need restructuring |
| `/triage-audit` | You pasted a big external AI review/audit and want it ground-truthed before acting on it |
| `/handoff` | Wrapping up, or the session's getting long — hand off cleanly instead of losing state to a limit |

## Standing rules worth remembering

- **CONTINUE.md** is hands-off except via `/handoff` — don't let a session rewrite it proactively.
- **ROADMAP IDs** (`#1–4`, `§5–7`, `Track A–C`) — append new ones, never renumber; other docs link to them.
- **Concurrent sessions**: `main` is integration-only. Claude and Codex work in disposable native
  worktrees; full operating guide: [Hybrid Claude + Codex workflow](#hybrid-claude--codex-workflow).
- **Migration flags / "today" dates / LLM-path smoke tests** — the 3 recurring bug classes, now in
  AGENTS.md. Check them on relevant changes.

## Block-turnover runbook

**Block-turnover runbook** → moved to [docs/RECIPES.md](docs/RECIPES.md#turn-over-a-block-end--retrospective--next-block).
