// P2: structured generation via Anthropic tool-use. ONE zod schema is the single source of truth
// for (a) the tool's input_schema Claude must fill, and (b) validating what comes back — replacing
// the brittle markdown regex parser (`plan-parser.ts`, kept as a fallback). Tool-use guarantees a
// *schema*-valid plan; `workout-validate.ts` still guards *coaching*-validity downstream.

import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { WORKOUT_TYPES, type PlannedDay, type WorkoutType } from "./types";

const DaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  name: z.string().min(1),
  type: z.enum(WORKOUT_TYPES as [WorkoutType, ...WorkoutType[]]),
  durationMin: z.number().int().min(0),
  workout: z.string(), // Intervals.icu step syntax, or "Rest" for rest days
  description: z.string(),
});

const WeekSchema = z.object({
  weekNumber: z.number().int().min(1),
  theme: z.string(),
  days: z.array(DaySchema).min(1),
});

export const PlanToolSchema = z.object({
  overview: z.string(),
  weeks: z.array(WeekSchema).min(1),
});

export type PlanToolOutput = z.infer<typeof PlanToolSchema>;

// JSON Schema for Claude's tool. Derived from the zod schema so the two never drift; `$schema`
// is stripped because Anthropic's input_schema doesn't want the meta key.
function toolInputSchema(): Anthropic.Tool["input_schema"] {
  const schema = z.toJSONSchema(PlanToolSchema) as Record<string, unknown>;
  delete schema.$schema; // Anthropic's input_schema doesn't want the JSON-Schema meta key
  // z.toJSONSchema emits `type: "object"` at runtime for an object schema; the cast restores the
  // literal the SDK's InputSchema requires.
  return schema as Anthropic.Tool["input_schema"];
}

export const TRAINING_BLOCK_TOOL: Anthropic.Tool = {
  name: "submit_training_block",
  description:
    "Submit the finished structured training block. Call this exactly once with every day of the " +
    "block. Put the Intervals.icu workout step syntax in `workout` (or \"Rest\" on rest days); put " +
    "the intent + nutrition text in `description`.",
  input_schema: toolInputSchema(),
};

// Flatten the validated tool output into the app's PlannedDay[] (week number/theme propagated to
// each day; Rest days carry no workout text, matching the regex parser's output).
export function structuredToPlannedDays(parsed: PlanToolOutput): {
  overview: string;
  days: PlannedDay[];
} {
  const days: PlannedDay[] = [];
  for (const wk of parsed.weeks) {
    for (const d of wk.days) {
      days.push({
        date: d.date,
        weekNumber: wk.weekNumber,
        weekTheme: wk.theme,
        name: d.name,
        type: d.type,
        durationMin: d.durationMin,
        workoutText: d.type === "Rest" ? "" : d.workout.trim(),
        description: d.description,
      });
    }
  }
  return { overview: parsed.overview.trim(), days };
}
