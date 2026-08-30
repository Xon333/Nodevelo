# 06 · Generation — how a training block comes to exist

**Why this exists:** resolved athlete, season, physiology, nutrition, and settings facts become a complete training-block proposal. TypeScript owns the schedule, progression, workout syntax, and publication eligibility; no model participates. **Where it sits:** the pipeline's last computational stage; accepted output becomes calendar events and later feeds [02-scoring](02-scoring-and-learning.md). Companion docs: [05-season.md](05-season.md) and [07-ai-layer.md](07-ai-layer.md).

The daily loop is **sync → generate preview → review findings → accept (write) → ride**.

## The two-phase commit

Generation remains a proposal; nothing reaches Intervals.icu until the athlete accepts it.

- `POST /api/generate` resolves facts, calls the pure compiler, returns `GeneratedPlan`, and persists only the best-effort CAS-guarded season re-plan plus the latest publication verdict.
- `POST /api/write` matches the submitted plan to that persisted verdict, refuses blockers and unknown/tampered plans, requires explicit acknowledgement for preferences, then writes idempotent `nodevelo-<date>` events and local block state.

All refusal paths precede calendar mutation. See [ADR-0015](../DECISIONS.md#adr-0015--the-publication-gate-persists-the-verdict-at-generation-time-and-write-matches-it).

## Pipeline walkthrough (`app/api/generate/route.ts`)

```text
resolved facts -> week targets -> block skeleton -> compileTrainingBlock
               -> typed prescription -> canonical render/parse equality
               -> publication gate -> preview -> explicit /api/write
```

`POST /api/generate` does not import the Anthropic SDK, prompt builders, a tool schema, or AI configuration. Its inputs are ordinary stored/synced facts; its output is stable for identical inputs.

### Resolved facts and composition

| Step | Module | Authority |
|---|---|---|
| Focus | `season-signals.ts`, `season.ts` | Focus family and event/recovery placement |
| Week targets | `block-skeleton.computeWeekTargets` | Loading target and recovery retention |
| Day slots | `block-skeleton.computeBlockSkeleton` | Every date, slot kind, type constraints, duration envelope, ceiling |
| Durability | `durability.selectDurabilityTemplate` | Long-ride template A–E |
| Requirements | `session-requirements.deriveSessionRequirements` | Required RaceSim or other deterministic floors |
| Nutrition | `nutrition.ts` | Per-day carbohydrate and energy values |
| Composition | `block-compiler.compileTrainingBlock` | Type assignment, stage progression, templates, canonical workout text, overview, gate call |

`targetWeeklyHours` is the intended loading-week load. `maxAvailableHours` is only the hard ceiling, and settings reject a target above it. Recovery weeks retain the configured fraction/range without exceeding availability.

#### The week skeleton (composition authority)

`computeBlockSkeleton` emits seven `DaySlot`s per week. Each carries a kind, allowed types, `minMin ≤ nominalMin ≤ maxMin`, optional intensity ceiling, and reason. Its property sweep guarantees every week's nominal minutes exactly equal its target and every envelope is ordered.

Event slots stay protected. Locked types never move. Flexible quality slots are assigned jointly so freshness-dependent SIT/VO2max work precedes fatigue-tolerant Threshold/RaceSim work where the allowed-type constraints permit it.

### Deterministic workout catalogue and progression

`lib/workout-templates.ts` owns Rest, Strength, Recovery, Z2, Threshold, VO2max, SIT, RaceSim, and durability A–E protocols. `lib/block-compiler.ts` chooses the stage from deterministic loading/recovery progression, fills the slot's exact nominal duration, and fails closed when no legal recipe fits.

Every generated cycling workout has exactly one structured target family:

- Threshold, VO2max, SIT, RaceSim, and durability B–E are power-led.
- Pure Z2, Recovery, and durability A may be heart-rate-led when current HR physiology exists.
- A power-led workout may include a resolved bpm HR ceiling as cue text; that cue is not a second structured target.
- Cadence targets are never generated. The parser tolerates legacy cadence tokens only for stored-history compatibility.

Progression increases work duration or repetitions before intensity and stays inside the protocol bands.

### Canonical Intervals.icu syntax

`lib/prescription.ts` owns typed semantics, canonical rendering, parsing, and semantic equality. A cycling workout must pass:

```text
typed prescription -> render -> parse -> semantic equality
```

before the publication gate can see it. Supported output includes `%FTP` points/ranges, standard power/HR zones, `% HR`, `% LTHR`, repeats, cues, `intensity=<role>`, power ramps, and eligible `Press lap` endings.

Ramps are limited to warmup/cooldown progression; main work never ramps. `Press lap` defaults off and is allowed only when `lapButtonSteps` is enabled for outdoor positioning/readiness or easy recovery transitions. It is never emitted for the owner's Wahoo default or prescribed SIT/VO2max/Threshold work. Absolute watts, custom zones, pace, distance, freeride, timed prompts, nested repeats, and presentation markup are outside the generated subset.

## The publication gate

`evaluatePublicationGate` runs once per compiled plan and returns blockers, preferences, and advisories. Severity belongs to the emitter, never message-string parsing.

- Blockers refuse publication with no override.
- Preferences require explicit informed acknowledgement, persisted on the current block.
- Advisories remain informational preview warnings.

The verdict is persisted at generation time under `verdictHash(days, blockParams)`. `/api/write` matches that passport rather than recomputing against drifted state. A missing or corrupt passport fails closed.

Core gate owners remain `workout-validate.ts`, `schedule-validate.ts`, `block-skeleton.ts`, `session-requirements.ts`, season validation, and structural checks in `publication-gate.ts`. One fact has one warning owner: skeleton conformance owns day-slot facts, week-hours validation owns totals, and recovery density owns recovery composition.

## Known rough edges

- Event duration comes from the displaced slot because the event model has no authoritative duration field.
- Canonical weekday placement is deliberately fixed; three or more quality sessions can make adjacency unavoidable and therefore a preference rather than a blocker.
- Event-date exclusion in `schedule-validate.ts` is still priority-blind: any event date is excluded from its quality/recovery/taper counts.
- Owner-attended Intervals.icu and Wahoo acceptance remains an evidence task, tracked in [ROADMAP FR-5](../../ROADMAP.md#fr-5--owner-attended-deterministic-generation-acceptance--ready).

## Provenance & regeneration semantics

New deterministic plans omit `model` and `promptVersion`; those optional fields remain readable on historical plans and genuine AI artifacts. `raw` is canonical compiler JSON, not provider output. Identical facts produce identical `raw`, days, weekly sums, and findings; there is no generation cache or model variation.

## Common modifications

| Change | Where | Then |
|---|---|---|
| Workout syntax | `lib/prescription.ts` | Preserve typed render/parse semantic equality and legacy parsing |
| Workout protocols | `lib/workout-templates.ts`, `lib/workout-validate.ts` | Keep catalogue output inside validator bands |
| Composition/progression | `lib/block-compiler.ts` | Preserve every date, exact slot duration, freshness ordering, and one gate call |
| Week-hour or slot logic | `lib/block-skeleton.ts` | Keep exact-sum and envelope property sweeps green |
| Validator severity | `lib/publication-gate.ts` | Classify by emitter; do not parse messages |
