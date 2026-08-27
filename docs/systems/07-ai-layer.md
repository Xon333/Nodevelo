# 07 · AI layer (Anthropic integration)

**Why this exists:** LLMs confabulate numbers and drift from instructions, so the model is caged: pure prompt builders (testable offline), forced structured output, deterministic validators, and resolved numbers it must copy from — the machinery that makes "AI coach" trustworthy. **Where it sits:** cross-cutting — [06-generation](06-generation.md) is its biggest client; the daily coach note and block retrospectives are the others. **Tradeoff:** prompt text and protocol numbers live in multiple hand-synced places (see scatter list at bottom).

## Every LLM call site

The complete set — exactly four remote Anthropic call categories. Adding a fifth? Follow the pattern: a pure prompt builder, a call
function in `anthropic-api.ts`, zod schema bundled with its tool if structured, usage recorded, and one
live smoke run before "done".

| # | Trigger | Call | Model | Structured? | Prompt owner | Validation |
|---|---|---|---|---|---|---|
| 1 | `POST /api/generate` | `generateTrainingBlock` | sonnet, temp 0.3, 8–16k tokens by length, cached prefix | ✅ forced `TRAINING_BLOCK_TOOL` | `buildSystemPrompt` + `buildUserMessage` | zod `PlanToolSchema` → two visible repairs → publication gate + deterministic overview warnings |
| 2 | `POST /api/analyze` (deferred from sync) | `analyseRide` | sonnet | free text | `buildRideAnalysisPrompt` | none |
| 3 | `POST /api/retrospective` | `generateRetrospective` | sonnet | free text | `buildRetrospectivePrompt` | none |
| 4 | same request, after 3 | `generateStructuredRetrospective` | sonnet | ✅ forced `RETROSPECTIVE_TOOL` | `buildStructuredRetrospectivePrompt` | zod; degrades to `[]` |

## Module layout (deliberate split)

| Module | Owns | Never contains |
|---|---|---|
| `lib/anthropic-api.ts` (212 lines) | The SDK shell: lazy client (240s timeout, 2 retries), model constant, the call functions, usage recording. Re-exports the prompt builders so callers import one module. | Prompt text |
| `lib/anthropic-config.ts` | SDK-free `isAnthropicConfigured` seam, re-exported by `anthropic-api.ts` but imported directly by deterministic routes that must remain outside the SDK graph. | SDK imports, model calls |
| `lib/anthropic-prompts.ts` (715 lines) | **All prompt assembly, pure** — no SDK, no network, fully unit-testable. System-prompt cache split, user-message rules, ride-analysis/retrospective prompts, `WORKOUT_SYNTAX_GUIDE`. | Network calls |
| `lib/tool-schema.ts` | `zodToToolInputSchema` — the ONE zod→Anthropic-tool bridge. | Schemas themselves |
| `lib/plan-schema.ts`, `lib/retrospective-schema.ts` | Each bundles its zod schema + `Tool` + parse/format helpers. There is **no central tool registry**. | |
| `lib/overview-check.ts` | Pure overview-vs-schedule consistency warnings. | LLM calls or prose rewrites |
| `lib/generate-cache.ts` | 60-second in-flight dedupe (SHA-256 of the three prompt parts, NUL-separated). Not a cache. | |
| `lib/ai-usage.ts` | Token/cost telemetry → `data/ai-usage.json` (surfaced on Settings). | |

## Models & constants (`anthropic-api.ts`)

- `GENERATION_MODEL = "claude-sonnet-4-6"` — block generation, ride analysis, prose retrospectives, structured retrospectives.
- Haiku has no live caller. Its pricing key remains in `ai-usage.ts` only so historical usage rows stay legible.
- `TEMPERATURE = 0.3` · `PROMPT_VERSION = 9` (generation/analysis artifacts).
- `generationMaxTokens(lengthWeeks)`: 8k (2/4wk) → 12k (6wk) → 16k (8wk) — fixes silent truncation of long blocks.
- ⚠️ Model IDs are string literals duplicated as keys in `ai-usage.ts`'s `PRICING` table. An unknown model records **$0 cost silently** — when bumping a model, update both files.

## Prompt caching

`buildSystemPrompt` returns `{cached, dynamic}`. Cached = persona + syntax guide + full KB text, sent with `cache_control: {type: "ephemeral"}` (5-min TTL, writes bill 1.25×, reads 0.1× — accounted in `ai-usage.ts`). Dynamic = all per-block context, after the breakpoint. `lib/system-prompt.test.ts` is the **executable contract** for this split: per-block data must never leak into the cached half. Keep it passing.

## Validation philosophy

Structural output is zod-validated; content findings are classified once by the publication gate; only two deterministic repairs mutate output (durationMin reconcile, nutrition kcal). `overview-check.ts` is deterministic and warn-only: it never calls an LLM or rewrites prose. A missing/malformed tool call is a hard 502 — no self-repair loop, by design. Details: [06-generation.md](06-generation.md).

Ride-intent identification is outside this AI layer: `POST /api/intent` parses strict labelled bullets,
matches synced Intervals.icu laps, and grades them deterministically. `POST /api/analyze` may phrase the
result, but receives its score and evidence as authoritative inputs.

## Cost tracking

Every call fire-and-forgets `recordUsage(model, usage)` → `data/ai-usage.json` (running totals + by-model: calls, input/output tokens, cache write/read tokens, estimated USD). Serialized via an in-memory promise chain (single-process assumption). Rendered server-side by `components/AiUsageCard.tsx` on Settings.

## Debugging a bad generation

There is **no LLM trace module** (`lib/trace.ts` is the ride power chart). The debugging surface is:

1. **`GeneratedPlan.raw`** — the verbatim tool-call JSON of the output (persisted; the audit trail). Compare against what the UI shows.
2. **`warnings[]` / `plan.findings`** in the API response — the validators' explanation of *why* a plan is suspect (`findings.blockers` refuse publication; preferences need an explicit override; advisories fold into `warnings`).
3. **Offline prompt reproduction** — the prompt builders are pure: construct the exact prompt in a unit test (`anthropic-prompts.test.ts` shows how), print it, inspect. This is the intended workflow; no API call needed.
4. **Provenance stamps** — `model` + `promptVersion` on every artifact keep past outputs attributable after prompt/model changes.
5. **Dedupe window** — within 60s, an identical regenerate returns the same result (`generate-cache.ts`); rule this out before suspecting the prompt.
6. Server logs: route catch blocks emit one-line JSON via `lib/log.ts` (`logError`/`logWarn`).

**Standing rule (AGENTS.md):** unit tests + green build only prove the deterministic scaffolding. Any new/changed AI path needs **one live smoke run** with the real API before it's "done".

**What a smoke run is:** run the changed feature once against the live API — `npm run dev`, trigger the relevant flow (generate a block / re-analyse today / close a block for prose and structured retrospectives), then READ the output and check `data/ai-usage.json` recorded the expected call. Those are the four live categories above; deterministic intent parsing and overview checking make no Anthropic call. A green build is not a smoke run.

## Known rough edges

- Interval-protocol numbers exist in three hand-synced places: KB prose, `buildUserMessage` hard rules, `workout-validate.PROTOCOL`. See [INVARIANTS](../INVARIANTS.md).
- Provider, model, and cost changes belong to a separate measured experiment: hold inputs and prompts constant, then compare validity, findings, usefulness, latency, and cost before changing a live route.

## Common modifications

| Change | Where |
|---|---|
| Prompts | [RECIPES § generation](../RECIPES.md#change-generation-behavior-prompt-rules-output-shape) |
| New LLM call site | Follow the four-call-site pattern above |
