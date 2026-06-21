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
          { date: "2026-06-15", name: "Threshold 3x12", type: "Threshold", durationMin: 75, workout: "Main Set 3x\n- 12m 95%", description: "x" },
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
    isAnthropicConfigured: () => true,
    generateTrainingBlock: vi.fn(async () => ({ toolInput: h.toolInput, raw: "", truncated: false })),
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
  readBlockSettings: vi.fn(),
  readCurrentBlock: vi.fn(),
  readInterventionLog: vi.fn(),
  readLastSync: vi.fn(),
  readRollingBaselines: vi.fn(),
  readScoreLog: vi.fn(),
}));

import * as store from "@/lib/data-store";
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
  vi.mocked(store.readBlockSettings).mockResolvedValue(DEFAULT_BLOCK_SETTINGS);
  vi.mocked(store.readCurrentBlock).mockResolvedValue(null);
  vi.mocked(store.readInterventionLog).mockResolvedValue({ records: [], updatedAt: "" });
  vi.mocked(store.readLastSync).mockResolvedValue(sync as never);
  vi.mocked(store.readRollingBaselines).mockResolvedValue({} as never);
  vi.mocked(store.readScoreLog).mockResolvedValue({ entries: [], updatedAt: "" });
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
