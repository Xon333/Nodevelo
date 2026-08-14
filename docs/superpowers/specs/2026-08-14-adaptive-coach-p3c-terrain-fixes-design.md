# Adaptive self-directed coach — Phase 3c: terrain-matching fixes — Design scope

**Status:** Partially shipped 2026-08-14 — Gap B shipped in `5c8b473`; Gap A remains open because
the live 25-payload data gate found no usable minimum/trough-gradient field.

## 1. Purpose

Phase 3b (`docs/superpowers/specs/2026-08-12-adaptive-coach-p3b-interval-context-design.md`) shipped
gradient-fallback terrain matching and flagged two gaps for a future scoping session
(`docs/systems/02-scoring-and-learning.md` § Known rough edges, `ROADMAP.md`'s Phase 3b entry). This
phase closes both, scoped narrowly to `lib/intent-scoring.ts`'s terrain path — no other objective kind
is touched.

- **Gap A — compound lap.** A lap containing both a climb and a descent (a curated standing-effort
  interval with a short recovery descent baked in) reads only its peak-positive gradient and is graded a
  pure climb; the descent inside it is silently dropped.
- **Gap B — gradient-fallback overmatch.** When a ride has no meaningfully-segmented curated intervals,
  `filterByTerrain`'s gradient floor can qualify the entire ride as one lap, and `complianceDelta`'s
  one-sided "longer is never a failure" reward (correct for whole-ride duration claims) rewards a 10x
  duration overmatch as full compliance instead of flagging the mismatch. Live-smoke-confirmed
  2026-08-13 (see the doc's rough-edges entry for the exact reproduction: a stated "10 min climb"
  matched a 103-minute undivided lap).

## 2. Locked product decisions (this scoping session, 2026-08-14)

- **Gap B fix direction: disqualify, don't cap.** A gradient-fallback candidate whose duration grossly
  exceeds the stated claim is rejected outright (falls back to ungraded), not scored with a capped
  reward. This is consistent with `filterByTerrain`'s existing "never guess by elimination" precedent
  (design doc §7/`docs/INVARIANTS.md` item 56's neighborhood) rather than introducing a second, weaker
  compliance curve alongside `complianceDelta`.
- **Gap B fix is gradient-fallback only.** A label-matched lap (`hasLabelHint` true) is exempt — the
  athlete's own curation is real ground truth, not a fallback guess, matching Phase 3b's "label is the
  primary signal" decision (design doc §2).
- **Gap A fix scope: build the compound-lap detector now**, conditional on a live-verified data source
  (§4 below). If the raw payload turns out not to expose a usable min-gradient field, Gap A reverts to
  "flagged, not built" and stays a documented rough edge — this design does not authorize inventing a
  compound signal from stream data (the same fail-closed reasoning that already keeps segment-decoupling
  out of scope, `docs/systems/02-scoring-and-learning.md`'s "Segment decoupling is deliberately absent").
- **A compound lap is excluded from gradient-fallback candidacy for BOTH climb and descent** — not
  reinterpreted as one or the other. There is no sub-lap timeline in the curated-interval payload, so
  there is no honest way to say how much of the lap was climb vs. descent; exclusion is the only
  fail-closed option (mirrors `filterByTerrain`'s existing rule that absence of signal is not evidence).
- **Compound exclusion does not apply to a labelled lap.** An athlete who labels a lap "Climb" is making
  a deliberate claim about the whole lap regardless of its gradient shape; overriding that with a
  gradient heuristic would contradict "label is the primary signal" for no real benefit (the athlete
  wasn't confused about their own effort).
- **Evidence text stays generic.** Both fixes fall back to `gradeTerrain`'s existing
  `"no {terrain} found in the curated intervals"` ungraded message rather than adding new
  compound/overmatch-specific copy — consistent with this codebase's existing discipline of not
  inventing UI specificity beyond what's load-bearing (design doc §7's "never guess" text is already
  this terse for the ambiguous case). The interim curation workaround (curate one lap per climb, one per
  descent) already covers what an athlete needs to do about it.

## 3. Out of scope (explicitly deferred)

- Sub-lap terrain splitting (detecting exactly where within a compound lap the climb ends and the
  descent begins). No stream-level timeline is in scope for this phase, same boundary Phase 3b already
  drew.
- Any change to `complianceDelta` itself, or to duration/zone/effort grading. The fix is local to
  terrain candidacy and matching (`filterByTerrain`, `matchTerrain`), not the shared compliance curve.
- Retroactive re-scoring of ledger entries already graded under the old terrain logic — out of scope by
  the ledger's own append-only design (`docs/INVARIANTS.md` items 1-2 equivalent, `lib/score-log.ts`).
  New logic applies to newly-parsed intent overlays only.

## 4. Data verification required before implementation (Gap A)

Phase 3b's design doc found `maxGradientPct`'s raw key oddly cased (`Maxgradient`, capital M, no
underscore, unlike every other field on the payload) only by fetching real `/activity/{id}/intervals`
payloads and inspecting them directly (design doc §11). No prior investigation in this codebase has
confirmed a symmetric minimum-gradient field exists on the same payload — `Mingradient` is an assumption,
not a verified fact.

**Implementer's first step for Gap A**: fetch and inspect at least one real activity's intervals payload
(sandboxed, same pattern as Phase 3b's own verification) and confirm the actual raw key for a
per-interval minimum/lowest gradient value.
- If found: proceed with §5 below, using the verified key name (do not assume `Mingradient`'s casing
  mirrors `Maxgradient` without checking — the p3b design doc explicitly called that casing an outlier,
  not a pattern).
- If genuinely absent from the payload: Gap A cannot be built this phase without inventing data. Stop,
  leave `docs/systems/02-scoring-and-learning.md`'s compound-lap bullet as a documented rough edge (update
  its text to say the field was checked and found absent, so a future session doesn't re-ask the same
  question), and ship Gap B alone.

## 5. `ExecutedInterval` addition (Gap A, conditional on §4)

| Field | Raw source | Why |
|---|---|---|
| `minGradientPct: number \| null` | verified per §4 | The trough gradient over the lap — symmetric to `maxGradientPct`'s peak. A lap whose peak clears the climb floor AND whose trough clears the descent floor contains both, which the existing single-peak/single-average reads (`maxGradientPct`, `avgGradientPct`) cannot detect on their own. |

Additive, non-breaking, same mapping-boundary pattern as every existing gradient field
(`lib/intervals-api.ts`'s `fetchIntervals`).

## 6. Compound-lap detection & candidacy exclusion (Gap A)

```ts
const isCompoundLap = (lap: ExecutedInterval): boolean =>
  lap.maxGradientPct != null && lap.maxGradientPct >= CLIMB_GRADIENT_FLOOR_PCT &&
  lap.minGradientPct != null && lap.minGradientPct <= -CLIMB_GRADIENT_FLOOR_PCT;
```

Reuses the existing `CLIMB_GRADIENT_FLOOR_PCT` (Strava's 3% floor, already the climb/descent threshold)
symmetrically for both extremes — no new magic number.

`filterByTerrain`'s gradient-fallback branch (the `return candidates.filter((lap) => clearsGradientFloor(...))`
line) excludes any `isCompoundLap` candidate before applying `clearsGradientFloor`. The labelled branch
(`if (labelled.length > 0) return labelled`) is untouched — per §2, compound exclusion never applies to a
label-matched lap.

## 7. Gradient-fallback overmatch disqualification (Gap B)

```ts
// Same family as CLIMB_GRADIENT_FLOOR_PCT — a named, tunable constant, not an inline magic number.
// A gradient-fallback terrain match whose duration exceeds this multiple of the stated claim is treated
// as "wrong lap, not a generous ride" — see docs/systems/02-scoring-and-learning.md's rough-edges entry
// for the reproduction (10.3x overmatch on an undivided ride).
const TERRAIN_OVERMATCH_RATIO = 3;
```

In `matchTerrain`, after selecting `closest` (the existing closest-by-duration pick among qualifying
candidates), add one check before returning it:

```ts
if (!hasLabelHint(closest, terrain) && closest.durationSec > targetSec * TERRAIN_OVERMATCH_RATIO) {
  return []; // gradient-fallback match grossly exceeds the stated claim — don't guess, don't reward it
}
```

- Applies only in the duration-stated branch (`matchTerrain`'s `durationMin !== null` path) — the
  no-duration branch has no stated length to compare against, so it's unaffected and keeps its existing
  "exactly one qualifying candidate or nothing" rule.
- One-sided by construction (over-match only), deliberately asymmetric from `complianceDelta`'s own
  one-sided reward — here the same asymmetry cuts the other way: a lap *shorter* than stated is still a
  legitimate (if lower-scoring) match via `complianceDelta`'s existing under-match bands; a lap wildly
  *longer* than stated on the gradient-fallback path specifically indicates "no real candidate existed,"
  not "the athlete over-delivered."
- `hasLabelHint` is already defined and exported-in-file (`lib/intent-scoring.ts`); reused as-is, not
  duplicated (mirrors the reuse discipline the p3b plan enforced for `viEvidenceText`).

## 8. Interaction between the two fixes

Independent and composable: §6 shrinks the gradient-fallback candidate pool (removes compound laps before
ranking); §7 disqualifies whatever the pool's closest-duration pick turns out to be, if it's a gross
gradient-fallback overmatch. A ride can trigger both in sequence — e.g. a compound lap gets excluded by
§6, gradient-fallback then has nothing left, `qualifying.length === 0` returns `[]` before §7's check ever
runs. No ordering conflict; §7's check is unreachable when §6 already emptied the pool.

## 9. Implementation-planning constraints

- Gap A is conditional on §4's live verification — the implementation plan's first task must be that
  verification, with an explicit fork: proceed to §5-6 on success, or close out as "checked, absent" on
  the rough-edges doc and skip straight to Gap B on failure. Do not schedule Gap A's coding tasks before
  the verification task resolves.
- Reuse `CLIMB_GRADIENT_FLOOR_PCT` and `hasLabelHint` as-is; do not introduce parallel constants/helpers.
- No new persistence, no new API route, no new UI component, no `ExecutedInterval`/`IntentTarget` field
  beyond `minGradientPct` (and only if §4 confirms a source for it).
- Update `docs/INVARIANTS.md` with a new invariant covering both guarantees (compound-lap exclusion,
  gradient-fallback overmatch disqualification) — next available number is 57 as of this design.
- Update `docs/systems/02-scoring-and-learning.md`'s Known Rough Edges: both Phase 3b bullets (compound
  lap, overmatch) get resolved/closed language pointing at this phase, matching how prior phases closed
  out their own flagged bullets (e.g. the Phase 2c drift-signal-defects bullet).
- Update `ROADMAP.md`'s Phase 3b entry: the "two terrain-matching gaps flagged for a future scoping
  session" sentence is now stale once this phase ships — point it at this design/plan instead of
  describing the gaps as still-unscoped.
- Test fixtures: a compound-lap test needs both `maxGradientPct` and `minGradientPct` set on one
  fixture lap; an overmatch test needs a gradient-fallback (unlabelled) lap whose duration is >3x a
  stated claim, plus a control case at exactly the ratio boundary and one just under it (mirrors this
  codebase's existing boundary-testing convention for band functions like `complianceDelta`).

## 10. Research basis

Builds directly on Phase 3b's own research (§11 of that design doc) — no new external sources needed;
this phase's only open research question is §4's live data-shape check, which is implementation-time
verification, not desk research.
