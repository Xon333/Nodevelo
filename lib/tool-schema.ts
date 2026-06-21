// Shared zod → Anthropic tool-use bridge. ONE place that turns a zod schema into the JSON Schema
// Claude's `input_schema` expects — used by every structured-output tool (the training-block plan
// and the block retrospective) so the conversion never drifts per call site.
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

// `z.toJSONSchema` emits a `$schema` meta key + (at runtime) `type: "object"` for an object schema;
// Anthropic's input_schema rejects the meta key, and its types want the literal `"object"`, so we
// strip the one and cast the other.
export function zodToToolInputSchema(schema: z.ZodType): Anthropic.Tool["input_schema"] {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json as Anthropic.Tool["input_schema"];
}
