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

// Negation words that flip a nearby tag keyword ("avoid hills", "no racing", "without climbs").
const NEGATION = /\b(?:no|not|avoid|without|skip|minimal|less|few|fewer)\b/;

// Clause boundaries. Negation only carries within the clause it sits in, so a negation in an *earlier*
// clause doesn't reach across and flip a later tag. Boundaries: punctuation, newlines, dashes, and
// contrastive conjunctions ("but"/"however"/"yet") — "no rest, hilly race" and "no sprints but big
// climbs" both leave the later tag standing (RR-4).
const CLAUSE_BREAK = /[,.;:\n—–]|\s-\s|\bbut\b|\bhowever\b|\byet\b/g;

// Start index of the clause containing `index` — the char after the last clause break before it.
function clauseStart(haystack: string, index: number): number {
  const scan = new RegExp(CLAUSE_BREAK.source, "g");
  let start = 0;
  let b: RegExpExecArray | null;
  while ((b = scan.exec(haystack)) !== null) {
    if (b.index >= index) break;
    start = b.index + b[0].length;
  }
  return start;
}

// A tag counts only if it appears at least once *not* preceded by a negation word within the same
// clause — so "avoid hills" / "no racing this block" don't wrongly require a RaceSim, but a negation
// in a separate clause ("no rest weeks — hilly KOM race") leaves the tag standing.
export function tagPresent(haystack: string, re: RegExp): boolean {
  const scan = new RegExp(re.source, "g");
  let m: RegExpExecArray | null;
  while ((m = scan.exec(haystack)) !== null) {
    if (!NEGATION.test(haystack.slice(clauseStart(haystack, m.index), m.index))) return true;
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

// P5 (2026-07-24 block-generation redesign): RaceSim relaxed from a per-loading-week requirement to a
// sporadic, block-wide one — athlete direction: structured interval work (the block's primary quality,
// KB §12/REQUIRED COVERAGE) takes priority over RaceSim for the shared weekly quality-session budget;
// RaceSim doesn't need to appear every week when terrain/racing isn't itself the block's main goal.
// Prompt instruction (null when there's nothing to require); the validator below enforces the same
// block-wide floor.
export function formatSessionRequirements(req: SessionRequirements): string | null {
  if (!req.terrainRace) return null;
  return `GOAL FOCUS: this block's goal is terrain/race-driven (${req.tags.join(", ")}). Include RaceSim sporadically across the block (KB §10) — at least once total, not necessarily every loading week — and prefer terrain-flexible outdoor quality (KB §11) where it fits. Structured intervals (the block's REQUIRED COVERAGE type, if any) take priority over RaceSim for the weekly quality-session budget; place RaceSim in a week where it doesn't crowd that out.`;
}

// Post-generation enforcement (warning only — never reorders the coach's plan): a block-wide floor —
// at least one RaceSim somewhere in the block. No longer a per-loading-week requirement (P5).
export function validateSessionRequirements(days: PlannedDay[], req: SessionRequirements): string[] {
  if (!req.requireRaceSim || days.length === 0) return [];
  if (days.some((d) => d.type === "RaceSim")) return [];
  return [
    `GOAL: the block goal is terrain/race-driven (${req.tags.join(", ")}) but no RaceSim session was prescribed anywhere in the block — add at least one as key quality work (KB §10).`,
  ];
}
