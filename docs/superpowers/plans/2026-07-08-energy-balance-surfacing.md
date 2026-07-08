# Energy-Balance Surfacing (§6, part a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute the precise weekly intake-vs-need ratio (logged kcal in vs. the app's own deterministic daily targets + ride kJ out), surface it on Trends and in `CoachSnapshot.fuel` — closing ROADMAP #1's last reserved slot.

**Architecture:** Extend the existing complete-weeks aggregator (`weeklyEnergy` in `lib/trends.ts`) with a day-matched need column and ratio, band it in `lib/nutrition.ts` next to `eaLevel`, and thread the latest complete week through `resolveCoachSignals` → `CoachSnapshot.fuel` with a documented precedence: **the weekly ratio owns `fuelingState` when present; the daily EA proxy remains the fallback** (one verdict, never two disagreeing ones — UX-CONSTITUTION §4 discipline). "Need" is the app's own formula (`baseCalories + day's ride kJ + buffer` on ride days, `restDayTarget` otherwise), summed **only over days with logged intake**, so under-logging reads as "not enough data," never as a fake deficit.

**Out of scope (the rest of §6):** fluid/sodium/precise pre-intra-post carb targets by IF+duration — a separate later plan. The *personalised* adequate line stays Track C calibration.

**Tech Stack:** TypeScript 5, Vitest, Next.js 16 route handlers, React 19. No new dependencies.

## Global Constraints

- Run everything with `npm`. Full verify: `npx tsc --noEmit && npm run lint && npm run build && npm test` (or `npm run check`).
- "Today" is the client's resolved local date (`resolveToday` server-side, `localToday()` client-side) — never inline `toISOString().slice(0,10)` for "now". Pure day-math on already-resolved dates may stay UTC-anchored.
- Sparse-field convention: optional fields are omitted or `null`-typed per surrounding code; read sites truthy-check new optional persisted fields, never `=== null`.
- Deterministic core / generative shell: the ratio, bands, and copy are pure code; the LLM only ever sees pre-rendered numbers in the snapshot line.
- **LLM-path smoke rule (AGENTS.md):** this plan changes the rendered CoachSnapshot prompt text → one live `/api/ask` call must be run and read before claiming done (Task 5).
- Concurrent-agent repo: commit on `main`, stage only files you touched (`git add <path>...`, never `git add -A`).
- Test fixtures: avoid expected values whose pre-rounding value sits on a `.x5` float boundary.

## File Structure

| File | Responsibility |
|---|---|
| Modify `lib/nutrition.ts` | `balanceLevel(ratio)` bands + constants (nutrition semantics live here, beside `eaLevel`) |
| Modify `lib/trends.ts` | `weeklyEnergy` gains optional settings → per-week `needKcal`/`ratio`; `latestWeeklyBalance` picker; `WeeklyEnergyBalance` type |
| Modify `lib/nutrition.test.ts`, `lib/trends.test.ts` | Unit coverage |
| Modify `lib/coach-snapshot.ts` (+ test) | `CoachSignals.weeklyBalance`, `fuel.weekBalance`, `fuelingState` precedence, prompt render line |
| Modify `app/api/trends/route.ts` | Pass nutrition settings into `weeklyEnergy` |
| Modify `app/api/sync/route.ts`, `app/api/ask/route.ts`, `app/api/generate/route.ts` | Pass `weeklyBalance` input to `resolveCoachSignals` (every call site — grep, don't assume three) |
| Modify `components/Trends.tsx` | One-line latest-week balance readout under the fueling chart |
| Modify `FEATURES.md`, `README.md`, `ROADMAP.md`, `ARCHIVE.md` | Docs |

---

### Task 1: Ratio bands — `balanceLevel` in `lib/nutrition.ts`

**Files:**
- Modify: `lib/nutrition.ts` (append near `eaLevel`, end of the EA section)
- Test: `lib/nutrition.test.ts`

**Interfaces:**
- Produces: `balanceLevel(ratio: number): EaLevel` (reuses the existing `EaLevel = "low" | "adequate" | "ample"` so the UI vocabulary stays single); constants `BALANCE_LOW_BELOW = 0.9`, `BALANCE_AMPLE_ABOVE = 1.05`.

- [ ] **Step 1: Write the failing test** (append to the existing EA describe-block's file)

```ts
describe("balanceLevel", () => {
  it("bands the weekly intake-vs-need ratio", () => {
    expect(balanceLevel(0.85)).toBe("low");
    expect(balanceLevel(0.9)).toBe("adequate"); // boundary is inclusive-adequate
    expect(balanceLevel(1.0)).toBe("adequate");
    expect(balanceLevel(1.05)).toBe("adequate"); // upper boundary still adequate
    expect(balanceLevel(1.2)).toBe("ample");
  });
});
```

Add `balanceLevel` to the file's existing `./nutrition` import.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/nutrition.test.ts`
Expected: FAIL — `balanceLevel` not exported.

- [ ] **Step 3: Implement** (append after `eaLevel` in `lib/nutrition.ts`)

```ts
// Weekly energy-balance band (§6): intake ÷ the app's OWN prescribed need for the same logged days.
// Unlike eaLevel (a kcal/kg body-weight proxy), this is a precise ratio against the deterministic
// daily-target formula — so 1.0 means "ate what the coach's formula advised" (which already embeds the
// weight-goal buffer), not raw thermodynamic balance. Bands deliberately coarse; the personalised
// adequate line is Track C calibration.
export const BALANCE_LOW_BELOW = 0.9;
export const BALANCE_AMPLE_ABOVE = 1.05;
export function balanceLevel(ratio: number): EaLevel {
  if (ratio < BALANCE_LOW_BELOW) return "low";
  if (ratio > BALANCE_AMPLE_ABOVE) return "ample";
  return "adequate";
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/nutrition.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/nutrition.ts lib/nutrition.test.ts
git commit -m "feat(nutrition): balanceLevel bands for the weekly intake-vs-need ratio (§6)"
```

---

### Task 2: Day-matched weekly need + ratio in `lib/trends.ts`

**Files:**
- Modify: `lib/trends.ts` (the `WeeklyEnergyPoint` / `weeklyEnergy` section, ~lines 55–107)
- Test: `lib/trends.test.ts`

**Interfaces:**
- Consumes: `NutritionSettings` type (`{ baseCalories, restDayTarget, buffer, targetWeightKg }`) from `./types`.
- Produces (Task 3 relies on these exact names):
  - `WeeklyEnergyPoint` gains `needKcal: number | null; ratio: number | null; loggedDays: number`
  - `weeklyEnergy(activities, wellness, today, settings?: NutritionSettings | null): WeeklyEnergyPoint[]` — 4th arg optional; omitted → new fields `null`/`0` (existing callers unaffected until updated)
  - `interface WeeklyEnergyBalance { weekOf: string; intakeKcal: number; needKcal: number; ratio: number; loggedDays: number }`
  - `latestWeeklyBalance(points: WeeklyEnergyPoint[], today: string): WeeklyEnergyBalance | null` — the immediately-prior complete week, or null if it's missing/under-logged
  - `MIN_LOGGED_DAYS_FOR_BALANCE = 4`

- [ ] **Step 1: Write the failing test** (append to `lib/trends.test.ts`, reusing its existing `ActivitySummary`/`WellnessEntry` fixture helpers if present — check the top of the file first)

```ts
describe("weeklyEnergy balance columns", () => {
  const settings = { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 70 };
  // Week Mon 2026-06-22 … Sun 2026-06-28; today Wed 2026-07-01 → that week is complete.
  const wellness = [
    // 5 logged-intake days (2500 each), 2 unlogged (null)
    { date: "2026-06-22", kcalConsumed: 2500 }, // rest day
    { date: "2026-06-23", kcalConsumed: 2500 }, // ride day (1000 kJ)
    { date: "2026-06-24", kcalConsumed: null },
    { date: "2026-06-25", kcalConsumed: 2500 }, // rest day
    { date: "2026-06-26", kcalConsumed: 2500 }, // ride day (1500 kJ)
    { date: "2026-06-27", kcalConsumed: null }, // ride day 800 kJ — UNLOGGED, must not enter need
    { date: "2026-06-28", kcalConsumed: 2500 }, // rest day
  ].map((w) => ({ weightKg: null, hrv: null, sleepHours: null, sleepQuality: null, ctl: null, atl: null, ...w }));
  const activities = [
    { date: "2026-06-23", kj: 1000 },
    { date: "2026-06-26", kj: 1500 },
    { date: "2026-06-27", kj: 800 },
  ].map((a) => makeActivity(a)); // use the file's existing activity fixture helper (type "Ride")

  it("computes need day-matched to logged-intake days and the ratio", () => {
    const [week] = weeklyEnergy(activities, wellness, "2026-07-01", settings);
    // need = 3 rest days × 2600 + (2000+1000+300) + (2000+1500+300) = 7800 + 3300 + 3800 = 14900
    expect(week.needKcal).toBe(14900);
    expect(week.loggedDays).toBe(5);
    // intake = 5 × 2500 = 12500 → ratio 12500/14900 = 0.8389… → 0.84
    expect(week.ratio).toBe(0.84);
  });

  it("withholds the ratio below 4 logged days and without settings", () => {
    const thin = wellness.map((w, i) => (i > 2 ? { ...w, kcalConsumed: null } : w)); // 2 logged
    expect(weeklyEnergy(activities, thin, "2026-07-01", settings)[0].ratio).toBeNull();
    expect(weeklyEnergy(activities, wellness, "2026-07-01")[0].ratio).toBeNull();
  });
});

describe("latestWeeklyBalance", () => {
  it("returns the immediately-prior complete week only", () => {
    const pts = [
      { date: "2026-06-15", burnKcal: 1, intakeKcal: 1, weightKg: null, needKcal: 14000, ratio: 0.95, loggedDays: 6 },
      { date: "2026-06-22", burnKcal: 1, intakeKcal: 12500, weightKg: null, needKcal: 14900, ratio: 0.84, loggedDays: 5 },
    ];
    expect(latestWeeklyBalance(pts, "2026-07-01")).toEqual({
      weekOf: "2026-06-22", intakeKcal: 12500, needKcal: 14900, ratio: 0.84, loggedDays: 5,
    });
    // Prior week under-logged (ratio null) → withheld, NOT the older week substituted
    const gap = [pts[0], { ...pts[1], ratio: null }];
    expect(latestWeeklyBalance(gap, "2026-07-01")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/trends.test.ts`
Expected: FAIL — new fields/functions missing.

- [ ] **Step 3: Implement in `lib/trends.ts`**

Extend the interface:

```ts
export interface WeeklyEnergyPoint {
  date: string; // Monday of the week
  burnKcal: number | null;
  intakeKcal: number | null;
  weightKg: number | null;
  // §6 energy balance — filled only when nutrition settings are supplied AND the week has enough
  // logged-intake days. Need is DAY-MATCHED: summed only over days whose intake was logged, so
  // under-logging withholds the ratio instead of faking a deficit.
  needKcal: number | null;
  ratio: number | null; // intakeKcal / needKcal, 2 dp
  loggedDays: number;
}

export const MIN_LOGGED_DAYS_FOR_BALANCE = 4; // a weekly verdict needs most of the week logged

export interface WeeklyEnergyBalance {
  weekOf: string;
  intakeKcal: number;
  needKcal: number;
  ratio: number;
  loggedDays: number;
}
```

Rework `weeklyEnergy` (same aggregation pass; the week map gains per-day matched fields):

```ts
export function weeklyEnergy(
  activities: ActivitySummary[],
  wellness: WellnessEntry[],
  today: string,
  settings?: NutritionSettings | null
): WeeklyEnergyPoint[] {
  const currentMonday = mondayOf(today);
  // Burn for the NEED formula counts every activity carrying kJ (same convention as the EA proxy —
  // a strength session costs energy too); the chart's burn series stays rides-only as before.
  const needBurnByDate = new Map<string, number>();
  for (const a of activities) {
    if (a.kj === null) continue;
    needBurnByDate.set(a.date, (needBurnByDate.get(a.date) ?? 0) + a.kj);
  }
  const wk = new Map<string, { burn: number; burnN: number; intake: number; intakeN: number; weights: number[]; need: number; logged: number }>();
  const getW = (monday: string) => {
    let e = wk.get(monday);
    if (!e) {
      e = { burn: 0, burnN: 0, intake: 0, intakeN: 0, weights: [], need: 0, logged: 0 };
      wk.set(monday, e);
    }
    return e;
  };
  for (const a of activities) {
    if (a.type !== "Ride" && a.type !== "VirtualRide") continue;
    if (a.kj === null) continue;
    const e = getW(mondayOf(a.date));
    e.burn += a.kj;
    e.burnN += 1;
  }
  for (const w of wellness) {
    const e = getW(mondayOf(w.date));
    if (w.kcalConsumed !== null && w.kcalConsumed > 0) {
      e.intake += w.kcalConsumed;
      e.intakeN += 1;
      // Day-matched need: the app's own daily-target formula for THIS day. Flat config buffer — the
      // live formula's weight-trend adjustment is a *current* steering signal, unknowable for past
      // weeks; ±150 kcal/day noise is inside the bands' coarseness.
      if (settings) {
        const dayBurn = needBurnByDate.get(w.date) ?? 0;
        e.need += dayBurn > 0 ? settings.baseCalories + dayBurn + settings.buffer : settings.restDayTarget;
        e.logged += 1;
      }
    }
    if (w.weightKg !== null) e.weights.push(w.weightKg);
  }
  return [...wk.entries()]
    .filter(([date]) => date < currentMonday) // complete weeks only
    .map(([date, e]) => {
      const hasBalance = settings != null && e.logged >= MIN_LOGGED_DAYS_FOR_BALANCE && e.need > 0;
      return {
        date,
        burnKcal: e.burnN > 0 ? Math.round(e.burn) : null,
        intakeKcal: e.intakeN > 0 ? Math.round(e.intake) : null,
        weightKg: e.weights.length > 0 ? Math.round(median(e.weights) * 10) / 10 : null,
        needKcal: hasBalance ? Math.round(e.need) : null,
        ratio: hasBalance ? Math.round((e.intake / e.need) * 100) / 100 : null,
        loggedDays: e.logged,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// The snapshot's slot wants exactly ONE honest number: the week that just closed. An older week is
// stale coaching context, so a missing/under-logged prior week withholds (null) rather than substitutes.
export function latestWeeklyBalance(points: WeeklyEnergyPoint[], today: string): WeeklyEnergyBalance | null {
  const priorMonday = new Date(Date.parse(mondayOf(today)) - 7 * 86_400_000).toISOString().slice(0, 10); // pure day math
  const p = points.find((x) => x.date === priorMonday);
  return p && p.ratio !== null && p.needKcal !== null && p.intakeKcal !== null
    ? { weekOf: p.date, intakeKcal: p.intakeKcal, needKcal: p.needKcal, ratio: p.ratio, loggedDays: p.loggedDays }
    : null;
}
```

Add `NutritionSettings` to the `./types` import. **Behavior note:** intake now requires `> 0` (was `!== null`) — this matches the EA proxy's "a 0-kcal day is unlogged, not fasted" convention; if an existing trends test pinned a 0-intake fixture, update it citing that convention.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/trends.test.ts && npx tsc --noEmit`
Expected: PASS; compile clean (the optional 4th arg breaks no caller).

- [ ] **Step 5: Commit**

```bash
git add lib/trends.ts lib/trends.test.ts
git commit -m "feat(trends): day-matched weekly need + intake-vs-need ratio on weeklyEnergy (§6)"
```

---

### Task 3: CoachSnapshot — fill #1's last slot

**Files:**
- Modify: `lib/coach-snapshot.ts` (interfaces ~55–121, `resolveCoachSignals` ~126–162, fuel build ~266, prompt render ~392)
- Test: `lib/coach-snapshot.test.ts`

**Interfaces:**
- Consumes: `WeeklyEnergyBalance` from `./trends`; `balanceLevel` from `./nutrition`.
- Produces:
  - `CoachSignals.weeklyBalance: WeeklyEnergyBalance | null`
  - `resolveCoachSignals(..., weeklyBalance: WeeklyEnergyBalance | null = null)` — appended as the **last** parameter (callers compute it; this function stays IO-free)
  - `CoachSnapshot.fuel.weekBalance: { weekOf: string; intakeKcal: number; needKcal: number; ratio: number } | null`
  - `fuelingState` precedence: weekly ratio band when `weekBalance` present, else EA band, else null.

- [ ] **Step 1: Write the failing test** (append to `lib/coach-snapshot.test.ts`, reusing its existing snapshot-input builder — read the file's helpers first and construct through them)

```ts
describe("weekly energy balance in the fuel slot (§6 / #1)", () => {
  const wb = { weekOf: "2026-06-22", intakeKcal: 12500, needKcal: 14900, ratio: 0.84, loggedDays: 5 };

  it("weekBalance fills and the weekly ratio owns fuelingState over the EA band", () => {
    // Build an input where energyAvailability would band "adequate" (eaKcalPerKg 30) but the
    // weekly ratio is low (0.84) — the precise signal must win.
    const snap = buildCoachSnapshot(inputWith({ weeklyBalance: wb, energyAvailability: { eaKcalPerKg: 30, daysUsed: 5, trend: null } }));
    expect(snap.fuel.weekBalance).toEqual({ weekOf: "2026-06-22", intakeKcal: 12500, needKcal: 14900, ratio: 0.84 });
    expect(snap.fuel.fuelingState).toBe("low");
  });

  it("falls back to the EA band when no weekly balance exists", () => {
    const snap = buildCoachSnapshot(inputWith({ weeklyBalance: null, energyAvailability: { eaKcalPerKg: 30, daysUsed: 5, trend: null } }));
    expect(snap.fuel.weekBalance).toBeNull();
    expect(snap.fuel.fuelingState).toBe("adequate");
  });

  it("renders the week line in the prompt only when present", () => {
    const withLine = renderCoachSnapshot(buildCoachSnapshot(inputWith({ weeklyBalance: wb })));
    expect(withLine).toContain("last week 12,500 kcal vs 14,900 needed (ratio 0.84 — low)");
    const without = renderCoachSnapshot(buildCoachSnapshot(inputWith({ weeklyBalance: null, energyAvailability: null })));
    expect(without).not.toContain("last week");
  });
});
```

(`inputWith` = whatever minimal-input helper the file already uses — mirror it; `renderCoachSnapshot` = the file's existing prompt-render export, check its real name at ~line 340 where the "fuel slots … not rendered while null" comment sits.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/coach-snapshot.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement in `lib/coach-snapshot.ts`**

1. `CoachSignals` gains (after `energyAvailability`):

```ts
  // §6: the precise intake-vs-need read for the week that just closed (day-matched, complete weeks
  // only — lib/trends.ts latestWeeklyBalance). Null when the prior week was under-logged. When
  // present it OWNS fuelingState; the daily EA proxy is the fallback band (one verdict, two sources,
  // documented precedence — never two disagreeing fuel verdicts in one snapshot).
  weeklyBalance: WeeklyEnergyBalance | null;
```

2. `resolveCoachSignals` — append the parameter and thread it (and add `weeklyBalance: null` to the early `if (!sync) return {...}` null-object):

```ts
  weeklyBalance: WeeklyEnergyBalance | null = null
): CoachSignals {
  ...
    energyAvailability: computeEnergyAvailability(sync.wellness, sync.activities, today ?? utcToday()),
    weeklyBalance,
    ftpRetest: detectFtpRetest(scoreEntries, today ?? utcToday(), currentFtp),
```

3. `CoachSnapshot["fuel"]` gains `weekBalance: { weekOf: string; intakeKcal: number; needKcal: number; ratio: number } | null;` and the build site (~266) becomes:

```ts
    fuel: {
      todayTargetKcal: ...,   // unchanged
      rideBurnKj: ...,        // unchanged
      weightTrend7dKg: ...,   // unchanged
      intakeVsNeed: input.energyAvailability?.eaKcalPerKg ?? null, // EA kcal/kg (Track C / #1)
      weekBalance: input.weeklyBalance
        ? { weekOf: input.weeklyBalance.weekOf, intakeKcal: input.weeklyBalance.intakeKcal, needKcal: input.weeklyBalance.needKcal, ratio: input.weeklyBalance.ratio }
        : null,
      // Precedence: precise weekly ratio > daily EA proxy band > null (see CoachSignals.weeklyBalance).
      fuelingState: input.weeklyBalance
        ? balanceLevel(input.weeklyBalance.ratio)
        : input.energyAvailability
          ? eaLevel(input.energyAvailability.eaKcalPerKg)
          : null,
    },
```

4. Prompt render (~392, inside the `fuelParts` assembly, after the `fuelingState` part):

```ts
  if (s.fuel.weekBalance) {
    const wb = s.fuel.weekBalance;
    fuelParts.push(
      `last week ${wb.intakeKcal.toLocaleString()} kcal vs ${wb.needKcal.toLocaleString()} needed (ratio ${wb.ratio.toFixed(2)} — ${balanceLevel(wb.ratio)})`
    );
  }
```

Imports: `import { balanceLevel, eaLevel } from "./nutrition";` (eaLevel is already imported — extend the line) and `import type { WeeklyEnergyBalance } from "./trends";`.

- [ ] **Step 4: Update every `resolveCoachSignals` call site**

Run: `grep -rn "resolveCoachSignals(" app lib --include="*.ts" | grep -v test | grep -v "export function"`
Expected sites: `app/api/sync/route.ts`, `app/api/ask/route.ts`, `app/api/generate/route.ts` (verify — update **all** hits). At each, compute and pass the final argument:

```ts
  latestWeeklyBalance(weeklyEnergy(sync?.activities ?? [], sync?.wellness ?? [], today, profile.nutrition), today)
```

with `import { latestWeeklyBalance, weeklyEnergy } from "@/lib/trends";`. Each of these routes already loads the athlete profile for other reasons — verify (`grep -n readAthleteProfile <route>`); if one genuinely doesn't, add it to that route's existing parallel loads. Pass `null` only where sync is absent.

- [ ] **Step 5: Run tests**

Run: `npx vitest run lib/coach-snapshot.test.ts app/api/sync/route.test.ts app/api/ask/route.test.ts app/api/generate/route.test.ts && npx tsc --noEmit`
Expected: PASS (route tests may need their mocks extended with `profile.nutrition` — follow each file's existing profile mock).

- [ ] **Step 6: Commit**

```bash
git add lib/coach-snapshot.ts lib/coach-snapshot.test.ts app/api/sync/route.ts app/api/ask/route.ts app/api/generate/route.ts
git commit -m "feat(snapshot): weekly intake-vs-need ratio fills #1's last fuel slot; weekly ratio owns fuelingState"
```

---

### Task 4: Surfacing — Trends payload + readout

**Files:**
- Modify: `app/api/trends/route.ts` (line ~47)
- Modify: `components/Trends.tsx` (fueling & weight section, series at ~66/75)

- [ ] **Step 1: Pass settings in the route**

At `app/api/trends/route.ts:47` (the route already loads `readAthleteProfile()` at line ~24 — confirm the local name, likely `profile`):

```ts
  const energy = weeklyEnergy(sync?.activities ?? [], sync?.wellness ?? [], today, profile.nutrition);
```

- [ ] **Step 2: Add the latest-week readout in `components/Trends.tsx`**

The `WeeklyEnergyPoint` fields arrive in `data.energy`. Directly under the fueling & weight chart markup (locate the section containing the two series built at lines ~66/75), add:

```tsx
      {(() => {
        const withRatio = data.energy.filter((e) => e.ratio != null);
        const last = withRatio[withRatio.length - 1];
        if (!last) return null;
        const pct = Math.round((last.ratio as number) * 100);
        return (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Last complete week: {last.intakeKcal?.toLocaleString()} kcal eaten vs{" "}
            {last.needKcal?.toLocaleString()} needed — {pct}% of target ({last.loggedDays}/7 days logged).
          </p>
        );
      })()}
```

(Here the *latest available* ratio week is correct — this is a trends surface, not the snapshot's "week just closed" slot. Match the section's existing caption classes if they differ — check the neighbouring chart captions and reuse their exact class string.)

If `data.energy`'s client-side type is declared in the component or a shared client type, extend it with `needKcal`/`ratio`/`loggedDays` to match `WeeklyEnergyPoint`.

- [ ] **Step 3: Full verify + preview**

Run: `npm run check && npm run build` — Expected: clean.
Preview (dev on the preview port, never 3000): open `/trends`, confirm the readout renders under the fueling & weight chart in dark mode (or renders nothing when no complete logged week exists — both are correct); screenshot as proof.

- [ ] **Step 4: Commit**

```bash
git add app/api/trends/route.ts components/Trends.tsx
git commit -m "feat(trends): weekly energy-balance readout under the fueling & weight chart (§6)"
```

---

### Task 5: Live LLM smoke run + docs

**Files:**
- Modify: `FEATURES.md`, `README.md`, `ROADMAP.md`, `ARCHIVE.md`

- [ ] **Step 1: Live smoke run (AGENTS.md rule — the snapshot prompt text changed)**

With the dev server running and a real Anthropic key configured, POST one Ask-Coach question (`/api/ask`, e.g. "how was my fueling last week?") and **read the reply**: it must reference the pre-computed weekly numbers (or say nothing about them when `weekBalance` is null) and must not invent kcal figures. Paste the reply into the commit body or PR notes. This is a billed call — run it once, deliberately.

- [ ] **Step 2: Docs**

- `FEATURES.md` → Nutrition section:
  ```md
  - **Weekly energy balance (§6)** — precise intake-vs-need ratio per complete week (need = the app's
    own daily-target formula, day-matched to logged days), banded low/adequate/ample; owns the
    snapshot's `fuelingState` when present (EA proxy is the fallback). Trends readout + CoachSnapshot.
    `lib/trends.ts`, `lib/nutrition.ts`
  ```
- `README.md` → in "Nutrition is code, not AI", one sentence: the weekly intake-vs-need ratio is computed day-matched against the app's own prescribed targets and only phrased by the LLM.
- `ROADMAP.md` → `§6`: part (a) (weekly ratio → fuelingState) shipped → ARCHIVE; §6 keeps the fluid/sodium/precise-timing targets as the remaining open scope. `#1`: the reserved-slots item is now fully closed — collapse it to its cross-ref-handle line ("#1 stays as the cross-ref handle; slots all filled → ARCHIVE").
- `ARCHIVE.md` → entry "Weekly energy-balance surfacing — §6 part (a) / closes #1's last slot (2026-07-08)": day-matched need formula + withholding rules (≥4 logged days, prior-week-only for the snapshot), fuelingState precedence decision, surfaces (Trends readout, snapshot prompt line), live smoke-run confirmation. Plan: `docs/superpowers/plans/2026-07-08-energy-balance-surfacing.md`.

- [ ] **Step 3: Commit (docs separate)**

```bash
git add FEATURES.md README.md ROADMAP.md ARCHIVE.md
git commit -m "docs: weekly energy-balance surfacing shipped (§6a) — #1 reserved slots closed"
```

---

## Self-review notes (already applied)

- **Spec coverage:** precise weekly kJ-out-vs-intake ratio ✓ (Task 2) · → `fuelingState` ✓ (Task 3 precedence) · #1 slot closed ✓ (fuel.weekBalance + prompt line) · Trends surfacing ✓ (Task 4) · fluid/sodium explicitly out ✓ (header + ROADMAP note).
- **Honesty guards:** day-matched need (under-logging → withheld, not a fake deficit); ≥4 logged days; snapshot slot = prior week only, never a stale older week; one `fuelingState` verdict with documented precedence.
- **Deliberate simplifications:** flat config buffer for past weeks (weight-trend adjustment is a current-steering signal, ±150 kcal inside band coarseness); ratio vs the app's own target rather than raw thermodynamic balance (the target already encodes the athlete's weight goal — that's the coaching-relevant reference).
- **Type consistency:** `WeeklyEnergyBalance { weekOf, intakeKcal, needKcal, ratio, loggedDays }` defined once (Task 2), consumed with those names in Task 3; `fuel.weekBalance` drops `loggedDays` deliberately (prompt brevity).
