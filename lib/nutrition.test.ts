import { describe, expect, it } from "vitest";
import {
  activeBurn,
  type BurnActivity,
  exerciseBurn,
  adjustBuffer,
  balanceLevel,
  buildNutritionReferenceRows,
  BUFFER_MAX_KCAL,
  BUFFER_MIN_KCAL,
  calculateDailyTarget,
  calibrateNeat,
  calibrateNeatByDayType,
  CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS,
  computeEnergyAvailability,
  computeNutritionTrendWarning,
  computeUnderfuelStreak,
  desiredWeightTrend,
  eaLevel,
  estimateWorkoutBurnKcal,
  goalSurplusKcalPerDay,
  inRideCarbTarget,
  isRestDayFor,
  loggedDaysForStreak,
  NEAT_PLAUSIBLE_MAX,
  NEAT_PLAUSIBLE_MIN,
  preRideCarbTarget,
  resolveBuffer,
  resolveNutritionModel,
  restingMetabolicRate,
  DEFAULT_NEAT_MULTIPLIER,
  DAY_TYPE_MIN_LOGGED_DAYS,
  smoothedCurrentWeightKg,
  STREAK_ALERT_THRESHOLD,
  STREAK_MAX_LOOKBACK_DAYS,
  STREAK_MIN_LOGGED_DAYS,
  STREAK_WINDOW_LOGGED_DAYS,
  TREND_WARNING_ADHERENCE_MAX,
  TREND_WARNING_ADHERENCE_MIN,
  TREND_WARNING_ERROR_KG_PER_WEEK,
  TREND_WARNING_MIN_LOGGED_DAYS,
  TREND_WARNING_MIN_WEIGH_INS,
  TREND_WARNING_WINDOW_DAYS,
  UNDERFUEL_RATIO_BELOW,
  weightTrendFromWellness,
  weightTrendPreciseFromWellness,
  type NutritionModel,
} from "./nutrition";
import type { AthleteProfile, DayTypeNeat, NeatCalibration, WellnessEntry, WorkoutType } from "./types";


describe("desiredWeightTrend", () => {
  it("is zero inside the deadband, so rounding never nudges forever", () => {
    expect(desiredWeightTrend(75, 75)).toBe(0);
    expect(desiredWeightTrend(75, 75.5)).toBe(0);
  });

  it("is positive and rate-capped when under target", () => {
    expect(desiredWeightTrend(70, 78)).toBe(0.35);
  });

  it("is negative and rate-capped when over target", () => {
    expect(desiredWeightTrend(80, 72)).toBe(-0.5);
  });

  it("treats a gap sitting exactly on the deadband as inside it", () => {
    expect(desiredWeightTrend(75, 75.7)).toBe(0);
    expect(desiredWeightTrend(75, 74.3)).toBe(0);
  });
});

describe("desiredWeightTrend with an athlete-set rate", () => {
  it("uses the configured rate instead of the derived cap", () => {
    expect(desiredWeightTrend(62, 63, 0.15)).toBe(0.15);
  });

  it("still zeroes inside the deadband regardless of the configured rate", () => {
    expect(desiredWeightTrend(62.5, 63, 0.15)).toBe(0);
  });

  it("clamps a configured rate to the protective caps", () => {
    expect(desiredWeightTrend(62, 70, 2.0)).toBe(0.35);
    expect(desiredWeightTrend(80, 70, -2.0)).toBe(-0.5);
  });

  it("ignores a configured rate pointing the wrong way and derives instead", () => {
    // Athlete is BELOW target but the stored rate says lose — direction comes from the gap, always.
    expect(desiredWeightTrend(62, 63, -0.3)).toBeGreaterThan(0);
  });

  it("falls back to the derived rate when none is configured", () => {
    expect(desiredWeightTrend(62, 63, null)).toBe(desiredWeightTrend(62, 63));
  });
});

describe("adjustBuffer", () => {
  const AT_TARGET = { current: 75, target: 75 };
  const UNDER_TARGET = { current: 70, target: 78 };

  it("leaves the buffer alone when the trend matches intent", () => {
    const r = adjustBuffer(300, 0, 0, AT_TARGET.current, AT_TARGET.target);
    expect(r.delta).toBe(0);
    expect(r.bufferApplied).toBe(300);
  });

  it("adds food promptly when losing faster than intended", () => {
    // err = -0.5 kg/7d → -550 kcal/day imbalance → +275 damped → clamped to the +250 step cap
    const r = adjustBuffer(300, -0.5, -0.5, AT_TARGET.current, AT_TARGET.target);
    expect(r.delta).toBe(250);
    expect(r.bufferApplied).toBe(550);
  });

  it("uses the responsive short trend on the loss side", () => {
    // Short says losing, long has not caught up — feed anyway; the protective direction acts first.
    const r = adjustBuffer(300, -0.4, 0, AT_TARGET.current, AT_TARGET.target);
    expect(r.delta).toBeGreaterThan(0);
  });

  it("does NOT cut on a glycogen-rebound spike when the long trend cannot confirm", () => {
    // The D3 regression: +1.5 kg/7d right after refuelling is glycogen + bound water, not fat.
    const r = adjustBuffer(300, 1.5, null, UNDER_TARGET.current, UNDER_TARGET.target);
    expect(r.delta).toBe(0);
    expect(r.bufferApplied).toBe(300);
    expect(r.reason).toMatch(/not confirmed/i);
  });

  it("barely cuts a confirmed gain while the athlete is still under target", () => {
    // Long trend +0.375 vs a desired +0.35 → the error is ~0.025, so the cut is negligible by
    // arithmetic rather than by a special case.
    const r = adjustBuffer(300, 1.5, 0.375, UNDER_TARGET.current, UNDER_TARGET.target);
    expect(r.delta).toBeGreaterThan(-30);
    expect(r.delta).toBeLessThanOrEqual(0);
  });

  it("cuts on a confirmed gain when the athlete is at target, damped harder than it feeds", () => {
    const gain = adjustBuffer(300, 0.5, 0.5, AT_TARGET.current, AT_TARGET.target);
    const loss = adjustBuffer(300, -0.5, -0.5, AT_TARGET.current, AT_TARGET.target);
    expect(gain.delta).toBeLessThan(0);
    expect(Math.abs(gain.delta)).toBeLessThan(Math.abs(loss.delta)); // asymmetry: quicker to feed
  });

  it("allows a negative buffer so a deficit is representable at all", () => {
    const r = adjustBuffer(-200, 0.6, 0.6, 80, 72);
    expect(r.bufferApplied).toBeLessThan(0);
    expect(r.bufferApplied).toBeGreaterThanOrEqual(-500);
  });

  it("reports when a rail is hit instead of swallowing it", () => {
    const r = adjustBuffer(580, -1.0, -1.0, AT_TARGET.current, AT_TARGET.target);
    expect(r.bufferApplied).toBe(600);
    expect(r.capped).toBe(true);
    expect(r.reason).toMatch(/capped/i);
  });

  it("withholds correction entirely when there is no trend to act on", () => {
    const r = adjustBuffer(300, null, null, AT_TARGET.current, AT_TARGET.target);
    expect(r.delta).toBe(0);
    expect(r.reason).toMatch(/not enough weigh-ins/i);
  });

  it("does not apply a full cut once the recent trend shows the athlete has stabilised", () => {
    // Long window still carries an earlier fast gain (+1.3), but the athlete is now gaining at +0.4
    // against a desired +0.35 — essentially on plan. Sizing the cut off the stale long trend would
    // punish exactly the recovery trajectory this mechanism exists to protect.
    const r = adjustBuffer(300, 0.4, 1.3, 70, 78);
    expect(r.delta).toBeGreaterThan(-30);
    expect(r.delta).toBeLessThanOrEqual(0);
  });

  it("still applies a real cut when BOTH windows confirm a sustained overshoot", () => {
    const r = adjustBuffer(300, 1.5, 1.5, 70, 78);
    expect(r.delta).toBeLessThan(-100);
  });
});

// I1: the ±MAX_ADJUSTMENT_STEP_KCAL clamp was invisible — an athlete losing 2 kg/week and one losing
// 0.3 kg/week both landed on the identical +250 with identical wording. stepClipped surfaces that this
// correction hit the per-adjustment size limit, distinct from `capped` (the outer BUFFER_MIN/MAX rails).
describe("adjustBuffer — stepClipped", () => {
  const AT_TARGET = { current: 75, target: 75 };

  it("flags stepClipped when the raw correction exceeds the per-adjustment step limit", () => {
    // err = -0.5 kg/7d → raw = +275 kcal/day, which exceeds the ±250 step limit.
    const r = adjustBuffer(300, -0.5, -0.5, AT_TARGET.current, AT_TARGET.target);
    expect(r.delta).toBe(250);
    expect(r.stepClipped).toBe(true);
    expect(r.reason).toMatch(/clip/i);
    expect(r.reason).toMatch(/model/i);
  });

  it("does NOT flag stepClipped when the raw correction is within the step limit", () => {
    // err = -0.4 kg/7d → raw = +220 kcal/day, inside the ±250 step limit.
    const r = adjustBuffer(300, -0.4, 0, AT_TARGET.current, AT_TARGET.target);
    expect(r.delta).toBe(220);
    expect(r.stepClipped).toBe(false);
  });

  it("does not flag stepClipped when there is no trend to act on (delta 0)", () => {
    const r = adjustBuffer(300, null, null, AT_TARGET.current, AT_TARGET.target);
    expect(r.stepClipped).toBe(false);
  });

  it("keeps stepClipped and capped as independent facts — a step-clipped correction need not hit a rail", () => {
    const r = adjustBuffer(300, -0.5, -0.5, AT_TARGET.current, AT_TARGET.target);
    expect(r.stepClipped).toBe(true);
    expect(r.capped).toBe(false); // 550 is well inside [-500, 600]
  });
});

describe("goalSurplusKcalPerDay", () => {
  it("converts a weekly rate to a daily energy figure", () => {
    expect(goalSurplusKcalPerDay(0.35)).toBe(390);   // 0.35 × 7700 ÷ 7 = 385, rounded to 10
    expect(goalSurplusKcalPerDay(-0.5)).toBe(-550);
    expect(goalSurplusKcalPerDay(0)).toBe(0);
  });
});

describe("resolveBuffer", () => {
  const derived = (confidence: "low" | "medium" | "high"): NeatCalibration =>
    ({ multiplier: 1.2584, confidence, source: "derived", windowDays: 42, loggedDays: 39,
       weighIns: 21, solvedAt: "2026-07-31", imbalance: null, stale: false });
  const popDefault: NeatCalibration =
    ({ multiplier: 1.2, confidence: "low", source: "default", windowDays: null, loggedDays: null,
       weighIns: null, solvedAt: null, imbalance: null, stale: false });

  it("uses the goal rate directly when calibration is trustworthy", () => {
    const r = resolveBuffer(derived("high"), 62, 63, null, 0, 0, 150);
    expect(r.mode).toBe("goal-rate");
    expect(r.bufferApplied).toBe(goalSurplusKcalPerDay(0.35));
    expect(r.servoDeltaKcal).toBe(0);
    expect(r.stepClipped).toBe(false);
  });

  it("IGNORES the legacy configured buffer in goal-rate mode", () => {
    const a = resolveBuffer(derived("high"), 62, 63, null, 0, 0, 150);
    const b = resolveBuffer(derived("high"), 62, 63, null, 0, 0, -400);
    expect(a.bufferApplied).toBe(b.bufferApplied); // the retired setting has no effect
  });

  // THE SIGN DEFECT (D-B). A cutting athlete must never be handed a surplus.
  it("never returns a surplus for an athlete below their target weight", () => {
    for (const legacy of [-400, 0, 150, 600]) {
      const r = resolveBuffer(derived("high"), 66, 63, null, -0.5, -0.5, legacy);
      expect(r.bufferApplied).toBeLessThan(0);
    }
  });

  it("never returns a deficit for an athlete above their target weight", () => {
    for (const legacy of [-400, 0, 150, 600]) {
      const r = resolveBuffer(derived("high"), 62, 63, null, 0.2, 0.2, legacy);
      expect(r.bufferApplied).toBeGreaterThan(0);
    }
  });

  it("is zero inside the deadband, so an athlete at target eats maintenance", () => {
    expect(resolveBuffer(derived("high"), 62.9, 63, null, 0, 0, 150).bufferApplied).toBe(0);
  });

  it("honours an athlete-set rate over the derived one", () => {
    const r = resolveBuffer(derived("high"), 62, 63, 0.15, 0, 0, 150);
    expect(r.bufferApplied).toBe(goalSurplusKcalPerDay(0.15));
  });

  it("falls back to the trend servo when calibration is not trustworthy", () => {
    for (const neat of [popDefault, derived("low")]) {
      const r = resolveBuffer(neat, 62, 63, null, -0.5, -0.5, 150);
      expect(r.mode).toBe("trend-servo");
      expect(r.servoDeltaKcal).not.toBe(0);
    }
  });

  it("clamps to the existing rails and reports it", () => {
    const r = resolveBuffer(derived("high"), 50, 63, null, 0, 0, 150); // huge gap
    expect(r.bufferApplied).toBeLessThanOrEqual(BUFFER_MAX_KCAL);
    expect(r.bufferApplied).toBeGreaterThanOrEqual(BUFFER_MIN_KCAL);
  });
});

const DERIVED: NutritionModel = {
  kind: "derived",
  restingKcalPerHour: 0,
  rmr: 1800,
  neatMultiplier: 1.2,
  weightKg: 75,
  targetWeightKg: 78,
  buffer: 300,
};
const LEGACY: NutritionModel = {
  kind: "legacy",
  baseCalories: 2000,
  restDayTarget: 2600,
  weightKg: 75,
  targetWeightKg: 78,
  buffer: 300,
};

describe("calculateDailyTarget (derived)", () => {
  it("is maintenance plus buffer on a rest day, with no rest-day branch", () => {
    const p = calculateDailyTarget(0, DERIVED, 300, true);
    expect(p.maintenanceKcal).toBe(2160); // 1.2 × 1800
    expect(p.dailyTarget).toBe(2460);
  });

  it("adds the synced active burn verbatim on a training day", () => {
    const p = calculateDailyTarget(843, DERIVED, 300, false);
    expect(p.dailyTarget).toBe(3300); // 2160 + 843 + 300, rounded to 10
  });

  it("carries a negative buffer through as a real deficit without breaching the RMR floor", () => {
    // With DERIVED (rmr: 1800), maintenance is 2160. A -400 buffer would give 1760, which is below
    // the RMR floor, so it gets floored to 1800 (rmr).
    const p = calculateDailyTarget(0, DERIVED, -400, true);
    expect(p.dailyTarget).toBe(1800); // floored to RMR
    expect(p.floored).toBe(true);
  });

  it("fills session carb targets only when a workout is supplied", () => {
    const bare = calculateDailyTarget(900, DERIVED, 300, false);
    expect(bare.preRideCarbs).toBe(0);
    const withWorkout = calculateDailyTarget(900, DERIVED, 300, false, { type: "Z2", durationMin: 150 });
    expect(withWorkout.preRideCarbs).toBeGreaterThan(0);
    expect(withWorkout.inRideCarbsPerHour).toBeGreaterThan(0);
  });

  it("never prescribes below resting metabolic rate", () => {
    const m: NutritionModel = { kind: "derived", rmr: 1631, neatMultiplier: 1.2,
    restingKcalPerHour: 0,
      weightKg: 62, targetWeightKg: 63, buffer: -500 };
    const p = calculateDailyTarget(0, m, -500, true);
    expect(p.dailyTarget).toBeGreaterThanOrEqual(1631);
    expect(p.floored).toBe(true);
  });

  it("does not floor a normal day", () => {
    const m: NutritionModel = { kind: "derived", rmr: 1631, neatMultiplier: 1.3,
    restingKcalPerHour: 0,
      weightKg: 62, targetWeightKg: 63, buffer: 300 };
    expect(calculateDailyTarget(800, m, 300, false).floored).toBe(false);
  });
});

// The D1 regression. Every one of these cases prescribed LESS than a rest day before this change.
describe("no training day may fall below the same athlete's rest day", () => {
  const CASES: Array<{ type: WorkoutType; durationMin: number }> = [
    { type: "Strength", durationMin: 45 },
    { type: "Strength", durationMin: 60 },
    { type: "Recovery", durationMin: 45 },
    { type: "Recovery", durationMin: 60 },
    { type: "Z2", durationMin: 60 },
    { type: "Threshold", durationMin: 60 },
    { type: "VO2max", durationMin: 75 },
  ];

  for (const model of [DERIVED, LEGACY]) {
    describe(model.kind, () => {
      const rest = calculateDailyTarget(0, model, 300, true).dailyTarget;
      for (const c of CASES) {
        it(`${c.type} ${c.durationMin}min >= rest day`, () => {
          const burn = estimateWorkoutBurnKcal(c.type, c.durationMin, 250);
          const training = calculateDailyTarget(burn, model, 300, false, c).dailyTarget;
          expect(training).toBeGreaterThanOrEqual(rest);
        });
      }
    });
  }
});

describe("computeNutritionTrendWarning", () => {
  const TODAY = "2026-08-03";
  const WINDOW_START = "2026-07-13";
  const TREND_MODEL: NutritionModel = { ...DERIVED, targetWeightKg: 80 };
  const activityBurnByIndex = new Map([[2, 500], [10, 800]]);

  const dateAt = (index: number) =>
    new Date(Date.parse(WINDOW_START) + index * 86_400_000).toISOString().slice(0, 10);

  const buildInput = (options: {
    slopeKgPerWeek?: number;
    intakeScale?: number;
    loggedIndices?: number[];
    unresolvedBurnIndices?: number[];
  } = {}) => {
    const {
      slopeKgPerWeek = 0.3,
      intakeScale = 1,
      loggedIndices = Array.from({ length: 21 }, (_, i) => i),
      unresolvedBurnIndices = [],
    } = options;
    const logged = new Set(loggedIndices);
    const unresolved = new Set(unresolvedBurnIndices);
    const wellness = Array.from({ length: 21 }, (_, index) => {
      const date = dateAt(index);
      const burn = activityBurnByIndex.get(index) ?? 0;
      const target = 2_160 + burn + 300;
      return {
        date,
        weightKg: 75 + (slopeKgPerWeek * index) / 7,
        kcalConsumed: logged.has(index) ? Math.round(target * intakeScale) : null,
      } as WellnessEntry;
    });
    const activities = Array.from(new Set([...activityBurnByIndex.keys(), ...unresolvedBurnIndices])).map((index) =>
      unresolved.has(index)
        ? { date: dateAt(index), activeBurnKcal: null, kj: null, movingTimeSec: 0 }
        : { date: dateAt(index), activeBurnKcal: activityBurnByIndex.get(index)!, kj: null, movingTimeSec: 0 }
    );
    return { wellness, activities };
  };

  const warning = (options?: Parameters<typeof buildInput>[0]) => {
    const { wellness, activities } = buildInput(options);
    return computeNutritionTrendWarning(
      wellness,
      activities,
      TREND_MODEL,
      TODAY,
      80,
      0.15,
      300
    );
  };

  it("pins the evidence gate constants", () => {
    expect(TREND_WARNING_WINDOW_DAYS).toBe(21);
    expect(TREND_WARNING_MIN_WEIGH_INS).toBe(7);
    expect(TREND_WARNING_MIN_LOGGED_DAYS).toBe(14);
    expect(TREND_WARNING_ADHERENCE_MIN).toBe(0.95);
    expect(TREND_WARNING_ADHERENCE_MAX).toBe(1.05);
    expect(TREND_WARNING_ERROR_KG_PER_WEEK).toBe(0.15);
  });

  it("returns evidence when the full window clears every gate", () => {
    expect(warning()).toMatchObject({
      observedKgPerWeek: expect.any(Number),
      intendedKgPerWeek: expect.any(Number),
      adherenceRatio: 1,
      weighIns: 21,
      loggedDays: 21,
    });
  });

  it("withholds when fewer than 7 weigh-ins remain", () => {
    const { wellness, activities } = buildInput();
    for (let index = 6; index < wellness.length; index++) wellness[index].weightKg = null;
    expect(computeNutritionTrendWarning(wellness, activities, TREND_MODEL, TODAY, 80, 0.15, 300)).toBeNull();
  });

  it("withholds when only 13 positive-intake days are usable", () => {
    expect(warning({ loggedIndices: Array.from({ length: 13 }, (_, i) => i) })).toBeNull();
  });

  it("withholds when aggregate adherence is below 0.95", () => {
    expect(warning({ intakeScale: 0.94 })).toBeNull();
  });

  it("withholds when aggregate adherence is above 1.05", () => {
    expect(warning({ intakeScale: 1.06 })).toBeNull();
  });

  it("withholds when the observed trend error is below 0.15 kg per week", () => {
    expect(warning({ slopeKgPerWeek: 0.2 })).toBeNull();
  });

  it("withholds when an unresolved-burn date leaves fewer than 14 usable days", () => {
    expect(warning({
      loggedIndices: Array.from({ length: 14 }, (_, i) => i),
      unresolvedBurnIndices: [0],
    })).toBeNull();
  });

  it("resolves deliberately divergent rest and training models in aggregate adherence", () => {
    const restModel: NutritionModel = { ...LEGACY, baseCalories: 2_000, restDayTarget: 2_000 };
    const trainModel: NutritionModel = { ...LEGACY, baseCalories: 3_000, restDayTarget: 3_000 };
    let restResolutions = 0;
    let trainResolutions = 0;
    const wellness = Array.from({ length: 21 }, (_, index) => {
      const training = index % 2 === 1;
      return {
        date: dateAt(index),
        weightKg: 75 + (0.3 * index) / 7,
        kcalConsumed: training ? 3_500 : 2_000,
      } as WellnessEntry;
    });
    const activities = wellness
      .filter((_, index) => index % 2 === 1)
      .map(({ date }) => ({ date, activeBurnKcal: 500, kj: null, movingTimeSec: 0 }));

    const result = computeNutritionTrendWarning(
      wellness,
      activities,
      (isRestDay) => {
        if (isRestDay) restResolutions++;
        else trainResolutions++;
        return isRestDay ? restModel : trainModel;
      },
      TODAY,
      80,
      0.15,
      0
    );

    expect(result).toMatchObject({ adherenceRatio: 1, loggedDays: 21 });
    expect(restResolutions).toBe(11);
    // 10 training days + ONE extra: computeNutritionTrendWarning probes the resolver once up front
    // (`modelOrResolver(false)`) to read the netting rate `exerciseBurn` needs, since both day types
    // share one rmr and one calibration basis. Deliberately still an exact count rather than a
    // `toBeGreaterThan` — the point of pinning it is to catch an N+1 resolve per day, which would show
    // up here as ~20, not as 11.
    expect(trainResolutions).toBe(10 + 1);
  });

  it("excludes a whole date when resolved and unresolved activities share it", () => {
    const { wellness, activities } = buildInput();
    activities.push({ date: dateAt(2), activeBurnKcal: null, kj: null, movingTimeSec: 0 });

    expect(computeNutritionTrendWarning(wellness, activities, TREND_MODEL, TODAY, 80, 0.15, 300))
      .toMatchObject({ adherenceRatio: 1, loggedDays: 20 });
  });

  it("includes exact trend-error and adherence boundaries", () => {
    const lower = warning({ intakeScale: 0.95 });
    const upper = warning({ intakeScale: 1.05 });
    expect(lower).not.toBeNull();
    expect(upper).not.toBeNull();
    expect(lower!.observedKgPerWeek - lower!.intendedKgPerWeek).toBeGreaterThanOrEqual(0.15);
    expect(lower!.adherenceRatio).toBe(0.95);
    expect(upper!.adherenceRatio).toBe(1.05);
  });
});

describe("calculateDailyTarget (legacy, pre-migration)", () => {
  it("preserves the athlete's hand-set rest-day number unchanged", () => {
    expect(calculateDailyTarget(0, LEGACY, 300, true).dailyTarget).toBe(2600);
  });

  it("floors a training day at the rest-day number rather than lowering rest days to fix the inversion", () => {
    // Strength 45min ≈ 225 kcal: 2000 + 225 + 300 = 2525, below the 2600 rest day.
    const p = calculateDailyTarget(225, LEGACY, 300, false);
    expect(p.dailyTarget).toBe(2600);
  });

  it("is unchanged from previous behaviour once burn clears the rest-day figure", () => {
    expect(calculateDailyTarget(700, LEGACY, 300, false).dailyTarget).toBe(3000);
  });
});

describe("inRideCarbTarget", () => {
  it("is zero for short rides, rest and strength", () => {
    expect(inRideCarbTarget(59, "Z2")).toBe(0);
    expect(inRideCarbTarget(45, "VO2max")).toBe(0);
    expect(inRideCarbTarget(0, "Rest")).toBe(0);
    expect(inRideCarbTarget(120, "Strength")).toBe(0);
  });

  it("follows the duration × intensity table", () => {
    expect(inRideCarbTarget(60, "Z2")).toBe(38); // 60–90 min easy: 30–45 g/hr
    expect(inRideCarbTarget(90, "Recovery")).toBe(38);
    expect(inRideCarbTarget(75, "Threshold")).toBe(75); // 60–90 min hard: 60–90 g/hr
    expect(inRideCarbTarget(120, "Z2")).toBe(75); // >90 min any: 60–90 g/hr
    expect(inRideCarbTarget(120, "VO2max")).toBe(105); // >90 min hard: 90–120 g/hr
    expect(inRideCarbTarget(91, "SIT")).toBe(105);
  });
});

describe("preRideCarbTarget", () => {
  it("is zero for rest and strength", () => {
    expect(preRideCarbTarget(60, "Rest", 75)).toBe(0);
    expect(preRideCarbTarget(60, "Strength", 75)).toBe(0);
  });

  it("uses 1.0 g/kg for easy and 1.5 g/kg for hard or long sessions", () => {
    expect(preRideCarbTarget(60, "Z2", 75)).toBe(75);
    expect(preRideCarbTarget(60, "Threshold", 75)).toBe(115); // 112.5 → 115
    expect(preRideCarbTarget(120, "Z2", 75)).toBe(115);
  });
});

describe("estimateWorkoutBurnKcal", () => {
  it("is zero on rest days", () => {
    expect(estimateWorkoutBurnKcal("Rest", 0, 250)).toBe(0);
  });

  it("estimates ride burn from FTP, intensity factor and duration", () => {
    // Z2: 250 W FTP × 0.65 = 162.5 W avg × 7200 s = 1170 kJ ≈ 1170 kcal
    expect(estimateWorkoutBurnKcal("Z2", 120, 250)).toBe(1170);
  });

  it("uses a flat per-minute rate for strength", () => {
    expect(estimateWorkoutBurnKcal("Strength", 60, 250)).toBe(300);
  });
});

describe("weightTrendFromWellness", () => {
  const entry = (date: string, weightKg: number | null): WellnessEntry => ({
    date,
    weightKg,
    hrv: null,
    sleepHours: null,
    sleepQuality: null,
    kcalConsumed: null,
    ctl: null,
    atl: null,
  });

  it("returns the Theil–Sen slope as kg/7d over the trailing window", () => {
    const trend = weightTrendFromWellness([
      entry("2026-06-01", 75.2),
      entry("2026-06-05", 75.0),
      entry("2026-06-08", 74.6),
    ]);
    expect(trend).toBe(-0.6); // steady ~0.6 kg/week loss
  });

  it("returns null below the 3-weigh-in floor", () => {
    expect(weightTrendFromWellness([entry("2026-06-08", 74.6)])).toBeNull();
    expect(
      weightTrendFromWellness([entry("2026-06-07", 75.0), entry("2026-06-08", 74.6)])
    ).toBeNull();
  });

  it("ignores entries without weight", () => {
    const trend = weightTrendFromWellness([
      entry("2026-06-01", 75.0),
      entry("2026-06-04", null),
      entry("2026-06-05", 74.8),
      entry("2026-06-08", 74.5),
    ]);
    expect(trend).toBe(-0.5);
  });

  it("resists a single outlier ~7 days back (the reported failure mode)", () => {
    // True weight is flat at 75.0; the reading exactly 7 days before the latest spiked to 75.6. The old
    // latest-minus-one-reference diff reported a false −0.6 kg/7d — the regression stays ~flat.
    const trend = weightTrendFromWellness([
      entry("2026-06-01", 75.0),
      entry("2026-06-03", 75.0),
      entry("2026-06-05", 75.0),
      entry("2026-06-07", 75.6), // outlier, exactly 7 days before the latest
      entry("2026-06-09", 75.0),
      entry("2026-06-11", 75.0),
      entry("2026-06-13", 75.0),
      entry("2026-06-14", 75.0),
    ]);
    expect(Math.abs(trend as number)).toBeLessThan(0.2);
  });
});

describe("weightTrendFromWellness windowing", () => {
  const w = (date: string, weightKg: number) =>
    ({ date, weightKg, kcalConsumed: null }) as unknown as WellnessEntry;

  it("dilutes a late step change when given the longer window", () => {
    const entries = [
      w("2026-07-01", 70), w("2026-07-08", 70), w("2026-07-15", 70),
      w("2026-07-22", 70), w("2026-07-29", 71.5),
    ];
    const short = weightTrendFromWellness(entries, 14) as number;
    const long = weightTrendFromWellness(entries, 28) as number;
    expect(long).toBeLessThan(short); // the point of the gain-side confirmation window
  });
});

describe("weightTrendPreciseFromWellness", () => {
  const w = (date: string, weightKg: number) =>
    ({ date, weightKg, kcalConsumed: null }) as unknown as WellnessEntry;

  it("keeps precision the rounded variant discards", () => {
    // +0.16 kg over 28 days = +0.04 kg/7d — rounds to 0.0, which is 44 kcal/day of error at 7700 kcal/kg.
    const entries = [
      w("2026-07-01", 62.00), w("2026-07-08", 62.04),
      w("2026-07-15", 62.08), w("2026-07-22", 62.12), w("2026-07-29", 62.16),
    ];
    expect(weightTrendFromWellness(entries, 28)).toBe(0);
    const precise = weightTrendPreciseFromWellness(entries, 28) as number;
    expect(precise).toBeGreaterThan(0.03);
    expect(precise).toBeLessThan(0.05);
  });

  it("returns null under the same sample floor as the rounded variant", () => {
    expect(weightTrendPreciseFromWellness([w("2026-07-01", 62)], 28)).toBeNull();
  });
});

// I2: a raw single weigh-in was sizing the GOAL comparison while the trend used a robust estimator —
// so the daily target could jump across the deadband boundary depending on which weigh-in happened to
// be last. smoothedCurrentWeightKg fixes that by taking the median of the trailing window instead.
describe("smoothedCurrentWeightKg", () => {
  const w = (date: string, weightKg: number | null): WellnessEntry => ({
    date, weightKg, hrv: null, sleepHours: null, sleepQuality: null, kcalConsumed: null, ctl: null, atl: null,
  });

  it("returns the median of the trailing window, not the latest single reading", () => {
    const wellness = [
      w("2026-07-15", 62.0),
      w("2026-07-17", 62.3),
      w("2026-07-19", 61.9),
      w("2026-07-22", 62.5),
      w("2026-07-24", 62.0),
    ];
    // sorted: 61.9, 62.0, 62.0, 62.3, 62.5 → median 62.0 (NOT the raw latest reading, 62.0 here too,
    // but see the next test for the case where latest genuinely differs from the median).
    expect(smoothedCurrentWeightKg(wellness, "2026-07-24")).toBe(62.0);
  });

  it("does not swing with whichever weigh-in happened to land last (the live D-1 bug)", () => {
    // Same 5 underlying readings as the live data (61.7–62.5), just with the LAST one varied. The raw
    // latest-reading approach flips between these two ends; the median must not.
    const commonEarlier = [
      w("2026-07-15", 61.7),
      w("2026-07-17", 62.3),
      w("2026-07-19", 61.9),
    ];
    const endsHigh = [...commonEarlier, w("2026-07-22", 62.0), w("2026-07-24", 62.5)];
    const endsLow = [...commonEarlier, w("2026-07-22", 62.5), w("2026-07-24", 62.0)];
    // Both sets contain the identical 5 values {61.7, 62.3, 61.9, 62.0, 62.5} — only which one is
    // dated last differs — so the median must be identical regardless.
    expect(smoothedCurrentWeightKg(endsHigh, "2026-07-24")).toBe(
      smoothedCurrentWeightKg(endsLow, "2026-07-24")
    );
  });

  it("falls back to the latest single reading when the trailing window is empty", () => {
    const wellness = [w("2026-05-01", 70.0)]; // far outside any reasonable trailing window
    expect(smoothedCurrentWeightKg(wellness, "2026-07-24")).toBe(70.0);
  });

  it("returns null when there are no weigh-ins at all", () => {
    expect(smoothedCurrentWeightKg([w("2026-07-24", null)], "2026-07-24")).toBeNull();
    expect(smoothedCurrentWeightKg([], "2026-07-24")).toBeNull();
  });

  it("ignores weigh-ins outside the requested window", () => {
    const wellness = [
      w("2026-06-01", 80.0), // way outside a 14-day window
      w("2026-07-20", 62.0),
      w("2026-07-24", 62.4),
    ];
    expect(smoothedCurrentWeightKg(wellness, "2026-07-24")).toBe(62.2); // median of {62.0, 62.4} only
  });
});

describe("computeEnergyAvailability", () => {
  const w = (date: string, kcalConsumed: number | null, weightKg: number | null = 60): WellnessEntry => ({
    date, weightKg, hrv: null, sleepHours: null, sleepQuality: null, kcalConsumed, ctl: null, atl: null,
  });
  const ride = (date: string, kj: number) => ({ date, kj, activeBurnKcal: null, movingTimeSec: 0 });

  it("averages (intake − burn)/kg over complete days and EXCLUDES today's partial intake", () => {
    const wellness = [
      w("2026-06-11", 3000), w("2026-06-12", 3000), w("2026-06-13", 3000), w("2026-06-14", 3000),
      w("2026-06-15", 500), // today — still being logged; must not drag the mean down
    ];
    const acts = ["2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14", "2026-06-15"].map((d) => ride(d, 1200));
    const ea = computeEnergyAvailability(wellness, acts, "2026-06-15")!;
    expect(ea.eaKcalPerKg).toBe(30); // (3000 − 1200) / 60, today excluded
    expect(ea.daysUsed).toBe(4);
  });

  it("withholds (null) below the minimum sample — no flaky single-day reading", () => {
    const ea = computeEnergyAvailability([w("2026-06-13", 3000), w("2026-06-14", 3000)], [], "2026-06-15");
    expect(ea).toBeNull();
  });

  it("ignores a logged 0-intake day (treated as not-logged, not a real fasted day → no negative drag)", () => {
    const wellness = [
      w("2026-06-11", 3000), w("2026-06-12", 3000), w("2026-06-13", 3000),
      w("2026-06-14", 0), // 0 kcal — excluded; counting it as (0 − burn)/kg would push the mean negative
    ];
    const acts = ["2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"].map((d) => ride(d, 1200));
    const ea = computeEnergyAvailability(wellness, acts, "2026-06-15")!;
    expect(ea.eaKcalPerKg).toBe(30); // (3000 − 1200)/60 over the 3 real days
    expect(ea.daysUsed).toBe(3);
  });

  it("anchors a no-weight day to the nearest PRIOR weigh-in, not a future one (EC-4)", () => {
    const wellness = [
      w("2026-06-05", null, 60), // prior weigh-in
      w("2026-06-14", null, 70), // later weigh-in (most-recent overall)
      w("2026-06-09", 3000, null), w("2026-06-10", 3000, null), w("2026-06-11", 3000, null),
    ];
    const ea = computeEnergyAvailability(wellness, [], "2026-06-15")!;
    expect(ea.eaKcalPerKg).toBe(50); // 3000 / 60 (prior); the most-recent 70 kg would give 43
  });

  // Minor 2: a day whose only activity has an UNRESOLVABLE burn (neither activeBurnKcal nor kj) must
  // be excluded from the mean entirely — treating it as burn 0 makes it read exactly like a rest day,
  // which INFLATES the EA figure and hides underfuelling (the wrong error direction for this athlete).
  it("excludes a day with an unresolvable activity burn entirely, rather than zeroing it", () => {
    const wellness = [
      w("2026-06-10", 3000), w("2026-06-11", 3000), w("2026-06-12", 3000),
      w("2026-06-13", 3000), // this day's activity has neither activeBurnKcal nor kj
      w("2026-06-14", 3000),
    ];
    const acts = [
      { date: "2026-06-10", kj: 1200, activeBurnKcal: null, movingTimeSec: 0 },
      { date: "2026-06-11", kj: 1200, activeBurnKcal: null, movingTimeSec: 0 },
      { date: "2026-06-12", kj: 1200, activeBurnKcal: null, movingTimeSec: 0 },
      { date: "2026-06-13", kj: null, activeBurnKcal: null, movingTimeSec: 0 }, // unresolved — NOT a rest day
      { date: "2026-06-14", kj: 1200, activeBurnKcal: null, movingTimeSec: 0 },
    ];
    const ea = computeEnergyAvailability(wellness, acts, "2026-06-15")!;
    // Without the fix, 06-13 folds in at (3000 − 0)/60 = 50, dragging the mean up to 32 over 5 days.
    expect(ea.eaKcalPerKg).toBe(30); // (3000 − 1200)/60 over the 4 RESOLVED days only
    expect(ea.daysUsed).toBe(4);
  });

  it("still counts a genuine rest day (no activity at all) at burn 0", () => {
    const wellness = [
      w("2026-06-10", 3000), w("2026-06-11", 3000), w("2026-06-12", 3000),
      w("2026-06-13", 3000), // no activity this day at all — a real rest day
    ];
    const acts = ["2026-06-10", "2026-06-11", "2026-06-12"].map((d) => ride(d, 1200));
    const ea = computeEnergyAvailability(wellness, acts, "2026-06-14")!;
    // 3 training days at (3000−1200)/60=30, plus one genuine rest day at (3000−0)/60=50.
    expect(ea.daysUsed).toBe(4);
    expect(ea.eaKcalPerKg).toBe(Math.round((30 * 3 + 50) / 4));
  });

  it("reports the trend vs the prior equal window", () => {
    const wellness = [
      // prior window [06-01, 06-08): (2400 − 1200)/60 = 20
      w("2026-06-04", 2400), w("2026-06-05", 2400), w("2026-06-06", 2400),
      // current window [06-08, 06-15): (3000 − 1200)/60 = 30
      w("2026-06-11", 3000), w("2026-06-12", 3000), w("2026-06-13", 3000),
    ];
    const acts = wellness.map((e) => ride(e.date, 1200));
    const ea = computeEnergyAvailability(wellness, acts, "2026-06-15")!;
    expect(ea.eaKcalPerKg).toBe(30);
    expect(ea.trend).toBe(10); // 30 now vs 20 the prior week
  });
});

describe("eaLevel — soft body-weight-basis read (FB-2026-06-30)", () => {
  it("bands a number into low / adequate / ample on the body-weight basis", () => {
    expect(eaLevel(18)).toBe("low");
    expect(eaLevel(24)).toBe("low"); // just under the 25 floor
    expect(eaLevel(25)).toBe("adequate"); // boundary is adequate, not low
    expect(eaLevel(32)).toBe("adequate");
    expect(eaLevel(39)).toBe("adequate");
    expect(eaLevel(40)).toBe("ample"); // boundary is ample
    expect(eaLevel(55)).toBe("ample");
  });
});

describe("balanceLevel", () => {
  it("bands the weekly intake-vs-need ratio", () => {
    expect(balanceLevel(0.85)).toBe("low");
    expect(balanceLevel(0.9)).toBe("adequate"); // boundary is inclusive-adequate
    expect(balanceLevel(1.0)).toBe("adequate");
    expect(balanceLevel(1.05)).toBe("adequate"); // upper boundary still adequate
    expect(balanceLevel(1.2)).toBe("ample");
  });
});

describe("activeBurn", () => {
  const base = { activeBurnKcal: null, kj: null } as Parameters<typeof activeBurn>[0];

  it("returns the synced figure verbatim, never scaled", () => {
    expect(activeBurn({ ...base, activeBurnKcal: 843, kj: 800 })).toEqual({ kcal: 843, legacy: false });
  });

  it("falls back to kj flagged as legacy when the active-burn figure is absent", () => {
    expect(activeBurn({ ...base, kj: 800 })).toEqual({ kcal: 800, legacy: true });
  });

  it("returns null — never 0 — when neither figure exists, so an unknown day is not a rest day", () => {
    expect(activeBurn(base)).toBeNull();
  });

  it("treats a zero active-burn figure as real, not missing", () => {
    expect(activeBurn({ ...base, activeBurnKcal: 0, kj: 500 })).toEqual({ kcal: 0, legacy: false });
  });

  // Minor 1 / AGENTS.md migration-flag gotcha: a synced activity written before activeBurnKcal existed
  // parses back with the key simply ABSENT (undefined), not null. `undefined !== null` is true, so a
  // `!== null` check would fall through to `{ kcal: undefined }` (NaN downstream) instead of the legacy
  // kj branch.
  it("falls back to the legacy kj branch when activeBurnKcal is entirely absent (undefined), not NaN", () => {
    const activityWithoutField = { kj: 800 } as unknown as Parameters<typeof activeBurn>[0];
    expect(activeBurn(activityWithoutField)).toEqual({ kcal: 800, legacy: true });
  });
});

describe("exerciseBurn (net of resting cost)", () => {
  const RMR = 1622;
  const perHour = RMR / 24; // 67.583…
  const ride = (over: Partial<BurnActivity> = {}): BurnActivity =>
    ({ date: "2026-08-05", activeBurnKcal: 1474, kj: 1473, movingTimeSec: 7140, ...over });

  it("subtracts the ride's own resting-equivalent cost from the gross source figure", () => {
    // The live 2026-08-05 ride: 1.983 h at RMR 1622 → 134 kcal of resting metabolism that k×RMR is
    // already paying for across the full day. 1474 − 134 = 1340.
    expect(exerciseBurn(ride(), perHour)!.kcal).toBeCloseTo(1474 - (7140 / 3600) * perHour, 6);
    expect(Math.round(exerciseBurn(ride(), perHour)!.kcal)).toBe(1340);
  });

  it("is a no-op at rate 0, so a gross-basis calibration keeps its own consistent pairing", () => {
    // This is the migration guarantee, not a degenerate case: pairing a gross-fit k with net burn
    // under-feeds by exactly the netted amount, so restingKcalPerHour 0 must return the source figure
    // untouched.
    expect(exerciseBurn(ride(), 0)).toEqual({ kcal: 1474, legacy: false });
  });

  it("nets the legacy kj branch too, and keeps the legacy flag", () => {
    expect(exerciseBurn(ride({ activeBurnKcal: null }), perHour)).toEqual({
      kcal: 1473 - (7140 / 3600) * perHour,
      legacy: true,
    });
  });

  it("floors at 0 rather than returning a negative exercise cost", () => {
    // A manually-entered burn for a long, very easy activity (an hour's walk logged at 30 kcal) nets
    // below zero. A negative "exercise cost" would SUBTRACT from the day's target — never a real
    // quantity, and the wrong direction for a chronically underfuelled athlete.
    expect(exerciseBurn(ride({ activeBurnKcal: 30, kj: null, movingTimeSec: 3600 }), perHour)!.kcal).toBe(0);
  });

  it("still returns null — never 0 — when the burn itself is unresolvable", () => {
    // Distinct from the floor above: an unknown burn must stay unknown, so the day is excluded rather
    // than read as a rest day.
    expect(exerciseBurn(ride({ activeBurnKcal: null, kj: null }), perHour)).toBeNull();
  });

  it("treats a missing duration as un-nettable rather than guessing one", () => {
    const noDuration = { date: "d", activeBurnKcal: 500, kj: null } as unknown as BurnActivity;
    expect(exerciseBurn(noDuration, perHour)!.kcal).toBe(500);
  });
});

describe("resolveNutritionModel — burn basis (net-of-resting migration)", () => {
  const withRmrInputs = (neat: Partial<NeatCalibration>): AthleteProfile =>
    ({
      performance: { dateOfBirth: "2006-05-28", heightCm: 177, sex: "male", weightKg: 62 },
      nutrition: {
        baseCalories: 2000,
        restDayTarget: 2600,
        buffer: 0,
        targetWeightKg: 63,
        targetRateKgPerWeek: null,
        neat: { multiplier: 1.3, confidence: "high", source: "derived", windowDays: 42, loggedDays: 39, weighIns: 20, solvedAt: null, imbalance: null, stale: false, ...neat },
        dayTypeNeat: null,
      },
    }) as unknown as AthleteProfile;

  it("enables netting once the calibration behind the multiplier is net-basis", () => {
    const m = resolveNutritionModel(withRmrInputs({ basis: "net" }), 62, "2026-08-05", false);
    expect(m.kind).toBe("derived");
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.restingKcalPerHour).toBeCloseTo(m.rmr / 24, 9);
  });

  // AGENTS.md migration-flag gotcha, and the one that actually protects the athlete here: a
  // profile.json written before `basis` existed parses it back as `undefined`. Netting must stay OFF
  // for that record — its k was fit against gross burn, and pairing it with net burn silently
  // under-feeds by ~130 kcal on a 2 h ride until the next sync re-solves.
  it("leaves netting OFF for a pre-migration record whose basis is absent (undefined)", () => {
    const m = resolveNutritionModel(withRmrInputs({}), 62, "2026-08-05", false);
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.restingKcalPerHour).toBe(0);
  });

  it("reads the basis off the day-type record actually supplying the multiplier, not the pooled one", () => {
    // A gross-basis split must not inherit netting from a net-basis pooled record sitting beside it.
    const netNeat: NeatCalibration = { multiplier: 1.3, confidence: "high", source: "derived", windowDays: 42, loggedDays: 39, weighIns: 20, solvedAt: null, imbalance: null, stale: false, basis: "net" };
    const grossSplit: NeatCalibration = { ...netNeat, multiplier: 1.45, basis: undefined };
    const profile = withRmrInputs({ basis: "net" });
    profile.nutrition.dayTypeNeat = { rest: grossSplit, train: grossSplit, pooled: netNeat, shrinkageWeight: { rest: 0.3, train: 0.9 } };
    const m = resolveNutritionModel(profile, 62, "2026-08-05", true);
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.neatMultiplier).toBe(1.45); // the split IS in force
    expect(m.restingKcalPerHour).toBe(0); // …so its own gross basis governs
  });
});

describe("isRestDayFor", () => {
  const act = (over: Partial<BurnActivity>) =>
    ({ date: "2026-07-30", activeBurnKcal: null, kj: null, ...over, movingTimeSec: 0 });

  it("is true when there's no activity at all on the date", () => {
    expect(isRestDayFor([act({ date: "2026-07-29" })], "2026-07-30")).toBe(true);
  });

  it("is false when the only activity on the date has an unresolvable burn — unknown is not rest", () => {
    expect(isRestDayFor([act({ activeBurnKcal: null, kj: null })], "2026-07-30")).toBe(false);
  });

  it("is true when the day's summed resolvable burn is exactly 0", () => {
    expect(isRestDayFor([act({ activeBurnKcal: 0 })], "2026-07-30")).toBe(true);
  });

  it("is false once any activity on the date carries a positive resolvable burn", () => {
    expect(isRestDayFor([act({ activeBurnKcal: 450 })], "2026-07-30")).toBe(false);
  });

  it("sums resolvable burn across multiple activities on the same date", () => {
    expect(
      isRestDayFor([act({ activeBurnKcal: 0 }), act({ kj: 300 }), act({ date: "2026-07-29", activeBurnKcal: 900, movingTimeSec: 0 })], "2026-07-30")
    ).toBe(false);
  });
});

describe("restingMetabolicRate", () => {
  // Mifflin-St Jeor: (10 × kg) + (6.25 × cm) − (5 × yr) + 5 for male, − 161 for female.
  it("matches the published male equation", () => {
    // 10*75 + 6.25*180 − 5*30 + 5 = 750 + 1125 − 150 + 5 = 1730
    expect(restingMetabolicRate(75, 180, 30, "male")).toBe(1730);
  });

  it("matches the published female equation", () => {
    // 10*62 + 6.25*168 − 5*28 − 161 = 620 + 1050 − 140 − 161 = 1369
    expect(restingMetabolicRate(62, 168, 28, "female")).toBe(1369);
  });

  it("exposes a NEAT prior that excludes structured exercise", () => {
    expect(DEFAULT_NEAT_MULTIPLIER).toBe(1.2);
  });
});

describe("resolveNutritionModel", () => {
  const profile = (perf: Partial<AthleteProfile["performance"]>) =>
    ({
      performance: {
        ftp: 250, maxHr: 190, thresholdHr: 170, weightKg: 75,
        weeklyHoursMin: 6, weeklyHoursMax: 10,
        dateOfBirth: null, heightCm: null, sex: null, ...perf,
      },
      nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 78 },
    }) as unknown as AthleteProfile;

  it("derives once all three RMR inputs are present", () => {
    const m = resolveNutritionModel(
      profile({ dateOfBirth: "1996-03-14", heightCm: 180, sex: "male" }), 74, "2026-07-30", false
    );
    expect(m.kind).toBe("derived");
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.rmr).toBe(restingMetabolicRate(74, 180, 30, "male"));
    expect(m.weightKg).toBe(74); // synced weight wins over the manual profile figure
  });

  // The gotcha this project has already been bitten by: a profile JSON written before these fields
  // existed parses them back as `undefined`, which `=== null` misses.
  it("stays legacy when the RMR fields are undefined, not just null", () => {
    const p = profile({});
    delete (p.performance as unknown as Record<string, unknown>).dateOfBirth;
    delete (p.performance as unknown as Record<string, unknown>).heightCm;
    delete (p.performance as unknown as Record<string, unknown>).sex;
    expect(resolveNutritionModel(p, 74, "2026-07-30", false).kind).toBe("legacy");
  });

  it("stays legacy when only some inputs are present", () => {
    expect(resolveNutritionModel(profile({ heightCm: 180 }), 74, "2026-07-30", false).kind).toBe("legacy");
  });

  it("stays legacy when the date of birth cannot yield a plausible age", () => {
    const m = resolveNutritionModel(
      profile({ dateOfBirth: "not-a-date", heightCm: 180, sex: "male" }), 74, "2026-07-30", false
    );
    expect(m.kind).toBe("legacy");
  });
});

describe("resolveNutritionModel with calibration", () => {
  const defaultNeat = {
    multiplier: DEFAULT_NEAT_MULTIPLIER, confidence: "low" as const, source: "default" as const,
    windowDays: null, loggedDays: null, weighIns: null, solvedAt: null, imbalance: null, stale: false,
  };
  const profileWith = (nutritionOverrides: Record<string, unknown>) =>
    ({
      performance: {
        ftp: 250, maxHr: 190, thresholdHr: 170, weightKg: 75,
        weeklyHoursMin: 6, weeklyHoursMax: 10,
        dateOfBirth: "1996-03-14", heightCm: 180, sex: "male",
      },
      nutrition: {
        baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 78, targetRateKgPerWeek: null,
        neat: defaultNeat, ...nutritionOverrides,
      },
    }) as unknown as AthleteProfile;

  it("uses the stored calibrated multiplier over the default", () => {
    const p = profileWith({ neat: { ...defaultNeat, multiplier: 1.3, source: "derived", confidence: "high" } });
    const m = resolveNutritionModel(p, 62, "2026-07-30", false);
    expect(m.kind).toBe("derived");
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.neatMultiplier).toBe(1.3);
  });

  it("falls back to the default when nothing has been adopted", () => {
    const m = resolveNutritionModel(profileWith({}), 62, "2026-07-30", false);
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.neatMultiplier).toBe(DEFAULT_NEAT_MULTIPLIER);
  });

  // The gotcha this project has already been bitten by: a profile JSON written before `neat` existed
  // parses it back as `undefined`, which `=== null` (or a bare, non-optional-chained read) would miss.
  it("falls back to the default when neat is undefined, not just null", () => {
    const p = profileWith({});
    delete (p.nutrition as unknown as Record<string, unknown>).neat;
    const m = resolveNutritionModel(p, 62, "2026-07-30", false);
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.neatMultiplier).toBe(DEFAULT_NEAT_MULTIPLIER);
  });
});

describe("resolveNutritionModel with day-type calibration (DT Task 2)", () => {
  const defaultNeat: NeatCalibration = {
    multiplier: DEFAULT_NEAT_MULTIPLIER, confidence: "low", source: "default",
    windowDays: null, loggedDays: null, weighIns: null, solvedAt: null, imbalance: null, stale: false,
  };
  const pooled: NeatCalibration = {
    ...defaultNeat, multiplier: 1.28, confidence: "high", source: "derived",
    windowDays: 42, loggedDays: 40, weighIns: 20, solvedAt: "2026-07-01T00:00:00.000Z",
  };
  const restCal: NeatCalibration = { ...pooled, multiplier: 1.47, windowDays: 90, loggedDays: 20 };
  const trainCal: NeatCalibration = { ...pooled, multiplier: 1.22, windowDays: 90, loggedDays: 40 };
  const dayTypeNeat: DayTypeNeat = {
    rest: restCal, train: trainCal, pooled, shrinkageWeight: { rest: 0.6, train: 0.9 },
  };

  const profileWith = (neat: NeatCalibration, dtn: DayTypeNeat | null) =>
    ({
      performance: {
        ftp: 250, maxHr: 190, thresholdHr: 170, weightKg: 75,
        weeklyHoursMin: 6, weeklyHoursMax: 10,
        dateOfBirth: "1996-03-14", heightCm: 180, sex: "male",
      },
      nutrition: {
        baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 78, targetRateKgPerWeek: null,
        neat, dayTypeNeat: dtn,
      },
    }) as unknown as AthleteProfile;

  it("picks dayTypeNeat.rest.multiplier on a rest day once dayTypeNeat is adopted", () => {
    const p = profileWith(pooled, dayTypeNeat);
    const m = resolveNutritionModel(p, 62, "2026-07-30", true);
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.neatMultiplier).toBe(dayTypeNeat.rest.multiplier);
  });

  it("picks dayTypeNeat.train.multiplier on a training day once dayTypeNeat is adopted", () => {
    const p = profileWith(pooled, dayTypeNeat);
    const m = resolveNutritionModel(p, 62, "2026-07-30", false);
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.neatMultiplier).toBe(dayTypeNeat.train.multiplier);
  });

  // No behavior change for an athlete without enough rest-day data yet (unmigrated / insufficient data).
  it("falls back to the flat neat.multiplier on both day types when dayTypeNeat is null", () => {
    const p = profileWith(pooled, null);
    const rest = resolveNutritionModel(p, 62, "2026-07-30", true);
    const train = resolveNutritionModel(p, 62, "2026-07-30", false);
    if (rest.kind !== "derived" || train.kind !== "derived") throw new Error("unreachable");
    expect(rest.neatMultiplier).toBe(pooled.multiplier);
    expect(train.neatMultiplier).toBe(pooled.multiplier);
  });

  // calibrateNeatByDayType forces shrinkageWeight to 0 below DAY_TYPE_MIN_LOGGED_DAYS, which by
  // construction already blends rest.multiplier down to EXACTLY pooled.multiplier — so picking
  // dayTypeNeat.rest.multiplier here is numerically identical to the flat fallback, not a regression.
  it("still resolves to the pooled figure when shrinkageWeight is forced to 0 (thin rest-day sample)", () => {
    const thin: DayTypeNeat = {
      ...dayTypeNeat,
      rest: { ...restCal, multiplier: pooled.multiplier, loggedDays: DAY_TYPE_MIN_LOGGED_DAYS - 1 },
      shrinkageWeight: { rest: 0, train: 0.9 },
    };
    const p = profileWith(pooled, thin);
    const m = resolveNutritionModel(p, 62, "2026-07-30", true);
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.neatMultiplier).toBe(pooled.multiplier);
  });

  // The override guard extends to the day-type path: an athlete-typed override is an explicit choice
  // and must win over EVERY derived figure, including a day-type split frozen from BEFORE the override
  // (sync-side adoption refuses to update dayTypeNeat while an override is active, so a stale split can
  // otherwise sit on disk alongside a fresh override and silently outrank it on both rest and training days).
  it("ignores a stale dayTypeNeat and uses the override on both rest and training days", () => {
    const overridden: NeatCalibration = {
      ...defaultNeat, multiplier: 1.5, source: "override", solvedAt: "2026-07-15T00:00:00.000Z",
    };
    const p = profileWith(overridden, dayTypeNeat);
    const rest = resolveNutritionModel(p, 62, "2026-07-30", true);
    const train = resolveNutritionModel(p, 62, "2026-07-30", false);
    if (rest.kind !== "derived" || train.kind !== "derived") throw new Error("unreachable");
    expect(rest.neatMultiplier).toBe(1.5);
    expect(train.neatMultiplier).toBe(1.5);
  });
});

describe("calibrateNeat", () => {
  // Synthetic athlete with a KNOWN k: intake is constructed so the identity must recover it.
  const synth = (k: number, days: number, rmr: number, burnPerDay: number) => {
    const wellness: WellnessEntry[] = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.UTC(2026, 5, 1) + i * 86_400_000).toISOString().slice(0, 10);
      wellness.push({ date, weightKg: 62, kcalConsumed: k * rmr + burnPerDay } as WellnessEntry);
    }
    const activities = wellness.map((w) => ({ date: w.date, activeBurnKcal: burnPerDay, kj: null, movingTimeSec: 0 }));
    return { wellness, activities };
  };

  it("recovers a known multiplier from a flat-weight athlete", () => {
    const { wellness, activities } = synth(1.3, 42, 1631, 1000);
    const r = calibrateNeat(wellness, activities, 1631, "2026-07-13", 42)!;
    expect(r.multiplier).toBeGreaterThan(1.29);
    expect(r.multiplier).toBeLessThan(1.31);
    expect(r.imbalance).toBeNull();
    expect(r.source).toBe("derived");
  });

  it("withholds below the confidence floor rather than adopting a flaky number", () => {
    const { wellness, activities } = synth(1.3, 10, 1631, 1000);
    expect(calibrateNeat(wellness, activities, 1631, "2026-06-11", 42)).toBeNull();
  });

  it("clamps an implausibly HIGH solve and reports both candidate causes, not a diagnosis", () => {
    const { wellness, activities } = synth(2.2, 42, 1631, 1000);
    const r = calibrateNeat(wellness, activities, 1631, "2026-07-13", 42)!;
    expect(r.multiplier).toBe(NEAT_PLAUSIBLE_MAX);
    expect(r.imbalance!.direction).toBe("intake-above-model");
    expect(r.imbalance!.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("clamps an implausibly LOW solve", () => {
    const { wellness, activities } = synth(0.6, 42, 1631, 1000);
    const r = calibrateNeat(wellness, activities, 1631, "2026-07-13", 42)!;
    expect(r.multiplier).toBe(NEAT_PLAUSIBLE_MIN);
    expect(r.imbalance!.direction).toBe("intake-below-model");
  });

  it("imputes missing intake days at the logged mean, not zero", () => {
    const { wellness, activities } = synth(1.3, 42, 1631, 1000);
    // Blank a third of the days: absence is a transfer gap, not a fast.
    for (let i = 0; i < wellness.length; i += 3) wellness[i].kcalConsumed = null;
    const r = calibrateNeat(wellness, activities, 1631, "2026-07-13", 42)!;
    expect(r.multiplier).toBeGreaterThan(1.28); // would collapse toward 0.87 if zeros were summed
    expect(r.multiplier).toBeLessThan(1.32);
  });

  // Step 3b: coverage over the LOGGABLE range, plus a staleness guard.
  describe("loggable-range coverage and staleness", () => {
    it("still calibrates with a trailing transfer-gap tail inside the staleness window", () => {
      const { wellness, activities } = synth(1.3, 42, 1631, 1000);
      // Blank the trailing 9 days' kcalConsumed — a batch-transfer gap (data not yet synced), not a
      // logging gap. Last logged day is then 10 days before "today" — inside
      // CALIBRATION_MAX_STALENESS_DAYS (14), so anchoring the window at `today` must not withhold this.
      for (let i = wellness.length - 9; i < wellness.length; i++) wellness[i].kcalConsumed = null;
      const r = calibrateNeat(wellness, activities, 1631, "2026-07-13", 42);
      expect(r).not.toBeNull();
      expect(r!.stale).toBe(false);
      expect(r!.source).toBe("derived");
      expect(r!.multiplier).toBeGreaterThan(1.25);
      expect(r!.multiplier).toBeLessThan(1.35);
    });

    it("returns a stale default (not a bare null) once the transfer gap exceeds the staleness window", () => {
      const { wellness, activities } = synth(1.3, 60, 1631, 1000);
      // Blank the trailing 20 days' kcalConsumed — last logged day lands 21 days before "today",
      // beyond CALIBRATION_MAX_STALENESS_DAYS (14). Good-but-old data must not be adopted as current,
      // and the reason must survive the withholding rather than reading as a bare absence.
      for (let i = wellness.length - 20; i < wellness.length; i++) wellness[i].kcalConsumed = null;
      const r = calibrateNeat(wellness, activities, 1631, "2026-07-31", 42);
      expect(r).not.toBeNull();
      expect(r!.stale).toBe(true);
      expect(r!.source).toBe("default");
      expect(r!.multiplier).toBe(DEFAULT_NEAT_MULTIPLIER);
    });

    it("decrements N for a day excluded because its activity burn is unresolvable", () => {
      const { wellness, activities: baseActivities } = synth(1.3, 42, 1631, 1000);
      const activities: Array<{ date: string; activeBurnKcal: number | null; kj: number | null; movingTimeSec: number }> =
        baseActivities.map((a) => ({ ...a }));
      // One mid-window day's burn is unresolvable (no activeBurnKcal AND no kj) — it must drop out of
      // sumBurn AND out of N, or the k·RMR term counts a day whose burn was never actually summed,
      // which is the ~1.5% imbalance the Task 3 implementer flagged.
      activities[20] = { date: activities[20].date, activeBurnKcal: null, kj: null, movingTimeSec: 0 };
      const r = calibrateNeat(wellness, activities, 1631, "2026-07-13", 42)!;
      expect(r).not.toBeNull();
      // Uniform synthetic intake makes the true multiplier exactly recoverable once N excludes the
      // unresolved day too — without that decrement the solve drifts to ~1.31 instead.
      expect(r.multiplier).toBeGreaterThan(1.299);
      expect(r.multiplier).toBeLessThan(1.301);
    });
  });

  // CRITICAL fix: theilSenKgPerWeek (unchanged) anchors its x-axis at whichever weigh-in is LAST in the
  // array it's given, with no awareness of `cutoff`/`today`. Passed the raw wellness array, a lapsed
  // weigh-in cadence silently drags the trend window back by the lapse — pre-window data (e.g. a
  // gaining block that ended weeks ago) gets a vote, and the most recent days of the real calibration
  // window get none. Two independent fixes close this: (1) calibrateNeat now filters the wellness
  // handed to the trend regression down to [cutoff, lastLoggedDate] before calling it; (2) a weigh-in
  // recency gate (CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS) withholds calibration outright once the most
  // recent in-window weigh-in is too old, because weigh-in COUNT and logged COVERAGE alone (the
  // pre-existing confidence gates) don't guarantee the trend they feed is current — a cluster of
  // weigh-ins in the window's first half can clear both bars with a stale trend.
  describe("weigh-in recency", () => {
    // A pre-window "gaining block": 40 days ending exactly at the cutoff boundary, weight rising
    // +1.4 kg/week, landing at 62 kg — continuous with the flat 62 kg in-window segment. On the OLD
    // (unfiltered, ungated) code this is exactly the shape that fabricated a ~165-177 kcal/day deficit
    // at HIGH confidence once weigh-ins lapsed (review finding #1's measured table).
    const withPreWindowTrend = (windowDays: number, k: number, rmr: number, burnPerDay: number) => {
      const preWindow: WellnessEntry[] = [];
      for (let i = 0; i < 40; i++) {
        const date = new Date(Date.UTC(2026, 3, 23) + i * 86_400_000).toISOString().slice(0, 10); // 2026-04-23 .. 2026-05-31
        preWindow.push({ date, weightKg: 54 + i * 0.2, kcalConsumed: k * rmr + burnPerDay } as WellnessEntry);
      }
      const inWindow: WellnessEntry[] = [];
      for (let i = 0; i < windowDays; i++) {
        const date = new Date(Date.UTC(2026, 5, 1) + i * 86_400_000).toISOString().slice(0, 10); // cutoff = 2026-06-01
        inWindow.push({ date, weightKg: 62, kcalConsumed: k * rmr + burnPerDay } as WellnessEntry);
      }
      const activities = inWindow.map((w) => ({ date: w.date, activeBurnKcal: burnPerDay, kj: null, movingTimeSec: 0 }));
      return { wellness: [...preWindow, ...inWindow], activities };
    };

    it("a pre-window trend no longer distorts k once weigh-ins lapse, as long as the lapse is still inside the recency gate", () => {
      const { wellness, activities } = withPreWindowTrend(42, 1.2584, 1631, 1000);
      // Blank the trailing 12 in-window weigh-ins (keep kcalConsumed — intake logging stays current,
      // only body-weight logging lapsed). The most recent surviving weigh-in lands 13 days before
      // `today`, inside CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS (14) — recency alone must not be the thing
      // withholding this one; the window filter (fix part a) has to do the work.
      for (let i = wellness.length - 12; i < wellness.length; i++) wellness[i].weightKg = null;
      const r = calibrateNeat(wellness, activities, 1631, "2026-07-13", 42);
      expect(r).not.toBeNull();
      expect(r!.source).toBe("derived");
      expect(r!.confidence).toBe("high");
      // Unfiltered, the pre-window gaining block drags the anchored trend window back far enough to
      // pull the solve down to ~1.15 (verified against the unfixed code); filtered to [cutoff,
      // lastLoggedDate], the pre-window data never enters the regression and the true flat-weight k
      // (1.2584) comes back essentially exactly.
      expect(r!.multiplier).toBeGreaterThan(1.258);
      expect(r!.multiplier).toBeLessThan(1.259);
    });

    it("withholds rather than adopting a distorted high-confidence multiplier — the review's exact 21-day-lapse-plus-pre-window-trend scenario", () => {
      const { wellness, activities } = withPreWindowTrend(42, 1.2584, 1631, 1000);
      // Blank the trailing 20 in-window weigh-ins. The most recent surviving weigh-in lands 21 days
      // before `today` — past CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS (14). Pre-fix, this combination
      // derived k ≈ 1.157 at HIGH confidence (a fabricated ~165 kcal/day cut for an athlete whose
      // in-window data was perfectly consistent with the true 1.2584).
      for (let i = wellness.length - 20; i < wellness.length; i++) wellness[i].weightKg = null;
      const r = calibrateNeat(wellness, activities, 1631, "2026-07-13", 42);
      expect(r).toBeNull();
    });

    it("withholds once the most recent weigh-in is stale even when weigh-in count and logged coverage alone would clear HIGH confidence", () => {
      const { wellness, activities } = synth(1.3, 42, 1631, 1000);
      // Blank the trailing 20 days' weightKg only — kcalConsumed (and so loggedFraction) stays at
      // 100%. 22 weigh-ins survive, still comfortably above CALIBRATION_HIGH_MIN_WEIGH_INS (20), so
      // count and coverage alone would have cleared HIGH under the pre-fix gates (verified: the
      // equivalent scenario with only 12 days blanked, inside the recency gate, DOES clear HIGH — see
      // the "loggable-range coverage and staleness" tests above). Recency is the only thing failing.
      for (let i = wellness.length - 20; i < wellness.length; i++) wellness[i].weightKg = null;
      const r = calibrateNeat(wellness, activities, 1631, "2026-07-13", 42);
      expect(r).toBeNull();
    });

    it("CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS is exported and matches the documented value", () => {
      expect(CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS).toBe(14);
    });
  });
});

describe("calibrateNeatByDayType", () => {
  const RMR = 1631;

  // Synthetic athlete: TRUE k_rest = 1.53, TRUE k_train = 1.22, flat weight, so the identity is exact
  // and the test can assert the raw (pre-shrinkage) recovery of the day-type split.
  function synth(nRest: number, nTrain: number, kRest: number, kTrain: number, trainBurn = 1200) {
    const wellness: WellnessEntry[] = [];
    const activities: Array<{ date: string; activeBurnKcal: number | null; kj: number | null; movingTimeSec: number }> = [];
    let day = 0;
    for (let i = 0; i < nRest; i++, day++) {
      const date = new Date(Date.UTC(2026, 4, 1) + day * 86_400_000).toISOString().slice(0, 10);
      wellness.push({ date, weightKg: 62, kcalConsumed: kRest * RMR } as WellnessEntry);
    }
    for (let i = 0; i < nTrain; i++, day++) {
      const date = new Date(Date.UTC(2026, 4, 1) + day * 86_400_000).toISOString().slice(0, 10);
      wellness.push({ date, weightKg: 62, kcalConsumed: kTrain * RMR + trainBurn } as WellnessEntry);
      activities.push({ date, activeBurnKcal: trainBurn, kj: null, movingTimeSec: 0 });
    }
    return {
      wellness,
      activities,
      today: new Date(Date.UTC(2026, 4, 1) + day * 86_400_000).toISOString().slice(0, 10),
    };
  }

  it("recovers day-type-specific k when both subsets are well-sampled", () => {
    const { wellness, activities, today } = synth(20, 40, 1.53, 1.22);
    const r = calibrateNeatByDayType(wellness, activities, RMR, today, 90)!;
    // The 42-day POOLED window (unchanged calibrateNeat call) reaches back only to day18 of this
    // 60-day fixture, so it sees just the trailing 2 of the 20 rest days — it is itself almost pure
    // training-day signal (verified: pooled.multiplier ≈ 1.2348, not ≈ 1.375 as an even day-type mix
    // would suggest). At loggedDays=20, shrinkageWeight is 20/(20+12) = 0.625 — day-type dominant but
    // not overwhelming — so the blend (verified: ≈1.4193) lands meaningfully above pooled and above
    // the midpoint of [pooled, raw], but not all the way to the raw 1.53. Asserting against the
    // midpoint (rather than a hardcoded absolute figure) ties the bound to the actual pooled anchor
    // instead of a number that silently goes stale if the fixture or pooled's own logic changes.
    const midpoint = (r.pooled.multiplier + 1.53) / 2;
    expect(r.rest.multiplier).toBeGreaterThan(midpoint);
    expect(r.rest.multiplier).toBeGreaterThan(1.4);
    expect(r.train.multiplier).toBeLessThan(1.28);
    expect(r.shrinkageWeight.rest).toBeGreaterThan(0.6); // n=20 well above K=12
  });

  it("shrinks HARD toward pooled when the rest-day sample is thin", () => {
    const { wellness, activities, today } = synth(3, 40, 1.53, 1.22);
    const r = calibrateNeatByDayType(wellness, activities, RMR, today, 90)!;
    // n=3 rest days: weight = 3/(3+12) = 0.2 — mostly pooled, not the raw 1.53.
    expect(r.shrinkageWeight.rest).toBeCloseTo(3 / 15, 2);
    expect(r.rest.multiplier).toBeLessThan(1.53);
    expect(r.rest.multiplier).toBeGreaterThan(r.pooled.multiplier);
  });

  it("forces shrinkageWeight to 0 below DAY_TYPE_MIN_LOGGED_DAYS", () => {
    const { wellness, activities, today } = synth(2, 40, 1.53, 1.22);
    const r = calibrateNeatByDayType(wellness, activities, RMR, today, 90)!;
    expect(r.shrinkageWeight.rest).toBe(0);
    expect(r.rest.multiplier).toBe(r.pooled.multiplier);
  });

  it("imputes a subset's missing days at that subset's OWN logged mean, not the pooled mean", () => {
    const { wellness, activities, today } = synth(20, 40, 1.53, 1.22);
    // Blank every third rest day — absence should not pull k_rest toward the training-heavy pooled mean.
    let count = 0;
    for (const w of wellness) {
      if (!activities.some((a) => a.date === w.date)) {
        // a rest day
        count++;
        if (count % 3 === 0) w.kcalConsumed = null;
      }
    }
    const r = calibrateNeatByDayType(wellness, activities, RMR, today, 90)!;
    // 6 of 20 rest days blanked → loggedDays=14, weight=14/26≈0.538. The raw per-subset solve is
    // UNCHANGED by the blanking (it's the mean of whatever logged days remain, and every logged rest
    // day carries the same exact synthetic value), so the blend is ≈1.3937 — would instead collapse
    // toward the training-heavy pooled figure (≈1.235) if the missing days were imputed at the pooled
    // mean or at zero rather than this subset's own logged mean.
    expect(r.rest.multiplier).toBeGreaterThan(1.35);
  });

  it("returns null when the pooled calibration itself is insufficient", () => {
    const { wellness, activities, today } = synth(2, 2, 1.53, 1.22);
    expect(calibrateNeatByDayType(wellness, activities, RMR, today, 90)).toBeNull();
  });

  it("clamps an implausible raw subset solve and reports an ambiguous imbalance before blending", () => {
    // Rest-day intake wildly high relative to RMR alone — should clamp to NEAT_PLAUSIBLE_MAX pre-shrink.
    const { wellness, activities, today } = synth(20, 40, 2.5, 1.22);
    const r = calibrateNeatByDayType(wellness, activities, RMR, today, 90)!;
    expect(r.rest.imbalance).not.toBeNull();
    expect(r.rest.imbalance!.candidates.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------- Under-fueling streak alert (spec §10) ----------
describe("computeUnderfuelStreak / loggedDaysForStreak", () => {
  const TODAY = "2026-07-15";
  // cutoff (14 days back) = 2026-07-01; window is [2026-07-01, 2026-07-15).
  const wDay = (date: string, kcalConsumed: number | null): WellnessEntry => ({
    date, weightKg: 62, hrv: null, sleepHours: null, sleepQuality: null, kcalConsumed, ctl: null, atl: null,
  });
  const actFor = (date: string, activeBurnKcal: number | null, kj: number | null = null) => ({ date, activeBurnKcal, kj, movingTimeSec: 0 });

  it("pins the spec's constants verbatim", () => {
    expect(UNDERFUEL_RATIO_BELOW).toBe(0.95);
    expect(STREAK_ALERT_THRESHOLD).toBe(3);
    expect(STREAK_WINDOW_LOGGED_DAYS).toBe(7);
    expect(STREAK_MAX_LOOKBACK_DAYS).toBe(14);
    expect(STREAK_MIN_LOGGED_DAYS).toBe(4);
  });

  it("fires at exactly STREAK_ALERT_THRESHOLD (3) below-threshold days", () => {
    // DERIVED (rmr 1800, k 1.2) unbuffered maintenance on a rest day = 2160; 0.95× = 2052.
    const wellness = [
      wDay("2026-07-08", 1800), wDay("2026-07-09", 1800), wDay("2026-07-10", 1800), // below (ratio .833)
      wDay("2026-07-11", 2200), wDay("2026-07-12", 2200), wDay("2026-07-13", 2200), wDay("2026-07-14", 2200), // above
    ];
    const r = computeUnderfuelStreak(wellness, [], DERIVED, TODAY)!;
    expect(r.loggedDays).toBe(7);
    expect(r.daysBelowThreshold).toBe(3);
    expect(r.alert).toBe(true);
  });

  it("does NOT fire at one fewer (2) below-threshold days", () => {
    const wellness = [
      wDay("2026-07-08", 1800), wDay("2026-07-09", 1800), // below
      wDay("2026-07-10", 2200), wDay("2026-07-11", 2200), wDay("2026-07-12", 2200), wDay("2026-07-13", 2200), wDay("2026-07-14", 2200), // above
    ];
    const r = computeUnderfuelStreak(wellness, [], DERIVED, TODAY)!;
    expect(r.daysBelowThreshold).toBe(2);
    expect(r.alert).toBe(false);
  });

  it("batchy transfer: 2 logged days in the last calendar 7, but 7 total within the 14-day lookback — still evaluates all 7, not just the calendar week", () => {
    const wellness = [
      // older batch (outside the last 7 CALENDAR days, but inside the 14-day lookback)
      wDay("2026-07-01", 1800), // below — proves the old batch is actually read, not skipped
      wDay("2026-07-02", 2200), wDay("2026-07-03", 2200), wDay("2026-07-04", 2200), wDay("2026-07-05", 2200),
      // recent batch (inside the last 7 calendar days)
      wDay("2026-07-13", 2200), wDay("2026-07-14", 2200),
    ];
    const r = computeUnderfuelStreak(wellness, [], DERIVED, TODAY)!;
    expect(r.loggedDays).toBe(7); // all 7 logged days evaluated, not just the 2 recent ones
    expect(r.daysBelowThreshold).toBe(1);
    expect(r.alert).toBe(false);
  });

  it("nothing older than STREAK_MAX_LOOKBACK_DAYS (14) counts, even a severe deficit", () => {
    const wellness = [
      wDay("2026-06-30", 500), // 15 days before TODAY — one day past the lookback boundary
      wDay("2026-07-11", 2200), wDay("2026-07-12", 2200), wDay("2026-07-13", 2200), wDay("2026-07-14", 2200),
    ];
    const r = computeUnderfuelStreak(wellness, [], DERIVED, TODAY)!;
    expect(r.loggedDays).toBe(4); // the 06-30 entry excluded
    expect(r.daysBelowThreshold).toBe(0);
  });

  it("the lookback boundary is inclusive: exactly 14 days before today counts", () => {
    const wellness = [
      wDay("2026-07-01", 500), // exactly 14 days before TODAY — the cutoff itself
      wDay("2026-07-11", 2200), wDay("2026-07-12", 2200), wDay("2026-07-13", 2200), wDay("2026-07-14", 2200),
    ];
    const r = computeUnderfuelStreak(wellness, [], DERIVED, TODAY)!;
    expect(r.loggedDays).toBe(5);
    expect(r.daysBelowThreshold).toBe(1);
  });

  it("below the logged-day floor returns null — distinct from 'you're fine'", () => {
    const wellness = [wDay("2026-07-12", 2200), wDay("2026-07-13", 2200), wDay("2026-07-14", 2200)];
    expect(computeUnderfuelStreak(wellness, [], DERIVED, TODAY)).toBeNull();
    // loggedDaysForStreak still reports the count, so the UI can say "not enough transferred yet (3 of 4)".
    expect(loggedDaysForStreak(wellness, [], TODAY)).toBe(3);
  });

  it("today is never counted, even with a severe apparent deficit logged on it", () => {
    const wellness = [
      wDay("2026-07-10", 2200), wDay("2026-07-11", 2200), wDay("2026-07-12", 2200), wDay("2026-07-13", 2200),
      wDay(TODAY, 500), // today — still being logged; must not count
    ];
    const r = computeUnderfuelStreak(wellness, [], DERIVED, TODAY)!;
    expect(r.loggedDays).toBe(4);
    expect(r.daysBelowThreshold).toBe(0);
  });

  it("a logged 0 or negative kcalConsumed is treated as NOT logged", () => {
    const wellness = [
      wDay("2026-07-10", 0), wDay("2026-07-09", -50),
      wDay("2026-07-11", 2200), wDay("2026-07-12", 2200), wDay("2026-07-13", 2200), wDay("2026-07-14", 2200),
    ];
    const r = computeUnderfuelStreak(wellness, [], DERIVED, TODAY)!;
    expect(r.loggedDays).toBe(4);
  });

  it("legacy model: unbuffered need is baseCalories, uniformly — NOT the flat restDayTarget on a rest day (no D1 asymmetry resurrected)", () => {
    // LEGACY: baseCalories 2000, restDayTarget 2600. If restDayTarget (a REST-day-only figure in the
    // old two-branch formula) leaked in here, 0.95×2600=2470 would read 1950 as a severe deficit; using
    // baseCalories uniformly (0.95×2000=1900), 1950 is just barely ABOVE the line.
    const wellness = [
      wDay("2026-07-11", 1950), wDay("2026-07-12", 1950), wDay("2026-07-13", 1950), wDay("2026-07-14", 1899),
    ];
    const r = computeUnderfuelStreak(wellness, [], LEGACY, TODAY)!;
    expect(r.daysBelowThreshold).toBe(1); // only the 1899 day (ratio .9495) is below .95
  });

  it("adds the day's active burn into the unbuffered need on both models", () => {
    const activities = [actFor("2026-07-14", 500)];
    // derived: (1.2×1800)+500=2660; 0.95×=2527 → 2500 below, 2600 (elsewhere) not.
    const wellness = [
      wDay("2026-07-11", 2200), wDay("2026-07-12", 2200), wDay("2026-07-13", 2200), // rest days, comfortably above
      wDay("2026-07-14", 2500), // training day: below its OWN higher bar
    ];
    const r = computeUnderfuelStreak(wellness, activities, DERIVED, TODAY)!;
    expect(r.daysBelowThreshold).toBe(1);
  });

  it("excludes a day whose only activity has an unresolvable burn, rather than zeroing it", () => {
    const activities = [actFor("2026-07-10", null, null)]; // neither activeBurnKcal nor kj
    const wellness = [
      wDay("2026-07-08", 2200), wDay("2026-07-09", 2200),
      wDay("2026-07-10", 500), // unresolvable burn day — must be excluded entirely, not counted as a deficit
      wDay("2026-07-11", 2200), wDay("2026-07-12", 2200),
    ];
    const r = computeUnderfuelStreak(wellness, activities, DERIVED, TODAY)!;
    expect(r.loggedDays).toBe(4); // the unresolved day dropped, not folded in at burn 0
    expect(r.daysBelowThreshold).toBe(0);
  });

  it("still reads a genuine rest day (no activity at all) at burn 0", () => {
    const wellness = [
      wDay("2026-07-11", 1800), wDay("2026-07-12", 2200), wDay("2026-07-13", 2200), wDay("2026-07-14", 2200),
    ];
    const r = computeUnderfuelStreak(wellness, [], DERIVED, TODAY)!;
    expect(r.loggedDays).toBe(4);
    expect(r.daysBelowThreshold).toBe(1); // the 1800 day, vs plain maintenance (no burn)
  });

  it("uses each historical day's rest or training model", () => {
    const restModel: NutritionModel = { ...DERIVED, neatMultiplier: 1.5 };
    const trainModel: NutritionModel = { ...DERIVED, neatMultiplier: 1.2 };
    const wellness = [
      wDay("2026-07-11", 2500), wDay("2026-07-12", 2600), wDay("2026-07-13", 2600),
      wDay("2026-07-14", 2600),
    ];
    const activities = [actFor("2026-07-14", 500)];

    const resolved = computeUnderfuelStreak(
      wellness,
      activities,
      (isRestDay) => isRestDay ? restModel : trainModel,
      TODAY
    )!;

    expect(resolved.daysBelowThreshold).toBe(1);
    expect(computeUnderfuelStreak(wellness, activities, restModel, TODAY)!.daysBelowThreshold).toBe(2);
  });

  it("evaluates the MOST RECENT up to STREAK_WINDOW_LOGGED_DAYS (7) when more logged days exist in the lookback", () => {
    const wellness = [
      // oldest 3 — excluded once 7 more-recent logged days exist; severely low so a bug that includes
      // them would flip daysBelowThreshold
      wDay("2026-07-01", 1000), wDay("2026-07-02", 1000), wDay("2026-07-03", 1000),
      // most recent 7 — all comfortably above the line
      wDay("2026-07-04", 2200), wDay("2026-07-05", 2200), wDay("2026-07-06", 2200), wDay("2026-07-07", 2200),
      wDay("2026-07-08", 2200), wDay("2026-07-09", 2200), wDay("2026-07-10", 2200),
    ];
    const r = computeUnderfuelStreak(wellness, [], DERIVED, TODAY)!;
    expect(r.loggedDays).toBe(7);
    expect(r.daysBelowThreshold).toBe(0);
    expect(loggedDaysForStreak(wellness, [], TODAY)).toBe(7); // capped, even though 10 exist
  });
});

describe("buildNutritionReferenceRows (DT Task 2 — per-row day-type resolution)", () => {
  const defaultNeat: NeatCalibration = {
    multiplier: DEFAULT_NEAT_MULTIPLIER, confidence: "low", source: "default",
    windowDays: null, loggedDays: null, weighIns: null, solvedAt: null, imbalance: null, stale: false,
  };
  const pooled: NeatCalibration = {
    ...defaultNeat, multiplier: 1.28, confidence: "high", source: "derived",
    windowDays: 42, loggedDays: 40, weighIns: 20, solvedAt: "2026-07-01T00:00:00.000Z",
  };
  const dayTypeNeat: DayTypeNeat = {
    rest: { ...pooled, multiplier: 1.47, windowDays: 90, loggedDays: 20 },
    train: { ...pooled, multiplier: 1.22, windowDays: 90, loggedDays: 40 },
    pooled,
    shrinkageWeight: { rest: 0.6, train: 0.9 },
  };
  const profileWith = (dtn: DayTypeNeat | null) =>
    ({
      performance: {
        ftp: 250, maxHr: 190, thresholdHr: 170, weightKg: 75,
        weeklyHoursMin: 6, weeklyHoursMax: 10,
        dateOfBirth: "1996-03-14", heightCm: 180, sex: "male",
      },
      nutrition: {
        baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 78, targetRateKgPerWeek: null,
        neat: pooled, dayTypeNeat: dtn,
      },
    }) as unknown as AthleteProfile;

  it("gives the Rest row and a training row genuinely different maintenance once dayTypeNeat is adopted", () => {
    const rmr = restingMetabolicRate(62, 180, 30, "male");
    const rows = buildNutritionReferenceRows(profileWith(dayTypeNeat), 62, "2026-07-30", 250, 0);
    const restRow = rows.find((r) => r.type === "Rest")!;
    const z2Row = rows.find((r) => r.type === "Z2" && r.durationMin === 60)!;
    // Rest row's estBurnKcal is 0, so its maintenance IS the rest-day-multiplier figure directly.
    expect(restRow.plan.maintenanceKcal).toBe(Math.round(dayTypeNeat.rest.multiplier * rmr));
    expect(z2Row.plan.maintenanceKcal).toBe(Math.round(dayTypeNeat.train.multiplier * rmr + z2Row.estBurnKcal));
    // The whole point of the split: these must actually differ, not just both equal pooled.
    expect(restRow.plan.maintenanceKcal).not.toBe(Math.round(dayTypeNeat.train.multiplier * rmr));
  });

  it("falls back to one shared flat multiplier across every row when dayTypeNeat is null — no regression", () => {
    const rmr = restingMetabolicRate(62, 180, 30, "male");
    const rows = buildNutritionReferenceRows(profileWith(null), 62, "2026-07-30", 250, 0);
    const restRow = rows.find((r) => r.type === "Rest")!;
    const z2Row = rows.find((r) => r.type === "Z2" && r.durationMin === 60)!;
    expect(restRow.plan.maintenanceKcal).toBe(Math.round(pooled.multiplier * rmr));
    expect(z2Row.plan.maintenanceKcal).toBe(Math.round(pooled.multiplier * rmr + z2Row.estBurnKcal));
  });
});
