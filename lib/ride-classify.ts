// Infer the effort type of an off-plan ride from its intensity factor (and duration). Rough
// by design — without a prescription we can't know intent, so this is a best-effort bucket
// for grouping and the behaviour signal only, never for adherence judgement.

import type { WorkoutType } from "./types";

export function inferWorkoutType(intensityFactor: number | null, durationMin: number): WorkoutType {
  if (intensityFactor === null) {
    // No power data: long rides read as endurance, very short ones as recovery spins.
    return durationMin >= 75 ? "Z2" : "Recovery";
  }
  const IF = intensityFactor;
  if (IF < 0.56) return "Recovery";
  if (IF < 0.75) return "Z2";
  if (IF < 0.9) return "Threshold"; // tempo / sweet-spot / threshold band
  return "VO2max";
}

// NV-12 (2026-08-15): inferWorkoutType's 0.75-0.9 IF band is deliberately broad (tempo / sweet-spot /
// threshold combined) — live-confirmed both IF 0.78 and IF 0.82 rides call the SAME "Threshold" bucket
// while the coach note correctly describes the latter as "tempo". "Threshold" is ALSO a real, narrower
// PRESCRIBED session type (lib/types.ts's WORKOUT_TYPES list, which gates what the deterministic
// compiler may legally prescribe) — reusing its exact name for an off-plan inferred bucket misleads on the
// Trends hover title (components/trends/sections.tsx). Display-layer only, deliberately: the stored
// WorkoutType/inferredType value is untouched, so this can't expand what the compiler is allowed to
// prescribe, and never touches per-type calibration (already prescribed-only, INVARIANT 40 — this
// label is display-only and is never read back as data).
export function inferredTypeLabel(inferredType: WorkoutType, planned: boolean): string {
  if (!planned && inferredType === "Threshold") return "Tempo/Threshold";
  return inferredType;
}
