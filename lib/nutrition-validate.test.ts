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
describe("day-type resolver (DT Task 2b)", () => {
  // Two deliberately DIVERGENT models — mirrors k_rest vs k_train once calibrateNeatByDayType has
  // adopted a real split. A single-model check (the old signature) MUST trip on at least one of these
  // two days; a day-type-aware resolver must trip on neither.
  const REST_MODEL: NutritionModel = { kind: "derived", rmr: 1630, neatMultiplier: 1.6, weightKg: 62, targetWeightKg: 63, buffer: 60 };
  const TRAIN_MODEL: NutritionModel = { kind: "derived", rmr: 1630, neatMultiplier: 1.2, weightKg: 62, targetWeightKg: 63, buffer: 60 };
  const resolver = (isRestDay: boolean) => (isRestDay ? REST_MODEL : TRAIN_MODEL);

  const restIntake = calculateDailyTarget(0, REST_MODEL, 60, true).dailyTarget;
  const trainIntake = calculateDailyTarget(estimateWorkoutBurnKcal("Z2", 90, FTP), TRAIN_MODEL, 60, false, { type: "Z2", durationMin: 90 }).dailyTarget;

  it("validates a mixed rest+training block correctly when given a resolver", () => {
    const days = [
      day("Rest", 0, `Recovery. Daily intake: ${restIntake} kcal`),
      day("Z2", 90, `Intent: aerobic. Daily intake: ${trainIntake} kcal`),
    ];
    expect(validateNutrition(days, resolver, FTP, 60)).toEqual([]);
  });

  it("proves the bug this fixes: the SAME two days flag under the old single-model behaviour", () => {
    const days = [
      day("Rest", 0, `Recovery. Daily intake: ${restIntake} kcal`),
      day("Z2", 90, `Intent: aerobic. Daily intake: ${trainIntake} kcal`),
    ];
    // Passing a bare model (today's model, whichever day type "today" happens to be) is exactly what
    // the generate route did before this fix — validating every day in the block against one figure.
    expect(validateNutrition(days, REST_MODEL, FTP, 60).length).toBeGreaterThan(0);
    expect(validateNutrition(days, TRAIN_MODEL, FTP, 60).length).toBeGreaterThan(0);
  });

  it("repairs each day against its OWN day-type model, not a shared one", () => {
    const days = [
      day("Rest", 0, `Recovery. Daily intake: ${restIntake + 1000} kcal`), // wrong on purpose
      day("Z2", 90, `Intent: aerobic. Daily intake: ${trainIntake} kcal`), // already correct
    ];
    const { days: repaired, repairs } = repairNutrition(days, resolver, FTP, 60);
    expect(repairs).toHaveLength(1);
    expect(repaired[0].description).toContain(`${restIntake} kcal`);
    expect(repaired[1].description).toContain(`${trainIntake} kcal`); // untouched, was already right
  });

  it("a bare NutritionModel (every existing caller) still works exactly as before", () => {
    const z2 = correctIntake("Z2", 120);
    expect(validateNutrition([day("Z2", 120, `Daily intake: ${z2} kcal`)], MODEL, FTP, BUFFER_APPLIED)).toEqual([]);
  });
});

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
