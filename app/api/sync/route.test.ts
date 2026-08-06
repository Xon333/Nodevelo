import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BLOCK_SETTINGS } from "@/lib/types";
import type { ActivitySummary, BlockHistoryEntry, CurrentBlock, CurrentBlockDay, IntervalsCalendarEvent, RideScoreEntry, SyncData } from "@/lib/types";

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
    fetchEvents: vi.fn(async () => []),
    createEvent: vi.fn(async () => null),
  };
});
vi.mock("@/lib/anthropic-api", async (orig) => {
  const actual = await orig<typeof import("@/lib/anthropic-api")>();
  return { ...actual, isAnthropicConfigured: vi.fn(() => false) };
});
vi.mock("@/lib/physiology", async (orig) => {
  const actual = await orig<typeof import("@/lib/physiology")>();
  const readPhysiology = vi.fn(async () => null);
  return {
    ...actual, // physiologyAsOf + reconcile (pure) stay real
    readPhysiology,
    // HR-52: mirrors the real updatePhysiology's contract — mutate is invoked with whatever the
    // lock-held read currently resolves to. Delegates to the SAME readPhysiology mock reference above,
    // so a test's `readPhysiology.mockResolvedValue(...)` override also flows into this.
    updatePhysiology: vi.fn(async (mutate: (cur: unknown) => unknown) => mutate(await readPhysiology())),
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
  readLoadingLog: vi.fn(),
  readMorningChecks: vi.fn(),
  readRollingBaselines: vi.fn(),
  readScoreLog: vi.fn(),
  readTodayAnalysis: vi.fn(),
  updateScoreLog: vi.fn(),
  updateCurrentBlock: vi.fn(async (mutate: (cur: null) => unknown) => mutate(null)),
  updateBlockHistory: vi.fn(),
  updateInterventionLog: vi.fn(async (mutate: (log: { records: unknown[]; updatedAt: string }) => unknown) =>
    mutate({ records: [], updatedAt: "" })
  ),
  updateCalibration: vi.fn(),
  updateAthleteProfile: vi.fn(),
  mergeCurrentBlockDays: vi.fn(),
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
import { DELETE, GET, POST, resolveCarbsOptimumForPrompt } from "@/app/api/sync/route";
import { buildRideScores } from "@/lib/score-log";
import type { CalibratedParameter, CalibrationStore } from "@/lib/types";

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
  activeBurnKcal: null,
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
  hrrc: null,
  wPrimeRollingJ: null,
  wBalDepletionJ: null,
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

const mkHistoryEntry = (over: Partial<BlockHistoryEntry> = {}): BlockHistoryEntry => ({
  id: "h1",
  goal: "Build FTP",
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  lengthWeeks: 4,
  overview: "prior block",
  createdAt: "2026-06-01T00:00:00.000Z",
  ...over,
});

const mkCalParam = (over: Partial<CalibratedParameter> = {}): CalibratedParameter => ({
  value: 60,
  source: "derived",
  confidence: "medium",
  dataPoints: 12,
  lastUpdated: "2026-06-20T00:00:00.000Z",
  locked: false,
  manualOverride: null,
  ...over,
});

// In-memory score-log the transactional mutators run against (disposition-route pattern), so the
// merge/patch effects are observable after the handler returns.
let scoreEntries: RideScoreEntry[];
// Same pattern for calibration (HR-51: updateCalibration now reads inside its own lock).
let calibration: CalibrationStore;

beforeEach(() => {
  vi.clearAllMocks();
  scoreEntries = [];
  calibration = {
    decouplingGood: { value: 5, source: "default", confidence: "low", dataPoints: 0, lastUpdated: "", locked: false, manualOverride: null },
    updatedAt: "",
  };
  vi.mocked(api.isIntervalsConfigured).mockReturnValue(true);
  vi.mocked(api.runFullSync).mockResolvedValue(mkSync());
  vi.mocked(api.fetchSportSettings).mockResolvedValue(null);
  vi.mocked(api.fetchIntervals).mockResolvedValue([]);
  vi.mocked(api.fetchPowerStream).mockResolvedValue([]);
  vi.mocked(api.fetchHrStream).mockResolvedValue([]);
  vi.mocked(api.deleteEvents).mockResolvedValue({ deleted: [], failed: [] });
  vi.mocked(api.fetchEvents).mockResolvedValue([]);
  vi.mocked(api.createEvent).mockResolvedValue(null);
  vi.mocked(anthropic.isAnthropicConfigured).mockReturnValue(false);
  vi.mocked(phys.readPhysiology).mockResolvedValue(null);
  vi.mocked(phys.readPowerZones).mockResolvedValue([]);
  vi.mocked(phys.readHrZones).mockResolvedValue([]);

  vi.mocked(store.readAthleteProfile).mockResolvedValue(profile as never);
  vi.mocked(store.readBlockHistory).mockResolvedValue([]);
  vi.mocked(store.readBlockSettings).mockResolvedValue(DEFAULT_BLOCK_SETTINGS);
  vi.mocked(store.readCurrentBlock).mockResolvedValue(null);
  vi.mocked(store.readDispositions).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.readCalibration).mockImplementation(async () => calibration);
  // HR-51: updateCalibration reads inside its own lock now — mirror that by reassigning the shared
  // in-memory `calibration` so post-request assertions can inspect what was actually persisted.
  vi.mocked(store.updateCalibration).mockImplementation(async (mutate) => {
    calibration = await mutate(calibration);
    return calibration;
  });
  vi.mocked(store.readInterventionLog).mockResolvedValue({ records: [], updatedAt: "" });
  vi.mocked(store.readLastSync).mockResolvedValue(null);
  vi.mocked(store.readLedgerRebuild).mockResolvedValue({ rebuiltAt: null });
  vi.mocked(store.readLoadingLog).mockResolvedValue({ entries: [] });
  vi.mocked(store.readMorningChecks).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.readRollingBaselines).mockResolvedValue({
    avgCtl90d: null,
    avgDecoupling90d: null,
    avgTss90d: null,
    avgWeeklyHours90d: null,
    ridesPerWeek90d: null,
    updatedAt: "",
  });
  vi.mocked(store.readScoreLog).mockImplementation(async () => ({ entries: scoreEntries, updatedAt: "" }));
  vi.mocked(store.readTodayAnalysis).mockResolvedValue(null);
  vi.mocked(store.updateScoreLog).mockImplementation(async (mutate) => {
    scoreEntries = await mutate(scoreEntries);
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

  // The default `profile` fixture omits performance.dateOfBirth/heightCm/sex, so
  // resolveNutritionModel resolves it to kind: "legacy" — no RMR to isolate the NEAT term from.
  it("returns null planEaKcalPerKg/planEaLevel for a legacy (pre-migration) profile", async () => {
    const json = await (await GET(new Request(`http://t/api/sync?today=${TODAY}`))).json();
    expect(json.planEaKcalPerKg).toBeNull();
    expect(json.planEaLevel).toBeNull();
  });

  it("returns both day-type nutrition models for historical streak calculations", async () => {
    const calibration = (multiplier: number) => ({
      multiplier, confidence: "high", source: "derived", windowDays: 42, loggedDays: 35,
      weighIns: 20, solvedAt: "2026-06-21", imbalance: null, stale: false,
    });
    const pooled = calibration(1.3);
    vi.mocked(store.readAthleteProfile).mockResolvedValueOnce({
      ...profile,
      performance: {
        ...profile.performance, dateOfBirth: "1995-01-01", heightCm: 180, sex: "male",
      },
      nutrition: {
        ...profile.nutrition,
        targetRateKgPerWeek: 0.1,
        neat: pooled,
        dayTypeNeat: {
          rest: calibration(1.45), train: calibration(1.2), pooled,
          shrinkageWeight: { rest: 0.5, train: 0.8 },
        },
      },
    } as never);
    const json = await (await GET(new Request(`http://t/api/sync?today=${TODAY}`))).json();
    expect(json.nutritionModelsByDayType.rest.neatMultiplier).toBe(1.45);
    expect(json.nutritionModelsByDayType.train.neatMultiplier).toBe(1.2);
  });

  // Review task 2.1: neatImbalance used to read ONLY the pooled `neat.imbalance`. A rest/train split
  // clamp (dayTypeNeat.rest/train.imbalance) could — and, on this athlete's real data, does — fire
  // while the pooled solve stays clean, leaving the one live out-of-band finding unreachable. No
  // activities today (readLastSync resolves null → lastSync?.activities is []) means isRestDayFor
  // reads today as a rest day, so the REST split's imbalance is the one expected here.
  it("surfaces the REST split's imbalance (tagged) on a rest day, not the pooled figure, once dayTypeNeat exists", async () => {
    const calibration = (over: Record<string, unknown> = {}) => ({
      multiplier: 1.3, confidence: "high", source: "derived", windowDays: 42, loggedDays: 35,
      weighIns: 20, solvedAt: "2026-06-21", imbalance: null, stale: false,
      ...over,
    });
    const restImbalance = {
      direction: "intake-above-model", estimatedKcalPerDay: 60,
      candidates: ["food-log under-reporting", "RMR-equation error"], note: "clamped rest-day solve",
    };
    vi.mocked(store.readAthleteProfile).mockResolvedValueOnce({
      ...profile,
      performance: { ...profile.performance, dateOfBirth: "1995-01-01", heightCm: 180, sex: "male" },
      nutrition: {
        ...profile.nutrition,
        targetRateKgPerWeek: 0.1,
        neat: calibration(), // pooled — clean, no imbalance
        dayTypeNeat: {
          rest: calibration({ multiplier: 1.37, imbalance: restImbalance }),
          train: calibration({ multiplier: 1.2 }),
          pooled: calibration(),
          shrinkageWeight: { rest: 0.5, train: 0.8 },
        },
      },
    } as never);
    const json = await (await GET(new Request(`http://t/api/sync?today=${TODAY}`))).json();
    expect(json.neatImbalance).toEqual({ dayType: "rest", finding: restImbalance });
  });

  // Strict-superset guard: an athlete who hasn't adopted a day-type split yet must see EXACTLY the
  // pre-fix behaviour (the pooled figure, untagged) — no regression for the common case.
  it("falls back to the pooled neatImbalance, untagged, when dayTypeNeat is null", async () => {
    const pooledImbalance = {
      direction: "intake-below-model", estimatedKcalPerDay: 40,
      candidates: ["food-log under-reporting", "RMR-equation error"], note: "pooled clamp",
    };
    vi.mocked(store.readAthleteProfile).mockResolvedValueOnce({
      ...profile,
      nutrition: {
        ...profile.nutrition,
        neat: {
          multiplier: 1.3, confidence: "high", source: "derived", windowDays: 42, loggedDays: 35,
          weighIns: 20, solvedAt: "2026-06-21", imbalance: pooledImbalance, stale: false,
        },
        dayTypeNeat: null,
      },
    } as never);
    const json = await (await GET(new Request(`http://t/api/sync?today=${TODAY}`))).json();
    expect(json.neatImbalance).toEqual({ dayType: null, finding: pooledImbalance });
  });

  it("returns early weight-trend evidence for the supplied local date", async () => {
    const warningProfile = {
      ...profile,
      performance: { ...profile.performance, dateOfBirth: "1996-01-01", heightCm: 180, sex: "male" as const },
      nutrition: {
        ...profile.nutrition,
        targetWeightKg: 80,
        targetRateKgPerWeek: 0.15,
        neat: {
          multiplier: 1.2,
          confidence: "high" as const,
          source: "derived" as const,
          windowDays: 42,
          loggedDays: 35,
          weighIns: 20,
          solvedAt: "2026-06-21",
          imbalance: null,
          stale: false,
        },
        dayTypeNeat: null,
      },
    };
    const wellness = Array.from({ length: 21 }, (_, index) => {
      const date = new Date(Date.parse("2026-06-01") + index * 86_400_000).toISOString().slice(0, 10);
      return { date, weightKg: 75 + (0.3 * index) / 7, hrv: null, sleepHours: null, sleepQuality: null, kcalConsumed: 2240, ctl: null, atl: null };
    });
    vi.mocked(store.readAthleteProfile).mockResolvedValue(warningProfile as never);
    vi.mocked(store.readLastSync).mockResolvedValue(mkSync({ wellness }));

    const body = await (await GET(new Request(`http://t/api/sync?today=${TODAY}`))).json();
    expect(body.nutritionTrendWarning).toMatchObject({
      adherenceRatio: expect.any(Number),
      loggedDays: 21,
    });

    const insufficient = await (await GET(new Request("http://t/api/sync?today=2026-06-12"))).json();
    expect(insufficient.nutritionTrendWarning).toBeNull();
  });

  it("includes the prescribed-EA proxy in the GET response", async () => {
    const warningProfile = {
      ...profile,
      performance: { ...profile.performance, dateOfBirth: "1996-01-01", heightCm: 180, sex: "male" as const },
      nutrition: {
        ...profile.nutrition,
        targetWeightKg: 80,
        targetRateKgPerWeek: 0.15,
        neat: {
          multiplier: 1.2,
          confidence: "high" as const,
          source: "derived" as const,
          windowDays: 42,
          loggedDays: 35,
          weighIns: 20,
          solvedAt: "2026-06-21",
          imbalance: null,
          stale: false,
        },
        dayTypeNeat: null,
      },
    };
    const wellness = Array.from({ length: 21 }, (_, index) => {
      const date = new Date(Date.parse("2026-06-01") + index * 86_400_000).toISOString().slice(0, 10);
      return { date, weightKg: 75 + (0.3 * index) / 7, hrv: null, sleepHours: null, sleepQuality: null, kcalConsumed: 2240, ctl: null, atl: null };
    });
    vi.mocked(store.readAthleteProfile).mockResolvedValue(warningProfile as never);
    vi.mocked(store.readLastSync).mockResolvedValue(mkSync({ wellness }));

    const res = await GET(new Request(`http://t/api/sync?today=${TODAY}`));
    const json = await res.json();
    expect(json).toHaveProperty("planEaKcalPerKg");
    expect(json).toHaveProperty("planEaLevel");
    if (json.planEaKcalPerKg !== null) {
      expect(typeof json.planEaKcalPerKg).toBe("number");
      expect(["low", "adequate", "ample"]).toContain(json.planEaLevel);
    }
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

describe("POST /api/sync — guards + error mapping", () => {
  it("400 when Intervals.icu is not configured", async () => {
    vi.mocked(api.isIntervalsConfigured).mockReturnValue(false);
    const res = await postSync();
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/connect intervals\.icu/i);
    expect(error).not.toMatch(/INTERVALS_API_KEY|INTERVALS_ATHLETE_ID|\.env/i); // athlete-facing copy must never name env vars
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

describe("POST /api/sync — ledger wiring", () => {
  it("persists the fresh sync + derived stores on a normal sync", async () => {
    const fresh = mkSync({ activities: [mkActivity({ id: "a21", date: "2026-06-21" })] });
    vi.mocked(api.runFullSync).mockResolvedValue(fresh);
    const res = await postSync();
    expect(res.status).toBe(200);
    expect(store.writeLastSync).toHaveBeenCalledWith(fresh);
    expect(store.writeRollingBaselines).toHaveBeenCalledOnce();
    expect(store.updateCalibration).toHaveBeenCalledOnce();
    expect(store.writeQuirks).toHaveBeenCalledOnce();
    const json = await res.json();
    expect(json.warnings).toEqual([]);
    expect(json.athleteState).not.toBeNull();
    expect(json.coachSnapshot).not.toBeNull();
  });

  it("writes a carbsOptimum calibration parameter on sync (Track C wiring)", async () => {
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: [mkActivity({ id: "a21", date: "2026-06-21" })] }));
    await postSync();
    expect(calibration.carbsOptimum).toBeDefined();
    expect(calibration.carbsOptimum!.source).toBe("default"); // fixture rides carry no carbs_ingested
  });

  it("HR-51: re-derives calibration from whatever updateCalibration's lock actually hands it, not a stale earlier readCalibration() snapshot — a manual override landing in that window survives", async () => {
    // Simulates the real race: readCalibration() (still used elsewhere, e.g. GET) captured a snapshot
    // with no override; a manual-override POST (app/api/calibration/route.ts) then lands, updating the
    // REAL on-disk calibration — reflected here in the shared `calibration` var, which updateCalibration's
    // own lock-held read now sees. The old code used the stale `readCalibration()` snapshot for its
    // re-derive input instead, silently discarding the override the instant its write landed.
    vi.mocked(store.readCalibration).mockResolvedValueOnce({
      decouplingGood: { value: 5, source: "default", confidence: "low", dataPoints: 0, lastUpdated: "", locked: false, manualOverride: null },
      updatedAt: "",
    });
    calibration = {
      ...calibration,
      decouplingGood: { ...calibration.decouplingGood, manualOverride: 3.5 },
    };
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: [mkActivity({ id: "a21", date: "2026-06-21", decoupling: 4 })] }));
    await postSync();
    expect(calibration.decouplingGood.manualOverride).toBe(3.5);
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

  it("HR-40: reads dispositions from INSIDE updateScoreLog's own call, not before it — closes the window where a stale outer read could un-set a disposition landing mid-sync", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({ days: [{ date: "2026-06-21", name: "Endurance", type: "Z2", durationMin: 90, workoutText: "- 90m 65%" }] })
    );
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: [mkActivity({ id: "a21", date: "2026-06-21" })] }));
    await postSync();
    // Proves the structural fix: previously, dispositions were read once BEFORE updateScoreLog was
    // even called, so a disposition POST landing after that read (but before this write acquired the
    // lock) was silently un-set by the stale snapshot applyDispositions was handed. The EARLIEST
    // readDispositions call must now come AFTER updateScoreLog's own call is registered — i.e. from
    // within its mutate, the locked critical section — not carried in from an earlier, un-locked read.
    // (A later, separate readDispositions call still exists — for the response body — in both the old
    // and new code, so only the FIRST call's ordering actually distinguishes the two.)
    const ledgerUpdateCallOrder = vi.mocked(store.updateScoreLog).mock.invocationCallOrder[0];
    const firstDispositionReadOrder = vi.mocked(store.readDispositions).mock.invocationCallOrder[0];
    expect(firstDispositionReadOrder).toBeGreaterThan(ledgerUpdateCallOrder);
  });

  it("backfills the fresh execution outcome onto the matching current-block day (§8 block-history enrichment)", async () => {
    scoreEntries = [mkScoreEntry({ date: "2026-07-01", executionScore: 9, compliancePct: 100 })];
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({ days: [{ date: "2026-07-01", name: "Threshold", type: "Threshold", durationMin: 60 }] })
    );
    await postSync();
    expect(store.mergeCurrentBlockDays).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ date: "2026-07-01", execution: { score: 9, compliancePct: 100 } })])
    );
  });

  it("does not call the block-day patch when no day's execution stamp actually changed (§8 block-history enrichment)", async () => {
    scoreEntries = [mkScoreEntry({ date: "2026-07-01", executionScore: 9, compliancePct: 100 })];
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({
        days: [
          {
            date: "2026-07-01",
            name: "Threshold",
            type: "Threshold",
            durationMin: 60,
            execution: { score: 9, compliancePct: 100 },
          },
        ],
      })
    );
    await postSync();
    expect(store.mergeCurrentBlockDays).not.toHaveBeenCalled();
  });

  it("backfills the fresh execution outcome onto a matching block-history day (§8 block-history enrichment)", async () => {
    scoreEntries = [mkScoreEntry({ date: "2026-07-01", executionScore: 9, compliancePct: 100 })];
    const historyEntry = mkHistoryEntry({
      days: [{ date: "2026-07-01", name: "Threshold", type: "Threshold", durationMin: 60 }],
    });
    vi.mocked(store.readBlockHistory).mockResolvedValue([historyEntry]);
    await postSync();
    expect(store.updateBlockHistory).toHaveBeenCalledOnce();
    const mutate = vi.mocked(store.updateBlockHistory).mock.calls[0][0];
    const patched = mutate([historyEntry]);
    expect(patched[0].days).toEqual([
      expect.objectContaining({ date: "2026-07-01", execution: { score: 9, compliancePct: 100 } }),
    ]);
  });

  it("does not call the block-history patch when no history day's execution stamp actually changed (§8 block-history enrichment)", async () => {
    scoreEntries = [mkScoreEntry({ date: "2026-07-01", executionScore: 9, compliancePct: 100 })];
    vi.mocked(store.readBlockHistory).mockResolvedValue([
      mkHistoryEntry({
        days: [
          {
            date: "2026-07-01",
            name: "Threshold",
            type: "Threshold",
            durationMin: 60,
            execution: { score: 9, compliancePct: 100 },
          },
        ],
      }),
    ]);
    await postSync();
    expect(store.updateBlockHistory).not.toHaveBeenCalled();
  });
});

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

  it("HR-53: a marker file missing rebuiltAt entirely (hand-edited/partial import, parses back as undefined) does not falsely read as already-rebuilt", async () => {
    seedRebuildScenario();
    // Real on-disk shape for a `{}` file or one predating this field — `rebuiltAt` is `undefined`,
    // not `null`. A strict `!== null` check wrongly treats that as "already rebuilt".
    vi.mocked(store.readLedgerRebuild).mockResolvedValue({} as { rebuiltAt: string | null });
    const json = await (await postSync({ today: TODAY, rebuildLedger: true })).json();
    expect(scoreEntries.find((e) => e.date === "2026-06-20")?.ftpUsed).toBe(200); // rebuild actually ran
    expect(store.writeLedgerRebuild).toHaveBeenCalledOnce();
    expect(json.warnings.some((w: string) => /already rebuilt/.test(w))).toBe(false);
  });
});

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
    // HR-52: updatePhysiology's mutate is invoked with whatever the lock-held read hands it (here,
    // readPhysiology's mocked null) — mirrors the real reconcile-inside-the-lock call.
    const mutate = vi.mocked(phys.updatePhysiology).mock.calls.at(-1)![0];
    expect(await mutate(null)).toEqual({ current: snapshot, history: [] });
  });

  it("surfaces a quirk-extraction failure as a warning without failing the sync", async () => {
    vi.mocked(store.writeQuirks).mockRejectedValueOnce(new Error("disk full"));
    const res = await postSync();
    expect(res.status).toBe(200);
    expect((await res.json()).warnings.some((w: string) => /Quirk extraction failed: disk full/.test(w))).toBe(true);
  });

  it("surfaces an intervention-validation failure as a warning without failing the sync", async () => {
    // readScoreLog is now also called twice earlier: once at birth-adherence candidate-gating time
    // (SUB-3 birth-time fetch), once more by Task 3's execution-outcome backfill (right after the
    // ledger update) — queue both of those to resolve normally so only the THIRD call (the one this
    // test actually exercises, feeding buildAthleteModel for intervention validation) rejects.
    vi.mocked(store.readScoreLog).mockResolvedValueOnce({ entries: scoreEntries, updatedAt: "" });
    vi.mocked(store.readScoreLog).mockResolvedValueOnce({ entries: scoreEntries, updatedAt: "" });
    vi.mocked(store.readScoreLog).mockRejectedValueOnce(new Error("corrupt log"));
    const res = await postSync();
    expect(res.status).toBe(200);
    expect((await res.json()).warnings.some((w: string) => /Intervention validation failed: corrupt log/.test(w))).toBe(true);
  });

  it("surfaces an execution-outcome backfill failure as a warning without failing the sync", async () => {
    scoreEntries = [mkScoreEntry({ date: "2026-07-01", executionScore: 9, compliancePct: 100 })];
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({ days: [{ date: "2026-07-01", name: "Threshold", type: "Threshold", durationMin: 60 }] })
    );
    vi.mocked(store.mergeCurrentBlockDays).mockRejectedValueOnce(new Error("disk full"));
    const res = await postSync();
    expect(res.status).toBe(200);
    expect((await res.json()).warnings.some((w: string) => /Execution-outcome backfill failed: disk full/.test(w))).toBe(true);
  });
});

describe("POST /api/sync — inbound calendar reconcile (§7)", () => {
  // A future planned day (tomorrow) the athlete moved onto TODAY's rest slot on the Intervals.icu
  // calendar. Both source and destination must be today-or-future for reconcileInboundMoves to touch
  // them (its own future-only gating) — landing the move ON today (rather than further out) also lets
  // buildRideScores' own `act.date > today` gate see the moved-in ride and score it, proving (c).
  // Drives the REAL reconcileInboundMoves logic (not mocked) through a mocked fetchEvents — genuine
  // coverage of the wiring, per lib/calendar-mirror.ts.
  const TOMORROW = "2026-06-23";
  const movedDay = {
    date: TOMORROW,
    name: "Threshold 3x12",
    type: "Threshold" as const,
    durationMin: 75,
    eventId: 41,
    workoutText: "Main Set 3x\n- 12m 95%",
  };
  const restDay = { date: TODAY, name: "Rest", type: "Rest" as const, durationMin: 0 };
  const mkEvent = (over: Partial<IntervalsCalendarEvent> & { date: string }): IntervalsCalendarEvent => ({
    id: null,
    uid: null,
    externalId: null,
    name: "Ride",
    description: "",
    category: "WORKOUT",
    type: "Ride",
    ...over,
  });

  it("relocates a day the athlete moved on the calendar, persists it, warns, and scores against the new date", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(mkBlock({ days: [movedDay, restDay] }));
    vi.mocked(api.fetchEvents).mockResolvedValue([mkEvent({ date: TODAY, id: 41 })]); // event 41 now sits on TODAY
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: [mkActivity({ id: "a-today" })] })); // rides TODAY
    const res = await postSync();
    expect(res.status).toBe(200);
    const json = await res.json();

    // (a) block persisted with the day relocated. Index 0, not the last call: with Task 3's
    // execution-outcome backfill now running right after this section, a matching score-log entry
    // for TODAY can trigger its own (later) mergeCurrentBlockDays call — the move-persistence call
    // this assertion cares about is always the FIRST one the calendar-reconcile section makes.
    const written = vi.mocked(store.mergeCurrentBlockDays).mock.calls[0][0] as CurrentBlockDay[];
    expect(written.find((d) => d.date === TODAY)).toMatchObject({
      name: "Threshold 3x12",
      type: "Threshold",
      durationMin: 75,
      eventId: 41,
    });
    expect(written.find((d) => d.date === TOMORROW)?.type).toBe("Rest");

    // (b) response warnings include a "Calendar move applied" line
    expect(json.warnings.some((w: string) => new RegExp(`Calendar move applied: ${TOMORROW} → ${TODAY}`).test(w))).toBe(true);

    // (c) scoring runs against the NEW date, not the vacated old one
    const entry = scoreEntries.find((e) => e.date === TODAY);
    expect(entry).toBeDefined();
    expect(entry?.planned).toBe(true);
    expect(scoreEntries.find((e) => e.date === TOMORROW)).toBeUndefined();
  });

  it("survives a fetchEvents rejection: sync still succeeds with a calendar-check-skipped warning", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(mkBlock({ days: [movedDay, restDay] }));
    vi.mocked(api.fetchEvents).mockRejectedValueOnce(new Error("upstream 500"));
    const res = await postSync();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warnings.some((w: string) => /calendar check skipped/i.test(w))).toBe(true);
    expect(store.mergeCurrentBlockDays).not.toHaveBeenCalled();
  });

  it("does not touch the block when the calendar agrees with the plan (no moves, no warnings)", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(mkBlock({ days: [movedDay, restDay] }));
    vi.mocked(api.fetchEvents).mockResolvedValue([mkEvent({ date: TOMORROW, id: 41 })]); // unmoved
    const res = await postSync();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(store.mergeCurrentBlockDays).not.toHaveBeenCalled();
    expect(json.warnings.some((w: string) => /Calendar move applied/.test(w))).toBe(false);
  });

  // Fix B (final review): reconcileInboundMoves relocates the block day locally but never re-keys the
  // calendar event's own external_id (documented limit on that function) — it's still stamped
  // `nodevelo-<TOMORROW>` (stale) even though the event now sits on TODAY. Left alone, a SUBSEQUENT
  // outbound move touching TODAY would miss it (id-keyed lookup finds nothing new) and createEvent would
  // spawn a duplicate. The route re-stamps it best-effort via create+delete right after applying the move.
  it("re-stamps the relocated event's external_id via create+delete after an inbound move applies", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(mkBlock({ days: [movedDay, restDay] }));
    const staleEvent = mkEvent({ date: TODAY, id: 41, description: "original threshold description" });
    vi.mocked(api.fetchEvents).mockResolvedValue([staleEvent]);
    vi.mocked(api.createEvent).mockResolvedValue(777);
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: [mkActivity({ id: "a-today" })] }));

    const res = await postSync();
    expect(res.status).toBe(200);

    // A fresh event is created at TODAY, carrying the OLD (stale-id'd) event's description, keyed by
    // the CURRENT (nodevelo-<TODAY>) external_id.
    expect(api.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: `nodevelo-${TODAY}`, description: "original threshold description" })
    );
    // The old drifted event (numeric id 41, still stamped nodevelo-<TOMORROW>) is deleted.
    expect(api.deleteEvents).toHaveBeenCalledWith([41]);

    // The block day's eventId is re-stamped to the newly-created event's id — the old id is gone.
    // Index 1 (the second mergeCurrentBlockDays call): index 0 is the move-persistence call, and a
    // later Task 3 execution-outcome backfill call (triggered by a matching score-log entry for TODAY)
    // can follow this one, so the re-stamp call is never reliably the LAST one either.
    const written = vi.mocked(store.mergeCurrentBlockDays).mock.calls[1][0] as CurrentBlockDay[];
    expect(written.find((d) => d.date === TODAY)?.eventId).toBe(777);
  });

  it("a re-stamp failure (createEvent rejects) is best-effort — sync still succeeds, local move still stands", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(mkBlock({ days: [movedDay, restDay] }));
    vi.mocked(api.fetchEvents).mockResolvedValue([mkEvent({ date: TODAY, id: 41 })]);
    vi.mocked(api.createEvent).mockRejectedValue(new Error("network down"));
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: [mkActivity({ id: "a-today" })] }));

    const res = await postSync();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.warnings.some((w: string) => /re-stamp failed/i.test(w))).toBe(true);
    expect(api.deleteEvents).not.toHaveBeenCalled(); // create never succeeded → never reached delete

    // The local move (from the reconcile itself) still stands, with the OLD eventId intact.
    const written = vi.mocked(store.mergeCurrentBlockDays).mock.calls[0][0] as CurrentBlockDay[];
    expect(written.find((d) => d.date === TODAY)).toMatchObject({ eventId: 41 });
  });
});

describe("resolveCarbsOptimumForPrompt — calibrated-honesty gate for the fuel prompt", () => {
  it("returns null for a low-confidence/non-derived/no-override calibration (population default, not personalized)", () => {
    expect(resolveCarbsOptimumForPrompt(undefined)).toBeNull();
    expect(resolveCarbsOptimumForPrompt(null)).toBeNull();
    expect(resolveCarbsOptimumForPrompt(mkCalParam({ source: "default", confidence: "low" }))).toBeNull();
    // Derived but still low confidence and not locked — not yet trustworthy enough to gate a claim.
    expect(resolveCarbsOptimumForPrompt(mkCalParam({ source: "derived", confidence: "low", locked: false }))).toBeNull();
  });

  it("returns {value, confidence: high} for a manual override, taking precedence over everything else", () => {
    const withOverride = mkCalParam({ source: "default", confidence: "low", manualOverride: 55 });
    expect(resolveCarbsOptimumForPrompt(withOverride)).toEqual({ value: 55, confidence: "high" });
  });

  it("passes through the real confidence for a trustworthy derived value", () => {
    expect(resolveCarbsOptimumForPrompt(mkCalParam({ source: "derived", confidence: "medium", value: 69 }))).toEqual({
      value: 69,
      confidence: "medium",
    });
    expect(resolveCarbsOptimumForPrompt(mkCalParam({ source: "derived", confidence: "high", value: 72 }))).toEqual({
      value: 72,
      confidence: "high",
    });
    // Locked at low confidence still counts as trustworthy (mirrors resolveCalibratedValue's own gate).
    expect(
      resolveCarbsOptimumForPrompt(mkCalParam({ source: "derived", confidence: "low", locked: true, value: 50 }))
    ).toEqual({ value: 50, confidence: "low" });
  });
});

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

  it("persists the interval-adherence stamp alongside the today-patch's executionScore (SIT-bug fix)", async () => {
    seedTodayRide(); // mkBlock's Threshold day parses to a non-empty 3x12m@95% prescription
    // Genuine executed intervals matching the prescription (same shape as the birth-fetch tests'
    // fixture below for an identical Threshold 3x12 prescription) — fetchIntervals must resolve
    // non-empty here so matchPrescription produces a real, non-fabricated comparison. An empty
    // `executed` is a separate guard (re-review fix): it now short-circuits to a null comparison
    // instead of freezing a fabricated 0%-adherence stamp onto the immutable ledger.
    vi.mocked(api.fetchIntervals).mockResolvedValue([
      { type: "WORK", durationSec: 720, avgWatts: 190, npWatts: 192, avgHr: 155, startIndex: 0, endIndex: 100 },
      { type: "WORK", durationSec: 720, avgWatts: 190, npWatts: 192, avgHr: 155, startIndex: 200, endIndex: 300 },
      { type: "WORK", durationSec: 720, avgWatts: 190, npWatts: 192, avgHr: 155, startIndex: 400, endIndex: 500 },
    ]);
    await postSync();
    // Proves the today-patch freezes a real comparison's stamp rather than silently dropping it (the
    // exact gap that once forced a manual ledger correction) — now backed by genuine executed data,
    // not the empty-array fabrication the bug depended on.
    expect(scoreEntries.find((e) => e.date === TODAY)?.intervals).toEqual({
      adherencePct: 100,
      structuralMismatch: false,
      completed: 3,
      total: 3,
    });
  });

  it("does NOT stamp `intervals` on a Z2 today even when intervalComparison is non-null (Finding 3 guard)", async () => {
    vi.mocked(anthropic.isAnthropicConfigured).mockReturnValue(true);
    // A Z2 day whose workoutText still parses to a non-empty prescription (e.g. authored with a
    // structured interval inside an otherwise-Z2 day) — this is the exact "somehow non-null on a Z2
    // day" scenario the guard must cover, not just the common case of an empty Z2 prescription.
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({
        days: [{ date: TODAY, name: "Endurance w/ opener", type: "Z2", durationMin: 90, workoutText: "Main Set 3x\n- 12m 95%" }],
      })
    );
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: [mkActivity()] }));
    await postSync();
    // The today-patch must match buildRideScores'/the birth-fetch's own Z2/Recovery/durability
    // exclusion — an `intervals` stamp on a Z2 day would be meaningless provenance (scored by an
    // entirely different system), a latent trap for any future broad consumer of `entry.intervals`.
    expect(scoreEntries.find((e) => e.date === TODAY)?.intervals).toBeUndefined();
  });

  it("does NOT stamp `intervals` on a durability-templated today even when intervalComparison is non-null (Finding 3 guard)", async () => {
    vi.mocked(anthropic.isAnthropicConfigured).mockReturnValue(true);
    // durabilityTemplate is an independent optional field, not tied to `type` — deliberately using a
    // type OTHER than "Z2"/"Recovery" here isolates the durabilityTemplate clause specifically. (Prior
    // version used type: "Z2", which let the pre-existing `type !== "Z2"` clause also block the stamp —
    // mutation testing showed that fixture stayed green even with the durabilityTemplate clause deleted,
    // i.e. it didn't actually prove this clause does anything.)
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({
        days: [
          {
            date: TODAY,
            name: "Durability long ride",
            type: "Threshold",
            durationMin: 180,
            durabilityTemplate: "C",
            workoutText: "Main Set 3x\n- 12m 95%",
          },
        ],
      })
    );
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: [mkActivity()] }));
    // Template C's expected effort: 1.05-1.25x FTP (200 → 210-250W), 150-420s, late in the ride —
    // makes intervalComparison genuinely non-null too (Finding 3 guard was previously unexercised: the
    // default empty fetchIntervals mock left intervalComparison null regardless of the guard clause).
    vi.mocked(api.fetchIntervals).mockResolvedValue([
      { type: "WORK", durationSec: 240, avgWatts: 230, npWatts: 230, avgHr: 165, startIndex: 600, endIndex: 700 },
    ]);
    await postSync();
    expect(scoreEntries.find((e) => e.date === TODAY)?.intervals).toBeUndefined();
    // Task 3: the today-patch stamps durabilityDelivery (Track C loading-loop provenance) — gated on
    // durabilityTemplate + a non-null delivery signal, independent of the `intervals` exclusion above.
    expect(scoreEntries.find((e) => e.date === TODAY)?.durabilityDelivery).toEqual({ signal: 2 });
  });

  describe("today-patch `easy` stamp consistency (Task 3)", () => {
    // A trailing baseline of qualifying outdoor Z2 Pw:HR rides before TODAY, so aerobicEffPct resolves
    // to a real (non-null) number rather than trivially being absent from every assertion below.
    const baselineRides = [
      mkActivity({ id: "b1", date: "2026-06-10", type: "Ride", powerHrZ2: 1.5, powerHrZ2Mins: 30 }),
      mkActivity({ id: "b2", date: "2026-06-12", type: "Ride", powerHrZ2: 1.6, powerHrZ2Mins: 30 }),
      mkActivity({ id: "b3", date: "2026-06-14", type: "Ride", powerHrZ2: 1.4, powerHrZ2Mins: 30 }),
    ];
    const hrZones = [
      { name: "Z1", lo: 0, hi: 120 },
      { name: "Z2", lo: 120, hi: 150 },
      { name: "Z3", lo: 150, hi: 165 },
      { name: "Z4", lo: 165, hi: 180 },
      { name: "Z5", lo: 180, hi: null },
    ];
    // Raw Intervals.icu HR-zone times: almost entirely zones 1-2 → reads "dialed" if used as-is.
    const rawHrZoneTimes = [900, 3500, 100, 0, 0];
    // A raw HR stream that re-buckets almost entirely into zone 4 (well above the aerobic ceiling) —
    // deliberately the OPPOSITE read from rawHrZoneTimes above, so an assertion of "hot" can only pass
    // if the patch used the re-bucketed stream, not the raw synced field.
    const hotHrStream = [...Array(3000).fill(170), ...Array(500).fill(100)];
    const rebucketedHrZoneTimes = [500, 0, 0, 3000, 0]; // what hotHrStream re-buckets to under hrZones

    const seedEasyRideToday = (plannedDayOver: Partial<CurrentBlockDay> = {}) => {
      vi.mocked(anthropic.isAnthropicConfigured).mockReturnValue(true);
      const plannedDay: CurrentBlockDay = { date: TODAY, name: "Recovery spin", type: "Z2", durationMin: 60, ...plannedDayOver };
      vi.mocked(store.readCurrentBlock).mockResolvedValue(mkBlock({ days: [plannedDay] }));
      const todayActivity = mkActivity({
        type: "Ride",
        avgHr: 140,
        powerHrZ2: 1.8,
        powerHrZ2Mins: 40,
        hrZoneTimes: rawHrZoneTimes,
      });
      vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: [...baselineRides, todayActivity] }));
      vi.mocked(phys.readHrZones).mockResolvedValue(hrZones);
      vi.mocked(api.fetchHrStream).mockResolvedValue(hotHrStream);
      return { plannedDay, todayActivity };
    };

    it("stamps `easy` on today's patch from the re-bucketed HR-zone times, not the raw synced ones", async () => {
      seedEasyRideToday();
      await postSync();
      const entry = scoreEntries.find((e) => e.date === TODAY);
      expect(entry?.easy).toBeDefined();
      expect(entry?.easy?.indoor).toBe(false);
      expect(entry?.easy?.hrRead).toBe("hot"); // re-bucketed read; raw hrZoneTimes alone would read "dialed"
      expect(entry?.easy?.aerobicEffPct).toBe(20); // (1.8 - 1.5) / 1.5 * 100, rounded
    });

    it("today's `easy` stamp matches what a full ledger rebuild (buildRideScores) would produce for the same re-bucketed data", async () => {
      const { plannedDay, todayActivity } = seedEasyRideToday();
      await postSync();
      const patched = scoreEntries.find((e) => e.date === TODAY);
      // A "full rebuild" fed the SAME re-bucketed HR data (what buildRideScores would see if the ledger
      // were rebuilt from correctly-bucketed streams) must land on the exact same `easy` stamp — proving
      // the live today-patch and a from-scratch rebuild can never disagree on this ride's provenance.
      const rebuilt = buildRideScores(
        mkBlock({ days: [plannedDay] }),
        [...baselineRides, { ...todayActivity, hrZoneTimes: rebucketedHrZoneTimes }],
        () => 200,
        TODAY,
        "2026-06-01"
      );
      expect(patched?.easy).toEqual(rebuilt.find((e) => e.date === TODAY)?.easy);
    });

    it("does NOT stamp `easy` on a non-Z2/Recovery planned day (Threshold)", async () => {
      seedEasyRideToday({ type: "Threshold", workoutText: undefined });
      await postSync();
      expect(scoreEntries.find((e) => e.date === TODAY)?.easy).toBeUndefined();
    });

    it("does NOT stamp `easy` on a Z2 day whose durability template embeds efforts (template C)", async () => {
      seedEasyRideToday({ durabilityTemplate: "C" });
      await postSync();
      expect(scoreEntries.find((e) => e.date === TODAY)?.easy).toBeUndefined();
    });
  });

  it("surfaces an analysis failure as a warning while the sync itself succeeds", async () => {
    seedTodayRide();
    vi.mocked(api.fetchPowerStream).mockRejectedValueOnce(new Error("stream 500"));
    const res = await postSync();
    expect(res.status).toBe(200);
    expect((await res.json()).warnings.some((w: string) => /Ride analysis failed: stream 500/.test(w))).toBe(true);
    expect(store.writeTodayAnalysis).not.toHaveBeenCalled();
  });

  it("computes and persists fuelPrompt for a qualifying ride (planned Threshold, unlogged carbs → log-nudge)", async () => {
    seedTodayRide(); // mkBlock's Threshold day qualifies regardless of duration; mkActivity's carbsIngestedG is null
    const res = await postSync();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.todayAnalysis.fuelPrompt).toEqual({ kind: "log-nudge", reason: "interval-day", durationMin: 75 });
    const written = vi.mocked(store.writeTodayAnalysis).mock.calls.at(-1)![0];
    expect(written?.fuelPrompt).toEqual({ kind: "log-nudge", reason: "interval-day", durationMin: 75 });
  });

  it("omits the fuelPrompt key entirely (not null) when the ride doesn't qualify", async () => {
    // Off-plan (no plannedDay) + under the 90-min long-ride threshold — deriveFuelPrompt returns null.
    vi.mocked(anthropic.isAnthropicConfigured).mockReturnValue(true);
    vi.mocked(store.readCurrentBlock).mockResolvedValue(null);
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ activities: [mkActivity({ movingTimeSec: 3000 })] }));
    const res = await postSync();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.todayAnalysis.fuelPrompt).toBeUndefined();
    expect("fuelPrompt" in json.todayAnalysis).toBe(false); // sparse-field convention: key absent, not null
    const written = vi.mocked(store.writeTodayAnalysis).mock.calls.at(-1)![0];
    expect(written).not.toBeNull();
    expect("fuelPrompt" in (written as object)).toBe(false);
  });

  it("surfaces a gap fuelPrompt when logged carbs fall well under a trustworthy derived optimum", async () => {
    seedTodayRide(); // planned Threshold on TODAY
    vi.mocked(api.runFullSync).mockResolvedValue(
      mkSync({ activities: [mkActivity({ carbsIngestedG: 65, movingTimeSec: 4500 })] }) // 65g / 1.25h = 52 g/h
    );
    // HR-51: the prior calibration updateCalibration's lock hands the re-derive — not a separate
    // readCalibration() read, which no longer feeds the sync's own re-derive at all.
    calibration = {
      decouplingGood: { value: 5, source: "default", confidence: "low", dataPoints: 0, lastUpdated: "", locked: false, manualOverride: null },
      carbsOptimum: mkCalParam({ source: "derived", confidence: "medium", value: 90 }), // 52 < 90 - 20
      updatedAt: "",
    };
    const res = await postSync();
    const json = await res.json();
    expect(json.todayAnalysis.fuelPrompt).toEqual({ kind: "gap", loggedGPerH: 52, optimumGPerH: 90, deltaGPerH: -38 });
  });
});

describe("POST /api/sync — birth-time interval-adherence fetch (late-sync gap)", () => {
  // A few days before TODAY (2026-06-22) — a planned Threshold day that never got interval-aware
  // scoring because it wasn't "today" on the sync that first recorded it (a late-synced ride).
  const PAST_DATE = "2026-06-19";

  const pastThresholdDay = {
    date: PAST_DATE,
    name: "Threshold 3x12",
    type: "Threshold" as const,
    durationMin: 75,
    workoutText: "Main Set 3x\n- 12m 95%",
  };

  const seedPastCandidate = () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(mkBlock({ days: [pastThresholdDay] }));
    vi.mocked(api.runFullSync).mockResolvedValue(
      mkSync({ activities: [mkActivity({ id: "past1", date: PAST_DATE })] })
    );
  };

  it("fetches intervals exactly once for a fresh past planned Threshold date and stamps the merged entry", async () => {
    seedPastCandidate();
    vi.mocked(api.fetchIntervals).mockResolvedValue([
      { type: "WORK", durationSec: 720, avgWatts: 190, npWatts: 192, avgHr: 155, startIndex: 0, endIndex: 100 },
      { type: "WORK", durationSec: 720, avgWatts: 190, npWatts: 192, avgHr: 155, startIndex: 200, endIndex: 300 },
      { type: "WORK", durationSec: 720, avgWatts: 190, npWatts: 192, avgHr: 155, startIndex: 400, endIndex: 500 },
    ]);
    const res = await postSync();
    expect(res.status).toBe(200);
    expect(api.fetchIntervals).toHaveBeenCalledTimes(1);
    expect(api.fetchIntervals).toHaveBeenCalledWith("past1");
    const entry = scoreEntries.find((e) => e.date === PAST_DATE);
    expect(entry).toBeDefined();
    expect(entry?.intervals).toEqual({
      adherencePct: 100,
      structuralMismatch: false,
      completed: 3,
      total: 3,
    });
    // Adherence-aware score: full duration + power match nets full marks (as the today-path proves
    // for an identical prescription/execution shape).
    expect(entry?.executionScore).toBeGreaterThan(0);
  });

  it("births a VO2max candidate off interval adherence identically to Threshold (acceptance criterion #1 isn't type-specific)", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({ days: [{ ...pastThresholdDay, type: "VO2max" as const }] })
    );
    vi.mocked(api.runFullSync).mockResolvedValue(
      mkSync({ activities: [mkActivity({ id: "past1", date: PAST_DATE })] })
    );
    vi.mocked(api.fetchIntervals).mockResolvedValue([
      { type: "WORK", durationSec: 720, avgWatts: 190, npWatts: 192, avgHr: 155, startIndex: 0, endIndex: 100 },
      { type: "WORK", durationSec: 720, avgWatts: 190, npWatts: 192, avgHr: 155, startIndex: 200, endIndex: 300 },
      { type: "WORK", durationSec: 720, avgWatts: 190, npWatts: 192, avgHr: 155, startIndex: 400, endIndex: 500 },
    ]);
    const res = await postSync();
    expect(res.status).toBe(200);
    expect(api.fetchIntervals).toHaveBeenCalledTimes(1);
    expect(api.fetchIntervals).toHaveBeenCalledWith("past1");
    const entry = scoreEntries.find((e) => e.date === PAST_DATE);
    expect(entry?.intervals).toEqual({
      adherencePct: 100,
      structuralMismatch: false,
      completed: 3,
      total: 3,
    });
    expect(entry?.executionScore).toBeGreaterThan(0);
  });

  it("caps at 6 candidate dates (newest first) and warns when more qualify", async () => {
    // 7 distinct past Threshold dates, all fresh candidates — one more than the cap.
    const dates = ["2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14", "2026-06-15", "2026-06-16"];
    const days = dates.map((date) => ({ ...pastThresholdDay, date }));
    vi.mocked(store.readCurrentBlock).mockResolvedValue(mkBlock({ days }));
    vi.mocked(api.runFullSync).mockResolvedValue(
      mkSync({ activities: dates.map((date) => mkActivity({ id: `a-${date}`, date })) })
    );
    const res = await postSync();
    expect(res.status).toBe(200);
    const json = await res.json();
    // Exactly 6 fetched — the newest 6 of the 7 (2026-06-11..16), oldest (06-10) dropped.
    expect(api.fetchIntervals).toHaveBeenCalledTimes(6);
    expect(api.fetchIntervals).not.toHaveBeenCalledWith("a-2026-06-10");
    for (const date of dates.slice(1)) expect(api.fetchIntervals).toHaveBeenCalledWith(`a-${date}`);
    expect(json.warnings.some((w: string) => /capped at 6 of 7/.test(w))).toBe(true);
  });

  it("does not fetch intervals for a date already present in the ledger", async () => {
    scoreEntries = [mkScoreEntry({ date: PAST_DATE, executionScore: 7, ftpUsed: 200 })];
    seedPastCandidate();
    const res = await postSync();
    expect(res.status).toBe(200);
    expect(api.fetchIntervals).not.toHaveBeenCalled();
    // Frozen entry untouched (immutable per date).
    expect(scoreEntries.find((e) => e.date === PAST_DATE)).toMatchObject({ executionScore: 7, ftpUsed: 200 });
  });

  it("survives a fetchIntervals rejection: sync succeeds, entry still present (coarse), warning logged", async () => {
    seedPastCandidate();
    vi.mocked(api.fetchIntervals).mockRejectedValueOnce(new Error("upstream 500"));
    const res = await postSync();
    expect(res.status).toBe(200);
    const json = await res.json();
    const entry = scoreEntries.find((e) => e.date === PAST_DATE);
    expect(entry).toBeDefined(); // built by the normal buildRideScores path regardless
    expect(entry?.intervals).toBeUndefined(); // no stamp — the fetch never landed
    expect(json.warnings.some((w: string) => /birth-adherence/i.test(w) || /upstream 500/.test(w))).toBe(true);
  });

  it("CRITICAL: an empty (not rejected) fetchIntervals result must not freeze a fabricated 0% stamp — entry stays coarse", async () => {
    // fetchIntervals NEVER rejects in production (it swallows timeouts/429s/5xx internally and
    // resolves to []) — mockResolvedValueOnce([]) is the REAL failure shape, unlike the rejection
    // test above. Before the fix, matchPrescription(nonEmptyPrescription, []) returns a fully-formed,
    // non-null comparison with adherencePct: 0 and structuralMismatch: false, which the ledger would
    // freeze as if it were a real, trustworthy 0%-adherence score — permanently, since this date can
    // never be retried once present in the ledger.
    seedPastCandidate();
    vi.mocked(api.fetchIntervals).mockResolvedValueOnce([]);
    const res = await postSync();
    expect(res.status).toBe(200);
    const entry = scoreEntries.find((e) => e.date === PAST_DATE);
    expect(entry).toBeDefined(); // built by the normal buildRideScores path regardless (coarse fallback)
    expect(entry?.intervals).toBeUndefined(); // no fabricated stamp — must NOT be { adherencePct: 0, ... }
  });

  it("stops attempting further candidates once the birth-fetch time budget is exceeded, without failing the sync", async () => {
    // 3 fresh candidate dates. The first fetchIntervals call "spends" the whole budget by advancing
    // the clock past it before resolving, so the loop's next-iteration budget check should trip and
    // skip the remaining candidates rather than attempt all 3.
    const dates = ["2026-06-17", "2026-06-18", PAST_DATE];
    const days = dates.map((date) => ({ ...pastThresholdDay, date }));
    vi.mocked(store.readCurrentBlock).mockResolvedValue(mkBlock({ days }));
    vi.mocked(api.runFullSync).mockResolvedValue(
      mkSync({ activities: dates.map((date) => mkActivity({ id: `a-${date}`, date })) })
    );
    vi.useFakeTimers();
    try {
      vi.mocked(api.fetchIntervals).mockImplementation(async () => {
        vi.advanceTimersByTime(41_000); // past the 40s budget, inside the first call
        return [];
      });
      const postPromise = postSync();
      await vi.runAllTimersAsync();
      const res = await postPromise;
      expect(res.status).toBe(200);
      const json = await res.json();
      // Only the first candidate was attempted — the loop's budget check trips before the 2nd/3rd.
      expect(api.fetchIntervals).toHaveBeenCalledTimes(1);
      expect(json.warnings.some((w: string) => /time budget exceeded/i.test(w))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rebuild run: a frozen adherence stamp on an existing entry reaches the re-score and survives the merge", async () => {
    // Seed an existing entry that already carries a frozen `intervals` stamp (as if a prior today-patch
    // or birth-fetch put it there) but a stale/coarse executionScore that predates it.
    scoreEntries = [
      mkScoreEntry({
        date: PAST_DATE,
        executionScore: 3, // stale/coarse — as if scored before adherence was known
        ftpUsed: 250,
        intervals: { adherencePct: 100, structuralMismatch: false, completed: 3, total: 3 },
      }),
    ];
    // The activity ran well SHORT of the planned 75min (45min → 60% duration compliance, which alone
    // would land in computeExecutionScore's "-1" bucket). The frozen stamp's adherencePct: 100 sits in
    // the "+2" bucket instead — so the two branches produce provably DIFFERENT deltas, and only a
    // re-score that actually consulted adherenceForDate (not duration compliance) lands on the higher one.
    vi.mocked(store.readCurrentBlock).mockResolvedValue(mkBlock({ days: [pastThresholdDay] }));
    vi.mocked(api.runFullSync).mockResolvedValue(
      mkSync({ activities: [mkActivity({ id: "past1", date: PAST_DATE, movingTimeSec: 2700 })] })
    );
    const json = await (await postSync({ today: TODAY, rebuildLedger: true })).json();
    expect(store.writeLedgerRebuild).toHaveBeenCalledOnce();
    // fetchIntervals must NOT be called for this date under rebuild — the frozen stamp is reused via
    // the lookup's second branch, not re-fetched.
    expect(api.fetchIntervals).not.toHaveBeenCalledWith("past1");
    const entry = scoreEntries.find((e) => e.date === PAST_DATE);
    expect(entry?.intervals).toEqual({ adherencePct: 100, structuralMismatch: false, completed: 3, total: 3 });
    // Re-scored against the current FTP resolution (200) under rebuild, proving fresh (not frozen) won.
    expect(entry?.ftpUsed).toBe(200);
    // Proves the frozen stamp actually drove the re-score, not just duration compliance: computeExecutionScore
    // on this exact fixture (IF 0.95, VI 190/180, Threshold) gives 6 fed 60% duration-only compliance, vs 9
    // fed adherencePct: 100 (verified by hand against lib/execution-score.ts) — an unambiguous, exact
    // discriminator between "adherenceForDate was consulted" and "it wasn't".
    expect(entry?.executionScore).toBe(9);
    expect(json.warnings.some((w: string) => /Ledger rebuilt/.test(w))).toBe(true);
  });
});

describe("POST /api/sync — NEAT recalibration (Task 4)", () => {
  // Mifflin-St Jeor for a 75kg/180cm/30yo male: 10*75 + 6.25*180 - 5*30 + 5 = 1730.
  const RMR = 1730;

  const derivedProfile = (neatOverride: Record<string, unknown> = {}) => ({
    ...profile,
    performance: { ...profile.performance, dateOfBirth: "1996-01-01", heightCm: 180, sex: "male" as const },
    nutrition: {
      ...profile.nutrition,
      targetRateKgPerWeek: null,
      neat: {
        multiplier: 1.2, confidence: "low" as const, source: "default" as const,
        windowDays: null, loggedDays: null, weighIns: null, solvedAt: null, imbalance: null, stale: false,
        ...neatOverride,
      },
    },
  });

  // 42 consecutive fully-logged days ending the day before TODAY (no transfer gap, flat weight) — a
  // known-k identity calibrateNeat can recover, mirroring lib/nutrition.test.ts's own `synth` helper.
  const wellnessWindow = (k: number, burnPerDay: number) => {
    const wellness: SyncData["wellness"] = [];
    const activities: ActivitySummary[] = [];
    const cutoffMs = Date.parse(TODAY) - 42 * 86_400_000;
    for (let i = 0; i < 42; i++) {
      const date = new Date(cutoffMs + i * 86_400_000).toISOString().slice(0, 10);
      wellness.push({ date, weightKg: 75, hrv: null, sleepHours: null, sleepQuality: null, kcalConsumed: k * RMR + burnPerDay, ctl: null, atl: null });
      activities.push(mkActivity({ id: `neat-${date}`, date, activeBurnKcal: burnPerDay, kj: null }));
    }
    return { wellness, activities };
  };

  it("persists a fresh derived calibration after a sync", async () => {
    vi.mocked(store.readAthleteProfile).mockResolvedValue(derivedProfile() as never);
    const { wellness, activities } = wellnessWindow(1.3, 1000);
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ wellness, activities }));

    await postSync();

    expect(store.updateAthleteProfile).toHaveBeenCalledTimes(1);
    const mutate = vi.mocked(store.updateAthleteProfile).mock.calls[0][0];
    const result = await mutate(derivedProfile() as never);
    expect(result.nutrition.neat.source).toBe("derived");
    // The fixture's intake is built as `k_gross × RMR + burn` — i.e. against the GROSS burn figure.
    // calibrateNeat now solves against exerciseBurn (net of each activity's resting-equivalent cost),
    // so it recovers a correspondingly higher k, by exactly the resting cost of the ride's duration
    // expressed in RMR-multiples: 1.3 + (4500 s / 3600) / 24 = 1.3520833…, which is what it returns to
    // the last digit. Asserted as the derivation rather than a hardcoded constant so the number can
    // never drift away from the mechanism that produces it.
    const NETTING_OFFSET = 4500 / 3600 / 24; // mkActivity's default movingTimeSec, as a fraction of a day
    expect(result.nutrition.neat.multiplier).toBeCloseTo(1.3 + NETTING_OFFSET, 6);
    expect(result.nutrition.neat.basis).toBe("net");
    expect(result.nutrition.neat.stale).toBe(false);
  });

  it("never overwrites a manual override, even when a fresh solve would succeed", async () => {
    const overridden = derivedProfile({ source: "override", multiplier: 1.45 });
    vi.mocked(store.readAthleteProfile).mockResolvedValue(overridden as never);
    const { wellness, activities } = wellnessWindow(1.3, 1000);
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ wellness, activities }));

    await postSync();

    // The override guard is re-checked INSIDE updateAthleteProfile's lock against whatever's
    // actually on disk (not the outer readAthleteProfile snapshot) — mutate is still invoked, but
    // must be a no-op against the locked current value when it's an override.
    expect(store.updateAthleteProfile).toHaveBeenCalledTimes(1);
    const mutate = vi.mocked(store.updateAthleteProfile).mock.calls[0][0];
    const result = await mutate(overridden as never);
    expect(result.nutrition.neat.source).toBe("override");
    expect(result.nutrition.neat.multiplier).toBe(1.45);
  });

  it("re-checks the override guard against the LOCKED value, not the stale outer read", async () => {
    // Simulates the real race this guards against: the outer readAthleteProfile() snapshot (used to
    // resolve the model/RMR) still shows "default", but a concurrent PUT set an override by the time
    // updateAthleteProfile's lock is actually acquired.
    vi.mocked(store.readAthleteProfile).mockResolvedValue(derivedProfile() as never);
    const { wellness, activities } = wellnessWindow(1.3, 1000);
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ wellness, activities }));

    await postSync();

    const mutate = vi.mocked(store.updateAthleteProfile).mock.calls[0][0];
    const concurrentlyOverridden = derivedProfile({ source: "override", multiplier: 1.5 });
    const result = await mutate(concurrentlyOverridden as never);
    expect(result.nutrition.neat.source).toBe("override");
    expect(result.nutrition.neat.multiplier).toBe(1.5);
  });

  it("does not persist when calibration withholds (below the confidence floor)", async () => {
    vi.mocked(store.readAthleteProfile).mockResolvedValue(derivedProfile() as never);
    // Only 10 of the 42 days logged — same "withholds" fixture pattern as lib/nutrition.test.ts.
    const { wellness, activities } = wellnessWindow(1.3, 1000);
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ wellness: wellness.slice(0, 10), activities: activities.slice(0, 10) }));

    await postSync();

    expect(store.updateAthleteProfile).not.toHaveBeenCalled();
  });

  it("never breaks the sync when calibration throws — logs and leaves neat untouched", async () => {
    // Only the FIRST readAthleteProfile call (this new block's own read) fails; later calls elsewhere
    // in the handler (e.g. the FTP fallback) fall through to the normal profile fixture.
    vi.mocked(store.readAthleteProfile)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(profile as never);
    const { wellness, activities } = wellnessWindow(1.3, 1000);
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ wellness, activities }));

    const res = await postSync();

    expect(res.status).toBe(200);
    expect(store.updateAthleteProfile).not.toHaveBeenCalled();
  });
});

describe("POST /api/sync — day-type NEAT recalibration (DT Task 2)", () => {
  // Mifflin-St Jeor for a 75kg/180cm/30yo male: 10*75 + 6.25*180 - 5*30 + 5 = 1730.
  const RMR = 1730;

  const derivedProfile = (neatOverride: Record<string, unknown> = {}) => ({
    ...profile,
    performance: { ...profile.performance, dateOfBirth: "1996-01-01", heightCm: 180, sex: "male" as const },
    nutrition: {
      ...profile.nutrition,
      targetRateKgPerWeek: null,
      neat: {
        multiplier: 1.2, confidence: "low" as const, source: "default" as const,
        windowDays: null, loggedDays: null, weighIns: null, solvedAt: null, imbalance: null, stale: false,
        ...neatOverride,
      },
    },
  });

  // Rest days (no activity, flat k=1.5) followed by training days (activity every day, flat k=1.22)
  // spanning nRest+nTrain consecutive days ending the day before TODAY — enough of each subset to clear
  // DAY_TYPE_MIN_LOGGED_DAYS and (with nRest large enough) a genuinely non-zero shrinkageWeight.rest.
  // Mirrors lib/nutrition.test.ts's calibrateNeatByDayType `synth` helper, adapted to this file's fixtures.
  const dayTypeWindow = (kRest: number, kTrain: number, nRest: number, nTrain: number, trainBurn = 1000) => {
    const wellness: SyncData["wellness"] = [];
    const activities: ActivitySummary[] = [];
    const totalDays = nRest + nTrain;
    const startMs = Date.parse(TODAY) - totalDays * 86_400_000;
    let day = 0;
    for (let i = 0; i < nRest; i++, day++) {
      const date = new Date(startMs + day * 86_400_000).toISOString().slice(0, 10);
      wellness.push({ date, weightKg: 75, hrv: null, sleepHours: null, sleepQuality: null, kcalConsumed: kRest * RMR, ctl: null, atl: null });
    }
    for (let i = 0; i < nTrain; i++, day++) {
      const date = new Date(startMs + day * 86_400_000).toISOString().slice(0, 10);
      wellness.push({ date, weightKg: 75, hrv: null, sleepHours: null, sleepQuality: null, kcalConsumed: kTrain * RMR + trainBurn, ctl: null, atl: null });
      activities.push(mkActivity({ id: `dt-${date}`, date, activeBurnKcal: trainBurn, kj: null }));
    }
    return { wellness, activities };
  };

  it("persists a fresh dayTypeNeat (rest + train + pooled) in the SAME write as the pooled adoption", async () => {
    vi.mocked(store.readAthleteProfile).mockResolvedValue(derivedProfile() as never);
    const { wellness, activities } = dayTypeWindow(1.5, 1.22, 20, 40);
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ wellness, activities }));

    await postSync();

    // ONE combined write, not two — atomic, so `neat` and `dayTypeNeat.pooled` can never disagree.
    expect(store.updateAthleteProfile).toHaveBeenCalledTimes(1);
    const mutate = vi.mocked(store.updateAthleteProfile).mock.calls[0][0];
    const result = await mutate(derivedProfile() as never);
    expect(result.nutrition.dayTypeNeat).not.toBeNull();
    expect(result.nutrition.dayTypeNeat!.rest.source).toBe("derived");
    expect(result.nutrition.dayTypeNeat!.train.source).toBe("derived");
    expect(result.nutrition.dayTypeNeat!.shrinkageWeight.rest).toBeGreaterThan(0);
    expect(result.nutrition.dayTypeNeat!.pooled.multiplier).toBe(result.nutrition.neat.multiplier);
  });

  it("never persists dayTypeNeat when the pooled NEAT multiplier is manually overridden", async () => {
    const overridden = derivedProfile({ source: "override", multiplier: 1.45 });
    vi.mocked(store.readAthleteProfile).mockResolvedValue(overridden as never);
    const { wellness, activities } = dayTypeWindow(1.5, 1.22, 20, 40);
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ wellness, activities }));

    await postSync();

    expect(store.updateAthleteProfile).toHaveBeenCalledTimes(1);
    const mutate = vi.mocked(store.updateAthleteProfile).mock.calls[0][0];
    const result = await mutate(overridden as never);
    expect(result.nutrition.neat.source).toBe("override");
    expect(result.nutrition.neat.multiplier).toBe(1.45);
    // Untouched, not just "still derived elsewhere" — the override guard extends to the day-type path.
    expect(result.nutrition.dayTypeNeat).toBe((overridden as unknown as { nutrition: { dayTypeNeat: unknown } }).nutrition.dayTypeNeat);
  });

  it("still persists dayTypeNeat with shrinkageWeight 0 when the rest-day sample is too thin — informative, not withheld like a bare null", async () => {
    vi.mocked(store.readAthleteProfile).mockResolvedValue(derivedProfile() as never);
    // Only 2 rest days: below DAY_TYPE_MIN_LOGGED_DAYS (3).
    const { wellness, activities } = dayTypeWindow(1.5, 1.22, 2, 40);
    vi.mocked(api.runFullSync).mockResolvedValue(mkSync({ wellness, activities }));

    await postSync();

    const mutate = vi.mocked(store.updateAthleteProfile).mock.calls[0][0];
    const result = await mutate(derivedProfile() as never);
    expect(result.nutrition.dayTypeNeat).not.toBeNull();
    expect(result.nutrition.dayTypeNeat!.shrinkageWeight.rest).toBe(0);
  });
});

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
    const json = await (await DELETE(new Request("http://localhost/api/sync"))).json();
    expect(api.deleteEvents).toHaveBeenCalledWith([11, 12, 13]);
    expect(store.appendBlockHistory).toHaveBeenCalledOnce();
    const archived = vi.mocked(store.appendBlockHistory).mock.calls[0][0];
    expect(archived.days?.map((d) => d.date)).toEqual(["2026-06-20", "2026-06-21"]); // future 06-25 dropped
    expect(store.updateCurrentBlock).toHaveBeenCalled();
    expect((vi.mocked(store.updateCurrentBlock).mock.calls.at(-1)![0])(null)).toBe(null);
    expect(json).toMatchObject({ ok: true, eventsRemoved: 3, eventsFailed: [] });
  });

  it("HR-32: uses the client-supplied local ?today, not the server's UTC date, to decide what's lived", async () => {
    // System time is 2026-06-22T12:00:00Z (utcToday() === "2026-06-22"), but an athlete east of UTC
    // can already be on 2026-06-23 locally — a day they rode THIS MORNING must still archive as lived.
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({ days: [{ date: "2026-06-23", name: "Threshold", type: "Threshold", durationMin: 75 }] })
    );
    await DELETE(new Request("http://localhost/api/sync?today=2026-06-23"));
    const archived = vi.mocked(store.appendBlockHistory).mock.calls[0][0];
    expect(archived.days?.map((d) => d.date)).toEqual(["2026-06-23"]); // not silently dropped
  });

  it("falls back to UTC when no ?today is supplied", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({ days: [{ date: "2026-06-22", name: "Threshold", type: "Threshold", durationMin: 75 }] })
    );
    await DELETE(new Request("http://localhost/api/sync"));
    const archived = vi.mocked(store.appendBlockHistory).mock.calls[0][0];
    expect(archived.days?.map((d) => d.date)).toEqual(["2026-06-22"]);
  });

  it("carries block.seasonFocus forward onto the archived BlockHistoryEntry (CFS-8)", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({
        seasonFocus: "threshold",
        seasonPhase: "build",
        days: [{ date: "2026-06-20", name: "Threshold", type: "Threshold", durationMin: 75, eventId: 11 }],
      })
    );
    vi.mocked(api.deleteEvents).mockResolvedValue({ deleted: [11], failed: [] });
    await DELETE(new Request("http://localhost/api/sync"));
    const archived = vi.mocked(store.appendBlockHistory).mock.calls[0][0];
    expect(archived.seasonFocus).toBe("threshold");
  });

  it("omits seasonFocus on the archived entry when the block never had one (pre-upgrade block)", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({
        days: [{ date: "2026-06-20", name: "Threshold", type: "Threshold", durationMin: 75, eventId: 11 }],
      })
    );
    vi.mocked(api.deleteEvents).mockResolvedValue({ deleted: [11], failed: [] });
    await DELETE(new Request("http://localhost/api/sync"));
    const archived = vi.mocked(store.appendBlockHistory).mock.calls[0][0];
    expect(archived.seasonFocus).toBeUndefined();
  });

  it("does not archive a same-day discard with no lived days (SUB-1 noise guard)", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({
        startDate: "2026-06-23",
        days: [{ date: "2026-06-23", name: "Threshold", type: "Threshold", durationMin: 75 }],
      })
    );
    const json = await (await DELETE(new Request("http://localhost/api/sync"))).json();
    expect(store.appendBlockHistory).not.toHaveBeenCalled();
    expect(store.updateCurrentBlock).toHaveBeenCalled();
    expect((vi.mocked(store.updateCurrentBlock).mock.calls.at(-1)![0])(null)).toBe(null);
    expect(json.ok).toBe(true);
  });

  it("handles no active block", async () => {
    const json = await (await DELETE(new Request("http://localhost/api/sync"))).json();
    expect(api.deleteEvents).not.toHaveBeenCalled();
    expect(store.appendBlockHistory).not.toHaveBeenCalled();
    expect(json).toMatchObject({ ok: true, eventsRemoved: 0 });
  });

  it("UXA-24: rejects with 409 and deletes nothing when expectedBlockCreatedAt is stale", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({ days: [{ date: "2026-06-20", name: "Threshold", type: "Threshold", durationMin: 75, eventId: 11 }] })
    );
    const res = await DELETE(new Request("http://localhost/api/sync?expectedBlockCreatedAt=2020-01-01T00%3A00%3A00.000Z"));
    expect(res.status).toBe(409);
    expect(api.deleteEvents).not.toHaveBeenCalled();
    expect(store.updateCurrentBlock).not.toHaveBeenCalled();
  });

  it("UXA-24: proceeds when expectedBlockCreatedAt matches the real block", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({ days: [{ date: "2026-06-20", name: "Threshold", type: "Threshold", durationMin: 75, eventId: 11 }] })
    );
    vi.mocked(api.deleteEvents).mockResolvedValue({ deleted: [11], failed: [] });
    const res = await DELETE(new Request(`http://localhost/api/sync?expectedBlockCreatedAt=${encodeURIComponent("2026-06-14T10:00:00.000Z")}`));
    expect(res.status).toBe(200);
  });

  it("HR-35: 409s and skips calendar/archive side effects when the block changed between the top-of-request guard and the actual clear", async () => {
    // The guard above only runs once; deleteEvents is a network round-trip that opens a window where a
    // second mutation (another tab's write/reschedule) can land. updateCurrentBlock's own CAS is what
    // actually re-checks createdAt — simulate it rejecting, as it would if a concurrent write won the race.
    vi.mocked(store.readCurrentBlock).mockResolvedValue(
      mkBlock({ days: [{ date: "2026-06-20", name: "Threshold", type: "Threshold", durationMin: 75, eventId: 11 }] })
    );
    vi.mocked(store.updateCurrentBlock).mockImplementationOnce(async (_mutate, expectedCreatedAt) => {
      expect(expectedCreatedAt).toBe("2026-06-14T10:00:00.000Z");
      return mkBlock({ createdAt: "2026-06-15T00:00:00.000Z" }); // a different, newer block survived
    });
    const res = await DELETE(new Request(`http://localhost/api/sync?expectedBlockCreatedAt=${encodeURIComponent("2026-06-14T10:00:00.000Z")}`));
    expect(res.status).toBe(409);
    expect(api.deleteEvents).not.toHaveBeenCalled();
    expect(store.appendBlockHistory).not.toHaveBeenCalled();
  });
});
