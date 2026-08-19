import type { ScoredObjective } from "./types";
import { parseZoneExpression } from "./zone-expression";

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

export function groundsDurationRange(note: string, min: number, max: number): boolean {
  const masked = maskZoneTokens(note);
  const minuteUnit = "(?:(?:minutes?|mins?|min|m(?!\\s*/))\\b|')";
  const hourUnit = "(?:hours?|hrs?|hr|h)\\b";
  return (
    inRanges(masked, min, minuteUnit) && inRanges(masked, max, minuteUnit) ||
    inRanges(masked, min, hourUnit, 60) && inRanges(masked, max, hourUnit, 60)
  );
}

export function groundsWatts(note: string, watts: number): boolean {
  const masked = maskZoneTokens(note);
  const unit = "(?:watts?|w)\\b";
  return hasValue(valuesFor(masked, unit), watts) || inRanges(masked, watts, unit);
}

export function groundsHrBpm(note: string, bpm: number): boolean {
  const masked = maskZoneTokens(note);
  const unit = "(?:bpm|beats?\\s*per\\s*minute)\\b";
  return hasValue(valuesFor(masked, unit), bpm) || inRanges(masked, bpm, unit);
}

export function groundsCadenceRpm(note: string, rpm: number): boolean {
  const masked = maskZoneTokens(note);
  const unit = "(?:rpm|revolutions?\\s*per\\s*minute)\\b";
  return hasValue(valuesFor(masked, unit), rpm) || inRanges(masked, rpm, unit);
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

// NV-2 (2026-08-15): used to require its `zone` argument already in exact canonical "Z<n>" form —
// live-confirmed to reject a bare "3" outright, even though the scorer's own zoneIndex (lib/
// intent-scoring.ts) had always accepted it. Now parses through the same shared expression parser, so
// a range or list target ("Z3-4", "z2,z3") grounds too — presence-based like every other groundsX
// check here: the note mentioning ANY zone within the claimed expression is enough, not proof every
// single zone in it was independently named (a full range is a plausible paraphrase of "z3 to z4").
export function groundsZone(note: string, zone: string): boolean {
  const zones = parseZoneExpression(zone);
  if (zones.length === 0) return false;
  const mentioned = new Set([...note.matchAll(ZONE_TOKEN)].map(([, number]) => `Z${number}`));
  if (zones.some((z) => mentioned.has(z))) return true;
  if (zones.includes("Z5") && /\bvo2(?:\s*max)?\b/i.test(note)) return true;
  return Object.entries(WORD_ZONES).some(
    ([word, mapped]) => zones.includes(mapped) && new RegExp(`\\b${word}\\b`, "i").test(note)
  );
}

function groundsQualifiedZone(note: string, zone: string, qualifier: "avg" | "np"): boolean {
  const zones = parseZoneExpression(zone);
  if (zones.length === 0) return false;
  const zoneText = `(?:z|zone\\s*)${zones.map((value) => value.slice(1)).join("|")}`;
  const word = qualifier === "avg" ? "(?:avg|average)" : "(?:np|normalized\\s+power)";
  return new RegExp(`${zoneText}[^\\n]{0,24}${word}|${word}[^\\n]{0,24}${zoneText}`, "i").test(note);
}

export function groundsSegmentLabel(note: string, label: string): boolean {
  const words = label.trim().split(/\s+/).filter((word) => word.toLowerCase() !== "segment");
  return words.length > 0 && words.every((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(note));
}

// Word-boundary vocabulary match, not numeric — mirrors groundsZone's WORD_ZONES approach. Conservative
// on purpose (design doc §5's "no fuzzy NLP matching" discipline, same rule Task 6's label matching uses).
const TERRAIN_WORDS: Record<"climb" | "descent", string[]> = {
  climb: ["climb", "climbing", "climbed", "kicker", "kickers", "ascent"],
  descent: ["descent", "descending", "descended", "downhill"],
};

export function groundsTerrain(note: string, terrain: "climb" | "descent"): boolean {
  return TERRAIN_WORDS[terrain].some((word) => new RegExp(`\\b${word}\\b`, "i").test(note));
}

// The model may decline grounding, but may never promote unsupported numeric specificity.
export function verifyGrounding(objective: Pick<ScoredObjective, "grounded" | "target">, note: string): boolean {
  if (!objective.grounded || !objective.target) return false;
  const { durationMin, durationMaxMin, segmentLabel, avgPowerZone, normalizedPowerZone, watts, targetPctFtp, reps, zone, targetHrBpm, targetCadenceRpm, terrain } = objective.target;
  const targets = [durationMin, durationMaxMin, segmentLabel, avgPowerZone, normalizedPowerZone, watts, targetPctFtp, reps, zone, targetHrBpm, targetCadenceRpm, terrain];
  const fields = [
    durationMin === undefined || groundsDuration(note, durationMin),
    durationMaxMin === undefined || (durationMin !== undefined && groundsDurationRange(note, durationMin, durationMaxMin)),
    segmentLabel === undefined || groundsSegmentLabel(note, segmentLabel),
    avgPowerZone === undefined || groundsQualifiedZone(note, avgPowerZone, "avg"),
    normalizedPowerZone === undefined || groundsQualifiedZone(note, normalizedPowerZone, "np"),
    watts === undefined || groundsWatts(note, watts),
    targetPctFtp === undefined || groundsPctFtp(note, targetPctFtp),
    reps === undefined || groundsReps(note, reps),
    zone === undefined || groundsZone(note, zone),
    targetHrBpm === undefined || groundsHrBpm(note, targetHrBpm),
    targetCadenceRpm === undefined || groundsCadenceRpm(note, targetCadenceRpm),
    terrain === undefined || groundsTerrain(note, terrain),
  ];
  return fields.every(Boolean) && targets.some((target) => target !== undefined);
}
