# Nutrition Phase 1 — Unified Formula & Active-Burn Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five live nutrition defects (D1–D5) from
[the spec](../specs/2026-07-30-day-to-day-nutrition-accuracy-design.md): the daily-target formula
currently prescribes *less* food on light training days than on rest days, cannot express a deficit,
ignores the athlete's target weight, re-derives energy from mechanical work instead of consuming the
active-burn figure it is handed, and drops off-bike activity entirely.

**Architecture:** `dailyTarget = (k × RMR) + activeBurnKcal + buffer`. Exactly one term is estimated
(`k × RMR`, from Mifflin-St Jeor plus a NEAT multiplier); `activeBurnKcal` is synced and used verbatim;
`buffer` is a signed, goal-directed correction. Rest days are simply days where `activeBurnKcal` is 0 —
deleting the separate rest-day branch makes the inversion unrepresentable rather than merely fixed. A
legacy branch preserves un-migrated profiles' existing numbers until the athlete supplies date of birth,
height and sex.

**Tech Stack:** TypeScript 5, Next.js 16 App Router, React 19, Vitest. Pure functions in `lib/`, tests
co-located as `lib/*.test.ts`.

## Global Constraints

- **Nutrition is code, not AI** (ADR-0002). Every number here is computed in TypeScript; the LLM only
  phrases values it is handed. Never move a calculation into a prompt.
- **Migration flags use truthy checks, never `=== null`.** A profile JSON written before a field existed
  parses that field back as `undefined`. `if (p.dateOfBirth && p.heightCm && p.sex)` — never `!== null`.
- **`activeBurnKcal` is used verbatim.** No efficiency factor, no resting-cost subtraction, no scaling, no
  re-derivation from `kj`. This is the whole point of D4.
- **A missing burn figure is `null`, never `0`.** Coercing to 0 makes an unknown day read as a rest day.
- **Local dates for "now".** Use `localToday()` / `resolveToday()` from `lib/date.ts`. Never inline
  `new Date().toISOString().slice(0, 10)`.
- **Stage only files you touched.** `git add <path>...` — never `git add -A`. A concurrent session shares
  this checkout.
- **Commit message trailer** on every commit:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Verification command:** `npm run check` (runs `tsc --noEmit && eslint && vitest run`). Single test file:
  `npx vitest run <file>`. Single test: `npx vitest run <file> -t "<name>"`.
- **Out of scope for this plan** (Phases 3–4, do not build): NEAT calibration / intake reconciliation
  (spec §7), daily carbohydrate target (§9), under-fueling streak alert (§10).
- **The repo does not typecheck between Tasks 3 and 6, by design.** Task 3 changes `adjustBuffer`'s
  signature and Task 4 changes `calculateDailyTarget`'s; their call sites are updated in Tasks 5 and 6.
  In that window, verify with the task's own test file (`npx vitest run <file>`) and a scoped
  `npx tsc --noEmit` whose only errors are in files a later task owns. **Task 6 ends with a fully green
  `npm run check` — that is the gate.** Do not "fix" an error in a file your task does not own.

## Deviation from the spec, deliberate

Spec §8 specifies a `BufferCorrectionState` with `pendingCutConfirmations` requiring the gain-side trend to
hold across two consecutive evaluations. **Not implemented as specified.** `adjustBuffer` is a pure function
called on-demand from `app/api/profile/route.ts` and `app/api/generate/route.ts`; neither has a write path,
so a counter would need a new persistence mechanism and a definition of "an evaluation" that a GET request
cannot honestly provide.

**Stateless equivalent used instead:** the loss side reads a responsive trend (14-day regression window),
the gain side requires a conservative one (28-day window) to confirm before any cut. Glycogen rebound is a
step change that a 28-day slope dilutes, and when the athlete is *under* target the desired trend is
positive, so a rebound produces a near-zero delta by arithmetic rather than by a special case.
`BufferCorrectionState` is dropped from the data model.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/date.ts` | Date helpers | **Modify** — add `ageYearsFrom` |
| `lib/types.ts` | Shared types | **Modify** — `ActivitySummary.activeBurnKcal`, `PerformanceData` RMR inputs, `NutritionSettings` deprecations |
| `lib/intervals-api.ts` | Intervals.icu parsing | **Modify** — capture the active-burn field |
| `lib/nutrition.ts` | The formula, RMR, buffer, burn accessor | **Modify** — the bulk of this plan |
| `lib/nutrition-validate.ts` | Guards the AI's kcal figures | **Modify** — signature follow-through |
| `lib/trends.ts` | Weekly energy aggregation | **Modify** — burn source + rest-day branch removal |
| `lib/data-store.ts` | `DEFAULT_PROFILE` | **Modify** — defaults for new fields |
| `app/api/profile/route.ts` | Profile GET/PUT | **Modify** — validation for new + signed fields |
| `app/api/generate/route.ts` | Plan generation | **Modify** — config assembly |
| `components/AthleteProfileForm.tsx` | Profile UI | **Modify** — new inputs, computed display, migration prompt |
| `components/dashboard/today.tsx` | Today dashboard | **Modify** — EA tile call-through only |
| `lib/ride-analysis.ts` | Today-card ride analysis | **Modify** — `computeAdvisedIntake` is a THIRD copy of the formula (missed in the original list, found during Task 3); delegate it to `calculateDailyTarget`. Task 5 Step 7b |
| `app/api/sync/route.ts` | Sync + today analysis | **Modify** — build `TodayAnalysisInputs.nutrition` from the model. Task 5 Step 7b |

Tests live in the existing `lib/nutrition.test.ts`, `lib/nutrition-validate.test.ts`, `lib/trends.test.ts`.

---

## Task 1: Capture active calorie burn from the sync

Fixes D4 and D5. Independently valuable: off-bike activities start counting immediately.

**Files:**
- Modify: `lib/types.ts` (`ActivitySummary`, after the `kj` field ~line 74)
- Modify: `lib/intervals-api.ts:209-245` (`fetchActivities`)
- Modify: `lib/nutrition.ts` (add accessor; update `computeEnergyAvailability` ~line 185)
- Test: `lib/nutrition.test.ts`

**Interfaces:**
- Produces: `ActiveBurn { kcal: number; legacy: boolean }`, `activeBurn(a): ActiveBurn | null`,
  `ActivitySummary.activeBurnKcal: number | null`. Every later task consumes `activeBurn()` as the *only*
  energy-expended accessor.

- [ ] **Step 1: Write the failing test**

Append to `lib/nutrition.test.ts`:

```ts
import { activeBurn } from "./nutrition";

describe("activeBurn", () => {
  const base = { activeBurnKcal: null, kj: null } as Parameters<typeof activeBurn>[0];

  it("returns the synced figure verbatim, never scaled", () => {
    expect(activeBurn({ ...base, activeBurnKcal: 843, kj: 800 })).toEqual({ kcal: 843, legacy: false });
  });

  it("falls back to kj flagged as legacy when the active-burn figure is absent", () => {
    expect(activeBurn({ ...base, kj: 800 })).toEqual({ kcal: 800, legacy: true });
  });

  it("returns null — never 0 — when neither figure exists, so an unknown day is not a rest day", () => {
    expect(activeBurn(base)).toBeNull();
  });

  it("treats a zero active-burn figure as real, not missing", () => {
    expect(activeBurn({ ...base, activeBurnKcal: 0, kj: 500 })).toEqual({ kcal: 0, legacy: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/nutrition.test.ts -t "activeBurn"`
Expected: FAIL — `activeBurn is not a function` (and a TS error that `activeBurnKcal` is not a known property).

- [ ] **Step 3: Add the type field**

In `lib/types.ts`, inside `ActivitySummary`, immediately after the `kj: number | null; // total work in kJ` line:

```ts
  // Intervals.icu's reported ACTIVE CALORIE BURN for the activity, in kcal. Present for every activity
  // type — including runs, hikes and gym work with no power meter — which is what makes off-bike energy
  // count at all. Used VERBATIM by activeBurn(): never scaled, never adjusted for resting metabolism,
  // never re-derived from kj. `kj` remains alongside it as what it actually is (mechanical work), and is
  // no longer an energy proxy except in activeBurn()'s flagged legacy branch.
  activeBurnKcal: number | null;
```

- [ ] **Step 4: Parse it in the sync**

In `lib/intervals-api.ts`, inside `fetchActivities`'s returned object, immediately after the
`kj: joules !== null ? Math.round(joules / 1000) : null,` line:

```ts
      // Intervals.icu's own active-burn figure for the activity. `calories` is the documented field;
      // `icu_calories` is kept as a defensive fallback in case the payload key differs by activity type.
      // NOT transformed here or anywhere downstream (D4).
      activeBurnKcal: num(a.calories) ?? num(a.icu_calories),
```

- [ ] **Step 5: Add the accessor**

In `lib/nutrition.ts`, after the imports and before `AthleteNutritionConfig`:

```ts
export interface ActiveBurn {
  kcal: number;
  legacy: boolean; // true when derived from kj because the activity predates activeBurnKcal
}

/**
 * The ONE energy-expended accessor, so "use the source's active-burn figure verbatim" has a single
 * implementation nothing can drift from. Intervals.icu already reports the activity's active calorie
 * burn; NodeVelo consumes that number unmodified.
 *
 * The legacy branch exists only for activities synced before `activeBurnKcal` did — they carry just `kj`
 * (mechanical work), and treating it as kcal was the app's previous behaviour app-wide. It is flagged so
 * callers can surface the approximation rather than silently mixing bases, and it shrinks on its own as
 * the sync window rolls forward.
 *
 * Returns null — never 0 — when neither figure exists: a day whose burn is unknown must not read as a
 * rest day.
 */
export function activeBurn(a: Pick<ActivitySummary, "activeBurnKcal" | "kj">): ActiveBurn | null {
  if (a.activeBurnKcal !== null) return { kcal: a.activeBurnKcal, legacy: false };
  if (a.kj !== null) return { kcal: a.kj, legacy: true };
  return null;
}
```

Add `ActivitySummary` to the existing type-only import at the top of the file:

```ts
import type { ActivitySummary, WellnessEntry, WorkoutType } from "./types";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run lib/nutrition.test.ts -t "activeBurn"`
Expected: PASS (4 tests).

- [ ] **Step 7: Switch `computeEnergyAvailability` to the accessor**

In `lib/nutrition.ts`, change the signature's `activities` parameter and its burn loop.

Replace:

```ts
export function computeEnergyAvailability(
  wellness: WellnessEntry[],
  activities: Array<{ date: string; kj: number | null }>,
  today: string,
  windowDays = 7,
): EnergyAvailability | null {
  const burnByDate = new Map<string, number>();
  for (const a of activities) {
    if (a.kj == null) continue;
    burnByDate.set(a.date, (burnByDate.get(a.date) ?? 0) + a.kj);
  }
```

with:

```ts
export function computeEnergyAvailability(
  wellness: WellnessEntry[],
  activities: Array<{ date: string; activeBurnKcal: number | null; kj: number | null }>,
  today: string,
  windowDays = 7,
): EnergyAvailability | null {
  const burnByDate = new Map<string, number>();
  for (const a of activities) {
    const burn = activeBurn(a);
    if (burn === null) continue; // unknown, not zero
    burnByDate.set(a.date, (burnByDate.get(a.date) ?? 0) + burn.kcal);
  }
```

Also update the docblock line above it that reads
`//   - burn sums ALL activities that carry a kJ value, not only rides;` to say
`//   - burn sums ALL activities carrying an active-burn figure, not only rides;`.

- [ ] **Step 8: Fix existing EA test fixtures**

`lib/nutrition.test.ts`'s `computeEnergyAvailability` fixtures build activities with `kj` only. TypeScript
will now require `activeBurnKcal`. Add `activeBurnKcal: null` to each existing activity literal in those
tests (keeping `kj` set) — this deliberately exercises the legacy branch, so the assertions must not change.

Run: `npx vitest run lib/nutrition.test.ts`
Expected: PASS — all tests in the file, including the pre-existing EA suite with unchanged expectations.

- [ ] **Step 9: Typecheck the whole repo**

Run: `npx tsc --noEmit`
Expected: errors ONLY in files that construct `ActivitySummary` literals (test fixtures elsewhere,
`lib/trends.test.ts`, `lib/coach-snapshot`-adjacent tests). Add `activeBurnKcal: null` to each such literal.
Do not change any assertion.

- [ ] **Step 10: Full check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add lib/types.ts lib/intervals-api.ts lib/nutrition.ts lib/nutrition.test.ts
git commit -m "feat(nutrition): consume Intervals.icu active-burn kcal verbatim

ActivitySummary.kj is mechanical work, but every consumer treated it as
calories - NodeVelo doing its own implicit unit conversion when the source
already reports the activity's active calorie burn. Captures that figure
as activeBurnKcal and adds activeBurn(), the single accessor that returns
it unmodified, with a flagged legacy kj branch so old and new data never
silently mix bases.

Also makes off-bike activity count for the first time: activeBurnKcal is
present for runs, hikes and gym work, which carry no icu_joules at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Note: other test files may need the one-line fixture addition from Step 9 — stage those too.

---

## Task 2: RMR from date of birth, height and sex

No behaviour change yet — pure additions the later tasks consume.

**Files:**
- Modify: `lib/date.ts` (add `ageYearsFrom` after `addDaysIso`)
- Modify: `lib/types.ts` (`PerformanceData`, ~line 29-36)
- Modify: `lib/nutrition.ts` (add `restingMetabolicRate`, `DEFAULT_NEAT_MULTIPLIER`)
- Modify: `lib/data-store.ts:15-30` (`DEFAULT_PROFILE`)
- Test: `lib/nutrition.test.ts`, `lib/date.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `ageYearsFrom(dateOfBirth: string, today: string): number | null`,
  `restingMetabolicRate(weightKg: number, heightCm: number, ageYears: number, sex: "male" | "female"): number`,
  `DEFAULT_NEAT_MULTIPLIER = 1.2`, `PerformanceData.dateOfBirth | heightCm | sex` (all nullable).

- [ ] **Step 1: Write the failing test for age derivation**

Append to `lib/date.test.ts`:

```ts
import { ageYearsFrom } from "./date";

describe("ageYearsFrom", () => {
  it("derives whole years", () => {
    expect(ageYearsFrom("1996-03-14", "2026-07-30")).toBe(30);
  });

  it("has not counted a birthday that has not happened yet this year", () => {
    expect(ageYearsFrom("1996-12-14", "2026-07-30")).toBe(29);
  });

  it("counts the birthday itself", () => {
    expect(ageYearsFrom("1996-07-30", "2026-07-30")).toBe(30);
  });

  it("does not count the day before the birthday", () => {
    expect(ageYearsFrom("1996-07-31", "2026-07-30")).toBe(29);
  });

  it("rejects malformed or implausible input rather than returning a wrong number", () => {
    expect(ageYearsFrom("not-a-date", "2026-07-30")).toBeNull();
    expect(ageYearsFrom("2027-01-01", "2026-07-30")).toBeNull(); // future DOB
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/date.test.ts -t "ageYearsFrom"`
Expected: FAIL — `ageYearsFrom is not a function`.

- [ ] **Step 3: Implement `ageYearsFrom`**

In `lib/date.ts`, after `addDaysIso`:

```ts
// Age in whole years, derived at point of use from a stored date of birth. Deliberately NOT a stored
// `ageYears` number: that silently drifts by one every year and nobody ever revisits it. Both arguments
// are YYYY-MM-DD; returns null on malformed input or an implausible result rather than a wrong number.
export function ageYearsFrom(dateOfBirth: string, today: string): number | null {
  if (!ISO_DATE.test(dateOfBirth) || !ISO_DATE.test(today)) return null;
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/date.test.ts -t "ageYearsFrom"`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for RMR**

Append to `lib/nutrition.test.ts`:

```ts
import { restingMetabolicRate, DEFAULT_NEAT_MULTIPLIER } from "./nutrition";

describe("restingMetabolicRate", () => {
  // Mifflin-St Jeor: (10 × kg) + (6.25 × cm) − (5 × yr) + 5 for male, − 161 for female.
  it("matches the published male equation", () => {
    // 10*75 + 6.25*180 − 5*30 + 5 = 750 + 1125 − 150 + 5 = 1730
    expect(restingMetabolicRate(75, 180, 30, "male")).toBe(1730);
  });

  it("matches the published female equation", () => {
    // 10*62 + 6.25*168 − 5*28 − 161 = 620 + 1050 − 140 − 161 = 1369
    expect(restingMetabolicRate(62, 168, 28, "female")).toBe(1369);
  });

  it("exposes a NEAT prior that excludes structured exercise", () => {
    expect(DEFAULT_NEAT_MULTIPLIER).toBe(1.2);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run lib/nutrition.test.ts -t "restingMetabolicRate"`
Expected: FAIL — `restingMetabolicRate is not a function`.

- [ ] **Step 7: Implement RMR**

In `lib/nutrition.ts`, after the `activeBurn` accessor from Task 1:

```ts
/**
 * Mifflin-St Jeor. Predicts RESTING metabolic rate (RMR/REE) — not BMR, which requires stricter
 * measurement conditions and runs ~10% lower; the naming matters because the two are not interchangeable.
 *
 * `sex` is a formula input: the equation's constant term is binary. It is not a statement about identity.
 *
 * Deliberately isolated in one function so the equation can be swapped without touching a single caller.
 * Mifflin under-predicts RMR in trained endurance athletes by ~5-10%, but a calibrated NEAT multiplier
 * (spec §7, Phase 3) absorbs a constant under-prediction by construction, so swapping equations is
 * deferred rather than done here.
 */
export function restingMetabolicRate(
  weightKg: number,
  heightCm: number,
  ageYears: number,
  sex: "male" | "female"
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return Math.round(sex === "male" ? base + 5 : base - 161);
}

// Prior for the NEAT multiplier before per-athlete calibration (Phase 3) has enough data. Covers
// RMR-multiplier territory ONLY: non-exercise activity plus the thermic effect of food. Structured
// exercise is never in here — it arrives separately as activeBurnKcal, and double-counting it would
// inflate every training day.
export const DEFAULT_NEAT_MULTIPLIER = 1.2;
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npx vitest run lib/nutrition.test.ts -t "restingMetabolicRate"`
Expected: PASS (3 tests).

- [ ] **Step 9: Add the profile fields**

In `lib/types.ts`, extend `PerformanceData`:

```ts
export interface PerformanceData {
  ftp: number; // watts
  maxHr: number; // bpm
  thresholdHr: number; // bpm
  weightKg: number; // manual entry; live weight comes from wellness sync
  weeklyHoursMin: number;
  weeklyHoursMax: number;
  // RMR inputs (Mifflin-St Jeor). All three null until the athlete supplies them; their presence is the
  // migration gate that switches the nutrition formula from the legacy hand-set numbers to the derived
  // one. Guard with truthy checks, NEVER `=== null` — a profile JSON written before these fields existed
  // parses them back as `undefined`.
  dateOfBirth: string | null; // YYYY-MM-DD; age is derived at use via ageYearsFrom, never stored
  heightCm: number | null;
  sex: "male" | "female" | null; // a formula input (the equation's constant term is binary), not identity
}
```

- [ ] **Step 10: Add store defaults**

In `lib/data-store.ts`, inside `DEFAULT_PROFILE.performance`, after `weeklyHoursMax: 10,`:

```ts
    dateOfBirth: null,
    heightCm: null,
    sex: null,
```

- [ ] **Step 11: Full check**

Run: `npm run check`
Expected: PASS. If `tsc` flags test fixtures constructing `PerformanceData`, add the three `null` fields
to those literals — no assertion changes.

- [ ] **Step 12: Commit**

```bash
git add lib/date.ts lib/date.test.ts lib/types.ts lib/nutrition.ts lib/nutrition.test.ts lib/data-store.ts
git commit -m "feat(nutrition): add RMR inputs and Mifflin-St Jeor

Stores date of birth rather than an age number, so age cannot silently
drift a year; ageYearsFrom derives it at use. restingMetabolicRate is
isolated in one function so the equation stays swappable - Mifflin
under-predicts in trained athletes, which a calibrated NEAT multiplier
will absorb later rather than an equation change now.

All three fields default to null; nothing consumes them yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Goal-directed, asymmetric buffer

Fixes D2 (a deficit becomes representable) and D3 (`targetWeight` is finally read). Replaces `adjustBuffer`
wholesale.

**Files:**
- Modify: `lib/nutrition.ts` (`adjustBuffer` ~lines 33-60, `weightTrendFromWellness` ~line 146)
- Test: `lib/nutrition.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces: `BUFFER_MIN_KCAL = -500`, `BUFFER_MAX_KCAL = 600`,
  `desiredWeightTrend(currentKg: number, targetKg: number): number`,
  `adjustBuffer(buffer: number, trendShort: number | null, trendLong: number | null, currentKg: number, targetKg: number): BufferAdjustment`
  where `BufferAdjustment = { bufferApplied: number; delta: number; reason: string; capped: boolean }`, and
  `weightTrendFromWellness(wellness: WellnessEntry[], windowDays?: number): number | null`.

- [ ] **Step 1: Write the failing tests**

Replace the entire existing `describe("adjustBuffer", ...)` block in `lib/nutrition.test.ts` with:

```ts
describe("desiredWeightTrend", () => {
  it("is zero inside the deadband, so rounding never nudges forever", () => {
    expect(desiredWeightTrend(75, 75)).toBe(0);
    expect(desiredWeightTrend(75, 75.5)).toBe(0);
  });

  it("is positive and rate-capped when under target", () => {
    expect(desiredWeightTrend(70, 78)).toBe(0.35);
  });

  it("is negative and rate-capped when over target", () => {
    expect(desiredWeightTrend(80, 72)).toBe(-0.5);
  });
});

describe("adjustBuffer", () => {
  const AT_TARGET = { current: 75, target: 75 };
  const UNDER_TARGET = { current: 70, target: 78 };

  it("leaves the buffer alone when the trend matches intent", () => {
    const r = adjustBuffer(300, 0, 0, AT_TARGET.current, AT_TARGET.target);
    expect(r.delta).toBe(0);
    expect(r.bufferApplied).toBe(300);
  });

  it("adds food promptly when losing faster than intended", () => {
    // err = -0.5 kg/7d → -550 kcal/day imbalance → +275 damped → clamped to the +250 step cap
    const r = adjustBuffer(300, -0.5, -0.5, AT_TARGET.current, AT_TARGET.target);
    expect(r.delta).toBe(250);
    expect(r.bufferApplied).toBe(550);
  });

  it("uses the responsive short trend on the loss side", () => {
    // Short says losing, long has not caught up — feed anyway; the protective direction acts first.
    const r = adjustBuffer(300, -0.4, 0, AT_TARGET.current, AT_TARGET.target);
    expect(r.delta).toBeGreaterThan(0);
  });

  it("does NOT cut on a glycogen-rebound spike when the long trend cannot confirm", () => {
    // The D3 regression: +1.5 kg/7d right after refuelling is glycogen + bound water, not fat.
    const r = adjustBuffer(300, 1.5, null, UNDER_TARGET.current, UNDER_TARGET.target);
    expect(r.delta).toBe(0);
    expect(r.bufferApplied).toBe(300);
    expect(r.reason).toMatch(/not confirmed/i);
  });

  it("barely cuts a confirmed gain while the athlete is still under target", () => {
    // Long trend +0.375 vs a desired +0.35 → the error is ~0.025, so the cut is negligible by
    // arithmetic rather than by a special case.
    const r = adjustBuffer(300, 1.5, 0.375, UNDER_TARGET.current, UNDER_TARGET.target);
    expect(r.delta).toBeGreaterThan(-30);
    expect(r.delta).toBeLessThanOrEqual(0);
  });

  it("cuts on a confirmed gain when the athlete is at target, damped harder than it feeds", () => {
    const gain = adjustBuffer(300, 0.5, 0.5, AT_TARGET.current, AT_TARGET.target);
    const loss = adjustBuffer(300, -0.5, -0.5, AT_TARGET.current, AT_TARGET.target);
    expect(gain.delta).toBeLessThan(0);
    expect(Math.abs(gain.delta)).toBeLessThan(Math.abs(loss.delta)); // asymmetry: quicker to feed
  });

  it("allows a negative buffer so a deficit is representable at all", () => {
    const r = adjustBuffer(-200, 0.6, 0.6, 80, 72);
    expect(r.bufferApplied).toBeLessThan(0);
    expect(r.bufferApplied).toBeGreaterThanOrEqual(-500);
  });

  it("reports when a rail is hit instead of swallowing it", () => {
    const r = adjustBuffer(580, -1.0, -1.0, AT_TARGET.current, AT_TARGET.target);
    expect(r.bufferApplied).toBe(600);
    expect(r.capped).toBe(true);
    expect(r.reason).toMatch(/capped/i);
  });

  it("withholds correction entirely when there is no trend to act on", () => {
    const r = adjustBuffer(300, null, null, AT_TARGET.current, AT_TARGET.target);
    expect(r.delta).toBe(0);
    expect(r.reason).toMatch(/not enough weigh-ins/i);
  });
});
```

Add `desiredWeightTrend` to the file's import from `./nutrition`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/nutrition.test.ts -t "adjustBuffer"`
Expected: FAIL — wrong arity, `desiredWeightTrend` undefined.

- [ ] **Step 3: Implement the new buffer**

In `lib/nutrition.ts`, replace the constants block and `adjustBuffer`/`formatTrend` (the existing
`BUFFER_STEP_KCAL`, `BUFFER_MIN_KCAL`, `BUFFER_MAX_KCAL`, `WEIGHT_TREND_THRESHOLD_KG`, `adjustBuffer`,
`formatTrend`) with:

```ts
// The buffer is SIGNED. A floor of 0 (the previous value) meant dailyTarget could never fall below
// base + burn ≈ maintenance, so the formula was structurally incapable of prescribing a deficit — which
// is why targetWeight was never wired into it: there was nowhere to put it.
export const BUFFER_MIN_KCAL = -500;
export const BUFFER_MAX_KCAL = 600;

// Inside the deadband the desired trend is 0, so the athlete is not nudged forever over rounding noise.
export const GOAL_DEADBAND_KG = 0.7;
// Protective rate caps: loss faster than ~0.5 kg/week costs lean mass and performance; gain is capped to
// limit fat accrual.
export const MAX_LOSS_KG_PER_WEEK = 0.5;
export const MAX_GAIN_KG_PER_WEEK = 0.35;

// Proportional response: a trend error of e kg/week is e × 7700 ÷ 7 kcal/day of imbalance. Damped to
// avoid oscillating against a noisy trend, and clamped per adjustment. The previous mechanism applied a
// flat ±150 kcal to a 0.3 kg/7d threshold worth ≈330 kcal/day — a ~2× under-correction.
export const KCAL_PER_KG_TISSUE = 7700;
export const CORRECTION_DAMPING = 0.5;
export const MAX_ADJUSTMENT_STEP_KCAL = 250;

// ASYMMETRY, the deliberate clinical choice. Losing faster than intended is the failure mode that hurts
// an underfuelled athlete, so it is corrected promptly off the responsive short trend. Gaining faster is
// very often glycogen + bound water from finally eating enough (~3 g water per g glycogen, so 1.5-2 kg
// within days at zero fat gain), so a cut is damped harder AND requires the long trend to confirm it.
// Never respond to the first week of successful refuelling by taking food away.
export const GAIN_SIDE_EXTRA_DAMPING = 0.5;

export interface BufferAdjustment {
  bufferApplied: number;
  delta: number; // kcal added to / removed from the configured buffer
  reason: string; // human-readable, shown in the profile UI
  capped: boolean; // true when a rail was hit — surfaced, never swallowed
}

// The trend the athlete SHOULD be on, in kg/7d, derived from the gap to target weight. This is the
// wiring that was missing: the previous mechanism compared the observed trend against zero, so it drove
// toward weight stability regardless of which way the athlete wanted to go.
export function desiredWeightTrend(currentKg: number, targetKg: number): number {
  const gap = targetKg - currentKg; // positive → needs to gain
  if (Math.abs(gap) <= GOAL_DEADBAND_KG) return 0;
  return gap > 0 ? Math.min(MAX_GAIN_KG_PER_WEEK, gap) : Math.max(-MAX_LOSS_KG_PER_WEEK, gap);
}

/**
 * Correct the buffer toward the athlete's INTENDED trend.
 *
 * `trendShort` (~14-day regression window) is the responsive signal and drives the loss side.
 * `trendLong` (~28-day window) is the conservative signal and must confirm before any cut — a stateless
 * substitute for a persisted confirmation counter, which adjustBuffer cannot carry because it is a pure
 * function called on-demand from GET handlers with no write path.
 */
export function adjustBuffer(
  buffer: number,
  trendShort: number | null,
  trendLong: number | null,
  currentKg: number,
  targetKg: number
): BufferAdjustment {
  const settle = (delta: number, reason: string): BufferAdjustment => {
    const unclamped = buffer + delta;
    const bufferApplied = Math.min(BUFFER_MAX_KCAL, Math.max(BUFFER_MIN_KCAL, unclamped));
    const capped = bufferApplied !== unclamped;
    return {
      bufferApplied,
      delta: bufferApplied - buffer,
      capped,
      reason: capped
        ? `${reason} Capped at ${bufferApplied} kcal (allowed range ${BUFFER_MIN_KCAL}–${BUFFER_MAX_KCAL}) — a pinned rail means the model, not the athlete, needs revisiting.`
        : reason,
    };
  };

  if (trendShort === null) {
    return settle(0, "Not enough weigh-ins yet to read a weight trend — buffer left as configured.");
  }

  const desired = desiredWeightTrend(currentKg, targetKg);
  const errShort = trendShort - desired; // positive → gaining faster than intended
  const goalNote = desired === 0 ? "holding weight" : `aiming for ${fmtKg(desired)} kg/week`;

  let err: number;
  let damping: number;
  if (errShort > 0) {
    if (trendLong === null) {
      return settle(
        0,
        `Weight up ${fmtKg(trendShort)} kg/week short-term while ${goalNote}, but not confirmed over the longer window (early gain after refuelling is largely glycogen and water) — no cut.`
      );
    }
    const errLong = trendLong - desired;
    if (errLong <= 0) {
      return settle(
        0,
        `Short-term weight up ${fmtKg(trendShort)} kg/week but the longer trend (${fmtKg(trendLong)} kg/week) does not confirm it while ${goalNote} — not confirmed, no cut.`
      );
    }
    err = errLong;
    damping = CORRECTION_DAMPING * GAIN_SIDE_EXTRA_DAMPING;
  } else {
    err = errShort;
    damping = CORRECTION_DAMPING;
  }

  const imbalanceKcalPerDay = (err * KCAL_PER_KG_TISSUE) / 7;
  const raw = -imbalanceKcalPerDay * damping;
  const stepped = Math.max(-MAX_ADJUSTMENT_STEP_KCAL, Math.min(MAX_ADJUSTMENT_STEP_KCAL, raw));
  const delta = Math.round(stepped / 10) * 10;
  const direction = delta > 0 ? "increased" : delta < 0 ? "decreased" : "unchanged";
  return settle(
    delta,
    `Weight trending ${fmtKg(err > 0 ? trendLong ?? trendShort : trendShort)} kg/week while ${goalNote} — buffer ${direction}${delta === 0 ? "" : ` by ${Math.abs(delta)} kcal`}.`
  );
}

function fmtKg(kg: number): string {
  const rounded = Math.round(kg * 100) / 100;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/nutrition.test.ts -t "adjustBuffer"`
Expected: PASS. Also run `-t "desiredWeightTrend"` — PASS (3 tests).

- [ ] **Step 5: Parameterise the trend window**

In `lib/nutrition.ts`, `weightTrendFromWellness` currently hard-codes `WEIGHT_TREND_WINDOW_DAYS = 14`.
Change the constant to a default parameter so the caller can ask for the long window:

```ts
export const WEIGHT_TREND_WINDOW_DAYS = 14; // default regression window; the gain side asks for 28
export const WEIGHT_TREND_LONG_WINDOW_DAYS = 28;
```

and change the signature and the filter line:

```ts
export function weightTrendFromWellness(
  wellness: WellnessEntry[],
  windowDays: number = WEIGHT_TREND_WINDOW_DAYS
): number | null {
```

```ts
    .filter((p) => p.x >= -windowDays);
```

- [ ] **Step 6: Test the long window**

Append to `lib/nutrition.test.ts`:

```ts
describe("weightTrendFromWellness windowing", () => {
  const w = (date: string, weightKg: number) =>
    ({ date, weightKg, kcalConsumed: null }) as unknown as WellnessEntry;

  it("dilutes a late step change when given the longer window", () => {
    const entries = [
      w("2026-07-01", 70), w("2026-07-08", 70), w("2026-07-15", 70),
      w("2026-07-22", 70), w("2026-07-29", 71.5),
    ];
    const short = weightTrendFromWellness(entries, 14) as number;
    const long = weightTrendFromWellness(entries, 28) as number;
    expect(long).toBeLessThan(short); // the point of the gain-side confirmation window
  });
});
```

Run: `npx vitest run lib/nutrition.test.ts -t "windowing"`
Expected: PASS.

- [ ] **Step 7: Commit (compile errors at call sites are expected and fixed in Task 5)**

`adjustBuffer`'s callers do not compile yet. Commit the pure layer only; Task 5 wires the routes.

```bash
git add lib/nutrition.ts lib/nutrition.test.ts
git commit -m "feat(nutrition): goal-directed asymmetric buffer

adjustBuffer compared the observed weight trend against zero, so it drove
toward weight stability regardless of the athlete's target - and cut 150
kcal as soon as weight rose 0.3 kg/7d. Repleting glycogen binds ~3 g water
per gram, adding 1.5-2 kg within days at zero fat gain, so the mechanism
actively suppressed recovery from underfuelling.

Now: corrects toward a desired trend derived from targetWeight (finally
read by a calculation rather than only appearing in prompt prose),
proportional to the actual kcal imbalance instead of a flat 150 step, and
asymmetric - the loss side acts on a responsive 14-day trend while a cut
requires a 28-day trend to confirm. That is a stateless substitute for the
spec's confirmation counter, which a pure function called from GET
handlers cannot carry.

BUFFER_MIN_KCAL moves 0 -> -500 so a deficit is representable at all.
Rails now report `capped` rather than swallowing the clamp.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The unified daily-target formula

Fixes D1 and D7. The core of the plan.

**Files:**
- Modify: `lib/nutrition.ts` (`AthleteNutritionConfig` → `NutritionModel`, `calculateDailyTarget`,
  `WorkoutNutritionPlan`, `buildNutritionReferenceRows`)
- Test: `lib/nutrition.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_NEAT_MULTIPLIER` and `restingMetabolicRate` (Task 2); `BufferAdjustment` (Task 3).
- Produces:
  ```ts
  type NutritionModel =
    | { kind: "derived"; rmr: number; neatMultiplier: number; weightKg: number; targetWeightKg: number; buffer: number }
    | { kind: "legacy"; baseCalories: number; restDayTarget: number; weightKg: number; targetWeightKg: number; buffer: number };
  ```
  `calculateDailyTarget(activeBurnKcal: number, model: NutritionModel, bufferApplied: number, isRestDay: boolean, workout?: WorkoutContext): WorkoutNutritionPlan`
  with `WorkoutNutritionPlan` gaining `maintenanceKcal: number`.
  `buildNutritionReferenceRows(model: NutritionModel, ftp: number, bufferApplied: number): NutritionReferenceRow[]`.

- [ ] **Step 1: Write the failing tests, including the D1 regression matrix**

Replace the existing `describe("calculateDailyTarget", ...)` block in `lib/nutrition.test.ts` with:

```ts
const DERIVED: NutritionModel = {
  kind: "derived",
  rmr: 1800,
  neatMultiplier: 1.2,
  weightKg: 75,
  targetWeightKg: 78,
  buffer: 300,
};
const LEGACY: NutritionModel = {
  kind: "legacy",
  baseCalories: 2000,
  restDayTarget: 2600,
  weightKg: 75,
  targetWeightKg: 78,
  buffer: 300,
};

describe("calculateDailyTarget (derived)", () => {
  it("is maintenance plus buffer on a rest day, with no rest-day branch", () => {
    const p = calculateDailyTarget(0, DERIVED, 300, true);
    expect(p.maintenanceKcal).toBe(2160); // 1.2 × 1800
    expect(p.dailyTarget).toBe(2460);
  });

  it("adds the synced active burn verbatim on a training day", () => {
    const p = calculateDailyTarget(843, DERIVED, 300, false);
    expect(p.dailyTarget).toBe(3300); // 2160 + 843 + 300, rounded to 10
  });

  it("carries a negative buffer through as a real deficit", () => {
    const p = calculateDailyTarget(0, DERIVED, -400, true);
    expect(p.dailyTarget).toBe(1760);
  });

  it("fills session carb targets only when a workout is supplied", () => {
    const bare = calculateDailyTarget(900, DERIVED, 300, false);
    expect(bare.preRideCarbs).toBe(0);
    const withWorkout = calculateDailyTarget(900, DERIVED, 300, false, { type: "Z2", durationMin: 150 });
    expect(withWorkout.preRideCarbs).toBeGreaterThan(0);
    expect(withWorkout.inRideCarbsPerHour).toBeGreaterThan(0);
  });
});

// The D1 regression. Every one of these cases prescribed LESS than a rest day before this change.
describe("no training day may fall below the same athlete's rest day", () => {
  const CASES: Array<{ type: WorkoutType; durationMin: number }> = [
    { type: "Strength", durationMin: 45 },
    { type: "Strength", durationMin: 60 },
    { type: "Recovery", durationMin: 45 },
    { type: "Recovery", durationMin: 60 },
    { type: "Z2", durationMin: 60 },
    { type: "Threshold", durationMin: 60 },
    { type: "VO2max", durationMin: 75 },
  ];

  for (const model of [DERIVED, LEGACY]) {
    describe(model.kind, () => {
      const rest = calculateDailyTarget(0, model, 300, true).dailyTarget;
      for (const c of CASES) {
        it(`${c.type} ${c.durationMin}min >= rest day`, () => {
          const burn = estimateWorkoutBurnKcal(c.type, c.durationMin, 250);
          const training = calculateDailyTarget(burn, model, 300, false, c).dailyTarget;
          expect(training).toBeGreaterThanOrEqual(rest);
        });
      }
    });
  }
});

describe("calculateDailyTarget (legacy, pre-migration)", () => {
  it("preserves the athlete's hand-set rest-day number unchanged", () => {
    expect(calculateDailyTarget(0, LEGACY, 300, true).dailyTarget).toBe(2600);
  });

  it("floors a training day at the rest-day number rather than lowering rest days to fix the inversion", () => {
    // Strength 45min ≈ 225 kcal: 2000 + 225 + 300 = 2525, below the 2600 rest day.
    const p = calculateDailyTarget(225, LEGACY, 300, false);
    expect(p.dailyTarget).toBe(2600);
  });

  it("is unchanged from previous behaviour once burn clears the rest-day figure", () => {
    expect(calculateDailyTarget(700, LEGACY, 300, false).dailyTarget).toBe(3000);
  });
});
```

Add `NutritionModel`, `estimateWorkoutBurnKcal` and `WorkoutType` to the imports in that test file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/nutrition.test.ts -t "calculateDailyTarget"`
Expected: FAIL — `NutritionModel` is not exported; arity mismatch.

- [ ] **Step 3: Replace the config type and the formula**

In `lib/nutrition.ts`, delete the `AthleteNutritionConfig` interface and replace `WorkoutNutritionPlan`
plus `calculateDailyTarget` with:

```ts
/**
 * `derived` is the real model: dailyTarget = (neatMultiplier × rmr) + activeBurnKcal + buffer. Exactly one
 * term is estimated; the burn is measured and the buffer is an explicit goal choice.
 *
 * `legacy` preserves a pre-migration profile's hand-set baseCalories/restDayTarget until the athlete
 * supplies date of birth, height and sex. Guessing an equivalence between the two shapes would be worse
 * than keeping current behaviour, so the old numbers are honoured verbatim — with one cheap, strictly
 * food-increasing correction for D1 (see calculateDailyTarget).
 */
export type NutritionModel =
  | {
      kind: "derived";
      rmr: number;
      neatMultiplier: number;
      weightKg: number;
      targetWeightKg: number;
      buffer: number;
    }
  | {
      kind: "legacy";
      baseCalories: number;
      restDayTarget: number;
      weightKg: number;
      targetWeightKg: number;
      buffer: number;
    };

export interface WorkoutNutritionPlan {
  dailyTarget: number; // total kcal for the day
  maintenanceKcal: number; // the pre-buffer figure, surfaced so the buffer's effect is auditable
  preRideCarbs: number; // grams
  inRideCarbsPerHour: number; // grams/hr (0 if < 60 min ride)
  bufferApplied: number; // signed
}

/**
 * ONE formula. There is deliberately no rest-day branch on the derived path: a rest day is a day whose
 * activeBurnKcal is 0, so `training ≥ rest` holds by construction for the same athlete.
 *
 * That inversion was live. Two independent formulas (base + burn + buffer vs a flat restDayTarget with no
 * buffer) meant a training day only overtook a rest day once burn cleared ~300 kcal, so every Strength
 * session and short recovery spin prescribed less food than doing nothing.
 *
 * `isRestDay` is consumed by the LEGACY path only — the derived path has no use for it, which is the fix.
 */
export function calculateDailyTarget(
  activeBurnKcal: number,
  model: NutritionModel,
  bufferApplied: number,
  isRestDay: boolean,
  workout?: WorkoutContext
): WorkoutNutritionPlan {
  const carbs = {
    preRideCarbs: workout ? preRideCarbTarget(workout.durationMin, workout.type, model.weightKg) : 0,
    inRideCarbsPerHour: workout ? inRideCarbTarget(workout.durationMin, workout.type) : 0,
  };

  if (model.kind === "derived") {
    const maintenance = model.neatMultiplier * model.rmr + activeBurnKcal;
    return {
      dailyTarget: roundTo(maintenance + bufferApplied, 10),
      maintenanceKcal: Math.round(maintenance),
      ...carbs,
      bufferApplied,
    };
  }

  // Legacy. The rest-day figure is honoured exactly; a training day is floored AT it rather than the
  // rest day being lowered to meet the training day — the inversion goes away and nobody loses food.
  if (isRestDay) {
    return {
      dailyTarget: Math.round(model.restDayTarget),
      maintenanceKcal: Math.round(model.restDayTarget),
      ...carbs,
      bufferApplied,
    };
  }
  const raw = roundTo(model.baseCalories + activeBurnKcal + bufferApplied, 10);
  return {
    dailyTarget: Math.max(raw, Math.round(model.restDayTarget)),
    maintenanceKcal: Math.round(model.baseCalories + activeBurnKcal),
    ...carbs,
    bufferApplied,
  };
}
```

- [ ] **Step 4: Update the reference-table builder**

In `lib/nutrition.ts`, replace `buildNutritionReferenceRows`:

```ts
export function buildNutritionReferenceRows(
  model: NutritionModel,
  ftp: number,
  bufferApplied: number
): NutritionReferenceRow[] {
  const rows: NutritionReferenceRow[] = [];
  for (const [type, durations] of Object.entries(REFERENCE_DURATIONS) as [WorkoutType, number[]][]) {
    for (const durationMin of durations) {
      const estBurnKcal = estimateWorkoutBurnKcal(type, durationMin, ftp);
      rows.push({
        type,
        durationMin,
        estBurnKcal,
        plan: calculateDailyTarget(estBurnKcal, model, bufferApplied, type === "Rest", {
          type,
          durationMin,
        }),
      });
    }
  }
  return rows;
}
```

The caller now resolves the buffer once and passes the applied figure, instead of every row re-deriving it
from a weight trend.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run lib/nutrition.test.ts`
Expected: PASS, including all 14 D1-regression cases (7 per model).

- [ ] **Step 6: Commit**

```bash
git add lib/nutrition.ts lib/nutrition.test.ts
git commit -m "feat(nutrition): one daily-target formula, no rest-day branch

calculateDailyTarget ran two independent formulas - base + burn + buffer
on training days, a flat restDayTarget with no buffer on rest days - so a
training day only overtook a rest day once burn cleared ~300 kcal. Every
Strength session (225 kcal at 45 min) and short recovery spin prescribed
LESS food than doing nothing, which for an athlete recovering from
underfuelling is backwards.

The derived path is now (neat x rmr) + activeBurnKcal + buffer, where a
rest day is simply burn = 0. training >= rest holds by construction, so
the inversion is unrepresentable rather than tuned away. A 14-case
regression matrix pins it across both models.

The legacy path keeps un-migrated profiles' hand-set numbers exactly, with
one strictly food-increasing correction: a training day is floored at the
rest-day figure rather than rest days being lowered to meet it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Resolve the model, and wire the routes

The migration gate plus every server call site.

**Files:**
- Modify: `lib/nutrition.ts` (add `resolveNutritionModel`)
- Modify: `lib/types.ts` (`NutritionSettings` deprecation comments)
- Modify: `app/api/profile/route.ts:53, 128-145` and the GET response
- Modify: `app/api/generate/route.ts:120-130`
- Test: `lib/nutrition.test.ts`

**Interfaces:**
- Consumes: `NutritionModel` (Task 4), `restingMetabolicRate` + `DEFAULT_NEAT_MULTIPLIER` (Task 2),
  `ageYearsFrom` (Task 2), `adjustBuffer` + `weightTrendFromWellness` (Task 3).
- Produces:
  `resolveNutritionModel(profile: AthleteProfile, latestWeightKg: number, today: string): NutritionModel`.

- [ ] **Step 1: Write the failing test**

Append to `lib/nutrition.test.ts`:

```ts
describe("resolveNutritionModel", () => {
  const profile = (perf: Partial<AthleteProfile["performance"]>) =>
    ({
      performance: {
        ftp: 250, maxHr: 190, thresholdHr: 170, weightKg: 75,
        weeklyHoursMin: 6, weeklyHoursMax: 10,
        dateOfBirth: null, heightCm: null, sex: null, ...perf,
      },
      nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 78 },
    }) as unknown as AthleteProfile;

  it("derives once all three RMR inputs are present", () => {
    const m = resolveNutritionModel(
      profile({ dateOfBirth: "1996-03-14", heightCm: 180, sex: "male" }), 74, "2026-07-30"
    );
    expect(m.kind).toBe("derived");
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.rmr).toBe(restingMetabolicRate(74, 180, 30, "male"));
    expect(m.weightKg).toBe(74); // synced weight wins over the manual profile figure
  });

  // The gotcha this project has already been bitten by: a profile JSON written before these fields
  // existed parses them back as `undefined`, which `=== null` misses.
  it("stays legacy when the RMR fields are undefined, not just null", () => {
    const p = profile({});
    delete (p.performance as Record<string, unknown>).dateOfBirth;
    delete (p.performance as Record<string, unknown>).heightCm;
    delete (p.performance as Record<string, unknown>).sex;
    expect(resolveNutritionModel(p, 74, "2026-07-30").kind).toBe("legacy");
  });

  it("stays legacy when only some inputs are present", () => {
    expect(resolveNutritionModel(profile({ heightCm: 180 }), 74, "2026-07-30").kind).toBe("legacy");
  });

  it("stays legacy when the date of birth cannot yield a plausible age", () => {
    const m = resolveNutritionModel(
      profile({ dateOfBirth: "not-a-date", heightCm: 180, sex: "male" }), 74, "2026-07-30"
    );
    expect(m.kind).toBe("legacy");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/nutrition.test.ts -t "resolveNutritionModel"`
Expected: FAIL — not a function.

- [ ] **Step 3: Implement the resolver**

In `lib/nutrition.ts`, after `calculateDailyTarget`:

```ts
/**
 * Pick the model for this athlete. The presence of all three RMR inputs IS the migration gate — there is
 * no separate timestamp flag to keep in sync.
 *
 * Truthy checks, never `=== null`: a profile JSON written before these fields existed parses them back as
 * `undefined`, and an equality check against null misses it, so the migration silently never runs. This
 * project has shipped that bug before.
 */
export function resolveNutritionModel(
  profile: AthleteProfile,
  latestWeightKg: number,
  today: string
): NutritionModel {
  const p = profile.performance;
  const shared = {
    weightKg: latestWeightKg,
    targetWeightKg: profile.nutrition.targetWeightKg,
    buffer: profile.nutrition.buffer,
  };
  if (p.dateOfBirth && p.heightCm && p.sex) {
    const ageYears = ageYearsFrom(p.dateOfBirth, today);
    if (ageYears !== null) {
      return {
        kind: "derived",
        rmr: restingMetabolicRate(latestWeightKg, p.heightCm, ageYears, p.sex),
        neatMultiplier: DEFAULT_NEAT_MULTIPLIER, // per-athlete calibration is Phase 3
        ...shared,
      };
    }
  }
  return {
    kind: "legacy",
    baseCalories: profile.nutrition.baseCalories,
    restDayTarget: profile.nutrition.restDayTarget,
    ...shared,
  };
}
```

Add to the imports at the top of `lib/nutrition.ts`:

```ts
import { ageYearsFrom } from "./date";
import type { ActivitySummary, AthleteProfile, WellnessEntry, WorkoutType } from "./types";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/nutrition.test.ts -t "resolveNutritionModel"`
Expected: PASS (4 tests).

- [ ] **Step 5: Mark the deprecated settings**

In `lib/types.ts`, replace `NutritionSettings`:

```ts
export interface NutritionSettings {
  buffer: number; // SIGNED goal-directed surplus/deficit, kcal/day; range BUFFER_MIN_KCAL..BUFFER_MAX_KCAL
  targetWeightKg: number;
  // DEPRECATED — read only by resolveNutritionModel's legacy branch, for profiles that predate the
  // dateOfBirth/heightCm/sex RMR inputs. Never written by new code; delete once no profile needs them.
  baseCalories: number;
  restDayTarget: number;
}
```

- [ ] **Step 6: Update the profile route**

In `app/api/profile/route.ts`:

Replace the `weightTrend7Day` line (~53) with both windows:

```ts
  const weightTrend7Day = sync ? weightTrendFromWellness(sync.wellness) : null;
  const weightTrendLong = sync ? weightTrendFromWellness(sync.wellness, WEIGHT_TREND_LONG_WINDOW_DAYS) : null;
```

Replace the `bufferStatus` line in the GET response:

```ts
    bufferStatus: adjustBuffer(
      profile.nutrition.buffer,
      weightTrend7Day,
      weightTrendLong,
      weighIns[0]?.weightKg ?? profile.performance.weightKg,
      profile.nutrition.targetWeightKg
    ),
    nutritionModel: resolveNutritionModel(
      profile,
      weighIns[0]?.weightKg ?? profile.performance.weightKg,
      localToday()
    ),
```

In the PUT validator, replace the nutrition block:

```ts
  let nutrition: AthleteProfile["nutrition"] | undefined;
  if (b.nutrition !== undefined) {
    const input = b.nutrition as Record<string, unknown>;
    const { baseCalories, restDayTarget, buffer, targetWeightKg } = input;
    const pos = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
    if (!pos(baseCalories)) return NextResponse.json({ error: "baseCalories must be a positive number." }, { status: 400 });
    if (!pos(restDayTarget)) return NextResponse.json({ error: "restDayTarget must be a positive number." }, { status: 400 });
    if (!pos(targetWeightKg)) return NextResponse.json({ error: "targetWeightKg must be a positive number." }, { status: 400 });
    // Signed: a negative buffer is how a deficit is expressed at all (previously impossible).
    if (typeof buffer !== "number" || !Number.isFinite(buffer) || buffer < BUFFER_MIN_KCAL || buffer > BUFFER_MAX_KCAL) {
      return NextResponse.json(
        { error: `buffer must be between ${BUFFER_MIN_KCAL} and ${BUFFER_MAX_KCAL} kcal.` },
        { status: 400 }
      );
    }
    nutrition = {
      baseCalories: baseCalories as number,
      restDayTarget: restDayTarget as number,
      buffer: buffer as number,
      targetWeightKg: targetWeightKg as number,
    };
  }

  // RMR inputs live on `performance`, saved independently of the nutrition block.
  let performancePatch: Partial<AthleteProfile["performance"]> | undefined;
  if (b.performance !== undefined) {
    const input = b.performance as Record<string, unknown>;
    const patch: Partial<AthleteProfile["performance"]> = {};
    if (input.dateOfBirth !== undefined) {
      const dob = input.dateOfBirth;
      if (dob !== null && (typeof dob !== "string" || ageYearsFrom(dob, localToday()) === null)) {
        return NextResponse.json({ error: "dateOfBirth must be a valid past YYYY-MM-DD date, or null." }, { status: 400 });
      }
      patch.dateOfBirth = dob as string | null;
    }
    if (input.heightCm !== undefined) {
      const h = input.heightCm;
      if (h !== null && !(typeof h === "number" && Number.isFinite(h) && h > 50 && h < 260)) {
        return NextResponse.json({ error: "heightCm must be between 50 and 260, or null." }, { status: 400 });
      }
      patch.heightCm = h as number | null;
    }
    if (input.sex !== undefined) {
      const s = input.sex;
      if (s !== null && s !== "male" && s !== "female") {
        return NextResponse.json({ error: 'sex must be "male", "female", or null.' }, { status: 400 });
      }
      patch.sex = s as "male" | "female" | null;
    }
    performancePatch = patch;
  }
```

Then, wherever the existing handler applies `nutrition` inside `updateAthleteProfile`, apply the
performance patch alongside it — read the surrounding mutator and add:

```ts
      performance: performancePatch ? { ...current.performance, ...performancePatch } : current.performance,
```

Add the needed imports to the file's existing `@/lib/nutrition` and `@/lib/date` imports:
`adjustBuffer, resolveNutritionModel, weightTrendFromWellness, WEIGHT_TREND_LONG_WINDOW_DAYS, BUFFER_MIN_KCAL, BUFFER_MAX_KCAL` and `localToday, ageYearsFrom`.

- [ ] **Step 7: Update the generate route**

In `app/api/generate/route.ts`, replace the `nutritionConfig` block (~120-130):

```ts
    const nutritionModel = resolveNutritionModel(profile, latestWeight, resolveToday(body.today));
    const bufferStatus = adjustBuffer(
      profile.nutrition.buffer,
      weightTrend,
      weightTrendFromWellness(sync?.wellness ?? [], WEIGHT_TREND_LONG_WINDOW_DAYS),
      latestWeight,
      profile.nutrition.targetWeightKg
    );
    const nutritionTable = nutritionTableMarkdown(
      buildNutritionReferenceRows(nutritionModel, profile.performance.ftp, bufferStatus.bufferApplied)
    );
```

Update the `AthleteNutritionConfig` import to `resolveNutritionModel, adjustBuffer, WEIGHT_TREND_LONG_WINDOW_DAYS`.
If `body.today` is not already read in this handler, use `localToday()` — do not inline a UTC date.

- [ ] **Step 7b: Fix the third copy of the formula — `lib/ride-analysis.ts`**

**Found during execution; the plan's original File Structure table missed it.** `computeAdvisedIntake`
([lib/ride-analysis.ts:53](../../../lib/ride-analysis.ts)) re-implements the training-day formula
(`baseCalories + rideKj + bufferApplied`) and calls `adjustBuffer` with the old 2-argument signature. It
feeds the Today card's advised-intake figure *and* `todayTargetKcal` in
[lib/coach-snapshot.ts:279](../../../lib/coach-snapshot.ts), which goes into the AI prompt — so leaving it
on the legacy path would make the Today card and the generated plan quietly disagree, which is the exact
defect class this phase exists to remove.

Delegate to the one formula instead of duplicating it:

```ts
export function computeAdvisedIntake(
  rideKj: number | null,
  model: NutritionModel,
  bufferApplied: number
): AdvisedIntake {
  const advisedRideFuelKcal = rideKj ?? 0;
  // Delegates to THE formula rather than re-deriving base + burn + buffer, so the Today card and the
  // generated plan can never disagree. isRestDay is false: this path only runs for a completed ride.
  const plan = calculateDailyTarget(advisedRideFuelKcal, model, bufferApplied, false);
  return {
    advisedIntakeKcal: plan.dailyTarget,
    advisedBaseKcal: plan.maintenanceKcal - advisedRideFuelKcal,
    advisedBufferKcal: bufferApplied,
    advisedRideFuelKcal,
  };
}
```

Change `TodayAnalysisInputs.nutrition` from `{ baseCalories: number; buffer: number }` to
`{ model: NutritionModel; bufferApplied: number }`, forward it at
[lib/ride-analysis.ts:107](../../../lib/ride-analysis.ts), and update the construction site at
[app/api/sync/route.ts:678](../../../app/api/sync/route.ts) to build it via `resolveNutritionModel` +
`adjustBuffer` the same way the profile route does. Keep `weightTrend7Day` on `TodayAnalysisInputs` if
other fields still use it; drop it only if it becomes genuinely unused.

Update `lib/ride-analysis.test.ts`'s `computeAdvisedIntake` suite to the new signature. Its existing
expectations (2900 = 2000 + 600 + 300) hold exactly under a legacy model — use one, and keep the numbers.

- [ ] **Step 8: Scoped verification**

Run: `npx vitest run lib/nutrition.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: errors ONLY in `lib/nutrition-validate.ts` and `lib/trends.ts` (and their tests), which Task 6
owns. Do not fix them here. Any error in another file is yours and must be fixed before committing.

- [ ] **Step 9: Commit**

```bash
git add lib/nutrition.ts lib/nutrition.test.ts lib/types.ts app/api/profile/route.ts app/api/generate/route.ts
git commit -m "feat(nutrition): migration gate and route wiring

resolveNutritionModel picks derived vs legacy from whether all three RMR
inputs are present - truthy checks, never === null, because a profile JSON
predating those fields parses them back as undefined and an equality check
misses it (a bug this project has shipped before).

Routes now resolve the buffer once and pass the applied figure down, rather
than every reference-table row re-deriving it from a weight trend. PUT
accepts the new performance fields and a signed buffer.

baseCalories/restDayTarget are marked deprecated: read only by the legacy
branch, never written by new code.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Follow through in the validator and weekly trends

`nutrition-validate.ts` is the enforcement layer for "the AI never invents a kcal figure" and it
*auto-rewrites* plan text, so it must move in lockstep. `trends.ts` carries the second half of D7.

**Files:**
- Modify: `lib/nutrition-validate.ts:12, 35-53, 55-72, 90-104`
- Modify: `lib/trends.ts:96-141`
- Test: `lib/nutrition-validate.test.ts`, `lib/trends.test.ts`

**Interfaces:**
- Consumes: `NutritionModel`, `calculateDailyTarget` (Task 4); `activeBurn` (Task 1).
- Produces: `validateNutrition(days, model, ftp, bufferApplied)`, `repairNutrition(days, model, ftp, bufferApplied)`,
  `weeklyEnergy(activities, wellness, today, model?)`.

- [ ] **Step 1: Update the validator signatures**

In `lib/nutrition-validate.ts`, change the import and both public functions to take a `NutritionModel` and
a resolved `bufferApplied` instead of `AthleteNutritionConfig` + `weightTrend7Day`:

```ts
import { calculateDailyTarget, estimateWorkoutBurnKcal, type NutritionModel } from "./nutrition";
```

In `checkDailyIntake`, replace the signature and the `expected` computation:

```ts
function checkDailyIntake(
  d: PlannedDay,
  model: NutritionModel,
  ftp: number,
  bufferApplied: number
): DailyIntakeCheck | null {
  const stated = parseDailyIntakeKcal(d.description);
  if (stated === null) return null;
  const expected = calculateDailyTarget(
    estimateWorkoutBurnKcal(d.type, d.durationMin, ftp),
    model,
    bufferApplied,
    d.type === "Rest",
    { type: d.type, durationMin: d.durationMin }
  ).dailyTarget;
```

Apply the same parameter swap to `validateNutrition` and `repairNutrition`, forwarding `model` and
`bufferApplied` to `checkDailyIntake`.

- [ ] **Step 2: Update the validator's test fixture**

In `lib/nutrition-validate.test.ts`, replace the config fixture with a legacy model so the existing
assertions (which reference the 2600 rest-day figure) still describe real behaviour:

```ts
const MODEL: NutritionModel = {
  kind: "legacy",
  baseCalories: 2000,
  restDayTarget: 2600,
  weightKg: 75,
  targetWeightKg: 78,
  buffer: 300,
};
```

Update every call to pass `MODEL, ftp, 300` in place of `config, ftp, weightTrend`.

Run: `npx vitest run lib/nutrition-validate.test.ts`
Expected: PASS with unchanged assertions.

- [ ] **Step 3: Update the generate route's repair call**

In `app/api/generate/route.ts:448`:

```ts
    const nutritionRepair = repairNutrition(reconciledDays, nutritionModel, profile.performance.ftp, bufferStatus.bufferApplied);
```

- [ ] **Step 4: Write the failing trends test**

Append to `lib/trends.test.ts`:

```ts
describe("weeklyEnergy need calculation", () => {
  const MODEL: NutritionModel = {
    kind: "derived", rmr: 1800, neatMultiplier: 1.2, weightKg: 75, targetWeightKg: 78, buffer: 300,
  };

  it("counts an off-bike activity's active burn toward need", () => {
    const activities = [
      { date: "2026-06-16", type: "Run", activeBurnKcal: 500, kj: null },
    ] as unknown as ActivitySummary[];
    const wellness = [{ date: "2026-06-16", weightKg: 75, kcalConsumed: 2800 }] as unknown as WellnessEntry[];
    const [week] = weeklyEnergy(activities, wellness, "2026-06-29", MODEL);
    // 1.2 × 1800 + 500 + 300 = 2960 — the run is no longer invisible.
    expect(week.needKcal).toBe(2960);
  });

  it("never computes a lower need for a day with activity than for one without", () => {
    const wellness = [{ date: "2026-06-16", weightKg: 75, kcalConsumed: 2800 }] as unknown as WellnessEntry[];
    const withWalk = weeklyEnergy(
      [{ date: "2026-06-16", type: "Walk", activeBurnKcal: 150, kj: null }] as unknown as ActivitySummary[],
      wellness, "2026-06-29", MODEL
    )[0];
    const withNothing = weeklyEnergy([], wellness, "2026-06-29", MODEL)[0];
    expect(withWalk.needKcal!).toBeGreaterThanOrEqual(withNothing.needKcal!);
  });
});
```

Run: `npx vitest run lib/trends.test.ts -t "weeklyEnergy need"`
Expected: FAIL — the old `dayBurn > 0 ? base + burn + buffer : restDayTarget` branch, and `kj`-only burn.

- [ ] **Step 5: Fix `weeklyEnergy`**

In `lib/trends.ts`, change the signature's `settings?: NutritionSettings | null` to
`model?: NutritionModel | null`, and replace the `needBurnByDate` loop:

```ts
  // Need-side burn counts every activity carrying an active-burn figure (D5) — a run, a hike and a gym
  // session all cost energy. The chart's separate `burn` series below stays rides-only, deliberately.
  const needBurnByDate = new Map<string, number>();
  for (const a of activities) {
    const burn = activeBurn(a);
    if (burn === null) continue;
    needBurnByDate.set(a.date, (needBurnByDate.get(a.date) ?? 0) + burn.kcal);
  }
```

Then replace the day-matched need line (~136). The `dayBurn > 0` rest-day test is deleted outright: it was
D7's second definition of "rest day", and combined with D1 it meant logging a walk *reduced* that day's
computed need.

```ts
      if (model) {
        const dayBurn = needBurnByDate.get(w.date) ?? 0;
        // One formula, no rest-day branch — a rest day is simply a day whose burn is 0. Flat configured
        // buffer: the live weight-trend adjustment is a CURRENT steering signal, unknowable for a past
        // week, and ±250 kcal/day sits inside the bands' coarseness.
        e.need += calculateDailyTarget(dayBurn, model, model.buffer, dayBurn === 0).dailyTarget;
        e.logged += 1;
      }
```

Update the file's imports: drop `NutritionSettings` if now unused, add
`import { activeBurn, calculateDailyTarget, type NutritionModel } from "./nutrition";`.

Note the chart's rides-only loop (~119-125) also reads `a.kj`. Leave it — it is a documented, deliberate
choice about what the *chart* displays, not the same defect.

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run lib/trends.test.ts`
Expected: PASS. The pre-existing `needKcal` expectations (14900, etc.) were computed from the legacy flat
formula — recompute each by hand from the new formula and update the literals, keeping the fixtures
unchanged. Confirm each new value is ≥ the old one for any day carrying activity.

- [ ] **Step 7: Update `weeklyEnergy`'s callers**

Run: `npx tsc --noEmit` and fix every call site that passes `NutritionSettings` to `weeklyEnergy` —
`app/api/trends/route.ts` and any snapshot assembly — to pass `resolveNutritionModel(...)` instead.

- [ ] **Step 8: Full check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/nutrition-validate.ts lib/nutrition-validate.test.ts lib/trends.ts lib/trends.test.ts app/api/generate/route.ts app/api/trends/route.ts
git commit -m "fix(nutrition): follow through in the validator and weekly need

nutrition-validate is the enforcement layer for 'the AI never invents a
kcal figure' and auto-rewrites plan text via repairNutrition, so it moves
in lockstep with the formula signature rather than drifting from it.

weeklyEnergy's need calculation carried the second half of D7: it decided
rest-vs-training by `dayBurn > 0`, a different definition from the
formula's own. Combined with the inversion, logging a 150 kcal walk
REDUCED that day's computed need by ~210 kcal. That branch is deleted -
one formula, burn = 0 is what a rest day means - and the need side now
reads active burn, so off-bike work counts.

The chart's separate rides-only burn series is deliberately untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Profile UI — RMR inputs, computed display, migration prompt

**Files:**
- Modify: `components/AthleteProfileForm.tsx:19-27, 44-60, 135, 150-160, 169-188, 634-705`
- Modify: `components/dashboard/today.tsx:610` (call-through only)

**Interfaces:**
- Consumes: the `/api/profile` GET response's new `nutritionModel` and extended `bufferStatus`
  (`capped: boolean`) from Task 5.

- [ ] **Step 1: Update the response types**

In `components/AthleteProfileForm.tsx`:

```ts
interface NutritionSettings {
  buffer: number;
  targetWeightKg: number;
  baseCalories: number; // deprecated; shown only during migration
  restDayTarget: number; // deprecated; shown only during migration
}

interface BufferStatus {
  bufferApplied: number;
  delta: number;
  reason: string;
  capped: boolean;
}

type NutritionModel =
  | { kind: "derived"; rmr: number; neatMultiplier: number; weightKg: number; targetWeightKg: number; buffer: number }
  | { kind: "legacy"; baseCalories: number; restDayTarget: number; weightKg: number; targetWeightKg: number; buffer: number };
```

Add `nutritionModel: NutritionModel;` to `ProfileResponse`, and `performance` with the three RMR fields if
the response does not already carry them — check the route's GET shape from Task 5 and match it exactly.

- [ ] **Step 2: Add form state for the RMR inputs**

Replace the `nut` state initialiser (~line 135):

```ts
  const [nut, setNut] = useState({ buffer: "", targetWeightKg: "" });
  const [rmrInputs, setRmrInputs] = useState({ dateOfBirth: "", heightCm: "", sex: "" });
```

In the mount effect, replace the `setNut({...})` call:

```ts
        setNut({ buffer: String(n.buffer), targetWeightKg: String(n.targetWeightKg) });
        setRmrInputs({
          dateOfBirth: response.performance?.dateOfBirth ?? "",
          heightCm: response.performance?.heightCm != null ? String(response.performance.heightCm) : "",
          sex: response.performance?.sex ?? "",
        });
```

- [ ] **Step 3: Save the RMR inputs**

Add alongside `saveNutrition`:

```ts
  const saveRmrInputs = async () => {
    const heightCm = Number(rmrInputs.heightCm);
    if (!rmrInputs.dateOfBirth || !Number.isFinite(heightCm) || heightCm <= 0 || !rmrInputs.sex) {
      setSaveState({ state: "error", message: "Date of birth, height and sex are all needed to compute your RMR." });
      return;
    }
    setSaveState({ state: "saving" });
    try {
      await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          performance: { dateOfBirth: rmrInputs.dateOfBirth, heightCm, sex: rmrInputs.sex },
        }),
      });
      setSaveState({ state: "saved" });
      setData(await api<ProfileResponse>("/api/profile"));
    } catch (err) {
      setSaveState({ state: "error", message: err instanceof Error ? err.message : "Couldn't save — try again." });
    }
  };
```

- [ ] **Step 4: Replace the nutrition section's display**

Replace the `<p className="mb-2 font-mono text-sm ...">` block (~line 641) with a model-aware display:

```tsx
        {data.nutritionModel.kind === "derived" ? (
          <p className="mb-2 font-mono text-sm text-zinc-800 dark:text-zinc-100">
            {data.nutritionModel.rmr.toLocaleString()} RMR
            <span className="text-zinc-500 dark:text-zinc-400"> × </span>
            {data.nutritionModel.neatMultiplier} NEAT
            <span className="text-zinc-500 dark:text-zinc-400"> = </span>
            {Math.round(data.nutritionModel.rmr * data.nutritionModel.neatMultiplier).toLocaleString()} maintenance
            <span className="text-zinc-500 dark:text-zinc-400"> · buffer </span>
            {data.nutrition.buffer > 0 ? "+" : ""}{data.nutrition.buffer}
            <span className="text-zinc-500 dark:text-zinc-400"> · target </span>
            {data.nutrition.targetWeightKg} kg
          </p>
        ) : (
          <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950">
            <p className="font-mono text-sm text-zinc-800 dark:text-zinc-100">
              {data.nutrition.baseCalories.toLocaleString()} base
              <span className="text-zinc-500 dark:text-zinc-400"> · </span>
              {data.nutrition.restDayTarget.toLocaleString()} rest-day
              <span className="text-zinc-500 dark:text-zinc-400"> (your hand-set values)</span>
            </p>
            <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-300">
              Add your date of birth, height and sex below and these become computed from your RMR instead.
              Your current numbers stay in use until you do — nothing changes behind your back.
            </p>
          </div>
        )}
```

- [ ] **Step 5: Add the RMR input form**

Insert before the existing `<details className="mt-3">` "Edit" disclosure:

```tsx
        <form
          className="mt-3 rounded bg-zinc-50 px-3 py-2 dark:bg-zinc-900"
          onSubmit={(e) => { e.preventDefault(); void saveRmrInputs(); }}
        >
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            Resting metabolic rate inputs
            {data.nutritionModel.kind === "derived" && (
              <span className="ml-1 font-normal text-zinc-500 dark:text-zinc-400">
                — driving the {data.nutritionModel.rmr.toLocaleString()} kcal figure above
              </span>
            )}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label>
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Date of birth</span>
              <input
                type="date"
                value={rmrInputs.dateOfBirth}
                onChange={(e) => setRmrInputs((s) => ({ ...s, dateOfBirth: e.target.value }))}
                className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
              />
            </label>
            <label>
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Height (cm)</span>
              <input
                type="number" min={50} max={260}
                value={rmrInputs.heightCm}
                onChange={(e) => setRmrInputs((s) => ({ ...s, heightCm: e.target.value }))}
                className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
              />
            </label>
            <label>
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">Sex</span>
              <select
                value={rmrInputs.sex}
                onChange={(e) => setRmrInputs((s) => ({ ...s, sex: e.target.value }))}
                className="mt-1 w-full rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
              >
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </label>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            Sex is a term in the Mifflin-St Jeor equation, not a profile setting.
          </p>
          <button type="submit" className="mt-2 rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
            Save
          </button>
        </form>
```

- [ ] **Step 6: Trim the Edit disclosure to the two live fields**

In the `Edit` disclosure's field array, delete the `baseCalories` and `restDayTarget` entries and make
`buffer` signed:

```tsx
                  { key: "buffer", label: "Goal buffer", unit: "kcal", min: BUFFER_MIN_KCAL, hint: `${BUFFER_MIN_KCAL}–${BUFFER_MAX_KCAL}, negative = deficit` },
                  { key: "targetWeightKg", label: "Target weight", unit: "kg", min: 0, hint: "min 0" },
```

Change the grid to `sm:grid-cols-2`.

- [ ] **Step 7: Surface the capped rail**

In the "Buffer auto-adjustment" box, after the `{bufferStatus.reason}` paragraph:

```tsx
          {bufferStatus.capped && (
            <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
              Correction is pinned at its limit — the model needs revisiting, not the buffer.
            </p>
          )}
```

- [ ] **Step 8: Update the EA tile's activities argument**

`computeEnergyAvailability` now needs `activeBurnKcal`. `sync.activities` already carries it after Task 1,
so `components/dashboard/today.tsx:610` needs no change. Verify with:

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Verify in the browser**

Start the dev server via the preview tool (not Bash), open `/profile`, and confirm:
1. Before entering RMR inputs: the amber legacy box shows the hand-set numbers and the explanatory copy.
2. After saving date of birth + height + sex: the display switches to the `RMR × NEAT = maintenance`
   breakdown and the amber box disappears.
3. A negative buffer saves without a 400.

Capture a screenshot of the migrated state.

- [ ] **Step 10: Full check and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add components/AthleteProfileForm.tsx
git commit -m "feat(profile): RMR inputs, computed maintenance, migration prompt

baseCalories/restDayTarget stop being editable text fields and become a
computed 'RMR x NEAT = maintenance' breakdown once date of birth, height
and sex are supplied. Until then the hand-set values keep displaying and
working, with copy saying so - a number the athlete tuned by experience is
evidence, not noise, so nothing is overwritten behind their back.

Buffer input accepts negatives (a deficit was previously unexpressible)
and a pinned correction rail is surfaced rather than swallowed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Live smoke run

LLM-backed paths need one real run — unit tests and a green build only prove the deterministic scaffolding
around the prompt, and this change rewrites the numbers that scaffolding feeds it.

**Files:** none modified unless the run surfaces a defect.

- [ ] **Step 1: Confirm the migrated model is live**

With the dev server running, `GET /api/profile` and confirm `nutritionModel.kind === "derived"` with a
plausible `rmr`.

- [ ] **Step 2: Generate a real block**

Generate a 2-week block through the UI against the live Anthropic API.

- [ ] **Step 3: Read the actual output**

Confirm in the returned plan:
1. No rest day's stated daily intake exceeds any training day's in the same week — the D1 fix, visible.
2. `warnings` contains no `repairNutrition` entries (the reference table and validator agree; a repair
   note here means they were computed from different models).
3. Rest-day kcal figures reflect `maintenance + buffer`, not the old flat 2600.

- [ ] **Step 4: Check the trends page**

Open `/trends` and confirm the weekly need/ratio figures render without `NaN` or nulls, and that a week
containing a non-ride activity shows a higher need than it would have before.

- [ ] **Step 5: Record the result**

Append a one-line record to `todo.md` under the post-audit live-verify section noting the date, the
generated block, and anything the run surfaced. Commit.

```bash
git add todo.md
git commit -m "docs: record the Phase 1 nutrition live smoke run

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| D1 inversion — unified formula, `restDayTarget` deleted | 4 (+ legacy floor), regression matrix in 4 |
| D2 deficit representable — signed buffer | 3 (`BUFFER_MIN_KCAL = -500`), 5 (route validation), 7 (UI) |
| D3 `targetWeight` wired, asymmetric correction | 3 |
| D4 active burn verbatim, no re-derivation from `kj` | 1 |
| D5 off-bike activity counts | 1, 6 (`weeklyEnergy` need side) |
| D6 rail surfaced, proportional correction | 3 (`capped`, damping), 7 (UI) |
| D7 two rest-day definitions | 4 (formula), 6 (`dayBurn > 0` deleted) |
| §4 `PerformanceData` RMR inputs, DOB not age | 2 |
| §4 `NutritionSettings` deprecation | 5 |
| §5 RMR + `DEFAULT_NEAT_MULTIPLIER` | 2 |
| §6 `activeBurn` accessor + flagged legacy branch | 1 |
| §11 migration gate, truthy checks, side-by-side | 5 (resolver + test), 7 (UI) |
| §12 all call sites | 1, 5, 6, 7 |
| §14 D1/D7 regression + glycogen-rebound + migration-gate tests | 3, 4, 5, 6 |
| AGENTS.md: LLM path needs a live smoke run | 8 |

Not covered, deliberately: §7 calibration, §9 daily carbs, §10 streak alert — Phases 3–4.
`BufferCorrectionState` is dropped (see the deviation note); the spec needs that edit.

**Type consistency check:** `NutritionModel` is the single config type from Task 4 onward — Tasks 5, 6 and 7
all consume that exact name. `activeBurn()` returns `ActiveBurn | null` and every consumer (Tasks 1, 6)
null-checks before reading `.kcal`. `adjustBuffer`'s 5-arity signature from Task 3 is used identically in
Task 5's two call sites. `WorkoutNutritionPlan.maintenanceKcal` is added in Task 4 and read in Task 7.
`bufferApplied` replaces `weightTrend7Day` in `validateNutrition`/`repairNutrition` consistently in Task 6.

**Known follow-up, not in this plan:** [lib/coach-snapshot.ts:173](../../../lib/coach-snapshot.ts) defaults
`computeEnergyAvailability`'s `today` to `utcToday()` while the tile passes `localToday()`. Pre-existing,
out of scope here, worth its own fix.
