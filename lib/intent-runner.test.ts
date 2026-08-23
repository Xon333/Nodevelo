import { beforeEach, describe, expect, it, vi } from "vitest";
import * as anthropic from "./anthropic-api";
import * as store from "./data-store";
import * as intervals from "./intervals-api";
import { buildIntentQueue, noteFingerprint } from "./intent-queue";
import { isApplicable } from "./intent-overlay";
import { runIntentParsing } from "./intent-runner";
import type { RideEvidence } from "./intent-scoring";
import { readPhysiology } from "./physiology";
import type {
  ActivitySummary,
  IntentInterpretation,
  IntentOverlay,
  IntentOverlayStore,
  IntentParseFailure,
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

vi.mock("./anthropic-api", () => ({ isAnthropicConfigured: vi.fn(), parseRideIntent: vi.fn() }));
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

// NV-10: parseRideIntent's real return shape — the mocked module returns this instead of a bare
// IntentInterpretation now.
function outcome(interp: IntentInterpretation | null, failure: IntentParseFailure | null = null) {
  return { interpretation: interp, failure };
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
  vi.mocked(anthropic.isAnthropicConfigured).mockReturnValue(true);
  vi.mocked(anthropic.parseRideIntent).mockResolvedValue(outcome(interpretation()));
  vi.mocked(intervals.fetchIntervals).mockResolvedValue([]);
});

describe("runIntentParsing", () => {
  it("decides a note-less ride with no parse call", async () => {
    activities[0].description = "  ";
    await runIntentParsing(TODAY, []);

    expect(anthropic.parseRideIntent).not.toHaveBeenCalled();
    expect(overlayStore.overlays[0]).toMatchObject({
      notScoredReason: "no-intent-found",
      origin: "unspecified",
      interpretation: null,
      scoringVersion: null,
    });
  });

  it("a transient failure writes nothing and leaves the ride queued", async () => {
    vi.mocked(anthropic.parseRideIntent).mockRejectedValueOnce(new Error("ECONNRESET"));
    const warnings: string[] = [];
    const result = await runIntentParsing(TODAY, warnings);

    expect(overlayStore.overlays).toHaveLength(0);
    expect(result).toMatchObject({ processed: 0, remaining: 1, stalled: true, failedIds: ["a1"] });
    expect(buildIntentQueue(activities, entries, overlayStore.overlays, TODAY, TODAY)).toHaveLength(1);
    expect(warnings[0]).toContain("ECONNRESET");
  });

  it("a later invocation retries and writes after a transient failure", async () => {
    vi.mocked(anthropic.parseRideIntent).mockRejectedValueOnce(new Error("503"));
    await runIntentParsing(TODAY, []);
    vi.mocked(anthropic.parseRideIntent).mockResolvedValueOnce(outcome(interpretation()));

    expect((await runIntentParsing(TODAY, [])).processed).toBe(1);
    expect(overlayStore.overlays).toHaveLength(1);
  });

  it("a completed call with no usable output writes interpreter-failed, carrying the bounded diagnosis (NV-10)", async () => {
    const failure: IntentParseFailure = { category: "schema-invalid", stopReason: "tool_use", issues: [{ path: "confidence", message: "bad enum" }] };
    vi.mocked(anthropic.parseRideIntent).mockResolvedValueOnce(outcome(null, failure));
    const result = await runIntentParsing(TODAY, []);

    expect(result.processed).toBe(1);
    expect(overlayStore.overlays[0]).toMatchObject({ notScoredReason: "interpreter-failed", origin: "unspecified", parseFailure: failure });
  });

  it("a low-confidence parse writes intent-unreliable", async () => {
    vi.mocked(anthropic.parseRideIntent).mockResolvedValueOnce(outcome(interpretation("low")));
    await runIntentParsing(TODAY, []);

    expect(overlayStore.overlays[0]).toMatchObject({ notScoredReason: "intent-unreliable", origin: "unspecified" });
  });

  it("skips a failed item for the rest of one client chain", async () => {
    activities = [activity({ id: "a-new", date: TODAY }), activity({ id: "a-old", date: "2026-08-06" })];
    entries = [ledger({ date: TODAY }), ledger({ date: "2026-08-06" })];
    overlayStore.autoFromDate = "2026-08-06";
    vi.mocked(anthropic.parseRideIntent).mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce(outcome(interpretation()));

    const first = await runIntentParsing(TODAY, [], { limit: 5 });
    expect(first.processed).toBe(1);
    expect(first.failedIds).toEqual(["a-new"]);
    expect(anthropic.parseRideIntent).toHaveBeenCalledTimes(2);

    const second = await runIntentParsing(TODAY, [], { skip: first.failedIds });
    expect(second).toMatchObject({ processed: 0, remaining: 1, stalled: true });
    expect(anthropic.parseRideIntent).toHaveBeenCalledTimes(2);
  });

  it("persists autoFromDate before the first parse and never rewrites it", async () => {
    overlayStore.autoFromDate = undefined;
    const order: string[] = [];
    vi.mocked(store.updateIntentOverlayStore).mockImplementation(async (mutate) => {
      order.push("boundary");
      overlayStore = await mutate(structuredClone(overlayStore));
      return structuredClone(overlayStore);
    });
    vi.mocked(anthropic.parseRideIntent).mockImplementation(async () => {
      order.push("parse");
      return outcome(interpretation());
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

  it("does not call Anthropic when it is unconfigured", async () => {
    vi.mocked(anthropic.isAnthropicConfigured).mockReturnValue(false);
    const warnings: string[] = [];
    const result = await runIntentParsing(TODAY, warnings);
    expect(result).toMatchObject({ processed: 0, remaining: 1, stalled: true });
    expect(anthropic.parseRideIntent).not.toHaveBeenCalled();
    expect(warnings).toHaveLength(1);
  });

  it("binds the write to the exact note fingerprint", async () => {
    await runIntentParsing(TODAY, []);
    expect(overlayStore.overlays[0].noteFingerprint).toBe(noteFingerprint(activities[0].description));
  });

  it("force re-analysis picks up curated intervals the athlete edited after the first parse", async () => {
    activities[0].description = "1 x 10 min at 250W";
    const effortInterpretation: IntentInterpretation = {
      ...interpretation(),
      intent: {
        primaryPurpose: "10 min effort",
        phases: [{ description: "10 min at 250W", kind: "effort", durationMin: 10, targetWatts: 250 }],
      },
      objectives: [{
        description: "10 min at 250W", kind: "effort",
        target: { durationMin: 10, watts: 250, reps: 1 }, zoneBasis: "unspecified",
        grounded: true, sourceText: "10 min at 250W", measurable: false, scored: false,
        scopeMin: null, evidence: null,
      }],
    };
    const curatedLap = (avgWatts: number) => ({
      type: "WORK", durationSec: 600, avgWatts, npWatts: avgWatts, avgHr: null,
      startIndex: 0, endIndex: 600, avgGradientPct: null, groupId: null, zone: null,
      maxHr: null, avgCadenceRpm: null, maxGradientPct: null, elevationGainM: null, label: null,
      avgSpeedKph: null,
    });

    vi.mocked(anthropic.parseRideIntent).mockResolvedValue(outcome(effortInterpretation));
    vi.mocked(intervals.fetchIntervals).mockResolvedValueOnce([curatedLap(250)]);
    await runIntentParsing(TODAY, [], { force: true });
    const first = overlayStore.overlays.find((o) => o.supersededBy === null);
    expect(first?.interpretation?.objectives[0].evidence).toContain("at 250 W vs");

    vi.mocked(anthropic.parseRideIntent).mockResolvedValue(outcome(effortInterpretation));
    vi.mocked(intervals.fetchIntervals).mockResolvedValueOnce([curatedLap(200)]);
    await runIntentParsing(TODAY, [], { force: true });

    const active = overlayStore.overlays.filter((o) => o.supersededBy === null);
    expect(active).toHaveLength(1);
    expect(active[0].interpretation?.objectives[0].evidence).toContain("at 200 W vs");
    expect(active[0].interpretation?.objectives[0].evidence).not.toContain("at 250 W vs");
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
