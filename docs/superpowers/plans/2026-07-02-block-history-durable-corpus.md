# Durable Planned Corpus (Block-History) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `block-history` retain per-day prescriptions so `buildRideScores` can match a ride against any historical block (not just the live one), so the trainable corpus stops losing entries as blocks roll over.

**Architecture:** `BlockHistoryEntry` gains an optional `days` field (verbatim `CurrentBlockDay[]`), truncated to its lived portion at archive time by a new pure helper. `buildRideScores` gains an optional `history` param and seeds its date→prescription map from history (oldest first) before the current block (so current always wins on collision, and among history entries the most recently created wins). The single production call site (the normal sync route) already has block-history in hand for an unrelated computation — it just gets threaded through. Three archive call sites (write-time supersede, retrospective completion, and — newly — discard) populate `days`.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, Vitest. JSON persistence via `lib/json-store.ts` helpers re-exported through `lib/data-store.ts`.

## Global Constraints

- **Deterministic core** — no LLM anywhere in this path; pure TypeScript only.
- **Do not modify `mergeScoreLog`/`mergeScoreLogRebuild`** (`lib/score-log.ts:191-226`) — LEDGER-1/2/3 are correct as-is; this plan only extends `buildRideScores`' matching *input*.
- **Pure logic is unit-tested** with Vitest (`lib/*.test.ts`). Route handlers are not unit-tested directly in this codebase — verify those with `npx tsc --noEmit && npm test` plus the existing full suite.
- **Concurrent checkout:** stage only files you touched (`git add <path>...`, never `git add -A`); commit on `main`.
- **Verification loop for any change:** `npx tsc --noEmit && npm test`.
- Ship target: before **2026-07-12** (current block's end date — the first natural rollover).

---

### Task 1: `BlockHistoryEntry.days` + `truncateBlockDays` helper

**Files:**
- Modify: `lib/types.ts:401-421` (`BlockHistoryEntry`)
- Modify: `lib/score-log.ts` (add `truncateBlockDays`, add `BlockHistoryEntry` to the type import)
- Test: `lib/score-log.test.ts`

**Interfaces:**
- Produces: `BlockHistoryEntry.days?: CurrentBlockDay[]`; `truncateBlockDays(days: CurrentBlockDay[], asOfDate: string): CurrentBlockDay[]`.

- [ ] **Step 1: Add `days` to `BlockHistoryEntry` in `lib/types.ts`**

Change lines 401-421 from:

```ts
export interface BlockHistoryEntry {
  id: string;
  goal: string;
  startDate: string;
  endDate: string;
  lengthWeeks: number;
  overview: string;
  createdAt: string;
  // Retrospective fields — populated when block is completed
  complianceByType?: Partial<Record<WorkoutType, number>>;
  actualHours?: number;
  plannedHours?: number;
  ctlGain?: number | null;
  nextBlockSeeds?: string[];
  retrospective?: string; // Claude narrative
  structuredReflections?: StructuredReflection[]; // Track D: hypothesis→outcome notes, fed into the next block's prompt
  // Provenance of the block this entry archives (see GeneratedPlan).
  model?: string;
  promptVersion?: number;
  durabilityTemplate?: string; // Track B: durability template (A–E) used — for rotation + scoring
}
```

to:

```ts
export interface BlockHistoryEntry {
  id: string;
  goal: string;
  startDate: string;
  endDate: string;
  lengthWeeks: number;
  overview: string;
  createdAt: string;
  // Retrospective fields — populated when block is completed
  complianceByType?: Partial<Record<WorkoutType, number>>;
  actualHours?: number;
  plannedHours?: number;
  ctlGain?: number | null;
  nextBlockSeeds?: string[];
  retrospective?: string; // Claude narrative
  structuredReflections?: StructuredReflection[]; // Track D: hypothesis→outcome notes, fed into the next block's prompt
  // Provenance of the block this entry archives (see GeneratedPlan).
  model?: string;
  promptVersion?: number;
  durabilityTemplate?: string; // Track B: durability template (A–E) used — for rotation + scoring
  // SUB-1: the block's per-day prescriptions, truncated to dates on/before the archive date (its "lived"
  // portion — a superseded/discarded block's un-lived future was never a real plan). Verbatim CurrentBlockDay
  // reuse — buildRideScores applies the same durationMin > 0 filter it already applies to the live block.
  // Absent on entries archived before this field existed; they contribute nothing to historical matching.
  days?: CurrentBlockDay[];
}
```

`CurrentBlockDay` is already imported in `lib/types.ts` (it's declared earlier in the same file, ~line 266) — no new import needed.

- [ ] **Step 2: Write the failing test for `truncateBlockDays`** — add to `lib/score-log.test.ts` (new `describe` block at the end of the file)

```ts
describe("truncateBlockDays", () => {
  const days = [
    { date: "2026-06-15", name: "Z2 day", type: "Z2" as const, durationMin: 90 },
    { date: "2026-06-16", name: "Threshold day", type: "Threshold" as const, durationMin: 60 },
    { date: "2026-06-17", name: "Recovery day", type: "Recovery" as const, durationMin: 45 },
  ];

  it("keeps days on or before the cutoff, inclusive", () => {
    expect(truncateBlockDays(days, "2026-06-16").map((d) => d.date)).toEqual(["2026-06-15", "2026-06-16"]);
  });

  it("drops all days when the cutoff is before the block started", () => {
    expect(truncateBlockDays(days, "2026-06-01")).toEqual([]);
  });

  it("keeps every day when the cutoff is on/after the block's last day", () => {
    expect(truncateBlockDays(days, "2026-06-17")).toHaveLength(3);
    expect(truncateBlockDays(days, "2026-07-01")).toHaveLength(3);
  });
});
```

Add `truncateBlockDays` to the existing import line at the top of `lib/score-log.test.ts`:

```ts
import { buildRideScores, fuelStampFor, mergeScoreLog, mergeScoreLogRebuild, summariseBehaviour, truncateBlockDays } from "./score-log";
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/score-log.test.ts -t truncateBlockDays`
Expected: FAIL — `truncateBlockDays is not a function` (or similar import error)

- [ ] **Step 4: Implement `truncateBlockDays` in `lib/score-log.ts`**

Add `BlockHistoryEntry` to the existing type import (line 11):

```ts
import type { ActivitySummary, BehaviourSummary, BlockHistoryEntry, CurrentBlock, CurrentBlockDay, RideEntryContext, RideScoreEntry } from "./types";
```

Add this function anywhere after the imports, e.g. directly above `buildRideScores` (before line 51):

```ts
// SUB-1: a block's "lived" days as of its archive date — the days it actually covered while live, not
// the un-lived future of a superseded/discarded block. Archiving only the lived portion keeps a later
// block's overlapping dates from ever having two competing historical prescriptions.
export function truncateBlockDays(days: CurrentBlockDay[], asOfDate: string): CurrentBlockDay[] {
  return days.filter((d) => d.date <= asOfDate);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/score-log.test.ts -t truncateBlockDays`
Expected: PASS (3 tests)

- [ ] **Step 6: Typecheck and full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no errors, all existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/score-log.ts lib/score-log.test.ts
git commit -m "feat(score-log): add BlockHistoryEntry.days + truncateBlockDays helper"
```

---

### Task 2: `buildRideScores` matches against historical blocks

**Files:**
- Modify: `lib/score-log.ts:51-72` (`buildRideScores` signature + `plannedByDate` construction)
- Test: `lib/score-log.test.ts`

**Interfaces:**
- Consumes: `truncateBlockDays` (Task 1, not used here directly, but its fixtures follow the same `CurrentBlockDay` shape), `BlockHistoryEntry.days` (Task 1).
- Produces: `buildRideScores(block, activities, ftpForDate, today?, offPlanFloor?, calibration?, contextForDate?, history?)` — new 8th optional param `history?: BlockHistoryEntry[]`. All existing call sites (including every existing test) remain valid unchanged — `history` defaults to `undefined`.

- [ ] **Step 1: Write the failing tests** — add to `lib/score-log.test.ts`, in the existing `describe("buildRideScores", ...)` block. First add a fixture helper near the existing `block()` helper (~line 45):

```ts
function historyEntry(
  createdAt: string,
  days: Array<{ date: string; type: WorkoutType; durationMin: number }>
): BlockHistoryEntry {
  return {
    id: createdAt,
    goal: "Test",
    startDate: days[0]?.date ?? "2026-01-01",
    endDate: days[days.length - 1]?.date ?? "2026-01-14",
    lengthWeeks: 2,
    overview: "",
    createdAt,
    days: days.map((d) => ({ date: d.date, name: `${d.type} day`, type: d.type, durationMin: d.durationMin })),
  };
}
```

Add `BlockHistoryEntry` to the existing type-only import at the top of the test file:

```ts
import type { ActivitySummary, BlockHistoryEntry, CurrentBlock, RideScoreEntry, WorkoutType } from "./types";
```

Then the tests:

```ts
it("matches a ride against a historical block's day when no current block covers that date", () => {
  const hist = [historyEntry("2026-01-01T00:00:00.000Z", [{ date: "2026-01-05", type: "Threshold", durationMin: 60 }])];
  const acts = [activity({ date: "2026-01-05", avgWatts: 180, normalizedPower: 185 })];
  const scores = buildRideScores(null, acts, ftp200, "2026-01-10", null, undefined, undefined, hist);
  expect(scores[0].planned).toBe(true);
  expect(scores[0].plannedType).toBe("Threshold");
});

it("prefers the current block over a historical block covering the same date", () => {
  const b = block([{ date: "2026-01-05", type: "Z2", durationMin: 90 }]);
  const hist = [historyEntry("2026-01-01T00:00:00.000Z", [{ date: "2026-01-05", type: "Threshold", durationMin: 60 }])];
  const acts = [activity({ date: "2026-01-05", avgWatts: 180, normalizedPower: 185 })];
  const scores = buildRideScores(b, acts, ftp200, "2026-01-10", null, undefined, undefined, hist);
  expect(scores[0].plannedType).toBe("Z2");
});

it("does not match a historical day whose block was created after the ride's date", () => {
  // Created 2026-01-06, but claims to prescribe 2026-01-05 — a block can't retroactively plan a past day.
  const hist = [historyEntry("2026-01-06T00:00:00.000Z", [{ date: "2026-01-05", type: "Threshold", durationMin: 60 }])];
  const acts = [activity({ date: "2026-01-05", avgWatts: 180, normalizedPower: 185 })];
  const scores = buildRideScores(null, acts, ftp200, "2026-01-10", "2025-01-01", undefined, undefined, hist);
  expect(scores[0].planned).toBe(false);
});

it("prefers the most-recently-created historical block when two both cover the same date", () => {
  const older = historyEntry("2026-01-01T00:00:00.000Z", [{ date: "2026-01-05", type: "Z2", durationMin: 90 }]);
  const newer = historyEntry("2026-01-03T00:00:00.000Z", [{ date: "2026-01-05", type: "Threshold", durationMin: 60 }]);
  const acts = [activity({ date: "2026-01-05", avgWatts: 180, normalizedPower: 185 })];
  const scores = buildRideScores(null, acts, ftp200, "2026-01-10", null, undefined, undefined, [older, newer]);
  expect(scores[0].plannedType).toBe("Threshold");
});

it("ignores a history entry with no days without crashing", () => {
  const noD: BlockHistoryEntry = { ...historyEntry("2026-01-01T00:00:00.000Z", []), days: undefined };
  const acts = [activity({ date: "2026-01-05", avgWatts: 180, normalizedPower: 185 })];
  expect(() => buildRideScores(null, acts, ftp200, "2026-01-10", null, undefined, undefined, [noD])).not.toThrow();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/score-log.test.ts -t "historical"`
Expected: FAIL — the new tests don't match current behavior (e.g. `scores[0].planned` is `false` for the first test, `plannedType` is `null`)

- [ ] **Step 3: Implement history-aware matching in `buildRideScores`**

Change the signature (line 51-69) from:

```ts
export function buildRideScores(
  block: CurrentBlock | null,
  activities: ActivitySummary[],
  ftpForDate: (date: string) => number,
  today: string = new Date().toISOString().slice(0, 10),
  offPlanFloor: string | null = null,
  calibration?: ScoringCalibration | null,
  contextForDate?: ((date: string) => RideEntryContext | null) | null
): RideScoreEntry[] {
  // Prescribed sessions, by date (only days that actually plan a ride).
  const plannedByDate = new Map<string, CurrentBlockDay>();
  if (block) for (const d of block.days) if (d.durationMin > 0) plannedByDate.set(d.date, d);
```

to:

```ts
export function buildRideScores(
  block: CurrentBlock | null,
  activities: ActivitySummary[],
  ftpForDate: (date: string) => number,
  today: string = new Date().toISOString().slice(0, 10),
  offPlanFloor: string | null = null,
  calibration?: ScoringCalibration | null,
  contextForDate?: ((date: string) => RideEntryContext | null) | null,
  // SUB-1: historical blocks' archived prescriptions, so a ride whose block has since rolled off can
  // still match. Seeded before the current block, oldest first, so a live block always wins on a date
  // collision and among history entries the most-recently-created wins (Map overwrite semantics). A
  // historical day only counts if its block's createdAt is on/before the day itself — a block can't
  // retroactively claim to have prescribed an already-past day.
  history?: BlockHistoryEntry[]
): RideScoreEntry[] {
  // Prescribed sessions, by date (only days that actually plan a ride).
  const plannedByDate = new Map<string, CurrentBlockDay>();
  const sortedHistory = [...(history ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const h of sortedHistory) {
    if (!h.days) continue;
    const createdDate = h.createdAt.slice(0, 10);
    for (const d of h.days) if (d.durationMin > 0 && createdDate <= d.date) plannedByDate.set(d.date, d);
  }
  if (block) for (const d of block.days) if (d.durationMin > 0) plannedByDate.set(d.date, d);
```

Nothing else in the function body changes — `plannedByDate` feeds the existing matching loop unmodified.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/score-log.test.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Typecheck and full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: no errors, all tests pass

- [ ] **Step 6: Commit**

```bash
git add lib/score-log.ts lib/score-log.test.ts
git commit -m "feat(score-log): buildRideScores matches rides against historical blocks"
```

---

### Task 3: Archive `days` at the write-time-supersede and retrospective-completion call sites

**Files:**
- Modify: `app/api/write/route.ts:91-106`
- Modify: `app/api/retrospective/route.ts:1-19` (imports), `~238-256` (`historyEntry` construction)

**Interfaces:**
- Consumes: `truncateBlockDays` (Task 1), `utcToday` (`lib/date.ts`, already exported).

- [ ] **Step 1: `app/api/write/route.ts`** — add the import and the field

Add `truncateBlockDays` to the existing `@/lib/score-log`... there is no existing import from `@/lib/score-log` in this file — add a new import line near the other `@/lib/*` imports (after line 9):

```ts
import { truncateBlockDays } from "@/lib/score-log";
```

Change the archive block (lines 91-106) from:

```ts
  // Archive the old block before replacing it.
  const existing = await readCurrentBlock();
  if (existing) {
    await appendBlockHistory({
      id: existing.createdAt,
      goal: existing.goal,
      startDate: existing.startDate,
      endDate: existing.endDate,
      lengthWeeks: existing.lengthWeeks,
      overview: existing.overview,
      createdAt: existing.createdAt,
      model: existing.model,
      promptVersion: existing.promptVersion,
      durabilityTemplate: existing.durabilityTemplate,
    });
  }
```

to:

```ts
  // Archive the old block before replacing it.
  const existing = await readCurrentBlock();
  if (existing) {
    await appendBlockHistory({
      id: existing.createdAt,
      goal: existing.goal,
      startDate: existing.startDate,
      endDate: existing.endDate,
      lengthWeeks: existing.lengthWeeks,
      overview: existing.overview,
      createdAt: existing.createdAt,
      model: existing.model,
      promptVersion: existing.promptVersion,
      durabilityTemplate: existing.durabilityTemplate,
      // SUB-1: archive only the lived portion — the days the superseded block actually covered while
      // live, not the un-lived future the new block is about to overwrite.
      days: truncateBlockDays(existing.days, utcToday()),
    });
  }
```

(`utcToday` is already imported in this file at line 9.)

- [ ] **Step 2: `app/api/retrospective/route.ts`** — add imports and the field

Add `utcToday` — there's no `@/lib/date` import in this file yet; add a new line after the existing imports (after line 10, before `import { analyzePowerProfile...`):

```ts
import { utcToday } from "@/lib/date";
import { truncateBlockDays } from "@/lib/score-log";
```

Change the `historyEntry` construction (lines 238-256) from:

```ts
  const historyEntry: BlockHistoryEntry = {
    id: block.createdAt,
    goal: block.goal,
    startDate: block.startDate,
    endDate: block.endDate,
    lengthWeeks: block.lengthWeeks,
    overview: block.overview,
    createdAt: block.createdAt,
    complianceByType: complianceMap as Partial<Record<WorkoutType, number>>,
    actualHours: Math.round(actualHours * 10) / 10,
    plannedHours: Math.round(plannedHours * 10) / 10,
    ctlGain: ctlStart !== null && ctlEnd !== null ? Math.round((ctlEnd - ctlStart) * 10) / 10 : null,
    nextBlockSeeds: seeds,
    retrospective,
    structuredReflections,
    model: block.model,
    promptVersion: block.promptVersion,
  };
```

to:

```ts
  const historyEntry: BlockHistoryEntry = {
    id: block.createdAt,
    goal: block.goal,
    startDate: block.startDate,
    endDate: block.endDate,
    lengthWeeks: block.lengthWeeks,
    overview: block.overview,
    createdAt: block.createdAt,
    complianceByType: complianceMap as Partial<Record<WorkoutType, number>>,
    actualHours: Math.round(actualHours * 10) / 10,
    plannedHours: Math.round(plannedHours * 10) / 10,
    ctlGain: ctlStart !== null && ctlEnd !== null ? Math.round((ctlEnd - ctlStart) * 10) / 10 : null,
    nextBlockSeeds: seeds,
    retrospective,
    structuredReflections,
    model: block.model,
    promptVersion: block.promptVersion,
    // SUB-1: truncation is a no-op here in practice — a retrospective only runs on a finished block
    // (isBlockFinished), so every day is already in the past — but applying it uniformly keeps one code
    // path instead of special-casing this call site.
    days: truncateBlockDays(block.days, utcToday()),
  };
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Full test suite**

Run: `npm test`
Expected: all tests pass (no unit tests target these route handlers directly, per this codebase's convention — the typecheck + existing suite is the verification here)

- [ ] **Step 6: Commit**

```bash
git add app/api/write/route.ts app/api/retrospective/route.ts
git commit -m "feat(block-history): archive per-day prescriptions on supersede + completion"
```

---

### Task 4: Archive on discard (`DELETE` in `app/api/sync/route.ts`)

**Files:**
- Modify: `app/api/sync/route.ts:1-50` (imports), `~478-494` (`DELETE` handler)

**Interfaces:**
- Consumes: `truncateBlockDays` (Task 1), `appendBlockHistory` (`lib/data-store.ts`, already exists — not currently imported in this file), `utcToday` (`lib/date.ts`).

**Why this task exists on its own:** unlike Task 3 (adding a field to an *existing* archive call), the `DELETE` handler doesn't call `appendBlockHistory` at all today — a discarded block's already-ridden days are currently lost from the matching corpus entirely. This is new behavior, not just a new field.

- [ ] **Step 1: Add the imports**

`appendBlockHistory` needs to be added to the existing `@/lib/data-store` import (line 9-32) — insert it alphabetically:

```ts
import {
  appendBlockHistory,
  readAthleteProfile,
  readBlockHistory,
  readBlockSettings,
  readCurrentBlock,
  readDispositions,
  readCalibration,
  readInterventionLog,
  readLastSync,
  readLedgerRebuild,
  readMorningChecks,
  readRollingBaselines,
  readScoreLog,
  updateScoreLog,
  writeLedgerRebuild,
  writeCalibration,
  writeInterventionLog,
  writeQuirks,
  writeTodayAnalysis,
  writeCurrentBlock,
  writeLastSync,
  writeRollingBaselines,
  readTodayAnalysis,
} from "@/lib/data-store";
```

Add `truncateBlockDays` to the existing `@/lib/score-log` import (line 43):

```ts
import { buildRideScores, calStampFor, mergeScoreLog, mergeScoreLogRebuild, truncateBlockDays } from "@/lib/score-log";
```

Add `utcToday` to the existing `@/lib/date` import (line 49):

```ts
import { resolveToday, utcToday } from "@/lib/date";
```

- [ ] **Step 2: Archive before clearing, in the `DELETE` handler**

Change (lines 478-494) from:

```ts
// DELETE discards the active block so a new one can be generated. RV-9: it also removes the block's
// planned-workout events from the Intervals.icu calendar — the whole plan is being thrown away, so its
// markers shouldn't linger (the old behaviour orphaned them). Best-effort + configured-guarded so a
// calendar hiccup never blocks the local clear; completed rides are separate activities, untouched.
export async function DELETE() {
  const block = await readCurrentBlock();
  const ids = blockEventIds(block);
  let eventsRemoved = 0;
  let eventsFailed: number[] = [];
  if (ids.length > 0 && isIntervalsConfigured()) {
    const { deleted, failed } = await deleteEvents(ids);
    eventsRemoved = deleted.length;
    eventsFailed = failed;
  }
  await writeCurrentBlock(null);
  return NextResponse.json({ ok: true, eventsRemoved, eventsFailed });
}
```

to:

```ts
// DELETE discards the active block so a new one can be generated. RV-9: it also removes the block's
// planned-workout events from the Intervals.icu calendar — the whole plan is being thrown away, so its
// markers shouldn't linger (the old behaviour orphaned them). Best-effort + configured-guarded so a
// calendar hiccup never blocks the local clear; completed rides are separate activities, untouched.
// SUB-1: archive the lived portion before clearing — "discard" rejects the block's un-lived future, not
// the days already ridden against it, which stay real coaching history the matcher can still use.
export async function DELETE() {
  const block = await readCurrentBlock();
  const ids = blockEventIds(block);
  let eventsRemoved = 0;
  let eventsFailed: number[] = [];
  if (ids.length > 0 && isIntervalsConfigured()) {
    const { deleted, failed } = await deleteEvents(ids);
    eventsRemoved = deleted.length;
    eventsFailed = failed;
  }
  if (block) {
    await appendBlockHistory({
      id: block.createdAt,
      goal: block.goal,
      startDate: block.startDate,
      endDate: block.endDate,
      lengthWeeks: block.lengthWeeks,
      overview: block.overview,
      createdAt: block.createdAt,
      model: block.model,
      promptVersion: block.promptVersion,
      durabilityTemplate: block.durabilityTemplate,
      days: truncateBlockDays(block.days, utcToday()),
    });
  }
  await writeCurrentBlock(null);
  return NextResponse.json({ ok: true, eventsRemoved, eventsFailed });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 5: Manual sanity check** (this route has no direct unit test in this codebase's convention — verify by hand)

Run: `npm run dev`, then with a block active:
```bash
curl -X DELETE http://localhost:3000/api/sync
cat data/block-history.json | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(d[0].days?.length))'
```
Expected: the discarded block's entry appears in `block-history.json` with a non-empty `days` array (or `0` if the block was discarded on day one, before any of its days had passed).

- [ ] **Step 6: Commit**

```bash
git add app/api/sync/route.ts
git commit -m "feat(block-history): archive a discarded block's lived days"
```

---

### Task 5: Wire history into the live sync path

**Files:**
- Modify: `app/api/sync/route.ts:267`

**Interfaces:**
- Consumes: `buildRideScores`'s new `history` param (Task 2); the `blockHistory` variable already read at line 252 for `offPlanFloor` — no new I/O.

- [ ] **Step 1: Pass `blockHistory` into the existing `buildRideScores` call**

Change line 267 from:

```ts
      const fresh = buildRideScores(block, lastSync.activities, ftpForDate, today, offPlanFloor, resolvedCal, contextForDate);
```

to:

```ts
      const fresh = buildRideScores(block, lastSync.activities, ftpForDate, today, offPlanFloor, resolvedCal, contextForDate, blockHistory);
```

`blockHistory` is already fetched two lines above `offPlanFloor`'s computation (line 252: `const blockHistory = await readBlockHistory();`) and is in scope at line 267 — this is the entire change. It feeds both `mergeScoreLog` (normal sync) and `mergeScoreLogRebuild` (rebuild) since both consume the same `fresh` array (line 286).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 4: Manual end-to-end sanity check**

Run: `npm run dev`, then:
```bash
curl -X POST http://localhost:3000/api/sync -H "Content-Type: application/json" -d '{}' | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const j=JSON.parse(d);console.log("scores:", j.scores?.length, "warnings:", j.warnings)})'
```
Expected: a normal 200 response, `scores` present, no new warnings. (There's nothing to observe changing yet in this app's current data — no block has rolled over — but this confirms the wiring doesn't break the live sync path.)

- [ ] **Step 5: Commit**

```bash
git add app/api/sync/route.ts
git commit -m "feat(sync): thread block-history into buildRideScores"
```

---

## Self-Review

**1. Spec coverage:**
- §4 data model (`BlockHistoryEntry.days`) → Task 1. ✓
- §3/§5 history-aware matching + tie-break + createdAt guard → Task 2. ✓
- §6 three archive call sites, including the discard-path gap (today calls no archive at all) → Tasks 3 & 4. ✓
- §5 single call site, feeds both normal-sync and rebuild merges → Task 5. ✓
- §9 test plan: historical match, current-wins-on-collision, createdAt guard, two-historical recency, no-`days` entry → all in Task 2's test step. Discard-path truncation → Task 4's manual verification step (no automated route test, per this repo's convention). ✓
- §10/§11 (pillar alignment, ship-before-2026-07-12) → no task needed, nothing to build; called out in Global Constraints instead. ✓
- §12 out-of-scope (provenance field, pruning, UI) → correctly has no task. ✓

**2. Placeholder scan:** No TBD/TODO; every step shows real before/after code, exact file:line, exact commands. ✓

**3. Type consistency:** `truncateBlockDays(days: CurrentBlockDay[], asOfDate: string): CurrentBlockDay[]` — identical signature and call shape in Tasks 1, 3, 4. `history?: BlockHistoryEntry[]` — same name and 8th positional slot in Task 2's `buildRideScores` signature and Task 5's call site. `historyEntry()` test fixture (Task 2) reuses the same `{date, type: WorkoutType, durationMin}` shape as the existing `block()` fixture. ✓

**Verified during authoring (not just assumed):** `buildRideScores` has exactly one production call site (`app/api/sync/route.ts:267`) — confirmed by grep before writing Task 5, so there's no second call site silently missing the `history` wire-up. `blockHistory` is already read at line 252 in the same scope for an unrelated computation (`offPlanFloor`) — Task 5 reuses it rather than adding a second `readBlockHistory()` call.
