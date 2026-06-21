// Goal-driven session selection (Track B). The generator already knows about RaceSim (KB §10) and
// terrain-flexible (KB §11) sessions, but reaches for them only when the prompt happens to nudge it.
// This turns the block goal + weakpoints into an explicit, DETERMINISTIC requirement that's both
// injected into the prompt and enforced post-generation (a warning, never a rewrite — same contract
// as validateSchedule). No AI in the selection; the LLM only phrases the chosen prescription.

import type { PlannedDay, WorkoutType } from "./types";

const QUALITY = new Set<WorkoutType>(["Threshold", "VO2max", "SIT", "RaceSim"]);

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

// Negation words that flip a nearby tag keyword ("avoid hills", "no racing", "without climbs").
const NEGATION = /\b(?:no|not|avoid|without|skip|minimal|less|few|fewer)\b/;

// A tag counts only if it appears at least once *not* immediately preceded (within ~15 chars) by a
// negation word — so "avoid hills" / "no racing this block" don't wrongly require a RaceSim.
function tagPresent(haystack: string, re: RegExp): boolean {
  const scan = new RegExp(re.source, "g");
  let m: RegExpExecArray | null;
  while ((m = scan.exec(haystack)) !== null) {
    if (!NEGATION.test(haystack.slice(Math.max(0, m.index - 15), m.index))) return true;
  }
  return false;
}

export function deriveSessionRequirements(goal: string, weakpoints: string[]): SessionRequirements {
  const haystack = [goal, ...weakpoints].join(" \n ").toLowerCase();
  const tags = TAG_PATTERNS.filter((p) => tagPresent(haystack, p.re)).map((p) => p.tag);
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

// Post-generation enforcement (warning only — never reorders the coach's plan). For a terrain/race
// goal: flag each *loading week* (≥2 quality sessions) that lacks a RaceSim (CR-12), plus a
// block-level floor for a block that ships zero RaceSim with no loading week to pin the warning on.
export function validateSessionRequirements(days: PlannedDay[], req: SessionRequirements): string[] {
  if (!req.requireRaceSim || days.length === 0) return [];

  const byWeek = new Map<number, PlannedDay[]>();
  for (const d of days) {
    const list = byWeek.get(d.weekNumber);
    if (list) list.push(d);
    else byWeek.set(d.weekNumber, [d]);
  }

  const warnings: string[] = [];
  let anyRaceSim = false;
  let flaggedAWeek = false;
  for (const [week, wd] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const qualityCount = wd.filter((d) => QUALITY.has(d.type)).length;
    const hasRaceSim = wd.some((d) => d.type === "RaceSim");
    if (hasRaceSim) anyRaceSim = true;
    if (qualityCount >= 2 && !hasRaceSim) {
      warnings.push(
        `GOAL: week ${week} is a loading week (${qualityCount} quality sessions) on a terrain/race goal (${req.tags.join(", ")}) but has no RaceSim — add one as key quality work (KB §10).`
      );
      flaggedAWeek = true;
    }
  }
  if (!anyRaceSim && !flaggedAWeek) {
    warnings.push(
      `GOAL: the block goal is terrain/race-driven (${req.tags.join(", ")}) but no RaceSim session was prescribed — add at least one as key quality work (KB §10).`
    );
  }
  return warnings;
}
