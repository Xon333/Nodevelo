# Nutrition early trend warning

**Status:** Approved design (pre-implementation)  
**Date:** 2026-08-03

## Purpose

Warn when the athlete appears to be following NodeVelo's prescription but their weight is still
moving faster upward than the configured goal. The warning is an early transparency signal while the
slower maintenance calibration gathers stronger evidence. It must never change the calorie target.

## Trigger

A pure nutrition function returns evidence only when all conditions hold over the 21 complete days
before the athlete's local `today`:

- at least 7 weigh-ins exist in the window;
- a robust Theil–Sen weight trend can be calculated;
- at least 14 days have positive logged intake and fully resolved activity burn;
- aggregate logged intake is 95–105% of the estimated prescriptions for those usable days; and
- observed weight trend exceeds the intended trend by at least 0.15 kg/week.

The intended trend comes from the existing `desiredWeightTrend`, so target direction, rate caps and
the 0.7 kg goal deadband remain single-sourced. Each historical prescription uses the existing
rest/training model resolver, measured activity burn and the currently resolved goal buffer. Days
with unknown activity burn are excluded rather than treated as rest days.

Historical final prescriptions are not persisted today. The adherence gate is therefore explicitly
an estimate using the current calibrated models and current goal buffer; the UI must call it
"estimated prescription adherence." A future immutable daily-prescription ledger can replace that
input without changing the warning contract.

The function returns `null` whenever evidence is insufficient, adherence is outside the band, or the
trend error is below threshold. It returns the observed trend, intended trend, adherence ratio,
weigh-in count and usable intake-day count when triggered.

## Data flow and UI

`GET /api/sync` computes the warning from the synced wellness and activities, athlete profile, the
same resolved rest/training nutrition models used elsewhere, and the athlete-local `today`. The API
returns the plain evidence object as `nutritionTrendWarning`; nothing is persisted.

Today renders one compact amber panel below safety alerts/loading prompts and above the page's main
pre/post-ride content. It is visible on rest days and training days. Copy states:

- the observed and intended kg/week trends;
- estimated prescription adherence and evidence counts; and
- "Calories are unchanged while maintenance calibration gathers stronger evidence."

This is informational, not an alarm or diagnosis. It does not enlarge the goal deficit, alter `k`,
write profile state, or feed the LLM.

## Verification

Unit tests cover the trigger and each withholding gate: insufficient weigh-ins, insufficient usable
intake days, adherence outside 95–105%, trend error below 0.15 kg/week, and unresolved activity burn.
Route coverage confirms the evidence is returned on GET and uses the supplied local date. A focused
component test verifies triggered copy and absence when the value is `null`; the existing full check
remains the integration gate.

