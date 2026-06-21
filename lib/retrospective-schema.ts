// Structured retrospective reflection (Track D). Mirrors plan-schema.ts: ONE zod schema is the
// single source of truth for (a) the tool's input_schema Claude must fill and (b) validating what
// comes back. The model turns the last block's intervention hypotheses + their matured outcomes into
// structured clinical notes — so the next block reads its own reasoning, not just deterministic
// compliance seeds. The math/validation stay in TS; the model only phrases (AI-containment).
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { StructuredReflection } from "./types";
import { zodToToolInputSchema } from "./tool-schema";

const ReflectionSchema = z.object({
  dimension: z.string(), // a WorkoutType or "Overall" — ties back to the intervention it reflects on
  hypothesis: z.string(), // what the prior block bet on (grounded in the supplied intervention)
  observation: z.string(), // what actually happened (grounded in the matured outcome)
  root_cause: z.string(), // why it played out that way
  adjusted_strategy: z.string(), // the concrete change to carry into the next block
});

export const RetrospectiveToolSchema = z.object({
  reflections: z.array(ReflectionSchema).min(1),
});

export type RetrospectiveToolOutput = z.infer<typeof RetrospectiveToolSchema>;

export const RETROSPECTIVE_TOOL: Anthropic.Tool = {
  name: "submit_reflections",
  description:
    "Submit structured clinical reflections on the completed training block. Produce exactly one " +
    "reflection per supplied intervention (the hypothesis the block acted on). Ground `hypothesis` " +
    "and `observation` strictly in the supplied data — never invent metrics, dates, or numbers. " +
    "`root_cause` and `adjusted_strategy` are your coaching judgement, kept concrete and actionable.",
  input_schema: zodToToolInputSchema(RetrospectiveToolSchema),
};

// Pure formatter: render persisted reflections into the next-block system prompt. Empty → "" so the
// caller concatenates nothing when there are no reflections. Unit-tested.
export function formatReflectionsForPrompt(reflections: StructuredReflection[]): string {
  if (!reflections.length) return "";
  const lines = reflections.map(
    (r) =>
      `- [${r.dimension}] hypothesis: ${r.hypothesis} → observed: ${r.observation} ` +
      `(root cause: ${r.root_cause}); next: ${r.adjusted_strategy}`
  );
  return (
    "\nCOACH REFLECTIONS FROM LAST BLOCK (your own clinical notes — apply the adjusted strategies):\n" +
    lines.join("\n")
  );
}
