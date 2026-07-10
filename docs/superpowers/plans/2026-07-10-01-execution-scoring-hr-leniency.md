# Execution Scoring — HR-Based Easy-Ride Leniency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop under-scoring outdoor easy rides by judging "was this ride actually easy?" from heart rate (terrain-immune) instead of power-zone time (terrain-confounded), with a lenient three-state read (✓ dialed in / ~ some drift / ✗ ran hot).

**Architecture:** Outdoors you cannot hold Zone-2 *power* — descents, rollers, restarts and corners spike watts, so the current power-based `aboveZ2Frac` penalty (and the VI penalty) mark down physiologically-perfect aerobic rides and only ever reward indoor ERG. The heart reflects true physiological cost, and the app already syncs `hrZoneTimes` per ride. This plan adds an HR-zone counterpart to the existing power helper, makes power/VI *reward-only* for easy rides (never penalize), and makes the HR read the single "too hard" judge — preserving the overtraining guardrail while removing the terrain bias. Scoring is deterministic and pure; the ledger recomputes scores from activities on rebuild, so the methodology change re-scores history automatically.

**Tech Stack:** TypeScript 5, Vitest (`npm test` → `vitest run`), Next.js 16 App Router, React 19.

## Global Constraints

- **Run tests with `npm test`** (aliases `vitest run`). Unit tests sit next to source in `lib/` as `*.test.ts`.
- **No new dependencies.** Everything here is pure arithmetic on already-synced data.
- **Determinism:** `computeExecutionScore` and all helpers must stay pure (no `Date.now()`, no IO). Same inputs → same output.
- **Backward-compatible nulls:** every new signal must degrade to *no effect* when its data is absent (a ride with no HR monitor must not be penalized). Follow the existing `timeAboveZ2Fraction` null-handling pattern verbatim.
- **HR zone index convention:** `hrZoneTimes` is `[Z1, Z2, Z3, …]` ascending, seconds per zone. Index 0–1 = aerobic (Z1–Z2); index ≥2 = above the aerobic ceiling. This matches `timeAboveZ2Fraction`'s power convention (`.slice(2)`).
- **Research-grounded bands (do not change without re-grounding):** a single easy ride should be ~100% aerobic; 10% tolerance for terrain-driven HR bumps (climbs, brief efforts); >25% of HR-time above aerobic means it genuinely was not an easy ride. Friel's LTHR Zone-2 ceiling ≈ 89% LTHR = top of HR zone 2; the 80/20 polarized principle backs the "almost all easy" expectation.

---

## File Structure

- `lib/execution-score.ts` — **modify.** Add `timeAboveAerobicHrFraction()` and `aerobicDisciplineRead()` helpers; swap the easy-ride branch from power-based penalty to HR-based read; make IF-band and VI reward-only for Z2/Recovery; replace the `aboveZ2Frac` input field with `aboveAerobicHrFrac`.
- `lib/execution-score.test.ts` — **modify.** New tests for the two helpers and the reworked easy-ride branch (including the user's outdoor-Z2 scenario); update existing easy-ride expectations.
- `lib/ride-analysis.ts` — **modify.** Feed `aboveAerobicHrFrac` from `input.hrZoneTimes`; add `aerobicDiscipline` to the analysis result.
- `lib/score-log.ts` — **modify.** Feed `aboveAerobicHrFrac` from `act.hrZoneTimes` at both call sites.
- `lib/types.ts` — **modify.** Add `aerobicDiscipline` to `TodayAnalysis`.
- `components/dashboard/today.tsx` — **modify.** Surface the ✓/~/✗ read in the debrief drill-down.
- `lib/athlete-model.ts` — **modify.** Reword the "Execution trending down = fatigue" insight from a diagnosis to a hypothesis (honesty fix; the trigger stays).
- `lib/athlete-model.test.ts` — **modify.** Update the asserted insight copy.

---

### Task 1: `timeAboveAerobicHrFraction` — the terrain-immune counterpart

**Files:**
- Modify: `lib/execution-score.ts` (add exported function near `timeAboveZ2Fraction`, ~line 255)
- Test: `lib/execution-score.test.ts`

**Interfaces:**
- Produces: `timeAboveAerobicHrFraction(hrZoneTimes: number[] | null | undefined): number | null` — fraction (0–1) of measured HR-zone time in HR zones 3+ (above the aerobic ceiling); `null` when there is no usable HR-zone data.

- [ ] **Step 1: Write the failing test**

Add to `lib/execution-score.test.ts`:

```ts
import { timeAboveAerobicHrFraction } from "./execution-score";

describe("timeAboveAerobicHrFraction", () => {
  it("returns the fraction of HR-zone time in zones 3+", () => {
    // [Z1, Z2, Z3, Z4] seconds: 300 aerobic-below-cap in Z1+Z2 is index 0..1; 100 above.
    expect(timeAboveAerobicHrFraction([1200, 1800, 200, 100])).toBeCloseTo(300 / 3300, 5);
  });
  it("treats a mostly-aerobic outdoor ride as low fraction despite brief spikes", () => {
    // 55 min aerobic (Z1 600s + Z2 2700s), 5 min above (Z3 300s) → 300/3600 ≈ 0.083 ≤ 0.10
    expect(timeAboveAerobicHrFraction([600, 2700, 300])).toBeCloseTo(0.0833, 3);
  });
  it("returns null with fewer than 3 zones or no usable data", () => {
    expect(timeAboveAerobicHrFraction([100, 200])).toBeNull();
    expect(timeAboveAerobicHrFraction(null)).toBeNull();
    expect(timeAboveAerobicHrFraction([0, 0, 0])).toBeNull();
  });
  it("ignores non-finite / negative buckets", () => {
    expect(timeAboveAerobicHrFraction([600, NaN, -5, 200])).toBeCloseTo(200 / 800, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- execution-score`
Expected: FAIL — `timeAboveAerobicHrFraction is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `lib/execution-score.ts` immediately after `timeAboveZ2Fraction`:

```ts
// Fraction (0–1) of measured HR-zone time spent ABOVE the aerobic ceiling — HR zones 3+ (above Z2) —
// from synced HR-zone seconds. The terrain-immune counterpart to timeAboveZ2Fraction: outdoors you
// cannot hold Z2 POWER (descents, rollers, restarts, corners spike watts), but the HEART reflects the
// ride's true physiological cost, so this is what decides whether an "easy" ride was actually easy.
// Returns null when there's no usable HR-zone data, so scoring falls back to its other signals.
// Pure + defensive: ignores non-finite/negative buckets; a missing top zone simply isn't counted.
export function timeAboveAerobicHrFraction(hrZoneTimes: number[] | null | undefined): number | null {
  if (!Array.isArray(hrZoneTimes) || hrZoneTimes.length < 3) return null;
  const secs = hrZoneTimes.map((s) => (typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 0));
  const total = secs.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const above = secs.slice(2).reduce((a, b) => a + b, 0); // HR zones 3+ (index 2 onward) = above the aerobic cap
  return above / total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- execution-score`
Expected: PASS (the new `timeAboveAerobicHrFraction` block; existing tests unchanged for now).

- [ ] **Step 5: Commit**

```bash
git add lib/execution-score.ts lib/execution-score.test.ts
git commit -m "feat(scoring): add HR-based timeAboveAerobicHrFraction (terrain-immune easy-ride read)"
```

---

### Task 2: `aerobicDisciplineRead` — the ✓ / ~ / ✗ three-state label

**Files:**
- Modify: `lib/execution-score.ts` (add exported helper + constants below the new function)
- Test: `lib/execution-score.test.ts`

**Interfaces:**
- Consumes: `timeAboveAerobicHrFraction` output (a fraction or null).
- Produces:
  - `AEROBIC_HR_DIALED_MAX = 0.10`, `AEROBIC_HR_DRIFT_MAX = 0.25` (exported consts).
  - `type AerobicDiscipline = "dialed" | "drift" | "hot"`.
  - `aerobicDisciplineRead(aboveAerobicHrFrac: number | null | undefined): AerobicDiscipline | null` — `null` when no HR data.

- [ ] **Step 1: Write the failing test**

```ts
import { aerobicDisciplineRead, AEROBIC_HR_DIALED_MAX, AEROBIC_HR_DRIFT_MAX } from "./execution-score";

describe("aerobicDisciplineRead", () => {
  it("dialed in when almost all time is aerobic", () => {
    expect(aerobicDisciplineRead(0.05)).toBe("dialed");
    expect(aerobicDisciplineRead(AEROBIC_HR_DIALED_MAX)).toBe("dialed"); // boundary inclusive
  });
  it("some drift in the tolerance band", () => {
    expect(aerobicDisciplineRead(0.18)).toBe("drift");
    expect(aerobicDisciplineRead(AEROBIC_HR_DRIFT_MAX)).toBe("drift"); // boundary inclusive
  });
  it("ran hot above the drift ceiling", () => {
    expect(aerobicDisciplineRead(0.4)).toBe("hot");
  });
  it("null when there is no HR data", () => {
    expect(aerobicDisciplineRead(null)).toBeNull();
    expect(aerobicDisciplineRead(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- execution-score`
Expected: FAIL — `aerobicDisciplineRead is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `lib/execution-score.ts` after `timeAboveAerobicHrFraction`:

```ts
// Research-grounded easy-ride discipline bands, on the HR-time-above-aerobic fraction. A single easy
// ride should be ~100% aerobic (80/20 polarized principle); ≤10% above tolerates terrain-driven HR bumps
// (climbs, the odd brief effort); >25% means the HEART sat above the aerobic ceiling for a quarter-plus of
// the ride — it genuinely wasn't an easy ride. Friel's LTHR Zone-2 ceiling (~89% LTHR) = the top of HR
// zone 2, so "above zone 2" is the physiological line these bands sit on.
export const AEROBIC_HR_DIALED_MAX = 0.10;
export const AEROBIC_HR_DRIFT_MAX = 0.25;

export type AerobicDiscipline = "dialed" | "drift" | "hot";

// Map the HR-time-above-aerobic fraction to a lenient three-state read. Null (no HR-zone data) → no read,
// and the scorer applies no HR penalty (an easy ride with no HR monitor rests on duration + power bonuses).
export function aerobicDisciplineRead(aboveAerobicHrFrac: number | null | undefined): AerobicDiscipline | null {
  if (aboveAerobicHrFrac == null || !Number.isFinite(aboveAerobicHrFrac)) return null;
  if (aboveAerobicHrFrac <= AEROBIC_HR_DIALED_MAX) return "dialed";
  if (aboveAerobicHrFrac <= AEROBIC_HR_DRIFT_MAX) return "drift";
  return "hot";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- execution-score`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/execution-score.ts lib/execution-score.test.ts
git commit -m "feat(scoring): add aerobicDisciplineRead 3-state easy-ride bands (research-grounded)"
```

---

### Task 3: Rework the easy-ride branch — HR judges "too hard", power/VI reward-only

**Files:**
- Modify: `lib/execution-score.ts` — `ExecutionScoreInput` interface (~line 42), the Z2/Recovery IF-band cases (~line 124), the VI block (~line 222), and the easy-ride discipline block (~line 179).
- Test: `lib/execution-score.test.ts`

**Interfaces:**
- Consumes: `aerobicDisciplineRead` (Task 2).
- Produces: `ExecutionScoreInput` gains `aboveAerobicHrFrac?: number | null` and **loses** `aboveZ2Frac`. Behaviour change: for prescribed `Z2`/`Recovery`, the IF-vs-type band and VI can only add points (never subtract), and the HR read is the sole penalty axis (`dialed` +1 / `drift` 0 / `hot` −2).

- [ ] **Step 1: Write the failing test (the user's scenario is the anchor)**

```ts
import { computeExecutionScore } from "./execution-score";

describe("easy-ride execution — HR judges effort, terrain does not", () => {
  const baseZ2 = {
    compliancePct: 100,      // rode the planned duration (or longer)
    intensityFactor: 0.68,   // NP/FTP of a genuine outdoor Z2 ride
    plannedType: "Z2" as const,
    variabilityIndex: 1.15,  // surgy — outdoor terrain, NOT a discipline failure
  };

  it("scores a well-ridden OUTDOOR Z2 highly despite power spikes and high VI", () => {
    // HR stayed aerobic (only 8% of HR-time above zone) → the ride was genuinely easy.
    const score = computeExecutionScore({ ...baseZ2, aboveAerobicHrFrac: 0.08 });
    expect(score).not.toBeNull();
    expect(score as number).toBeGreaterThanOrEqual(7); // "Good" is now reachable outdoors
  });

  it("does NOT penalize surgy VI or brief power spikes on an easy ride", () => {
    const steady = computeExecutionScore({ ...baseZ2, variabilityIndex: 1.02, aboveAerobicHrFrac: 0.08 });
    const surgy = computeExecutionScore({ ...baseZ2, variabilityIndex: 1.20, aboveAerobicHrFrac: 0.08 });
    // Steady may earn the +1 VI bonus, but surgy is never penalized below steady-minus-bonus.
    expect(surgy as number).toBeGreaterThanOrEqual((steady as number) - 1);
    expect(surgy as number).toBeGreaterThanOrEqual(7);
  });

  it("still flags a genuinely over-cooked easy ride via HR (the overtraining guardrail)", () => {
    // 40% of HR-time above aerobic → the heart was working; this was not an easy ride.
    const score = computeExecutionScore({ ...baseZ2, aboveAerobicHrFrac: 0.40 });
    expect(score as number).toBeLessThanOrEqual(5);
  });

  it("no HR data → no HR penalty (rides on duration + power bonuses)", () => {
    const score = computeExecutionScore({ ...baseZ2, aboveAerobicHrFrac: null });
    expect(score as number).toBeGreaterThanOrEqual(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- execution-score`
Expected: FAIL — `aboveAerobicHrFrac` not accepted, and the old VI/power branch penalizes surgy/spiky rides so the outdoor-Z2 score lands ~5–6, below 7.

- [ ] **Step 3: Edit the input interface**

In `lib/execution-score.ts`, in `ExecutionScoreInput`, **remove** the `aboveZ2Frac` field and its comment (currently ~lines 40–42) and **add**:

```ts
  // Easy-ride effort judge (Z2/Recovery): fraction (0–1) of the ride's HR-zone time spent ABOVE the
  // aerobic ceiling (HR zones 3+), from timeAboveAerobicHrFraction. Terrain-immune — this, not power,
  // decides whether an "easy" ride was actually easy. Only applied for prescribed Z2/Recovery; null/absent
  // → no HR penalty. Replaces the old power-based aboveZ2Frac, which penalized outdoor rides for terrain.
  aboveAerobicHrFrac?: number | null;
```

- [ ] **Step 4: Make the Z2/Recovery IF-band reward-only**

Replace the `case "Z2":` and `case "Recovery":` blocks in the intensity-vs-type `switch` (~lines 125–135) with:

```ts
      case "Z2":
        // Reward-only for easy rides: NP/FTP in-band is a nice controlled ride (+1), but being over is
        // NOT penalized here — outdoor NP inflates on terrain, and the HR read below is the sole "too hard"
        // judge. `o` is the per-athlete zone-edge offset (ROADMAP #2).
        if (IF >= 0.60 + o && IF <= 0.74 + o) score += 1;
        break;
      case "Recovery":
        if (IF < 0.60 + o) score += 1; // genuinely gentle — a bonus, never a penalty (HR judges "too hard")
        break;
```

- [ ] **Step 5: Make the Z2/Recovery VI reward-only**

Replace the `case "Z2": case "Recovery":` block in the variability-index `switch` (~lines 225–229) with:

```ts
      case "Z2":
      case "Recovery":
        if (vi <= 1.06) score += 1; // held the zone steadily, as intended — a bonus only.
        // No penalty for high VI: outdoor easy rides are naturally surgy (terrain), which is not a
        // discipline failure. The HR read is the sole "too hard" judge for easy rides.
        break;
```

- [ ] **Step 6: Replace the power-based easy-ride discipline block with the HR read**

Replace the entire `input.aboveZ2Frac`-based block (currently ~lines 169–191, the comment block plus the `if (input.aboveZ2Frac != null …)` statement) with:

```ts
  // --- Easy-ride effort judge: HR time above the aerobic ceiling (+1 / 0 / −2) --- prescribed Z2/Recovery.
  // The terrain-immune "was this actually easy?" read (aerobicDisciplineRead over HR-zone time), and the
  // ONLY penalty axis for easy rides: dialed in = +1, some drift = 0, ran hot = −2 (the overtraining
  // guardrail — a genuinely too-hard easy day is still flagged). Skipped for off-plan rides (no plan to be
  // easy against), for durability templates B–E (efforts INSIDE the ride are the point — Track B), and when
  // HR-zone data is absent (older rides / no HR monitor score exactly as before, on duration + bonuses).
  if (
    input.aboveAerobicHrFrac != null &&
    !intrinsic &&
    !embedsEfforts &&
    (plannedType === "Z2" || plannedType === "Recovery")
  ) {
    const read = aerobicDisciplineRead(input.aboveAerobicHrFrac);
    if (read === "dialed") score += 1;
    else if (read === "hot") score -= 2;
    // "drift" → 0 (lenient middle: the odd climb or brief effort is fine).
  }
```

- [ ] **Step 7: Run the new + existing tests**

Run: `npm test -- execution-score`
Expected: the four new easy-ride tests PASS. Some *pre-existing* easy-ride tests may now fail (they pinned scores under the old power/VI penalties) — that is expected and fixed in Task 6. If any test OUTSIDE the easy-ride/Z2/Recovery area fails, stop and re-read the diff.

- [ ] **Step 8: Commit**

```bash
git add lib/execution-score.ts lib/execution-score.test.ts
git commit -m "feat(scoring): HR judges easy-ride effort; power/VI reward-only for Z2/Recovery"
```

---

### Task 4: Feed the HR signal at both scoring call sites

**Files:**
- Modify: `lib/ride-analysis.ts:135` (the `buildTodayAnalysis` call) and its import (line 7).
- Modify: `lib/score-log.ts:137, 162, 215` (the ledger rebuild) and its import (line 7).
- Test: existing `lib/ride-analysis.test.ts`, `lib/score-log.test.ts` (run to confirm no regressions; add one targeted assertion).

**Interfaces:**
- Consumes: `timeAboveAerobicHrFraction` (Task 1); `input.hrZoneTimes` (already on `TodayAnalysisInputs`, line 78) and `act.hrZoneTimes` (already on `ActivitySummary`, `lib/types.ts:90`).
- Produces: both call sites now pass `aboveAerobicHrFrac` instead of `aboveZ2Frac`.

- [ ] **Step 1: Update `lib/ride-analysis.ts`**

Change the import on line 7 from:

```ts
import { computeExecutionScore, resolveCompliance, timeAboveZ2Fraction, type ScoringCalibration } from "./execution-score";
```

to:

```ts
import { computeExecutionScore, resolveCompliance, timeAboveAerobicHrFraction, aerobicDisciplineRead, type ScoringCalibration } from "./execution-score";
```

Then replace line 135:

```ts
    aboveZ2Frac: timeAboveZ2Fraction(input.powerZoneTimes),
```

with:

```ts
    // Easy-ride effort judged on HR (terrain-immune), not power-zone time.
    aboveAerobicHrFrac: timeAboveAerobicHrFraction(input.hrZoneTimes),
```

- [ ] **Step 2: Update `lib/score-log.ts`**

Change the import on line 7 to add `timeAboveAerobicHrFraction` and drop `timeAboveZ2Fraction`:

```ts
import { computeExecutionScore, resolveCompliance, timeAboveAerobicHrFraction, type ScoringCalibration } from "./execution-score";
```

Replace line 137:

```ts
    const aboveZ2Frac = timeAboveZ2Fraction(act.powerZoneTimes);
```

with:

```ts
    const aboveAerobicHrFrac = timeAboveAerobicHrFraction(act.hrZoneTimes);
```

In the planned-ride `computeExecutionScore` call (~line 162) replace `aboveZ2Frac,` with `aboveAerobicHrFrac,`. In the off-plan call (~line 215) replace `aboveZ2Frac, // gated …` with `aboveAerobicHrFrac, // gated to prescribed Z2/Recovery in computeExecutionScore — inert here (intrinsic)`.

- [ ] **Step 3: Run the affected suites**

Run: `npm test -- ride-analysis score-log`
Expected: compiles and runs. Some pinned score assertions may shift (Task 6). No `timeAboveZ2Fraction`/`aboveZ2Frac` reference errors.

- [ ] **Step 4: Commit**

```bash
git add lib/ride-analysis.ts lib/score-log.ts
git commit -m "feat(scoring): feed HR-based easy-ride signal at today + ledger call sites"
```

---

### Task 5: Surface the ✓ / ~ / ✗ read in the debrief

**Files:**
- Modify: `lib/types.ts` — add `aerobicDiscipline` to the `TodayAnalysis` interface (near `activityDecoupling`).
- Modify: `lib/ride-analysis.ts` — compute and attach `aerobicDiscipline` on the result object (in the `todayAnalysis` literal, ~line 163 near `activityDecoupling`).
- Modify: `components/dashboard/today.tsx` — render the read in the existing "Power execution / Aerobic drift" drill-down (~line 305).
- Test: `lib/ride-analysis.test.ts`.

**Interfaces:**
- Consumes: `aerobicDisciplineRead` + `timeAboveAerobicHrFraction` (Tasks 1–2), imported in Task 4 Step 1.
- Produces: `TodayAnalysis.aerobicDiscipline: AerobicDiscipline | null`.

- [ ] **Step 1: Write the failing test**

Add to `lib/ride-analysis.test.ts` (adapt the existing `buildTodayAnalysis` fixture helper used in that file — reuse its factory, only setting `plannedDay.type = "Z2"` and `hrZoneTimes`):

```ts
it("attaches aerobicDiscipline for an easy ride from HR-zone time", () => {
  const result = buildTodayAnalysis(makeInputs({
    plannedType: "Z2",
    hrZoneTimes: [600, 2700, 300], // ~8% above aerobic → dialed
  }));
  expect(result.todayAnalysis.aerobicDiscipline).toBe("dialed");
});

it("aerobicDiscipline is null for an interval day (not an easy ride)", () => {
  const result = buildTodayAnalysis(makeInputs({
    plannedType: "VO2max",
    hrZoneTimes: [300, 600, 900, 1200],
  }));
  expect(result.todayAnalysis.aerobicDiscipline).toBeNull();
});
```

> Note to implementer: `makeInputs` is illustrative — match the fixture factory already present in `lib/ride-analysis.test.ts`. If none exists, build a `TodayAnalysisInputs` literal directly, setting `plannedDay.type`, `hrZoneTimes`, `activity`, `ftp`, and `nutrition`.

- [ ] **Step 2: Add the type field**

In `lib/types.ts`, in `interface TodayAnalysis`, add near `activityDecoupling`:

```ts
  // Easy-ride effort read (Z2/Recovery only): "dialed" | "drift" | "hot" from HR-zone time above aerobic,
  // or null for interval/off-plan days. Surfaced in the debrief; mirrors the HR execution signal.
  aerobicDiscipline: import("./execution-score").AerobicDiscipline | null;
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- ride-analysis`
Expected: FAIL — `aerobicDiscipline` missing on the result object.

- [ ] **Step 4: Compute and attach it in `lib/ride-analysis.ts`**

In `buildTodayAnalysis`, before the `todayAnalysis` literal, add:

```ts
  // Easy-ride effort read for the debrief (Z2/Recovery only; null otherwise). Same HR signal the score used.
  const aerobicDiscipline =
    scoringType === "Z2" || scoringType === "Recovery"
      ? aerobicDisciplineRead(timeAboveAerobicHrFraction(input.hrZoneTimes))
      : null;
```

Then add `aerobicDiscipline,` to the `todayAnalysis` object literal (next to `activityDecoupling`).

- [ ] **Step 5: Render it in `components/dashboard/today.tsx`**

Inside the "Power execution / Aerobic drift" drill-down block (the `{(analysis.powerZoneTimes || …)` section, ~line 305), add after the decoupling row (~line 334, after its `</MetricTip>`):

```tsx
{analysis.aerobicDiscipline != null && (
  <div className="flex items-center gap-1.5 text-xs">
    <span className="text-zinc-500 dark:text-zinc-400">Aerobic discipline</span>
    <span
      className={
        analysis.aerobicDiscipline === "dialed"
          ? "font-medium text-emerald-600 dark:text-emerald-400"
          : analysis.aerobicDiscipline === "hot"
            ? "font-medium text-amber-600 dark:text-amber-400"
            : "text-zinc-600 dark:text-zinc-300"
      }
    >
      {analysis.aerobicDiscipline === "dialed"
        ? "✓ Dialed in — HR stayed aerobic"
        : analysis.aerobicDiscipline === "drift"
          ? "~ Some drift — a few efforts crept up"
          : "✗ Ran hot — HR sat above easy"}
    </span>
  </div>
)}
```

Also widen the drill-down's render guard (~line 305) so an easy ride with only HR data still shows the section — add `|| analysis.aerobicDiscipline != null` to the condition.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- ride-analysis` then `npx tsc --noEmit`
Expected: both PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/ride-analysis.ts components/dashboard/today.tsx lib/ride-analysis.test.ts
git commit -m "feat(debrief): surface ✓/~/✗ aerobic-discipline read for easy rides"
```

---

### Task 6: Re-baseline existing tests + full suite + live smoke

**Files:**
- Modify: `lib/execution-score.test.ts`, `lib/score-log.test.ts` (any pinned easy-ride expectations).

- [ ] **Step 1: Run the full suite and list failures**

Run: `npm test`
Expected: failures ONLY in easy-ride (Z2/Recovery) scoring assertions that hard-coded scores under the old power/VI penalties.

- [ ] **Step 2: Fix each failing easy-ride expectation to the new methodology**

For each failing assertion, recompute by hand from the new rules (baseline 5; duration ±2; Z2 IF-in-band +1 only; VI≤1.06 +1 only; HR read dialed +1 / drift 0 / hot −2; RPE ±1) and update the expected value. **Do not** weaken an assertion to `toBeGreaterThan` just to pass — set the exact new expected number so the test still pins behaviour. Add a one-line comment on any changed expectation: `// re-baselined: easy-ride effort now HR-judged, power/VI reward-only`.

- [ ] **Step 3: Re-run full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 4: Live smoke (required — see AGENTS.md, LLM/scoring paths)**

This change alters real ledger scores. Recompute against real synced data and eyeball an outdoor Z2 ride:

Run: `npm run dev`, open `/today` after a synced outdoor easy ride (or `/trends` Delivery card), and confirm a well-ridden outdoor Z2 now reads ≥7 with a ✓/~ aerobic-discipline line — not the old ~5. If no synced easy ride is available, note that in the commit and flag for the user to verify on their next Z2.

- [ ] **Step 5: Commit**

```bash
git add lib/execution-score.test.ts lib/score-log.test.ts
git commit -m "test(scoring): re-baseline easy-ride expectations to HR-judged methodology"
```

---

### Task 7: Honesty fix — "Execution trending down" insight is a hypothesis, not a diagnosis

**Files:**
- Modify: `lib/athlete-model.ts:136-144` (the overall-trend insight).
- Test: `lib/athlete-model.test.ts`.

**Interfaces:** no signature change — copy only.

- [ ] **Step 1: Update the asserted copy in the test**

In `lib/athlete-model.test.ts`, find the assertion on the `"Execution trending down"` insight's `suggestion` and change the expected string to:

```ts
"Execution is drifting down — could be accumulated fatigue, a harder block, or more outdoor riding. Check recovery signals before adding load.";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- athlete-model`
Expected: FAIL — old suggestion string still returned.

- [ ] **Step 3: Reword the insight**

In `lib/athlete-model.ts`, in the `model.sampleSize >= 6 && model.overallTrend === "down"` block, change the `suggestion` line to:

```ts
      suggestion:
        "Execution is drifting down — could be accumulated fatigue, a harder block, or more outdoor riding. Check recovery signals before adding load.",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- athlete-model`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/athlete-model.ts lib/athlete-model.test.ts
git commit -m "fix(insights): frame execution downtrend as hypothesis, not a fatigue diagnosis"
```

---

## Self-Review Notes (for the executor)

- **Spec coverage:** power→HR swap (Tasks 1,3,4); leniency ✓/~/✗ (Tasks 2,3); UI surface (Task 5); no-HR fallback (Task 3 test 4); overtraining guardrail preserved (Task 3 test 3 — `hot` −2); cascade honesty (Task 7). The full athlete-state fusion rework (HRV in, Pw:HR/ACWR demote) is **Plan 2** — do not attempt it here.
- **Type consistency:** `AerobicDiscipline` is defined once (Task 2) and referenced by `TodayAnalysis` (Task 5) and `ride-analysis.ts`. `aboveAerobicHrFrac` replaces `aboveZ2Frac` in `ExecutionScoreInput` and BOTH callers — grep `aboveZ2Frac` after Task 4; the only surviving reference should be `timeAboveZ2Fraction` in `coach-snapshot.ts` (an independent display, intentionally kept).
- **Ledger:** scores recompute from activities on rebuild, so no migration is needed; Task 6 Step 4 is the required live check because this is a scoring-methodology change.
