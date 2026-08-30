import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_BLOCK_SETTINGS, type GenerationVerdict } from "@/lib/types";

vi.mock("@/lib/block-compiler", async (original) => {
  const actual = await original<typeof import("@/lib/block-compiler")>();
  return { ...actual, compileTrainingBlock: vi.fn(actual.compileTrainingBlock) };
});
vi.mock("@/lib/physiology", () => ({
  readPhysiologyWithStatus: vi.fn(async () => ({
    store: {
      current: {
        effectiveFrom: "2026-06-01", capturedAt: "2026-06-01T00:00:00.000Z", source: "intervals",
        ftp: 280, lthr: 165, maxHr: 185, powerZonePct: [55, 75, 90, 105, 120, 150],
        hrZones: [130, 150, 165, 180], hrZonesAreBpm: true, powerZoneNames: [], hrZoneNames: [],
      },
      history: [],
    },
    corruptFallback: false, fileExisted: true, liveCorrupt: false,
  })),
  resolveHrZones: vi.fn(() => [
    { name: "Z1", lo: 0, hi: 130 },
    { name: "Z2", lo: 131, hi: 150 },
  ]),
}));
vi.mock("@/lib/physiology-freshness", async (original) => {
  const actual = await original<typeof import("@/lib/physiology-freshness")>();
  return {
    ...actual,
    readPhysiologyStatus: vi.fn(async () => ({
      status: { lastAttemptAt: "2026-06-15T00:00:00.000Z", lastOutcome: "confirmed", lastConfirmedAt: "2026-06-15T00:00:00.000Z" },
      corruptFallback: false, liveCorrupt: false,
    })),
    assessPhysiologyFreshnessFromReads: vi.fn(() => ({
      state: "fresh", confirmedAt: "2026-06-15T00:00:00.000Z", effectiveFrom: "2026-06-01",
    })),
  };
});
vi.mock("@/lib/data-store", () => ({
  readAthleteProfile: vi.fn(), readBlockHistory: vi.fn(), readBlockSettings: vi.fn(),
  readCurrentBlock: vi.fn(), readIntentOverlays: vi.fn(), readLastSync: vi.fn(),
  readRollingBaselines: vi.fn(), readScoreLog: vi.fn(), readSeasonPlan: vi.fn(),
  replaceGenerationVerdict: vi.fn(), saveGenerationVerdict: vi.fn(), updateSeasonPlan: vi.fn(),
}));

import { POST } from "@/app/api/generate/route";
import * as compiler from "@/lib/block-compiler";
import * as store from "@/lib/data-store";
import * as fresh from "@/lib/physiology-freshness";
import * as physiology from "@/lib/physiology";
import { verdictHash } from "@/lib/publication-gate";

const profile = {
  performance: { ftp: 280, weightKg: 72, maxHr: 185, thresholdHr: 165, weeklyHoursMin: 8, weeklyHoursMax: 12 },
  nutrition: { baseCalories: 2200, restDayTarget: 2000, buffer: 300, targetWeightKg: 70 },
  goals: [], weakpoints: [],
};
const sync = { syncedAt: "", activities: [], wellness: [], powerCurve: [], fitness: { ctl: 50, atl: 60, tsb: -10 } };
const emptySeason = { objective: "", events: [], periods: [], updatedAt: "v1" };
let persistedVerdict: GenerationVerdict | null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.readAthleteProfile).mockResolvedValue(profile as never);
  vi.mocked(store.readBlockHistory).mockResolvedValue([]);
  vi.mocked(store.readBlockSettings).mockResolvedValue(DEFAULT_BLOCK_SETTINGS);
  vi.mocked(store.readCurrentBlock).mockResolvedValue(null);
  vi.mocked(store.readIntentOverlays).mockResolvedValue({ overlays: [], updatedAt: "" });
  vi.mocked(store.readLastSync).mockResolvedValue(sync as never);
  vi.mocked(store.readRollingBaselines).mockResolvedValue({} as never);
  vi.mocked(store.readScoreLog).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.readSeasonPlan).mockResolvedValue(emptySeason);
  persistedVerdict = null;
  vi.mocked(store.saveGenerationVerdict).mockImplementation(async (record) => { persistedVerdict = record; });
  vi.mocked(store.replaceGenerationVerdict).mockImplementation(async (claimHash, record) => {
    if (persistedVerdict?.verdictHash !== claimHash) return "lost";
    persistedVerdict = record;
    return "saved";
  });
  vi.mocked(store.updateSeasonPlan).mockImplementation(async (mutate) => mutate(emptySeason));
});

const gen = (goal = "Improve threshold power") => POST(new Request("http://t/api/generate", {
  method: "POST",
  body: JSON.stringify({ lengthWeeks: 2, goal, startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
}));

describe("POST /api/generate — deterministic preview", () => {
  it("has no block-generation Anthropic or tool-schema dependency", async () => {
    const source = await readFile(join(process.cwd(), "app/api/generate/route.ts"), "utf8");
    expect(source).not.toMatch(/generateTrainingBlock|PlanToolSchema|buildSystemPrompt|buildUserMessage|dedupeGeneration|isAnthropicConfigured/);
  });

  it("generates without Anthropic configuration and omits AI provenance", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await gen();
    const { plan } = await res.json();
    expect(res.status).toBe(200);
    expect(plan.days).toHaveLength(14);
    expect(plan.model).toBeUndefined();
    expect(plan.promptVersion).toBeUndefined();
  });

  it("uses the real compiler output and fills every skeleton day", async () => {
    const { plan } = await (await gen()).json();
    expect(compiler.compileTrainingBlock).toHaveBeenCalledTimes(1);
    expect(plan.days.every((day: { workoutText: string; type: string }) => day.type === "Rest" || day.workoutText.length > 0)).toBe(true);
    expect(plan.raw).toContain('"durabilityTemplateId"');
  });

  it("persists the compiler verdict and keeps generation preview-only", async () => {
    const { plan } = await (await gen()).json();
    expect(store.saveGenerationVerdict).toHaveBeenCalledTimes(1);
    const claim = vi.mocked(store.saveGenerationVerdict).mock.calls[0][0];
    expect(claim.verdictHash).toMatch(/^pending:/);
    expect(store.replaceGenerationVerdict).toHaveBeenCalledTimes(1);
    const [claimHash, record] = vi.mocked(store.replaceGenerationVerdict).mock.calls[0];
    expect(claimHash).toBe(claim.verdictHash);
    expect(record.verdictHash).toBe(verdictHash(plan.days, plan.blockParams));
    expect(record.model).toBeUndefined();
    expect(record.promptVersion).toBeUndefined();
  });

  it("builds type-dependent nutrition at each exact slot duration", async () => {
    await gen();
    const input = vi.mocked(compiler.compileTrainingBlock).mock.calls[0][0];
    const slot = input.skeleton.weeks[0].days.find((day) => day.duration.nominalMin === 83)
      ?? input.skeleton.weeks[0].days.find((day) => day.duration.nominalMin > 0)!;
    expect(input.nutritionByDateAndType[slot.date]?.Z2).toBeDefined();
    expect(input.nutritionByDateAndType[slot.date]?.Threshold).toBeDefined();
  });

  it("selects RaceSim deterministically for a terrain/race requirement", async () => {
    const { plan } = await (await gen("Win the hilly KOM road race")).json();
    expect(plan.days.some((day: { type: string }) => day.type === "RaceSim")).toBe(true);
  });
});

describe("POST /api/generate — guards and degradation", () => {
  it("returns 400 for invalid JSON and invalid block parameters", async () => {
    const badJson = await POST(new Request("http://t/api/generate", { method: "POST", body: "bad" }));
    expect(badJson.status).toBe(400);
    const badLength = await POST(new Request("http://t/api/generate", { method: "POST", body: JSON.stringify({ lengthWeeks: 3 }) }));
    expect((await badLength.json()).error).toMatch(/lengthWeeks/);
  });

  it("returns 400 before composition for infeasible settings", async () => {
    vi.mocked(store.readBlockSettings).mockResolvedValue({
      ...DEFAULT_BLOCK_SETTINGS, qualitySessionsPerLoadingWeek: 5, restDaysPerWeek: 2,
    });
    const res = await gen();
    expect(res.status).toBe(400);
    expect(compiler.compileTrainingBlock).not.toHaveBeenCalled();
  });

  it.each([
    { state: "missing" },
    { state: "malformed", reason: "bad" },
    { state: "inconsistent", reason: "bad" },
    { state: "obsolete", markedObsoleteAt: "2026-08-20T00:00:00.000Z" },
  ])("returns 400 for unusable physiology: $state", async (state) => {
    vi.mocked(fresh.assessPhysiologyFreshnessFromReads).mockReturnValueOnce(state as never);
    const res = await gen();
    expect(res.status).toBe(400);
    expect(compiler.compileTrainingBlock).not.toHaveBeenCalled();
  });

  it("keeps temporary physiology and backup degradation visible", async () => {
    vi.mocked(fresh.assessPhysiologyFreshnessFromReads).mockReturnValueOnce({
      state: "sync-failed", lastAttemptAt: "2026-06-15T00:00:00.000Z", lastDetail: "timeout",
      lastConfirmedAt: "2026-06-13T00:00:00.000Z", lastConfirmedDate: "2026-06-13",
    } as never);
    const read = await physiology.readPhysiologyWithStatus();
    vi.mocked(physiology.readPhysiologyWithStatus).mockResolvedValueOnce({ ...read, liveCorrupt: true });
    const { plan } = await (await gen()).json();
    expect(plan.warnings).toContainEqual(expect.stringMatching(/last confirmed 2026-06-13/i));
    expect(plan.warnings).toContainEqual(expect.stringMatching(/backup/i));
  });

  it("keeps recovery placement and a visible warning when season replanning degrades", async () => {
    vi.mocked(store.readSeasonPlan).mockResolvedValue({
      objective: "",
      events: [],
      periods: [{
        focus: "threshold", phase: "build", startDate: "not-a-date", plannedWeeks: 3,
        intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "x",
        source: "derived", confidence: "medium",
      }],
      updatedAt: "v1",
    } as never);
    const res = await POST(new Request("http://t/api/generate", {
      method: "POST",
      body: JSON.stringify({ lengthWeeks: 4, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
    }));
    const { plan } = await res.json();
    const input = vi.mocked(compiler.compileTrainingBlock).mock.calls[0][0];
    expect(res.status).toBe(200);
    expect(input.weekTargets.some((week) => week.isRecovery)).toBe(true);
    expect(plan.warnings).toContainEqual(expect.stringMatching(/^SEASON:/));
  });

  it("returns a preview with a fail-closed pending passport when final storage fails while owned", async () => {
    vi.mocked(store.replaceGenerationVerdict).mockResolvedValueOnce("write-failed");
    const res = await gen();
    const plan = (await res.json()).plan;
    expect(res.status).toBe(200);
    expect(plan).toBeDefined();
    expect(persistedVerdict?.verdictHash).toMatch(/^pending:/);
    expect(persistedVerdict?.verdictHash).not.toBe(verdictHash(plan.days, plan.blockParams));
  });

  it("does not issue a preview when the old passport cannot be invalidated", async () => {
    vi.mocked(store.saveGenerationVerdict).mockRejectedValueOnce(new Error("disk full"));
    const res = await gen();
    expect(res.status).toBe(502);
    expect(compiler.compileTrainingBlock).not.toHaveBeenCalled();
  });

  it("does not let failed generation A erase or borrow concurrent generation B's passport", async () => {
    let releaseA!: () => void;
    let claimAStarted!: () => void;
    const aStarted = new Promise<void>((resolve) => { claimAStarted = resolve; });
    const holdA = new Promise<void>((resolve) => { releaseA = resolve; });
    vi.mocked(store.saveGenerationVerdict)
      .mockImplementationOnce(async (record) => {
        persistedVerdict = record;
        claimAStarted();
        await holdA;
      })
      .mockImplementation(async (record) => { persistedVerdict = record; });

    const generationA = gen();
    await aStarted;
    const responseB = await gen();
    const planB = (await responseB.json()).plan;
    const passportB = persistedVerdict;
    releaseA();
    const responseA = await generationA;

    expect(responseB.status).toBe(200);
    expect(responseA.status).toBe(502);
    expect(persistedVerdict).toEqual(passportB);
    expect(passportB?.verdictHash).toBe(verdictHash(planB.days, planB.blockParams));
  });

  it("maps compiler failures to 502 and does not persist season state", async () => {
    vi.mocked(compiler.compileTrainingBlock).mockImplementationOnce(() => { throw new Error("compile failed"); });
    const res = await gen();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("compile failed");
    expect(store.updateSeasonPlan).not.toHaveBeenCalled();
  });

  it("CAS-guards delayed season persistence and degrades persistence failure", async () => {
    let expectedVersion: string | undefined;
    vi.mocked(store.updateSeasonPlan).mockImplementationOnce(async (mutate, expected) => {
      expectedVersion = expected;
      return mutate(emptySeason);
    });
    expect((await gen()).status).toBe(200);
    expect(expectedVersion).toBe("v1");

    vi.mocked(store.updateSeasonPlan).mockRejectedValueOnce(new Error("disk full"));
    expect((await gen()).status).toBe(200);
  });
});
