import { beforeEach, describe, expect, it, vi } from "vitest";
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
  appendBlockHistory: vi.fn(async () => {}),
  writeCurrentBlock: vi.fn(async () => {}),
  readBlockHistory: vi.fn(async () => []),
}));

vi.mock("@/lib/anthropic-api", () => ({
  isAnthropicConfigured: h.isAnthropicConfigured,
  generateRetrospective: h.generateRetrospective,
  generateStructuredRetrospective: h.generateStructuredRetrospective,
}));

vi.mock("@/lib/kb-loader", () => ({
  writeRetrospective: h.writeRetrospective,
}));

vi.mock("@/lib/data-store", () => ({
  readCurrentBlock: h.readCurrentBlock,
  readLastSync: h.readLastSync,
  readInterventionLog: h.readInterventionLog,
  readAthleteProfile: h.readAthleteProfile,
  appendBlockHistory: h.appendBlockHistory,
  writeCurrentBlock: h.writeCurrentBlock,
  readBlockHistory: h.readBlockHistory,
}));

import * as store from "@/lib/data-store";
import { POST } from "@/app/api/retrospective/route";

const post = () => POST();

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
  h.appendBlockHistory.mockResolvedValue(undefined);
  h.writeCurrentBlock.mockResolvedValue(undefined);
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

  it("appends history before clearing the current block, and never clears if the append fails", async () => {
    h.appendBlockHistory.mockRejectedValueOnce(new Error("disk full"));
    await expect(post()).rejects.toThrow("disk full");
    expect(store.writeCurrentBlock).not.toHaveBeenCalled();
  });

  it("calls appendBlockHistory before writeCurrentBlock on the success path", async () => {
    const order: string[] = [];
    (store.appendBlockHistory as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      order.push("append");
    });
    (store.writeCurrentBlock as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      order.push("clear");
    });
    await post();
    expect(order).toEqual(["append", "clear"]);
    expect(store.writeCurrentBlock).toHaveBeenCalledWith(null);
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

  it("writes the retro file with the slugified filename and next_block_seeds frontmatter", async () => {
    await post();
    expect(store.appendBlockHistory).toHaveBeenCalledTimes(1); // sanity: reached the end of the handler
    expect(h.writeRetrospective).toHaveBeenCalledTimes(1);
    const [filename, content] = h.writeRetrospective.mock.calls[0];
    // slugify(): lowercase, non [a-z0-9] runs -> '-', trim leading/trailing '-', cap at 40 chars.
    expect(filename).toBe("2026-06-15_build-ftp.md");
    expect(content).toContain("next_block_seeds:");
    expect(content).toContain('id: "2026-06-15_build-ftp"');
  });

  it("400s when Anthropic is not configured, without touching the data store", async () => {
    h.isAnthropicConfigured.mockReturnValue(false);
    const res = await post();
    expect(res.status).toBe(400);
    expect(store.readCurrentBlock).not.toHaveBeenCalled();
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

  it("archives and clears an unfinished block — no server-side guard exists (characterization)", async () => {
    // isBlockFinished (lib/date.ts) is a UI-only nudge on /today — this route never calls it. Push
    // endDate far into the future to make the block unambiguously unfinished relative to any realistic
    // "today", then assert the route runs to completion exactly as it would on a finished block.
    h.readCurrentBlock.mockResolvedValueOnce({ ...block, endDate: "2027-06-28" });

    const res = await post();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.fileId).toBe("2026-06-15_build-ftp");
    expect(store.appendBlockHistory).toHaveBeenCalledTimes(1);
    expect(store.writeCurrentBlock).toHaveBeenCalledWith(null);
  });
});
