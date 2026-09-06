import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { PROMPT_VERSION } from "../lib/anthropic-api";
import { FR6_CASES, type Fr6ExperimentCase } from "./fr6-language-fixtures";
import type { Fr6Candidate } from "./fr6-language-providers";

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
    | "in-flight"
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
  | "corpus-incomplete"
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
const EXPERIMENT_COST_CAP_USD = 2;
const WRAPPER_INPUT_TOKEN_ALLOWANCE = 20_000;

export interface PlannedProviderRequest {
  provider: ExperimentResult["provider"];
  model: string;
  caseId: string;
  maximumCostUsd: number;
}

export interface Fr6RunPlan {
  candidateOrder: string[];
  actualCostUsd: number;
  accountedCostUsd: number;
  capExceeded: boolean;
  missingCredentialResults: ExperimentResult[];
  nextRequest: PlannedProviderRequest | null;
  stoppedBefore: PlannedProviderRequest | null;
}

export interface AccountedExperimentResult extends ExperimentResult {
  accountedCostUsd: number;
  costAccounting:
    | "actual"
    | "reserved-unknown"
    | "reserved-in-flight"
    | "no-request";
}

export interface Fr6ExperimentProvenance {
  protocolVersion: "fr6-fixed-input-v1";
  promptVersion: string;
  costPolicy: {
    experimentCapUsd: 2;
    wrapperInputTokenAllowance: 20_000;
  };
  corpus: {
    sha256: string;
    cases: Array<{ id: string; category: LanguageCallCategory }>;
  };
  models: Array<{
    provider: ExperimentResult["provider"];
    model: string;
    credential: Fr6Candidate["credential"];
    pricing: CandidatePricing;
  }>;
}

export interface Fr6ResultsArtifact {
  provenance: Fr6ExperimentProvenance;
  blindSeed: string;
  createdAt: string;
  updatedAt: string;
  results: AccountedExperimentResult[];
}

export interface ExecuteFr6ExperimentOptions {
  evidenceDirectory: string;
  candidates: readonly Fr6Candidate[];
  cases: Fr6ExperimentCase[];
  env: Record<string, string | undefined>;
  runCase: (
    candidate: Fr6Candidate,
    fixture: Fr6ExperimentCase,
  ) => Promise<ExperimentResult>;
  afterRawCheckpoint?: (artifact: Fr6ResultsArtifact) => void;
  now?: () => Date;
}

export function buildRunPlan(
  candidates: readonly Fr6Candidate[],
  cases: Fr6ExperimentCase[],
  env: Record<string, string | undefined>,
  completedResults: readonly (ExperimentResult | AccountedExperimentResult)[],
): Fr6RunPlan {
  if (
    completedResults.some(
      ({ costUsd }) => !Number.isFinite(costUsd) || costUsd < 0,
    )
  ) {
    throw new Error("FR-6 measured costs must be finite and non-negative");
  }
  const actualCostUsd = completedResults.reduce(
    (sum, result) => sum + result.costUsd,
    0,
  );
  const accountedCostUsd = completedResults.reduce(
    (sum, result) =>
      sum +
      ("accountedCostUsd" in result ? result.accountedCostUsd : result.costUsd),
    0,
  );
  if (!Number.isFinite(accountedCostUsd) || accountedCostUsd < 0) {
    throw new Error("FR-6 accounted costs must be finite and non-negative");
  }
  const completed = new Set(
    completedResults
      .filter((result) => {
        if (result.status !== "missing-credential") return true;
        const candidate = candidates.find(
          ({ provider, model }) =>
            provider === result.provider && model === result.model,
        );
        return candidate === undefined || !env[candidate.credential];
      })
      .map((result) => runKey(result.provider, result.model, result.caseId)),
  );
  const missingCredentialResults: ExperimentResult[] = [];

  if (accountedCostUsd > EXPERIMENT_COST_CAP_USD) {
    return {
      candidateOrder: candidates.map(({ model }) => model),
      actualCostUsd,
      accountedCostUsd,
      capExceeded: true,
      missingCredentialResults,
      nextRequest: null,
      stoppedBefore: null,
    };
  }

  for (const candidate of candidates) {
    for (const fixture of cases) {
      const key = runKey(candidate.provider, candidate.model, fixture.id);
      if (completed.has(key)) continue;
      if (!env[candidate.credential]) {
        missingCredentialResults.push(
          missingCredentialResult(candidate, fixture),
        );
        continue;
      }

      const request = plannedRequest(candidate, fixture);
      return {
        candidateOrder: candidates.map(({ model }) => model),
        actualCostUsd,
        accountedCostUsd,
        capExceeded: false,
        missingCredentialResults,
        nextRequest:
          accountedCostUsd + request.maximumCostUsd <= EXPERIMENT_COST_CAP_USD
            ? request
            : null,
        stoppedBefore:
          accountedCostUsd + request.maximumCostUsd > EXPERIMENT_COST_CAP_USD
            ? request
            : null,
      };
    }
  }

  return {
    candidateOrder: candidates.map(({ model }) => model),
    actualCostUsd,
    accountedCostUsd,
    capExceeded: false,
    missingCredentialResults,
    nextRequest: null,
    stoppedBefore: null,
  };
}

export function accountExperimentResult(
  result: ExperimentResult,
  maximumCostUsd: number,
): AccountedExperimentResult {
  if (!Number.isFinite(maximumCostUsd) || maximumCostUsd < 0) {
    throw new Error("FR-6 request reservation must be finite and non-negative");
  }
  if (result.status === "missing-credential") {
    return { ...result, accountedCostUsd: 0, costAccounting: "no-request" };
  }
  if (result.costUsd === 0 && result.usage.totalTokens === 0) {
    return {
      ...result,
      accountedCostUsd: maximumCostUsd,
      costAccounting: "reserved-unknown",
    };
  }
  return {
    ...result,
    accountedCostUsd: result.costUsd,
    costAccounting: "actual",
  };
}

export function buildFr6ExperimentProvenance(
  candidates: readonly Fr6Candidate[],
  cases: Fr6ExperimentCase[],
): Fr6ExperimentProvenance {
  const corpusCases = cases.map(({ id, category }) => ({ id, category }));
  return {
    protocolVersion: "fr6-fixed-input-v1",
    promptVersion: String(PROMPT_VERSION),
    costPolicy: {
      experimentCapUsd: EXPERIMENT_COST_CAP_USD,
      wrapperInputTokenAllowance: WRAPPER_INPUT_TOKEN_ALLOWANCE,
    },
    corpus: {
      sha256: createHash("sha256")
        .update(JSON.stringify(cases))
        .digest("hex"),
      cases: corpusCases,
    },
    models: candidates.map(({ provider, model, credential, pricing }) => ({
      provider,
      model,
      credential,
      pricing: { ...pricing },
    })),
  };
}

export function createFr6ResultsArtifact(
  provenance: Fr6ExperimentProvenance,
  blindSeed = randomBytes(32).toString("hex"),
  now = new Date(),
): Fr6ResultsArtifact {
  if (!/^[a-f0-9]{64}$/.test(blindSeed)) {
    throw new Error("FR-6 blind seed must be 32 random bytes encoded as hex");
  }
  const timestamp = now.toISOString();
  return {
    provenance,
    blindSeed,
    createdAt: timestamp,
    updatedAt: timestamp,
    results: [],
  };
}

export async function executeFr6Experiment(
  options: ExecuteFr6ExperimentOptions,
): Promise<{
  artifact: Fr6ResultsArtifact;
  stoppedBefore: PlannedProviderRequest | null;
  capExceeded: boolean;
  incompleteRequests: AccountedExperimentResult[];
}> {
  const releaseLock = await acquireFr6RunLock(options.evidenceDirectory);
  try {
    return await executeLockedFr6Experiment(options);
  } finally {
    await releaseLock();
  }
}

async function executeLockedFr6Experiment(
  options: ExecuteFr6ExperimentOptions,
): Promise<{
  artifact: Fr6ResultsArtifact;
  stoppedBefore: PlannedProviderRequest | null;
  capExceeded: boolean;
  incompleteRequests: AccountedExperimentResult[];
}> {
  const provenance = buildFr6ExperimentProvenance(
    options.candidates,
    options.cases,
  );
  const rawTarget = join(options.evidenceDirectory, "results.json");
  const blindTarget = join(options.evidenceDirectory, "blind-review.json");
  const existingArtifact = await loadFr6ResultsArtifact(
    rawTarget,
    provenance,
    options.candidates,
    options.cases,
  );
  let artifact: Fr6ResultsArtifact;
  if (existingArtifact === null) {
    artifact = createFr6ResultsArtifact(
      provenance,
      undefined,
      (options.now ?? (() => new Date()))(),
    );
    await atomicWriteJson(rawTarget, artifact);
  } else {
    artifact = existingArtifact;
  }

  let stoppedBefore: PlannedProviderRequest | null = null;
  let capExceeded = false;
  const checkpoint = async (result: AccountedExperimentResult): Promise<void> => {
    const resultKey = runKey(result.provider, result.model, result.caseId);
    const retained = artifact.results.filter(
      (existing) =>
        runKey(existing.provider, existing.model, existing.caseId) !== resultKey,
    );
    artifact = {
      ...artifact,
      updatedAt: (options.now ?? (() => new Date()))().toISOString(),
      results: [...retained, result],
    };
    await atomicWriteJson(rawTarget, artifact);
    options.afterRawCheckpoint?.(artifact);
  };

  while (true) {
    const plan = buildRunPlan(
      options.candidates,
      options.cases,
      options.env,
      artifact.results,
    );
    for (const missing of plan.missingCredentialResults) {
      await checkpoint(accountExperimentResult(missing, 0));
    }
    if (plan.capExceeded) {
      capExceeded = true;
      break;
    }
    if (plan.stoppedBefore !== null) {
      stoppedBefore = plan.stoppedBefore;
      break;
    }
    if (plan.nextRequest === null) break;

    const candidate = options.candidates.find(
      ({ provider, model }) =>
        provider === plan.nextRequest?.provider && model === plan.nextRequest.model,
    );
    const fixture = options.cases.find(
      ({ id }) => id === plan.nextRequest?.caseId,
    );
    if (candidate === undefined || fixture === undefined) {
      throw new Error("FR-6 run plan referenced an unknown candidate or case");
    }
    await checkpoint(
      inFlightResult(
        candidate,
        fixture,
        plan.nextRequest.maximumCostUsd,
      ),
    );
    let accounted: AccountedExperimentResult;
    try {
      const result = await options.runCase(candidate, fixture);
      assertPlannedResult(result, candidate, fixture, provenance.promptVersion);
      accounted = accountExperimentResult(
        result,
        plan.nextRequest.maximumCostUsd,
      );
      validateAccountedResult(accounted, candidate, fixture);
    } catch {
      accounted = accountExperimentResult(
        unknownFailureResult(candidate, fixture),
        plan.nextRequest.maximumCostUsd,
      );
    }
    await checkpoint(accounted);
  }

  const blinded = blindReviewRows(
    resultsEligibleForBlindReview(artifact.results),
    artifact.blindSeed,
  ).sort((left, right) => left.blindId.localeCompare(right.blindId));
  await atomicWriteJson(blindTarget, blinded);
  return {
    artifact,
    stoppedBefore,
    capExceeded,
    incompleteRequests: artifact.results.filter(
      ({ status }) => status === "in-flight",
    ),
  };
}

async function acquireFr6RunLock(
  evidenceDirectory: string,
): Promise<() => Promise<void>> {
  await mkdir(evidenceDirectory, { recursive: true });
  const lockDirectory = join(evidenceDirectory, "run.lock");
  try {
    await mkdir(lockDirectory);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error(
        `FR-6 live experiment is already running or requires stale lock review: ${lockDirectory}`,
      );
    }
    throw error;
  }
  return async () => {
    await rm(lockDirectory, { recursive: true });
  };
}

export function resolveFr6EvidenceDirectory(
  worktree: string,
  gitCommonDirOutput: string,
): string {
  const commonDir = gitCommonDirOutput.trim();
  if (commonDir.length === 0) {
    throw new Error("git rev-parse returned an empty common directory");
  }
  const absoluteCommonDir = isAbsolute(commonDir)
    ? commonDir
    : resolve(worktree, commonDir);
  return join(absoluteCommonDir, "sdd", "fr6-language-provider-experiment");
}

export async function atomicWriteJson(
  target: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function loadFr6ResultsArtifact(
  target: string,
  expectedProvenance: Fr6ExperimentProvenance,
  candidates: readonly Fr6Candidate[],
  cases: Fr6ExperimentCase[],
): Promise<Fr6ResultsArtifact | null> {
  let raw: string;
  try {
    raw = await readFile(target, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return validateFr6ResultsArtifact(
      JSON.parse(raw),
      expectedProvenance,
      candidates,
      cases,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Invalid FR-6 results artifact: ${detail}`);
  }
}

function validateFr6ResultsArtifact(
  value: unknown,
  expectedProvenance: Fr6ExperimentProvenance,
  candidates: readonly Fr6Candidate[],
  cases: Fr6ExperimentCase[],
): Fr6ResultsArtifact {
  const artifact = asObject(value);
  if (
    JSON.stringify(artifact.provenance) !== JSON.stringify(expectedProvenance)
  ) {
    throw new Error("protocol, corpus, model, pricing, or prompt provenance changed");
  }
  if (typeof artifact.blindSeed !== "string" || !/^[a-f0-9]{64}$/.test(artifact.blindSeed)) {
    throw new Error("blind seed is missing or invalid");
  }
  if (typeof artifact.createdAt !== "string" || typeof artifact.updatedAt !== "string") {
    throw new Error("artifact timestamps are missing");
  }
  if (!Array.isArray(artifact.results)) {
    throw new Error("results ledger is missing");
  }

  const allowedCases = new Map(cases.map((fixture) => [fixture.id, fixture]));
  const allowedModels = new Map(
    candidates.map((candidate) => [
      `${candidate.provider}\0${candidate.model}`,
      candidate,
    ]),
  );
  const seen = new Set<string>();
  const results = artifact.results.map((rawResult) => {
    const rawObject = asObject(rawResult);
    const candidate = allowedModels.get(
      `${String(rawObject.provider)}\0${String(rawObject.model)}`,
    );
    const fixture = allowedCases.get(String(rawObject.caseId));
    if (candidate === undefined) {
      throw new Error(`unknown candidate result: ${String(rawObject.model)}`);
    }
    if (fixture === undefined || fixture.category !== rawObject.category) {
      throw new Error(`unknown or mismatched corpus case: ${String(rawObject.caseId)}`);
    }
    const result = validateAccountedResult(rawResult, candidate, fixture);
    const key = runKey(result.provider, result.model, result.caseId);
    if (seen.has(key)) throw new Error(`duplicate result ledger entry: ${result.caseId}`);
    seen.add(key);
    if (result.promptVersion !== expectedProvenance.promptVersion) {
      throw new Error(`prompt provenance mismatch: ${result.caseId}`);
    }
    return result;
  });
  return {
    provenance: expectedProvenance,
    blindSeed: artifact.blindSeed,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    results,
  };
}

function validateAccountedResult(
  value: unknown,
  candidate: Fr6Candidate,
  fixture: Fr6ExperimentCase,
): AccountedExperimentResult {
  const result = asObject(value);
  const statuses = new Set<ExperimentResult["status"]>([
    "ok",
    "missing-credential",
    "in-flight",
    "request-failed",
    "schema-invalid",
    "truncated",
  ]);
  const categories = new Set<LanguageCallCategory>([
    "ride-analysis",
    "prose-retrospective",
    "structured-retrospective",
  ]);
  const providers = new Set<ExperimentResult["provider"]>([
    "anthropic",
    "openai",
    "google",
    "mistral",
  ]);
  if (
    typeof result.caseId !== "string" ||
    typeof result.category !== "string" ||
    !categories.has(result.category as LanguageCallCategory) ||
    typeof result.provider !== "string" ||
    !providers.has(result.provider as ExperimentResult["provider"]) ||
    typeof result.model !== "string" ||
    typeof result.promptVersion !== "string" ||
    typeof result.status !== "string" ||
    !statuses.has(result.status as ExperimentResult["status"]) ||
    typeof result.output !== "string" ||
    typeof result.costUsd !== "number" ||
    !Number.isFinite(result.costUsd) ||
    result.costUsd < 0 ||
    typeof result.accountedCostUsd !== "number" ||
    !Number.isFinite(result.accountedCostUsd) ||
    result.accountedCostUsd < result.costUsd ||
    typeof result.schemaValid !== "boolean" ||
    !Array.isArray(result.unsupportedClaims) ||
    !result.unsupportedClaims.every((claim) => typeof claim === "string")
  ) {
    throw new Error("result ledger row has an invalid shape");
  }
  if (
    result.costAccounting !== "actual" &&
    result.costAccounting !== "reserved-unknown" &&
    result.costAccounting !== "reserved-in-flight" &&
    result.costAccounting !== "no-request"
  ) {
    throw new Error("result ledger row has invalid cost accounting");
  }
  if (result.costAccounting === "actual" && result.accountedCostUsd !== result.costUsd) {
    throw new Error("actual cost accounting disagrees with request cost");
  }
  if (
    result.costAccounting === "no-request" &&
    (result.status !== "missing-credential" || result.accountedCostUsd !== 0)
  ) {
    throw new Error("no-request accounting is inconsistent");
  }
  const usageValue = asObject(result.usage);
  let componentTokenTotal = 0;
  for (const field of [
    "inputTokens",
    "cachedInputTokens",
    "cacheWriteTokens",
    "outputTokens",
    "reasoningTokens",
    "totalTokens",
  ]) {
    if (
      typeof usageValue[field] !== "number" ||
      !Number.isFinite(usageValue[field]) ||
      usageValue[field] < 0
    ) {
      throw new Error("result ledger row has invalid usage");
    }
    componentTokenTotal += usageValue[field] as number;
  }
  componentTokenTotal -= usageValue.totalTokens as number;
  if (usageValue.totalTokens !== componentTokenTotal) {
    throw new Error("result ledger row has inconsistent total usage");
  }
  if (
    (result.costAccounting === "reserved-unknown" ||
      result.costAccounting === "reserved-in-flight") &&
    (result.status === "missing-credential" ||
      result.costUsd !== 0 ||
      usageValue.totalTokens !== 0 ||
      result.accountedCostUsd <= 0)
  ) {
    throw new Error("reserved cost accounting is inconsistent");
  }
  const expectedReservation = conservativeMaximumRequestCost(candidate, fixture);
  if (
    (result.costAccounting === "reserved-unknown" ||
      result.costAccounting === "reserved-in-flight") &&
    !costsEqual(result.accountedCostUsd as number, expectedReservation)
  ) {
    throw new Error("reserved cost does not match the request reservation");
  }
  if (
    result.costAccounting === "reserved-in-flight" &&
    result.status !== "in-flight"
  ) {
    throw new Error("in-flight cost accounting is inconsistent");
  }
  if (
    result.status === "in-flight" &&
    result.costAccounting !== "reserved-in-flight"
  ) {
    throw new Error("in-flight result is missing its reservation");
  }
  if (
    result.status === "missing-credential" &&
    result.costAccounting !== "no-request"
  ) {
    throw new Error("missing credential result has request accounting");
  }
  if (
    result.costAccounting === "no-request" &&
    usageValue.totalTokens !== 0
  ) {
    throw new Error("no-request result has billed usage");
  }
  if (result.costAccounting === "actual") {
    const expectedActual = estimateExperimentCost(
      candidate.pricing,
      result.usage as ExperimentUsage,
    );
    if (!costsEqual(result.costUsd as number, expectedActual)) {
      throw new Error("actual cost does not match persisted usage and pricing");
    }
  }
  if (
    typeof result.latencyMs !== "number" ||
    !Number.isFinite(result.latencyMs) ||
    result.latencyMs < 0 ||
    typeof result.retries !== "number" ||
    !Number.isFinite(result.retries) ||
    result.retries < 0 ||
    (result.finishReason !== null && typeof result.finishReason !== "string")
  ) {
    throw new Error("result ledger row has invalid request metadata");
  }
  return result as unknown as AccountedExperimentResult;
}

function costsEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-12;
}

function inFlightResult(
  candidate: Fr6Candidate,
  fixture: Fr6ExperimentCase,
  maximumCostUsd: number,
): AccountedExperimentResult {
  return {
    ...missingCredentialResult(candidate, fixture),
    status: "in-flight",
    output: "Request reserved; completion was not checkpointed.",
    accountedCostUsd: maximumCostUsd,
    costAccounting: "reserved-in-flight",
  };
}

function assertPlannedResult(
  result: ExperimentResult,
  candidate: Fr6Candidate,
  fixture: Fr6ExperimentCase,
  promptVersion: string,
): void {
  if (
    result.provider !== candidate.provider ||
    result.model !== candidate.model ||
    result.caseId !== fixture.id ||
    result.category !== fixture.category ||
    result.promptVersion !== promptVersion ||
    result.status === "missing-credential"
  ) {
    throw new Error("provider result does not match the planned request");
  }
}

function unknownFailureResult(
  candidate: Fr6Candidate,
  fixture: Fr6ExperimentCase,
): ExperimentResult {
  return {
    ...missingCredentialResult(candidate, fixture),
    status: "request-failed",
    output: `${candidate.provider} request failed before usage was reported.`,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected an object");
  }
  return value as Record<string, unknown>;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function runKey(
  provider: ExperimentResult["provider"],
  model: string,
  caseId: string,
): string {
  return `${provider}\0${model}\0${caseId}`;
}

function plannedRequest(
  candidate: Fr6Candidate,
  fixture: Fr6ExperimentCase,
): PlannedProviderRequest {
  return {
    provider: candidate.provider,
    model: candidate.model,
    caseId: fixture.id,
    maximumCostUsd: conservativeMaximumRequestCost(candidate, fixture),
  };
}

function conservativeMaximumRequestCost(
  candidate: Fr6Candidate,
  fixture: Fr6ExperimentCase,
): number {
  // UTF-8 bytes are an intentionally high token estimate for this ASCII fixture
  // corpus. The additional allowance covers request wrappers and the structured
  // schema. Charge all of it at the most expensive input class, then reserve the
  // full output cap at the output rate.
  const promptBytes = Buffer.byteLength(fixture.prompt, "utf8");
  const inputTokenCeiling = promptBytes + WRAPPER_INPUT_TOKEN_ALLOWANCE;
  const inputRate = Math.max(
    candidate.pricing.inputPerMillion,
    candidate.pricing.cachedInputPerMillion,
    candidate.pricing.cacheWritePerMillion,
  );
  return (
    inputTokenCeiling * inputRate +
    fixture.maxOutputTokens * candidate.pricing.outputPerMillion
  ) / 1_000_000;
}

function missingCredentialResult(
  candidate: Fr6Candidate,
  fixture: Fr6ExperimentCase,
): ExperimentResult {
  return {
    caseId: fixture.id,
    category: fixture.category,
    provider: candidate.provider,
    model: candidate.model,
    promptVersion: String(PROMPT_VERSION),
    status: "missing-credential",
    output: `Missing credential: ${candidate.credential}`,
    parsed: null,
    usage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    },
    costUsd: 0,
    latencyMs: 0,
    finishReason: null,
    retries: 0,
    schemaValid: fixture.schema === null,
    unsupportedClaims: [],
  };
}

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

  const expectedCases = new Map(
    FR6_CASES.map(({ id, category }) => [id, category]),
  );
  const contexts = new Map<string, ExperimentResult[]>();
  for (const result of results) {
    const context = runKey(result.provider, result.model, "");
    contexts.set(context, [...(contexts.get(context) ?? []), result]);
  }
  const corpusComplete =
    contexts.size > 0 &&
    [...contexts.values()].every((candidateResults) => {
      if (candidateResults.length !== expectedCases.size) return false;
      const seen = new Set<string>();
      for (const result of candidateResults) {
        if (
          seen.has(result.caseId) ||
          expectedCases.get(result.caseId) !== result.category
        ) {
          return false;
        }
        seen.add(result.caseId);
      }
      return seen.size === expectedCases.size;
    });
  if (!corpusComplete) failures.push("corpus-incomplete");

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
  idFor: (result: ExperimentResult, seed: string) => string = opaqueId,
): BlindReviewRow[] {
  const ids = new Set<string>();
  return results.map((result) => {
    const blindId = idFor(result, seed);
    if (ids.has(blindId)) {
      throw new Error(`duplicate blind review ID: ${blindId}`);
    }
    ids.add(blindId);
    return {
      blindId,
      caseId: result.caseId,
      category: result.category,
      output: result.output,
    };
  });
}

export function resultsEligibleForBlindReview(
  results: ExperimentResult[],
): ExperimentResult[] {
  const grouped = new Map<string, ExperimentResult[]>();
  for (const result of results) {
    const key = runKey(result.provider, result.model, "");
    grouped.set(key, [...(grouped.get(key) ?? []), result]);
  }
  const eligible = new Set(
    [...grouped.entries()]
      .filter(([, candidateResults]) => evaluateHardGates(candidateResults).passed)
      .map(([key]) => key),
  );
  return results.filter(
    (result) => eligible.has(runKey(result.provider, result.model, "")),
  );
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
    `\\b(${metricPattern})\\s+(increased|decreased|changed|rose|fell|improved|declined|dropped|grew|moved|went|shifted)\\s+` +
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

  const arrowPattern = new RegExp(
    `\\b(${metricPattern})\\s+(${signedNumber})\\s*(?:→|->|=>)\\s*(${signedNumber})\\b`,
    "gi",
  );
  for (const match of output.matchAll(arrowPattern)) {
    const metric = match[1].replace(/\s+(?:score|EWMA)$/i, "");
    const metricKey = normalizeMetricName(metric);
    let searchFrom = metric.length;
    for (const value of [match[2], match[3]]) {
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

  const metricDeltaPattern = new RegExp(
    `\\b(${metricPattern})\\s+(?:delta|Δ)\\s*(?:(?:was|is|of|at)\\s*)?(?::|=)?\\s*(${signedNumber})\\b`,
    "gi",
  );
  for (const match of output.matchAll(metricDeltaPattern)) {
    const metric = match[1].replace(/\s+(?:score|EWMA)$/i, "");
    const normalizedDelta = canonicalNumberToken(normalizeSign(match[2]));
    if (!allowedDeltas.has(`${normalizeMetricName(metric)}:${normalizedDelta}`)) {
      unsupported.push({
        index: match.index + match[0].lastIndexOf(match[2]),
        message: `unsupported numeric delta: ${metric} ${Number(normalizedDelta) >= 0 ? "+" : ""}${normalizedDelta}`,
      });
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
    `\\b(${metricPattern})\\s*(?:(?:was|is|of|at)\\s*)?:?\\s*(${signedNumber})\\b(?!\\s*(?:\\/|→|->|=>))`,
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
      "gi",
    );
    const match = [...output.matchAll(pattern)].find(
      (candidate) => !isLocallyNegated(output, candidate.index),
    );
    if (match !== undefined) {
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

function isLocallyNegated(output: string, claimIndex: number): boolean {
  const localPrefix = output.slice(Math.max(0, claimIndex - 32), claimIndex);
  const qualifier = "(?:actually|remotely|really|quite|exactly|necessarily|entirely)";
  const article = "(?:a|an|the)";
  const contraction = "(?:isn(?:['’]t|t)|wasn(?:['’]t|t))";
  return new RegExp(
    `(?:\\b(?:not|never)\\s+(?:${qualifier}\\s+)?(?:${article}\\s+)?|` +
      `\\b${contraction}\\s+(?:${qualifier}\\s+)?(?:${article}\\s+)?|` +
      `\\b(?:hardly|scarcely|barely)\\s+(?:${article}\\s+)?|` +
      `\\banything\\s+but\\s+(?:${article}\\s+)?)$`,
    "i",
  ).test(
    localPrefix,
  );
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
    .update(result.provider)
    .update("\0")
    .update(result.model)
    .update("\0")
    .update(result.caseId)
    .update("\0")
    .update(result.category)
    .update("\0")
    .update(result.promptVersion)
    .update("\0")
    .update(result.output)
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();

  return `FR6-${digest}`;
}
