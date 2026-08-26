# Lean Skill Stack Implementation Plan

**Goal:** Consolidate overlapping skills while preserving the approved workflows.

**Architecture:** One global orchestration skill owns parallel and sequential execution. One project review skill owns review modes. One project web-quality umbrella owns broad quality routing. Live routers point only at retained skills.

## Task 1: Merge workflows

- [ ] Create and validate `agent-orchestration` from the three shared orchestration skills.
- [ ] Add skeptical, request, and feedback modes to `code-review` and validate it.
- [ ] Make `web-quality-audit` self-contained for broad audits.

## Task 2: Retire duplicates safely

- [ ] Update `ask-matt`, `writing-plans`, workflow docs, links, and compatibility symlinks.
- [ ] Archive redundant shared skill entrypoints and remove redundant project skill directories.
- [ ] Search for stale live pointers and verify the final inventory.
