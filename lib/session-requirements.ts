// Goal-driven deterministic session requirements. The compiler consumes these directly and the
// publication gate verifies the finished block; no prompt or model participates.

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

// Post-generation enforcement (warning only — never reorders the coach's plan): a block-wide floor —
// at least one RaceSim somewhere in the block. No longer a per-loading-week requirement (P5).
export function validateSessionRequirements(days: PlannedDay[], req: SessionRequirements): string[] {
  if (!req.requireRaceSim || days.length === 0) return [];
  if (days.some((d) => d.type === "RaceSim")) return [];
  return [
    `GOAL: the block goal is terrain/race-driven (${req.tags.join(", ")}) but no RaceSim session was prescribed anywhere in the block — add at least one as key quality work (KB §10).`,
  ];
}
