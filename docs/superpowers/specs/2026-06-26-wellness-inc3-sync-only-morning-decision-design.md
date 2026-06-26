# Wellness Inc 3 — sync-only morning decision (retire the morning-check form)

> ⚠️ **SUPERSEDED (2026-06-26)** by
> [`2026-06-26-remove-subjective-wellness-manual-flag-design.md`](./2026-06-26-remove-subjective-wellness-manual-flag-design.md).
> The direction changed: instead of sourcing the morning read from synced subjective wellness, the subjective
> sync is removed entirely (reverting Inc 1 + Inc 2) in favour of a small manual "feeling ill / extreme
> fatigue" button. Kept for history; do not implement this one.

**Date:** 2026-06-26
**Status:** SUPERSEDED — not implemented
**ROADMAP:** "Subjective wellness from Intervals.icu — retire the morning-check form" → Inc 3
**Builds on:** Inc 1 (synced subjective wellness → `WellnessEntry`), Inc 2 (`wellnessToMorningAnswers` adapter + `deriveStrainHigh`/`resolveStrainBandsOverride`).

## Goal

Finish the sync-only pivot: the proactive "downgrade today?" morning decision is computed from **synced
Intervals.icu wellness** at request time, not captured in a NodeVelo form. Remove the form, its POST, and
the `morning-check.json` store. Keep the athlete-confirmed apply (move/defer/easy-cap the local plan).

This also lands the Inc 2 → Inc 3 wiring: the derived strain-high edge (`resolveStrainBandsOverride`),
built in Inc 2 but with no consumer, now feeds the live decision.

## Decisions made during brainstorming

1. **Illness comes from sync, no in-app input.** The athlete added a **sickness metric** to the
   Intervals.icu wellness tab; we sync it and map it to `IllnessLevel`. A dedicated in-app sickness button
   would just take space (rarely used). This closes the previously-flagged "no illness field" limitation.
2. **Apply UX = banner + one-click.** A Today-view banner surfaces a downgrade/easy-cap recommendation with
   an `[Apply]` button; nothing mutates the plan until the athlete clicks. (Not fully-automatic, not
   info-only.)
3. **Architecture = recompute on demand (Approach A).** The decision is a pure function of `(today's synced
   wellness, today's planned session, calibration settings, ledger)`. Computed wherever needed; **no
   persistence** — `morning-check.json` and its store are deleted. Can't go stale; deletes the most code.

## Architecture

A new pure helper centralises the decision so every caller shares one path:

```
syncedMorningDecision(
  wellnessForDate: WellnessEntry | null,
  plannedDay: CurrentBlockDay | null,
  objective: MorningCheckObjective,
  calibration: MorningCheckCalibration,
): MorningCheckDecisionResult | null
```

- Wraps the existing `wellnessToMorningAnswers(wellnessForDate)` → `decideMorningCheck(answers, objective, calibration)`.
- Returns `null` when there's no usable wellness row for the date (athlete didn't log) — callers render
  nothing / treat as `proceed`.
- `calibration.strainBands` is resolved via `resolveStrainBandsOverride(ledgerEntries, settings.strainBands)`
  (Inc 2 derived edge), not the plain `resolveStrainBands` — **this is the Inc 2 → Inc 3 wiring.**
- `objective` (isQualityDay, tsb, readiness, acwr) is built by the caller exactly as the current POST does.

The decision logic itself (`decideMorningCheck`) is unchanged.

## Components & changes

### Sync the sickness field
- `lib/types.ts` — `WellnessEntry` gains `sickness: number | null`.
- `lib/intervals-api.ts` — `fetchWellness` maps the new field. **⚠️ The API key + value range are
  UNCONFIRMED**; map defensively (absent → `null`), flagged 🔎 to confirm against a live payload — same
  discipline as the other synced subjective fields.

### Illness from sync
- `lib/morning-check.ts` — `wellnessToMorningAnswers` replaces the hard-coded `illness: "none"` with a
  mapping from `w.sickness` → `IllnessLevel`. Mapping shape depends on the confirmed field type:
  - if a 1–4 scale: `1 → none`, `2 → mild`, `3–4 → sick` (thresholds to confirm);
  - if a flag/boolean: present-and-set → `sick`, else `none`.
  Absent/unconfirmed → `none` (safe; strain + objective signals still drive the decision).

### Shared decision helper
- `lib/morning-check.ts` — add `syncedMorningDecision` (above).
- `proactiveApplyBlock` refactored: guard on the **decision value** (`MorningCheckDecision | null`) +
  `rideLoggedToday`, not a stored `MorningCheckEntry`.

### Route — `app/api/morning-check/route.ts`
- **GET** → returns the computed synced decision: `{ decision, reasons, isQualityDay, suggestion }`
  (suggestion = `suggestProactiveReschedule` preview when the decision isn't `proceed`).
- **POST removed** (no manual capture).
- **PUT** kept: recomputes the synced decision to guard, then runs the existing `applyProactiveReschedule` /
  `applyEasyCap` against the local block. Same response/notes ("mirror it on your Intervals.icu calendar").

### UI
- Replace `components/MorningCheckIn.tsx` (the 4-slider form) with a thin `components/MorningDecisionBanner.tsx`:
  GET the synced decision; if `downgrade`/`proceed-easy` and the ride isn't logged → show the recommendation +
  reason + `[Apply]` (PUT); otherwise render nothing.
- `components/dashboard/TodayView.tsx` — swap `<MorningCheckIn />` for `<MorningDecisionBanner />`.

### Coach-snapshot
- `lib/coach-snapshot.ts` — source the `morningCheck` decision from `syncedMorningDecision` (it already has
  sync + block) instead of the stored entry, so the LLM context matches the banner.

### Deletions
- `data/morning-check.json` (orphaned; no migration — the ledger already carries the wellness-derived
  context stamps from Inc 2).
- `lib/data-store.ts` — `readMorningChecks` / `writeMorningChecks`.
- `lib/types.ts` — `MorningCheckLog`, `MorningCheckEntry` (keep `IllnessLevel`, `MorningCheckDecision`).
- `lib/morning-check.ts` — `mergeMorningCheck`.
- `app/api/morning-check/route.ts` — the POST handler.
- `app/api/ask/route.ts` — stops reading the morning-check store.

## Data flow

1. Morning: athlete logs wellness (incl. sickness) in Intervals.icu.
2. Opens app → sync pulls wellness.
3. Today view GETs the synced decision.
4. If `downgrade`/`proceed-easy` and the ride isn't logged → banner shows recommendation + `[Apply]`.
5. Click → PUT moves/defers/caps the local plan; note tells the athlete to mirror it on the Intervals.icu
   calendar.

No in-app capture step — the accepted sync-only tradeoff.

## Edge cases (all degrade to "do nothing / proceed")

- **No wellness row for today** → helper returns `null` → banner hidden.
- **Not a quality day** → `decideMorningCheck` → `proceed` → no banner.
- **Ride already logged today** → `proactiveApplyBlock` blocks the apply; banner hidden.
- **Sickness field absent / shape unconfirmed** → `illness: "none"` → no illness-driven downgrade (identical
  to today); strain + objective signals still apply.
- **Settings change between syncs** → decision recomputes live every GET (never stale).
- **Stale sync** → the decision keys on today's wellness row only; an older row won't surface today's banner.

## Testing

- `syncedMorningDecision`: quality day + high synced strain → `downgrade`; non-quality → `proceed`; no
  wellness → `null`; synced sickness → `sick` → `downgrade`; a derived strain-high override shifts the band
  (Inc 2 → Inc 3 wiring).
- `wellnessToMorningAnswers`: `sickness` → `IllnessLevel` mapping (incl. absent → `none`).
- `proactiveApplyBlock`: decision-based guard (proceed → blocked, downgrade → allowed, ride-logged → blocked).
- Route: GET returns the computed decision; PUT applies/guards off the recomputed decision; POST gone.
- `decideMorningCheck` existing tests unchanged.
- Full suite + `tsc` green; Today view renders the banner on a downgrade and nothing on proceed.

## Deferred confirm (not a blocker)

The Intervals.icu `sickness` field's API key + value range — mapped defensively, flagged 🔎 to confirm
against a real wellness payload before relying on the illness path. Until confirmed it no-ops to `none`.

## Out of scope

- Fully-automatic (no-confirm) downgrade — ROADMAP §3 future sliver.
- Intervals.icu **calendar** mutation on apply (still local-block only; the note asks the athlete to mirror)
  — same boundary as the reactive `/api/reschedule` path.
- Re-centering the strain bands for the neutral-sleep range (RV2-15) — data-gated, tracked separately.
