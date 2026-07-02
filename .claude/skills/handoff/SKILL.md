---
name: handoff
description: Use when a session is approaching its context or usage limit, or has reached a clean stopping point, and work needs to resume cleanly in a fresh session instead of being cut off by a hard limit.
---

# Handoff

## Overview

Session limits and context exhaustion end sessions without warning. Recovery has historically meant
verbatim re-pasting of prior prompts, hand-carried findings tables, or feedback lost entirely across
the boundary. This skill front-loads the handoff **before** the wall hits, not after.

## When to use

- Context is visibly getting long, or a natural stopping point is reached mid-task.
- The user asks to wrap up, hand off, or "continue this in another session."
- Before starting a large new task that likely won't finish this session.

## Procedure

1. **Summarize state in 2–4 sentences**: what's done, what's uncommitted, the single concrete next step.
   Don't write a log of everything that happened — CONTINUE.md is a resume pointer, not a history.
2. **Update CONTINUE.md's summary** with that state. This is the one time to touch CONTINUE.md
   proactively — normally it's hands-off unless asked (standing convention).
3. **If mid-feature with a plan file** (`docs/superpowers/plans/*.md`), point CONTINUE.md at that
   file instead of re-describing the work — plan files have proven to carry full context cleanly
   across sessions (they're detailed enough for a fresh session to execute directly).
4. **Commit and push** whatever is done and green. Stage only files this session touched.
5. **Print the resume line** for the user to paste into a fresh session: `read CONTINUE.md and continue`.

## Common mistakes

- Waiting until the limit actually hits — by then there's no turn left to run this skill. Run it early.
- Writing a full session narrative into CONTINUE.md instead of a short pointer — bloats context on
  every future resume.
