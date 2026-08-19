# Segment-aware self-directed intent scoring — Design

**Status:** Approved for implementation planning 2026-08-19; not yet implemented.

## Purpose

NodeVelo currently grades phase-scoped zone claims against whole-ride zone totals. On activity
`i177434779`, four athlete-labelled Intervals.icu segments all met their stated duration, average-power
zone, and normalized-power zone, but the parser converted those claims into `zone-time` objectives and
the scorer merged different segments by zone. The result was a misleading 5/10.

This change makes athlete-curated Intervals.icu labels authoritative segment boundaries, preserves the
distinct meanings of average power and normalized power, removes the temporary generic-score flash
while intent is being evaluated, and prevents contextual text such as “after a rest day” from
classifying a ridden session as `Rest`.

## Locked decisions

1. A named segment is one objective containing its label, duration or duration range, average-power
   zone, and normalized-power zone. These fields are not decomposed into independent `zone-time`
   objectives.
2. Intervals.icu labels are the primary and only segment-boundary signal. No stream inference or
   duration-only fallback is introduced.
3. Matching is conservative: normalize case, whitespace, punctuation, and the generic word `segment`;
   accept a trailing numeric suffix on the Intervals label when the stated label has none. A fallback
   match must be unique. Ambiguity or absence is ungraded, never guessed.
4. A curated lap is consumed once. Different segment labels never merge merely because they share a
   zone. Exact duplicate objectives may still deduplicate.
5. Average-power zones are graded from `ExecutedInterval.avgWatts`; normalized-power zones are graded
   from `ExecutedInterval.npWatts`. NP is never translated into “minutes in zone.”
6. Zone lookup uses the effective-dated Intervals.icu power-zone boundaries from `physiologyAsOf` for
   the ride date. The frozen ledger FTP remains the percentage anchor. Missing boundaries or metrics
   withhold that segment grade; they do not become failures or population guesses.
7. `durationMin` remains the exact target when no upper bound exists. For a stated range,
   `durationMin` is the inclusive lower bound and `durationMaxMin` is the inclusive upper bound.
8. A fully compliant, correctly ordered set of named segments normally scores 9/10. A 10/10 requires
   every scored segment to meet the stricter precision criteria in this document.
9. Existing genuinely whole-ride `zone-time` and `zone-emphasis` objectives retain their current
   aggregate-array behavior. This change routes only named, interval-backed phases through segment
   scoring.
10. Existing overlays and frozen ledger rows are not rewritten. New/forced parses use bumped intent
    prompt, scoring, and overlay schema versions.
11. While a noted, unplanned ride has no applicable overlay and deferred intent analysis is active,
    Today shows `Evaluating your intent…` instead of the generic intrinsic score. An already-resolved
    overlay remains visible during manual re-analysis.
12. Workout-type detection checks stated phases before using `Rest` as a fallback. A real recovery
    purpose still resolves as `Recovery`; a note with no ridden zones may still resolve as `Rest`.

## Structured intent

Add `segment` to `ObjectiveKind` and these optional `IntentTarget` fields:

```ts
segmentLabel?: string;
durationMaxMin?: number;
avgPowerZone?: string;
normalizedPowerZone?: string;
```

A valid segment objective requires `segmentLabel` plus at least one measurable target among duration,
average-power zone, or normalized-power zone. `durationMaxMin` requires `durationMin` and must be greater
than or equal to it. `zoneBasis` is `power` when average or normalized power is explicitly stated; NP
is itself an explicit power metric, not an assumed basis.

The phase schema carries the same segment fields so `StructuredIntent.phases` preserves enough stated
information for display and workout-type provenance. The parser still sees only the note and ride
duration. It never sees laps, zones, FTP, scores, or compliance.

Grounding verifies every new field against the objective's `sourceText`/note. Both ends of a duration
range must occur with a duration unit. Segment labels use conservative token presence, and average/NP
zone fields require their respective `avg`/`average` or `NP`/`normalized power` qualifier near the zone.

## Deterministic matching and grading

### Label matching

`segmentLabelKey` lowercases, removes punctuation/whitespace, and removes the standalone word
`segment`. Matching order:

1. exact normalized key;
2. actual key equals target key plus digits, only when the target has no trailing digits;
3. accept only if exactly one unused lap matches.

No substring, edit-distance, duration, terrain, or zone fallback is allowed. Each selected lap is
removed from the segment pool.

### Component grading

A label match is required before any component is graded.

- Exact duration is compliant at 85–115% of target; 70–130% is partial; outside is missed.
- A duration range is compliant inside its inclusive bounds; within 15% outside the nearest bound is
  partial; farther outside is missed.
- Average-power and NP targets are compliant when the corresponding watts resolve to the stated zone;
  an adjacent zone is partial; any farther zone is missed.
- If a stated power metric, FTP anchor, or zone boundary is unavailable, the whole segment objective is
  ungraded rather than being scored from duration alone.

Component values are `1` (compliant), `0.5` (partial), or `0` (missed). Their mean maps to the segment
delta: `1 => +3`, `>=0.75 => +2`, `>=0.5 => 0`, `>=0.25 => -2`, otherwise `-3`. The existing per-kind
mean and clamp apply with a `segment` band of `[-3, +3]`.

Named segment order is deterministic from objective order and matched `startIndex` values. When at
least two segment objectives match and every known start index is strictly increasing, add one
reward-only point. If any start index is absent or order is wrong, add no point and no penalty.
Segment-backed order owns this fact; a same-source `structure` objective is subsumed so it cannot add a
second order point.

Precision adds one final point only when every scored segment is fully compliant and precise:

- exact duration within 5% of target, or ranged duration inside the middle half of its range; and
- every stated average/NP value lies inside the middle half of its target zone's watt band.

Open-ended top zones cannot earn the precision bonus. Thus complete ordered execution is
`5 baseline + 3 segment + 1 order = 9`; all-segment precision adds the tenth point.

The current ride is the locked acceptance fixture:

| Segment | Result | Expected |
|---|---:|---|
| Rolling Terrain 1 | 21:52, 238 W avg, 263 W NP | 20m, Z3 avg, Z4 NP — compliant |
| Flat 1 | 54:09, 220 W avg, 232 W NP | 45–60m, Z3 avg — compliant |
| Flat 2 | 19:16, 190 W avg, 214 W NP | 20m, Z2 avg — compliant |
| Short Effort | 6:51, 285 W avg, 309 W NP | 6m, Z4 avg, Z5 NP — compliant |

With FTP 288 W and ride-date zone tops `[55, 75, 90, 105, 120, 150, 999]`, the result is 9/10 and
none of the evidence may mention whole-ride minutes in Z2–Z5.

## Canonicalisation and scoreability

Segment identity includes label, lower/upper duration, average zone, and NP zone. Stage 2 never sums
segments. A segment objective subsumes duration/zone-time/zone-emphasis/structure decompositions from
the same source span. Existing canonicalization order remains load-bearing.

Evidence scope remains the existing maximum objective scope, not a fabricated union. A matched
segment's scope is its lap duration. The 54-minute Flat 1 segment clears the current ride's 33% gate.
This design does not alter scope aggregation for unrelated objectives.

## Deferred UI state

No API or persisted `pending` field is needed. `SyncProvider` already owns `analyzing`, and
`TodayRideCard` already receives it. When all of these are true—unplanned ride, non-empty activity note,
no applicable overlay, and `analyzing`—the score row renders `Evaluating your intent…`. Metrics and ride
facts remain visible. Once the final sync-query invalidation returns the overlay, the effective score
replaces the pending copy. Manual re-analysis never hides an existing overlay score.

## Versioning and compatibility

- Bump `INTENT_PROMPT_VERSION` because the tool instructions/output semantics change.
- Bump `INTENT_SCORING_VERSION` because the deterministic score changes.
- Bump the overlay schema version for newly written overlays.
- Do not bump the unrelated block-generation `PROMPT_VERSION`.
- Do not retro-score frozen ledger entries or rewrite historical overlays.
- Force-reanalyse today's activity after deployment; supersession remains the existing transactional
  append path.

## Testing and verification

Tests must cover schema rejection, field-specific grounding, label normalization and ambiguity,
single-use laps, no cross-label merge, avg-versus-NP semantics, missing-data withholding, duration and
precision boundaries, ordering, the 9/10 live acceptance fixture, whole-ride regression behavior,
pending-score UI behavior, and Rest fallback precedence.

Run targeted Vitest suites first, then `npm run check`. Because the intent prompt changes, run one live
forced re-analysis against activity `i177434779`, read the persisted overlay and visible debrief, and
confirm 9/10 with segment-local evidence before calling the work complete.

## Out of scope and follow-up reminder

- Stream-inferred phases when curated labels are absent.
- Segment decoupling; it still requires the separately documented stream-quality investigation.
- The remaining unlabelled compound climb/descent terrain fallback.
- Retrospective repair of older overlays beyond today's forced acceptance run.
- Coach-note prose redesign beyond consuming the corrected overlay through the existing sequence.

After this work ships, explicitly remind the user about the two unrelated open rough edges: segment
decoupling and the unlabelled compound climb/descent terrain fallback.
