import { describe, expect, it } from "vitest";
import { buildTodayAnalysis, computeAdvisedIntake, computeRideMetrics } from "./ride-analysis";
import type { ActivitySummary, TodayAnalysis } from "./types";

const activity = (over: Partial<ActivitySummary> = {}): ActivitySummary => ({
  id: "a1",
  date: "2026-06-22",
  type: "Ride",
  name: "Morning ride",
  movingTimeSec: 3600,
  avgWatts: 190,
  normalizedPower: 200,
  maxWatts: 600,
  avgHr: 150,
  maxHr: 175,
  kj: 600,
  trainingLoad: 70,
  rpe: 5,
  decoupling: 4,
  efficiencyFactor: null,
  description: "felt good",
  avgCadence: 90,
  distanceMeters: 30000,
  elevationGain: 300,
  powerZoneTimes: null,
  hrZoneTimes: null,
  ...over,
});

describe("computeRideMetrics", () => {
  it("computes actual minutes, compliance, IF (NP/FTP) and VI (NP/avg)", () => {
    const m = computeRideMetrics(activity(), 60, 250);
    expect(m.actualMin).toBe(60);
    expect(m.compliancePct).toBe(100);
    expect(m.intensityFactor).toBe(0.8); // 200 / 250
    expect(m.variabilityIndex).toBe(1.05); // 200 / 190
  });

  it("falls back to avg watts for IF when NP is absent", () => {
    const m = computeRideMetrics(activity({ normalizedPower: null, avgWatts: 200 }), 60, 250);
    expect(m.intensityFactor).toBe(0.8);
    expect(m.variabilityIndex).toBeNull(); // needs NP
  });

  it("returns null compliance with no planned duration", () => {
    expect(computeRideMetrics(activity(), null, 250).compliancePct).toBeNull();
    expect(computeRideMetrics(activity(), 0, 250).compliancePct).toBeNull();
  });
});

describe("computeAdvisedIntake", () => {
  it("sums base + ride kJ + weight-adjusted buffer", () => {
    const i = computeAdvisedIntake(600, 2000, 300, 0); // stable weight → buffer unchanged
    expect(i).toEqual({ advisedIntakeKcal: 2900, advisedBaseKcal: 2000, advisedBufferKcal: 300, advisedRideFuelKcal: 600 });
  });

  it("treats a null ride kJ as zero fuel", () => {
    expect(computeAdvisedIntake(null, 2000, 300, 0).advisedRideFuelKcal).toBe(0);
  });
});

describe("buildTodayAnalysis (CR-G)", () => {
  const base = {
    today: "2026-06-22",
    activity: activity(),
    plannedDay: { name: "Threshold 3x12", type: "Threshold" as const, durationMin: 60 },
    ftp: 250,
    nutrition: { baseCalories: 2000, buffer: 300 },
    weightTrend7Day: 0,
    powerZoneTimes: [10, 20] as number[] | null,
    hrZoneTimes: null,
    intervalComparison: null,
    trace: null,
    powerPRs: [],
    preserved: null,
    resolvedCal: { decouplingGood: 4 },
  };

  it("assembles a coherent analysis with a numeric execution score and capped compliance", () => {
    const { todayAnalysis, executionScore, resolvedCompliancePct } = buildTodayAnalysis(base);
    expect(todayAnalysis.activityDate).toBe("2026-06-22");
    expect(todayAnalysis.intensityFactor).toBe(0.8);
    expect(todayAnalysis.advisedIntakeKcal).toBe(2900);
    expect(todayAnalysis.powerZoneTimes).toEqual([10, 20]);
    expect(typeof executionScore).toBe("number");
    expect(todayAnalysis.compliancePct).toBe(resolvedCompliancePct);
    // Compliance is capped by execution, so it can never exceed 100.
    expect(resolvedCompliancePct! <= 100).toBe(true);
  });

  it("preserves an existing coach note + provenance for the same day", () => {
    const preserved = { activityDate: "2026-06-22", coachNote: "keep me", model: "m", promptVersion: 3 } as unknown as TodayAnalysis;
    const { todayAnalysis } = buildTodayAnalysis({ ...base, preserved });
    expect(todayAnalysis.coachNote).toBe("keep me");
    expect(todayAnalysis.model).toBe("m");
    expect(todayAnalysis.promptVersion).toBe(3);
  });

  it("does not carry a note from a different day", () => {
    const preserved = { activityDate: "2026-06-21", coachNote: "stale" } as unknown as TodayAnalysis;
    const { todayAnalysis } = buildTodayAnalysis({ ...base, preserved });
    expect(todayAnalysis.coachNote).toBe("");
    expect(todayAnalysis.model).toBeUndefined();
  });

  it("drops interval adherence from scoring on a structural mismatch", () => {
    const mismatch = buildTodayAnalysis({
      ...base,
      intervalComparison: { prescribedLabels: [], reps: [], completed: 3, total: 3, avgAdherencePct: 99, avgDurationPct: 50, effectiveAdherencePct: 49, structuralMismatch: true } as never,
    });
    const clean = buildTodayAnalysis({
      ...base,
      intervalComparison: { prescribedLabels: [], reps: [], completed: 3, total: 3, avgAdherencePct: 99, avgDurationPct: 50, effectiveAdherencePct: 49, structuralMismatch: false } as never,
    });
    // The mismatch path ignores the (low) effectiveAdherencePct, so it should not score worse than clean.
    expect(mismatch.executionScore! >= clean.executionScore!).toBe(true);
  });
});
