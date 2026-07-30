import { describe, expect, it } from "vitest";
import {
  activeBurn,
  adjustBuffer,
  balanceLevel,
  calculateDailyTarget,
  computeEnergyAvailability,
  desiredWeightTrend,
  eaLevel,
  estimateWorkoutBurnKcal,
  inRideCarbTarget,
  preRideCarbTarget,
  restingMetabolicRate,
  DEFAULT_NEAT_MULTIPLIER,
  weightTrendFromWellness,
  type AthleteNutritionConfig,
} from "./nutrition";
import type { WellnessEntry } from "./types";

const config: AthleteNutritionConfig = {
  baseCalories: 2000,
  restDayTarget: 2600,
  buffer: 300,
  weight: 75,
  targetWeight: 72,
};

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

describe("calculateDailyTarget", () => {
  it("uses the flat rest day target with no buffer or ride carbs", () => {
    const plan = calculateDailyTarget(0, true, config, 0);
    expect(plan).toEqual({
      dailyTarget: 2600,
      preRideCarbs: 0,
      inRideCarbsPerHour: 0,
      bufferApplied: 0,
    });
  });

  it("sums base + activity burn + buffer on training days", () => {
    const plan = calculateDailyTarget(700, false, config, 0);
    expect(plan.dailyTarget).toBe(3000); // 2000 + 700 + 300
    expect(plan.bufferApplied).toBe(300);
  });

  it("applies the weight-adjusted buffer to the daily target", () => {
    const plan = calculateDailyTarget(700, false, config, -0.5);
    expect(plan.bufferApplied).toBe(450);
    expect(plan.dailyTarget).toBe(3150); // 2000 + 700 + 450
  });

  it("fills pre/in-ride carbs from the workout context", () => {
    const plan = calculateDailyTarget(900, false, config, 0, { type: "Z2", durationMin: 150 });
    expect(plan.inRideCarbsPerHour).toBe(75);
    expect(plan.preRideCarbs).toBe(115); // 1.5 g/kg (long ride) × 75 kg, rounded to 5 g
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
