import { describe, expect, expectTypeOf, it } from "vitest";

import {
  atomicWriteJson,
  blindReviewRows,
  buildRunPlan,
  estimateExperimentCost,
  evaluateHardGates,
  projectTwoWeekCost,
  resolveFr6EvidenceDirectory,
  type CandidatePricing,
  type ExperimentResult,
} from "./fr6-language-experiment";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FR6_CASES } from "./fr6-language-fixtures";
import { FR6_CANDIDATES } from "./fr6-language-providers";

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
    promptVersion: "2026-08-31.v1",
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
  it("requires prompt provenance on every experiment result", () => {
    expectTypeOf<ExperimentResult>()
      .toHaveProperty("promptVersion")
      .toBeString();
  });

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

  it("exposes no parameter that can relax the fixed $0.25 ceiling", () => {
    expectTypeOf(evaluateHardGates).parameters.toEqualTypeOf<
      [ExperimentResult[]]
    >();
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

  it("does not encode provider or model identity in an opaque ID", () => {
    const anthropic = result();
    const openai = result({ provider: "openai", model: "gpt-5.6-luna" });

    expect(blindReviewRows([anthropic], "fr6-v1")[0]?.blindId).toBe(
      blindReviewRows([openai], "fr6-v1")[0]?.blindId,
    );
  });

  it("keeps each artifact's opaque ID stable when rows are reordered", () => {
    const ride = result();
    const prose = result({
      caseId: "retro-normal",
      category: "prose-retrospective",
      output: "A grounded retrospective.",
    });
    const forward = blindReviewRows([ride, prose], "fr6-v1");
    const reversed = blindReviewRows([prose, ride], "fr6-v1");

    expect(forward.find((row) => row.caseId === ride.caseId)?.blindId).toBe(
      reversed.find((row) => row.caseId === ride.caseId)?.blindId,
    );
    expect(forward.find((row) => row.caseId === prose.caseId)?.blindId).toBe(
      reversed.find((row) => row.caseId === prose.caseId)?.blindId,
    );
  });
});

describe("live run planning", () => {
  it("uses the fixed candidate order and exposes the first payable request only", () => {
    const plan = buildRunPlan(FR6_CANDIDATES, FR6_CASES, {
      ANTHROPIC_API_KEY: "present",
      OPENAI_API_KEY: "present",
      GEMINI_API_KEY: "present",
      MISTRAL_API_KEY: "present",
    }, []);

    expect(plan.candidateOrder).toEqual([
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
      "gpt-5.6-luna",
      "gemini-3.1-flash-lite",
      "mistral-small-2603",
    ]);
    expect(plan.nextRequest).toMatchObject({
      model: "claude-sonnet-4-6",
      caseId: FR6_CASES[0]?.id,
    });
  });

  it("turns absent credentials into explicit rows without a payable request", () => {
    const plan = buildRunPlan(FR6_CANDIDATES, FR6_CASES, {}, []);

    expect(plan.nextRequest).toBeNull();
    expect(plan.missingCredentialResults).toHaveLength(
      FR6_CANDIDATES.length * FR6_CASES.length,
    );
    expect(plan.missingCredentialResults[0]).toMatchObject({
      status: "missing-credential",
      model: "claude-sonnet-4-6",
      caseId: FR6_CASES[0]?.id,
      costUsd: 0,
    });
  });

  it("uses measured cumulative spend before reserving the next request", () => {
    const completed = [
      result({
        model: "claude-sonnet-4-6",
        caseId: FR6_CASES[0]?.id,
        costUsd: 1.99,
      }),
    ];
    const plan = buildRunPlan(FR6_CANDIDATES, FR6_CASES, {
      ANTHROPIC_API_KEY: "present",
    }, completed);

    expect(plan.measuredCostUsd).toBe(1.99);
    expect(plan.nextRequest).toBeNull();
    expect(plan.stoppedBefore).toMatchObject({
      model: "claude-sonnet-4-6",
      caseId: FR6_CASES[1]?.id,
    });
  });

  it("reports measured overspend even when there is no next request to reserve", () => {
    const allCompleted = FR6_CANDIDATES.flatMap((candidate) =>
      FR6_CASES.map((fixture, index) =>
        result({
          provider: candidate.provider,
          model: candidate.model,
          caseId: fixture.id,
          category: fixture.category,
          costUsd: index === 0 && candidate === FR6_CANDIDATES[0] ? 2.01 : 0,
        }),
      ),
    );

    const plan = buildRunPlan(FR6_CANDIDATES, FR6_CASES, {}, allCompleted);

    expect(plan.capExceeded).toBe(true);
    expect(plan.nextRequest).toBeNull();
  });

  it("rejects invalid measured costs instead of letting them relax the cap", () => {
    expect(() =>
      buildRunPlan(FR6_CANDIDATES, FR6_CASES, {}, [
        result({ costUsd: -10 }),
      ]),
    ).toThrow("finite and non-negative");
  });

  it("does not expose a caller-controlled experiment cap", () => {
    expectTypeOf(buildRunPlan).parameters.toEqualTypeOf<[
      typeof FR6_CANDIDATES,
      typeof FR6_CASES,
      Record<string, string | undefined>,
      ExperimentResult[],
    ]>();
  });
});

describe("live evidence persistence", () => {
  it("resolves relative git common directories against the worktree", () => {
    expect(resolveFr6EvidenceDirectory("/repo/.worktrees/task", "../.git\n")).toBe(
      "/repo/.worktrees/.git/sdd/fr6-language-provider-experiment",
    );
    expect(resolveFr6EvidenceDirectory("/repo", "/repo/.git\n")).toBe(
      "/repo/.git/sdd/fr6-language-provider-experiment",
    );
  });

  it("atomically writes parseable JSON to the requested target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fr6-evidence-"));
    const target = join(directory, "nested", "results.json");

    await atomicWriteJson(target, { status: "ok", rows: [1, 2] });

    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
      status: "ok",
      rows: [1, 2],
    });
  });
});
