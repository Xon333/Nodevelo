import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { PROMPT_VERSION } from "../lib/anthropic-api";
import { RETROSPECTIVE_TOOL } from "../lib/retrospective-schema";
import {
  estimateExperimentCost,
  findUnsupportedClaims,
  type CandidatePricing,
  type ExperimentResult,
  type ExperimentUsage,
} from "./fr6-language-experiment";
import type { Fr6ExperimentCase } from "./fr6-language-fixtures";

export type Fr6Provider = "anthropic" | "openai" | "google" | "mistral";

export interface Fr6Candidate {
  provider: Fr6Provider;
  model: string;
  credential: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "GEMINI_API_KEY" | "MISTRAL_API_KEY";
  pricing: CandidatePricing;
}

interface AnthropicMessageClient {
  messages: {
    create(request: Record<string, unknown>): Promise<unknown>;
  };
}

export interface ProviderCaseDependencies {
  env: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  createAnthropicClient?: (options: {
    apiKey: string;
    maxRetries: 0;
    timeout: 240_000;
  }) => AnthropicMessageClient;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  createAbortController?: () => {
    signal: AbortSignal;
    abort(): void;
  };
}

const ZERO_USAGE: ExperimentUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};

function anthropic(model: string, prices: {
  input: number;
  cached: number;
  write: number;
  output: number;
}): Fr6Candidate {
  return candidate("anthropic", model, "ANTHROPIC_API_KEY", prices);
}

function openai(model: string, prices: {
  input: number;
  cached: number;
  write: number;
  output: number;
}): Fr6Candidate {
  return candidate("openai", model, "OPENAI_API_KEY", prices);
}

function google(model: string, prices: {
  input: number;
  cached: number;
  write: number;
  output: number;
}): Fr6Candidate {
  return candidate("google", model, "GEMINI_API_KEY", prices);
}

function mistral(model: string, prices: {
  input: number;
  cached: number;
  write: number;
  output: number;
}): Fr6Candidate {
  return candidate("mistral", model, "MISTRAL_API_KEY", prices);
}

function candidate(
  provider: Fr6Provider,
  model: string,
  credential: Fr6Candidate["credential"],
  prices: { input: number; cached: number; write: number; output: number },
): Fr6Candidate {
  return {
    provider,
    model,
    credential,
    pricing: {
      inputPerMillion: prices.input,
      cachedInputPerMillion: prices.cached,
      cacheWritePerMillion: prices.write,
      outputPerMillion: prices.output,
    },
  };
}

// Prices are the standard synchronous USD list prices captured by the dated FR-6 research.
// They deliberately stay experiment-local and do not replace production usage accounting.
export const FR6_CANDIDATES: readonly Fr6Candidate[] = [
  anthropic("claude-sonnet-4-6", { input: 3, cached: 0.3, write: 3.75, output: 15 }),
  anthropic("claude-haiku-4-5", { input: 1, cached: 0.1, write: 1.25, output: 5 }),
  openai("gpt-5.6-luna", { input: 0.2, cached: 0.02, write: 0.25, output: 1.2 }),
  google("gemini-3.1-flash-lite", { input: 0.25, cached: 0.025, write: 0.25, output: 1.5 }),
  mistral("mistral-small-2603", { input: 0.15, cached: 0.015, write: 0.15, output: 0.6 }),
];

interface ProviderResponse {
  output: string;
  parsedInput?: unknown;
  usage: ExperimentUsage;
  finishReason: string | null;
  truncated: boolean;
  failed: boolean;
}

export async function runProviderCase(
  selected: Fr6Candidate,
  fixture: Fr6ExperimentCase,
  deps: ProviderCaseDependencies,
): Promise<ExperimentResult> {
  const key = deps.env[selected.credential];
  if (!key) {
    return baseResult(selected, fixture, {
      status: "missing-credential",
      output: `Missing credential: ${selected.credential}`,
    });
  }

  const now = deps.now ?? performance.now.bind(performance);
  const startedAt = now();
  try {
    const response = await requestProvider(selected, fixture, key, deps);
    const latencyMs = Math.max(0, now() - startedAt);
    const validation = validateOutput(fixture, response);
    const status = response.failed
      ? "request-failed"
      : !validation.schemaValid
        ? "schema-invalid"
        : response.truncated
          ? "truncated"
          : "ok";

    return {
      ...baseResult(selected, fixture),
      status,
      output: response.output,
      parsed: validation.parsed,
      usage: response.usage,
      costUsd: estimateExperimentCost(selected.pricing, response.usage),
      latencyMs,
      finishReason: response.finishReason,
      schemaValid: validation.schemaValid,
      unsupportedClaims:
        response.output.length > 0
          ? findUnsupportedClaims(response.output, fixture.grounding)
          : [],
    };
  } catch (error) {
    const latencyMs = Math.max(0, now() - startedAt);
    return baseResult(selected, fixture, {
      status: "request-failed",
      output: sanitizedFailure(selected.provider, error),
      latencyMs,
    });
  }
}

function baseResult(
  selected: Fr6Candidate,
  fixture: Fr6ExperimentCase,
  overrides: Partial<ExperimentResult> = {},
): ExperimentResult {
  return {
    caseId: fixture.id,
    category: fixture.category,
    provider: selected.provider,
    model: selected.model,
    promptVersion: String(PROMPT_VERSION),
    status: "request-failed",
    output: "",
    parsed: null,
    usage: { ...ZERO_USAGE },
    costUsd: 0,
    latencyMs: 0,
    finishReason: null,
    retries: 0,
    schemaValid: fixture.schema === null,
    unsupportedClaims: [],
    ...overrides,
  };
}

async function requestProvider(
  selected: Fr6Candidate,
  fixture: Fr6ExperimentCase,
  key: string,
  deps: ProviderCaseDependencies,
): Promise<ProviderResponse> {
  switch (selected.provider) {
    case "anthropic":
      return requestAnthropic(selected, fixture, key, deps);
    case "openai":
      return requestOpenAi(selected, fixture, key, deps);
    case "google":
      return requestGoogle(selected, fixture, key, deps);
    case "mistral":
      return requestMistral(selected, fixture, key, deps);
  }
}

async function requestAnthropic(
  selected: Fr6Candidate,
  fixture: Fr6ExperimentCase,
  key: string,
  deps: ProviderCaseDependencies,
): Promise<ProviderResponse> {
  const createClient =
    deps.createAnthropicClient ??
    ((options) => new Anthropic(options) as unknown as AnthropicMessageClient);
  const client = createClient({ apiKey: key, maxRetries: 0, timeout: 240_000 });
  const request: Record<string, unknown> = {
    model: selected.model,
    max_tokens: fixture.maxOutputTokens,
    temperature: 0.3,
    service_tier: "standard_only",
    messages: [{ role: "user", content: fixture.prompt }],
  };
  if (fixture.category === "structured-retrospective") {
    request.tools = [RETROSPECTIVE_TOOL];
    request.tool_choice = { type: "tool", name: RETROSPECTIVE_TOOL.name };
  }

  const raw = asRecord(await client.messages.create(request));
  const blocks = Array.isArray(raw.content) ? raw.content.map(asRecord) : [];
  const tool = blocks.find(
    (block) => block.type === "tool_use" && block.name === RETROSPECTIVE_TOOL.name,
  );
  const output =
    fixture.category === "structured-retrospective"
      ? tool === undefined
        ? ""
        : (JSON.stringify(tool.input) ?? "")
      : blocks
          .filter((block) => block.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join("\n")
          .trim();
  const usage = normalizeAnthropicUsage(asRecord(raw.usage));
  const finishReason = stringOrNull(raw.stop_reason);
  return {
    output,
    parsedInput: tool?.input,
    usage,
    finishReason,
    truncated:
      finishReason === "max_tokens" || finishReason === "model_context_window_exceeded",
    failed:
      output.length === 0 ||
      (finishReason !== "end_turn" &&
        finishReason !== "tool_use" &&
        finishReason !== "max_tokens" &&
        finishReason !== "model_context_window_exceeded"),
  };
}

async function requestOpenAi(
  selected: Fr6Candidate,
  fixture: Fr6ExperimentCase,
  key: string,
  deps: ProviderCaseDependencies,
): Promise<ProviderResponse> {
  const body: Record<string, unknown> = {
    model: selected.model,
    input: fixture.prompt,
    max_output_tokens: fixture.maxOutputTokens,
    store: false,
    service_tier: "default",
    temperature: 0.3,
    reasoning: { effort: "none" },
  };
  if (fixture.category === "structured-retrospective") {
    body.text = {
      format: {
        type: "json_schema",
        name: RETROSPECTIVE_TOOL.name,
        strict: true,
        schema: jsonSchema(fixture),
      },
    };
  }

  const raw = await fetchJsonWithTimeout(
    deps,
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "OpenAI",
  );
  const refused = hasOpenAiRefusal(raw);
  const output = refused ? "OpenAI response refused." : extractOpenAiText(raw);
  const status = stringOrNull(raw.status);
  const incompleteReason = stringOrNull(asRecord(raw.incomplete_details).reason);
  const truncated = status === "incomplete" && incompleteReason === "max_output_tokens";
  return {
    output,
    usage: normalizeOpenAiUsage(asRecord(raw.usage)),
    finishReason: refused ? "refusal" : (incompleteReason ?? status),
    truncated,
    failed: refused || output.length === 0 || (status !== "completed" && !truncated),
  };
}

async function requestGoogle(
  selected: Fr6Candidate,
  fixture: Fr6ExperimentCase,
  key: string,
  deps: ProviderCaseDependencies,
): Promise<ProviderResponse> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: fixture.maxOutputTokens,
    temperature: 0.3,
  };
  if (fixture.category === "structured-retrospective") {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseJsonSchema = jsonSchema(fixture);
  }
  const raw = await fetchJsonWithTimeout(
    deps,
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selected.model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: fixture.prompt }] }],
        generationConfig,
      }),
    },
    "Google",
  );
  const firstCandidate = asRecord(arrayFirst(raw.candidates));
  const parts = Array.isArray(asRecord(firstCandidate.content).parts)
    ? (asRecord(firstCandidate.content).parts as unknown[]).map(asRecord)
    : [];
  const output = parts
    .filter((part) => typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
  const finishReason = stringOrNull(firstCandidate.finishReason);
  return {
    output,
    usage: normalizeGoogleUsage(asRecord(raw.usageMetadata)),
    finishReason,
    truncated: finishReason === "MAX_TOKENS",
    failed:
      output.length === 0 ||
      (finishReason !== "STOP" && finishReason !== "MAX_TOKENS"),
  };
}

async function requestMistral(
  selected: Fr6Candidate,
  fixture: Fr6ExperimentCase,
  key: string,
  deps: ProviderCaseDependencies,
): Promise<ProviderResponse> {
  const body: Record<string, unknown> = {
    model: selected.model,
    max_tokens: fixture.maxOutputTokens,
    temperature: 0.3,
    reasoning_effort: "none",
    service_tier: "standard_only",
    messages: [{ role: "user", content: fixture.prompt }],
  };
  if (fixture.category === "structured-retrospective") {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: RETROSPECTIVE_TOOL.name,
        strict: true,
        schema: jsonSchema(fixture),
      },
    };
  }
  const raw = await fetchJsonWithTimeout(
    deps,
    "https://api.mistral.ai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "Mistral",
  );
  const choice = asRecord(arrayFirst(raw.choices));
  const content = asRecord(choice.message).content;
  const output = typeof content === "string" ? content.trim() : "";
  const finishReason = stringOrNull(choice.finish_reason);
  return {
    output,
    usage: normalizeMistralUsage(asRecord(raw.usage)),
    finishReason,
    truncated: finishReason === "length" || finishReason === "model_length",
    failed:
      output.length === 0 ||
      (finishReason !== "stop" &&
        finishReason !== "length" &&
        finishReason !== "model_length"),
  };
}

async function fetchJsonWithTimeout(
  deps: ProviderCaseDependencies,
  url: string,
  init: RequestInit,
  provider: string,
): Promise<Record<string, unknown>> {
  const controller = (deps.createAbortController ?? (() => new AbortController()))();
  const setTimer =
    deps.setTimer ??
    ((callback: () => void, delayMs: number): unknown =>
      globalThis.setTimeout(callback, delayMs));
  const clearTimer =
    deps.clearTimer ??
    ((handle: unknown): void =>
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>));
  const timer = setTimer(() => controller.abort(), 240_000);

  try {
    const response = await (deps.fetch ?? globalThis.fetch)(url, {
      ...init,
      signal: controller.signal,
    });
    ensureOk(response, provider);
    return asRecord(await response.json());
  } finally {
    clearTimer(timer);
  }
}

function validateOutput(
  fixture: Fr6ExperimentCase,
  response: ProviderResponse,
): { parsed: unknown | null; schemaValid: boolean } {
  if (fixture.schema === null) return { parsed: null, schemaValid: true };
  try {
    const value = response.parsedInput ?? JSON.parse(response.output);
    const parsed = fixture.schema.safeParse(value);
    return parsed.success
      ? { parsed: parsed.data, schemaValid: true }
      : { parsed: null, schemaValid: false };
  } catch {
    return { parsed: null, schemaValid: false };
  }
}

function jsonSchema(fixture: Fr6ExperimentCase): Record<string, unknown> {
  if (fixture.schema === null) throw new Error("Structured schema unavailable");
  const schema = z.toJSONSchema(fixture.schema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function normalizeAnthropicUsage(raw: Record<string, unknown>): ExperimentUsage {
  const cached = numberOrZero(raw.cache_read_input_tokens);
  const write = numberOrZero(raw.cache_creation_input_tokens);
  const outputTotal = numberOrZero(raw.output_tokens);
  const reasoning = numberOrZero(asRecord(raw.output_tokens_details).thinking_tokens);
  const output = Math.max(0, outputTotal - reasoning);
  const input = numberOrZero(raw.input_tokens);
  return usage(input, cached, write, output, reasoning);
}

function normalizeOpenAiUsage(raw: Record<string, unknown>): ExperimentUsage {
  const inputDetails = asRecord(raw.input_tokens_details);
  const outputDetails = asRecord(raw.output_tokens_details);
  const cached = numberOrZero(inputDetails.cached_tokens);
  const write = numberOrZero(inputDetails.cache_write_tokens);
  const input = Math.max(0, numberOrZero(raw.input_tokens) - cached - write);
  const reasoning = numberOrZero(outputDetails.reasoning_tokens);
  const output = Math.max(0, numberOrZero(raw.output_tokens) - reasoning);
  return usage(input, cached, write, output, reasoning);
}

function normalizeGoogleUsage(raw: Record<string, unknown>): ExperimentUsage {
  const cached = numberOrZero(raw.cachedContentTokenCount);
  const input = Math.max(0, numberOrZero(raw.promptTokenCount) - cached);
  return usage(
    input,
    cached,
    0,
    numberOrZero(raw.candidatesTokenCount),
    numberOrZero(raw.thoughtsTokenCount),
  );
}

function normalizeMistralUsage(raw: Record<string, unknown>): ExperimentUsage {
  const cached = numberOrZero(asRecord(raw.prompt_tokens_details).cached_tokens);
  const input = Math.max(0, numberOrZero(raw.prompt_tokens) - cached);
  const reasoning = numberOrZero(asRecord(raw.completion_tokens_details).reasoning_tokens);
  const output = Math.max(0, numberOrZero(raw.completion_tokens) - reasoning);
  return usage(input, cached, 0, output, reasoning);
}

function usage(
  inputTokens: number,
  cachedInputTokens: number,
  cacheWriteTokens: number,
  outputTokens: number,
  reasoningTokens: number,
): ExperimentUsage {
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    totalTokens:
      inputTokens + cachedInputTokens + cacheWriteTokens + outputTokens + reasoningTokens,
  };
}

function extractOpenAiText(raw: Record<string, unknown>): string {
  if (typeof raw.output_text === "string") return raw.output_text.trim();
  return openAiContent(raw)
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function hasOpenAiRefusal(raw: Record<string, unknown>): boolean {
  return openAiContent(raw).some(
    (item) => item.type === "refusal" && typeof item.refusal === "string",
  );
}

function openAiContent(raw: Record<string, unknown>): Record<string, unknown>[] {
  const output = Array.isArray(raw.output) ? raw.output.map(asRecord) : [];
  return output.flatMap((item) =>
    Array.isArray(item.content) ? item.content.map(asRecord) : [],
  );
}

function ensureOk(response: Response, provider: string): void {
  if (!response.ok) {
    const error = new Error(`${provider} request failed (HTTP ${response.status}).`);
    error.name = "SanitizedHttpError";
    throw error;
  }
}

function sanitizedFailure(provider: Fr6Provider, error: unknown): string {
  if (error instanceof Error && error.name === "SanitizedHttpError") {
    return error.message;
  }
  const name = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    google: "Google",
    mistral: "Mistral",
  }[provider];
  return `${name} request failed.`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function arrayFirst(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
