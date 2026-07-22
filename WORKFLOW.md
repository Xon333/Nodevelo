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
- **Concurrent sessions**: trunk-based, direct on `main` — no per-session branches/worktrees. Stage
  only the exact files you touched (never `git add -A`); don't "fix" build errors in files you didn't
  edit — check `git status --short <file>` first, it's likely the other session mid-edit (full policy
  in CLAUDE.md).
- **Migration flags / "today" dates / LLM-path smoke tests** — the 3 recurring bug classes, now in
  AGENTS.md. Check them on relevant changes.

## Block-turnover runbook

The first turnover happened and was confirmed clean (2026-07-22 → ARCHIVE.md) — `block-history.json`
and `intervention-log.json` both exist with real entries. Kept as a reusable reference for any
future turnover, attended or not.

1. **Backup first:** `GET /api/export` → save the bundle off-machine. The retro clears `current-block.json` — this is the undo.
2. Sync (`POST /api/sync`) so the final rides are scored into the ledger.
3. `POST /api/retrospective` — **read the generated retro** (live LLM smoke run per AGENTS.md; judge the narrative + seeds for sanity).
4. Verify: `data/block-history.json` has a new entry, `days` non-empty, `nextBlockSeeds` non-empty.
5. Generate + preview + write the next block on `/plan`. `seasonFocus`/`seasonPhase` land on the NEW
   block's `current-block.json` here, not on the retrospective's `block-history.json` entry.
6. Verify: if coaching directives fired (the common case), `data/intervention-log.json` now exists with this block's directives + baselines — zero directives is a legitimate outcome (no insights cleared the model's gate that day), not a failure; `current-block.json` is the new block.
7. Confirm `/today` shows the new block's first session; the block-completion nudge is gone.
   - **If any step fails:** stop, `POST /api/import` the backup, report — do not improvise against live data.
