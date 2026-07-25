---
name: whats-next
description: Use when asked what to work on next, to check the roadmap for priorities, or to suggest the next task — including splitting work across two concurrent sessions.
---

# What's Next

## Overview

ROADMAP.md is the actual work dispatcher for this project. This skill standardizes how "what should
we work on next" gets answered instead of re-deriving the ranking logic each time.

## Procedure

1. Read [ROADMAP.md](../../../ROADMAP.md) (stable IDs #1–4, §5–7, Tracks A–C) and
   [todo.md](../../../todo.md).
2. **Piggybacked docs-health check (cheap, not a separate task):** while both files are open, check
   them against `docs-sweep`'s "Bloat tripwires" (`.claude/skills/docs-sweep/SKILL.md`) — todo.md
   past ~80 lines or a `☑` stuck in Open, ROADMAP.md past ~150 lines or an item running long. If one
   trips, add a single line to your answer ("todo.md's grown past its usual size — worth a sweep
   sometime?"). Don't act on it and don't let it delay the actual recommendation below.
3. **todo.md P1 items (correctness / data-integrity) outrank ROADMAP feature work regardless of
   roadmap position.** Check todo.md first.
4. Rank remaining open items by leverage against the project's stated goal (ROADMAP.md's opening
   line — the coaching-layer thesis), not by recency or ease of implementation.
5. Present the top item with a one-line "why this," plus 1–2 runner-up alternatives — the user
   regularly asks for exactly this shape ("suggest 1 for you to work on and one so there's another").
6. If the user mentions a second/concurrent session, split the recommendation into two independent
   lanes that touch disjoint files, and write the second lane as a ready-to-paste instruction block
   for that session.
7. Wait for the user to pick before starting build work.

## Common mistakes

- Recommending by roadmap position instead of leverage — the roadmap is roughly but not strictly
  ordered.
- Proposing two lanes that touch overlapping files — defeats the point of the split.
- Launching a full docs-sweep unprompted because a tripwire fired — flag it in one line and wait,
  same as any other recommendation in this skill.
