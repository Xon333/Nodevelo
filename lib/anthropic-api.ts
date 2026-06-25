// Anthropic API client + call layer for training-block generation, ride analysis, retrospectives and
// ask-coach. Prompt assembly lives in ./anthropic-prompts (pure, unit-testable); this file is the thin
// shell over the SDK that sends those prompts and parses the responses (RV-8 split). The prompt builders
// and their input types are re-exported below so callers can keep importing them from "@/lib/anthropic-api".
import Anthropic from "@anthropic-ai/sdk";
import type { StructuredReflection } from "./types";
import { TRAINING_BLOCK_TOOL } from "./plan-schema";
import { RETROSPECTIVE_TOOL, RetrospectiveToolSchema } from "./retrospective-schema";
import { recordUsage } from "./ai-usage";
import {
  buildAskCoachPrompt,
  buildRideAnalysisPrompt,
  buildRetrospectivePrompt,
  buildStructuredRetrospectivePrompt,
  type AskCoachContext,
  type ReflectionInterventionInput,
  type RetrospectiveInput,
  type RideAnalysisInput,
} from "./anthropic-prompts";

// Re-export the prompt builders + their input types so existing call sites keep importing everything
// Anthropic-related from this one module (the RV-8 split kept the public surface stable).
export {
  blockDates,
  buildAthleteDataSection,
  buildSystemPrompt,
  buildUserMessage,
  buildRideAnalysisInput,
} from "./anthropic-prompts";
export { buildAskCoachPrompt, buildRideAnalysisPrompt, buildRetrospectivePrompt, buildStructuredRetrospectivePrompt };
export type { AskCoachContext, ReflectionInterventionInput, RetrospectiveInput, RideAnalysisInput };

// Non-negotiable: in-app generation always uses claude-sonnet-4-6.
export const GENERATION_MODEL = "claude-sonnet-4-6";
// Bump whenever the generation/analysis prompt structure or rules change. Stamped (with the model
// id) onto every AI-produced artifact — GeneratedPlan, TodayAnalysis, BlockHistoryEntry — so a past
// output stays reproducible/auditable when the model or prompt later changes.
export const PROMPT_VERSION = 3;
// Cheap, fast model for the low-token "ask coach" spot-checks — these inject only today's
// session + the question, never deep history, so a small model is the right cost/latency call.
export const QUICK_MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 8000;
const TEMPERATURE = 0.3;

// One client, lazily constructed. Lazy so importing this module never requires the API key
// (every call site guards with isAnthropicConfigured() first); reused so calls share one
// keep-alive agent (connection pooling) instead of spinning up a client per request.
// Bounded timeout + retries (CR-B) so a stalled model request fails within the route's maxDuration
// instead of hanging on the SDK's 10-minute default. 240s comfortably covers a full 4-week block
// generation (the longest call) while still failing fast on a dead connection.
let _client: Anthropic | null = null;
function getClient(): Anthropic {
  return (_client ??= new Anthropic({ timeout: 240_000, maxRetries: 2 }));
}

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Concatenate the text blocks of a response into the trimmed reply. Shared by the prose calls
// (ride analysis / retrospective / ask-coach) so the extraction isn't copy-pasted four times.
function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export interface GenerationResult {
  toolInput: unknown | null; // the structured tool-use payload (validate with PlanToolSchema); null if Claude didn't call the tool
  raw: string; // any text content — the regex-parser fallback path
  truncated: boolean;
}

// ---------- Today's ride analysis ----------

export async function analyseRide(input: RideAnalysisInput): Promise<string> {
  if (!isAnthropicConfigured()) {
    throw new Error("Anthropic API is not configured.");
  }
  const client = getClient();
  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 280,
    temperature: 0.3,
    messages: [{ role: "user", content: buildRideAnalysisPrompt(input) }],
  });
  void recordUsage(GENERATION_MODEL, response.usage); // fire-and-forget telemetry
  return textOf(response);
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

// ---------- Training-block generation ----------

export async function generateTrainingBlock(
  systemCached: string,
  systemDynamic: string,
  userMessage: string
): Promise<GenerationResult> {
  if (!isAnthropicConfigured()) {
    throw new Error("Anthropic API is not configured. Set ANTHROPIC_API_KEY in .env.local.");
  }
  const client = getClient();
  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    // Cache breakpoint after the stable prefix (persona + syntax + reference KB): a repeat
    // generation within the cache TTL reads it at ~0.1× instead of re-paying full input. The
    // dynamic block (seeds/directives/athlete/params) follows so it never breaks the cache.
    system: [
      { type: "text", text: systemCached, cache_control: { type: "ephemeral" } },
      { type: "text", text: systemDynamic },
    ],
    // Structured output (P2): force the plan tool so Claude returns typed JSON, not markdown to
    // regex-parse. The route validates `toolInput` with PlanToolSchema and falls back to the regex
    // parser on `raw` only if the tool output is absent/malformed.
    tools: [TRAINING_BLOCK_TOOL],
    tool_choice: { type: "tool", name: TRAINING_BLOCK_TOOL.name },
    messages: [{ role: "user", content: userMessage }],
  });
  void recordUsage(GENERATION_MODEL, response.usage); // fire-and-forget telemetry
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return { toolInput: toolUse?.input ?? null, raw, truncated: response.stop_reason === "max_tokens" };
}

// ---------- Low-token "ask coach" spot-checks ----------

export async function askCoach(ctx: AskCoachContext, query: string): Promise<string> {
  if (!isAnthropicConfigured()) throw new Error("Anthropic API is not configured.");
  const client = getClient();
  const response = await client.messages.create({
    model: QUICK_MODEL,
    max_tokens: 320,
    temperature: 0.4,
    messages: [{ role: "user", content: buildAskCoachPrompt(ctx, query) }],
  });
  void recordUsage(QUICK_MODEL, response.usage); // fire-and-forget telemetry
  return textOf(response);
}

// Streaming variant: yields text deltas as they arrive so the UI can render the reply
// progressively instead of waiting for the whole message. Usage telemetry is recorded from the
// final message once the stream completes.
export async function* streamAskCoach(ctx: AskCoachContext, query: string): AsyncGenerator<string> {
  if (!isAnthropicConfigured()) throw new Error("Anthropic API is not configured.");
  const client = getClient();
  const stream = client.messages.stream({
    model: QUICK_MODEL,
    max_tokens: 320,
    temperature: 0.4,
    messages: [{ role: "user", content: buildAskCoachPrompt(ctx, query) }],
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
  const final = await stream.finalMessage();
  void recordUsage(QUICK_MODEL, final.usage); // fire-and-forget telemetry
}
