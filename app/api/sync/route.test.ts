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
