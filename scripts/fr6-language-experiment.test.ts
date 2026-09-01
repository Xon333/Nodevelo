import { describe, expect, it } from "vitest";

import {
  blindReviewRows,
  estimateExperimentCost,
  evaluateHardGates,
  projectTwoWeekCost,
  type CandidatePricing,
  type ExperimentResult,
} from "./fr6-language-experiment";

const pricing: CandidatePricing = {
  inputPerMillion: 1,
  cachedInputPerMillion: 0.1,
  cacheWritePerMillion: 1.25,
  outputPerMillion: 5,
};

function result(overrides: Partial<ExperimentResult> = {}): ExperimentResult {
  return {
    caseId: "ride-prescribed-good",
    category: "ride-analysis",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    status: "ok",
    output: "Useful feedback.",
    parsed: null,
    usage: {
      inputTokens: 100,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 20,
      reasoningTokens: 0,
      totalTokens: 120,
    },
    costUsd: 0.01,
    latencyMs: 100,
    finishReason: "end_turn",
    retries: 0,
    schemaValid: true,
    unsupportedClaims: [],
    ...overrides,
  };
}

function completeResults(costs: {
  ride: number;
  prose: number;
  structured: number;
}): ExperimentResult[] {
  return [
    result({ costUsd: costs.ride }),
    result({
      caseId: "retro-normal",
      category: "prose-retrospective",
      costUsd: costs.prose,
    }),
    result({
      caseId: "structured-mixed-verdicts",
      category: "structured-retrospective",
      costUsd: costs.structured,
    }),
  ];
}

describe("provider-neutral cost arithmetic", () => {
  it("normalizes every billed token class into one request cost", () => {
    expect(
      estimateExperimentCost(pricing, {
        inputTokens: 1_000,
        cachedInputTokens: 2_000,
        cacheWriteTokens: 3_000,
        outputTokens: 4_000,
        reasoningTokens: 500,
        totalTokens: 10_500,
      }),
    ).toBeCloseTo(0.02745, 8);
  });

  it("projects eleven ride notes and both closeout calls", () => {
    expect(
      projectTwoWeekCost(
        completeResults({ ride: 0.01, prose: 0.02, structured: 0.03 }),
        11,
      ),
    ).toBeCloseTo(0.16, 8);
  });

  it("returns an explicit non-finite projection when a category has no success", () => {
    const incomplete = completeResults({ ride: 0.01, prose: 0.02, structured: 0.03 }).map(
      (row) =>
        row.category === "structured-retrospective"
          ? { ...row, status: "request-failed" as const }
          : row,
    );

    expect(projectTwoWeekCost(incomplete, 11)).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(projectTwoWeekCost(incomplete, 11))).toBe(false);
  });
});

describe("hard gates", () => {
  it("accepts the inclusive $0.25 two-week ceiling", () => {
    const evaluation = evaluateHardGates(
      completeResults({ ride: 0.02, prose: 0.015, structured: 0.015 }),
    );

    expect(evaluation).toEqual({
      passed: true,
      projectedCostUsd: 0.25,
      failures: [],
    });
  });

  it("rejects a projection even fractionally above the ceiling", () => {
    const evaluation = evaluateHardGates(
      completeResults({ ride: 0.02, prose: 0.015001, structured: 0.015 }),
    );

    expect(evaluation.passed).toBe(false);
    expect(evaluation.projectedCostUsd).toBeCloseTo(0.250001, 8);
    expect(evaluation.failures).toContain("projected-cost-exceeds-budget");
  });

  it.each(["missing-credential", "request-failed", "schema-invalid"] as const)(
    "rejects an explicit %s result",
    (status) => {
      const rows = completeResults({ ride: 0.01, prose: 0.01, structured: 0.01 });
      rows[0] = result({ status });

      expect(evaluateHardGates(rows).failures).toContain("result-not-ok");
    },
  );

  it("rejects invalid structured output and unsupported claims", () => {
    const rows = completeResults({ ride: 0.01, prose: 0.01, structured: 0.01 });
    rows[0] = result({ unsupportedClaims: ["FTP increased"] });
    rows[2] = { ...rows[2], schemaValid: false };

    expect(evaluateHardGates(rows).failures).toEqual([
      "structured-schema-invalid",
      "unsupported-claims",
    ]);
  });
});

describe("blind review rows", () => {
  it("produces stable opaque IDs without provider or model fields", () => {
    const rows = completeResults({ ride: 0.01, prose: 0.01, structured: 0.01 });
    const first = blindReviewRows(rows, "fr6-v1");
    const second = blindReviewRows(rows, "fr6-v1");

    expect(first).toEqual(second);
    expect(first.map((row) => row.blindId)).toEqual([
      expect.stringMatching(/^FR6-[A-F0-9]{12}$/),
      expect.stringMatching(/^FR6-[A-F0-9]{12}$/),
      expect.stringMatching(/^FR6-[A-F0-9]{12}$/),
    ]);
    for (const row of first) {
      expect(row).not.toHaveProperty("provider");
      expect(row).not.toHaveProperty("model");
      expect(JSON.stringify(row)).not.toContain("anthropic");
      expect(JSON.stringify(row)).not.toContain("claude-haiku-4-5");
    }
  });

  it("changes opaque IDs when the blinding seed changes", () => {
    const rows = completeResults({ ride: 0.01, prose: 0.01, structured: 0.01 });

    expect(blindReviewRows(rows, "fr6-v1")[0]?.blindId).not.toBe(
      blindReviewRows(rows, "fr6-v2")[0]?.blindId,
    );
  });

  it("assigns unique IDs to repeated finalist runs", () => {
    const repeated = result();
    const blindIds = blindReviewRows([repeated, repeated], "fr6-v1").map(
      (row) => row.blindId,
    );

    expect(new Set(blindIds).size).toBe(2);
  });
});
