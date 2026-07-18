# Block History Enrichment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist real execution outcomes and protocol/duration findings onto `CurrentBlockDay`/`BlockHistoryEntry.days`, so block history becomes a self-contained, honest record the season-selection signals (and future scorer weighting) can build on without re-joining the score log or re-running validators after the fact.

**Architecture:** Two independent, deterministic write-time stamps: (1) a pure backfill function that joins `RideScoreEntry` onto a day array by date, called from `/api/sync` right after the score log updates so the live current block and any still-relevant archived block both stay current; (2) the existing per-day protocol/duration validators, already used at generation time, re-run once more at `/api/write` time and frozen onto each day instead of being discarded after the write.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, Vitest.

## Global Constraints

- Run the full gate before every commit: `npm run check` (tsc --noEmit && eslint && vitest run). Zero errors, zero new warnings.
- New/changed fields on persisted types are **optional** and read with a truthy check, never `=== null` — an on-disk JSON file written before the field existed parses the key back as `undefined` (see `AGENTS.md`'s migration-flag rule; the same trap applies to any new optional field on an existing persisted shape).
- No new abstractions beyond what's specified below — reuse `validateWorkoutProtocol`/`validateDurationConsistency` (`lib/workout-validate.ts`) and the existing `RideScoreEntry` shape verbatim; do not introduce a new validation or scoring pipeline.
- This plan does not touch the generation prompt or call the Anthropic API — no live LLM smoke run is required (AGENTS.md's LLM-smoke-run rule only applies to changed generation paths).

---

### Task 1: `CurrentBlockDay` gains `execution` + `protocolFindings`, plus the pure backfill helper

**Files:**
- Modify: `lib/types.ts` (the `CurrentBlockDay` interface, ~line 291-311)
- Modify: `lib/score-log.ts` (add `backfillExecutionOntoDays`)
- Test: `lib/score-log.test.ts`

**Interfaces:**
- Produces: `CurrentBlockDay.execution?: { score: number; compliancePct: number | null }`, `CurrentBlockDay.protocolFindings?: string[]`
- Produces: `backfillExecutionOntoDays(days: CurrentBlockDay[], entries: RideScoreEntry[]): CurrentBlockDay[]` — pure, returns a **new array only where something changed** (referential equality preserved on unchanged days, so callers can diff cheaply)

- [ ] **Step 1: Write the failing test**

Add to `lib/score-log.test.ts` (near the other `buildRideScores`/merge tests):

```ts
import { backfillExecutionOntoDays } from "./score-log";
import type { CurrentBlockDay, RideScoreEntry } from "./types";

describe("backfillExecutionOntoDays", () => {
  const day = (date: string, overrides: Partial<CurrentBlockDay> = {}): CurrentBlockDay => ({
    date, name: "Threshold", type: "Threshold", durationMin: 60, ...overrides,
  });
  const entry = (date: string, overrides: Partial<RideScoreEntry> = {}): RideScoreEntry => ({
    date, executionScore: 8, plannedType: "Threshold", inferredType: "Threshold", planned: true,
    legacy: false, compliancePct: 95, intensityFactor: 0.9, ftpUsed: 250, durationMin: 60, tss: 80,
    ...overrides,
  });

  it("stamps execution score + compliance from a matching planned entry", () => {
    const out = backfillExecutionOntoDays([day("2026-07-01")], [entry("2026-07-01")]);
    expect(out[0].execution).toEqual({ score: 8, compliancePct: 95 });
  });

  it("leaves a day untouched (same reference) when no entry matches its date", () => {
    const days = [day("2026-07-01")];
    const out = backfillExecutionOntoDays(days, [entry("2026-07-02")]);
    expect(out[0]).toBe(days[0]);
  });

  it("ignores an off-plan entry (planned: false) — nothing to attribute to a prescribed day", () => {
    const out = backfillExecutionOntoDays([day("2026-07-01")], [entry("2026-07-01", { planned: false })]);
    expect(out[0].execution).toBeUndefined();
  });

  it("leaves a day untouched (same reference) when its stamp is already up to date — idempotent", () => {
    const days = [day("2026-07-01", { execution: { score: 8, compliancePct: 95 } })];
    const out = backfillExecutionOntoDays(days, [entry("2026-07-01")]);
    expect(out[0]).toBe(days[0]);
  });

  it("updates an existing stamp when the ledger entry has since changed (e.g. a rebuild)", () => {
    const days = [day("2026-07-01", { execution: { score: 5, compliancePct: 70 } })];
    const out = backfillExecutionOntoDays(days, [entry("2026-07-01", { executionScore: 9, compliancePct: 100 })]);
    expect(out[0].execution).toEqual({ score: 9, compliancePct: 100 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/score-log.test.ts -t "backfillExecutionOntoDays"`
Expected: FAIL — `backfillExecutionOntoDays is not a function` (not exported yet).

- [ ] **Step 3: Add the type fields**

In `lib/types.ts`, extend `CurrentBlockDay` (right after the existing `sessionLevel?: SessionLevel;` field, ~line 304):

```ts
  // Block history enrichment (ROADMAP season-architecture-redesign §8): the real execution outcome
  // for this day, joined from the score log once the session is actually ridden and scored. Absent
  // until scored, and on blocks/history written before this field existed — truthy-check, never
  // `=== null`.
  execution?: { score: number; compliancePct: number | null };
  // Deterministic protocol/duration findings for this day, re-run and frozen at WRITE time (the same
  // checks generation already ran — see lib/workout-validate.ts). Lets a later "written despite a
  // known violation" correlation exist without re-running validators against a since-changed FTP/
  // calibration. Absent when the day carries no findings, or on days written before this shipped.
  protocolFindings?: string[];
```

- [ ] **Step 4: Implement `backfillExecutionOntoDays`**

In `lib/score-log.ts`, add near `truncateBlockDays` (they're both small `CurrentBlockDay[]` transforms):

```ts
// Block history enrichment (ROADMAP season-architecture-redesign §8): join each day's real execution
// outcome from the score log by date. Planned-only (`e.planned`) — an off-plan ride has no prescribed
// day to attribute an outcome to. Pure; returns a fresh array only when at least one day's stamp
// actually changes, and preserves referential equality on every unchanged day so a caller (the sync
// route) can diff cheaply and only persist the days that moved.
export function backfillExecutionOntoDays(days: CurrentBlockDay[], entries: RideScoreEntry[]): CurrentBlockDay[] {
  const byDate = new Map(entries.filter((e) => e.planned).map((e) => [e.date, e]));
  let changed = false;
  const out = days.map((d) => {
    const e = byDate.get(d.date);
    if (!e) return d;
    if (d.execution?.score === e.executionScore && d.execution?.compliancePct === e.compliancePct) return d;
    changed = true;
    return { ...d, execution: { score: e.executionScore, compliancePct: e.compliancePct } };
  });
  return changed ? out : days;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/score-log.test.ts -t "backfillExecutionOntoDays"`
Expected: PASS (5 tests).

- [ ] **Step 6: Full gate + commit**

Run: `npm run check`
Expected: 0 tsc errors, 0 lint errors, all tests pass.

```bash
git add lib/types.ts lib/score-log.ts lib/score-log.test.ts
git commit -m "feat(season): add CurrentBlockDay.execution/protocolFindings + backfillExecutionOntoDays"
```

---

### Task 2: Transactional `updateBlockHistory` in the data store

**Files:**
- Modify: `lib/data-store.ts` (add `updateBlockHistory`, right after `appendBlockHistory`)
- Test: `lib/data-store.test.ts` (create if it doesn't already cover data-store; check first — if a test file already exists for `data-store.ts`, add to it instead of creating a new one)

**Interfaces:**
- Consumes: `updateJsonFile` from `./json-store` (already imported in this file as `updateJson`)
- Produces: `updateBlockHistory(mutate: (entries: BlockHistoryEntry[]) => BlockHistoryEntry[]): Promise<BlockHistoryEntry[]>`

- [ ] **Step 1: Check for an existing data-store test file**

Run: `ls lib/data-store.test.ts 2>/dev/null && echo EXISTS || echo MISSING`

If `MISSING`, the sync route's own tests already cover `updateCurrentBlock`/`updateScoreLog` behavior end-to-end (via `lib/json-store.ts`'s `updateJsonFile`, which is what's actually being exercised here) — so this step's test goes directly against `updateJson`'s real file-backed behavior using a temp dir, mirroring however `lib/json-store.test.ts` already sets up its fixtures. Read `lib/json-store.test.ts` first to copy its temp-directory/mock pattern exactly (it already solves "test a function that reads/writes `data/*.json`" for this codebase — do not invent a second pattern).

- [ ] **Step 2: Write the failing test**

Add to `lib/data-store.test.ts` (following whatever fixture pattern Step 1 found — the shape below assumes a temp-dir-backed `DATA_DIR`, matching `lib/json-store.test.ts`'s existing convention):

```ts
import { updateBlockHistory, readBlockHistory, appendBlockHistory } from "./data-store";
import type { BlockHistoryEntry } from "./types";

describe("updateBlockHistory", () => {
  const entry = (id: string, overrides: Partial<BlockHistoryEntry> = {}): BlockHistoryEntry => ({
    id, goal: "Build FTP", startDate: "2026-06-01", endDate: "2026-06-28", lengthWeeks: 4,
    overview: "", createdAt: "2026-06-01T00:00:00.000Z", ...overrides,
  });

  it("mutates and persists the block-history array", async () => {
    await appendBlockHistory(entry("a"));
    const out = await updateBlockHistory((entries) => entries.map((e) => (e.id === "a" ? { ...e, retrospective: "done" } : e)));
    expect(out.find((e) => e.id === "a")?.retrospective).toBe("done");
    expect((await readBlockHistory()).find((e) => e.id === "a")?.retrospective).toBe("done");
  });

  it("defaults to an empty array when block-history.json doesn't exist yet", async () => {
    const out = await updateBlockHistory((entries) => entries);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/data-store.test.ts -t "updateBlockHistory"`
Expected: FAIL — `updateBlockHistory is not a function`.

- [ ] **Step 4: Implement `updateBlockHistory`**

In `lib/data-store.ts`, right after `appendBlockHistory` (~line 139):

```ts
// Transactional read-modify-write on block history (mirrors updateCurrentBlock/updateScoreLog) — the
// read happens inside the per-file lock, so the sync route's execution-outcome backfill (§8) can't
// race a concurrent appendBlockHistory (a block discard/replace) and lose either write.
export async function updateBlockHistory(
  mutate: (entries: BlockHistoryEntry[]) => BlockHistoryEntry[]
): Promise<BlockHistoryEntry[]> {
  return updateJson<BlockHistoryEntry[]>("block-history.json", [], mutate);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/data-store.test.ts -t "updateBlockHistory"`
Expected: PASS (2 tests).

- [ ] **Step 6: Full gate + commit**

Run: `npm run check`

```bash
git add lib/data-store.ts lib/data-store.test.ts
git commit -m "feat(data-store): add transactional updateBlockHistory"
```

---

### Task 3: Wire the execution-outcome backfill into `/api/sync`

**Files:**
- Modify: `app/api/sync/route.ts` (right after the `updateScoreLog` block that currently ends ~line 530, before that `if` block's own closing brace)
- Test: `app/api/sync/route.test.ts`

**Interfaces:**
- Consumes: `backfillExecutionOntoDays` (Task 1), `updateBlockHistory` (Task 2), `updateCurrentBlock`/`mergeCurrentBlockDays` (already imported in this file), `readCurrentBlock`, `readBlockHistory` (already imported)

- [ ] **Step 1: Read the current test setup for this route**

Run: `grep -n "describe\|readCurrentBlock\|readBlockHistory\|updateScoreLog" app/api/sync/route.test.ts | head -40`

Confirm how the existing tests mock `lib/data-store` (likely `vi.mock("@/lib/data-store", ...)` with per-test overrides) — the new test must follow that exact mocking shape, not invent a new one.

- [ ] **Step 2: Write the failing test**

Add a test to `app/api/sync/route.test.ts` in whatever `describe` block already covers score-log updates on sync. Shape (adapt mock setup to match Step 1's findings):

```ts
it("backfills the fresh execution outcome onto the matching current-block day", async () => {
  // Arrange: mock readScoreLog/updateScoreLog to return an entry for 2026-07-01 with executionScore 9,
  // compliancePct 100, planned: true; mock readCurrentBlock to return a block whose days include
  // { date: "2026-07-01", name: "Threshold", type: "Threshold", durationMin: 60 } (no execution stamp yet).
  // Spy on mergeCurrentBlockDays (or updateCurrentBlock, whichever the implementation uses).
  const req = new Request("http://localhost/api/sync", { method: "GET" });
  await GET(req);
  expect(mergeCurrentBlockDaysMock).toHaveBeenCalledWith(
    expect.anything(),
    expect.arrayContaining([expect.objectContaining({ date: "2026-07-01", execution: { score: 9, compliancePct: 100 } })])
  );
});

it("does not call the block-day patch when no day's execution stamp actually changed", async () => {
  // Arrange: the current block's day already carries the matching execution stamp.
  const req = new Request("http://localhost/api/sync", { method: "GET" });
  await GET(req);
  expect(mergeCurrentBlockDaysMock).not.toHaveBeenCalled();
});
```

Fill in the exact mock return shapes using this route test file's existing helper builders (e.g. a `buildSyncData`/`buildCurrentBlock` factory, if one already exists in the file — grep for `function build` in `app/api/sync/route.test.ts` before writing fresh fixtures).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run app/api/sync/route.test.ts -t "backfills the fresh execution outcome"`
Expected: FAIL — the patch call never happens yet.

- [ ] **Step 4: Implement the backfill call**

In `app/api/sync/route.ts`, add the import:

```ts
import { backfillExecutionOntoDays } from "@/lib/score-log";
import { updateBlockHistory, readBlockHistory } from "@/lib/data-store"; // readBlockHistory already imported? check — merge into the existing import block from "@/lib/data-store" instead of a second import statement
```

(Both `updateBlockHistory` and `readBlockHistory` belong in the single existing `import { ... } from "@/lib/data-store"` block at the top of the file — add them there, not as a separate statement.)

Right after the `updateScoreLog(...)` call and its `if (doRebuild) { ... }` block (currently ending at line 530, still inside the outer `if` that started around line 460s), add:

```ts
      // §8 (season-architecture-redesign): now that the ledger reflects this sync's fresh scores,
      // backfill the real execution outcome onto the matching day — current block first (the common
      // case: a sync usually lands while the block that prescribed the ride is still live), then any
      // block-history entry that still carries the same date (a late sync after the block was already
      // archived/replaced). Best-effort: never fail the sync over a provenance stamp.
      try {
        const freshLog = await readScoreLog();
        const blockForBackfill = await readCurrentBlock();
        if (blockForBackfill) {
          const patchedDays = backfillExecutionOntoDays(blockForBackfill.days, freshLog.entries);
          if (patchedDays !== blockForBackfill.days) {
            const changedDates = new Set(
              patchedDays.filter((d, i) => d !== blockForBackfill.days[i]).map((d) => d.date)
            );
            await mergeCurrentBlockDays(blockForBackfill, patchedDays.filter((d) => changedDates.has(d.date)));
          }
        }
        const history = await readBlockHistory();
        const historyNeedsPatch = history.some((h) => h.days && backfillExecutionOntoDays(h.days, freshLog.entries) !== h.days);
        if (historyNeedsPatch) {
          await updateBlockHistory((entries) =>
            entries.map((h) => (h.days ? { ...h, days: backfillExecutionOntoDays(h.days, freshLog.entries) } : h))
          );
        }
      } catch (e) {
        logWarn("/api/sync", "execution-backfill", e instanceof Error ? e.message : String(e));
      }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/api/sync/route.test.ts -t "backfill"`
Expected: PASS.

- [ ] **Step 6: Full suite + commit**

Run: `npm run check`

```bash
git add app/api/sync/route.ts app/api/sync/route.test.ts
git commit -m "feat(sync): backfill real execution outcome onto block-history days"
```

---

### Task 4: Stamp protocol/duration findings at write time

**Files:**
- Modify: `app/api/write/route.ts` (the day-mapping closure ~line 138-160)
- Test: `app/api/write/route.test.ts`

**Interfaces:**
- Consumes: `validateWorkoutProtocol`, `validateDurationConsistency` (`lib/workout-validate.ts`, already exported), `resolveDurabilityInsertEnvelope` (`lib/calibration.ts`, already used by the generate route), `readBlockSettings` (`lib/data-store.ts`)

- [ ] **Step 1: Write the failing test**

Add to `app/api/write/route.test.ts`, in whatever `describe` block covers the `currentBlock.days` shape written by `POST`:

```ts
it("stamps protocolFindings onto a day whose workout text violates its own protocol", async () => {
  // Arrange the plan payload's day to include a SIT day whose workoutText prescribes an effort that
  // violates PROTOCOL.SIT (lib/workout-validate.ts) — e.g. a 90s all-out effort (maxEffortSec: 45).
  const body = {
    plan: {
      overview: "", blockParams: { lengthWeeks: 2, goal: "g", startDate: "2026-07-20", weakpoints: [] },
      days: [{ date: "2026-07-20", name: "SIT", type: "SIT", durationMin: 45, workoutText: "6x90s @ 150% FTP, 4min recovery", description: "" }],
    },
  };
  const req = new Request("http://localhost/api/write", { method: "POST", body: JSON.stringify(body) });
  const res = await POST(req);
  const { currentBlock } = await res.json();
  expect(currentBlock.days[0].protocolFindings).toEqual(
    expect.arrayContaining([expect.stringContaining("longer than protocol")])
  );
});

it("omits protocolFindings on a clean day", async () => {
  const body = {
    plan: {
      overview: "", blockParams: { lengthWeeks: 2, goal: "g", startDate: "2026-07-20", weakpoints: [] },
      days: [{ date: "2026-07-20", name: "Rest", type: "Rest", durationMin: 0, workoutText: "", description: "" }],
    },
  };
  const req = new Request("http://localhost/api/write", { method: "POST", body: JSON.stringify(body) });
  const res = await POST(req);
  const { currentBlock } = await res.json();
  expect(currentBlock.days[0].protocolFindings).toBeUndefined();
});
```

Check the file's existing mocks first (`isIntervalsConfigured`, `createEvent`, `readAthleteProfile`, `readCurrentBlock`, `readBlockSettings` if already mocked) and align the new tests' setup with them — do not duplicate a second mock scheme.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/write/route.test.ts -t "protocolFindings"`
Expected: FAIL — `currentBlock.days[0].protocolFindings` is `undefined` for the SIT-violation case.

- [ ] **Step 3: Implement the stamp**

In `app/api/write/route.ts`:

```ts
import { validateWorkoutProtocol, validateDurationConsistency } from "@/lib/workout-validate";
import { resolveDurabilityInsertEnvelope } from "@/lib/calibration";
import { readBlockSettings } from "@/lib/data-store"; // add to the existing @/lib/data-store import block, not a new statement
```

Fetch `blockSettings` alongside the existing `ftp` read (~line 116):

```ts
  const [athleteProfile, blockSettings] = await Promise.all([readAthleteProfile(), readBlockSettings()]);
  const ftp = athleteProfile.performance.ftp;
  const envelope = resolveDurabilityInsertEnvelope(blockSettings.durabilityInsertEnvelope);
```

(Replace the existing single `const ftp = (await readAthleteProfile()).performance.ftp;` line with the block above.)

In the day-mapping closure (~line 141-160), add the findings computation alongside `sessionLevel`:

```ts
      return plan.days.map((d) => {
        const prescription = parsePrescription(d.workoutText, ftp);
        const sessionLevel = computeSessionLevel(d.type, prescription);
        const eventId = eventIdByDate.get(d.date) ?? null;
        // §8 (season-architecture-redesign): freeze the same deterministic protocol/duration checks
        // generation already ran, so a "written despite a known violation" pattern is queryable later
        // without re-running validators against whatever FTP/calibration is live at query time.
        const protocolFindings = [
          ...validateWorkoutProtocol(d, ftp, envelope),
          ...(validateDurationConsistency(d) ? [validateDurationConsistency(d) as string] : []),
        ];
        return {
          date: d.date,
          name: d.name,
          type: d.type,
          durationMin: d.durationMin,
          ...(isLongRide(d) && plan.durabilityTemplate ? { durabilityTemplate: plan.durabilityTemplate } : {}),
          ...(d.workoutText ? { workoutText: d.workoutText } : {}),
          ...(prescription.length > 0 ? { prescription } : {}),
          ...(sessionLevel ? { sessionLevel } : {}),
          ...(eventId !== null ? { eventId } : {}),
          ...(protocolFindings.length > 0 ? { protocolFindings } : {}),
        };
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/write/route.test.ts -t "protocolFindings"`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite + commit**

Run: `npm run check`

```bash
git add app/api/write/route.ts app/api/write/route.test.ts
git commit -m "feat(write): stamp protocol/duration findings onto each written day"
```

---

### Task 5: Whole-plan verification

- [ ] **Step 1: Full gate**

Run: `npm run check`
Expected: 0 errors, all tests pass (existing + the ~9 new tests from Tasks 1-4).

- [ ] **Step 2: Manual spot-check against real local data**

Run a real `npm run dev` sync (or `curl -X GET http://127.0.0.1:3000/api/sync`) against the athlete's actual `data/current-block.json`, then inspect the file directly:

```bash
node -e "const b = require('./data/current-block.json'); console.log(JSON.stringify(b.days.filter(d => d.execution || d.protocolFindings), null, 2))"
```

Confirm at least one already-ridden day in the live block now carries an `execution` stamp (or, if every ridden day was already clean/compliant, confirm no `protocolFindings` false-positives appear on a day known to be well-formed).

- [ ] **Step 3: Update ROADMAP.md**

Remove the "`GeneratedPlan.protocolViolations`... `/api/write` doesn't persist it onto `CurrentBlockDay`" debt item from the "Season engine — known debt" section (`ROADMAP.md`, currently listed under the 2026-07-16 final-review tracked-debt bullets) — it's now closed by Task 4. Leave the `exposureFromSessions` measures-generated-not-ridden bullet and the others untouched (out of this plan's scope).

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): close the protocolViolations-not-persisted debt item"
```
