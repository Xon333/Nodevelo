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
  allowedMetricValues: Array<{ metric: string; value: number }>;
  allowedDeltas: Array<{
    metric: string;
    value: number;
  }>;
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
  const allowedDeltas = new Set(
    facts.allowedDeltas.map(
      ({ metric, value }) => `${normalizeMetricName(metric)}:${canonicalNumberToken(String(value))}`,
    ),
  );
  const allowedMetricValues = new Set(
    facts.allowedMetricValues.map(
      ({ metric, value }) => `${normalizeMetricName(metric)}:${canonicalNumberToken(String(value))}`,
    ),
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

  const seenNumeric = new Set<string>();
  const recordNumericClaim = (
    index: number,
    display: string,
    normalized: string,
  ): void => {
    const key = `${index}:${normalized}`;
    if (!seenNumeric.has(key) && !allowedNumbers.has(normalized)) {
      seenNumeric.add(key);
      unsupported.push({
        index,
        message: `unsupported numeric claim: ${display}`,
      });
    }
  };

  const metricPattern = groundingMetricPattern(facts);
  const signedNumber = "[+\\-−–]?\\d+(?:\\.\\d+)?";
  const comparisonPattern = new RegExp(
    `\\b(${metricPattern})\\s+(increased|decreased|changed|rose|fell|improved|declined|dropped|grew)\\s+` +
      `(?:from\\s+(${signedNumber})\\s+to\\s+(${signedNumber})|to\\s+(${signedNumber})|by\\s+(${signedNumber}))\\b`,
    "gi",
  );
  for (const match of output.matchAll(comparisonPattern)) {
    const [, rawMetric, verb, from, to, single, delta] = match;
    const metric = rawMetric.replace(/\s+(?:score|EWMA)$/i, "");
    const metricKey = normalizeMetricName(metric);
    if (delta !== undefined) {
      const direction = deltaDirection(verb, delta);
      const normalizedDelta = canonicalNumberToken(String(direction));
      const offset = match[0].lastIndexOf(delta);
      const key = `${metricKey}:${normalizedDelta}`;
      if (!allowedDeltas.has(key)) {
        unsupported.push({
          index: match.index + offset,
          message: `unsupported numeric delta: ${metric} ${direction >= 0 ? "+" : ""}${normalizedDelta}`,
        });
      }
      continue;
    }

    let searchFrom = 0;
    for (const value of [from, to, single].filter(
      (item): item is string => item !== undefined,
    )) {
      const offset = match[0].indexOf(value, searchFrom);
      searchFrom = offset + value.length;
      const normalizedValue = canonicalNumberToken(normalizeSign(value));
      if (!allowedMetricValues.has(`${metricKey}:${normalizedValue}`)) {
        unsupported.push({
          index: match.index + offset,
          message: `unsupported numeric claim: ${metric} ${normalizedValue}`,
        });
      }
    }
  }

  const numericPatterns = [
    /(?<![\w.+\-−–])[+\-−–]?\d+(?:\.\d+)?\s*(?:-\s*)?(?:watts?|W|min(?:ute)?s?|km|bpm|TSS|rpm|%|hours?|h)(?!\w)/gi,
    /\b(?:RPE\s*:?\s*)?[+\-−–]?\d+(?:\.\d+)?\s*\/\s*10\b/gi,
  ];
  for (const pattern of numericPatterns) {
    for (const match of output.matchAll(pattern)) {
      const normalized = normalizeNumericToken(match[0]);
      recordNumericClaim(
        match.index,
        compactNumericToken(match[0]),
        normalized,
      );
    }
  }

  const metricValuePattern = new RegExp(
    `\\b(${metricPattern})\\s*(?:(?:was|is|of|at)\\s*)?:?\\s*(${signedNumber})\\b(?!\\s*\\/)`,
    "gi",
  );
  for (const match of output.matchAll(metricValuePattern)) {
    const metric = match[1].replace(/\s+(?:score|EWMA)$/i, "");
    const value = canonicalNumberToken(normalizeSign(match[2]));
    const allowedAsMetric = allowedMetricValues.has(
      `${normalizeMetricName(metric)}:${value}`,
    );
    const allowedAsNumericToken = allowedNumbers.has(
      normalizeNumericToken(`${metric} ${value}`),
    );
    if (!allowedAsMetric && !allowedAsNumericToken) {
      unsupported.push({
        index: match.index,
        message: `unsupported numeric claim: ${compactNumericToken(match[0])}`,
      });
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

function deltaDirection(verb: string, rawValue: string): number {
  const normalized = normalizeSign(rawValue);
  const explicit = Number(normalized);
  if (/^[+-]/.test(normalized)) return explicit;
  if (/^(decreased|fell|declined|dropped)$/i.test(verb)) return -explicit;
  return explicit;
}

function normalizeNumericToken(token: string): string {
  const compact = normalizeSign(token)
    .toLowerCase()
    .replace(/minutes?/g, "min")
    .replace(/watts?/g, "w")
    .replace(/hours?/g, "h")
    .replace(/(?<=\d)-(?=[a-z%])/g, "")
    .replace(/\s|:/g, "");
  const prefix = compact.match(
    /^(rpe|tss|ctl|ftp|execution(?:score|ewma)?|baseline|compliance(?:score|rate)?)(?:was|is|of|at)?([+-]?\d+(?:\.\d+)?(?:\/10)?)$/,
  );
  if (prefix) {
    if (prefix[1] === "rpe") {
      return `${canonicalNumberToken(prefix[2].replace(/\/10$/, ""))}/10`;
    }
    const value = canonicalNumberToken(prefix[2]);
    const metric = prefix[1]
      .replace(/^(execution)(?:score|ewma)$/, "$1")
      .replace(/^(compliance)(?:score|rate)$/, "$1");
    return `${value}${metric}`;
  }

  const suffix = compact.match(
    /^([+-]?\d+(?:\.\d+)?)(w|min|km|bpm|tss|rpm|%|h)$/,
  );
  if (suffix) return `${canonicalNumberToken(suffix[1])}${suffix[2]}`;

  const score = compact.match(/^([+-]?\d+(?:\.\d+)?)\/10$/);
  if (score) return `${canonicalNumberToken(score[1])}/10`;

  return compact;
}

function compactNumericToken(token: string): string {
  return token.replace(/\s+(?=W\b)/, "").trim();
}

function canonicalNumberToken(value: string): string {
  const numeric = Number(normalizeSign(value));
  return Object.is(numeric, -0) ? "0" : String(numeric);
}

function normalizeSign(value: string): string {
  return value.replace(/[−–]/g, "-");
}

function normalizeMetricName(metric: string): string {
  return metric
    .toLowerCase()
    .replace(/\s+(?:score|ewma)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function groundingMetricPattern(facts: IndependentGroundingFacts): string {
  const metrics = new Set([
    "CTL",
    "FTP",
    "TSS",
    "execution",
    "execution score",
    "execution EWMA",
    "baseline",
    "compliance",
    "compliance score",
    "compliance rate",
    ...facts.allowedMetricValues.map(({ metric }) => metric),
    ...facts.allowedDeltas.map(({ metric }) => metric),
  ]);
  return [...metrics]
    .sort((left, right) => right.length - left.length)
    .map((metric) => escapeRegExp(metric).replace(/\\ /g, "\\s+"))
    .join("|");
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
