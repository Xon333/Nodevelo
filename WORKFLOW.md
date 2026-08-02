# Workflow cheat sheet

Personal quick-reference. Full conventions live in [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md);
this is just the daily-use summary.

## Daily loop

1. **Start:** `npm run dev` (port 3000). Resuming prior work → `read CONTINUE.md and continue`.
2. **Work.** Pick a task with `/whats-next` if unsure what's highest-leverage.
3. **Before ending, or if a session is running long** → run `/handoff` (updates CONTINUE.md, commits,
   pushes, gives you the resume line). Don't wait for the limit to hit.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Main dev server, port 3000 — your daily driver |
| `npm run check` | `tsc --noEmit` + lint + full test suite in one shot |
| `npm run finish:agent-task` | Verify, push, open a PR, and enable squash auto-merge for the current task branch |
| `npm run reset:today` | Clears `today-analysis.json` so the next sync recomputes from scratch (dev server must already be running) |
| `npm run dev:preview` | Port 3100 — used automatically by Claude's preview tool, kept off your port 3000 so the two never collide |

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
  worktrees on namespaced branches, then run `npm run finish:agent-task`; GitHub checks and merges
  automatically. Assign overlapping files to one writer and use the other agent as reviewer.
- **Migration flags / "today" dates / LLM-path smoke tests** — the 3 recurring bug classes, now in
  AGENTS.md. Check them on relevant changes.

## Block-turnover runbook

**Block-turnover runbook** → moved to [docs/RECIPES.md](docs/RECIPES.md#turn-over-a-block-end--retrospective--next-block).
