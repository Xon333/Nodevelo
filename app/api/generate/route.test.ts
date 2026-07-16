import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BLOCK_SETTINGS } from "@/lib/types";

// Integration test for /api/generate (CR-8): proves the Track B wiring is actually hooked up — a
// terrain/race goal's RaceSim requirement is enforced into the plan's warnings, and the chosen
// durability template is stamped on the plan. The LLM + data/KB/physiology IO are mocked; the
// requirement derivation, durability selection, validators and stamping run for real.

const h = vi.hoisted(() => ({
  // A schema-valid tool payload with NO RaceSim — so validateSessionRequirements must warn.
  toolInput: {
    overview: "Test build block.",
    weeks: [
      {
        weekNumber: 1,
        theme: "Build",
        days: [
          { date: "2026-06-15", name: "Threshold 3x12", type: "Threshold", durationMin: 36, workout: "Main Set 3x\n- 12m 95%", description: "x" },
          { date: "2026-06-16", name: "Endurance", type: "Z2", durationMin: 90, workout: "- 90m 65%", description: "x" },
        ],
      },
    ],
  },
}));

vi.mock("@/lib/anthropic-api", async (orig) => {
  const actual = await orig<typeof import("@/lib/anthropic-api")>();
  return {
    ...actual,
    isAnthropicConfigured: vi.fn(() => true),
    generateTrainingBlock: vi.fn(async () => ({ toolInput: h.toolInput, raw: "", truncated: false, stopReason: null })),
  };
});
vi.mock("@/lib/generate-cache", () => ({
  generationKey: () => "k",
  dedupeGeneration: async (_k: string, fn: () => Promise<unknown>) => ({ result: await fn() }),
}));
vi.mock("@/lib/kb-loader", () => ({
  loadKnowledgeBaseContext: vi.fn(async () => "KB"),
  latestRetrospectiveSeeds: vi.fn(async () => []),
}));
vi.mock("@/lib/physiology", () => ({
  readPhysiology: vi.fn(async () => null),
  resolvePowerZones: vi.fn(() => []),
  resolveHrZones: vi.fn(() => []),
}));
vi.mock("@/lib/data-store", () => ({
  readAthleteProfile: vi.fn(),
  readBlockHistory: vi.fn(),
  readBlockSettings: vi.fn(),
  readCurrentBlock: vi.fn(),
  readInterventionLog: vi.fn(),
  readLastSync: vi.fn(),
  readQuirks: vi.fn(),
  readRollingBaselines: vi.fn(),
  readScoreLog: vi.fn(),
  readSeasonPlan: vi.fn(),
  writeSeasonPlan: vi.fn(),
}));

import * as store from "@/lib/data-store";
import * as anthropic from "@/lib/anthropic-api";
import { GENERATION_MODEL, PROMPT_VERSION } from "@/lib/anthropic-api";
import { POST } from "@/app/api/generate/route";

const profile = {
  performance: { ftp: 280, weightKg: 72, maxHr: 185, thresholdHr: 165, weeklyHoursMin: 8, weeklyHoursMax: 12 },
  nutrition: { baseCalories: 2200, restDayTarget: 2000, buffer: 300, targetWeightKg: 70 },
  goals: [],
  weakpoints: [],
};
const sync = { syncedAt: "", activities: [], wellness: [], powerCurve: [], fitness: { ctl: 50, atl: 60, tsb: -10 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.readAthleteProfile).mockResolvedValue(profile as never);
  vi.mocked(store.readBlockHistory).mockResolvedValue([]);
  vi.mocked(store.readBlockSettings).mockResolvedValue(DEFAULT_BLOCK_SETTINGS);
  vi.mocked(store.readCurrentBlock).mockResolvedValue(null);
  vi.mocked(store.readInterventionLog).mockResolvedValue({ records: [], updatedAt: "" });
  vi.mocked(store.readLastSync).mockResolvedValue(sync as never);
  vi.mocked(store.readQuirks).mockResolvedValue({ entries: [], extractedAt: "", engine: "" });
  vi.mocked(store.readRollingBaselines).mockResolvedValue({} as never);
  vi.mocked(store.readScoreLog).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.readSeasonPlan).mockResolvedValue({ objective: "", events: [], periods: [], updatedAt: "" });
  vi.mocked(store.writeSeasonPlan).mockResolvedValue(undefined);
});

const gen = (goal: string) =>
  POST(new Request("http://t/api/generate", { method: "POST", body: JSON.stringify({ lengthWeeks: 2, goal, startDate: "2026-06-15", weakpoints: [] }) }));

describe("POST /api/generate — Track B wiring", () => {
  it("enforces the RaceSim requirement for a terrain/race goal and stamps the durability template", async () => {
    const json = await (await gen("Win the hilly KOM road race")).json();
    expect(json.plan.warnings.some((w: string) => /RaceSim/.test(w))).toBe(true); // validateSessionRequirements wired in
    expect(json.plan.durabilityTemplate).toBe("A"); // selected (no insights, no prior block) + stamped
  });

  it("does not require a RaceSim for a flat, non-terrain goal", async () => {
    const json = await (await gen("Improve 40k TT power on the flats")).json();
    expect(json.plan.warnings.some((w: string) => /RaceSim/.test(w))).toBe(false);
  });
});

describe("POST /api/generate — season wiring (multi-period blocks)", () => {
  // Base 2026-06-08 → 06-22 (straddles today → preserved verbatim by replanSeasonArc), then an
  // athlete-owned build override 06-22 → 07-13 (preserved verbatim too). A 2-week block starting
  // 06-15 crosses the base→build boundary on 06-22.
  const seasonPlan = {
    objective: "",
    events: [],
    periods: [
      { focus: "aerobic-base", phase: "base", startDate: "2026-06-08", plannedWeeks: 2, intensitySplit: "90/10", targetWeeklyTss: null, deloadWeek: false, rationale: "Base.", source: "derived", confidence: "medium" },
      { focus: "threshold", phase: "build", startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "Build.", source: "override", confidence: "medium" },
    ],
    updatedAt: "",
  };
  const genWithSeason = () =>
    POST(new Request("http://t/api/generate", { method: "POST", body: JSON.stringify({ lengthWeeks: 2, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }) }));

  it("injects the multi-period season context when the block spans two periods", async () => {
    vi.mocked(store.readSeasonPlan).mockResolvedValue(seasonPlan as never);
    await genWithSeason();
    const dynamic = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][1];
    expect(dynamic).toContain("spans 2 season periods");
    expect(dynamic).toContain("focus aerobic-base");
    expect(dynamic).toContain("focus threshold");
  });

  it("validates each generated day against its own period, duration-weighted", async () => {
    vi.mocked(store.readSeasonPlan).mockResolvedValue(seasonPlan as never);
    const json = await (await genWithSeason()).json();
    // Both mocked days (06-15 Threshold 75m + 06-16 Z2 90m) land in the base portion: 75/165 ≈ 45%
    // of riding time is hard → exactly one warning, scoped to those dates, phrased by time not count.
    const fit = json.plan.warnings.filter((w: string) => /^Season fit/.test(w));
    expect(fit.length).toBe(1);
    expect(fit[0]).toContain("2026-06-15");
    expect(fit[0]).toContain("riding time");
  });
});

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

describe("POST /api/generate — generation outcomes", () => {
  it("502 when the model returns no structured payload", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: null, raw: "prose", truncated: false, stopReason: null } as never);
    const res = await gen("Build FTP");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/did not return a structured plan/);
  });

  it("reports a precise retryable error when a 6-week response hits the token limit", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: null, raw: "", truncated: true, stopReason: "max_tokens" } as never);
    const res = await POST(new Request("http://t/api/generate", { method: "POST", body: JSON.stringify({ lengthWeeks: 6, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [] }) }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("The generated 6-week plan exceeded the response limit. Please retry; the app will request a larger response.");
  });

  it("502 when the payload fails schema validation", async () => {
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: { bogus: true }, raw: "", truncated: false, stopReason: null } as never);
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
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: h.toolInput, raw: "", truncated: true, stopReason: "max_tokens" } as never);
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

describe("POST /api/generate — protocol-violation severity (measurability)", () => {
  it("carries quality-session protocol breaches as plan.protocolViolations, not generic warnings", async () => {
    const badSit = {
      overview: "o",
      weeks: [{
        weekNumber: 1,
        theme: "t",
        days: [{ date: "2026-06-15", name: "SIT 5x1min", type: "SIT", durationMin: 25, workout: "Main Set 5x\n- 1m 150%\n- 4m 40%", description: "x" }],
      }],
    };
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: badSit, raw: "", truncated: false, stopReason: null } as never);
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.protocolViolations).toHaveLength(1);
    expect(json.plan.protocolViolations[0]).toMatch(/longer than protocol/);
    expect(json.plan.warnings.some((w: string) => /longer than protocol/.test(w))).toBe(false); // not double-reported
  });

  it("omits protocolViolations entirely on a clean plan (sparse-field convention)", async () => {
    const json = await (await gen("Build FTP")).json(); // default mocked toolInput is protocol-clean
    expect(json.plan.protocolViolations).toBeUndefined();
  });
});
