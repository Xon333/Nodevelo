// Anthropic API client + call layer for training-block generation, ride analysis, retrospectives and
// ask-coach. Prompt assembly lives in ./anthropic-prompts (pure, unit-testable); this file is the thin
// shell over the SDK that sends those prompts and parses the responses (RV-8 split). The prompt builders
// and their input types are re-exported below so callers can keep importing them from "@/lib/anthropic-api".
import Anthropic from "@anthropic-ai/sdk";
import type { IntentInterpretation, StructuredReflection } from "./types";
import { TRAINING_BLOCK_TOOL } from "./plan-schema";
import { RETROSPECTIVE_TOOL, RetrospectiveToolSchema } from "./retrospective-schema";
import { buildNarrativeCriticPrompt, NARRATIVE_CRITIC_TOOL, parseNarrativeCriticOutput, type NarrativeCriticOutput, type WeekFacts } from "./narrative-critic";
import { INTENT_TOOL, parseIntentToolOutput } from "./intent-schema";
import { buildIntentPrompt, INTENT_PROMPT_VERSION } from "./intent-prompt";
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
export const PROMPT_VERSION = 6;
// Cheap, fast model for the low-token "ask coach" spot-checks — these inject only today's
// session + the question, never deep history, so a small model is the right cost/latency call.
export const QUICK_MODEL = "claude-haiku-4-5";
const TEMPERATURE = 0.3;

// A fixed 8,000-token ceiling was tuned for 4-week blocks (28 structured days) and silently
// truncated 6/8-week requests (42/56 days) before the model finished the tool call — the plan
// then failed schema validation with no indication why. Scale the allowance with the day count
// instead of guessing one number for every length.
export function generationMaxTokens(lengthWeeks: 2 | 4 | 6 | 8): number {
  switch (lengthWeeks) {
    case 2:
    case 4:
      return 8000;
    case 6:
      return 12000;
    case 8:
      return 16000;
  }
}

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
  stopReason: Anthropic.Message["stop_reason"]; // the provider's raw stop reason, so the route can tell a token-limit cutoff apart from other malformed output
}

// ---------- Activity-note intent ----------

export async function parseRideIntent(note: string, rideDurationMin: number): Promise<IntentInterpretation | null> {
  if (!isAnthropicConfigured()) throw new Error("Anthropic API is not configured.");
  const client = getClient();
  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 900,
    temperature: TEMPERATURE,
    tools: [INTENT_TOOL],
    tool_choice: { type: "tool", name: INTENT_TOOL.name },
    messages: [{ role: "user", content: buildIntentPrompt(note, rideDurationMin) }],
  });
  void recordUsage(GENERATION_MODEL, response.usage);

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  const parsed = toolUse ? parseIntentToolOutput(toolUse.input) : null;
  // A completed response with no usable tool output is a terminal interpreter result. SDK errors are
  // deliberately allowed to throw so a transient network failure does not burn the note fingerprint.
  if (!parsed) return null;

  return {
    intent: {
      primaryPurpose: parsed.primaryPurpose,
      phases: parsed.phases.map((phase) => ({
        ...phase,
        ...(phase.zone === undefined ? {} : { targetZone: phase.zone }),
      })),
    },
    confidence: parsed.confidence,
    objectives: parsed.objectives.map((objective) => ({
      ...objective,
      measurable: false,
      scored: false,
      scopeMin: null,
      evidence: null,
    })),
    model: GENERATION_MODEL,
    promptVersion: INTENT_PROMPT_VERSION,
  };
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

// ---------- Narrative-coherence critic (P3c) ----------

// A small, cheap follow-up check — never the generation model, never touches the schedule, only the
// overview string. Best-effort by design: never throws, returns null on any failure (misconfigured,
// no tool_use block, malformed response) so a caller can fall back to the original overview untouched
// — mirroring generateStructuredRetrospective's graceful-degradation contract, not
// generateTrainingBlock's throw-on-misconfiguration one, since this check is a secondary enhancement
// to an already-successful generation, not the generation itself.
export async function critiqueOverview(overview: string, facts: WeekFacts[]): Promise<NarrativeCriticOutput | null> {
  if (!isAnthropicConfigured()) return null;
  try {
    const client = getClient();
    const response = await client.messages.create({
      model: QUICK_MODEL,
      max_tokens: 400,
      temperature: TEMPERATURE,
      tools: [NARRATIVE_CRITIC_TOOL],
      tool_choice: { type: "tool", name: NARRATIVE_CRITIC_TOOL.name },
      messages: [{ role: "user", content: buildNarrativeCriticPrompt(overview, facts) }],
    });
    void recordUsage(QUICK_MODEL, response.usage); // fire-and-forget telemetry
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    return toolUse ? parseNarrativeCriticOutput(toolUse.input) : null;
  } catch {
    return null;
  }
}

// ---------- Training-block generation ----------

export async function generateTrainingBlock(
  systemCached: string,
  systemDynamic: string,
  userMessage: string,
  lengthWeeks: 2 | 4 | 6 | 8
): Promise<GenerationResult> {
  if (!isAnthropicConfigured()) {
    throw new Error("Anthropic API is not configured.");
  }
  const client = getClient();
  const response = await client.messages.create({
    model: GENERATION_MODEL,
    max_tokens: generationMaxTokens(lengthWeeks),
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
  return {
    toolInput: toolUse?.input ?? null,
    raw,
    truncated: response.stop_reason === "max_tokens",
    stopReason: response.stop_reason,
  };
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
