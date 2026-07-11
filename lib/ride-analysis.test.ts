import { describe, expect, it } from "vitest";
import { buildTodayAnalysis, computeAdvisedIntake, computeRideMetrics } from "./ride-analysis";
import type { ActivitySummary, ExecutedInterval, TodayAnalysis } from "./types";

const activity = (over: Partial<ActivitySummary> = {}): ActivitySummary => ({
  id: "a1",
  date: "2026-06-22",
  type: "Ride",
  name: "Morning ride",
  movingTimeSec: 3600,
  avgWatts: 190,
  normalizedPower: 200,
  maxWatts: 600,
  icuFtp: null,
  powerHrZ2: null,
  powerHrZ2Mins: null,
  avgHr: 150,
  maxHr: 175,
  kj: 600,
  trainingLoad: 70,
  rpe: 5,
  carbsIngestedG: null,
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
    powerZoneTopsPct: null as number[] | null,
    aerobicEffPct: null as number | null,
    executed: [] as ExecutedInterval[],
    intervalComparison: null,
    trace: null,
    powerPRs: [],
    preserved: null,
    resolvedCal: {},
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

  it("applies the VI pacing read to an off-plan ride (infers a type so steady ≠ surgy)", () => {
    // Off-plan = no planned session; both rides infer the same type (IF 0.80 → Threshold), so only VI
    // differs. Without inferring a scoring type, off-plan rides got no VI and these would tie.
    const offPlan = (avgWatts: number) => ({
      ...base,
      plannedDay: null,
      activity: activity({ avgWatts, normalizedPower: 200, rpe: null }),
    });
    const steady = buildTodayAnalysis(offPlan(190)).executionScore!; // VI 1.05 → controlled (+1)
    const surgy = buildTodayAnalysis(offPlan(165)).executionScore!; // VI 1.21 → surgy (−1)
    expect(steady).toBeGreaterThan(surgy);
    // The OUTPUT plannedType stays null (nothing was planned) even though scoring inferred one.
    expect(buildTodayAnalysis(offPlan(190)).todayAnalysis.plannedType).toBeNull();
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

  it("attaches aerobicDiscipline for an easy ride from HR-zone time", () => {
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      plannedDay: { name: "Z2 endurance", type: "Z2", durationMin: 60 },
      hrZoneTimes: [600, 2700, 300], // ~8% above aerobic → dialed
    });
    expect(todayAnalysis.aerobicDiscipline).toBe("dialed");
  });

  it("aerobicDiscipline is null for an interval day (not an easy ride)", () => {
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      plannedDay: { name: "VO2max 5x3", type: "VO2max", durationMin: 60 },
      hrZoneTimes: [300, 600, 900, 1200],
    });
    expect(todayAnalysis.aerobicDiscipline).toBeNull();
  });

  it("aerobicDiscipline is null for an off-plan ride even when its inferred type is Z2", () => {
    // No planned session (intrinsic) + power data that infers to Z2 (IF 0.64) + HR data that would
    // otherwise read "hot". The score's own HR-judge axis is gated !intrinsic and never sees this ride,
    // so the debrief must not show a read the score didn't use.
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      plannedDay: null,
      activity: activity({ normalizedPower: 160, avgWatts: 150 }), // IF 0.64 → infers Z2
      hrZoneTimes: [300, 300, 2400], // 80% above aerobic → would be "hot" if scored
    });
    expect(todayAnalysis.aerobicDiscipline).toBeNull();
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
