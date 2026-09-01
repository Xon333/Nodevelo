// Token/cost telemetry for every Anthropic call. Active ride-analysis / retrospective calls fold
// their `usage` into data/ai-usage.json (best-effort — never blocks or fails the
// real request). Cost is estimated from a per-model price table so the single user can see running
// spend in Settings. Pairs with the P6 model/promptVersion stamping (provenance + cost together).
//
// Caching economics (see the prompt-caching reference): the API's `input_tokens` is already the
// *uncached* remainder; cache **writes** (`cache_creation_input_tokens`) bill at ~1.25× input
// (5-min ephemeral) and cache **reads**
// (`cache_read_input_tokens`) at ~0.1× input. Output bills at the model's output rate.

import { readJsonFile, writeJsonFile } from "./json-store";

// USD per 1M tokens (input, output). Source: claude-api pricing reference (cached 2026-06-04).
const PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  "claude-sonnet-4-6": { inPerM: 3, outPerM: 15 },
  "claude-haiku-4-5": { inPerM: 1, outPerM: 5 },
};
const CACHE_WRITE_MULT = 1.25; // 5-min ephemeral cache-write premium
const CACHE_READ_MULT = 0.1; // cache-read discount

export interface AiUsageTotals {
  calls: number;
  inputTokens: number; // uncached input
  outputTokens: number;
  cacheWriteTokens: number; // cache_creation_input_tokens
  cacheReadTokens: number; // cache_read_input_tokens
  costUsd: number;
}

export interface AiUsageStore {
  total: AiUsageTotals;
  byModel: Record<string, AiUsageTotals>;
  updatedAt: string;
}

// The subset of an Anthropic response's `usage` we care about (structurally compatible with the
// SDK's usage object, so call sites can pass `response.usage` directly).
export interface RawUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

const USAGE_FILE = "ai-usage.json"; // regenerable telemetry — not a CRITICAL ledger, no .bak

function emptyTotals(): AiUsageTotals {
  return { calls: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 };
}

// Pure, deterministic: dollar cost of one call. Unknown model → 0 (counted but unpriced rather than
// guessing a rate). Exported for unit tests.
export function estimateCostUsd(model: string, u: RawUsage): number {
  const p = PRICING[model];
  if (!p) return 0;
  const inRate = p.inPerM / 1_000_000;
  const outRate = p.outPerM / 1_000_000;
  return (
    (u.input_tokens ?? 0) * inRate +
    (u.cache_creation_input_tokens ?? 0) * inRate * CACHE_WRITE_MULT +
    (u.cache_read_input_tokens ?? 0) * inRate * CACHE_READ_MULT +
    (u.output_tokens ?? 0) * outRate
  );
}

function addInto(t: AiUsageTotals, model: string, u: RawUsage): void {
  t.calls += 1;
  t.inputTokens += u.input_tokens ?? 0;
  t.outputTokens += u.output_tokens ?? 0;
  t.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
  t.cacheReadTokens += u.cache_read_input_tokens ?? 0;
  t.costUsd = Math.round((t.costUsd + estimateCostUsd(model, u)) * 1e6) / 1e6;
}

export async function readAiUsage(): Promise<AiUsageStore> {
  return readJsonFile<AiUsageStore>(USAGE_FILE, {
    total: emptyTotals(),
    byModel: {},
    updatedAt: new Date(0).toISOString(),
  });
}

// Serialize the read-modify-write so concurrent calls don't lose increments. The json-store mutex
// only serializes the write itself; this chain serializes the whole accumulate. (Single-process,
// which is the local-first deployment.)
let chain: Promise<void> = Promise.resolve();

// Fold one call's usage into the running store. Best-effort: call sites fire-and-forget so this
// never blocks or fails the request that produced the usage.
export function recordUsage(model: string, usage: RawUsage | null | undefined): Promise<void> {
  if (!usage) return Promise.resolve();
  chain = chain
    .catch(() => {})
    .then(async () => {
      const store = await readAiUsage();
      addInto(store.total, model, usage);
      store.byModel[model] ??= emptyTotals();
      addInto(store.byModel[model], model, usage);
      store.updatedAt = new Date().toISOString();
      await writeJsonFile(USAGE_FILE, store);
    });
  return chain;
}
