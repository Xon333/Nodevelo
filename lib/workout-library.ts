import { createHash } from "node:crypto";
import type { DaySlot } from "./block-skeleton";
import { parsePrescription, walkWorkoutSteps } from "./prescription";
import type { PlannedDay, QualityLibraryType, WorkoutLibraryEntry, WorkoutLibraryEvidence } from "./types";
import { validateWorkoutProtocol } from "./workout-validate";

export const QUALITY_TYPES = new Set<QualityLibraryType>(["Threshold", "VO2max", "SIT", "RaceSim"]);

// Reuses prescription.ts's own step-grammar walker (repeat-block expansion, multi-clause lines,
// ramp-to-upper-bound normalization) instead of a second hand-rolled parser, so a future grammar fix
// there can't silently diverge from what identity fingerprints see. `keep: () => true` retains
// warmup/cooldown/recovery steps too — unlike parsePrescription's work-only view, workout identity
// depends on the full structure, not just what counts toward execution scoring.
export function fingerprintWorkout(workoutText: string): string {
  const steps = walkWorkoutSteps(workoutText, () => true).map((s) => [s.durationSec, s.pct]);
  return createHash("sha256").update(JSON.stringify(steps)).digest("hex");
}

function plannedDay(entry: WorkoutLibraryEntry): PlannedDay {
  return {
    date: "library",
    weekNumber: 0,
    weekTheme: "library",
    name: entry.id,
    type: entry.workoutType,
    durationMin: entry.durationMin,
    workoutText: entry.workoutText,
    description: "",
  };
}

function isProtocolSafe(entry: WorkoutLibraryEntry, ftp: number): boolean {
  return parsePrescription(entry.workoutText, ftp).length > 0 && validateWorkoutProtocol(plannedDay(entry), ftp).length === 0;
}

export function applyEvidence(
  entry: WorkoutLibraryEntry,
  evidence: WorkoutLibraryEvidence,
  compromised: boolean,
  promotedAt: string
): WorkoutLibraryEntry {
  if (compromised || entry.evidence.some((existing) => existing.date === evidence.date)) return entry;

  const next = { ...entry, evidence: [...entry.evidence, evidence] };
  if (entry.status !== "candidate") return next;

  const qualifying = next.evidence.filter(({ executionScore }) => executionScore >= 6);
  if (next.evidence.some(({ executionScore }) => executionScore >= 8) || qualifying.length >= 2) {
    return { ...next, status: "active", promotedBy: "automatic", promotedAt };
  }
  return next;
}

export function canManuallyPromote(entry: WorkoutLibraryEntry, completed: boolean, ftp: number): boolean {
  return completed && entry.status !== "retired" && QUALITY_TYPES.has(entry.workoutType) && isProtocolSafe(entry, ftp);
}

function bestEvidence(entry: WorkoutLibraryEntry): number {
  return Math.max(0, ...entry.evidence.map(({ executionScore }) => executionScore));
}

export function selectLibraryWorkout(entries: WorkoutLibraryEntry[], slot: DaySlot, ftp: number): WorkoutLibraryEntry | null {
  return entries
    .filter((entry) =>
      entry.status === "active" &&
      (slot.kind === "quality" || slot.kind === "event") &&
      slot.allowedTypes.includes(entry.workoutType) &&
      entry.durationMin >= slot.duration.minMin &&
      entry.durationMin <= slot.duration.maxMin &&
      isProtocolSafe(entry, ftp) &&
      (slot.maxIntensityPct === null || parsePrescription(entry.workoutText, ftp).every((step) => step.targetPctFtp <= slot.maxIntensityPct!))
    )
    .sort((a, b) =>
      bestEvidence(b) - bestEvidence(a) ||
      b.evidence.length - a.evidence.length ||
      Math.abs(a.durationMin - slot.duration.nominalMin) - Math.abs(b.durationMin - slot.duration.nominalMin) ||
      a.recentUses.length - b.recentUses.length ||
      a.id.localeCompare(b.id)
    )[0] ?? null;
}
