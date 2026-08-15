# Adaptive self-directed coach — Phase 3a: no-block Today — Design scope

**Status:** Shipped 2026-08-13 (PR #49, fixes r2 PR #47, follow-up fix PR #50). See
[ARCHIVE.md](../../../ARCHIVE.md) § Adaptive self-directed coach.

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
- **Corrected 2026-08-12 (external review, verified against the real code before accepting): none of
  `computeFatigueAlert`/`computeLoadRamp`/`compromised` classify an arbitrary historical week by
  themselves.** `computeFatigueAlert` grades the *current* `FitnessMetrics` snapshot (a live check, not a
  per-week retrospective one). `computeLoadRamp` compares only the trailing 7 days against the 7 before
  that, anchored to `today` — it cannot be pointed at week N-5. `compromised`/`SessionDisposition` records
  athlete-attributed disruption per *ride*, with no "missing data" or "travel" state. A new function,
  `classifyWeekTolerance(weekStart, weekEnd, scoreLog, wellness)`, is needed — it reuses these as
  *inputs* (any `compromised` ride inside the week → not tolerated; wellness/TSB trend in the days
  immediately following the week → the "good recovery" read) but is itself new logic, not a reuse of an
  existing whole-week classifier. **A week where the underlying data is insufficient to classify (too few
  synced days, missing wellness) is `unknown`, and `unknown` weeks are excluded from the anchor's median
  — never guessed into tolerated or not.** Exact sufficiency thresholds are an implementation-plan
  decision (matches §8.2's own deferral of exact numbers), not locked here.
- **Computed and persisted at sync time**, not behind a new on-demand API route — same pattern as
  `current-block.json`/`athleteState`, required by §8.3's freeze-through-Sunday lifecycle (an on-demand
  recompute would re-derive a different "Monday's" range every time it's requested near a weekly
  boundary, which the design explicitly forbids). **But sync-time computation runs on every sync, not
  just Monday's** — §5 below specifies the two distinct paths that run on every sync (full Monday
  recompute vs. an every-sync, reduction-only safety check), since collapsing them into "only recomputes
  on Monday" (as an earlier draft of this section said) silently drops the §2 midweek-reduction
  requirement.
- **A finished-but-not-yet-regenerated block counts as "no active block."** Confirmed against
  `isBlockFinished(block, today) = block !== null && today > block.endDate` — this evaluates true before
  `PlannedToday` ever reaches its `!block` branch, so without an explicit fix a finished block would keep
  showing only "Your block finished — Generate the next block →," never the envelope/suggestion. Decided
  2026-08-12 (external review raised it, athlete's explicit call): **include** it — no active block is
  governing today either way, so the envelope/suggestion is exactly as useful here as in the never-had-a-
  block case. The existing "block finished" link stays, alongside the new section, not replaced by it.

## 4. Module boundaries

Three new files, each with one responsibility, plus one new persisted store:

| File | Responsibility |
|---|---|
| `lib/weekly-envelope.ts` | §8. `classifyWeekTolerance` (new, §3), anchor (median tolerated-week load, `unknown` weeks excluded), role (Build/Maintain/Recovery), range calculation, the Monday-recompute-vs-every-sync-reduction lifecycle (§5). |
| `lib/session-suggestion.ts` | §9. Calls `lib/season-signals.ts`'s **`gatherFocusInputs()`** (the existing assembly of `limiter`/`lastFocus`/`signals`, including goal text and execution quality via `buildAthleteModel`) to build `ChooseNextFocusInput`, then `season.ts`'s `chooseNextFocus`. Readiness/spacing gates run first, reading `computeReadiness(...).level` and `computeLoadRamp(...).level`/`computeAcwr(...)` **only** — never their `.reason` text (`computeLoadRamp`'s `reason` string literally contains "injury risk" wording that would violate the original design's §15 non-goal on fixed injury warnings if forwarded). Insufficient history (e.g. `computeAcwr` returns `null` pre-28-day baseline) defaults to the *conservative* gate reading, not the permissive one — never guesses toward "push harder." Maps the resolved focus to a concrete session shape (duration range, structure, expected TSS via `hours × IF² × 100`). |
| `lib/no-block-summary.ts` | §10 + composition. Reads the envelope, the suggestion, and the effective-origin-aware execution read (`summariseBehaviour`, called on `resolveAll()`'s `ResolvedRide[]` output — never raw ledger rows, per `lib/athlete-model.ts`'s own `buildAthleteModel`) into the one headline + three-stream body `TodayView.tsx` renders. No new calculation of its own — pure composition. |
| `data/weekly-envelope.json` | New store, atomic via `lib/json-store.ts`. Explicit shape: `{ weekStart: string (ISO Monday), role, range: { min, max }, previousRange: { min, max } \| null (the pre-reduction value, kept for audit — never overwritten in place), reductionApplied: boolean, reductionReason: string \| null, calculationVersion: number, resolvedAt: string }`. `previousRange`/`reductionApplied` are what make "Monday full recompute" vs. "mid-week reduction-only" mechanically distinguishable and testable, not just documented behavior. |

**Why three files, not one:** `weekly-envelope.ts` and `session-suggestion.ts` have genuinely different
inputs and change independently (a role-threshold retune touches only the first; a focus-mapping change
touches only the second). `no-block-summary.ts` depends on both but contains no selection logic of its
own — keeping it separate means a change to *how* the headline reads never risks touching *what* gets
selected.

## 5. Data flow

**Corrected 2026-08-12 (external review): the envelope needs two distinct paths on every sync, not one
Monday-gated path** — collapsing them, as an earlier draft did, silently drops §2's midweek-reduction
requirement (a reduction must be checkable on *any* day, not just Mondays).

```
POST /api/sync (existing sync pass, same step that already produces athleteState/currentBlock)
  → lib/readiness.ts's existing signals (fatigueAlert, loadRamp, acwr) [already computed]
  → lib/weekly-envelope.ts, path A (Monday only): localToday() has crossed a new Monday since
      data/weekly-envelope.json's weekStart → full recompute (classify weeks, anchor, role, range),
      overwrite the store with a fresh weekStart and previousRange: null.
  → lib/weekly-envelope.ts, path B (every sync, including Monday's): safety evaluation against the
      CURRENT persisted range — if today's fatigue/wellness signal implies a lower range than what's
      stored, write a new range with previousRange set to the prior value and reductionApplied: true.
      Never writes a HIGHER range than what's already persisted for this weekStart. A sync with no new
      reducing evidence writes nothing (the persisted value is read as-is).
  → data/weekly-envelope.json (persisted, either path)
  → lib/season-signals.ts's gatherFocusInputs() [existing] → lib/season.ts's chooseNextFocus [existing]
      → lib/session-suggestion.ts: readiness/spacing gates (levels only, never .reason text) → map
      focus to session shape
  → lib/no-block-summary.ts: compose envelope + suggestion + summariseBehaviour(resolveAll(...)) into
      { headline, body, weeklyRange, suggestion }
  → threaded onto the sync response / AppState, alongside todayAnalysis/currentBlock/athleteState
      (exact field name and response-object placement — implementer's call, follow the existing
       todayOutcome precedent from Phase 2c: one field, both GET and POST)
  → components/dashboard/today.tsx's PlannedToday: render the new section whenever there is no ACTIVE
      block — !block OR isBlockFinished(block, today) (§3) — alongside, not replacing, the existing
      "block finished" link in the finished case.
```

## 6. UI contract (restating design §12.1/§12.3 against the real component)

**Corrected 2026-08-12 (external review, verified against `lib/date.ts:40-42`):**
`PlannedToday` (`components/dashboard/today.tsx:825-879`) branches on `isBlockFinished` → `!day || day.type
=== "Rest"` → `!block`. `isBlockFinished(block, today) = block !== null && today > block.endDate` returns
`false` for `block === null` (short-circuits), so the never-had-a-block case correctly reaches the
`!block` branch untouched by this fact — but a block that *existed and has ended* is caught by
`isBlockFinished` first and returns early, never reaching `!block` at all. Per §3's decision, the new
no-block section now renders in **both** cases: replace the `!block` branch's content (currently lines
869-879), and *add* the same section to the `isBlockFinished` branch's existing "Your block finished —
Generate the next block →" output (that link stays, the new section is additional content alongside it,
not a replacement of it there). Rest-day and gapped-day branches are genuinely different states (an
active block still governs today) and stay untouched.

The rendered section is the one compact block the original design's §8/§9/§10 examples all share: headline
(e.g. "Productive training · mild fatigue"), three-stream body text, weekly TSS line, suggested-session
block. No confirmation, completion, planning, or calendar-write control — matching §12.1's explicit
statement.

## 7. Explicit non-goals

- No change to `AthleteStateCard`/Zone 1 (§3, flagged for revisit in `todo.md`, not built here).
- No new LLM call or prompt.
- No change to active-block behavior (§12.3) — this phase's entire surface is gated behind "no ACTIVE
  block" (`!state.currentBlock || isBlockFinished(state.currentBlock, today)`, §3/§6), never rendering
  while a block is genuinely in progress. (Corrected 2026-08-12: an earlier draft said `!state.currentBlock`
  alone, which is stale after §3's finished-block decision — a finished block still has a non-null
  `currentBlock`.)
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
  at multi-ride granularity; do not assume it from single-ride correctness. **Required test (external
  review, 2026-08-12): resolve a week containing rides both before and after an overlay is created, and
  prove a later `active` overlay affects that week's execution read exactly as `resolveAll()` specifies**
  — not a general aggregation smoke test, this specific before/after-`createdAt` scenario.

The implementation plan may choose exact function names, exact role thresholds/rounding (§8.2 explicitly
defers these), and the exact response-field name threading the summary onto `AppState`. It may not change
the locked decisions in §2/§3 without returning to design review.
