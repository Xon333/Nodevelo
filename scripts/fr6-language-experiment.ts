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

export interface IndependentGroundingFacts {
  allowedDates: string[];
  allowedNumericTokens: string[];
  forbiddenClaims: string[];
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

/**
 * A deliberately conservative first-pass check for claims that can be compared
 * mechanically with independently authored fixture facts. Semantic grounding
 * remains part of the blind human review.
 */
export function findUnsupportedClaims(
  output: string,
  facts: IndependentGroundingFacts,
): string[] {
  const unsupported: Array<{ index: number; message: string }> = [];
  const allowedDates = new Set(facts.allowedDates);
  const allowedNumbers = new Set(
    facts.allowedNumericTokens.map(normalizeNumericToken),
  );

  for (const match of output.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
    const value = match[0];
    if (!allowedDates.has(value)) {
      unsupported.push({
        index: match.index,
        message: `unsupported date: ${value}`,
      });
    }
  }

  const numericPatterns = [
    /\b\d+(?:\.\d+)?\s*(?:watts?|W|min(?:ute)?s?|km|bpm|TSS|rpm|%|hours?|h)\b/gi,
    /\b(?:TSS|CTL|FTP|execution(?:\s+EWMA)?)\s*:?\s*\d+(?:\.\d+)?\b/gi,
    /\b(?:RPE\s*:?\s*)?\d+(?:\.\d+)?\s*\/\s*10\b/gi,
  ];
  const seenNumeric = new Set<string>();
  for (const pattern of numericPatterns) {
    for (const match of output.matchAll(pattern)) {
      const normalized = normalizeNumericToken(match[0]);
      const key = `${match.index}:${normalized}`;
      if (!seenNumeric.has(key) && !allowedNumbers.has(normalized)) {
        seenNumeric.add(key);
        unsupported.push({
          index: match.index,
          message: `unsupported numeric claim: ${compactNumericToken(match[0])}`,
        });
      }
    }
  }

  for (const phrase of facts.forbiddenClaims) {
    const pattern = new RegExp(
      `\\b${escapeRegExp(phrase).replace(/\\ /g, "\\s+")}\\b`,
      "i",
    );
    const match = pattern.exec(output);
    if (match) {
      unsupported.push({
        index: match.index,
        message: `forbidden claim: ${phrase}`,
      });
    }
  }

  return unsupported
    .sort((left, right) => left.index - right.index)
    .map(({ message }) => message);
}

function normalizeNumericToken(token: string): string {
  const compact = token
    .toLowerCase()
    .replace(/minutes?/g, "min")
    .replace(/watts?/g, "w")
    .replace(/hours?/g, "h")
    .replace(/\s|:/g, "");
  const prefix = compact.match(
    /^(rpe|tss|ctl|ftp|execution(?:ewma)?)(\d+(?:\.\d+)?(?:\/10)?)$/,
  );
  if (!prefix) return compact;
  if (prefix[1] === "rpe") return prefix[2];
  return `${prefix[2]}${prefix[1]}`;
}

function compactNumericToken(token: string): string {
  return token
    .replace(/\s+(?=(?:W|watts?)\b)/i, "")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
