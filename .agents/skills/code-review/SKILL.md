---
name: code-review
description: Review a PR, branch, working diff, or received feedback for actionable defects and unmet requirements.
---

# Code Review

Establish the requested review target. Use an explicit base when supplied, the PR's base for a PR, the merge-base with the repository's integration branch for a branch, and staged/unstaged changes for a working-diff review. State the chosen scope; ask only if plausible alternatives materially change it. Pin relevant SHAs for committed work and inspect the actual diff.

Review both correctness and compliance with the requested behavior. Find requirements in the user request, linked issue, or relevant spec. If no spec is available, report that limit and continue the defect review. Use [issue-tracker configuration](../../../docs/agents/issue-tracker.md) when retrieving issues; an unavailable tracker need not block a local review.

Read the relevant repository contracts and nearby callers. Prioritize defects that affect behavior, data integrity, security, concurrency, migrations, local dates, or required integration. Treat design smells as hypotheses: report them only with a concrete consequence, and distinguish optional improvements from defects. Skip stylistic findings already enforced by tooling.

Scale review depth and delegation to the change. An explicitly requested independent review uses a separate reviewer when available; otherwise report that limitation. Parallel review can help with substantial independent areas, but two reviewers are not required for every diff. Give reviewers a bounded scope, requirements, diff range, and relevant constraints. Verify their findings against the code.

Report actionable findings with severity, a precise file/line, the trigger, and the consequence. Distinguish unmet requirements from other defects without duplicating findings. State review scope and verification limits when reporting no findings. Reviews alone do not authorize edits or external messages.

For received feedback, verify each suggestion against current code, tests, and recorded decisions. Implement accepted changes when authorized, with focused verification; explain rejected suggestions with evidence. Ask about ambiguity only when it affects the result.

When the user requests a backlog, record accepted findings in the repository's format, preserve stable IDs, and verify that each accepted finding is represented. Follow the sanctioned integration workflow for implementation tasks; review does not create a new approval gate.
