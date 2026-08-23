import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "./data-store";
import * as intervals from "./intervals-api";
import { noteFingerprint } from "./intent-queue";
import { isApplicable } from "./intent-overlay";
import { runIntentParsing } from "./intent-runner";
import type { RideEvidence } from "./intent-scoring";
import { readPhysiology } from "./physiology";
import type {
  ActivitySummary,
  IntentInterpretation,
  IntentOverlay,
  IntentOverlayStore,
  PhysiologySnapshot,
  RideScoreEntry,
} from "./types";

// Call-through spy on the deterministic scorer, so tests can inspect the exact evidence the runner
// hands it (e.g. ride-date power zones) while every other test keeps real scoring behaviour.
const scoreIntentExecutionSpy = vi.hoisted(() => vi.fn());
vi.mock("./intent-scoring", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./intent-scoring")>();
  scoreIntentExecutionSpy.mockImplementation(actual.scoreIntentExecution);
  return { ...actual, scoreIntentExecution: scoreIntentExecutionSpy };
});

vi.mock("./intervals-api", () => ({ fetchIntervals: vi.fn() }));
vi.mock("./data-store", () => ({
  readLastSync: vi.fn(),
  readScoreLog: vi.fn(),
  readIntentOverlays: vi.fn(),
  updateIntentOverlayStore: vi.fn(),
  updateIntentOverlays: vi.fn(),
}));
// Only `readPhysiology` is stubbed — `physiologyAsOf` stays REAL so this suite pins actual
// effective-dating behaviour, not a re-implementation of it.
vi.mock("./physiology", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./physiology")>();
  return { ...actual, readPhysiology: vi.fn() };
});

const TODAY = "2026-08-07";

function activity(over: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    id: "a1",
    date: TODAY,
    type: "Ride",
    name: "Ride",
    movingTimeSec: 3600,
    avgWatts: 180,
    normalizedPower: 185,
    maxWatts: 400,
    icuFtp: 288,
    avgHr: 140,
    maxHr: 165,
    kj: 600,
    activeBurnKcal: 600,
    trainingLoad: 60,
    rpe: 5,
    carbsIngestedG: null,
    decoupling: 3,
    efficiencyFactor: 1.3,
    powerHrZ2: null,
    powerHrZ2Mins: null,
    description: "60 min endurance",
    avgCadence: 88,
    distanceMeters: 30000,
    elevationGain: 300,
    powerZoneTimes: [0, 3600, 0, 0, 0, 0, 0],
    hrZoneTimes: null,
    wPrimeRollingJ: null,
    wBalDepletionJ: null,
    hrrc: null,
    ...over,
  };
}

function ledger(over: Partial<RideScoreEntry> = {}): RideScoreEntry {
  return {
    date: TODAY,
    executionScore: 5,
    plannedType: null,
    inferredType: "Z2",
    planned: false,
    legacy: false,
    compliancePct: null,
    intensityFactor: 0.64,
    ftpUsed: 288,
    durationMin: 60,
    tss: 60,
    ...over,
  };
}

function interpretation(confidence: "high" | "medium" | "low" = "high"): IntentInterpretation {
  return {
    intent: {
      primaryPurpose: "endurance",
      phases: [{ description: "60 min endurance", kind: "duration", durationMin: 60 }],
    },
    confidence,
    objectives: [
      {
        description: "60 min endurance",
        kind: "duration",
        target: { durationMin: 60 },
        zoneBasis: "unspecified",
        grounded: true,
        sourceText: "60 min endurance",
        measurable: false,
        scored: false,
        scopeMin: null,
        evidence: null,
      },
    ],
    model: "claude-sonnet-4-6",
    promptVersion: 1,
  };
}

function prior(over: Partial<IntentOverlay> = {}): IntentOverlay {
  return {
    id: "old",
    activityId: "a1",
    date: TODAY,
    noteFingerprint: "old-fingerprint",
    status: "active",
    origin: "self-directed",
    effectiveExecutionScore: 8,
    notScoredReason: null,
    interpretation: interpretation(),
    scoringVersion: 1,
    effectiveWorkoutType: "Z2",
    schemaVersion: 1,
    createdAt: "2026-08-07T10:00:00.000Z",
    approvedAt: null,
    supersededBy: null,
    ...over,
  };
}

let activities: ActivitySummary[];
let entries: RideScoreEntry[];
let overlayStore: IntentOverlayStore;

beforeEach(() => {
  vi.clearAllMocks();
  activities = [activity()];
  entries = [ledger()];
  overlayStore = { overlays: [], autoFromDate: TODAY, updatedAt: "1970-01-01T00:00:00.000Z" };

  vi.mocked(store.readLastSync).mockImplementation(async () => ({ activities } as never));
  vi.mocked(store.readScoreLog).mockImplementation(async () => ({ entries, updatedAt: "now" }));
  vi.mocked(store.readIntentOverlays).mockImplementation(async () => structuredClone(overlayStore));
  vi.mocked(store.updateIntentOverlayStore).mockImplementation(async (mutate) => {
    overlayStore = await mutate(structuredClone(overlayStore));
    return structuredClone(overlayStore);
  });
  vi.mocked(store.updateIntentOverlays).mockImplementation(async (mutate) => {
    overlayStore.overlays = await mutate(structuredClone(overlayStore.overlays));
    return structuredClone(overlayStore);
  });
  vi.mocked(readPhysiology).mockResolvedValue(null);
  vi.mocked(intervals.fetchIntervals).mockResolvedValue([]);
});

describe("runIntentParsing", () => {
  it("scores the August 23 labelled intervals without calling Claude", async () => {
    activities[0].description = `Intent:
-Block 1 (Z3, 1h)
-Effort 1 (Z4 avg/Z5 NP, 7m, rolling climb, steep gradients)
-Effort 2 (z5 avg, 3m30s, very steep short climb)
-Block 2 (Z2 avg/Z3 NP, 24m, rolling terrain)`;
    activities[0].movingTimeSec = 6030;
    entries[0] = ledger({ durationMin: 101, ftpUsed: 288 });
    vi.mocked(readPhysiology).mockResolvedValue({
      history: [],
      current: {
        effectiveFrom: "2026-08-01", capturedAt: "2026-08-01T00:00:00.000Z", source: "intervals",
        ftp: 288, lthr: 165, maxHr: 185, powerZonePct: [55, 75, 90, 105, 120, 150, 999],
        hrZones: [], hrZonesAreBpm: true, powerZoneNames: [], hrZoneNames: [],
      },
    });
    const named = (label: string, durationSec: number, avgWatts: number, npWatts: number, startIndex: number) => ({
      type: "WORK", durationSec, avgWatts, npWatts, avgHr: null, startIndex, endIndex: startIndex + durationSec,
      avgGradientPct: null, groupId: null, zone: null, maxHr: null, avgCadenceRpm: null,
      maxGradientPct: null, elevationGainM: null, label, avgSpeedKph: null,
    });
    vi.mocked(intervals.fetchIntervals).mockResolvedValue([
      named("Block 1", 3600, 240, 247, 0),
      named("Effort 1", 440, 275, 304, 3600),
      named("Effort 2", 210, 327, 334, 4040),
      named("Block 2", 1461, 211, 236, 4531),
    ]);

    await runIntentParsing(TODAY, []);

    expect(overlayStore.overlays[0]).toMatchObject({
      effectiveExecutionScore: 9,
      notScoredReason: null,
      interpretation: { model: "deterministic-note-parser" },
    });
  });

  it("decides a note-less ride with no parse call", async () => {
    activities[0].description = "  ";
    await runIntentParsing(TODAY, []);

    expect(overlayStore.overlays[0]).toMatchObject({
      notScoredReason: "no-intent-found",
      origin: "unspecified",
      interpretation: null,
      scoringVersion: null,
    });
  });

  it("an unsupported note writes intent-unreliable without calling Claude", async () => {
    await runIntentParsing(TODAY, []);

    expect(overlayStore.overlays[0]).toMatchObject({ notScoredReason: "intent-unreliable", origin: "unspecified" });
  });

  // The parse runs BEFORE the Intervals.icu fetch, so a note the parser cannot grade never depends
  // on the API being up — an outage must not stall it into failedIds when its overlay needs no laps.
  // A SUPPORTED note, whose grading genuinely needs curated laps, must still stall on an outage.
  it("an unsupported note is recorded without fetching curated laps; a supported one still stalls on an outage", async () => {
    await runIntentParsing(TODAY, []);

    expect(intervals.fetchIntervals).not.toHaveBeenCalled();
    expect(overlayStore.overlays[0]).toMatchObject({ notScoredReason: "intent-unreliable" });

    activities[0].description = "-Effort 1 (10m)";
    vi.mocked(intervals.fetchIntervals).mockRejectedValueOnce(new Error("Intervals unavailable"));

    const result = await runIntentParsing(TODAY, []);

    expect(result).toMatchObject({ processed: 0, remaining: 1, stalled: true, failedIds: ["a1"] });
    // The outage wrote nothing new — only the earlier unsupported note's own overlay remains.
    expect(overlayStore.overlays).toHaveLength(1);
    expect(overlayStore.overlays[0]).toMatchObject({ notScoredReason: "intent-unreliable" });
  });

  it("persists autoFromDate before the first parse and never rewrites it", async () => {
    overlayStore.autoFromDate = undefined;
    const order: string[] = [];
    vi.mocked(store.updateIntentOverlayStore).mockImplementation(async (mutate) => {
      order.push("boundary");
      overlayStore = await mutate(structuredClone(overlayStore));
      return structuredClone(overlayStore);
    });
    await runIntentParsing(TODAY, []);
    expect(order[0]).toBe("boundary");
    expect(overlayStore.autoFromDate).toBe(TODAY);
    await runIntentParsing(TODAY, []);
    expect(store.updateIntentOverlayStore).toHaveBeenCalledTimes(1);
  });

  it("writes nothing before autoFromDate even with force", async () => {
    activities[0].date = "2026-08-06";
    entries[0].date = "2026-08-06";
    const result = await runIntentParsing(TODAY, [], { force: true });
    expect(result.processed).toBe(0);
    expect(overlayStore.overlays).toHaveLength(0);
  });

  it("supersedes pending and disabled predecessors in one store write", async () => {
    overlayStore.overlays = [prior({ status: "pending" }), prior({ id: "disabled", status: "disabled" })];
    await runIntentParsing(TODAY, [], { force: true });

    expect(store.updateIntentOverlays).toHaveBeenCalledTimes(1);
    expect(overlayStore.overlays.filter((o) => o.supersededBy === null)).toHaveLength(1);
    expect(overlayStore.overlays.slice(0, 2).every((o) => o.supersededBy !== null)).toBe(true);
  });

  it("supersedes the old primary by date when a legacy row's primary changes", async () => {
    overlayStore.overlays = [prior({ activityId: "short" })];
    activities = [activity({ id: "short", movingTimeSec: 3600 }), activity({ id: "long", movingTimeSec: 7200 })];
    await runIntentParsing(TODAY, []);

    expect(overlayStore.overlays.find((o) => o.activityId === "short")?.supersededBy).not.toBeNull();
    expect(overlayStore.overlays.filter((o) => o.date === TODAY && o.supersededBy === null)).toHaveLength(1);
    expect(overlayStore.overlays.at(-1)?.activityId).toBe("long");
  });

  it("writes only records its consumer accepts", async () => {
    activities[0].description = "";
    await runIntentParsing(TODAY, []);
    activities[0] = activity({ id: "a2", description: "60 min endurance" });
    entries[0] = ledger({ activityId: "a2" });
    await runIntentParsing(TODAY, []);
    expect(overlayStore.overlays.filter((o) => o.supersededBy === null).every(isApplicable)).toBe(true);
  });

  it("respects the batch limit and reports remaining work", async () => {
    activities = Array.from({ length: 3 }, (_, i) => activity({ id: `a${i}`, date: `2026-08-0${7 - i}` }));
    entries = activities.map((a) => ledger({ date: a.date }));
    overlayStore.autoFromDate = "2026-08-05";
    const result = await runIntentParsing(TODAY, [], { limit: 2 });
    expect(result).toMatchObject({ processed: 2, remaining: 1, stalled: false });
  });

  it("never writes for a prescribed ride, even with force", async () => {
    entries[0].planned = true;
    expect((await runIntentParsing(TODAY, [], { force: true })).processed).toBe(0);
    expect(overlayStore.overlays).toHaveLength(0);
  });

  it("does not depend on Anthropic configuration", async () => {
    const warnings: string[] = [];
    const result = await runIntentParsing(TODAY, warnings);
    expect(result).toMatchObject({ processed: 1, remaining: 0, stalled: false });
    expect(warnings).toHaveLength(0);
  });

  it("binds the write to the exact note fingerprint", async () => {
    await runIntentParsing(TODAY, []);
    expect(overlayStore.overlays[0].noteFingerprint).toBe(noteFingerprint(activities[0].description));
  });

  it("force re-analysis picks up curated intervals the athlete edited after the first parse", async () => {
    activities[0].description = "-Effort 1 (10m)";
    const curatedLap = (avgWatts: number) => ({
      type: "WORK", durationSec: 600, avgWatts, npWatts: avgWatts, avgHr: null,
      startIndex: 0, endIndex: 600, avgGradientPct: null, groupId: null, zone: null,
      maxHr: null, avgCadenceRpm: null, maxGradientPct: null, elevationGainM: null, label: "Effort 1",
      avgSpeedKph: null,
    });

    vi.mocked(intervals.fetchIntervals).mockResolvedValueOnce([curatedLap(250)]);
    await runIntentParsing(TODAY, [], { force: true });
    const first = overlayStore.overlays.find((o) => o.supersededBy === null);
    expect(first?.interpretation?.objectives[0].evidence).toContain("avg 250 W");

    vi.mocked(intervals.fetchIntervals).mockResolvedValueOnce([curatedLap(200)]);
    await runIntentParsing(TODAY, [], { force: true });

    const active = overlayStore.overlays.filter((o) => o.supersededBy === null);
    expect(active).toHaveLength(1);
    expect(active[0].interpretation?.objectives[0].evidence).toContain("avg 200 W");
    expect(active[0].interpretation?.objectives[0].evidence).not.toContain("avg 250 W");
  });

  it("ride-date power zones: the scorer sees the historical snapshot's tops, not current zones", async () => {
    const rideDateTops = [60, 80, 95, 110, 130, 160];
    const currentTops = [50, 70, 85, 100, 115, 140];
    const snapshot = (effectiveFrom: string, powerZonePct: number[]): PhysiologySnapshot => ({
      effectiveFrom,
      capturedAt: "2026-08-01T00:00:00.000Z",
      source: "intervals",
      ftp: 288,
      lthr: 165,
      maxHr: 185,
      powerZonePct,
      hrZones: [],
      hrZonesAreBpm: true,
      powerZoneNames: [],
      hrZoneNames: [],
    });
    // The CURRENT zones changed only AFTER TODAY (2026-08-07): as-of resolution must ignore them
    // for this ride and anchor to the snapshot that was live on the ride date.
    vi.mocked(readPhysiology).mockResolvedValue({
      history: [snapshot("2026-07-01", rideDateTops)],
      current: snapshot("2026-08-10", currentTops),
    });

    await runIntentParsing(TODAY, []);

    expect(scoreIntentExecutionSpy).toHaveBeenCalledTimes(1);
    const evidence = scoreIntentExecutionSpy.mock.calls[0][1] as RideEvidence;
    expect(evidence.powerZoneTopsPct).toEqual(rideDateTops);
    expect(evidence.powerZoneTopsPct).not.toEqual(currentTops);
  });
});
