import { describe, expect, it } from "vitest";
import { buildRideScores, mergeScoreLog, summariseBehaviour } from "./score-log";
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
    efficiencyFactor: 1.3,
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
  const ftp200 = () => 200;

  it("scores planned days that have a matching ride and stamps the FTP used", () => {
    const b = block([{ date: "2026-01-01", type: "Z2", durationMin: 60 }]);
    const acts = [activity({ date: "2026-01-01", avgWatts: 135, normalizedPower: 138 })]; // IF ~0.69 @ ftp200
    const scores = buildRideScores(b, acts, ftp200, "2026-01-10");
    expect(scores).toHaveLength(1);
    expect(scores[0].plannedType).toBe("Z2");
    expect(scores[0].ftpUsed).toBe(200);
    expect(scores[0].executionScore).toBeGreaterThanOrEqual(1);
    expect(scores[0].executionScore).toBeLessThanOrEqual(10);
  });

  it("resolves FTP per ride date (as-of), not a single current FTP", () => {
    const b = block([
      { date: "2026-01-01", type: "Z2", durationMin: 60 },
      { date: "2026-02-01", type: "Z2", durationMin: 60 },
    ]);
    const acts = [
      activity({ date: "2026-01-01", avgWatts: 135, normalizedPower: 138 }),
      activity({ date: "2026-02-01", avgWatts: 135, normalizedPower: 138 }),
    ];
    const ftpForDate = (date: string) => (date < "2026-01-15" ? 200 : 300);
    const scores = buildRideScores(b, acts, ftpForDate, "2026-03-01");
    expect(scores.find((s) => s.date === "2026-01-01")?.ftpUsed).toBe(200);
    expect(scores.find((s) => s.date === "2026-02-01")?.ftpUsed).toBe(300);
  });

  it("skips rest days, future days, and days without a ride", () => {
    const b = block([
      { date: "2026-01-01", type: "Rest", durationMin: 0 },
      { date: "2026-01-02", type: "Z2", durationMin: 60 }, // no matching activity
      { date: "2026-01-20", type: "Z2", durationMin: 60 }, // future vs the "today" below
    ]);
    const acts = [activity({ date: "2026-01-20", avgWatts: 140 })];
    const scores = buildRideScores(b, acts, ftp200, "2026-01-10");
    expect(scores).toHaveLength(0);
  });
});

describe("mergeScoreLog", () => {
  const mk = (date: string, score: number): RideScoreEntry => ({
    date,
    executionScore: score,
    plannedType: "Z2",
    inferredType: "Z2",
    planned: true,
    legacy: false,
    compliancePct: 100,
    intensityFactor: 0.68,
    ftpUsed: 288,
    durationMin: 60,
    tss: 60,
  });

  it("is immutable: existing entries are frozen and fresh only fills new dates", () => {
    const existing = [mk("2026-01-01", 5), mk("2026-01-03", 6)];
    const fresh = [mk("2026-01-03", 9), mk("2026-01-02", 7)];
    const merged = mergeScoreLog(existing, fresh);
    expect(merged.map((e) => e.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    // 2026-01-03 already existed → kept at 6, not overwritten by the fresh 9.
    expect(merged.find((e) => e.date === "2026-01-03")?.executionScore).toBe(6);
    // 2026-01-02 is new → added.
    expect(merged.find((e) => e.date === "2026-01-02")?.executionScore).toBe(7);
  });

  it("caps the log length", () => {
    const many = Array.from({ length: 300 }, (_, i) => mk(`2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, 5));
    const merged = mergeScoreLog(many, []);
    expect(merged.length).toBeLessThanOrEqual(400);
  });
});

const ftp200 = () => 200;

describe("buildRideScores — all rides (planned + off-plan)", () => {
  it("scores off-plan rides (on/after the floor) intrinsically and tags them not-legacy", () => {
    const b = block([{ date: "2026-01-01", type: "Z2", durationMin: 60 }]);
    const acts = [
      activity({ date: "2026-01-01", avgWatts: 135, normalizedPower: 138 }), // matches the plan
      activity({ date: "2026-01-03", avgWatts: 150, normalizedPower: 155, decoupling: 2 }), // off-plan
    ];
    const scores = buildRideScores(b, acts, ftp200, "2026-01-10", "2026-01-01");
    const planned = scores.find((s) => s.date === "2026-01-01");
    const offplan = scores.find((s) => s.date === "2026-01-03");
    expect(planned?.planned).toBe(true);
    expect(offplan?.planned).toBe(false);
    expect(offplan?.legacy).toBe(false);
    expect(offplan?.plannedType).toBeNull();
    expect(offplan?.inferredType).toBeTruthy();
    expect(offplan?.compliancePct).toBeNull();
  });

  it("keeps off-plan rides before the floor as history but flags them legacy", () => {
    const acts = [
      activity({ date: "2025-11-20", avgWatts: 140 }), // pre-app legacy, before the first block
      activity({ date: "2026-01-05", avgWatts: 140 }), // off-plan during structured training
    ];
    const scores = buildRideScores(null, acts, ftp200, "2026-01-10", "2026-01-01");
    expect(scores.map((s) => s.date)).toEqual(["2025-11-20", "2026-01-05"]); // both stored
    expect(scores.find((s) => s.date === "2025-11-20")?.legacy).toBe(true);
    expect(scores.find((s) => s.date === "2026-01-05")?.legacy).toBe(false);
  });

  it("flags every off-plan ride legacy when no block has ever existed (floor null)", () => {
    const acts = [activity({ date: "2026-01-02", avgWatts: 140 })];
    const scores = buildRideScores(null, acts, ftp200, "2026-01-10", null);
    expect(scores).toHaveLength(1);
    expect(scores[0].legacy).toBe(true);
  });

  it("keeps the longer ride when two land on one date", () => {
    const acts = [
      activity({ date: "2026-01-02", movingTimeSec: 1800 }),
      activity({ date: "2026-01-02", movingTimeSec: 5400 }),
    ];
    const scores = buildRideScores(null, acts, ftp200, "2026-01-10", "2026-01-01");
    expect(scores).toHaveLength(1);
    expect(scores[0].durationMin).toBe(90);
  });
});

describe("summariseBehaviour", () => {
  const entry = (over: Partial<RideScoreEntry> & { date: string }): RideScoreEntry => ({
    executionScore: 7,
    plannedType: "Z2",
    inferredType: "Z2",
    planned: true,
    legacy: false,
    compliancePct: 100,
    intensityFactor: 0.68,
    ftpUsed: 200,
    durationMin: 60,
    tss: 60,
    ...over,
  });

  it("computes off-plan frequency and unplanned quality", () => {
    const b = summariseBehaviour([
      entry({ date: "2026-01-01" }),
      entry({ date: "2026-01-03", planned: false, plannedType: null, executionScore: 6 }),
    ]);
    expect(b.totalRides).toBe(2);
    expect(b.plannedRides).toBe(1);
    expect(b.unplannedRides).toBe(1);
    expect(b.offPlanPct).toBe(50);
    expect(b.unplannedAvgQuality).toBe(6);
  });
});
