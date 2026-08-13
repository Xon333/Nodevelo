import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToToolInputSchema } from "./tool-schema";

const ObjectiveKindSchema = z.enum(["duration", "zone-time", "zone-emphasis", "effort", "structure", "qualitative", "terrain"]);
const ZoneBasisSchema = z.enum(["power", "heart-rate", "unspecified"]);

const TargetSchema = z
  .object({
    durationMin: z.number().positive().optional(),
    watts: z.number().min(30).max(2000).optional(),
    targetPctFtp: z.number().min(30).max(200).optional(),
    zone: z.string().optional(),
    reps: z.number().int().positive().optional(),
    targetHrBpm: z.number().min(60).max(230).optional(),
    targetCadenceRpm: z.number().min(30).max(150).optional(),
    terrain: z.enum(["climb", "descent"]).optional(),
  })
  .strict()
  .refine((target) => target.watts === undefined || target.targetPctFtp === undefined, {
    message: "watts and targetPctFtp are mutually exclusive",
  })
  // R5 (resolved 2026-08-12): at most one of {power, HR, cadence, terrain} may compete for ranking.
  // zone/durationMin/reps are deliberately excluded — real notes combine them with exactly one of the
  // four above (e.g. "1h z2 HR cap at 152"), and none of the three is ever a matchLaps ranking signal.
  .refine(
    (target) => {
      const power = target.watts !== undefined || target.targetPctFtp !== undefined;
      const competing = [
        power,
        target.targetHrBpm !== undefined,
        target.targetCadenceRpm !== undefined,
        target.terrain !== undefined,
      ];
      return competing.filter(Boolean).length <= 1;
    },
    { message: "at most one of power, targetHrBpm, targetCadenceRpm, terrain may be set per objective" }
  );

const PhaseSchema = z
  .object({
    description: z.string(),
    kind: ObjectiveKindSchema,
    durationMin: z.number().positive().optional(),
    zone: z.string().optional(),
    zoneBasis: ZoneBasisSchema.optional(),
    targetWatts: z.number().min(30).max(2000).optional(),
    targetPctFtp: z.number().min(30).max(200).optional(),
    reps: z.number().int().positive().optional(),
  })
  .strict()
  .refine((phase) => phase.targetWatts === undefined || phase.targetPctFtp === undefined, {
    message: "targetWatts and targetPctFtp are mutually exclusive",
  });

const ObjectiveSchema = z
  .object({
    description: z.string(),
    kind: ObjectiveKindSchema,
    zoneBasis: ZoneBasisSchema.describe(
      'Report only what the note states: "heart-rate" for HR, "power" for power/watts/%FTP, otherwise "unspecified".'
    ),
    target: TargetSchema.nullable().describe(
      "Never derive watts from targetPctFtp or targetPctFtp from watts; emit only the unit the note explicitly states."
    ),
    grounded: z.boolean(),
    sourceText: z.string().nullable(),
  })
  .strict();

export const IntentToolSchema = z
  .object({
    primaryPurpose: z.string(),
    phases: z.array(PhaseSchema),
    objectives: z.array(ObjectiveSchema),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();

export type IntentToolOutput = z.infer<typeof IntentToolSchema>;

export const INTENT_TOOL: Anthropic.Tool = {
  name: "submit_ride_intent",
  description:
    "Translate the activity note into stated phases and objectives. Never invent specificity, " +
    "derive one unit from another, calculate a verdict, or guess zoneBasis from a zone number.",
  input_schema: zodToToolInputSchema(IntentToolSchema),
};

export function parseIntentToolOutput(input: unknown): IntentToolOutput | null {
  const parsed = IntentToolSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
