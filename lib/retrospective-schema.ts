// Structured retrospective reflection (Track D). One zod schema is the source of truth for the
// tool input and response validation. The model turns intervention outcomes into history notes;
// deterministic block compilation never consumes them.
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { zodToToolInputSchema } from "./tool-schema";

const ReflectionSchema = z.object({
  dimension: z.string(), // a WorkoutType or "Overall" — ties back to the intervention it reflects on
  hypothesis: z.string(), // what the prior block bet on (grounded in the supplied intervention)
  observation: z.string(), // what actually happened (grounded in the matured outcome)
  root_cause: z.string(), // why it played out that way
  adjusted_strategy: z.string(), // retrospective coaching judgement, stored as history only
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
