import { describe, expect, it } from "vitest";
import type { DaySlot } from "./block-skeleton";
import type { DurabilityTemplateId } from "./durability";
import type { WorkoutNutritionPlan } from "./nutrition";
import { validateWorkoutProtocol } from "./workout-validate";
import { buildTemplateDay, TemplateCoverageError } from "./workout-templates";

const FTP = 280;

function slot(overrides: Partial<DaySlot> = {}): DaySlot {
  return {
    date: "2026-08-03",
    kind: "easy",
    allowedTypes: ["Z2", "Recovery"],
    duration: { nominalMin: 150, minMin: 135, maxMin: 165 },
    maxIntensityPct: null,
    locked: false,
    reason: "test",
    ...overrides,
  };
}

const nutrition: WorkoutNutritionPlan = {
  dailyTarget: 2800, maintenanceKcal: 2600, preRideCarbs: 80, inRideCarbsPerHour: 60,
  bufferApplied: 200, floored: false,
};

const noCarbNutrition: WorkoutNutritionPlan = { ...nutrition, preRideCarbs: 0, inRideCarbsPerHour: 0 };

describe("buildTemplateDay — Z2", () => {
  it.each([60, 480, 150])("produces the exact requested duration (%i min) via totalPrescribedMinutes, not one of a fixed set of points", (durationMin) => {
    const day = buildTemplateDay("Z2", slot({ duration: { nominalMin: durationMin, minMin: durationMin - 15, maxMin: durationMin + 15 } }), "A", false, nutrition);
    expect(day).not.toBeNull();
    expect(day!.durationMin).toBe(durationMin);
    // totalPrescribedMinutes is the real step-sum; re-derive it the same way validateDurationConsistency
    // does rather than importing it directly, to also prove the template's own durationMin agrees.
    const stepsTotalMin = day!.workoutText
      .split("\n")
      .filter((l) => l.trim().startsWith("-"))
      .reduce((sum, l) => {
        const m = l.match(/(\d+)m/);
        return sum + (m ? Number(m[1]) : 0);
      }, 0);
    expect(stepsTotalMin).toBe(durationMin);
  });

  it("returns null when the durability template is B-E and it isn't a recovery week", () => {
    for (const id of ["B", "C", "D", "E"] as DurabilityTemplateId[]) {
      expect(buildTemplateDay("Z2", slot(), id, false, nutrition)).toBeNull();
    }
  });

  it("returns the deterministic template (not null) for template A regardless of recovery-week status", () => {
    expect(buildTemplateDay("Z2", slot(), "A", false, nutrition)).not.toBeNull();
    expect(buildTemplateDay("Z2", slot(), "A", true, nutrition)).not.toBeNull();
  });

  it("returns the deterministic template (not null) for ANY durability template during a recovery week — the recovery-week exception overrides B-E", () => {
    for (const id of ["A", "B", "C", "D", "E"] as DurabilityTemplateId[]) {
      expect(buildTemplateDay("Z2", slot(), id, true, nutrition)).not.toBeNull();
    }
  });

  it("throws TemplateCoverageError as a defensive invariant, not the primary duration-mismatch path, for a duration too short to hold warmup+cooldown", () => {
    expect(() => buildTemplateDay("Z2", slot({ duration: { nominalMin: 15, minMin: 10, maxMin: 20 } }), "A", false, nutrition)).toThrow(TemplateCoverageError);
  });

  it("carries the nutrition numbers verbatim into description, without calculating them", () => {
    const day = buildTemplateDay("Z2", slot(), "A", false, nutrition)!;
    expect(day.description).toContain("2800 kcal");
    expect(day.description).toContain("80g carbs pre-ride, 60g/h during");
    const noCarbDay = buildTemplateDay("Z2", slot(), "A", false, noCarbNutrition)!;
    expect(noCarbDay.description).not.toContain("carbs");
  });

  it("stamps a duration-encoded template source", () => {
    const day = buildTemplateDay("Z2", slot({ duration: { nominalMin: 150, minMin: 135, maxMin: 165 } }), "A", false, nutrition)!;
    expect(day.source).toBe("template:z2-150");
  });
});

describe("buildTemplateDay — Recovery", () => {
  it.each([60, 480, 150])("produces the exact requested duration (%i min)", (durationMin) => {
    const day = buildTemplateDay("Recovery", slot({ duration: { nominalMin: durationMin, minMin: durationMin, maxMin: durationMin } }), "B", false, nutrition)!;
    expect(day.durationMin).toBe(durationMin);
    const m = day.workoutText.match(/(\d+)m/);
    expect(Number(m![1])).toBe(durationMin);
  });

  it("is never gated by durability template or recovery-week status (only Z2 is)", () => {
    expect(buildTemplateDay("Recovery", slot(), "B", false, nutrition)).not.toBeNull();
  });
});

describe("buildTemplateDay — Rest", () => {
  it("has empty workout text and zero duration", () => {
    const day = buildTemplateDay("Rest", slot({ duration: { nominalMin: 0, minMin: 0, maxMin: 0 } }), "A", false, nutrition)!;
    expect(day.workoutText).toBe("");
    expect(day.durationMin).toBe(0);
  });
});

describe("buildTemplateDay — Strength", () => {
  it("has the caller-configured duration and non-empty prose", () => {
    const day = buildTemplateDay("Strength", slot({ duration: { nominalMin: 45, minMin: 45, maxMin: 45 } }), "A", false, nutrition)!;
    expect(day.durationMin).toBe(45);
    expect(day.workoutText.length).toBeGreaterThan(0);
    expect(day.workoutText).toContain("Back squat");
  });
});

describe("buildTemplateDay — protocol validation", () => {
  it("every cycling template (Z2 at three durations, Recovery, and every durability-A/recovery-week Z2 combination) passes validateWorkoutProtocol with zero findings", () => {
    const days = [
      buildTemplateDay("Z2", slot({ duration: { nominalMin: 60, minMin: 60, maxMin: 60 } }), "A", false, nutrition),
      buildTemplateDay("Z2", slot({ duration: { nominalMin: 480, minMin: 480, maxMin: 480 } }), "A", false, nutrition),
      buildTemplateDay("Z2", slot({ duration: { nominalMin: 150, minMin: 150, maxMin: 150 } }), "A", false, nutrition),
      buildTemplateDay("Z2", slot(), "C", true, nutrition), // recovery-week exception
      buildTemplateDay("Recovery", slot({ duration: { nominalMin: 90, minMin: 90, maxMin: 90 } }), "A", false, nutrition),
    ];
    for (const day of days) {
      expect(day).not.toBeNull();
      expect(validateWorkoutProtocol(day!, FTP)).toEqual([]);
    }
  });
});
