# Nutrition Early Trend Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a conservative Today-page warning when reliable 21-day evidence says weight is rising faster than intended despite estimated adherence to NodeVelo's prescription.

**Architecture:** A pure function in `lib/nutrition.ts` owns the complete evidence gate. `GET /api/sync` calls it with the existing rest/train model pair and resolved goal buffer, then Today renders the returned plain evidence without persistence or calorie changes.

**Tech Stack:** TypeScript, Next.js 16 route handlers, React 19, Vitest, Testing Library.

## Global Constraints

- Use the athlete-local `today` supplied to `GET /api/sync`; never derive user-facing today from UTC.
- Use 21 complete days before today, at least 7 weigh-ins, and at least 14 usable intake days.
- Require aggregate estimated prescription adherence in the inclusive 0.95–1.05 band.
- Trigger only when observed minus intended trend is at least 0.15 kg/week.
- Exclude a date containing unresolved activity burn; never classify it as rest.
- Resolve each historical day with the existing rest/train model pair and current goal buffer.
- The warning is informational only: no persistence, buffer change, `k` change, target change, or LLM input.
- Add no dependency and no new storage shape.

---

### Task 1: Pure evidence gate

**Files:**
- Modify: `lib/nutrition.ts`
- Test: `lib/nutrition.test.ts`

**Interfaces:**
- Consumes: existing `ModelOrResolver`, `activeBurn`, `calculateDailyTarget`, `desiredWeightTrend`, `smoothedCurrentWeightKg`, and `weightTrendPreciseFromWellness`.
- Produces: `computeNutritionTrendWarning(...): NutritionTrendWarning | null` and the exported evidence type/constants.

- [ ] **Step 1: Write failing trigger and withholding tests**

Add imports for the new function/constants and a `describe("computeNutritionTrendWarning", ...)` block. Build 21 dated wellness rows with linear weights and positive intake, plus measured-burn activities on selected dates. Cover:

```ts
expect(computeNutritionTrendWarning(validInput)).toMatchObject({
  observedKgPerWeek: expect.any(Number),
  intendedKgPerWeek: expect.any(Number),
  adherenceRatio: 1,
  weighIns: 21,
  loggedDays: 21,
});
```

Then assert `null` independently for 6 weigh-ins, 13 usable intake days, adherence `0.94`, adherence `1.06`, trend error below `0.15`, and an unresolved-burn date that reduces usable days below 14. Include an exact-boundary case proving `0.15` and `0.95`/`1.05` are inclusive; avoid `.x5` fixture arithmetic by deriving weights from an unambiguous slope.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run lib/nutrition.test.ts`

Expected: FAIL because `computeNutritionTrendWarning` and its constants are not exported.

- [ ] **Step 3: Implement the minimum pure function**

Add beside the existing historical nutrition signals:

```ts
export const TREND_WARNING_WINDOW_DAYS = 21;
export const TREND_WARNING_MIN_WEIGH_INS = 7;
export const TREND_WARNING_MIN_LOGGED_DAYS = 14;
export const TREND_WARNING_ADHERENCE_MIN = 0.95;
export const TREND_WARNING_ADHERENCE_MAX = 1.05;
export const TREND_WARNING_ERROR_KG_PER_WEEK = 0.15;

export interface NutritionTrendWarning {
  observedKgPerWeek: number;
  intendedKgPerWeek: number;
  adherenceRatio: number;
  weighIns: number;
  loggedDays: number;
}

export function computeNutritionTrendWarning(
  wellness: WellnessEntry[],
  activities: Array<Pick<ActivitySummary, "date" | "activeBurnKcal" | "kj">>,
  modelOrResolver: ModelOrResolver,
  today: string,
  targetWeightKg: number,
  targetRateKgPerWeek: number | null,
  bufferApplied: number
): NutritionTrendWarning | null
```

Inside it:

1. Filter evidence to `[today - 21 days, today)` before counting or estimating.
2. Require 7 non-null weights and calculate the precise Theil–Sen trend from only that bounded series.
3. Aggregate measured burn by date; mark the whole date unusable if any activity burn is unresolved.
4. Keep positive-intake, resolved-burn days; require 14.
5. For each day, resolve rest from `burn === 0`, call `calculateDailyTarget(burn, model, bufferApplied, burn === 0)`, and sum intake and `dailyTarget`.
6. Require aggregate adherence inside 0.95–1.05 inclusive.
7. Resolve current smoothed weight and `desiredWeightTrend`; return `null` unless `observed - intended >= 0.15`.
8. Return ratios/trends rounded only for the evidence object; perform gates on unrounded values.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run lib/nutrition.test.ts`

Expected: all nutrition tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add lib/nutrition.ts lib/nutrition.test.ts
git commit -m "feat(nutrition): detect early goal-trend mismatch"
```

---

### Task 2: Sync wiring and Today warning

**Files:**
- Modify: `app/api/sync/route.ts`
- Test: `app/api/sync/route.test.ts`
- Modify: `components/SyncProvider.tsx`
- Modify: `components/dashboard/today.tsx`
- Create: `components/dashboard/today.test.tsx`
- Modify: `components/dashboard/TodayView.tsx`
- Modify: `docs/systems/09-nutrition.md`
- Modify: `FEATURES.md`
- Modify: `todo.md`
- Modify: `ARCHIVE.md`
- Modify: `docs/superpowers/specs/2026-08-03-nutrition-early-trend-warning-design.md`

**Interfaces:**
- Consumes: Task 1's `computeNutritionTrendWarning` and `NutritionTrendWarning`.
- Produces: optional `AppState.nutritionTrendWarning`, the `NutritionTrendWarningBanner` component, route response wiring, and shipped documentation.

- [ ] **Step 1: Write failing route and component tests**

In `app/api/sync/route.test.ts`, configure a derived nutrition profile and 21-day synced history that satisfies Task 1. Call `GET(new Request(`/api/sync?today=${TODAY}`))` and assert:

```ts
const body = await response.json();
expect(body.nutritionTrendWarning).toMatchObject({
  adherenceRatio: expect.any(Number),
  loggedDays: 21,
});
```

Also call GET with a different explicit local date whose bounded window is insufficient and assert `nutritionTrendWarning` is `null`; this pins date forwarding rather than server UTC.

In `components/dashboard/today.test.tsx`, render a small exported presentational component with `renderToStaticMarkup`:

```tsx
const html = renderToStaticMarkup(<NutritionTrendWarningBanner warning={warning} />);
expect(html).toContain("Weight trend needs attention");
expect(html).toContain("Calories are unchanged");
expect(html).toContain("estimated prescription adherence");
expect(renderToStaticMarkup(<NutritionTrendWarningBanner warning={null} />)).toBe("");
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run app/api/sync/route.test.ts components/dashboard/today.test.tsx`

Expected: FAIL because the route field and component do not exist.

- [ ] **Step 3: Wire the route and client type**

In `GET /api/sync`, reuse the already-resolved `nutritionModelsByDayType`, smoothed current weight and `resolveBuffer` inputs. Compute:

```ts
const nutritionTrendWarning = computeNutritionTrendWarning(
  lastSync?.wellness ?? [],
  lastSync?.activities ?? [],
  (isRestDay) => isRestDay ? nutritionModelsByDayType.rest : nutritionModelsByDayType.train,
  today,
  profile.nutrition.targetWeightKg,
  profile.nutrition.targetRateKgPerWeek,
  bufferStatus.bufferApplied
);
```

Return the field from GET only. Add `nutritionTrendWarning?: NutritionTrendWarning | null` to `AppState`; do not add POST merge code because the existing query invalidation refetches GET after sync.

- [ ] **Step 4: Render one accessible informational banner**

Export `NutritionTrendWarningBanner` from `components/dashboard/today.tsx`. Return `null` for no warning. For evidence, render an amber bordered panel with heading `Weight trend needs attention`, a concise line containing signed observed/intended kg/week and rounded adherence percent with `loggedDays`/`weighIns`, followed by:

```text
Calories are unchanged while maintenance calibration gathers stronger evidence.
```

Label adherence exactly `estimated prescription adherence`. Use semantic text and existing amber design tokens; no dismiss state or interaction.

Mount it once in `TodayView`, below `ReadinessAlerts` and `LoadingPrompt` and before the pre/post mode branch:

```tsx
<NutritionTrendWarningBanner warning={state.nutritionTrendWarning ?? null} />
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx vitest run app/api/sync/route.test.ts components/dashboard/today.test.tsx lib/nutrition.test.ts`

Expected: all focused tests pass.

- [ ] **Step 6: Update owned documentation**

In `docs/systems/09-nutrition.md`, document the 21-day evidence gate, approximate historical-adherence limitation, and strict no-auto-adjust behavior. Add one user-facing line to `FEATURES.md`. Move the completed TODO line to a concise dated `ARCHIVE.md` entry. Set the design spec status to `Shipped 2026-08-03`. Do not edit the immutable implementation plan after execution begins.

- [ ] **Step 7: Run the full gate**

Run: `npm run check`

Expected: TypeScript, lint, and all tests pass.

- [ ] **Step 8: Commit Task 2**

```bash
git add app/api/sync/route.ts app/api/sync/route.test.ts components/SyncProvider.tsx components/dashboard/today.tsx components/dashboard/today.test.tsx components/dashboard/TodayView.tsx docs/systems/09-nutrition.md FEATURES.md todo.md ARCHIVE.md docs/superpowers/specs/2026-08-03-nutrition-early-trend-warning-design.md
git commit -m "feat(nutrition): surface early weight-trend warning"
```

---

### Task 3: Review and integration

**Files:**
- Review only: complete branch diff from `origin/main`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: reviewed, verified task branch integrated through the repository's hybrid workflow.

- [ ] **Step 1: Run a separate whole-branch review**

Have the reviewer inspect threshold boundaries, date bounds, unresolved-burn handling, historical day-type selection, accessibility, copy honesty, and whether any path changes calories or persistence. Fix every Critical/Important finding and rerun focused tests.

- [ ] **Step 2: Verify branch cleanliness and integration gate**

Run:

```bash
git status --short
npm run finish:agent-task
```

Expected: clean committed task branch; local `npm run check` passes; branch pushes; a PR opens; squash auto-merge is enabled. Never merge manually.

