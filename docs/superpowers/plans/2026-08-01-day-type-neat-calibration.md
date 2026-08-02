# Day-Type NEAT Calibration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Option 3 from the [rest-day energy model review](../specs/2026-08-01-rest-day-energy-model-review.md) — split the calibrated NEAT multiplier `k` by day type (rest vs. training), so rest days stop being systematically under-served by a flat average dragged down by training days.

**Architecture:** `calibrateNeatByDayType` solves `k_rest` and `k_train` independently over a wider window
(rest days are sparse), then **shrinks each toward the existing pooled `k`** by an empirical-Bayes weight
`n / (n + K)`. This replaces the review's originally-proposed hard confidence gate (all-or-nothing at a
sample-size cliff) with smooth shrinkage — conservative when data is thin, converging to the day-type-specific
value as data accumulates. No new physiological term; this conditions the existing calibrated parameter on
one variable the review's Test A validated (today's own `activeBurnKcal` status).

**Tech Stack:** TypeScript 5, Next.js 16 App Router, React 19, Vitest.

## Why shrinkage, not a hard gate — and why K = 12

The review's §9 proposed a binary gate (`REST_K_MIN_LOGGED_DAYS = 15`, below which fall back entirely to
flat `k`). The athlete asked to "be conservative" on the rollout; shrinkage does that more honestly than a
cliff — a hard gate means the number jumps discontinuously the day the 15th observation lands, while
shrinkage means it drifts smoothly toward the day-type-specific value as evidence accumulates, and is
already conservative on day one.

`K` (the shrinkage prior strength, in "days worth of trust") is not a new invented constant — it reuses
`CALIBRATION_MIN_WEIGH_INS` (12), the exact threshold this file already uses elsewhere to mean "this many
observations before a solve is trusted at all". At the athlete's live rest-day sample (n=10),
`weight = 10/22 ≈ 0.45` — meaningfully conservative, not a coin flip, and it lands close to their own
historical actual rest-day eating (~2,450 vs. a historical mean of 2,437), not the full uncorrected
estimate (~2,800).

## Global Constraints

- **Nutrition is code, not AI** (ADR-0002). Every number here is TypeScript; the LLM only phrases values
  it is handed.
- **Reuse existing constants where the concept is genuinely the same.** `DAY_TYPE_SHRINKAGE_K` = the
  existing `CALIBRATION_MIN_WEIGH_INS`, not a fresh magic number. Confidence-tier thresholds for the
  rest/train subsets reuse `CALIBRATION_MIN_WEIGH_INS` / `CALIBRATION_HIGH_MIN_WEIGH_INS` /
  `CALIBRATION_MIN_LOGGED_FRACTION` / `CALIBRATION_HIGH_MIN_LOGGED_FRACTION` — the same tiers, applied to
  the subset's own logged-day count instead of the whole window's.
- **Missing days are imputed at the SUBSET's own logged mean**, not the pooled mean — a rest day's
  intake, if unlogged, is better estimated from other rest days than from the training-day-heavy pooled
  average.
- **The uniform-daily-rate weight-drift assumption is shared across subsets** (the existing model's own
  simplification, applied once per window, not re-derived per subset) — trend needs temporal spread to
  estimate, not day-type spread.
- **An out-of-band raw subset solve is clamped and reports an ambiguous `imbalance` with multiple
  candidates before blending** — the existing rule, applied to the subset solve, not skipped because it's
  going to be shrunk afterward.
- **Never modify anything under `data/`** — the athlete's live personal data, not git-restorable.
- **Stage only files you touched**; never `git add -A` — a concurrent session shares this checkout.
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Verification: `npm run check`. Baseline green at 1589 tests.
- Do not weaken an existing assertion. If one must genuinely move, stop and report it.

## Out of scope

Option 5 from the review (continuous load-weighted `k(t)`) — deferred until Option 3 has enough data to
show it's under-fitting. The daily carbohydrate target and any further nutrition work — separate scope.

## File Structure

| File | Change |
|---|---|
| `lib/nutrition.ts` | **Modify** — `calibrateNeatByDayType`, new constants, shrinkage helper |
| `lib/types.ts` | **Modify** — `DayTypeNeat`, extend `NutritionSettings` |
| `lib/data-store.ts` | **Modify** — default for the new field |
| `lib/nutrition.ts` (`resolveNutritionModel`) | **Modify** — day-type-aware multiplier selection |
| `app/api/sync/route.ts` | **Modify** — compute + persist `DayTypeNeat` on sync (mirrors the existing single-`k` adoption) |
| `app/api/profile/route.ts` | **Modify** — expose in `derivation`, thread `isRestDayToday` into `resolveNutritionModel` |
| `app/api/generate/route.ts` | **Modify** — thread day-type per row into the reference table |
| `components/AthleteProfileForm.tsx` | **Modify** — show which `k` is active, its shrinkage weight, and the pooled fallback |

---

## Task 1: `calibrateNeatByDayType` — the statistics

**Files:** Modify `lib/nutrition.ts`, `lib/types.ts`; test in `lib/nutrition.test.ts`.

**Interfaces:**
- Consumes: `calibrateNeat` (unchanged, called once for the pooled anchor), `activeBurn`,
  `weightTrendPreciseFromWellness`, `restingMetabolicRate`, `NEAT_PLAUSIBLE_MIN/MAX`,
  `CALIBRATION_MIN_WEIGH_INS`, `CALIBRATION_HIGH_MIN_WEIGH_INS`, `CALIBRATION_MIN_LOGGED_FRACTION`,
  `CALIBRATION_HIGH_MIN_LOGGED_FRACTION`, `CALIBRATION_MAX_STALENESS_DAYS`.
- Produces:

```ts
export const DAY_TYPE_WINDOW_DAYS = 90; // rest days are sparse for a training cyclist; needs more
                                          // calendar time than the 42-day pooled window to gather enough
export const DAY_TYPE_SHRINKAGE_K = CALIBRATION_MIN_WEIGH_INS; // reused, not invented — see plan header
export const DAY_TYPE_MIN_LOGGED_DAYS = 3; // below this, shrinkageWeight is forced to 0 (avoid a
                                             // near-divide-by-zero mean from 1-2 points)

export interface DayTypeNeat {
  rest: NeatCalibration;
  train: NeatCalibration;
  pooled: NeatCalibration;              // the unchanged whole-window calibration; the shrinkage anchor
  shrinkageWeight: { rest: number; train: number }; // 0..1, transparency for the derivation panel
}

export function calibrateNeatByDayType(
  wellness: WellnessEntry[],
  activities: Array<Pick<ActivitySummary, "date" | "activeBurnKcal" | "kj">>,
  rmr: number,
  today: string,
  windowDays: number = DAY_TYPE_WINDOW_DAYS
): DayTypeNeat | null
```

- [ ] **Step 1: Write the failing tests**

```ts
describe("calibrateNeatByDayType", () => {
  const RMR = 1631;

  // Synthetic athlete: TRUE k_rest = 1.53, TRUE k_train = 1.22, flat weight, so the identity is exact
  // and the test can assert the raw (pre-shrinkage) recovery of the day-type split.
  function synth(nRest: number, nTrain: number, kRest: number, kTrain: number, trainBurn = 1200) {
    const wellness: WellnessEntry[] = [];
    const activities: Array<{ date: string; activeBurnKcal: number | null; kj: number | null }> = [];
    let day = 0;
    for (let i = 0; i < nRest; i++, day++) {
      const date = new Date(Date.UTC(2026, 4, 1) + day * 86_400_000).toISOString().slice(0, 10);
      wellness.push({ date, weightKg: 62, kcalConsumed: kRest * RMR } as WellnessEntry);
    }
    for (let i = 0; i < nTrain; i++, day++) {
      const date = new Date(Date.UTC(2026, 4, 1) + day * 86_400_000).toISOString().slice(0, 10);
      wellness.push({ date, weightKg: 62, kcalConsumed: kTrain * RMR + trainBurn } as WellnessEntry);
      activities.push({ date, activeBurnKcal: trainBurn, kj: null });
    }
    return { wellness, activities, today: new Date(Date.UTC(2026, 4, 1) + day * 86_400_000).toISOString().slice(0, 10) };
  }

  it("recovers day-type-specific k when both subsets are well-sampled", () => {
    const { wellness, activities, today } = synth(20, 40, 1.53, 1.22);
    const r = calibrateNeatByDayType(wellness, activities, RMR, today, 90)!;
    expect(r.rest.multiplier).toBeGreaterThan(1.45);
    expect(r.train.multiplier).toBeLessThan(1.28);
    expect(r.shrinkageWeight.rest).toBeGreaterThan(0.6); // n=20 well above K=12
  });

  it("shrinks HARD toward pooled when the rest-day sample is thin", () => {
    const { wellness, activities, today } = synth(3, 40, 1.53, 1.22);
    const r = calibrateNeatByDayType(wellness, activities, RMR, today, 90)!;
    // n=3 rest days: weight = 3/(3+12) = 0.2 — mostly pooled, not the raw 1.53.
    expect(r.shrinkageWeight.rest).toBeCloseTo(3 / 15, 2);
    expect(r.rest.multiplier).toBeLessThan(1.53);
    expect(r.rest.multiplier).toBeGreaterThan(r.pooled.multiplier);
  });

  it("forces shrinkageWeight to 0 below DAY_TYPE_MIN_LOGGED_DAYS", () => {
    const { wellness, activities, today } = synth(2, 40, 1.53, 1.22);
    const r = calibrateNeatByDayType(wellness, activities, RMR, today, 90)!;
    expect(r.shrinkageWeight.rest).toBe(0);
    expect(r.rest.multiplier).toBe(r.pooled.multiplier);
  });

  it("imputes a subset's missing days at that subset's OWN logged mean, not the pooled mean", () => {
    const { wellness, activities, today } = synth(20, 40, 1.53, 1.22);
    // Blank every third rest day — absence should not pull k_rest toward the training-heavy pooled mean.
    let count = 0;
    for (const w of wellness) {
      if (!(activities as any[]).some(a => a.date === w.date)) { // a rest day
        count++;
        if (count % 3 === 0) w.kcalConsumed = null;
      }
    }
    const r = calibrateNeatByDayType(wellness, activities, RMR, today, 90)!;
    expect(r.rest.multiplier).toBeGreaterThan(1.4); // would collapse toward pooled if imputed wrong
  });

  it("returns null when the pooled calibration itself is insufficient", () => {
    const { wellness, activities, today } = synth(2, 2, 1.53, 1.22);
    expect(calibrateNeatByDayType(wellness, activities, RMR, today, 90)).toBeNull();
  });

  it("clamps an implausible raw subset solve and reports an ambiguous imbalance before blending", () => {
    // Rest-day intake wildly high relative to RMR alone — should clamp to NEAT_PLAUSIBLE_MAX pre-shrink.
    const { wellness, activities, today } = synth(20, 40, 2.5, 1.22);
    const r = calibrateNeatByDayType(wellness, activities, RMR, today, 90)!;
    expect(r.rest.imbalance).not.toBeNull();
    expect(r.rest.imbalance!.candidates.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Reuse `calibrateNeat`'s internal clamp/imbalance logic — if it isn't already
factored into a standalone helper, extract one (`solveAndClampK(sumIntake, sumBurn, deltaMass, n, rmr):
{ multiplier, imbalance }`) that both `calibrateNeat` and `calibrateNeatByDayType` call, so the two paths
cannot silently diverge on how an out-of-band solve is handled. `calibrateNeatByDayType`:

1. `const pooled = calibrateNeat(wellness, activities, rmr, today);` — unchanged 42-day call. If `null`,
   return `null`.
2. Determine `cutoff = today - windowDays` and `lastLoggedDate` (most recent `date < today` with
   `kcalConsumed > 0`), same staleness convention as `calibrateNeat`.
3. Build a day-type map for every calendar date in `[cutoff, lastLoggedDate]`: rest if the resolved
   `activeBurn` sum for that date is `0` (or no activity), training otherwise. Dates whose only activity
   has an unresolvable burn are excluded from both the day-type map and any subset's `N`.
4. Compute `perDayDriftKg = weightTrendPreciseFromWellness(wellness restricted to [cutoff, lastLoggedDate])
   / 7` **once**, shared by both subsets (the model's existing uniform-rate assumption).
5. For each subset (rest, train): `loggableDays`, `loggedDays`, `coverage = loggedDays/loggableDays`,
   `meanLoggedIntake` (of that subset only), `ΣintakeImputed = meanLoggedIntake × loggableDays`,
   `Σburn` (resolved burns within the subset only), `Δmass = perDayDriftKg × loggableDays`, then
   `solveAndClampK(ΣintakeImputed, Σburn, Δmass, loggableDays, rmr)`.
6. Confidence tier per subset, reusing the pooled tiers' exact thresholds against `loggedDays`/`coverage`.
7. `shrinkageWeight = loggedDays < DAY_TYPE_MIN_LOGGED_DAYS ? 0 : loggedDays / (loggedDays + DAY_TYPE_SHRINKAGE_K)`.
8. `finalMultiplier = shrinkageWeight × clampedSubsetK + (1 − shrinkageWeight) × pooled.multiplier`.
9. Assemble each `NeatCalibration` (`source: "derived"`, `windowDays: DAY_TYPE_WINDOW_DAYS`, `loggedDays`,
   `weighIns` — reuse the pooled window's weigh-in count, `solvedAt: today`, `imbalance` from the
   pre-shrink clamp, `stale: false` — staleness already gates via `pooled` returning `null`).

- [ ] **Step 4: Run — expect PASS. Then `npm run check`.**
- [ ] **Step 5: Commit.**

---

## Task 2: Wire into `resolveNutritionModel`, adopt on sync

**Files:** Modify `lib/nutrition.ts` (`resolveNutritionModel`), `lib/types.ts`, `lib/data-store.ts`,
`app/api/sync/route.ts`; tests alongside.

**Interfaces:**
- `NutritionSettings` gains `dayTypeNeat: DayTypeNeat | null` (persisted, `null` until the pooled gate and
  at least one subset clear `DAY_TYPE_MIN_LOGGED_DAYS`).
- `resolveNutritionModel(profile, latestWeightKg, today, isRestDayToday: boolean)` — **new required
  parameter.** Existing callers must be updated, not defaulted silently; a day-type-aware model must know
  which day it's resolving for.

- [ ] **Step 1: Write the failing tests** — `resolveNutritionModel` picks `dayTypeNeat.rest.multiplier` when
`isRestDayToday` and `dayTypeNeat` is non-null with `shrinkageWeight.rest > 0`; picks `.train` otherwise;
falls back to the existing flat `neat.multiplier` when `dayTypeNeat` is `null` (unmigrated / insufficient
data) — **no behavior change for an athlete without enough rest-day data yet.**

- [ ] **Step 2: Implement.** In `resolveNutritionModel`'s derived branch, replace the flat
`neatMultiplier: profile.nutrition.neat?.multiplier ?? DEFAULT_NEAT_MULTIPLIER` with: if
`profile.nutrition.dayTypeNeat` exists, pick `.rest` or `.train` by `isRestDayToday`; else fall back to
the existing flat lookup unchanged.

- [ ] **Step 3: Adopt on sync.** In `app/api/sync/route.ts`, alongside the existing pooled-`k` adoption
(guarded on `source === "derived"`, never overwriting an `"override"`), call `calibrateNeatByDayType` and
persist `dayTypeNeat` under the same guard. Wrap in try/catch — a calibration failure must never break a
sync, matching the existing pooled-`k` adoption's error handling.

- [ ] **Step 4: Thread `isRestDayToday` through the three routes.** `app/api/profile/route.ts` (GET) and
`app/api/generate/route.ts` need to determine it: for the profile route, `isRestDayToday` = whether
*today's* synced activity burn (if any) resolves to 0 — same convention `calculateDailyTarget`'s
`isRestDay` parameter already uses elsewhere; for the generate route's reference table
(`buildNutritionReferenceRows`, which iterates hypothetical rows for both `Rest` and every other type
already), pass the row's own `type === "Rest"` — it already knows this per row.

- [ ] **Step 5: `npm run check`, commit.**

---

## Task 3: Derivation panel

**Files:** `app/api/profile/route.ts` (extend `derivation`), `components/AthleteProfileForm.tsx`.

- [ ] **Step 1:** Extend `derivation` with `dayTypeNeat: DayTypeNeat | null` and `isRestDayToday: boolean`.
- [ ] **Step 2:** Replace the flat "Non-exercise multiplier" row with one that, when `dayTypeNeat` is
present, shows **both** `k_rest` and `k_train` with their shrinkage weights, and bolds whichever is active
today — e.g. *"Rest-day k: 1.47 (45% day-type-specific, 55% pooled — 10 logged rest days so far) ·
Training-day k: 1.25 (98% day-type-specific)"*. When `dayTypeNeat` is `null`, render exactly as today
(single flat value) — no regression for an athlete without enough data yet.
- [ ] **Step 3:** `npm run check`, browser-verify via the preview tool (never `npm run dev` in bash; a
dev server is already running on :3000 — reuse it), screenshot. **Never modify `data/` directly** — drive
any state through the UI or through a real sync.
- [ ] **Step 4:** Commit.

---

## Task 4: Live verification

- [ ] **Step 1:** Sync, confirm `dayTypeNeat` persists with `source: "derived"` on both subsets and a
non-null `shrinkageWeight`.
- [ ] **Step 2:** Read today's actual resolved rest-day target from `/api/profile`. Compare against the
hand-computed estimate in this plan's header (~2,450 at the athlete's current n=10, K=12) — a materially
different number means the implementation disagrees with the hand calculation and must be reconciled
before calling this done.
- [ ] **Step 3:** Generate a real block live. Confirm the reference table's rest-day rows reflect the new
day-type `k`, and that no `repairNutrition` warnings fire (the reference table and the validator must
still agree — same invariant Phase 1 established).
- [ ] **Step 4:** Record the measured numbers in `todo.md` and in
[docs/systems/09-nutrition.md](../../systems/09-nutrition.md)'s Known rough edges (replacing the "researched,
not yet fixed" bullet with what shipped and its live numbers). Commit.

## Self-Review

**Spec coverage:** implements Option 3 from the 2026-08-01 review exactly, with the review's hard gate
(§9) replaced by shrinkage per the athlete's "be conservative" request — that deviation is stated in this
plan's header, not silently substituted.

**Type consistency:** `DayTypeNeat` defined in Task 1, consumed unchanged by Tasks 2–3.
`resolveNutritionModel`'s new required `isRestDayToday` parameter is threaded through every call site in
Task 2 — no default that would let a caller silently forget it.

**Not covered, deliberately:** Option 5 (continuous load-weighted `k`); anything from Phase 4's daily-carb
scope; the pre-existing unlocked-self-heal and `weeklyEnergy`-buffer-basis follow-ups already tracked in
`todo.md`.
