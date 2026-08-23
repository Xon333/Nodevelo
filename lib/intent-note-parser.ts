import type { IntentInterpretation, IntentTarget, ScoredObjective, StructuredIntent } from "./types";

export const DETERMINISTIC_INTENT_VERSION = 1;
export const ACTIVITY_NOTE_MAX_CHARS = 2000;

function durationMinutes(text: string): number | undefined {
  const minuteSeconds = text.match(/\b(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?\b/i);
  if (minuteSeconds) return Number(minuteSeconds[1]) + Number(minuteSeconds[2]) / 60;
  const hours = text.match(/\b(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\b/i);
  if (hours) return Number(hours[1]) * 60;
  const minutes = text.match(/\b(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?\b/i);
  return minutes ? Number(minutes[1]) : undefined;
}

function qualifiedZone(text: string, qualifier: "avg" | "np"): string | undefined {
  const word = qualifier === "avg" ? "(?:avg|average)" : "(?:np|normali[sz]ed\\s+power)";
  const match = text.match(new RegExp(`\\b(?:z|zone\\s*)([1-7])\\b\\s*${word}|${word}\\s*\\b(?:z|zone\\s*)([1-7])\\b`, "i"));
  const zone = match?.[1] ?? match?.[2];
  return zone ? `Z${zone}` : undefined;
}

function parseTarget(label: string, details: string): IntentTarget | null {
  const durationMin = durationMinutes(details);
  const avgPowerZone = qualifiedZone(details, "avg");
  const normalizedPowerZone = qualifiedZone(details, "np");
  const unqualifiedZone = !avgPowerZone && !normalizedPowerZone
    ? details.match(/\b(?:z|zone\s*)([1-7])\b/i)?.[1]
    : undefined;
  if (durationMin === undefined && !avgPowerZone && !normalizedPowerZone && !unqualifiedZone) return null;
  return {
    segmentLabel: label,
    ...(durationMin === undefined ? {} : { durationMin }),
    ...(avgPowerZone ? { avgPowerZone } : {}),
    ...(normalizedPowerZone ? { normalizedPowerZone } : {}),
    ...(unqualifiedZone ? { zone: `Z${unqualifiedZone}` } : {}),
  };
}

export function parseDeterministicIntent(note: string): IntentInterpretation | null {
  const objectives: ScoredObjective[] = [];
  const phases: StructuredIntent["phases"] = [];
  for (const rawLine of note.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*[-*]\s*([^()]+?)\s*\(([^)]*)\)\s*$/);
    if (!match) continue;
    const label = match[1].trim();
    const details = match[2].trim();
    const target = parseTarget(label, details);
    if (!target) continue;
    const sourceText = `${label} (${details})`;
    objectives.push({
      description: sourceText,
      kind: "segment",
      zoneBasis: target.avgPowerZone || target.normalizedPowerZone ? "power" : "unspecified",
      target,
      grounded: true,
      sourceText,
      measurable: false,
      scored: false,
      scopeMin: null,
      evidence: null,
    });
    phases.push({
      description: sourceText,
      kind: "segment",
      ...(target.durationMin === undefined ? {} : { durationMin: target.durationMin }),
      ...(target.zone ? { targetZone: target.zone } : {}),
      ...(target.avgPowerZone ? { avgPowerZone: target.avgPowerZone } : {}),
      ...(target.normalizedPowerZone ? { normalizedPowerZone: target.normalizedPowerZone } : {}),
      segmentLabel: label,
    });
  }
  if (objectives.length === 0) return null;
  return {
    intent: { primaryPurpose: "Execute the labelled Intervals.icu segments stated in the note.", phases },
    confidence: "high",
    objectives,
    model: "deterministic-note-parser",
    promptVersion: DETERMINISTIC_INTENT_VERSION,
  };
}
