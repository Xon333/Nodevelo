// P3c (2026-07-24 block-generation redesign): a narrative-coherence check. P2d (weeks written before
// overview) reduces but doesn't eliminate the defect class where a block's own written summary
// contradicts its actual schedule — confirmed live twice: the reviewed plan claimed "escalate SIT
// load" while shipping none, and a smoke-tested overview described a 190-minute ride as "4-hour."
//
// Design: deterministically extract the real facts (this file, pure, no LLM), then hand them to a
// small, cheap follow-up Claude call whose only job is to check the written overview against those
// facts and correct it if it disagrees. This never touches the schedule itself — only the overview
// string — which bounds the risk regardless of what the critic gets wrong. Mirrors
// retrospective-schema.ts's bundling (schema + tool + formatter in one file) and
// generateStructuredRetrospective's graceful-degradation contract (lib/anthropic-api.ts).

import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { PlannedDay, WorkoutType } from "./types";
import type { WeekTarget } from "./block-skeleton";
import { round1 } from "./stats";
import { zodToToolInputSchema } from "./tool-schema";

const QUALITY_TYPES: WorkoutType[] = ["Threshold", "VO2max", "SIT", "RaceSim"];

export interface WeekFacts {
  weekNumber: number;
  isRecovery: boolean;
  totalHours: number;
  qualityCounts: Partial<Record<WorkoutType, number>>; // only types that actually occurred
  longestRideMinutes: number;
}

// Pure: the ground truth the critic checks the overview against. Driven by weekTargets (not just
// days) so a week with zero generated days still appears — a real gap the overview shouldn't paper over.
export function extractBlockFacts(days: PlannedDay[], weekTargets: WeekTarget[]): WeekFacts[] {
  const byWeek = new Map<number, PlannedDay[]>();
  for (const d of days) {
    const list = byWeek.get(d.weekNumber);
    if (list) list.push(d);
    else byWeek.set(d.weekNumber, [d]);
  }
  return weekTargets.map((t) => {
    const weekDays = byWeek.get(t.weekNumber) ?? [];
    const totalMin = weekDays.reduce((sum, d) => sum + d.durationMin, 0);
    const qualityCounts: Partial<Record<WorkoutType, number>> = {};
    for (const type of QUALITY_TYPES) {
      const n = weekDays.filter((d) => d.type === type).length;
      if (n > 0) qualityCounts[type] = n;
    }
    const longestRideMinutes = weekDays.reduce((max, d) => Math.max(max, d.durationMin), 0);
    return { weekNumber: t.weekNumber, isRecovery: t.isRecovery, totalHours: round1(totalMin / 60), qualityCounts, longestRideMinutes };
  });
}

export function formatBlockFacts(facts: WeekFacts[]): string {
  return facts
    .map((f) => {
      const quality = Object.entries(f.qualityCounts)
        .map(([type, n]) => `${n}x ${type}`)
        .join(", ");
      return `Week ${f.weekNumber} (${f.isRecovery ? "recovery" : "loading"}): ${f.totalHours}h total, quality sessions: ${quality || "none"}, longest single ride: ${f.longestRideMinutes}min.`;
    })
    .join("\n");
}

export function buildNarrativeCriticPrompt(overview: string, facts: WeekFacts[]): string {
  return `You wrote this training-block overview:

"${overview}"

Here are the ACTUAL facts about the block, computed directly from the generated schedule (not from
your own narrative):

${formatBlockFacts(facts)}

Does the overview accurately describe these facts? Check specifically for: claimed escalation or
progression across weeks that the counts above don't support, wrong session counts or durations, and
any claim about a specific week that contradicts its actual content.

Call the tool with your answer. If the overview is accurate, return it completely unchanged in
\`overview\`. If it isn't, return a corrected overview in \`overview\` — same length and style (2-3
sentences), but matching the facts exactly.`;
}

const NarrativeCriticToolSchema = z.object({
  accurate: z.boolean(),
  overview: z.string(), // always the text to use going forward — unchanged if accurate, corrected if not
});

export type NarrativeCriticOutput = z.infer<typeof NarrativeCriticToolSchema>;

export const NARRATIVE_CRITIC_TOOL: Anthropic.Tool = {
  name: "submit_overview_check",
  description:
    "Check a training-block overview against the deterministic facts about what was actually " +
    "generated, and correct it if it disagrees. Never invent facts not listed — only compare and " +
    "rewrite the overview text itself.",
  input_schema: zodToToolInputSchema(NarrativeCriticToolSchema),
};

export function parseNarrativeCriticOutput(input: unknown): NarrativeCriticOutput | null {
  const parsed = NarrativeCriticToolSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
