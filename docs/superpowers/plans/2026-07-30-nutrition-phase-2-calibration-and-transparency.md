# Nutrition Phase 2 — NEAT Calibration, Rate Goal & Transparency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop guessing the athlete's non-exercise energy expenditure and derive it from their own logged
data; let them set the *rate* they want to change weight rather than inferring it from a hardcoded cap;
and show the whole derivation instead of emitting a bare buffer number.

**Architecture:** `dailyTarget = (k × RMR) + activeBurnKcal + buffer`. Phase 1 shipped `k` as a fixed
population prior of 1.20. This phase solves the energy-balance identity over a 28–42 day window to derive
`k` per-athlete, with a confidence tier and a manual override. `desiredWeightTrend` stops deriving the
rate from the gap and reads an athlete-set field. The profile UI gains a panel showing every step from RMR
to today's target.

**Tech Stack:** TypeScript 5, Next.js 16 App Router, React 19, Tailwind v4, Vitest.

## Why this is worth doing — measured, not assumed

Derived from this athlete's real logged data on 2026-07-30 (63 intake-logged days, 80 weigh-ins):

| Window | Intake coverage | Weigh-ins | Mean intake | Mean burn | Derived `k` |
|---|---|---|---|---|---|
| 28 d | 82% | 16 | 3192 | 1074 | **1.299** |
| 42 d | 83% | 26 | 3243 | 1124 | **1.299** |
| 60 d | 87% | 41 | 3218 | 1097 | **1.301** |

Three independent windows agreeing to three decimal places is signal, not noise. The app ships **1.20**.
That gap is **~163 kcal/day** the athlete is not being given — and their weight is flat at a logged intake
of ~3190, so 3190 *is* their maintenance while the app computes 3031.

The Phase 1 buffer had already climbed to +190 chasing it: the model rediscovering its own NEAT error
through the weight trend. That is defect D6 from the spec, observed live. It also resolves the final
review's **I3** (migration cutting rest days 2600 → 2300), because the correct `k` restores most of it.

## Global Constraints

- **Nutrition is code, not AI** (ADR-0002). Every number here is TypeScript; the LLM only phrases values
  it is handed. Never move a calculation into a prompt.
- **Only the product `k × RMR` is identifiable** from the energy-balance identity. Do not present derived
  `k` as a measurement of the athlete's metabolism — it absorbs RMR-equation bias too (see below).
- **Mifflin-St Jeor under-predicts trained endurance athletes by 5–10%**, so derived `k` lands
  correspondingly high. The plausibility band was written assuming an unbiased RMR. Band edges must be
  documented as *"against Mifflin"*, not as universal physiology.
- **An out-of-band solve is ambiguous, never a diagnosis.** Report the magnitude and BOTH candidate causes
  (food-log bias; RMR-equation/efficiency error). Never tell the athlete their log is wrong.
- **Missing intake days are imputed at the window's logged mean, not summed as zero.** This athlete logs
  ~99% of days in MyFitnessPal and only the *transfer* to Intervals.icu is intermittent, so absence is
  missing-at-random. Summing logged days only would fabricate a deficit proportional to transfer laziness.
- **Calibration must never silently lower the daily target below RMR.** See Task 6's floor.
- **Local dates for "now"** — `localToday()` / `resolveToday()` from `lib/date.ts`.
- **Stage only files you touched** (`git add <path>...`). Never `git add -A` — a concurrent session shares
  this checkout.
- **Never modify anything under `data/`** — that is the athlete's live personal data and is NOT
  git-restorable (`data/athlete.json` was removed from tracking in 98f0245). A Phase 1 subagent wrote
  invented physiology into it; do not repeat that.
- Commit trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Verification: `npm run check` (= `tsc --noEmit && eslint && vitest run`). Currently green at 1521 tests.

## Out of scope

The separable-by-regression upgrade (fitting `k` *and* an efficiency factor ε from multi-week blocks) —
spec §7 states its data cost and this athlete does not yet meet it. The under-fueling streak alert and the
daily carbohydrate target remain Phase 3/4.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/nutrition.ts` | Formula, RMR, buffer, calibration | **Modify** — `calibrateNeat`, unrounded trend, rate goal, floor |
| `lib/types.ts` | Shared types | **Modify** — `NeatCalibration`, `targetRateKgPerWeek` |
| `lib/data-store.ts` | `DEFAULT_PROFILE` | **Modify** — defaults for the new fields |
| `app/api/profile/route.ts` | Profile GET/PUT | **Modify** — expose the derivation, validate new fields |
| `app/api/sync/route.ts` | Sync | **Modify** — recalibrate on sync |
| `components/AthleteProfileForm.tsx` | Profile UI | **Modify** — rate goal input, NEAT control, derivation panel |

---

## Task 1: Unrounded weight trend

`weightTrendFromWellness` rounds to 1 decimal, so a true +0.04 kg/week reads as 0.0 — about **44 kcal/day**
of slop, which the calibration in Task 3 cannot tolerate since it multiplies the trend by 7700.

**Files:** Modify `lib/nutrition.ts`; test in `lib/nutrition.test.ts`.

**Interfaces:**
- Produces: `weightTrendPreciseFromWellness(wellness, windowDays?): number | null` — same estimator, no
  rounding. `weightTrendFromWellness` keeps its rounding and stays the display/steering path.

- [ ] **Step 1: Write the failing test**

```ts
describe("weightTrendPreciseFromWellness", () => {
  const w = (date: string, weightKg: number) =>
    ({ date, weightKg, kcalConsumed: null }) as unknown as WellnessEntry;

  it("keeps precision the rounded variant discards", () => {
    // +0.16 kg over 28 days = +0.04 kg/7d — rounds to 0.0, which is 44 kcal/day of error at 7700 kcal/kg.
    const entries = [
      w("2026-07-01", 62.00), w("2026-07-08", 62.04),
      w("2026-07-15", 62.08), w("2026-07-22", 62.12), w("2026-07-29", 62.16),
    ];
    expect(weightTrendFromWellness(entries, 28)).toBe(0);
    const precise = weightTrendPreciseFromWellness(entries, 28) as number;
    expect(precise).toBeGreaterThan(0.03);
    expect(precise).toBeLessThan(0.05);
  });

  it("returns null under the same sample floor as the rounded variant", () => {
    expect(weightTrendPreciseFromWellness([w("2026-07-01", 62)], 28)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`weightTrendPreciseFromWellness is not a function`)

Run: `npx vitest run lib/nutrition.test.ts -t "weightTrendPrecise"`

- [ ] **Step 3: Extract the shared estimator**

Refactor `weightTrendFromWellness` so the Theil–Sen computation lives in one unexported helper returning
the unrounded slope in kg/7d, then:

```ts
// Unrounded Theil–Sen slope, kg/7d. weightTrendFromWellness rounds to 1 decimal for display and for the
// buffer's steering decisions — fine there, useless here: calibration multiplies this by 7700 kcal/kg, so
// a discarded 0.04 kg/7d is ~44 kcal/day of fabricated imbalance.
export function weightTrendPreciseFromWellness(
  wellness: WellnessEntry[],
  windowDays: number = WEIGHT_TREND_WINDOW_DAYS
): number | null {
  return theilSenKgPerWeek(wellness, windowDays);
}
```

`weightTrendFromWellness` becomes `const s = theilSenKgPerWeek(...); return s === null ? null : Math.round(s * 10) / 10;`

**Every existing `weightTrendFromWellness` expectation must still pass unchanged.** If one moves, stop and
report — the refactor was not behaviour-preserving.

- [ ] **Step 4: Run tests** — `npx vitest run lib/nutrition.test.ts` — expect PASS.
- [ ] **Step 5: `npm run check`** — expect PASS.
- [ ] **Step 6: Commit**

```bash
git add lib/nutrition.ts lib/nutrition.test.ts
git commit -m "feat(nutrition): expose an unrounded weight trend for calibration

weightTrendFromWellness rounds to 1 decimal, which is right for display and
for the buffer's steering bands but wrong for calibration: the identity
multiplies the trend by 7700 kcal/kg, so a discarded 0.04 kg/7d becomes ~44
kcal/day of fabricated imbalance. Both variants now share one estimator.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Athlete-set weekly rate goal

`desiredWeightTrend` currently derives the rate from the gap and clamps it with hardcoded constants, so the
athlete cannot say "+0.15 kg/week". They should set it directly.

**Files:** Modify `lib/types.ts`, `lib/data-store.ts`, `lib/nutrition.ts`; test in `lib/nutrition.test.ts`.

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `NutritionSettings.targetRateKgPerWeek: number | null`;
  `desiredWeightTrend(currentKg, targetKg, configuredRate?: number | null)` — same name, new optional third
  parameter, so existing call sites keep compiling.

- [ ] **Step 1: Write the failing test**

```ts
describe("desiredWeightTrend with an athlete-set rate", () => {
  it("uses the configured rate instead of the derived cap", () => {
    expect(desiredWeightTrend(62, 63, 0.15)).toBe(0.15);
  });

  it("still zeroes inside the deadband regardless of the configured rate", () => {
    expect(desiredWeightTrend(62.5, 63, 0.15)).toBe(0);
  });

  it("clamps a configured rate to the protective caps", () => {
    expect(desiredWeightTrend(62, 70, 2.0)).toBe(MAX_GAIN_KG_PER_WEEK);
    expect(desiredWeightTrend(80, 70, -2.0)).toBe(-MAX_LOSS_KG_PER_WEEK);
  });

  it("ignores a configured rate pointing the wrong way and derives instead", () => {
    // Athlete is BELOW target but the stored rate says lose — direction comes from the gap, always.
    expect(desiredWeightTrend(62, 63, -0.3)).toBeGreaterThan(0);
  });

  it("falls back to the derived rate when none is configured", () => {
    expect(desiredWeightTrend(62, 63, null)).toBe(desiredWeightTrend(62, 63));
  });
});
```

- [ ] **Step 2: Run it — expect FAIL.**
- [ ] **Step 3: Add the field**

`lib/types.ts`, in `NutritionSettings`:

```ts
  // Signed kg/week the athlete WANTS to move, e.g. +0.15 to gain slowly. null → derive from the gap and
  // the protective caps, which is Phase 1's behaviour. The sign is advisory only: direction always comes
  // from which side of target the athlete is on, so a stale value cannot invert the goal.
  targetRateKgPerWeek: number | null;
```

`lib/data-store.ts`, in `DEFAULT_PROFILE.nutrition`: `targetRateKgPerWeek: null,`

- [ ] **Step 4: Implement**

```ts
export function desiredWeightTrend(
  currentKg: number,
  targetKg: number,
  configuredRate: number | null = null
): number {
  const gap = Math.round((targetKg - currentKg) * 100) / 100;
  if (Math.abs(gap) <= GOAL_DEADBAND_KG) return 0;
  const cap = gap > 0 ? MAX_GAIN_KG_PER_WEEK : MAX_LOSS_KG_PER_WEEK;
  // Direction is never taken from the stored rate — only its magnitude. A rate left over from a previous
  // goal must not be able to invert which way the athlete is being steered.
  const magnitude =
    configuredRate != null && Number.isFinite(configuredRate) && configuredRate !== 0
      ? Math.min(Math.abs(configuredRate), cap)
      : Math.min(Math.abs(gap), cap);
  return gap > 0 ? magnitude : -magnitude;
}
```

- [ ] **Step 5: Thread it through**

`adjustBuffer` gains a trailing optional `configuredRate: number | null = null` and forwards it to
`desiredWeightTrend`. Update the three route call sites
(`app/api/profile/route.ts`, `app/api/sync/route.ts`, `app/api/generate/route.ts`) to pass
`profile.nutrition.targetRateKgPerWeek`.

Validate in `app/api/profile/route.ts`'s PUT: accept `null`, or a finite number with
`Math.abs(v) <= 1.5`; reject otherwise with a 400 naming the bound.

- [ ] **Step 6: Tests + `npm run check`** — expect PASS.
- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/data-store.ts lib/nutrition.ts lib/nutrition.test.ts app/api/profile/route.ts app/api/sync/route.ts app/api/generate/route.ts
git commit -m "feat(nutrition): athlete-set weekly weight-change rate

desiredWeightTrend derived the rate from the gap and clamped it with
hardcoded caps, so the athlete could not choose their pace - a 1 kg gap
always implied +0.35 kg/week whether they wanted that or not.

Magnitude now comes from targetRateKgPerWeek when set. Direction never
does: it always comes from which side of target the athlete is on, so a
rate left over from an earlier goal cannot invert the steering.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Derive the NEAT multiplier

The centrepiece. Solve the energy-balance identity for `k` over a trailing window.

```
Σ intake − ( N·k·RMR + Σ activeBurn ) = Δmass · ρ
  ⇒ k = ( Σ intake − Σ activeBurn − Δmass·ρ ) / ( N · RMR )
```

**Files:** Modify `lib/nutrition.ts`, `lib/types.ts`; test in `lib/nutrition.test.ts`.

**Interfaces:**
- Consumes: `weightTrendPreciseFromWellness` (Task 1), `activeBurn`, `restingMetabolicRate`.
- Produces: `calibrateNeat(...)` returning `NeatCalibration | null`, plus the constants below.

- [ ] **Step 1: Write the failing tests**

```ts
describe("calibrateNeat", () => {
  // Synthetic athlete with a KNOWN k: intake is constructed so the identity must recover it.
  const synth = (k: number, days: number, rmr: number, burnPerDay: number) => {
    const wellness: WellnessEntry[] = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.UTC(2026, 5, 1) + i * 86_400_000).toISOString().slice(0, 10);
      wellness.push({ date, weightKg: 62, kcalConsumed: k * rmr + burnPerDay } as WellnessEntry);
    }
    const activities = wellness.map((w) => ({ date: w.date, activeBurnKcal: burnPerDay, kj: null }));
    return { wellness, activities };
  };

  it("recovers a known multiplier from a flat-weight athlete", () => {
    const { wellness, activities } = synth(1.3, 42, 1631, 1000);
    const r = calibrateNeat(wellness, activities, 1631, "2026-07-13", 42)!;
    expect(r.multiplier).toBeGreaterThan(1.29);
    expect(r.multiplier).toBeLessThan(1.31);
    expect(r.imbalance).toBeNull();
    expect(r.source).toBe("derived");
  });

  it("withholds below the confidence floor rather than adopting a flaky number", () => {
    const { wellness, activities } = synth(1.3, 10, 1631, 1000);
    expect(calibrateNeat(wellness, activities, 1631, "2026-06-11", 42)).toBeNull();
  });

  it("clamps an implausibly HIGH solve and reports both candidate causes, not a diagnosis", () => {
    const { wellness, activities } = synth(2.2, 42, 1631, 1000);
    const r = calibrateNeat(wellness, activities, 1631, "2026-07-13", 42)!;
    expect(r.multiplier).toBe(NEAT_PLAUSIBLE_MAX);
    expect(r.imbalance!.direction).toBe("intake-above-model");
    expect(r.imbalance!.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("clamps an implausibly LOW solve", () => {
    const { wellness, activities } = synth(0.6, 42, 1631, 1000);
    const r = calibrateNeat(wellness, activities, 1631, "2026-07-13", 42)!;
    expect(r.multiplier).toBe(NEAT_PLAUSIBLE_MIN);
    expect(r.imbalance!.direction).toBe("intake-below-model");
  });

  it("imputes missing intake days at the logged mean, not zero", () => {
    const { wellness, activities } = synth(1.3, 42, 1631, 1000);
    // Blank a third of the days: absence is a transfer gap, not a fast.
    for (let i = 0; i < wellness.length; i += 3) wellness[i].kcalConsumed = null;
    const r = calibrateNeat(wellness, activities, 1631, "2026-07-13", 42)!;
    expect(r.multiplier).toBeGreaterThan(1.28); // would collapse toward 0.87 if zeros were summed
    expect(r.multiplier).toBeLessThan(1.32);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Add the types**

`lib/types.ts`:

```ts
export interface EnergyImbalanceFinding {
  direction: "intake-below-model" | "intake-above-model";
  estimatedKcalPerDay: number; // magnitude, NOT a cause
  candidates: string[];        // ordered most→least likely; ALWAYS names more than one
  note: string;
}

export interface NeatCalibration {
  multiplier: number;
  confidence: "low" | "medium" | "high";
  source: "default" | "derived" | "override";
  windowDays: number | null;
  loggedDays: number | null;
  weighIns: number | null;
  solvedAt: string | null; // ISO
  imbalance: EnergyImbalanceFinding | null;
}
```

Add to `NutritionSettings`: `neat: NeatCalibration;`
Add to `DEFAULT_PROFILE.nutrition`:
```ts
    neat: { multiplier: DEFAULT_NEAT_MULTIPLIER, confidence: "low", source: "default",
            windowDays: null, loggedDays: null, weighIns: null, solvedAt: null, imbalance: null },
```

- [ ] **Step 4: Implement**

```ts
// Band for an RMR multiplier covering NEAT + the thermic effect of food and NOTHING else — structured
// exercise arrives separately as activeBurnKcal. Standard PAL figures (1.2 sedentary … 1.9 very active)
// INCLUDE exercise and are the wrong reference, so these edges are deliberately tighter.
//
// READ THESE AGAINST MIFFLIN-ST JEOR SPECIFICALLY. Mifflin under-predicts trained endurance athletes by
// 5–10%, so a derived k for such an athlete lands correspondingly high — the upper edge carries that
// bias, it is not a claim about human physiology.
export const NEAT_PLAUSIBLE_MIN = 1.15;
export const NEAT_PLAUSIBLE_MAX = 1.55;

export const KCAL_PER_KG_TISSUE = 7700;
export const CALIBRATION_MIN_WINDOW_DAYS = 28;
export const CALIBRATION_PREFERRED_WINDOW_DAYS = 42;
export const CALIBRATION_MIN_LOGGED_FRACTION = 0.65;
export const CALIBRATION_MIN_WEIGH_INS = 12;

export function calibrateNeat(
  wellness: WellnessEntry[],
  activities: Array<Pick<ActivitySummary, "date" | "activeBurnKcal" | "kj">>,
  rmr: number,
  today: string,
  windowDays: number = CALIBRATION_PREFERRED_WINDOW_DAYS
): NeatCalibration | null
```

Implementation notes the tests pin:
- Window is `[today - windowDays, today)`. **Exclude today** — its intake is still being logged.
- A logged `0` or negative counts as *not logged* (no genuine zero-kcal day exists).
- `Σ intake` = `mean(logged) × windowDays` — the imputation the constraints require.
- `Σ activeBurn` sums `activeBurn(a)?.kcal` over the window; days whose activity has an **unresolvable**
  burn are excluded from *both* sums so the identity stays balanced.
- `Δmass` = `weightTrendPreciseFromWellness(wellness, windowDays) / 7 × windowDays`.
- Confidence: `high` at ≥42 d, ≥20 weigh-ins, ≥80% logged; `medium` at ≥28 d, ≥12, ≥65%; else return
  `null` (do **not** emit a `low`-confidence adopted value — withhold).
- Out of band → clamp, and set `imbalance` with **at least two** candidates, log bias listed first
  (20–30% athlete under-reporting is larger and better documented than equation error), RMR-equation
  bias second. Never assert a single cause.

- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: `npm run check`** — expect PASS.
- [ ] **Step 7: Commit**

```bash
git add lib/nutrition.ts lib/nutrition.test.ts lib/types.ts lib/data-store.ts
git commit -m "feat(nutrition): derive the NEAT multiplier from the athlete's own data

Phase 1 shipped k as a fixed population prior of 1.20. Solving the
energy-balance identity over this athlete's real logs puts it at 1.30
across three independent windows (28/42/60d, 82-87% intake coverage) -
about 163 kcal/day the app was not giving them, and the reason the buffer
had climbed to +190 chasing its own model error.

Out-of-band solves clamp and report BOTH candidate causes rather than
diagnosing the food log: only the product k x RMR is identifiable, so a
high k also absorbs Mifflin's 5-10% under-prediction in trained athletes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Adopt on sync, with a manual override

**Files:** Modify `lib/nutrition.ts` (`resolveNutritionModel`), `app/api/sync/route.ts`,
`app/api/profile/route.ts`; test in `lib/nutrition.test.ts`.

**Interfaces:**
- Consumes: `calibrateNeat` (Task 3).
- Produces: `resolveNutritionModel` reads `profile.nutrition.neat.multiplier` instead of the constant.

- [ ] **Step 1: Write the failing tests**

```ts
describe("resolveNutritionModel with calibration", () => {
  it("uses the stored calibrated multiplier over the default", () => {
    const p = profileWith({ neat: { ...defaultNeat, multiplier: 1.3, source: "derived", confidence: "high" } });
    const m = resolveNutritionModel(p, 62, "2026-07-30");
    expect(m.kind).toBe("derived");
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.neatMultiplier).toBe(1.3);
  });

  it("falls back to the default when nothing has been adopted", () => {
    const m = resolveNutritionModel(profileWith({}), 62, "2026-07-30");
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.neatMultiplier).toBe(DEFAULT_NEAT_MULTIPLIER);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Read the stored value**

In `resolveNutritionModel`'s derived branch, replace `neatMultiplier: DEFAULT_NEAT_MULTIPLIER` with
`neatMultiplier: profile.nutrition.neat?.multiplier ?? DEFAULT_NEAT_MULTIPLIER`.

Optional chaining and `??` are required, not stylistic: a profile JSON written before `neat` existed parses
it back as `undefined`. This is the same class as the migration gate.

- [ ] **Step 3b: Coverage over the LOGGABLE range, plus a staleness guard**

**Found during execution — the plan's original gates were measured against an over-optimistic hand
calculation.** Anchoring the window at *today* while this athlete transfers intake in batches drags
coverage down artificially. Measured 2026-07-30 with a 9-day transfer gap:

| Window | logged/total | weigh-ins | outcome |
|---|---|---|---|
| 28 d | 14/28 = 50% | 8 | withheld |
| 42 d | 26/42 = 62% | 20 | withheld |
| 60 d | 44/60 = 73% | 34 | k = 1.363, medium |

The same windows anchored at the last *logged* day give 82–87% coverage. So calibration as written
flickers: available right after a transfer, gone nine days later. That is honest but not useful.

**Fix — separate "patchy" from "stale", because they are different states:**

```ts
// Days the athlete COULD have logged in this window: window start → the last day they actually logged.
// Coverage measured against the full window punishes a transfer gap as if it were a logging gap, and
// this athlete logs ~99% of days in MyFitnessPal and only transfers into Intervals.icu in batches.
export const CALIBRATION_MAX_STALENESS_DAYS = 14;
```

- Compute `loggableDays` = days from window start through the last logged date inside the window.
  Coverage = `loggedDays / loggableDays`, floored at 1 to avoid divide-by-zero.
- **Staleness guard:** if the last logged date is more than `CALIBRATION_MAX_STALENESS_DAYS` before
  `today`, return `null` regardless of coverage, and say so — good-but-old data must not be adopted as
  current. Add a `stale: boolean` to `NeatCalibration` so Task 5 can render "your last transfer was N
  days ago" rather than a bare absence.
- `N` in the identity becomes `loggableDays`, not `windowDays` — the k·RMR term is per-day, so it must
  count the same days the intake and burn sums cover.

This also resolves the Task 3 implementer's flagged judgment call: days excluded for an unresolvable
activity burn must decrement `N` too (this athlete has **23** such activities), otherwise the identity
is unbalanced by roughly 1.5%.

Add tests: a series with a trailing transfer gap inside the staleness limit still calibrates; one beyond
it returns `null` with `stale: true`; excluding a burn-unresolvable day decrements `N`.

- [ ] **Step 4: Recalibrate on sync**

In `app/api/sync/route.ts`, after the sync data is persisted and the profile is available, call
`calibrateNeat`. Persist the result via `updateAthleteProfile` **only when** it returns non-null **and**
`profile.nutrition.neat.source !== "override"`. Preserve `source: "override"` untouched — an athlete's
manual value must survive every re-solve.

Wrap in try/catch: a calibration failure must never break a sync. On throw, log and leave `neat` as-is.

- [ ] **Step 5: Override endpoint**

In `app/api/profile/route.ts`'s PUT, accept `nutrition.neatMultiplier`: a finite number within
`[NEAT_PLAUSIBLE_MIN, NEAT_PLAUSIBLE_MAX]` sets `neat = { ...existing, multiplier: v, source: "override",
solvedAt: <now> }`; `null` resets `source` to `"default"` with the multiplier back to
`DEFAULT_NEAT_MULTIPLIER`. Reject out-of-range with a 400 naming the bounds.

- [ ] **Step 6: Tests + `npm run check`** — expect PASS.
- [ ] **Step 7: Commit** (message: adopt calibrated NEAT on sync; override wins and survives re-solve)

---

## Task 5: The derivation panel

Replace the bare buffer number with the whole chain. This is the transparency requirement: the athlete
should see the system working, not just its output.

**Files:** Modify `app/api/profile/route.ts` (expose the parts), `components/AthleteProfileForm.tsx`.

- [ ] **Step 1: Expose the derivation from GET `/api/profile`**

Add a `derivation` object to the response:

```ts
derivation: {
  rmr: number | null,
  neat: NeatCalibration,
  maintenanceKcal: number | null,      // neat.multiplier × rmr
  smoothedWeightKg: number | null,
  rawLatestWeightKg: number | null,
  targetWeightKg: number,
  trendShortKgPerWeek: number | null,
  trendLongKgPerWeek: number | null,
  desiredTrendKgPerWeek: number,
  buffer: BufferAdjustment,            // includes capped + stepClipped
}
```

- [ ] **Step 2: Render the chain**

A `<dl>` under the Nutrition section, each row `label → value → one-line why`. Required rows, in order:

1. **Resting metabolic rate** — `1,631 kcal` · "Mifflin-St Jeor from 62 kg, 177 cm, age 20"
2. **Non-exercise multiplier** — `× 1.30` · source + confidence, e.g. "derived from your last 42 days
   (83% logged, 26 weigh-ins) — high confidence", or "population default — not enough logged days yet"
3. **Maintenance** — `2,120 kcal` · "before training and before your weight goal"
4. **Weight** — `62.25 kg (14-day median)` · "smoothed; last single reading 62.0"
5. **Goal** — `63.0 kg at +0.15 kg/week` · "your setting" or "derived from the gap"
6. **Observed trend** — `0.0 kg/week (14d) · 0.0 (28d)` · "the long window must confirm before any cut"
7. **Buffer** — `+150 → +340` · `buffer.reason`
8. **Today's target** — `maintenance + today's burn + buffer`

Show `stepClipped` and `capped` as an explicit warning line when either is true.
When `neat.imbalance` is set, render it with **both** candidates — never as a verdict about the food log.

- [ ] **Step 3: Rate-goal input**

Add `targetRateKgPerWeek` to the editable fields: signed number, step 0.05, range −1.5…1.5, hint
"kg/week; blank = derive from the gap".

- [ ] **Step 4: NEAT control**

Show the derived value read-only with its confidence, plus a disclosure to override it (range
`NEAT_PLAUSIBLE_MIN`–`NEAT_PLAUSIBLE_MAX`) and a "revert to derived" action. Overriding must state that it
stops tracking the athlete's data.

- [ ] **Step 5: Browser verification** — via the preview tool, never `npm run dev` in bash. Confirm: every
row renders with real values; the override sets `source: "override"` and survives a sync; a blank rate
falls back to derived. **Do not hand-edit anything under `data/`.** Screenshot the panel.

- [ ] **Step 6: `npm run check` + commit.**

---

## Task 6: An absolute floor under the daily target

The final review's Minor 8: `calculateDailyTarget(0, derived, -500, true)` yields **1460 kcal against an
RMR of 1631** — the app can prescribe below resting metabolic rate. For an athlete presenting with
underfuelling that must not be reachable.

**Files:** Modify `lib/nutrition.ts`; test in `lib/nutrition.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
it("never prescribes below resting metabolic rate", () => {
  const m: NutritionModel = { kind: "derived", rmr: 1631, neatMultiplier: 1.2,
    weightKg: 62, targetWeightKg: 63, buffer: -500 };
  const p = calculateDailyTarget(0, m, -500, true);
  expect(p.dailyTarget).toBeGreaterThanOrEqual(1631);
  expect(p.floored).toBe(true);
});

it("does not floor a normal day", () => {
  const m: NutritionModel = { kind: "derived", rmr: 1631, neatMultiplier: 1.3,
    weightKg: 62, targetWeightKg: 63, buffer: 300 };
  expect(calculateDailyTarget(800, m, 300, false).floored).toBe(false);
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — add `floored: boolean` to `WorkoutNutritionPlan`; on the derived path clamp
`dailyTarget` to `>= model.rmr` and set the flag. Legacy path: `floored: false` (its floor is
`restDayTarget`, already handled).

Comment it as a safety floor, not a formula term: a target below RMR is never a legitimate prescription
from this app, whatever the buffer says.

- [ ] **Step 4: Surface it** — where `capped`/`stepClipped` are shown, add the floor.
- [ ] **Step 5: `npm run check` + commit.**

---

## Task 7: Live verification

- [ ] **Step 1:** Sync, then confirm `/api/profile` shows `neat.source === "derived"` with a plausible
multiplier and a stated confidence. **Do not expect 1.30** — that hand figure anchored its windows at the
last *logged* day and was over-optimistic. Measured against the real today-anchored data on 2026-07-30 the
60-day window gives **1.363 at medium confidence**, and the 28/42-day windows correctly withhold. After
Step 3b's loggable-range change the number will move again; **record what it actually is** rather than
matching it to a prior expectation. What must hold: `k` is inside the plausible band, confidence is
justified by the printed coverage/weigh-in counts, and the value is stable across two consecutive syncs.
- [ ] **Step 2:** Confirm the derivation panel renders every row with real values.
- [ ] **Step 3:** Generate a 2-week block live. Confirm no rest day exceeds any training day, and record
the new rest-day figure — it should recover most of Phase 1's 2600 → 2300 drop (review finding I3).
- [ ] **Step 4:** Set a manual override, sync, confirm it survives. Revert to derived.
- [ ] **Step 5:** Record the measured numbers in `todo.md` and commit.

---

## Self-Review

**Spec coverage:** Task 1 → the rounding fix the athlete approved. Task 2 → configurable rate goal. Tasks
3–4 → spec §7 calibration with `source: "override"`. Task 5 → transparency panel. Task 6 → review Minor 8.
Task 7 → AGENTS.md's live-run requirement.

**Not covered, deliberately:** the ε-regression upgrade (spec §7, data cost not met); review findings I4,
Minor 4, 6, 7, 9, 11 (logged in the Phase 1 ledger for separate triage); streak alert and daily carb
target (Phase 3/4).

**Type consistency:** `NeatCalibration` and `EnergyImbalanceFinding` are defined in Task 3 and consumed
unchanged by Tasks 4 and 5. `calibrateNeat`'s signature is fixed in Task 3 Step 4 and called identically in
Task 4 Step 4. `desiredWeightTrend`'s third parameter (Task 2) is optional, so Task 1's untouched call
sites keep compiling. `floored` is added in Task 6 and rendered in the same place as `capped`/`stepClipped`
from Phase 1.

**Ordering:** Task 3 depends on Task 1 (precise trend). Task 4 depends on Task 3. Task 5 depends on 2, 3,
4. Task 6 is independent and could move earlier if the floor is wanted sooner.
