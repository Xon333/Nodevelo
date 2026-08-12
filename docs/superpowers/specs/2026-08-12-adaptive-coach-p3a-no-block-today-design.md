# Adaptive self-directed coach — Phase 3a: no-block Today — Design scope

## 1. Purpose

The original design (`docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md` §8-10,
§12.1) specifies a weekly TSS envelope, one suggested session, and a three-stream athlete-state read for
days with no active training block — locked at design review 2026-08-06, not yet built. Today,
`PlannedToday`'s no-block branch (`components/dashboard/today.tsx:869-879`) shows only "No active
training block yet — Plan your next block →." This phase replaces that with the real content, and wires
in the deterministic seams Phase 2b/2c already shipped so self-directed rides read correctly in it
(Phase 2c's "Handoff boundary to Phase 3" note: weekly aggregation must not assume Phase 2c's
single-ride-resolution correctness generalizes for free — this phase re-verifies that, not inherits it).

**This is an implementation-shape design, not a requirements brainstorm.** §8-10's product decisions are
already locked; this doc covers module boundaries, persistence, and UI composition against the actual
current codebase.

## 2. Locked product decisions (from the original design, restated for reference)

- No fixed-percentage injury-risk claims, no ACWR-based prescriptive warnings — CTL/ATL/TSB are trend
  sensors and context, never a standalone workout selector or a completeness verdict.
- The weekly range is resolved Monday, frozen through Sunday, and may only be *reduced* mid-week on new
  fatigue evidence — never raised.
- The suggested session is one concrete option, never a menu, never a plan, never something with a
  confirm/complete/calendar-write control.
- Finishing below, inside or above the range is context, not pass/fail compliance; an ignored suggestion
  carries no adherence or execution penalty.
- All three pieces (envelope, suggestion, three-stream state) render *only* when there is no active
  block — identical, unmodified behavior for an active block (§12.3).

## 3. This phase's own locked decisions (made in this brainstorm, 2026-08-12)

- **Zone 1's fused `AthleteStateCard` (`lib/athlete-state.ts`, the existing single 0-100 signal-fusion
  score) stays exactly as-is, unconditionally, for both block and no-block cases.** Design §10's
  three-stream Load/Recovery/Execution read becomes new content inside the no-block section this phase
  adds to Zone 2 — it does **not** replace or sit alongside Zone 1. **Flagged in `todo.md` to revisit**
  once this has shipped and been used — the athlete's explicit call was the lower-risk option for v1, not
  a final verdict that the two should never be unified.
- **§9's suggester reuses `lib/season.ts`'s existing `chooseNextFocus`/`selectBuildFocus` machinery** for
  "what training system is needed" (goal relevance, trainability, execution-by-focus, recent exposure) —
  a new, small, focus→session-shape mapping function is the only new selection logic this phase adds.
  Chosen over building §9 fresh so the suggester and the block generator never silently disagree about
  what the athlete needs.
- **No new LLM call.** The suggestion's "why" text is templated from the same deterministic inputs that
  produced the suggestion — matches this app's core deterministic-numbers/AI-prose-only-for-blocks
  pillar, and doesn't grow the still-open AI-cost-guard surface (ROADMAP P8).
- **The week-tolerance classifier (§8.1's "tolerated" week — good recovery, no execution collapse) reuses
  entirely existing signals** — `computeFatigueAlert`/`computeLoadRamp` (`lib/readiness.ts`) and
  `RideScoreEntry.compromised`/`SessionDisposition` (illness/equipment disruption, already tracked). No
  new wellness data collection.
- **Computed and persisted at sync time**, not behind a new on-demand API route — same pattern as
  `current-block.json`/`athleteState`, required by §8.3's freeze-through-Sunday lifecycle (an on-demand
  recompute would re-derive a different "Monday's" range every time it's requested near a weekly
  boundary, which the design explicitly forbids).

## 4. Module boundaries

Three new files, each with one responsibility, plus one new persisted store:

| File | Responsibility |
|---|---|
| `lib/weekly-envelope.ts` | §8. Week-tolerance classification, anchor (median tolerated-week load), role (Build/Maintain/Recovery), range calculation, the freeze/one-way-reduction lifecycle. |
| `lib/session-suggestion.ts` | §9. Calls `season.ts`'s `chooseNextFocus`, maps the chosen focus to a concrete session shape (duration range, structure, expected TSS via `hours × IF² × 100`), applies readiness/spacing gates first. |
| `lib/no-block-summary.ts` | §10 + composition. Reads the envelope, the suggestion, and the effective-origin-aware execution read (`summariseBehaviour`, the seam Phase 2c's handoff note names) into the one headline + three-stream body `TodayView.tsx` renders. No new calculation of its own — pure composition. |
| `data/weekly-envelope.json` | New store: persisted range, role, calculation provenance/version. Read/written via `lib/json-store.ts`'s existing atomic pattern. |

**Why three files, not one:** `weekly-envelope.ts` and `session-suggestion.ts` have genuinely different
inputs and change independently (a role-threshold retune touches only the first; a focus-mapping change
touches only the second). `no-block-summary.ts` depends on both but contains no selection logic of its
own — keeping it separate means a change to *how* the headline reads never risks touching *what* gets
selected.

## 5. Data flow

```
POST /api/sync (existing sync pass, same step that already produces athleteState/currentBlock)
  → lib/readiness.ts's existing signals (fatigueAlert, loadRamp, acwr) [already computed]
  → lib/weekly-envelope.ts: classify recent weeks, resolve anchor/role/range
      (only recomputes when localToday() has crossed a Monday boundary since the persisted value;
       otherwise reads data/weekly-envelope.json unchanged)
  → data/weekly-envelope.json (persisted)
  → lib/season.ts's chooseNextFocus [existing] → lib/session-suggestion.ts: map focus to session shape
  → lib/no-block-summary.ts: compose envelope + suggestion + summariseBehaviour's effective execution
      read into { headline, body, weeklyRange, suggestion }
  → threaded onto the sync response / AppState, alongside todayAnalysis/currentBlock/athleteState
      (exact field name and response-object placement — implementer's call, follow the existing
       todayOutcome precedent from Phase 2c: one field, both GET and POST)
  → components/dashboard/today.tsx's PlannedToday, !block branch: render the new section in place of
      "No active training block yet"
```

## 6. UI contract (restating design §12.1/§12.3 against the real component)

`PlannedToday` (`components/dashboard/today.tsx:825-879`) already branches on `isBlockFinished` → `!day
|| day.type === "Rest"` → `!block`. The new no-block section replaces only the final `!block` branch's
content (currently lines 869-879: "No active training block yet" + "Plan your next block →"). Every
other branch (finished block, rest day, a block with today's day gapped) is untouched — those aren't the
no-block-*ever* state this phase covers, they're active-block edge cases already handled correctly.

The rendered section is the one compact block the original design's §8/§9/§10 examples all share: headline
(e.g. "Productive training · mild fatigue"), three-stream body text, weekly TSS line, suggested-session
block. No confirmation, completion, planning, or calendar-write control — matching §12.1's explicit
statement.

## 7. Explicit non-goals

- No change to `AthleteStateCard`/Zone 1 (§3, flagged for revisit in `todo.md`, not built here).
- No new LLM call or prompt.
- No change to active-block behavior (§12.3) — this phase's entire surface is gated behind
  `!state.currentBlock`.
- No historical backfill — the envelope only ever resolves forward from whatever Monday it first runs on;
  no attempt to reconstruct what a "resolved" range would have been for past weeks.
- No new wellness/readiness data collection — every input to the week-tolerance classifier already exists.

## 8. Implementation-planning constraints

- Reuse `lib/date.ts`'s `localToday()`/`resolveToday()` for the Monday boundary — never a UTC-derived
  "today" (AGENTS.md's recurring bug class).
- Reuse `lib/json-store.ts`'s atomic read/write pattern for the new store file; do not hand-roll file I/O.
- The one-way midweek reduction rule must be enforced in the *write path* (`lib/weekly-envelope.ts`),
  not merely documented as a UI convention — a rebuild or a second sync on the same day must not be able
  to raise an already-frozen range.
- Version and stamp provenance on every write (which calculation version produced this week's range),
  matching this app's existing calibration/scoring-version conventions — a future threshold retune must
  not silently reinterpret an already-persisted week's range.
- Re-verify `summariseBehaviour`'s effective-origin aggregation holds under a week boundary specifically
  (a week straddling an overlay's `createdAt` mid-week) — Phase 2c's handoff note flags this as unproven
  at multi-ride granularity; do not assume it from single-ride correctness.

The implementation plan may choose exact function names, exact role thresholds/rounding (§8.2 explicitly
defers these), and the exact response-field name threading the summary onto `AppState`. It may not change
the locked decisions in §2/§3 without returning to design review.
