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
    const phases = result.interpretation?.intent.phases ?? [];

    expect(result.failure).toBeNull();
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

  // NV-10 (2026-08-15): a completed-but-unusable response used to collapse to a bare `null`, giving
  // the persisted overlay no way to distinguish truncation from a declined tool call from a schema
  // mismatch. These three pin the categorisation this fix depends on.
  it("categorises a response with no tool_use block cut off by max_tokens as max-tokens", async () => {
    h.create.mockResolvedValueOnce({ content: [], stop_reason: "max_tokens", usage: {} });
    const result = await parseRideIntent("a note", 60);
    expect(result.interpretation).toBeNull();
    expect(result.failure).toEqual({ category: "max-tokens", stopReason: "max_tokens", issues: [] });
  });

  it("categorises a response with no tool_use block and a non-max_tokens stop_reason as missing-tool-use", async () => {
    h.create.mockResolvedValueOnce({ content: [{ type: "text", text: "I decline." }], stop_reason: "end_turn", usage: {} });
    const result = await parseRideIntent("a note", 60);
    expect(result.interpretation).toBeNull();
    expect(result.failure).toEqual({ category: "missing-tool-use", stopReason: "end_turn", issues: [] });
  });

  it("categorises a tool_use block that fails schema validation as schema-invalid, with sanitized Zod issues", async () => {
    h.create.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { primaryPurpose: "x", phases: [], objectives: [], confidence: "extreme" } }],
      stop_reason: "tool_use",
      usage: {},
    });
    const result = await parseRideIntent("a note", 60);
    expect(result.interpretation).toBeNull();
    expect(result.failure?.category).toBe("schema-invalid");
    expect(result.failure?.stopReason).toBe("tool_use");
    expect(result.failure?.issues).toEqual([{ path: "confidence", message: expect.stringContaining("high") }]);
  });

  // Live-confirmed 2026-08-15: Anthropic's tool-input JSON is assembled in schema-field order, so a
  // max_tokens cutoff can still leave a syntactically valid (but incomplete) tool_use block behind —
  // primaryPurpose/phases complete, objectives/confidence never started. That must be judged by
  // stop_reason, not by "did a tool_use block exist" — otherwise a genuine truncation is mis-bucketed
  // as schema-invalid, which is exactly the bug this fixture reproduces from the real failure.
  it("categorises a PARTIAL tool_use block cut off mid-call as max-tokens, not schema-invalid", async () => {
    h.create.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { primaryPurpose: "endurance ride", phases: [{ description: "steady", kind: "duration" }] } }],
      stop_reason: "max_tokens",
      usage: {},
    });
    const result = await parseRideIntent("a long multi-section note", 95);
    expect(result.interpretation).toBeNull();
    expect(result.failure?.category).toBe("max-tokens");
    expect(result.failure?.stopReason).toBe("max_tokens");
    // The missing trailing fields still show up as free diagnostic detail, they just don't steer the category.
    expect(result.failure?.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["objectives", "confidence"]));
  });

  it("sends the raised token budget for intent parsing (900 was too tight for a multi-section note)", async () => {
    h.create.mockResolvedValueOnce({ content: [], stop_reason: "max_tokens", usage: {} });
    await parseRideIntent("a note", 60);
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 1800 }));
  });
});
