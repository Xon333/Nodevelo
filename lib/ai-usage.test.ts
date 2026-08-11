import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { estimateCostUsd, readAiUsage, recordUsage } from "./ai-usage";
import { GENERATION_MODEL, QUICK_MODEL } from "./anthropic-api";

describe("estimateCostUsd", () => {
  it("prices sonnet input + output at the published rates ($3 / $15 per 1M)", () => {
    // 1M input + 1M output = $3 + $15 = $18.
    expect(estimateCostUsd("claude-sonnet-4-6", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(18, 6);
  });

  it("prices haiku at $1 / $5 per 1M", () => {
    expect(estimateCostUsd("claude-haiku-4-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(6, 6);
  });

  it("applies the cache-write premium (1.25×) and cache-read discount (0.1×) to the input rate", () => {
    // sonnet input rate $3/1M. 1M cache-write = $3.75; 1M cache-read = $0.30.
    expect(estimateCostUsd("claude-sonnet-4-6", { cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(3.75, 6);
    expect(estimateCostUsd("claude-sonnet-4-6", { cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.3, 6);
  });

  it("returns 0 for an unknown model (counted but unpriced)", () => {
    expect(estimateCostUsd("some-future-model", { input_tokens: 1_000_000 })).toBe(0);
  });

  it("tolerates missing/null usage fields", () => {
    expect(estimateCostUsd("claude-haiku-4-5", { input_tokens: null })).toBe(0);
  });

  it("prices every model id any call site actually uses (INVARIANT 18)", () => {
    for (const model of [GENERATION_MODEL, QUICK_MODEL]) {
      expect(estimateCostUsd(model, { input_tokens: 1_000_000, output_tokens: 0 })).toBeGreaterThan(0);
    }
  });
});

describe("recordUsage accumulation", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "nodevelo-usage-"));
    process.env.NODEVELO_DATA_DIR = dir;
  });
  afterAll(async () => {
    delete process.env.NODEVELO_DATA_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("accumulates totals + per-model without losing concurrent increments", async () => {
    await Promise.all([
      recordUsage("claude-sonnet-4-6", { input_tokens: 100, output_tokens: 50 }),
      recordUsage("claude-sonnet-4-6", { input_tokens: 200, output_tokens: 60 }),
      recordUsage("claude-haiku-4-5", { input_tokens: 10, output_tokens: 5 }),
    ]);
    const store = await readAiUsage();
    expect(store.total.calls).toBe(3);
    expect(store.total.inputTokens).toBe(310);
    expect(store.total.outputTokens).toBe(115);
    expect(store.byModel["claude-sonnet-4-6"].calls).toBe(2);
    expect(store.byModel["claude-haiku-4-5"].calls).toBe(1);
    expect(store.total.costUsd).toBeGreaterThan(0);
  });
});
