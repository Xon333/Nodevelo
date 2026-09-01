import { createHash } from "node:crypto";

export type LanguageCallCategory =
  | "ride-analysis"
  | "prose-retrospective"
  | "structured-retrospective";

export interface ExperimentUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface CandidatePricing {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  cacheWritePerMillion: number;
  outputPerMillion: number;
}

export interface ExperimentResult {
  caseId: string;
  category: LanguageCallCategory;
  provider: "anthropic" | "openai" | "google" | "mistral";
  model: string;
  promptVersion: string;
  status:
    | "ok"
    | "missing-credential"
    | "request-failed"
    | "schema-invalid"
    | "truncated";
  output: string;
  parsed: unknown | null;
  usage: ExperimentUsage;
  costUsd: number;
  latencyMs: number;
  finishReason: string | null;
  retries: number;
  schemaValid: boolean;
  unsupportedClaims: string[];
}

export interface HardGateEvaluation {
  passed: boolean;
  projectedCostUsd: number;
  failures: HardGateFailure[];
}

export type HardGateFailure =
  | "result-not-ok"
  | "projected-cost-unavailable"
  | "projected-cost-exceeds-budget"
  | "structured-schema-invalid"
  | "unsupported-claims";

export interface BlindReviewRow {
  blindId: string;
  caseId: string;
  category: LanguageCallCategory;
  output: string;
}

const TWO_WEEK_RIDE_DAYS = 11;
const TWO_WEEK_COST_BUDGET_USD = 0.25;

export function estimateExperimentCost(
  pricing: CandidatePricing,
  usage: ExperimentUsage,
): number {
  return (
    usage.inputTokens * pricing.inputPerMillion +
    usage.cachedInputTokens * pricing.cachedInputPerMillion +
    usage.cacheWriteTokens * pricing.cacheWritePerMillion +
    (usage.outputTokens + usage.reasoningTokens) * pricing.outputPerMillion
  ) / 1_000_000;
}

export function projectTwoWeekCost(
  results: ExperimentResult[],
  rideDays: number,
): number {
  const mean = (category: LanguageCallCategory): number => {
    const successful = results.filter(
      (result) => result.category === category && result.status === "ok",
    );
    if (successful.length === 0) return Number.POSITIVE_INFINITY;

    return (
      successful.reduce((sum, result) => sum + result.costUsd, 0) /
      successful.length
    );
  };

  return (
    rideDays * mean("ride-analysis") +
    mean("prose-retrospective") +
    mean("structured-retrospective")
  );
}

export function evaluateHardGates(
  results: ExperimentResult[],
): HardGateEvaluation {
  const projectedCostUsd = projectTwoWeekCost(results, TWO_WEEK_RIDE_DAYS);
  const failures: HardGateFailure[] = [];

  if (results.some((result) => result.status !== "ok")) {
    failures.push("result-not-ok");
  }
  if (!Number.isFinite(projectedCostUsd)) {
    failures.push("projected-cost-unavailable");
  } else if (projectedCostUsd > TWO_WEEK_COST_BUDGET_USD) {
    failures.push("projected-cost-exceeds-budget");
  }
  if (
    results.some(
      (result) =>
        result.category === "structured-retrospective" && !result.schemaValid,
    )
  ) {
    failures.push("structured-schema-invalid");
  }
  if (results.some((result) => result.unsupportedClaims.length > 0)) {
    failures.push("unsupported-claims");
  }

  return {
    passed: failures.length === 0,
    projectedCostUsd,
    failures,
  };
}

export function blindReviewRows(
  results: ExperimentResult[],
  seed: string,
): BlindReviewRow[] {
  return results.map((result) => ({
    blindId: opaqueId(result, seed),
    caseId: result.caseId,
    category: result.category,
    output: result.output,
  }));
}

function opaqueId(result: ExperimentResult, seed: string): string {
  const digest = createHash("sha256")
    .update(seed)
    .update("\0")
    .update(result.caseId)
    .update("\0")
    .update(result.category)
    .update("\0")
    .update(result.promptVersion)
    .update("\0")
    .update(result.output)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();

  return `FR6-${digest}`;
}
