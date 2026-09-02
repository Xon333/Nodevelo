# 07 · AI layer (Anthropic integration)

**Why this exists:** Anthropic is retained only where language is the product: an optional post-ride coach note and optional retrospective wording/reflections. Deterministic engines supply the facts and numbers; the model phrases them. Block generation is outside this layer and is documented in [06-generation](06-generation.md).

## Every LLM call site

Exactly three active call categories exist across two routes:

| # | Route | Function | Output | Prompt | Validation |
|---:|---|---|---|---|---|
| 1 | `POST /api/analyze` | `analyseRide` | Coach-note prose | `buildRideAnalysisPrompt` | Deterministic score/evidence supplied as authoritative input |
| 2 | `POST /api/retrospective` | `generateRetrospective` | Retrospective prose | `buildRetrospectivePrompt` | Optional enrichment; deterministic closeout facts persist without it |
| 3 | same retrospective request | `generateStructuredRetrospective` | Structured reflections | `buildStructuredRetrospectivePrompt` | Forced `RETROSPECTIVE_TOOL`, zod validation, degrades to `[]` |

`POST /api/generate`, `POST /api/intent`, sync, scoring, nutrition, and publication validation make no Anthropic call.

## Module layout

| Module | Owns |
|---|---|
| `lib/anthropic-api.ts` | Lazy SDK client, model/provenance constants, the three call functions, usage recording |
| `lib/anthropic-config.ts` | SDK-free configuration check |
| `lib/anthropic-prompts.ts` | Pure ride-analysis and retrospective prompt builders |
| `lib/retrospective-schema.ts` | Structured-reflection schema and tool |
| `lib/tool-schema.ts` | Shared zod-to-Anthropic tool bridge |
| `lib/ai-usage.ts` | Token/cost telemetry in `data/ai-usage.json` |

Generation-only prompt builders, plan tool schema, and request dedupe were removed with FR-5.

## Models and provenance

`GENERATION_MODEL` retains its historical name because stored AI artifacts and usage accounting depend on that public constant. It currently identifies the model used by ride analysis and both retrospective paths. `PROMPT_VERSION` stamps genuine AI artifacts, including a retrospective created while archiving a deterministic block; deterministic plans themselves omit both fields.

Model IDs also appear in `ai-usage.ts` pricing keys. Update both locations together or usage can silently record zero cost for an unknown model.

## Authority boundary

- TypeScript computes scores, evidence, physiological/nutrition figures, and closeout facts.
- Claude may phrase supplied facts, but retrospective prose/reflections never steer deterministic generation. Acknowledgement stamps are history/workflow records only.
- Retrospective language receives one route-owned effective closeout window. Normal completion ends
  at the scheduled block end; explicit early end stops at the athlete's local closeout date. Planned
  and actual hours, block-window ride evidence, and the stored history totals use that same window.
- Empty/missing configuration degrades optional language paths; it does not prevent block generation.
- A changed language path requires one live API smoke run before completion.

Ride-intent identification is deterministic. The analysis path receives the completed intent verdict and matched evidence; it does not discover or grade intent.

## Cost tracking

Each active call fire-and-forgets `recordUsage(model, usage)`. Settings displays totals by model, input/output tokens, prompt-cache tokens when present, and estimated USD. Historical block-generation rows remain readable.

## Debugging a bad generation

Block generation is deterministic. Inspect `GeneratedPlan.raw`, `days`, `findings`, the compiler input, and [06-generation](06-generation.md); do not look for an LLM trace or prompt/cache variation.

For an optional language artifact:

1. inspect its `model` and `promptVersion`;
2. reproduce the pure prompt in `anthropic-prompts.test.ts`;
3. inspect route logs and `data/ai-usage.json`;
4. run the changed path once against the live API and read the result.

`lib/trace.ts` is a ride power chart, not an LLM trace module.

## Known rough edges

- Provider/model/cost changes remain a separate
  [fixed-input experiment](../reviews/2026-09-01-fr6-language-provider-experiment.md). The first run
  measured Sonnet and Haiku but neither cleared schema/grounding gates; OpenAI, Gemini, and Mistral
  remain explicit missing-credential arms. Complete the same sanitized matrix, cost projection, and
  blind owner review before changing a live language route.
- Historical types and cost rows retain generation-era provenance names for compatibility.

## Common modifications

| Change | Where |
|---|---|
| Ride-note prompt | `buildRideAnalysisPrompt` + its tests; bump `PROMPT_VERSION`; live smoke |
| Retrospective prompts/schema | corresponding prompt builder or `retrospective-schema.ts`; bump version; live smoke |
| New LLM call site | Update this exhaustive table, deterministic authority docs, usage accounting, tests, and live smoke evidence |
