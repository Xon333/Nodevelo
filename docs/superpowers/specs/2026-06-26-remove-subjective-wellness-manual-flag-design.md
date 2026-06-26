# Remove subjective wellness sync → a manual "feeling ill / extreme fatigue" button

**Date:** 2026-06-26
**Status:** design approved, implementing directly (user waived the spec-review gate)
**Supersedes:** `2026-06-26-wellness-inc3-sync-only-morning-decision-design.md` (Inc 3) and reverts Inc 1 + Inc 2.

## Why

The synced subjective metrics (soreness/fatigue/stress/mood/motivation/injury + the strain edge) are
**latent or dead** in shipped code: `stress/mood/injury` are read by nothing; `fatigue/soreness/motivation`
only feed a composite `strain` stamped onto the ledger that dead-ends at `resolveStrainBandsOverride` (no
live consumer — Inc 3 was never built). The aspirational payoff (a per-athlete subjective→execution
learning loop) is speculative, noisy, and un-utilitarian — and a future wearable will give **objective**
morning-readiness (HRV/sleep/resting-HR) that's strictly better and folds into the existing readiness/
athlete-state signals. So: drop the subjective sync, keep one cheap manual override.

## Scope

**Removed (revert Inc 1 + Inc 2):**
- Subjective fields off `WellnessEntry` + `fetchWellness`: `soreness, fatigue, stress, mood, motivation, injury`.
- `wellnessToMorningAnswers`, `strainScore`, `MorningCheckAnswers` (the sync adapter).
- Strain edge in `calibration.ts`: `StrainBands`, `DEFAULT_STRAIN_BANDS`, `resolveStrainBands`,
  `isStrainBandsOverridden`, `STRAIN_HIGH_SPEC`, `deriveStrainHigh`, `resolveStrainBandsOverride`.
- `settings.strainBands` (block-settings + the settings route accept).
- Ledger morning stamp: `RideScoreEntry.morningCheck`, `RideMorningContext`, `RideEntryContext.morningCheck`,
  and the sync-route stamp + `score-log` carry-forward of it (it only fed the deleted strain edge).
- RV2-15 (todo) — moot once the strain edge is gone.

**Kept untouched:**
- All objective wellness: `weightKg, ctl, atl, hrv, sleepHours, sleepQuality, kcalConsumed` → TSB, readiness,
  ACWR, fatigue alerts, nutrition weight-trend.
- `deriveTsbDeepFatigue` (objective TSB edge) and the shared correlation engine.
- All RV2 accuracy fixes, the reschedule machinery (`applyProactiveReschedule`, `suggestProactiveReschedule`,
  `deferredQuality`), the `formState` ledger stamp.

## The new morning feature

**UI** — replace the 4-slider `MorningCheckIn` with a small Today control: two buttons, **Feeling ill** and
**Extreme fatigue**. Default state shows nothing actionable.

**Decision** — `decideMorningCheck` collapses to:
```
flag: "ill" | "extreme-fatigue" | "none"
decision = isQualityDay && flag !== "none" ? "downgrade" : "proceed"
```
- No strain, no objective inputs, no `proceed-easy`/neck-check, no easy-cap.
- `MorningCheckDecision` becomes `"proceed" | "downgrade"`.
- `MorningCheckEntry` becomes `{ date, flag, decision, setAt }`.
- Objective deep-fatigue is still surfaced by `computeReadiness` / `computeFatigueAlert` as today — this
  feature is purely the manual override.

**Flow** — tap a button → POST stores the flag + computes the decision → if `downgrade`, the UI shows the
`suggestProactiveReschedule` preview + **[Apply]** → PUT runs `applyProactiveReschedule` on the local block
(unchanged "mirror it on your Intervals.icu calendar" note). The store/POST/PUT machinery is reused, shrunk.

**Coach-snapshot** — surfaces "reported feeling ill / extreme fatigue → downgraded today" instead of the
slider readout; sources from the (simplified) morning-check store.

## Routes

- `app/api/morning-check/route.ts`:
  - **GET** → `{ check, isQualityDay, suggestion }` (check = stored flag entry or null).
  - **POST** → parse `flag` (ill | extreme-fatigue), compute the trivial decision, store, return
    `{ decision, reasons, suggestion }`. Drop the 4-rating parse, the objective-signal computation
    (`computeReadiness`/`computeAcwr`), and the strain-band resolve.
  - **PUT** → downgrade-only apply (drop the `applyEasyCap` branch); otherwise unchanged.
- `app/api/settings/route.ts` — drop `strainBands` accept/preserve.
- `app/api/ask/route.ts` — still reads the (simplified) morning-check store; surfacing adjusted to the flag.

## Edge cases

- Not a quality day → `proceed` (nothing to downgrade); button shows but applies nothing.
- Ride already logged today → `proactiveApplyBlock` blocks the apply (unchanged guard).
- No flag set → `proceed`; no banner/preview.
- Objective deep fatigue with no button press → unchanged: surfaced by `readiness`, not by this feature.

## Testing

- `decideMorningCheck`: quality day + `ill` → downgrade; + `extreme-fatigue` → downgrade; + `none` → proceed;
  non-quality + any flag → proceed.
- `proactiveApplyBlock`: proceed → blocked, downgrade → allowed, ride-logged → blocked.
- Route: POST stores the flag + decision; PUT downgrades + guards; GET returns the stored flag.
- Remove the strain-edge tests (`deriveStrainHigh`/`resolveStrainBandsOverride`) and adapter tests
  (`wellnessToMorningAnswers`/`strainScore`).
- Update every `WellnessEntry` / `MorningCheckEntry` fixture across the suite to the trimmed shapes.
- Full suite + `tsc` green; Today view renders the two buttons and a downgrade preview/apply on tap.

## Out of scope

- Intervals.icu **calendar** mutation on apply (still local-block only; the note asks the athlete to mirror).
- Objective auto-downgrade without a button press (readiness already covers it).
- Wearable objective morning-readiness — the future replacement for this manual override.
