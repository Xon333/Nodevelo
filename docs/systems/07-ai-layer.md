# 07 · AI layer (Anthropic integration)

**Why this exists:** LLMs confabulate numbers and drift from instructions, so the model is caged: pure prompt builders (testable offline), forced structured output, deterministic validators, and one resolved-numbers bundle it must copy from — the machinery that makes "AI coach" trustworthy. **Where it sits:** cross-cutting — [06-generation](06-generation.md) is its biggest client; the daily coach note and ask-coach are the others. **Tradeoff:** prompt text and protocol numbers live in multiple hand-synced places (see scatter list at bottom).

## Every LLM call site

The complete set — exactly seven. Adding an eighth? Follow the pattern: a pure prompt builder, a call
function in `anthropic-api.ts`, zod schema bundled with its tool if structured, usage recorded, and one
live smoke run before "done".

| # | Trigger | Call | Model | Structured? | Prompt owner | Validation |
|---|---|---|---|---|---|---|
| 1 | `POST /api/generate` | `generateTrainingBlock` | sonnet, temp 0.3, 8–16k tokens by length, cached prefix | ✅ forced `TRAINING_BLOCK_TOOL` | `buildSystemPrompt` + `buildUserMessage` | zod `PlanToolSchema` → repairs → 7 warn-only validators |
| 2 | same request, after 1 | `critiqueOverview` | haiku | ✅ forced `NARRATIVE_CRITIC_TOOL` | `narrative-critic.ts` | zod; best-effort, overview-only |
| 3 | `POST /api/analyze` (deferred from sync) | `analyseRide` | sonnet | free text | `buildRideAnalysisPrompt` | none |
| 4 | `POST /api/retrospective` | `generateRetrospective` | sonnet | free text | `buildRetrospectivePrompt` | none |
| 5 | same request, after 4 | `generateStructuredRetrospective` | sonnet | ✅ forced `RETROSPECTIVE_TOOL` | `buildStructuredRetrospectivePrompt` | zod; degrades to `[]` |
| 6 | `POST /api/ask` | `streamAskCoach` | haiku, **streamed** | free text | `buildAskCoachPrompt` (no `system` param; excludes the ledger, <1200 chars) | none |
| 7 | `POST /api/intent` (deferred from sync) | `parseRideIntent` | sonnet, 900 tokens | ✅ forced `INTENT_TOOL` | `buildIntentPrompt`, independently versioned by `INTENT_PROMPT_VERSION` | zod `IntentToolSchema`; empty note skips the call, transient throws write nothing/retry next sync, completed unusable output records `interpreter-failed`, deterministic grounding/scoring may downgrade |

## Module layout (deliberate split)

| Module | Owns | Never contains |
|---|---|---|
| `lib/anthropic-api.ts` (265 lines) | The SDK shell: lazy client (240s timeout, 2 retries), model constants, the call functions, usage recording. Re-exports the prompt builders so callers import one module. | Prompt text |
| `lib/anthropic-config.ts` | SDK-free `isAnthropicConfigured` seam, re-exported by `anthropic-api.ts` but imported directly by deterministic routes that must remain outside the SDK graph. | SDK imports, model calls |
| `lib/anthropic-prompts.ts` (691 lines) | **All prompt assembly, pure** — no SDK, no network, fully unit-testable. System-prompt cache split, user-message rules, ride-analysis/retrospective/ask-coach prompts, `WORKOUT_SYNTAX_GUIDE`. | Network calls |
| `lib/tool-schema.ts` | `zodToToolInputSchema` — the ONE zod→Anthropic-tool bridge. | Schemas themselves |
| `lib/plan-schema.ts`, `lib/retrospective-schema.ts`, `lib/narrative-critic.ts`, `lib/intent-schema.ts` | Each bundles its zod schema + `Tool` + parse/format helpers. There is **no central tool registry**. | |
| `lib/intent-prompt.ts` | The isolated ride-intent prompt and `INTENT_PROMPT_VERSION`; note + ride duration only. | Ride metrics, FTP, scores |
| `lib/generate-cache.ts` | 60-second in-flight dedupe (SHA-256 of the three prompt parts, NUL-separated). Not a cache. | |
| `lib/ai-usage.ts` | Token/cost telemetry → `data/ai-usage.json` (surfaced on Settings). | |

## Models & constants (`anthropic-api.ts`)

- `GENERATION_MODEL = "claude-sonnet-4-6"` — block generation, ride analysis, retrospectives.
- `QUICK_MODEL = "claude-haiku-4-5"` — ask-coach (streamed), narrative critic.
- `TEMPERATURE = 0.3` · `PROMPT_VERSION = 7` (generation/analysis artifacts) · `INTENT_PROMPT_VERSION = 1` (ride-intent artifacts; independently versioned).
- `generationMaxTokens(lengthWeeks)`: 8k (2/4wk) → 12k (6wk) → 16k (8wk) — fixes silent truncation of long blocks.
- ⚠️ Model IDs are string literals duplicated as keys in `ai-usage.ts`'s `PRICING` table. An unknown model records **$0 cost silently** — when bumping a model, update both files.

## Prompt caching

`buildSystemPrompt` returns `{cached, dynamic}`. Cached = persona + syntax guide + full KB text, sent with `cache_control: {type: "ephemeral"}` (5-min TTL, writes bill 1.25×, reads 0.1× — accounted in `ai-usage.ts`). Dynamic = all per-block context, after the breakpoint. `lib/system-prompt.test.ts` is the **executable contract** for this split: per-block data must never leak into the cached half. Keep it passing.

## Validation philosophy

Structural output is zod-validated; content is checked by warn-only validators; only two deterministic repairs mutate output (durationMin reconcile, nutrition kcal). A missing/malformed tool call is a hard 502 — no self-repair loop, by design. Details: [06-generation.md](06-generation.md).

## Cost tracking

Every call fire-and-forgets `recordUsage(model, usage)` → `data/ai-usage.json` (running totals + by-model: calls, input/output tokens, cache write/read tokens, estimated USD). Serialized via an in-memory promise chain (single-process assumption). Rendered server-side by `components/AiUsageCard.tsx` on Settings.

## Debugging a bad generation

There is **no LLM trace module** (`lib/trace.ts` is the ride power chart). The debugging surface is:

1. **`GeneratedPlan.raw`** — the verbatim tool-call JSON of the output (persisted; the audit trail). Compare against what the UI shows.
2. **`warnings[]` / `protocolViolations[]`** in the API response — the validators' explanation of *why* a plan is suspect.
3. **Offline prompt reproduction** — the prompt builders are pure: construct the exact prompt in a unit test (`anthropic-prompts.test.ts` shows how), print it, inspect. This is the intended workflow; no API call needed.
4. **Provenance stamps** — `model` + `promptVersion` on every artifact keep past outputs attributable after prompt/model changes.
5. **Dedupe window** — within 60s, an identical regenerate returns the same result (`generate-cache.ts`); rule this out before suspecting the prompt.
6. Server logs: route catch blocks emit one-line JSON via `lib/log.ts` (`logError`/`logWarn`).

**Standing rule (AGENTS.md):** unit tests + green build only prove the deterministic scaffolding. Any new/changed AI path needs **one live smoke run** with the real API before it's "done".

**What a smoke run is:** run the feature once against the live API — `npm run dev`, trigger the actual flow (generate a block / re-analyse today / ask the coach), then READ the output and check `data/ai-usage.json` recorded the call. A green build is not a smoke run.

## Known rough edges

- Interval-protocol numbers exist in three hand-synced places: KB prose, `buildUserMessage` hard rules, `workout-validate.PROTOCOL`. See [INVARIANTS](../INVARIANTS.md).
- Ask-coach sends no `system` param at all (persona lives in its user message) — inconsistent with other call sites but intentional-ish; know it before "fixing" it.
- `ask-coach.test.ts` / `system-prompt.test.ts` test code that lives in `anthropic-prompts.ts` — there are no modules by those names.

## Common modifications

| Change | Where |
|---|---|
| Prompts | [RECIPES § generation](../RECIPES.md#change-generation-behavior-prompt-rules-output-shape) |
| New LLM call site | Follow the six-call-site pattern above |
