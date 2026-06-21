// Goal-driven session selection (Track B). The generator already knows about RaceSim (KB §10) and
// terrain-flexible (KB §11) sessions, but reaches for them only when the prompt happens to nudge it.
// This turns the block goal + weakpoints into an explicit, DETERMINISTIC requirement that's both
// injected into the prompt and enforced post-generation (a warning, never a rewrite — same contract
// as validateSchedule). No AI in the selection; the LLM only phrases the chosen prescription.

import type { PlannedDay } from "./types";

export interface SessionRequirements {
  terrainRace: boolean; // the macro-goal implies terrain/race demands
  requireRaceSim: boolean; // ⇒ the block must carry ≥1 RaceSim quality session
  tags: string[]; // which demands were detected (for the reason + prompt)
  reason: string;
}

// Tag → the signals that imply it. Matched over goal + weakpoints (lowercased). `\b` word-ish
// boundaries keep "crit" from matching "critical", etc.
const TAG_PATTERNS: Array<{ tag: string; re: RegExp }> = [
  { tag: "climbing", re: /\b(hill|hills|hilly|climb|climbs|climbing|kom|gradient|elevation|ascent|mountain|col)\b/ },
  { tag: "racing", re: /\b(race|races|racing|event|crit|criterium|road ?race|fondo|gran ?fondo|sportive)\b/ },
  { tag: "punchy", re: /\b(punch|punchy|attack|attacks|surge|surges)\b/ },
  { tag: "gravel", re: /\bgravel\b/ },
];

export function deriveSessionRequirements(goal: string, weakpoints: string[]): SessionRequirements {
  const haystack = [goal, ...weakpoints].join(" \n ").toLowerCase();
  const tags = TAG_PATTERNS.filter((p) => p.re.test(haystack)).map((p) => p.tag);
  const terrainRace = tags.length > 0;
  return {
    terrainRace,
    requireRaceSim: terrainRace,
    tags,
    reason: terrainRace
      ? `Goal/weakpoints imply ${tags.join(", ")} demands — RaceSim rehearses them directly (KB §10).`
      : "No terrain/race demands detected in the goal — no RaceSim requirement.",
  };
}

// Prompt instruction (null when there's nothing to require). The per-loading-week ask lives here;
// the validator below enforces only the ≥1/block floor (loading-vs-recovery-week detection is fuzzy).
export function formatSessionRequirements(req: SessionRequirements): string | null {
  if (!req.terrainRace) return null;
  return `GOAL FOCUS: this block's goal is terrain/race-driven (${req.tags.join(", ")}). Include at least one RaceSim quality session per loading week (KB §10) as key quality work — it counts toward the weekly quality budget, not on top of it — and prefer terrain-flexible outdoor quality (KB §11) where it fits. Keep structured intervals primary.`;
}

// Post-generation enforcement: a terrain/race goal with zero RaceSim in the whole block is the
// failure mode this closes. Warning only — never reorders the coach's plan.
export function validateSessionRequirements(days: PlannedDay[], req: SessionRequirements): string[] {
  if (!req.requireRaceSim) return [];
  if (days.some((d) => d.type === "RaceSim")) return [];
  return [
    `GOAL: the block goal is terrain/race-driven (${req.tags.join(", ")}) but no RaceSim session was prescribed — add at least one as key quality work (KB §10).`,
  ];
}
