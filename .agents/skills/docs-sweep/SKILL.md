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
| README.md | Landing page: what/why, core-idea pillars, setup, routing tables. Deep subsystem content lives in `docs/systems/`, the doc-set listing in `docs/COMPASS.md` §"The full doc set" — keep the Compass listing (not a README table) in sync whenever a doc is added or removed. |
| CONTINUE.md | Session-handoff only. Don't touch during a docs sweep unless asked — use the `handoff` skill instead. |

## Full-repo sweep scope

("sweep/restructure all the documentation" — broader than the table above.)

**In scope:** README.md, ROADMAP.md, ARCHIVE.md, todo.md, research.md, DESIGN.md, FEATURES.md,
`docs/specs/*.md`, `docs/superpowers/specs/*.md` (design specs — stamp `Status: Shipped` + a date
once built; don't leave them saying "Approved design (pre-implementation)" forever),
`knowledge-base-defaults/*.md` (the committed KB skeleton — real user-facing copy, not just a
fixture), and the docs system (2026-07-25, consolidated same day): `docs/COMPASS.md` (the single
navigation hub — keep its task table and doc-set listing current), `docs/systems/01–08-*.md` (the
numbered pipeline docs), `docs/RECIPES.md`, `docs/FILE_INDEX.md`, `docs/INVARIANTS.md`,
`docs/GLOSSARY.md`, `docs/DECISIONS.md` (append new ADR sections; existing ones are decision
records — amend with a dated note, don't rewrite), and the folder READMEs `lib/README.md`,
`components/README.md`, `app/README.md`. Ownership rules for which doc owns which fact:
`docs/COMPASS.md` §"Session rituals" closing table + §"The full doc set" — enforce them during a
sweep (a fact duplicated across docs gets one owner + links, not copies).

**Out of scope:** CONTINUE.md (see table above), CLAUDE.md/AGENTS.md (agent operating instructions
— a different category from project docs; flag as excluded rather than silently touching or
silently skipping), `docs/superpowers/plans/*.md` (point-in-time execution records, immutable like
commits — don't rewrite history).

**Doc drift from concurrent sessions:** this repo is trunk-based with a shared checkout, so a
feature can ship (with its own commit) while the docs describing it are never updated in the same
pass — cross-check `git log` against what ROADMAP/ARCHIVE claim is "open" before trusting either.

## Bloat tripwires — check these without waiting to be asked

This skill used to be purely reactive ("clean up when asked"), and the repo drifted three times
before anyone asked — ROADMAP.md reached 385 lines, todo.md reached 314, both re-accumulating
exactly the shipped-narrative bloat a 2026-07-25 sweep had just removed. These are the cheap,
mechanical signals that a sweep is due — check them with `wc -l`/`grep`, don't estimate:

- `todo.md` has grown past ~80 lines, or has any `☑` line still sitting in the "Open" section (a
  shipped item that was never archived).
- `ROADMAP.md` has grown past ~150 lines, or any bullet under an open item runs longer than 2–3
  lines of prose — that's archive-shaped rationale creeping back into the backlog, the exact
  failure mode the 2026-07-25 redesign fixed.
- `git log --oneline -20` shows a feature-shipping commit (not a docs commit) whose corresponding
  ROADMAP/todo line is still marked open — code and docs have started disagreeing.
- A `docs/superpowers/specs/*.md` still says "Approved design (pre-implementation)" for something
  `git log` already shows as shipped.

None of these are hard failures or a reason to launch a full sweep unprompted — they're a signal to
**flag one line to the user** ("todo.md's grown past its usual size, worth a sweep?") and let them
decide when to spend the session on it. `whats-next` runs this same check as a cheap side effect of
its own read of ROADMAP/todo, so the flag usually surfaces there first.

## Procedure

1. Diff intent vs. reality: check whether ROADMAP.md or todo.md still lists anything that ARCHIVE.md
   or recent git log shows as already shipped — move it.
2. Verify every ROADMAP cross-ref ID is still referenced correctly elsewhere (todo.md, README).
   Never renumber an existing ID; append new ones.
3. Trim ROADMAP prose that's now historical context rather than forward work — that belongs in
   ARCHIVE, not ROADMAP. Includes ✅-marked shipped narrative *inside* still-open items: keep only
   the "Left:" part plus a pointer to ARCHIVE. A paused/rejected investigation keeps a short stub
   in ROADMAP (decision + revisit trigger); its investigation detail moves to ARCHIVE.
4. Check WORKFLOW.md's "standing rules" against CLAUDE.md/AGENTS.md — the cheat sheet drifts when
   the underlying policy changes.
5. Update README's doc map table if the set of docs changed. One-off point-in-time reports (audits,
   transcript analyses) live under `docs/`, not the repo root — root is for living docs only.
6. Commit doc changes separately from code changes when both happened in the same session.

## Common mistakes

- Renumbering existing ROADMAP IDs — breaks cross-references elsewhere that assume stable handles.
- Leaving a shipped item listed as open because it "still has open sub-parts" — split it: the shipped
  part moves to ARCHIVE, only the genuinely unstarted remainder stays.
- Deleting a decision record while trimming — "decided against / paused / removed" entries are
  forward-relevant (they stop re-proposals) and must survive the trim, even if compressed.
- Duplicating accepted-no-fix items in both todo.md and ARCHIVE — they live in the relevant ARCHIVE
  closeout once, and todo goes back to genuinely empty.
