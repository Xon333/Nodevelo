# FR-6 fixed-input language-provider experiment

**Run date:** 2026-09-02

**Run head:** `5eb856d0e278f0e3cdabe941c31647372a15bf1c`

**Status:** **INCOMPLETE** — no candidate cleared the hard gates; external credentials and owner
blind scoring remain outstanding

## Decision boundary

This run does not justify a production provider/model change or retirement of any language call.
It measured the fixed corpus against the two available Anthropic models and recorded explicit
missing-credential results for the three external candidates. Both Anthropic structured responses
hit the `700`-token cap, failed schema validation without repair, and therefore made the required
two-week hard-gate cost projection unavailable. Both models also produced unsupported numeric claims
in prose outputs.

FR-6 remains open. Block generation stays deterministic at a $0 API baseline, production routes stay
on their existing model, and FR-7 remains blocked until Phase 3 closes.

## Fixed protocol

- Protocol: `fr6-fixed-input-v1`; prompt version `10`.
- Corpus SHA-256: `e1f9a30eee8aeb43a5b44f40fbfa1d875fbb23d21dad4404f48a08a84737b721`.
- Six synthetic cases: three ride analyses (`ride-prescribed-good`, `ride-prescribed-poor`,
  `ride-self-directed`), two prose retrospectives (`retro-normal`, `retro-early`), and one structured
  retrospective (`structured-mixed-verdicts`) containing validated, refuted, and inconclusive
  interventions.
- Exact production prompt builders and output caps were retained: `450` ride analysis, `380` prose
  retrospective, and `700` structured retrospective tokens.
- The projection contract is eleven ride analyses plus one prose and one structured retrospective,
  with a hard ceiling of `$0.25` per two-week block. The paid experiment cap stayed `$2.00`.
- Standard synchronous calls used no explicit prompt cache or provider-specific prompt tuning.

The corpus contains only fictional 2030 inputs. An independent scan of the result artifact found no
credential value, email address, named athlete, live activity identifier, or live location. The
persisted provenance hash matched the full fixture contract used by the runner.

## Credential boundary

| Candidate | Credential state | Requests represented |
|---|---|---:|
| Anthropic `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` available | 6 paid |
| Anthropic `claude-haiku-4-5` | `ANTHROPIC_API_KEY` available | 6 paid |
| OpenAI `gpt-5.6-luna` | `OPENAI_API_KEY` missing | 6 not requested |
| Google `gemini-3.1-flash-lite` | `GEMINI_API_KEY` missing | 6 not requested |
| Mistral `mistral-small-2603` | `MISTRAL_API_KEY` missing | 6 not requested |

The missing rows are evidence of an unexecuted arm, not zero-cost model results. No fallback hid a
missing credential.

## Measured results

| Candidate | Row status | Tokens (input / output / total) | Latency ms (min / mean / max) | Measured cost | Hard-gate result |
|---|---|---:|---:|---:|---|
| Sonnet 4.6 | 5 `ok`, 1 `schema-invalid` | 3,721 / 1,783 / 5,504 | 6,533 / 8,773 / 15,032 | `$0.037908` | Fail: non-OK result, projection unavailable, structured schema invalid, unsupported claims |
| Haiku 4.5 | 5 `ok`, 1 `schema-invalid` | 3,724 / 1,566 / 5,290 | 2,699 / 3,904 / 7,138 | `$0.011554` | Fail: non-OK result, projection unavailable, structured schema invalid, unsupported claims |
| GPT-5.6 Luna | 6 `missing-credential` | — | — | not measured | Incomplete: no requests; projection unavailable |
| Gemini 3.1 Flash-Lite | 6 `missing-credential` | — | — | not measured | Incomplete: no requests; projection unavailable |
| Mistral Small 4 | 6 `missing-credential` | — | — | not measured | Incomplete: no requests; projection unavailable |

Across the twelve paid requests, measured usage was 7,445 input tokens and 3,349 output tokens
(10,794 total), with no reported cached-input, cache-write, or reasoning tokens. The exact measured
spend was **`$0.049462`**, comfortably below the `$2.00` experiment cap. Recomputing every row from
its recorded usage and the dated per-million-token prices produced the same total with zero delta.

That `$0.049462` is experiment spend across twelve fixture requests. It is not the required
two-week cost projection. `projectTwoWeekCost` uses only successful rows in all three categories;
because neither structured row succeeded, the hard-gate projection is correctly **unavailable**.
No cost-only estimate is substituted for this missing validity evidence.

### Failure detail

- Sonnet's structured response stopped at `max_tokens` with 700 output tokens and did not validate.
- Haiku's structured response stopped at `max_tokens` with 700 output tokens and did not validate.
- Sonnet emitted unsupported numeric claims in all three ride cases and the normal retrospective:
  `85%`, `20 minutes`, `185W`, `10W`, and `3.5%`.
- Haiku emitted unsupported numeric claims in the good prescribed and self-directed ride cases:
  `85%` and `15W`.
- The early-closeout prose case produced no unsupported numeric claim for either Anthropic model.

The deterministic scanner is a hard screen, not a complete semantic-quality judgment. Its findings
are enough to fail this run; passing it later will still require blind human review.

## Blind review

`blind-review.json` is an empty array because the runner only exports outputs from a candidate that
passes every hard gate across the complete category matrix. Neither Anthropic model passed, and the
external candidates did not run. There is therefore nothing valid to score yet; the empty artifact is
not a favorable review.

When a candidate clears the automated gates, the owner reviews opaque rows without provider/model
identity and scores each from 1 (unacceptable) to 5 (excellent):

1. **Usefulness:** would this help the athlete understand or act on the supplied evidence?
2. **Trust:** does it stay within supplied facts and appropriately express uncertainty?
3. **Specificity:** is it concrete without inventing numbers, causes, or prescriptions?
4. **Tone:** is it concise, respectful, and appropriate for coaching language?

The owner separately records a **reject flag** for any invented claim or unsafe advice. Truncation is
an observation and reject condition, not a fifth score: record any abrupt or structurally incomplete
ending and reject that output.

The owner also records keep, switch, or retire by call category. A candidate cannot advance on polish
alone: schema validity, grounding, and the `$0.25` combined projection remain absolute gates.

## Evidence and next run

Persistent raw evidence is outside tracked source in the repository's common Git directory:

- `.git/sdd/fr6-language-provider-experiment/results.json` — raw sanitized outputs, usage, latency,
  status, grounding results, pricing provenance, corpus identity, and spend accounting;
- `.git/sdd/fr6-language-provider-experiment/blind-review.json` — currently `[]` because no complete
  candidate passed.

The implementation is reproducible with `npm run experiment:fr6`; the resumable v1 ledger will not
repeat completed candidate/case rows. Protocol `fr6-fixed-input-v1` can only be continued unchanged,
so its remaining work is limited to the three missing external-provider arms. Existing v1 Anthropic
failures cannot be replaced in that ledger by changing the output cap, schema, prompt, or any other
protocol input.

Any such change must create a new protocol version with a distinct evidence artifact/ledger and rerun
every required provider/case arm under that identical protocol. Results from v1 and a changed protocol
must never be mixed into one cost projection or comparison. To finish FR-6:

1. provide attended `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `MISTRAL_API_KEY` environment credentials
   and run the three missing arms without placing secrets in source or evidence;
2. if resolving the structured-cap/schema failure changes the protocol, create the new versioned
   artifact and rerun every required arm rather than only the affected Anthropic rows;
3. obtain the combined eleven-plus-two projection at or below `$0.25` with every hard gate passing;
4. have the owner score the resulting blind artifact and record keep/switch/retire for each category.

Any external winner requires a separate minimal production-adapter plan and live smoke run. This
experiment itself changes no production provider, model, provenance, route, or usage accounting.
