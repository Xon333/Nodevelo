import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BLOCK_SETTINGS } from "@/lib/types";

// HR-26 (2026-07-17 hostile review): the SEASON_SHAPES_GENERATION=false route-wiring tests in
// route.test.ts replaced the pre-existing flag-on assertions rather than keeping both — the
// flag-on branch in app/api/generate/route.ts became completely untested. ROADMAP.md documents the
// flag as the planned re-enable point; without this file, npm run check would stay green through a
// regression in that branch until it's exercised live. A SEPARATE file (not a shared describe block
// in route.test.ts) is required: vi.mock is hoisted and file-scoped, so overriding
// SEASON_SHAPES_GENERATION here would otherwise also flip it for route.test.ts's own flag-off
// assertions in the same file.

vi.mock("@/lib/season", async (orig) => {
  const actual = await orig<typeof import("@/lib/season")>();
  return { ...actual, SEASON_SHAPES_GENERATION: true };
});

const h = vi.hoisted(() => ({
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
    critiqueOverview: vi.fn(async () => null), // P3c: explicitly mocked, see route.test.ts's own note
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
  readIntentOverlays: vi.fn(),
  readSeasonPlan: vi.fn(),
  updateSeasonPlan: vi.fn(),
}));

import * as store from "@/lib/data-store";
import * as anthropic from "@/lib/anthropic-api";
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
  vi.mocked(store.readIntentOverlays).mockResolvedValue({ overlays: [], updatedAt: "" });
  vi.mocked(store.readSeasonPlan).mockResolvedValue({ objective: "", events: [], periods: [], updatedAt: "" });
  vi.mocked(store.updateSeasonPlan).mockImplementation(async (mutate) =>
    mutate({ objective: "", events: [], periods: [], updatedAt: "" })
  );
});

// Same fixture route.test.ts's "season wiring" describe block uses, so this file's assertions are
// the direct positive counterpart of that file's flag-off ones.
describe("POST /api/generate — season wiring with SEASON_SHAPES_GENERATION=true (HR-26)", () => {
  // CFS-4 (settleSeasonHistory replacing replanSeasonArc): rolling mode now drops every future period,
  // including overrides, so this fixture needs an upcoming A-event to route through replanEventArc
  // instead — the event-anchored path unchanged behavior that still preserves current + override
  // periods verbatim, same as replanSeasonArc always did for this exact bucket shape. The event date
  // is far enough out that its own derived tail (anchored off the override's end, 2026-07-13) can't
  // overlap this 2-week block's own range (2026-06-15 → 06-29).
  const seasonPlan = {
    objective: "",
    events: [{ name: "Late Season Race", date: "2026-10-01", priority: "A" }],
    periods: [
      { focus: "aerobic-base", phase: "base", startDate: "2026-06-08", plannedWeeks: 2, intensitySplit: "90/10", targetWeeklyTss: null, deloadWeek: false, rationale: "Base.", source: "derived", confidence: "medium" },
      { focus: "threshold", phase: "build", startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "Build.", source: "override", confidence: "medium" },
    ],
    updatedAt: "",
  };
  const genWithSeason = () =>
    POST(new Request("http://t/api/generate", { method: "POST", body: JSON.stringify({ lengthWeeks: 2, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }) }));

  it("injects the multi-period season-phase context into the prompt", async () => {
    vi.mocked(store.readSeasonPlan).mockResolvedValue(seasonPlan as never);
    await genWithSeason();
    const dynamic = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][1];
    expect(dynamic).toContain("spans 2 season periods");
    expect(dynamic).toContain("focus aerobic-base");
    expect(dynamic).toContain("focus threshold");
  });

  it("pushes a Season fit warning when a generated day's intensity disagrees with its period", async () => {
    vi.mocked(store.readSeasonPlan).mockResolvedValue(seasonPlan as never);
    const json = await (await genWithSeason()).json();
    // Both mocked days (06-15 Threshold 36m + 06-16 Z2 90m) land in the base portion: 36/126 ≈ 28.6%
    // of riding time is hard — same fixture and expectation route.test.ts's pre-Task-6 test used.
    const fit = json.plan.warnings.filter((w: string) => /^Season fit/.test(w));
    expect(fit.length).toBe(1);
    expect(fit[0]).toContain("2026-06-15");
    expect(fit[0]).toContain("riding time");
  });

  // Hostile-review finding (CFS-7 task-7 review): every test above has an upcoming A-event, so
  // aEventForBlock is always truthy and only the (unchanged) replanEventArc/formatSeasonContext
  // branch ever ran under this file's SEASON_SHAPES_GENERATION=true mock. formatFocusContext,
  // formatRecoveryWeeks and validateBlockFocus — all new in this task — had never been exercised
  // with the flag on. This is the rolling-mode (no upcoming A-event) counterpart.
  it("injects BLOCK FOCUS + RECOVERY context for a rolling-mode block (no upcoming A-event)", async () => {
    vi.mocked(store.readSeasonPlan).mockResolvedValue({ objective: "", events: [], periods: [], updatedAt: "" } as never);
    // Force realWeeksSinceLastRecovery to return 3 (lib/season.ts): with a 350 weekly baseline
    // (avgTss90d 50 * 7) the 50%-of-baseline "light week" cutoff is 175. The real calendar weeks
    // ending 06-15, 06-08 and 06-01 (relative to today 2026-06-15) each carry 300 TSS — loading,
    // not light — while the week ending 05-25 has zero logged TSS, so the backward walk stops
    // there and returns 3 (same pattern lib/season.test.ts's own "counts real calendar weeks back"
    // case uses). planRecoveryWeeks(3, lengthWeeks=2, tight=false): 3+1=4 hits the 4-week hard cap
    // on the block's own week index 0, so recovery is forced onto this block's first week.
    vi.mocked(store.readRollingBaselines).mockResolvedValue({ avgTss90d: 50 } as never);
    vi.mocked(store.readScoreLog).mockResolvedValue({
      entries: [
        { date: "2026-06-12", tss: 300, executionScore: 80, plannedType: null, inferredType: "Z2", planned: false, legacy: false, compliancePct: null, intensityFactor: null, ftpUsed: 280, durationMin: 180 },
        { date: "2026-06-05", tss: 300, executionScore: 80, plannedType: null, inferredType: "Z2", planned: false, legacy: false, compliancePct: null, intensityFactor: null, ftpUsed: 280, durationMin: 180 },
        { date: "2026-05-29", tss: 300, executionScore: 80, plannedType: null, inferredType: "Z2", planned: false, legacy: false, compliancePct: null, intensityFactor: null, ftpUsed: 280, durationMin: 180 },
      ],
      updatedAt: "",
    } as never);
    const json = await (await genWithSeason()).json();
    const dynamic = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][1];
    expect(dynamic).toContain("BLOCK FOCUS:"); // formatFocusContext reached the prompt
    expect(dynamic).toContain("RECOVERY:"); // formatRecoveryWeeks reached the prompt
    expect(json.plan.seasonFocus).toBeDefined();
    expect(typeof json.plan.seasonFocusRationale).toBe("string");
    expect(json.plan.seasonFocusRationale.length).toBeGreaterThan(0);
  });
});
