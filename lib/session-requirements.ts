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
function tagPresent(haystack: string, re: RegExp): boolean {
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

// Prompt instruction (null when there's nothing to require). The per-loading-week ask lives here; the
// validator below enforces it per loading week (≥2 quality, theme-aware) and falls back to a ≥1/block floor.
export function formatSessionRequirements(req: SessionRequirements): string | null {
  if (!req.terrainRace) return null;
  return `GOAL FOCUS: this block's goal is terrain/race-driven (${req.tags.join(", ")}). Include at least one RaceSim quality session per loading week (KB §10) as key quality work — it counts toward the weekly quality budget, not on top of it — and prefer terrain-flexible outdoor quality (KB §11) where it fits. Keep structured intervals primary.`;
}

// A week theme that marks the week as recovery/deload/taper. The LLM writes the theme free-text
// (plan-schema maps `wk.theme`), so match loosely + case-insensitively. Such weeks aren't "loading"
// weeks even if they happen to keep ≥2 quality sessions, so the per-week RaceSim ask skips them (RR-3).
const RECOVERY_WEEK = /recover|deload|unload|taper|rest week|easy week/i;

// A loading week = ≥2 quality sessions and not themed as recovery/deload/taper. The quality count
// alone is a fuzzy proxy; the theme exclusion stops a recovery week that keeps 2 quality from being
// flagged as needing a RaceSim.
function isLoadingWeek(weekDays: PlannedDay[]): boolean {
  if (weekDays.filter((d) => QUALITY.has(d.type)).length < 2) return false;
  const theme = weekDays.find((d) => d.weekTheme)?.weekTheme ?? "";
  return !RECOVERY_WEEK.test(theme);
}

// Post-generation enforcement (warning only — never reorders the coach's plan). For a terrain/race
// goal: one consolidated warning naming every loading week that lacks a RaceSim (RR-8/CR-12), plus a
// block-level floor for a block that ships zero RaceSim with no loading week to pin the warning on.
export function validateSessionRequirements(days: PlannedDay[], req: SessionRequirements): string[] {
  if (!req.requireRaceSim || days.length === 0) return [];

  const byWeek = new Map<number, PlannedDay[]>();
  for (const d of days) {
    const list = byWeek.get(d.weekNumber);
    if (list) list.push(d);
    else byWeek.set(d.weekNumber, [d]);
  }

  let anyRaceSim = false;
  const offendingWeeks: number[] = [];
  for (const [week, wd] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    if (wd.some((d) => d.type === "RaceSim")) anyRaceSim = true;
    else if (isLoadingWeek(wd)) offendingWeeks.push(week);
  }

  const warnings: string[] = [];
  if (offendingWeeks.length > 0) {
    const subject =
      offendingWeeks.length === 1
        ? `week ${offendingWeeks[0]} is a loading week`
        : `weeks ${offendingWeeks.join(", ")} are loading weeks`;
    const verb = offendingWeeks.length === 1 ? "has" : "have";
    warnings.push(
      `GOAL: ${subject} (≥2 quality) on a terrain/race goal (${req.tags.join(", ")}) but ${verb} no RaceSim — add one as key quality work each (KB §10).`
    );
  }
  // Block-level floor: a block that ships zero RaceSim with no loading week to pin the warning on
  // still needs the requirement surfaced.
  if (!anyRaceSim && offendingWeeks.length === 0) {
    warnings.push(
      `GOAL: the block goal is terrain/race-driven (${req.tags.join(", ")}) but no RaceSim session was prescribed — add at least one as key quality work (KB §10).`
    );
  }
  return warnings;
}
