# Day-to-Day Nutrition Accuracy — Design

**Date:** 2026-07-30
**Status:** Draft — pending user review
**todo.md:** "Scope a real day-to-day nutrition system" (added 2026-07-30)

---

## 1. Problem & context

Flagged as the biggest current training hurdle: off-bike underfuelling is hindering recovery. Three
concrete gaps, confirmed against the actual code (not assumed):

- **`baseCalories`/`restDayTarget` are flat, hand-typed numbers** ([lib/types.ts:38-43](../../../lib/types.ts))
  — not derived from the athlete's actual physiology. Default `2000`/`2600`, whatever the athlete
  originally guessed.
- **Off-bike burn is invisible.** [lib/intervals-api.ts:214-237](../../../lib/intervals-api.ts) only
  captures Intervals.icu's `icu_joules` (power-meter work) into `ActivitySummary.kj`. Intervals.icu
  separately computes an HR/pace-based `calories` estimate that works for *any* activity type — a run,
  swim, hike, no power meter needed — but NodeVelo discards it. A logged non-cycling session
  contributes **zero** to any burn calculation today.
- **No day-level view of chronic under-fuelling exists.** `lib/trends.ts`'s `weeklyEnergy` is
  Monday-anchored and deliberately drops the in-progress week (lagged up to 7 days);
  `computeEnergyAvailability` gives one trailing-window *mean*, not per-day pass/fail. Neither can
  answer "how many of the last few days was I under target?"

**Athlete context:** no wearable connected (checked via Freddy — only Intervals.icu is connected;
`wellness_steps` has 2 records ever). Intake is logged once per day, end-of-day, copied from
MyFitnessPal into Intervals.icu's `wellness_kcalConsumed` — so a live "logged so far today" figure
would be meaningless. Off-bike *structured* sport sessions (a run, a hike) get logged as their own
Intervals.icu activity; ordinary daily-life NEAT does not get logged anywhere.

## 2. Goals / non-goals

**Goals**
- Replace the flat `baseCalories`/`restDayTarget` guesses with a formula derived from the athlete's
  actual physiology (RMR), recomputed as weight/age change.
- Make logging a non-cycling sport activity into Intervals.icu actually count toward burn — fixing the
  `kj`-only blind spot.
- Surface chronic (not single-day) under-fuelling as a warning, not just a retrospective mean.
- Keep the existing weight-trend buffer (`adjustBuffer`) as the long-run self-correction mechanism for
  whatever the formula gets wrong — extend it to rest days too, since a *computed* number needs the same
  correction a *hand-picked* one didn't.

**Non-goals** (explicitly ruled out this round)
- No new live "Today's Target" dashboard tile / progress bar. The athlete already sees pre-ride carb
  guidance before riding and the post-ride number after — a mid-day "logged so far" comparison is moot
  given once-a-day end-of-day logging.
- No native food-logging UI in NodeVelo. Intake logging stays on Intervals.icu/MyFitnessPal.
- No wearable integration. Off-bike NEAT is estimated by formula, not measured. (Freddy already supports
  connecting one later — Garmin/Oura/Whoop/Apple Health — if the formula proves insufficient; that's a
  clean future upgrade, not part of this scope.)
- No manual "log a walk" entry point. Ordinary daily-life activity is absorbed by the RMR formula's
  lifestyle multiplier and, longer-term, by the weight-trend buffer.

## 3. Approach

Three changes, all inside the existing deterministic-code architecture (ADR-0002 — nutrition is code,
not AI; the LLM only phrases numbers this module computes):

1. **RMR-based auto-computed baseline** — `baseCalories`/`restDayTarget` become derived from Mifflin-St
   Jeor + a lifestyle multiplier, not manually typed.
2. **`calories`-primary burn source** — every place that sums activity energy across activity types
   switches from `kj`-only to `calories` (Intervals.icu's own cross-sport estimate) with `kj` as a
   fallback for activities missing it.
3. **Under-fueling streak alert** — a new day-level function counts low-ratio days in the trailing week
   and adds a warning line to the existing `EnergyAvailabilityTile`.

## 4. Data model changes

**`PerformanceData`** ([lib/types.ts:27-36](../../../lib/types.ts)) gains three fields, alongside the
existing `weightKg`:

```ts
export interface PerformanceData {
  ftp: number;
  maxHr: number;
  thresholdHr: number;
  weightKg: number;
  weeklyHoursMin: number;
  weeklyHoursMax: number;
  ageYears: number | null;   // null until the athlete fills it in (pre-migration profiles)
  heightCm: number | null;
  sex: "male" | "female" | null; // Mifflin-St Jeor's constant term is binary; a formula input, not a
                                  // statement about identity
}
```

**`ActivitySummary`** ([lib/types.ts:56-98](../../../lib/types.ts)) gains one field:

```ts
calories: number | null; // Intervals.icu's own cross-sport kcal estimate (HR/pace-based); populated
                          // alongside kj from the same activity payload
```

`ageYears`/`heightCm`/`sex` are `null` on every existing profile on disk today (JSON parses a missing
field back as `undefined`, read as `null` through the store's defaults) — the gate in §7 handles this,
per the project's own migration-flag rule: check truthy, never `=== null`.

## 5. RMR formula & the auto-computed baseline — `lib/nutrition.ts`

```ts
// Mifflin-St Jeor. `sex` is a formula input (the equation's constant term is binary), not identity.
function restingMetabolicRate(weightKg: number, heightCm: number, ageYears: number, sex: "male" | "female"): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === "male" ? base + 5 : base - 161;
}

// Multiplier represents ordinary daily-life NEAT only — structured training is added separately via
// activityBurnKcal, so this must NOT double-count exercise. Rest days get a higher multiplier
// deliberately: the research is consistent that rest days deserve generous fueling, not a diet dip.
export const BASE_NEAT_MULTIPLIER = 1.2;
export const REST_DAY_NEAT_MULTIPLIER = 1.4;

export function computeNutritionBaseline(
  weightKg: number, heightCm: number, ageYears: number, sex: "male" | "female"
): { baseCalories: number; restDayTarget: number; rmr: number } {
  const rmr = Math.round(restingMetabolicRate(weightKg, heightCm, ageYears, sex));
  return {
    rmr,
    baseCalories: Math.round(rmr * BASE_NEAT_MULTIPLIER),
    restDayTarget: Math.round(rmr * REST_DAY_NEAT_MULTIPLIER),
  };
}
```

**Rest days now get the buffer too.** `calculateDailyTarget`'s rest-day branch currently hardcodes
`bufferApplied: 0` — correct when `restDayTarget` was a number the athlete had already picked (no
correction needed), but that rationale breaks once it's a formula output. Fix:

```ts
export function calculateDailyTarget(
  activityBurnKcal: number, isRestDay: boolean, config: AthleteNutritionConfig,
  weightTrend7Day: number, workout?: WorkoutContext
): WorkoutNutritionPlan {
  const { bufferApplied } = adjustBuffer(config.buffer, weightTrend7Day); // now called unconditionally
  if (isRestDay) {
    return { dailyTarget: roundTo(config.restDayTarget + bufferApplied, 10), preRideCarbs: 0, inRideCarbsPerHour: 0, bufferApplied };
  }
  return {
    dailyTarget: roundTo(config.baseCalories + activityBurnKcal + bufferApplied, 10),
    preRideCarbs: workout ? preRideCarbTarget(...) : 0,
    inRideCarbsPerHour: workout ? inRideCarbTarget(...) : 0,
    bufferApplied,
  };
}
```

The docblock above `calculateDailyTarget` ("Rest day: restDayTarget flat, no buffer") gets updated to
match — a stale comment describing the old behavior would be exactly the kind of drift this project's
own rules flag.

## 6. Burn-source fix — `calories`-primary, `kj`-fallback

Three call sites currently sum `a.kj` only, silently treating any non-power activity as a zero-calorie
event. All three switch to the same rule: `const burn = a.calories ?? a.kj; if (burn == null) continue;`

- **`computeEnergyAvailability`** ([lib/nutrition.ts:191-195](../../../lib/nutrition.ts)) — the EA
  proxy's burn side.
- **`weeklyEnergy`'s `needBurnByDate`** ([lib/trends.ts:103-109](../../../lib/trends.ts)) — feeds the
  weekly intake-vs-need ratio. (The chart's separate rides-only `burn`/`burnKcal` series stays untouched
  — that's a distinct, already-documented, deliberate choice about what the *chart* displays, not the
  same bug.)
- **The new streak function (§7)** — built on the same pattern from the start.

`calories` is preferred over `kj` (not the reverse) because it's populated for every activity type,
including rides; `kj` only remains as a fallback for activities synced before this ships, where
`calories` hasn't backfilled yet. The exact Intervals.icu API field name backing `calories` will be
confirmed against one real sync before this is called done — an external-API assumption, not guessed
from docs.

## 7. Under-fueling streak alert

Neither existing mechanism exposes day-by-day pass/fail (see §1), so this is one new function, reusing
conventions already established elsewhere in this file rather than inventing new ones:

```ts
export interface UnderfuelingStreak {
  lowDays: number;     // logged days in the window with ratio < BALANCE_LOW_BELOW
  loggedDays: number;  // logged days considered
  windowDays: number;
}

export const STREAK_ALERT_THRESHOLD = 3; // of the last 7 logged days

export function computeUnderfuelingStreak(
  wellness: WellnessEntry[],
  activities: Array<{ date: string; kj: number | null; calories: number | null }>,
  settings: NutritionSettings,
  today: string,
  windowDays = 7
): UnderfuelingStreak | null {
  // today excluded (still logging); a logged 0 kcal is "not logged" (no real zero-kcal day exists);
  // need for a past day uses the flat configured buffer, not the live self-adjusting one — same
  // convention as weeklyEnergy, since a past day's live trend isn't reconstructable and the ±150 kcal
  // noise is inside the bands' coarseness. Below MIN_LOGGED_DAYS_FOR_BALANCE logged days → null
  // (withheld, not a false "all clear").
}
```

**UI:** `EnergyAvailabilityTile` gains a warning line when `streak.lowDays >= STREAK_ALERT_THRESHOLD`,
e.g. *"3 of your last 7 logged days were under target."* No new tile.

## 8. Migration & rollout

Every profile on disk today has hand-set `baseCalories`/`restDayTarget` and no `ageYears`/`heightCm`/
`sex`. The formula only activates once all three are present:

```ts
if (profile.performance.ageYears && profile.performance.heightCm && profile.performance.sex) {
  // compute via computeNutritionBaseline
} else {
  // keep whatever baseCalories/restDayTarget are already on disk, unchanged
}
```

Truthy check, not `=== null` — this project has been bitten by that exact gap before (a pre-existing
JSON file parses a missing field back as `undefined`). No separate migration-timestamp flag is needed;
the three fields' presence is the gate.

**Profile UI:** `baseCalories`/`restDayTarget` switch from editable text inputs to a read-only computed
display showing the breakdown (e.g. "1,847 RMR × 1.2 = 2,216"), once the gate is satisfied. Until then, a
one-time prompt invites the athlete to fill in age/height/sex, and the old manually-set numbers keep
displaying and working exactly as today. `buffer` and `targetWeightKg` are unaffected — still editable.

## 9. Edge cases & degradation

- Missing/zero/negative `weightKg`, `heightCm`, or `ageYears` → treated as "not migrated" (§8 fallback),
  never divides or produces `NaN`/negative targets.
- An activity with neither `calories` nor `kj` → contributes 0, same as today.
- `computeUnderfuelingStreak` below the logged-days floor → `null`, silent (no alert), not a false clear.
- Historical activities synced before this ships may have `calories: null` until the next sync refreshes
  them within Intervals.icu's normal lookback window; `kj` fallback covers that gap.

## 10. Testing — `lib/nutrition.test.ts` / `lib/trends.test.ts`

- `restingMetabolicRate` / `computeNutritionBaseline` against known reference values (both sexes).
- `calculateDailyTarget`: rest-day path now returns a non-zero `bufferApplied` when weight trend
  warrants it — **existing tests asserting `bufferApplied: 0` on rest days need updating to match the
  new, intended behavior**, not left as unrelated breakage.
- `computeEnergyAvailability` / `weeklyEnergy`'s need calc: activity with `calories` only (no `kj`)
  counts; `kj`-only (pre-migration) still counts; neither → 0.
- `computeUnderfuelingStreak`: exactly `STREAK_ALERT_THRESHOLD` low days triggers; one fewer doesn't;
  below the logged-days floor → `null` regardless of ratios; today itself never counted.
- Migration gate: a profile object with `ageYears`/`heightCm`/`sex` absent (`undefined`, simulating a
  pre-existing on-disk file) falls back correctly — the specific gotcha this project has hit before.

## 11. Out of scope (this round)

Native intake logging; live "Today's Target" tile; wearable-sourced off-bike expenditure; manual
off-bike-activity logging; retuning `BASE_NEAT_MULTIPLIER`/`REST_DAY_NEAT_MULTIPLIER`/
`STREAK_ALERT_THRESHOLD` beyond sensible defaults (named constants, easy to revisit once lived-with).
