# Lean Skill Stack Design

## Goal

Reduce skill-selection overhead without removing workflows the user relies on.

## Decisions

- Keep `ask-matt` as the human-invoked router.
- Replace `dispatching-parallel-agents`, `subagent-driven-development`, and `executing-plans` with one shared `agent-orchestration` skill.
- Keep project-local `tdd` and `diagnosing-bugs`; retire the shared duplicates.
- Expand project-local `code-review` with skeptical review, review-request, and feedback-evaluation modes; retire their separate skills.
- Keep `web-quality-audit` as the umbrella. Retire `best-practices` and `core-web-vitals`; keep the optional focused `accessibility`, `performance`, and `seo` skills.
- Retire `using-superpowers`; skill routing remains explicit in `AGENTS.md` and `ask-matt`.
- Keep every optional domain skill the user selected.

## Migration

Update live routers and references before retiring old entry points. Preserve historical plans and archive text. Archive shared skill entrypoints recoverably instead of permanently erasing them.

## Verification

- Validate changed and new skills with the Codex skill validator.
- Search live workflow files for retired names.
- Confirm the final discovered inventory contains the merged skills and omits retired entrypoints.
