# Hard-ride carb optimum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, parallel learned carb-fueling optimum (`hardCarbsOptimum`) for hard/interval sessions, classified by `executionScore` — the existing `carbsOptimum` only covers Z2/endurance rides and cannot be reused for hard sessions because its outcome signal (aerobic efficiency) doesn't meaningfully exist for them.

**Architecture:** Mirrors the existing `carbsOptimum` pipeline exactly (`lib/calibration.ts`'s generic `deriveOptimum`/`OptimumSpec` machinery), with a different candidate pool (hard-type rides from `data/score-log.json`'s already-persisted `inferredType`, not a fresh classification) and a different outcome signal (`executionScore`, not `aerobicEffPct`). The resolved value is computed once per generation request and threaded as a plain optional number into `lib/nutrition.ts`'s pure formula functions and `lib/nutrition-validate.ts`'s validator — never two independent resolves, which is exactly the divergence class the day-type NEAT work already hit once.

**Tech Stack:** TypeScript, Next.js API routes, Vitest.

## Global Constraints

- New parameter is additive: `hardCarbsOptimum?: CalibratedParameter` alongside the existing `carbsOptimum` in `CalibrationStore` — no migration, no restructuring.
- Population default for the hard tier is `105` (`DEFAULT_HARD_CARBS_OPTIMUM`) — identical to what `inRideCarbTarget` already returns today, so an athlete with no confident calibration sees zero change.
- Good/bad classification: `executionScore >= 7` → good, `< 5` → bad, `[5, 7)` → deadband — reusing `executionScoreLabel`'s existing band boundaries (`lib/execution-score.ts`), not new thresholds.
- Reuse, never duplicate: `CARBS_OPTIMUM_BOUNDS` ([30, 120] g/h), `CARBS_DISCRIMINATION_MARGIN` (10 g/h), `CARBS_MIN_DURATION_SEC` (90 min), the existing confidence-tier function shape (`nGood<5 or nBad<3 → low`, `nGood<10 → medium`, else `high`), and `HARD_TYPES` (`lib/nutrition.ts` — must be exported, currently module-local).
- `lib/nutrition.ts` must never import `lib/calibration.ts` (or vice versa in the wiring direction that would cycle) — the resolved override is always a plain `number | null` parameter, resolved by the route layer.
- Ride classification reuses `RideScoreEntry.inferredType` (`data/score-log.json`) unchanged — no new inference logic. `legacy`/`compromised` entries are excluded, matching every existing consumer of this ledger.

---

### Task 1: `deriveHardCarbsOptimum` in `lib/calibration.ts`

**Files:**
- Modify: `lib/types.ts` (add `hardCarbsOptimum?: CalibratedParameter;` to `CalibrationStore`, right after the existing `carbsOptimum?: CalibratedParameter;` line — confirm its exact location with `grep -n "carbsOptimum?:" lib/types.ts` first)
- Modify: `lib/nutrition.ts` (export `HARD_TYPES` — currently `const HARD_TYPES: ReadonlySet<WorkoutType> = new Set(["Threshold", "VO2max", "SIT", "RaceSim"]);` around line 226; change to `export const HARD_TYPES`)
- Modify: `lib/calibration.ts` (add the new spec + derive function, after the existing `deriveCarbsOptimum` function — confirm with `grep -n "^export function deriveCarbsOptimum" lib/calibration.ts`)
- Test: `lib/calibration.test.ts`

**Interfaces:**
- Consumes: `OptimumObservation`/`OptimumSpec`/`deriveOptimum` (existing, `lib/correlation.ts`), `CalibratedParameter` (existing, `lib/types.ts`), `CARBS_OPTIMUM_BOUNDS`/`CARBS_DISCRIMINATION_MARGIN` (existing, `lib/calibration.ts`)
- Produces: `export interface HardCarbsRideSignal { carbsIngestedG: number | null; executionScore: number | null; movingTimeSec: number }`, `export const DEFAULT_HARD_CARBS_OPTIMUM = 105`, `export function deriveHardCarbsOptimum(prior: CalibratedParameter | undefined | null, rides: HardCarbsRideSignal[]): CalibratedParameter` — consumed by Task 2 (route wiring) and Task 6 (UI)

- [ ] **Step 1: Write the failing tests**

Add to `lib/calibration.test.ts`, after the existing `describe("deriveCarbsOptimum"...)` block. First add `deriveHardCarbsOptimum` to the file's existing `import { ... } from "./calibration";` block:

```ts
// A hard-session ride: `hours` long, with the given executionScore (1-10) and logged grams (null =
// not logged). Mirrors the existing `steady()` helper's shape for the Z2 bucket.
const hardRide = (executionScore: number | null, carbsG: number | null, hours = 1.5) => ({
  carbsIngestedG: carbsG,
  executionScore,
  movingTimeSec: hours * 3600,
});

describe("deriveHardCarbsOptimum", () => {
  it("derives the good-rides' median g/h when fueling discriminates", () => {
    const rides = [
      // good: executionScore >= 7, well-fueled
      hardRide(8, 160), // 106.7 g/h
      hardRide(7, 150), // 100 g/h
      hardRide(9, 165), // 110 g/h
      hardRide(7, 150), // 100 g/h
      hardRide(8, 160), // 106.7 g/h
      // bad: executionScore < 5, under-fueled
      hardRide(3, 60), // 40 g/h
      hardRide(4, 75), // 50 g/h
      hardRide(2, 45), // 30 g/h
    ];
    const p = deriveHardCarbsOptimum(null, rides);
    expect(p.source).toBe("derived");
    expect(p.value).toBe(106.7); // median of [106.7, 100, 110, 100, 106.7]
    expect(p.dataPoints).toBe(5);
    expect(p.confidence).toBe("medium"); // 5 good / 3 bad — at the gate
  });

  it("excludes deadband rides (executionScore 5 or 6) from both classes", () => {
    const rides = [
      hardRide(7, 150), hardRide(7, 150), hardRide(7, 150), hardRide(7, 150), hardRide(7, 150), // 5 good
      hardRide(6, 999999 / 3600), // deadband — must not pollute either class
      hardRide(4, 60), hardRide(4, 60), hardRide(4, 60), // 3 bad
    ];
    const p = deriveHardCarbsOptimum(null, rides);
    expect(p.value).toBe(100); // unchanged by the deadband ride
  });

  it("skips rides with no logged carbs, no execution score, or under 90 minutes", () => {
    const rides = [
      hardRide(8, null), // no fueling logged
      hardRide(null, 160), // no execution score (shouldn't happen on a real ledger entry, defend anyway)
      hardRide(8, 160, 1), // 60-min ride — fueling not load-bearing
      hardRide(4, 60), // the only classifiable ride (bad)
    ];
    const p = deriveHardCarbsOptimum(null, rides);
    expect(p.source).toBe("default"); // no goods at all → blank
  });

  it("clamps to CARBS_OPTIMUM_BOUNDS", () => {
    const rides = [
      hardRide(8, 250), hardRide(9, 260), hardRide(7, 255), hardRide(8, 250), hardRide(9, 260), // ~166-173 g/h good
      hardRide(3, 30), hardRide(4, 35), hardRide(2, 25), // bad
    ];
    const p = deriveHardCarbsOptimum(null, rides);
    expect(p.value).toBe(120); // CARBS_OPTIMUM_BOUNDS.max
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/calibration.test.ts -t "deriveHardCarbsOptimum"`
Expected: FAIL — `deriveHardCarbsOptimum` is not exported from `./calibration`.

- [ ] **Step 3: Write the minimal implementation**

In `lib/types.ts`, find `carbsOptimum?: CalibratedParameter;` inside `CalibrationStore` and add immediately after it:

```ts
  // Second, parallel optimum for hard/interval sessions — carbsOptimum's pool (isSteadyEnduranceRide)
  // and outcome signal (aerobicEffPct) structurally exclude hard rides, so this is classified by
  // executionScore instead. Additive: no migration, same optional-field convention carbsOptimum itself
  // established when it was added.
  hardCarbsOptimum?: CalibratedParameter;
```

In `lib/nutrition.ts`, change:
```ts
const HARD_TYPES: ReadonlySet<WorkoutType> = new Set(["Threshold", "VO2max", "SIT", "RaceSim"]);
```
to:
```ts
export const HARD_TYPES: ReadonlySet<WorkoutType> = new Set(["Threshold", "VO2max", "SIT", "RaceSim"]);
```

In `lib/calibration.ts`, immediately after the existing `deriveCarbsOptimum` function:

```ts
// ---------- Hard-session in-ride carbs optimum ----------
// carbsOptimum's pool (isSteadyEnduranceRide) and outcome signal (aerobicEffPct, which needs ≥15 min of
// genuine Z2 samples) structurally exclude hard/interval rides — a Threshold/VO2max/SIT/RaceSim session
// has no meaningful aerobic-efficiency read on its own hard efforts. This is the same OptimumSpec shape,
// classified by executionScore instead (already computed, already trusted — workout-library's evidence
// promotion already keys off it). Good/bad boundaries reuse executionScoreLabel's own bands (lib/
// execution-score.ts): >=7 "Good", <5 "Below target"/"Poor", [5,7) a deadband excluded from both classes.

// Identical to inRideCarbTarget's current hard/>90min tier (lib/nutrition.ts) — an athlete with no
// confident calibration yet sees no change from today's behavior.
export const DEFAULT_HARD_CARBS_OPTIMUM = 105;

const HARD_CARBS_OPTIMUM_SPEC: OptimumSpec = {
  badSide: "lower", // under-fueling is still the credited failure mode
  discriminationMargin: CARBS_DISCRIMINATION_MARGIN,
  clampTo: [CARBS_OPTIMUM_BOUNDS.min, CARBS_OPTIMUM_BOUNDS.max],
  confidence: (nGood, nBad) => (nGood < 5 || nBad < 3 ? "low" : nGood < 10 ? "medium" : "high"),
};

export interface HardCarbsRideSignal {
  carbsIngestedG: number | null;
  executionScore: number | null;
  movingTimeSec: number;
}

export function deriveHardCarbsOptimum(
  prior: CalibratedParameter | undefined | null,
  rides: HardCarbsRideSignal[]
): CalibratedParameter {
  const obs = rides
    .filter(
      (r) =>
        r.movingTimeSec >= CARBS_MIN_DURATION_SEC &&
        typeof r.carbsIngestedG === "number" &&
        r.carbsIngestedG > 0 && // 0/null = not logged, same convention as deriveCarbsOptimum
        typeof r.executionScore === "number"
    )
    .filter((r) => (r.executionScore as number) >= 7 || (r.executionScore as number) < 5) // exclude the [5,7) deadband
    .map((r) => ({
      signal: Math.round(((r.carbsIngestedG as number) / (r.movingTimeSec / 3600)) * 10) / 10, // g/h
      good: (r.executionScore as number) >= 7,
    }));

  const derived = deriveOptimum(obs, HARD_CARBS_OPTIMUM_SPEC);
  const now = derived.lastUpdated;
  const manualOverride = prior?.manualOverride ?? null;
  if (derived.source === "default") {
    // Same gap semantics as deriveCarbsOptimum: a quiet window refreshes, it doesn't discard.
    if (prior?.source === "derived" && Number.isFinite(prior.value)) {
      return { ...prior, manualOverride, lastUpdated: now };
    }
    return { ...derived, manualOverride };
  }
  return { ...derived, manualOverride };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/calibration.test.ts -t "deriveHardCarbsOptimum"`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the whole calibration test file and full typecheck**

Run: `npx vitest run lib/calibration.test.ts && npx tsc --noEmit`
Expected: all pre-existing tests still pass (exporting `HARD_TYPES` and adding an optional field are additive), 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/nutrition.ts lib/calibration.ts lib/calibration.test.ts
git commit -m "feat(calibration): add hardCarbsOptimum, classified by executionScore

Second, parallel CalibratedParameter alongside the existing Z2/endurance
carbsOptimum -- that bucket's pool and outcome signal (aerobicEffPct)
structurally exclude hard/interval rides, so this uses executionScore
instead (already computed, already trusted). Same generic deriveOptimum
machinery, same confidence-tier shape, additive to CalibrationStore.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire the candidate pool into `POST /api/sync`

**Files:**
- Modify: `app/api/sync/route.ts` (the existing `updateCalibration` call inside the calibration block — find it with `grep -n "carbsOptimum: deriveCarbsOptimum" app/api/sync/route.ts`)
- Test: `app/api/sync/route.test.ts`

**Interfaces:**
- Consumes: `deriveHardCarbsOptimum`, `HardCarbsRideSignal` (Task 1, `@/lib/calibration`), `HARD_TYPES` (Task 1, `@/lib/nutrition`), `scoreLog.entries` and `lastSync.activities` (already in scope in this route)
- Produces: `calibration.hardCarbsOptimum` populated on every sync — consumed by Task 5 (generation wiring) and Task 6 (fuel prompt + UI)

- [ ] **Step 1: Write the failing test**

Find the existing test(s) in `app/api/sync/route.test.ts` asserting `carbsOptimum` is persisted after a sync (search for `carbsOptimum` or `deriveCarbsOptimum` in that file to find the mocked `scoreLog`/`activities` fixture pattern already in use). Add a sibling test in the same `describe` block:

```ts
it("persists hardCarbsOptimum from hard-type ledger entries", async () => {
  // Mirror whatever mocked readScoreLog/runFullSync fixture the existing carbsOptimum test in this
  // file uses, but with hard-type (Threshold/VO2max/SIT/RaceSim) entries instead of steady ones —
  // enough good (executionScore >= 7) and bad (< 5) rides to clear the confidence floor, each >= 90
  // min, each with carbsIngestedG logged on the matching activity by date.
  const hardEntries = [
    { date: "2026-06-01", executionScore: 8, inferredType: "Threshold", planned: true, plannedType: "Threshold", legacy: false, compromised: false, compliancePct: 100, intensityFactor: 0.95 },
    { date: "2026-06-03", executionScore: 7, inferredType: "SIT", planned: true, plannedType: "SIT", legacy: false, compromised: false, compliancePct: 100, intensityFactor: 0.7 },
    { date: "2026-06-05", executionScore: 9, inferredType: "VO2max", planned: true, plannedType: "VO2max", legacy: false, compromised: false, compliancePct: 100, intensityFactor: 1.1 },
    { date: "2026-06-07", executionScore: 8, inferredType: "Threshold", planned: true, plannedType: "Threshold", legacy: false, compromised: false, compliancePct: 100, intensityFactor: 0.95 },
    { date: "2026-06-09", executionScore: 7, inferredType: "SIT", planned: true, plannedType: "SIT", legacy: false, compromised: false, compliancePct: 100, intensityFactor: 0.7 },
    { date: "2026-06-11", executionScore: 3, inferredType: "Threshold", planned: true, plannedType: "Threshold", legacy: false, compromised: false, compliancePct: 40, intensityFactor: 0.95 },
    { date: "2026-06-13", executionScore: 4, inferredType: "Threshold", planned: true, plannedType: "Threshold", legacy: false, compromised: false, compliancePct: 50, intensityFactor: 0.95 },
    { date: "2026-06-15", executionScore: 2, inferredType: "Threshold", planned: true, plannedType: "Threshold", legacy: false, compromised: false, compliancePct: 30, intensityFactor: 0.95 },
  ];
  vi.mocked(store.readScoreLog).mockResolvedValue({ entries: hardEntries as never, updatedAt: "2026-01-01T00:00:00.000Z" });
  const hardActivities = hardEntries.map((e) => mkActivity({
    id: `hard-${e.date}`, date: e.date, movingTimeSec: 100 * 60, carbsIngestedG: e.executionScore >= 7 ? 175 : 65, // ~105/~39 g/h at 100 min
  }));
  vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: hardActivities }));

  await postSync();

  const cal = vi.mocked(store.updateCalibration).mock.calls[0][0](
    { decouplingGood: { value: 0, source: "default", confidence: "low", dataPoints: 0, lastUpdated: "", locked: false, manualOverride: null } } as never
  );
  expect(cal.hardCarbsOptimum?.source).toBe("derived");
  expect(cal.hardCarbsOptimum?.confidence).not.toBe("low");
});
```

If `store.readScoreLog` isn't already mocked/imported this way in the file, check how the existing `carbsOptimum`-adjacent tests read `scoreLog` (this route already reads it for other purposes — search `readScoreLog` in `app/api/sync/route.ts` to confirm the exact import name) and mirror that mock setup precisely rather than guessing a different shape.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/sync/route.test.ts -t "persists hardCarbsOptimum"`
Expected: FAIL — `cal.hardCarbsOptimum` is `undefined`.

- [ ] **Step 3: Write the minimal implementation**

In `app/api/sync/route.ts`:

1. Add `deriveHardCarbsOptimum` and `HardCarbsRideSignal` (as a type import) to the existing `@/lib/calibration` import, and `HARD_TYPES` to the existing `@/lib/nutrition` import (find both import lines with `grep -n 'from "@/lib/calibration"' -n 'from "@/lib/nutrition"' app/api/sync/route.ts` first — add to whichever exact lines exist, don't create new import statements for an already-imported module).

2. Find the `updateCalibration((priorCal) => ({ ... carbsOptimum: deriveCarbsOptimum(...), ... }))` call (search `carbsOptimum: deriveCarbsOptimum`). Immediately before that call, build the hard-ride candidate pool from the already-loaded `scoreLog` (this route already reads it — confirm the exact variable name with `grep -n "readScoreLog\|scoreLog\." app/api/sync/route.ts`) and `lastSync.activities`:

```ts
    // Track: hard-ride carbs optimum — same 90-day-ledger-lookback shape as steadyEndurance90d above,
    // but from scoreLog (inferredType already answers "planned or inferred, in-block or not" — see
    // docs/superpowers/specs/2026-08-06-hard-ride-carb-optimum-design.md), cross-referenced against
    // lastSync.activities by date for carbsIngestedG/movingTimeSec (the ledger entry itself carries
    // neither). Excludes legacy/compromised, matching every other consumer of this ledger.
    const activityByDate = new Map(lastSync.activities.map((a) => [a.date, a]));
    const hardRideSignals: HardCarbsRideSignal[] = scoreLog.entries
      .filter((e) => e.date >= cutoff90 && !e.legacy && !e.compromised && HARD_TYPES.has(e.inferredType))
      .map((e) => {
        const activity = activityByDate.get(e.date);
        return {
          carbsIngestedG: activity?.carbsIngestedG ?? null,
          executionScore: e.executionScore,
          movingTimeSec: activity?.movingTimeSec ?? 0,
        };
      });
```

(`cutoff90` already exists a few lines above this point in the same function, computed for `steadyEndurance90d` — reuse it verbatim, do not recompute a second 90-day cutoff.)

3. Add `hardCarbsOptimum: deriveHardCarbsOptimum(priorCal.hardCarbsOptimum, hardRideSignals),` as a new property inside the same `updateCalibration((priorCal) => ({ ... }))` object literal, alongside the existing `carbsOptimum: deriveCarbsOptimum(...)` line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/sync/route.test.ts`
Expected: PASS — the new test, and every pre-existing test in the file unchanged.

- [ ] **Step 5: Full check**

Run: `npm run check`
Expected: 0 type errors, 0 lint errors, all tests passing.

- [ ] **Step 6: Commit**

```bash
git add app/api/sync/route.ts app/api/sync/route.test.ts
git commit -m "feat(sync): build the hard-ride candidate pool from the score ledger

Cross-references scoreLog.entries' inferredType (already answers planned
vs off-plan, in-block vs not -- see the design doc) against
lastSync.activities by date for carbsIngestedG/movingTimeSec, same 90-day
window and legacy/compromised exclusion the existing carbsOptimum pool uses.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Optional override parameter through `lib/nutrition.ts`

**Files:**
- Modify: `lib/nutrition.ts` (`inRideCarbTarget`, `calculateDailyTarget`, `buildNutritionReferenceRows`)
- Test: `lib/nutrition.test.ts`

**Interfaces:**
- Consumes: nothing new (this task only adds an optional parameter to existing pure functions)
- Produces: `inRideCarbTarget(durationMin: number, type: WorkoutType, hardOverrideGPerH?: number | null): number`, `calculateDailyTarget(..., workout?: WorkoutContext, hardOverrideGPerH?: number | null): WorkoutNutritionPlan`, `buildNutritionReferenceRows(..., hardOverrideGPerH?: number | null): NutritionReferenceRow[]` — consumed by Task 4 (validator) and Task 5 (generate route)

- [ ] **Step 1: Write the failing tests**

Add to `lib/nutrition.test.ts`, find the existing `describe(...)` block covering `inRideCarbTarget` (search for `"inRideCarbTarget"` in the file) and add:

```ts
it("uses hardOverrideGPerH for the hard/>90min tier only, when provided", () => {
  expect(inRideCarbTarget(120, "Threshold", 95)).toBe(95);
  expect(inRideCarbTarget(120, "Threshold", null)).toBe(105); // null → population default, unchanged
  expect(inRideCarbTarget(120, "Threshold")).toBe(105); // omitted → byte-identical to today
});

it("ignores hardOverrideGPerH for every tier it doesn't apply to", () => {
  expect(inRideCarbTarget(60, "Threshold", 95)).toBe(0); // < 60 min still returns 0 regardless
  expect(inRideCarbTarget(75, "Threshold", 95)).toBe(75); // <=90min hard tier is untouched
  expect(inRideCarbTarget(120, "Z2", 95)).toBe(75); // easy >90min tier is untouched (carbsOptimum's job)
  expect(inRideCarbTarget(120, "Rest", 95)).toBe(0); // non-ride types untouched
});
```

Find the existing `describe("calculateDailyTarget"...)` or similar block and add:

```ts
it("threads hardOverrideGPerH through to the in-ride carb figure for a hard >90min session", () => {
  const model: NutritionModel = {
    kind: "derived", rmr: 1600, neatMultiplier: 1.3, restingKcalPerHour: 0,
    weightKg: 70, targetWeightKg: 70, buffer: 0,
  };
  const plan = calculateDailyTarget(500, model, 0, false, { type: "Threshold", durationMin: 120 }, 95);
  expect(plan.inRideCarbsPerHour).toBe(95);
  const planNoOverride = calculateDailyTarget(500, model, 0, false, { type: "Threshold", durationMin: 120 });
  expect(planNoOverride.inRideCarbsPerHour).toBe(105); // omitted → today's behavior, unchanged
});
```

Find the existing `describe("buildNutritionReferenceRows"...)` block and add:

```ts
it("threads hardOverrideGPerH to every hard->90min row, leaving every other row unchanged", () => {
  const withOverride = buildNutritionReferenceRows(profile, 70, "2026-07-01", 250, 0, 95);
  const withoutOverride = buildNutritionReferenceRows(profile, 70, "2026-07-01", 250, 0);
  const thresholdLong = withOverride.find((r) => r.type === "Threshold" && r.durationMin === 120)!;
  expect(thresholdLong.plan.inRideCarbsPerHour).toBe(95);
  // Every row of a type/duration the override doesn't apply to must be byte-identical either way.
  for (let i = 0; i < withOverride.length; i++) {
    if (withOverride[i].type === "Threshold" && withOverride[i].durationMin === 120) continue;
    expect(withOverride[i].plan.inRideCarbsPerHour).toBe(withoutOverride[i].plan.inRideCarbsPerHour);
  }
});
```

(Use whatever `profile` fixture the existing `buildNutritionReferenceRows` tests in this file already construct — search for the describe block's own setup rather than inventing a new one; the exact fixture values don't matter here, only that the two calls share the identical fixture so the "everything else unchanged" comparison is meaningful.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/nutrition.test.ts -t "hardOverrideGPerH"`
Expected: FAIL — `inRideCarbTarget` doesn't accept a third argument (TypeScript error caught by vitest's esbuild transform, or a runtime pass-through with no effect — either way the assertions expecting 95 will fail).

- [ ] **Step 3: Write the minimal implementation**

In `lib/nutrition.ts`:

```ts
export function inRideCarbTarget(durationMin: number, type: WorkoutType, hardOverrideGPerH?: number | null): number {
  if (NON_RIDE_TYPES.has(type) || durationMin < 60) return 0;
  const hard = HARD_TYPES.has(type);
  if (durationMin <= 90) return hard ? 75 : 38; // 60–90 g/hr vs 30–45 g/hr
  if (hard && hardOverrideGPerH != null) return hardOverrideGPerH; // hard-ride carb optimum (calibrated)
  return hard ? 105 : 75; // >90 min: 90–120 g/hr vs 60–90 g/hr
}
```

Find `calculateDailyTarget`'s signature and its internal `carbs` object (search `inRideCarbsPerHour: workout ? inRideCarbTarget`):

```ts
export function calculateDailyTarget(
  activeBurnKcal: number,
  model: NutritionModel,
  bufferApplied: number,
  isRestDay: boolean,
  workout?: WorkoutContext,
  hardOverrideGPerH?: number | null
): WorkoutNutritionPlan {
  const carbs = {
    preRideCarbs: workout ? preRideCarbTarget(workout.durationMin, workout.type, model.weightKg) : 0,
    inRideCarbsPerHour: workout ? inRideCarbTarget(workout.durationMin, workout.type, hardOverrideGPerH) : 0,
  };
```

(Leave the rest of the function body untouched — only the signature and the `carbs.inRideCarbsPerHour` line change.)

Find `buildNutritionReferenceRows`'s signature and its `calculateDailyTarget` call:

```ts
export function buildNutritionReferenceRows(
  profile: AthleteProfile,
  latestWeightKg: number,
  today: string,
  ftp: number,
  bufferApplied: number,
  hardOverrideGPerH?: number | null
): NutritionReferenceRow[] {
  const rows: NutritionReferenceRow[] = [];
  for (const [type, durations] of Object.entries(REFERENCE_DURATIONS) as [WorkoutType, number[]][]) {
    const isRestDayToday = type === "Rest";
    const model = resolveNutritionModel(profile, latestWeightKg, today, isRestDayToday);
    for (const durationMin of durations) {
      const estBurnKcal = estimateWorkoutBurnKcal(type, durationMin, ftp);
      rows.push({
        type,
        durationMin,
        estBurnKcal,
        plan: calculateDailyTarget(estBurnKcal, model, bufferApplied, isRestDayToday, {
          type,
          durationMin,
        }, hardOverrideGPerH),
      });
    }
  }
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/nutrition.test.ts`
Expected: PASS — all new tests, and every pre-existing test in the file unchanged (the new parameters are optional and default to the exact prior behavior when omitted).

- [ ] **Step 5: Full check**

Run: `npm run check`
Expected: 0 type errors (check every OTHER caller of `calculateDailyTarget`/`buildNutritionReferenceRows`/`inRideCarbTarget` in the repo still compiles with the extra trailing optional parameter — it should, since none of them pass a 6th/3rd argument today), 0 lint errors, all tests passing.

- [ ] **Step 6: Commit**

```bash
git add lib/nutrition.ts lib/nutrition.test.ts
git commit -m "feat(nutrition): thread an optional hard-ride carb override through the formula

inRideCarbTarget/calculateDailyTarget/buildNutritionReferenceRows each gain
one optional trailing parameter, used only for the hard+>90min tier.
Omitted or null reproduces today's flat 105 g/hr exactly -- every other
(type, duration) combination is unaffected. lib/nutrition.ts stays
calibration-agnostic; the caller resolves the actual override value.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Thread the override through `lib/nutrition-validate.ts`

**Files:**
- Modify: `lib/nutrition-validate.ts` (`checkInRideCarbs`, `validateNutrition`, `repairNutrition`)
- Test: `lib/nutrition-validate.test.ts`

**Interfaces:**
- Consumes: `inRideCarbTarget`'s new optional parameter (Task 3)
- Produces: `validateNutrition(days, modelOrResolver, ftp, bufferApplied, hardOverrideGPerH?: number | null): string[]`, `repairNutrition(days, modelOrResolver, ftp, bufferApplied, hardOverrideGPerH?: number | null): NutritionRepairResult` — consumed by Task 5 (generate route)

**Why this task exists as its own gate, not folded into Task 3:** the day-type NEAT work already shipped a bug shaped exactly like the one this task exists to prevent — a reference table resolving a per-row value one way while a validator independently recomputed a different "expected" value for the same row. This task's tests exist specifically to prove `buildNutritionReferenceRows` and `checkInRideCarbs` can never disagree once both receive the same override.

- [ ] **Step 1: Write the failing tests**

Add to `lib/nutrition-validate.test.ts`. Find the existing tests covering `checkInRideCarbs`'s behavior via `validateNutrition`/`repairNutrition` (search `"in-ride carbs"` or `parseInRideCarbsGPerHour` in the file) and add, in the same file, a new block:

```ts
describe("hard-ride carb override (review, dual carb optimum)", () => {
  const hardDay: PlannedDay = {
    date: "2026-06-01", type: "Threshold", durationMin: 120,
    description: "Pre-ride: 105g\nIn-ride: 95g/hr\nDaily intake: 3200 kcal",
  } as unknown as PlannedDay;
  const model: NutritionModel = {
    kind: "derived", rmr: 1600, neatMultiplier: 1.3, restingKcalPerHour: 0,
    weightKg: 70, targetWeightKg: 70, buffer: 0,
  };
  // 1.3*1600 = 2080; estimateWorkoutBurnKcal for a 120min Threshold session at some ftp — the exact
  // kcal figure isn't the point of this test, so bufferApplied/ftp are chosen so the kcal line matches
  // and only the carbs line is under test. Use the SAME ftp/buffer in every call in this block.
  const FTP = 250;

  it("a correctly-copied override figure is NOT flagged when the caller passes the same override", () => {
    const warnings = validateNutrition([hardDay], model, FTP, 0, 95);
    expect(warnings.some((w) => /in-ride carbs/.test(w))).toBe(false);
  });

  it("the SAME figure IS flagged when the caller omits the override (proves the two paths share one source)", () => {
    const warnings = validateNutrition([hardDay], model, FTP, 0); // no override → expects 105, not 95
    expect(warnings.some((w) => /in-ride carbs/.test(w) && /95/.test(w) && /105/.test(w))).toBe(true);
  });

  it("repairNutrition corrects toward whatever override IT was given, matching a reference table built with the same override", () => {
    const { days } = repairNutrition([hardDay], model, FTP, 0, 95);
    expect(days[0].description).toContain("In-ride: 95g/hr");
    const { days: daysNoOverride } = repairNutrition([hardDay], model, FTP, 0);
    expect(daysNoOverride[0].description).toContain("In-ride: 105g/hr");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/nutrition-validate.test.ts -t "hard-ride carb override"`
Expected: FAIL — `validateNutrition`/`repairNutrition` don't accept a 5th argument yet, so every call behaves as if the override were absent; the first test (expecting no flag with override=95) fails because the code still checks against the population default 105 while the description says 95.

- [ ] **Step 3: Write the minimal implementation**

In `lib/nutrition-validate.ts`:

```ts
function checkInRideCarbs(d: PlannedDay, hardOverrideGPerH?: number | null): DailyIntakeCheck | null {
  const stated = parseInRideCarbsGPerHour(d.description);
  if (stated === null) return null;
  const expected = inRideCarbTarget(d.durationMin, d.type, hardOverrideGPerH);
  const tolerance = carbTolerance(expected);
  return { stated, expected, withinTolerance: Math.abs(stated - expected) <= tolerance };
}

export function validateNutrition(
  days: PlannedDay[],
  modelOrResolver: ModelOrResolver,
  ftp: number,
  bufferApplied: number,
  hardOverrideGPerH?: number | null
): string[] {
  const warnings: string[] = [];
  for (const d of days) {
    const check = checkDailyIntake(d, modelOrResolver, ftp, bufferApplied);
    if (check && !check.withinTolerance) {
      const tolerance = toleranceBand(check.expected, 0.18, 300);
      warnings.push(
        `${d.date} (${d.type}): stated daily intake ${check.stated} kcal differs from the computed ${check.expected} kcal (tolerance ±${Math.round(tolerance)}) — verify it was copied from the reference table, not invented.`
      );
    }
    const preRide = checkPreRideCarbs(d, modelOrResolver);
    if (preRide && !preRide.withinTolerance) {
      const tolerance = carbTolerance(preRide.expected);
      warnings.push(
        `${d.date} (${d.type}): stated pre-ride carbs ${preRide.stated}g differs from the computed ${preRide.expected}g (tolerance ±${Math.round(tolerance)}) — verify it was copied from the reference table, not invented.`
      );
    }
    const inRide = checkInRideCarbs(d, hardOverrideGPerH);
    if (inRide && !inRide.withinTolerance) {
      const tolerance = carbTolerance(inRide.expected);
      warnings.push(
        `${d.date} (${d.type}): stated in-ride carbs ${inRide.stated}g/hr differs from the computed ${inRide.expected}g/hr (tolerance ±${Math.round(tolerance)}) — verify it was copied from the reference table, not invented.`
      );
    }
  }
  return warnings;
}
```

(`checkDailyIntake`/`checkPreRideCarbs`/`parseDailyIntakeKcal`/`toleranceBand`/`carbTolerance` are all untouched — only `checkInRideCarbs`'s signature and its one call site inside `validateNutrition` change.)

```ts
export function repairNutrition(
  days: PlannedDay[],
  modelOrResolver: ModelOrResolver,
  ftp: number,
  bufferApplied: number,
  hardOverrideGPerH?: number | null
): NutritionRepairResult {
  const repairs: string[] = [];
  const repairedDays = days.map((d) => {
    let description = d.description;
    let changed = false;

    const kcalCheck = checkDailyIntake(d, modelOrResolver, ftp, bufferApplied);
    if (kcalCheck && !kcalCheck.withinTolerance) {
      repairs.push(`${d.date} (${d.type}): auto-corrected daily intake ${kcalCheck.stated} kcal → ${kcalCheck.expected} kcal (didn't match the reference table).`);
      description = replaceDailyIntakeKcal(description, kcalCheck.expected);
      changed = true;
    }

    const preRideCheck = checkPreRideCarbs(d, modelOrResolver);
    if (preRideCheck && !preRideCheck.withinTolerance) {
      repairs.push(`${d.date} (${d.type}): auto-corrected pre-ride carbs ${preRideCheck.stated}g → ${preRideCheck.expected}g (didn't match the reference table).`);
      description = replacePreRideCarbsG(description, preRideCheck.expected);
      changed = true;
    }

    const inRideCheck = checkInRideCarbs(d, hardOverrideGPerH);
    if (inRideCheck && !inRideCheck.withinTolerance) {
      repairs.push(`${d.date} (${d.type}): auto-corrected in-ride carbs ${inRideCheck.stated}g/hr → ${inRideCheck.expected}g/hr (didn't match the reference table).`);
      description = replaceInRideCarbsGPerHour(description, inRideCheck.expected);
      changed = true;
    }

    return changed ? { ...d, description } : d;
  });
  return { days: repairedDays, repairs };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/nutrition-validate.test.ts`
Expected: PASS — all new tests, and every pre-existing test in the file unchanged (5th argument is optional; every existing call site omits it and gets today's exact behavior).

- [ ] **Step 5: Full check**

Run: `npm run check`
Expected: 0 type errors, 0 lint errors, all tests passing.

- [ ] **Step 6: Commit**

```bash
git add lib/nutrition-validate.ts lib/nutrition-validate.test.ts
git commit -m "feat(nutrition-validate): thread the hard-ride carb override into the validator

checkInRideCarbs/validateNutrition/repairNutrition gain the same optional
override validateNutrition's callers will pass to buildNutritionReferenceRows
-- the exact single-source-of-truth pairing bufferApplied already has,
preventing the reference-table/validator divergence class the day-type NEAT
work hit once.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Resolve and thread the override in `app/api/generate/route.ts`

**Files:**
- Modify: `app/api/generate/route.ts`
- Test: `app/api/generate/route.test.ts`

**Interfaces:**
- Consumes: `resolveCalibratedValue` (existing, `@/lib/calibration`), `readCalibration` (existing, `@/lib/data-store`), `DEFAULT_HARD_CARBS_OPTIMUM` (Task 1), `buildNutritionReferenceRows`/`repairNutrition`'s new optional parameters (Tasks 3–4)
- Produces: the fully wired hard-ride carb override, resolved exactly once per request and shared by both the reference table and the validator

- [ ] **Step 1: Write the failing test**

Find an existing test in `app/api/generate/route.test.ts` that asserts something about the generated nutrition table's in-ride carb figure for a hard, >90-minute session (search `"In-ride"` or `inRideCarbTarget`/`105` in the file to find the pattern and its mocked-profile/mocked-calibration setup, if any calibration mocking already exists there — if `readCalibration`/`store.readCalibration` isn't mocked anywhere in this file yet, check how `app/api/sync/route.test.ts` mocks it and mirror that exact pattern here). Add:

```ts
it("substitutes the calibrated hard-ride carb optimum into the nutrition table once it's trusted", async () => {
  vi.mocked(store.readCalibration).mockResolvedValue({
    decouplingGood: { value: 0, source: "default", confidence: "low", dataPoints: 0, lastUpdated: "", locked: false, manualOverride: null },
    hardCarbsOptimum: { value: 95, source: "derived", confidence: "high", dataPoints: 10, lastUpdated: "2026-06-01T00:00:00.000Z", locked: false, manualOverride: null },
    updatedAt: "2026-06-01T00:00:00.000Z",
  } as never);
  // (reuse whatever mocked profile/block-params fixture an existing generate test in this file uses)
  const res = await postGenerate(/* existing helper + fixture, whatever this file's own convention is */);
  const json = await res.json();
  expect(json.nutritionTableMarkdown ?? "").toContain("95"); // adapt the exact response field name to what this route actually returns — check with `grep -n "nutritionTable" app/api/generate/route.ts`
});

it("falls back to the population default (105) when hardCarbsOptimum isn't confident yet", async () => {
  vi.mocked(store.readCalibration).mockResolvedValue({
    decouplingGood: { value: 0, source: "default", confidence: "low", dataPoints: 0, lastUpdated: "", locked: false, manualOverride: null },
    hardCarbsOptimum: { value: 95, source: "derived", confidence: "low", dataPoints: 2, lastUpdated: "2026-06-01T00:00:00.000Z", locked: false, manualOverride: null },
    updatedAt: "2026-06-01T00:00:00.000Z",
  } as never);
  const res = await postGenerate(/* same fixture as above */);
  const json = await res.json();
  expect(json.nutritionTableMarkdown ?? "").not.toContain("95");
});
```

Adapt the exact assertion mechanics (`postGenerate`, the response field checked) to match this test file's own existing conventions — the implementer must read the file's existing generate-route tests first and follow their established mocking/assertion pattern rather than inventing a new one; the two scenarios above (confident override present vs. not confident) are the actual behavior under test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/generate/route.test.ts -t "hard-ride carb optimum"`
Expected: FAIL — the route doesn't read calibration at all yet, so both scenarios produce the same (population-default) output.

- [ ] **Step 3: Write the minimal implementation**

In `app/api/generate/route.ts`:

1. Add `readCalibration` to the existing `@/lib/data-store` import (find the exact line with `grep -n 'from "@/lib/data-store"' app/api/generate/route.ts` — it's a long combined import, add `readCalibration` to that list).
2. Add `resolveCalibratedValue` to the existing `@/lib/calibration` import (currently `import { resolveDurabilityInsertEnvelope, resolveTsbEdgesOverride } from "@/lib/calibration";`).
3. Add `DEFAULT_HARD_CARBS_OPTIMUM` to the same import.
4. Find where `bufferStatus` is computed (search `resolveBuffer(`) and add, immediately after it:

```ts
    // Track: the hard-ride carb optimum, resolved ONCE and shared by both the reference table and the
    // validator below — never two independent resolves (see docs/superpowers/specs/
    // 2026-08-06-hard-ride-carb-optimum-design.md for why that class of bug matters here specifically).
    const calibration = await readCalibration();
    const hardOverrideGPerH = resolveCalibratedValue(calibration.hardCarbsOptimum, DEFAULT_HARD_CARBS_OPTIMUM);
```

5. Find the `buildNutritionReferenceRows(profile, latestWeight, today, profile.performance.ftp, bufferStatus.bufferApplied)` call and add the new argument:

```ts
      buildNutritionReferenceRows(profile, latestWeight, today, profile.performance.ftp, bufferStatus.bufferApplied, hardOverrideGPerH)
```

6. Find the `repairNutrition(reconciledDays, nutritionModelFor, profile.performance.ftp, bufferStatus.bufferApplied)` call and add the same argument:

```ts
    const nutritionRepair = repairNutrition(reconciledDays, nutritionModelFor, profile.performance.ftp, bufferStatus.bufferApplied, hardOverrideGPerH);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/generate/route.test.ts`
Expected: PASS — the two new tests, and every pre-existing test in the file unchanged (a `readCalibration` mock returning a low-confidence or absent `hardCarbsOptimum` reproduces today's 105 exactly via `resolveCalibratedValue`'s existing fallback behavior).

- [ ] **Step 5: Full check**

Run: `npm run check`
Expected: 0 type errors, 0 lint errors, all tests passing.

- [ ] **Step 6: Commit**

```bash
git add app/api/generate/route.ts app/api/generate/route.test.ts
git commit -m "feat(generate): resolve the hard-ride carb optimum once, share it everywhere

readCalibration + resolveCalibratedValue(calibration.hardCarbsOptimum, 105)
computed once and passed to both buildNutritionReferenceRows and
repairNutrition -- identical to how bufferApplied is already resolved once
and shared between the same two call sites.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Post-ride fuel prompt + calibration UI

**Files:**
- Modify: `app/api/sync/route.ts` (the `deriveFuelPrompt` call site)
- Modify: `app/api/calibration/route.ts` (`PARAM_BOUNDS`)
- Modify: `components/CalibrationPanel.tsx` (`RowConfig["param"]`, `ROWS`)
- Test: `app/api/sync/route.test.ts`, `app/api/calibration/route.test.ts`

**Interfaces:**
- Consumes: `calibration.hardCarbsOptimum` (Task 2), `HARD_TYPES` (Task 1), `inferWorkoutType` (existing, `@/lib/ride-classify`), `resolveCarbsOptimumForPrompt` (existing, same file), `CARBS_OPTIMUM_BOUNDS`/`DEFAULT_HARD_CARBS_OPTIMUM` (Task 1)
- Produces: nothing further downstream — this is the last task

- [ ] **Step 1: Write the failing test (fuel prompt selection)**

In `app/api/sync/route.test.ts`, find the existing test(s) covering `deriveFuelPrompt`'s wiring for today's ride (search `fuelPrompt` in the file). Add a sibling test where today's completed ride is a hard/interval session and `calibration.hardCarbsOptimum` (not `carbsOptimum`) is the confident one:

```ts
it("compares a hard session's logged carbs against hardCarbsOptimum, not the Z2 optimum", async () => {
  // reuse this file's existing today-ride/fuelPrompt test fixture, but make today's activity a
  // Threshold-intensity, >=90min ride with carbsIngestedG logged well below a hard optimum of 95 g/hr
  // (e.g. 60g/hr) while calibration.carbsOptimum (Z2 bucket) sits confidently at a DIFFERENT value
  // (e.g. 70 g/hr) to prove the wrong bucket would NOT have flagged a gap.
  // ... (mirror the exact mock setup — mockResolvedValue on api.runFullSync with today's activity,
  // store.readCalibration or store.readCalibration equivalent already used by this file's existing
  // fuelPrompt tests) ...
  const res = await postSync();
  const json = await res.json();
  expect(json.todayAnalysis?.fuelPrompt?.kind).toBe("gap");
  expect(json.todayAnalysis?.fuelPrompt?.optimumGPerH).toBe(95); // the HARD optimum, not carbsOptimum's 70
});
```

Adapt the exact fixture construction to this file's own established `postSync`/mock conventions (the implementer must read the existing `fuelPrompt`-related tests in this file first, per Task 2's own note on this same pattern) — the assertion under test is that the hard optimum, not the Z2 one, drives the gap comparison for a hard ride.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/sync/route.test.ts -t "hardCarbsOptimum, not the Z2"`
Expected: FAIL — the route still always compares against `calibration.carbsOptimum` regardless of today's ride type.

- [ ] **Step 3: Write the minimal implementation**

In `app/api/sync/route.ts`:

1. Add `inferWorkoutType` to the existing `@/lib/ride-classify` import (or add a new `import { inferWorkoutType } from "@/lib/ride-classify";` line if that module isn't imported here yet — check with `grep -n "ride-classify" app/api/sync/route.ts` first).
2. Add `HARD_TYPES` to the existing `@/lib/nutrition` import.
3. Find the `const fuelPrompt = deriveFuelPrompt({ activity: todayActivity, plannedType: plannedDay?.type ?? null, carbsOptimum: resolveCarbsOptimumForPrompt(calibration.carbsOptimum) });` call and replace it:

```ts
          // Which optimum applies depends on today's ride's own type — same plannedType-or-inferred
          // resolution ride-analysis.ts's buildTodayAnalysis already does internally for scoring
          // (that internal value isn't exposed to this caller, so it's cheaper to recompute the same
          // small inference here than to widen that function's return shape for this one use).
          const todayIfBasis = todayActivity.normalizedPower ?? todayActivity.avgWatts;
          const todayIntensityFactor =
            todayIfBasis !== null && profile.performance.ftp > 0 ? todayIfBasis / profile.performance.ftp : null;
          const fuelRideType =
            plannedDay?.type ?? inferWorkoutType(todayIntensityFactor, Math.round(todayActivity.movingTimeSec / 60));
          const fuelPrompt = deriveFuelPrompt({
            activity: todayActivity,
            plannedType: plannedDay?.type ?? null,
            carbsOptimum: resolveCarbsOptimumForPrompt(
              HARD_TYPES.has(fuelRideType) ? calibration.hardCarbsOptimum : calibration.carbsOptimum
            ),
          });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/sync/route.test.ts`
Expected: PASS — the new test, and every pre-existing fuel-prompt test unchanged (a non-hard `fuelRideType` reproduces today's exact `calibration.carbsOptimum` lookup).

- [ ] **Step 5: Write the failing test (UI)**

In `app/api/calibration/route.test.ts`, find the existing test(s) covering the `PARAM_BOUNDS`/unknown-parameter rejection (search `"Unknown calibration parameter"` in the file) and add a sibling proving `hardCarbsOptimum` is now accepted:

```ts
it("accepts a manual override on hardCarbsOptimum", async () => {
  const res = await POST(new Request("http://localhost/api/calibration", {
    method: "POST",
    body: JSON.stringify({ param: "hardCarbsOptimum", manualOverride: 100 }),
  }));
  expect(res.status).toBe(200);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run app/api/calibration/route.test.ts -t "hardCarbsOptimum"`
Expected: FAIL — `PARAM_BOUNDS` doesn't have a `hardCarbsOptimum` key, so the route responds 400 "Unknown calibration parameter."

- [ ] **Step 7: Write the minimal implementation (UI)**

In `app/api/calibration/route.ts`:

```ts
import { CARBS_OPTIMUM_BOUNDS, DECOUPLING_GOOD_BOUNDS, defaultParameter } from "@/lib/calibration";
```
stays the same import list (`CARBS_OPTIMUM_BOUNDS` is reused verbatim — the hard bucket shares the same [30, 120] physiological bound). Change:
```ts
const PARAM_BOUNDS = {
  decouplingGood: DECOUPLING_GOOD_BOUNDS,
  carbsOptimum: CARBS_OPTIMUM_BOUNDS,
} as const;
```
to:
```ts
const PARAM_BOUNDS = {
  decouplingGood: DECOUPLING_GOOD_BOUNDS,
  carbsOptimum: CARBS_OPTIMUM_BOUNDS,
  hardCarbsOptimum: CARBS_OPTIMUM_BOUNDS,
} as const;
```

In `components/CalibrationPanel.tsx`:

```ts
import { CARBS_OPTIMUM_BOUNDS, DECOUPLING_GOOD_BOUNDS, DEFAULT_CARBS_OPTIMUM, DEFAULT_HARD_CARBS_OPTIMUM, resolveCalibratedValue } from "@/lib/calibration";
```

Change the `RowConfig` type and `ROWS` array:

```ts
interface RowConfig {
  param: "decouplingGood" | "carbsOptimum" | "hardCarbsOptimum";
  label: string;
  unit: string;
  bounds: { readonly min: number; readonly max: number };
  populationDefault: number;
  blurb: string;
}

const ROWS: RowConfig[] = [
  {
    param: "decouplingGood",
    label: "Durability reference (typical Pw:HR drift)",
    unit: "%",
    bounds: DECOUPLING_GOOD_BOUNDS,
    populationDefault: DEFAULT_DECOUPLING_GOOD,
    blurb:
      "Your typical Pw:HR drift on steady rides — the reference a long-ride durability read compares against. (No longer affects execution scoring.)",
  },
  {
    param: "carbsOptimum",
    label: "In-ride fueling optimum (long steady rides)",
    unit: " g/h",
    bounds: CARBS_OPTIMUM_BOUNDS,
    populationDefault: DEFAULT_CARBS_OPTIMUM,
    blurb:
      "The carb intake your best long steady rides carry, learned from rides where you logged fueling in Intervals.icu. Display + coach context — it doesn't change the fueling table yet.",
  },
  {
    param: "hardCarbsOptimum",
    label: "In-ride fueling optimum (hard sessions)",
    unit: " g/h",
    bounds: CARBS_OPTIMUM_BOUNDS,
    populationDefault: DEFAULT_HARD_CARBS_OPTIMUM,
    blurb:
      "The carb intake your best-executed Threshold/VO2max/SIT/RaceSim sessions carry, learned from your execution scores. Once confident, this replaces the population default in the fueling table for hard sessions over 90 minutes.",
  },
];
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run app/api/calibration/route.test.ts components/CalibrationPanel.test.tsx 2>/dev/null; npx vitest run app/api/calibration/route.test.ts`
Expected: PASS. (`CalibrationPanel.test.tsx` may not exist — if `find components -iname "*CalibrationPanel*test*"` returns nothing, skip that file; the generic `ROWS`-driven rendering doesn't need new component-level tests since `ParamCard` is already exercised by the existing rows and takes no `hardCarbsOptimum`-specific branching.)

- [ ] **Step 9: Full check**

Run: `npm run check`
Expected: 0 type errors, 0 lint errors, all tests passing.

- [ ] **Step 10: Commit**

```bash
git add app/api/sync/route.ts app/api/sync/route.test.ts app/api/calibration/route.ts app/api/calibration/route.test.ts components/CalibrationPanel.tsx
git commit -m "feat(calibration): wire hardCarbsOptimum into the fuel prompt and Model UI

deriveFuelPrompt's gap comparison now picks hardCarbsOptimum or carbsOptimum
based on today's ride's own plannedType-or-inferred type, mirroring the
day-type resolver pattern already used for NEAT. CalibrationPanel and the
manual-override route both already generalize over any CalibratedParameter
field -- this is additive rows/bounds, no new component code.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Purpose (new parallel calibrated parameter) → Task 1. Ride classification (`inferredType`, planned/inferred/off-block) → Task 2, reusing the existing field unchanged, no new task needed since the design doc's whole point is that nothing new is built here. New calibrated parameter shape/storage → Task 1. Wiring without reintroducing the validator-divergence bug → Tasks 3–5, with Task 4 existing specifically to prove that guarantee. Post-ride fuel prompt extension → Task 6. UI → Task 6. Verification (real-ledger sanity check) → covered by Task 2's test using the real 23-entry shape confirmed during design; the plan's Task 2 test fixture numbers are illustrative, but the implementer should also run the design doc's own real-data check (`data/score-log.json` + `data/last-sync.json`, read-only) once Task 2 lands, and report the actual resolved value/confidence — not scripted as a numbered step since it's a one-time sanity read, not a repeatable unit test, but should not be skipped before Task 2 is considered done.

**Placeholder scan:** No TBD/TODO. Every code step has complete, real code. Task 5 and Task 6's test steps ask the implementer to adapt exact mock mechanics to each file's own established convention rather than guessing a fixture shape blind — this is a deliberate exception (the plan author does not have those two test files' exact existing fixtures loaded), not a placeholder: the *behavior* under test is fully specified in prose and assertions, only the mechanical mock construction is left to match house style, exactly as the file's own recent history has done (e.g. Task 2's own test explicitly says "mirror whatever mocked fixture the existing carbsOptimum test uses").

**Type consistency:** `HardCarbsRideSignal { carbsIngestedG, executionScore, movingTimeSec }` (Task 1) is constructed identically in Task 2. `deriveHardCarbsOptimum(prior, rides)` (Task 1) is called with that exact shape in Task 2. `inRideCarbTarget(durationMin, type, hardOverrideGPerH?)` (Task 3) is called identically (same parameter name, same position) in Task 4's `checkInRideCarbs`. `hardOverrideGPerH: number | null` is the consistent parameter name and type from Task 3 through Task 5's `resolveCalibratedValue` call. `HARD_TYPES` (exported in Task 1) is imported and used identically in Task 2 and Task 6.
