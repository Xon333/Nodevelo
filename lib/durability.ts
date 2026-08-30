// Durability prescription taxonomy (Track B). Durability is a stimulus *category*, not one workout:
// five templates that each train a different fatigue-resistance mechanism. The template for a block
// is chosen DETERMINISTICALLY — limiter-driven from the athlete model, else rotated to keep adaptation
// broad — and structures the week's long Z2 ride (the intensity sits inside the duration, never
// replacing it). The LLM only phrases the chosen, hardwired structure. See KB §12.

import type { Insight } from "./types";
import { tagPresent } from "./session-requirements";

export type DurabilityTemplateId = "A" | "B" | "C" | "D" | "E";

export const DURABILITY_RECIPES = {
  A: { kind: "steady" },
  B: { kind: "late-repeats", reps: 2, workSec: 600, workPct: 90, recoverySec: 300 },
  C: { kind: "late-repeats", reps: 4, workSec: 180, workPct: 110, recoverySec: 180 },
  D: { kind: "late-repeats", reps: 8, workSec: 15, workPct: 150, recoverySec: 225 },
  E: { kind: "distributed", reps: 6, workSec: 60, workPct: 105, recoverySec: 840 },
} as const;

export interface DurabilityTemplate {
  id: DurabilityTemplateId;
  name: string;
  mechanism: string;
  structure: string; // how to build the long ride — injected into the generation prompt
}

export const DURABILITY_TEMPLATES: DurabilityTemplate[] = [
  {
    id: "A",
    name: "Pure accumulation",
    mechanism: "raw aerobic volume → fatigue resistance",
    structure: "a long, unbroken Z2 ride at the duration target — no embedded efforts; govern by the HR cap, not watts.",
  },
  {
    id: "B",
    name: "Fatigue-then-threshold",
    mechanism: "threshold power produced on accumulated fatigue",
    structure: "~2–3 h steady Z2, then 2–3 × 8–15 min threshold (88–105%) efforts late in the ride, then Z1/Z2 to fill the duration target — the threshold work lands in the back third, on tired legs.",
  },
  {
    id: "C",
    name: "Fatigue-then-VO2",
    mechanism: "high-end aerobic repeatability under fatigue",
    structure: "long Z2, then 4–6 × 3–4 min VO2max (106–120%) efforts placed late, then easy fill — the VO2 work comes after the bulk of the duration, not fresh.",
  },
  {
    id: "D",
    name: "Fatigue-then-neuromuscular",
    mechanism: "recruitment + sprint power when glycogen-depleted",
    structure: "long Z2, then 6–10 × 10–20 s near-maximal sprints in the final hour with full recovery between, then easy fill — trains the late-race finish.",
  },
  {
    id: "E",
    name: "Mixed density",
    mechanism: "repeatability across surges woven through fatigue",
    structure: "Z2 with micro-doses spread throughout (short surges or under/overs every ~15–20 min), not back-loaded — the variability is the stimulus; keep the overall ride at the duration target.",
  },
];

const BY_ID = new Map(DURABILITY_TEMPLATES.map((t) => [t.id, t]));

// Limiter dimension → template (the ROADMAP mapping). Threshold-under-fatigue → B; VO2 repeatability
// → C; explosive finish (SIT/neuromuscular) → D; systemic fatigue / low volume tolerance → A.
const LIMITER_TEMPLATE: Array<{ dimension: string; id: DurabilityTemplateId }> = [
  { dimension: "Threshold", id: "B" },
  { dimension: "VO2max", id: "C" },
  { dimension: "SIT", id: "D" },
  { dimension: "Overall", id: "A" },
];

function nextAfter(lastId: string | null): DurabilityTemplate {
  if (!lastId) return DURABILITY_TEMPLATES[0];
  const i = DURABILITY_TEMPLATES.findIndex((t) => t.id === lastId);
  return DURABILITY_TEMPLATES[(i + 1) % DURABILITY_TEMPLATES.length]; // i === -1 (unknown id) → wraps to A
}

// Goal-text fallback (2026-07-16 live feedback): the insight-driven LIMITER_TEMPLATE map above only
// fires on a formally DETECTED weakness. A stated goal (e.g. "move up TTE") should still bias
// selection toward the matching template when no insight already decided it -- otherwise a goal the
// athlete explicitly named can go completely unaddressed by the long ride for as many blocks as it
// takes a weakness to get formally flagged. Same three dimensions LIMITER_TEMPLATE already covers.
// No `/i` flags: matched against an already-lowercased haystack (see the goalText branch below),
// the same convention lib/season.ts's GOAL_PATTERNS/tagPresent pairing already uses -- tagPresent
// rebuilds the regex with only the "g" flag, so an `/i` flag here would silently stop applying.
const GOAL_TEMPLATE_PATTERNS: Array<{ re: RegExp; id: DurabilityTemplateId }> = [
  { re: /\b(threshold|ftp|tte|time.?to.?exhaustion|sustained|steady.?state)\b/, id: "B" },
  { re: /\b(vo2.?max|vo2|high.?end|aerobic (power|ceiling))\b/, id: "C" },
  { re: /\b(sprint|neuromuscular|explosive|1.?min(ute)? power|5.?sec(ond)? power)\b/, id: "D" },
];

// HR-17 (2026-07-17 hostile review): an "Overall" alert/watch fires on a blunt
// `overallTrend === "down"` aggregate (lib/athlete-model.ts) with no attribution to cause -- it can
// be genuine systemic fatigue, or it can be fully explained by an environmental artifact the athlete
// model ALREADY diagnoses separately (deriveInsights' "{type} splits indoor vs outdoor" branch: hot
// outdoor rides depressing execution scores, not a training-load problem). Forcing template A (the
// safest, effort-suppressing choice) for the second case made the athlete's stated goal
// structurally unreachable for as long as the environmental pattern held — confirmed live: this
// exact athlete's real Overall alert co-occurs with a "Z2 splits indoor vs outdoor" insight, and
// every long ride defaulted to A regardless of a stated FTP/TTE goal. Only an insight the model
// itself has NOT already explained should still force the safe template.
function overallDeclineIsExplained(insights: Insight[]): boolean {
  return insights.some((i) => /splits indoor vs outdoor/.test(i.title));
}

// Pick this block's durability template: address the strongest flagged limiter (alert beats watch;
// a systemic Overall alert deliberately wins → A, the safest, rather than stacking hard late efforts
// on a fatigued athlete — UNLESS the model has already explained the decline environmentally, see
// overallDeclineIsExplained above); else — 2026-07-16 — check the athlete's stated goal text for the
// same three dimensions; else rotate from the last block's template to keep adaptation broad.
// `goalText` is optional so every pre-existing call site/test compiles and behaves unchanged
// without it.
export function selectDurabilityTemplate(insights: Insight[], lastId: string | null, goalText?: string): DurabilityTemplate {
  const weak = insights.filter((i) => i.severity === "alert" || i.severity === "watch");
  const overallExplained = overallDeclineIsExplained(insights);
  for (const sev of ["alert", "watch"] as const) {
    for (const { dimension, id } of LIMITER_TEMPLATE) {
      if (dimension === "Overall" && overallExplained) continue;
      if (weak.some((i) => i.severity === sev && i.dimension === dimension)) return BY_ID.get(id)!;
    }
  }
  if (goalText) {
    // HR-25 (2026-07-17 hostile review): tagPresent (already used by lib/season.ts's own
    // goal-text matching) strips a negated clause before it can fire -- "no interest in threshold
    // work" no longer routes to B just because "threshold" appears in the text.
    const haystack = goalText.toLowerCase();
    for (const { re, id } of GOAL_TEMPLATE_PATTERNS) {
      if (tagPresent(haystack, re)) return BY_ID.get(id)!;
    }
  }
  return nextAfter(lastId);
}

// `hasRecoveryWeek` appends the recovery-week exception. The template is chosen ONCE per block but
// this line is injected for every week — so template B ("fatigue-then-threshold") was instructing the
// model to put threshold efforts inside the recovery week's long ride too. That is the second root
// cause of the 2026-07 recovery-week defect, and it contradicts formatRecoveryWeeks' own long-ride
// rule (lib/season.ts) unless stated here as well.
export function formatDurabilityForPrompt(t: DurabilityTemplate, hasRecoveryWeek = false): string {
  const base = `DURABILITY FOCUS THIS BLOCK — template ${t.id} (${t.name}): ${t.mechanism}. Build the week's long Z2 ride as ${t.structure} The intensity sits INSIDE the duration target, never replacing it, and the long ride stays TYPE Z2 (the late efforts are part of it, not a separate quality session). See KB §12.`;
  if (!hasRecoveryWeek) return base;
  return `${base} EXCEPTION — in a RECOVERY week this template does not apply: that week's long ride is unbroken Z2 at its duration target with no embedded threshold/VO2 efforts at all.`;
}
