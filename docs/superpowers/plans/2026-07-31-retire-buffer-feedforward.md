# Retire the configured buffer — feed-forward from the rate goal

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Replace the trend-servo buffer with a direct thermodynamic statement of the athlete's goal, and
retire `NutritionSettings.buffer` as a primary setting. Approved by the athlete 2026-07-31.

**Rationale:** [docs/superpowers/specs/2026-07-31-buffer-redesign-feedforward.md](../specs/2026-07-31-buffer-redesign-feedforward.md).
Two measured defects: a proportional controller with no integral term parks the athlete 1.3 kg past
target (0 of the last 65 simulated days inside the deadband); and because the controller reads only
*trend error*, a configured surplus can stand against a weight-loss goal indefinitely, unnoticed —
a 66 kg athlete targeting 63 ends the simulated year at **66.94 kg**, the wrong direction.

**The athlete has confirmed they eat the prescription ~99% of the time**, so the simulation's exact-
adherence assumption — previously the weakest part of the evidence — holds for them. These are real
outcomes, not idealisations.

## The design

```
buffer = goalSurplus(desiredRate)  +  (calibration trustworthy ? 0 : trendCorrection)

goalSurplus(rate) = rate × 7700 ÷ 7        // kg/week → kcal/day
```

Two mechanisms, non-overlapping jobs:

| Mechanism | Job | When |
|---|---|---|
| `calibrateNeat` | keep maintenance honest | always, re-solved per sync |
| goal surplus | deliver the energy the goal requires | always |
| trend servo | absorb maintenance error | **only** when calibration is not trustworthy |

"Trustworthy" = `neat.source === "derived"` **and** `confidence` is `medium` or `high`. Anything else
(`default`, `override` with no solve behind it, `low`, `stale`) means maintenance is a guess, so the servo
is still the best available correction — and its steady-state offset is a far smaller problem than an
uncorrected model error.

Unifying the two on a shared base is what kills the sign defect: there is no longer a standing configured
surplus that can point opposite to the goal.

## Global Constraints

- **Nutrition is code, not AI** (ADR-0002).
- **Never modify anything under `data/`** — the athlete's live personal data, not git-restorable.
- **Stage only files you touched**; never `git add -A` (a concurrent session shares this checkout).
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- `npm run check` green at the end. Baseline: 92 files, 1565 tests.
- Do not weaken an existing assertion. If one must move, stop and report.

---

## Task 1: `resolveBuffer` — one entry point, two modes

**Files:** `lib/nutrition.ts`, `lib/types.ts`; tests in `lib/nutrition.test.ts`.

**Produces:**

```ts
export interface ResolvedBuffer {
  bufferApplied: number;
  mode: "goal-rate" | "trend-servo";
  goalSurplusKcal: number;      // the feed-forward component, always present
  servoDeltaKcal: number;       // 0 in goal-rate mode
  reason: string;
  capped: boolean;              // hit BUFFER_MIN/MAX
  stepClipped: boolean;         // servo only; false in goal-rate mode
}

export function goalSurplusKcalPerDay(desiredRateKgPerWeek: number): number;

export function resolveBuffer(
  neat: NeatCalibration,
  currentKg: number,
  targetKg: number,
  configuredRate: number | null,
  trendShort: number | null,
  trendLong: number | null,
  legacyBuffer: number,          // NutritionSettings.buffer — servo fallback base only
): ResolvedBuffer;
```

- [ ] **Step 1: Write the failing tests**

```ts
describe("goalSurplusKcalPerDay", () => {
  it("converts a weekly rate to a daily energy figure", () => {
    expect(goalSurplusKcalPerDay(0.35)).toBe(390);   // 0.35 × 7700 ÷ 7 = 385, rounded to 10
    expect(goalSurplusKcalPerDay(-0.5)).toBe(-550);
    expect(goalSurplusKcalPerDay(0)).toBe(0);
  });
});

describe("resolveBuffer", () => {
  const derived = (confidence: "low" | "medium" | "high"): NeatCalibration =>
    ({ multiplier: 1.2584, confidence, source: "derived", windowDays: 42, loggedDays: 39,
       weighIns: 21, solvedAt: "2026-07-31", imbalance: null, stale: false });
  const popDefault: NeatCalibration =
    ({ multiplier: 1.2, confidence: "low", source: "default", windowDays: null, loggedDays: null,
       weighIns: null, solvedAt: null, imbalance: null, stale: false });

  it("uses the goal rate directly when calibration is trustworthy", () => {
    const r = resolveBuffer(derived("high"), 62, 63, null, 0, 0, 150);
    expect(r.mode).toBe("goal-rate");
    expect(r.bufferApplied).toBe(goalSurplusKcalPerDay(0.35));
    expect(r.servoDeltaKcal).toBe(0);
    expect(r.stepClipped).toBe(false);
  });

  it("IGNORES the legacy configured buffer in goal-rate mode", () => {
    const a = resolveBuffer(derived("high"), 62, 63, null, 0, 0, 150);
    const b = resolveBuffer(derived("high"), 62, 63, null, 0, 0, -400);
    expect(a.bufferApplied).toBe(b.bufferApplied); // the retired setting has no effect
  });

  // THE SIGN DEFECT (D-B). A cutting athlete must never be handed a surplus.
  it("never returns a surplus for an athlete below their target weight", () => {
    for (const legacy of [-400, 0, 150, 600]) {
      const r = resolveBuffer(derived("high"), 66, 63, null, -0.5, -0.5, legacy);
      expect(r.bufferApplied).toBeLessThan(0);
    }
  });

  it("never returns a deficit for an athlete above their target weight", () => {
    for (const legacy of [-400, 0, 150, 600]) {
      const r = resolveBuffer(derived("high"), 62, 63, null, 0.2, 0.2, legacy);
      expect(r.bufferApplied).toBeGreaterThan(0);
    }
  });

  it("is zero inside the deadband, so an athlete at target eats maintenance", () => {
    expect(resolveBuffer(derived("high"), 62.9, 63, null, 0, 0, 150).bufferApplied).toBe(0);
  });

  it("honours an athlete-set rate over the derived one", () => {
    const r = resolveBuffer(derived("high"), 62, 63, 0.15, 0, 0, 150);
    expect(r.bufferApplied).toBe(goalSurplusKcalPerDay(0.15));
  });

  it("falls back to the trend servo when calibration is not trustworthy", () => {
    for (const neat of [popDefault, derived("low")]) {
      const r = resolveBuffer(neat, 62, 63, null, -0.5, -0.5, 150);
      expect(r.mode).toBe("trend-servo");
      expect(r.servoDeltaKcal).not.toBe(0);
    }
  });

  it("clamps to the existing rails and reports it", () => {
    const r = resolveBuffer(derived("high"), 50, 63, null, 0, 0, 150); // huge gap
    expect(r.bufferApplied).toBeLessThanOrEqual(BUFFER_MAX_KCAL);
    expect(r.bufferApplied).toBeGreaterThanOrEqual(BUFFER_MIN_KCAL);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

```ts
// The energy a goal rate thermodynamically requires, per day. This is the whole feed-forward idea:
// once calibrateNeat makes maintenance honest, the goal needs no servo — it needs arithmetic.
export function goalSurplusKcalPerDay(desiredRateKgPerWeek: number): number {
  return Math.round((desiredRateKgPerWeek * KCAL_PER_KG_TISSUE) / 7 / 10) * 10;
}

// Calibration is trustworthy when it came from the athlete's own data with enough of it. A "default",
// a "low" tier, or a stale record all mean maintenance is a population guess — there the trend servo,
// steady-state offset and all, still beats no correction at all.
function calibrationIsTrustworthy(neat: NeatCalibration): boolean {
  return neat.source === "derived" && (neat.confidence === "medium" || neat.confidence === "high");
}
```

`resolveBuffer` computes `desiredWeightTrend(currentKg, targetKg, configuredRate)` once, turns it into
`goalSurplusKcal`, and then:

- **trustworthy** → `bufferApplied = clamp(goalSurplusKcal)`, `mode: "goal-rate"`, `servoDeltaKcal: 0`,
  `stepClipped: false`. **`legacyBuffer` is not read.**
- **not trustworthy** → call the existing `adjustBuffer` with `goalSurplusKcal` as its base instead of
  `legacyBuffer`, so both modes share the same base and the sign defect cannot recur. `mode:
  "trend-servo"`, `servoDeltaKcal` = the servo's delta, and carry through its `capped` / `stepClipped`.

Reason strings must name the mode and the evidence — e.g. *"aiming for +0.35 kg/week → +390 kcal/day
(your calibrated maintenance is trusted, so this is the surplus that rate requires)"* vs *"maintenance is
still a population estimate, so the buffer is also correcting against your weight trend"*.

Keep `adjustBuffer` exported — it is the fallback and its tests stay.

- [ ] **Step 4: Run — expect PASS. Then `npm run check`.**
- [ ] **Step 5: Commit.**

---

## Task 2: Wire the routes and retire the setting

**Files:** `app/api/profile/route.ts`, `app/api/sync/route.ts`, `app/api/generate/route.ts`,
`lib/types.ts`, `lib/data-store.ts`; tests alongside.

- [ ] **Step 1:** Replace every `adjustBuffer(...)` call site with `resolveBuffer(...)`, passing
  `profile.nutrition.neat`, the smoothed current weight, target, `targetRateKgPerWeek`, both trends, and
  `profile.nutrition.buffer` as the legacy fallback base.
- [ ] **Step 2:** Mark `NutritionSettings.buffer` deprecated in `lib/types.ts` with a comment saying it is
  read **only** by the trend-servo fallback and is no longer athlete-facing. Do not delete the field —
  removing it would break existing profile JSON and the PUT validator.
- [ ] **Step 3:** `PUT /api/profile` stops accepting `buffer` as an athlete-editable field. Keep accepting
  it in the payload without erroring (older clients), but ignore it. Keep `targetRateKgPerWeek`.
- [ ] **Step 4:** Extend the `derivation` object in `GET /api/profile` with the new fields
  (`mode`, `goalSurplusKcal`, `servoDeltaKcal`) so the panel can render them.
- [ ] **Step 5:** `npm run check`, commit.

---

## Task 3: The derivation panel

**Files:** `components/AthleteProfileForm.tsx`.

- [ ] **Step 1:** Remove the buffer number input. The rate goal becomes the single owned control.
- [ ] **Step 2:** The buffer row shows the mode explicitly:
  - goal-rate → *"+390 kcal/day — the surplus your +0.35 kg/week goal requires"*
  - trend-servo → *"+340 kcal/day — goal surplus +390, corrected −50 against your weight trend because
    maintenance is still an estimate"*
- [ ] **Step 3:** State the deadband honestly somewhere in the goal row: with ±0.7 kg, "target 63" means
  62.3–63.7, and the surplus goes to zero on entry.
- [ ] **Step 4:** `npm run check`, browser-verify via the preview tool (never `npm run dev` in bash, never
  hand-edit `data/`), screenshot, commit.

---

## Task 4: Closed-loop verification

- [ ] **Step 1:** Re-run the year-long simulation from the redesign spec against the shipped code, both
  directions (62 kg gaining to 63; 66 kg cutting to 63). Record final weight and days-in-deadband.
  **Expected:** both converge and hold, replacing 64.32 / 66.94.
- [ ] **Step 2:** Confirm on live data that the athlete's buffer becomes the goal surplus for their
  +0.35 kg/week target, and that `mode` is `goal-rate` given their high-confidence calibration.
- [ ] **Step 3:** Record the measured numbers in the ledger and `todo.md`; commit.

## Self-Review

Covers the approved change: buffer retired as a primary setting, rate goal becomes the single input,
feed-forward when calibration is trustworthy, servo retained as the fallback. The sign defect is pinned by
two explicit tests (`never returns a surplus below target` / `never returns a deficit above target`) that
sweep the legacy value, so it cannot recur regardless of what is left on disk.

Not covered, deliberately: the unlocked `readAthleteProfile` self-heal (separate, pre-existing); the
sustained non-energy weight-offset sensitivity (documented, not code-fixable without body composition).
