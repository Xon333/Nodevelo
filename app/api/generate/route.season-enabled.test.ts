import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BLOCK_SETTINGS } from "@/lib/types";

vi.mock("@/lib/season", async (original) => ({
  ...await original<typeof import("@/lib/season")>(),
  SEASON_SHAPES_GENERATION: true,
}));
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
  resolveHrZones: vi.fn(() => []),
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

const profile = {
  performance: { ftp: 280, weightKg: 72, maxHr: 185, thresholdHr: 165, weeklyHoursMin: 8, weeklyHoursMax: 12 },
  nutrition: { baseCalories: 2200, restDayTarget: 2000, buffer: 300, targetWeightKg: 70 },
  goals: [], weakpoints: [],
};
const sync = { syncedAt: "", activities: [], wellness: [], powerCurve: [], fitness: { ctl: 50, atl: 60, tsb: -10 } };
const eventSeason = {
  objective: "",
  events: [{ name: "Late Season Race", date: "2026-10-01", priority: "A" }],
  periods: [
    { focus: "aerobic-base", phase: "base", startDate: "2026-06-08", plannedWeeks: 2, intensitySplit: "90/10", targetWeeklyTss: null, deloadWeek: false, rationale: "Base.", source: "derived", confidence: "medium" },
    { focus: "threshold", phase: "build", startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "Build.", source: "override", confidence: "medium" },
  ],
  updatedAt: "v1",
};

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
  vi.mocked(store.readSeasonPlan).mockResolvedValue(eventSeason as never);
  vi.mocked(store.saveGenerationVerdict).mockResolvedValue(undefined);
  vi.mocked(store.replaceGenerationVerdict).mockResolvedValue("saved");
  vi.mocked(store.updateSeasonPlan).mockImplementation(async (mutate) => mutate(eventSeason as never));
});

const gen = () => POST(new Request("http://t/api/generate", {
  method: "POST",
  body: JSON.stringify({ lengthWeeks: 2, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
}));

describe("POST /api/generate — season shaping enabled", () => {
  it("passes event-anchored season context and the period phase to the compiler", async () => {
    const res = await gen();
    expect(res.status).toBe(200);
    const input = vi.mocked(compiler.compileTrainingBlock).mock.calls[0][0];
    expect(input.publication.seasonContext?.mode).toBe("event-anchored");
    expect(input.phase).toBe("base");
  });

  it.each([
    { state: "missing" },
    { state: "malformed", reason: "bad" },
    { state: "inconsistent", reason: "bad" },
    { state: "obsolete", markedObsoleteAt: "2026-08-20T00:00:00.000Z" },
  ])("returns 400 for unusable physiology: $state", async (state) => {
    vi.mocked(fresh.assessPhysiologyFreshnessFromReads).mockReturnValueOnce(state as never);
    expect((await gen()).status).toBe(400);
    expect(compiler.compileTrainingBlock).not.toHaveBeenCalled();
  });

  it("keeps a temporary physiology sync failure visible", async () => {
    vi.mocked(fresh.assessPhysiologyFreshnessFromReads).mockReturnValueOnce({
      state: "sync-failed", lastAttemptAt: "2026-06-15T00:00:00.000Z", lastDetail: "timeout",
      lastConfirmedAt: "2026-06-13T00:00:00.000Z", lastConfirmedDate: "2026-06-13",
    } as never);
    const { plan } = await (await gen()).json();
    expect(plan.warnings).toContainEqual(expect.stringMatching(/last confirmed 2026-06-13/i));
  });

  it("uses rolling focus when no A-event is upcoming", async () => {
    vi.mocked(store.readSeasonPlan).mockResolvedValue({ objective: "", events: [], periods: [], updatedAt: "v1" } as never);
    await gen();
    const input = vi.mocked(compiler.compileTrainingBlock).mock.calls[0][0];
    expect(input.publication.seasonContext).toEqual({ mode: "rolling", focus: input.focus });
    expect(input.focusRationale).toBeTruthy();
  });
});
