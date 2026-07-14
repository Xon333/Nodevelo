import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: h.create };
  },
}));
// generateTrainingBlock fire-and-forgets usage telemetry to the real data/ai-usage.json — mock it
// out so this test doesn't write real usage rows for a fake "test-key" call.
vi.mock("@/lib/ai-usage", () => ({ recordUsage: vi.fn() }));

import { generateTrainingBlock, generationMaxTokens } from "@/lib/anthropic-api";

describe("generationMaxTokens", () => {
  it("keeps 4-week plans at 8,000 tokens and gives longer plans larger budgets", () => {
    expect(generationMaxTokens(4)).toBe(8000);
    expect(generationMaxTokens(6)).toBeGreaterThan(generationMaxTokens(4));
    expect(generationMaxTokens(8)).toBeGreaterThan(generationMaxTokens(6));
  });
});

describe("generateTrainingBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("returns the provider stop reason", async () => {
    h.create.mockResolvedValueOnce({
      content: [],
      stop_reason: "max_tokens",
      usage: {},
    });

    const result = await generateTrainingBlock("cached", "dynamic", "message", 6);

    expect(result.stopReason).toBe("max_tokens");
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: generationMaxTokens(6) }));
  });
});
