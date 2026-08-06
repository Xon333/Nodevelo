# Prescribed-EA warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn on the Today dashboard when the app's own PRESCRIBED daily target is already low-energy-availability by construction, using the app's existing `eaLevel()` bands unchanged — informational only, never changes the target.

**Architecture:** One new pure function in `lib/nutrition.ts` (`planEaKcalPerKg`) computes the target's own EA-equivalent from a `NutritionModel` + resolved buffer. `GET /api/sync` computes it once (mirroring exactly how `nutritionTrendWarning` is already computed GET-only in that file) and adds two fields to its response. `SyncProvider`'s `AppState` carries them through; a new `PlanEaWarningBanner` component in `components/dashboard/today.tsx` (styled identically to the existing `NutritionTrendWarningBanner`) renders only when the level is `"low"`.

**Tech Stack:** TypeScript, Next.js API routes, React (client components), Vitest + `@testing-library/react` (jsdom).

## Global Constraints

- Never change the calorie target — this is display-only. Reviewed and rejected as a hard floor (see `docs/superpowers/specs/2026-08-06-prescribed-ea-warning-design.md`).
- Reuse `eaLevel()` unchanged — no new thresholds.
- `null` for a legacy (pre-migration) `NutritionModel` — no RMR exists to isolate the NEAT term, matching `maintenanceKcal`'s existing convention in `app/api/profile/route.ts`.
- GET-only, mirroring `nutritionTrendWarning`'s existing pattern in `app/api/sync/route.ts` — not computed in POST; the client re-fetches GET after a sync to pick up updated derived values (same pattern `SyncProvider.tsx` already documents for `nutritionModel`).

---

### Task 1: `planEaKcalPerKg` pure function

**Files:**
- Modify: `lib/nutrition.ts` (add after `eaLevel`, which is defined at line 1370 as of this writing — confirm with `grep -n "^export function eaLevel" lib/nutrition.ts` before editing, since concurrent work may have shifted line numbers)
- Test: `lib/nutrition.test.ts`

**Interfaces:**
- Consumes: `NutritionModel` (existing union type, `lib/nutrition.ts` line ~150), `EaLevel`/`eaLevel()` (existing, `lib/nutrition.ts` line ~1369-1370)
- Produces: `export function planEaKcalPerKg(model: NutritionModel, bufferApplied: number): number | null` — used by Task 2

- [ ] **Step 1: Write the failing tests**

Add to `lib/nutrition.test.ts` (find the `describe("eaLevel"...)` or nearby EA-related describe block and add a new one after it, following this file's existing import list — `planEaKcalPerKg` needs to be added to the big `import { ... } from "./nutrition";` block at the top):

```ts
describe("planEaKcalPerKg", () => {
  it("returns null for a legacy model — no RMR to isolate the NEAT term from", () => {
    const legacy: NutritionModel = {
      kind: "legacy",
      baseCalories: 2000,
      restDayTarget: 2600,
      weightKg: 70,
      targetWeightKg: 68,
      buffer: 0,
    };
    expect(planEaKcalPerKg(legacy, -500)).toBeNull();
  });

  it("computes (k x RMR + buffer) / weightKg for a derived model, excluding the exercise term", () => {
    // Rounded from this athlete's real post-net-of-resting-fix calibration (RMR 1622, k~1.3493,
    // weight 62kg) at the buffer floor — the concrete case the design doc's review was grounded in.
    const model: NutritionModel = {
      kind: "derived",
      rmr: 1622,
      neatMultiplier: 1.3493,
      restingKcalPerHour: 1622 / 24,
      weightKg: 62,
      targetWeightKg: 63,
      buffer: 0,
    };
    const result = planEaKcalPerKg(model, -500);
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo((1.3493 * 1622 - 500) / 62, 2);
    expect(result!).toBeCloseTo(27.24, 1);
  });

  it("is independent of activeBurnKcal — the exercise term never enters this calculation", () => {
    // planEaKcalPerKg takes only model + bufferApplied, no burn parameter at all — this test exists
    // to make that contract explicit and regression-proof, since EA definitions are always net of
    // exercise and a future edit must not accidentally thread a burn figure into this function.
    const model: NutritionModel = {
      kind: "derived",
      rmr: 1500,
      neatMultiplier: 1.3,
      restingKcalPerHour: 1500 / 24,
      weightKg: 60,
      targetWeightKg: 60,
      buffer: 0,
    };
    expect(planEaKcalPerKg(model, 0)).toBe((1.3 * 1500) / 60);
  });

  it("combined with eaLevel(): lands on 'low' just below 25 kcal/kg and 'adequate' at exactly 25", () => {
    const justBelow: NutritionModel = {
      kind: "derived", rmr: 1499, neatMultiplier: 1, restingKcalPerHour: 1499 / 24,
      weightKg: 60, targetWeightKg: 60, buffer: 0,
    };
    const exactlyAt: NutritionModel = { ...justBelow, rmr: 1500 };
    expect(eaLevel(planEaKcalPerKg(justBelow, 0)!)).toBe("low"); // 1499/60 = 24.98
    expect(eaLevel(planEaKcalPerKg(exactlyAt, 0)!)).toBe("adequate"); // 1500/60 = 25.0 exactly
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/nutrition.test.ts -t "planEaKcalPerKg"`
Expected: FAIL — `planEaKcalPerKg` is not exported from `./nutrition` (TypeScript/import error, or `ReferenceError` if the test file's import list wasn't updated yet — add `planEaKcalPerKg` to the existing `import { ... } from "./nutrition";` block at the top of `lib/nutrition.test.ts` as part of this step, before running).

- [ ] **Step 3: Write the minimal implementation**

In `lib/nutrition.ts`, immediately after the `eaLevel` function (confirm exact location with `grep -n "^export function eaLevel" lib/nutrition.ts` first):

```ts
/**
 * The daily target's OWN energy-availability proxy — same units and bands as the observed-intake
 * proxy (`eaLevel`), applied to the PRESCRIBED target instead of logged behaviour. This is what the
 * RMR floor doesn't catch: `dailyTarget >= RMR` guards against an invalid formula output, not against
 * a target that is valid but already low-EA by construction (e.g. at `BUFFER_MIN_KCAL`, when the
 * athlete's own RMR sits below the low-EA line too).
 *
 * = (k × RMR + bufferApplied) / weightKg — maintenance minus the exercise term (EA definitions are
 * always net of exercise energy), buffer's effect included. `null` for a legacy model: there is no RMR
 * to isolate the NEAT term from, same convention `maintenanceKcal` follows in `app/api/profile/route.ts`.
 *
 * Informational only (docs/superpowers/specs/2026-08-06-prescribed-ea-warning-design.md) — never feeds
 * back into the target. A hard floor was reviewed and explicitly rejected: no body-fat data exists
 * anywhere in this app, and a hard override built on an approximation could move real calories on a
 * guess.
 */
export function planEaKcalPerKg(model: NutritionModel, bufferApplied: number): number | null {
  if (model.kind !== "derived") return null;
  return (model.neatMultiplier * model.rmr + bufferApplied) / model.weightKg;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/nutrition.test.ts -t "planEaKcalPerKg"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/nutrition.ts lib/nutrition.test.ts
git commit -m "feat(nutrition): add planEaKcalPerKg, the prescribed target's own EA proxy

Reuses eaLevel()'s existing bands unchanged, applied to (k x RMR +
bufferApplied) / weightKg instead of observed intake -- catches when the
RMR floor doesn't, because RMR itself can sit below the low-EA line.
Informational only per docs/superpowers/specs/2026-08-06-prescribed-ea-warning-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire into `GET /api/sync`

**Files:**
- Modify: `app/api/sync/route.ts` (GET handler only — around lines 85-217 as of this writing; find the `bufferStatus` computation and the `nutritionTrendWarning` computation immediately after it, and the final `NextResponse.json({...})` object)
- Test: `app/api/sync/route.test.ts`

**Interfaces:**
- Consumes: `planEaKcalPerKg(model, bufferApplied)` and `eaLevel(kcalPerKg)` from Task 1; `nutritionModelForEnergy` and `bufferStatus.bufferApplied` (both already computed locally in the GET handler, immediately before `nutritionTrendWarning` is computed)
- Produces: two new fields on the GET response JSON: `planEaKcalPerKg: number | null`, `planEaLevel: EaLevel | null` — consumed by Task 3

- [ ] **Step 1: Write the failing test**

Find the existing test(s) asserting `nutritionTrendWarning` appears in the GET response (search `app/api/sync/route.test.ts` for `nutritionTrendWarning` to find the pattern — likely inside a `describe("GET /api/sync"...)` block with a mocked profile/sync fixture). Add a sibling test immediately after it:

```ts
it("includes the prescribed-EA proxy in the GET response", async () => {
  // Reuse whatever mocked derived-profile fixture the nutritionTrendWarning test above uses (same
  // profile shape, same mocked readAthleteProfile/readLastSync) so this exercises the real
  // nutritionModelForEnergy + bufferStatus values the route actually resolves, not a hand-picked one.
  const res = await GET(new Request("http://localhost/api/sync"));
  const json = await res.json();
  expect(json).toHaveProperty("planEaKcalPerKg");
  expect(json).toHaveProperty("planEaLevel");
  // A derived profile must produce a number, not null (null is only for legacy/pre-migration profiles).
  if (json.planEaKcalPerKg !== null) {
    expect(typeof json.planEaKcalPerKg).toBe("number");
    expect(["low", "adequate", "ample"]).toContain(json.planEaLevel);
  }
});

it("returns null planEaKcalPerKg/planEaLevel for a legacy (pre-migration) profile", async () => {
  // Find/reuse this test file's existing legacy-profile fixture (search for wherever an existing test
  // proves `nutritionModel.kind === "legacy"` behavior, e.g. around maintenanceKcal-null assertions in
  // app/api/profile/route.test.ts's sibling tests, and mirror the same mock setup here for the sync route).
  const res = await GET(new Request("http://localhost/api/sync"));
  const json = await res.json();
  expect(json.planEaKcalPerKg).toBeNull();
  expect(json.planEaLevel).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/sync/route.test.ts -t "prescribed-EA"`
Expected: FAIL — `planEaKcalPerKg`/`planEaLevel` are `undefined` on the response (property doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

In `app/api/sync/route.ts`:

1. Add `planEaKcalPerKg` and `eaLevel` to the existing `@/lib/nutrition` import (currently `import { calibrateNeat, calibrateNeatByDayType, computeNutritionTrendWarning, isRestDayFor, resolveBuffer, resolveNeatImbalance, resolveNutritionModel, smoothedCurrentWeightKg, weightTrendFromWellness, WEIGHT_TREND_LONG_WINDOW_DAYS } from "@/lib/nutrition";` — confirm this exact line with `grep -n 'from "@/lib/nutrition"' app/api/sync/route.ts` first, since it's a single long line and easy to mis-edit):

```ts
import { calibrateNeat, calibrateNeatByDayType, computeNutritionTrendWarning, eaLevel, isRestDayFor, planEaKcalPerKg, resolveBuffer, resolveNeatImbalance, resolveNutritionModel, smoothedCurrentWeightKg, weightTrendFromWellness, WEIGHT_TREND_LONG_WINDOW_DAYS } from "@/lib/nutrition";
```

2. Immediately after the `bufferStatus` computation and before `nutritionTrendWarning` is computed (find `const nutritionTrendWarning = computeNutritionTrendWarning(` in the GET handler), add:

```ts
  // The prescribed target's OWN EA proxy — informational, see
  // docs/superpowers/specs/2026-08-06-prescribed-ea-warning-design.md. Uses the SAME
  // nutritionModelForEnergy + bufferStatus.bufferApplied the Today card's fuel figures already use —
  // one resolve, no second call.
  const planEaKcalPerKgValue = planEaKcalPerKg(nutritionModelForEnergy, bufferStatus.bufferApplied);
  const planEaLevel = planEaKcalPerKgValue === null ? null : eaLevel(planEaKcalPerKgValue);
```

3. In the final `return NextResponse.json({...})` object, add the two fields near `nutritionTrendWarning` (find that line inside the returned object and add these immediately before or after it):

```ts
    planEaKcalPerKg: planEaKcalPerKgValue,
    planEaLevel,
    nutritionTrendWarning,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/sync/route.test.ts`
Expected: PASS — all tests in this file, including the two new ones, plus every pre-existing test in the file unchanged (the new fields are additive; nothing removed from the response).

- [ ] **Step 5: Commit**

```bash
git add app/api/sync/route.ts app/api/sync/route.test.ts
git commit -m "feat(sync): surface the prescribed-EA proxy in GET /api/sync

planEaKcalPerKg/planEaLevel, computed from the same nutritionModelForEnergy
+ bufferStatus.bufferApplied the route already resolves for other Today
fields. GET-only, mirroring nutritionTrendWarning's existing pattern --
the client re-fetches GET after a sync to pick up updated derived values.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `PlanEaWarningBanner` on the Today dashboard

**Files:**
- Modify: `components/SyncProvider.tsx` (add two fields to `AppState`)
- Modify: `components/dashboard/today.tsx` (add `PlanEaWarningBanner`, exported alongside `NutritionTrendWarningBanner`)
- Modify: `components/dashboard/TodayView.tsx` (render it next to `NutritionTrendWarningBanner`, line ~146)
- Test: `components/dashboard/today.test.tsx`

**Interfaces:**
- Consumes: `planEaKcalPerKg: number | null` and `planEaLevel: EaLevel | null` from Task 2's route response, threaded through `AppState`
- Produces: `export function PlanEaWarningBanner({ level, kcalPerKg }: { level: EaLevel | null; kcalPerKg: number | null }): JSX.Element | null` — rendered in `TodayView.tsx`

- [ ] **Step 1: Write the failing test**

In `components/dashboard/today.test.tsx`, add `PlanEaWarningBanner` to the existing `import { EnergyAvailabilityTile, NutritionTrendWarningBanner } from "./today";` line, and add a new `describe` block right after the existing `describe("NutritionTrendWarningBanner"...)` block (mirror its exact structure — this file already has `afterEach(cleanup)` and the jsdom docblock at the top, don't duplicate them):

```ts
describe("PlanEaWarningBanner", () => {
  it("renders when the level is low", () => {
    render(<PlanEaWarningBanner level="low" kcalPerKg={27.2} />);

    const heading = screen.getByRole("heading", { name: "Today's target is low-energy-availability" });
    expect(screen.getByRole("region", { name: heading.textContent! })).toBeTruthy();
    expect(screen.getByText("27 kcal/kg", { exact: false })).toBeTruthy();
    expect(screen.getByText("informational only, calories are unchanged", { exact: false })).toBeTruthy();
  });

  it("withholds when the level is adequate or ample", () => {
    const { container: c1 } = render(<PlanEaWarningBanner level="adequate" kcalPerKg={32} />);
    expect(c1.firstChild).toBeNull();
    cleanup();
    const { container: c2 } = render(<PlanEaWarningBanner level="ample" kcalPerKg={45} />);
    expect(c2.firstChild).toBeNull();
  });

  it("withholds when level is null (legacy model, no RMR to compute from)", () => {
    const { container } = render(<PlanEaWarningBanner level={null} kcalPerKg={null} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/dashboard/today.test.tsx -t "PlanEaWarningBanner"`
Expected: FAIL — `PlanEaWarningBanner` is not exported from `./today`.

- [ ] **Step 3: Write the minimal implementation**

In `components/dashboard/today.tsx`:

1. Add `EaLevel` to the existing `@/lib/nutrition` import block (it currently imports `eaLevel` as a value already — add the type alongside it):

```ts
import {
  computeEnergyAvailability,
  computeUnderfuelStreak,
  eaLevel,
  loggedDaysForStreak,
  STREAK_MIN_LOGGED_DAYS,
  type EaLevel,
  type NeatImbalanceContext,
  type NutritionModel,
  type NutritionTrendWarning,
} from "@/lib/nutrition";
```

2. Immediately after the existing `NutritionTrendWarningBanner` function (find it — it ends with the closing `}` after its `</section>` return), add:

```ts
export function PlanEaWarningBanner({ level, kcalPerKg }: { level: EaLevel | null; kcalPerKg: number | null }) {
  if (level !== "low" || kcalPerKg === null) return null;
  return (
    <section aria-labelledby="plan-ea-warning" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/50">
      <h2 id="plan-ea-warning" className="text-xs font-semibold text-amber-800 dark:text-amber-300">Today&apos;s target is low-energy-availability</h2>
      <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
        The prescribed target works out to {Math.round(kcalPerKg)} kcal/kg once exercise fuel is set aside — below the level the app treats as adequate.
      </p>
      <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">This is about the size of today&apos;s plan, not your logged intake — informational only, calories are unchanged.</p>
    </section>
  );
}
```

3. In `components/SyncProvider.tsx`, add `EaLevel` to the existing `import type { NeatImbalanceContext, NutritionModel, NutritionTrendWarning } from "@/lib/nutrition";` line, and add two fields to the `AppState` interface right next to the existing `nutritionTrendWarning?: NutritionTrendWarning | null;` field:

```ts
  planEaKcalPerKg?: number | null;
  planEaLevel?: EaLevel | null;
```

4. In `components/dashboard/TodayView.tsx`, add `PlanEaWarningBanner` to the existing `import { EatToday, EnergyAvailabilityTile, NutritionTrendWarningBanner, PlannedToday, ReadinessAlerts, RecentDataSummary, TodayRideCard } from "./today";` line (line 12), and render it immediately after the existing `<NutritionTrendWarningBanner warning={state.nutritionTrendWarning ?? null} />` (line ~146):

```tsx
      <NutritionTrendWarningBanner warning={state.nutritionTrendWarning ?? null} />
      <PlanEaWarningBanner level={state.planEaLevel ?? null} kcalPerKg={state.planEaKcalPerKg ?? null} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/dashboard/today.test.tsx`
Expected: PASS — all tests in this file, including the three new ones.

- [ ] **Step 5: Full check and commit**

Run: `npm run check`
Expected: 0 type errors, 0 lint errors, all tests passing (only additions vs. the pre-existing count — check the exact baseline with `git log` / the most recent merged PR's reported count, since other concurrent work may have landed).

```bash
git add components/SyncProvider.tsx components/dashboard/today.tsx components/dashboard/today.test.tsx components/dashboard/TodayView.tsx
git commit -m "feat(today): render the prescribed-EA warning banner

PlanEaWarningBanner, styled identically to the existing
NutritionTrendWarningBanner, next to it on the Today dashboard. Renders
only when planEaLevel === 'low' -- silent for adequate/ample/null, same
null-means-nothing-to-say contract the trend warning already uses.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Purpose (warn on prescription-side low EA, never change target) → Task 1's docstring + Global Constraints. Trigger (`planEaKcalPerKg` formula, `eaLevel()` reuse) → Task 1. Data flow (GET-only, sync route) → Task 2. UI (banner next to trend warning, low-only) → Task 3. Verification (unit tests, route coverage, component test) → each task's Steps 1-4. No spec section is unaddressed.

**Placeholder scan:** No TBD/TODO. Every step has complete, real code — no "similar to Task N" references, no "add appropriate handling" phrasing.

**Type consistency:** `planEaKcalPerKg(model: NutritionModel, bufferApplied: number): number | null` (Task 1) is called identically in Task 2 (`planEaKcalPerKg(nutritionModelForEnergy, bufferStatus.bufferApplied)`) and its return type (`number | null`) matches what Task 2 stores in `planEaKcalPerKgValue` and what Task 3's `PlanEaWarningBanner` prop (`kcalPerKg: number | null`) expects. `EaLevel` is imported consistently as a type in all three consuming files (sync route via value import of `eaLevel` + this plan adds no new type export — `EaLevel` already exists and is already imported as a value in `today.tsx`, this plan adds it as a `type` import alongside the existing value import, which TypeScript allows in one combined import statement).
