import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirror app/api/generate/route.test.ts's data-store mock shape: empty vi.fn() stubs at module
// scope, resolved values wired up per-test/beforeEach via vi.mocked(store.x).mockResolvedValue(...).
vi.mock("@/lib/data-store", () => ({
  readAthleteProfile: vi.fn(),
  readLastSync: vi.fn(),
  readCurrentBlock: vi.fn(),
  readBlockHistory: vi.fn(),
  readScoreLog: vi.fn(),
  readIntentOverlays: vi.fn(),
  readSeasonPlan: vi.fn(),
}));

import * as store from "@/lib/data-store";
import { gatherFocusInputs, mapSystemToFocus } from "./season-signals";

const profile = {
  performance: { ftp: 250, weightKg: 75, maxHr: 190, thresholdHr: 170, weeklyHoursMin: 6, weeklyHoursMax: 10 },
  goals: [{ goal: "Raise FTP", target: "300W", focus: "threshold" }],
  weakpoints: [],
  nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 75 },
  goalsMigratedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.readAthleteProfile).mockResolvedValue(profile as never);
  vi.mocked(store.readLastSync).mockResolvedValue(null);
  vi.mocked(store.readCurrentBlock).mockResolvedValue(null);
  vi.mocked(store.readBlockHistory).mockResolvedValue([]);
  vi.mocked(store.readScoreLog).mockResolvedValue({ entries: [], updatedAt: "" });
  vi.mocked(store.readIntentOverlays).mockResolvedValue({ overlays: [], updatedAt: "" });
  vi.mocked(store.readSeasonPlan).mockResolvedValue({ objective: "get faster", events: [], periods: [], updatedAt: "" });
});

describe("mapSystemToFocus", () => {
  it("maps both neuromuscular and anaerobic power systems onto the anaerobic season focus", () => {
    expect(mapSystemToFocus("neuromuscular")).toBe("anaerobic");
    expect(mapSystemToFocus("anaerobic")).toBe("anaerobic");
    expect(mapSystemToFocus("vo2max")).toBe("vo2max");
    expect(mapSystemToFocus("threshold")).toBe("threshold");
  });
});

describe("gatherFocusInputs", () => {
  it("folds the season objective + profile goals into signals.goalText, same as combinedGoalText used to", async () => {
    const input = await gatherFocusInputs({ blockGoal: "Build for a fondo", weakpoints: ["climbing"] });
    expect(input.signals.goalText).toContain("get faster");
    expect(input.signals.goalText).toContain("Build for a fondo");
    expect(input.signals.goalText).toContain("climbing");
    expect(input.signals.goalText).toContain("Raise FTP");
  });

  it("defaults limiter to null/low when there's no synced power curve", async () => {
    const input = await gatherFocusInputs();
    expect(input.limiter).toEqual({ system: null, confidence: "low" });
  });

  it("defaults lastFocus to null when there's no current block", async () => {
    const input = await gatherFocusInputs();
    expect(input.lastFocus).toBeNull();
  });
});
