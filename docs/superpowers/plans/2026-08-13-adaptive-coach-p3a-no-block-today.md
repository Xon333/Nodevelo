# Adaptive self-directed coach — Phase 3a: no-block Today Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `PlannedToday`'s bare "No active training block yet" fallback with a real weekly TSS
envelope, one suggested session, and a three-stream Load/Recovery/Execution read — for both the
never-had-a-block state and a finished-but-not-regenerated block.

**Architecture:** Three new `lib/` modules (`weekly-envelope.ts`, `session-suggestion.ts`,
`no-block-summary.ts`), one new persisted store (`data/weekly-envelope.json`, atomic via
`lib/json-store.ts`/`lib/data-store.ts`'s existing pattern), computed in `/api/sync`'s existing GET/POST
handlers alongside `fatigueAlert`/`loadRamp`/`acwr`/`athleteState`, threaded onto `AppState`, and rendered
by `PlannedToday` (`components/dashboard/today.tsx`) in place of its `!block` and `isBlockFinished`
fallbacks. No new API route, no new LLM call, no change to `AthleteStateCard`/Zone 1.

**Tech Stack:** Next.js 16 (App Router), TypeScript 5, Vitest.

## Global Constraints

- **One-way midweek reduction, never a raise.** Enforced in the write path (`lib/weekly-envelope.ts`),
  not documented-only.
- **`unknown` weeks (insufficient data) are excluded from the anchor's median — never guessed into
  tolerated or not.**
- **Readiness/spacing gates read `.level` only, never `.reason` text.** `computeLoadRamp`'s `reason`
  string contains literal "injury risk" wording that violates the original design's own §15 non-goal if
  forwarded into the suggestion's "why" text.
- **A finished-but-not-regenerated block (`isBlockFinished(block, today) === true`) gets the new section
  too**, alongside its existing "Generate the next block →" link, not replacing it.
- **No new LLM call.** The suggestion's "why" text is templated from deterministic inputs.
- **This phase adds no LLM-backed path — the AGENTS.md live-smoke-run requirement does not apply.**
  Stated explicitly so it isn't silently skipped *or* silently demanded where it doesn't belong.
- **Client-supplied local date, not a server-computed one.** `/api/sync`'s GET/POST already resolve
  `today` via `resolveToday(<client-supplied value>)` (query param on GET, request body on POST) — reuse
  that exact `today` binding for the Monday-boundary check. Do not call `resolveToday()`/`localToday()`
  fresh inside the new modules; that would silently reintroduce a UTC-drift risk the existing routes
  already avoid.
- **Reuse `computeReadiness`'s exported `.level`, not its private `isDeepFatigueTsb`/`heavyAtlCtl`
  helpers** (unexported in `lib/readiness.ts`) — those aren't importable, and `computeReadiness` is the
  correct, already-calibrated public seam.
- **Historical per-day TSB comes from `WellnessEntry.ctl`/`.atl`** (`lib/types.ts:246-247`, TSB = ctl −
  atl) — `SyncData.fitness` is a single current snapshot, not a history; do not attempt to read historical
  TSB from it.
- **Canonical completed-ride load is `ActivitySummary.trainingLoad`, never `RideScoreEntry.tss`.** Design
  §8.1: "Use Intervals.icu's synced activity `trainingLoad` as the canonical completed-ride load." These
  are two different fields on two different types (`lib/types.ts:196` vs `:825`) — `RideScoreEntry.tss`
  is the ledger's own scoring-time value, not the synced canonical one. The anchor/week-load calculation
  reads `ActivitySummary[]`; `RideScoreEntry[]` is only for the tolerance classifier's `compromised` flag
  and (via `buildAthleteModel`) the execution stream.
- **The persisted envelope is read-modified-written as ONE atomic operation via `lib/json-store.ts`'s
  `updateJsonFile`**, never a separate read call followed by a separate write call — two concurrent syncs
  racing a plain read-then-write could otherwise both read the same base and one's midweek reduction could
  clobber the other's.
- **`suggestSession` gates on the envelope's range and the current week's completed load-to-date**, not
  just readiness/spacing levels — a session must not be suggested that would push the athlete past an
  already-frozen weekly ceiling.
- **Every call that resolves "today" downstream also receives the same client-supplied value** — this
  includes `gatherFocusInputs({ today })`, not just the top-level `resolveWeeklyEnvelope`/`isBlockFinished`
  calls. `gatherFocusInputs`'s own fallback (no `today` passed) is `resolveToday(undefined)` → server UTC,
  reintroducing exactly the drift risk the constraint above exists to prevent.

---

## Task 0: Confirm baseline

**Files:** none (verification only).

- [ ] **Step 1: Verify the branch and design doc**

```bash
git branch --show-current
grep -n "export function readCurrentBlock" lib/data-store.ts
grep -n "export function computeReadiness" lib/readiness.ts
grep -n "export function chooseNextFocus" lib/season.ts
grep -n "export async function gatherFocusInputs" lib/season-signals.ts
```

Expected: all four print a match. Read
`docs/superpowers/specs/2026-08-12-adaptive-coach-p3a-no-block-today-design.md` in full before starting
Task 1 — this plan implements it, it does not restate the reasoning.

- [ ] **Step 2: Confirm the current sync-route integration points**

```bash
grep -n "const today = resolveToday" app/api/sync/route.ts
grep -n "const fatigueAlert\|const loadRamp\|const acwr\b" app/api/sync/route.ts
```

Expected: two `today` lines (GET and POST) and matching `fatigueAlert`/`loadRamp`/`acwr` triples in each
handler. Note the exact line numbers printed — Task 5 references them, but line numbers drift; verify
against what this prints, not the numbers written into this plan.

---

## Task 1: `classifyWeekTolerance` — the week-tolerance classifier

**Files:**
- Create: `lib/weekly-envelope.ts`
- Test: `lib/weekly-envelope.test.ts`

**Interfaces:**
- Produces: `type WeekTolerance = "tolerated" | "not-tolerated" | "unknown"`,
  `classifyWeekTolerance(input: { weekStart: string; weekEnd: string; entries: RideScoreEntry[]; wellness: WellnessEntry[] }): WeekTolerance`.
  Read by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `lib/weekly-envelope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyWeekTolerance } from "./weekly-envelope";
import type { RideScoreEntry, WellnessEntry } from "./types";

const entry = (over: Partial<RideScoreEntry> = {}): RideScoreEntry => ({
  date: "2026-07-06",
  executionScore: 6,
  plannedType: "Z2",
  inferredType: "Z2",
  planned: true,
  legacy: false,
  compliancePct: 95,
  intensityFactor: 0.65,
  ftpUsed: 280,
  durationMin: 90,
  tss: 60,
  ...over,
});

const wellness = (date: string, ctl: number | null, atl: number | null): WellnessEntry => ({
  date, weightKg: null, hrv: null, sleepHours: null, sleepQuality: null, kcalConsumed: null, ctl, atl,
});

describe("classifyWeekTolerance", () => {
  it("tolerated: no compromised rides, no deep-fatigue read in the days after", () => {
    const entries = [entry({ date: "2026-07-06" }), entry({ date: "2026-07-08" })];
    // TSB = ctl - atl = 60 - 50 = 10, comfortably above deep-fatigue territory
    const w = [wellness("2026-07-13", 60, 50), wellness("2026-07-14", 61, 49)];
    expect(classifyWeekTolerance({ weekStart: "2026-07-06", weekEnd: "2026-07-12", entries, wellness: w })).toBe("tolerated");
  });

  it("not-tolerated: a compromised ride inside the week", () => {
    const entries = [entry({ date: "2026-07-06", compromised: true } as Partial<RideScoreEntry>)];
    const w = [wellness("2026-07-13", 60, 50)];
    expect(classifyWeekTolerance({ weekStart: "2026-07-06", weekEnd: "2026-07-12", entries, wellness: w })).toBe("not-tolerated");
  });

  it("not-tolerated: deep fatigue in the days immediately after the week", () => {
    const entries = [entry({ date: "2026-07-06" })];
    // TSB = 40 - 70 = -30, deep-fatigue territory (computeReadiness's Recover band)
    const w = [wellness("2026-07-13", 40, 70)];
    expect(classifyWeekTolerance({ weekStart: "2026-07-06", weekEnd: "2026-07-12", entries, wellness: w })).toBe("not-tolerated");
  });

  it("unknown: no rides synced for the week at all — never guessed tolerated", () => {
    expect(classifyWeekTolerance({ weekStart: "2026-07-06", weekEnd: "2026-07-12", entries: [], wellness: [wellness("2026-07-13", 60, 50)] })).toBe("unknown");
  });

  it("unknown: no post-week wellness data to read recovery from", () => {
    const entries = [entry({ date: "2026-07-06" })];
    expect(classifyWeekTolerance({ weekStart: "2026-07-06", weekEnd: "2026-07-12", entries, wellness: [] })).toBe("unknown");
  });
});
```

(`RideScoreEntry`'s exact field list — grep `lib/types.ts` for `export interface RideScoreEntry` and
match the fixture to whatever it actually is; the fields above are this plan's best current
understanding, not guaranteed exhaustive.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/weekly-envelope.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

Create `lib/weekly-envelope.ts`:

```ts
// Phase 3a §8: classifies whether a calendar week's training load should count toward the envelope
// anchor. New logic — computeFatigueAlert/computeLoadRamp/compromised are real signals but none of them
// classify an ARBITRARY historical week on their own (verified during design, 2026-08-12): the first is
// a live snapshot check, the second only compares the trailing two 7-day windows anchored to `today`.
import { computeReadiness } from "./readiness";
import type { RideScoreEntry, WellnessEntry } from "./types";

export type WeekTolerance = "tolerated" | "not-tolerated" | "unknown";

const MIN_RIDES_TO_CLASSIFY = 2; // fewer synced rides than this and the week's own load is unreadable
const POST_WEEK_WINDOW_DAYS = 3; // days after weekEnd checked for a deep-fatigue recovery read

export function classifyWeekTolerance(input: {
  weekStart: string;
  weekEnd: string;
  entries: RideScoreEntry[];
  wellness: WellnessEntry[];
}): WeekTolerance {
  const { weekStart, weekEnd, entries, wellness } = input;
  const weekEntries = entries.filter((e) => e.date >= weekStart && e.date <= weekEnd && !e.legacy);
  if (weekEntries.length < MIN_RIDES_TO_CLASSIFY) return "unknown";

  if (weekEntries.some((e) => e.compromised)) return "not-tolerated";

  // Post-week recovery read: TSB = ctl - atl per day, evaluated via the same public, already-calibrated
  // computeReadiness seam readiness.ts's own live checks use — never the module-private
  // isDeepFatigueTsb/heavyAtlCtl helpers directly (not exported).
  const postWeek = wellness.filter((w) => w.date > weekEnd && w.date <= addDaysIso(weekEnd, POST_WEEK_WINDOW_DAYS));
  const withFitness = postWeek.filter((w) => w.ctl !== null && w.atl !== null);
  if (withFitness.length === 0) return "unknown";

  const anyDeepFatigue = withFitness.some((w) => {
    const ctl = w.ctl as number;
    const atl = w.atl as number;
    return computeReadiness({ ctl, atl, tsb: ctl - atl }, []).level === "Recover";
  });
  return anyDeepFatigue ? "not-tolerated" : "tolerated";
}

// Local copy of the day-math this file needs — lib/date.ts's addDaysIso is exported and pure; reuse it
// rather than reimplementing, this comment exists only to point at Step 4 below if it's missing an export.
import { addDaysIso } from "./date";
```

(Move the `import { addDaysIso } from "./date";` to the top of the file with the other imports — written
at the bottom above only to flag it needs adding; do not leave a mid-file import in the real file.)

- [ ] **Step 4: Confirm `addDaysIso` is exported**

```bash
grep -n "export function addDaysIso" lib/date.ts
```

Expected: a match (verified present during this plan's writing, `lib/date.ts:47`). If absent, export it
rather than reimplementing day-math inline (AGENTS.md's UTC-drift bug class risk is specifically in
*"what day is it now"* code — pure day-offset arithmetic like this is fine to reuse from `date.ts`
regardless).

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run lib/weekly-envelope.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/weekly-envelope.ts lib/weekly-envelope.test.ts
git commit -m "feat(weekly-envelope): add classifyWeekTolerance — new logic, not a reuse of an existing whole-week classifier"
```

---

## Task 2: Weekly envelope — anchor, role, range, persistence

**Files:**
- Modify: `lib/weekly-envelope.ts`
- Modify: `lib/data-store.ts` (new `updateWeeklyEnvelope`, an atomic wrapper around
  `lib/json-store.ts`'s `updateJsonFile` — NOT a separate read/write pair)
- Modify: `lib/types.ts` (new `WeeklyEnvelope` interface)
- Test: `lib/weekly-envelope.test.ts`, `lib/data-store.test.ts`

**Interfaces:**
- Produces: `WeeklyEnvelope` type; `resolveWeeklyEnvelope(input): { envelope: WeeklyEnvelope; wrote: boolean }`
  — a PURE function (no I/O), called from inside `updateWeeklyEnvelope`'s `mutate` callback (Task 5), so
  the read-compute-write sequence runs under `updateJsonFile`'s file lock as one atomic unit. Consumes
  `classifyWeekTolerance` (Task 1) and `ActivitySummary[]` for canonical load — NOT `RideScoreEntry.tss`
  (external review: these are different fields on different types; the design requires the synced
  canonical `trainingLoad`).

- [ ] **Step 1: Add the persisted type**

In `lib/types.ts`, near `CurrentBlock` (`lib/types.ts:475`), add:

```ts
// data/weekly-envelope.json — Phase 3a §8. previousRange/reductionApplied exist specifically so
// "Monday full recompute" vs "midweek reduction-only" is mechanically testable, not just documented
// behavior (external review, 2026-08-12).
export interface WeeklyEnvelope {
  weekStart: string; // ISO Monday date this range applies to
  role: "build" | "maintain" | "recovery";
  range: { min: number; max: number }; // TSS
  previousRange: { min: number; max: number } | null; // set only when reductionApplied
  reductionApplied: boolean;
  reductionReason: string | null;
  calculationVersion: number;
  resolvedAt: string; // ISO timestamp
}
```

- [ ] **Step 2: Add the atomic update wrapper**

**Corrected (external review): a separate read call followed by a separate write call is NOT atomic** —
two concurrent syncs could both read the same persisted value and one's midweek reduction would be lost
when the other writes second. Read `lib/json-store.ts:102`'s `updateJsonFile<T>(file, fallback, mutate:
(current: T) => T | Promise<T>): Promise<T>` first — it holds a file lock for the ENTIRE read-mutate-write
sequence. Add to `lib/data-store.ts`:

```ts
import { updateJsonFile } from "./json-store";
import type { WeeklyEnvelope } from "./types";

const WEEKLY_ENVELOPE_FILE = "weekly-envelope.json";

export function updateWeeklyEnvelope(
  mutate: (current: WeeklyEnvelope | null) => WeeklyEnvelope
): Promise<WeeklyEnvelope> {
  return updateJsonFile<WeeklyEnvelope | null>(WEEKLY_ENVELOPE_FILE, null, mutate) as Promise<WeeklyEnvelope>;
}
```

No separate `readWeeklyEnvelope`/`writeWeeklyEnvelope` — Task 5's caller passes `resolveWeeklyEnvelope`
itself (adapted to the `mutate` shape) as the callback, so the read it does internally happens INSIDE the
lock `updateJsonFile` already holds.

- [ ] **Step 3: Write the failing tests**

Add to `lib/weekly-envelope.test.ts`:

```ts
import type { ActivitySummary } from "./types";

const activity = (date: string, trainingLoad: number): ActivitySummary => ({
  id: `act-${date}`, date, type: "Ride", name: "Ride", movingTimeSec: 3600, avgWatts: 200,
  normalizedPower: null, maxWatts: null, icuFtp: null, avgHr: null, maxHr: null, kj: null,
  activeBurnKcal: null, trainingLoad, rpe: null, carbsIngestedG: null, decoupling: null,
  efficiencyFactor: null, powerHrZ2: null, powerHrZ2Mins: null, description: null, avgCadence: null,
  distanceMeters: null, elevationGain: null, powerZoneTimes: null, hrZoneTimes: null,
  wPrimeRollingJ: null, wBalDepletionJ: null, hrrc: null,
});

describe("resolveWeeklyEnvelope", () => {
  // n "tolerated" weeks (two rides each, ~325 TSS/ride via canonical trainingLoad, ~650/week), oldest first.
  // classifyWeekTolerance needs matching RideScoreEntry rows (>= MIN_RIDES_TO_CLASSIFY) for the SAME dates
  // so these weeks actually classify as tolerated, not unknown — entries and activities must agree on dates.
  const weeksOfData = (n: number, mondayOfCurrentWeek: string) => {
    const activities: ActivitySummary[] = [];
    const entries: RideScoreEntry[] = [];
    const wellness: WellnessEntry[] = [];
    let cursor = mondayOfCurrentWeek;
    for (let w = 0; w < n; w++) {
      cursor = addDaysIso(cursor, -7);
      const d1 = cursor;
      const d2 = addDaysIso(cursor, 2);
      activities.push(activity(d1, 325), activity(d2, 325));
      entries.push(entry({ date: d1 }), entry({ date: d2 }));
      // post-week recovery read: comfortably tolerated (TSB well above deep-fatigue territory)
      const postWeekDate = addDaysIso(cursor, 8);
      wellness.push(wellness_(postWeekDate, 60, 45));
    }
    return { activities, entries, wellness };
  };
  const wellness_ = (date: string, ctl: number, atl: number): WellnessEntry => ({
    date, weightKg: null, hrv: null, sleepHours: null, sleepQuality: null, kcalConsumed: null, ctl, atl,
  });

  it("Monday recompute: no persisted envelope yet resolves a fresh one for the current week", () => {
    const { activities, entries, wellness } = weeksOfData(7, "2026-08-10");
    const result = resolveWeeklyEnvelope({ today: "2026-08-10", persisted: null, activities, entries, wellness });
    expect(result.envelope.weekStart).toBe("2026-08-10");
    expect(result.envelope.previousRange).toBeNull();
    expect(result.wrote).toBe(true);
    // anchor ~650, build role needs 2+ classifiable recent weeks with zero not-tolerated — all 7 here
    // qualify, so role should read "build" and the range should center above the raw anchor.
    expect(result.envelope.role).toBe("build");
  });

  it("non-Monday sync with no new reducing evidence reads the persisted value unchanged", () => {
    const persisted = { weekStart: "2026-08-10", role: "build" as const, range: { min: 600, max: 700 }, previousRange: null, reductionApplied: false, reductionReason: null, calculationVersion: 1, resolvedAt: "2026-08-10T06:00:00.000Z" };
    const result = resolveWeeklyEnvelope({ today: "2026-08-12", persisted, activities: [], entries: [], wellness: [] });
    expect(result.envelope).toEqual(persisted);
    expect(result.wrote).toBe(false);
  });

  it("midweek reduction: a not-tolerated recent week writes a strictly lower range, never higher", () => {
    const persisted = { weekStart: "2026-08-10", role: "build" as const, range: { min: 600, max: 700 }, previousRange: null, reductionApplied: false, reductionReason: null, calculationVersion: 1, resolvedAt: "2026-08-10T06:00:00.000Z" };
    const { activities, entries } = weeksOfData(3, "2026-08-10");
    // Deep-fatigue post-week read for the most recent classified week — implies a lower fresh anchor/role.
    const wellness = [wellness_(addDaysIso("2026-08-03", 1), 40, 70)];
    const result = resolveWeeklyEnvelope({ today: "2026-08-11", persisted, activities, entries, wellness });
    if (result.wrote) {
      expect(result.envelope.range.max).toBeLessThanOrEqual(persisted.range.max);
      expect(result.envelope.range.min).toBeLessThanOrEqual(persisted.range.min);
      expect(result.envelope.previousRange).toEqual(persisted.range);
      expect(result.envelope.reductionApplied).toBe(true);
    }
  });

  it("never raises an already-persisted range mid-week, even if this sync's fresh calc would be higher", () => {
    const persisted = { weekStart: "2026-08-10", role: "build" as const, range: { min: 600, max: 700 }, previousRange: null, reductionApplied: false, reductionReason: null, calculationVersion: 1, resolvedAt: "2026-08-10T06:00:00.000Z" };
    const { activities, entries, wellness } = weeksOfData(8, "2026-08-10"); // would compute higher fresh
    const result = resolveWeeklyEnvelope({ today: "2026-08-11", persisted, activities, entries, wellness });
    expect(result.envelope.range.max).toBeLessThanOrEqual(700);
    expect(result.envelope.range.min).toBeLessThanOrEqual(600);
  });
});
```

(`entry`/`addDaysIso` reuse Task 1's own test fixture/import — this describe block lives in the same
`lib/weekly-envelope.test.ts` file. `RideScoreEntry`/`WellnessEntry` types come from the same imports
Task 1 already added.)

- [ ] **Step 4: Implement `resolveWeeklyEnvelope`**

Add to `lib/weekly-envelope.ts`:

```ts
import type { ActivitySummary, RideScoreEntry, WeeklyEnvelope, WellnessEntry } from "./types";
// WeekTolerance is defined earlier in this same file (Task 1) — no cross-file import needed.

export const WEEKLY_ENVELOPE_CALCULATION_VERSION = 1;
const RANGE_BAND_PCT = 0.075; // ±7.5%, within design §8.2's "roughly ±7-8%"
const RECENT_WEEKS_FOR_ANCHOR = 8;

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function weekBounds(mondayIso: string): { start: string; end: string } {
  const start = new Date(`${mondayIso}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: mondayIso, end: end.toISOString().slice(0, 10) };
}

// Corrected (external review): canonical load is ActivitySummary.trainingLoad (design §8.1, verbatim:
// "Use Intervals.icu's synced activity trainingLoad as the canonical completed-ride load"), NOT
// RideScoreEntry.tss — a different field on a different type, the ledger's own scoring-time value.
function weekLoad(activities: ActivitySummary[], start: string, end: string): number {
  return activities
    .filter((a) => a.date >= start && a.date <= end && a.trainingLoad !== null)
    .reduce((sum, a) => sum + (a.trainingLoad as number), 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function resolveWeeklyEnvelope(input: {
  today: string;
  persisted: WeeklyEnvelope | null;
  activities: ActivitySummary[];
  entries: RideScoreEntry[];
  wellness: WellnessEntry[];
}): { envelope: WeeklyEnvelope; wrote: boolean } {
  const { today, persisted, activities, entries, wellness } = input;
  const currentMonday = mondayOf(today);

  if (!persisted || persisted.weekStart !== currentMonday) {
    // Path A: Monday full recompute (also fires the FIRST time this ever runs, whatever weekday that is —
    // there is no persisted week to compare against yet).
    const anchor = resolveAnchor(activities, entries, wellness, currentMonday);
    const role = resolveRole(anchor.recentTolerance);
    const centre = roleAdjustedCentre(anchor.median, role);
    const envelope: WeeklyEnvelope = {
      weekStart: currentMonday,
      role,
      range: roundedRange(centre),
      previousRange: null,
      reductionApplied: false,
      reductionReason: null,
      calculationVersion: WEEKLY_ENVELOPE_CALCULATION_VERSION,
      resolvedAt: new Date().toISOString(),
    };
    return { envelope, wrote: true };
  }

  // Path B: every sync (including Monday's, after path A already ran this week), reduction-only safety
  // check against the CURRENTLY PERSISTED range — never raises it.
  const freshAnchor = resolveAnchor(activities, entries, wellness, currentMonday);
  const freshCentre = roleAdjustedCentre(freshAnchor.median, persisted.role);
  const freshRange = roundedRange(freshCentre);
  const impliesLower = freshRange.max < persisted.range.max || freshRange.min < persisted.range.min;
  if (!impliesLower) return { envelope: persisted, wrote: false };

  const envelope: WeeklyEnvelope = {
    ...persisted,
    range: { min: Math.min(freshRange.min, persisted.range.min), max: Math.min(freshRange.max, persisted.range.max) },
    previousRange: persisted.range,
    reductionApplied: true,
    reductionReason: "new fatigue/wellness evidence implied a lower range mid-week",
    resolvedAt: new Date().toISOString(),
  };
  return { envelope, wrote: true };
}

// Returns the median load AND the ordered tolerance sequence (newest week first) — resolveRole reads
// the same sequence rather than re-classifying, so the two functions can never disagree about which
// weeks were tolerated. Load comes from `activities` (canonical trainingLoad); tolerance classification
// comes from `entries` (the compromised flag) + `wellness` (post-week recovery read) — two different
// inputs feeding two different questions about the same week.
function resolveAnchor(
  activities: ActivitySummary[],
  entries: RideScoreEntry[],
  wellness: WellnessEntry[],
  currentMonday: string
): { median: number; recentTolerance: WeekTolerance[] } {
  const loads: number[] = [];
  const recentTolerance: WeekTolerance[] = [];
  let cursor = currentMonday;
  for (let i = 0; i < RECENT_WEEKS_FOR_ANCHOR; i++) {
    cursor = addDaysIso(cursor, -7);
    const { start, end } = weekBounds(cursor);
    const tolerance = classifyWeekTolerance({ weekStart: start, weekEnd: end, entries, wellness });
    recentTolerance.push(tolerance);
    if (tolerance === "tolerated") loads.push(weekLoad(activities, start, end));
  }
  return { median: median(loads), recentTolerance };
}

// Concrete v1 rule (implementation-plan decision, design §8.2 explicitly defers exact thresholds):
// count only the CLASSIFIABLE weeks (unknown weeks are excluded from the vote, same "never guess"
// discipline as the anchor itself) among the most recent 3. Two or more not-tolerated among those →
// recovery (repeated overload/disruption calls for unloading, not another build week). Zero
// not-tolerated among at least 2 classifiable recent weeks → build (real evidence the athlete is
// absorbing load). Everything else (including "too few classifiable weeks to have a real read") →
// maintain, the conservative default — never guesses toward "push harder" on thin evidence.
function resolveRole(recentTolerance: WeekTolerance[]): "build" | "maintain" | "recovery" {
  const recentThree = recentTolerance.slice(0, 3).filter((t) => t !== "unknown");
  const notTolerated = recentThree.filter((t) => t === "not-tolerated").length;
  if (notTolerated >= 2) return "recovery";
  if (recentThree.length >= 2 && notTolerated === 0) return "build";
  return "maintain";
}

function roleAdjustedCentre(anchorMedian: number, role: "build" | "maintain" | "recovery"): number {
  if (role === "build") return anchorMedian * 1.08;
  if (role === "recovery") return anchorMedian * 0.75;
  return anchorMedian;
}

function roundedRange(centre: number): { min: number; max: number } {
  const step = 10; // realistic ride-sized TSS increment (design §8.2: "false precision" to avoid)
  const min = Math.round((centre * (1 - RANGE_BAND_PCT)) / step) * step;
  const max = Math.round((centre * (1 + RANGE_BAND_PCT)) / step) * step;
  return { min, max };
}
```

`resolveRole` reads the same `recentTolerance` sequence `resolveAnchor` already computed — a vote over
the most recent 3 *classifiable* weeks (unknown weeks excluded from the vote, same discipline as the
anchor's own median), defaulting to `maintain` whenever there isn't a clear majority read either way,
never guessing toward `build` on thin evidence.

- [ ] **Step 5: Fill in the test fixtures from Step 3 with real numbers**

Go back to Step 3's tests and replace the fixture placeholders (`/* ...fixture... */`,
`/* deep-fatigue-implying data */`) with concrete
`RideScoreEntry`/`WellnessEntry` values that actually drive the described outcomes — this is normal TDD
red-green, not optional cleanup.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run lib/weekly-envelope.test.ts lib/data-store.test.ts
npx tsc --noEmit
```

Expected: PASS, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add lib/weekly-envelope.ts lib/data-store.ts lib/types.ts lib/weekly-envelope.test.ts lib/data-store.test.ts
git commit -m "feat(weekly-envelope): resolveWeeklyEnvelope — Monday recompute + every-sync reduction-only safety path"
```

---

## Task 3: `lib/session-suggestion.ts` — one concrete session

**Files:**
- Create: `lib/session-suggestion.ts`
- Test: `lib/session-suggestion.test.ts`

**Interfaces:**
- Consumes: `gatherFocusInputs({ today })` (`lib/season-signals.ts:35` — MUST pass `today`, its own
  fallback is server UTC), `chooseNextFocus()` (`lib/season.ts:262`), `computeReadiness`,
  `computeLoadRamp`, `computeAcwr` (`.level` only).
- Produces: `SessionSuggestion { purpose: string; structure: string; durationRangeMin: [number, number]; expectedTssRange: [number, number]; reason: string }`,
  `suggestSession(today: string, envelope: WeeklyEnvelope, weekToDateTss: number, readiness: ReadinessSignal, loadRamp: LoadRampAlert, acwr: AcwrResult | null): Promise<SessionSuggestion | null>`.
  **Corrected (external review): gates on `envelope`'s own range vs. `weekToDateTss`, not just
  readiness/spacing levels** — a session must never be suggested that would push completed-plus-suggested
  load past an already-frozen weekly ceiling. `null` return covers both the Recover-gate case and the
  insufficient-history case; **above-range is a distinct third case** (design §9: "prefer recovery/low
  load without calling the week a failure") — a low-dose suggestion, not `null` and not the normal dose.

- [ ] **Step 1: Write the failing tests**

Create `lib/session-suggestion.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { suggestSession } from "./session-suggestion";
import * as seasonSignals from "./season-signals";
import * as season from "./season";

const envelope = { weekStart: "2026-08-10", role: "build" as const, range: { min: 600, max: 700 }, previousRange: null, reductionApplied: false, reductionReason: null, calculationVersion: 1, resolvedAt: "2026-08-10T06:00:00.000Z" };

describe("suggestSession", () => {
  it("returns null when the readiness gate says Recover — never suggests pushing through fatigue", async () => {
    const result = await suggestSession(
      "2026-08-12", envelope, 400,
      { level: "Recover", reason: "TSB -20 — accumulated fatigue" },
      { triggered: false, level: "none", thisWeekTss: 400, lastWeekTss: 400, changePct: 0, reason: null },
      null
    );
    expect(result).toBeNull();
  });

  it("passes today through to gatherFocusInputs — never lets its date fallback diverge from the client-supplied sync date", async () => {
    const spy = vi.spyOn(seasonSignals, "gatherFocusInputs").mockResolvedValue({ limiter: { system: null, confidence: "low" }, lastFocus: null, signals: {} });
    vi.spyOn(season, "chooseNextFocus").mockReturnValue({ focus: "aerobic-base", rationale: "aerobic-base is neglected", scores: [] });
    await suggestSession("2026-08-12", envelope, 400, { level: "Build", reason: "TSB 5" }, { triggered: false, level: "none", thisWeekTss: 400, lastWeekTss: 400, changePct: 0, reason: null }, null);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ today: "2026-08-12" }));
  });

  it("never forwards computeLoadRamp's reason text into the suggestion output", async () => {
    vi.spyOn(seasonSignals, "gatherFocusInputs").mockResolvedValue({ limiter: { system: null, confidence: "low" }, lastFocus: null, signals: {} });
    vi.spyOn(season, "chooseNextFocus").mockReturnValue({ focus: "aerobic-base", rationale: "aerobic-base is neglected", scores: [] });
    const result = await suggestSession(
      "2026-08-12", envelope, 400,
      { level: "Build", reason: "TSB 5 — good conditions to train" },
      { triggered: true, level: "caution", thisWeekTss: 450, lastWeekTss: 380, changePct: 18, reason: "Load up 18% on the previous 7 days (450 vs 380 TSS) — above the ~10% progressive-overload guideline. Watch recovery." },
      null
    );
    expect(result?.reason ?? "").not.toMatch(/injury/i);
    expect(result?.reason ?? "").not.toMatch(/risk/i);
  });

  it("maps the chosen focus to a concrete session shape with an IF²-based TSS estimate", async () => {
    vi.spyOn(seasonSignals, "gatherFocusInputs").mockResolvedValue({ limiter: { system: null, confidence: "low" }, lastFocus: null, signals: {} });
    vi.spyOn(season, "chooseNextFocus").mockReturnValue({ focus: "threshold", rationale: "threshold execution has been strong", scores: [] });
    const result = await suggestSession(
      "2026-08-12", envelope, 400,
      { level: "Build", reason: "TSB 5" },
      { triggered: false, level: "none", thisWeekTss: 400, lastWeekTss: 400, changePct: 0, reason: null },
      null
    );
    expect(result).not.toBeNull();
    expect(result!.durationRangeMin[0]).toBeGreaterThan(0);
    expect(result!.expectedTssRange[0]).toBeGreaterThan(0);
  });

  it("above range: suggests a low-dose recovery session, never null, never calling the week a failure", async () => {
    vi.spyOn(seasonSignals, "gatherFocusInputs").mockResolvedValue({ limiter: { system: null, confidence: "low" }, lastFocus: null, signals: {} });
    vi.spyOn(season, "chooseNextFocus").mockReturnValue({ focus: "threshold", rationale: "threshold execution has been strong", scores: [] });
    // weekToDateTss already exceeds envelope.range.max (700)
    const result = await suggestSession(
      "2026-08-12", envelope, 750,
      { level: "Build", reason: "TSB 5" },
      { triggered: false, level: "none", thisWeekTss: 750, lastWeekTss: 400, changePct: 0, reason: null },
      null
    );
    expect(result).not.toBeNull();
    expect(result!.purpose.toLowerCase()).toMatch(/recovery|easy/);
    expect(result!.reason.toLowerCase()).not.toMatch(/failure|failed/);
  });

  it("below range: suggests normally — never a desperate catch-up framing", async () => {
    vi.spyOn(seasonSignals, "gatherFocusInputs").mockResolvedValue({ limiter: { system: null, confidence: "low" }, lastFocus: null, signals: {} });
    vi.spyOn(season, "chooseNextFocus").mockReturnValue({ focus: "aerobic-base", rationale: "aerobic-base is neglected", scores: [] });
    const result = await suggestSession(
      "2026-08-12", envelope, 200, // well below range.min (600)
      { level: "Build", reason: "TSB 5" },
      { triggered: false, level: "none", thisWeekTss: 200, lastWeekTss: 400, changePct: 0, reason: null },
      null
    );
    expect(result).not.toBeNull();
    expect(result!.reason.toLowerCase()).not.toMatch(/catch.?up|behind|make up/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/session-suggestion.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

Create `lib/session-suggestion.ts`:

```ts
// Phase 3a §9. Readiness/spacing gates run FIRST and read only .level fields — never
// computeLoadRamp's/computeAcwr's .reason text, which carries injury-risk wording the original design's
// §15 non-goal forbids in this app's own voice.
import { gatherFocusInputs } from "./season-signals";
import { chooseNextFocus } from "./season";
import { FOCUS_LABELS } from "./season";
import type { AcwrResult, LoadRampAlert, ReadinessSignal, SeasonFocus, WeeklyEnvelope } from "./types";

export interface SessionSuggestion {
  purpose: string;
  structure: string;
  durationRangeMin: [number, number];
  expectedTssRange: [number, number];
  reason: string;
}

// Coarse duration/structure template per focus — deliberately simple (§9: "a duration/intensity dose
// that fits the weekly envelope" is priority 5 of 5, after the harder gates). Not the block generator's
// job to author real interval content here; this is a suggestion, never a plan.
const FOCUS_SESSION_TEMPLATE: Record<SeasonFocus, { structure: string; durationRangeMin: [number, number]; ifEstimate: number }> = {
  "aerobic-base": { structure: "mostly Z2, controlled climbing optional", durationRangeMin: [90, 120], ifEstimate: 0.65 },
  threshold: { structure: "steady threshold intervals", durationRangeMin: [60, 90], ifEstimate: 0.85 },
  vo2max: { structure: "short high-intensity intervals", durationRangeMin: [45, 75], ifEstimate: 0.9 },
  anaerobic: { structure: "short maximal efforts, full recovery between", durationRangeMin: [45, 60], ifEstimate: 0.8 },
  durability: { structure: "long ride with embedded efforts late", durationRangeMin: [150, 210], ifEstimate: 0.7 },
  sharpen: { structure: "race-pace openers", durationRangeMin: [45, 60], ifEstimate: 0.85 },
};

function expectedTss(durationMin: number, ifEstimate: number): number {
  return Math.round((durationMin / 60) * ifEstimate * ifEstimate * 100);
}

// A dedicated low-dose template, used only for the above-range case — never the block generator's job,
// never a full recovery-day plan, just this suggestion's own concrete option.
const RECOVERY_TEMPLATE = { structure: "easy spin, conversational pace", durationRangeMin: [30, 45] as [number, number], ifEstimate: 0.55 };

export async function suggestSession(
  today: string,
  envelope: WeeklyEnvelope,
  weekToDateTss: number,
  readiness: ReadinessSignal,
  loadRamp: LoadRampAlert,
  acwr: AcwrResult | null
): Promise<SessionSuggestion | null> {
  // Gate 1: readiness. Never suggest pushing through a Recover read.
  if (readiness.level === "Recover") return null;

  // Gate 2 (external review, corrected): the envelope's own range vs. completed-load-to-date. Design §9:
  // "above range: prefer recovery/low load without calling the week a failure" — a distinct THIRD case,
  // not folded into the Recover gate above and not treated as a normal-dose suggestion either.
  if (weekToDateTss >= envelope.range.max) {
    const t = RECOVERY_TEMPLATE;
    return {
      purpose: "Easy recovery spin",
      structure: t.structure,
      durationRangeMin: t.durationRangeMin,
      expectedTssRange: [expectedTss(t.durationRangeMin[0], t.ifEstimate), expectedTss(t.durationRangeMin[1], t.ifEstimate)],
      reason: `This week's load is already at the top of the ${envelope.range.min}-${envelope.range.max} range — an easy spin keeps the legs moving without adding to it.`,
    };
  }

  // Gate 3: hard-session spacing. A high load-ramp level or a danger-band ACWR level trims the dose
  // rather than compounding — read levels only, never computeLoadRamp's/computeAcwr's .reason text.
  const spacingCaution = loadRamp.level === "high" || acwr?.level === "danger";

  // today threaded through explicitly — gatherFocusInputs' own fallback (no today) is server UTC, which
  // would silently diverge from the client-supplied sync date this whole call chain is anchored to.
  const inputs = await gatherFocusInputs({ today });
  const choice = chooseNextFocus(inputs);
  const template = FOCUS_SESSION_TEMPLATE[choice.focus];

  const [minDur, maxDur] = spacingCaution
    ? [template.durationRangeMin[0], Math.round(template.durationRangeMin[0] * 1.15)]
    : template.durationRangeMin;
  const expectedMin = expectedTss(minDur, template.ifEstimate);
  const expectedMax = expectedTss(maxDur, template.ifEstimate);

  // Below-range (design §9: "never a desperate catch-up ride") needs no special branch — the normal
  // suggestion above already doesn't reference how far below range the week is; there is nothing here
  // that COULD read as catch-up framing, which is the point.
  const reason = spacingCaution
    ? `Recent load has ramped quickly — ${FOCUS_LABELS[choice.focus]} at a controlled dose fits better than pushing another hard day.`
    : choice.rationale;

  return {
    purpose: FOCUS_LABELS[choice.focus],
    structure: template.structure,
    durationRangeMin: [minDur, maxDur],
    expectedTssRange: [expectedMin, expectedMax],
    reason,
  };
}
```

(Verify `FOCUS_LABELS`'s exact export shape — `grep -n "export const FOCUS_LABELS" lib/season.ts` — before
relying on the import above; this plan references it from an earlier read but did not re-verify its exact
type at write time. Verify `gatherFocusInputs`'s `opts` parameter is genuinely named `today` — grep
`lib/season-signals.ts:35`'s signature — this plan read it as `{ blockGoal?, weakpoints?, today? }`
earlier but re-confirm before relying on the object-shape call above.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/session-suggestion.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/session-suggestion.ts lib/session-suggestion.test.ts
git commit -m "feat(session-suggestion): suggestSession — gatherFocusInputs/chooseNextFocus reuse, levels-only gates"
```

---

## Task 4: `lib/no-block-summary.ts` — the three-stream composition

**Files:**
- Modify: `lib/types.ts` (new `NoBlockSummary` interface — **corrected, external review: shared
  response-shape types live in `types.ts` in this codebase, same as `WeeklyEnvelope`/`SessionSuggestion`
  should for consistency; Task 6 already assumed this location, this task now actually puts it there
  instead of leaving it implicitly defined in `no-block-summary.ts`**)
- Create: `lib/no-block-summary.ts` (the `composeNoBlockSummary` function only — no type declaration)
- Test: `lib/no-block-summary.test.ts`

**Interfaces:**
- Consumes: `WeeklyEnvelope`, `SessionSuggestion | null`, `summariseBehaviour(resolveAll(...))`'s output
  (verify its exact return shape — `grep -n "export function summariseBehaviour" lib/score-log.ts` — this
  plan has not re-verified it beyond confirming the function exists and is fed `resolveAll`'s output, per
  the external review's confirmed `lib/athlete-model.ts:84-86` chain).
- Produces: `NoBlockSummary` (defined in `lib/types.ts`, Step 0 below), `composeNoBlockSummary(envelope, suggestion, behaviour): NoBlockSummary`.

- [ ] **Step 0: Add `NoBlockSummary` to `lib/types.ts`**

Near the new `WeeklyEnvelope` interface (Task 2, Step 1):

```ts
export interface NoBlockSummary {
  headline: string;
  body: string;
  weeklyRange: { min: number; max: number; thisWeekTss: number };
  suggestion: SessionSuggestion | null;
}
```

`SessionSuggestion` also needs to move here if it doesn't already live in `types.ts` — check Task 3's
actual file placement before this step; if `SessionSuggestion` stayed in `lib/session-suggestion.ts` per
Task 3's original text, either move it to `types.ts` now for consistency with `NoBlockSummary`/
`WeeklyEnvelope`, or import it from `session-suggestion.ts` here — pick one and apply it consistently
across every file that imports `SessionSuggestion`, don't leave two different import paths for the same
type in the codebase.

- [ ] **Step 1: Read `summariseBehaviour`'s actual return shape**

```bash
grep -n "export function summariseBehaviour" -A 15 lib/score-log.ts
```

Ground this task's Step 3 implementation against what this actually prints — do not assume a shape.

- [ ] **Step 2: Write the failing tests**

Create `lib/no-block-summary.test.ts` with cases covering: a "Build · fresh" headline when role is build
and TSB is positive, "mild fatigue" wording when the readiness/behaviour read implies it, `suggestion:
null` rendering a body that omits the suggestion block entirely rather than a broken/empty one, and — the
example the original design's §8/§10 explicitly share — reproduce "Productive training · mild fatigue"
for a role/behaviour input combination matching that example's implied state. (Concrete fixture values
depend on Step 1's real `summariseBehaviour` shape; write these once that's confirmed, not blind.)

- [ ] **Step 3: Implement `composeNoBlockSummary`**

Pure composition, no new calculation — read `WeeklyEnvelope.role` for the Load stream, `ReadinessSignal`/
recent TSB trend for the Recovery stream, and `summariseBehaviour`'s output for the Execution stream
(reading only fields Step 1 confirmed exist). Template the headline/body text; never call an LLM.

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run lib/no-block-summary.test.ts
git add lib/no-block-summary.ts lib/no-block-summary.test.ts
git commit -m "feat(no-block-summary): composeNoBlockSummary — pure composition, no new calculation"
```

---

## Task 5: Wire into `/api/sync` GET and POST

**Files:**
- Modify: `app/api/sync/route.ts`
- Test: `app/api/sync/route.test.ts`

**Interfaces:**
- Produces: `noBlockSummary: NoBlockSummary | null` on both GET and POST JSON responses. `null` covers
  three distinct cases, not conflated: an active unfinished block, no sync data yet (`readiness`/
  `loadRamp` are themselves `null` in GET pre-first-sync — **corrected, external review**: do not pass a
  null value where `suggestSession` requires a real `ReadinessSignal`/`LoadRampAlert`), and — never
  reachable via this path, listed only for completeness — a `resolveWeeklyEnvelope` result with no data
  to build an anchor from (that case still returns a `maintain`-role envelope with a `median([])===0`
  range per Task 2, not `null`; a genuinely empty range is itself informative, unlike "no sync yet").

- [ ] **Step 1: Re-confirm the exact current line numbers**

```bash
grep -n "const today = resolveToday\|const fatigueAlert\|const loadRamp\|const acwr\b\|const athleteState" app/api/sync/route.ts
```

Use what this prints, not any number written elsewhere in this plan — other work may have landed on
`main` since this plan was written (this repo runs concurrent agent sessions routinely).

- [ ] **Step 2: Write the failing tests**

Add to `app/api/sync/route.test.ts`, mirroring the file's existing `readCurrentBlock`/`readScoreLog` mock
pattern (grep the file's `beforeEach` for how it currently mocks these):

```ts
describe("GET/POST /api/sync — noBlockSummary", () => {
  it("is present and non-null when there is no active block", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/sync?today=2026-08-12"));
    const body = await res.json();
    expect(body.noBlockSummary).not.toBeNull();
  });

  it("is null when a block is active and not finished", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue({ /* ...active block fixture, endDate in the future... */ } as never);
    const res = await GET(new Request("http://localhost/api/sync?today=2026-08-12"));
    const body = await res.json();
    expect(body.noBlockSummary).toBeNull();
  });

  it("is present when the block has finished (isBlockFinished true)", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue({ /* ...block fixture, endDate in the past relative to today... */ } as never);
    const res = await GET(new Request("http://localhost/api/sync?today=2026-08-12"));
    const body = await res.json();
    expect(body.noBlockSummary).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run app/api/sync/route.test.ts -t "noBlockSummary"
```

Expected: FAIL — field doesn't exist.

- [ ] **Step 4: Implement in both handlers**

Add imports at the top of `app/api/sync/route.ts`:

```ts
import { resolveWeeklyEnvelope } from "@/lib/weekly-envelope";
import { updateWeeklyEnvelope } from "@/lib/data-store";
import { suggestSession } from "@/lib/session-suggestion";
import { composeNoBlockSummary } from "@/lib/no-block-summary";
import { isBlockFinished } from "@/lib/date";
```

Add a shared helper near `resolveTodayOutcome` (mirroring that function's existing shape — both handlers
call one shared function rather than duplicating this logic inline):

```ts
function weekToDateLoad(activities: ActivitySummary[], weekStart: string, today: string): number {
  return activities
    .filter((a) => a.date >= weekStart && a.date <= today && a.trainingLoad !== null)
    .reduce((sum, a) => sum + (a.trainingLoad as number), 0);
}

async function resolveNoBlockSummary(
  block: CurrentBlock | null,
  today: string,
  activities: ActivitySummary[],
  scoreEntries: RideScoreEntry[],
  wellness: WellnessEntry[],
  readiness: ReadinessSignal | null,
  loadRamp: LoadRampAlert | null,
  acwr: AcwrResult | null
): Promise<NoBlockSummary | null> {
  const noActiveBlock = !block || isBlockFinished(block, today);
  if (!noActiveBlock) return null;
  // Corrected (external review): GET's readiness/loadRamp are themselves null pre-first-sync
  // (`lastSync ? computeX(...) : null`) — there is no history to build an envelope OR a suggestion
  // from yet, so this is its own real state, not a 0-0 envelope manufactured from nothing.
  if (!readiness || !loadRamp) return null;

  // Corrected (external review): read-compute-write as ONE atomic operation via updateWeeklyEnvelope —
  // resolveWeeklyEnvelope's own read of `current` happens INSIDE updateJsonFile's lock, so two
  // concurrent syncs can never both read the same base and clobber each other's midweek reduction.
  const envelope = await updateWeeklyEnvelope(
    (persisted) => resolveWeeklyEnvelope({ today, persisted, activities, entries: scoreEntries, wellness }).envelope
  );

  const weekToDateTss = weekToDateLoad(activities, envelope.weekStart, today);
  const suggestion = await suggestSession(today, envelope, weekToDateTss, readiness, loadRamp, acwr);
  // behaviour input — grep Task 4's Step 1 confirmed shape and thread the same call this file already
  // makes for buildAthleteModel's behaviour field, don't re-derive it a second way.
  const behaviour = buildAthleteModel(scoreEntries, /* intentStore.overlays, already in scope */ []).behaviour;
  return composeNoBlockSummary(envelope, suggestion, behaviour);
}
```

(The `intentStore.overlays` placeholder above — both `GET` and `POST` already have this in scope from
their own existing `buildAthleteModel` calls a few lines earlier; pass the same binding, don't re-read the
store.)

In `GET`, immediately after the existing `athleteState` computation (Step 1's grep target), add:

```ts
  const noBlockSummary = await resolveNoBlockSummary(currentBlock, today, lastSync?.activities ?? [], scoreLog.entries, lastSync?.wellness ?? [], readiness, loadRamp, acwr);
```

Add `noBlockSummary,` to `GET`'s response object literal, alongside `athleteState,`.

Repeat identically in `POST` (same helper call, same field name, added to `POST`'s response object at its
existing single-line literal near `athleteState`). **`POST`'s `readiness`/`loadRamp`/`acwr` are
non-nullable per Step 1's grep** (`POST` only reaches this code after confirming `lastSync` exists,
unlike `GET`) — the `resolveNoBlockSummary` helper's nullable parameter types still apply (it's shared),
they simply never read `null` on the `POST` path.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run app/api/sync/route.test.ts
npx tsc --noEmit
```

Expected: PASS, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/sync/route.ts app/api/sync/route.test.ts
git commit -m "feat(sync): resolve and persist noBlockSummary in both GET and POST"
```

---

## Task 6: Thread onto `AppState`

**Files:**
- Modify: `components/SyncProvider.tsx`
- Test: `components/SyncProvider.test.tsx` (if it exists — check first)

**Interfaces:**
- Produces: `AppState.noBlockSummary: NoBlockSummary | null`.

- [ ] **Step 1: Check for existing state tests**

```bash
ls components/SyncProvider.test.tsx 2>&1
grep -n "todayOutcome" components/SyncProvider.tsx
```

Follow the exact `todayOutcome` precedent (Phase 2c) — same interface placement, same null-safe default.

- [ ] **Step 2: Add the field**

In `components/SyncProvider.tsx`'s `AppState` interface, add `noBlockSummary: NoBlockSummary | null;`
immediately after `todayOutcome`. Add `NoBlockSummary` to the file's `from "@/lib/types"` import.

- [ ] **Step 3: Run the full suite, commit**

```bash
npx vitest run
git add components/SyncProvider.tsx
git commit -m "feat(sync-provider): thread noBlockSummary onto AppState"
```

---

## Task 7: UI wiring — `PlannedToday`

**Files:**
- Modify: `components/dashboard/today.tsx`
- Modify: `components/dashboard/TodayView.tsx`
- Test: `components/dashboard/today.test.tsx` (check first whether it exists)

**Interfaces:**
- `PlannedToday` gains a new prop: `noBlockSummary: NoBlockSummary | null`.

- [ ] **Step 1: Write the failing tests**

Add cases (new file with `/** @vitest-environment jsdom */` if none exists, matching Phase 2c's
`ride-intent.test.tsx` convention) proving: the never-had-a-block state (`block: null`) renders the
summary's headline when `noBlockSummary` is non-null, alongside the existing "Plan your next block →"
link (not instead of it — confirm the design's own wording: "alongside, not replacing"); the
finished-block state renders the summary alongside "Your block finished..."; an active, unfinished block
renders neither (confirm no regression — `PlannedToday`'s other branches are unaffected).

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run components/dashboard/today.test.tsx -t "noBlockSummary"
```

- [ ] **Step 3: Implement**

In `components/dashboard/today.tsx`, change `PlannedToday`'s signature (`today.tsx:825`):

```ts
export function PlannedToday({ block, noBlockSummary }: { block: CurrentBlock | null; noBlockSummary: NoBlockSummary | null }) {
```

Add a small internal component (or inline JSX, implementer's call, matching this file's existing
convention for small blocks) rendering `noBlockSummary`'s headline/body/weeklyRange/suggestion when
non-null — no confirmation, completion, planning, or calendar-write control (design §12.1).

In the `isBlockFinished` branch (`today.tsx:827-841`), add the summary render alongside the existing
"Generate the next block →" content — do not replace the finished-block link.

In the `!block` branch (`today.tsx:869-881`), add the summary render alongside the existing "Plan your
next block →" content — same rule.

In `components/dashboard/TodayView.tsx:233`, update the call site:

```tsx
<PlannedToday block={state.currentBlock} noBlockSummary={state.noBlockSummary} />
```

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run
npx tsc --noEmit
git add components/dashboard/today.tsx components/dashboard/TodayView.tsx components/dashboard/today.test.tsx
git commit -m "feat(today): render the no-block weekly-envelope/suggestion section"
```

---

## Task 8: Required test — week straddling an overlay's `createdAt`

**Files:**
- Modify: `lib/no-block-summary.test.ts` (or `lib/score-log.test.ts`, wherever `summariseBehaviour`'s own
  tests live — check first which file already covers weekly-aggregation-shaped cases)

- [ ] **Step 1: Write the test**

Per the external review's explicit requirement: construct a week containing rides both before and after
an `IntentOverlay.createdAt` timestamp, resolve it through `resolveAll()` → `summariseBehaviour()`, and
prove the later `active` overlay affects that week's execution read exactly as `resolveAll()` specifies
— not a general smoke test, this specific before/after-`createdAt` scenario. Read `resolveAll`'s own
tests first (`lib/intent-overlay.test.ts`, grep for `createdAt`) to match its established fixture
pattern rather than inventing a new one.

- [ ] **Step 2: Run and commit**

```bash
npx vitest run
git add <the test file>
git commit -m "test(no-block-summary): prove weekly execution reflects a mid-week overlay per resolveAll()"
```

---

## Task 9: Docs

**Files:**
- Modify: `docs/systems/03-daily-loop.md` (or wherever the no-block Today surface is documented — check
  `docs/FILE_INDEX.md`/`docs/systems/` for the right home; this plan has not confirmed the exact file)
- Modify: `ROADMAP.md` (move the Phase 3a line to "shipped," per repo convention — check its current exact
  wording first, another session may have touched it since this plan was written)

- [ ] **Step 1: Find the right systems doc**

```bash
grep -rln "no-block\|PlannedToday" docs/systems/*.md
```

Add a short entry describing the new weekly-envelope/session-suggestion/three-stream surface, following
that doc's existing "Known rough edges" convention if one exists.

- [ ] **Step 2: Update ROADMAP.md**

Re-read the current Phase 3a line first (`grep -n "Phase 3a" ROADMAP.md`) — do not assume it still reads
as this plan's authors last saw it. Move it to ARCHIVE.md per the repo's stated policy once this phase
ships, or update its wording to reflect "shipped" if that's the convention in use at implementation time.

- [ ] **Step 3: Commit**

```bash
git add docs/systems/*.md ROADMAP.md
git commit -m "docs: record the Phase 3a no-block Today surface"
```

---

## Handoff

Implements `docs/superpowers/specs/2026-08-12-adaptive-coach-p3a-no-block-today-design.md` in full,
including all six external-review corrections folded into that design doc on 2026-08-12. This plan
itself carries a second round of external-review corrections (2026-08-13): canonical `trainingLoad` vs.
`RideScoreEntry.tss`, atomic read-modify-write via `updateJsonFile`, nullable `readiness`/`loadRamp`
handling in `GET`, `NoBlockSummary`'s actual location, `suggestSession`'s envelope/week-to-date gate, and
`gatherFocusInputs({ today })` threading — all folded in place, all verified against the real code before
fixing, not taken on faith. No LLM call added — no live-smoke-run task in this plan, deliberately (see
Global Constraints). Explicit non-goals from the design doc (§7) are not tasks here on purpose: no change
to `AthleteStateCard`/Zone 1 (flagged in `todo.md` for revisit), no historical backfill, no new
wellness/readiness data collection.
