---
name: docs-sweep
description: Use when asked to review, restructure, or clean up the project's documentation (README, ROADMAP, ARCHIVE, todo, FEATURES) for clarity, or when docs have drifted from what's actually shipped.
---

# Docs Sweep

## Overview

Encodes this repo's documentation conventions so any session — including subagents with no other
context — applies them the same way.

## Conventions

| File | Rule |
|---|---|
| ROADMAP.md | **Forward-only**: open work only. Anything shipped moves out to ARCHIVE.md. Keep stable cross-ref IDs (`#1–4`, `§5–7`, `Track A–C`) — other docs link to these; append new IDs, never renumber. |
| ARCHIVE.md | Everything shipped, grouped by theme, one-line record plus enough detail to find the commit. |
| todo.md | Lean live punch-list only. Legend: Status `☐`/`◑`/`☑`, Priority `P1` correctness/data-integrity > `P2` UX/feature > `P3` polish. On ship, move the line to ARCHIVE.md. |
| README.md | Architectural manual. Keep the "Documentation map" table in sync whenever a doc is added or removed. |
| CONTINUE.md | Session-handoff only. Don't touch during a docs sweep unless asked — use the `handoff` skill instead. |

## Procedure

1. Diff intent vs. reality: check whether ROADMAP.md or todo.md still lists anything that ARCHIVE.md
   or recent git log shows as already shipped — move it.
2. Verify every ROADMAP cross-ref ID is still referenced correctly elsewhere (todo.md, README).
   Never renumber an existing ID; append new ones.
3. Trim ROADMAP prose that's now historical context rather than forward work — that belongs in
   ARCHIVE, not ROADMAP.
4. Update README's doc map table if the set of docs changed.
5. Commit doc changes separately from code changes when both happened in the same session.

## Common mistakes

- Renumbering existing ROADMAP IDs — breaks cross-references elsewhere that assume stable handles.
- Leaving a shipped item listed as open because it "still has open sub-parts" — split it: the shipped
  part moves to ARCHIVE, only the genuinely unstarted remainder stays.
