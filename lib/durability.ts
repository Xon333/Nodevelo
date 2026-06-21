// Durability prescription taxonomy (Track B). Durability is a stimulus *category*, not one workout:
// five templates that each train a different fatigue-resistance mechanism. The template for a block
// is chosen DETERMINISTICALLY — limiter-driven from the athlete model, else rotated to keep adaptation
// broad — and structures the week's long Z2 ride (the intensity sits inside the duration, never
// replacing it). The LLM only phrases the chosen, hardwired structure. See KB §12.

import type { Insight } from "./types";

export type DurabilityTemplateId = "A" | "B" | "C" | "D" | "E";

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

// Pick this block's durability template: address the strongest flagged limiter (alert beats watch;
// a systemic Overall alert deliberately wins → A, the safest, rather than stacking hard late efforts
// on a fatigued athlete), else rotate from the last block's template to keep adaptation broad.
export function selectDurabilityTemplate(insights: Insight[], lastId: string | null): DurabilityTemplate {
  const weak = insights.filter((i) => i.severity === "alert" || i.severity === "watch");
  for (const sev of ["alert", "watch"] as const) {
    for (const { dimension, id } of LIMITER_TEMPLATE) {
      if (weak.some((i) => i.severity === sev && i.dimension === dimension)) return BY_ID.get(id)!;
    }
  }
  return nextAfter(lastId);
}

export function formatDurabilityForPrompt(t: DurabilityTemplate): string {
  return `DURABILITY FOCUS THIS BLOCK — template ${t.id} (${t.name}): ${t.mechanism}. Build the week's long Z2 ride as ${t.structure} The intensity sits INSIDE the duration target, never replacing it, and the long ride stays TYPE Z2 (the late efforts are part of it, not a separate quality session). See KB §12.`;
}
