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
