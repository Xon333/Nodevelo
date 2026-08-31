import { describe, expect, it } from "vitest";
import type { DaySlot } from "./block-skeleton";
import type { DurabilityTemplateId } from "./durability";
import type { WorkoutNutritionPlan } from "./nutrition";
import {
  parseCyclingPrescription,
  prescriptionsEqual,
  renderPrescription,
  totalPrescribedMinutes,
  type CyclingPrescription,
  type PrescriptionStep,
} from "./prescription";
import type { PlannedDay, WorkoutType } from "./types";
import { validateWorkoutProtocol } from "./workout-validate";
import {
  compileWorkoutTemplate,
  TemplateCoverageError,
  type CompiledWorkoutTemplate,
  type WorkoutTemplateInput,
} from "./workout-templates";

const FTP = 280;
const nutrition: WorkoutNutritionPlan = {
  dailyTarget: 2800,
  maintenanceKcal: 2600,
  preRideCarbs: 80,
  inRideCarbsPerHour: 60,
  bufferApplied: 200,
  floored: false,
};

function slot(durationMin = 120, overrides: Partial<DaySlot> = {}): DaySlot {
  return {
    date: "2026-08-03",
    kind: "quality",
    allowedTypes: ["Threshold", "VO2max", "SIT", "RaceSim"],
    duration: { nominalMin: durationMin, minMin: durationMin, maxMin: durationMin },
    maxIntensityPct: null,
    locked: false,
    reason: "test",
    ...overrides,
  };
}

function input(type: WorkoutType, overrides: Partial<WorkoutTemplateInput> = {}): WorkoutTemplateInput {
  return {
    type,
    slot: slot(),
    stage: 0,
    isRecoveryWeek: false,
    durabilityTemplateId: "A",
    targetMode: "power",
    hrCeilingBpm: 145,
    lapButtonSteps: false,
    nutrition,
    ...overrides,
  };
}

function steps(prescription: CyclingPrescription): PrescriptionStep[] {
  return prescription.sections.flatMap((section) =>
    Array.from({ length: section.repeats }, () => section.steps).flat()
  );
}

function hardSteps(prescription: CyclingPrescription): PrescriptionStep[] {
  return steps(prescription).filter((step) =>
    step.target.kind === "power-percent" && step.target.minPctFtp >= 80
  );
}

function targetPct(step: PrescriptionStep): number {
  if (step.target.kind !== "power-percent") throw new Error("expected power-percent target");
  return step.target.maxPctFtp;
}

function rendered(result: CompiledWorkoutTemplate, templateInput: WorkoutTemplateInput): string {
  return renderPrescription(result.prescription!, { lapButtonSteps: templateInput.lapButtonSteps });
}

function dayFrom(result: CompiledWorkoutTemplate, workoutText: string, templateInput: WorkoutTemplateInput): PlannedDay {
  return {
    date: templateInput.slot.date,
    weekNumber: 1,
    weekTheme: "Loading",
    name: result.name,
    type: templateInput.type,
    durationMin: templateInput.slot.duration.nominalMin,
    workoutText,
    description: result.description,
  };
}

describe("compileWorkoutTemplate — ordered quality catalogue", () => {
  const cases = [
    { type: "SIT", summaries: ["4×30s @ 150% FTP", "5×30s @ 150% FTP", "6×30s @ 150% FTP"], minPct: 130, maxPct: 200 },
    { type: "VO2max", summaries: ["4×3m @ 110% FTP", "5×4m @ 112% FTP", "5×5m @ 115% FTP"], minPct: 106, maxPct: 120 },
    { type: "Threshold", summaries: ["2×12m @ 90% FTP", "2×20m @ 93% FTP", "3×15m @ 95% FTP"], minPct: 88, maxPct: 105 },
  ] as const;

  it.each(cases)("progresses $type without leaving its protocol band", ({ type, summaries, minPct, maxPct }) => {
    const workSeconds: number[] = [];
    for (const stage of [0, 1, 2] as const) {
      const templateInput = input(type, { stage });
      const result = compileWorkoutTemplate(templateInput);
      const work = hardSteps(result.prescription!);
      expect(result.summary).toBe(summaries[stage]);
      expect(work.every((step) => targetPct(step) >= minPct && targetPct(step) <= maxPct)).toBe(true);
      workSeconds.push(work.reduce((sum, step) => sum + step.durationSec, 0));
      expect(totalPrescribedMinutes(rendered(result, templateInput))).toBe(templateInput.slot.duration.nominalMin);
    }
    expect(workSeconds[1]).toBeGreaterThanOrEqual(workSeconds[0]);
    expect(workSeconds[2]).toBeGreaterThanOrEqual(workSeconds[1]);
  });

  it("uses the dedicated recovery-week Threshold touch", () => {
    const result = compileWorkoutTemplate(input("Threshold", {
      stage: 2,
      isRecoveryWeek: true,
      slot: slot(45, { maxIntensityPct: 95 }),
    }));
    expect(result.summary).toBe("2×8m @ 90% FTP");
    expect(hardSteps(result.prescription!)).toHaveLength(2);
  });

  it("renders SIT as compact repeat syntax with only its actionable posture cue", () => {
    const templateInput = input("SIT", { slot: slot(55) });
    const result = compileWorkoutTemplate(templateInput);
    expect(rendered(result, templateInput)).toBe([
      "Warmup",
      "- 26m 50%-60% intensity=warmup",
      "- 5m ramp 50%-75% intensity=warmup",
      "",
      "Main Set 3x",
      "- Seated max 30s 150% intensity=active",
      "- 4m 50%-60% intensity=recovery",
      "",
      "Main Set",
      "- Standing max 30s 150% intensity=active",
      "",
      "Cooldown",
      "- 10m 50%-60% intensity=cooldown",
    ].join("\n"));
  });
});

describe("compileWorkoutTemplate — RaceSim", () => {
  it.each([0, 1, 2] as const)("uses distinct moves and puts the hardest move in the final third at stage %i", (stage) => {
    const result = compileWorkoutTemplate(input("RaceSim", { stage }));
    const main = result.prescription!.sections.find((section) => section.name === "Main Set")!.steps;
    const moves = main.filter((step) => step.role === "active");
    const recoveries = main.filter((step) => step.role === "recovery");
    expect(moves).toHaveLength(stage + 3);
    expect(new Set(moves.map((step) => step.durationSec)).size).toBe(moves.length);
    expect(new Set(moves.map(targetPct)).size).toBe(moves.length);
    expect(new Set(recoveries.map((step) => step.durationSec)).size).toBe(recoveries.length);
    const hardestIndex = moves.findIndex((step) => targetPct(step) === Math.max(...moves.map(targetPct)));
    expect(hardestIndex).toBeGreaterThanOrEqual(Math.floor(moves.length * 2 / 3));
  });
});

describe("compileWorkoutTemplate — easy and durability protocols", () => {
  it("enforces the 75% ramp against power-led easy slot ceilings only", () => {
    for (const type of ["Recovery", "Z2"] as const) {
      expect(() => compileWorkoutTemplate(input(type, {
        slot: slot(60, { maxIntensityPct: 70 }),
      }))).toThrow(TemplateCoverageError);
      expect(() => compileWorkoutTemplate(input(type, {
        slot: slot(60, { maxIntensityPct: 75 }),
      }))).not.toThrow();
      expect(() => compileWorkoutTemplate(input(type, {
        targetMode: "heartRate",
        slot: slot(60, { maxIntensityPct: 70 }),
      }))).not.toThrow();
    }
  });

  it.each(["B", "C", "D"] as const)("puts durability %s work after half of the ride", (durabilityTemplateId) => {
    const templateInput = input("Z2", { slot: slot(150), durabilityTemplateId });
    const prescription = compileWorkoutTemplate(templateInput).prescription!;
    const expanded = steps(prescription);
    const firstHard = expanded.findIndex((step) => step.target.kind === "power-percent" && step.target.minPctFtp >= 88);
    const elapsed = expanded.slice(0, firstHard).reduce((sum, step) => sum + step.durationSec, 0);
    expect(elapsed).toBeGreaterThanOrEqual(75 * 60);
    expect(hardSteps(prescription)).toHaveLength(durabilityTemplateId === "B" ? 2 : durabilityTemplateId === "C" ? 4 : 8);
  });

  it("distributes durability E through the ride", () => {
    const prescription = compileWorkoutTemplate(input("Z2", { slot: slot(150), durabilityTemplateId: "E" })).prescription!;
    const expanded = steps(prescription);
    const positions: number[] = [];
    let elapsed = 0;
    for (const step of expanded) {
      if (step.target.kind === "power-percent" && step.target.minPctFtp >= 80) positions.push(elapsed);
      elapsed += step.durationSec;
    }
    expect(positions).toHaveLength(6);
    expect(positions[0]).toBeLessThan(50 * 60);
    expect(positions.at(-1)).toBeGreaterThan(100 * 60);
  });

  it.each(["A", "B", "C", "D", "E"] as DurabilityTemplateId[])("overrides durability %s to steady A in recovery weeks", (durabilityTemplateId) => {
    const result = compileWorkoutTemplate(input("Z2", {
      slot: slot(90),
      durabilityTemplateId,
      isRecoveryWeek: true,
    }));
    expect(result.summary).toBe("Steady Z2");
    expect(hardSteps(result.prescription!)).toEqual([]);
  });

  it("uses HR zones only for selected Recovery, pure Z2, and recovery-override rides", () => {
    const eligible = [
      input("Recovery", { targetMode: "heartRate", slot: slot(60) }),
      input("Z2", { targetMode: "heartRate", durabilityTemplateId: "A", slot: slot(90) }),
      input("Z2", { targetMode: "heartRate", durabilityTemplateId: "D", isRecoveryWeek: true, slot: slot(90) }),
    ];
    for (const templateInput of eligible) {
      const prescription = compileWorkoutTemplate(templateInput).prescription!;
      expect(prescription.targetMode).toBe("heartRate");
      expect(steps(prescription).every((step) => step.target.kind === "hr-zone")).toBe(true);
    }
    const durability = compileWorkoutTemplate(input("Z2", { targetMode: "heartRate", durabilityTemplateId: "B", slot: slot(150) })).prescription!;
    expect(durability.targetMode).toBe("power");
  });
});

describe("compileWorkoutTemplate — rendering contract", () => {
  const cyclingCases: Array<WorkoutTemplateInput> = [
    ...(["SIT", "VO2max", "Threshold", "RaceSim"] as const).flatMap((type) =>
      ([0, 1, 2] as const).map((stage) => input(type, { stage }))
    ),
    input("Threshold", { stage: 2, isRecoveryWeek: true, slot: slot(45, { maxIntensityPct: 95 }) }),
    input("Recovery", { slot: slot(60) }),
    input("Recovery", { targetMode: "heartRate", slot: slot(60) }),
    ...(["A", "B", "C", "D", "E"] as const).map((durabilityTemplateId) =>
      input("Z2", { durabilityTemplateId, slot: slot(150) })
    ),
    input("Z2", { durabilityTemplateId: "A", targetMode: "heartRate", slot: slot(150) }),
  ];

  it.each(cyclingCases)("renders $type stage $stage with exact duration, roundtrip, and valid protocol", (templateInput) => {
    const result = compileWorkoutTemplate(templateInput);
    const workoutText = rendered(result, templateInput);
    expect(result.workoutText).toBe("");
    expect(totalPrescribedMinutes(workoutText)).toBe(templateInput.slot.duration.nominalMin);
    expect(validateWorkoutProtocol(dayFrom(result, workoutText, templateInput), FTP)).toEqual([]);
    expect(prescriptionsEqual(parseCyclingPrescription(workoutText), result.prescription!)).toBe(true);
    expect(workoutText).not.toMatch(/\brpm\b/i);
    expect(result.description).toBe("Target 2800 kcal today. 80g carbs pre-ride, 60g/h during.");
  });

  it("uses ramps only in warmup and timer endings for quality work and recovery", () => {
    const templateInput = input("VO2max", { stage: 2, lapButtonSteps: true });
    const prescription = compileWorkoutTemplate(templateInput).prescription!;
    for (const section of prescription.sections) {
      for (const step of section.steps) {
        if (step.target.kind === "power-ramp") expect(section.name).toBe("Warmup");
        if (section.name === "Main Set") expect(step.end).toBe("timer");
      }
    }
    const lapSteps = steps(prescription).filter((step) => step.end === "lapButton");
    expect(lapSteps).toHaveLength(1);
    expect(lapSteps[0].role).toBe("warmup");
  });

  it("keeps quality sessions power-only and reserves HR ceilings for easy rides", () => {
    for (const type of ["Threshold", "VO2max", "SIT", "RaceSim"] as const) {
      const prescription = compileWorkoutTemplate(input(type, { stage: 0, hrCeilingBpm: 145 })).prescription!;
      expect(steps(prescription).every((step) => step.hrCeilingBpm === undefined)).toBe(true);
    }
    const z2 = compileWorkoutTemplate(input("Z2", { slot: slot(90), hrCeilingBpm: 145 })).prescription!;
    expect(steps(z2).filter((step) => step.role === "active").every((step) => step.hrCeilingBpm === 145)).toBe(true);
    expect(steps(z2).filter((step) => step.role !== "active").every((step) => step.hrCeilingBpm === undefined)).toBe(true);
  });
});

describe("compileWorkoutTemplate — non-cycling and failure behavior", () => {
  it("returns base protocol names without duplicating summaries", () => {
    const quality = compileWorkoutTemplate(input("Threshold"));
    expect(quality.name).toBe("Threshold");
    expect(quality.summary).toBe("2×12m @ 90% FTP");
    expect(compileWorkoutTemplate(input("Rest", { slot: slot(0) }))).toMatchObject({
      name: "Rest",
      summary: "",
    });
  });

  it("keeps Rest empty and Strength deterministic prose", () => {
    const rest = compileWorkoutTemplate(input("Rest", { slot: slot(0) }));
    expect(rest).toMatchObject({ prescription: null, workoutText: "" });
    const strength = compileWorkoutTemplate(input("Strength", { slot: slot(45) }));
    expect(strength.prescription).toBeNull();
    expect(strength.workoutText).toContain("Back squat");
  });

  it("omits carb text when the supplied nutrition plan has no ride fuel", () => {
    const result = compileWorkoutTemplate(input("Recovery", {
      slot: slot(60),
      nutrition: { ...nutrition, preRideCarbs: 0, inRideCarbsPerHour: 0 },
    }));
    expect(result.description).toBe("Target 2800 kcal today.");
  });

  it("throws instead of padding hard work when a recipe cannot fit", () => {
    expect(() => compileWorkoutTemplate(input("Threshold", { stage: 2, slot: slot(40) }))).toThrow(TemplateCoverageError);
    expect(() => compileWorkoutTemplate(input("Z2", { durabilityTemplateId: "E", slot: slot(90) }))).toThrow(TemplateCoverageError);
  });

  it("rejects recovery-week SIT and slot intensity conflicts", () => {
    expect(() => compileWorkoutTemplate(input("SIT", { isRecoveryWeek: true }))).toThrow(TemplateCoverageError);
    expect(() => compileWorkoutTemplate(input("VO2max", { slot: slot(120, { maxIntensityPct: 95 }) }))).toThrow(TemplateCoverageError);
  });
});
