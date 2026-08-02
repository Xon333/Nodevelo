# Nutrition Provenance and Safety Transparency

**Status:** Approved design — 2026-08-02

## Goal

Close three nutrition transparency gaps without inventing historical data:

1. Weekly adherence should eventually use the buffer actually prescribed on each day.
2. The Profile derivation should disclose when the RMR safety floor changes the target.
3. Coach-snapshot calculations should default to the athlete's local date, never UTC.

## Decisions

### Historical buffer provenance

Do not reconstruct old applied buffers from current settings, current weight, or generated prose. Those
inputs can differ from what NodeVelo knew on the historical day and would create false precision.

Do not stamp only ride ledger entries: rest days have no ride entry, so a weekly denominator would almost
never have complete coverage. The current change therefore leaves weekly adherence on its documented
approximate basis and labels that limitation honestly.

The future upgrade point is a separate day-keyed prescription history containing the final displayed
`dailyTargetKcal` (not merely the buffer) for every day NodeVelo actually prescribed. Weekly adherence
switches to that source only when every usable intake-logged day in the week has a stamp; it must never mix
exact and reconstructed days inside one ratio. This history is deferred until NodeVelo has a reliable
daily commit event independent of rides and block usage. No migration or backfill is attempted.

### RMR-floor transparency

The Profile route must compute today's displayed target through `calculateDailyTarget`, the same authority
used everywhere else, rather than reproducing `maintenance + buffer` in JSX.

When `floored` is false, the current compact target row remains unchanged. When true, the row displays the
pre-floor result and the final target, with plain language explaining that the target was raised to RMR.
This is informational, not a new control or warning banner.

### Athlete-local date

`resolveCoachSignals` resolves one date at entry: the supplied athlete-local date, otherwise
`localToday()`. That single value feeds ACWR, load ramp, athlete state, energy availability, and FTP-retest
detection. `utcToday()` is removed from this path.

Routes continue supplying `resolveToday(req)` results. The fallback exists for direct library callers and
tests, and obeys the same local-day invariant.

## Compatibility and failure behavior

- Existing weekly balance remains valid and explicitly approximate.
- Weekly balance never guesses a missing historical prescription.
- Legacy nutrition profiles keep their existing target behavior and report `floored: false`.
- Missing or unresolved activity burn remains excluded according to the existing nutrition contracts.
- No AI prompt or generation structure changes are required.

## Verification

- A unit test proves the coach-signal fallback is equivalent to an explicitly supplied `localToday()`.
- Profile-route and calculation tests prove an active RMR floor is returned and rendered from the shared
  calculation result.
- Documentation and existing weekly-energy tests preserve the approximation until a complete daily
  prescription source exists.
- Full `npm run check` and one local UI inspection of the derivation panel.

## Non-goals

- Retroactive buffer reconstruction or migration.
- A new recovery-energy term.
- Meal-level logging or carbohydrate Phase 4.
- Changing the goal-rate or day-type NEAT equations.
