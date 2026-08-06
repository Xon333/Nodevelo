# Prescribed-EA warning

**Status:** Design approved 2026-08-06, not yet implemented
**Date:** 2026-08-06

## Purpose

The only existing safety floor on the daily-target formula is `dailyTarget >= RMR` — a guard against
the formula producing an invalid output, not a clinical read. Measured on this athlete's real
calibration at `BUFFER_MIN_KCAL` (-500): the resulting target sits at ~28 kcal/kg body weight, below
the low-energy-availability line the app's own `eaLevel()` already treats as "low" — and the RMR floor
doesn't catch it, because RMR itself can sit below that line too.

This warns when the app's own PRESCRIPTION — not the athlete's logged behaviour — is already the thing
putting them in low-EA territory. It complements, and must not be confused with, two existing signals:
the under-fuelling streak alert (is the athlete under-eating the plan) and the early trend warning (is
weight moving faster than intended despite good adherence). This one asks a third, distinct question:
is the plan itself already too aggressive, independent of whether it's being followed. It must never
change the calorie target — reviewed and explicitly rejected as a hard floor, because the app has no
body-fat data and a hard override built on an approximation could move real calories on a guess.

## Trigger

A pure function, `planEaKcalPerKg`, in `lib/nutrition.ts`:

```
planEaKcalPerKg = (k × RMR + bufferApplied) / weightKg
```

This is the target's own EA-equivalent: maintenance minus the exercise term (EA definitions always
exclude exercise energy), buffer's effect included. It reuses `weightKg` off the same `NutritionModel`
`calculateDailyTarget` already takes, and needs no new inputs.

Returns `null` for a legacy (pre-migration) model — no RMR exists to isolate the NEAT term, same
convention `maintenanceKcal` already follows in `app/api/profile/route.ts`.

The resulting `kcal/kg` value is passed through the **existing, unmodified** `eaLevel()` — the exact
same `<25 low / <40 adequate / ≥40 ample` bands the observed-intake EA tile already uses. No new
threshold is introduced or justified here; this reuses the one the app already shipped and already
argued for (clinical 30/45 kcal/kg·FFM cutoffs shifted down for a total-body-weight denominator).

The warning is "present" only when the resulting level is `"low"`. `"adequate"`/`"ample"` render
nothing — this is a warning surface, not a permanent status readout, matching the early-trend
warning's null-means-nothing-to-say contract.

## Data flow and UI

Computed server-side wherever a resolved `NutritionModel` and `bufferStatus.bufferApplied` already
coexist: `app/api/sync/route.ts` (GET and POST responses), `app/api/generate/route.ts`,
`app/api/profile/route.ts`. No new resolves — every one of these call sites already has both inputs in
scope for other reasons. Computed server-side rather than client-side specifically because the client
only receives `nutritionModel`/`nutritionModelsByDayType` (the multiplier), never the live resolved
`bufferApplied` — shipping the finished level avoids introducing a new raw buffer field to the client
just for this one check.

Shipped as `planEaLevel: EaLevel | null` (reusing the `EaLevel` type `eaLevel()` already returns) plus
`planEaKcalPerKg: number | null` for display, threaded through `SyncProvider`'s `AppState` exactly like
`nutritionTrendWarning` already is.

Today renders a compact amber panel next to `NutritionTrendWarningBanner`, in the same
"something's off with fuelling" neighbourhood as the streak alert, visible only when
`planEaLevel === "low"`. Copy states the `kcal/kg` figure and that this is about the size of the
current target, not about logged behaviour — explicitly distinct from the streak alert's copy, so an
athlete seeing both at once (a possible but not required combination) can tell they're different
findings rather than a duplicate.

This is informational only. It does not alter the buffer, `k`, or the daily target; it writes no
profile state; it is never fed to the LLM.

## Verification

Unit tests for `planEaKcalPerKg`: legacy model returns `null`; a derived model at this athlete's real
RMR/multiplier reproduces the ~28 kcal/kg figure from the review at `BUFFER_MIN_KCAL`; boundary cases
around the existing `25`/`40` `eaLevel()` edges: a value just below/above each band flips the level
correctly (reusing `eaLevel()` unchanged means these are really regression tests that the reuse stayed
wired correctly, not new threshold tests). Route coverage confirms `planEaLevel`/`planEaKcalPerKg` are
present in the GET and POST sync responses, in the generate response, and in the profile response, and
`null` for a legacy profile in all of them. A focused component test verifies the banner renders only
when `planEaLevel === "low"` and is silent for `"adequate"`/`"ample"`/`null`. The existing full check
(`npm run check`) remains the integration gate.
