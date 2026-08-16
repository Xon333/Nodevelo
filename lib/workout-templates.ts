// Deterministic routine-day templates (design §3, plan Task 5). Z2 is parameterized to any duration
// inside the athlete's configured 60-480 min long-ride range — not a fixed set of durations — but is
// only template-eligible when the week's long ride is supposed to be unbroken Z2: durability template
// A ("pure accumulation", lib/durability.ts), or any recovery week (which overrides B-E's embedded
// efforts regardless of the block's active template, per formatDurabilityForPrompt's own exception).
// Templates B-E's embedded harder efforts are fuzzy prose ranges meant for an LLM to phrase into a
// concrete schedule, not something this file can build a deterministic schedule for — buildTemplateDay
// returns null for those, so Task 7 routes that date to AI authoring instead of silently losing the
// durability stimulus while lib/durability.ts's stamp on the day would still claim it was delivered.

import type { DaySlot } from "./block-skeleton";
import type { DurabilityTemplateId } from "./durability";
import type { WorkoutNutritionPlan } from "./nutrition";
import type { PlannedDay, WorkoutSource, WorkoutType } from "./types";

// Duration-mismatch is no longer reachable through the normal 60-480 min settings range once Z2 is
// parameterized (the whole point of this task) — kept only as a defensive invariant check for a
// caller passing a duration outside that range, which would itself be a bug elsewhere.
export class TemplateCoverageError extends Error {}

const Z2_WARMUP_MIN = 10;
const Z2_COOLDOWN_MIN = 10;
const Z2_WARMUP_PCT = 55;
const Z2_STEADY_PCT = 68; // comfortably under the 75% easy ceiling and the 88% durability-insert floor
const Z2_COOLDOWN_PCT = 50;
const RECOVERY_PCT = 50; // KB cycling_database.md §"Active recovery": genuinely easy, under 60% FTP throughout

// KB cycling_database.md §4 "Core Programme — Heavy Compound Lifts": the highest-return, year-round
// strength programme for amateurs. Static/deterministic — no per-athlete scaling, matching Strength's
// existing "prose, not step syntax, moving_time written directly from durationMin" treatment elsewhere.
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
  const carbs =
    nutrition.preRideCarbs > 0
      ? ` ${nutrition.preRideCarbs}g carbs pre-ride, ${nutrition.inRideCarbsPerHour}g/h during.`
      : "";
  return `Target ${nutrition.dailyTarget} kcal today.${carbs}`;
}

function z2WorkoutText(durationMin: number): string {
  const steadyMin = durationMin - Z2_WARMUP_MIN - Z2_COOLDOWN_MIN;
  if (steadyMin <= 0) {
    throw new TemplateCoverageError(
      `Z2 template needs at least ${Z2_WARMUP_MIN + Z2_COOLDOWN_MIN + 1} min; got ${durationMin}.`
    );
  }
  return `Warmup\n- ${Z2_WARMUP_MIN}m ${Z2_WARMUP_PCT}%\n\nSteady Z2\n- ${steadyMin}m ${Z2_STEADY_PCT}%\n\nCooldown\n- ${Z2_COOLDOWN_MIN}m ${Z2_COOLDOWN_PCT}%`;
}

function recoveryWorkoutText(durationMin: number): string {
  if (durationMin <= 0) throw new TemplateCoverageError(`Recovery template needs a positive duration; got ${durationMin}.`);
  return `Active recovery — genuinely easy throughout\n- ${durationMin}m ${RECOVERY_PCT}%`;
}

function buildDay(
  slot: DaySlot,
  type: WorkoutType,
  name: string,
  workoutText: string,
  source: WorkoutSource,
  nutrition: WorkoutNutritionPlan
): PlannedDay & { source: WorkoutSource } {
  return {
    date: slot.date,
    // Placeholder — the caller (Task 7) knows the real week context and stamps it on; a synthetic
    // per-day template builder has no week to report (lib/workout-library.ts's own plannedDay() helper
    // uses the same placeholder-then-caller-overrides convention for the same reason).
    weekNumber: 0,
    weekTheme: "",
    name,
    type,
    durationMin: slot.duration.nominalMin,
    workoutText,
    description: nutritionLine(nutrition),
    source,
  };
}

// `type` is explicit rather than inferred from `slot.allowedTypes` — an "easy" kind slot allows BOTH
// Z2 and Recovery (block-skeleton.ts), so the slot alone can't disambiguate which one the caller wants;
// Task 7 already has to decide per-slot which type it's filling and is the natural owner of that call.
export function buildTemplateDay(
  type: Extract<WorkoutType, "Z2" | "Recovery" | "Rest" | "Strength">,
  slot: DaySlot,
  durabilityTemplateId: DurabilityTemplateId,
  isRecoveryWeek: boolean,
  nutrition: WorkoutNutritionPlan
): (PlannedDay & { source: WorkoutSource }) | null {
  const durationMin = slot.duration.nominalMin;
  switch (type) {
    case "Rest":
      return buildDay(slot, "Rest", "Rest", "", "template:rest", nutrition);
    case "Strength":
      return buildDay(slot, "Strength", "Strength", STRENGTH_TEXT, `template:strength-${durationMin}`, nutrition);
    case "Recovery":
      return buildDay(slot, "Recovery", "Active recovery", recoveryWorkoutText(durationMin), `template:recovery-${durationMin}`, nutrition);
    case "Z2":
      if (durabilityTemplateId !== "A" && !isRecoveryWeek) return null;
      return buildDay(slot, "Z2", "Z2 endurance", z2WorkoutText(durationMin), `template:z2-${durationMin}`, nutrition);
  }
}
