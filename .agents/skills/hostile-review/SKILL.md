---
name: hostile-review
description: Use when asked to critically review the repo or recent diffs as a skeptical senior engineer, find edge cases, or route review findings into a fixable backlog.
---

# Hostile Review

## Overview

The recurring review ritual for this project: run a skeptical, edge-case-hunting review, assign each
finding a stable ID, route every finding into todo.md, and burn the list down with atomic commits.

## Procedure

1. **Scope.** Whole repo, or recent diffs (`HEAD~N..HEAD`)? Confirm if the request is ambiguous.
2. **Run the review.** Prefer `/code-review` at high or xhigh effort (multi-angle Agent fan-out) over
   an inline read — in this project's own history, xhigh with real dispatched subagents found
   materially more than earlier inline or pasted-formula attempts at the same review.
3. **Assign stable IDs.** Short letter/number series (e.g. `CR-1`, `RV-A`). If this is a second review
   round on the same area, **append** new IDs — never renumber an existing series.
4. **Write every finding into todo.md** in the house format — see the `docs-sweep` skill for the exact
   template (Status/Priority/Type bullet, bolded one-line summary, file refs in backticks).
5. **Recount before reporting done.** Count the findings in the review output and count the todo.md
   entries you just wrote — they must match. A past review round silently dropped 1 of 16 findings
   during this transcription step; it was caught only because the user asked to double-check.
6. **Propose a burn-down order** (P1 correctness first) and start on the ones that don't need user
   input, per standing instruction.

## Common mistakes

- Dropping a finding during review→todo transcription — always recount.
- Renumbering old IDs when a second review round touches the same area — append instead, so earlier
  cross-references (commits, prior todo entries) stay valid.
