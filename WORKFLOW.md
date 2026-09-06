# Workflow cheat sheet

[AGENTS.md](AGENTS.md) owns operating rules. [CLAUDE.md](CLAUDE.md) imports it; keep policy changes in the shared file.

## Daily loop

Start or resume an isolated task, implement the requested outcome, verify it, and finish through the sanctioned helper. On clean primary `main`, `npm run sync` refreshes the integration mirror and prunes merged worktrees. Preserve local edits if sync is blocked; task creation fetches current `origin/main` independently.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local development server on port 3000 |
| `npm run dev:preview` | Isolated preview server on port 3100 |
| `npm run check` | Typecheck, lint, application tests, workflow tests, sync tests, and documentation links |
| `npm run check-links` | Check project documentation links |
| `npm run sync` | Refresh clean primary main and prune merged worktrees |
| `npm run start:agent-task -- codex <task-name>` | Create an isolated Codex task from current origin/main |
| `npm run finish:agent-task` | Verify committed task work, push, open a PR, and enable squash auto-merge after required checks |
| `npm run merge:agent-task -- <pr>` | Check and merge an existing Codex PR |
| `npm run reset:today` | Clear today's cached analysis through the local dev server |

## Codex workflow

Codex owns implementation and integration. Ox/Claude reciprocal-review gates are deprecated. The sanctioned helpers retain branch, clean-tree, authentication, and verification checks; no manual push, PR creation, or merge commands bypass them.

Run commands from the task worktree. Stage only task-owned files and commit before finishing. Inspect the resulting PR status: enabling auto-merge is not confirmation that the PR has merged. A new commit requires checks against the updated head. Merged remote branches are removed by repository settings; local task cleanup happens through sync.

The current owner policy is recorded in AGENTS.md. If an older checkout's helpers still require reciprocal review, use the owner's current sanctioned helper when available. Do not invent a review marker or bypass checks. Report a helper/policy mismatch if the current helper is unavailable.

### Codex + opencode workflow

Legacy links to this heading refer to the [current Codex workflow](#codex-workflow).

### Reviewing an agent PR

Inspect the actual diff against the requested behavior and affected repository contracts. Check relevant recurring bug classes from AGENTS.md and that promised callers, persistence, and UI paths are wired. Record genuinely unfinished scope in ROADMAP or todo. Fix substantive findings and rerun affected checks before finishing. An outside review is optional unless the owner explicitly requests it.

### Optional joint planning

Joint planning is user-invoked. Work from one shared issue or spec and bring unresolved product decisions to the user. It is not a prerequisite for routine implementation.

### Two agents at once

Independent tasks may use separate Codex worktrees with disjoint file ownership. Overlapping work uses one writer and a read-only reviewer. Research and review can inspect files without owning an implementation branch.

### When automation stops

| Situation | Next action |
|---|---|
| Uncommitted task files | Review and commit only task-owned files, then retry |
| Failed checks | Fix regressions caused by the task; identify unrelated failures without claiming a pass |
| Merge conflict | Reconcile both changes deliberately; use the merge-conflict skill |
| Required checks pending | Wait for the PR's checks; inspect failures if they occur |
| GitHub login expired | Report the required login step and continue independent local work |
| Task blocked | Report the concrete blocker and completed work; use handoff only when a handoff is requested |

## Skills (`/name`)

| Skill | Use when |
|---|---|
| `/whats-next` | Choose work from the roadmap |
| `/agent-orchestration` | Coordinate useful independent delegated tasks |
| `/diagnosing-bugs` | Investigate a bug with an uncertain cause |
| `/tdd` | Implement behavior through a meaningful red/green test loop |
| `/code-review` | Review a diff or verify received feedback |
| `/docs-sweep` | Reconcile documentation with shipped state |
| `/triage-audit` | Evaluate an external audit against the repository |
| `/handoff` | Prepare a requested handoff |

## Standing rules worth remembering

CONTINUE.md is maintained through handoff. Preserve stable roadmap IDs. Navigation and documentation ownership are in [Compass](docs/COMPASS.md#session-rituals); operating safeguards are in [AGENTS.md](AGENTS.md).

## Block-turnover runbook

See [Recipes](docs/RECIPES.md#turn-over-a-block-end--retrospective--next-block).
