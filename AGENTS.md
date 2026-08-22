<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Orient first

Read [docs/COMPASS.md](docs/COMPASS.md) before exploring the codebase — it is the single navigation
hub (mental model, task router, file index pointers, traps) and replaces most exploratory file
reads. Hard contracts: [docs/INVARIANTS.md](docs/INVARIANTS.md).

# Agent skills and repository vocabulary

- `.agents/skills/` is the canonical shared skill directory. `.claude/skills/` contains compatibility
  symlinks only; edit the canonical copy.
- Use the matching installed skill for the task. Core routes: bugs → `diagnosing-bugs`; feature or
  bug implementation → `tdd`; branch/PR review → `code-review`; documentation drift →
  `docs-sweep`; before declaring completion → `verification-before-completion`.
- Generic skill references to `CONTEXT.md` and `docs/adr/` map to NodeVelo's existing
  [glossary](docs/GLOSSARY.md) and consolidated [decision log](docs/DECISIONS.md). Keep those as the
  canonical domain sources; do not create parallel context or ADR stores.
- Skill configuration: [issue tracker](docs/agents/issue-tracker.md),
  [triage labels](docs/agents/triage-labels.md), and [domain docs](docs/agents/domain.md).

# Recurring bug classes — check before shipping

Four defect shapes have shipped more than once. Check for them explicitly on relevant changes:

- **Migration flags.** Guard a new `fooMigratedAt` field with a truthy check (`if (profile.fooMigratedAt)`), never `=== null`. A JSON file written before the field existed parses back as `undefined`, not `null` — an equality check misses it and the migration silently never runs.
- **"Today" must be local, not UTC.** Use `localToday()` / `resolveToday()` from `lib/date.ts` for anything user-facing (what day is it for the athlete right now). Don't inline `new Date().toISOString().slice(0, 10)` — that's UTC and drifts a day off from the athlete's local date near midnight. (Pure day-math like `addDays`/lookback windows can stay UTC-anchored; the risk is specifically in code answering "what day is it *now* for the user.")
- **LLM-backed paths need one live smoke run.** Unit tests + a green build only prove the deterministic scaffolding around a prompt — they don't exercise the real Anthropic call. Before calling a new or changed AI-generation path "done," run it once against the live API and read the actual output.
- **Stale doc/comment pointers.** A `// AI:` comment or a doc's cross-reference (e.g. `docs/systems/05-season.md#known-rough-edges`) silently goes stale when the target section is renamed, moved, or removed — this already happened once (`lib/season.ts` pointed at a ROADMAP section a later redesign deleted). When you touch a file carrying a `// AI:` pointer or a systems doc's "Known rough edges" entry, or when you rename/remove a heading anything links to, check that every pointer to it still resolves before committing.

# Parallel agent integration

- On `main`, run `npm run sync` first (fetch + fast-forward + prune stale worktrees) — a stale local
  `main` reads as wrong state, not just outdated.
- `main` is integration-only. Start implementation work with
  `npm run start:agent-task -- <codex|ox> <task-name>`, which creates a disposable worktree on a
  guaranteed-correct `codex/<task>` or `ox/<task>` branch off current `origin/main`.
- **Never `git checkout`/`git branch -b` directly in the primary checkout to "start" a task.** It is not
  isolated — the primary checkout is the one shared directory every session for this project opens, and
  git tracks only one working-tree state per directory, so a manual branch switch there changes what
  every other concurrent session sees on disk, immediately, not just for the session that ran it.
  Confirmed live 2026-08-05: a Claude session moved uncommitted work onto a task branch by hand-running
  `git checkout -b claude/<task>` in the primary checkout instead of an isolated worktree, and that
  branch's files surfaced in the user's other open sessions. Always start an isolated worktree instead —
  `npm run start:agent-task`.
- Parallel tasks must own disjoint files. If tasks overlap, use one writer and the other agent as
  reviewer.
- Joint planning is optional and user-invoked. The receiving agent drafts one GitHub issue/spec, the
  other agent edits or comments there, and unresolved product or architecture choices go back to the
  user. It is never an implementation gate.
- Stage only files touched by the active task; never `git add -A` or `git add .`.
- Finish committed work with `npm run finish:agent-task`; it verifies, pushes, opens the PR, records
  the writer from the branch prefix, and stops for both `codex/*` and `ox/*`.
- The non-writing agent reviews the current PR head: ox reviews `codex/*`, Codex reviews `ox/*`.
  Approval must be recorded against that exact head with
  `npm run merge:agent-task -- <pr> --approve-as <codex|ox>`; a new commit requires fresh review.
- An explicit, PR-scoped user instruction may bypass reciprocal review with
  `npm run merge:agent-task -- <pr> --user-override`. Never infer an override from a general request
  to merge when done.
- `finish:agent-task` and `merge:agent-task` are the only sanctioned integration path. Manual
  `git push`, `gh pr create`, or `gh pr merge` skips the branch, check, or review gates and must not be
  used.
- Never bypass checks, force-push `main`, or automatically choose a side in a merge conflict.
