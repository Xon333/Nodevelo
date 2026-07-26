---
name: whats-next
description: Use when asked what to work on next, to check the roadmap for priorities, or to suggest the next task — including splitting work across two concurrent sessions.
---

# What's Next

## Overview

ROADMAP.md is the actual work dispatcher for this project. Since the 2026-07-25 redesign it's
already pre-ranked (⚑ State of the app → 🎯 Do this → Then → Blocked/dormant → Watch → Later) —
this skill's job is mostly to read that structure correctly and sanity-check it, not to re-derive a
leverage ranking from scratch the way it used to when ROADMAP was one long undifferentiated list.

## Procedure

1. Read [ROADMAP.md](../../../ROADMAP.md)'s **"⚑ State of the app"** banner first. It carries a "Last verified" date and
   the live data-maturity state (e.g. a verdict-maturation date). If that date is old, or a stated
   milestone has already passed, say so before recommending anything — the rest of the doc may be
   answering a question that's since changed.
2. **Piggybacked docs-health check** (cheap, not a separate task): while ROADMAP.md/todo.md are
   open, check them against `docs-sweep`'s "Bloat tripwires" (`.claude/skills/docs-sweep/SKILL.md`)
   — todo.md past ~80 lines or a `☑` stuck in Open, ROADMAP.md past ~150 lines or an item running
   long. If one trips, add a single line to your answer. Don't act on it, don't let it delay the
   recommendation below.
3. **todo.md P1 items (correctness / data-integrity) outrank ROADMAP feature work regardless of
   roadmap position.** Check [todo.md](../../../todo.md) first.
4. **Trust ROADMAP's own ranking as the default — don't re-derive it.** "🎯 Do this" is the
   pre-computed top recommendation; "Then" is the pre-computed ranked runner-up queue. Only
   override that order if you have a concrete, stated reason it's now stale (the keystone item
   already shipped since the doc was last verified, a "Blocked / dormant" item's condition has
   since cleared, etc.) — name the reason explicitly if you do.
5. **Never propose a "Blocked / dormant" item as ready work.** If the user asks about one, answer
   with what it's blocked on (straight from that table), not a workaround.
6. **Surface known rough edges for whatever you recommend.** Check [docs/COMPASS.md](../../../docs/COMPASS.md)'s
   "Session rituals" section for the current list of systems docs carrying real "Known rough edges"
   content. If the recommended item touches one of those areas, add a one-line pointer (e.g.
   "season work carries a live tripwire condition — see
   [docs/systems/05-season.md#known-rough-edges](../../../docs/systems/05-season.md#known-rough-edges)
   before starting"). Skip this for anything outside that list — don't invent a caveat that isn't
   documented.
7. Present the top item with a one-line "why this" (plus its known-rough-edges pointer, if any),
   plus 1–2 runner-up alternatives pulled from "Then" — the user regularly asks for exactly this
   shape ("suggest 1 for you to work on and one so there's another").
8. If the user mentions a second/concurrent session, split the recommendation into two independent
   lanes that touch disjoint files, and write the second lane as a ready-to-paste instruction block
   for that session.
9. Wait for the user to pick before starting build work.

## Common mistakes

- Re-deriving a leverage ranking from scratch instead of trusting ROADMAP's pre-computed "Do
  this"/"Then" order — the 2026-07-25 redesign already did that work; don't redo it every session.
- Recommending an item that's actually listed under "Blocked / dormant."
- Proposing two lanes that touch overlapping files — defeats the point of the split.
- Launching a full docs-sweep unprompted because a tripwire fired — flag it in one line and wait,
  same as any other recommendation in this skill.
- Inventing a "known rough edges" caveat for an area that doesn't have real documented content —
  check COMPASS's current list rather than assuming or guessing.
