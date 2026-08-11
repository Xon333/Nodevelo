import type { ScoredObjective } from "./types";

const ZONE_TOKEN = /\b(?:z|zone\s*)([1-7])\b/gi;
const NUMBER = "\\d+(?:\\.\\d+)?";

// Replace zone labels before numeric matching so the `4` in `Z4` cannot become invented reps.
export const ZONE_MASK = " <zone> ";

export function maskZoneTokens(note: string): string {
  return note.replace(ZONE_TOKEN, ZONE_MASK);
}

function hasValue(values: number[], target: number, tolerance = 0): boolean {
  return Number.isFinite(target) && values.some((value) => Math.abs(value - target) <= tolerance);
}

function inRanges(note: string, target: number, unit: string, scale = 1): boolean {
  const ranges = new RegExp(`(${NUMBER})\\s*(?:-|–|—|to)\\s*(${NUMBER})\\s*${unit}`, "gi");
  return [...note.matchAll(ranges)].some(([, lo, hi]) => target >= Number(lo) * scale && target <= Number(hi) * scale);
}

function valuesFor(note: string, unit: string, scale = 1): number[] {
  const values = new RegExp(`(${NUMBER})\\s*${unit}`, "gi");
  return [...note.matchAll(values)].map(([, value]) => Number(value) * scale);
}

export function groundsDuration(note: string, min: number): boolean {
  const masked = maskZoneTokens(note);
  // The `'` alternative must live INSIDE the unit group: `${unit}` is interpolated after `(N)\s*`, so a
  // top-level `|'` would make the whole pattern "[number+unit] OR [bare apostrophe]" and the apostrophe
  // branch would match with group 1 undefined. No `\b` after `'` — it is already a non-word character.
  const minuteUnit = "(?:(?:minutes?|mins?|min|m(?!\\s*/))\\b|')";
  const minutes = valuesFor(masked, minuteUnit, 1);
  const hours = valuesFor(masked, "(?:hours?|hrs?|hr|h)\\b", 60);
  // ponytail: bare colon notation is ambiguous; add contextual grammar only when note syntax disambiguates it.
  return (
    hasValue([...minutes, ...hours], min, 1) ||
    inRanges(masked, min, minuteUnit, 1) ||
    inRanges(masked, min, "(?:hours?|hrs?|hr|h)\\b", 60)
  );
}

export function groundsWatts(note: string, watts: number): boolean {
  const masked = maskZoneTokens(note);
  const unit = "(?:watts?|w)\\b";
  return hasValue(valuesFor(masked, unit), watts) || inRanges(masked, watts, unit);
}

export function groundsPctFtp(note: string, pct: number): boolean {
  const masked = maskZoneTokens(note);
  const unit = "(?:%|pct\\b|percent\\b)";
  return hasValue(valuesFor(masked, unit), pct) || inRanges(masked, pct, unit);
}

export function groundsReps(note: string, reps: number): boolean {
  const masked = maskZoneTokens(note);
  const repeated = [...masked.matchAll(new RegExp(`(${NUMBER})\\s*(?:x|×)(?=\\s|\\d|$)`, "gi"))]
    .map(([, value]) => Number(value));
  const named = valuesFor(masked, "(?:reps?|sets?|rounds?)\\b");
  return hasValue([...repeated, ...named], reps);
}

const WORD_ZONES: Record<string, string> = {
  recovery: "Z1",
  endurance: "Z2",
  tempo: "Z3",
  "sweet spot": "Z3",
  threshold: "Z4",
  vo2: "Z5",
};

export function groundsZone(note: string, zone: string): boolean {
  const target = zone.toUpperCase();
  if (!/^Z[1-7]$/.test(target)) return false;
  if ([...note.matchAll(ZONE_TOKEN)].some(([, number]) => `Z${number}` === target)) return true;
  if (target === "Z5" && /\bvo2(?:\s*max)?\b/i.test(note)) return true;
  return Object.entries(WORD_ZONES).some(([word, mapped]) => mapped === target && new RegExp(`\\b${word}\\b`, "i").test(note));
}

// The model may decline grounding, but may never promote unsupported numeric specificity.
export function verifyGrounding(objective: Pick<ScoredObjective, "grounded" | "target">, note: string): boolean {
  if (!objective.grounded || !objective.target) return false;
  const { durationMin, watts, targetPctFtp, reps, zone } = objective.target;
  const targets = [durationMin, watts, targetPctFtp, reps, zone];
  const fields = [
    durationMin === undefined || groundsDuration(note, durationMin),
    watts === undefined || groundsWatts(note, watts),
    targetPctFtp === undefined || groundsPctFtp(note, targetPctFtp),
    reps === undefined || groundsReps(note, reps),
    zone === undefined || groundsZone(note, zone),
  ];
  return fields.every(Boolean) && targets.some((target) => target !== undefined);
}
