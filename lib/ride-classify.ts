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
