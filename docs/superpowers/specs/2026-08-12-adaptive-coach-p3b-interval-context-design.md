# Adaptive self-directed coach — Phase 3b: curated-interval context — Design scope

**Status:** Shipped 2026-08-13 (PR #48), live-smoke-tested, Claude-reviewed. Phase 3c (2026-08-14)
fixed a gradient-fallback overmatch found after shipment. See [ARCHIVE.md](../../../ARCHIVE.md) §
Adaptive self-directed coach.

## 1. Purpose

Phase 2b/2c's intent-scoring (`lib/intent-scoring.ts`) grades a self-directed ride's note against
curated intervals using only duration, power and zone. Two real gaps follow from that:

- A note claim about anything else the athlete already selects intervals to see — heart rate ("stay
  under 154bpm"), cadence, or terrain ("did a climb") — has nowhere to attach and either gets dropped or
  misclassified as `qualitative`/unscored, even when the note states it as plainly as a power target.
- `ExecutedInterval` already carries `avgGradientPct`/`groupId`/`zone` (Phase 2c round 2, Task 11) with
  **zero consumers anywhere** — synced, never read. ROADMAP's Phase 3 gate ("do not infer terrain or
  widen the matching hierarchy" before this design) exists because Task 12's original attempt to use
  gradient for matching had no real data path and was narrowed away in round 3 review.

This phase closes both: extends `IntentTarget` with HR/cadence/terrain fields, extends `ExecutedInterval`
with the metrics needed to grade them, and generalizes `matchLaps` to route on whichever target field the
note actually stated — without inventing a multi-signal weighted-compliance formula (research turned up
no defensible industry-standard one to copy; see §8).

## 2. Locked product decisions

- **Label is the primary terrain match signal; gradient and VAM are *always* attached as evidence, not
  only as a fallback.** Confirmed directly with the athlete (2026-08-12): even a labelled interval
  should still surface gradient/VAM context. Label absence, not label presence, is what triggers
  gradient-based *matching* — but gradient/VAM evidence text is unconditional. Scoped to terrain only —
  using `label` to disambiguate other objective kinds (e.g. a labelled "Sprint" corroborating an `effort`
  claim) is a natural future extension but is not specified or built by this phase; §7's ranking rules
  only reference `label` for `terrain`-targeted objectives.
- **One target field drives ranking per objective.** The note states one primary claim per phase; this
  is deliberately not a weighted blend across power+HR+cadence+terrain. See §8 — no established
  multi-signal compliance formula exists to justify weighting one.
  **Resolved 2026-08-12 (R2/R5 scoping session):** enforced narrowly, not universally. Real athlete notes
  legitimately combine `durationMin`/`zone`/`reps` with exactly one of {power, HR, cadence, terrain} in
  one phase (e.g. "1h z2 HR cap at 152" — duration + zone + HR-ceiling together). `TargetSchema` gains a
  `.refine()` requiring at most one of {power (watts/targetPctFtp), targetHrBpm, targetCadenceRpm,
  terrain} per objective; `zone`/`durationMin`/`reps` are exempt, since they are never used as
  `matchLaps` ranking signals once a duration is stated. This also closes a same-target collision an
  earlier review found: without it, an `effort`-kind objective's target could carry a stray `terrain`
  value that `matchLaps`'s distance function checks first, silently hijacking that objective's ranking.
- **Terrain claims are existence+duration claims, never quality/technique claims.** "Did a climb of
  about this length happen" is gradeable; "was the descent well-executed" is explicitly out of scope
  (design doc §15: "Objective scoring of technical descending/cornering from speed alone"). `gradeTerrain`
  must not produce a skill grade.
- **HR/cadence targets are single ceiling/target values in v1, not ranges.** Matches the athlete's actual
  note style (today's real note: "If HR goes over 154bpm dial back to stay in z2" — a ceiling, not a
  range). Intervals.icu's own workout syntax supports ranges (`"200-220W"`, `"90-100rpm"`); ranges are a
  natural v2 if the athlete's notes start using them, not built speculatively now.
  **Resolved 2026-08-12 (R2 scoping session):** that same real note states no interval duration at all —
  it's a whole-ride claim, and real note history shows this is a recurring pattern, not a one-off (a
  second note: "I also made an effort to keep cadence stable and higher throughout the whole ride").
  `gradeEffort` grades an HR/cadence target with no stated `durationMin` against the whole ride's own
  `maxHr`/`avgCadence` — both already synced on `ActivitySummary` (`lib/intervals-api.ts:238-239,254`),
  zero new sync cost — instead of returning ungraded. A duration-stated claim still prefers the more
  precise per-lap match (§7); whole-ride grading is the fallback for the undurated case, not a
  replacement.
- **`distance` stays out of sync scope.** VAM only needs `elevationGainM` + `durationSec` (both in
  scope); Phase 2c's "no distance/GPS/position-locator system" decision is not reopened by this phase
  since nothing here needs it.
- **`groupId` is dropped from the design entirely.** Verified against three of the athlete's real rides:
  the raw value (`"237s@267w80rpm"`) is Intervals.icu's own auto-generated duration+watts+cadence bucket
  string, not athlete-curated, with no terrain semantics. It was already synced (Task 11) on a
  since-superseded assumption; this phase does not build anything on it and a future cleanup may remove
  the field if nothing else claims it.
- **No Strava segment-name resolution.** `segment_effort_ids` is real and populated in the athlete's
  data, but resolving it to a climb's actual name/category needs a new Strava API integration — out of
  scope for this phase.
- **No per-interval critical-power/W′ refit, no sensor fields (SmO2/lactate/DFA-a1/etc.), no torque, no
  speed, no per-interval training-load/strain/intensity.** No plausible note-phrase consumer for any of
  these; the CP/W′ refit specifically echoes `intervals-api.ts`'s own documented "eFTP trap" caution
  about noisy per-ride model refits, worse at per-interval granularity.

## 3. Data flow (unchanged shape, extended fields)

No new persistence, no new API route, no new store file. `ExecutedInterval[]` continues to be fetched
fresh per analysis via `fetchIntervals` (`lib/intervals-api.ts`) and consumed transiently by
`intent-scoring.ts` — never written to disk raw. Only derived `ScoredObjective`/evidence text persists,
inside the `IntentOverlay`, exactly as Phase 2b already does.

**Added 2026-08-12 (R2 scoping session):** `RideEvidence` gains `wholeRideMaxHr: number | null` and
`wholeRideAvgCadence: number | null`, sourced from `activity.maxHr`/`activity.avgCadence` — both already
synced at the whole-activity level, no new fetch. `intent-runner.ts` threads them onto `RideEvidence`
alongside the existing `powerZoneTimes`/`hrZoneTimes` fields when it builds evidence for
`scoreIntentExecution`.

## 4. `ExecutedInterval` additions

| Field | Raw source | Why |
|---|---|---|
| `maxHr: number \| null` | `max_heartrate` | An HR-ceiling claim needs peak, not just average — a lap whose average stayed under 154 but spiked to 170 briefly should read differently than one that never approached the ceiling. |
| `avgCadenceRpm: number \| null` | `average_cadence` | Cadence claims ("high cadence spin", "grinding low cadence"). |
| `maxGradientPct: number \| null` | `Maxgradient` (note the exact casing — capital M, no underscore, unlike every other snake_case field on this payload; verified live 2026-08-12, easy to mistype as `max_gradient`) | Verified against the athlete's own rides: `average_gradient` on a real interval read ~0.4% while `Maxgradient` on the same interval hit 14–15% — the mean washes out short pitches. Peak, not average, is the discriminating signal for "did a climb happen here." |
| `elevationGainM: number \| null` | `total_elevation_gain` | VAM input (§6). |
| `label: string \| null` | `label` | Athlete-typed free text on a manually curated interval — confirmed real and API-exposed via `iv.label` (`forum.intervals.icu/t/intervals-can-now-have-labels/1100`; confirmed accessible via the same field path `fetchIntervals` already reads, per a community custom-field script reading `activity.icu_intervals[i].label`). Zero-inference ground truth when present — the highest-confidence signal this phase adds. |

`avgGradientPct`/`zone` (already synced, Task 11) are unchanged. `groupId` stays synced (removing it is
a separate cleanup, not this phase's job) but gets no new consumer.

**Verification note for whoever implements this**: the three real payloads sampled during this design
(2026-08-12, three of the athlete's own recent rides) all had `label: null` on every interval — the
athlete hasn't started labelling yet. Don't write a test fixture assuming labels are already populated
in production data; the label-match path needs its own live-smoke verification once the athlete adopts
the habit, separately from this phase's initial ship (see §9's smoke-test note).

## 5. `IntentTarget` additions

```ts
export interface IntentTarget {
  durationMin?: number;
  watts?: number;
  targetPctFtp?: number;
  zone?: string;
  reps?: number;
  targetHrBpm?: number;       // NEW — ceiling, e.g. "under 154bpm"
  targetCadenceRpm?: number;  // NEW — target/ceiling cadence
  terrain?: "climb" | "descent"; // NEW — qualifier, not a numeric target
}
```

Additive, non-breaking — same pattern every prior field on this type used. The parallel Zod schema
(`lib/intent-schema.ts`'s `TargetSchema`/`PhaseSchema`) and prompt (`lib/intent-prompt.ts`) need the
matching update:

- `TargetSchema` gains `targetHrBpm: z.number().positive().optional()`,
  `targetCadenceRpm: z.number().positive().optional()`, `terrain: z.enum(["climb", "descent"]).optional()`.
- `TargetSchema` also gains a `.refine()` enforcing §2's scoped mutual exclusion (R5): at most one of
  {power (watts/targetPctFtp), targetHrBpm, targetCadenceRpm, terrain} may be set per objective;
  `zone`/`durationMin`/`reps` are exempt and may co-occur with any of them.
- `buildIntentPrompt` needs a new rule distinguishing an HR/cadence/terrain *target* (gradeable) from a
  qualitative skill/experience claim (still ungraded) — e.g. "did a climb" → `terrain: "climb"`
  (gradeable existence claim) vs. "the descent felt great" → stays `qualitative` (still a skill/feel
  claim, unaffected by this phase). This is the one place this phase touches LLM behavior; get the
  distinction right or terrain claims will over- or under-fire relative to the qualitative bucket.
- `INTENT_PROMPT_VERSION` bumps. One live smoke run required before this is done (AGENTS.md: "LLM-backed
  paths need one live smoke run") — read the actual model output against a real note, don't trust the
  schema change in isolation.

`zoneBasis` (`"power" | "heart-rate" | "unspecified"`) is existing, already-shipped precedent for
exactly this kind of generalization — an objective's grading metric already varies by what the note
stated, for zone-time objectives. This phase extends the same pattern to HR/cadence/terrain targets on
other objective kinds; it is not a new mechanism.

## 6. VAM (derived, not synced)

`VAM = elevationGainM / (durationSec / 3600)` — meters climbed per hour, computed at grading time from
already-present fields, no new sync cost. Established cycling metric (Michele Ferrari's *Velocità
Ascensionale Media*) with real reference points: club cyclists ~700-900 m/h, professional mountain-stage
efforts ~1650-1800 m/h. Used as evidence-text context on any terrain-matched or gradient-matched
interval, alongside gradient — not a scored dimension itself.

## 7. Matching — one generalized `matchLaps`, routed by target field

Duration stays the primary candidate filter (unchanged — RV-6's surge-resistance logic, matching by
length not power, stays exactly as is). Within the duration-filtered pool, exactly one secondary ranking
applies, chosen by which field the objective's `IntentTarget` actually set:

- `watts` / `targetPctFtp` set → rank by power distance (today's behavior, unchanged).
- `targetHrBpm` set → rank by `|avgHr − targetHrBpm|`; grading (§8) also reads `maxHr` for ceiling
  violations independent of ranking.
- `targetCadenceRpm` set → rank by cadence distance.
- `terrain` set → if any candidate's `label` case-insensitively contains `"climb"`/`"descent"` (or a
  small synonym set — implementer's call, keep it conservative, no fuzzy NLP matching, this is still
  "never invent specificity" territory), prefer it; otherwise rank by `maxGradientPct` — positive and
  ≥3% (Strava's own published climb-categorization floor,
  `support.strava.com/hc/en-us/articles/216917057-Climb-Categorization`) for `"climb"`, negative for
  `"descent"`.

A genuinely ambiguous match (no field set that the pool can rank on, or a terrain claim where nothing
clears the 3% floor and no label exists) stays ungraded — same "never guess" discipline Task 12's locked
decision already established for power/duration matching.

**Exception — whole-ride HR/cadence claims skip `matchLaps` entirely (R2, §2).** When `targetHrBpm` or
`targetCadenceRpm` is set with no stated `durationMin`, there is no per-lap window to match against; §8's
whole-ride grading path reads `RideEvidence.wholeRideMaxHr`/`wholeRideAvgCadence` directly instead. This
is the one HR/cadence/terrain grading path that does not go through `matchLaps` — a duration-stated claim
always prefers the matched-lap path above.

## 8. Grading

- **`gradeTerrain`** — new function, same shape as `gradeDuration`: did a climb/descent of roughly the
  stated length happen, yes/no + duration compliance. Never a quality grade (§2, §15's non-goal).
- **HR-ceiling grading** — inverse of `adherenceDelta`'s existing curve shape: over the ceiling is a
  penalty (using `maxHr` to catch a brief spike even when `avgHr` stayed under), at/under is neutral-to-
  positive. Mirror the existing power-adherence delta function's shape rather than inventing a new curve.
- **Cadence grading** — same shape as power adherence (distance from target), applied to
  `avgCadenceRpm`.
- **VI (`npWatts / avgWatts`, both already-synced, zero new sync cost) rides along as evidence text
  only** on any matched lap — "steady, VI 1.04" / "surged, VI 1.19" — never a scored dimension by itself.
- **Whole-ride HR-ceiling/cadence grading (R2, added 2026-08-12).** When no interval duration is stated,
  `gradeEffort` grades `targetHrBpm`/`targetCadenceRpm` against `RideEvidence.wholeRideMaxHr`/
  `wholeRideAvgCadence` using the same `hrCeilingDelta`/`adherenceDelta` curves as the matched-lap path,
  with `scopeMin` set to the full ride duration. This directly covers the phase's own motivating example
  ("if HR goes over 154bpm dial back to stay in z2" — no stated duration), which the matched-lap-only
  design left ungradable.
  **Missing data here is `ungraded()`, NOT "graded on presence" (R9 fix, 2026-08-12 review)** — unlike the
  matched-lap path, where a matched lap is itself real evidence even if one field on it is missing, there
  is no fallback signal at all for a whole-ride claim with no whole-ride HR/cadence data; treating it as
  scored would let zero real evidence both earn a neutral-positive delta and inflate `evidenceScope`
  enough to pass the minimum-evidence gate.
  **A stated `durationMin` does not always mean "match a curated lap" (R10 fix, 2026-08-12 review).** A
  real note pattern ("1h z2 HR cap at 152") combines `durationMin` with `zone` — that duration describes
  a whole-ride-scale or phase-scale portion of the ride, not a discrete curated interval, and Intervals.icu
  doesn't curate "steady zone-time" phases as laps. `gradeEffort` therefore routes to whole-ride grading
  whenever `zone` is set alongside `targetHrBpm`/`targetCadenceRpm`, regardless of whether `durationMin`
  is also stated — `zone` is the signal, matching this codebase's existing convention that zone-based
  claims are always graded from whole-ride aggregate data (`gradeZoneTime`/`gradeZoneEmphasis`), never
  from lap-matching. A duration-only HR/cadence claim with no `zone` (e.g. a genuinely short structured
  effort, "20 min at HR 165") still takes the matched-lap path as before. **Residual gap, not solved by
  this phase:** a large duration-only claim with no `zone` that's actually describing ride-scale riding
  (not a curated interval) can still misroute to lap-matching and fail to match — no real note in this
  phase's sample exhibited that shape, so it's flagged rather than speculatively solved.

**Why no weighted multi-signal formula**: researched TrainingPeaks' and Intervals.icu's own
planned-vs-actual compliance features directly. TrainingPeaks' compliance is a coarse duration/distance/
TSS color-band, not a documented weighted algorithm. Intervals.icu's own compliance % has multiple open
bug reports (wrong at high intensity, wrong for distance-based workouts —
`forum.intervals.icu/t/solved-plan-compliance-incorrect-at-high-intensity-session/61734`,
`forum.intervals.icu/t/compliance-to-plan-for-distance-based-swimming-workouts/11515`). Nothing
defensible to copy. This app's existing per-claim independent grading (never one blended score) is
already more rigorous than either — extend it, don't replace it with a fabricated weighting scheme.

## 9. Presentation

No new UI component. Extends `RideIntentBlock`'s existing evidence rendering (Phase 2c,
`components/dashboard/ride-intent.tsx`). Evidence strings always include gradient + VAM context on a
terrain-matched or gradient-matched lap, regardless of whether the match came via label or gradient
fallback, e.g.:

- `"8 min on the climb (labelled) — avg 6.2%, VAM 780 m/h"`
- `"8 min matched by gradient — avg 6.2%, max 11%, VAM 780 m/h, no label found"`

**Live-smoke requirement**: because the athlete's real rides currently have no labels set (§4), the
initial ship's live smoke run (AGENTS.md) will necessarily exercise only the gradient-fallback path. The
label-match path needs a second, separate live-smoke check once the athlete has actually labelled a ride
— flag this explicitly in the implementation plan's acceptance criteria rather than letting "one smoke
run" quietly stand in for both paths.

## 10. Explicit non-goals for this phase

Strava segment-name resolution (`segment_effort_ids`), per-interval CP/W′ refits, HR/cadence *ranges*
(v1 is ceiling/target only), speed, torque, per-interval training-load/strain/intensity, per-interval
`decoupling` (real and synced-for-free if ever wanted, but no consumer built here — flagged in
`docs/systems/02-scoring-and-learning.md` as a future unlock for the already-deferred segment-scoped-
drift item, not this phase's job), `groupId` cleanup/removal, any change to the planned-ride adherence
path (`lib/interval-match.ts` stays duration+power only, untouched by this phase).

## 11. Research basis

- [Strava Climb Categorization](https://support.strava.com/hc/en-us/articles/216917057-Climb-Categorization) — 3% average-gradient floor for "counts as a climb"; length×gradient scoring formula (borrowed conceptually for the ≥3% floor, not the full category-scoring, which this phase doesn't need).
- [VAM (bicycling) / Cycling Weekly explainer](https://www.cyclingweekly.com/fitness/what-is-vam-and-can-i-use-it-to-improve-my-climbing) — vertical-meters-per-hour formula and real reference ranges.
- [Intervals.icu: "Intervals can now have labels"](https://forum.intervals.icu/t/intervals-can-now-have-labels/1100) and [accessing labelled interval properties via the API](https://forum.intervals.icu/t/how-to-access-labelled-interval-properties-in-custom-activity-fields/130562) — confirms `label` is real, athlete-set free text, API-exposed as `iv.label`.
- [Intervals.icu: interval type is WORK/RECOVERY/REST only, auto-assigned](https://forum.intervals.icu/t/change-interval-type-work-recovery/10100) — confirms `type` can never carry terrain semantics.
- [Intervals.icu: average_gradient is signed](https://forum.intervals.icu/t/feature-request-positive-and-negative-average-gradient-for-the-interval-field/47649) — `(finish altitude − start altitude) / distance`, positive=climb/negative=descent, matching what was observed empirically.
- [Intervals.icu: climb detection/categorization is not a native feature](https://forum.intervals.icu/t/climb-detection-and-categorization/46900) — only available via athlete-written custom-field formulas (FIETS index, Strava's own formula) — confirms there's no platform-native classification to lean on instead of building this.
- [Intervals.icu Workout Builder syntax](https://forum.intervals.icu/t/workout-builder-syntax-quick-guide/123701) — confirms HR and cadence are already first-class target types on this same platform (`"1km 70% HR"`, `"90-100rpm"`), while gradient has no native target syntax at all — the basis for §5's asymmetric treatment (HR/cadence as real numeric targets, terrain as a qualifier).
- Direct API verification: three of the athlete's own real activities' `/activity/{id}/intervals` payloads were fetched and inspected during this design session (files deleted after inspection, not retained) — the source for `Maxgradient` vs `average_gradient` divergence, `groupId`'s auto-generated shape, and `label: null` across all sampled intervals.

## 12. Implementation-planning constraints

Mirrors the original design doc's §17: trace and reuse existing seams before proposing new files.
Specifically —

- extend `ExecutedInterval`/`IntentTarget` additively (§4/§5), never break existing callers;
- reuse `matchLaps`'s existing duration-filter/RV-6 alignment logic — this phase adds ranking branches,
  not a parallel matcher;
- reuse `adherenceDelta`'s curve shape for the new HR-ceiling and cadence grading rather than inventing
  new delta functions from scratch;
- bump `INTENT_PROMPT_VERSION`, one live smoke run against a real note before calling the LLM-facing
  change done, plus the separate label-match smoke run once labels exist in real data (§9);
- update `docs/INVARIANTS.md` if any new invariant is warranted (e.g. "terrain claims are never graded
  on technique," mirroring how existing invariants pin other locked decisions) and
  `docs/systems/02-scoring-and-learning.md`'s Known Rough Edges with a cross-reference to the deferred
  per-interval-decoupling unlock (§10);
- keep the permanent production surface small — no new store file, no new API route (§3).

The implementation plan may choose exact function names and file boundaries. It may not change the
locked decisions in §2 without returning to design review.
