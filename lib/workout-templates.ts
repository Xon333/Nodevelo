import type { DaySlot } from "./block-skeleton";
import { DURABILITY_RECIPES, type DurabilityTemplateId } from "./durability";
import type { WorkoutNutritionPlan } from "./nutrition";
import type { CyclingPrescription, PrescriptionStep, PrescriptionTargetMode } from "./prescription";
import type { WorkoutType } from "./types";

export class TemplateCoverageError extends Error {}

export interface WorkoutTemplateInput {
  type: WorkoutType;
  slot: DaySlot;
  stage: 0 | 1 | 2;
  isRecoveryWeek: boolean;
  durabilityTemplateId: DurabilityTemplateId;
  targetMode: PrescriptionTargetMode;
  hrCeilingBpm: number | null;
  lapButtonSteps: boolean;
  nutrition: WorkoutNutritionPlan;
}

export interface CompiledWorkoutTemplate {
  name: string;
  summary: string;
  prescription: CyclingPrescription | null;
  workoutText: string;
  description: string;
}

const QUALITY_STAGES = {
  SIT: [
    { reps: 4, workSec: 30, workPct: 150, recoverySec: 240 },
    { reps: 5, workSec: 30, workPct: 150, recoverySec: 240 },
    { reps: 6, workSec: 30, workPct: 150, recoverySec: 240 },
  ],
  VO2max: [
    { reps: 4, workSec: 180, workPct: 110, recoverySec: 180 },
    { reps: 5, workSec: 240, workPct: 112, recoverySec: 240 },
    { reps: 5, workSec: 300, workPct: 115, recoverySec: 300 },
  ],
  Threshold: [
    { reps: 2, workSec: 720, workPct: 90, recoverySec: 300 },
    { reps: 2, workSec: 1200, workPct: 93, recoverySec: 300 },
    { reps: 3, workSec: 900, workPct: 95, recoverySec: 300 },
  ],
} as const;

const RECOVERY_THRESHOLD = { reps: 2, workSec: 480, workPct: 90, recoverySec: 300 } as const;
const RACE_STAGES = [
  [
    { workSec: 180, workPct: 105, recoverySec: 180 },
    { workSec: 60, workPct: 120, recoverySec: 240 },
    { workSec: 20, workPct: 150, recoverySec: 300 },
  ],
  [
    { workSec: 300, workPct: 100, recoverySec: 180 },
    { workSec: 120, workPct: 112, recoverySec: 240 },
    { workSec: 45, workPct: 135, recoverySec: 300 },
    { workSec: 20, workPct: 160, recoverySec: 360 },
  ],
  [
    { workSec: 480, workPct: 95, recoverySec: 180 },
    { workSec: 240, workPct: 108, recoverySec: 240 },
    { workSec: 120, workPct: 120, recoverySec: 300 },
    { workSec: 45, workPct: 140, recoverySec: 360 },
    { workSec: 20, workPct: 170, recoverySec: 420 },
  ],
] as const;

const READY_SEC = 300;
const RAMP_SEC = 300;
const WARMUP_SEC = READY_SEC + RAMP_SEC;
const COOLDOWN_SEC = 600;

const STRENGTH_TEXT = [
  "Core strength programme (KB §4) — heavy compound lifts for force production, not hypertrophy.",
  "Mobility: 5-10 min hip and thoracic work before lifting.",
  "",
  "- Back squat (or goblet squat): 4 sets x 4-6 reps",
  "- Romanian deadlift: 4 sets x 4-6 reps",
  "- Bulgarian split squat: 3 sets x 5 reps each leg",
  "- Nordic hamstring curl: 3 sets x 5-6 reps",
  "- Hip thrust: 3 sets x 6-8 reps",
  "- Bent-over row: 3 sets x 6-8 reps",
  "- Overhead press: 3 sets x 6-8 reps",
].join("\n");

function nutritionLine(nutrition: WorkoutNutritionPlan): string {
  const carbs = nutrition.preRideCarbs > 0
    ? ` ${nutrition.preRideCarbs}g carbs pre-ride, ${nutrition.inRideCarbsPerHour}g/h during.`
    : "";
  return `Target ${nutrition.dailyTarget} kcal today.${carbs}`;
}

function durationLabel(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : seconds % 60 === 0 ? `${seconds / 60}m` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

function summary(reps: number, workSec: number, workPct: number): string {
  return `${reps}×${durationLabel(workSec)} @ ${workPct}% FTP`;
}

function powerStep(
  durationSec: number,
  role: PrescriptionStep["role"],
  minPctFtp: number,
  maxPctFtp: number,
  options: { cue?: string; end?: PrescriptionStep["end"]; hrCeilingBpm?: number } = {}
): PrescriptionStep {
  return {
    durationSec,
    end: options.end ?? "timer",
    role,
    target: { kind: "power-percent", minPctFtp, maxPctFtp },
    ...(options.cue ? { cue: options.cue } : {}),
    ...(options.hrCeilingBpm ? { hrCeilingBpm: options.hrCeilingBpm } : {}),
  };
}

function powerEasyStep(durationSec: number, role: PrescriptionStep["role"], hrCeilingBpm: number | null): PrescriptionStep {
  return {
    durationSec,
    end: "timer",
    role,
    target: { kind: "power-zone", minZone: 1, maxZone: 2 },
    ...(hrCeilingBpm ? { hrCeilingBpm } : {}),
  };
}

function hrEasyStep(
  durationSec: number,
  role: PrescriptionStep["role"],
  options: { cue?: string; end?: PrescriptionStep["end"] } = {}
): PrescriptionStep {
  return {
    durationSec,
    end: options.end ?? "timer",
    role,
    target: { kind: "hr-zone", minZone: 1, maxZone: 2 },
    ...(options.cue ? { cue: options.cue } : {}),
  };
}

function powerWarmup(input: WorkoutTemplateInput, extraSec = 0): PrescriptionStep[] {
  return [
    powerStep(READY_SEC + extraSec, "warmup", 50, 60, {
      end: input.lapButtonSteps ? "lapButton" : "timer",
    }),
    {
      durationSec: RAMP_SEC,
      end: "timer",
      role: "warmup",
      target: { kind: "power-ramp", fromPctFtp: 50, toPctFtp: 75 },
    },
  ];
}

function powerCooldown(): PrescriptionStep {
  return powerStep(COOLDOWN_SEC, "cooldown", 50, 60);
}

function interleavedWork(
  recipe: { reps: number; workSec: number; workPct: number; recoverySec: number }
): PrescriptionStep[] {
  const steps: PrescriptionStep[] = [];
  for (let rep = 0; rep < recipe.reps; rep += 1) {
    steps.push(powerStep(recipe.workSec, "active", recipe.workPct, recipe.workPct));
    if (rep < recipe.reps - 1) {
      steps.push(powerStep(recipe.recoverySec, "recovery", 50, 60));
    }
  }
  return steps;
}

function prescriptionDuration(prescription: CyclingPrescription): number {
  return prescription.sections.reduce(
    (total, section) => total + section.repeats * section.steps.reduce((sum, step) => sum + step.durationSec, 0),
    0
  );
}

function assertFits(input: WorkoutTemplateInput, requiredSec: number): number {
  const totalSec = input.slot.duration.nominalMin * 60;
  if (!Number.isInteger(totalSec) || requiredSec > totalSec) {
    throw new TemplateCoverageError(`${input.type} recipe needs ${Math.ceil(requiredSec / 60)} min; got ${input.slot.duration.nominalMin}.`);
  }
  return totalSec;
}

function assertIntensityCeiling(input: WorkoutTemplateInput, highestPct: number): void {
  if (input.slot.maxIntensityPct !== null && highestPct > input.slot.maxIntensityPct) {
    throw new TemplateCoverageError(`${input.type} recipe reaches ${highestPct}% FTP above the slot ceiling of ${input.slot.maxIntensityPct}%.`);
  }
}

function compileQuality(input: WorkoutTemplateInput): { summary: string; prescription: CyclingPrescription } {
  if (input.isRecoveryWeek && (input.type === "SIT" || input.type === "VO2max")) {
    throw new TemplateCoverageError(`Recovery-week quality must use the Threshold touch, not ${input.type}.`);
  }
  const recipe = input.type === "Threshold" && input.isRecoveryWeek
    ? RECOVERY_THRESHOLD
    : QUALITY_STAGES[input.type as keyof typeof QUALITY_STAGES][input.stage];
  assertIntensityCeiling(input, recipe.workPct);
  const work = powerStep(recipe.workSec, "active", recipe.workPct, recipe.workPct, {
    ...(input.type === "SIT" ? { cue: "Seated max" } : {}),
  });
  const finalWork = powerStep(recipe.workSec, "active", recipe.workPct, recipe.workPct, {
    ...(input.type === "SIT" ? { cue: "Standing max" } : {}),
  });
  const recovery = powerStep(recipe.recoverySec, "recovery", 50, 60);
  const hardSec = recipe.reps * recipe.workSec + (recipe.reps - 1) * recipe.recoverySec;
  const totalSec = assertFits(input, WARMUP_SEC + hardSec + COOLDOWN_SEC);
  return {
    summary: summary(recipe.reps, recipe.workSec, recipe.workPct),
    prescription: {
      targetMode: "power",
      sections: [
        { name: "Warmup", repeats: 1, steps: powerWarmup(input, totalSec - WARMUP_SEC - hardSec - COOLDOWN_SEC) },
        { name: "Main Set", repeats: recipe.reps - 1, steps: [work, recovery] },
        { name: "Main Set", repeats: 1, steps: [finalWork] },
        { name: "Cooldown", repeats: 1, steps: [powerCooldown()] },
      ],
    },
  };
}

function compileRaceSim(input: WorkoutTemplateInput): { summary: string; prescription: CyclingPrescription } {
  const moves = RACE_STAGES[input.stage];
  assertIntensityCeiling(input, Math.max(...moves.map((move) => move.workPct)));
  const work: PrescriptionStep[] = [];
  moves.forEach((move) => {
    work.push(powerStep(move.workSec, "active", move.workPct, move.workPct));
    work.push(powerStep(move.recoverySec, "recovery", 50, 60));
  });
  const workSec = work.reduce((sum, step) => sum + step.durationSec, 0);
  const totalSec = assertFits(input, WARMUP_SEC + workSec + COOLDOWN_SEC);
  return {
    summary: `${moves.length} varied race moves`,
    prescription: {
      targetMode: "power",
      sections: [
        { name: "Warmup", repeats: 1, steps: powerWarmup(input, totalSec - WARMUP_SEC - workSec - COOLDOWN_SEC) },
        { name: "Main Set", repeats: 1, steps: work },
        { name: "Cooldown", repeats: 1, steps: [powerCooldown()] },
      ],
    },
  };
}

function compileEasy(input: WorkoutTemplateInput, mode: PrescriptionTargetMode): CyclingPrescription {
  const totalSec = assertFits(input, WARMUP_SEC + COOLDOWN_SEC + 60);
  const mainSec = totalSec - WARMUP_SEC - COOLDOWN_SEC;
  if (mode === "power") {
    assertIntensityCeiling(input, 75);
    return {
      targetMode: "power",
      sections: [
        { name: "Warmup", repeats: 1, steps: powerWarmup(input) },
        { name: "Main Set", repeats: 1, steps: [powerEasyStep(mainSec, input.type === "Recovery" ? "recovery" : "active", input.hrCeilingBpm)] },
        { name: "Cooldown", repeats: 1, steps: [powerCooldown()] },
      ],
    };
  }
  return {
    targetMode: "heartRate",
    sections: [
      { name: "Warmup", repeats: 1, steps: [hrEasyStep(WARMUP_SEC, "warmup", { end: input.lapButtonSteps ? "lapButton" : "timer" })] },
      { name: "Main Set", repeats: 1, steps: [hrEasyStep(mainSec, input.type === "Recovery" ? "recovery" : "active")] },
      { name: "Cooldown", repeats: 1, steps: [hrEasyStep(COOLDOWN_SEC, "cooldown")] },
    ],
  };
}

function compileLateDurability(
  input: WorkoutTemplateInput,
  recipe: Extract<(typeof DURABILITY_RECIPES)[DurabilityTemplateId], { kind: "late-repeats" }>
): CyclingPrescription {
  assertIntensityCeiling(input, recipe.workPct);
  const work = interleavedWork(recipe);
  const hardSec = work.reduce((sum, step) => sum + step.durationSec, 0);
  const totalSec = input.slot.duration.nominalMin * 60;
  assertFits(input, totalSec / 2 + hardSec + COOLDOWN_SEC);
  const beforeWorkSec = totalSec / 2 - WARMUP_SEC;
  const afterWorkSec = totalSec - WARMUP_SEC - beforeWorkSec - hardSec - COOLDOWN_SEC;
  if (beforeWorkSec < 0 || afterWorkSec < 0) {
    throw new TemplateCoverageError(`Durability ${input.durabilityTemplateId} cannot fit ${input.slot.duration.nominalMin} min after halfway.`);
  }
  const mainSteps: PrescriptionStep[] = [];
  if (beforeWorkSec > 0) mainSteps.push(powerEasyStep(beforeWorkSec, "active", input.hrCeilingBpm));
  mainSteps.push(...work);
  if (afterWorkSec > 0) mainSteps.push(powerEasyStep(afterWorkSec, "active", input.hrCeilingBpm));
  return {
    targetMode: "power",
    sections: [
      { name: "Warmup", repeats: 1, steps: powerWarmup(input) },
      { name: "Main Set", repeats: 1, steps: mainSteps },
      { name: "Cooldown", repeats: 1, steps: [powerCooldown()] },
    ],
  };
}

function compileDistributedDurability(
  input: WorkoutTemplateInput,
  recipe: Extract<(typeof DURABILITY_RECIPES)[DurabilityTemplateId], { kind: "distributed" }>
): CyclingPrescription {
  assertIntensityCeiling(input, recipe.workPct);
  const totalSec = input.slot.duration.nominalMin * 60;
  const minimumSec = WARMUP_SEC + COOLDOWN_SEC + recipe.reps * recipe.workSec + (recipe.reps - 1) * recipe.recoverySec;
  assertFits(input, minimumSec);
  const easySec = totalSec - WARMUP_SEC - COOLDOWN_SEC - recipe.reps * recipe.workSec;
  const baseline = [0, ...Array(recipe.reps - 1).fill(recipe.recoverySec), 0];
  let extra = easySec - (recipe.reps - 1) * recipe.recoverySec;
  const gaps = baseline.map((seconds, index) => {
    const share = Math.floor(extra / (baseline.length - index));
    extra -= share;
    return seconds + share;
  });
  const mainSteps: PrescriptionStep[] = [];
  for (let rep = 0; rep < recipe.reps; rep += 1) {
    if (gaps[rep] > 0) mainSteps.push(powerEasyStep(gaps[rep], rep === 0 ? "active" : "recovery", input.hrCeilingBpm));
    mainSteps.push(powerStep(recipe.workSec, "active", recipe.workPct, recipe.workPct));
  }
  if (gaps[recipe.reps] > 0) mainSteps.push(powerEasyStep(gaps[recipe.reps], "active", input.hrCeilingBpm));
  return {
    targetMode: "power",
    sections: [
      { name: "Warmup", repeats: 1, steps: powerWarmup(input) },
      { name: "Main Set", repeats: 1, steps: mainSteps },
      { name: "Cooldown", repeats: 1, steps: [powerCooldown()] },
    ],
  };
}

function durabilitySummary(id: DurabilityTemplateId): string {
  const recipe = DURABILITY_RECIPES[id];
  if (recipe.kind === "steady") return "Steady Z2";
  return `${summary(recipe.reps, recipe.workSec, recipe.workPct)} ${recipe.kind === "distributed" ? "distributed" : "late"}`;
}

export function compileWorkoutTemplate(input: WorkoutTemplateInput): CompiledWorkoutTemplate {
  const description = nutritionLine(input.nutrition);
  if (input.type === "Rest") return { name: "Rest", summary: "", prescription: null, workoutText: "", description };
  if (input.type === "Strength") {
    return { name: "Strength", summary: "Core strength programme", prescription: null, workoutText: STRENGTH_TEXT, description };
  }

  let compiled: { summary: string; prescription: CyclingPrescription };
  if (input.type === "SIT" || input.type === "VO2max" || input.type === "Threshold") {
    compiled = compileQuality(input);
  } else if (input.type === "RaceSim") {
    compiled = compileRaceSim(input);
  } else if (input.type === "Recovery") {
    compiled = { summary: "Easy throughout", prescription: compileEasy(input, input.targetMode) };
  } else {
    const durabilityId = input.isRecoveryWeek ? "A" : input.durabilityTemplateId;
    const recipe = DURABILITY_RECIPES[durabilityId];
    if (recipe.kind === "steady") {
      compiled = { summary: durabilitySummary(durabilityId), prescription: compileEasy(input, input.targetMode) };
    } else if (recipe.kind === "late-repeats") {
      compiled = { summary: durabilitySummary(durabilityId), prescription: compileLateDurability(input, recipe) };
    } else {
      compiled = { summary: durabilitySummary(durabilityId), prescription: compileDistributedDurability(input, recipe) };
    }
  }

  if (prescriptionDuration(compiled.prescription) !== input.slot.duration.nominalMin * 60) {
    throw new TemplateCoverageError(`${input.type} recipe did not fill its exact slot.`);
  }
  return {
    name: input.type,
    summary: compiled.summary,
    prescription: compiled.prescription,
    workoutText: "",
    description,
  };
}
