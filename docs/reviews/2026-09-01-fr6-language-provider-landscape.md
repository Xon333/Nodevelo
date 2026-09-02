# FR-6 language-provider landscape

**Date:** 2026-09-01
**Status:** research input for a fixed-input experiment; not a production-switch decision

## Decision summary

NodeVelo should benchmark the current production baseline (`claude-sonnet-4-6`) and the lowest-friction
candidate (`claude-haiku-4-5`) against three provider alternatives:

1. `gpt-5.6-luna` (OpenAI),
2. `gemini-3.1-flash-lite` (Google), and
3. `mistral-small-2603` / Mistral Small 4 (Mistral).

All five can produce the two prose artifacts and the structured retrospective shape. All four cheaper
candidates have list prices that make the **$0.25 total per two-week block** target plausible by a wide
margin. That is only a cost-screening conclusion. No provider or model should replace production until
the repository's fixed corpus measures grounding, usefulness, schema validity, latency, token usage,
and actual cost.

The experiment should keep the existing prompt builders and output caps unchanged, use standard
synchronous service tiers, and run without prompt caching first. Caching is unlikely to decide this
workload: the calls are short, infrequent, and dominated by changing athlete/block facts. It can be a
second pass only if measured prompt prefixes are long and repeat often enough to hit.

## Repository fit

The current integration is unusually narrow:

- [`lib/anthropic-api.ts`](../../lib/anthropic-api.ts) owns exactly three calls: ride-analysis prose
  (`450` output-token cap), retrospective prose (`380`), and a forced structured retrospective (`700`).
- [`lib/anthropic-prompts.ts`](../../lib/anthropic-prompts.ts) already makes all prompt construction
  provider-independent and pure.
- [`lib/retrospective-schema.ts`](../../lib/retrospective-schema.ts) owns a simple Zod object containing
  an array of string-only reflection objects. The route still performs Zod validation and degrades to
  `[]` on failure.
- [`lib/ai-usage.ts`](../../lib/ai-usage.ts) assumes Anthropic's usage fields and contains a hard-coded
  pricing table. A production migration would therefore need a normalized usage record as well as a
  new client; the experiment harness can normalize usage without changing the live route.
- The repo already runs Node 22 locally. That satisfies the current OpenAI SDK's Node 22 minimum and is
  compatible with the other official JavaScript/TypeScript SDKs reviewed here.

No provider needs to compute training facts. TypeScript remains authoritative; the model only phrases
the supplied evidence. The structured call can use each provider's native JSON-schema output rather
than imitating an action-bearing tool call.

## Cost screen

Prices below are standard synchronous USD list prices per million tokens as published on 2026-09-01.
They exclude tax, negotiated discounts, regional uplifts, and any model-generated reasoning tokens.

| Provider/model | Input | Cached input | Cache write | Output | Output-only two-week ceiling* |
|---|---:|---:|---:|---:|---:|
| Anthropic Claude Sonnet 4.6 | $3.00 | $0.30 | $3.75 (5 min) | $15.00 | $0.1107 |
| Anthropic Claude Haiku 4.5 | $1.00 | $0.10 | $1.25 (5 min) | $5.00 | $0.0369 |
| OpenAI GPT-5.6 Luna | $0.20 | $0.02 | $0.25 | $1.20 | $0.0089 |
| Google Gemini 3.1 Flash-Lite | $0.25 | $0.025 + storage | no separate write price published | $1.50 | $0.0111 |
| Mistral Small 4 | $0.15 | $0.015 | no separate write price published | $0.60 | $0.0044 |

\*Conservative arithmetic for fourteen maximal ride notes plus one prose and one structured
retrospective: `14 × 450 + 380 + 700 = 7,380` output tokens. Actual blocks should normally have fewer
than fourteen ride-analysis calls and outputs need not hit their caps.

The official sources are [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[OpenAI pricing](https://developers.openai.com/api/docs/pricing),
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), and
[Mistral pricing](https://docs.mistral.ai/inference/pricing). Anthropic charges 1.25× input for a
five-minute cache write and 0.1× for a hit. OpenAI documents a 1.25× cache-write rate and 0.1× cached
input for GPT-5.6. Gemini additionally charges explicit-cache storage by token-hour. Mistral documents
cached hits at 10% of input and describes caching as opportunistic, but its public pricing surface does
not expose a distinct write charge ([Mistral caching](https://docs.mistral.ai/studio/conversations/advanced/prompt-caching)).

**Inference, not a measurement:** at the full 7,380-token output ceiling, Sonnet can accept only about
46,400 aggregate uncached input tokens before crossing $0.25. The corresponding break-even input
budgets are about 213,000 for Haiku, 1.21 million for Luna, 956,000 for Gemini 3.1 Flash-Lite, and 1.64
million for Mistral Small 4. This makes Sonnet the only candidate whose budget outcome is genuinely in
doubt for ordinary prompt sizes, but measured provider tokenization and billed reasoning/tool overhead
must replace this arithmetic in the experiment result.

## Provider evaluations

### Anthropic: Sonnet 4.6 and Haiku 4.5

**Capability and SDK.** This is the existing integration, using the official
[`@anthropic-ai/sdk`](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript). Both
models support tool use. Anthropic now also supports constrained JSON output and `strict: true` tool
schemas; strict mode guarantees schema-conformant tool inputs through constrained sampling
([structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
[strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use)). The
current NodeVelo tool definition does **not** set `strict: true`, so its existing Zod check remains
meaningful. The experiment should either preserve that exact non-strict path for a faithful baseline or
record strict mode as a separate protocol change, never silently combine it with the model comparison.

**Latency tier.** Standard is the default. Anthropic's Priority Tier is now available only to
organizations with an existing capacity commitment; it is not a practical default for this personal,
low-volume app ([service tiers](https://platform.claude.com/docs/en/api/service-tiers)). Fast mode does
not apply to Sonnet 4.6 or Haiku 4.5. Measure ordinary synchronous latency.

**Data handling.** Anthropic says commercial API inputs and outputs are deleted within 30 days under
the standard policy, with exceptions for law and usage-policy enforcement; a sales-enabled ZDR
arrangement avoids at-rest prompt/response storage after the response. Anthropic also states retained
API data is not used for model training without express permission
([API retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention),
[standard retention window](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)).

**EU posture.** The first-party Claude API supports only `global` or US-only inference; its only
workspace storage geography is currently US. It does **not** document EU-only processing
([data residency](https://platform.claude.com/docs/en/manage-claude/data-residency)). Amazon Bedrock
offers EU regional/inference-profile routes for Claude, but adopting Bedrock would add AWS credentials,
endpoint/model-ID differences, a different data processor, and a regional price premium. Treat that as
a separate hosting experiment, not as equivalent to the current first-party API.

**Migration complexity.** Sonnet → Haiku is **low**: one model value plus pricing/provenance updates,
then the live smoke run required by repository law. It is the first comparison to run and the cleanest
way to learn whether the present provider can meet the budget without new infrastructure.

### OpenAI: GPT-5.6 Luna

**Why this model.** OpenAI describes `gpt-5.6-luna` as its current cost-sensitive, high-volume tier. It
supports text generation, function calling, structured outputs, and controllable reasoning effort
([model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna)). The older GPT-5 Mini and Nano
remain documented, but their pages explicitly direct new cost-sensitive workloads toward Luna; they
should not enlarge the first experiment matrix.

**Structured output and SDK.** The official [`openai` JavaScript/TypeScript SDK](https://github.com/openai/openai-node)
has Zod helpers, and Structured Outputs guarantees conformance to the supplied JSON Schema
([Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)). This maps
directly to `RetrospectiveToolSchema` and is simpler than forcing a synthetic function call. Keep the
route's Zod parse anyway, because schema conformance does not prove coaching semantics or one-reflection-
per-intervention cardinality beyond what the schema expresses.

**Latency tier.** Standard should be the experiment default. OpenAI documents Fast mode as up to 2.5×
faster/more consistent, selected with `service_tier: "fast"`, but Luna's Fast list price is 2× its
standard token price ([Fast mode](https://developers.openai.com/api/docs/guides/fast-mode),
[pricing](https://developers.openai.com/api/docs/pricing)). Only test it if standard latency fails the
user-facing ride-note bar.

**Data handling and EU posture.** API data is not used to train OpenAI models unless the customer opts
in. Default abuse-monitoring logs may retain prompts/responses for up to 30 days; Modified Abuse
Monitoring and ZDR require approval. OpenAI documents both storage and inference processing in Europe
(EEA + Switzerland) through `eu.api.openai.com`, but it requires an approved retention control and an
additional amendment. Current pricing adds a 10% regional-processing uplift for eligible post-March
2026 models ([data controls and regional support](https://developers.openai.com/api/docs/guides/your-data),
[regional price](https://developers.openai.com/api/docs/pricing)).

**Migration complexity.** **Medium.** The prose calls are near one-for-one. The structured path changes
from Anthropic content blocks/tool inputs to OpenAI parsed JSON; stop/incomplete reasons and usage fields
also need normalization. NodeVelo must add an API-key/config surface and a second SDK dependency. The
prompt builders and Zod schema can remain unchanged.

### Google: Gemini 3.1 Flash-Lite (with 3.5 Flash-Lite as a quality fallback)

**Why these models.** Stable `gemini-3.1-flash-lite` is explicitly aimed at high-frequency lightweight
tasks, extraction, and low cost, and supports function calling, structured output, caching, Flex,
Priority, and Batch. It is cheaper than the newer `gemini-3.5-flash-lite` ($0.25/$1.50 versus
$0.30/$2.50 per million standard input/output tokens). The newer model is also stable and described as
low-latency and cost-effective, so it is a sensible second Google arm only if 3.1's prose usefulness is
weak ([3.1 model](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite),
[3.5 model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)).

**Structured output and SDK.** Google's official [`@google/genai` JavaScript SDK](https://ai.google.dev/gemini-api/docs/get-started)
accepts JSON Schema and returns JSON text; the docs demonstrate validation with Zod. Gemini supports a
subset of JSON Schema, but NodeVelo's string/object/array schema appears to fit that subset
([structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)). **Inference:** confirm
the generated schema is accepted in a dry run rather than assuming every `z.toJSONSchema` keyword is
portable.

**Latency tier.** Standard is the appropriate live-like measurement. Priority is documented for both
Flash-Lite models and costs 75–100% more for lower-latency, non-sheddable traffic. Flex is 50% cheaper
but targets roughly 1–15 minute latency and is unsuitable for an interactive ride note; it may be useful
only for offline corpus execution or a background retrospective
([Priority](https://ai.google.dev/gemini-api/docs/priority-inference),
[Flex](https://ai.google.dev/gemini-api/docs/flex-inference)).

**Data handling.** Paid Gemini Developer API prompts/responses are not used to improve Google's
products. Google logs paid prompts/responses for abuse monitoring for an officially unspecified
"limited period"; approved project-level ZDR sanitizes content and identifiable metadata before
logging. The Interactions API stores state by default, so use `store: false`; avoid explicit context
caching for a ZDR-shaped test. Implicit in-memory caching has a 24-hour TTL and is described as
ZDR-compatible ([Gemini ZDR](https://ai.google.dev/gemini-api/docs/zdr),
[terms](https://ai.google.dev/gemini-api/terms)).

**EU posture.** The Gemini Developer API is available in the EEA, UK, and Switzerland, and EEA use gets
the paid-service data terms even for unpaid quota. However, the first-party Developer API materials
reviewed here do **not** promise EU-only inference or storage. **Do not infer data residency from product
availability.** If EU processing becomes mandatory, evaluate Vertex AI regional endpoints separately;
that changes the hosting/API contract and must be verified model-by-model.

**Migration complexity.** **Medium.** Add `@google/genai`, configuration, and usage normalization.
Prose extraction is simple; structured output maps to JSON Schema plus Zod. Gemini bills generated
thinking tokens as output, so the harness must record them and use the lowest supported reasoning
setting consistent with the fixed protocol rather than comparing hidden extra compute against
non-reasoning calls.

### Mistral: Mistral Small 4

**Why it qualifies.** Mistral is an additional credible provider with a current GA generalist model,
official TypeScript SDK, native structured outputs/function calling, very low list price, and explicit
EU regional inference. Mistral Small 4 is a March 2026 GA hybrid model with a stable versioned ID and
supports Chat Completions, function calling, structured outputs, and batching
([model page](https://docs.mistral.ai/models/mistral-small-4-0-26-03)).

**Structured output and SDK.** The official ESM-only
[`@mistralai/mistralai`](https://github.com/mistralai/client-ts) SDK supports Node/TypeScript. Mistral's
`json_schema` response format guarantees JSON matching the supplied schema, while forced tool choice
`any` is available if the experiment deliberately mirrors Anthropic tool use
([API reference](https://docs.mistral.ai/api),
[structured outputs](https://docs.mistral.ai/studio/conversations/structured-output),
[function calling](https://docs.mistral.ai/studio/conversations/function-calling)). Prefer direct schema
output for the structured retrospective and retain Zod semantic validation.

**Latency tier.** Standard is the experiment default. Priority requires account setup, offers priority
queueing and a 99.5% SLA, and applies a 1.75× multiplier. It is unnecessary at NodeVelo's traffic level
unless standard latency fails ([Priority Tier](https://docs.mistral.ai/inference/priority-tier)).

**Data handling and EU posture.** Mistral says API data is not used for model training. Approved ZDR on
paid plans prevents storage/logging of supported stateless Chat Completions inputs and outputs after
generation ([privacy controls](https://docs.mistral.ai/admin/monitor-comply/privacy-data-controls),
[ZDR](https://docs.mistral.ai/admin/monitor-comply/zero-data-retention)). Its EU endpoint processes
inference in EU/EFTA data centers for a 10% uplift; operational/control-plane metadata can still be
handled outside the selected geography. Function calling is the only regional tool feature promised,
but plain structured Chat Completions should be confirmed against the EU endpoint before relying on it
([regional inference](https://docs.mistral.ai/inference/regional-inference)).

**Migration complexity.** **Medium.** Like OpenAI, prose is straightforward and the structured call can
map to JSON Schema. New work is provider config, result/finish-reason extraction, usage normalization,
and ESM dependency integration. Mistral's regional and privacy posture is stronger than Anthropic's
first-party API for an EU-hosted athlete, which makes it worth including even if Haiku meets the cost
target.

## Recommended experiment shortlist and order

Run one protocol, but stage spending and review effort:

1. **Required baseline:** Claude Sonnet 4.6 on every corpus item.
2. **Required lowest-risk candidate:** Claude Haiku 4.5 on every item.
3. **Required cross-provider candidates:** GPT-5.6 Luna, Gemini 3.1 Flash-Lite, and Mistral Small 4 on
   every item. This directly answers the user's requirement that the experiment not assume Claude is
   the only API option.
4. **Conditional quality challenger:** Gemini 3.5 Flash-Lite only if 3.1 is schema-valid and cheap but
   loses materially on prose usefulness. Do not add older GPT-5 Mini/Nano or more Mistral sizes to the
   first matrix.

For comparability:

- Send the exact strings returned by the current three prompt builders. Do not provider-tune prompts
  during the first pass.
- Preserve output caps of 450/380/700 and temperature intent where each API supports it. Record any
  unsupported sampling control as a protocol difference.
- Use native JSON-schema output for the structured retrospective, then run the same Zod parser and
  cardinality/grounding checks for all providers.
- Run standard synchronous tiers with no Batch, Flex, Priority/Fast, or explicit cache. Record
  time-to-first-token only if streaming is uniformly implemented; otherwise compare end-to-end wall
  time.
- Record input, cached input, cache-write (where exposed), visible output, reasoning output, total
  billed tokens, request count, retries, finish reason, schema result, and USD cost from the provider
  response—not character-count estimates.
- Blind-score outputs for factual grounding, coaching usefulness, specificity, tone, and truncation.
  Provider identity must not be visible to the scorer.
- Project a two-week block from the actual planned ride-day count plus one prose and one structured
  retrospective. The acceptance bar is **≤ $0.25 total** with no meaningful usefulness loss.
- Do not ship a provider switch from list-price arithmetic. A production change also needs config,
  provenance, usage pricing, failure semantics, privacy disclosure, tests, and the repository-required
  live smoke run.

## Recommendation boundary

The most likely low-risk outcome is Haiku 4.5: its maximum-output cost is already only 3.69 cents and
it requires almost no integration work. The best raw cost candidates are Mistral Small 4, GPT-5.6 Luna,
and Gemini 3.1 Flash-Lite, all with native schema output and official TypeScript support. Mistral also
has the clearest directly documented EU-processing option for a small deployment; OpenAI offers EU
processing but only with approved retention controls and an amendment.

Those are hypotheses for the corpus, not a production recommendation. If Haiku meets both usefulness
and the $0.25 block budget, the extra-provider results still provide valuable bargaining and privacy
evidence, but avoiding a second production SDK may be worth more than fractions of a cent. If none of
the candidates preserves usefulness, retire or deterministically template the weakest language call
before raising the budget: block generation and all coaching numbers already remain AI-free.
