# FR-5 deterministic authority design

**Date:** 2026-08-29  
**Status:** Approved by owner on 2026-08-29

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
- Emit cycling workouts only, using a narrow typed prescription and canonical Intervals text. Power
  remains the authority for quality work; HR zones may govern pure easy/recovery work, and a resolved
  HR ceiling may appear as a visible cue where power remains primary.
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

For the Intervals grammar, FR-5 selects a **layered useful subset**: portable prescription semantics
in the core type, plus explicit annotations whose device limits are known. Modeling every accepted
token would make the interface as complex as the external format; excluding every device-dependent
feature would throw away useful execution controls. The selected type therefore represents targets,
roles, cues, and lap endings, while templates decide which are safe to emit.

## Deep module and seam

The new deep module is the deterministic block compiler. Its external interface is one pure call:

```ts
compileTrainingBlock(input: DeterministicBlockInput): DeterministicBlockResult
```

The input contains only already-resolved facts: block parameters, week skeleton, selected focus,
selected durability template, session requirements, block settings (including lap-button capability),
and deterministic nutrition values. It does not accept prompt text, an Anthropic client, or raw
knowledge-base prose.

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
  targetMode: "power" | "heartRate";
  sections: PrescriptionSection[];
}

interface PrescriptionSection {
  name: "Warmup" | "Main Set" | "Cooldown";
  repeats: number;
  steps: PrescriptionStep[];
}

type StepRole = "warmup" | "active" | "recovery" | "cooldown";

type StepTarget =
  | { kind: "power-percent"; minPctFtp: number; maxPctFtp: number }
  | { kind: "power-ramp"; fromPctFtp: number; toPctFtp: number }
  | { kind: "power-zone"; minZone: 1 | 2 | 3 | 4 | 5 | 6; maxZone: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: "hr-percent"; basis: "max" | "lthr"; minPct: number; maxPct: number }
  | { kind: "hr-zone"; minZone: 1 | 2 | 3 | 4 | 5; maxZone: 1 | 2 | 3 | 4 | 5 };

interface PrescriptionStep {
  cue?: string;
  durationSec: number;
  end: "timer" | "lapButton";
  role: StepRole;
  target: StepTarget;
  hrCeilingBpm?: number;
}
```

`repeats` is at least one; nested repeats do not exist. A point target is represented by equal min
and max values. `durationSec` is always the planned duration used for weekly arithmetic, including a
lap-button step. `hrCeilingBpm` is a deterministic guardrail resolved from current physiology; it is not
misrepresented as a second device-controlled target.

The canonical renderer emits:

```text
Warmup
- Settle in 10m ramp 50%-75% intensity=warmup

Main Set 5x
- Smooth power 3m 115%-120% intensity=active
- HR cap 145bpm 2m 50%-60% intensity=recovery

Cooldown
- Spin easy 10m 50%-60% intensity=cooldown
```

With `lapButtonSteps` enabled on a proven Garmin/Suunto path, an eligible readiness step may instead
render `- Press lap when safely positioned 10m 50%-60% intensity=warmup`. The owner's default Wahoo
output never emits that variant.

It uses `h`, `m`, and `s`, includes every unit in combined durations, emits lowercase `ramp`, and
places one blank line around sections. Power percentages remain canonical for quality work. Standard
power and HR zones, `% HR`, and `% LTHR` are available where the protocol calls for them. A zone range
uses `Z1-Z2`; HR zones append `HR`. Per-step roles render as `intensity=<role>` so FIT/device exports
can classify warmup, work, recovery, and cooldown instead of guessing from prose.

The [ZonePace grammar](https://zonepace.cc/intervals-workout-format) establishes steps, target
families, ramps, repeats, cues, and timed prompts. The [Intervals Workout Builder](https://www.intervals.icu/features/workout-builder/)
confirms power/HR/pace/zone targets and device export, while the first-party
[builder guide](https://forum.intervals.icu/t/workout-builder/1163) records the actual export behavior.
The detailed source and portability findings are recorded in the
[FR-5 expanded syntax research](../../reviews/2026-08-29-fr5-expanded-intervals-syntax-research.md).
The parser continues to accept legacy duration spellings and cadence tokens already stored by
NodeVelo, but the deterministic renderer emits no cadence target.

### Target-family and cap rules

Intervals can parse power and HR targets on one step, but a synced workout executes under one chosen
target family. FR-5 therefore never claims that a dual-target line enforces power plus a secondary HR
ceiling.

- `targetMode` is explicit, and every generated step must match it.
- Threshold, VO2max, SIT, RaceSim, and durability B–E use power targets.
- Pure Z2, Recovery, and durability A may use `Z1-Z2 HR` when current HR physiology is available;
  otherwise they use a power-zone or `%FTP` target.
- On a power-led workout, `hrCeilingBpm` renders as a short step cue such as `HR cap 145bpm`. It is visible
  guidance, not a device alert. A cap derived from a zone is resolved to bpm before rendering so `Z2`
  is not accidentally parsed as a second structured target.
- Numeric quality protocols continue to use `%FTP`, not zone labels, because their validators require
  exact deterministic bands. Zone targets are for easy/recovery control, not a way to blur protocol
  edges.

### Lap-button and device annotations

`Press lap` is useful but is export behavior, not a portable duration primitive. Intervals retains the
stated duration for planned time/load; Garmin and Suunto can instead advance when the athlete presses
lap. Wahoo does not support that end condition.

- `end: "lapButton"` renders `Press lap` in the step cue and still requires a realistic
  `durationSec`.
- It is allowed only for outdoor positioning, readiness, or easy recovery transitions.
- It is forbidden on prescribed SIT/VO2max/Threshold work and excluded from Wahoo output.
- `BlockSettings.lapButtonSteps` is the only capability switch. It defaults to `false` for the
  owner's Wahoo and may be enabled only when the athlete explicitly selects a proven Garmin/Suunto
  outdoor path. That switch is both capability and execution intent, so no brand abstraction,
  indoor-mode field, or device matrix is introduced.
- `intensity=<role>` is emitted because the role is already known; it is export metadata, never a
  substitute for a target.
- Ordinary step cues are supported. Timed `seconds^prompt <!>` cues remain excluded because they are
  chiefly a Zwift export feature and no selected NodeVelo protocol needs them.

Ramps remain in the core type for power-percent warmup/cooldown progression. The Intervals graph must
parse their direction and endpoints; device execution is inspected separately because some head units
flatten a ramp to a band or midpoint.

The model deliberately excludes cadence generation, absolute watts, MMP, custom zones, pace,
distance, freeride, timed prompts, power-display averaging, HTML/Markdown decoration, and nested
repeats. Those features either duplicate a current target, weaken deterministic load, or are tied to
an unselected device workflow.

For every newly generated ride, this invariant must pass before publication:

```text
typed prescription -> render -> parse -> semantic equality
```

Semantic equality covers total duration, expanded step order, repeat count, target family and
endpoints, zones, ramp direction, step role, lap-button ending, resolved HR cap, and cues.
`walkWorkoutSteps`, `parsePrescription`, and
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
- `lapButtonSteps = false`
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

- semantic round trips for power/HR points, ranges and zones; ramps; cues; roles; lap-button endings;
  resolved HR caps; repeats; and legacy durations/cadence tolerance;
- one primary target family per generated workout, with power plus HR-cap cues never misclassified as
  dual device targets;
- lap-button misuse rejected unless the capability switch and an eligible readiness/recovery step
  both permit it;
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
duration/load, power-led and HR-led targets, zone ranges, repeat order, role classification, ramp
interpretation, and explicit rest days. Execute representative power and HR workouts on the owner's
Wahoo, confirm expected ramp degradation, and confirm no `Press lap` step was emitted. Record parser
behavior and device execution separately; a correct Intervals graph is not proof that Garmin, Suunto,
Wahoo, and Zwift execute identically.

Any retained Anthropic route whose prompt or output handling changes during implementation also gets
one live smoke run. Removing the block-generation call requires no replacement AI smoke; its proof is
successful generation with Anthropic unconfigured.

## Explicit non-goals

- No UI redesign beyond the settings fields required by target versus ceiling and the lap-button
  capability switch.
- No new workout library behavior.
- No second parser, template system, validator family, or AI call.
- No free-form explanation feeding deterministic planning.
- No automatic calendar publication.
- No attempt to model every Intervals.icu workout feature or hide device-specific behavior behind a
  false portability claim.
