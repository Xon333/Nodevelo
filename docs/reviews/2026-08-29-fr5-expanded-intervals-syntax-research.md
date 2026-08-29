# FR-5 expanded Intervals.icu workout-syntax research

**Date:** 2026-08-29  
**Purpose:** define the useful Intervals.icu cycling syntax FR-5 should model, distinguish parser
support from device behavior, and recommend what deterministic templates should actually emit.

## Conclusion

FR-5 should use a **layered subset**, not the earlier all-power subset and not the whole Intervals
grammar:

1. A portable core for every generated workout: explicit time, one target family per workout,
   `%FTP` or standard zone targets, flat repeats, known section headers, short step cues, and explicit
   step roles.
2. Typed optional capabilities: HR-primary targets, zone ranges, power ramps, a visible HR-ceiling
   guardrail, and lap-button endings.
3. Execution-profile gates: NodeVelo may model an optional feature, but must not emit it when the
   selected device cannot execute its semantics.

The important distinction is:

```text
Intervals can parse it != the destination can execute it != NodeVelo should emit it by default
```

This matters for the owner's Wahoo. Intervals can parse ramps, dual power/HR targets, cadence, and
`Press lap`; Wahoo does not provide a lap-button end condition, does not execute ramps as ramps, and
selects one target family rather than enforcing power plus an HR ceiling. Intervals founder David
Tinker confirms that Wahoo's uploaded workout format has no `Press lap` option; the athlete can
pause/skip/replay steps with Wahoo's workout controls instead. ([Wahoo planned-workout thread](https://forum.intervals.icu/t/planned-workouts-with-wahoo-now-supported/54795?page=5))

## Source hierarchy

- [ZonePace's full Intervals.icu workout-format page](https://zonepace.cc/intervals-workout-format)
  is the accepted consolidated grammar reference for this task.
- Intervals.icu's [official Workout Builder page](https://www.intervals.icu/features/workout-builder/)
  confirms the supported target families, formats, and device-sync intent.
- Founder David Tinker's [Workout builder guide](https://forum.intervals.icu/t/workout-builder/1163)
  and his later replies are first-party evidence for parser and export behavior.
- Other Intervals forum reports below are used only where first-party documentation does not state a
  destination's observed behavior. They are portability evidence, not grammar authority.

## Grammar facts relevant to FR-5

### Steps and time

A structured step begins with `-`. A step may contain a duration or distance, target, optional
cadence, and free text. Supported time forms include `1h`, `10m`, `30s`, combined forms, and quote
shorthand. ([ZonePace](https://zonepace.cc/intervals-workout-format),
[Intervals quick guide](https://forum.intervals.icu/t/workout-builder-syntax-quick-guide/123701))

FR-5 should emit one explicit house style:

```text
- 30s 120%
- 5m30s 60%
- 1h30m Z2
```

Use `h`, `m`, and `s`; include the final unit in combined durations. Parse legacy spellings only
where existing NodeVelo data requires them. Time-based cycling is sufficient for FR-5; distance
steps add device and route semantics without serving any selected protocol.

### Power targets and zone caps

Intervals accepts FTP percentages, watts, power zones, zone ranges, MMP, and custom zones. The
official product page lists `%FTP`, absolute watts, modeled-power targets, and zones; the current
quick guide gives exact zone-range forms such as `Z2-Z3`.
([official Workout Builder](https://www.intervals.icu/features/workout-builder/),
[quick guide](https://forum.intervals.icu/t/workout-builder-syntax-quick-guide/123701))

Useful FR-5 forms are:

```text
- 10m 75%
- 10m 88-94%
- 60m Z2
- 60m Z1-Z2
```

The semantic difference must survive the typed round trip:

- `56-75%` is an exact FTP-relative numeric band chosen by NodeVelo.
- `Z2` is the athlete's configured power zone, resolved by Intervals at use/export time.
- `Z1-Z2` is a broad target band whose upper edge acts like a power-zone ceiling, but remains a
  two-sided range rather than a special one-sided-cap operator.

Use `%FTP` for Threshold, VO2max, SIT, RaceSim, and deterministic progression because the recipes
need exact endpoints. Permit `Z1`, `Z2`, and `Z1-Z2` for Recovery and unbroken endurance, where the
athlete's current configured zone is the desired authority. Do not generate fixed watts, MMP, or
custom-zone IDs in FR-5.

### Heart-rate targets: what is possible and what “HR cap” means

Intervals supports HR as percent of max HR, percent of LTHR, and HR zones/ranges:

```text
- 60m 70% HR
- 60m 75-80% HR
- 60m 95% LTHR
- 60m 90-95% LTHR
- 60m Z2 HR
- 60m Z1-Z2 HR
```

`HR` means percent of max HR; `LTHR` means percent of threshold HR. Absolute `120-135bpm` text is
not a structured target. ([ZonePace](https://zonepace.cc/intervals-workout-format),
[quick guide](https://forum.intervals.icu/t/workout-builder-syntax-quick-guide/123701),
[absolute-bpm limitation](https://forum.intervals.icu/t/hr-target-workouts-broken-on-edge-840-firmware-30-18-interpreted-as-hrmax-instead-of-bpm/130090/2))

There is no documented one-sided HR-cap operator. `Z2 HR` and `Z1-Z2 HR` are target bands; they can
provide a cap-like upper boundary but may also produce below-target feedback. Intervals can parse a
power and an HR target on the same step:

```text
- 60m Z2 Z2 HR
```

However, founder David Tinker states that execution still chooses one of power, HR, or pace. A later
Wahoo report likewise shows only one of power/HR/cadence targets, and current export behavior selects
one family by priority. A dual-target line therefore cannot promise “hold this power while the device
also enforces this HR ceiling.” ([David's dual-target explanation](https://forum.intervals.icu/t/why-do-my-structured-running-workouts-default-to-power-instead-of-heart-rate/61699),
[Wahoo multiple-target report](https://forum.intervals.icu/t/multiple-targets-in-wahoo/114397),
[current target-priority discussion](https://forum.intervals.icu/t/workout-builder/1163?page=54))

FR-5 should offer two honest alternatives:

1. **HR-primary easy/endurance workout.** Every step uses HR, for example:

   ```text
   Warmup
   - Settle 10m Z1-Z2 HR intensity=warmup

   Endurance
   - Aerobic cap 70m Z1-Z2 HR intensity=active

   Cooldown
   - Easy 10m Z1 HR intensity=cooldown
   ```

   Wahoo can display an HR target when the workout uses valid `... HR` syntax.
   ([Wahoo HR-target example](https://forum.intervals.icu/t/target-hr-field-on-wahoo/123748))

2. **Power-primary workout with an informational HR ceiling.** NodeVelo resolves the current top of
   the intended HR zone from its authoritative physiology snapshot and renders it as canonical cue
   text, not as a second device target:

   ```text
   - Keep HR at or below 152 bpm 60m 56-75% intensity=active
   ```

   Because absolute `bpm` is not a recognized target token, the power target remains unambiguous.
   The typed model must call this a `guardrail` or `cue`, never an enforced target. It may be shown by
   Intervals or a destination that carries step text, but no publication claim may say the device
   enforces it. If current HR-zone physiology is missing or stale, omit the cue rather than guessing.

FR-5 should never emit two target families merely to simulate a secondary cap.

### Ramps

`ramp` marks a gradual transition and is case-insensitive. Direction is explicit in the endpoints:

```text
- 10m ramp 50%-75%
- 8m ramp 60%-45%
```

A range without `ramp` is a band, not a progression. ([ZonePace](https://zonepace.cc/intervals-workout-format),
[quick guide](https://forum.intervals.icu/t/workout-builder-syntax-quick-guide/123701))

Ramps belong in the typed model and canonical Intervals serialization, but stock FR-5 templates
should use them only for warmup/cooldown. Wahoo does not execute a ramp as a ramp; an observed export
treats it as a static range, and the current forum guidance states Wahoo lacks ramp support.
([Wahoo ramp discussion](https://forum.intervals.icu/t/workout-builder/1163?page=54)) Garmin also lacks
native ramp execution and conversions can consume its 50-step limit.
([Garmin ramp/step-limit report](https://forum.intervals.icu/t/help-needed-with-edge-540-please/102528?page=2))

That degradation is acceptable for a non-critical warmup/cooldown, but not for a main-set protocol
whose stimulus depends on a true linear ramp. Do not create a stepped-ramp expansion in FR-5; add one
only if live Wahoo acceptance proves the warmup/cooldown degradation is materially bad.

### Repeats, blank lines, and headers

Both repeat forms are valid:

```text
Main Set 5x
- Work 3m 115-120%
- Recovery 2m 50-60%
```

```text
5x
- 30s 120%
- 30s 50%
```

Only a section/header line containing `Nx`, or a standalone `Nx`, creates a repeat. Nested repeats
are not supported. Blank lines around each section/repeat block are the safest canonical boundary.
([ZonePace](https://zonepace.cc/intervals-workout-format),
[quick guide](https://forum.intervals.icu/t/workout-builder-syntax-quick-guide/123701),
[no nested repeats](https://forum.intervals.icu/t/workout-builder/1163?page=54))

FR-5 should emit named sections only: `Warmup`, `Main Set`, and `Cooldown`. A section name is useful
organization, but it is not enough to classify the exported step. The renderer should also emit the
step role described next.

### Step roles with `intensity=`

Intervals supports FIT-oriented role metadata:

```text
intensity=warmup
intensity=active
intensity=interval
intensity=rest
intensity=recovery
intensity=cooldown
```

These values classify a step/lap; they do not set its target magnitude. Intervals added explicit FIT
intensity values, and later activity reprocessing maps `intensity=rest` to Recovery.
([intensity support](https://forum.intervals.icu/t/workout-builder-garmin-recovery-rest-interval-step/19540/14),
[first-party reprocessing behavior](https://forum.intervals.icu/t/workout-builder/1163?page=49))

FR-5 should model the smaller cycling set:

```text
warmup | active | recovery | cooldown
```

Use `active` for prescribed work, `recovery` for easy pedaling between efforts, and the matching
warmup/cooldown roles. Defer `interval` because Garmin maps `active` and `interval` alike, and defer
`rest` until NodeVelo generates a genuinely stationary cycling step. Roles should be emitted on every
step; this is more deterministic than asking a destination to infer work/recovery from power.

### Ordinary and timed text prompts

Text before the first recognized duration or target becomes the step cue:

```text
- Recovery 30s 50%
- Stay seated 4m 100%
```

([founder guide](https://forum.intervals.icu/t/workout-builder/1163),
[ZonePace](https://zonepace.cc/intervals-workout-format))

Short ordinary cues are useful for posture, fueling, safety, and the informational HR ceiling. They
belong in the typed prescription and round trip. Do not assume every destination displays them.

Timed prompts inside one step use offsets and a separator, for example:

```text
- First prompt at 0s 33^Second prompt at 33s <!> 10m ramp 25-75%
```

They are mainly a Zwift/ZWO facility. On non-ZWO exports, messages may be concatenated, and repeated
blocks have additional limitations. ([ZonePace](https://zonepace.cc/intervals-workout-format),
[first-party text-event announcement](https://forum.intervals.icu/t/text-events-are-now-supported-in-the-workout-builder/96016))
Defer timed prompts; ordinary step cues cover FR-5 without destination-specific scheduling syntax.

### Lap-button endings (`Press lap`)

The literal phrase `Press lap` makes supported exports use the device lap button as the end condition:

```text
- Press lap when ready 10m 50-65% intensity=warmup
```

A nominal time is still required for Intervals' planned duration/load. On Garmin, that time is not the
actual end condition; the step continues until lap is pressed. ([founder answer](https://forum.intervals.icu/t/press-lap-workout-builder-to-garmin-edge-530/14696),
[ZonePace portability note](https://zonepace.cc/intervals-workout-format)) Recent use confirms Garmin
and Suunto support, but it is export behavior rather than portable core grammar.
([Garmin/Suunto example](https://forum.intervals.icu/t/lap-press-a-integrer-dans-une-seance/121016))

NodeVelo already documents the correct safety restriction in
[`lib/anthropic-prompts.ts`](../../lib/anthropic-prompts.ts): only positioning/readiness steps, never
a prescribed work interval, and always retain a realistic nominal duration.

FR-5 should keep this capability in the typed model, with two hard gates:

- `end: "lapButton"` is valid only for `warmup` or `recovery`, never `active` work.
- The execution profile must report lap-button support. Garmin/Suunto may pass; Wahoo must fail or
  choose a normal timed step before rendering.

For this owner's Wahoo, do **not** emit `Press lap`. Wahoo's uploaded workout format has no such
condition. Its supported alternative is to pause or skip/replay the current workout interval using
the head-unit controls. ([founder Wahoo answer](https://forum.intervals.icu/t/planned-workouts-with-wahoo-now-supported/54795?page=5))

## Recommended typed boundary

The smallest model that makes the useful features honest is:

```ts
type WorkoutTargetMode = "power" | "heartRate";

type PrescriptionTarget =
  | { kind: "powerPct"; min: number; max: number }
  | { kind: "powerRampPct"; from: number; to: number }
  | { kind: "powerZone"; minZone: number; maxZone: number }
  | { kind: "hrPct"; basis: "max" | "lthr"; min: number; max: number }
  | { kind: "hrZone"; minZone: number; maxZone: number };

type StepRole = "warmup" | "active" | "recovery" | "cooldown";

interface PrescriptionStep {
  cue?: string;
  durationSec: number;
  target: PrescriptionTarget;
  role: StepRole;
  end: "timer" | "lapButton";
  guardrails?: Array<{ kind: "hrCeilingBpm"; bpm: number }>;
}

interface PrescriptionSection {
  name: "Warmup" | "Main Set" | "Cooldown";
  repeats: number;
  steps: PrescriptionStep[];
}

interface CyclingPrescription {
  targetMode: WorkoutTargetMode;
  sections: PrescriptionSection[];
}
```

Required invariants:

- every target matches the workout's one `targetMode`;
- `powerRampPct` is the only ramp form emitted in FR-5;
- `hrCeilingBpm` is informational and may accompany a power target, but is never serialized as a
  second structured target;
- `lapButton` requires a supported execution profile and a warmup/recovery role;
- repeats are at least one and never nested;
- cues are short canonical text, not free-form AI output; and
- render → parse → semantic equality covers targets, roles, guardrails, step endings, ordered repeat
  expansion, cues, and duration.

This expands the design without creating separate power and HR prescription models. It also reuses
NodeVelo's current physiology authority: `resolveHrZones` already produces current bpm zone bounds,
so a visible Z2 ceiling can be derived rather than copied from stale profile prose.

## Canonical templates FR-5 should emit

### Portable power-quality workout

```text
Warmup
- Build smoothly 10m ramp 50%-70% intensity=warmup

Main Set 4x
- Controlled threshold 8m 95-100% intensity=active
- Easy spin 4m 50-60% intensity=recovery

Cooldown
- Spin easy 8m ramp 60%-45% intensity=cooldown
```

On Wahoo, the two ramps may execute as bands rather than linear ramps; the main set remains exact.

### HR-primary endurance with a cap-like zone band

```text
Warmup
- Settle 10m Z1-Z2 HR intensity=warmup

Main Set
- Aerobic cap 70m Z1-Z2 HR intensity=active

Cooldown
- Easy 10m Z1 HR intensity=cooldown
```

This is the only device-targeted HR-cap substitute FR-5 should promise. It is still a range, not a
one-sided operator.

### Power-primary endurance with visible HR ceiling

```text
Warmup
- Build smoothly 10m 50-65% intensity=warmup

Main Set
- Keep HR at or below 152 bpm 70m 56-75% intensity=active

Cooldown
- Easy 10m 50% intensity=cooldown
```

The 152 bpm value is an example; the compiler must resolve the athlete's current HR-zone ceiling.
This cue is useful guidance but not device enforcement.

### Lap-button transition on a supported device only

```text
Warmup
- Press lap when safely positioned 10m 50-65% intensity=warmup

Main Set 5x
- Hard 3m 115-120% intensity=active
- Easy 3m 50-60% intensity=recovery
```

Never emit this variant for Wahoo; emit the same workout with a normal timed warmup instead.

## Parser support versus stock-template policy

| Feature | Can model and round-trip? | Stock templates emit? | Reason |
|---|---:|---:|---|
| Explicit time | Yes | Always | Portable, exact duration authority. |
| `%FTP` point/range | Yes | Quality + most power workouts | Exact deterministic progression. |
| Power zones/ranges | Yes | Recovery/endurance only | Useful cap-like bands; depends on configured zones. |
| HR `%max`/`%LTHR` | Yes | Optional HR-primary workouts | Structured HR target, but not absolute bpm. |
| HR zones/ranges | Yes | Optional HR-primary easy/endurance | Best available device-targeted HR cap substitute. |
| Visible resolved-bpm HR ceiling | Yes, as NodeVelo guardrail/cue | Optional power endurance | Honest informational cap; not a second device target. |
| Power ramps | Yes | Warmup/cooldown only | Parser-valid; Wahoo/Garmin execution degrades. |
| `intensity=` roles | Yes | Every step | Useful explicit FIT/lap classification. |
| Flat repeats + headers | Yes | When recipe repeats | Portable; nested repeats excluded. |
| Ordinary cues | Yes | Sparingly | Useful execution/safety text; display varies. |
| `Press lap` | Yes | Only on supported profile | Garmin/Suunto feature; unavailable on Wahoo. |
| Cadence target | No FR-5 requirement | No | Owner does not need it; one-target device behavior reduces value. |
| Dual power + HR target | Parser could retain it | Never | Execution/export selects one family; not a true cap. |
| Timed prompts | Defer | No | Primarily Zwift/ZWO and repeat behavior varies. |
| `freeride` | Defer | No | Zwift ERG-off behavior, not portable cycling prescription. |
| `power=3s` / display flags | Defer | No | Device preference, not training intent. |
| Fixed watts, MMP, custom zones | Defer | No | No selected FR-5 protocol needs them. |
| Distance/pace | Reject for FR-5 | No | Outside cycling-time prescription scope. |

## Acceptance implications

FR-5 acceptance must test three different boundaries:

1. **NodeVelo semantic round trip:** the canonical parser reconstructs the complete typed meaning.
2. **Intervals interpretation:** its graph, duration, load, repeat order, targets, and roles match.
3. **Actual Wahoo execution:** verify power ranges, an HR-primary endurance workout, role labels where
   visible, ordinary cues where visible, and the expected ramp degradation. Confirm `Press lap` is
   not emitted.

One successful Intervals graph is not evidence of device behavior. Conversely, Wahoo's lack of a
feature should not force the semantic model to forget it: the execution-profile gate lets a future
Garmin/Suunto owner use lap-button endings without weakening this owner's deterministic plan.

## Final recommendation to carry into the FR-5 design

- Remove cadence from the required type, renderer, parser equality, and acceptance evidence.
- Add target mode plus power-zone, HR-percent, and HR-zone target variants.
- Add `StepRole` and emit `intensity=` deterministically.
- Keep power ramps, limited to warmup/cooldown by stock templates.
- Add a typed informational `hrCeilingBpm` guardrail, resolved from current physiology and rendered
  in canonical cue text on power-primary endurance workouts.
- Add typed lap-button endings, but capability-gate them; Wahoo receives timed steps only.
- Reject mixed target families in generated output and never describe a cue or zone band as a true
  secondary enforced HR cap.
- Continue to reject the rest of the grammar until a selected protocol or live device failure
  justifies it.
