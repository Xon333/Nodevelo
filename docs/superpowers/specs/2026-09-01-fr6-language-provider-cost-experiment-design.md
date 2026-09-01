# FR-6 remaining-language provider and cost experiment

**Date:** 2026-09-01  
**Status:** Approved design; implementation pending

## Outcome

NodeVelo measures whether its three remaining optional language calls are useful enough to keep and
cheap enough to operate. The combined projected API cost for one real two-week block must be no more
than **$0.25**, covering every ride-analysis note plus one prose retrospective and one structured
retrospective. Deterministic block generation remains a **$0 API baseline** and is not reopened.

The experiment compares the current Sonnet 4.6 baseline, Haiku 4.5, and eligible low-cost models from
other providers against one sanitized fixed corpus. It records evidence before changing a live route.
A provider may win one call category without winning the others; a language call may instead be
retired if no candidate provides value worth even its cents-level cost.

This design re-scopes the stale FR-6 generation-era file list after
[FR-5](2026-08-29-fr5-deterministic-authority-design.md) removed Anthropic from block generation. It
preserves [INVARIANT 12](../../INVARIANTS.md#generation-and-ai-output-shape): TypeScript owns every
score, prescription, closeout fact, and publication decision.

## Current boundary

Exactly three active model-call categories remain:

1. `POST /api/analyze` produces an optional post-ride coach note.
2. `POST /api/retrospective` produces optional retrospective prose.
3. The same retrospective request may produce schema-validated structured reflections.

All three phrase facts supplied by deterministic code. Failures degrade without blocking sync,
closeout, scoring, generation, or publication. `POST /api/generate` is deterministic and stays out of
FR-6.

Historical `data/ai-usage.json` cannot establish the new steady-state cost: its $7.15 total includes
the removed generation path and aggregates by model rather than call category. FR-6 therefore
measures each experiment request directly and projects a new two-week total from the active block's
eleven planned ride days plus the two closeout calls.

## Provider research and eligibility

The [primary-source provider landscape](../../reviews/2026-09-01-fr6-language-provider-landscape.md)
screens current official pricing, structured-output support, TypeScript SDKs, retention/training
terms, regional posture, and integration complexity.

The first experiment matrix contains:

- Anthropic Claude Sonnet 4.6 — current production baseline;
- Anthropic Claude Haiku 4.5 — lowest-friction candidate;
- OpenAI GPT-5.6 Luna;
- Google Gemini 3.1 Flash-Lite; and
- Mistral Small 4.

Gemini 3.5 Flash-Lite is conditional: run it only if Gemini 3.1 is valid and cheap but materially
weaker in prose. Do not enlarge the first matrix with additional model sizes.

A candidate is eligible only if it has an official Node/TypeScript client, can constrain the
structured retrospective to the existing schema, documents commercial API data handling, and is
plausible under the $0.25 budget. Availability is not treated as data residency; regional claims must
come from the provider's own documentation.

The first pass uses standard synchronous service tiers, no batch/flex/priority mode, and no explicit
prompt cache. Prompts and output caps stay unchanged. Provider-specific prompt tuning would be a
second experiment, not part of the baseline comparison.

## Fixed corpus

The committed corpus contains sanitized, synthetic inputs at the existing public prompt seams:

- **Ride analysis:** one well-executed prescribed ride, one poorly executed prescribed ride, and one
  self-directed ride with deterministic intent evidence.
- **Prose retrospective:** one normal completion and one explicit early closeout.
- **Structured retrospective:** validated, refuted, and inconclusive matured interventions.

Fixtures contain no live athlete notes, credentials, identifiers, or raw activity payloads. Expected
facts are declared independently beside each case so grounding checks do not merely repeat provider
output. The runner sends the exact strings produced by the current prompt builders.

## Experiment seam and records

One provider-neutral experiment interface accepts a call category, exact prompt, output cap, and—only
for structured reflections—the existing JSON schema. Each provider adapter returns:

- visible output and parsed structured value where applicable;
- model and provider identifiers;
- input, cached-input, cache-write, visible-output, reasoning-output, and total billed tokens when
  exposed;
- finish/stop reason, retry count, and end-to-end latency;
- schema-validation and deterministic grounding results; and
- estimated USD cost from the provider's measured usage.

This interface belongs to the experiment harness, not production. No generic multi-provider runtime
abstraction is built before a non-Anthropic candidate wins. Raw sanitized results live in persistent
experiment evidence outside tracked source; the dated review record commits the corpus identity,
scoring sheet, measured totals, projections, and decision.

## Evaluation

The first pass runs one output for every fixed case/model. Only finalists are repeated when variance
could change the decision. The entire paid experiment stops at **$2** unless the owner explicitly
extends it.

Hard gates:

- projected combined cost is at most $0.25 for eleven ride notes, one prose retrospective, and one
  structured retrospective;
- structured output validates without repair;
- no output invents dates, metrics, scores, causes, or prescriptions; and
- deterministic facts remain authoritative.

Outputs that pass the hard gates are shown without provider/model identity. The owner scores
usefulness, trust, specificity, tone, and truncation. A cheaper candidate may be slightly less polished
than Sonnet, but it cannot introduce a grounding regression or a meaningful usefulness loss. Latency
is recorded rather than pre-optimized.

## Decision rules

Decisions are independent by call category:

- **Keep or switch:** a candidate clears every hard gate and the blind usefulness review.
- **Retire:** no candidate produces value worth its projected cost for that category.
- **External provider wins:** create a separate minimal production-adapter plan covering config,
  provenance, normalized usage accounting, privacy disclosure, failure semantics, tests, and the
  required live smoke call.
- **Haiku wins:** prefer the low-complexity model change when its usefulness is comparable, even if an
  external provider is fractions of a cent cheaper.
- **No candidate clears the total budget:** retire or deterministically template the weakest optional
  call before asking to raise the budget.

FR-6 closes on a recorded keep/switch/retire decision for all three categories. List-price arithmetic
alone cannot close it.

## Safety and failure handling

- All runs use sanitized fixtures and isolated output paths; live NodeVelo stores are never read or
  written by the harness.
- Credentials come from attended environment setup and are never stored in the repository or result
  files.
- Missing credentials, rate limits, refusals, truncation, schema failures, and unsupported sampling
  controls remain explicit results. The harness does not hide them behind provider fallback.
- The experiment does not mutate production provider/model selection.
- Any later production change bumps prompt/provenance only when its structural contract changes and
  receives the repository-required live language smoke run.

## FR-9 runs alongside FR-6

The real 2026-08-31 through 2026-09-13 block is prospective-cycle candidate #1. It is tracked in the
[publication-gate evidence log](../../reviews/2026-08-24-publication-gate-evidence.md) independently of
the provider experiment. Its retention, edits, adaptations/refutations, incidents, and owner
usefulness/trust feedback are recorded through closeout. It earns completed-cycle credit only after
the real block finishes without a serious unresolved safety or integrity failure.

FR-6 fixture calls, provider outputs, and synthetic replays never count as FR-9 prospective evidence.

## Verification

The implementation plan must cover:

- pure tests for cost projection and usage normalization;
- fixture redaction/sanitization checks;
- schema and grounding checks for every structured case;
- deterministic runner behavior for missing credentials and provider errors;
- `npm run check`, link validation, and whitespace checks;
- a review record proving the $2 experiment cap and $0.25 block projection; and
- a separate live smoke only after the owner approves a production change.

## Non-goals

- No AI block generation, AI scoring, AI prescription, or AI publication authority.
- No production multi-provider framework before measured evidence selects an external provider.
- No provider-specific prompt optimization in the first comparison.
- No batch, flex, priority, or fast-tier optimization.
- No use of live athlete data in the committed corpus.
- No claim that test outputs contribute to FR-9.
- No FR-7 workout-library implementation before FR-6 closes.
