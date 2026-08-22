import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReflectionInterventionInput, RetrospectiveInput } from "@/lib/anthropic-api";
import type { StructuredReflection } from "@/lib/types";

// Route test for /api/retrospective — this route runs for the first time ever around 2026-07-12,
// when the current training block completes. It builds the very first BlockHistoryEntry ever written
// to block-history.json and destructively clears the active block, so its IO ordering and
// failure-tolerance around the LLM calls need characterization coverage before it ships live.

const h = vi.hoisted(() => ({
  isAnthropicConfigured: vi.fn(() => true),
  generateRetrospective: vi.fn<(input: RetrospectiveInput) => Promise<string>>(async () => "Solid block overall."),
  generateStructuredRetrospective: vi.fn<
    (input: RetrospectiveInput & { interventions: ReflectionInterventionInput[] }) => Promise<StructuredReflection[]>
  >(async () => []),
  writeRetrospective: vi.fn<(name: string, content: string) => Promise<void>>(async () => {}),
  readCurrentBlock: vi.fn(),
  readLastSync: vi.fn(),
  readInterventionLog: vi.fn(),
  readAthleteProfile: vi.fn(),
  readScoreLog: vi.fn(),
  appendBlockHistory: vi.fn(async () => {}),
  updateCurrentBlock: vi.fn(async (mutate: (cur: null) => unknown) => mutate(null)),
  readBlockHistory: vi.fn(async () => []),
}));

vi.mock("@/lib/anthropic-api", () => ({
  isAnthropicConfigured: h.isAnthropicConfigured,
  generateRetrospective: h.generateRetrospective,
  generateStructuredRetrospective: h.generateStructuredRetrospective,
}));

vi.mock("@/lib/kb-loader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kb-loader")>()),
  writeRetrospective: h.writeRetrospective,
}));

vi.mock("@/lib/data-store", () => ({
  readCurrentBlock: h.readCurrentBlock,
  readLastSync: h.readLastSync,
  readInterventionLog: h.readInterventionLog,
  readAthleteProfile: h.readAthleteProfile,
  readScoreLog: h.readScoreLog,
  appendBlockHistory: h.appendBlockHistory,
  updateCurrentBlock: h.updateCurrentBlock,
  readBlockHistory: h.readBlockHistory,
}));

import * as store from "@/lib/data-store";
import { POST } from "@/app/api/retrospective/route";

// A bare Request with no body — tolerated (today falls back to UTC), matching every existing test's
// expectations below; the dedicated `today`-threading tests further down send a real body.
const post = (body?: unknown) =>
  POST(new Request("http://localhost/api/retrospective", { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) }));

const day = (date: string, type: string, durationMin: number) => ({
  date,
  name: `${type} day`,
  type,
  durationMin,
});

const block = {
  goal: "Build FTP",
  lengthWeeks: 2,
  startDate: "2026-06-15",
  endDate: "2026-06-28",
  overview: "Two-week threshold build.",
  createdAt: "2026-06-14T08:00:00.000Z",
  days: [
    day("2026-06-15", "Z2", 90),
    day("2026-06-17", "Threshold", 60),
    day("2026-06-20", "Z2", 120),
    day("2026-06-22", "SIT", 45),
    day("2026-06-28", "Z2", 60),
  ],
  model: "claude-sonnet-4-6",
  promptVersion: 3,
};

const sync = {
  syncedAt: "2026-06-28T12:00:00.000Z",
  activities: [
    {
      id: "a1",
      date: "2026-06-15",
      type: "Ride",
      name: "Z2 ride",
      movingTimeSec: 5400,
      avgWatts: 180,
      normalizedPower: 185,
      maxWatts: 400,
      icuFtp: 250,
      trainingLoad: 60,
      decoupling: 3.2,
    },
    {
      id: "a2",
      date: "2026-06-17",
      type: "Ride",
      name: "Threshold ride",
      movingTimeSec: 3600,
      avgWatts: 220,
      normalizedPower: 230,
      maxWatts: 450,
      icuFtp: 250,
      trainingLoad: 80,
      decoupling: 2.1,
    },
  ],
  wellness: [
    { date: "2026-06-15", weightKg: 74, hrv: 60, sleepHours: 7, sleepQuality: 4, kcalConsumed: 2600, ctl: 50, atl: 55 },
    { date: "2026-06-28", weightKg: 73.5, hrv: 62, sleepHours: 7.5, sleepQuality: 4, kcalConsumed: 2700, ctl: 58, atl: 50 },
  ],
  powerCurve: [],
  fitness: { ctl: 58, atl: 50, tsb: 8 },
};

const athleteProfile = {
  performance: { ftp: 250, maxHr: 190, thresholdHr: 170, weightKg: 74, weeklyHoursMin: 6, weeklyHoursMax: 10 },
  goals: [],
  weakpoints: [],
  nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 73 },
  goalsMigratedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const emptyInterventionLog = { records: [], updatedAt: new Date(0).toISOString() };

const maturedIntervention = {
  id: "int-1",
  firedAt: "2026-06-14",
  blockStartDate: "2026-06-15",
  dimension: "Threshold",
  severity: "watch" as const,
  title: "Threshold compliance watch",
  horizonDays: 14,
  baselineExecEwma: 0.8,
  baselinePhys: 250,
  physMetric: "5-min power",
  outcome: {
    evaluatedAt: "2026-06-28T00:00:00.000Z",
    execNow: 0.9,
    physNow: 260,
    execDelta: 0.1,
    physDelta: 10,
    verdict: "validated" as const,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.isAnthropicConfigured.mockReturnValue(true);
  h.generateRetrospective.mockResolvedValue("Solid block overall.");
  h.generateStructuredRetrospective.mockResolvedValue([]);
  h.writeRetrospective.mockResolvedValue(undefined);
  h.readCurrentBlock.mockResolvedValue(block);
  h.readLastSync.mockResolvedValue(sync);
  h.readInterventionLog.mockResolvedValue(emptyInterventionLog);
  h.readAthleteProfile.mockResolvedValue(athleteProfile);
  // Default ledger consistent with the fixture activities: same dates, capped compliance 100,
  // execution 7. Individual cases override via mockResolvedValue after this runs.
  h.readScoreLog.mockReset();
  h.readScoreLog.mockResolvedValue({
    entries: [
      { date: "2026-06-15", planned: true, executionScore: 7, compliancePct: 100, plannedType: "Z2", activityId: "a1" },
      { date: "2026-06-17", planned: true, executionScore: 7, compliancePct: 100, plannedType: "Threshold", activityId: "a2" },
    ],
  });
  h.appendBlockHistory.mockResolvedValue(undefined);
  h.updateCurrentBlock.mockImplementation(async (mutate: (cur: null) => unknown) => mutate(null));
});

describe("/api/retrospective POST", () => {
  it("builds a BlockHistoryEntry carrying every required field", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(store.appendBlockHistory).toHaveBeenCalledTimes(1);
    const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(entry.id).toBe(block.createdAt);
    expect(entry.goal).toBe(block.goal);
    expect(entry.startDate).toBe(block.startDate);
    expect(entry.endDate).toBe(block.endDate);
    expect(entry.lengthWeeks).toBe(block.lengthWeeks);
    expect(entry.overview).toBe(block.overview);
    expect(entry.createdAt).toBe(block.createdAt);
    expect(entry.complianceByType).toBeDefined();
    expect(typeof entry.complianceByType).toBe("object");
    expect(entry.nextBlockSeeds).toBeDefined();
    expect(Array.isArray(entry.nextBlockSeeds)).toBe(true);
    expect(entry.retrospective).toBe("Solid block overall.");
    expect(entry.structuredReflections).toEqual([]);
    expect(entry.model).toBe(block.model);
    expect(entry.promptVersion).toBe(block.promptVersion);
    // SUB-1: every day in this fixture is on/before the block's own endDate, which is in the past
    // relative to any realistic "today" — truncateBlockDays should keep them all.
    expect(entry.days).toHaveLength(block.days.length);
    expect(entry.days.map((d: { date: string }) => d.date)).toEqual(block.days.map((d) => d.date));
  });

  it("averages decoupling only across whole-ride-comparable endurance rides", async () => {
    const steady = sync.activities[0];
    const mixed = (id: string, date: string, decoupling: number) => ({
      ...steady,
      id,
      date,
      name: "Mixed climbing ride",
      normalizedPower: 230,
      avgWatts: 180,
      decoupling,
    });

    h.readLastSync.mockResolvedValueOnce({
      ...sync,
      activities: [steady, mixed("a2", "2026-06-17", 8), mixed("a3", "2026-06-20", 10)],
    });
    await post();
    expect(h.generateRetrospective.mock.calls[0][0].avgDecoupling).toBe(3.2);

    h.readLastSync.mockResolvedValueOnce({
      ...sync,
      activities: [mixed("a2", "2026-06-17", 8), mixed("a3", "2026-06-20", 10)],
    });
    await post();
    expect(h.generateRetrospective.mock.calls[1][0].avgDecoupling).toBeNull();
  });

  it("carries block.seasonFocus forward onto the archived BlockHistoryEntry (CFS-8)", async () => {
    h.readCurrentBlock.mockResolvedValueOnce({ ...block, seasonFocus: "threshold", seasonPhase: "build" });
    await post();
    const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry.seasonFocus).toBe("threshold");
  });

  describe("version guard (HR-33)", () => {
    it("rejects with 409 and archives nothing when expectedBlockCreatedAt is stale", async () => {
      const res = await post({ expectedBlockCreatedAt: "2020-01-01T00:00:00Z" });
      expect(res.status).toBe(409);
      expect(store.appendBlockHistory).not.toHaveBeenCalled();
    });

    it("proceeds when expectedBlockCreatedAt matches the real block", async () => {
      const res = await post({ expectedBlockCreatedAt: block.createdAt });
      expect(res.status).toBe(200);
    });

    it("skips the check entirely when the caller sends no expectedBlockCreatedAt at all", async () => {
      const res = await post();
      expect(res.status).toBe(200);
    });

    it("HR-35: 409s (but keeps the already-saved retrospective in the response) when the block changed between the guard and the actual clear", async () => {
      // The guard above only runs once, before the live LLM call(s) — the widest window of any
      // block-mutating route. updateCurrentBlock's own CAS is what actually re-checks createdAt at
      // write time; simulate it rejecting, as it would if a concurrent write won the race.
      h.updateCurrentBlock.mockImplementation(async () => ({ ...block, createdAt: "2026-06-20T00:00:00.000Z" }));
      const res = await post({ expectedBlockCreatedAt: block.createdAt });
      const json = await res.json();
      expect(res.status).toBe(409);
      expect(store.appendBlockHistory).toHaveBeenCalled(); // already saved — not rolled back
      expect(json.retrospective).toBe("Solid block overall.");
    });
  });

  describe("archive-truncation uses the client's local today (HR-32)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-28T12:00:00.000Z")); // utcToday() === "2026-06-28"
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("archives a day already lived local-side even though the server's UTC date hasn't rolled over yet", async () => {
      h.readCurrentBlock.mockResolvedValueOnce({
        ...block,
        days: [...block.days, day("2026-06-29", "Z2", 60)], // rode it this morning, local
      });
      await post({ today: "2026-06-29" });
      const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(entry.days.map((d: { date: string }) => d.date)).toContain("2026-06-29"); // not silently dropped
    });

    it("falls back to UTC when no today is sent in the body", async () => {
      // endDate shifted one day earlier so the Phase 1 gate (today > endDate, with UTC-fallback
      // today = 2026-06-28) sees a finished block — the truncation assertions are unchanged.
      h.readCurrentBlock.mockResolvedValueOnce({
        ...block,
        endDate: "2026-06-27",
        days: [...block.days, day("2026-06-29", "Z2", 60)],
      });
      await post(); // no body at all
      const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(entry.days.map((d: { date: string }) => d.date)).not.toContain("2026-06-29");
    });
  });

  it("omits seasonFocus on the archived entry when the block never had one (pre-upgrade block)", async () => {
    // Shared `block` fixture carries no seasonFocus at all — the pre-CFS-7 case.
    await post();
    const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry.seasonFocus).toBeUndefined();
  });

  it("appends history before clearing the current block, and 502s without clearing if the append fails", async () => {
    h.appendBlockHistory.mockRejectedValueOnce(new Error("disk full"));
    const res = await post();
    expect(res.status).toBe(502);
    expect(store.updateCurrentBlock).not.toHaveBeenCalled();
  });

  it("calls appendBlockHistory before updateCurrentBlock on the success path", async () => {
    const order: string[] = [];
    (store.appendBlockHistory as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      order.push("append");
    });
    (store.updateCurrentBlock as ReturnType<typeof vi.fn>).mockImplementationOnce(async (mutate: (cur: null) => unknown) => {
      order.push("clear");
      return mutate(null);
    });
    await post();
    expect(order).toEqual(["append", "clear"]);
    const mutateFn = (store.updateCurrentBlock as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mutateFn(null)).toBe(null);
  });

  it("tolerates a failing structured-reflections call, still succeeding with structuredReflections: []", async () => {
    h.readInterventionLog.mockResolvedValueOnce({ records: [maturedIntervention], updatedAt: "2026-06-28T00:00:00.000Z" });
    h.generateStructuredRetrospective.mockRejectedValueOnce(new Error("LLM 500"));

    const res = await post();
    expect(res.status).toBe(200);
    expect(h.generateStructuredRetrospective).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json.structuredReflections).toEqual([]);

    const entry = (store.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry.structuredReflections).toEqual([]);
  });

  it("fires the structured call when a matured intervention matches the block's startDate", async () => {
    h.readInterventionLog.mockResolvedValueOnce({ records: [maturedIntervention], updatedAt: "2026-06-28T00:00:00.000Z" });
    h.generateStructuredRetrospective.mockResolvedValueOnce([
      { dimension: "Threshold", hypothesis: "h", observation: "o", root_cause: "r", adjusted_strategy: "a" },
    ]);

    const res = await post();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.structuredReflections).toHaveLength(1);
    const callArg = h.generateStructuredRetrospective.mock.calls[0][0];
    expect(callArg.interventions).toHaveLength(1);
    expect(callArg.interventions[0].dimension).toBe("Threshold");
  });

  it("tolerates an empty/missing intervention log — no crash, empty structuredReflections, structured call skipped", async () => {
    // Exactly the real default shape readInterventionLog() resolves to for a genuinely-missing file.
    h.readInterventionLog.mockResolvedValueOnce({ records: [], updatedAt: new Date(0).toISOString() });

    const res = await post();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.structuredReflections).toEqual([]);
    expect(h.generateStructuredRetrospective).not.toHaveBeenCalled();
  });

  it("writes the retro file with the retroFileId filename and execution frontmatter", async () => {
    await post();
    expect(store.appendBlockHistory).toHaveBeenCalledTimes(1); // sanity: reached the end of the handler
    expect(h.writeRetrospective).toHaveBeenCalledTimes(1);
    const [filename, content] = h.writeRetrospective.mock.calls[0];
    // retroFileId(): lowercase, non [a-z0-9] runs -> '-', trim leading/trailing '-', cap at 40 chars.
    expect(filename).toBe("2026-06-15_build-ftp.md");
    expect(content).toContain('id: "2026-06-15_build-ftp"');
    expect(content).toContain("execution_scored: 2/5");
    expect(content).toContain("seeds_approved: false");
  });

  describe("live Anthropic call failure (HR-57, Phase 1 trust contract)", () => {
    it("degrades to a deterministic closeout (200, retrospective null) when generateRetrospective rejects", async () => {
      h.generateRetrospective.mockRejectedValueOnce(new Error("529 overloaded"));
      const res = await post();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.retrospective).toBeNull();
      expect(json.narrativeDegraded).toBe(true);
    });

    it("still archives and clears the block when generateRetrospective fails", async () => {
      h.generateRetrospective.mockRejectedValueOnce(new Error("network blip"));
      const res = await post();
      expect(res.status).toBe(200);
      expect(store.appendBlockHistory).toHaveBeenCalledTimes(1);
      expect(store.updateCurrentBlock).toHaveBeenCalled();
    });
  });

  it("closes out deterministically when Anthropic is not configured — no preflight 400 (Phase 1)", async () => {
    h.isAnthropicConfigured.mockReturnValue(false);
    const res = await post();
    expect(res.status).toBe(200);
    expect(store.readCurrentBlock).toHaveBeenCalled();
    const json = await res.json();
    expect(json.retrospective).toBeNull();
    expect(json.narrativeDegraded).toBe(true);
    expect(h.generateRetrospective).not.toHaveBeenCalled();
  });

  it("404s when there is no active block", async () => {
    h.readCurrentBlock.mockResolvedValueOnce(null);
    const res = await post();
    expect(res.status).toBe(404);
    expect(store.appendBlockHistory).not.toHaveBeenCalled();
  });

  it("400s when there is no sync data", async () => {
    h.readLastSync.mockResolvedValueOnce(null);
    const res = await post();
    expect(res.status).toBe(400);
    expect(store.appendBlockHistory).not.toHaveBeenCalled();
  });

  it("closes out an unfinished block given an explicit early-end decision (was: archived freely — now gated)", async () => {
    // The Phase 1 gate replaced the old no-guard characterization: an unfinished block can only
    // complete via endedEarly + reason, which then runs the full closeout end to end.
    h.readCurrentBlock.mockResolvedValueOnce({ ...block, endDate: "2027-06-28" });

    const res = await post({ endedEarly: true, endReason: "Race prep pivot" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.fileId).toBe("2026-06-15_build-ftp");
    expect(store.appendBlockHistory).toHaveBeenCalledTimes(1);
    expect(store.updateCurrentBlock).toHaveBeenCalled();
    const mutateFn = (store.updateCurrentBlock as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mutateFn(null)).toBe(null);
  });
});

describe("Phase 1 trust contract", () => {
  const unfinished = { ...block, endDate: "2099-01-01" };

  it("409s an unfinished block with no explicit early-end decision — and writes NOTHING", async () => {
    h.readCurrentBlock.mockResolvedValue(unfinished);
    const res = await post();
    expect(res.status).toBe(409);
    expect(h.writeRetrospective).not.toHaveBeenCalled();
    expect(h.appendBlockHistory).not.toHaveBeenCalled();
    expect(h.updateCurrentBlock).not.toHaveBeenCalled();
  });

  it("proceeds on an explicit early-end decision and records it on the history entry", async () => {
    h.readCurrentBlock.mockResolvedValue(unfinished);
    const res = await post({ endedEarly: true, endReason: "Race prep pivot" });
    expect(res.status).toBe(200);
    const arg = (h.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.endedEarlyAt).toBeTruthy();
    expect(arg.endedEarlyReason).toBe("Race prep pivot");
  });

  it("409s an early-end decision with a blank reason", async () => {
    h.readCurrentBlock.mockResolvedValue(unfinished);
    const res = await post({ endedEarly: true, endReason: "   " });
    expect(res.status).toBe(409);
    expect(h.appendBlockHistory).not.toHaveBeenCalled();
  });

  it("closes out a normally finished block without any endedEarly fields", async () => {
    h.readCurrentBlock.mockResolvedValue(block); // endDate 2026-06-28 < today fixture usage below
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(200);
    const arg = (h.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.endedEarlyAt).toBeUndefined();
    expect(arg.closeout).toBeTruthy();
  });

  it("completes the whole closeout when Anthropic is NOT configured", async () => {
    h.isAnthropicConfigured.mockReturnValue(false);
    h.readCurrentBlock.mockResolvedValue(block);
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retrospective).toBeNull();
    expect(body.narrativeDegraded).toBe(true);
    expect(h.generateRetrospective).not.toHaveBeenCalled();
    const arg = (h.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.retrospective).toBeUndefined();
    expect(arg.closeout).toBeTruthy();
    expect(arg.nextBlockSeeds.length).toBeGreaterThan(0);
    expect(h.updateCurrentBlock).toHaveBeenCalled(); // the clear STILL happened
  });

  it("degrades gracefully when the narrative call THROWS (no 502, closeout completes)", async () => {
    h.generateRetrospective.mockRejectedValueOnce(new Error("429 overload"));
    h.readCurrentBlock.mockResolvedValue(block);
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(200);
    expect((await res.json()).retrospective).toBeNull();
    expect(h.appendBlockHistory).toHaveBeenCalledTimes(1);
  });

  it("a markdown-write failure leaves history and the active block untouched", async () => {
    h.writeRetrospective.mockRejectedValueOnce(new Error("disk full"));
    h.readCurrentBlock.mockResolvedValue(block);
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(502);
    expect(h.appendBlockHistory).not.toHaveBeenCalled();
    expect(h.updateCurrentBlock).not.toHaveBeenCalled();
  });

  it("a history-append failure leaves the active block uncleared", async () => {
    h.appendBlockHistory.mockRejectedValueOnce(new Error("lock poisoned"));
    h.readCurrentBlock.mockResolvedValue(block);
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(502);
    expect(h.updateCurrentBlock).not.toHaveBeenCalled();
  });

  it("persists closeout evidence built from CAPPED ledger values, and no approval stamp", async () => {
    h.readCurrentBlock.mockResolvedValue(block);
    h.readScoreLog.mockResolvedValue({
      entries: [
        { date: "2026-06-17", planned: true, executionScore: 3, compliancePct: 54, plannedType: "Threshold", activityId: "a2" },
      ],
    });
    const res = await post({ today: "2026-06-29" });
    const body = await res.json();
    const threshold = body.closeout.perType.find((t: { type: string }) => t.type === "Threshold");
    expect(threshold.meanCompliancePct).toBe(54); // capped ledger value…
    expect(threshold.meanCompliancePct).not.toBe(100); // …not the raw 60/60 ratio
    const arg = (h.appendBlockHistory as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.reflectionsApprovedAt).toBeUndefined();
  });

  it("flags overshoot against the ride the ledger scored when a shorter ride sorts first", async () => {
    const twoRides = {
      ...sync,
      activities: [
        { ...sync.activities[0], id: "short", movingTimeSec: 20 * 60 }, // first on 06-15
        { ...sync.activities[0], id: "long", movingTimeSec: 120 * 60 }, // actual primary
      ],
    };
    h.readLastSync.mockResolvedValue(twoRides);
    h.readCurrentBlock.mockResolvedValue(block);
    h.readScoreLog.mockResolvedValue({
      entries: [{ date: "2026-06-15", planned: true, executionScore: 7, compliancePct: 100, plannedType: "Z2", activityId: "long" }],
    });
    const res = await post({ today: "2026-06-29" });
    const body = await res.json();
    expect(body.closeout.overshootSessions).toBe(1); // 120min vs 90 planned > 1.25× — judged on "long"
  });

  it("early ends count only lived days as missed", async () => {
    const early = { ...unfinished, days: [day("2026-06-16", "Z2", 60), day("2098-12-31", "SIT", 45)] };
    h.readCurrentBlock.mockResolvedValue(early);
    h.readScoreLog.mockResolvedValue({ entries: [] });
    const res = await post({ today: "2026-06-20", endedEarly: true, endReason: "injury" });
    const body = await res.json();
    expect(body.closeout.plannedSessions).toBe(1); // the 2098 day excluded entirely
    expect(body.closeout.missedSessions).toBe(1);
  });
});
