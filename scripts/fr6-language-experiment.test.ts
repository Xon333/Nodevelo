import { describe, expect, expectTypeOf, it } from "vitest";

import {
  accountExperimentResult,
  atomicWriteJson,
  blindReviewRows,
  buildFr6ExperimentProvenance,
  buildRunPlan,
  createFr6ResultsArtifact,
  estimateExperimentCost,
  evaluateHardGates,
  executeFr6Experiment,
  projectTwoWeekCost,
  resolveFr6EvidenceDirectory,
  type AccountedExperimentResult,
  type CandidatePricing,
  type ExperimentResult,
} from "./fr6-language-experiment";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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

  it("uses hidden provider and model identity to disambiguate identical outputs", () => {
    const anthropic = result();
    const openai = result({ provider: "openai", model: "gpt-5.6-luna" });

    expect(blindReviewRows([anthropic], "fr6-v1")[0]?.blindId).not.toBe(
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

    expect(plan.actualCostUsd).toBe(1.99);
    expect(plan.accountedCostUsd).toBe(1.99);
    expect(plan.nextRequest).toBeNull();
    expect(plan.stoppedBefore).toMatchObject({
      model: "claude-sonnet-4-6",
      caseId: FR6_CASES[1]?.id,
    });
  });

  it("uses reserved accounting for an unknown-cost failure", () => {
    const failed = accountExperimentResult(
      result({
        status: "request-failed",
        costUsd: 0,
        usage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
        },
      }),
      1.99,
    );

    expect(failed).toMatchObject({
      costUsd: 0,
      accountedCostUsd: 1.99,
      costAccounting: "reserved-unknown",
    });
    expect(
      buildRunPlan(FR6_CANDIDATES, FR6_CASES, { ANTHROPIC_API_KEY: "set" }, [
        failed,
      ]).stoppedBefore,
    ).not.toBeNull();
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
      readonly (ExperimentResult | AccountedExperimentResult)[],
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

  it("fails closed on corrupt prior evidence before a request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fr6-corrupt-"));
    await writeFile(join(directory, "results.json"), "{broken", "utf8");
    let requests = 0;

    await expect(
      executeFr6Experiment({
        evidenceDirectory: directory,
        candidates: FR6_CANDIDATES,
        cases: FR6_CASES,
        env: { ANTHROPIC_API_KEY: "set" },
        runCase: async () => {
          requests += 1;
          return result();
        },
      }),
    ).rejects.toThrow("Invalid FR-6 results artifact");
    expect(requests).toBe(0);
  });

  it("fails closed on incompatible provenance before a request", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fr6-incompatible-"));
    const provenance = buildFr6ExperimentProvenance(
      FR6_CANDIDATES,
      FR6_CASES,
    );
    const incompatible = createFr6ResultsArtifact(
      {
        ...provenance,
        promptVersion: `${provenance.promptVersion}-changed`,
      },
      "b".repeat(64),
    );
    await atomicWriteJson(join(directory, "results.json"), incompatible);
    let requests = 0;

    await expect(
      executeFr6Experiment({
        evidenceDirectory: directory,
        candidates: FR6_CANDIDATES,
        cases: FR6_CASES,
        env: { ANTHROPIC_API_KEY: "set" },
        runCase: async () => {
          requests += 1;
          return result();
        },
      }),
    ).rejects.toThrow("provenance changed");
    expect(requests).toBe(0);
  });

  it("includes the full fixture contract and request policy in provenance", () => {
    const baseline = buildFr6ExperimentProvenance(
      [FR6_CANDIDATES[0]!],
      [FR6_CASES[0]!],
    );
    const changedGrounding = buildFr6ExperimentProvenance(
      [FR6_CANDIDATES[0]!],
      [
        {
          ...FR6_CASES[0]!,
          grounding: {
            ...FR6_CASES[0]!.grounding,
            forbiddenClaims: ["new forbidden claim"],
          },
        },
      ],
    );

    expect(changedGrounding.corpus.sha256).not.toBe(baseline.corpus.sha256);
    expect(baseline).toMatchObject({
      costPolicy: {
        experimentCapUsd: 2,
        wrapperInputTokenAllowance: 20_000,
      },
      models: [{ credential: "ANTHROPIC_API_KEY" }],
    });
  });

  it("persists a private high-entropy blind seed without credential values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fr6-seed-"));
    const candidate = FR6_CANDIDATES[0]!;
    const fixture = FR6_CASES[0]!;
    const credentialValue = "must-not-enter-evidence";
    const promptVersion = buildFr6ExperimentProvenance(
      [candidate],
      [fixture],
    ).promptVersion;

    await executeFr6Experiment({
      evidenceDirectory: directory,
      candidates: [candidate],
      cases: [fixture],
      env: { ANTHROPIC_API_KEY: credentialValue },
      runCase: async () =>
        result({
          provider: candidate.provider,
          model: candidate.model,
          caseId: fixture.id,
          category: fixture.category,
          promptVersion,
        }),
    });

    const raw = await readFile(join(directory, "results.json"), "utf8");
    const blind = await readFile(join(directory, "blind-review.json"), "utf8");
    const parsed = JSON.parse(raw) as { blindSeed: string };
    const blindRows = JSON.parse(blind) as Array<Record<string, unknown>>;
    expect(parsed.blindSeed).toMatch(/^[a-f0-9]{64}$/);
    expect(blind).not.toContain(parsed.blindSeed);
    expect(raw).not.toContain(credentialValue);
    expect(blind).not.toContain(credentialValue);
    expect(Object.keys(blindRows[0]!).sort()).toEqual([
      "blindId",
      "caseId",
      "category",
      "output",
    ]);
  });

  it("checkpoints an unknown-cost request with reserved rather than actual spend", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fr6-unknown-cost-"));
    const candidate = FR6_CANDIDATES[0]!;
    const fixture = FR6_CASES[0]!;
    const promptVersion = buildFr6ExperimentProvenance(
      [candidate],
      [fixture],
    ).promptVersion;
    const run = await executeFr6Experiment({
      evidenceDirectory: directory,
      candidates: [candidate],
      cases: [fixture],
      env: { ANTHROPIC_API_KEY: "set" },
      runCase: async () =>
        result({
          provider: candidate.provider,
          model: candidate.model,
          caseId: fixture.id,
          category: fixture.category,
          promptVersion,
          status: "request-failed",
          costUsd: 0,
          usage: {
            inputTokens: 0,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            totalTokens: 0,
          },
        }),
    });

    expect(run.artifact.results[0]).toMatchObject({
      costUsd: 0,
      costAccounting: "reserved-unknown",
      accountedCostUsd: expect.any(Number),
    });
    expect(run.artifact.results[0]!.accountedCostUsd).toBeGreaterThan(0);
  });

  it("checkpoints every result and resumes without repurchasing completed cases", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fr6-resume-"));
    const firstCase = FR6_CASES[0]!;
    const secondCase = FR6_CASES[1]!;
    const firstCandidate = FR6_CANDIDATES[0]!;
    const provenance = buildFr6ExperimentProvenance(
      [firstCandidate],
      [firstCase, secondCase],
    );
    const initial = createFr6ResultsArtifact(provenance, "a".repeat(64));
    const completed = accountExperimentResult(
      result({
        provider: firstCandidate.provider,
        model: firstCandidate.model,
        caseId: firstCase.id,
        category: firstCase.category,
        promptVersion: provenance.promptVersion,
      }),
      0.5,
    );
    await atomicWriteJson(join(directory, "results.json"), {
      ...initial,
      results: [completed],
    });
    const checkpoints: number[] = [];
    let requests = 0;

    await executeFr6Experiment({
      evidenceDirectory: directory,
      candidates: [firstCandidate],
      cases: [firstCase, secondCase],
      env: { ANTHROPIC_API_KEY: "set" },
      runCase: async (_candidate, fixture) => {
        requests += 1;
        return result({
          provider: firstCandidate.provider,
          model: firstCandidate.model,
          caseId: fixture.id,
          category: fixture.category,
          promptVersion: provenance.promptVersion,
        });
      },
      afterRawCheckpoint: (artifact) => {
        checkpoints.push(artifact.results.length);
      },
    });

    expect(requests).toBe(1);
    expect(checkpoints).toEqual([2]);
    const persisted = JSON.parse(
      await readFile(join(directory, "results.json"), "utf8"),
    ) as { results: AccountedExperimentResult[] };
    expect(persisted.results).toHaveLength(2);

    requests = 0;
    await executeFr6Experiment({
      evidenceDirectory: directory,
      candidates: [firstCandidate],
      cases: [firstCase, secondCase],
      env: { ANTHROPIC_API_KEY: "set" },
      runCase: async () => {
        requests += 1;
        return result();
      },
    });
    expect(requests).toBe(0);
  });

  it("replaces a prior missing-credential row when the credential becomes available", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fr6-late-credential-"));
    const candidate = FR6_CANDIDATES[0]!;
    const fixture = FR6_CASES[0]!;
    const promptVersion = buildFr6ExperimentProvenance(
      [candidate],
      [fixture],
    ).promptVersion;

    await executeFr6Experiment({
      evidenceDirectory: directory,
      candidates: [candidate],
      cases: [fixture],
      env: {},
      runCase: async () => {
        throw new Error("must not request without a credential");
      },
    });

    let requests = 0;
    const completed = await executeFr6Experiment({
      evidenceDirectory: directory,
      candidates: [candidate],
      cases: [fixture],
      env: { ANTHROPIC_API_KEY: "set" },
      runCase: async () => {
        requests += 1;
        return result({
          provider: candidate.provider,
          model: candidate.model,
          caseId: fixture.id,
          category: fixture.category,
          promptVersion,
        });
      },
    });

    expect(requests).toBe(1);
    expect(completed.artifact.results).toHaveLength(1);
    expect(completed.artifact.results[0]?.status).toBe("ok");
  });

  it("checkpoints an exact planned failure when an adapter returns mismatched provenance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fr6-result-provenance-"));
    const candidate = FR6_CANDIDATES[0]!;
    const fixture = FR6_CASES[0]!;

    const run = await executeFr6Experiment({
      evidenceDirectory: directory,
      candidates: [candidate],
      cases: [fixture],
      env: { ANTHROPIC_API_KEY: "set" },
      runCase: async () =>
        result({
          provider: "openai",
          model: "wrong-model",
          caseId: "wrong-case",
          promptVersion: "wrong-prompt",
        }),
    });

    expect(run.artifact.results).toHaveLength(1);
    expect(run.artifact.results[0]).toMatchObject({
      provider: candidate.provider,
      model: candidate.model,
      caseId: fixture.id,
      category: fixture.category,
      status: "request-failed",
      costUsd: 0,
      costAccounting: "reserved-unknown",
    });
  });
});
