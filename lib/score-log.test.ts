import { describe, expect, it } from "vitest";
import { buildRideScores, mergeScoreLog } from "./score-log";
import type { ActivitySummary, CurrentBlock, RideScoreEntry, WorkoutType } from "./types";

function activity(over: Partial<ActivitySummary> & { date: string }): ActivitySummary {
  return {
    id: over.date,
    type: "Ride",
    name: "Ride",
    movingTimeSec: 3600,
    avgWatts: 180,
    normalizedPower: 185,
    maxWatts: 400,
    avgHr: 140,
    maxHr: 165,
    kj: 600,
    trainingLoad: 60,
    rpe: 5,
    decoupling: 3,
    description: null,
    avgCadence: 88,
    distanceMeters: 30000,
    elevationGain: 300,
    powerZoneTimes: null,
    hrZoneTimes: null,
    ...over,
  };
}

function block(days: Array<{ date: string; type: WorkoutType; durationMin: number }>): CurrentBlock {
  return {
    goal: "Test",
    lengthWeeks: 2,
    startDate: days[0]?.date ?? "2026-01-01",
    endDate: days[days.length - 1]?.date ?? "2026-01-14",
    overview: "",
    createdAt: new Date().toISOString(),
    days: days.map((d) => ({ date: d.date, name: `${d.type} day`, type: d.type, durationMin: d.durationMin })),
  };
}

describe("buildRideScores", () => {
  it("scores planned days that have a matching ride", () => {
    const b = block([{ date: "2026-01-01", type: "Z2", durationMin: 60 }]);
    const acts = [activity({ date: "2026-01-01", avgWatts: 135, normalizedPower: 138 })]; // IF ~0.69 @ ftp200
    const scores = buildRideScores(b, acts, 200, "2026-01-10");
    expect(scores).toHaveLength(1);
    expect(scores[0].plannedType).toBe("Z2");
    expect(scores[0].executionScore).toBeGreaterThanOrEqual(1);
    expect(scores[0].executionScore).toBeLessThanOrEqual(10);
  });

  it("skips rest days, future days, and days without a ride", () => {
    const b = block([
      { date: "2026-01-01", type: "Rest", durationMin: 0 },
      { date: "2026-01-02", type: "Z2", durationMin: 60 }, // no matching activity
      { date: "2026-01-20", type: "Z2", durationMin: 60 }, // future vs the "today" below
    ]);
    const acts = [activity({ date: "2026-01-20", avgWatts: 140 })];
    const scores = buildRideScores(b, acts, 200, "2026-01-10");
    expect(scores).toHaveLength(0);
  });
});

describe("mergeScoreLog", () => {
  const mk = (date: string, score: number): RideScoreEntry => ({
    date,
    executionScore: score,
    plannedType: "Z2",
    compliancePct: 100,
    intensityFactor: 0.68,
  });

  it("dedupes by date with fresh overriding and keeps sorted order", () => {
    const existing = [mk("2026-01-01", 5), mk("2026-01-03", 6)];
    const fresh = [mk("2026-01-03", 9), mk("2026-01-02", 7)];
    const merged = mergeScoreLog(existing, fresh);
    expect(merged.map((e) => e.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(merged.find((e) => e.date === "2026-01-03")?.executionScore).toBe(9);
  });

  it("caps the log length", () => {
    const many = Array.from({ length: 300 }, (_, i) => mk(`2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, 5));
    const merged = mergeScoreLog(many, []);
    expect(merged.length).toBeLessThanOrEqual(250);
  });
});
