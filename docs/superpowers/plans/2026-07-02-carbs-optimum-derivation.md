# Track C · Carbs-Optimum Derivation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the *optimum* shape to the shared correlation engine and bring in-ride carbs (g/h) under the per-athlete calibration framework — the first leg of ROADMAP Track C ("the engine's `deriveExecutionEdge` finds a *failure edge*; carbs needs an *optimum* — the g/h band tied to the best outcomes").

**Architecture:** `deriveOptimum` joins `deriveExecutionEdge` in `lib/correlation.ts` as a generic guarded derivation over `{signal, good}` observations: the median signal of the athlete's *successes*, credited only when failures exist to contrast against AND sit a margin away on the expected side (same "don't calibrate to habit" philosophy as the edge). The carbs consumer (`deriveCarbsOptimum` in `lib/calibration.ts`) classifies steady long endurance rides good/bad by their Pw:HR decoupling against the athlete's own already-calibrated `decouplingGood` reference — the two parameters compound — and stores the result as `carbsOptimum: CalibratedParameter` in the calibration store, re-derived each sync, manually overridable via the existing `/api/calibration` contest/correct route and `CalibrationPanel`.

**Tech Stack:** TypeScript 5, Vitest 4 (`npm test` = `vitest run`), Next.js 16 App Router. No new dependencies.

## Global Constraints

- **Provenance only, no behaviour change to coaching output:** the derived optimum is stored + displayed; it does NOT alter `inRideCarbTarget` or any fueling table (that's Track C's §6 surfacing layer, explicitly out of scope).
- **Population default = today's literal value:** `DEFAULT_CARBS_OPTIMUM = 75` g/h — `inRideCarbTarget`'s >90-min endurance target, matching the ride population the derivation is restricted to (per the #2 pattern: "default = today's literal value").
- **JSON migration-flag gotcha (AGENTS.md):** an on-disk `calibration.json` written before this ships parses back with `carbsOptimum` **undefined**, not null. The field is typed optional; every read site must tolerate `undefined` (`?? defaultParameter()` / `?? null`).
- **Immutable-ledger rule:** no changes to `RideScoreEntry` or scoring — the derivation reads `ActivitySummary` (last-sync), not the ledger.
- **Float-boundary fixtures:** don't pin expectations whose pre-rounding value sits on a `.x5` boundary.
- **Concurrent-agent rule:** stage only files this plan touches (`git add <path>...`, never `-A`). If check/lint fails in an untouched file, `git status --short <file>` first — uncommitted = other session's WIP; retry once after ~30s, then stop and report.
- Commits on `main`, small and per-task, message style `feat(scope): …` / `test(scope): …`, ending with the Claude co-author line.

## File Structure

- `lib/correlation.ts` — add `OptimumSpec`, `OptimumObservation`, `deriveOptimum` (the reusable shape; stays dependent on `./types` + `./stats` only).
- `lib/correlation.test.ts` — add a `deriveOptimum` describe block.
- `lib/calibration.ts` — add `CARBS_OPTIMUM_BOUNDS`, `DEFAULT_CARBS_OPTIMUM`, `deriveCarbsOptimum` (classification + prior-preservation, mirroring `deriveDecouplingGood`).
- `lib/calibration.test.ts` — add a `deriveCarbsOptimum` describe block.
- `lib/types.ts` — `CalibrationStore` gains optional `carbsOptimum?: CalibratedParameter`.
- `app/api/sync/route.ts` — derive + write `carbsOptimum` in the existing calibration block (~line 220), reusing the already-built `steadyDecoup` list.
- `app/api/sync/route.test.ts` — one wiring assertion: the written calibration carries `carbsOptimum`.
- `app/api/calibration/route.ts` — generalise the POST from a single hard-coded param to a param→bounds map (`decouplingGood`, `carbsOptimum`).
- `app/api/calibration/route.test.ts` — extend: carbs clamp, undefined-field (migration) case, decouplingGood regression.
- `components/CalibrationPanel.tsx` — refactor the single hard-coded row into a config-driven `ParamRow`; add the carbs row.
- `ROADMAP.md`, `ARCHIVE.md` — close the optimum-shape bullet (engine + first consumer), record the ship.

---

### Task 1: `deriveOptimum` — the optimum shape in the correlation engine

**Files:**
- Modify: `lib/correlation.ts` (append after `deriveExecutionEdge`)
- Test: `lib/correlation.test.ts` (append)

**Interfaces:**
- Consumes: existing `blank(dataPoints, now)` helper, `clamp`/`median` from `./stats`, `CalibratedParameter` from `./types`.
- Produces (Task 2 relies on these exact signatures):
  ```ts
  export interface OptimumObservation { signal: number; good: boolean }
  export interface OptimumSpec {
    badSide: "lower" | "higher";
    discriminationMargin: number;
    clampTo: readonly [min: number, max: number];
    confidence: (nGood: number, nBad: number) => CalibratedParameter["confidence"];
  }
  export function deriveOptimum(obs: OptimumObservation[], spec: OptimumSpec): CalibratedParameter
  ```

- [x] **Step 1: Write the failing tests**

Append to `lib/correlation.test.ts`:

```ts
import { deriveOptimum, type OptimumSpec } from "./correlation"; // merge into the existing import line

// Carbs-shaped spec: failures (bad outcomes) are expected at LOWER signal values (under-fueling).
const optimumSpec: OptimumSpec = {
  badSide: "lower",
  discriminationMargin: 10,
  clampTo: [30, 120],
  confidence: (nGood, nBad) => (nGood < 5 || nBad < 3 ? "low" : nGood < 10 ? "medium" : "high"),
};

const good = (signal: number) => ({ signal, good: true });
const bad = (signal: number) => ({ signal, good: false });

describe("deriveOptimum — guards", () => {
  it("returns a default-source blank with no observations", () => {
    const p = deriveOptimum([], optimumSpec);
    expect(p.source).toBe("default");
    expect(Number.isNaN(p.value)).toBe(true);
    expect(p.dataPoints).toBe(0);
  });

  it("returns blank when there are successes but no failures to contrast against", () => {
    // An athlete who always fuels ~75 and always succeeds: the optimum would be habit, not signal.
    const p = deriveOptimum([good(70), good(75), good(80), good(75), good(70)], optimumSpec);
    expect(p.source).toBe("default");
    expect(p.dataPoints).toBe(5); // honest about how many successes were seen
  });

  it("returns blank when the signal does not discriminate (bad median too close to good median)", () => {
    // goods ~75, bads ~70 → 70 is NOT ≤ 75 - margin(10)
    const p = deriveOptimum([good(70), good(75), good(80), bad(68), bad(72)], optimumSpec);
    expect(p.source).toBe("default");
  });

  it("returns blank when failures sit on the WRONG side (bad median above good median)", () => {
    // bads fueled MORE than goods — under-fueling isn't the driver here.
    const p = deriveOptimum([good(60), good(64), good(68), bad(90), bad(95)], optimumSpec);
    expect(p.source).toBe("default");
  });
});

describe("deriveOptimum — derivation", () => {
  it("derives the successes' median signal when the signal discriminates (badSide lower)", () => {
    const obs = [good(70), good(80), good(90), bad(30), bad(40), bad(50)]; // medGood 80, medBad 40
    const p = deriveOptimum(obs, optimumSpec);
    expect(p.source).toBe("derived");
    expect(p.value).toBe(80);
    expect(p.dataPoints).toBe(3); // the successes the value rests on
    expect(p.manualOverride).toBeNull();
    expect(p.locked).toBe(false);
  });

  it("clamps the derived value to the spec bounds", () => {
    const obs = [good(140), good(150), good(160), bad(60), bad(70), bad(80)];
    const p = deriveOptimum(obs, optimumSpec);
    expect(p.value).toBe(120); // clamped to max
  });

  it("supports badSide 'higher' (failures at higher signal values)", () => {
    const spec: OptimumSpec = { ...optimumSpec, badSide: "higher", clampTo: [0, 200] };
    const obs = [good(60), good(70), good(80), bad(95), bad(100), bad(105)]; // medBad 100 ≥ medGood 70 + 10
    const p = deriveOptimum(obs, spec);
    expect(p.source).toBe("derived");
    expect(p.value).toBe(70);
  });

  it("passes both class sizes to the confidence gate", () => {
    // 5 good / 3 bad → exactly at the medium gate of the spec above.
    const obs = [good(70), good(75), good(80), good(85), good(90), bad(30), bad(40), bad(50)];
    const p = deriveOptimum(obs, optimumSpec);
    expect(p.confidence).toBe("medium");
  });

  it("drops non-finite signals before classifying", () => {
    const obs = [good(70), good(80), good(90), { signal: NaN, good: true }, bad(30), bad(40), bad(50)];
    const p = deriveOptimum(obs, optimumSpec);
    expect(p.value).toBe(80); // NaN observation ignored
    expect(p.dataPoints).toBe(3);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run lib/correlation.test.ts`
Expected: FAIL — `deriveOptimum` is not exported.

- [x] **Step 3: Implement**

Append to `lib/correlation.ts`:

```ts
// ---------- The OPTIMUM shape (ROADMAP Track C) ----------
// deriveExecutionEdge finds where things BREAK (median of failures); deriveOptimum finds where things
// WORK (median of successes). Same honesty guards, mirrored: successes alone are habit, not signal —
// failures must exist to contrast against, and must sit a margin away on the expected side, or we stay
// on the population default. Generic over observations (not RideScoreEntry) because optimum consumers
// classify outcomes off different substrates (carbs classifies steady rides by decoupling, not by
// ledger executionScore).

export interface OptimumObservation {
  signal: number; // the stamped input being calibrated (e.g. carbs g/h)
  good: boolean; // outcome class, decided by the caller (e.g. decoupling ≤ the athlete's reference)
}

export interface OptimumSpec {
  // Which side of the optimum the BAD outcomes must sit for the signal to be credited as the driver:
  //   "lower"  → failures at LOWER signal values (under-fueling degrades late-ride durability)
  //   "higher" → failures at HIGHER signal values
  badSide: "lower" | "higher";
  discriminationMargin: number; // bad median must sit ≥ this many signal units away from the good median
  clampTo: readonly [min: number, max: number]; // sanity-bound the derived optimum
  confidence: (nGood: number, nBad: number) => CalibratedParameter["confidence"];
}

// Derive a per-athlete optimum from classified observations. Never throws; a non-discriminating or
// one-sided sample returns a default-source blank (dataPoints = successes seen) instead.
export function deriveOptimum(obs: OptimumObservation[], spec: OptimumSpec): CalibratedParameter {
  const now = new Date().toISOString();
  const finite = obs.filter((o) => Number.isFinite(o.signal));
  const good = finite.filter((o) => o.good).map((o) => o.signal);
  const bad = finite.filter((o) => !o.good).map((o) => o.signal);
  if (good.length === 0 || bad.length === 0) return blank(good.length, now);

  const medGood = median(good);
  const medBad = median(bad);
  const discriminates =
    spec.badSide === "lower" ? medBad <= medGood - spec.discriminationMargin : medBad >= medGood + spec.discriminationMargin;
  if (!discriminates) return blank(good.length, now);

  return {
    value: clamp(medGood, spec.clampTo[0], spec.clampTo[1]),
    source: "derived",
    confidence: spec.confidence(good.length, bad.length),
    dataPoints: good.length, // the successes the value rests on
    lastUpdated: now,
    locked: false, // keep re-deriving as the rolling window evolves
    manualOverride: null,
  };
}
```

- [x] **Step 4: Run to verify pass**

Run: `npx vitest run lib/correlation.test.ts`
Expected: PASS (existing edge tests + new optimum tests).

- [x] **Step 5: Commit**

```bash
git add lib/correlation.ts lib/correlation.test.ts
git commit -m "feat(correlation): deriveOptimum — the optimum shape beside the failure edge (Track C)"
```

---

### Task 2: `deriveCarbsOptimum` + store field

**Files:**
- Modify: `lib/calibration.ts` (append), `lib/types.ts` (CalibrationStore, ~line 659)
- Test: `lib/calibration.test.ts` (append)

**Interfaces:**
- Consumes: `deriveOptimum`, `OptimumSpec` from `./correlation` (Task 1); `defaultParameter()` already in `calibration.ts`; `ActivitySummary` fields `carbsIngestedG` / `decoupling` / `movingTimeSec`.
- Produces (Tasks 3–5 rely on these):
  ```ts
  export const CARBS_OPTIMUM_BOUNDS = { min: 30, max: 120 } as const;
  export const DEFAULT_CARBS_OPTIMUM = 75;
  export function deriveCarbsOptimum(
    prior: CalibratedParameter | undefined | null,
    steadyRides: Array<Pick<ActivitySummary, "carbsIngestedG" | "decoupling" | "movingTimeSec">>,
    decouplingGoodPct: number
  ): CalibratedParameter
  ```
  and in `lib/types.ts`: `CalibrationStore.carbsOptimum?: CalibratedParameter` (optional — migration).

- [x] **Step 1: Type first**

In `lib/types.ts`, change `CalibrationStore`:

```ts
export interface CalibrationStore {
  decouplingGood: CalibratedParameter;
  // Track C: in-ride carbs optimum (g/h) on steady long endurance rides. OPTIONAL — a calibration.json
  // written before this field existed parses back as undefined (not null); read sites must tolerate it.
  carbsOptimum?: CalibratedParameter;
  updatedAt: string;
}
```

- [x] **Step 2: Write the failing tests**

Append to `lib/calibration.test.ts` (check its existing imports; it already imports from `./calibration` — extend that import with `CARBS_OPTIMUM_BOUNDS, DEFAULT_CARBS_OPTIMUM, deriveCarbsOptimum`):

```ts
// ---------- deriveCarbsOptimum (Track C) ----------

// A steady ride: 2h at the given decoupling with the given logged grams (null = not logged).
const steady = (decoupling: number | null, carbsG: number | null, hours = 2) => ({
  carbsIngestedG: carbsG,
  decoupling,
  movingTimeSec: hours * 3600,
});

describe("deriveCarbsOptimum", () => {
  const DG = 4; // the resolved decouplingGood reference these tests classify against

  it("derives the good-rides' median g/h when fueling discriminates", () => {
    const rides = [
      // good: decoupling ≤ 4, well-fueled (g/h = grams / hours)
      steady(3, 160), // 80 g/h
      steady(3.5, 180), // 90 g/h
      steady(2.8, 140), // 70 g/h
      steady(3.9, 160), // 80 g/h
      steady(3.2, 180), // 90 g/h
      // bad: decoupling ≥ 6 (= DG + 2), under-fueled
      steady(7, 60), // 30 g/h
      steady(6.5, 80), // 40 g/h
      steady(8, 100), // 50 g/h
    ];
    const p = deriveCarbsOptimum(null, rides, DG);
    expect(p.source).toBe("derived");
    expect(p.value).toBe(80); // median of [80,90,70,80,90]
    expect(p.dataPoints).toBe(5);
    expect(p.confidence).toBe("medium"); // 5 good / 3 bad — at the gate
  });

  it("excludes deadband rides (between DG and DG+2) from both classes", () => {
    const rides = [
      steady(3, 160), steady(3, 180), steady(3, 140), steady(3, 160), steady(3, 180), // 5 good
      steady(5, 999999), // deadband — ambiguous, must not pollute either class
      steady(7, 60), steady(7, 80), steady(7, 100), // 3 bad
    ];
    const p = deriveCarbsOptimum(null, rides, DG);
    expect(p.value).toBe(80); // unchanged by the deadband ride
  });

  it("skips rides with no logged carbs, no decoupling, or under 90 minutes", () => {
    const rides = [
      steady(3, null), // no fueling logged
      steady(null, 160), // no decoupling
      steady(3, 160, 1), // 60-min ride — fueling not load-bearing
      steady(7, 60), // the only classifiable ride (bad)
    ];
    const p = deriveCarbsOptimum(null, rides, DG);
    expect(p.source).toBe("default"); // no goods at all → blank
  });

  it("returns default when fueling does not discriminate (bad rides fueled like good ones)", () => {
    const rides = [
      steady(3, 160), steady(3, 180), steady(3, 140), steady(3, 160), steady(3, 180), // goods ~80
      steady(7, 150), steady(7, 160), steady(7, 170), // bads ~80 too — drift isn't about carbs here
    ];
    const p = deriveCarbsOptimum(null, rides, DG);
    expect(p.source).toBe("default");
  });

  it("preserves a prior manual override through re-derivation", () => {
    const prior = { ...defaultParameter(), manualOverride: 95 };
    const p = deriveCarbsOptimum(prior, [], DG);
    expect(p.manualOverride).toBe(95);
  });

  it("carries a previously-derived value through a signal gap instead of snapping to default", () => {
    const prior: CalibratedParameter = {
      value: 85, source: "derived", confidence: "medium", dataPoints: 6,
      lastUpdated: "2026-01-01T00:00:00Z", locked: false, manualOverride: null,
    };
    const p = deriveCarbsOptimum(prior, [], DG); // window went quiet
    expect(p.source).toBe("derived");
    expect(p.value).toBe(85);
  });

  it("clamps the derived optimum into CARBS_OPTIMUM_BOUNDS", () => {
    const rides = [
      steady(3, 280), steady(3, 300), steady(3, 320), steady(3, 280), steady(3, 300), // 140–160 g/h
      steady(7, 60), steady(7, 80), steady(7, 100),
    ];
    const p = deriveCarbsOptimum(null, rides, DG);
    expect(p.value).toBe(CARBS_OPTIMUM_BOUNDS.max);
  });

  it("exposes the literal population default the derivation is benchmarked against", () => {
    expect(DEFAULT_CARBS_OPTIMUM).toBe(75); // inRideCarbTarget's >90-min endurance value
  });
});
```

Note: `defaultParameter` and `CalibratedParameter` may already be imported in this test file — merge, don't duplicate.

- [x] **Step 3: Run to verify failure**

Run: `npx vitest run lib/calibration.test.ts`
Expected: FAIL — `deriveCarbsOptimum` not exported.

- [x] **Step 4: Implement**

Append to `lib/calibration.ts` (and extend the top import from `./correlation` to `{ deriveExecutionEdge, deriveOptimum, type ExecutionEdgeSpec, type OptimumSpec }`; add `ActivitySummary` to the type import from `./types`):

```ts
// ---------- In-ride carbs optimum (ROADMAP Track C — first optimum-shape consumer) ----------
// The g/h band tied to the athlete's BEST long steady rides, classified against their OWN calibrated
// durability reference (decouplingGood) — the two parameters compound. Provenance + display only for
// now: it does NOT alter the fueling table (that's §6 surfacing). Classification is deliberately
// endurance-only: decoupling is meaningless on interval days, and fueling is load-bearing from ~90 min.

export const CARBS_OPTIMUM_BOUNDS = { min: 30, max: 120 } as const; // g/h — the KB's physiological range
// The literal in-ride target nutrition.ts prescribes for >90-min endurance rides today — the population
// default the derived optimum replaces only once it clears the confidence gate.
export const DEFAULT_CARBS_OPTIMUM = 75;

const CARBS_MIN_DURATION_SEC = 90 * 60; // fueling genuinely load-bearing (nutrition's >90-min tier)
const CARBS_BAD_DECOUPLING_DELTA = 2; // pp beyond the athlete's typical drift = clearly-poor durability
const CARBS_DISCRIMINATION_MARGIN = 10; // g/h — good rides must carry meaningfully more fuel than bad

const CARBS_OPTIMUM_SPEC: OptimumSpec = {
  badSide: "lower", // the credited failure mode is UNDER-fueling
  discriminationMargin: CARBS_DISCRIMINATION_MARGIN,
  clampTo: [CARBS_OPTIMUM_BOUNDS.min, CARBS_OPTIMUM_BOUNDS.max],
  // Mirrors qualityFailureConfidence's spirit: bad long rides are rare and informative; require real
  // contrast. resolveCalibratedValue applies medium+ → effective gate is ≥5 good AND ≥3 bad rides.
  confidence: (nGood, nBad) => (nGood < 5 || nBad < 3 ? "low" : nGood < 10 ? "medium" : "high"),
};

// `steadyRides` is the sync route's already-filtered steady-endurance set (decoupling present, 90-day
// window, isSteadyEnduranceRide) — reusing it keeps one definition of "steady" and avoids an import
// cycle with trends.ts. This adds only the fueling-specific gates.
export function deriveCarbsOptimum(
  prior: CalibratedParameter | undefined | null,
  steadyRides: Array<Pick<ActivitySummary, "carbsIngestedG" | "decoupling" | "movingTimeSec">>,
  decouplingGoodPct: number
): CalibratedParameter {
  const badAt = decouplingGoodPct + CARBS_BAD_DECOUPLING_DELTA;
  const obs = steadyRides
    .filter(
      (a) =>
        a.movingTimeSec >= CARBS_MIN_DURATION_SEC &&
        typeof a.carbsIngestedG === "number" &&
        a.carbsIngestedG > 0 && // 0/null = not logged, same convention as fuelStampFor
        typeof a.decoupling === "number" &&
        // Deadband: rides between "good" and "clearly bad" are ambiguous — keep them out of both classes.
        (a.decoupling <= decouplingGoodPct || a.decoupling >= badAt)
    )
    .map((a) => ({
      signal: Math.round(((a.carbsIngestedG as number) / (a.movingTimeSec / 3600)) * 10) / 10, // g/h, as fuelStampFor rounds
      good: (a.decoupling as number) <= decouplingGoodPct,
    }));

  const derived = deriveOptimum(obs, CARBS_OPTIMUM_SPEC);
  const now = derived.lastUpdated;
  const manualOverride = prior?.manualOverride ?? null;
  if (derived.source === "default") {
    // Same gap semantics as deriveDecouplingGood: a quiet window refreshes, it doesn't discard.
    if (prior?.source === "derived" && Number.isFinite(prior.value)) {
      return { ...prior, manualOverride, lastUpdated: now };
    }
    return { ...derived, manualOverride };
  }
  return { ...derived, manualOverride };
}
```

- [x] **Step 5: Run to verify pass**

Run: `npx vitest run lib/calibration.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [x] **Step 6: Commit**

```bash
git add lib/calibration.ts lib/calibration.test.ts lib/types.ts
git commit -m "feat(calibration): carbs g/h optimum — first consumer of the optimum shape (Track C)"
```

---

### Task 3: Sync wiring — derive `carbsOptimum` every sync

**Files:**
- Modify: `app/api/sync/route.ts` (~lines 49, 220–225)
- Test: `app/api/sync/route.test.ts` (read first; extend minimally)

**Interfaces:**
- Consumes: `deriveCarbsOptimum`, `resolveCalibratedValue` (both `@/lib/calibration`), `DEFAULT_DECOUPLING_GOOD` (`@/lib/execution-score`), and the route's existing `steadyDecoup` array + `priorCal`.
- Produces: `calibration.json` gains `carbsOptimum` on every POST sync (readCalibration → the store the panel + override route read).

- [x] **Step 1: Wire the derive**

In `app/api/sync/route.ts` line 49, extend the calibration import:

```ts
import { deriveCarbsOptimum, deriveDecouplingGood, deriveIfBandOffsets, resolveAcwrBands, resolveAthleteStateWeights, resolveCalibratedValue } from "@/lib/calibration";
```

Add (with the other lib imports): `import { DEFAULT_DECOUPLING_GOOD } from "@/lib/execution-score";`
(Check first — if the route already imports from `@/lib/execution-score`, merge into that line.)

Replace the calibration block (~lines 220–225):

```ts
    const priorCal = await readCalibration();
    const decouplingGood = deriveDecouplingGood(priorCal.decouplingGood, steadyDecoupMean, steadyDecoup.length);
    const calibration = {
      decouplingGood,
      // Track C: carbs optimum from the same steady-ride set, classified against the athlete's own
      // RESOLVED durability reference (calibrated when trusted, population default otherwise).
      carbsOptimum: deriveCarbsOptimum(
        priorCal.carbsOptimum,
        steadyDecoup,
        resolveCalibratedValue(decouplingGood, DEFAULT_DECOUPLING_GOOD)
      ),
      updatedAt: new Date().toISOString(),
    };
    await writeCalibration(calibration);
```

- [x] **Step 2: Extend the sync route test**

Read `app/api/sync/route.test.ts` first to see how POST fixtures mock activities + `writeCalibration`. Add ONE test to the existing POST describe block asserting the written calibration object has a `carbsOptimum` key (shape only — the derivation itself is fully unit-tested in Task 2):

```ts
it("writes a carbsOptimum calibration parameter on sync (Track C wiring)", async () => {
  // …use the suite's existing happy-path POST fixture…
  // after awaiting POST:
  const written = (store.writeCalibration as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
  expect(written.carbsOptimum).toBeDefined();
  expect(written.carbsOptimum.source).toBe("default"); // fixture rides carry no carbs_ingested
});
```

Adapt names to the suite's actual mock conventions — the assertion (carbsOptimum present on the written store) is the requirement, the code above is the shape.

- [x] **Step 3: Run**

Run: `npx vitest run app/api/sync/route.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [x] **Step 4: Commit**

```bash
git add app/api/sync/route.ts app/api/sync/route.test.ts
git commit -m "feat(sync): derive carbsOptimum each sync off the steady-ride set (Track C)"
```

---

### Task 4: Override route — generalise contest/correct to both parameters

**Files:**
- Modify: `app/api/calibration/route.ts`
- Test: `app/api/calibration/route.test.ts` (extend)

**Interfaces:**
- Consumes: `CARBS_OPTIMUM_BOUNDS`, `DECOUPLING_GOOD_BOUNDS`, `defaultParameter` from `@/lib/calibration`.
- Produces: `POST /api/calibration` accepts `{ param: "decouplingGood" | "carbsOptimum", manualOverride: number | null }`; unknown params still 400. (Task 5's panel posts exactly this.)

- [x] **Step 1: Write the failing tests**

Append to `app/api/calibration/route.test.ts` (inside the POST describe, after the existing tests):

```ts
  it("clamps a carbsOptimum manualOverride into its own bounds", async () => {
    const res = await post({ param: "carbsOptimum", manualOverride: 300 });
    const json = await res.json();
    expect(json.calibration.carbsOptimum.manualOverride).toBe(CARBS_OPTIMUM_BOUNDS.max);

    const res2 = await post({ param: "carbsOptimum", manualOverride: 5 });
    const json2 = await res2.json();
    expect(json2.calibration.carbsOptimum.manualOverride).toBe(CARBS_OPTIMUM_BOUNDS.min);
  });

  it("creates carbsOptimum from a blank when the stored file predates the field (migration)", async () => {
    // base() has no carbsOptimum — the pre-existing-file case (parses back undefined, not null).
    const res = await post({ param: "carbsOptimum", manualOverride: 90 });
    const json = await res.json();
    expect(json.calibration.carbsOptimum.manualOverride).toBe(90);
    expect(json.calibration.carbsOptimum.source).toBe("default"); // seeded from defaultParameter()
    expect(json.calibration.decouplingGood.value).toBe(4); // sibling untouched
  });

  it("clears a carbsOptimum override with null", async () => {
    const res = await post({ param: "carbsOptimum", manualOverride: null });
    const json = await res.json();
    expect(json.calibration.carbsOptimum.manualOverride).toBeNull();
  });
```

Extend the file's import from `@/lib/calibration` with `CARBS_OPTIMUM_BOUNDS`.

- [x] **Step 2: Run to verify failure**

Run: `npx vitest run app/api/calibration/route.test.ts`
Expected: FAIL — route 400s on `carbsOptimum` ("Unknown calibration parameter").

- [x] **Step 3: Implement**

Rewrite the POST in `app/api/calibration/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readCalibration, updateCalibration } from "@/lib/data-store";
import { CARBS_OPTIMUM_BOUNDS, DECOUPLING_GOOD_BOUNDS, defaultParameter } from "@/lib/calibration";
import { clamp } from "@/lib/stats";

// Contest/correct for the Model page (ROADMAP #2): set or clear a manual override on a calibrated
// scoring parameter. Each param's override is clamped into the same sane band its derivation uses, so
// a bad value can't distort what reads it. The next sync preserves overrides (each derive reads
// prior.manualOverride).

const PARAM_BOUNDS = {
  decouplingGood: DECOUPLING_GOOD_BOUNDS,
  carbsOptimum: CARBS_OPTIMUM_BOUNDS,
} as const;
type ParamName = keyof typeof PARAM_BOUNDS;

export async function GET() {
  return NextResponse.json({ calibration: await readCalibration() });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const param = b.param as ParamName;
  const bounds = typeof param === "string" ? PARAM_BOUNDS[param] : undefined;
  if (!bounds) {
    return NextResponse.json({ error: "Unknown calibration parameter." }, { status: 400 });
  }

  // null clears the override (revert to the learned/default value); a finite number sets it, clamped.
  const raw = b.manualOverride;
  let manualOverride: number | null;
  if (raw === null) {
    manualOverride = null;
  } else if (typeof raw === "number" && Number.isFinite(raw)) {
    manualOverride = clamp(raw, bounds.min, bounds.max);
  } else {
    return NextResponse.json({ error: "manualOverride must be a number or null." }, { status: 400 });
  }

  const calibration = await updateCalibration((cur) => ({
    ...cur,
    // A store written before the param existed parses back with the field undefined — seed a blank.
    [param]: { ...(cur[param] ?? defaultParameter()), manualOverride },
    updatedAt: new Date().toISOString(),
  }));

  return NextResponse.json({ calibration });
}
```

- [x] **Step 4: Run to verify pass**

Run: `npx vitest run app/api/calibration/route.test.ts && npx tsc --noEmit`
Expected: PASS (old decouplingGood tests + new carbs tests), tsc clean.

- [x] **Step 5: Commit**

```bash
git add app/api/calibration/route.ts app/api/calibration/route.test.ts
git commit -m "feat(calibration-route): param->bounds map; carbsOptimum contest/correct (Track C)"
```

---

### Task 5: CalibrationPanel — config-driven rows, carbs row added

**Files:**
- Modify: `components/CalibrationPanel.tsx`

**Interfaces:**
- Consumes: `POST /api/calibration` with `{ param, manualOverride }` (Task 4); `state.calibration.carbsOptimum` (optional — Task 2's migration note); `CARBS_OPTIMUM_BOUNDS`, `DEFAULT_CARBS_OPTIMUM`, `DECOUPLING_GOOD_BOUNDS`, `resolveCalibratedValue` from `@/lib/calibration`; `DEFAULT_DECOUPLING_GOOD` from `@/lib/execution-score`.
- Produces: two rows on `/model`, same contest/correct affordances each.

- [x] **Step 1: Refactor to a row config**

Replace the single hard-coded `<li>` with an internal `ParamRow` component + a `ROWS` config. Full component after the edit:

```tsx
"use client";

import { useState } from "react";
import { useSync } from "./SyncProvider";
import { Card } from "./ui";
import { api } from "@/lib/client-api";
import { CARBS_OPTIMUM_BOUNDS, DECOUPLING_GOOD_BOUNDS, DEFAULT_CARBS_OPTIMUM, resolveCalibratedValue } from "@/lib/calibration";
import { DEFAULT_DECOUPLING_GOOD } from "@/lib/execution-score";
import type { CalibratedParameter, CalibrationStore } from "@/lib/types";

// Per-athlete calibration (ROADMAP #2) — shows the effective value the app uses + its provenance,
// so the athlete sees what's been learned from their own data vs. the population default, AND can
// contest/correct it: a manual override is the escape hatch when the learned value is wrong. The next
// sync preserves overrides (each derive reads prior.manualOverride).

interface RowConfig {
  param: "decouplingGood" | "carbsOptimum";
  label: string;
  unit: string; // rendered after the value, e.g. "%" / " g/h"
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
];

function detail(p: CalibratedParameter | undefined, effective: number, noun: string): string {
  if (!p || p.source === "default") return "Population default — not enough of your data yet.";
  if (p.manualOverride != null) return "Manually set by you.";
  if (effective === p.value) return `Calibrated from your last ${p.dataPoints} ${noun} · ${p.confidence} confidence${p.locked ? " · locked" : ""}.`;
  return `Learning from ${p.dataPoints} ${noun} — using the default until there's enough to be confident.`;
}

function ParamRow({
  row,
  param,
  onSaved,
}: {
  row: RowConfig;
  param: CalibratedParameter | undefined;
  onSaved: (calibration: CalibrationStore) => void;
}) {
  const effective = resolveCalibratedValue(param ?? null, row.populationDefault);
  const overridden = param?.manualOverride != null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist a set (number) or clear (null) override, then lift the fresh store into shared state so
  // every surface that reads state.calibration reflects it without waiting for the next sync.
  const save = async (manualOverride: number | null) => {
    setSaving(true);
    setError(null);
    try {
      const { calibration } = await api<{ calibration: CalibrationStore }>("/api/calibration", {
        method: "POST",
        body: JSON.stringify({ param: row.param, manualOverride }),
      });
      onSaved(calibration);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = () => {
    setDraft(effective.toFixed(1));
    setError(null);
    setEditing(true);
  };

  const submit = () => {
    const v = parseFloat(draft);
    // Validate the range here (UI-2) — not just finiteness — so an out-of-range entry shows the error
    // instead of being silently clamped server-side to a value the athlete didn't type.
    if (!Number.isFinite(v) || v < row.bounds.min || v > row.bounds.max) {
      setError(`Enter a number between ${row.bounds.min} and ${row.bounds.max}.`);
      return;
    }
    void save(v);
  };

  return (
    <li className="border-t border-zinc-100 pt-3 first:border-t-0 first:pt-0 dark:border-zinc-700/60">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{row.label}</span>
        <span className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
          {effective.toFixed(1)}
          {row.unit}
          {overridden && (
            <span className="ml-1 align-middle text-[10px] font-normal uppercase tracking-wide text-zinc-500 dark:text-[#ff49c8]">set</span>
          )}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{row.blurb}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{detail(param, effective, "rides")}</p>

      {editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="number"
            step="0.1"
            min={row.bounds.min}
            max={row.bounds.max}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={`${row.label} override`}
            className="w-20 rounded border border-zinc-300 px-2 py-1 font-mono text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:border-zinc-400"
          />
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {row.unit.trim() || "%"} · {row.bounds.min}–{row.bounds.max}
          </span>
          <button
            onClick={submit}
            disabled={saving}
            className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:border-zinc-400 disabled:opacity-50 dark:border-[#00d4ff]/40 dark:text-[#00d4ff] dark:hover:bg-[#00d4ff]/10"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            className="text-[11px] text-zinc-500 dark:text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <button
            onClick={startEdit}
            className="text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-[#00d4ff]"
          >
            {overridden ? "Adjust" : "This looks wrong — set my own"}
          </button>
          {overridden && (
            <button
              onClick={() => void save(null)}
              disabled={saving}
              className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-600 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-300"
            >
              Use learned value
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </li>
  );
}

export default function CalibrationPanel() {
  const { state, setState } = useSync();
  const cal = state?.calibration ?? null;
  const onSaved = (calibration: CalibrationStore) => setState((s) => (s ? { ...s, calibration } : s));

  return (
    <Card title="Per-athlete calibration">
      <p className="-mt-1 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Scoring thresholds the app learns from your own data, with a population default until there&apos;s enough
        history. Updated on each sync — override one only if you know the learned value is wrong for you.
      </p>
      {!cal ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Sync to compute your calibration.</p>
      ) : (
        <ul className="space-y-3">
          {ROWS.map((row) => (
            <ParamRow key={row.param} row={row} param={cal[row.param]} onSaved={onSaved} />
          ))}
        </ul>
      )}
    </Card>
  );
}
```

- [x] **Step 2: Verify in the preview**

`npx tsc --noEmit`, then `preview_start` (config `nodevelo`), open `/model`, `preview_snapshot`: both rows render; the carbs row shows `75.0 g/h` + "Population default — not enough of your data yet." (the live store predates the field — the undefined-tolerance path exercised for real). `preview_console_logs` clean. Screenshot for the record. Stop the server.

- [x] **Step 3: Commit**

```bash
git add components/CalibrationPanel.tsx
git commit -m "feat(model-ui): carbs-optimum row on the calibration panel (Track C)"
```

---

### Task 6: Full verification + docs + push

**Files:**
- Modify: `ROADMAP.md` (Track C section), `ARCHIVE.md` (new entry at top)

- [x] **Step 1: Full check**

Run: `npm run check`
Expected: tsc clean; eslint 0 errors (1 pre-existing warning in `prototypes/` allowed); all suites pass (baseline 721 + ~20 new). Apply the concurrent-agent rule to any failure in an untouched file.

- [x] **Step 2: ROADMAP — close the shipped sliver**

In Track C, replace the "**Optimum-derivation shape**" bullet with:

```markdown
- ✅ **Optimum-derivation shape — engine + first consumer shipped, 2026-07-03** (`deriveOptimum` in
  `lib/correlation.ts`; `carbsOptimum` derived each sync from steady long rides classified against the
  athlete's own `decouplingGood`, overridable on `/model` — see ARCHIVE). Dormant until `carbs_ingested`
  data accrues (like every calibrated param). Left: per-ride-type optimums + richer outcome signals
  (RPE-vs-IF divergence, interval completion, next-day TSB) once the endurance read proves out.
```

- [x] **Step 3: ARCHIVE entry**

Add above the "Off-machine backup" entry, matching house format: what shipped (engine shape, carbs consumer, store field + migration note, sync wiring, generalised override route, panel row), the honesty guards (contrast + discrimination + confidence gates, deadband, ≥90-min steady rides only), and the explicit non-goal (fueling table untouched — §6).

- [x] **Step 4: Commit + push**

```bash
git add ROADMAP.md ARCHIVE.md docs/superpowers/plans/2026-07-02-carbs-optimum-derivation.md
git commit -m "docs(roadmap): carbs-optimum derivation shipped -> ARCHIVE (Track C first leg)"
git push
```

---

## Self-Review

- **Spec coverage:** ROADMAP bullet asks for (a) the optimum shape on the engine — Task 1; (b) correlate stamped carbs per ride type against outcomes — Task 2 (endurance type via the steady-ride set; decoupling as the first outcome; the other named outcomes + per-type split recorded as the open remainder in Task 6's ROADMAP text, honestly deferred rather than half-built); (c) stored as a calibrated parameter ← #2 — Tasks 2–4 (store field, sync derive, override route); Model-page transparency matches the framework's anti-black-box pattern — Task 5.
- **Placeholder scan:** none — every step carries the actual code/commands. Task 3 Step 2 explicitly delegates fixture-adaptation to the existing suite's conventions with the assertion pinned; that's a read-first instruction, not a TBD.
- **Type consistency:** `deriveOptimum(obs, spec)` (T1) consumed by `deriveCarbsOptimum` (T2); `carbsOptimum?: CalibratedParameter` (T2) read by sync (T3), route (T4: `cur[param] ?? defaultParameter()`), panel (T5: `cal[row.param]`); bounds/default names (`CARBS_OPTIMUM_BOUNDS`, `DEFAULT_CARBS_OPTIMUM`) identical across T2/T4/T5. ✓
