# FR-5 deterministic authority design

**Date:** 2026-08-29  
**Status:** Proposed — awaiting owner approval

## Outcome

NodeVelo compiles a complete, publishable training block without Anthropic. Deterministic code owns
day composition, load targets, progression, workout protocol selection, Intervals.icu syntax, and
publication eligibility. The athlete still previews and explicitly publishes the result.

Anthropic remains only where language earns its cost: an optional ride-analysis note and optional
retrospective interpretation. Neither may change a score, prescription, publication verdict, or
future plan.

This design implements [ROADMAP FR-5](../../../ROADMAP.md#fr-5--deterministic-authority-audit-and-replacement-plan--ready-next-action)
and preserves the contracts in [INVARIANTS](../../INVARIANTS.md).

## Settled scope

- Generate every work and rest day. There is no optional-extra-day concept.
- Treat intended weekly load and available time as different inputs.
- Emit cycling-power workouts only, using a narrow typed prescription and canonical Intervals text.
- Generate no workout, week, or block explanation with AI.
- Generate one deterministic title, for example `4-week Threshold Build`.
- Keep Intervals' graph, calculated duration/load, and projected fitness views as external inspection
  surfaces; do not reproduce them.
- Keep public plans, workout folders, automatic promotion, events without a real A-event, sharing,
  and multi-athlete controls outside FR-5.

## Authority audit

| Anthropic call category | Authority class | FR-5 disposition |
|---|---|---|
| Block generation | Deterministic fact/process plus constrained composition | Remove the call. A deterministic compiler produces the entire plan. |
| Ride-analysis coach note | Optional explanation | Retain best-effort. It phrases the already-authoritative score and evidence and never gates sync. |
| Prose retrospective | Optional explanation | Retain best-effort after deterministic closeout. It is display-only. |
| Structured retrospective | Free-form interpretation | Retain as an explicitly untrusted hypothesis record. It cannot feed generation, even after approval, until a separate typed deterministic adoption rule exists. |

The existing deterministic closeout facts and seeds remain available for the athlete to inspect.
Free-form seeds, reflections, quirks, and knowledge-base prose stop entering block composition. FR-5
does not add a parser that converts prose back into authority.

## Approaches considered

1. **Compile a typed plan, then serialize it — selected.** One semantic prescription drives text,
   validation, duration, and execution matching. This removes model authority and makes invalid output
   an ordinary code defect with a reproducible input.
2. Extend the current string templates directly. This is a smaller initial diff, but ranges, ramps,
   cadence, cues, and repeat order would remain implicit in text and require parallel parsing rules.
3. Let Anthropic choose template parameters while code renders them. This constrains syntax but leaves
   progression and protocol composition probabilistic, so it does not meet FR-5.

## Deep module and seam

The new deep module is the deterministic block compiler. Its external interface is one pure call:

```ts
compileTrainingBlock(input: DeterministicBlockInput): DeterministicBlockResult
```

The input contains only already-resolved facts: block parameters, week skeleton, selected focus,
selected durability template, session requirements, block settings, and deterministic nutrition
values. It does not accept prompt text, an Anthropic client, or raw knowledge-base prose.

The result contains the existing `GeneratedPlan` shape plus the typed prescriptions used to render
its ride days. The route remains responsible for reads, physiology freshness, season persistence,
the persisted publication verdict, and HTTP errors. The compiler remains pure and is the interface
used by tests.

This seam concentrates composition and progression without wrapping existing pure selectors.
`chooseNextFocus`, `selectDurabilityTemplate`, `computeWeekTargets`, `computeBlockSkeleton`, nutrition
calculation, and the publication gate remain their own authorities and are called rather than copied.

## Typed cycling prescription

`lib/prescription.ts` owns the single semantic type and its renderer/parser round trip:

```ts
interface CyclingPrescription {
  sections: PrescriptionSection[];
}

interface PrescriptionSection {
  name: "Warmup" | "Main Set" | "Cooldown";
  repeats: number;
  steps: PrescriptionStep[];
}

interface PrescriptionStep {
  cue?: string;
  durationSec: number;
  power:
    | { kind: "steady"; minPctFtp: number; maxPctFtp: number }
    | { kind: "ramp"; fromPctFtp: number; toPctFtp: number };
  cadenceRpm?: { min: number; max: number };
}
```

`repeats` is at least one; nested repeats do not exist. A point target is represented by equal min
and max values. The model deliberately excludes fixed watts, zones, heart rate, pace, distance,
MMP, freeride, lap-button endings, timed prompts, device display settings, and decoration.

The canonical renderer emits:

```text
Warmup
- 10m ramp 50%-75% 90rpm

Main Set 5x
- Work 3m 115%-120% 100rpm
- Recovery 2m 50% 85rpm

Cooldown
- 8m ramp 50%-40% 80rpm
```

It uses `h`, `m`, and `s`, includes the final unit in combined durations, emits lowercase `ramp`,
uses `%FTP` points/ranges only, and places one blank line around sections. The parser continues to
accept legacy duration spellings already stored by NodeVelo.

For every newly generated ride, this invariant must pass before publication:

```text
typed prescription -> render -> parse -> semantic equality
```

Semantic equality covers total duration, expanded step order, repeat count, power endpoints, ramp
direction, cadence endpoints, and cues. `walkWorkoutSteps`, `parsePrescription`, and
`totalPrescribedMinutes` are extended rather than replaced. Existing callers keep their current
work-only or duration-only views over the richer parsed result.

`PlannedDay.workoutText` remains the persisted/calendar representation, avoiding a data migration.
The typed value is the build-time authority, and parsing the stored text reconstructs its semantics.

## Deterministic composition

The compiler follows this order:

1. Validate settings and physiology before composition.
2. Resolve `targetWeeklyHours`, recovery targets, focus, durability template, session requirements,
   events, and athlete state using existing deterministic modules.
3. Compute the week targets and exact day-slot skeleton.
4. Choose one workout type per slot with stable rules.
5. Select the protocol stage from the loading-week ordinal and compile a typed prescription.
6. Render, parse, and compare every cycling prescription.
7. Build deterministic names, week labels, nutrition text, and the block title.
8. Run the existing publication gate once and persist its verdict.

### Slot rules

- Rest slots produce explicit rest days.
- Event slots remain `RaceSim` and preserve the existing event protections.
- Long-ride slots produce `Z2`; recovery-week long rides always use unbroken Z2.
- Easy slots use Z2 in loading weeks and Recovery in recovery weeks.
- The first loading-week quality slot uses the focus type when the skeleton locks one; otherwise it
  uses Threshold.
- A required RaceSim occupies the first flexible quality slot in the block unless an event already
  satisfies it.
- Other flexible quality slots use the first compatible complement in the stable order Threshold,
  VO2max, SIT, excluding that week's primary type.
- Freshness-dependent work (SIT or VO2max) is placed before Threshold or RaceSim. The compiler must
  satisfy this rule by construction; the validator remains a backstop.
- A recovery week's one retained quality touch is low-end Threshold at no more than 95% FTP. The
  skeleton must not lock a recovery touch to VO2max or SIT and then ask the validator to reject it.

### Protocol catalogue and progression

`lib/workout-templates.ts` becomes the one catalogue for Rest, Strength, Recovery, Z2, Threshold,
VO2max, SIT, RaceSim, and durability A–E. It returns typed prescriptions for cycling workouts and
reuses the existing deterministic routine templates.

Each trainable protocol declares ordered stages inside its existing bands. Loading-week ordinal
selects the stage from easy to hard; recovery resets to its dedicated touch. Progression increases
work duration or repetitions before intensity. A recipe fills the remainder of its slot with easy
warmup, recovery, or cooldown so the rendered step sum equals the slot's nominal minutes exactly.
It never pads hard work, exceeds the slot ceiling, or changes the weekly total.

The existing protocol bands remain authoritative:

- SIT: 4–6 × 20–30 seconds, 130–200% FTP, four-minute easy recoveries, seated cue.
- VO2max: 3–8-minute efforts at 106–120% FTP.
- Threshold: 88–105% FTP, including sweet spot at 88–93%.
- RaceSim: 3–5 varied race moves, each with distinct duration/intensity/recovery, hardest move in the
  last third, with an optional finishing sprint.
- Durability A–E: preserve the existing selected mechanism; B–E become fixed typed recipes rather
  than prose instructions.

If a recipe cannot fit its slot, compilation fails with a settings/protocol error. There is no AI
fallback and no post-hoc duration reconciliation of compiler-owned output.

## Weekly load settings

`targetWeeklyHours` is the intended loading-week total. `maxAvailableHours` is a hard ceiling and
must be greater than or equal to the target. `computeWeekTargets` uses the target, never the ceiling,
for normal loading weeks. Recovery targets keep the existing deterministic reduction/envelope and
are also capped by available time.

Existing settings migrate without changing current generated load:

- `targetWeeklyHours = old weeklyHoursMax`
- `maxAvailableHours = old weeklyHoursMax`
- existing recovery settings are retained

The athlete can then add headroom by raising `maxAvailableHours`; migration does not silently lower
the current 12-hour target to the old 10-hour minimum. Missing new fields use truthy/fallback checks,
never `=== null`.

## Names, descriptions, and provenance

- Block title: `<length>-week <focus> <phase>`, with fixed capitalization and fallbacks.
- Week label: fixed focus/loading or Recovery label.
- Workout name: fixed protocol name plus its work-set summary.
- Workout text: canonical renderer output.
- Description: deterministic nutrition text only; execution cues live on steps.
- `raw`: canonical serialized compiler result for audit, not an AI response.
- Deterministic plans omit `model` and `promptVersion`; those fields remain on genuine AI artifacts
  and historical plans.

The existing `overview` field carries the deterministic block title so preview, current-block, and
history shapes do not need a parallel title migration.

## Publication and failure behavior

Human approval remains unchanged: generation creates a preview, and only `/api/write` publishes it.
The persisted-verdict passport, absolute blocker behavior, preference acknowledgment, CAS guards,
local-before-calendar rules, and stable `nodevelo-<date>` event keys remain intact.

The compiler's round-trip mismatch is an internal generation failure, not a warning. Invalid settings
return a specific 400 before composition. Unexpected compiler failures return 502 and save no verdict
or season mutation. A verdict-persistence failure still makes the plan unpublishable through the
existing fail-safe.

Generation no longer requires Anthropic configuration. Retained language calls continue to degrade
independently without blocking sync or closeout.

## Verification and FR-5 acceptance evidence

Tests exercise the compiler through its public interface and the prescription module through its
render/parse interface.

Required automated checks:

- semantic round trips for points, ranges, ramps, cadence, cues, repeats, and legacy durations;
- exact per-day and per-week duration sums;
- deterministic output for identical inputs;
- progression monotonicity within protocol bands;
- freshness-first quality ordering;
- recovery-week quality and long-ride rules;
- target below ceiling, target equal to ceiling, and infeasible settings;
- no Anthropic call or configuration requirement on `/api/generate`;
- unchanged publication-passport and human-approval behavior.

Record five consecutive varied-input generations with zero publication blockers:

1. two-week threshold block with target equal to ceiling;
2. four-week VO2max block with a recovery week and target below ceiling;
3. six-week anaerobic block with three quality slots;
4. terrain/race goal that deterministically places RaceSim;
5. long block with event displacement and constrained availability.

Then publish one owner-approved result to Intervals and inspect the parsed workout graph, calculated
duration/load, repeat order, cadence/ramp interpretation, and explicit rest days. Record any parser or
device discrepancy rather than widening the grammar speculatively.

Any retained Anthropic route whose prompt or output handling changes during implementation also gets
one live smoke run. Removing the block-generation call requires no replacement AI smoke; its proof is
successful generation with Anthropic unconfigured.

## Explicit non-goals

- No UI redesign beyond the settings labels/fields required by target versus ceiling.
- No new workout library behavior.
- No second parser, template system, validator family, or AI call.
- No free-form explanation feeding deterministic planning.
- No automatic calendar publication.
- No attempt to model every Intervals.icu workout feature.
