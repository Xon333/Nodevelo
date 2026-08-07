# Adaptive self-directed coach — Phase 1: aerobic eligibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a structurally mixed outdoor ride from being scored, described, and calibrated as if it were a steady aerobic ride — with no AI and no new persisted state.

**Architecture:** A single shared variability criterion (`AEROBIC_MAX_VI`) is added to TWO deliberately different eligibility predicates in `lib/aerobic.ts`: `isSteadyEnduranceRide` (whole-ride comparability — trend/calibration/debrief membership; needs duration + IF-band too) and `qualifyingPwHr` (Z2-isolated Pw:HR trustworthiness — baseline membership; needs neither). Because `qualifyingPwHr` is called by `aerobicEffPct()` on the ride *being scored*, not just on baseline candidates, tightening it alone propagates through the existing, unmodified production call chains in `lib/score-log.ts` and `app/api/sync/route.ts` — no consumer-side gate is needed for the aerobic-efficiency signal, on either off-plan or planned rides. The only place that genuinely needs its own consumer-side gate is `activityDecoupling` (Intervals.icu's raw whole-ride figure, with no producer-level protection at all). Separately, the off-plan variability-penalty axis is fixed so structure can inform pacing bonuses but never manufacture an execution penalty out of terrain.

**Tech Stack:** TypeScript 5, Next.js 16 (App Router), Vitest. No new dependencies. No new files in `data/`.

## Why this plan looks the way it does (read before Task 1)

This plan went through two independent review passes before implementation — both against the real code, the real 90-day sync data, and (where relevant) Node's actual runtime behavior, not accepted or rejected on the reviews' say-so alone. Recording what changed so nobody re-litigates settled ground:

**Pass 1 (Codex) — confirmed bugs, fixed here:**

1. A test asserted a mathematically wrong number — the intensity-band bonus swamped the VI penalty it meant to isolate. Task 2 now uses differencing (two rides identical except VI) so the assertion can't be confounded.
2. Two tests checked the wrong ride — `buildRideScores` returns Map-insertion order, not date order, so `const [entry] = buildRideScores(...)` grabbed a baseline ride, not the target. Fixed with `.find(e => e.date === ...)` everywhere a multi-activity array is scored.
3. A floating-point justification was wrong (`1.12` is not exactly representable — it's a repeating binary fraction, same class as `0.1`) though the test it justified still passes: verified in Node that `224/200 === 1.12` (both round to the identical double). Comment corrected; logic was already fine.
4. The original live-verification task couldn't execute: a fresh worktree has neither `data/` nor `.env*` (both gitignored), sync performs real writes to the athlete's live Intervals.icu calendar, and both 2026-08-05 and 2026-08-06 were *already* frozen in the real ledger at `executionScore: 2` by the time this plan was written — a normal sync will never re-derive either. Replaced with an offline, read-only computation against the already-synced snapshot (Task 6).
5. The Pw:HR baseline pool's contamination was measured, not assumed: 24 of 38 rides (63%) that qualified for it fell outside the new comparable definition. Folded the fix into Phase 1 per your decision, rather than deferring to Phase 4.
6. Two points were genuine design questions, not bugs, and you answered them directly: VI stays reward-only for intrinsic rides (matches decision 11's literal wording); fail-open on missing NP was conceded outright once real data showed it was a zero-cost no-op (0 of 43 candidate rides lack NP) — this plan fails closed.
7. `docs/systems/02-scoring-and-learning.md` has no "Known rough edges" section at all (confirmed via grep) — Task 6 adds it rather than assuming it exists.

**Pass 2 (a second independent review) — a real architectural correction, and it's the reason Tasks 3–5 look nothing like their first draft:**

`aerobicEffPct(ride, baseline)` calls `qualifyingPwHr(ride)` on the ride being scored — not only on baseline candidates:

```ts
export function aerobicEffPct(ride: PwHrRide, baseline: number | null): number | null {
  const v = qualifyingPwHr(ride);   // checks THIS ride's own eligibility
  if (v == null || baseline == null || baseline <= 0) return null;
  return ((v - baseline) / baseline) * 100;
}
```

Both real producers already route through this unconditionally — `lib/score-log.ts:219` (`aerobicEffPct(act, z2PwHrBaselineBefore(...))`) and `app/api/sync/route.ts`'s `todayAerobicEffPct` (same pattern, computed before `buildTodayAnalysis` is even called). So tightening `qualifyingPwHr` with the variability check (Task 1) makes a high-VI ride's `aerobicEffPct` come back `null` **automatically**, with zero changes needed to `score-log.ts` or `ride-analysis.ts` — confirmed by tracing the *original, unmodified* code, which already passes the computed value straight through, ungated.

An earlier draft of this plan added an EXPLICIT extra gate (`isSteadyEnduranceRide`-based) on top of this in three places. That gate was not just redundant — it was actively wrong, because `isSteadyEnduranceRide` requires whole-ride duration ≥45min and IF in [0.56, 0.85], neither of which `qualifyingPwHr` requires. A clean, steady 30-minute recovery spin at IF 0.45 would pass `qualifyingPwHr` (trustworthy Z2 reading — no contamination concern) but fail the extra gate on criteria that have nothing to do with contamination, silently discarding a legitimate signal. The tests for that extra gate concealed the problem by injecting `aerobicEffPct: -10` directly as a raw input, bypassing the real producer chain entirely — an input shape the real pipeline can no longer produce once Task 1 lands.

**What survived that correction:** `activityDecoupling` (Task 4) is a genuinely different case — it's Intervals.icu's raw whole-ride figure, computed independently of `qualifyingPwHr`/`aerobicEffPct`, with no producer-side protection at all. It keeps its `isSteadyEnduranceRide` gate. Tasks 3 and 5 (as previously separate, gate-adding tasks) collapsed into one verification-only task proving the existing, unmodified call chains already do the right thing once Task 1 lands — for off-plan rides, planned rides that turned surgy, and short/low-IF rides that should NOT be suppressed.

## Why this phase exists

This is Phase 1 of the design in `docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md` (on branch `codex/adaptive-self-directed-coach-scope`), implementing **resolved decision 11**: *"Fix deterministic eligibility before adding AI intent scoring."*

Tracing `computeExecutionScore` for the 2026-08-06 ride (off-plan, IF 0.84, NP 241 W, avg 200 W, VI 1.205) shows where a `2/10` actually comes from — not from the absence of self-directed intent, but from two structure-driven penalties:

| Axis | Effect |
|---|---|
| baseline | **5** |
| compliance / adherence (both null) | 0 |
| intensity-vs-type | skipped — already guarded by `intrinsic` |
| easy-ride merged read | skipped — already guarded by `intrinsic` |
| **variability index** (inferred type `Threshold`, VI 1.205 ≥ 1.15) | **−1** |
| **intrinsic `aerobicEffPct`** (Z2 Pw:HR ≥ 2×deadband below baseline) | **−2** |
| **total** | **2 → "Poor"** |

Both penalties are artifacts of ride *structure*, not ride *quality*. Removing them is worth doing on its own merits, requires no LLM, and is independently verifiable — which is why it ships before the intent pipeline.

### Explicitly out of scope for Phase 1

- **Segment-scoped decoupling** (design §7.1–7.4), per decision 11: *"Locally calculated segment decoupling is deferred until stream quality and sampling behaviour are proven."* Phase 1 **omits** drift on ineligible rides; it does not compute a replacement.
- Anything requiring an LLM call, a new `data/` file, an origin taxonomy, or a UI section. Those are Phases 2–4.
- **Retroactively re-scoring already-frozen ledger entries.** Phase 1 changes how FUTURE rides (and whichever single date is still "today" at the moment a sync runs) get scored. Both 2026-08-05 and 2026-08-06 already have frozen `executionScore: 2` entries as of this plan's writing (`mergeScoreLog` freezes past dates — INVARIANT 1); Phase 1 alone will not change what the UI shows for those specific historical dates. A ledger rebuild (`mergeScoreLogRebuild`, already present — see `app/api/sync/route.ts`'s "Ledger rebuilt" warning path) could re-derive them, but triggering one is a separate decision this plan does not make for you.

## Global Constraints

- **Do not touch the frozen ledger.** `mergeScoreLog` keeps `existing` over `fresh`; past `score-log.json` entries must not be rewritten (INVARIANT 1). Every scoring change here applies forward and to today's live re-derived entry only.
- **No new persisted fields.** `RideScoreEntry` and `TodayAnalysis` keep their current shapes. `TodayAnalysis.activityDecoupling` stays `number | null` — this plan only changes *when* it is null.
- **The sync route stays LLM-free** (INVARIANT 23). Nothing in Phase 1 adds an Anthropic call.
- **One shared variability criterion, two deliberately different predicates.** `isSteadyEnduranceRide` and `qualifyingPwHr` are NOT the same eligibility check and must not be merged into one function — they answer different questions (whole-ride comparability vs. Z2-segment trustworthiness) and only share the `AEROBIC_MAX_VI` threshold plus fail-closed-on-missing-NP behavior. Do not add a THIRD hand-rolled "is this ride steady" check anywhere (INVARIANT 17's drift class) — and do not add a consumer-side gate that duplicates what a producer function already guarantees (that was the mistake this plan corrected).
- **`AEROBIC_MAX_VI = 1.12` is a provisional, athlete-specific value, not a universal physiological law** — derived from this athlete's own 90-day sync window (the loosest threshold that still excludes every ride whose decoupling exceeds the repo's own "meaningless past this" bound). Treat it the same way the design spec treats its 30-minute segment-eligibility threshold: revisit with real data if it stops fitting, don't treat it as settled physiology.
- **Fail CLOSED when VI is uncomputable.** If `normalizedPower` is null, the ride is excluded from both predicates — verified against real data to cost nothing (0 of 43 candidate rides lack NP) and matches the "better absent than wrong" convention already used elsewhere in this codebase.
- **A gate belongs at the producer, not every consumer.** `qualifyingPwHr`'s tightening (Task 1) is sufficient for the aerobic-efficiency signal precisely because `aerobicEffPct()` calls it internally on the ride being scored. Before adding a comparability check anywhere new, check whether the value already flows through a gated producer first — an extra consumer-side check that merely repeats a producer's guarantee is dead code at best and silently over-suppressive at worst (this plan's Pass 2 correction, above).
- Tests are colocated `lib/*.test.ts`, Vitest, `describe`/`it`/`expect`. Verify with `npm run check` (`tsc --noEmit && eslint && vitest run`).
- Commit after every task. Stage only the files that task names — never `git add -A`.

## File Structure

| File | Change | Responsibility after this plan |
|---|---|---|
| `lib/aerobic.ts` | Modify | Sole owner of both variability-aware predicates: `AEROBIC_MAX_VI`, `ENDURANCE_MIN_SEC`, `isSteadyEnduranceRide`, `qualifyingPwHr`, plus the existing baseline helpers |
| `lib/aerobic.test.ts` | Modify | Tests for both tightened predicates, including a Recovery/short-ride regression proving no over-suppression |
| `lib/trends.ts` | Modify | Loses `isSteadyEnduranceRide` + `ENDURANCE_MIN_SEC`; imports them from `aerobic.ts` for `efSeries` |
| `lib/trends.test.ts` | Modify | Import fix only |
| `lib/anthropic-prompts.ts` | Modify | Import moves from `./trends` to `./aerobic` |
| `app/api/sync/route.ts` | Modify | Import moves from `@/lib/trends` to `@/lib/aerobic` |
| `lib/execution-score.ts` | Modify | VI axis becomes reward-only for `intrinsic` rides |
| `lib/execution-score.test.ts` | Modify | Fixed differencing test for the reward-only rule |
| `lib/score-log.ts` | **No change** | Task 1 alone is sufficient — `aerobicEffPct` already flows through the tightened `qualifyingPwHr` unmodified |
| `lib/score-log.test.ts` | Modify | New end-to-end tests proving the real chain works for off-plan AND planned rides — no source change needed to make them pass |
| `lib/ride-analysis.ts` | Modify | ONLY `activityDecoupling` gets a comparability gate — `aerobicEffPct` is untouched (same reasoning as `score-log.ts`) |
| `lib/ride-analysis.test.ts` | Modify | New tests for the `activityDecoupling` gate only |
| `lib/athlete-state.test.ts` | Modify | One new test confirming a high-VI ride is excluded from the aerobic-efficiency baseline it feeds |
| `docs/INVARIANTS.md`, `docs/systems/02-scoring-and-learning.md`, `docs/FILE_INDEX.md`, `ROADMAP.md` | Modify | Record the contract; add the missing "Known rough edges" section properly |

`components/dashboard/today.tsx` needs **no change**: it already renders the decoupling chip only when `analysis.activityDecoupling != null` ([today.tsx:397](../../../components/dashboard/today.tsx)), and the `details` wrapper's condition already tolerates its absence.

---

### Task 1: A shared variability criterion for both `isSteadyEnduranceRide` and `qualifyingPwHr`, fail-closed

**Files:**
- Modify: `lib/aerobic.ts` (the `PwHrRide` interface and `qualifyingPwHr` at lines 13–28; append `isSteadyEnduranceRide` after)
- Modify: `lib/trends.ts:22-46` (delete `ENDURANCE_MIN_SEC` + `isSteadyEnduranceRide`, import instead)
- Modify: `lib/anthropic-prompts.ts:20` (import source)
- Modify: `app/api/sync/route.ts:48` (import source)
- Test: `lib/aerobic.test.ts`, `lib/trends.test.ts:2`, `lib/athlete-state.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first task).
- Produces:
  - `export const AEROBIC_MAX_VI = 1.12`
  - `export const ENDURANCE_MIN_SEC = 45 * 60`
  - `export interface PwHrRide { date: string; type: string; powerHrZ2: number | null; powerHrZ2Mins: number | null; avgWatts: number | null; normalizedPower: number | null; }` — two new REQUIRED fields, matching `ActivitySummary`'s own (non-optional, nullable) shape, so every real caller satisfies it with zero code changes.
  - `export interface ComparableRide { type: string; movingTimeSec: number; avgWatts: number | null; normalizedPower: number | null; }` — same pattern.
  - `export function qualifyingPwHr(r: PwHrRide): number | null` — same behaviour as before, PLUS the variability check. **This is the entire fix for the aerobic-efficiency penalty** — Task 3 verifies this, adding no further source changes.
  - `export function isSteadyEnduranceRide(a: ComparableRide, ftp: number): boolean` — unrelated to `qualifyingPwHr` beyond sharing `AEROBIC_MAX_VI`; do not conflate the two or try to implement one in terms of the other.

**Why `PwHrRide` grows two REQUIRED (not optional) fields:** `qualifyingPwHr`, `z2PwHrBaselineBefore`, and `aerobicEffPct` are exercised today by a single shared `r()` helper in `lib/aerobic.test.ts` (confirmed the only file constructing a bare `PwHrRide` — real callers in `lib/athlete-state.ts:173` and `lib/score-log.ts:219` pass full `ActivitySummary` objects, which already carry both fields). Making the fields optional would leave old fixtures silently `undefined`, ambiguous with "genuinely unknown." Step 1 below widens the shared `r()` helper to set explicit steady defaults instead, so every existing test keeps testing what it always tested without VI becoming an accidental confound.

- [ ] **Step 1: Write the failing tests**

Replace the top of `lib/aerobic.test.ts` (currently just the `r()` helper) with a widened helper, and add the new describe blocks. Widen the file's existing single import line — don't add a second `from "./aerobic"` statement:

```ts
import { AEROBIC_MAX_VI, aerobicEffPct, isSteadyEnduranceRide, qualifyingPwHr, z2PwHrBaselineBefore, type ComparableRide, type PwHrRide } from "./aerobic";

// avgWatts/normalizedPower default to a steady VI (185/180 = 1.028, well under AEROBIC_MAX_VI) so every
// EXISTING test below keeps testing what it always tested — the Z2-minutes floor, outdoor-only gate, and
// baseline window — without the new variability check becoming an accidental, undocumented confound.
// Tests that specifically exercise the VI gate override these two fields explicitly.
const r = (
  date: string,
  powerHrZ2: number | null,
  powerHrZ2Mins = 30,
  type = "Ride",
  avgWatts = 180,
  normalizedPower = 185
): PwHrRide => ({ date, type, powerHrZ2, powerHrZ2Mins, avgWatts, normalizedPower });
```

After the existing `describe("qualifyingPwHr", ...)` block, add:

```ts
describe("qualifyingPwHr — variability gate", () => {
  it("excludes a ride whose Z2 reading came from a structurally mixed ride (high VI)", () => {
    // 241/200 = 1.205, matches the 2026-08-06 screenshot ride's real VI.
    expect(qualifyingPwHr(r("2026-06-01", 1.5, 30, "Ride", 200, 241))).toBeNull();
  });

  it("keeps a genuinely steady ride's reading (VI at/under the threshold)", () => {
    expect(qualifyingPwHr(r("2026-06-01", 1.5, 30, "Ride", 200, 224))).toBe(1.5); // VI exactly 1.12
    expect(qualifyingPwHr(r("2026-06-01", 1.5, 30, "Ride", 200, 225))).toBeNull(); // VI 1.125
  });

  it("fails CLOSED when normalizedPower is absent — cannot rule out a surgy ride, so exclude it", () => {
    expect(qualifyingPwHr({ date: "2026-06-01", type: "Ride", powerHrZ2: 1.5, powerHrZ2Mins: 30, avgWatts: 200, normalizedPower: null })).toBeNull();
  });

  // Deliberately DOES NOT require duration or an IF band — qualifyingPwHr answers "is this ride's Z2
  // reading trustworthy," not "is the whole ride comparable" (that's isSteadyEnduranceRide, a stricter,
  // different question). A short, gentle Recovery ride below IF 0.56 with steady VI is exactly the case
  // an earlier draft of this plan wrongly suppressed by applying isSteadyEnduranceRide's extra
  // duration/IF-band criteria here too — this test guards against reintroducing that mistake.
  it("qualifies a short, low-intensity Recovery ride that isSteadyEnduranceRide would reject", () => {
    const shortEasyRide = r("2026-06-01", 1.5, 20, "Ride", 150, 152); // 20 Z2 min, VI 1.013, well under 45min
    expect(qualifyingPwHr(shortEasyRide)).toBe(1.5);
    expect(isSteadyEnduranceRide({ type: "Ride", movingTimeSec: 20 * 60, avgWatts: 150, normalizedPower: 152 }, 288)).toBe(false); // duration floor
  });
});

describe("z2PwHrBaselineBefore — excludes non-comparable rides from the baseline mean", () => {
  it("drops a high-VI ride from the baseline even though its Z2 reading would otherwise qualify", () => {
    const rides = [
      r("2026-06-01", 1.5), // steady, default VI 1.028
      r("2026-06-05", 1.6), // steady
      r("2026-06-09", 9.9, 30, "Ride", 200, 241), // high-VI (1.205) — must be excluded despite a qualifying Z2 reading
      r("2026-06-12", 1.4), // steady
    ];
    // Without the VI gate, the mean would include 9.9 and be wildly skewed. With it, only 1.5/1.6/1.4 count.
    expect(z2PwHrBaselineBefore(rides, "2026-06-20")).toBeCloseTo((1.5 + 1.6 + 1.4) / 3, 5);
  });
});

describe("aerobicEffPct — end-to-end through the tightened qualifyingPwHr", () => {
  it("returns null for a high-VI ride even with a valid baseline — this alone is the fix for the aerobic-efficiency penalty", () => {
    const mixedRide = r("2026-08-06", 1.35, 20, "Ride", 200, 241); // VI 1.205, matches the screenshot ride
    expect(aerobicEffPct(mixedRide, 1.5)).toBeNull();
  });

  it("still computes a real percentage for a genuinely steady ride", () => {
    const steadyRide = r("2026-08-06", 1.35, 40, "Ride", 200, 206); // VI 1.03
    expect(aerobicEffPct(steadyRide, 1.5)).toBeCloseTo(-10, 5); // (1.35-1.5)/1.5*100
  });
});

describe("isSteadyEnduranceRide", () => {
  const ride = (over: Partial<ComparableRide> = {}): ComparableRide => ({
    type: "Ride",
    movingTimeSec: 90 * 60,
    avgWatts: 200,
    normalizedPower: 208, // VI 1.04 — steady
    ...over,
  });

  it("accepts an outdoor, long-enough, in-band, low-variability ride", () => {
    expect(isSteadyEnduranceRide(ride(), 280)).toBe(true);
  });

  it("rejects indoor/virtual rides", () => {
    expect(isSteadyEnduranceRide(ride({ type: "VirtualRide" }), 280)).toBe(false);
  });

  it("rejects rides under the 45-minute floor", () => {
    expect(isSteadyEnduranceRide(ride({ movingTimeSec: 44 * 60 }), 280)).toBe(false);
  });

  it("rejects rides outside the 0.56-0.85 endurance band", () => {
    expect(isSteadyEnduranceRide(ride({ normalizedPower: 140, avgWatts: 135 }), 280)).toBe(false); // IF 0.50
    expect(isSteadyEnduranceRide(ride({ normalizedPower: 250, avgWatts: 242 }), 280)).toBe(false); // IF 0.89
  });

  it("rejects a surgy ride that would otherwise pass the band — the mixed-terrain case", () => {
    // The 2026-08-06 screenshot ride: 118 min, NP 241, avg 200, FTP 288 -> IF 0.837 (in band), VI 1.205.
    expect(isSteadyEnduranceRide(ride({ movingTimeSec: 118 * 60, normalizedPower: 241, avgWatts: 200 }), 288)).toBe(false);
  });

  it("accepts exactly at the variability threshold and rejects just above it", () => {
    // avgWatts 200 with NP 224 -> VI 1.12; 225 -> VI 1.125. Verified in Node that 224/200 and the literal
    // 1.12 round to the IDENTICAL IEEE-754 double (224/200 === 1.12 evaluates true) — neither is "exactly
    // representable" in an absolute sense (1.12 is a repeating binary fraction, same class as 0.1), but
    // both operands land on the same bit pattern, so this comparison is stable, not a coincidence to avoid.
    expect(isSteadyEnduranceRide(ride({ normalizedPower: 224, avgWatts: 200 }), 280)).toBe(true);
    expect(isSteadyEnduranceRide(ride({ normalizedPower: 225, avgWatts: 200 }), 280)).toBe(false);
    expect(AEROBIC_MAX_VI).toBe(1.12);
  });

  it("fails CLOSED when NP is absent — cannot rule out a surgy ride", () => {
    // Verified against real data (90-day window): 0 of 43 rides that pass duration+band lack
    // normalizedPower, so this costs nothing in practice — it's the safer default, not a tradeoff.
    expect(isSteadyEnduranceRide(ride({ normalizedPower: null, avgWatts: 200 }), 280)).toBe(false);
  });

  it("rejects a ride with no power at all", () => {
    expect(isSteadyEnduranceRide(ride({ normalizedPower: null, avgWatts: null }), 280)).toBe(false);
  });

  it("skips the band check when FTP is unknown, but still applies duration and variability", () => {
    expect(isSteadyEnduranceRide(ride({ normalizedPower: 400, avgWatts: 390 }), 0)).toBe(true); // VI 1.026
    expect(isSteadyEnduranceRide(ride({ normalizedPower: 400, avgWatts: 300 }), 0)).toBe(false); // VI 1.33
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/aerobic.test.ts
```

Expected: FAIL — `isSteadyEnduranceRide`/`AEROBIC_MAX_VI` not exported; `qualifyingPwHr`'s VI tests fail because the current implementation has no VI check; the new `PwHrRide` object literals won't type-check yet either (missing fields on the interface).

- [ ] **Step 3: Widen `PwHrRide` and add the variability gate to `qualifyingPwHr`**

Replace `lib/aerobic.ts:13-28` (the `PwHrRide` interface through the end of `qualifyingPwHr`):

```ts
export interface PwHrRide {
  date: string; // YYYY-MM-DD
  type: string; // activity type — only OUTDOOR "Ride" qualifies (see qualifyingPwHr)
  powerHrZ2: number | null;
  powerHrZ2Mins: number | null;
  // Both required (not optional), matching ActivitySummary's own non-optional-but-nullable shape, so a
  // real ActivitySummary satisfies this interface with zero changes. Added 2026-08-06 so qualifyingPwHr
  // can apply the same variability gate isSteadyEnduranceRide does — see AEROBIC_MAX_VI below.
  avgWatts: number | null;
  normalizedPower: number | null;
}

// A ride's Z2 Pw:HR if it's an OUTDOOR ride that clears the Z2-minutes floor AND was steady enough for its
// own Z2 samples to be trustworthy, else null. Outdoor-only (`type === "Ride"`, excluding VirtualRide) for
// parity with the Trends Pw:HR (`isSteadyEnduranceRide`): indoor/virtual rides have no wind cooling →
// cardiac drift, and ERG holds power flat, so their Z2 Pw:HR is distorted.
//
// VARIABILITY GATE (2026-08-06): a ride's Z2-isolated Pw:HR is only trustworthy when the ride as a WHOLE
// was steady — on a structurally mixed ride (Z2 cruising between hard climbs), the Z2-zone power samples
// still carry cardiac drift from the efforts around them (HR doesn't reset the instant power drops back
// into Z2), so "Z2 power" does not mean "undisturbed aerobic HR" on a surgy ride. Measured over the real
// 90-day sync window: 24 of 38 (63%) of the rides that previously qualified for the baseline fell outside
// this gate, 10 of those with implausible (>8%) decoupling — this was NOT a marginal, single-ride effect.
// Fails CLOSED (excludes) when VI can't be computed: verified against real data that 0 of 43 candidate
// rides lack normalizedPower, so this costs nothing in practice.
//
// DELIBERATELY narrower than isSteadyEnduranceRide: no duration floor, no whole-ride IF band. Those
// answer "is the WHOLE ride comparable for a whole-ride metric" (decoupling, EF trend) — a different
// question from "is THIS ride's Z2-isolated reading trustworthy." A short, gentle Recovery ride below the
// 0.56 IF band is a perfectly legitimate Pw:HR reading; conflating the two gates was a real mistake this
// plan corrected before implementation — do not reintroduce it (see aerobic.test.ts's Recovery-ride test).
export function qualifyingPwHr(r: PwHrRide): number | null {
  if (r.type !== "Ride" || r.powerHrZ2 == null || (r.powerHrZ2Mins ?? 0) < AEROBIC_MIN_Z2_MINS) return null;
  if (r.normalizedPower == null || r.avgWatts == null || r.avgWatts <= 0) return null; // fail closed
  if (r.normalizedPower / r.avgWatts > AEROBIC_MAX_VI) return null;
  return r.powerHrZ2;
}
```

Add the new constant near the top of the file, alongside the existing `AEROBIC_*` constants (after `AEROBIC_DEADBAND_PCT`, currently line 11):

```ts
// Derived from the athlete's own 187-activity sync window (2026-08-06), not chosen: 1.12 is the loosest
// threshold that still excludes every ride whose whole-ride decoupling exceeds DECOUPLING_GOOD_BOUNDS.max
// (8% — the repo's own "above this a cutoff is meaningless" line), while keeping the majority of plausible
// steady rides. A PROVISIONAL, athlete-specific value, not a universal physiological constant — treat it
// the way the design spec treats its 30-minute segment threshold: revisit with real data if it stops
// fitting. Shared by qualifyingPwHr (Z2-segment trustworthiness) and isSteadyEnduranceRide (whole-ride
// comparability) below — the ONLY thing the two predicates share; they otherwise test different things.
export const AEROBIC_MAX_VI = 1.12;
```

- [ ] **Step 4: Add `isSteadyEnduranceRide` to `lib/aerobic.ts`**

Append after `qualifyingPwHr`:

```ts
// ---------- ride-level aerobic comparability (a DIFFERENT question from qualifyingPwHr above — see the
// module-level note on AEROBIC_MAX_VI) ----------

export const ENDURANCE_MIN_SEC = 45 * 60;

// Structural shape, not ActivitySummary — so the predicate stays testable without a 30-field fixture.
// ActivitySummary satisfies it structurally, so real callers pass activities directly with no cast.
export interface ComparableRide {
  type: string;
  movingTimeSec: number;
  avgWatts: number | null;
  normalizedPower: number | null;
}

// The like-for-like gate that makes a WHOLE-RIDE aerobic metric (Intervals.icu's decoupling, the Trends EF
// series) comparable across rides. Moved here from lib/trends.ts (2026-08-06). NOT the same question as
// qualifyingPwHr (Z2-segment trustworthiness, above) — this one needs the WHOLE ride to be steady-endurance
// shaped, because decoupling/EF are whole-ride metrics; qualifyingPwHr only needs the Z2 portion to be
// trustworthy. Do not use one to gate the other's consumer.
//
//   • OUTDOOR only — indoor/virtual rides have no wind cooling (cardiac drift) and ERG flattens power.
//   • >= 45 min — shorter rides don't yield a meaningful whole-ride aerobic signal.
//   • endurance band ~0.56-0.85 FTP — hard/easy days aren't comparable. Skipped when FTP is unknown.
//   • VI <= AEROBIC_MAX_VI, fail CLOSED when uncomputable — a mixed-terrain ride averages into the band
//     but reports 15-46% "drift" that is a ride-structure artifact, not aerobic fade.
export function isSteadyEnduranceRide(a: ComparableRide, ftp: number): boolean {
  if (a.type !== "Ride") return false;
  if (a.movingTimeSec < ENDURANCE_MIN_SEC) return false;
  const power = a.normalizedPower ?? a.avgWatts;
  if (power === null) return false;
  if (ftp > 0 && (power / ftp < 0.56 || power / ftp > 0.85)) return false;
  if (a.normalizedPower == null || a.avgWatts == null || a.avgWatts <= 0) return false; // fail closed
  if (a.normalizedPower / a.avgWatts > AEROBIC_MAX_VI) return false;
  return true;
}
```

- [ ] **Step 5: Delete the old copy from `lib/trends.ts` and import instead**

Replace `lib/trends.ts:22-46` (the `ENDURANCE_MIN_SEC` comment block through the end of `isSteadyEnduranceRide`) with:

```ts
// Efficiency Factor = NP / avg HR — the standard aerobic-efficiency marker. Restricted by
// isSteadyEnduranceRide (lib/aerobic.ts) so the trend compares like-for-like: outdoor only, >= 45 min,
// steady-endurance band, and low variability. Uses Intervals.icu's icu_efficiency_factor when present,
// falling back to NP/HR.
```

Add to the import block at the top of `lib/trends.ts`:

```ts
import { isSteadyEnduranceRide } from "./aerobic";
```

Leave `efSeries` and `hrrcSeries` otherwise untouched. `hrrcSeries`'s comment at `trends.ts:59-62` references `isSteadyEnduranceRide` by name — that reference still resolves, so leave it.

- [ ] **Step 6: Update the three external import sites**

`lib/trends.test.ts:2` — remove `isSteadyEnduranceRide` from the `./trends` import if present, and confirm the file's other imports still resolve.

`lib/anthropic-prompts.ts:20` — change `import { isSteadyEnduranceRide } from "./trends";` to `import { isSteadyEnduranceRide } from "./aerobic";`.

`app/api/sync/route.ts:48` — change:

```ts
import { isSteadyEnduranceRide, latestWeeklyBalance, weeklyEnergy } from "@/lib/trends";
```

to:

```ts
import { latestWeeklyBalance, weeklyEnergy } from "@/lib/trends";
```

and add `isSteadyEnduranceRide` to the existing `@/lib/aerobic` import on that route (it already imports `aerobicEffPct, z2PwHrBaselineBefore`). Verify:

```bash
grep -rn "isSteadyEnduranceRide" --include='*.ts' --include='*.tsx' lib/ app/ components/
```

Expected: definition in `lib/aerobic.ts`, plus exactly three importers (`lib/trends.ts`, `lib/anthropic-prompts.ts`, `app/api/sync/route.ts`) and the test file.

- [ ] **Step 7: Add one athlete-state test proving the baseline tightening reaches the live aerobic signal**

`lib/athlete-state.ts:173` calls `qualifyingPwHr` directly (`const qualifying = acts.filter((a) => qualifyingPwHr(a) != null);`) to build BOTH the "now" reading and the baseline for `evalAerobicEff`. Its shared `act()` fixture (`lib/athlete-state.test.ts:145`) already sets `avgWatts: 165, normalizedPower: 165` (VI exactly 1.0) — every existing test is already comfortably steady and unaffected. Add one new test proving the tightening is live end-to-end:

```ts
it("excludes a high-VI ride from the aerobic-efficiency baseline (2026-08-06 tightening)", () => {
  const s = sync([
    act({ date: iso(1), powerHrZ2: 1.55, powerHrZ2Mins: 60 }), // steady, VI 1.0 (default)
    act({ date: iso(4), powerHrZ2: 1.5, powerHrZ2Mins: 50 }),
    act({ date: iso(8), powerHrZ2: 1.6, powerHrZ2Mins: 70 }),
    // A high-VI ride with an outlier Z2 reading — must NOT enter the baseline despite clearing the
    // Z2-minutes floor and the outdoor-only gate.
    act({ date: iso(6), powerHrZ2: 9.9, powerHrZ2Mins: 60, avgWatts: 200, normalizedPower: 241 }),
  ]);
  const inputs = athleteStateInputsFrom(s, model, null, iso(0));
  expect(inputs.aerobicEffBaseline).not.toBeNull();
  expect(inputs.aerobicEffBaseline!).toBeLessThan(2); // would be skewed far above 2 if the outlier leaked in
});
```

Check the file's existing `sync()`/`model`/`iso()` helpers before pasting — match their actual exported names and signatures (they're already used by every other test in the file).

- [ ] **Step 8: Run the full check**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/aerobic.ts lib/aerobic.test.ts lib/trends.ts lib/trends.test.ts lib/anthropic-prompts.ts app/api/sync/route.ts lib/athlete-state.test.ts
git commit -m "refactor(aerobic): variability-aware qualifyingPwHr and isSteadyEnduranceRide

Adds a shared AEROBIC_MAX_VI (1.12) threshold to both predicates, which answer
deliberately different questions (Z2-segment trustworthiness vs whole-ride
comparability) and are not merged. Because aerobicEffPct() calls qualifyingPwHr on
the ride being scored, this alone fixes the off-plan/planned aerobic-efficiency
penalty for the existing, unmodified score-log.ts/ride-analysis.ts call chains — see
Task 3. Both predicates fail closed when NP is missing (verified zero-cost: 0/43
real candidate rides lack it). Baseline pool was 63% contaminated (24/38), not
marginal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Make the variability axis reward-only for intrinsic (off-plan) rides

**Files:**
- Modify: `lib/execution-score.ts:267-285`
- Test: `lib/execution-score.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (independent — `execution-score.ts` has no activity data to gate; `intrinsic` is caller-supplied).
- Produces: no signature change. `computeExecutionScore`'s existing `intrinsic?: boolean` input now also governs the VI branch's penalty half only.

**Design decision (confirmed with you, not re-opened):** VI is reward-only for intrinsic rides — the bonus (steady pacing) survives, only the penalty (surgy pacing against an inferred type) is removed. This matches decision 11's literal wording ("do not apply VI penalties," not "any effect") and isn't self-referential the way the removed intensity-vs-type circularity was: VI (pacing smoothness) is a different measured quantity from IF (the quantity the type was inferred from), so rewarding steady pacing on an off-plan ride isn't "true by construction" the way an IF-band match against an IF-inferred type would be.

- [ ] **Step 1: Write the failing tests**

Uses differencing (two rides that differ only in VI, everything else held constant) so the assertion can't be confounded by another axis:

```ts
describe("variability index on off-plan (intrinsic) rides", () => {
  // Both rides in each pair share IDENTICAL intensityFactor/plannedType/aerobicEffPct — only
  // variabilityIndex differs — so any score difference within a pair is attributable to VI alone,
  // regardless of what the intensity-vs-type axis happens to do for that IF/type combination.
  const commonBase = {
    compliancePct: null,
    intensityFactor: 0.84, // inside the Threshold sweet spot [0.82, 0.92] — held constant across both
                            // rides in each pair, so the intensity-vs-type branch's effect cancels out
                            // of the WITHIN-PAIR difference regardless of what it equals.
    plannedType: "Threshold" as const,
    aerobicEffPct: null,
  };

  it("does not penalise a surgy off-plan ride, but a steady one still earns its pacing bonus", () => {
    const steady = computeExecutionScore({ ...commonBase, variabilityIndex: 1.02, intrinsic: true })!; // <=1.08 -> +1
    const surgy = computeExecutionScore({ ...commonBase, variabilityIndex: 1.21, intrinsic: true })!; // >=1.15, penalty suppressed -> +0
    expect(steady).toBe(6); // 5 baseline + 1 VI bonus (intensity-vs-type skipped entirely: intrinsic)
    expect(surgy).toBe(5); // 5 baseline, no VI effect either way
    expect(steady).toBe(surgy + 1); // the ONLY difference between these two rides is the VI bonus
  });

  it("still penalises a surgy PLANNED threshold ride relative to a steady one", () => {
    const steady = computeExecutionScore({ ...commonBase, variabilityIndex: 1.02, intrinsic: false })!;
    const surgy = computeExecutionScore({ ...commonBase, variabilityIndex: 1.21, intrinsic: false })!;
    expect(steady).toBe(8); // 5 baseline + 2 intensity-band (IF 0.84 in [0.82,0.92]) + 1 VI bonus
    expect(surgy).toBe(6); // 5 baseline + 2 intensity-band - 1 VI penalty (planned, so NOT suppressed)
    expect(steady).toBe(surgy + 2); // steady's +1 bonus AND surgy's -1 penalty both apply here — a
                                     // 2-point gap, vs only a 1-point gap for the intrinsic pair above.
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/execution-score.test.ts -t "variability index on off-plan"
```

Expected: FAIL — the first test's `surgy` currently returns `4` (5 baseline − 1 VI penalty, not yet suppressed for intrinsic), not `5`.

- [ ] **Step 3: Implement the reward-only rule**

Replace the VI block at `lib/execution-score.ts:267-285`:

```ts
  // --- Pacing smoothness via variability index (±1) ---
  // VI = NP / avg power. ~1.0 means perfectly steady; higher means surgy.
  // Only meaningful for steady session types — intervals (VO2max/SIT) are meant
  // to be variable, so they are left neutral.
  //
  // REWARD-ONLY for intrinsic (off-plan) rides. An off-plan ride's `plannedType` was INFERRED from its
  // own intensity (lib/ride-classify.inferWorkoutType), so penalising it for missing that type's
  // steadiness is the same circularity the intensity-vs-type branch above already refuses: a
  // mixed-terrain ride reads IF 0.84 -> "Threshold" -> surgy -> -1, purely because it contained
  // climbing. A BONUS is not circular in the same way — VI (pacing) is a different measured quantity
  // from IF (what the type was inferred from), so rewarding steady pacing doesn't manufacture credit
  // "true by construction" the way an IF-band match against an IF-inferred type would. Confirmed as
  // the intended design (not a workaround): decision 11 says "do not apply VI PENALTIES," not "any
  // effect." Reverses the deliberate "this only enables VI" note that used to sit in
  // lib/ride-analysis.ts's scoringType comment.
  if (variabilityIndex !== null && plannedType) {
    const vi = variabilityIndex;
    switch (plannedType) {
      case "Z2":
      case "Recovery":
        if (vi <= 1.06) score += 1; // held the zone steadily, as intended — a bonus only.
        // No penalty for high VI: outdoor easy rides are naturally surgy (terrain), which is not a
        // discipline failure. The HR read is the sole "too hard" judge for easy rides.
        break;
      case "Threshold":
        if (vi <= 1.08) score += 1; // well-controlled threshold effort
        else if (vi >= 1.15 && !intrinsic) score -= 1; // circular off-plan — see the note above
        break;
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run lib/execution-score.test.ts
```

Expected: PASS, including every pre-existing test in the file (planned rides at other IF/VI combinations are untouched).

- [ ] **Step 5: Fix the now-wrong comment in `lib/ride-analysis.ts`**

`lib/ride-analysis.ts:169-172` currently reads:

```ts
  // Off-plan (no planned session) → infer a scoring type so the VI pacing read applies, exactly as the
  // ledger does. `intrinsic` still guards the circular intensity-vs-type branch, so this only enables VI;
  // the OUTPUT plannedType field below stays null (nothing was planned).
```

Replace with:

```ts
  // Off-plan (no planned session) → infer a scoring type, exactly as the ledger does, so the VI pacing
  // BONUS can still apply. As of 2026-08-06 the VI penalty is suppressed for intrinsic rides (it was
  // circular — the type comes from the ride's own intensity; see computeExecutionScore's VI block), so
  // this enables the reward half only. The OUTPUT plannedType field below stays null (nothing was planned).
```

- [ ] **Step 6: Fix a pre-existing test whose comment documents the penalty this task removes**

`lib/ride-analysis.test.ts:182-195` — `"applies the VI pacing read to an off-plan ride (infers a type so steady ≠ surgy)"` — asserts `steady` scores higher than `surgy` via `toBeGreaterThan`. Trace both through after this task's change (`base.ftp = 250`, both rides infer `plannedType: "Threshold"` from `IF = 200/250 = 0.8`):

- `offPlan(190)` (steady): VI = 200/190 = 1.0526 ≤ 1.08 → Threshold's `+1` bonus applies regardless of `intrinsic`. Score = 5 + 1 = **6**.
- `offPlan(165)` (surgy): VI = 200/165 = 1.2121 ≥ 1.15, but the penalty is now gated `!intrinsic` and this ride is `intrinsic: true` → **no penalty applies**. Score = 5 (baseline, no VI effect either way) = **5**.

The numeric assertion (`6 > 5`) still holds, but the test's inline comment (`// VI 1.21 → surgy (−1)`) describes a penalty that no longer fires. Replace lines 182-195:

```ts
  it("rewards steady pacing on an off-plan ride but never penalises surgy pacing (VI is reward-only when intrinsic)", () => {
    // Off-plan = no planned session; both rides infer the same type (IF 0.80 → Threshold), so only VI
    // differs. Without inferring a scoring type, off-plan rides got no VI signal at all and these would tie.
    const offPlan = (avgWatts: number) => ({
      ...base,
      plannedDay: null,
      activity: activity({ avgWatts, normalizedPower: 200, rpe: null }),
    });
    // VI 1.0526 ≤ 1.08 → Threshold's steady bonus (+1). A bonus is never circular, so it applies to
    // off-plan rides exactly as it would to a planned one.
    expect(buildTodayAnalysis(offPlan(190)).executionScore).toBe(6);
    // VI 1.2121 ≥ 1.15 would penalise a PLANNED Threshold ride (-1), but this ride's type was INFERRED
    // from its own intensity — penalising it for missing that type's steadiness would be circular, so
    // the penalty is suppressed for intrinsic rides. Baseline, no VI effect either way.
    expect(buildTodayAnalysis(offPlan(165)).executionScore).toBe(5);
    // The OUTPUT plannedType stays null (nothing was planned) even though scoring inferred one.
    expect(buildTodayAnalysis(offPlan(190)).todayAnalysis.plannedType).toBeNull();
  });
```

- [ ] **Step 7: Run the full check**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/execution-score.ts lib/execution-score.test.ts lib/ride-analysis.ts lib/ride-analysis.test.ts
git commit -m "fix(scoring): stop penalising off-plan rides for variability against an inferred type

An off-plan ride's type is inferred from its own intensity, so the VI penalty was
circular in exactly the way the intensity-vs-type branch already guards against. The
VI bonus is unaffected — it isn't self-referential the way the penalty was, and
decision 11 scoped the fix to penalties only.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Verify the aerobic-efficiency penalty is already fixed, off-plan AND planned — no source change

**Files:**
- Test only: `lib/score-log.test.ts`

**Interfaces:**
- Consumes: Task 1's tightened `qualifyingPwHr` (via the existing, unmodified `easyAerobicEffPct = aerobicEffPct(act, z2PwHrBaselineBefore(activities, act.date))` line already in `lib/score-log.ts`).
- Produces: nothing new for later tasks — this is a verification task confirming Task 1 was sufficient.

**Why there's no source change here:** `lib/score-log.ts`'s off-plan branch already does `aerobicEffPct: easyAerobicEffPct` as a direct, ungated pass-through, and its planned branch already does the same for `mergedEasyRead`'s input. Both derive `easyAerobicEffPct` from `aerobicEffPct(act, ...)`, which — after Task 1 — internally calls the tightened `qualifyingPwHr(act)` on the ride being scored. A high-VI ride's `easyAerobicEffPct` is `null` with zero code changes beyond Task 1. This task exists to PROVE that, end-to-end, through the real call chain — not to add a redundant gate on top of it (an earlier draft did exactly that, and it was wrong: see "Why this plan looks the way it does" above).

- [ ] **Step 1: Write the tests**

Add to `lib/score-log.test.ts`, reusing the file's existing `activity()`/`block()` helpers. **Use `.find(e => e.date === ...)` to locate entries** — `buildRideScores` returns entries in the insertion order of the `activities` array it was given, not sorted by date, so destructuring the first element of a multi-activity result grabs whichever ride was listed first, not necessarily the one under test.

```ts
describe("aerobic-efficiency penalty is withheld on non-comparable rides via qualifyingPwHr alone (Task 1)", () => {
  const ftp = () => 288;
  // Baseline-forming rides: steady, outdoor, well inside the band, ~1.5 Pw:HR.
  const baseline = ["2026-06-01", "2026-06-05", "2026-06-09"].map((date) =>
    activity({ date, movingTimeSec: 90 * 60, avgWatts: 200, normalizedPower: 206, icuFtp: 288, powerHrZ2: 1.5, powerHrZ2Mins: 40 })
  );

  it("off-plan: scores a surgy mixed ride at baseline instead of applying the -2 aerobic penalty", () => {
    // 118 min, NP 241 / avg 200 -> VI 1.205 (> AEROBIC_MAX_VI), IF 0.837 (in band, irrelevant here since
    // this is off-plan). Pw:HR 1.35 is ~10% below the 1.5 baseline -> would be -2 without Task 1's gate.
    const mixed = activity({
      date: "2026-06-15", movingTimeSec: 118 * 60, avgWatts: 200, normalizedPower: 241,
      icuFtp: 288, powerHrZ2: 1.35, powerHrZ2Mins: 20,
    });
    const entry = buildRideScores(null, [...baseline, mixed], ftp, "2026-06-15", "2026-01-01").find((e) => e.date === "2026-06-15")!;
    expect(entry.planned).toBe(false);
    expect(entry.executionScore).toBe(5); // no aerobic penalty, no VI penalty (Task 2)
  });

  it("off-plan: still applies the aerobic read to a genuinely steady mixed ride", () => {
    const steady = activity({
      date: "2026-06-15", movingTimeSec: 100 * 60, avgWatts: 200, normalizedPower: 206,
      icuFtp: 288, powerHrZ2: 1.35, powerHrZ2Mins: 40,
    });
    const entry = buildRideScores(null, [...baseline, steady], ftp, "2026-06-15", "2026-01-01").find((e) => e.date === "2026-06-15")!;
    expect(entry.executionScore).toBe(4); // 5 baseline + 1 VI bonus (steady) - 2 aerobic penalty (below baseline)
  });

  it("planned Z2: withholds the aerobic-efficiency penalty on a ride that turned surgy, no explicit gate needed", () => {
    const z2Block = block([{ date: "2026-06-15", type: "Z2", durationMin: 118 }]);
    // Same shape as the off-plan case above: VI 1.205 (not comparable via qualifyingPwHr), Pw:HR 1.35
    // (10% below baseline). hrZoneTimes [3000,3000,1080] -> 1080/7080 = 15.25% above aerobic -> "drift"
    // (>10% dialed ceiling, <=25% drift ceiling) — deliberately NOT "hot", so the untouched HR-zone-time
    // discipline signal stays in its 0-contribution branch, isolating what qualifyingPwHr's tightening
    // alone changed.
    const surgyPlanned = activity({
      date: "2026-06-15", movingTimeSec: 118 * 60, avgWatts: 200, normalizedPower: 241,
      icuFtp: 288, powerHrZ2: 1.35, powerHrZ2Mins: 20, hrZoneTimes: [3000, 3000, 1080],
    });
    const entry = buildRideScores(z2Block, [...baseline, surgyPlanned], ftp, "2026-06-15").find((e) => e.date === "2026-06-15")!;
    expect(entry.planned).toBe(true);
    // qualifyingPwHr(surgyPlanned) is null (VI 1.205), so aerobicEffPct is null, so easyStampFor never
    // receives a value to freeze — no explicit gate anywhere in score-log.ts made this happen.
    expect(entry.easy?.aerobicEffPct).toBeUndefined();
    // 5 baseline + 2 duration compliance (100%) + 0 intensity (IF 0.837 outside the Z2 0.60-0.74 band,
    // Z2 is reward-only so no penalty either) + 0 mergedEasyRead ("drift" HR read, but aerobicEffPct is
    // null so its penalty-if-corroborated branch returns 0 instead of -2) + 0 VI (1.205 doesn't clear
    // the Z2 <=1.06 bonus threshold) = 7.
    expect(entry.executionScore).toBe(7);
  });

  it("planned Z2: still applies the aerobic read on a ride that stayed steady", () => {
    const z2Block = block([{ date: "2026-06-15", type: "Z2", durationMin: 100 }]);
    const steadyPlanned = activity({
      date: "2026-06-15", movingTimeSec: 100 * 60, avgWatts: 200, normalizedPower: 206,
      icuFtp: 288, powerHrZ2: 1.35, powerHrZ2Mins: 40, hrZoneTimes: [3600, 2400, 0], // 0% above aerobic -> dialed
    });
    const entry = buildRideScores(z2Block, [...baseline, steadyPlanned], ftp, "2026-06-15").find((e) => e.date === "2026-06-15")!;
    expect(entry.easy?.aerobicEffPct).toBeDefined();
    // 5 baseline + 2 duration compliance (100%) + 1 intensity (IF 0.715, inside the Z2 0.60-0.74 band)
    // + 0 mergedEasyRead ("dialed" HR read, but aerobicEffPct -10% clears the -2x-deadband threshold,
    // so dialed's table gives 0, not the +1 it would give above that threshold) + 1 VI (1.03 <= 1.06
    // bonus) = 9.
    expect(entry.executionScore).toBe(9);
  });

  // Guards the over-suppression bug an earlier draft introduced: a short, low-intensity ride that
  // qualifyingPwHr correctly trusts (steady VI, enough Z2 minutes) must NOT be suppressed just because
  // it fails isSteadyEnduranceRide's UNRELATED duration/IF-band criteria — those predicates answer
  // different questions (see Task 1's module comment) and score-log.ts must only ever consult the one
  // that matches what it's actually scoring.
  it("off-plan: a short Recovery ride below the endurance IF band still gets its aerobic read", () => {
    const shortEasy = activity({
      date: "2026-06-15", movingTimeSec: 25 * 60, avgWatts: 150, normalizedPower: 152, // IF 0.53, VI 1.013
      icuFtp: 288, powerHrZ2: 1.65, powerHrZ2Mins: 20,
    });
    const entry = buildRideScores(null, [...baseline, shortEasy], ftp, "2026-06-15", "2026-01-01").find((e) => e.date === "2026-06-15")!;
    // (1.65-1.5)/1.5*100 = +10% -> above baseline -> +2 bonus on the intrinsic axis, NOT withheld.
    expect(entry.executionScore).toBeGreaterThan(5);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run lib/score-log.test.ts
```

Expected: **all new tests PASS immediately** — this task adds no source change, so there is no red step. If any fail, the bug is in Task 1's implementation, not here; go re-check `lib/aerobic.ts` before touching this file.

- [ ] **Step 3: Confirm no pre-existing test needed a fix**

Run the full file once more and confirm every pre-existing test in `lib/score-log.test.ts` still passes unchanged — in particular the `"buildRideScores — easy-ride merged-read provenance (Task 2)"` describe block's `baselineRides`/`targetRide` fixtures (VI ~1.03, comparable) and its `"hoisting doesn't change off-plan scoring..."` test, none of which are touched by Task 1's `qualifyingPwHr` tightening since their VI was always low. If you find yourself wanting to change a pre-existing test's FTP or fixture to make something pass, stop — that was the sign of the redundant-gate mistake in an earlier draft, and this task should not need it.

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/score-log.test.ts
git commit -m "test(scoring): verify the aerobic-efficiency penalty is fixed for off-plan AND planned rides

No source change — lib/score-log.ts already passes aerobicEffPct through unmodified;
Task 1's tightened qualifyingPwHr (called internally by aerobicEffPct on the ride
being scored) is the entire fix. Includes a regression test proving a short,
low-intensity ride that qualifyingPwHr correctly trusts is NOT wrongly suppressed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Gate `activityDecoupling` on the today path — the one signal that genuinely needs a consumer-side check

**Files:**
- Modify: `lib/ride-analysis.ts` (`activityDecoupling` at line 234 only — NOT the `aerobicEffPct` argument to `computeExecutionScore`, which needs no change per Task 3's finding)
- Modify: `lib/types.ts:996` (comment only)
- Test: `lib/ride-analysis.test.ts`

**Interfaces:**
- Consumes: `isSteadyEnduranceRide` from `lib/aerobic.ts` (Task 1).
- Produces: `TodayAnalysis.activityDecoupling` is now `null` whenever the ride is not aerobically comparable. Field type is unchanged (`number | null`).

**Why this one field, and only this one:** `activity.decoupling` is Intervals.icu's raw whole-ride figure — it does not flow through `qualifyingPwHr`/`aerobicEffPct` at all, so there is no producer-level protection for it anywhere. `buildTodayAnalysis`'s `aerobicEffPct` input, by contrast, is already computed by the caller (`app/api/sync/route.ts`'s `todayAerobicEffPct = aerobicEffPct(todayActivity, ...)`) before it ever reaches this function — `buildTodayAnalysis` is a pure pass-through for that field and needs no gate of its own (this was the mistake corrected before implementation: see the plan's header).

- [ ] **Step 1: Write the failing tests**

`lib/ride-analysis.test.ts` has no input-builder function — every test spreads a `base` object (defined at line 125, inside `describe("buildTodayAnalysis (CR-G)", ...)`) directly into `buildTodayAnalysis({ ...base, ... })`. Insert two new `it(...)` calls immediately before that describe block's closing `});` (currently line 361), closing over `base` and `activity` the same way every existing test does:

```ts
  it("omits drift entirely for a structurally mixed ride (VI 1.205)", () => {
    // 118 min, avg 200 / NP 241 -> VI 1.205 > AEROBIC_MAX_VI (1.12): not aerobically comparable, even
    // though IF (241/288 = 0.837) sits inside the 0.56-0.85 band. This is the 2026-08-06 screenshot ride.
    const mixed = activity({ movingTimeSec: 118 * 60, avgWatts: 200, normalizedPower: 241, decoupling: 15.7 });
    const { todayAnalysis } = buildTodayAnalysis({ ...base, activity: mixed, plannedDay: null, ftp: 288 });
    expect(todayAnalysis.activityDecoupling).toBeNull();
  });

  it("keeps drift for a genuinely steady ride", () => {
    // 100 min, avg 200 / NP 206 -> VI 1.03 (comparable), IF 206/288 = 0.715 (in band).
    const steady = activity({ movingTimeSec: 100 * 60, avgWatts: 200, normalizedPower: 206, decoupling: 3.8 });
    const { todayAnalysis } = buildTodayAnalysis({ ...base, activity: steady, plannedDay: null, ftp: 288 });
    expect(todayAnalysis.activityDecoupling).toBe(3.8);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/ride-analysis.test.ts
```

Expected: the first new test FAILS (`activityDecoupling` is currently `15.7`, unconditionally returned); the second already PASSES (steady rides were always shown correctly).

- [ ] **Step 3: Implement the gate**

Add the import to `lib/ride-analysis.ts`:

```ts
import { isSteadyEnduranceRide } from "./aerobic";
```

In the `todayAnalysis` object, change line 234 only:

```ts
    // Aerobic drift is only meaningful when power demand was uniform. On a mixed ride the whole-ride
    // figure is a ride-structure artifact (15-46% on this athlete's climbing days), so OMIT it rather
    // than label it — matching the repo's "better absent than wrong" convention. Segment-scoped drift
    // is deliberately deferred (Phase 1 scope). This is the ONLY field in buildTodayAnalysis that needs
    // this gate — aerobicEffPct is already correctly gated at its producer (Task 1's qualifyingPwHr), and
    // adding a second gate here would be redundant at best (see the plan's header note on Task 3-5).
    activityDecoupling: isSteadyEnduranceRide(activity, ftp) ? activity.decoupling : null,
```

Do **not** touch the `aerobicEffPct:` argument passed to `computeExecutionScore` a few lines above, and do **not** touch `aerobicEffPctForToday` a few lines below (both around lines 191 and 213-216 respectively) — both are already correct pass-throughs of an already-gated value.

- [ ] **Step 4: Update the field's doc comment in `lib/types.ts`**

At `lib/types.ts:996`, replace:

```ts
  activityDecoupling: number | null;
```

with:

```ts
  // Whole-ride Pw:HR drift %, or null when the ride wasn't aerobically comparable (isSteadyEnduranceRide
  // in lib/aerobic.ts — outdoor, >=45 min, 0.56-0.85 band, VI <= AEROBIC_MAX_VI, fail-closed on missing
  // NP). Null also on a ride Intervals.icu reported no decoupling for. The debrief renders the chip only
  // when this is non-null.
  activityDecoupling: number | null;
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run lib/ride-analysis.test.ts
```

Expected: PASS, including every pre-existing test.

- [ ] **Step 6: Run the full check**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/ride-analysis.ts lib/ride-analysis.test.ts lib/types.ts
git commit -m "fix(debrief): omit aerobic drift when the ride wasn't steady enough to measure it

Only activityDecoupling needs a consumer-side gate — it's Intervals.icu's raw
whole-ride figure with no producer-level protection, unlike aerobicEffPct (already
correctly gated at its producer, see Task 1/3).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Verify the UI degrades correctly and no third comparability check survives

**Files:**
- Read-only verification: `components/dashboard/today.tsx:380-411`
- Modify: none expected

- [ ] **Step 1: Confirm the debrief tolerates an absent drift value**

Read `components/dashboard/today.tsx:380-411`. Confirm both:

1. The `details` wrapper's condition (line 380) is an `||` chain that includes other content, so it still opens when `activityDecoupling` is null.
2. The chip itself (line 397) is guarded by `analysis.activityDecoupling != null`.

Both already hold — **make no change**. If either does not hold, fix it minimally and note the fix in the commit.

- [ ] **Step 2: Confirm exactly two (not three) variability/comparability checks exist, each in its right place**

```bash
grep -rn "0.56\|0\.85\|ENDURANCE_MIN_SEC\|AEROBIC_MAX_VI\|isSteadyEnduranceRide\|qualifyingPwHr" --include='*.ts' --include='*.tsx' lib/ app/ components/
```

Expected: the band constants `0.56`/`0.85` appear only inside `isSteadyEnduranceRide`. `AEROBIC_MAX_VI` appears only in `lib/aerobic.ts` (both `qualifyingPwHr` and `isSteadyEnduranceRide`) and its test file. `qualifyingPwHr` is called from `lib/aerobic.ts` itself (`z2PwHrBaselineBefore`, `aerobicEffPct`), `lib/athlete-state.ts:173`, and its test files — **not** from `lib/score-log.ts` or `lib/ride-analysis.ts` directly (those call `aerobicEffPct`, which calls `qualifyingPwHr` internally — a direct call from either file would be a sign the redundant-gate mistake crept back in). `isSteadyEnduranceRide` appears in `lib/trends.ts`, `lib/anthropic-prompts.ts`, `app/api/sync/route.ts`, and now `lib/ride-analysis.ts` (Task 4's `activityDecoupling` gate only) — **not** in `lib/score-log.ts` at all. `inferWorkoutType` in `lib/ride-classify.ts` has its own unrelated `0.56` (effort bucketing, not comparability) — leave it.

- [ ] **Step 3: Run the full check**

```bash
npm run check
```

Expected: PASS.

- [ ] **Step 4: Commit (only if Step 1 required a fix)**

```bash
git add components/dashboard/today.tsx
git commit -m "fix(today): keep the debrief section open when drift is withheld

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

If no fix was needed, skip the commit and say so in the task report.

---

### Task 6: Offline verification against real synced data, then docs

**Why offline, not a live sync (confirmed during review):** a fresh worktree has neither `data/` nor `.env*` (both gitignored) — there is nothing to sync against and nothing to diff. Separately, sync performs real `createEvent`/`deleteEvents` writes to the athlete's live Intervals.icu calendar, which is not something to fold into a verification step without explicit consent. This task instead runs the REAL, just-written TypeScript predicates against the already-synced `data/last-sync.json` snapshot in the MAIN checkout — read-only, no network, no mutation, reproducible.

**Files:**
- Create (temporary, never committed): `lib/_verify-phase1.test.ts`
- Modify: `docs/INVARIANTS.md` (add two numbered contracts)
- Modify: `docs/systems/02-scoring-and-learning.md` (add a "Known rough edges" section — **it does not currently exist in this file**, confirmed via `grep -c "Known rough edges" docs/systems/02-scoring-and-learning.md` returning `0`)
- Modify: `docs/FILE_INDEX.md` (`lib/aerobic.ts` row)
- Modify: `ROADMAP.md` (record the phase)

- [ ] **Step 1: Write and run a disposable, read-only verification script**

This file is temporary — Step 4 deletes it before the final commit. It must never be staged.

```ts
// lib/_verify-phase1.test.ts — TEMPORARY, delete before committing. Exercises the real Task 1 predicates
// against the athlete's actual synced data (read-only, no network) to prove the pool-size/calibration
// shift this plan predicts actually happens, not just that unit fixtures pass.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { isSteadyEnduranceRide, qualifyingPwHr, z2PwHrBaselineBefore } from "./aerobic";
import { deriveDecouplingGood } from "./calibration";
import type { ActivitySummary } from "./types";

const DATA_PATH = process.env.SYNC_DATA_PATH ?? "/Users/otis/Cycling App/data/last-sync.json";

describe("Phase 1 — offline verification against real synced data", () => {
  it("shrinks the steady-endurance pool and drops the derived decoupling-good cutoff", () => {
    const raw = JSON.parse(readFileSync(DATA_PATH, "utf8")) as { activities: ActivitySummary[] };
    const acts = raw.activities;
    const today = acts.reduce((max, a) => (a.date > max ? a.date : max), "");
    const cutoff90 = new Date(Date.parse(today) - 90 * 86_400_000).toISOString().slice(0, 10);
    const ftp = 288; // this athlete's current FTP as of the sync window this plan measured — confirm
                      // against data/physiology.json's current.ftp if re-running later and it's changed.

    const window = acts.filter((a) => a.date >= cutoff90);
    const steady = window.filter((a) => isSteadyEnduranceRide(a, ftp));
    const qualifying = window.filter((a) => qualifyingPwHr(a) != null);

    console.log(`90d window: ${cutoff90} .. ${today}`);
    console.log(`isSteadyEnduranceRide pool: ${steady.length} (measured 19 on 2026-08-06 — will drift as new rides sync)`);
    console.log(`qualifyingPwHr pool: ${qualifying.length} (measured 15 on 2026-08-06)`);

    expect(steady.length).toBeGreaterThan(0);
    expect(steady.length).toBeLessThan(window.filter((a) => a.type === "Ride").length);

    const steadyDecoup = steady.filter((a) => a.decoupling !== null);
    const mean = steadyDecoup.length ? steadyDecoup.reduce((s, a) => s + (a.decoupling as number), 0) / steadyDecoup.length : null;
    console.log(`mean decoupling over the tightened pool: ${mean?.toFixed(2)}% (measured ~0.25% on 2026-08-06, well under the prior ~5.0%)`);

    const derived = deriveDecouplingGood(undefined, mean, steadyDecoup.length);
    console.log(`deriveDecouplingGood output: ${JSON.stringify(derived)}`);
    expect(derived.value).toBeGreaterThanOrEqual(2.5); // DECOUPLING_GOOD_BOUNDS.min — the floor this plan predicts it clamps to
    expect(derived.value).toBeLessThanOrEqual(8); // DECOUPLING_GOOD_BOUNDS.max

    const baselineExample = z2PwHrBaselineBefore(window, today);
    console.log(`z2PwHrBaselineBefore for the most recent date: ${baselineExample}`);
  });
});
```

Run it:

```bash
npx vitest run lib/_verify-phase1.test.ts
```

Read the console output. Expected, based on the measurements this plan was written against: the steady pool lands around 18-20 rides (was 40-41 before this plan), the qualifying-baseline pool around 14-16 (was 38), and `deriveDecouplingGood`'s output clamps to its `2.5` floor. **These are the values measured on 2026-08-06 and will drift as new rides sync in — don't treat a close-but-different number as a failure; treat a wildly different one (e.g. the pool not shrinking at all) as a sign Task 1 isn't wired correctly, and stop to investigate.**

- [ ] **Step 2: Confirm the two screenshot rides via the offline snapshot, not the live UI**

Since both 2026-08-05 and 2026-08-06 are already frozen in `data/score-log.json` at `executionScore: 2` and Phase 1 does not retroactively rescore frozen entries, do **not** attempt to observe an improved score for either date in the running app. Instead, Task 3's own unit tests already prove the forward-looking behavior directly using this ride's real field values — that IS the verification for this specific ride; there is no additional live-UI step that adds information Phase 1 can actually demonstrate today.

- [ ] **Step 3: Check the Trends EF chart still has enough points**

Using the console output from Step 1, confirm the EF series pool (`isSteadyEnduranceRide`-filtered) isn't so small the chart becomes sparse/unreadable. If it drops under roughly 8 points over 90 days, report it — that would argue for revisiting `AEROBIC_MAX_VI`, which is a decision for you, not something to silently change.

- [ ] **Step 4: Delete the temporary verification script**

```bash
rm lib/_verify-phase1.test.ts
git status --short lib/_verify-phase1.test.ts
```

Expected: no output from `git status` — the file was never staged, just confirm it's gone from the working tree.

- [ ] **Step 5: Add the invariants**

Append to `docs/INVARIANTS.md` under "Architecture directions", continuing the existing numbering (currently ends at 33):

```markdown
34. **A shared variability criterion, not one comparability definition.** `isSteadyEnduranceRide` and
    `qualifyingPwHr` (`lib/aerobic.ts`) both gate on `AEROBIC_MAX_VI`, fail CLOSED when normalized power is
    unavailable — that is the ONLY thing they share. They answer different questions (whole-ride
    comparability for decoupling/EF vs. Z2-segment trustworthiness for the Pw:HR baseline) and must not be
    merged or used to gate each other's consumers: `aerobicEffPct()` already calls `qualifyingPwHr()`
    internally on the ride being scored, so a consumer-side `isSteadyEnduranceRide` check on the SAME value
    is redundant at best and silently over-suppressive at worst (it adds a duration/IF-band requirement
    `qualifyingPwHr` never needed, discarding legitimate short/low-intensity readings). Before gating a
    value against ride comparability, check whether it already flows through a gated producer.
35. **Inferred types may reward, never punish.** An off-plan ride's `plannedType` comes from
    `inferWorkoutType` on its own intensity, so any axis that penalises it against that type is circular.
    `computeExecutionScore` guards this for intensity-vs-type, the easy-ride merged read, and (since
    2026-08-06) the variability index — the bonus half of an axis is not circular (it measures a
    different quantity than the one that inferred the type) and stays live for intrinsic rides; only
    penalties are suppressed. A new penalty axis must add the same `!intrinsic` guard; a new bonus axis
    does not need one.
```

- [ ] **Step 6: Add the missing "Known rough edges" section to the systems doc**

`docs/systems/02-scoring-and-learning.md` has no such section today (confirmed: `grep -c "Known rough edges"` returns `0`). Add it as a new `##`-level section, matching the heading level and closing position the other systems docs use — insert it immediately before the existing `## Common modifications` heading (currently the file's last section):

```markdown
## Known rough edges

- **Off-plan (and planned-but-surgy) rides score flat until intent lands.** Phase 1 (2026-08-06) removed
  the axes that were punishing structurally mixed rides for their own structure — the circular VI penalty,
  and the contaminated intrinsic/merged-read Pw:HR efficiency signal (fixed entirely at its producer,
  `qualifyingPwHr` in `lib/aerobic.ts` — no gate was added in `score-log.ts` or `ride-analysis.ts` for this
  signal). Both removals are correct, but they leave a mixed ride with almost no quality differentiator:
  expect scores clustering around baseline (5/10) for most of them. The differentiator returns in Phase 2,
  when the athlete's activity note becomes the scoring target. Don't "fix" the flatness by re-adding a
  structure-derived penalty, and don't re-add a consumer-side comparability gate for `aerobicEffPct` — it's
  already correctly gated where it's computed.
- **The Pw:HR baseline and decoupling-good cutoff moved when Phase 1 shipped, and will keep moving.** The
  athlete's true steady-ride drift mean was measured well under `DECOUPLING_GOOD_BOUNDS.min` as of the
  2026-08-06 sync window, so `deriveDecouplingGood` clamps to its floor — that's the bounds doing their job
  on a pool that used to include structurally mixed rides, not a calibration failure. Both this value and
  the exact pool sizes are recalculated fresh on every sync from a rolling 90-day window; don't treat any
  specific number recorded in this plan's own text as durable.
- **`qualifyingPwHr` and `isSteadyEnduranceRide` are deliberately different gates.** See INVARIANT 34. A
  future change that needs "is this ride aerobically trustworthy" almost always means ONE of these two,
  not both — check which question is actually being asked before reaching for either.
```

- [ ] **Step 7: Update `docs/FILE_INDEX.md` and `ROADMAP.md`**

`FILE_INDEX.md` — update the `lib/aerobic.ts` row's description to name its widened responsibility ("Z2 Pw:HR baseline + the whole-ride steady-endurance predicate, both variability-aware but answering different questions") and add `isSteadyEnduranceRide` to any symbol listing that previously pointed at `lib/trends.ts`.

`ROADMAP.md` — append a 1–2 line entry under "Then" or "Watch" (never renumber existing IDs, per INVARIANT 26). Word it as landing on this branch, not "shipped" — `finish:agent-task` auto-merges `claude/*` branches, but the merge is a separate, later event:

```markdown
- **Adaptive self-directed coach — Phase 1 landed on `claude/adaptive-coach-p1-aerobic-eligibility`**
  (2026-08-06): a shared variability threshold now gates both `isSteadyEnduranceRide` (whole-ride
  comparability) and `qualifyingPwHr` (Pw:HR baseline membership); off-plan and planned-but-surgy rides
  no longer take circular VI/Pw:HR penalties. Historical entries already frozen before this landed (e.g.
  2026-08-05/06's `2/10`) are unaffected until a ledger rebuild is explicitly triggered — not part of this
  phase. Phases 2–4 (intent overlay, weekly envelope, historical repair) not started — design in
  `docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md`.
```

- [ ] **Step 8: Run the full check and commit**

```bash
npm run check
```

Expected: PASS. Confirm `lib/_verify-phase1.test.ts` is gone (Step 4) before this check — if it's still present, `npm test` will fail in any environment lacking this athlete's `data/last-sync.json`.

```bash
git add docs/INVARIANTS.md docs/systems/02-scoring-and-learning.md docs/FILE_INDEX.md ROADMAP.md
git commit -m "docs: record the shared-variability-criterion and inferred-types-may-not-punish contracts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Finish the branch**

```bash
npm run finish:agent-task
```

Do not `git push` or `gh pr create` manually — `finish:agent-task` is the only sanctioned integration path (AGENTS.md).

---

## Phase map — interfaces Phases 2–4 will consume

| Phase | Scope | Depends on Phase 1 for |
|---|---|---|
| **2** | Origin taxonomy (`prescribed` / `self-directed` / `unspecified`), permanent overlay store keyed by activity id, LLM intent parse, intent-aware scoring, deferred re-analysis | `qualifyingPwHr`/`isSteadyEnduranceRide` as the eligibility gates for any new aerobic objective — and the lesson that a gate belongs at the producer, not every consumer; the `!intrinsic` no-punish rule; `5/10` as the current off-plan floor the intent score must improve on |
| **3** | Weekly cycling-TSS envelope, no-block state read, one session suggestion, Today UI | Nothing structural — independent of Phase 1 |
| **4** | One-time three-week historical repair: report → human approval → overlay write → derived-state rebuild, PLUS the option to trigger a ledger rebuild so already-frozen dates (2026-08-05/06 included) pick up Phase 1's corrected scoring | Phase 2's overlay shape; Phase 1's scorer, since retro scoring must use "the same deterministic scorer and segment eligibility used for future rides"; `mergeScoreLogRebuild`'s existing LEDGER-1 guard |

One Phase 1 deferral still open: **segment-scoped decoupling** (design §7.1–7.4). Deferred per decision 11 until stream sampling behaviour is proven. Note for whoever picks it up: `fetchActivityStream` maps non-finite samples to `0`, so a sensor dropout is indistinguishable from coasting, and nothing in the repo asserts a 1 Hz sample rate — derive resolution from `movingTimeSec / stream.length`.
