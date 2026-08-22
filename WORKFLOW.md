# Workflow cheat sheet

Personal quick-reference. Full conventions live in [AGENTS.md](AGENTS.md); [CLAUDE.md](CLAUDE.md)
only imports them.

## Daily loop

1. **Start:** on `main`, run `npm run sync` first (stale local `main`/worktrees read as wrong state,
   not just outdated — this bit us once). Open Codex or opencode normally.
   Implementation belongs in the app's isolated task worktree, never directly on `main` — start one
   with `npm run start:agent-task -- <codex|ox> <task-name>`. Resuming prior work →
   `read CONTINUE.md and continue`.
2. **Work.** Pick a task with `/whats-next` if unsure what's highest-leverage.
3. **Finish:** ask the agent to “finish and integrate this task.” It commits its files and runs
   `npm run finish:agent-task`; the other agent reviews, then `merge:agent-task` validates and merges.
   If the session is unfinished or running long, use `/handoff` instead.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Main dev server, port 3000 — your daily driver |
| `npm run check` | `tsc --noEmit` + lint + full test suite in one shot |
| `npm run sync` | Fetch, fast-forward local `main`, prune stale worktrees — run at the start of every session on `main` |
| `npm run start:agent-task -- <codex\|ox> <task-name>` | Create a disposable worktree on a guaranteed-correct `codex/<task>`/`ox/<task>` branch off current `origin/main` |
| `npm run finish:agent-task` | Verify, push, open a PR, record the writer, and stop for reciprocal review |
| `npm run merge:agent-task -- <pr> --approve-as <codex\|ox>` | Record the expected agent's approval of the current head, require green checks, and squash-merge |
| `npm run merge:agent-task -- <pr> --user-override` | Record an explicit PR-scoped user override, require green checks, and squash-merge |
| `npm run reset:today` | Clears `today-analysis.json` so the next sync recomputes from scratch (dev server must already be running) |
| `npm run dev:preview` | Port 3100 — used automatically by Claude's preview tool, kept off your port 3000 so the two never collide |

## Codex + opencode workflow

### What is automatic

- Codex and opencode ox alpha implementation tasks use disposable worktrees based on current
  `origin/main`: `codex/<task>` and `ox/<task>`, created via `npm run start:agent-task`.
- `npm run finish:agent-task` refuses `main`, detached HEAD, unnamed branches, dirty files, failed
  checks, and missing GitHub authentication.
- On a valid committed task branch it runs `npm run check`, pushes, and opens a pull request, stamping
  the PR body `Agent: codex` or `Agent: ox` (derived from the branch prefix) so `git log` on `main`
  shows which agent shipped what without grepping branch history.
- Both prefixes stop at the PR. The other agent reviews that exact head: ox reviews `codex/*`; Codex
  reviews `ox/*`. A later commit makes the old approval stale.
- `npm run merge:agent-task` records or validates the structured current-head review marker, requires
  GitHub's required checks, and squash-merges. An explicit PR-scoped user instruction may replace the
  reciprocal review with `--user-override`; the helper records that override on the PR.
- Merged remote task branches are deleted automatically. Local worktrees/branches remain until
  `npm run sync` prunes them.

Opening or closing an app does **not** create a pull request by itself. Research, review, and planning
sessions with no committed code produce no PR. `finish:agent-task` creates the PR and
`merge:agent-task` integrates it; they are the only sanctioned path. Manual `git push`, `gh pr create`,
or `gh pr merge` skips a branch, check, or review gate and must not be used.

### Normal use

1. Open Codex or opencode normally. On `main`, run
   `npm run sync` first.
2. Start the task with `npm run start:agent-task -- <codex|ox> <task-name>`. For parallel work,
   give the other agent a task touching different files.
3. Let the agent implement and verify in its isolated worktree.
4. Say **“finish and integrate this task”** if it does not do so automatically.
5. Hand the PR number to the other agent for review, then use `merge:agent-task` as below. Run
   `npm run sync` next session to clean up the local worktree/branch.

You do not pull, merge, or rebase normal agent tasks. A branch being behind `main` is harmless unless
GitHub reports a real conflict or the combined CI check fails.

### Reviewing an agent PR

Codex and ox do not share a live session, so the PR is the handoff. The writer never approves its own
implementation.

1. For a `codex/*` PR ask ox to review; for an `ox/*` PR ask Codex.
2. The reviewer reads the real diff (`gh pr diff <n>`), not just the PR description, against:
   `AGENTS.md`'s
   4 recurring bug classes, `docs/INVARIANTS.md`, and whether every caller/persistence/UI path the
   PR's own plan doc (if any, under `docs/superpowers/plans/`) promised actually landed — or whether
   the gap is now recorded in `ROADMAP.md`/`todo.md` rather than silently missing. (This exact check
   caught the workout-library module shipping unwired and untracked, 2026-08-04 — see
   [ROADMAP.md](ROADMAP.md) Phase 4.)
3. If acceptable, the reviewer runs `npm run merge:agent-task -- <n> --approve-as <reviewer>`. This
   posts `Agent-Review: reviewer=<reviewer> head=<sha> verdict=approved`, requires green checks, and
   squash-merges. For findings, comment on the PR; the writer fixes the same branch and the reviewer
   repeats against the new head.
4. If the user explicitly says “Merge PR #`<n>` without agent review,” the active agent runs
   `npm run merge:agent-task -- <n> --user-override`. A generic “merge when done” is not an override.

### Optional joint planning

Joint planning happens only when the user asks for it. The receiving agent drafts one GitHub
issue/spec, the other agent edits or comments on that same artifact, and the receiving agent
reconciles. Factual disagreements are investigated by the agents; unresolved product or architecture
choices return to the user with options and one recommendation.

### Two agents at once

- **Disjoint files/subsystems:** Codex and ox may implement concurrently when neither ticket blocks
  the other.
- **Same files or tightly coupled behavior:** use one agent as writer and the other as reviewer.
- **Research versus implementation:** research can run anywhere read-only; only the implementation
  session owns a task branch.

### When automation stops

| Stop | What happens |
|---|---|
| Uncommitted files | Agent commits only its own files, then retries the finish command |
| Tests or lint errors | Implementing agent fixes its branch; nothing merges |
| Merge conflict | One agent reconciles both changes deliberately; never choose a side automatically |
| Agent PR awaiting review | Ask the other agent to review it, then use `merge:agent-task` |
| GitHub login expired | Run `gh auth login -h github.com` once, then retry |
| Task is unfinished | Use `/handoff`; do not open a partial PR merely to end a session |

`main` is an integration mirror, not a workspace. If a tool opens the primary checkout on `main`, use
it for reading only and start an isolated task before editing with `npm run start:agent-task`, not
`git checkout -b` run by hand in that same directory. The primary checkout is the
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
- **Concurrent sessions**: `main` is integration-only. Codex and ox work in disposable native
  worktrees; full operating guide: [Codex + opencode workflow](#codex--opencode-workflow).
- **Migration flags / "today" dates / LLM-path smoke tests / stale pointers** — the 4 recurring bug classes in
  AGENTS.md. Check them on relevant changes.

## Block-turnover runbook

**Block-turnover runbook** → moved to [docs/RECIPES.md](docs/RECIPES.md#turn-over-a-block-end--retrospective--next-block).
