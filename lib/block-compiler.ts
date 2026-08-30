import type { BlockSkeleton, DaySlot, WeekTarget, WeekSkeleton } from "./block-skeleton";
import { canonical, evaluatePublicationGate, type PublicationGateArgs } from "./publication-gate";
import type { DurabilityTemplateId } from "./durability";
import type { WorkoutNutritionPlan } from "./nutrition";
import {
  parseCyclingPrescription,
  prescriptionsEqual,
  renderPrescription,
  totalPrescribedMinutes,
  type CyclingPrescription,
} from "./prescription";
import type { SessionRequirements } from "./session-requirements";
import type {
  BlockParams,
  BlockSettings,
  GeneratedPlan,
  PlannedDay,
  QualityLibraryType,
  SeasonFocus,
  SeasonPhase,
  WorkoutType,
} from "./types";
import { compileWorkoutTemplate } from "./workout-templates";

export interface DeterministicBlockInput {
  blockParams: BlockParams;
  settings: BlockSettings;
  weekTargets: WeekTarget[];
  skeleton: BlockSkeleton;
  focus: SeasonFocus;
  phase: SeasonPhase;
  focusRationale?: string;
  durabilityTemplateId: DurabilityTemplateId;
  requirements: SessionRequirements;
  ftp: number;
  hrZone2CeilingBpm: number | null;
  nutritionByDateAndType: Record<string, Partial<Record<WorkoutType, WorkoutNutritionPlan>>>;
  warnings: string[];
  publication: Omit<
    PublicationGateArgs,
    "days" | "truncated" | "expectedDayCount" | "ftp" | "blockSettings" | "weekTargets" | "blockSkeleton" | "requirements"
  >;
}

export interface DeterministicBlockResult {
  plan: GeneratedPlan;
  prescriptions: Record<string, CyclingPrescription>;
  verdict: { blockers: string[]; preferences: string[] };
}

export class BlockCompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockCompilationError";
  }
}

const COMPLEMENTS: QualityLibraryType[] = ["Threshold", "VO2max", "SIT", "RaceSim"];
const FRESHNESS_FIRST: QualityLibraryType[] = ["SIT", "VO2max", "Threshold", "RaceSim"];
const QUALITY = new Set<WorkoutType>(COMPLEMENTS);
const FRESH = new Set<WorkoutType>(["SIT", "VO2max"]);
const TOLERANT = new Set<WorkoutType>(["Threshold", "RaceSim"]);

const FOCUS_LABEL: Record<SeasonFocus, string> = {
  "aerobic-base": "Aerobic Base",
  threshold: "Threshold",
  vo2max: "VO2max",
  anaerobic: "Anaerobic",
  durability: "Durability",
  sharpen: "Sharpen",
};
const PHASE_LABEL: Record<SeasonPhase, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
  transition: "Transition",
};
const focusLabel = (focus: SeasonFocus) => FOCUS_LABEL[focus];

interface QualityAssignment {
  slot: DaySlot;
  type: QualityLibraryType;
  anchored: boolean;
}

function compilationError(message: string): never {
  throw new BlockCompilationError(message);
}

function qualityType(type: WorkoutType | undefined, slot: DaySlot): QualityLibraryType {
  if (!type || !QUALITY.has(type)) {
    return compilationError(`Quality slot ${slot.date} is locked to incompatible type ${type ?? "none"}.`);
  }
  return type as QualityLibraryType;
}

function assertAllowed(slot: DaySlot, type: WorkoutType): void {
  if (!slot.allowedTypes.includes(type)) {
    compilationError(`${slot.date} ${slot.kind} slot does not allow required type ${type}.`);
  }
}

function isTemporallyCompatible(type: QualityLibraryType, index: number, assignments: Array<QualityAssignment | null>): boolean {
  if (FRESH.has(type) && assignments.some((assignment, i) => i < index && assignment?.anchored && TOLERANT.has(assignment.type))) {
    return false;
  }
  if (TOLERANT.has(type) && assignments.some((assignment, i) => i > index && assignment?.anchored && FRESH.has(assignment.type))) {
    return false;
  }
  return true;
}

function orderFlexibleQuality(assignments: Array<QualityAssignment | null>): QualityAssignment[] {
  const flexible = assignments
    .filter((assignment): assignment is QualityAssignment => assignment !== null && !assignment.anchored)
    .map((assignment) => assignment.type)
    .sort((left, right) => FRESHNESS_FIRST.indexOf(left) - FRESHNESS_FIRST.indexOf(right));
  let cursor = 0;
  const ordered = assignments.map((assignment) => {
    if (!assignment) return compilationError("Quality assignment is incomplete.");
    if (assignment.anchored) return assignment;
    const type = flexible[cursor++];
    assertAllowed(assignment.slot, type);
    return { ...assignment, type };
  });
  const earliestFresh = ordered.findIndex((assignment) => FRESH.has(assignment.type));
  const earliestTolerant = ordered.findIndex((assignment) => TOLERANT.has(assignment.type));
  if (earliestFresh >= 0 && earliestTolerant >= 0 && earliestTolerant < earliestFresh) {
    compilationError(`Locked quality slots in week containing ${ordered[0].slot.date} cannot satisfy freshness-first ordering.`);
  }
  return ordered;
}

function chooseWorkoutTypes(input: DeterministicBlockInput): Map<string, WorkoutType> {
  const chosen = new Map<string, WorkoutType>();
  const eventSatisfiesRaceSim = input.skeleton.weeks.some((week) => week.days.some((slot) => slot.kind === "event"));
  const firstQualityDates = new Set(
    input.skeleton.weeks.map((week) => week.days.find((slot) => slot.kind === "quality")?.date).filter(Boolean)
  );
  const reservedRaceSimDate = input.requirements.requireRaceSim && !eventSatisfiesRaceSim
    ? input.skeleton.weeks
        .filter((week) => !week.isRecovery)
        .flatMap((week) => week.days)
        .find((slot) => slot.kind === "quality" && !slot.locked && !firstQualityDates.has(slot.date) && slot.allowedTypes.includes("RaceSim"))?.date
    : undefined;
  if (input.requirements.requireRaceSim && !eventSatisfiesRaceSim && !reservedRaceSimDate) {
    compilationError("Required RaceSim has no compatible flexible loading quality slot.");
  }

  for (const week of input.skeleton.weeks) {
    for (const slot of week.days) {
      const type = slot.kind === "rest" ? "Rest"
        : slot.kind === "event" ? "RaceSim"
        : slot.kind === "longRide" ? "Z2"
        : slot.kind === "easy" ? (week.isRecovery ? "Recovery" : "Z2")
        : null;
      if (type) {
        assertAllowed(slot, type);
        chosen.set(slot.date, type);
      }
    }

    const qualitySlots = week.days.filter((slot) => slot.kind === "quality");
    if (qualitySlots.length === 0) continue;
    if (week.isRecovery) {
      for (const slot of qualitySlots) {
        assertAllowed(slot, "Threshold");
        if (slot.locked && (slot.allowedTypes.length !== 1 || slot.allowedTypes[0] !== "Threshold")) {
          compilationError(`Recovery quality slot ${slot.date} is locked to ${slot.allowedTypes.join(" or ")}, not Threshold.`);
        }
        chosen.set(slot.date, "Threshold");
      }
      continue;
    }

    const assignments: Array<QualityAssignment | null> = qualitySlots.map((slot) => {
      if (!slot.locked) return null;
      if (slot.allowedTypes.length !== 1) compilationError(`Locked quality slot ${slot.date} must name exactly one type.`);
      return { slot, type: qualityType(slot.allowedTypes[0], slot), anchored: true };
    });
    if (!assignments[0]) {
      assertAllowed(qualitySlots[0], "Threshold");
      assignments[0] = { slot: qualitySlots[0], type: "Threshold", anchored: true };
    }
    const primary = assignments[0].type;

    for (let index = 1; index < qualitySlots.length; index += 1) {
      if (assignments[index]) continue;
      const slot = qualitySlots[index];
      if (slot.date === reservedRaceSimDate) {
        assertAllowed(slot, "RaceSim");
        assignments[index] = { slot, type: "RaceSim", anchored: true };
        continue;
      }
      const used = new Set(assignments.filter((assignment): assignment is QualityAssignment => assignment !== null).map((assignment) => assignment.type));
      const compatible = COMPLEMENTS.find((candidate) =>
        candidate !== primary
        && !used.has(candidate)
        && slot.allowedTypes.includes(candidate)
        && isTemporallyCompatible(candidate, index, assignments)
      ) ?? COMPLEMENTS.find((candidate) =>
        candidate !== primary
        && slot.allowedTypes.includes(candidate)
        && isTemporallyCompatible(candidate, index, assignments)
      );
      if (!compatible) compilationError(`No compatible quality type for ${slot.date}.`);
      assignments[index] = { slot, type: compatible, anchored: false };
    }

    for (const assignment of orderFlexibleQuality(assignments)) chosen.set(assignment.slot.date, assignment.type);
  }

  return chosen;
}

function prescriptionSeconds(prescription: CyclingPrescription): number {
  return prescription.sections.reduce(
    (total, section) => total + section.repeats * section.steps.reduce((sum, step) => sum + step.durationSec, 0),
    0
  );
}

function compileDay(
  input: DeterministicBlockInput,
  week: WeekSkeleton,
  slot: DaySlot,
  type: WorkoutType,
  stage: 0 | 1 | 2
): { day: PlannedDay; prescription?: CyclingPrescription } {
  const nutrition = input.nutritionByDateAndType[slot.date]?.[type];
  if (!nutrition) compilationError(`Missing nutrition for ${slot.date} ${type}.`);
  const effectiveDurability = type === "Z2" && slot.kind !== "longRide" ? "A" : input.durabilityTemplateId;
  const targetMode = input.hrZone2CeilingBpm !== null
    && (type === "Recovery" || (type === "Z2" && effectiveDurability === "A"))
    ? "heartRate"
    : "power";
  const template = compileWorkoutTemplate({
    type,
    slot,
    stage,
    isRecoveryWeek: week.isRecovery,
    durabilityTemplateId: effectiveDurability,
    targetMode,
    hrCeilingBpm: input.hrZone2CeilingBpm,
    lapButtonSteps: input.settings.lapButtonSteps,
    nutrition,
  });
  const workoutText = template.prescription
    ? renderPrescription(template.prescription, { lapButtonSteps: input.settings.lapButtonSteps })
    : template.workoutText;
  const day: PlannedDay = {
    date: slot.date,
    weekNumber: week.weekNumber,
    weekTheme: week.isRecovery ? "Recovery" : `${focusLabel(input.focus)} build`,
    name: template.summary ? `${template.name} — ${template.summary}` : template.name,
    type,
    durationMin: slot.duration.nominalMin,
    workoutText,
    description: template.description,
  };

  if (type !== "Rest") {
    if (!template.prescription) compilationError(`Cycling workout ${slot.date} ${type} has no typed prescription.`);
    const parsed = parseCyclingPrescription(workoutText);
    const typedSeconds = prescriptionSeconds(template.prescription);
    const renderedSeconds = totalPrescribedMinutes(workoutText) * 60;
    if (!prescriptionsEqual(parsed, template.prescription)
      || renderedSeconds !== typedSeconds
      || typedSeconds !== day.durationMin * 60) {
      compilationError(`Prescription round trip or duration mismatch for ${slot.date} ${type}.`);
    }
  }
  return { day, ...(template.prescription ? { prescription: template.prescription } : {}) };
}

export function compileTrainingBlock(input: DeterministicBlockInput): DeterministicBlockResult {
  const types = chooseWorkoutTypes(input);
  const days: PlannedDay[] = [];
  const prescriptions: Record<string, CyclingPrescription> = {};
  let loadingOrdinal = 0;

  for (const week of input.skeleton.weeks) {
    const stage = Math.min(loadingOrdinal, 2) as 0 | 1 | 2;
    for (const slot of week.days) {
      const type = types.get(slot.date) ?? compilationError(`No workout type selected for ${slot.date}.`);
      const compiled = compileDay(input, week, slot, type, stage);
      days.push(compiled.day);
      if (compiled.prescription) prescriptions[slot.date] = compiled.prescription;
    }
    if (!week.isRecovery) loadingOrdinal += 1;
  }

  const gate = evaluatePublicationGate({
    ...input.publication,
    days,
    truncated: false,
    expectedDayCount: input.blockParams.lengthWeeks * 7,
    ftp: input.ftp,
    blockSettings: input.settings,
    weekTargets: input.weekTargets,
    blockSkeleton: input.skeleton,
    requirements: input.requirements,
  });
  const overview = `${input.blockParams.lengthWeeks}-week ${focusLabel(input.focus)} ${PHASE_LABEL[input.phase]}`;
  const raw = canonical({
    blockParams: input.blockParams,
    focus: input.focus,
    phase: input.phase,
    durabilityTemplateId: input.durabilityTemplateId,
    days,
    prescriptions,
  });
  const plan: GeneratedPlan = {
    overview,
    days,
    warnings: [...input.warnings, ...gate.advisories],
    ...(gate.blockers.length > 0 || gate.preferences.length > 0
      ? { findings: { blockers: gate.blockers, preferences: gate.preferences } }
      : {}),
    raw,
    blockParams: input.blockParams,
    durabilityTemplate: input.durabilityTemplateId,
    seasonFocus: input.focus,
    ...(input.focusRationale ? { seasonFocusRationale: input.focusRationale } : {}),
  };

  return {
    plan,
    prescriptions,
    verdict: { blockers: gate.blockers, preferences: gate.preferences },
  };
}
