// Anthropic API client + call layer for ride analysis and retrospectives.
// Prompt assembly lives in ./anthropic-prompts (pure, unit-testable); this file is the thin
// shell over the SDK that sends those prompts and parses the responses (RV-8 split). The prompt builders
// and their input types are re-exported below so callers can keep importing them from "@/lib/anthropic-api".
import Anthropic from "@anthropic-ai/sdk";
export { isAnthropicConfigured } from "./anthropic-config";
import { isAnthropicConfigured } from "./anthropic-config";
import type { StructuredReflection } from "./types";
import { RETROSPECTIVE_TOOL, RetrospectiveToolSchema } from "./retrospective-schema";
import { recordUsage } from "./ai-usage";
import {
  buildRideAnalysisPrompt,
  buildRetrospectivePrompt,
  buildStructuredRetrospectivePrompt,
  type ReflectionInterventionInput,
  type RetrospectiveInput,
  type RideAnalysisInput,
} from "./anthropic-prompts";

// Re-export the prompt builders + their input types so existing call sites keep importing everything
// Anthropic-related from this one module (the RV-8 split kept the public surface stable).
export {
  buildRideAnalysisInput,
} from "./anthropic-prompts";
export { buildRideAnalysisPrompt, buildRetrospectivePrompt, buildStructuredRetrospectivePrompt };
export type { ReflectionInterventionInput, RetrospectiveInput, RideAnalysisInput };

// Non-negotiable: in-app language generation uses claude-sonnet-4-6.
export const GENERATION_MODEL = "claude-sonnet-4-6";
// Bump whenever an analysis/retrospective prompt structure or rule changes. Stamped (with the model
// id) onto every AI-produced artifact — TodayAnalysis and BlockHistoryEntry — so a past
// output stays reproducible/auditable when the model or prompt later changes.
export const PROMPT_VERSION = 10; // 9→10: retrospectives identify the effective early-closeout window
const TEMPERATURE = 0.3;

// One client, lazily constructed. Lazy so importing this module never requires the API key
// (every call site guards with isAnthropicConfigured() first); reused so calls share one
// keep-alive agent (connection pooling) instead of spinning up a client per request.
// Bounded timeout + retries (CR-B) so a stalled model request fails instead of hanging on the SDK's
// 10-minute default.
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  return (_client ??= new Anthropic({ timeout: 240_000, maxRetries: 2 }));
}

// Concatenate the text blocks of a response into the trimmed reply. Shared by the prose calls
// (ride analysis / retrospective) so the extraction isn't copy-pasted.
function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// NV-8 (2026-08-15): analyseRide used to
// return a bare string, discarding stop_reason entirely, so a token-limit cutoff mid-sentence was
// indistinguishable from a genuinely finished note. Scoped to analyseRide only (the audit's exact
// finding); the retrospective call sharing textOf() is untouched.
export interface ProseResult {
  text: string;
  truncated: boolean;
  stopReason: Anthropic.Message["stop_reason"];
}

// ---------- Today's ride analysis ----------

// Live-confirmed 2026-08-15, the same day NV-8's truncation-audit shipped: 280 was sized before NV-7's
// evidence-bound-prose instructions (measured/inferred/athlete-reported discipline, the decoupling
// claim-strength clause, descending safety) lengthened what the model needs to write to satisfy them —
// a real note cut off mid-sentence ("For next session, the") the very first time NV-8's new stopReason
// check ran against production. No longer a guess: raised with direct evidence, same as NV-10's
// intent-parsing budget.
const RIDE_ANALYSIS_MAX_TOKENS = 450;

export async function analyseRide(input: RideAnalysisInput): Promise<ProseResult> {
  if (!isAnthropicConfigured()) {
    throw new Error("Anthropic API is not configured.");
  }
  const client = getClient();
  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: RIDE_ANALYSIS_MAX_TOKENS,
    temperature: 0.3,
    messages: [{ role: "user", content: buildRideAnalysisPrompt(input) }],
  });
  void recordUsage(GENERATION_MODEL, response.usage); // fire-and-forget telemetry
  return {
    text: textOf(response),
    truncated: response.stop_reason === "max_tokens",
    stopReason: response.stop_reason,
  };
}

// ---------- Block retrospective ----------

export async function generateRetrospective(input: RetrospectiveInput): Promise<string> {
  if (!isAnthropicConfigured()) throw new Error("Anthropic API is not configured.");
  const client = getClient();
  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 380,
    temperature: 0.3,
    messages: [{ role: "user", content: buildRetrospectivePrompt(input) }],
  });
  void recordUsage(GENERATION_MODEL, response.usage); // fire-and-forget telemetry
  return textOf(response);
}

// Track D — structured retrospective reflection. Feeds the block's matured intervention hypotheses +
// their outcomes to the model via native tool-use, returning one StructuredReflection each. Additive
// to the prose retrospective; one extra call per ~4-week block. Degrades to [] on any failure so the
// block always completes. The model only phrases — every number is supplied, never invented.
export async function generateStructuredRetrospective(
  input: RetrospectiveInput & { interventions: ReflectionInterventionInput[] }
): Promise<StructuredReflection[]> {
  if (!isAnthropicConfigured()) throw new Error("Anthropic API is not configured.");
  if (input.interventions.length === 0) return [];

  const client = getClient();
  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 700,
    temperature: TEMPERATURE,
    tools: [RETROSPECTIVE_TOOL],
    tool_choice: { type: "tool", name: RETROSPECTIVE_TOOL.name },
    messages: [{ role: "user", content: buildStructuredRetrospectivePrompt(input) }],
  });
  void recordUsage(GENERATION_MODEL, response.usage); // fire-and-forget telemetry

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) return [];
  const parsed = RetrospectiveToolSchema.safeParse(toolUse.input);
  return parsed.success ? parsed.data.reflections : [];
}
