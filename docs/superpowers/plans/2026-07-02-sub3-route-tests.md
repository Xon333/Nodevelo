# SUB-3 · Route Tests for `/api/sync` + `/api/generate` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the two highest-stakes, least-tested routes — the 518-line `/api/sync` (reconciliation + scoring orchestration, guardian of the immutable ledger) and the 328-line `/api/generate` (tool-use parsing + validator pipeline) — wiring-level test coverage, closing ROADMAP SUB-3.

**Architecture:** Characterization tests of *existing, working* routes. Mock only the I/O boundaries (`@/lib/intervals-api` network, `@/lib/data-store` + `@/lib/physiology` filesystem, `@/lib/anthropic-api` LLM); let the pure pipeline (`score-log`, `sync-ledger`, `disposition`, `readiness`, `coach-snapshot`, validators) run for real. Handlers are invoked directly as functions with a `Request` — no server. This is the exact pattern already proven in `app/api/disposition/route.test.ts` (in-memory transactional store) and `app/api/generate/route.test.ts` (spread-actual module mocks).

**Tech Stack:** Vitest 4 (`environment: "node"`), TypeScript 5, Next.js 16 App Router route handlers.

## Global Constraints

- **Tests only. Never modify `app/api/sync/route.ts`, `app/api/generate/route.ts`, or anything in `lib/`.** If a test cannot pass without changing production code, STOP — you may have found a real bug; report it to the user instead of patching.
- **These tests are expected to PASS on first correct write** (the code under test already ships). A failing test means: (1) first suspect your fixture/mock, (2) then read the route to check the actual behavior, (3) only then consider it a genuine bug → stop and report.
- **No new dependencies.** `package.json` is untouched.
- **`vi.mock` calls are hoisted** — keep all `vi.mock(...)` blocks above the `import * as …` statements they mock, exactly as scaffolded. Never reorder them. Add new tests by appending `describe` blocks at the END of the file.
- **Run a single file with:** `npm test -- app/api/sync/route.test.ts` (or the generate path). Full suite: `npm test`.
- **Concurrent-agent checkout:** commit on `main` directly (no branches), stage ONLY the file(s) you touched (`git add <exact path>` — never `git add -A` or `git add .`). If a check fails in a file you did not edit, run `git status --short <file>` first — an uncommitted file is the other session's WIP; wait ~30s, retry once, then report rather than fix.
- Commit messages: conventional-commit style (`test(sync): …`, `test(generate): …`, `docs(roadmap): …`), each ending with the line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Dates in fixtures are all anchored to the constant `TODAY = "2026-06-22"` and passed explicitly in the POST body / query — no real-clock dependence except the DELETE tests, which use `vi.useFakeTimers()`.

## File Structure

- **Create:** `app/api/sync/route.test.ts` — new file, built up across Tasks 1–7 (scaffold + GET, then POST guards, ledger wiring, rebuild one-shot, warnings, today-analysis path, DELETE).
- **Modify:** `app/api/generate/route.test.ts` — Tasks 8–9 upgrade one mock and append two `describe` blocks. The two existing tests must keep passing unchanged.
- **Modify (docs):** `ROADMAP.md`, `ARCHIVE.md` — Task 10 moves SUB-3 to the archive.

---

### Task 1: Sync test scaffold + GET tests

**Files:**
- Create: `app/api/sync/route.test.ts`

**Interfaces:**
- Consumes: `GET`, `POST`, `DELETE` from `@/app/api/sync/route`; types + `DEFAULT_BLOCK_SETTINGS` from `@/lib/types`.
- Produces (used verbatim by Tasks 2–7 — do not rename):
  - `const TODAY = "2026-06-22"`
  - `mkActivity(over?: Partial<ActivitySummary>): ActivitySummary` — a 75-min Ride on `TODAY`, NP 190, avgWatts 180
  - `mkSync(over?: Partial<SyncData>): SyncData` — empty activities/wellness, fitness `{ctl:50, atl:55, tsb:-5}`
  - `mkBlock(over?: Partial<CurrentBlock>): CurrentBlock` — 2-week block 2026-06-15→28, one planned Threshold day on `TODAY` with `workoutText: "Main Set 3x\n- 12m 95%"`
  - `mkScoreEntry(over?: Partial<RideScoreEntry>): RideScoreEntry` — frozen planned Threshold entry, date 2026-06-20, `executionScore: 9`, `ftpUsed: 250`
  - `let scoreEntries: RideScoreEntry[]` — in-memory ledger; `readScoreLog`/`updateScoreLog` mocks read/mutate it
  - `postSync(body?: Record<string, unknown>)` — POSTs JSON, defaults `{ today: TODAY }`
  - Mocked module handles: `api` (intervals-api), `anthropic`, `phys` (physiology), `store` (data-store)
  - Mock defaults set in `beforeEach`: intervals configured=true, `runFullSync`→empty `mkSync()`, anthropic configured=false, physiology store null, all data-store reads → empty/default fixtures, profile FTP **200**

- [ ] **Step 1: Write the scaffold + two GET tests**

Create `app/api/sync/route.test.ts` with exactly this content:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BLOCK_SETTINGS } from "@/lib/types";
import type { ActivitySummary, CurrentBlock, RideScoreEntry, SyncData } from "@/lib/types";

// Route tests for /api/sync (SUB-3): the 500-line orchestrator guarding the immutable ledger.
// Network (intervals-api) + fs (data-store, physiology) are mocked at the module boundary; the
// scoring/merge/snapshot pipeline (score-log, sync-ledger, disposition, readiness, coach-snapshot)
// runs for real — these prove the WIRING (immutability, rebuild one-shot, warning surfacing),
// not the unit-tested internals.

vi.mock("@/lib/intervals-api", async (orig) => {
  const actual = await orig<typeof import("@/lib/intervals-api")>();
  return {
    ...actual, // IntervalsApiError + isSuspectEmptySync (pure) stay real
    isIntervalsConfigured: vi.fn(() => true),
    runFullSync: vi.fn(),
    fetchSportSettings: vi.fn(async () => null),
    fetchIntervals: vi.fn(async () => []),
    fetchPowerStream: vi.fn(async () => []),
    fetchHrStream: vi.fn(async () => []),
    deleteEvents: vi.fn(async () => ({ deleted: [], failed: [] })),
  };
});
vi.mock("@/lib/anthropic-api", async (orig) => {
  const actual = await orig<typeof import("@/lib/anthropic-api")>();
  return { ...actual, isAnthropicConfigured: vi.fn(() => false) };
});
vi.mock("@/lib/physiology", async (orig) => {
  const actual = await orig<typeof import("@/lib/physiology")>();
  return {
    ...actual, // physiologyAsOf + reconcile (pure) stay real
    readPhysiology: vi.fn(async () => null),
    writePhysiology: vi.fn(async () => undefined),
    readPowerZones: vi.fn(async () => []),
    readHrZones: vi.fn(async () => []),
  };
});
vi.mock("@/lib/data-store", () => ({
  appendBlockHistory: vi.fn(),
  readAthleteProfile: vi.fn(),
  readBlockHistory: vi.fn(),
  readBlockSettings: vi.fn(),
  readCurrentBlock: vi.fn(),
  readDispositions: vi.fn(),
  readCalibration: vi.fn(),
  readInterventionLog: vi.fn(),
  readLastSync: vi.fn(),
  readLedgerRebuild: vi.fn(),
  readMorningChecks: vi.fn(),
  readRollingBaselines: vi.fn(),
  readScoreLog: vi.fn(),
  readTodayAnalysis: vi.fn(),
  updateScoreLog: vi.fn(),
  writeCalibration: vi.fn(),
  writeCurrentBlock: vi.fn(),
  writeInterventionLog: vi.fn(),
  writeLastSync: vi.fn(),
  writeLedgerRebuild: vi.fn(),
  writeQuirks: vi.fn(),
  writeRollingBaselines: vi.fn(),
  writeTodayAnalysis: vi.fn(),
}));

import * as api from "@/lib/intervals-api";
import * as anthropic from "@/lib/anthropic-api";
import * as phys from "@/lib/physiology";
import * as store from "@/lib/data-store";
import { DELETE, GET, POST } from "@/app/api/sync/route";

const TODAY = "2026-06-22";

const profile = {
  performance: { ftp: 200, maxHr: 190, thresholdHr: 170, weightKg: 75, weeklyHoursMin: 6, weeklyHoursMax: 10 },
  goals: [],
  weakpoints: [],
  nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 75 },
  goalsMigratedAt: null,
  updatedAt: "",
};

const mkActivity = (over: Partial<ActivitySummary> = {}): ActivitySummary => ({
  id: "a1",
  date: TODAY,
  type: "Ride",
  name: "Morning Ride",
  movingTimeSec: 4500,
  avgWatts: 180,
  normalizedPower: 190,
  maxWatts: 600,
  icuFtp: null,
  avgHr: 140,
  maxHr: 172,
  kj: 810,
  trainingLoad: 70,
  rpe: null,
  carbsIngestedG: null,
  decoupling: null,
  efficiencyFactor: null,
  powerHrZ2: null,
  powerHrZ2Mins: null,
  description: null,
  avgCadence: 90,
  distanceMeters: 40_000,
  elevationGain: 300,
  powerZoneTimes: null,
  hrZoneTimes: null,
  ...over,
});

const mkSync = (over: Partial<SyncData> = {}): SyncData => ({
  syncedAt: "2026-06-22T08:00:00.000Z",
  activities: [],
  wellness: [],
  powerCurve: [],
  powerCurveAllTime: [],
  fitness: { ctl: 50, atl: 55, tsb: -5 },
  ...over,
});

const mkBlock = (over: Partial<CurrentBlock> = {}): CurrentBlock => ({
  goal: "Build FTP",
  lengthWeeks: 2,
  startDate: "2026-06-15",
  endDate: "2026-06-28",
  overview: "test block",
  createdAt: "2026-06-14T10:00:00.000Z",
  days: [{ date: TODAY, name: "Threshold 3x12", type: "Threshold", durationMin: 75, workoutText: "Main Set 3x\n- 12m 95%" }],
  ...over,
});

const mkScoreEntry = (over: Partial<RideScoreEntry> = {}): RideScoreEntry => ({
  date: "2026-06-20",
  executionScore: 9,
  plannedType: "Threshold",
  inferredType: "Threshold",
  planned: true,
  legacy: false,
  compliancePct: 100,
  intensityFactor: 0.9,
  ftpUsed: 250,
  durationMin: 75,
  tss: 80,
  ...over,
});

// In-memory score-log the transactional mutators run against (disposition-route pattern), so the
// merge/patch effects are observable after the handler returns.
let scoreEntries: RideScoreEntry[];

beforeEach(() => {
  vi.clearAllMocks();
  scoreEntries = [];
  vi.mocked(api.isIntervalsConfigured).mockReturnValue(true);
  vi.mocked(api.runFullSync).mockResolvedValue(mkSync());
  vi.mocked(api.fetchSportSettings).mockResolvedValue(null);
  vi.mocked(api.fetchIntervals).mockResolvedValue([]);
  vi.mocked(api.fetchPowerStream).mockResolvedValue([]);
  vi.mocked(api.fetchHrStream).mockResolvedValue([]);
  vi.mocked(api.deleteEvents).mockResolvedValue({ deleted: [], failed: [] });
  vi.mocked(anthropic.isAnthropicConfigured).mockReturnValue(false);
  vi.mocked(phys.readPhysiology).mockResolvedValue(null);
  vi.mocked(phys.readPowerZones).mockResolvedValue([]);
  vi.mocked(phys.readHrZones).mockResolvedValue([]);

  vi.mocked(store.readAthleteProfile).mockResolvedValue(profile as never);
  vi.mocked(store.readBlockHistory).mockResolvedValue([]);
  vi.mocked(store.readBlockSettings).mockResolvedValue(DEFAULT_BLOCK_SETTINGS);
  vi.mocked(store.readCurrentBlock).mockResolvedValue(null);
  vi.mocked(store.readDispositions).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.readCalibration).mockResolvedValue({
    decouplingGood: { value: 5, source: "default", confidence: "low", dataPoints: 0, lastUpdated: "", locked: false, manualOverride: null },
    updatedAt: "",
  });
  vi.mocked(store.readInterventionLog).mockResolvedValue({ records: [], updatedAt: "" });
  vi.mocked(store.readLastSync).mockResolvedValue(null);
  vi.mocked(store.readLedgerRebuild).mockResolvedValue({ rebuiltAt: null });
  vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.readRollingBaselines).mockResolvedValue({
    avgCtl90d: null,
    avgDecoupling90d: null,
    avgCadence90d: null,
    avgTss90d: null,
    avgWeeklyHours90d: null,
    ridesPerWeek90d: null,
    updatedAt: "",
  });
  vi.mocked(store.readScoreLog).mockImplementation(async () => ({ entries: scoreEntries, updatedAt: "" }));
  vi.mocked(store.readTodayAnalysis).mockResolvedValue(null);
  vi.mocked(store.updateScoreLog).mockImplementation(async (mutate) => {
    scoreEntries = mutate(scoreEntries);
    return { entries: scoreEntries, updatedAt: "" };
  });
});

const postSync = (body: Record<string, unknown> = { today: TODAY }) =>
  POST(new Request("http://t/api/sync", { method: "POST", body: JSON.stringify(body) }));

describe("GET /api/sync", () => {
  it("returns null readiness/load signals before any sync", async () => {
    const res = await GET(new Request(`http://t/api/sync?today=${TODAY}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.configured).toBe(true);
    expect(json.lastSync).toBeNull();
    expect(json.readiness).toBeNull();
    expect(json.fatigueAlert).toBeNull();
    expect(json.loadRamp).toBeNull();
    expect(json.acwr).toBeNull();
    expect(json.polarization).toBeNull();
    expect(json.autoSyncOnOpen).toBe(true);
  });

  it("filters legacy + compromised entries out of scores but surfaces their dates", async () => {
    scoreEntries = [
      mkScoreEntry({ date: "2026-06-18" }),
      mkScoreEntry({ date: "2026-06-19", legacy: true }),
      mkScoreEntry({ date: "2026-06-20", compromised: true }),
    ];
    vi.mocked(store.readDispositions).mockResolvedValue({
      entries: [
        { date: "2026-06-20", disposition: "compromised", reason: "equipment", setAt: "" },
        { date: "2026-06-21", disposition: "partial", reason: null, setAt: "" },
      ],
      updatedAt: "",
    });
    const json = await (await GET(new Request(`http://t/api/sync?today=${TODAY}`))).json();
    expect(json.scores.map((e: RideScoreEntry) => e.date)).toEqual(["2026-06-18"]);
    expect(json.compromisedDates).toEqual(["2026-06-20"]);
    expect(json.partialDates).toEqual(["2026-06-21"]);
  });
});
```

- [ ] **Step 2: Run the file — both tests pass**

Run: `npm test -- app/api/sync/route.test.ts`
Expected: `2 passed`. If it fails on a type error in a fixture, fix the fixture against `lib/types.ts` — never widen with `any`; the established repo escape hatch is `as never` on a mock's resolved value.

- [ ] **Step 3: Commit**

```bash
git add app/api/sync/route.test.ts
git commit -m "test(sync): route-test scaffold + GET coverage (SUB-3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: POST guards + error mapping

**Files:**
- Modify: `app/api/sync/route.test.ts` (append a `describe` block at the end)

**Interfaces:**
- Consumes (from Task 1, already in the file): `postSync(body?)`, `mkSync(over?)`, `mkActivity(over?)`, mocked handles `api`/`store`. `api.IntervalsApiError` is the REAL class (spread-actual mock), constructor `(message: string, status?: number)`. `api.isSuspectEmptySync` is real: returns true only when the previous sync had activities/wellness and the fresh one has neither.
- Produces: nothing consumed later — self-contained assertions.

- [ ] **Step 1: Append the guard tests**

```ts
describe("POST /api/sync — guards + error mapping", () => {
  it("400 when Intervals.icu is not configured", async () => {
    vi.mocked(api.isIntervalsConfigured).mockReturnValue(false);
    const res = await postSync();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/INTERVALS_API_KEY/);
    expect(api.runFullSync).not.toHaveBeenCalled();
  });

  it("502 + keeps previous data when upstream returns a suspect empty sync (CR-C)", async () => {
    vi.mocked(store.readLastSync).mockResolvedValue(
      mkSync({
        activities: [mkActivity({ date: "2026-06-18" })],
        wellness: [{ date: "2026-06-18", weightKg: 75, hrv: null, sleepHours: 7, sleepQuality: null, kcalConsumed: null, ctl: 50, atl: 55 }],
      })
    );
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync()); // no activities AND no wellness
    const res = await postSync();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/no activities or wellness/);
    expect(store.writeLastSync).not.toHaveBeenCalled(); // previous store untouched
  });

  it("maps an Intervals 401 to 401 and any other failure to 502", async () => {
    vi.mocked(api.runFullSync).mockRejectedValueOnce(new api.IntervalsApiError("Unauthorized", 401));
    expect((await postSync()).status).toBe(401);

    vi.mocked(api.runFullSync).mockRejectedValueOnce(new Error("boom"));
    const res = await postSync();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("boom");
  });
});
```

- [ ] **Step 2: Run the file — 5 tests pass**

Run: `npm test -- app/api/sync/route.test.ts`
Expected: `5 passed`.

- [ ] **Step 3: Commit**

```bash
git add app/api/sync/route.test.ts
git commit -m "test(sync): POST config/empty-sync guards + 401/502 error mapping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: POST happy path + ledger immutability wiring (the core of SUB-3)

**Files:**
- Modify: `app/api/sync/route.test.ts` (append at the end)

**Interfaces:**
- Consumes (from Task 1): `postSync`, `mkSync`, `mkActivity`, `mkBlock`, `mkScoreEntry`, `scoreEntries`, handles `api`/`store`.
- Key behavior under test (real code, mocked edges): `buildRideScores` scores planned rides against block days matched by date; `mergeScoreLog(backfilled, fresh)` = **existing entry wins per date**; `applyDispositions` stamps `compromised: true`. With the physiology store null, a fresh entry's `ftpUsed` falls back to the profile FTP (**200**) — while the seeded frozen entry carries **250**. That 250-vs-200 difference is the immutability discriminator.
- Produces: nothing consumed later.

- [ ] **Step 1: Append the ledger-wiring tests**

```ts
describe("POST /api/sync — ledger wiring", () => {
  it("persists the fresh sync + derived stores on a normal sync", async () => {
    const fresh = mkSync({ activities: [mkActivity({ id: "a21", date: "2026-06-21" })] });
    vi.mocked(api.runFullSync).mockResolvedValue(fresh);
    const res = await postSync();
    expect(res.status).toBe(200);
    expect(store.writeLastSync).toHaveBeenCalledWith(fresh);
    expect(store.writeRollingBaselines).toHaveBeenCalledOnce();
    expect(store.writeCalibration).toHaveBeenCalledOnce();
    expect(store.writeQuirks).toHaveBeenCalledOnce();
    const json = await res.json();
    expect(json.warnings).toEqual([]);
    expect(json.athleteState).not.toBeNull();
    expect(json.coachSnapshot).not.toBeNull();
  });

  it("keeps existing ledger entries immutable per date and scores only new dates", async () => {
    scoreEntries = [mkScoreEntry({ date: "2026-06-20", executionScore: 9, ftpUsed: 250 })];
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({
        days: [
          { date: "2026-06-20", name: "Threshold 3x12", type: "Threshold", durationMin: 75, workoutText: "Main Set 3x\n- 12m 95%" },
          { date: "2026-06-21", name: "Endurance", type: "Z2", durationMin: 90, workoutText: "- 90m 65%" },
        ],
      })
    );
    vi.mocked(api.runFullSync).mockResolvedValue(
      mkSync({
        activities: [
          mkActivity({ id: "a20", date: "2026-06-20" }),
          mkActivity({ id: "a21", date: "2026-06-21", movingTimeSec: 5400, avgWatts: 130, normalizedPower: 135 }),
        ],
      })
    );
    await postSync();
    // Existing wins: the frozen 06-20 entry survives untouched (immutable per date) even though the
    // fresh sync re-scored that date.
    expect(scoreEntries.find((e) => e.date === "2026-06-20")).toMatchObject({ executionScore: 9, ftpUsed: 250 });
    // The new date joins the ledger, scored as planned against the current FTP fallback (200).
    const e21 = scoreEntries.find((e) => e.date === "2026-06-21");
    expect(e21).toBeDefined();
    expect(e21?.planned).toBe(true);
    expect(e21?.ftpUsed).toBe(200);
  });

  it("stamps athlete dispositions onto the merged ledger and filters them from the response scores", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({ days: [{ date: "2026-06-21", name: "Endurance", type: "Z2", durationMin: 90, workoutText: "- 90m 65%" }] })
    );
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: [mkActivity({ id: "a21", date: "2026-06-21" })] }));
    vi.mocked(store.readDispositions).mockResolvedValue({
      entries: [{ date: "2026-06-21", disposition: "compromised", reason: "sickness", setAt: "" }],
      updatedAt: "",
    });
    const json = await (await postSync()).json();
    expect(scoreEntries.find((e) => e.date === "2026-06-21")?.compromised).toBe(true);
    expect(json.scores.map((e: RideScoreEntry) => e.date)).not.toContain("2026-06-21");
    expect(json.compromisedDates).toContain("2026-06-21");
  });
});
```

- [ ] **Step 2: Run the file — 8 tests pass**

Run: `npm test -- app/api/sync/route.test.ts`
Expected: `8 passed`.
If "scores only new dates" fails because `e21` is undefined: read `lib/score-log.ts` `buildRideScores` to see what filtered the ride out (activity type must be Ride/VirtualRide, date ≤ `today`, block day `durationMin > 0` — the fixtures satisfy all three; do not loosen the assertion without understanding why).

- [ ] **Step 3: Commit**

```bash
git add app/api/sync/route.test.ts
git commit -m "test(sync): POST happy path + ledger per-date immutability + disposition stamping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: POST ledger-rebuild one-shot semantics (LEDGER-3)

**Files:**
- Modify: `app/api/sync/route.test.ts` (append at the end)

**Interfaces:**
- Consumes (from Task 1): `postSync`, `mkSync`, `mkActivity`, `mkBlock`, `mkScoreEntry`, `scoreEntries`, handles `api`/`store`.
- Key behavior under test: `shouldRebuildLedger(requested, alreadyRebuilt, force)` gates the destructive path; under rebuild, `mergeScoreLogRebuild(fresh, existing)` lets the FRESH re-score win per date (verified: only the frozen `formState` context is carried forward — `ftpUsed` is the fresh value). Same 250 (frozen) vs 200 (fresh fallback) discriminator as Task 3, now expected to flip.
- Produces: nothing consumed later.

- [ ] **Step 1: Append the rebuild tests**

```ts
describe("POST /api/sync — ledger rebuild one-shot (LEDGER-3)", () => {
  const seedRebuildScenario = () => {
    scoreEntries = [mkScoreEntry({ date: "2026-06-20", executionScore: 9, ftpUsed: 250 })];
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({ days: [{ date: "2026-06-20", name: "Threshold 3x12", type: "Threshold", durationMin: 75, workoutText: "Main Set 3x\n- 12m 95%" }] })
    );
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: [mkActivity({ id: "a20", date: "2026-06-20" })] }));
  };

  it("re-scores past entries when requested and unmarked, then persists the marker", async () => {
    seedRebuildScenario();
    const json = await (await postSync({ today: TODAY, rebuildLedger: true })).json();
    // Fresh wins under rebuild: the entry is re-scored against the current FTP resolution (200),
    // no longer the frozen 250.
    expect(scoreEntries.find((e) => e.date === "2026-06-20")?.ftpUsed).toBe(200);
    expect(store.writeLedgerRebuild).toHaveBeenCalledOnce();
    expect(json.warnings.some((w: string) => /Ledger rebuilt/.test(w))).toBe(true);
  });

  it("refuses a repeat rebuild once the marker is set", async () => {
    seedRebuildScenario();
    vi.mocked(store.readLedgerRebuild).mockResolvedValue({ rebuiltAt: "2026-06-01T00:00:00.000Z" });
    const json = await (await postSync({ today: TODAY, rebuildLedger: true })).json();
    expect(scoreEntries.find((e) => e.date === "2026-06-20")?.ftpUsed).toBe(250); // frozen entry kept
    expect(store.writeLedgerRebuild).not.toHaveBeenCalled();
    expect(json.warnings.some((w: string) => /already rebuilt/.test(w))).toBe(true);
  });

  it("force re-runs a rebuild past the marker", async () => {
    seedRebuildScenario();
    vi.mocked(store.readLedgerRebuild).mockResolvedValue({ rebuiltAt: "2026-06-01T00:00:00.000Z" });
    await postSync({ today: TODAY, rebuildLedger: true, force: true });
    expect(scoreEntries.find((e) => e.date === "2026-06-20")?.ftpUsed).toBe(200);
    expect(store.writeLedgerRebuild).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the file — 11 tests pass**

Run: `npm test -- app/api/sync/route.test.ts`
Expected: `11 passed`.

- [ ] **Step 3: Commit**

```bash
git add app/api/sync/route.test.ts
git commit -m "test(sync): rebuild one-shot gating — runs once, marker refuses repeats, force overrides

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: POST physiology reconcile + best-effort warning surfacing

**Files:**
- Modify: `app/api/sync/route.test.ts` (append at the end)

**Interfaces:**
- Consumes (from Task 1): `postSync`, handles `api`/`phys`/`store`. `phys.reconcile` is REAL: with a null prior store it returns `{ store: { current: incoming, history: [] }, changed: false }`.
- Ordering fact this task relies on: inside POST, the intervention-validation `try` block contains the FIRST `readScoreLog()` call of the request; a later second call feeds the response. So `mockRejectedValueOnce` on `readScoreLog` fails exactly the validation pass and nothing else.
- Produces: nothing consumed later.

- [ ] **Step 1: Append the reconcile + warning tests**

```ts
describe("POST /api/sync — physiology reconcile + best-effort warnings", () => {
  it("reconciles incoming sport-settings into the physiology store", async () => {
    const snapshot = {
      effectiveFrom: TODAY,
      capturedAt: "2026-06-22T08:00:00.000Z",
      source: "intervals" as const,
      ftp: 260,
      lthr: 165,
      maxHr: 190,
      powerZonePct: [55, 75, 90, 105, 120, 150],
      hrZones: [120, 140, 155, 165, 175, 190],
      hrZonesAreBpm: true,
      powerZoneNames: [],
      hrZoneNames: [],
    };
    vi.mocked(api.fetchSportSettings).mockResolvedValue(snapshot);
    await postSync();
    // First-ever snapshot: reconcile (real) seeds the store with it as current, empty history.
    expect(phys.writePhysiology).toHaveBeenCalledWith({ current: snapshot, history: [] });
  });

  it("surfaces a quirk-extraction failure as a warning without failing the sync", async () => {
    vi.mocked(store.writeQuirks).mockRejectedValueOnce(new Error("disk full"));
    const res = await postSync();
    expect(res.status).toBe(200);
    expect((await res.json()).warnings.some((w: string) => /Quirk extraction failed: disk full/.test(w))).toBe(true);
  });

  it("surfaces an intervention-validation failure as a warning without failing the sync", async () => {
    vi.mocked(store.readScoreLog).mockRejectedValueOnce(new Error("corrupt log"));
    const res = await postSync();
    expect(res.status).toBe(200);
    expect((await res.json()).warnings.some((w: string) => /Intervention validation failed: corrupt log/.test(w))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the file — 14 tests pass**

Run: `npm test -- app/api/sync/route.test.ts`
Expected: `14 passed`.

- [ ] **Step 3: Commit**

```bash
git add app/api/sync/route.test.ts
git commit -m "test(sync): physiology reconcile wiring + best-effort failures surface as warnings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: POST today-ride deterministic-analysis path

**Files:**
- Modify: `app/api/sync/route.test.ts` (append at the end)

**Interfaces:**
- Consumes (from Task 1): `postSync`, `mkSync`, `mkActivity`, `mkBlock`, `scoreEntries`, `TODAY`, handles `api`/`anthropic`/`store`.
- Path under test (route lines ~309–430): with Anthropic configured AND a Ride on `today`, the route re-buckets zones (streams mocked empty → falls back), parses the day's `workoutText` into a prescription, fetches intervals (mocked `[]`), runs the REAL `buildTodayAnalysis`, writes it, and — because the interval-aware `executionScore` is non-null — patches today's ledger entry in a SECOND `updateScoreLog` call. `analysisPending` is true because no `coachNote` exists yet (the LLM note is deferred to `/api/analyze`).
- Produces: nothing consumed later.

- [ ] **Step 1: Append the today-analysis tests**

```ts
describe("POST /api/sync — today-ride analysis path", () => {
  const seedTodayRide = () => {
    vi.mocked(anthropic.isAnthropicConfigured).mockReturnValue(true);
    vi.mocked(store.readCurrentBlock).mockResolvedValue(mkBlock()); // planned Threshold on TODAY
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: [mkActivity()] })); // ride on TODAY
  };

  it("writes the deterministic analysis, patches today's ledger entry, and flags the LLM note pending", async () => {
    seedTodayRide();
    const res = await postSync();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(store.writeTodayAnalysis).toHaveBeenCalledOnce();
    expect(json.todayAnalysis).not.toBeNull();
    expect(json.todayAnalysis.activityDate).toBe(TODAY);
    expect(json.analysisPending).toBe(true); // no coach note yet — client must call /api/analyze
    // The interval-aware score is patched onto today's ledger entry in a second transactional
    // updateScoreLog call, so the Today card and the ledger can't disagree.
    expect(store.updateScoreLog).toHaveBeenCalledTimes(2);
    expect(scoreEntries.find((e) => e.date === TODAY)?.executionScore).toBe(json.todayAnalysis.executionScore);
  });

  it("surfaces an analysis failure as a warning while the sync itself succeeds", async () => {
    seedTodayRide();
    vi.mocked(api.fetchPowerStream).mockRejectedValueOnce(new Error("stream 500"));
    const res = await postSync();
    expect(res.status).toBe(200);
    expect((await res.json()).warnings.some((w: string) => /Ride analysis failed: stream 500/.test(w))).toBe(true);
    expect(store.writeTodayAnalysis).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the file — 16 tests pass**

Run: `npm test -- app/api/sync/route.test.ts`
Expected: `16 passed`.
If `updateScoreLog` was only called once: `buildTodayAnalysis` returned a null `executionScore`, meaning the fixture ride didn't score. Check that `mkActivity()`'s `normalizedPower` (190) and the block day's date/`workoutText` reached the route unmodified — read `lib/ride-analysis.ts` `buildTodayAnalysis` before touching anything.

- [ ] **Step 3: Commit**

```bash
git add app/api/sync/route.test.ts
git commit -m "test(sync): today-ride analysis path — write, ledger patch, pending flag, failure warning

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: DELETE — discard block (SUB-1 archive semantics)

**Files:**
- Modify: `app/api/sync/route.test.ts` (append at the end)

**Interfaces:**
- Consumes (from Task 1): `mkBlock`, handles `api`/`store`; `DELETE` from the route import (takes NO arguments).
- Clock: `DELETE` uses the real clock via `utcToday()` — pin it with fake timers to `2026-06-22`. `truncateBlockDays(days, today)` keeps dates `<= today`. `blockEventIds` collects every day's numeric `eventId`.
- Produces: nothing consumed later.

- [ ] **Step 1: Append the DELETE tests**

```ts
describe("DELETE /api/sync — discard block", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("archives only the lived days, removes calendar events, and clears the block", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({
        days: [
          { date: "2026-06-20", name: "Threshold", type: "Threshold", durationMin: 75, eventId: 11 },
          { date: "2026-06-21", name: "Endurance", type: "Z2", durationMin: 90, eventId: 12 },
          { date: "2026-06-25", name: "VO2max", type: "VO2max", durationMin: 60, eventId: 13 },
        ],
      })
    );
    vi.mocked(api.deleteEvents).mockResolvedValue({ deleted: [11, 12, 13], failed: [] });
    const json = await (await DELETE()).json();
    expect(api.deleteEvents).toHaveBeenCalledWith([11, 12, 13]);
    expect(store.appendBlockHistory).toHaveBeenCalledOnce();
    const archived = vi.mocked(store.appendBlockHistory).mock.calls[0][0];
    expect(archived.days?.map((d) => d.date)).toEqual(["2026-06-20", "2026-06-21"]); // future 06-25 dropped
    expect(store.writeCurrentBlock).toHaveBeenCalledWith(null);
    expect(json).toMatchObject({ ok: true, eventsRemoved: 3, eventsFailed: [] });
  });

  it("does not archive a same-day discard with no lived days (SUB-1 noise guard)", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({
        startDate: "2026-06-23",
        days: [{ date: "2026-06-23", name: "Threshold", type: "Threshold", durationMin: 75 }],
      })
    );
    const json = await (await DELETE()).json();
    expect(store.appendBlockHistory).not.toHaveBeenCalled();
    expect(store.writeCurrentBlock).toHaveBeenCalledWith(null);
    expect(json.ok).toBe(true);
  });

  it("handles no active block", async () => {
    const json = await (await DELETE()).json();
    expect(api.deleteEvents).not.toHaveBeenCalled();
    expect(store.appendBlockHistory).not.toHaveBeenCalled();
    expect(json).toMatchObject({ ok: true, eventsRemoved: 0 });
  });
});
```

- [ ] **Step 2: Run the file — 19 tests pass**

Run: `npm test -- app/api/sync/route.test.ts`
Expected: `19 passed`.

- [ ] **Step 3: Run the FULL suite to prove no cross-file damage**

Run: `npm test`
Expected: all suites pass (49 lib suites + 7 route files).

- [ ] **Step 4: Commit**

```bash
git add app/api/sync/route.test.ts
git commit -m "test(sync): DELETE discard — lived-days archive, calendar cleanup, same-day noise guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Generate route — configurable mock + request-validation tests

**Files:**
- Modify: `app/api/generate/route.test.ts`

**Interfaces:**
- Consumes: the file's existing mocks (`h.toolInput` hoisted fixture, `gen(goal)` helper, mocked `@/lib/data-store` as `store`). `beforeEach` uses `vi.clearAllMocks()` which clears CALLS but NOT implementations — so factory-level implementations survive and per-test `mockReturnValueOnce`/`mockResolvedValueOnce` layering works.
- Produces (for Task 9): `anthropic` namespace import of the mocked `@/lib/anthropic-api`, with `isAnthropicConfigured` and `generateTrainingBlock` both `vi.fn`s that can be overridden per-test. `GENERATION_MODEL`/`PROMPT_VERSION` re-exported real via spread-actual.

- [ ] **Step 1: Make `isAnthropicConfigured` overridable**

In `app/api/generate/route.test.ts`, replace this existing mock block:

```ts
vi.mock("@/lib/anthropic-api", async (orig) => {
  const actual = await orig<typeof import("@/lib/anthropic-api")>();
  return {
    ...actual,
    isAnthropicConfigured: () => true,
    generateTrainingBlock: vi.fn(async () => ({ toolInput: h.toolInput, raw: "", truncated: false })),
  };
});
```

with:

```ts
vi.mock("@/lib/anthropic-api", async (orig) => {
  const actual = await orig<typeof import("@/lib/anthropic-api")>();
  return {
    ...actual,
    isAnthropicConfigured: vi.fn(() => true),
    generateTrainingBlock: vi.fn(async () => ({ toolInput: h.toolInput, raw: "", truncated: false })),
  };
});
```

(One change: `isAnthropicConfigured` becomes a `vi.fn` with the same default.)

- [ ] **Step 2: Add the mocked-module import**

Directly below the existing line `import * as store from "@/lib/data-store";` add:

```ts
import * as anthropic from "@/lib/anthropic-api";
```

- [ ] **Step 3: Append the request-validation tests at the end of the file**

```ts
describe("POST /api/generate — request validation", () => {
  it("400 when Anthropic is not configured, without calling the model", async () => {
    vi.mocked(anthropic.isAnthropicConfigured).mockReturnValueOnce(false);
    const res = await gen("Build FTP");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ANTHROPIC_API_KEY/);
    expect(anthropic.generateTrainingBlock).not.toHaveBeenCalled();
  });

  it("400 on a non-JSON body", async () => {
    const res = await POST(new Request("http://t/api/generate", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body.");
  });

  it("400 on invalid block params, naming the offending field", async () => {
    const post = (body: unknown) =>
      POST(new Request("http://t/api/generate", { method: "POST", body: JSON.stringify(body) }));
    expect((await (await post({ lengthWeeks: 3, goal: "x", startDate: "2026-06-15" })).json()).error).toMatch(/lengthWeeks/);
    expect((await (await post({ lengthWeeks: 2, goal: "  ", startDate: "2026-06-15" })).json()).error).toMatch(/goal/);
    expect((await (await post({ lengthWeeks: 2, goal: "x", startDate: "15-06-2026" })).json()).error).toMatch(/startDate/);
  });
});
```

- [ ] **Step 4: Run the file — existing 2 + new 3 pass**

Run: `npm test -- app/api/generate/route.test.ts`
Expected: `5 passed` — the two pre-existing Track B tests MUST still pass; if they broke, your Step 1 edit changed more than the one line.

- [ ] **Step 5: Commit**

```bash
git add app/api/generate/route.test.ts
git commit -m "test(generate): configurable anthropic mock + 400-path request validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Generate route — tool-payload outcomes, warnings, provenance, best-effort season

**Files:**
- Modify: `app/api/generate/route.test.ts` (append at the end)

**Interfaces:**
- Consumes (from Task 8 + the original file): `anthropic` mocked namespace, `store` mocked namespace, `gen(goal)` helper, `h.toolInput` (a 2-day, 1-week payload → a 2-week request always yields the "Expected 14 days, got 2." warning). Add `GENERATION_MODEL, PROMPT_VERSION` to the existing `@/lib/anthropic-api`-typed imports — they pass through the spread-actual mock unchanged: `import { GENERATION_MODEL, PROMPT_VERSION } from "@/lib/anthropic-api";` (place it with the other imports below the mocks).
- Route facts under test: a null `toolInput` → 502 "The model did not return a structured plan. Please retry."; a schema-invalid one → 502 "…failed structured validation…"; `truncated: true` → warning UNSHIFTED to index 0; audit `raw` = `JSON.stringify(toolInput, null, 2)`; the season replan is wrapped in its own try/catch so a `writeSeasonPlan` failure must not block generation.
- Produces: nothing consumed later.

- [ ] **Step 1: Add the constants import**

Below `import * as anthropic from "@/lib/anthropic-api";` add:

```ts
import { GENERATION_MODEL, PROMPT_VERSION } from "@/lib/anthropic-api";
```

- [ ] **Step 2: Append the outcome tests at the end of the file**

```ts
describe("POST /api/generate — generation outcomes", () => {
  it("502 when the model returns no structured payload", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: null, raw: "prose", truncated: false } as never);
    const res = await gen("Build FTP");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/did not return a structured plan/);
  });

  it("502 when the payload fails schema validation", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: { bogus: true }, raw: "", truncated: false } as never);
    const res = await gen("Build FTP");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/failed structured validation/);
  });

  it("maps a thrown generation failure to 502 with its message", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockRejectedValueOnce(new Error("Anthropic 500"));
    const res = await gen("Build FTP");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Anthropic 500");
  });

  it("surfaces truncation as the FIRST warning and flags the day-count shortfall", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: h.toolInput, raw: "", truncated: true } as never);
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.warnings[0]).toMatch(/token limit/);
    expect(json.plan.warnings).toContain("Expected 14 days, got 2.");
  });

  it("stamps provenance + the audit trail on the plan", async () => {
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.model).toBe(GENERATION_MODEL);
    expect(json.plan.promptVersion).toBe(PROMPT_VERSION);
    expect(json.plan.raw).toBe(JSON.stringify(h.toolInput, null, 2));
    expect(json.plan.blockParams).toMatchObject({ lengthWeeks: 2, goal: "Build FTP", startDate: "2026-06-15" });
  });

  it("a season-replan persistence failure never blocks generation (best-effort)", async () => {
    vi.mocked(store.writeSeasonPlan).mockRejectedValueOnce(new Error("disk full"));
    const res = await gen("Build FTP");
    expect(res.status).toBe(200);
    expect((await res.json()).plan).toBeDefined();
  });
});
```

- [ ] **Step 3: Run the file — 11 tests pass**

Run: `npm test -- app/api/generate/route.test.ts`
Expected: `11 passed`.

- [ ] **Step 4: Commit**

```bash
git add app/api/generate/route.test.ts
git commit -m "test(generate): tool-payload failure paths, truncation/day-count warnings, provenance, season best-effort

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Full verification + close SUB-3 in the docs

**Files:**
- Modify: `ROADMAP.md` (remove the SUB-3 subsection; annotate the audit findings)
- Modify: `ARCHIVE.md` (add the shipped entry)

- [ ] **Step 1: Run the full check**

Run: `npm run check`
Expected: `tsc --noEmit` clean, eslint clean, all Vitest suites pass. If a failure appears in a file you did NOT touch, follow the concurrent-agent rule from Global Constraints (git status → wait → retry once → report), do not fix it.

- [ ] **Step 2: Update ROADMAP.md**

Three edits (follow the exact precedent SUB-1/SUB-2 set in the same file):
1. Delete the whole `### SUB-3 · Route tests (`sync` + `generate`)` subsection (heading + its paragraph).
2. In the "Data substrate" intro paragraph, change the sentence that says SUB-3/SUB-4 remain open so only **SUB-4** remains open, and note SUB-3 shipped 2026-07-02 → ARCHIVE.md.
3. In the audit's Strict findings, append to the "⚠️ **Test coverage lopsided**" bullet: ` **Resolved 2026-07-02** — see "Route tests (sync + generate)" in [ARCHIVE.md](ARCHIVE.md).` And in the numbered Priorities list, mark priority 2 ("Test the `sync` + `generate` routes") as ✅ done, 2026-07-02 (SUB-3), matching how priority 1 is annotated.

- [ ] **Step 3: Update ARCHIVE.md**

Read the top of `ARCHIVE.md` first and copy the exact format of the most recent entry (the "Durable planned corpus" SUB-1 entry from 2026-07-02). Add a new entry titled **Route tests (`sync` + `generate`) — SUB-3** dated 2026-07-02, recording: `app/api/sync/route.test.ts` created (19 tests: GET cache/filtering, POST guards + 401/502 mapping, per-date ledger immutability, rebuild one-shot gating, physiology reconcile, best-effort warning surfacing, today-analysis path, DELETE lived-days archive) and `app/api/generate/route.test.ts` extended (11 tests: request validation, structured-payload failure paths, truncation/day-count warnings, provenance stamping, season best-effort). I/O mocked at module boundary, pure pipeline real.

- [ ] **Step 4: Commit + push**

```bash
git add ROADMAP.md ARCHIVE.md
git commit -m "docs(roadmap): move shipped SUB-3 route tests to ARCHIVE

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

(Also push the earlier test commits if not yet pushed — `git push` covers them all.)

---

## Self-Review Notes (already applied)

- **Spec coverage:** SUB-3 names three risk areas — reconciliation (Tasks 3–5), scoring orchestration (Tasks 3, 4, 6), tool-use parsing (Task 9). All covered; DELETE (Task 7) additionally locks the SUB-1 archive semantics the route gained recently.
- **Type consistency:** all fixture shapes were verified against `lib/types.ts` at plan-writing time (`ActivitySummary` 25 fields, `RideScoreEntry`, `CurrentBlockDay.eventId?`, `DispositionEntry.reason: CompromiseReason | null` with `"equipment" | "sickness" | "weather" | "other"`, `WorkoutType` includes `Z2/Threshold/VO2max`). `mergeScoreLogRebuild` was read directly: fresh wins including `ftpUsed`; only `formState` carries forward — the 250/200 discriminator is sound.
- **Known soft spot:** Task 6's `toHaveBeenCalledTimes(2)` depends on `buildTodayAnalysis` producing a non-null score for the fixture ride (NP 190 @ FTP 200, planned Threshold day). The step includes the diagnosis path if that assumption fails.
