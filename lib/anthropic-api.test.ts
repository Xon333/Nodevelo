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

import { generateTrainingBlock, generationMaxTokens, parseRideIntent } from "@/lib/anthropic-api";

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

describe("parseRideIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  // The tool schema's phase is RICHER than `StructuredIntent.phases[]`. Spreading it would carry
  // `zone`, `zoneBasis`, `targetPctFtp` and `reps` into `IntentOverlay.interpretation` — a permanent
  // stored record — and TypeScript cannot catch it, because spreads are exempt from excess-property
  // checking. Pin the exact key set so the mapping stays field-by-field.
  it("maps phases to exactly the fields StructuredIntent declares, dropping the rest", async () => {
    h.create.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          input: {
            primaryPurpose: "endurance then efforts",
            phases: [
              {
                description: "45 minutes steady Z2",
                kind: "zone-time",
                durationMin: 45,
                zone: "Z2",
                zoneBasis: "power",
                targetPctFtp: 65,
                reps: 3,
              },
              { description: "hard effort", kind: "effort", targetWatts: 300 },
            ],
            objectives: [],
            confidence: "high",
          },
        },
      ],
      stop_reason: "tool_use",
      usage: {},
    });

    const result = await parseRideIntent("45m z2 then efforts", 60);
    const phases = result?.intent.phases ?? [];

    expect(Object.keys(phases[0]).sort()).toEqual(["description", "durationMin", "kind", "targetZone"]);
    expect(phases[0]).toEqual({
      description: "45 minutes steady Z2",
      kind: "zone-time",
      durationMin: 45,
      targetZone: "Z2",
    });
    // The zone must arrive under ONE name, not duplicated as both `zone` and `targetZone`.
    expect(phases[0]).not.toHaveProperty("zone");
    expect(Object.keys(phases[1]).sort()).toEqual(["description", "kind", "targetWatts"]);
  });
});
