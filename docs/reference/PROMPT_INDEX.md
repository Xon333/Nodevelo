# Prompt index — every LLM call site

The complete set. If you're adding a seventh, follow the pattern: prompt builder in `anthropic-prompts.ts` (pure), call function in `anthropic-api.ts`, zod schema bundled with its tool if structured, usage recorded, one live smoke run before "done".

| # | Trigger | Call (in `anthropic-api.ts`) | Model | Structured? | Prompt owner | Validation |
|---|---|---|---|---|---|---|
| 1 | `POST /api/generate` | `generateTrainingBlock` | sonnet, temp 0.3, 8–16k tokens by length, cached system prefix | ✅ forced `TRAINING_BLOCK_TOOL` | `buildSystemPrompt` + `buildUserMessage` | zod `PlanToolSchema` → repairs → 7 warn-only validators ([pipeline](../systems/generation-pipeline.md)) |
| 2 | same request, after 1 | `critiqueOverview` (narrative critic) | haiku | ✅ forced `NARRATIVE_CRITIC_TOOL` | `narrative-critic.buildNarrativeCriticPrompt` | zod; best-effort, never throws, overview-only |
| 3 | `POST /api/analyze` (deferred from sync) | `analyseRide` via `sync-analysis.addCoachNote` | sonnet | free text | `buildRideAnalysisPrompt` | none |
| 4 | `POST /api/retrospective` | `generateRetrospective` | sonnet | free text | `buildRetrospectivePrompt` | none |
| 5 | same request, after 4 | `generateStructuredRetrospective` | sonnet | ✅ forced `RETROSPECTIVE_TOOL` | `buildStructuredRetrospectivePrompt` | zod; degrades to `[]` on failure |
| 6 | `POST /api/ask` | `streamAskCoach` | haiku, **streamed** | free text | `buildAskCoachPrompt` (no `system` param; deliberately excludes the ledger, <1200 chars context) | none |

## Ground rules encoded in this layer

- **The model never computes numbers.** Every figure in a prompt comes from `coach-snapshot.ts`, the nutrition reference table, zones from the physiology store, etc. The model copies/arranges/phrases.
- **Prompt text lives only in `anthropic-prompts.ts` + the three schema/critic modules.** Routes never build prompt strings.
- **Tool schemas**: complete registry = `plan-schema.ts`, `retrospective-schema.ts`, `narrative-critic.ts`, all through `tool-schema.zodToToolInputSchema`.
- **`PROMPT_VERSION`** (currently 4) is stamped on every artifact; bump it when prompt structure changes.
- **Cache discipline**: per-block data must never enter the cached system-prompt half (`system-prompt.test.ts` enforces this).
- **The three-copy trap**: interval-protocol numbers (SIT/VO2max/Threshold bands) exist in KB prose, `buildUserMessage` hard rules, and `workout-validate.PROTOCOL`. Edit all three together.
- **Live smoke rule** (AGENTS.md): a changed AI path isn't done until one real API run's output has been read.
