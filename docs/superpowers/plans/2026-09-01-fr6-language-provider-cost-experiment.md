# FR-6 Remaining-Language Provider and Cost Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `agent-orchestration` to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a reproducible fixed-input comparison for NodeVelo's three optional language calls, project a real two-week cost, and record a keep/switch/retire decision under a $0.25 block budget.

**Architecture:** Keep the experiment outside production routes. Pure experiment contracts normalize provider usage, calculate cost, enforce the budget, and prepare blind outputs; sanitized fixtures call the existing prompt builders; thin adapters invoke Anthropic, OpenAI, Gemini, and Mistral only from an explicitly live experiment runner. A production adapter is a later, separately reviewed slice only if measured evidence selects one.

**Tech Stack:** TypeScript, Vitest, Node 22 `fetch`, existing `@anthropic-ai/sdk`, Zod, provider REST APIs, Markdown evidence.

## Global Constraints

- Deterministic block generation remains $0 and makes no model call.
- Projected combined cost is at most $0.25 for eleven ride notes, one prose retrospective, and one structured retrospective.
- The paid experiment stops at $2 unless the owner explicitly extends it.
- The committed corpus contains no live athlete notes, credentials, identifiers, or raw activity payloads.
- The first pass uses unchanged prompt strings/output caps, standard synchronous tiers, and no explicit prompt cache.
- Missing credentials and provider failures remain explicit results; no fallback hides them.
- Production routes, provider selection, provenance, and usage accounting remain unchanged until a measured winner is approved.
- FR-6 synthetic calls never count as FR-9 prospective evidence.

---

### Task 1: Pure experiment contracts, usage normalization, and cost gate

**Files:**
- Create: `scripts/fr6-language-experiment.ts`
- Create: `scripts/fr6-language-experiment.test.ts`

**Interfaces:**
- Consumes: no provider SDKs or environment variables.
- Produces: `LanguageCallCategory`, `ExperimentUsage`, `ExperimentResult`, `CandidatePricing`, `estimateExperimentCost`, `projectTwoWeekCost`, `evaluateHardGates`, and `blindReviewRows`.

- [ ] **Step 1: Write failing tests for provider-neutral cost arithmetic**

```ts
import { describe, expect, it } from "vitest";
import {
  estimateExperimentCost,
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

it("normalizes every billed token class into one request cost", () => {
  expect(estimateExperimentCost(pricing, {
    inputTokens: 1_000,
    cachedInputTokens: 2_000,
    cacheWriteTokens: 3_000,
    outputTokens: 4_000,
    reasoningTokens: 500,
    totalTokens: 10_500,
  })).toBeCloseTo(0.02795, 8);
});

it("projects eleven ride notes and both closeout calls", () => {
  const rows = [
    { category: "ride-analysis", costUsd: 0.01 },
    { category: "prose-retrospective", costUsd: 0.02 },
    { category: "structured-retrospective", costUsd: 0.03 },
  ] as ExperimentResult[];
  expect(projectTwoWeekCost(rows, 11)).toBeCloseTo(0.16, 8);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run scripts/fr6-language-experiment.test.ts`  
Expected: FAIL because `fr6-language-experiment.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure contracts**

```ts
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
  status: "ok" | "missing-credential" | "request-failed" | "schema-invalid" | "truncated";
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

export function estimateExperimentCost(pricing: CandidatePricing, usage: ExperimentUsage): number {
  return (
    usage.inputTokens * pricing.inputPerMillion +
    usage.cachedInputTokens * pricing.cachedInputPerMillion +
    usage.cacheWriteTokens * pricing.cacheWritePerMillion +
    (usage.outputTokens + usage.reasoningTokens) * pricing.outputPerMillion
  ) / 1_000_000;
}

export function projectTwoWeekCost(results: ExperimentResult[], rideDays: number): number {
  const mean = (category: LanguageCallCategory) => {
    const rows = results.filter((row) => row.category === category && row.status === "ok");
    return rows.reduce((sum, row) => sum + row.costUsd, 0) / rows.length;
  };
  return rideDays * mean("ride-analysis") + mean("prose-retrospective") + mean("structured-retrospective");
}
```

- [ ] **Step 4: Add hard-gate and deterministic blind-row tests**

Test that missing/failed/schema-invalid results fail, `$0.25` passes while `$0.250001` fails, unsupported claims fail, and `blindReviewRows(results, "fr6-v1")` produces stable opaque IDs without provider/model fields.

- [ ] **Step 5: Run Task 1 tests and verify GREEN**

Run: `npx vitest run scripts/fr6-language-experiment.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add scripts/fr6-language-experiment.ts scripts/fr6-language-experiment.test.ts
git commit -m "test(fr6): add provider-neutral cost gates"
```

---

### Task 2: Sanitized fixed corpus and independent grounding facts

**Files:**
- Create: `scripts/fr6-language-fixtures.ts`
- Create: `scripts/fr6-language-fixtures.test.ts`
- Modify: `scripts/fr6-language-experiment.ts`
- Modify: `scripts/fr6-language-experiment.test.ts`

**Interfaces:**
- Consumes: `buildRideAnalysisPrompt`, `buildRetrospectivePrompt`, `buildStructuredRetrospectivePrompt`, `RetrospectiveToolSchema`, and Task 1's `LanguageCallCategory`.
- Produces: `FR6_CASES`, `Fr6ExperimentCase`, `findUnsupportedClaims`, exact prompt strings, output caps `450/380/700`, and the shared structured JSON schema.

- [ ] **Step 1: Write the failing corpus-shape and sanitization tests**

```ts
it("covers every approved corpus case and contains no live identifiers", () => {
  expect(FR6_CASES.map((item) => item.id)).toEqual([
    "ride-prescribed-good",
    "ride-prescribed-poor",
    "ride-self-directed",
    "retro-normal",
    "retro-early",
    "structured-mixed-verdicts",
  ]);
  const serialized = JSON.stringify(FR6_CASES);
  for (const forbidden of ["i174", "Novo Mesto", "Otis", "@", "ANTHROPIC_API_KEY"]) {
    expect(serialized).not.toContain(forbidden);
  }
});

it("uses the production prompt builders and exact output caps", () => {
  expect(FR6_CASES.map(({ category, maxOutputTokens }) => [category, maxOutputTokens])).toEqual([
    ["ride-analysis", 450],
    ["ride-analysis", 450],
    ["ride-analysis", 450],
    ["prose-retrospective", 380],
    ["prose-retrospective", 380],
    ["structured-retrospective", 700],
  ]);
});
```

- [ ] **Step 2: Run fixture tests and verify RED**

Run: `npx vitest run scripts/fr6-language-fixtures.test.ts`  
Expected: FAIL because the fixture module does not exist.

- [ ] **Step 3: Implement all six fixtures with synthetic literals**

Use fictional dates in `2030`, fictional goals and ride names, FTP `250`, and independent facts on each case:

```ts
export interface Fr6ExperimentCase {
  id: string;
  category: LanguageCallCategory;
  prompt: string;
  maxOutputTokens: 450 | 380 | 700;
  structured: boolean;
  allowedNumbers: string[];
  forbiddenClaims: string[];
}

export const FR6_CASES: Fr6ExperimentCase[] = [
  rideCase("ride-prescribed-good", goodPrescribedRide, {
    allowedNumbers: ["2030-01-08", "250", "225", "90", "8", "45"],
    forbiddenClaims: ["FTP increased", "adaptation confirmed", "missed interval"],
  }),
  rideCase("ride-prescribed-poor", poorPrescribedRide, {
    allowedNumbers: ["2030-01-10", "250", "205", "82", "3", "60"],
    forbiddenClaims: ["textbook", "fully completed", "fitness increased"],
  }),
  rideCase("ride-self-directed", selfDirectedRide, {
    allowedNumbers: ["2030-01-12", "250", "210", "84", "7", "75"],
    forbiddenClaims: ["prescribed session", "100% compliance", "technique confirmed"],
  }),
  proseRetroCase("retro-normal", normalRetrospective, {
    allowedNumbers: ["2030-01-01", "2030-01-14", "2", "12", "11", "92", "50", "53"],
    forbiddenClaims: ["ended early", "future session", "FTP increased"],
  }),
  proseRetroCase("retro-early", earlyRetrospective, {
    allowedNumbers: ["2030-02-01", "2030-02-03", "2030-02-14", "2", "3", "1", "50"],
    forbiddenClaims: ["two-week failure", "missed after 2030-02-03", "FTP increased"],
  }),
  structuredRetroCase("structured-mixed-verdicts", structuredRetrospective, {
    allowedNumbers: ["2030-03-01", "2030-03-14", "2", "10", "9", "90", "5", "6", "250", "255"],
    forbiddenClaims: ["injury", "FTP increased", "medication"],
  }),
];
```

`rideCase`, `proseRetroCase`, and `structuredRetroCase` are local typed factories that call the
corresponding production prompt builder and set the category/output cap/schema flag. Define
`goodPrescribedRide`, `poorPrescribedRide`, and `selfDirectedRide` as complete `RideAnalysisInput`
objects using only the literals above plus null/empty optional evidence; define the retrospective
objects as complete `RetrospectiveInput` values using their listed dates/hours/compliance/CTL values.

- [ ] **Step 4: Implement deterministic unsupported-claim checks**

Extract ISO dates and number/unit tokens from output. Report any date absent from the prompt and any
number-bearing token absent from the case allowlist. Also report exact case-specific forbidden claims.
Do not claim this proves semantic grounding; the blind human review remains authoritative for prose.

- [ ] **Step 5: Verify corpus, prompt, schema, and grounding tests**

Run: `npx vitest run scripts/fr6-language-fixtures.test.ts scripts/fr6-language-experiment.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add scripts/fr6-language-fixtures.ts scripts/fr6-language-fixtures.test.ts scripts/fr6-language-experiment.ts scripts/fr6-language-experiment.test.ts
git commit -m "test(fr6): add sanitized language corpus"
```

---

### Task 3: Provider adapters and explicit failure results

**Files:**
- Create: `scripts/fr6-language-providers.ts`
- Create: `scripts/fr6-language-providers.test.ts`

**Interfaces:**
- Consumes: `Fr6ExperimentCase`, `ExperimentResult`, `ExperimentUsage`, existing `@anthropic-ai/sdk`, global `fetch`, and the structured schema exported by the fixtures.
- Produces: `FR6_CANDIDATES`, `runProviderCase(candidate, fixture, deps)`, normalized usage for all four providers, and exact credential names.

- [ ] **Step 1: Write failing credential and response-normalization tests**

```ts
it.each([
  ["anthropic", "ANTHROPIC_API_KEY"],
  ["openai", "OPENAI_API_KEY"],
  ["google", "GEMINI_API_KEY"],
  ["mistral", "MISTRAL_API_KEY"],
])("records missing %s credentials without making a request", async (provider, credential) => {
  const fetch = vi.fn();
  const result = await runProviderCase(candidate(provider), FR6_CASES[0], {
    env: {}, fetch,
    now: performance.now,
  });
  expect(result.status).toBe("missing-credential");
  expect(result.output).toContain(credential);
  expect(fetch).not.toHaveBeenCalled();
});
```

Add one mocked success and one malformed/failed response for each provider. Assert usage fields,
finish reason, schema status, HTTP error sanitization, and zero retries.

- [ ] **Step 2: Run provider tests and verify RED**

Run: `npx vitest run scripts/fr6-language-providers.test.ts`  
Expected: FAIL because the provider module does not exist.

- [ ] **Step 3: Define the exact candidate matrix and prices**

```ts
export const FR6_CANDIDATES = [
  anthropic("claude-sonnet-4-6", { input: 3, cached: 0.3, write: 3.75, output: 15 }),
  anthropic("claude-haiku-4-5", { input: 1, cached: 0.1, write: 1.25, output: 5 }),
  openai("gpt-5.6-luna", { input: 0.2, cached: 0.02, write: 0.25, output: 1.2 }),
  google("gemini-3.1-flash-lite", { input: 0.25, cached: 0.025, write: 0.25, output: 1.5 }),
  mistral("mistral-small-2603", { input: 0.15, cached: 0.015, write: 0.15, output: 0.6 }),
] as const;
```

Keep these experiment prices next to the dated evidence; they do not replace production
`lib/ai-usage.ts` pricing.

- [ ] **Step 4: Implement thin adapters with no fallback**

- Anthropic uses the existing SDK and forced `submit_reflections` tool for the structured case.
- OpenAI calls `POST https://api.openai.com/v1/responses` and uses strict `json_schema` text output.
- Gemini calls `models/{model}:generateContent` with `responseMimeType: "application/json"` and
  `responseJsonSchema` for the structured case.
- Mistral calls `POST https://api.mistral.ai/v1/chat/completions` with `response_format.type =
  "json_schema"` for the structured case.
- Every adapter uses the fixture's exact prompt and output cap, standard synchronous service, zero
  automatic retries, and the same final Zod parse.

- [ ] **Step 5: Verify all provider-adapter tests**

Run: `npx vitest run scripts/fr6-language-providers.test.ts`  
Expected: PASS with no network access.

- [ ] **Step 6: Commit Task 3**

```bash
git add scripts/fr6-language-providers.ts scripts/fr6-language-providers.test.ts
git commit -m "feat(fr6): add isolated provider adapters"
```

---

### Task 4: Live runner, $2 stop, persistent evidence, and blind sheet

**Files:**
- Create: `scripts/fr6-language-experiment.live.test.ts`
- Modify: `package.json`
- Test: `scripts/fr6-language-experiment.test.ts`

**Interfaces:**
- Consumes: `FR6_CASES`, `FR6_CANDIDATES`, `runProviderCase`, `projectTwoWeekCost`, `evaluateHardGates`, and `blindReviewRows`.
- Produces: `npm run experiment:fr6`, `.git/sdd/fr6-language-provider-experiment/results.json`, `.git/sdd/fr6-language-provider-experiment/blind-review.json`, and a non-zero exit when measured spend would exceed $2.

- [ ] **Step 1: Write failing runner-plan tests**

Test `buildRunPlan` orders Sonnet, Haiku, Luna, Gemini, and Mistral; skips only candidates with missing
credentials; accumulates measured cost before the next request; and stops before a request whose
conservative maximum would cross `$2`.

- [ ] **Step 2: Run runner tests and verify RED**

Run: `npx vitest run scripts/fr6-language-experiment.test.ts`  
Expected: FAIL because live-runner planning is absent.

- [ ] **Step 3: Implement the opt-in live test and package command**

```json
"experiment:fr6": "FR6_RUN_LIVE=1 vitest run scripts/fr6-language-experiment.live.test.ts"
```

The live test uses `describe.skipIf(process.env.FR6_RUN_LIVE !== "1")`, resolves the git common
directory with `git rev-parse --git-common-dir`, writes atomically beneath
`.git/sdd/fr6-language-provider-experiment/`, and prints a table containing status, latency, schema,
unsupported claims, request cost, and projected two-week cost. Result JSON may name providers; blind
JSON contains only opaque IDs and outputs.

- [ ] **Step 4: Verify runner behavior without credentials or network**

Run: `npx vitest run scripts/fr6-language-experiment.test.ts scripts/fr6-language-experiment.live.test.ts`  
Expected: pure tests PASS and the live suite SKIPS when `FR6_RUN_LIVE` is absent.

- [ ] **Step 5: Commit Task 4**

```bash
git add package.json scripts/fr6-language-experiment.ts scripts/fr6-language-experiment.test.ts scripts/fr6-language-experiment.live.test.ts
git commit -m "feat(fr6): add capped live experiment runner"
```

---

### Task 5: Run the available fixed-input matrix and capture the decision surface

**Files:**
- Create after the run: `docs/reviews/2026-09-01-fr6-language-provider-experiment.md`
- Modify: `ROADMAP.md`
- Modify: `docs/systems/07-ai-layer.md`

**Interfaces:**
- Consumes: live result and blind-review JSON from Task 4 plus the approved design/research.
- Produces: one dated evidence table, explicit credential gaps, actual cost projections, hard-gate results, and owner blind-scoring instructions.

- [ ] **Step 1: Preflight credentials without printing secrets**

Run a shell check that prints only whether `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
and `MISTRAL_API_KEY` are present. Load the existing local environment convention first. Never echo
values.

- [ ] **Step 2: Run the live matrix once**

Run: `npm run experiment:fr6`  
Expected: every configured candidate produces six result rows; unconfigured candidates produce six
`missing-credential` rows; total measured spend remains below `$2`; raw and blind JSON are written.

- [ ] **Step 3: Verify the evidence independently**

Check result counts, recompute cost from normalized usage, confirm structured output passes the shared
Zod schema, scan committed fixtures/results for secrets and live identifiers, and confirm no FR-9
file was counted as experiment input.

- [ ] **Step 4: Write the evidence record without inventing missing comparisons**

The review must contain:

- exact head commit and run date;
- corpus IDs and candidate model IDs;
- credentials available/missing;
- per-provider validity, grounding, latency, measured spend, and projected block cost;
- the opaque blind-review path and scoring rubric;
- explicit status `INCOMPLETE` while any required provider or owner score is missing;
- no production recommendation before all hard gates and the blind review finish.

- [ ] **Step 5: Re-scope the roadmap honestly**

Replace FR-6's stale `/api/generate`/publication-gate file scope with the three language calls,
experiment harness, provider research, `$0.25` exit budget, and a link to the evidence record. Keep
FR-7 blocked until FR-6 has a recorded keep/switch/retire decision. Add the fixed-input experiment and
credential boundary to `07-ai-layer`'s known rough edges.

- [ ] **Step 6: Verify and commit Task 5**

Run: `git diff --check && npm run check-links`  
Expected: PASS.

```bash
git add ROADMAP.md docs/systems/07-ai-layer.md docs/reviews/2026-09-01-fr6-language-provider-experiment.md
git commit -m "docs(fr6): record fixed-input experiment state"
```

---

### Task 6: Blind decision, production disposition, and FR-6 closeout

**Files:**
- Modify after owner scoring: `docs/reviews/2026-09-01-fr6-language-provider-experiment.md`
- Modify after owner scoring: `ROADMAP.md`
- Modify after owner scoring: `ARCHIVE.md`
- Conditional production files only when approved by evidence: `lib/anthropic-api.ts`, `lib/anthropic-config.ts`, `lib/ai-usage.ts`, their tests, and privacy/UI documentation; or a separately planned external-provider adapter.

**Interfaces:**
- Consumes: completed blind scores and every required provider result.
- Produces: one keep/switch/retire decision per language category; either an approved minimal production-change plan or an evidence-only FR-6 closeout.

- [ ] **Step 1: Present the blind sheet without the identity map**

Collect owner scores from 1–5 for usefulness, trust, specificity, and tone, plus a reject flag for any
invented claim or unsafe advice. Preserve the blind IDs exactly.

- [ ] **Step 2: Join scores to identities and apply the approved rules**

Reject hard-gate failures first. Among remaining candidates, prefer Haiku when its usefulness is
comparable even if an external candidate is marginally cheaper. Retire a category when no result is
worth its cost. Never raise the budget automatically.

- [ ] **Step 3: Choose exactly one disposition path**

- **No production change:** record why Sonnet remains or why optional calls retire, then close FR-6.
- **Haiku change:** write regression tests for model selection/pricing/provenance, make the minimal
  production change, run all focused tests plus one live smoke, then close FR-6.
- **External-provider winner:** stop before production code, write a separate approved design/plan for
  the minimal adapter, and keep FR-6 open until that slice lands.

- [ ] **Step 4: Run full verification before any completion claim**

Run: `npm run check && git diff --check`  
Expected: TypeScript, lint, all tests, agent-workflow guards, sync tests, and link checks PASS.

- [ ] **Step 5: Update canonical status and commit**

Move FR-6 to `ARCHIVE.md` only when all three categories have a decision and any approved production
change has live smoke evidence. Unblock FR-7 only at that point. Stage only files touched by this task.

---

## Final verification and integration

- [ ] Re-read the approved design and map every requirement to the implemented task/evidence row.
- [ ] Run `npm run check` and `git diff --check` fresh.
- [ ] Confirm the worktree is clean and only FR-6/FR-9 documentation plus the experiment harness changed.
- [ ] Finish through `npm run finish:agent-task`; do not push or open a PR manually.
- [ ] Merge only after the repository's exact-head review gate or a new explicit PR-scoped owner override.
