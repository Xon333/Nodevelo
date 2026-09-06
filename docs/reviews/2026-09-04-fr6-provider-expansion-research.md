# FR-6 provider expansion research

**Date:** 2026-09-04
**Audience:** NodeVelo FR-6 decision and experiment owners
**Question:** Which current Gemini, OpenAI, Meta Muse, Z.AI, and DeepSeek API arms are worth adding to
the fixed-input language experiment while keeping the target near cents per two-week block?

## Executive answer

Add DeepSeek V4 Flash and Z.AI GLM-5.3-Flash to the research shortlist, alongside the existing
Gemini 3.1 Flash-Lite and OpenAI GPT-5.6 Luna arms. Keep the current experiment's fixed corpus,
output caps, grounding scanner, Zod validation, and `$0.25` block gate unchanged. DeepSeek is very
cheap but its documented structured output is JSON mode/schema output rather than a provider guarantee
equivalent to strict JSON Schema. Z.AI is also cheap and documents structured output, but its API
privacy/processing posture needs a separate EU review.

Do not add Meta Muse Spark 1.3 to the executable matrix yet. Meta officially describes Muse Spark 1.3
and Meta Model API availability, but the model identifier, public API request/response contract,
pricing, rate limits, and residency terms could not be verified from the developer endpoint during this
research. Treat it as a gated follow-up, not a guessed adapter.

OpenAI GPT-5.4 Mini is a current alternative to Luna with structured outputs and clear API support,
but its `$0.75/M` input and `$4.50/M` output pricing is materially less attractive for this workload.
Gemini 3.1 Flash-Lite remains the most attractive Google comparison; newer Gemini 3.7/3.8 Flash
models are more expensive and should not displace the low-cost arm without a quality reason.

No API credentials for these five providers were available in the FR-6 environment on this date, so
this is a source-backed screening report, not a live quality comparison.

## Fixed-input cost screen

The estimates below use the existing FR-6 protocol's measured Anthropic prompt shape as a rough input
proxy (about 8,589 input tokens for eleven ride calls plus one prose and one structured retrospective)
and the protocol's maximum 7,380 output tokens. They are directional ceilings, not provider bills;
reasoning tokens, tokenizer differences, cache state, regional uplifts, and failed calls can change the
result.

| Provider / model | Standard input / output per 1M | Directional max block cost | Structured-output posture | Recommendation |
|---|---:|---:|---|---|
| Gemini 3.1 Flash-Lite | `$0.25 / $1.50` | about `$0.013` | JSON Schema subset; adapter compatibility check required | Add; current Google low-cost arm |
| Gemini 3.7 Flash | `$0.75 / $3.75` promotional through 2026-12-31 | about `$0.034` | Structured outputs documented | Optional quality arm, not first |
| OpenAI GPT-5.6 Luna | `$0.20 / $1.20` | about `$0.009` | Strict Responses `json_schema` | Keep existing arm |
| OpenAI GPT-5.4 Mini | `$0.75 / $4.50` | about `$0.040` | Strict Responses `json_schema` | Optional comparison |
| Z.AI GLM-5.3-Flash | `$0.075 / $0.25` promotional through 2026-09-09 | about `$0.0025` | Structured output/function calling documented | Add first; recheck promo expiry |
| Z.AI GLM-4.7-FlashX | `$0.07 / $0.40` | about `$0.0035` | Structured output/function calling documented | Add; verify EU/privacy and schema behavior |
| DeepSeek V4 Flash | `$0.22 / $0.66` cache-miss off-peak | about `$0.0068` | JSON Schema response format documented; validate strictness in adapter | Add; pin off-peak/standard policy |
| Meta Muse Spark 1.3 | Not published/verified | Not computable | Not verified from developer API | Research-only gate |

The estimates use `8,589 × input price + 7,380 × output price`, divided by one million. DeepSeek's
peak prices can be 2× its off-peak table, so its experiment arm must record the UTC billing window.
Gemini output prices include thinking tokens where the pricing page says so. OpenAI reasoning effort
should remain `none` for the cost baseline.

## Provider findings

### Google Gemini

Google's current model catalog lists stable `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`,
`gemini-3.6-flash`, `gemini-3.7-flash`, and newer models. The catalog describes 3.1 Flash-Lite as a
cost-efficient high-volume model. The current pricing page lists 3.1 Flash-Lite at `$0.25/M` input
and `$1.50/M` output, while 3.7 Flash has a temporary `$0.75/M` and `$3.75/M` price through the end
of 2026. Output pricing includes thinking tokens. [Gemini model catalog](https://ai.google.dev/gemini-api/docs/models)
and [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).

Gemini structured output accepts a documented JSON Schema subset and uses `responseMimeType:
"application/json"` plus `responseJsonSchema`/`responseSchema`. The subset must be checked against
NodeVelo's generated schema before treating a valid response as comparable. The official JavaScript
SDK is `@google/genai`; the REST `generateContent` path remains suitable for an isolated adapter.
[Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output) and [Gemini
JavaScript quickstart](https://ai.google.dev/gemini-api/docs/generate-content/get-started).

Paid Gemini API content is not used to improve Google's products, but abuse-monitoring retention and
EU-only processing are not equivalent to a blanket EU residency guarantee. Use sanitized fixtures and
obtain privacy confirmation before production. [Gemini zero-data-retention guidance](https://ai.google.dev/gemini-api/docs/zdr)
and [Gemini terms](https://ai.google.dev/gemini-api/terms).

### OpenAI

OpenAI's current model page positions GPT-5.6 Luna for cost-sensitive, high-volume workloads at
`$0.20/M` input and `$1.20/M` output, with Responses, structured outputs, function calling, and
`reasoning.effort` including `none`. GPT-5.4 Mini is a current alternative at `$0.75/M` input and
`$4.50/M` output. [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
[GPT-5.4 Mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini), and [OpenAI model
guidance](https://developers.openai.com/api/docs/guides/latest-model).

The Responses API uses `text.format` with strict `json_schema`; usage exposes input, cached, output,
and reasoning details. OpenAI documents `eu.api.openai.com` regional processing for supported services,
with retention controls/eligibility requirements. [Responses create reference](https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create)
and [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

### Meta Muse Spark 1.3

Meta's September 2026 announcement calls the model **Muse Spark 1.3** and says it is rolling out through
Muse Code and the Meta Model API. Meta's public product page describes Meta Model API as a preview and
highlights Muse Spark 1.3. However, the developer API page returned a rate-limit response during this
research, and no first-party source exposed a stable model ID, token pricing, structured-output
contract, rate limits, or residency terms that can be safely copied into NodeVelo. [Meta Muse Spark 1.3
announcement](https://research.meta.ai/blog/introducing-muse-spark-1-3), [Meta Muse product/API page](https://ai.meta.com/llama?via=aivyx),
and [Meta's earlier API-preview announcement](https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/).

This is an access/documentation gap, not evidence that the model is unsuitable. Do not invent a
`muse-spark-1.3` slug or pricing; revisit when Meta provides an authenticated developer contract.

### Z.AI / GLM

Z.AI's general API is an OpenAI-compatible chat-completions endpoint at
`https://api.z.ai/api/paas/v4/chat/completions` with Bearer API-key authentication. Current pricing
lists GLM-5.3-Flash at a temporary `$0.075/M` input and `$0.25/M` output rate through 2026-09-09
(UTC+8), with GLM-4.7-FlashX at `$0.07/M` and `$0.40/M` as a stable low-cost comparison. GLM-5.3,
GLM-5.2, GLM-5.1, and GLM-5 are materially more expensive. Structured output and function calling
are documented. [Z.AI
pricing](https://docs.z.ai/guides/overview/pricing), [HTTP API guide](https://docs.z.ai/guides/develop/http/introduction),
and [structured output](https://docs.z.ai/guides/capabilities/struct-output).

The Coding Plan endpoint is distinct and its quota is not licensed for a general application API
without a written agreement. Z.AI's API privacy materials describe processor handling and Singapore
processing; no EU-only guarantee or latency/SLA commitment was found. Use the general API endpoint,
not Coding Plan credentials, and keep EU/privacy approval as a gate. [Z.AI subscription terms](https://docs.z.ai/legal-agreement/subscription-terms)
and [privacy policy](https://docs.z.ai/legal-agreement/privacy-policy).

### DeepSeek

DeepSeek's current model/pricing page lists `deepseek-v4-flash` and `deepseek-v4-pro`; legacy
`deepseek-chat` and `deepseek-reasoner` names are scheduled for deprecation. V4 Flash is priced at
`$0.22/M` cache-miss input and `$0.66/M` output off-peak, with higher peak rates. The API is
OpenAI-compatible at `https://api.deepseek.com` and also exposes an Anthropic-compatible base URL.
[DeepSeek models and pricing](https://api-docs.deepseek.com/quick_start/pricing) and [first API call](https://api-docs.deepseek.com/).

DeepSeek documents JSON mode and a `json_schema` response format, plus tool calling. The fixed
experiment must still validate the returned JSON with NodeVelo's Zod schema, because provider-documented
JSON syntax/schema behavior is not the same as semantic grounding or the repository's hard gate.
[DeepSeek chat reference](https://api-docs.deepseek.com/api/create-chat-completion/), [DeepSeek
Responses reference](https://api-docs.deepseek.com/api/create-response/), and [DeepSeek rate limits](https://api-docs.deepseek.com/quick_start/rate_limit/).

DeepSeek's public material reviewed here did not establish an EU-only processing or retention
commitment. Use sanitized fixtures and treat privacy/residency as unresolved. Peak windows and model
version must be persisted with any measured result.

## Decision and next actions

1. Keep the already-built Anthropic, OpenAI Luna, and Gemini 3.1 Flash-Lite adapter shapes as a
   baseline, but refresh the OpenAI/Gemini model/pricing provenance before the next run.
2. Add Z.AI GLM-5.3-Flash (promo, if still active) or GLM-4.7-FlashX and DeepSeek V4 Flash only in a new, explicitly versioned experiment
   protocol after adapter tests cover exact usage, refusal, timeout, JSON/schema, and billing-window
   behavior.
3. Keep Meta Muse Spark 1.3 research-only until an authenticated first-party developer contract
   provides model ID, pricing, schema output, rate limits, and data terms.
4. Never mix these newer arms into the current `fr6-fixed-input-v1` ledger. A new protocol version
   must rerun every required arm under identical caps, prompts, grounding rules, and scoring.
5. Preserve the existing `$0.25` block gate and require external credentials plus owner blind scoring
   before any production recommendation.

## Evidence limits and search stop

All substantive claims above use first-party provider/API documentation or provider announcements
accessed 2026-09-04. No provider account was available for authenticated smoke calls, and Meta's
developer page was rate-limited, so exact Meta API mechanics remain unverified. We stopped after the
official model, pricing, structured-output, data-control, and access pages converged; further search
would not remove the credential and Meta-access gaps without authenticated access.
