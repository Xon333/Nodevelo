<!-- BEGIN:nextjs-agent-rules -->
# Next.js

For changes to Next.js APIs or framework conventions, read the relevant guide in `node_modules/next/dist/docs/`. This version has breaking changes; heed deprecations.
<!-- END:nextjs-agent-rules -->

# Project context

Use [docs/COMPASS.md](docs/COMPASS.md) when you need orientation or a subsystem pointer. Read the relevant contracts in [docs/INVARIANTS.md](docs/INVARIANTS.md) when changing the ledger, persistence, dates, generation, or shared types.

- `.agents/skills/` is canonical; `.claude/skills/` contains compatibility symlinks. Edit the canonical copy.
- Use skills when their workflow is relevant: `diagnosing-bugs` for uncertain causes, `tdd` for behavioral implementation, `code-review` for reviews, and `docs-sweep` for documentation drift. Small prose or configuration edits do not require a full implementation workflow.
- Domain vocabulary and decisions live in [docs/GLOSSARY.md](docs/GLOSSARY.md) and [docs/DECISIONS.md](docs/DECISIONS.md), not separate `CONTEXT.md` or `docs/adr/` stores.
- For tracker, triage, or domain-document workflows, see [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md), [triage-labels.md](docs/agents/triage-labels.md), and [domain.md](docs/agents/domain.md), respectively.

# Completion and decisions

Carry authorized implementation through relevant verification, fixes, and the sanctioned finish workflow below. Choose routine details from existing conventions. Ask when missing information materially changes the result or an action exceeds authorization. Plan-only and review-only requests end with the requested artifact.

Use affected checks while developing and complete required integration checks. Reuse passing evidence while relevant files and the environment are unchanged; rerun when changes or unresolved concerns justify it. Report unavailable checks or baseline failures accurately.

# Recurring bug classes — check before shipping

Check these on relevant changes:

- **Migration flags:** use a truthy migrated guard (`if (profile.fooMigratedAt)`), not `=== null`; older JSON may omit the field and yield `undefined`.
- **Local today:** use `localToday()` / `resolveToday()` from `lib/date.ts` for the athlete's current day. UTC-anchored day arithmetic is fine; `toISOString().slice(0, 10)` is not local today.
- **LLM paths:** run one live API smoke test and inspect the actual output for a new or changed AI-generation path. Unit tests and builds do not exercise the prompt against the model.
- **Pointers:** when changing a `// AI:` pointer, its target heading, or a systems doc's "Known rough edges" entry, verify affected inbound and outbound links still resolve. Check existing pointers in files you touch.

# Parallel agent integration

- `main` is integration-only. On a clean primary `main`, run `npm run sync` before relying on its state. If local edits prevent syncing, preserve them, report the stale checkout, and use a fresh task worktree for implementation.
- Start implementation with `npm run start:agent-task -- codex <task-name>`, which creates a disposable `codex/<task>` worktree from current `origin/main`. Resume an existing task in its own worktree. Never use `git checkout` or `git branch -b` in the shared primary checkout to start work.
- Parallel tasks own disjoint files. For overlap, use one writer and a read-only reviewer. Joint planning is optional and user-invoked, not an implementation gate.
- Stage only task-owned files; never `git add -A` or `git add .`.
- Finish committed work with `npm run finish:agent-task`; it verifies, pushes, opens the PR, and enables squash auto-merge once required checks pass. Codex has full workflow authority; Ox/Claude implementation and reciprocal review are deprecated until the owner re-enables them.
- For an existing Codex PR, use `npm run merge:agent-task -- <pr>`. Manual `git push`, `gh pr create`, or `gh pr merge` skips the sanctioned gates and must not be used.
- Never bypass checks, force-push `main`, or automatically choose a side in a merge conflict.

Command details and troubleshooting: [WORKFLOW.md](WORKFLOW.md).
