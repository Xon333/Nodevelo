# Today Daily-Read Signals — De-Noise the Verdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the two noisiest signals in the Today "Athlete State" verdict — a scientifically-discredited ACWR and a single-ride Pw:HR — from manufacturing false fatigue, by demoting ACWR and smoothing the aerobic-efficiency read.

**Architecture:** Two moves inside the existing signal-fusion framework (`lib/athlete-state.ts` + `lib/calibration.ts`). (1) **Demote ACWR** to a minor nudge — TSB and the separate load-ramp readiness check already carry the "you ramped load fast" story, and ACWR is redundant and unreliable for endurance readiness (Impellizzeri et al.). (2) **De-noise the aerobic-efficiency "now" signal** by using a smoothed mean of the last few qualifying rides as the numerator instead of one latest ride, and widening its deadband — a single hot or caffeinated day should no longer cap the score. Both are weight/adapter edits to a pure fusion function; the AI never computes the state.

**HRV is deferred.** HRV would be the best daily-readiness signal, but the athlete has no wearable that measures it consistently yet, so wiring an HRV evaluator into the fusion now would be dead code (it would only ever return "unavailable"). The opt-in HRV path already in `lib/readiness.ts` is left untouched for when a wearable lands — see the Deferred section at the end for the exact add-back.

**Tech Stack:** TypeScript 5, Vitest (`npm test`), pure functions (no IO in the fusion).

## Global Constraints

- **`npm test`** runs Vitest. Fusion tests live in `lib/athlete-state.test.ts`, weights in `lib/calibration.test.ts`.
- **No new dependencies.** Everything here operates on data already on `SyncData`.
- **Purity:** `computeAthleteState` and evaluators stay pure functions of `(inputs, weights)`. `athleteStateInputsFrom` may read the passed `sync`/`model` but performs no IO.
- **Graceful absence:** every signal returns `null` (sits out) when its data is missing. Never fabricate a signal from thin data.
- **Calibration discipline:** any changed weight default must stay within its existing `[min,max]` bound in `ATHLETE_STATE_WEIGHT_BOUNDS`, or the resolver clamps it (CAL-1). The demoted ACWR defaults below all sit inside the current bounds, so **no bounds edit is needed** — verify this rather than widening bounds.

---

## File Structure

- `lib/calibration.ts` — **modify.** Demote the `acwr` default magnitudes in `DEFAULT_ATHLETE_STATE_WEIGHTS`; widen the `aerobicEff` deadband default.
- `lib/athlete-state.ts` — **modify.** Smooth the aerobic-efficiency numerator in `athleteStateInputsFrom`.
- `lib/athlete-state.test.ts` — **modify.** Tests for the smoothed aerobic numerator and the demoted ACWR's non-dominance.
- `lib/calibration.test.ts` — **modify.** Assert the demoted ACWR defaults.

---

### Task 1: Demote the ACWR defaults

**Files:**
- Modify: `lib/calibration.ts` — `DEFAULT_ATHLETE_STATE_WEIGHTS.acwr` (~line 151).
- Test: `lib/calibration.test.ts`

**Interfaces:**
- Produces: new (smaller-magnitude) `acwr` defaults. No type or bounds change.

- [ ] **Step 1: Write the failing test**

Add to `lib/calibration.test.ts`:

```ts
import { DEFAULT_ATHLETE_STATE_WEIGHTS, resolveAthleteStateWeights } from "./calibration";

describe("athlete-state weights: ACWR demoted", () => {
  it("demotes ACWR so it can no longer dominate the score", () => {
    // Was danger −20 / optimal +4 — a hammer. Now a nudge; TSB carries the load story.
    expect(Math.abs(DEFAULT_ATHLETE_STATE_WEIGHTS.acwr.danger)).toBeLessThanOrEqual(8);
    expect(DEFAULT_ATHLETE_STATE_WEIGHTS.acwr.optimal).toBeLessThanOrEqual(2);
  });
  it("keeps TSB the dominant load signal (its cap outweighs ACWR danger)", () => {
    expect(DEFAULT_ATHLETE_STATE_WEIGHTS.tsb.cap).toBeGreaterThan(
      Math.abs(DEFAULT_ATHLETE_STATE_WEIGHTS.acwr.danger)
    );
  });
  it("the demoted defaults survive the resolver unchanged (inside bounds)", () => {
    const w = resolveAthleteStateWeights(null);
    expect(w.acwr.danger).toBe(DEFAULT_ATHLETE_STATE_WEIGHTS.acwr.danger); // not clamped
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- calibration`
Expected: FAIL — `acwr.danger` still −20, `optimal` still 4.

- [ ] **Step 3: Demote the defaults**

In `lib/calibration.ts`, in `DEFAULT_ATHLETE_STATE_WEIGHTS`, replace the `acwr` line (~line 151):

```ts
  acwr: { optimal: 4, low: -2, high: -10, danger: -20 },
```

with:

```ts
  // ACWR demoted (redundant with TSB + the load-ramp readiness check, and unreliable for endurance
  // readiness — Impellizzeri et al.): a minor nudge now, not a dominant hammer. TSB carries the load story.
  // Bounds unchanged so a coach could re-weight it; only the DEFAULT is demoted.
  acwr: { optimal: 2, low: -1, high: -4, danger: -8 },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- calibration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/calibration.ts lib/calibration.test.ts
git commit -m "feat(state): demote ACWR to a minor nudge (TSB carries the load story)"
```

---

### Task 2: De-noise the aerobic-efficiency "now" signal

**Files:**
- Modify: `lib/athlete-state.ts` — `athleteStateInputsFrom`, the `aerobicEffLatest` computation (~lines 162-165).
- Modify: `lib/calibration.ts` — `DEFAULT_ATHLETE_STATE_WEIGHTS.aerobicEff.deadband` (~line 153).
- Test: `lib/athlete-state.test.ts`

**Interfaces:**
- Consumes: `sync.activities` (Pw:HR), `qualifyingPwHr`, `AEROBIC_RECENCY_DAYS`, `round2` (all already imported in `athlete-state.ts`).
- Produces: `athleteStateInputsFrom` returns a smoothed `aerobicEffLatest` (mean of up to the last 3 qualifying rides in the recency window).

- [ ] **Step 1: Write the failing test**

Add to `lib/athlete-state.test.ts` (reuse the file's existing sync/model fixture builder; the shape shorthand below stands in for the real `ActivitySummary`/`SyncData`/`AthleteModel` fields the function reads — fill them to match):

```ts
import { athleteStateInputsFrom } from "./athlete-state";

it("smooths aerobic efficiency over the last few rides, not one noisy latest", () => {
  // Two normal rides then one outlier-low latest (a hot/caffeinated day) inside the recency window.
  const activities = [
    { date: "2026-07-01", type: "Ride", powerHrZ2: 2.0, powerHrZ2Mins: 60 /* + other ActivitySummary fields */ },
    { date: "2026-07-03", type: "Ride", powerHrZ2: 2.0, powerHrZ2Mins: 60 },
    { date: "2026-07-08", type: "Ride", powerHrZ2: 1.2, powerHrZ2Mins: 60 }, // outlier
  ];
  const inputs = athleteStateInputsFrom(
    { activities, wellness: [], fitness: { tsb: 0 } } as any,
    { sampleSize: 10, overallExecEwma: 6, overallTrend: "flat", behaviour: { offPlanPct: 0 } } as any,
    null,
    "2026-07-09"
  );
  // Smoothed latest = mean(2.0, 2.0, 1.2) ≈ 1.73, NOT the raw 1.2 — one hot day can't cap the state alone.
  expect(inputs.aerobicEffLatest).toBeGreaterThan(1.5);
});
```

> Implementer: match the real `ActivitySummary` shape — `qualifyingPwHr` reads `type`, `powerHrZ2`, `powerHrZ2Mins`. The `as any` casts are shorthand; fill the fields the function actually touches. Reuse any fixture factory already in `athlete-state.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- athlete-state`
Expected: FAIL — `aerobicEffLatest` is the raw single latest ride (1.2), below 1.5.

- [ ] **Step 3: Smooth the numerator**

In `lib/athlete-state.ts`, in `athleteStateInputsFrom`, replace the `qualifying`/`latestQual`/`aerobicEffLatest` block (~lines 162-165):

```ts
  const qualifying = acts.filter((a) => qualifyingPwHr(a) != null);
  const latestQual = [...qualifying].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const aerobicEffLatest =
    latestQual && latestQual.date >= daysAgo(AEROBIC_RECENCY_DAYS) ? latestQual.powerHrZ2 : null;
```

with:

```ts
  const qualifying = acts.filter((a) => qualifyingPwHr(a) != null);
  // Smooth the "now" read over the last few qualifying rides in the recency window rather than trusting a
  // single latest ride — per-ride Pw:HR is dominated by heat/hydration/caffeine, so one bad day shouldn't
  // cap the state. The baseline below (older than the recency window) is unchanged, so no overlap.
  const recentQual = [...qualifying]
    .filter((a) => a.date >= daysAgo(AEROBIC_RECENCY_DAYS))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  const aerobicEffLatest =
    recentQual.length > 0
      ? round2(recentQual.reduce((s, a) => s + (a.powerHrZ2 as number), 0) / recentQual.length)
      : null;
```

- [ ] **Step 4: Widen the aerobic deadband**

In `lib/calibration.ts`, in `DEFAULT_ATHLETE_STATE_WEIGHTS`, change the `aerobicEff` deadband from `2` to `3` (a smoothed ±3% is a genuine move; ±2% is still noise):

```ts
  aerobicEff: { perPct: 1.5, cap: 9, deadband: 3 }, // effect = relative %Δ from baseline × perPct, capped
```

- [ ] **Step 5: Run tests + full suite**

Run: `npm test -- athlete-state calibration` then `npm test`
Expected: all green. If a pre-existing test pinned a state score that shifts because ACWR is demoted or the deadband widened, recompute the exact new expected value (don't loosen the assertion to a range just to pass).

- [ ] **Step 6: Live smoke**

Run: `npm run dev` (dev server is `dev:preview` on port 3100), open `/today`, and confirm a single recent hot-day ride no longer flips the Athlete State verdict to "strained" on its own, and that the ACWR driver (if present in "Supporting signals") reads as a small contribution rather than dominating.

- [ ] **Step 7: Commit**

```bash
git add lib/athlete-state.ts lib/calibration.ts lib/athlete-state.test.ts
git commit -m "feat(state): smooth aerobic-efficiency numerator; widen its deadband (kill one-hot-day false fatigue)"
```

---

## Self-Review Notes

- **Spec coverage:** ACWR demoted (Task 1); single-ride Pw:HR de-noised (Task 2). The *display* of these in the Today "Supporting signals" disclosure updates automatically (it renders `state.drivers`).
- **Depends on Plan 1:** the execution driver feeding `execEwma` should be honest first — land `2026-07-10-01-execution-scoring-hr-leniency` before tuning the fusion around it.
- **Not in scope:** removing ACWR entirely, or merging the three load-ramp signals — demotion is the reversible, low-risk move. And HRV (deferred, below).
- **No type churn:** `AthleteStateInputs` is unchanged (no new field), so every construction of it still compiles.

---

## Deferred: HRV (add back when a wearable is available)

The athlete has no consistent HRV source today, so this is intentionally NOT built. When a wearable that syncs HRV to intervals.icu wellness is in place, HRV becomes the strongest daily-readiness signal and should join the fusion as a corroborating "lived" signal. The exact add-back at that point:

1. Add an `hrv` weight leaf to `AthleteStateWeights` + `DEFAULT_ATHLETE_STATE_WEIGHTS` (`{ perPct: 0.8, cap: 12, deadband: 4, suppressAt: -8 }`) and a matching `[min,max]` bound in `ATHLETE_STATE_WEIGHT_BOUNDS`.
2. Add `hrvSuppressionPct: number | null` to `AthleteStateInputs`; compute it in `athleteStateInputsFrom` by reusing the baseline/staleness logic in `lib/readiness.ts` (latest non-stale reading ≤2 days old vs the prior-7-day mean, today excluded).
3. Add an `evalHrv` evaluator (mirror `evalAerobicEff`), register it in the `evaluators` array, and add `"hrv"` to both `isLivedNegative` (dir "down" when suppressed past `suppressAt`) and `CORE_KEYS`.

This is a pointer, not a stub — nothing is scaffolded now.
