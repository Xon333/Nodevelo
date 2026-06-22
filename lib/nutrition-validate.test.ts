import { describe, expect, it } from "vitest";
import { parseDailyIntakeKcal, validateNutrition } from "./nutrition-validate";
import { calculateDailyTarget, estimateWorkoutBurnKcal, type AthleteNutritionConfig } from "./nutrition";
import type { PlannedDay, WorkoutType } from "./types";

const config: AthleteNutritionConfig = {
  baseCalories: 2000,
  restDayTarget: 2600,
  buffer: 300,
  weight: 75,
  targetWeight: 73,
};
const FTP = 250;
const TREND = 0; // stable weight → buffer unchanged

const day = (type: WorkoutType, durationMin: number, description: string): PlannedDay => ({
  date: "2026-07-01",
  weekNumber: 1,
  weekTheme: "Base",
  name: `${type} session`,
  type,
  durationMin,
  workoutText: "",
  description,
});

// The figure the model is supposed to copy, for a given day.
const correctIntake = (type: WorkoutType, durationMin: number) =>
  calculateDailyTarget(estimateWorkoutBurnKcal(type, durationMin, FTP), type === "Rest", config, TREND, {
    type,
    durationMin,
  }).dailyTarget;

describe("parseDailyIntakeKcal", () => {
  it("parses the labelled figure across formatting variants", () => {
    expect(parseDailyIntakeKcal("Daily intake: 2600 kcal")).toBe(2600);
    expect(parseDailyIntakeKcal("Daily intake: ~2,850 kcal")).toBe(2850);
    expect(parseDailyIntakeKcal("Daily target 3100kcal")).toBe(3100);
  });

  it("returns null when there is no daily-intake line", () => {
    expect(parseDailyIntakeKcal("Intent: easy spin. Pre-ride: 75g.")).toBeNull();
  });
});

describe("validateNutrition (CR-F)", () => {
  it("passes when the stated intake matches the deterministic formula", () => {
    const z2 = correctIntake("Z2", 120);
    const warnings = validateNutrition([day("Z2", 120, `Intent: aerobic. Daily intake: ${z2} kcal`)], config, FTP, TREND);
    expect(warnings).toEqual([]);
  });

  it("flags an invented daily intake", () => {
    const warnings = validateNutrition(
      [day("Z2", 120, "Intent: aerobic. Daily intake: 4200 kcal")],
      config,
      FTP,
      TREND
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/differs from the computed/);
    expect(warnings[0]).toContain("4200");
  });

  it("does not flag a small rounding / closest-row difference", () => {
    const z2 = correctIntake("Z2", 120);
    const warnings = validateNutrition(
      [day("Z2", 120, `Daily intake: ${z2 + 120} kcal`)], // within tolerance
      config,
      FTP,
      TREND
    );
    expect(warnings).toEqual([]);
  });

  it("skips days with no daily-intake line", () => {
    expect(validateNutrition([day("Z2", 90, "Intent: spin. Pre-ride: 75g")], config, FTP, TREND)).toEqual([]);
  });

  it("validates rest-day targets too", () => {
    const warnings = validateNutrition([day("Rest", 0, "Rest. Daily intake: 3500 kcal")], config, FTP, TREND);
    expect(warnings).toHaveLength(1); // restDayTarget is 2600, 3500 is invented
  });
});
