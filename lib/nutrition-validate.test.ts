import { describe, expect, it } from "vitest";
import { parseDailyIntakeKcal, parseInRideCarbsGPerHour, parsePreRideCarbsG, repairNutrition, validateNutrition } from "./nutrition-validate";
import { calculateDailyTarget, estimateWorkoutBurnKcal, inRideCarbTarget, preRideCarbTarget, type NutritionModel } from "./nutrition";
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

// The pre-ride/in-ride figures the model is supposed to copy, for a given day — same reference-table
// formulas the validator itself checks against, so a test never hand-computes a number that could drift
// from the real formula (the float-boundary trap: preRideCarbTarget's own roundTo(_, 5) can flip on a
// hand-calculated .x5 case in ways a direct call never will).
const correctPreRide = (type: WorkoutType, durationMin: number) => preRideCarbTarget(durationMin, type, MODEL.weightKg);
const correctInRide = (type: WorkoutType, durationMin: number) => inRideCarbTarget(durationMin, type);

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
  const REST_MODEL: NutritionModel = { kind: "derived", rmr: 1630, neatMultiplier: 1.6, restingKcalPerHour: 0, weightKg: 62, targetWeightKg: 63, buffer: 60 };
  const TRAIN_MODEL: NutritionModel = { kind: "derived", rmr: 1630, neatMultiplier: 1.2, restingKcalPerHour: 0, weightKg: 62, targetWeightKg: 63, buffer: 60 };
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
    // Pre-ride is deliberately already CORRECT here (not 90g, an arbitrary leftover) so this test stays
    // scoped to the kcal repair alone — pre-ride/in-ride repair get their own tests below.
    const preRide = correctPreRide("Z2", 120);
    const d = day("Z2", 120, `Intent: aerobic. Daily intake: 4200 kcal. Pre-ride: ${preRide}g.`);
    const result = repairNutrition([d], MODEL, FTP, BUFFER_APPLIED);
    expect(result.days[0].description).toBe(`Intent: aerobic. Daily intake: ${z2} kcal. Pre-ride: ${preRide}g.`);
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

describe("parsePreRideCarbsG", () => {
  it("parses the labelled figure across formatting variants", () => {
    expect(parsePreRideCarbsG("Pre-ride: 75g")).toBe(75);
    expect(parsePreRideCarbsG("Pre-ride: ~110g")).toBe(110);
    expect(parsePreRideCarbsG("Pre-ride carbs: 1,150g")).toBe(1150); // comma tolerance, mirrors the kcal parser
    expect(parsePreRideCarbsG("Pre-ride 90 grams")).toBe(90);
  });

  it("returns null when there is no pre-ride line (e.g. a rest day)", () => {
    expect(parsePreRideCarbsG("Rest. Daily intake: 2600 kcal.")).toBeNull();
  });
});

describe("parseInRideCarbsGPerHour", () => {
  it("parses the labelled figure across formatting variants", () => {
    expect(parseInRideCarbsGPerHour("In-ride: 75g/hr")).toBe(75);
    expect(parseInRideCarbsGPerHour("In-ride: ~90 g/hr")).toBe(90);
    expect(parseInRideCarbsGPerHour("In-ride carbs: 38 grams/hr")).toBe(38);
  });

  it("returns null when there is no in-ride line (e.g. a short ride or rest day)", () => {
    expect(parseInRideCarbsGPerHour("Intent: easy spin. Pre-ride: 75g. Daily intake: 2600 kcal.")).toBeNull();
  });
});

describe("validateNutrition — pre-ride/in-ride carbs", () => {
  it("passes when both carb figures match the deterministic formula", () => {
    const preRide = correctPreRide("Z2", 120);
    const inRide = correctInRide("Z2", 120);
    const kcal = correctIntake("Z2", 120);
    const warnings = validateNutrition(
      [day("Z2", 120, `Intent: aerobic. Pre-ride: ${preRide}g. In-ride: ${inRide}g/hr. Daily intake: ${kcal} kcal`)],
      MODEL,
      FTP,
      BUFFER_APPLIED
    );
    expect(warnings).toEqual([]);
  });

  it("flags an invented pre-ride figure without touching an already-correct in-ride/kcal", () => {
    const inRide = correctInRide("Z2", 120);
    const kcal = correctIntake("Z2", 120);
    const warnings = validateNutrition(
      [day("Z2", 120, `Pre-ride: 300g. In-ride: ${inRide}g/hr. Daily intake: ${kcal} kcal`)],
      MODEL,
      FTP,
      BUFFER_APPLIED
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/stated pre-ride carbs 300g differs from the computed/);
  });

  it("flags an invented in-ride figure without touching an already-correct pre-ride/kcal", () => {
    const preRide = correctPreRide("Z2", 120);
    const kcal = correctIntake("Z2", 120);
    const warnings = validateNutrition(
      [day("Z2", 120, `Pre-ride: ${preRide}g. In-ride: 400g/hr. Daily intake: ${kcal} kcal`)],
      MODEL,
      FTP,
      BUFFER_APPLIED
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/stated in-ride carbs 400g\/hr differs from the computed/);
  });

  it("does not flag a missing in-ride line on a short ride (<= 60 min) where none is expected", () => {
    const preRide = correctPreRide("Z2", 45);
    const kcal = correctIntake("Z2", 45);
    // No In-ride line at all — correct, since inRideCarbTarget("Z2", 45) is 0 for a sub-60-min ride.
    const warnings = validateNutrition([day("Z2", 45, `Pre-ride: ${preRide}g. Daily intake: ${kcal} kcal`)], MODEL, FTP, BUFFER_APPLIED);
    expect(warnings).toEqual([]);
  });

  it("does not flag missing pre-ride/in-ride lines on a Rest day", () => {
    const kcal = correctIntake("Rest", 0);
    const warnings = validateNutrition([day("Rest", 0, `Rest. Daily intake: ${kcal} kcal`)], MODEL, FTP, BUFFER_APPLIED);
    expect(warnings).toEqual([]);
  });

  it("does not flag missing pre-ride/in-ride lines on a Strength day", () => {
    const kcal = correctIntake("Strength", 45);
    const warnings = validateNutrition([day("Strength", 45, `Strength session. Daily intake: ${kcal} kcal`)], MODEL, FTP, BUFFER_APPLIED);
    expect(warnings).toEqual([]);
  });

  it("threads a day-type resolver through the pre-ride check the same way the kcal check already does", () => {
    // Two models differing only in weightKg — pre-ride is the one figure that actually depends on it, so
    // this proves the resolver is consulted rather than a single shared model, mirroring the existing
    // "day-type resolver (DT Task 2b)" kcal coverage above.
    const REST_W: NutritionModel = { kind: "legacy", baseCalories: 2000, restDayTarget: 2600, weightKg: 60, targetWeightKg: 63, buffer: 60 };
    const TRAIN_W: NutritionModel = { kind: "legacy", baseCalories: 2000, restDayTarget: 2600, weightKg: 80, targetWeightKg: 63, buffer: 60 };
    const resolver = (isRestDay: boolean) => (isRestDay ? REST_W : TRAIN_W);
    const trainPreRide = preRideCarbTarget(120, "Z2", TRAIN_W.weightKg);
    const days = [day("Z2", 120, `Pre-ride: ${trainPreRide}g`)];

    expect(validateNutrition(days, resolver, FTP, BUFFER_APPLIED)).toEqual([]);
    // The same stated figure checked against the wrong (rest) model's weight should trip — proving the
    // resolver's weight is actually what the check used above, not a coincidence.
    expect(validateNutrition(days, REST_W, FTP, BUFFER_APPLIED).some((w) => /pre-ride carbs/.test(w))).toBe(true);
  });
});

describe("repairNutrition — pre-ride/in-ride carbs", () => {
  it("auto-corrects an invented pre-ride figure, preserving surrounding text", () => {
    const preRide = correctPreRide("Z2", 120);
    const kcal = correctIntake("Z2", 120);
    const d = day("Z2", 120, `Intent: aerobic. Pre-ride: 300g. Daily intake: ${kcal} kcal.`);
    const result = repairNutrition([d], MODEL, FTP, BUFFER_APPLIED);
    expect(result.days[0].description).toBe(`Intent: aerobic. Pre-ride: ${preRide}g. Daily intake: ${kcal} kcal.`);
    expect(result.repairs.some((r) => r.includes(`auto-corrected pre-ride carbs 300g → ${preRide}g`))).toBe(true);
  });

  it("auto-corrects an invented in-ride figure, preserving surrounding text", () => {
    const inRide = correctInRide("Z2", 120);
    const kcal = correctIntake("Z2", 120);
    const d = day("Z2", 120, `Intent: aerobic. In-ride: 500g/hr. Daily intake: ${kcal} kcal.`);
    const result = repairNutrition([d], MODEL, FTP, BUFFER_APPLIED);
    expect(result.days[0].description).toBe(`Intent: aerobic. In-ride: ${inRide}g/hr. Daily intake: ${kcal} kcal.`);
    expect(result.repairs.some((r) => r.includes(`auto-corrected in-ride carbs 500g/hr → ${inRide}g/hr`))).toBe(true);
  });

  it("corrects kcal, pre-ride, and in-ride together in one pass when all three are invented", () => {
    const preRide = correctPreRide("Z2", 120);
    const inRide = correctInRide("Z2", 120);
    const kcal = correctIntake("Z2", 120);
    const d = day("Z2", 120, "Intent: aerobic. Pre-ride: 10g. In-ride: 10g/hr. Daily intake: 100 kcal.");
    const result = repairNutrition([d], MODEL, FTP, BUFFER_APPLIED);
    expect(result.days[0].description).toBe(
      `Intent: aerobic. Pre-ride: ${preRide}g. In-ride: ${inRide}g/hr. Daily intake: ${kcal} kcal.`
    );
    expect(result.repairs).toHaveLength(3);
  });

  it("does not touch a day whose carb figures are already within tolerance", () => {
    const preRide = correctPreRide("Z2", 120);
    const inRide = correctInRide("Z2", 120);
    const kcal = correctIntake("Z2", 120);
    const d = day("Z2", 120, `Pre-ride: ${preRide}g. In-ride: ${inRide}g/hr. Daily intake: ${kcal} kcal.`);
    const result = repairNutrition([d], MODEL, FTP, BUFFER_APPLIED);
    expect(result.days[0]).toBe(d); // same reference — nothing rewritten
    expect(result.repairs).toEqual([]);
  });

  it("leaves a missing in-ride line alone on a day where none is expected", () => {
    const preRide = correctPreRide("Z2", 45);
    const kcal = correctIntake("Z2", 45);
    const d = day("Z2", 45, `Pre-ride: ${preRide}g. Daily intake: ${kcal} kcal.`);
    const result = repairNutrition([d], MODEL, FTP, BUFFER_APPLIED);
    expect(result.days[0]).toBe(d);
    expect(result.repairs).toEqual([]);
  });
});
