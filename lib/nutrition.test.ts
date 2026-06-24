import { describe, expect, it } from "vitest";
import {
  adjustBuffer,
  calculateDailyTarget,
  estimateWorkoutBurnKcal,
  inRideCarbTarget,
  preRideCarbTarget,
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

describe("adjustBuffer", () => {
  it("keeps the buffer when weight is stable (within ±0.3 kg)", () => {
    expect(adjustBuffer(300, 0).bufferApplied).toBe(300);
    expect(adjustBuffer(300, -0.3).bufferApplied).toBe(300);
    expect(adjustBuffer(300, 0.3).bufferApplied).toBe(300);
  });

  it("adds 150 kcal when losing more than 0.3 kg over 7 days", () => {
    const result = adjustBuffer(300, -0.5);
    expect(result.bufferApplied).toBe(450);
    expect(result.delta).toBe(150);
    expect(result.reason).toMatch(/losing too fast/);
  });

  it("removes 150 kcal when gaining more than 0.3 kg over 7 days", () => {
    const result = adjustBuffer(300, 0.5);
    expect(result.bufferApplied).toBe(150);
    expect(result.delta).toBe(-150);
    expect(result.reason).toMatch(/gaining too fast/);
  });

  it("caps the buffer between 0 and 600 kcal", () => {
    expect(adjustBuffer(550, -1.0).bufferApplied).toBe(600);
    expect(adjustBuffer(50, 1.0).bufferApplied).toBe(0);
    expect(adjustBuffer(550, -1.0).reason).toMatch(/Capped/);
  });
});

describe("calculateDailyTarget", () => {
  it("uses the flat rest day target with no buffer or ride carbs", () => {
    const plan = calculateDailyTarget(0, true, config, 0);
    expect(plan).toEqual({
      dailyTarget: 2600,
      preRideCarbs: 0,
      inRideCarbsPerHour: 0,
      postRideCarbs: 0,
      postRideProtein: 0,
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

  it("scales post-ride targets to body weight", () => {
    const plan = calculateDailyTarget(500, false, config, 0);
    expect(plan.postRideCarbs).toBe(85); // 1.1 g/kg × 75 kg, rounded to 5 g
    expect(plan.postRideProtein).toBe(30);
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
    soreness: null,
    fatigue: null,
    stress: null,
    mood: null,
    motivation: null,
    injury: null,
  });

  it("returns the change between the latest weigh-in and ~7 days prior", () => {
    const trend = weightTrendFromWellness([
      entry("2026-06-01", 75.2),
      entry("2026-06-05", 75.0),
      entry("2026-06-08", 74.6),
    ]);
    expect(trend).toBe(-0.6); // 74.6 (Jun 8) vs 75.2 (Jun 1, 7 days back)
  });

  it("returns null when there is no weigh-in 4–10 days before the latest", () => {
    expect(weightTrendFromWellness([entry("2026-06-08", 74.6)])).toBeNull();
    expect(
      weightTrendFromWellness([entry("2026-06-07", 75.0), entry("2026-06-08", 74.6)])
    ).toBeNull();
  });

  it("ignores entries without weight", () => {
    const trend = weightTrendFromWellness([
      entry("2026-06-01", 75.0),
      entry("2026-06-07", null),
      entry("2026-06-08", 74.5),
    ]);
    expect(trend).toBe(-0.5);
  });
});
