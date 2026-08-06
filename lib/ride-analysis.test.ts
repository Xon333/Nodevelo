import { describe, expect, it } from "vitest";
import { buildTodayAnalysis, computeAdvisedIntake, computeRideMetrics } from "./ride-analysis";
import type { NutritionModel } from "./nutrition";
import type { ActivitySummary, ExecutedInterval, TodayAnalysis } from "./types";

// Legacy model: baseCalories 2000, restDayTarget 2600 — matches the pre-existing 2900 = 2000 + 600 + 300
// expectation exactly (calculateDailyTarget's legacy path floors at restDayTarget, which 2900 clears).
const LEGACY_MODEL: NutritionModel = {
  kind: "legacy",
  baseCalories: 2000,
  restDayTarget: 2600,
  weightKg: 75,
  targetWeightKg: 78,
  buffer: 300,
};

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
  activeBurnKcal: null,
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
  hrrc: null,
  wPrimeRollingJ: null,
  wBalDepletionJ: null,
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
  it("sums base + resolved ride burn + weight-adjusted buffer", () => {
    const i = computeAdvisedIntake(600, LEGACY_MODEL, 300); // bufferApplied already resolved
    expect(i).toEqual({ advisedIntakeKcal: 2900, advisedBaseKcal: 2000, advisedBufferKcal: 300, advisedRideFuelKcal: 600 });
  });

  // C1: a null resolved burn must WITHHOLD the advised intake entirely, not fall back to zero fuel —
  // zero fuel is indistinguishable from a rest day and understates a real ride's need.
  it("withholds (returns null) rather than zeroing an unresolved burn", () => {
    expect(computeAdvisedIntake(null, LEGACY_MODEL, 300)).toBeNull();
  });

  // The live defect: exerciseBurn nets a per-hour resting rate off the source figure, so the burn
  // reaching this function is fractional. `maintenanceKcal - rideBurnKcal` was a rounded total minus an
  // unrounded part, which rendered as "2,202.512 base + 1,283.488 ride + 60 buffer" under a 3,550
  // headline — decimals the athlete has no use for, on a line that didn't add up to its own total.
  const DERIVED_MODEL: NutritionModel = {
    kind: "derived",
    rmr: 1627,
    neatMultiplier: 1.3537870346661005,
    restingKcalPerHour: 1627 / 24,
    weightKg: 61.6,
    targetWeightKg: 63,
    buffer: 60,
  };

  it("reports whole kcal for every part of the breakdown", () => {
    const i = computeAdvisedIntake(1283.488, DERIVED_MODEL, 60)!;
    for (const v of [i.advisedIntakeKcal, i.advisedBaseKcal, i.advisedBufferKcal, i.advisedRideFuelKcal]) {
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(i.advisedRideFuelKcal).toBe(1283);
  });

  // dailyTarget rounds to the nearest 10, so the ≤5 kcal residual has to land SOMEWHERE — on base, the
  // one estimated term. What must never happen is the three parts summing to something other than the
  // headline the card prints them under.
  it("keeps base + ride + buffer exactly equal to the advised total", () => {
    for (const burn of [1283.488, 0, 1.4, 999.5, 2007]) {
      const i = computeAdvisedIntake(burn, DERIVED_MODEL, 60)!;
      expect(i.advisedBaseKcal + i.advisedRideFuelKcal + i.advisedBufferKcal).toBe(i.advisedIntakeKcal);
    }
  });

  // The RMR safety floor raises dailyTarget above what the formula computed. The breakdown is a
  // breakdown OF THE PRESCRIBED NUMBER, so it has to keep summing there too.
  it("still sums when the RMR safety floor raised the target", () => {
    const i = computeAdvisedIntake(0, DERIVED_MODEL, -900)!;
    expect(i.advisedIntakeKcal).toBe(1627); // floored at RMR
    expect(i.advisedBaseKcal + i.advisedRideFuelKcal + i.advisedBufferKcal).toBe(1627);
  });
});

describe("buildTodayAnalysis (CR-G)", () => {
  const base = {
    today: "2026-06-22",
    activity: activity(),
    plannedDay: { name: "Threshold 3x12", type: "Threshold" as const, durationMin: 60 },
    ftp: 250,
    nutrition: { model: LEGACY_MODEL, bufferApplied: 300 },
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

  // C1 regression: the Today card must read activeBurnKcal, not fall through to kj. A ride synced
  // with a real active-burn figure and no kj must drive advisedIntakeKcal off that figure, not read
  // like a rest day (the live bug: kj null → 0 fuel → the card showed the REST-day number on a real
  // training day).
  it("drives advisedIntakeKcal off activeBurnKcal when kj is absent", () => {
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      activity: activity({ kj: null, activeBurnKcal: 2007 }),
    });
    expect(todayAnalysis.advisedRideFuelKcal).toBe(2007);
    // Legacy path rounds to the nearest 10: 2000 + 2007 + 300 = 4307 → 4310.
    expect(todayAnalysis.advisedIntakeKcal).toBe(4310);
  });

  // C1: when NEITHER activeBurnKcal nor kj resolves (both null), the advised intake must be withheld
  // (null), never silently zeroed to the rest-day figure.
  it("withholds advisedIntakeKcal (and its breakdown) when burn is unresolved", () => {
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      activity: activity({ kj: null, activeBurnKcal: null }),
    });
    expect(todayAnalysis.advisedIntakeKcal).toBeNull();
    expect(todayAnalysis.advisedBaseKcal).toBeNull();
    expect(todayAnalysis.advisedBufferKcal).toBeNull();
    expect(todayAnalysis.advisedRideFuelKcal).toBeNull();
  });

  it("rewards steady pacing on an off-plan ride but never penalises surgy pacing (VI is reward-only when intrinsic)", () => {
    // Off-plan = no planned session; both rides infer the same type (IF 0.80 → Threshold), so only VI
    // differs. Without inferring a scoring type, off-plan rides got no VI signal at all and these would tie.
    const offPlan = (avgWatts: number) => ({
      ...base,
      plannedDay: null,
      activity: activity({ avgWatts, normalizedPower: 200, rpe: null }),
    });
    // VI 1.0526 ≤ 1.08 → Threshold's steady bonus (+1). A bonus is never circular, so it applies to
    // off-plan rides exactly as it would to a planned one.
    expect(buildTodayAnalysis(offPlan(190)).executionScore).toBe(6);
    // VI 1.2121 ≥ 1.15 would penalise a PLANNED Threshold ride (-1), but this ride's type was INFERRED
    // from its own intensity — penalising it for missing that type's steadiness would be circular, so
    // the penalty is suppressed for intrinsic rides. Baseline, no VI effect either way.
    expect(buildTodayAnalysis(offPlan(165)).executionScore).toBe(5);
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

  it("aerobicDiscipline is null for a durability template B–E day even with a 'hot' HR read", () => {
    // Planned Z2 day built on template C (embeds efforts) + HR data that would read "hot". The scorer's
    // own HR judge is gated !embedsEfforts for these templates (efforts INSIDE the ride are the point,
    // not a discipline lapse), so the debrief must not show a read the score never applied.
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      plannedDay: { name: "Durability C", type: "Z2", durationMin: 60, durabilityTemplate: "C" },
      hrZoneTimes: [300, 300, 2400], // 80% above aerobic → would be "hot" if scored
    });
    expect(todayAnalysis.aerobicDiscipline).toBeNull();
  });

  it("attaches aerobicEffPct for a planned Z2 with non-null input", () => {
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      plannedDay: { name: "Z2 endurance", type: "Z2", durationMin: 60 },
      aerobicEffPct: 5.2,
    });
    expect(todayAnalysis.aerobicEffPct).toBe(5.2);
  });

  it("attaches aerobicEffPct for a planned Recovery with non-null input", () => {
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      plannedDay: { name: "Recovery", type: "Recovery", durationMin: 60 },
      aerobicEffPct: -8.1,
    });
    expect(todayAnalysis.aerobicEffPct).toBe(-8.1);
  });

  it("aerobicEffPct is null for an interval day", () => {
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      plannedDay: { name: "VO2max 5x3", type: "VO2max", durationMin: 60 },
      aerobicEffPct: 5.2,
    });
    expect(todayAnalysis.aerobicEffPct).toBeNull();
  });

  it("aerobicEffPct is null for an off-plan ride even when input is non-null", () => {
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      plannedDay: null,
      aerobicEffPct: 5.2,
    });
    expect(todayAnalysis.aerobicEffPct).toBeNull();
  });

  it("aerobicEffPct is null for a durability template B–E day even when input is non-null", () => {
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      plannedDay: { name: "Durability C", type: "Z2", durationMin: 60, durabilityTemplate: "C" },
      aerobicEffPct: 5.2,
    });
    expect(todayAnalysis.aerobicEffPct).toBeNull();
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

  it("omits drift entirely for a structurally mixed ride (VI 1.205)", () => {
    // 118 min, avg 200 / NP 241 -> VI 1.205 > AEROBIC_MAX_VI (1.12): not aerobically comparable, even
    // though IF (241/288 = 0.837) sits inside the 0.56-0.85 band. This is the 2026-08-06 screenshot ride.
    const mixed = activity({ movingTimeSec: 118 * 60, avgWatts: 200, normalizedPower: 241, decoupling: 15.7 });
    const { todayAnalysis } = buildTodayAnalysis({ ...base, activity: mixed, plannedDay: null, ftp: 288 });
    expect(todayAnalysis.activityDecoupling).toBeNull();
  });

  it("keeps drift for a genuinely steady ride", () => {
    // 100 min, avg 200 / NP 206 -> VI 1.03 (comparable), IF 206/288 = 0.715 (in band).
    const steady = activity({ movingTimeSec: 100 * 60, avgWatts: 200, normalizedPower: 206, decoupling: 3.8 });
    const { todayAnalysis } = buildTodayAnalysis({ ...base, activity: steady, plannedDay: null, ftp: 288 });
    expect(todayAnalysis.activityDecoupling).toBe(3.8);
  });
});

// The Today debrief header renders this under a "kcal" label. It used to render `activityKj` —
// mechanical work in kJ — which is a different unit and, on a real activity, a different number
// (this athlete's 2026-08-06 ride: kj 1421, activeBurnKcal 1417).
describe("buildTodayAnalysis — gross burn in kcal", () => {
  const base = {
    today: "2026-06-22",
    activity: activity(),
    plannedDay: null,
    ftp: 250,
    nutrition: { model: LEGACY_MODEL, bufferApplied: 300 },
    powerZoneTimes: null,
    hrZoneTimes: null,
    powerZoneTopsPct: null,
    aerobicEffPct: null,
    executed: [] as ExecutedInterval[],
    intervalComparison: null,
    trace: null,
    powerPRs: [],
    preserved: null,
    resolvedCal: {},
  };

  it("reports activeBurnKcal, and keeps activityKj on its own kJ basis", () => {
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      activity: activity({ kj: 1421, activeBurnKcal: 1417 }),
    });
    expect(todayAnalysis.activityBurnKcal).toBe(1417);
    expect(todayAnalysis.activityKj).toBe(1421);
  });

  // activeBurn's legacy branch — a pre-activeBurnKcal activity carries only kj, treated as kcal.
  it("falls back to kj for a legacy activity", () => {
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      activity: activity({ kj: 600, activeBurnKcal: null }),
    });
    expect(todayAnalysis.activityBurnKcal).toBe(600);
  });

  it("withholds rather than zeroing when neither figure resolves", () => {
    const { todayAnalysis } = buildTodayAnalysis({
      ...base,
      activity: activity({ kj: null, activeBurnKcal: null }),
    });
    expect(todayAnalysis.activityBurnKcal).toBeNull();
  });
});
