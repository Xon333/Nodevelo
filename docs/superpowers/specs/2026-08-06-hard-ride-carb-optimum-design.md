# Hard-ride carb optimum

**Status:** Design approved 2026-08-06, not yet implemented
**Date:** 2026-08-06

## Purpose

`inRideCarbTarget`'s hard/>90min tier (105 g/hr) is a population figure with no per-athlete evidence
behind it, unlike the app's existing Z2/endurance carb optimum (`carbsOptimum` in `lib/calibration.ts`),
which already learns a personalized in-ride rate from the athlete's own long steady rides. That existing
system explicitly cannot cover hard/interval sessions: its candidate pool is `isSteadyEnduranceRide`-
filtered (excludes anything hard by construction) and its outcome signal, `aerobicEffPct`, needs ≥15 min
of genuine Z2 samples within a ride to compute at all — meaningless for judging whether fueling helped a
Threshold/VO2max/SIT/RaceSim session's own hard efforts.

This adds a second, parallel calibrated parameter — `hardCarbsOptimum` — built the same
derive-with-fallback way, but classified by `executionScore` instead of aerobic efficiency, since that's
the outcome signal that actually exists and is already trusted for hard-session quality.

## How a ride is classified — planned, inferred, and off-block

Reuses `data/score-log.json`'s existing `RideScoreEntry.inferredType: WorkoutType`, unchanged. Its own
doc comment states its purpose exactly: "the effort type used for grouping: plannedType when planned,
otherwise inferred from intensity/duration. **Always present so every ride can join the model.**" This
already answers both open questions from review:

- **Planned session:** `inferredType` = the plan's own `type` (e.g. a generated Threshold day).
- **Off-plan / no active block:** `inferredType` = `inferWorkoutType(intensityFactor, durationMin)`
  (`lib/ride-classify.ts`) — a pure function of the ride's own power/duration, with no dependency on a
  block existing at all. A ride ridden with zero plan in force gets the same treatment as one inside a
  block.

No new classification logic is built. `legacy` and `compromised` entries are excluded, matching every
other consumer of this ledger (`scores.filter((e) => !e.legacy && !e.compromised)` in the sync route).

Confirmed against the real ledger: 23 hard-type (`Threshold`/`VO2max`/`SIT`/`RaceSim`) entries in the
last 90 days, `executionScore` spanning 5–8 — a genuine spread, not a degenerate all-same sample.

## The new calibrated parameter

`lib/calibration.ts`, mirroring `deriveCarbsOptimum`/`CARBS_OPTIMUM_SPEC` exactly:

```
HardCarbsRideSignal { carbsIngestedG: number | null; executionScore: number | null; movingTimeSec: number }

HARD_CARBS_OPTIMUM_SPEC: OptimumSpec = {
  badSide: "lower",                          // under-fueling is still the credited failure mode
  discriminationMargin: CARBS_DISCRIMINATION_MARGIN,   // reuse: 10 g/h
  clampTo: CARBS_OPTIMUM_BOUNDS,             // reuse: [30, 120] g/h — same physiological range
  confidence: same nGood/nBad thresholds CARBS_OPTIMUM_SPEC already uses,
}

deriveHardCarbsOptimum(prior, rides): CalibratedParameter
```

**Good/bad classification:** `executionScore >= 7` → good, `< 5` → bad, `[5, 7)` → deadband (excluded
from both classes) — reusing `executionScoreLabel`'s own existing band boundaries ("Good" starts at 7,
"Below target" ends below 5) rather than inventing new thresholds.

**Candidate pool** (built where `carbsOptimum` is already built, in the sync route's calibration
block): `scoreLog.entries` filtered to `inferredType` in `HARD_TYPES`, `!legacy`, `!compromised`, cross-
referenced by date against `lastSync.activities` for `carbsIngestedG`/`movingTimeSec`, filtered to
`movingTimeSec >= CARBS_MIN_DURATION_SEC` (90 min — reused, fueling isn't load-bearing before that
regardless of intensity).

**Population default:** 105 g/hr (`DEFAULT_HARD_CARBS_OPTIMUM`) — identical to what `inRideCarbTarget`
already prescribes for this tier today, so a not-yet-confident athlete sees no change.

**Storage:** `hardCarbsOptimum?: CalibratedParameter` added *alongside* `carbsOptimum` in
`CalibrationStore` (additive — no migration, no restructuring of the existing field, same optional-field
convention `carbsOptimum` itself already established when it was added).

## Wiring into the prescription — without reintroducing the day-type validator bug

`inRideCarbTarget(durationMin, type)` is pure and has multiple callers (`buildNutritionReferenceRows`,
`nutrition-validate.ts`'s carb check). The day-type NEAT work already hit this exact failure mode once:
a reference table resolving a value one way while the validator computed its own "expected" value a
different way. The fix here is the same shape as that fix: **one shared resolved number, passed to both
call sites by their common caller — never two independent resolves.**

- `inRideCarbTarget` gains one optional parameter: `inRideCarbTarget(durationMin, type,
  hardOverrideGPerH?: number | null)`. Used only when the hard/>90min branch would otherwise apply.
  `lib/nutrition.ts` stays calibration-agnostic — it takes a plain number, never imports
  `lib/calibration.ts` (avoids a nutrition↔calibration import cycle entirely, since `calibration.ts`
  would need to import `HARD_TYPES`/`inRideCarbTarget` the other direction if the wiring lived there).
- `buildNutritionReferenceRows` and `nutrition-validate.ts`'s carb-check both gain the same optional
  parameter, threaded straight through to `inRideCarbTarget`.
- `app/api/generate/route.ts` (currently doesn't read calibration at all) adds one `readCalibration()`
  call, computes `const hardOverrideGPerH = resolveCalibratedValue(calibration.hardCarbsOptimum, 105)`
  **once**, and passes it into both `buildNutritionReferenceRows` and `repairNutrition`/`validateNutrition`
  — identical to how `bufferApplied` is already resolved once and shared between the same two call sites.
  `resolveCalibratedValue` already encodes the entire trust gate (confidence + manual override
  precedence) other calibrated parameters use, so no new gating logic is written here.

## Post-ride fuel prompt (secondary, small extension)

`deriveFuelPrompt`'s "gap" comparison (today only ever checks against `carbsOptimum`) is extended to
pick whichever `CalibratedParameter` matches the completed ride's own `plannedType`/inferred type —
`hardCarbsOptimum` for a hard session, `carbsOptimum` otherwise — mirroring the day-type resolver
pattern already used for NEAT (`(isRestDay) => isRestDay ? rest : train`). `deriveFuelPrompt` itself is
unchanged; only its caller's selection of which optimum to pass in changes.

## UI

`components/CalibrationPanel.tsx` and `app/api/calibration/route.ts` both already generalize over any
`CalibratedParameter`-shaped field (`RowConfig`, `PARAM_BOUNDS`) — adding `hardCarbsOptimum` to each is
a one-line addition to an existing list, not new component code. Manual override, provenance chip, and
confidence display all come free from the existing generic machinery.

## Verification

Unit tests for `deriveHardCarbsOptimum`: good/bad/deadband classification at the exact executionScore
boundaries (7, 6, 5); confidence tiers at the same nGood/nBad breakpoints `CARBS_OPTIMUM_SPEC` already
has coverage for; a non-discriminating sample (good and bad medians too close) stays on the population
default. `inRideCarbTarget`'s new parameter: an override is used only for hard+`>90min`; every other
(type, duration) combination is byte-identical to today's output with the parameter omitted or null —
regression-proof for the existing carb table. `nutrition-validate.ts`: extend the existing day-type
divergence test's spirit — a block whose reference table used one override value must not get "corrected"
by a validator resolving a different one. Route-level test proves `app/api/generate` resolves the
override once and both consumers agree. Real-ledger sanity check (read-only,
`data/score-log.json`+`data/last-sync.json`): confirm the 23 real hard-type entries actually produce a
sane `deriveHardCarbsOptimum` result when run through the real pipeline, reporting confidence/dataPoints/
value, before calling this done.
