# Season Architecture Redesign — Design

**Date:** 2026-07-17
**Status:** Design approved, not yet planned/implemented
**ROADMAP:** ties `6a` `§7` `#4` `#2`; supersedes the rolling-mode portion of
`2026-07-01-macro-periodization-design.md` and the four 2026-07-15 season plans
(`season-critical-fixes`, `season-coverage-selector`, `season-macro-structure`,
`block-generation-measurability`'s season-adjacent pieces). Event-anchored mode from those
designs is **kept**, not superseded.

---

## 1. Problem & context

The current season engine (shipped 2026-07-01 through 2026-07-16, four redesign plans) models a season
as a persisted sequence of **focus periods** — labeled mesocycles (`aerobic-base`, `threshold`, `vo2max`,
`anaerobic`, `durability`, `sharpen`) with fixed KB-default lengths, forced periodic base re-touches (arc
caps), a rolling deload cadence, and genuine multi-week season breaks (transitions). `replanSeasonArc`
redrafts the future tail of this sequence on every `/api/generate` call, preserving frozen/current/override
periods verbatim.

This was deliberately disabled from shaping generation on 2026-07-16 (`SEASON_SHAPES_GENERATION = false`,
`lib/season.ts`) after the athlete's first real block on the redesigned engine surfaced multiple defects.
A same-day hostile review (`docs/superpowers/plans/2026-07-16-block-generation-fidelity.md`,
`todo.md` HR-16..HR-30) fixed 15 findings, but surfaced a deeper, repeated pattern: **the machinery that
tracks state across replan calls (arc-cap counters, deload-cadence counters, transition clocks) has been
the single largest source of correctness bugs in this codebase across the last three sessions** — most
recently HR-22 today, where the "genuine rolling calendar-week deload count" fixed hours earlier turned
out to reset to zero on every replan because the counter was never actually threaded across calls.

Separately, the model has a structural gap unrelated to any of those bugs: `needsBaseGate` — the rule
deciding whether the next drafted period should be a forced aerobic-base touch — looks *only* at the
app's own recent period-label history, never at any real fitness signal (CTL, training history, FTP). A
brand-new athlete with a genuinely deep aerobic base gets force-fed a base period on their very first
draft, because the label history is empty, regardless of their actual fitness.

This design addresses both: the fragile cross-call state machinery, and the "doesn't reflect the real
athlete" gap — for the **rolling (no upcoming A-event) case**, which is where both problems concentrate
and where the vast majority of blocks are generated.

## 2. Goals / non-goals

**Goals**
- Replace the rolling-mode period sequence with **continuous, signal-driven focus selection** — every
  real generation call decides the next block's focus fresh, from real data, using machinery that already
  exists (`scoreFocusCandidates`/`selectBuildFocus`).
- Eliminate cross-call state for the rolling case entirely. Nothing about "what's next" is stored between
  `/api/generate` calls; everything is re-derived from real, already-durable data (ride history, block
  history) every time.
- Fix the base-gate problem by construction: `aerobic-base` becomes a normal competing candidate scored
  by the same signals as every other focus, not a special-cased rule keyed to the app's own bookkeeping.
- Replace deload-cadence bookkeeping with a **hard-capped, real-data-derived recovery check**: never more
  than 4 real calendar weeks without a recovery week, computed fresh from actual training history at
  block-generation time.
- Keep a forward-looking roadmap view on `/plan`, but as a stateless, clearly-labeled projection —
  computed fresh on demand, never persisted, never gating real generation.
- Enrich block history (real execution outcomes, persisted protocol violations) so the above signals get
  more accurate as real data accumulates over time, and so future features have a self-contained record
  to build on.

**Non-goals**
- Event-anchored mode (a real upcoming A-priority race) is **not** being redesigned. It keeps its own
  persisted, backward-scheduled build→peak→taper sequence, largely as shipped 2026-07-15. It already uses
  the scored selector for its build slots, so it inherits the base-gate fix (§4) without extra work; its
  peak/taper load-shaping is untouched.
- A distinct, multi-week "genuine season break" (transition) concept, separate from a single recovery
  week, is explicitly **out of scope for now** — folded into the same single-week recovery mechanism.
  Revisit only if a real need for a harder multi-week break shows up in practice (athlete decision,
  2026-07-17).
- **Proven-workout reuse** (writing well-executed sessions to Intervals.icu's own workout library, and
  having generation pull from it) is a separate, already-tracked ROADMAP idea with its own design surface
  (selection criteria, how generation consumes a library entry, the Intervals.icu API). Deliberately split
  out of this design (athlete decision, 2026-07-17) — a future design session, building on the enriched
  history this one produces.
- Checking the recovery hard-cap mid-block (after a block is already generated and sitting unwritten) is
  out of scope — the check runs once, at generation time, per athlete decision.
- Season "objective" text and the event calendar (`SeasonEvent[]`) are unchanged — this design only
  touches the derived `periods` layer.

## 3. Approach

Three approaches were considered:

- **(A) Score everything, persist nothing, including event mode** — the most complete simplification
  (peak/taper absorbed into the same continuous scorer as a specificity-weighting effect), but the
  biggest rewrite, and it disturbs the event-anchored path, which is comparatively well-tested and not
  where the doubt or the bugs concentrate.
- **(B) Continuous for rolling, keep event-anchored phasing** — **chosen.** Resolves all three named
  concerns (doesn't fit real riders / machinery keeps breaking / redundant with the scored selector) for
  the case that generates almost every block, without rewriting the event path for reasons that don't
  really apply to it.
- **(C) Adaptive periods** — keep the persisted period data structure and roadmap UI as-is, replace only
  the fixed rules inside it (base-gate, deload cadence) with signal-driven versions. Fixes "doesn't fit
  real riders" but leaves the fragile cross-call state machinery (arc caps, deload counters, transition
  timing) fully in place — the actual source of the repeated bugs survives untouched.

Approach B is the design below.

## 4. Real generation: `chooseNextFocus`

Replaces "redraft periods, read the current period's focus" with one direct call at generation time.

- **Candidate set expands.** Today's `BUILD_FOCI` (`threshold`, `vo2max`, `anaerobic`, `durability`) gains
  `aerobic-base` as a normal competing candidate in `scoreFocusCandidates`, scored by the same four
  factors everything else already uses: goal-relevance, decay-urgency (real exposure from ridden
  sessions), trainability, execution quality — plus the existing bounded confident-limiter bonus.
- **`needsBaseGate`/`weeksSinceBase`/arc-cap special-casing are removed** for the rolling case. They
  existed only to force periodic re-touches within a rigid rotation; once base is a normal candidate
  re-evaluated fresh every call, "make sure base gets re-touched sometimes" falls out of decay-urgency
  naturally (the longer it's neglected, the more it decays, the more it competes) instead of needing a
  hardcoded "every ~8-12 weeks" rule.
- **No new "period" concept threaded through anywhere.** `chooseNextFocus` takes the same inputs
  `scoreFocusCandidates` already takes (goal text, real exposure, execution quality, confident limiter)
  and returns the winning focus + its rationale, fed into the prompt as a plain instruction line — the
  same shape `formatDurabilityForPrompt`/goal-text already use today, not a "you are in phase X" framing.

## 5. Recovery timing: real-data hard cap, no cadence counter

Directly replaces `applyDeloadCadence` and its cross-call `weeksSinceLastDeload` seeding (today's HR-22).

- **Hard cap, derived fresh from real history, not carried as state.** At block-generation time, compute
  `realWeeksSinceLastRecovery`: walk backward through the athlete's actual weekly TSS (against their
  already-tracked rolling baseline) to find the most recent week that was genuinely light, then count real
  calendar weeks since. This reflects what the athlete *actually rode* — if a "planned" recovery week got
  ridden hard anyway, the hard cap sees that reality, not the stale plan. Nothing is stored or threaded
  across `/api/generate` calls; it's re-derived correctly every time because it's built from durable,
  already-real data (ride history), not from what a previous generation call remembered.
- **Enforcement:** if `realWeeksSinceLastRecovery >= 4` at generation time, the new block's first eligible
  week is forced recovery, full stop — no exceptions, overriding any softer signal.
- **Softer signal, same direction only:** real ACWR/TSB can still pull a recovery week *earlier* than the
  4-week cap if real fatigue signals warrant it (already-computed, no new tracking needed) — but 4 weeks
  is the hard floor, never exceeded in the other direction.
- **Within a block longer than 4 weeks:** the same real-week counting continues forward from wherever the
  block's own start landed, so an 8-week block still gets recovery weeks spaced ≤4 weeks apart internally.
- **`formatRetestNote` simplifies as a consequence:** today it looks ahead into the drafted period array
  for a "best slot." Under this design there's no period array to look ahead into — if FTP is stale *and*
  this block's own recovery-week decision (above) places a lighter week somewhere in it, the retest note
  points there, decided at the same time as the recovery check, not via a separate lookahead.
- **Distinct multi-week "transition" break:** explicitly deferred (§2 non-goals) — folded into this same
  single-week mechanism for now.

## 6. Roadmap preview: stateless projection

`/plan`'s season roadmap keeps a forward-looking view, but computed, not persisted.

- A new function hypothetically re-runs `chooseNextFocus` forward a handful of slots, reusing the
  extrapolation approach `draftSeasonArc`'s existing loop already has (each hypothetical slot's exposure
  is assumed to grow once "filled," so the next slot's scoring reflects having just done that focus).
  Recomputed fresh every time the roadmap is shown — nothing written to disk, nothing carried between
  page loads.
- No arc caps, no base-gate, no deload-cadence state needed here either — it's the same real signals and
  the same `chooseNextFocus` logic from §4, just run in a loop for display.
- **UI framing must change**, not just the data source: this needs to visibly read as "if you kept going
  from today, roughly..." rather than a committed plan — unlike today's roadmap, nothing here is a promise
  about what a future block will actually contain. `SeasonRoadmap.tsx` needs copy changes reflecting that.
- Event mode is unaffected — it already shows a real, committed backward-scheduled plan and continues to
  render as today.

## 7. Event-anchored mode — minimal change

Kept close to today's design (§2 non-goals), with two things that carry over automatically once §4–5
land, not extra work:

- **Base re-touches "fix themselves."** Event mode already uses the scored selector (`pickBuildFocus`)
  for its build slots, so once `aerobic-base` is a normal competing candidate, a long event runway
  naturally gets base re-touches when real signals call for it — closing today's tracked debt item
  ("event-anchored path bypasses the whole macro layer... no base re-touches") as a side effect.
- **The §5 recovery hard cap applies to the build stretch** leading up to the event, same as rolling
  blocks. Peak and taper keep their own existing, deliberate load-shaping untouched — that's intentional
  load reduction for a specific race, not the generic recovery mechanism, and isn't double-applied on top
  of it.

## 8. Block history enrichment

Feeds §4/§6's real signals, and is useful as a record on its own. Scoped narrowly (§2 non-goals: no
scorer-weighting logic yet, no proven-workout reuse).

- **Real execution outcome joined onto history.** `CurrentBlockDay` gains optional fields (execution
  score / compliance, pulled from the real `RideScoreEntry`) stamped once a session is actually ridden and
  scored, instead of requiring a separate cross-reference by date. Since `BlockHistoryEntry.days` already
  reuses `CurrentBlockDay` verbatim, this flows into history automatically. Requires a new write path:
  whenever a score is computed for a date inside `currentBlock`/`blockHistory`, backfill it onto the
  matching day.
- **Protocol/duration violations persisted.** Closes existing tracked debt: `GeneratedPlan.protocolViolations`
  today lives only on the preview plan. `/api/write` re-runs the same deterministic per-day checks already
  used at generation time (`validateWorkoutProtocol`, `validateDurationConsistency`) and stamps the result
  onto each `CurrentBlockDay`, alongside the existing `sessionLevel` stamp.
- **No scorer effect yet.** Athlete decision, 2026-07-17: this data is recorded for future features, not
  wired into `chooseNextFocus`'s math in this pass. Track "use persisted protocol-violation/execution data
  to weight the scorer's signals" in ROADMAP.md as a future item once this design ships.

## 9. Rollout

- **`SEASON_SHAPES_GENERATION` is repurposed, not retired.** It currently gates the *old* periods-based
  prompt text/validators off. Once this design ships, the same flag (or a renamed equivalent) gates the
  *new* continuous-model wiring instead — a kill-switch stays available during rollout. Remove it later
  once proven stable in practice, same as any other flag.
- **Real cleanup, not just addition.** The rolling-mode machinery being replaced —
  `draftSeasonArc`'s rolling loop, `applyDeloadCadence`, `needsBaseGate`, `weeksSinceBase`, arc-cap
  constants (`SEASON_CONSTANTS.arcWeeks`) — becomes genuinely dead code for the rolling case and gets
  removed as part of implementation, not left in "just in case." Event-mode code
  (`backwardScheduleFromEvent`, its periods handling, `pickBuildFocus`) stays untouched.
- **Live smoke run required** (AGENTS.md: LLM-backed paths need one live run before "done") — this touches
  what reaches the generation prompt.

## 10. Open questions carried into planning

None blocking — the design is complete as scoped. Implementation-level questions (exact field names,
which existing tests need rewriting vs. deleting, exact within-block week-numbering mechanics) belong in
the implementation plan, not this design.
