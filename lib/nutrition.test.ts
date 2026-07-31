import { describe, expect, it } from "vitest";
import {
  activeBurn,
  adjustBuffer,
  balanceLevel,
  calculateDailyTarget,
  calibrateNeat,
  CALIBRATION_MAX_WEIGHIN_LAPSE_DAYS,
  computeEnergyAvailability,
  desiredWeightTrend,
  eaLevel,
  estimateWorkoutBurnKcal,
  inRideCarbTarget,
  NEAT_PLAUSIBLE_MAX,
  NEAT_PLAUSIBLE_MIN,
  preRideCarbTarget,
  resolveNutritionModel,
  restingMetabolicRate,
  DEFAULT_NEAT_MULTIPLIER,
  smoothedCurrentWeightKg,
  weightTrendFromWellness,
  weightTrendPreciseFromWellness,
  type NutritionModel,
} from "./nutrition";
import type { AthleteProfile, WellnessEntry, WorkoutType } from "./types";


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

const DERIVED: NutritionModel = {
  kind: "derived",
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
      weightKg: 62, targetWeightKg: 63, buffer: -500 };
    const p = calculateDailyTarget(0, m, -500, true);
    expect(p.dailyTarget).toBeGreaterThanOrEqual(1631);
    expect(p.floored).toBe(true);
  });

  it("does not floor a normal day", () => {
    const m: NutritionModel = { kind: "derived", rmr: 1631, neatMultiplier: 1.3,
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
  const ride = (date: string, kj: number) => ({ date, kj, activeBurnKcal: null });

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
      { date: "2026-06-10", kj: 1200, activeBurnKcal: null },
      { date: "2026-06-11", kj: 1200, activeBurnKcal: null },
      { date: "2026-06-12", kj: 1200, activeBurnKcal: null },
      { date: "2026-06-13", kj: null, activeBurnKcal: null }, // unresolved — NOT a rest day
      { date: "2026-06-14", kj: 1200, activeBurnKcal: null },
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
      profile({ dateOfBirth: "1996-03-14", heightCm: 180, sex: "male" }), 74, "2026-07-30"
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
    expect(resolveNutritionModel(p, 74, "2026-07-30").kind).toBe("legacy");
  });

  it("stays legacy when only some inputs are present", () => {
    expect(resolveNutritionModel(profile({ heightCm: 180 }), 74, "2026-07-30").kind).toBe("legacy");
  });

  it("stays legacy when the date of birth cannot yield a plausible age", () => {
    const m = resolveNutritionModel(
      profile({ dateOfBirth: "not-a-date", heightCm: 180, sex: "male" }), 74, "2026-07-30"
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
    const m = resolveNutritionModel(p, 62, "2026-07-30");
    expect(m.kind).toBe("derived");
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.neatMultiplier).toBe(1.3);
  });

  it("falls back to the default when nothing has been adopted", () => {
    const m = resolveNutritionModel(profileWith({}), 62, "2026-07-30");
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.neatMultiplier).toBe(DEFAULT_NEAT_MULTIPLIER);
  });

  // The gotcha this project has already been bitten by: a profile JSON written before `neat` existed
  // parses it back as `undefined`, which `=== null` (or a bare, non-optional-chained read) would miss.
  it("falls back to the default when neat is undefined, not just null", () => {
    const p = profileWith({});
    delete (p.nutrition as unknown as Record<string, unknown>).neat;
    const m = resolveNutritionModel(p, 62, "2026-07-30");
    if (m.kind !== "derived") throw new Error("unreachable");
    expect(m.neatMultiplier).toBe(DEFAULT_NEAT_MULTIPLIER);
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
    const activities = wellness.map((w) => ({ date: w.date, activeBurnKcal: burnPerDay, kj: null }));
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
      const activities: Array<{ date: string; activeBurnKcal: number | null; kj: number | null }> =
        baseActivities.map((a) => ({ ...a }));
      // One mid-window day's burn is unresolvable (no activeBurnKcal AND no kj) — it must drop out of
      // sumBurn AND out of N, or the k·RMR term counts a day whose burn was never actually summed,
      // which is the ~1.5% imbalance the Task 3 implementer flagged.
      activities[20] = { date: activities[20].date, activeBurnKcal: null, kj: null };
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
      const activities = inWindow.map((w) => ({ date: w.date, activeBurnKcal: burnPerDay, kj: null }));
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
