import { createHash } from "node:crypto";
import type { DaySlot } from "./block-skeleton";
import { parsePrescription } from "./prescription";
import type { PlannedDay, QualityLibraryType, WorkoutLibraryEntry, WorkoutLibraryEvidence } from "./types";
import { validateWorkoutProtocol } from "./workout-validate";

const QUALITY_TYPES = new Set<QualityLibraryType>(["Threshold", "VO2max", "SIT", "RaceSim"]);

function normalizedStructuredSteps(workoutText: string): string[] {
  const out: string[] = [];
  let block: string[] = [];
  let repeats = 1;
  const flush = () => {
    for (let i = 0; i < repeats; i++) out.push(...block);
    block = [];
    repeats = 1;
  };

  for (const raw of workoutText.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (!line.startsWith("-")) {
      flush();
      repeats = Math.max(1, Number(line.match(/\b(\d+)\s*x\b/i)?.[1] ?? 1));
      continue;
    }

    const targets = [...line.matchAll(/(\d+(?:\s*-\s*\d+)?)\s*%/g)];
    let cursor = 0;
    for (const target of targets) {
      const beforeTarget = line.slice(cursor, target.index);
      const inlineReps = Math.max(1, Number(beforeTarget.match(/(\d+)\s*x\s*(?=\d+\s*(?:h|m|s|'|"))/i)?.[1] ?? 1));
      const durationSec = [...beforeTarget.matchAll(/(\d+)\s*(h|m|s|'|")/gi)].reduce((sum, token) => {
        const unit = token[2].toLowerCase();
        return sum + Number(token[1]) * (unit === "h" ? 3600 : unit === "m" || unit === "'" ? 60 : 1);
      }, 0);
      if (durationSec > 0) block.push(`${inlineReps}x${durationSec}s@${target[1].replace(/\s/g, "")}%`);
      cursor = (target.index ?? 0) + target[0].length;
    }
  }
  flush();
  return out;
}

export function fingerprintWorkout(workoutText: string): string {
  return createHash("sha256").update(normalizedStructuredSteps(workoutText).join("\n")).digest("hex");
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
      slot.kind === "quality" &&
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
