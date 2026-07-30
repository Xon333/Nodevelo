import { describe, expect, it } from "vitest";
import { parseDailyIntakeKcal, repairNutrition, validateNutrition } from "./nutrition-validate";
import { calculateDailyTarget, estimateWorkoutBurnKcal, type NutritionModel } from "./nutrition";
import type { PlannedDay, WorkoutType } from "./types";

const MODEL: NutritionModel = {
  kind: "legacy",
  baseCalories: 2000,
  restDayTarget: 2600,
  weightKg: 75,
  targetWeightKg: 78,
  buffer: 300,
};
const FTP = 250;
const BUFFER_APPLIED = 300;

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
  calculateDailyTarget(estimateWorkoutBurnKcal(type, durationMin, FTP), MODEL, BUFFER_APPLIED, type === "Rest", {
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
    const warnings = validateNutrition([day("Z2", 120, `Intent: aerobic. Daily intake: ${z2} kcal`)], MODEL, FTP, BUFFER_APPLIED);
    expect(warnings).toEqual([]);
  });

  it("flags an invented daily intake", () => {
    const warnings = validateNutrition(
      [day("Z2", 120, "Intent: aerobic. Daily intake: 4200 kcal")],
      MODEL,
      FTP,
      BUFFER_APPLIED
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/differs from the computed/);
    expect(warnings[0]).toContain("4200");
  });

  it("does not flag a small rounding / closest-row difference", () => {
    const z2 = correctIntake("Z2", 120);
    const warnings = validateNutrition(
      [day("Z2", 120, `Daily intake: ${z2 + 120} kcal`)], // within tolerance
      MODEL,
      FTP,
      BUFFER_APPLIED
    );
    expect(warnings).toEqual([]);
  });

  it("skips days with no daily-intake line", () => {
    expect(validateNutrition([day("Z2", 90, "Intent: spin. Pre-ride: 75g")], MODEL, FTP, BUFFER_APPLIED)).toEqual([]);
  });

  it("validates rest-day targets too", () => {
    const warnings = validateNutrition([day("Rest", 0, "Rest. Daily intake: 3500 kcal")], MODEL, FTP, BUFFER_APPLIED);
    expect(warnings).toHaveLength(1); // restDayTarget is 2600, 3500 is invented
  });
});

// P3a (2026-07-24 block-generation redesign): the correct figure is always known — a mismatch has no
// ambiguity to preserve, so auto-correct it instead of only flagging it.
describe("repairNutrition (P3a)", () => {
  it("leaves a matching day untouched", () => {
    const z2 = correctIntake("Z2", 120);
    const d = day("Z2", 120, `Intent: aerobic. Daily intake: ${z2} kcal`);
    const result = repairNutrition([d], MODEL, FTP, BUFFER_APPLIED);
    expect(result.days[0]).toBe(d); // same reference — nothing rewritten
    expect(result.repairs).toEqual([]);
  });

  it("overwrites an invented figure with the correct one, preserving the surrounding text", () => {
    const z2 = correctIntake("Z2", 120);
    const d = day("Z2", 120, "Intent: aerobic. Daily intake: 4200 kcal. Pre-ride: 90g.");
    const result = repairNutrition([d], MODEL, FTP, BUFFER_APPLIED);
    expect(result.days[0].description).toBe(`Intent: aerobic. Daily intake: ${z2} kcal. Pre-ride: 90g.`);
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0]).toMatch(/auto-corrected daily intake 4200 kcal/);
    expect(result.repairs[0]).toContain(String(z2));
  });

  it("does not touch a day within tolerance", () => {
    const z2 = correctIntake("Z2", 120);
    const d = day("Z2", 120, `Daily intake: ${z2 + 120} kcal`); // within tolerance, per validateNutrition's own test
    const result = repairNutrition([d], MODEL, FTP, BUFFER_APPLIED);
    expect(result.days[0]).toBe(d);
    expect(result.repairs).toEqual([]);
  });

  it("skips days with no daily-intake line", () => {
    const d = day("Z2", 90, "Intent: spin. Pre-ride: 75g");
    const result = repairNutrition([d], MODEL, FTP, BUFFER_APPLIED);
    expect(result.days[0]).toBe(d);
    expect(result.repairs).toEqual([]);
  });

  it("running validateNutrition on the repaired days finds nothing left to flag", () => {
    const d = day("Z2", 120, "Daily intake: 4200 kcal");
    const { days } = repairNutrition([d], MODEL, FTP, BUFFER_APPLIED);
    expect(validateNutrition(days, MODEL, FTP, BUFFER_APPLIED)).toEqual([]);
  });
});
