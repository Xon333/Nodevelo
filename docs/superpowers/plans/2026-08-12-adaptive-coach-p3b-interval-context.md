# Adaptive self-directed coach — Phase 3b: curated-interval context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a self-directed ride's note claim HR ("stay under 154bpm"), cadence, or terrain ("did a
climb") get graded against curated intervals the same way duration/power/zone claims already are —
label-matched first, gradient/VAM always attached as evidence context.

**Architecture:** Extend `ExecutedInterval` with the metrics Intervals.icu already computes per curated
interval (`maxHr`, `avgCadenceRpm`, `maxGradientPct`, `elevationGainM`, `label`) and `IntentTarget` with
the new claim shapes (`targetHrBpm`, `targetCadenceRpm`, `terrain`). Generalize `matchLaps` to rank
candidates by whichever target field an objective actually stated (one field drives it, never a blend);
add a new `terrain` `ObjectiveKind` graded by existence+duration (never technique); extend `gradeEffort`
with HR-ceiling and cadence grading branches. No new persistence, no new API route, no new UI component —
`RideIntentBlock` already renders any measurable objective's `description`/`evidence` generically
(verified by reading it; Task 9 adds a test proving it rather than just asserting it).

**Tech Stack:** Next.js 16 (App Router), TypeScript 5, Vitest, `@testing-library/react` (jsdom).

## Global Constraints

- **One target field drives ranking per objective — enforced narrowly (resolved 2026-08-12, R5 scoping
  session).** Never a weighted multi-signal blend — no defensible industry-standard formula exists to
  justify one (design doc §8). At most one of {power (watts/targetPctFtp), targetHrBpm,
  targetCadenceRpm, terrain} may be set per objective, schema-enforced (Task 3). `zone`/`durationMin`/
  `reps` are exempt and may co-occur with any of them — real notes combine them (e.g. "1h z2 HR cap at
  152"), and none of the three are ever used as a `matchLaps` ranking signal once a duration is stated.
- **Terrain claims are existence+duration, never quality/technique.** `gradeTerrain` must never produce
  a skill grade (design doc §15's non-goal on descending/cornering technique).
- **Label is the primary terrain match signal; gradient/VAM are *always* attached as evidence**,
  regardless of whether the match came via label or gradient fallback.
- **A genuinely ambiguous match stays ungraded — never guess.** Mirrors the existing zone-only-candidate
  rule (`matchLaps`'s `candidates.length === 1 ? candidates : []`).
- **HR/cadence targets are single ceiling/target values in this phase, not ranges.**
- **An HR/cadence target grades against the WHOLE ride, not a matched lap, when no duration is stated OR
  a `zone` is stated alongside it (resolved 2026-08-12, R2 + R10).** The phase's own motivating note ("if
  HR goes over 154bpm dial back to stay in z2") states no duration; a second real note combines a
  duration WITH a zone ("1h z2 HR cap at 152") — that duration describes a whole-ride-scale zone phase,
  not a discrete curated interval, so it must not route through `matchLaps`'s duration window either.
  `RideEvidence` gains `wholeRideMaxHr`/`wholeRideAvgCadence`, sourced from
  `activity.maxHr`/`activity.avgCadence` — already synced on `ActivitySummary`, zero new sync cost
  (Task 8, Step 3). `gradeEffort` grades against these instead of the matched-lap path in both cases
  (Task 8, Step 5). Missing whole-ride data is `ungraded()`, not a presence-based delta (R9) — there is no
  fallback evidence the way a matched lap provides one. A duration-stated claim with NO zone still prefers
  the more precise matched-lap path — whole-ride grading is the fallback there, not a replacement.
- **`Maxgradient` is the raw field's exact casing** — capital M, no underscore, unlike every other
  snake_case field on the same payload. Verified live 2026-08-12. Easy to mistype as `max_gradient`.
- **`distance` and `groupId` are out of scope.** VAM only needs `elevationGainM`/`durationSec` (both in
  scope); `groupId` is Intervals.icu's own auto-generated duration+watts+cadence bucket string, no
  terrain semantics, gets no new consumer.
- **No Strava segment resolution, no per-interval CP/W′, no sensor fields, no torque/speed/per-interval
  training-load/strain/intensity.** No plausible note-phrase consumer for any of these.
- **`INTENT_PROMPT_VERSION` bumps; one live smoke run is required before this is done** (AGENTS.md:
  "LLM-backed paths need one live smoke run") — **and a second, separate smoke run once the athlete has
  actually labelled a ride**, since all real data sampled during design had `label: null` everywhere
  (Task 11 covers the first; the second is the athlete's to trigger later, noted in Task 11's Step 3).
- **Adding `"terrain"` to `ObjectiveKind` makes the TypeScript compiler enumerate every switch statement
  over that union that needs a case — resolved to close immediately, not defer (R8b fix, 2026-08-12
  second review round).** Task 3, Step 4 runs `npx tsc --noEmit` right after adding the type, lets the
  compiler's own error list be the authority on what needs a case (rather than trusting this plan's
  enumeration is exhaustive), and closes each one with a throwaway placeholder in the same step — so the
  build stays green through Tasks 4-6 instead of staying red until Task 7. Task 7 then REPLACES each
  placeholder with real logic; it does not add new cases.
- **Task ordering matters here more than usual.** Task 7 (the `terrain` kind's grading) calls `matchLaps`
  expecting Task 6's (matchLaps generalization) shape to already exist — do these two in numeric order,
  not the reverse. Also: **Task 8 reuses `viEvidenceText`, defined in Task 7** (R11 fix, 2026-08-12 second
  review round) — do not redefine it in Task 8; if Task 7 and Task 8 are ever executed out of order or by
  separate agents, Task 8 must confirm the helper already exists rather than duplicating it.

---

## Revision log (2026-08-12) — two rounds of external review, all findings resolved below

This plan went through two rounds of external review (codex) before any task was executed, each
independently re-verified against the current source before any fix was made. **All eleven findings
across both rounds are now resolved directly in the task text below** — this log is a pointer to where,
not a to-do list. No open blockers remain; this plan is implementation-ready as written.

### Round 1 (R1-R8): 2 blockers, 5 correctness issues, 1 execution-plan defect

Two of the eight (R2, R5) needed a genuine product/design decision, not just a code fix — that decision
was made in a follow-up scoping session grounded in the athlete's real note history
(`data/last-sync.json`), not guessed.

- **R1 — grounding coverage.** `verifyGrounding` didn't check the three new target fields, so an invented
  HR/cadence value could pass on another field's coattails while a terrain-only objective was rejected
  outright (INVARIANT 44 violation). Fixed in **Task 3, Step 7** — `groundsHrBpm`/`groundsCadenceRpm`/
  `groundsTerrain` added, wired into `verifyGrounding`.
- **R2 — the motivating HR use case was ungradable.** The real "154bpm" note states no interval duration;
  `gradeEffort` required one before any HR branch ran. **Resolved as a design decision** (scoping session,
  this file's design doc §2/§5/§7-8): an HR/cadence target with no stated duration now grades against the
  whole ride, using already-synced `activity.maxHr`/`activity.avgCadence`. Fixed in **Task 8, Steps 3-5**
  (`RideEvidence` extension, `gradeWholeRideHrCeiling`/`gradeWholeRideCadence`, the early-return
  restructure) and verified end-to-end (not just parsing shape) in **Task 11, Step 4**'s checklist item 3.
- **R3 — terrain duration grading contradicted terrain matching.** The ±20% duration pre-filter excluded a
  terrain-qualified lap before `gradeTerrain` could apply its own compliance-vs-stated-duration penalty,
  contradicting the plan's own test. Fixed in **Task 6, Step 3** — terrain candidacy now comes entirely
  from `filterByTerrain` (label/gradient); a stated duration only picks the closest qualifying candidate,
  never excludes one.
- **R4 — descent detection used the wrong gradient statistic.** `maxGradientPct` (a peak/most-positive
  sample) is the wrong extremum for descent detection — one flat or uphill moment anywhere in a real
  descent could defeat it. Fixed in **Task 6, Step 3** — descent now reads `avgGradientPct` (already-synced,
  signed, net-over-the-lap); climb keeps `maxGradientPct` (still the right statistic there). VAM-on-descent
  evidence fixed in **Task 7, Step 6** (VAM shown for climbs only). The related, distinct same-lap
  climb+descent blind spot is out of scope for this phase and tracked separately in
  [docs/systems/02-scoring-and-learning.md § Known rough edges](../../systems/02-scoring-and-learning.md#known-rough-edges).
- **R5 — "one target field drives ranking" wasn't enforced.** **Resolved as a design decision** (same
  scoping session — a real note combines `durationMin`+`zone`+`targetHrBpm` in one phase, so a blanket
  ban was wrong): `zone`/`durationMin`/`reps` may co-occur with any target field; power/HR/cadence/terrain
  stay mutually exclusive. Fixed in **Task 3, Step 5** — `TargetSchema` gains a `.refine()` enforcing
  exactly that, closing a same-target `matchLaps` collision risk as a side effect.
- **R6 — gradient matches could be falsely reported as label matches.** `gradeTerrain`'s "(labelled)" tag
  checked for any non-empty label, not one that actually matched the terrain. Fixed in **Task 7, Step 6**
  — now checks `hasLabelHint(primary, terrain)`, with a regression test for an irrelevant non-empty label.
- **R7 — live-smoke instructions could mutate real persisted state.** The original Task 11 suggested
  exercising `/api/intent` against the primary data store, which persists via `runIntentParsing`. Fixed in
  **Task 11, Steps 1-3** — now uses the same sandboxed-`NODEVELO_DATA_DIR` pattern Phase 2b's Task 9
  already established, not a new mechanism.
- **R8 — task-sequence gaps.** (a) Task 2's fixture-patch file list missed `lib/interval-match.test.ts` —
  fixed, added as Step 6 there. (c) Task 3's proposed `PhaseSchema` additions were dead surface (never
  consumed by `anthropic-api.ts`'s field-by-field phase mapping) — fixed by dropping them from
  `PhaseSchema` in **Task 3, Step 5**; they're only ever needed on `objectives[].target`, already covered
  there. (b) is superseded by R8b below — round 1 left the red-build window as documented/intentional;
  round 2 asked for it to close instead.

### Round 2 (R9, R10, R8b, R11): re-review of the round-1 fixes themselves

Round 1's R2/R5 fixes introduced their own gaps, caught on re-review of the actual code this time (not
just the design). Fix order requested: R9 → R10 → R8b → R11.

- **R9 — whole-ride missing-data earned a score and passed the evidence gate.** `gradeWholeRideHrCeiling`/
  `gradeWholeRideCadence` (Task 8) returned `delta: 1, scored: true` with the FULL ride's `scopeMin` when
  `wholeRideMaxHr`/`wholeRideAvgCadence` was null — unlike the matched-lap "graded on presence" pattern it
  copied, there is no matched lap here to serve as a real evidence anchor, so this let zero evidence both
  earn a neutral-positive delta and inflate `evidenceScope` past the minimum-evidence gate
  (`assessScoreability`). Fixed in **Task 8, Step 4** — both helpers now return `ungraded()` on missing
  data, matching `gradeEffort`'s own `pool.length === 0` precedent rather than the matched-lap precedent.
- **R10 — a stated total-ride duration could misroute an HR/cadence claim into failed lap-matching.** R5's
  fix explicitly allowed `durationMin + zone + targetHrBpm` on one objective (the real "1h z2 HR cap at
  152" shape), but R2's routing treated ANY stated `durationMin` as "search for a curated lap this long" —
  a 60-minute Z2 phase has no corresponding curated interval, so this would report a false "-1, no lap
  matched" for a correctly-executed ride. Fixed in **Task 8, Step 5** — a stated `zone` alongside
  `targetHrBpm`/`targetCadenceRpm` now routes to whole-ride grading regardless of `durationMin`, since
  `zone` already means whole-ride-aggregate evidence everywhere else in this file
  (`gradeZoneTime`/`gradeZoneEmphasis`). A duration-only claim with no zone still prefers the matched-lap
  path. **Residual, not solved:** a large duration-only claim with no zone that's actually ride-scale can
  still misroute — no real note sampled during design exhibited that shape.
- **R8b — intermediate task builds were knowingly left uncompilable.** Task 3 added `"terrain"` to
  `ObjectiveKind` and deliberately left `tsc --noEmit` red until Task 7, four tasks later. Fixed in
  **Task 3, Step 4** — the two broken switches (`mergeKey`, `gradeObjective`) are now discovered via
  `tsc --noEmit` and closed with throwaway placeholders in the SAME step, so the build stays green through
  Tasks 4-6; **Task 7, Steps 5 and 7** now replace those placeholders with real logic instead of adding
  new cases.
- **R11 — VI evidence was specified but never implemented.** Design doc §8 requires VI (`npWatts /
  avgWatts`) as evidence text on any matched lap; none of `gradeHrCeiling`/`gradeCadenceTarget`/
  `gradeTerrain` added it. Fixed in **Task 7, Step 6** (where `viEvidenceText` is defined, since Task 7
  runs before Task 8) and reused in **Task 8, Step 4** — a small shared helper, wired into all three
  matched-lap grading functions (whole-ride grading has no
  matched lap, so it's out of scope there by the design's own "on any matched lap" wording).

---

## Task 0: Confirm baseline

**Files:** none (verification only).

- [ ] **Step 1: Verify the branch and design doc exist**

```bash
git branch --show-current
```

Expected: `claude/adaptive-coach-p3-scoping` (or whatever branch this plan was committed on — if you're
implementing this as a separate `codex/<task>` branch off `origin/main`, expect this plan file and
`docs/superpowers/specs/2026-08-12-adaptive-coach-p3b-interval-context-design.md` to both be present on
`main` already, since the docs land there before implementation starts).

```bash
grep -n "export interface ExecutedInterval" lib/types.ts
grep -n "export function matchLaps" lib/intent-scoring.ts
grep -n "^[0-9]\+\." docs/INVARIANTS.md | tail -1
```

Expected: first two greps print a match; the third prints the current highest invariant number (55 as
of this plan's writing — Task 10 appends the next one after whatever this actually prints, not a
hard-coded value).

- [ ] **Step 2: Read the design doc**

Read `docs/superpowers/specs/2026-08-12-adaptive-coach-p3b-interval-context-design.md` in full before
starting Task 1. This plan implements it; it does not restate the reasoning behind each locked decision.

---

## Task 1: Sync — `ExecutedInterval` gains 5 fields

**Files:**
- Modify: `lib/types.ts` (`ExecutedInterval`, `lib/types.ts:398-411`)
- Modify: `lib/intervals-api.ts` (`fetchIntervals`, `lib/intervals-api.ts:186-210`)
- Test: `lib/intervals-api.test.ts`

**Interfaces:**
- Produces: `ExecutedInterval` gains `maxHr: number | null`, `avgCadenceRpm: number | null`,
  `maxGradientPct: number | null`, `elevationGainM: number | null`, `label: string | null`. Read by
  Tasks 6-8.

- [ ] **Step 1: Write the failing tests**

Add to `lib/intervals-api.test.ts` (extend the existing `fetchIntervals` describe block — grep the file
for `"maps the three newly-added interval fields"` to find its mocked raw payload pattern and reuse it):

```ts
it("maps the five Phase 3b interval fields", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
    type: "WORK", moving_time: 480, average_watts: 210,
    max_heartrate: 172, average_cadence: 88, Maxgradient: 11.7,
    total_elevation_gain: 42.5, label: "Climb 1",
  }]), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  const [interval] = await fetchIntervals("act-1");
  expect(interval.maxHr).toBe(172);
  expect(interval.avgCadenceRpm).toBe(88);
  expect(interval.maxGradientPct).toBeCloseTo(11.7, 1);
  expect(interval.elevationGainM).toBeCloseTo(42.5, 1);
  expect(interval.label).toBe("Climb 1");
});

it("maps all five to null when the raw payload omits them", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
    type: "WORK", moving_time: 480, average_watts: 210,
  }]), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  const [interval] = await fetchIntervals("act-1");
  expect(interval.maxHr).toBeNull();
  expect(interval.avgCadenceRpm).toBeNull();
  expect(interval.maxGradientPct).toBeNull();
  expect(interval.elevationGainM).toBeNull();
  expect(interval.label).toBeNull();
});

it("treats an empty-string label as null, not an empty match target", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
    type: "WORK", moving_time: 480, average_watts: 210, label: "",
  }]), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  const [interval] = await fetchIntervals("act-1");
  expect(interval.label).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/intervals-api.test.ts -t "Phase 3b"
```

Expected: FAIL — the five fields don't exist on `ExecutedInterval` yet (TypeScript error) or read as
`undefined`.

- [ ] **Step 3: Add the fields to the type**

In `lib/types.ts`, inside `ExecutedInterval` (`lib/types.ts:398-411`), add after `zone: number | null;`:

```ts
  // Phase 3b: the metrics Intervals.icu already computes per curated interval, beyond gradient/zone.
  // Peak HR (not just average) is needed so a claim like "stay under 154bpm" can catch a brief spike
  // even when the interval's average stayed under the ceiling.
  maxHr: number | null;
  avgCadenceRpm: number | null;
  // Peak gradient, not average — a real interval's average can read near 0% while its peak hits double
  // digits; the mean washes out short pitches (verified against real ride data during design).
  maxGradientPct: number | null;
  elevationGainM: number | null;
  // Athlete-typed free text on a manually curated interval (Intervals.icu's own "label" feature) — the
  // highest-confidence terrain/effort match signal this phase has, when present. Confirmed API-exposed
  // as `iv.label`; empty string is normalised to null at the mapping boundary (Step 4), never an
  // empty-but-present match target.
  label: string | null;
```

- [ ] **Step 4: Thread the mapping through**

In `lib/intervals-api.ts`'s `fetchIntervals` (`lib/intervals-api.ts:192-206`), add to the mapped object
literal, after `zone: num(iv.zone),`:

```ts
        maxHr: num(iv.max_heartrate),
        avgCadenceRpm: num(iv.average_cadence),
        // NOTE the exact raw key casing: `Maxgradient` — capital M, no underscore, unlike every other
        // snake_case field on this payload. Verified live 2026-08-12; do not "fix" it to max_gradient.
        maxGradientPct: num(iv.Maxgradient),
        elevationGainM: num(iv.total_elevation_gain),
        label: typeof iv.label === "string" && iv.label.trim() ? iv.label : null,
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run lib/intervals-api.test.ts
```

Expected: PASS, full file green.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/intervals-api.ts lib/intervals-api.test.ts
git commit -m "feat(intervals): map HR, cadence, peak gradient, elevation gain and label onto ExecutedInterval"
```

---

## Task 2: Patch existing `ExecutedInterval` fixtures

Task 1's five new required (non-optional) fields break every existing `ExecutedInterval`-typed literal
outside its own files — the same fixture-patch pattern Phase 2c's Task 11 already established for its
three fields.

**Files:**
- Modify: `lib/intent-scoring.test.ts` (`lap()` helper, `lib/intent-scoring.test.ts:65-78`)
- Modify: `lib/durability-score.test.ts` (`iv()` helper, `lib/durability-score.test.ts:7-10`)
- Modify: `lib/trace.test.ts` (`work()` helper, `lib/trace.test.ts:5-16`)
- Modify: `app/api/sync/route.test.ts` (10 inline literals: lines 1081-1083, 1141, 1305-1307, 1334-1336)
- Modify: `lib/interval-match.test.ts` (`ex()` helper, `lib/interval-match.test.ts:12-23`) — **added
  2026-08-12 (R8a review finding):** missed by this task's original file list; also builds an
  `ExecutedInterval` literal and breaks the same way the other four do.

- [ ] **Step 1: Run the full suite to see the current breakage**

```bash
npx vitest run 2>&1 | grep -i "error\|fail" | head -30
```

Expected: TypeScript errors in the five files above, each missing the five new required fields.

- [ ] **Step 2: Patch `lib/intent-scoring.test.ts`'s `lap()` helper**

Replace (`lib/intent-scoring.test.ts:65-78`):

```ts
function lap(durationSec: number, avgWatts: number | null, startIndex: number | null = null): ExecutedInterval {
  return {
    type: "WORK",
    durationSec,
    avgWatts,
    npWatts: avgWatts,
    avgHr: null,
    startIndex,
    endIndex: startIndex === null ? null : startIndex + durationSec,
    avgGradientPct: null,
    groupId: null,
    zone: null,
  };
}
```

with:

```ts
function lap(durationSec: number, avgWatts: number | null, startIndex: number | null = null): ExecutedInterval {
  return {
    type: "WORK",
    durationSec,
    avgWatts,
    npWatts: avgWatts,
    avgHr: null,
    startIndex,
    endIndex: startIndex === null ? null : startIndex + durationSec,
    avgGradientPct: null,
    groupId: null,
    zone: null,
    maxHr: null,
    avgCadenceRpm: null,
    maxGradientPct: null,
    elevationGainM: null,
    label: null,
  };
}
```

- [ ] **Step 3: Patch `lib/durability-score.test.ts`'s `iv()` helper**

Replace (`lib/durability-score.test.ts:7-10`):

```ts
const iv = (over: Partial<ExecutedInterval>): ExecutedInterval => ({
  type: "WORK", durationSec: 0, avgWatts: null, npWatts: null, avgHr: null, startIndex: null, endIndex: null,
  avgGradientPct: null, groupId: null, zone: null, ...over,
});
```

with:

```ts
const iv = (over: Partial<ExecutedInterval>): ExecutedInterval => ({
  type: "WORK", durationSec: 0, avgWatts: null, npWatts: null, avgHr: null, startIndex: null, endIndex: null,
  avgGradientPct: null, groupId: null, zone: null,
  maxHr: null, avgCadenceRpm: null, maxGradientPct: null, elevationGainM: null, label: null,
  ...over,
});
```

- [ ] **Step 4: Patch `lib/trace.test.ts`'s `work()` helper**

Replace (`lib/trace.test.ts:5-16`):

```ts
const work = (startIndex: number, endIndex: number): ExecutedInterval => ({
  type: "WORK",
  durationSec: endIndex - startIndex,
  avgWatts: 300,
  npWatts: 305,
  avgHr: 165,
  startIndex,
  endIndex,
  avgGradientPct: null,
  groupId: null,
  zone: null,
});
```

with:

```ts
const work = (startIndex: number, endIndex: number): ExecutedInterval => ({
  type: "WORK",
  durationSec: endIndex - startIndex,
  avgWatts: 300,
  npWatts: 305,
  avgHr: 165,
  startIndex,
  endIndex,
  avgGradientPct: null,
  groupId: null,
  zone: null,
  maxHr: null,
  avgCadenceRpm: null,
  maxGradientPct: null,
  elevationGainM: null,
  label: null,
});
```

- [ ] **Step 5: Patch `app/api/sync/route.test.ts`'s 10 inline literals**

Each of the 10 lines (1081-1083, 1141, 1305-1307, 1334-1336) currently ends `..., avgGradientPct: null, groupId: null, zone: null }`. For each one, insert the five new fields before the closing brace, e.g. line 1081 becomes:

```ts
      { type: "WORK", durationSec: 720, avgWatts: 190, npWatts: 192, avgHr: 155, startIndex: 0, endIndex: 100, avgGradientPct: null, groupId: null, zone: null, maxHr: null, avgCadenceRpm: null, maxGradientPct: null, elevationGainM: null, label: null },
```

Apply the same `, maxHr: null, avgCadenceRpm: null, maxGradientPct: null, elevationGainM: null, label: null` insertion (before the final ` }`) to all 10 lines — they differ only in `startIndex`/`endIndex` values, which stay unchanged.

- [ ] **Step 6: Patch `lib/interval-match.test.ts`'s `ex()` helper (R8a)**

Replace (`lib/interval-match.test.ts:12-23`):

```ts
const ex = (type: string, np: number, durationSec = 1200): ExecutedInterval => ({
  type,
  durationSec,
  avgWatts: np - 3,
  npWatts: np,
  avgHr: 165,
  startIndex: null,
  endIndex: null,
  avgGradientPct: null,
  groupId: null,
  zone: null,
});
```

with:

```ts
const ex = (type: string, np: number, durationSec = 1200): ExecutedInterval => ({
  type,
  durationSec,
  avgWatts: np - 3,
  npWatts: np,
  avgHr: 165,
  startIndex: null,
  endIndex: null,
  avgGradientPct: null,
  groupId: null,
  zone: null,
  maxHr: null,
  avgCadenceRpm: null,
  maxGradientPct: null,
  elevationGainM: null,
  label: null,
});
```

- [ ] **Step 7: Run the full suite**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: PASS, no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add lib/intent-scoring.test.ts lib/durability-score.test.ts lib/trace.test.ts app/api/sync/route.test.ts lib/interval-match.test.ts
git commit -m "test(intervals): patch ExecutedInterval fixtures for Phase 3b's five new fields"
```

---

## Task 3: `IntentTarget` additions + Zod schema + prompt

**Files:**
- Modify: `lib/types.ts` (`IntentTarget`, `lib/types.ts:686-692`; `ObjectiveKind`, `lib/types.ts:683`)
- Modify: `lib/intent-schema.ts`
- Modify: `lib/intent-prompt.ts`
- Modify: `lib/intent-grounding.ts` — **added 2026-08-12 (R1 review finding):** `verifyGrounding` must gain
  field-specific checks for the three new target fields, or an invented HR/cadence value can pass
  grounding on another field's coattails while a terrain-only objective is rejected outright.
- Modify: `lib/intent-scoring.ts` — **added 2026-08-12 (R8b review finding):** two placeholder `switch`
  cases (`mergeKey`, `gradeObjective`), just enough to keep `tsc --noEmit` green after this task; Task 7
  replaces both with real logic.
- Test: `lib/intent-schema.test.ts` (create if it doesn't already exist — check first)
- Test: `lib/intent-grounding.test.ts` (exists — extend it)

**Interfaces:**
- Produces: `IntentTarget` gains `targetHrBpm?: number`, `targetCadenceRpm?: number`,
  `terrain?: "climb" | "descent"`. `ObjectiveKind` gains `"terrain"`. Read by Tasks 5-8.

- [ ] **Step 1: Check for an existing schema test file**

```bash
ls lib/intent-schema.test.ts 2>&1
```

If it exists, read it first and follow its existing pattern for Step 2 below instead of creating a new
file structure. If it does not exist, Step 2 creates one.

- [ ] **Step 2: Write the failing test**

Add (to the existing file, or create `lib/intent-schema.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { IntentToolSchema } from "./intent-schema";

describe("IntentToolSchema — Phase 3b fields", () => {
  const base = { primaryPurpose: "endurance", phases: [], confidence: "high" as const };

  it("accepts an objective with targetHrBpm", () => {
    const result = IntentToolSchema.safeParse({
      ...base,
      objectives: [{
        description: "stay under 154bpm", kind: "effort", zoneBasis: "heart-rate",
        target: { durationMin: 30, targetHrBpm: 154 }, grounded: true, sourceText: "under 154bpm",
      }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an objective with targetCadenceRpm", () => {
    const result = IntentToolSchema.safeParse({
      ...base,
      objectives: [{
        description: "high cadence spin", kind: "effort", zoneBasis: "unspecified",
        target: { durationMin: 20, targetCadenceRpm: 95 }, grounded: true, sourceText: "high cadence",
      }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a terrain objective", () => {
    const result = IntentToolSchema.safeParse({
      ...base,
      objectives: [{
        description: "did a climb", kind: "terrain", zoneBasis: "unspecified",
        target: { terrain: "climb" }, grounded: true, sourceText: "did a climb",
      }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a terrain value outside the climb/descent enum", () => {
    const result = IntentToolSchema.safeParse({
      ...base,
      objectives: [{
        description: "flat section", kind: "terrain", zoneBasis: "unspecified",
        target: { terrain: "flat" }, grounded: true, sourceText: null,
      }],
    });
    expect(result.success).toBe(false);
  });

  // R5 (resolved 2026-08-12): at most one of {power, HR, cadence, terrain} may compete for ranking;
  // zone/durationMin/reps are exempt because real notes combine them with exactly one of the above.
  it("rejects an objective combining watts and targetHrBpm (two competing ranking signals)", () => {
    const result = IntentToolSchema.safeParse({
      ...base,
      objectives: [{
        description: "250W under 160bpm", kind: "effort", zoneBasis: "heart-rate",
        target: { durationMin: 20, watts: 250, targetHrBpm: 160 }, grounded: true, sourceText: null,
      }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts durationMin + zone + targetHrBpm together — the real '1h z2 HR cap at 152' note shape", () => {
    const result = IntentToolSchema.safeParse({
      ...base,
      objectives: [{
        description: "1h z2 HR cap at 152", kind: "effort", zoneBasis: "heart-rate",
        target: { durationMin: 60, zone: "Z2", targetHrBpm: 152 }, grounded: true, sourceText: "1h z2 HR cap at 152",
      }],
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run lib/intent-schema.test.ts -t "Phase 3b"
```

Expected: FAIL — `kind: "effort"` with `targetHrBpm`/`targetCadenceRpm` rejected by the `.strict()`
schema (unrecognized key), `kind: "terrain"` rejected (not in the enum), and the two R5 mutual-exclusion
tests fail because neither the new fields nor the new refine exist yet.

- [ ] **Step 4: Add the fields to `IntentTarget` and `ObjectiveKind`**

In `lib/types.ts` (`IntentTarget`, `lib/types.ts:686-692`), replace:

```ts
export interface IntentTarget {
  durationMin?: number;
  watts?: number;
  targetPctFtp?: number;
  zone?: string;
  reps?: number;
}
```

with:

```ts
export interface IntentTarget {
  durationMin?: number;
  watts?: number;
  targetPctFtp?: number;
  zone?: string;
  reps?: number;
  // Phase 3b. Ceiling, not a range — matches the athlete's actual note style ("under 154bpm").
  targetHrBpm?: number;
  targetCadenceRpm?: number;
  // Qualifier, not a numeric target — resolved by ExecutedInterval.label first, ExecutedInterval's
  // maxGradientPct/elevationGainM as fallback. See lib/intent-scoring.ts's matchLaps.
  terrain?: "climb" | "descent";
}
```

Also update `ObjectiveKind` (`lib/types.ts:683`) — add `"terrain"`:

```ts
export type ObjectiveKind = "duration" | "zone-time" | "zone-emphasis" | "effort" | "structure" | "qualitative" | "terrain";
```

**This breaks compilation across every exhaustive `switch` over `ObjectiveKind` (R8b fix, 2026-08-12
second review round — this task now closes each break immediately instead of leaving it red for four
tasks).** Run the compiler right away to find every one:

```bash
npx tsc --noEmit
```

**This plan's own investigation found exactly two** — `mergeKey` and `gradeObjective`'s switch, both in
`lib/intent-scoring.ts` — **plus confirmed `mergeGroup` (`lib/intent-scoring.ts:391-428`) has a catch-all
`default:` and does not need a case, and `applySubsumption` is not a switch over `ObjectiveKind` at all**
(it filters by explicit kind checks for `zone-time`/`zone-emphasis`/`duration` only; a terrain claim is
none of those, so it passes through unaffected). **If `tsc` reports a switch this plan did not
anticipate, add a placeholder case there too and note what it was** — that is this plan's own
verification method failing to be exhaustive, worth recording for whoever reads this next.

Add a THROWAWAY placeholder to each of the two switches — not the real logic (Task 7 owns that), just
enough to keep the compiler green in the meantime. In `lib/intent-scoring.ts`'s `mergeKey` (currently
`lib/intent-scoring.ts:366-384`), add a case (placement doesn't matter within the switch):

```ts
    case "terrain":
      // PLACEHOLDER (Task 3) — Task 7 replaces this with the real merge key. Exists only to keep
      // mergeKey's switch exhaustive between Task 3 and Task 7.
      return "terrain|placeholder";
```

In `gradeObjective`'s switch (currently `lib/intent-scoring.ts:710-737`), add a case (after
`case "structure": ... break;`, before `case "qualitative":`):

```ts
    case "terrain":
      // PLACEHOLDER (Task 3) — Task 7 replaces this with a real gradeTerrain(...) call. Exists only to
      // keep gradeObjective's switch exhaustive (and `verdict` definitely assigned) between Task 3 and
      // Task 7. A terrain objective is simply ungraded until Task 7 lands — no test in this task or
      // Tasks 4-6 exercises terrain grading, so this is inert until then.
      verdict = ungraded("terrain grading not yet implemented");
      break;
```

Run `npx tsc --noEmit` again to confirm both placeholders close every break this task introduced. This
task's own `git add`/commit (Step 9 below) now includes `lib/intent-scoring.ts` for these two placeholder
cases — Tasks 4-6 can now assume a green build throughout, and Task 7 REPLACES both placeholders with
real logic rather than adding new cases (see Task 7, Steps 3-5 and 6-7 below).

- [ ] **Step 5: Update the Zod schema**

In `lib/intent-schema.ts`:

Replace line 5:
```ts
const ObjectiveKindSchema = z.enum(["duration", "zone-time", "zone-emphasis", "effort", "structure", "qualitative"]);
```
with:
```ts
const ObjectiveKindSchema = z.enum(["duration", "zone-time", "zone-emphasis", "effort", "structure", "qualitative", "terrain"]);
```

Replace the `TargetSchema` (lines 8-19):
```ts
const TargetSchema = z
  .object({
    durationMin: z.number().positive().optional(),
    watts: z.number().min(30).max(2000).optional(),
    targetPctFtp: z.number().min(30).max(200).optional(),
    zone: z.string().optional(),
    reps: z.number().int().positive().optional(),
  })
  .strict()
  .refine((target) => target.watts === undefined || target.targetPctFtp === undefined, {
    message: "watts and targetPctFtp are mutually exclusive",
  });
```
with:
```ts
const TargetSchema = z
  .object({
    durationMin: z.number().positive().optional(),
    watts: z.number().min(30).max(2000).optional(),
    targetPctFtp: z.number().min(30).max(200).optional(),
    zone: z.string().optional(),
    reps: z.number().int().positive().optional(),
    targetHrBpm: z.number().min(60).max(230).optional(),
    targetCadenceRpm: z.number().min(30).max(150).optional(),
    terrain: z.enum(["climb", "descent"]).optional(),
  })
  .strict()
  .refine((target) => target.watts === undefined || target.targetPctFtp === undefined, {
    message: "watts and targetPctFtp are mutually exclusive",
  })
  // R5 (resolved 2026-08-12): at most one of {power, HR, cadence, terrain} may compete for ranking.
  // zone/durationMin/reps are deliberately excluded — real notes combine them with exactly one of the
  // four above (e.g. "1h z2 HR cap at 152"), and none of the three is ever a matchLaps ranking signal.
  .refine(
    (target) => {
      const power = target.watts !== undefined || target.targetPctFtp !== undefined;
      const competing = [power, target.targetHrBpm !== undefined, target.targetCadenceRpm !== undefined, target.terrain !== undefined];
      return competing.filter(Boolean).length <= 1;
    },
    { message: "at most one of power, targetHrBpm, targetCadenceRpm, terrain may be set per objective" }
  );
```

**Do NOT add `targetHrBpm`/`targetCadenceRpm`/`terrain` to `PhaseSchema` (R8c review finding).**
`lib/anthropic-api.ts`'s `parseRideIntent` maps `StructuredIntent.phases[]` field-by-field, deliberately
never via `...phase` (comment at `lib/anthropic-api.ts:119-123` explains why — excess-property checking
would otherwise smuggle untyped fields into a permanently persisted record). That mapping only carries
`description`/`kind`/`durationMin`/`targetZone`/`targetWatts` through. Adding these three fields to
`PhaseSchema` would let them validate and then be silently discarded before reaching
`StructuredIntent.phases[]` — dead schema surface with no consumer. The only place these three fields are
actually read is `objectives[].target` (already covered above); `PhaseSchema` stays as it already is.

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run lib/intent-schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Close the grounding gap for HR/cadence/terrain (R1 — resolved 2026-08-12)**

**Why this step exists:** `verifyGrounding` (`lib/intent-grounding.ts:81-93`) only checks
`durationMin`/`watts`/`targetPctFtp`/`reps`/`zone`. Left unfixed, an invented `targetHrBpm` value passes
grounding for free whenever another field on the same objective (e.g. `durationMin`) is genuinely
grounded — and a terrain-only objective (no duration/watts/reps/zone stated) is rejected outright by
`targets.some((t) => t !== undefined)`, even though `target.terrain` IS the stated claim. This breaks
INVARIANT 44 ("grounding is semantic and field-specific") for exactly the three fields this phase adds.

Add to `lib/intent-grounding.test.ts` (follow the file's existing `groundsWatts`/`groundsZone` pattern):

```ts
describe("Phase 3b grounding — HR, cadence, terrain", () => {
  it("grounds an HR ceiling only from a bpm-unit form", () => {
    expect(groundsHrBpm("if HR goes over 154bpm dial back", 154)).toBe(true);
    expect(groundsHrBpm("30 min effort", 154)).toBe(false); // no bpm unit anywhere — must not invent one
  });

  it("grounds a cadence target only from an rpm-unit form", () => {
    expect(groundsCadenceRpm("high cadence spin, aim for 95rpm", 95)).toBe(true);
    expect(groundsCadenceRpm("30 min effort", 95)).toBe(false);
  });

  it("grounds a terrain claim from climb/descent vocabulary", () => {
    expect(groundsTerrain("did a proper climb today", "climb")).toBe(true);
    expect(groundsTerrain("fast technical descent at the end", "descent")).toBe(true);
    expect(groundsTerrain("steady z2 ride", "climb")).toBe(false);
  });

  it("no longer rejects a terrain-only objective outright — the R1 bug this step fixes", () => {
    const objective = { grounded: true, target: { terrain: "climb" as const } };
    expect(verifyGrounding(objective, "did a proper climb today")).toBe(true);
  });

  it("no longer lets an invented HR value pass on another field's coattails — the other R1 bug", () => {
    const objective = { grounded: true, target: { durationMin: 30, targetHrBpm: 154 } };
    expect(verifyGrounding(objective, "30 min steady endurance ride")).toBe(false); // no bpm anywhere
  });
});
```

Add `groundsHrBpm`, `groundsCadenceRpm`, `groundsTerrain`, `verifyGrounding` to the test file's import list.

Run `npx vitest run lib/intent-grounding.test.ts -t "Phase 3b"` — expect FAIL (the three functions don't
exist yet, and `verifyGrounding` doesn't check the new fields).

Implement in `lib/intent-grounding.ts`, following the existing `groundsWatts`/`groundsZone` pattern
exactly (add near those functions):

```ts
export function groundsHrBpm(note: string, bpm: number): boolean {
  const masked = maskZoneTokens(note);
  const unit = "(?:bpm|beats?\\s*per\\s*minute)\\b";
  return hasValue(valuesFor(masked, unit), bpm) || inRanges(masked, bpm, unit);
}

export function groundsCadenceRpm(note: string, rpm: number): boolean {
  const masked = maskZoneTokens(note);
  const unit = "(?:rpm|revolutions?\\s*per\\s*minute)\\b";
  return hasValue(valuesFor(masked, unit), rpm) || inRanges(masked, rpm, unit);
}

// Word-boundary vocabulary match, not numeric — mirrors groundsZone's WORD_ZONES approach. Conservative
// on purpose (design doc §5's "no fuzzy NLP matching" discipline, same rule Task 6's label matching uses).
const TERRAIN_WORDS: Record<"climb" | "descent", string[]> = {
  climb: ["climb", "climbing", "climbed", "kicker", "kickers", "ascent"],
  descent: ["descent", "descending", "descended", "downhill"],
};

export function groundsTerrain(note: string, terrain: "climb" | "descent"): boolean {
  return TERRAIN_WORDS[terrain].some((word) => new RegExp(`\\b${word}\\b`, "i").test(note));
}
```

Update `verifyGrounding` (`lib/intent-grounding.ts:81-93`) — replace:

```ts
export function verifyGrounding(objective: Pick<ScoredObjective, "grounded" | "target">, note: string): boolean {
  if (!objective.grounded || !objective.target) return false;
  const { durationMin, watts, targetPctFtp, reps, zone } = objective.target;
  const targets = [durationMin, watts, targetPctFtp, reps, zone];
  const fields = [
    durationMin === undefined || groundsDuration(note, durationMin),
    watts === undefined || groundsWatts(note, watts),
    targetPctFtp === undefined || groundsPctFtp(note, targetPctFtp),
    reps === undefined || groundsReps(note, reps),
    zone === undefined || groundsZone(note, zone),
  ];
  return fields.every(Boolean) && targets.some((target) => target !== undefined);
}
```

with:

```ts
export function verifyGrounding(objective: Pick<ScoredObjective, "grounded" | "target">, note: string): boolean {
  if (!objective.grounded || !objective.target) return false;
  const { durationMin, watts, targetPctFtp, reps, zone, targetHrBpm, targetCadenceRpm, terrain } = objective.target;
  const targets = [durationMin, watts, targetPctFtp, reps, zone, targetHrBpm, targetCadenceRpm, terrain];
  const fields = [
    durationMin === undefined || groundsDuration(note, durationMin),
    watts === undefined || groundsWatts(note, watts),
    targetPctFtp === undefined || groundsPctFtp(note, targetPctFtp),
    reps === undefined || groundsReps(note, reps),
    zone === undefined || groundsZone(note, zone),
    targetHrBpm === undefined || groundsHrBpm(note, targetHrBpm),
    targetCadenceRpm === undefined || groundsCadenceRpm(note, targetCadenceRpm),
    terrain === undefined || groundsTerrain(note, terrain),
  ];
  return fields.every(Boolean) && targets.some((target) => target !== undefined);
}
```

Run `npx vitest run lib/intent-grounding.test.ts` — expect PASS, full file green.

- [ ] **Step 8: Update the prompt**

In `lib/intent-prompt.ts`, bump the version (line 1):
```ts
export const INTENT_PROMPT_VERSION = 1;
```
becomes:
```ts
export const INTENT_PROMPT_VERSION = 2;
```

Add a new rule to `buildIntentPrompt`'s rule list (after the existing `"Keep qualitative skill goals as
qualitative objectives; sensor data cannot establish their quality."` line):

```ts
- A stated HR ceiling (e.g. "stay under 154bpm") is an effort objective with zoneBasis heart-rate and target.targetHrBpm set to that number — not a zone-time claim, and not qualitative.
- A stated cadence target (e.g. "high cadence spin", "90rpm") is an effort objective with target.targetCadenceRpm set — only when the note gives a number or an unambiguous descriptor; do not invent a cadence value.
- A claim that a climb or descent of some length happened is a terrain objective with target.terrain set to "climb" or "descent" — this is an existence claim (did it happen, roughly how long), never a claim about how well it was ridden. A claim about descending or climbing SKILL or FEEL (e.g. "the descent felt great", "practiced cornering") stays qualitative — it is not a terrain objective.
- If the note states no specific interval duration for an HR ceiling or cadence target (e.g. "if HR goes over 154bpm dial back" with no stated interval window), leave target.durationMin unset — do not invent one to make the claim gradable. It will be graded against the whole ride automatically (R2).
```

**This is the one place this phase touches LLM behavior beyond adding fields.** Getting the
terrain-vs-qualitative distinction right in the prompt matters: too loose and every "great ride through
the hills" becomes a spurious terrain objective; too strict and real "did a climb" claims stay
qualitative and never get graded. The new fourth rule matters for the same reason R2 was a blocker in the
first place — Task 11's live smoke run is where all of this actually gets checked against a real model
response; do not consider this step done from the wording alone.

- [ ] **Step 9: Commit**

```bash
git add lib/types.ts lib/intent-schema.ts lib/intent-schema.test.ts lib/intent-prompt.ts lib/intent-grounding.ts lib/intent-grounding.test.ts lib/intent-scoring.ts
git commit -m "feat(intent): add HR ceiling, cadence and terrain to IntentTarget, schema, grounding and prompt"
```

---

## Task 4: VAM helper

**Files:**
- Modify: `lib/intent-scoring.ts`
- Test: `lib/intent-scoring.test.ts`

**Interfaces:**
- Produces: `vam(elevationGainM: number, durationSec: number): number` — meters climbed per hour. Read
  by Task 7's `gradeTerrain`.

- [ ] **Step 1: Write the failing test**

Add to `lib/intent-scoring.test.ts` (a new top-level `describe`, anywhere after the imports):

```ts
describe("vam", () => {
  it("computes vertical meters per hour", () => {
    // 500 m gained in 30 min (1800s) → 1000 m/h
    expect(vam(500, 1800)).toBeCloseTo(1000, 0);
  });

  it("matches a realistic club-cyclist reference point", () => {
    // ~800 m gained over a 1-hour climb is within the ~700-900 m/h club-cyclist VAM range
    // (Cycling Weekly / TrainingPeaks reference points cited in the design doc).
    expect(vam(800, 3600)).toBe(800);
  });
});
```

Add `vam` to the file's existing `import { ... } from "./intent-scoring"` line at the top of the test
file (grep for the current import list first).

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/intent-scoring.test.ts -t "vam"
```

Expected: FAIL — `vam` is not exported.

- [ ] **Step 3: Implement it**

Add to `lib/intent-scoring.ts`, near `lapMinutes` (`lib/intent-scoring.ts:537-538`):

```ts
// VAM (vertical ascent meters/hour) — Michele Ferrari's "Velocità Ascensionale Media", an established
// cycling climbing-effort metric independent of gradient noise. Evidence-text context only (design doc
// §6) — never a scored dimension by itself. Reference points: club cyclists ~700-900 m/h, professional
// mountain-stage efforts ~1650-1800 m/h.
export function vam(elevationGainM: number, durationSec: number): number {
  return elevationGainM / (durationSec / 3600);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run lib/intent-scoring.test.ts -t "vam"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "feat(intent-scoring): add vam() — vertical ascent meters/hour, evidence-text only"
```

---

## Task 5: Close the canonicalisation collision gap for HR/cadence

**Why this task exists:** `identityKey` (`lib/intent-scoring.ts:309-322`) and `mergeKey`'s `"effort"`
case (`lib/intent-scoring.ts:374-380`) build their dedup/merge keys from `(kind, zone, zoneBasis,
durationMin, watts, targetPctFtp, reps)` — **`targetHrBpm`/`targetCadenceRpm` are not in that key.** Left
unfixed, two genuinely different claims — "9 min at 250W" and "9 min under 154bpm" — with the same
stated duration would collide: `dropExactDuplicates` would silently drop one as a "duplicate" of the
other, or `mergeGroup` would merge them as if they were the same effort. This is a real correctness bug,
not a hypothetical — verified by reading `identityKey`/`mergeKey`'s actual current field lists during
this plan's writing. Fixing this does not depend on the `"terrain"` kind existing yet (Task 7), so it's
split out as its own task and done first.

**Files:**
- Modify: `lib/intent-scoring.ts` (`identityKey`, `lib/intent-scoring.ts:309-322`; `mergeKey`'s
  `"effort"` case, `lib/intent-scoring.ts:374-380`)
- Test: `lib/intent-scoring.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/intent-scoring.test.ts` (find the existing `describe("canonicalise"` or
`describe("identityKey"`/`describe("mergeKey"` block — grep the file — and add alongside it; if none of
those describe blocks exist, add a new one):

```ts
describe("identityKey — Phase 3b collision guard", () => {
  it("a power-targeted effort and an HR-targeted effort with the same duration do NOT collide", () => {
    const power = objective({ kind: "effort", target: { durationMin: 9, watts: 250 } });
    const hr = objective({ kind: "effort", target: { durationMin: 9, targetHrBpm: 154 } });
    expect(identityKey(power)).not.toBe(identityKey(hr));
  });

  it("a power-targeted effort and a cadence-targeted effort with the same duration do NOT collide", () => {
    const power = objective({ kind: "effort", target: { durationMin: 9, watts: 250 } });
    const cadence = objective({ kind: "effort", target: { durationMin: 9, targetCadenceRpm: 95 } });
    expect(identityKey(power)).not.toBe(identityKey(cadence));
  });
});
```

(`objective(...)` — reuse the file's existing objective-fixture helper; grep for `function objective(`
near the top of the file to confirm its exact signature before using it. Add `identityKey` to the file's
import list if not already imported.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/intent-scoring.test.ts -t "collision guard"
```

Expected: FAIL — both pairs currently produce the same key.

- [ ] **Step 3: Fix `identityKey`**

Replace (`lib/intent-scoring.ts:309-322`):

```ts
export function identityKey(objective: ScoredObjective): string {
  const target = objective.target ?? {};
  const parts = [
    objective.kind,
    zoneKey(target.zone),
    objective.zoneBasis,
    roundOr(target.durationMin, 1),
    roundOr(target.watts, 5),
    roundOr(target.targetPctFtp, 1),
    roundOr(target.reps, 1),
  ];
  if (objective.kind === "qualitative") parts.push(objective.description);
  return parts.join("|");
}
```

with:

```ts
export function identityKey(objective: ScoredObjective): string {
  const target = objective.target ?? {};
  const parts = [
    objective.kind,
    zoneKey(target.zone),
    objective.zoneBasis,
    roundOr(target.durationMin, 1),
    roundOr(target.watts, 5),
    roundOr(target.targetPctFtp, 1),
    roundOr(target.reps, 1),
    // Phase 3b: without these, an HR- or cadence-targeted effort collides with a power-targeted one of
    // the same stated duration — a real bug found by reading this function's actual field list.
    roundOr(target.targetHrBpm, 1),
    roundOr(target.targetCadenceRpm, 1),
    target.terrain ?? "-",
  ];
  if (objective.kind === "qualitative") parts.push(objective.description);
  return parts.join("|");
}
```

- [ ] **Step 4: Fix `mergeKey`'s `"effort"` case**

Replace (`lib/intent-scoring.ts:374-380`):

```ts
    case "effort":
      // `reps` is deliberately absent: two readings of one effort that disagree only on rep count are
      // CONTRADICTORY, not additive.
      return `effort|${roundOr(target.durationMin, 1)}|${roundOr(target.watts, 5)}|${roundOr(
        target.targetPctFtp,
        1
      )}|${zoneKey(target.zone)}`;
```

with:

```ts
    case "effort":
      // `reps` is deliberately absent: two readings of one effort that disagree only on rep count are
      // CONTRADICTORY, not additive. targetHrBpm/targetCadenceRpm added (Phase 3b) for the same reason
      // identityKey needed them — otherwise an HR-targeted and a power-targeted effort of the same
      // duration merge into one.
      return `effort|${roundOr(target.durationMin, 1)}|${roundOr(target.watts, 5)}|${roundOr(
        target.targetPctFtp,
        1
      )}|${zoneKey(target.zone)}|${roundOr(target.targetHrBpm, 1)}|${roundOr(target.targetCadenceRpm, 1)}`;
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run lib/intent-scoring.test.ts
```

Expected: PASS. (`target.terrain` in `identityKey` references a field that exists as of Task 3; this
compiles regardless of whether `"terrain"` is a valid `ObjectiveKind` value yet, since `IntentTarget`
already carries `terrain?` independent of the kind.)

- [ ] **Step 6: Commit**

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "fix(intent-scoring): include targetHrBpm/targetCadenceRpm/terrain in dedup and merge keys"
```

---

## Task 6: Generalize `matchLaps` for HR, cadence and terrain

**Files:**
- Modify: `lib/intent-scoring.ts` (`matchLaps`, `lib/intent-scoring.ts:512-536`)
- Test: `lib/intent-scoring.test.ts`

**Interfaces:**
- Produces: `matchLaps` now also ranks by `target.targetHrBpm`/`target.targetCadenceRpm` distance when
  set, and dispatches `target.terrain` to a dedicated `matchTerrain` helper (see below) rather than
  folding terrain into the shared duration/power ranking path. Also produces `CLIMB_GRADIENT_FLOOR_PCT`
  (module-level constant) and `filterByTerrain` — both read by Task 7's `gradeTerrain` indirectly
  (through this task's `matchLaps`) and directly is not needed by Task 7, which only calls `matchLaps`.
- **Revised 2026-08-12 (R3 + R4 review findings, both fixed here — no design decision needed, both
  follow directly from the phase's own already-locked "existence+duration compliance" model):**
  - **R3:** terrain candidacy is now decided ENTIRELY by `filterByTerrain` (label/gradient), never by the
    ±20% duration pre-filter that gates power/HR/cadence matching. A stated duration is used only to pick
    the single best-matching terrain-qualified candidate (closest duration wins) — it no longer excludes
    a real but badly-mismatched terrain lap from candidacy outright. `gradeTerrain`'s own
    compliance-vs-stated-duration math (Task 7) is what penalizes the mismatch; exclusion from candidacy
    was double-penalizing (and contradicting Task 7's own test) for the same thing.
  - **R4:** `clearsGradientFloor`'s descent branch now reads `avgGradientPct` (already-synced, signed,
    pre-dates this phase) instead of `maxGradientPct` (a peak/most-positive sample — the wrong extremum
    for descent detection; a real descent with one flat or uphill moment anywhere in it could otherwise
    never clear a `<= -3%` floor). The climb branch is unchanged — `maxGradientPct` stays right for
    climbs, where a short steep pitch inside an otherwise-flat lap should still count (design doc §4).

- [ ] **Step 1: Write the failing tests**

Add to `lib/intent-scoring.test.ts` (near the existing `describe("matchLaps"` block — grep for it):

```ts
describe("matchLaps — Phase 3b: HR and cadence ranking", () => {
  it("ranks by HR distance when targetHrBpm is set", () => {
    const target: IntentTarget = { durationMin: 10, targetHrBpm: 154 };
    const close = { ...lap(600, 200), avgHr: 152 };
    const far = { ...lap(600, 200), avgHr: 170 };
    expect(matchLaps(target, [far, close])).toEqual([close]);
  });

  it("ranks by cadence distance when targetCadenceRpm is set", () => {
    const target: IntentTarget = { durationMin: 10, targetCadenceRpm: 95 };
    const close = { ...lap(600, 200), avgCadenceRpm: 93 };
    const far = { ...lap(600, 200), avgCadenceRpm: 70 };
    expect(matchLaps(target, [far, close])).toEqual([close]);
  });
});

describe("matchLaps — Phase 3b: terrain, label-first with gradient fallback", () => {
  it("prefers a labelled climb over an unlabelled one clearing the gradient floor, with a stated duration", () => {
    const target: IntentTarget = { terrain: "climb", durationMin: 8 };
    const labelled = { ...lap(480, 220), label: "Climb 1", maxGradientPct: 5 };
    const unlabelled = { ...lap(480, 220), maxGradientPct: 12 };
    expect(matchLaps(target, [unlabelled, labelled])).toEqual([labelled]);
  });

  it("falls back to the gradient floor when no label exists, with a stated duration", () => {
    const target: IntentTarget = { terrain: "climb", durationMin: 8 };
    const climb = { ...lap(480, 220), maxGradientPct: 9 };
    const flat = { ...lap(480, 220), maxGradientPct: 1 };
    expect(matchLaps(target, [flat, climb])).toEqual([climb]);
  });

  it("never selects a duration-matched lap that clears neither label nor gradient floor — no guessing", () => {
    const target: IntentTarget = { terrain: "climb", durationMin: 8 };
    const flat = { ...lap(480, 220), maxGradientPct: 1 };
    expect(matchLaps(target, [flat])).toEqual([]);
  });

  it("resolves an unstated-duration climb claim only when exactly one candidate qualifies", () => {
    const target: IntentTarget = { terrain: "climb" };
    const one = { ...lap(300, 220), maxGradientPct: 9 };
    expect(matchLaps(target, [one])).toEqual([one]);
  });

  it("stays ungraded on an unstated-duration climb claim with two qualifying candidates — never guesses", () => {
    const target: IntentTarget = { terrain: "climb" };
    const a = { ...lap(300, 220), maxGradientPct: 9 };
    const b = { ...lap(400, 230), maxGradientPct: 10 };
    expect(matchLaps(target, [a, b])).toEqual([]);
  });

  // R4 fix (2026-08-12): descent detection reads avgGradientPct (signed, net-over-the-lap), not
  // maxGradientPct (a peak/most-positive sample — the wrong extremum for "was this a descent").
  it("descent uses the negative AVERAGE gradient floor, not the peak", () => {
    const target: IntentTarget = { terrain: "descent", durationMin: 5 };
    const descent = { ...lap(300, 150), avgGradientPct: -6 };
    const flat = { ...lap(300, 150), avgGradientPct: 0.5 };
    expect(matchLaps(target, [flat, descent])).toEqual([descent]);
  });

  it("still detects a real descent when a brief flat/uphill blip pushes the PEAK sample positive — the exact R4 bug", () => {
    const target: IntentTarget = { terrain: "descent", durationMin: 5 };
    // maxGradientPct is positive (one uphill blip in an otherwise-descending lap) — a maxGradientPct-only
    // check would have missed this descent entirely. avgGradientPct correctly reads net-negative.
    const descent = { ...lap(300, 150), maxGradientPct: 1.5, avgGradientPct: -4 };
    expect(matchLaps(target, [descent])).toEqual([descent]);
  });

  // R3 fix (2026-08-12): a terrain-qualified lap is never excluded from candidacy for failing the ±20%
  // duration window that gates power/HR/cadence matching — gradeTerrain's own compliance math (Task 7)
  // is what penalizes a big duration mismatch, not exclusion here.
  it("does not discard a terrain-qualified lap for failing the ±20% duration window", () => {
    const target: IntentTarget = { terrain: "climb", durationMin: 20 };
    const shortClimb = { ...lap(240, 220), label: "Climb 1", maxGradientPct: 8 }; // 4 min vs 20 stated
    expect(matchLaps(target, [shortClimb])).toEqual([shortClimb]);
  });

  it("prefers the closest-duration terrain-qualified candidate when several qualify with a stated duration", () => {
    const target: IntentTarget = { terrain: "climb", durationMin: 20 };
    const close = { ...lap(1140, 220), maxGradientPct: 9 }; // 19 min
    const far = { ...lap(240, 220), maxGradientPct: 9 }; // 4 min
    expect(matchLaps(target, [far, close])).toEqual([close]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/intent-scoring.test.ts -t "Phase 3b: HR and cadence ranking\|Phase 3b: terrain"
```

Expected: FAIL — `matchLaps` doesn't read `targetHrBpm`/`targetCadenceRpm`/`terrain` yet.

- [ ] **Step 3: Implement**

Replace `matchLaps` in full (`lib/intent-scoring.ts:512-536`):

```ts
export function matchLaps(
  target: IntentTarget,
  laps: ExecutedInterval[],
  resolvedWatts: number | null = null
): ExecutedInterval[] {
  // Terrain is handled entirely separately (R3/R4 fix, 2026-08-12) — it never shares the duration
  // pre-filter or the distance() ranking below. See matchTerrain.
  if (target.terrain) return matchTerrain(target, laps);

  const durationMin = numeric(target.durationMin);
  if (durationMin === null || durationMin <= 0) {
    const zone = zoneIndex(target.zone);
    if (zone === null) return [];
    const candidates = laps.filter((lap) => lap.zone === zone + 1);
    return candidates.length === 1 ? candidates : [];
  }
  const targetSec = durationMin * 60;
  const low = targetSec * (1 - LAP_DURATION_TOLERANCE);
  const high = targetSec * (1 + LAP_DURATION_TOLERANCE);
  const candidates = laps.filter((lap) => lap.durationSec >= low && lap.durationSec <= high);
  const wanted = Math.max(1, Math.round(numeric(target.reps) ?? 1));
  const distance = (lap: ExecutedInterval): number => {
    if (target.targetHrBpm != null) {
      return lap.avgHr == null ? Number.MAX_SAFE_INTEGER : Math.abs(lap.avgHr - target.targetHrBpm);
    }
    if (target.targetCadenceRpm != null) {
      return lap.avgCadenceRpm == null ? Number.MAX_SAFE_INTEGER : Math.abs(lap.avgCadenceRpm - target.targetCadenceRpm);
    }
    if (resolvedWatts === null) return Math.abs(lap.durationSec - targetSec);
    if (lap.avgWatts == null) return Number.MAX_SAFE_INTEGER;
    return Math.abs(lap.avgWatts - resolvedWatts);
  };
  return [...candidates].sort((a, b) => distance(a) - distance(b)).slice(0, wanted);
}

// Strava's own published climb-categorization floor (support.strava.com/hc/en-us/articles/216917057) —
// borrowed here as the minimum |gradient| that counts as a climb/descent at all, not their full
// length×gradient category scoring, which this phase doesn't need.
const CLIMB_GRADIENT_FLOOR_PCT = 3;

function hasLabelHint(lap: ExecutedInterval, terrain: "climb" | "descent"): boolean {
  return (lap.label ?? "").trim().toLowerCase().includes(terrain);
}

// R4 fix (2026-08-12): climb and descent deliberately read DIFFERENT gradient statistics, not the same
// field with a sign flip. Climb keeps maxGradientPct (peak) — a short steep pitch inside an otherwise
// flat lap should still count (design doc §4: a real climb lap's average read ~0.4% while its peak hit
// 14-15%). Descent switches to avgGradientPct (already-synced, signed, pre-dates this phase) — the NET
// gradient over the lap is the honest "was this a sustained descent" signal. maxGradientPct is the wrong
// extremum for descent: it's the most-POSITIVE sample, so one flat or uphill moment anywhere in a real
// descent would defeat a maxGradientPct<=-3% check even though the lap genuinely descended overall.
function clearsGradientFloor(lap: ExecutedInterval, terrain: "climb" | "descent"): boolean {
  if (terrain === "climb") {
    return lap.maxGradientPct != null && lap.maxGradientPct >= CLIMB_GRADIENT_FLOOR_PCT;
  }
  return lap.avgGradientPct != null && lap.avgGradientPct <= -CLIMB_GRADIENT_FLOOR_PCT;
}

// A candidate qualifies as the stated terrain only via its own label or a gradient clearing the floor
// above — NEVER by elimination among duration-matched laps. A lap that shows no climb/descent signal is
// not evidence of one; without this filter, "closest by distance" among non-qualifying candidates would
// silently guess.
function filterByTerrain(terrain: "climb" | "descent", candidates: ExecutedInterval[]): ExecutedInterval[] {
  const labelled = candidates.filter((lap) => hasLabelHint(lap, terrain));
  if (labelled.length > 0) return labelled; // label is the primary signal — don't dilute with gradient-only candidates once any label exists
  return candidates.filter((lap) => clearsGradientFloor(lap, terrain));
}

// R3 fix (2026-08-12): terrain candidacy is decided ENTIRELY by filterByTerrain (label/gradient) — it
// never shares the ±20% duration pre-filter that gates power/HR/cadence matching above. A stated
// duration is used only to pick the single best-matching terrain-qualified candidate (closest duration
// wins); it no longer excludes a real but badly-mismatched terrain lap from candidacy outright.
// gradeTerrain's own compliance-vs-stated-duration math (Task 7) is what penalizes the mismatch.
function matchTerrain(target: IntentTarget, laps: ExecutedInterval[]): ExecutedInterval[] {
  const terrain = target.terrain!;
  const qualifying = filterByTerrain(terrain, laps);
  const durationMin = numeric(target.durationMin);
  if (durationMin === null || durationMin <= 0) {
    // No stated duration: same ultra-conservative "exactly one candidate or nothing" rule the zone-only
    // branch above already uses — a genuinely ambiguous terrain claim stays ungraded.
    return qualifying.length === 1 ? qualifying : [];
  }
  if (qualifying.length === 0) return [];
  const targetSec = durationMin * 60;
  const closest = [...qualifying].sort(
    (a, b) => Math.abs(a.durationSec - targetSec) - Math.abs(b.durationSec - targetSec)
  )[0];
  return [closest];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/intent-scoring.test.ts
```

Expected: PASS for every test added in this task. (Task 7's terrain-grading tests, if already written,
will now also pass — this task's `matchLaps` is their dependency.)

- [ ] **Step 5: Confirm the existing gradient-axis regression test still passes, and update its scope**

`lib/intent-scoring.test.ts:713-719` has an existing test: `"never introduces a gradient-based scoring
axis — gradient is evidence text only"`. Its scenario uses `target: { durationMin: 10, watts: 250, reps:
1 }` — a power-targeted objective with no `terrain` field — so it is unaffected by this task's changes
(`matchLaps` dispatches to `matchTerrain` only when `target.terrain` is set, per Step 3 above; this
scenario never takes that branch and falls through to the unchanged power/duration path) and should still
pass as-is. **Confirm this by running it explicitly:**

```bash
npx vitest run lib/intent-scoring.test.ts -t "never introduces a gradient-based scoring axis"
```

Expected: PASS, unchanged.

Its name is now a slight overstatement, though — gradient IS a real matching signal as of this task, for
`terrain`-targeted objectives specifically. Update the test's description (not its assertions) to scope
the claim correctly:

```ts
it("never uses gradient as a matching signal for power/duration-targeted objectives (terrain-targeted objectives do — see the describe block above)", () => {
```

This is the AGENTS.md "stale doc/comment pointer" bug class applied to a test name rather than a doc
cross-reference — the assertion stays true, but an absolute claim in its title would otherwise mislead
the next reader into thinking gradient plays no role anywhere in this file.

- [ ] **Step 6: Commit**

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "feat(intent-scoring): generalize matchLaps for HR/cadence ranking and label-first terrain matching"
```

---

## Task 7: The `"terrain"` kind — banding, gating, grading, dispatch

**Files:**
- Modify: `lib/intent-scoring.ts` (`GRADABLE_KINDS_BY_CONFIDENCE:71-75`, `KIND_BAND:173-180`,
  `mergeKey`'s switch:366-384, `gradeObjective`'s switch:710-737)
- Test: `lib/intent-scoring.test.ts`

**Interfaces:**
- Consumes: `matchLaps` (Task 6 — must be done first, per Global Constraints).
- Produces: `gradeTerrain(objective, pool): Verdict` — internal, dispatched from `gradeObjective`.
- **Revised 2026-08-12 (R6 + R4 review findings, both fixed here):**
  - **R6:** the "(labelled)" vs "(matched by gradient)" evidence tag now checks `hasLabelHint(primary,
    terrain)`, not "does `primary.label` happen to be non-empty." A gradient-matched lap (guaranteed to
    not label-match, since `filterByTerrain` prefers label matches first) can still carry an unrelated,
    non-empty label from Intervals.icu (e.g. `"Tempo 1"`) — the old check would have misreported it as
    "(labelled)".
  - **R4 (evidence half):** VAM is only ever shown for `terrain: "climb"` evidence, never `"descent"`.
    VAM is an ascent-rate metric; `elevationGainM` (`total_elevation_gain`) is a gross positive-only
    accumulation, near-zero on a genuine descent lap — showing "VAM 12 m/h" on a descent claim implies a
    climbing rate that isn't meaningful there.

- [ ] **Step 1: Write the failing tests**

Add to `lib/intent-scoring.test.ts`:

```ts
describe("gradeTerrain (via gradeObjective)", () => {
  it("grades a labelled climb as existence + duration compliance", () => {
    const o = objective({ kind: "terrain", target: { terrain: "climb", durationMin: 8 } });
    const climbLap = { ...lap(480, 220, 0), label: "Climb 1", maxGradientPct: 9.2, elevationGainM: 120 };
    const ev = evidence({ laps: [climbLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBeGreaterThanOrEqual(1);
    expect(result.objective.evidence).toMatch(/climb/i);
    expect(result.objective.evidence).toMatch(/labelled/i);
  });

  it("falls back to gradient when no label matches, and says so in evidence", () => {
    const o = objective({ kind: "terrain", target: { terrain: "climb", durationMin: 8 } });
    const climbLap = { ...lap(480, 220, 0), maxGradientPct: 9.2, elevationGainM: 120 };
    const ev = evidence({ laps: [climbLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.objective.evidence).toMatch(/gradient/i);
  });

  it("stays ungraded — never guesses — when nothing clears the climb floor and no label exists", () => {
    const o = objective({ kind: "terrain", target: { terrain: "climb", durationMin: 8 } });
    const flatLap = lap(480, 220, 0); // maxGradientPct null via the lap() helper default
    const ev = evidence({ laps: [flatLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(false);
    expect(result.delta).toBeNull();
  });

  it("includes VAM in the evidence text when elevationGainM is present", () => {
    const o = objective({ kind: "terrain", target: { terrain: "climb", durationMin: 8 } });
    // 480s = 1/7.5 h; 100 m gain → VAM = 100 / (480/3600) = 750 m/h
    const climbLap = { ...lap(480, 220, 0), label: "Climb", elevationGainM: 100, maxGradientPct: 6 };
    const ev = evidence({ laps: [climbLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.evidence).toMatch(/VAM/);
    expect(result.objective.evidence).toMatch(/750/);
  });

  it("never produces a technique/quality grade — only existence and duration compliance", () => {
    // A very short matched climb (well under the stated duration) still SCORES, on compliance — it is
    // never "ungraded" for being a bad climb. This is the design's existence-vs-quality boundary. (This
    // also exercises the R3 fix: the 4-min lap is well outside the ±20% window of the 20-min stated
    // duration, so it would have been silently excluded from candidacy before that fix — see Task 6.)
    const o = objective({ kind: "terrain", target: { terrain: "climb", durationMin: 20 } });
    const shortClimb = { ...lap(240, 220, 0), label: "Climb", maxGradientPct: 8 }; // 4 min vs 20 stated
    const ev = evidence({ laps: [shortClimb] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBeLessThan(0); // low compliance, not "ungraded", not a skill verdict
  });

  // R6 fix (2026-08-12): a gradient-matched lap carrying an unrelated non-empty label must not be
  // misreported as "(labelled)".
  it("reports 'matched by gradient', not 'labelled', when the matched lap's label doesn't mention the terrain", () => {
    const o = objective({ kind: "terrain", target: { terrain: "climb", durationMin: 8 } });
    const climbLap = { ...lap(480, 220, 0), label: "Tempo 1", maxGradientPct: 9.2 }; // unrelated label
    const ev = evidence({ laps: [climbLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.evidence).toMatch(/matched by gradient/i);
    expect(result.objective.evidence).not.toMatch(/\(labelled\)/i);
  });

  // R4 fix (2026-08-12), evidence half: VAM is an ascent-rate metric — never shown on a descent claim.
  it("omits VAM from descent evidence even when elevationGainM is present", () => {
    const o = objective({ kind: "terrain", target: { terrain: "descent", durationMin: 5 } });
    const descentLap = { ...lap(300, 150, 0), avgGradientPct: -6, elevationGainM: 8 };
    const ev = evidence({ laps: [descentLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.objective.evidence).not.toMatch(/VAM/);
  });

  // R11 fix (2026-08-12, second review round): VI shows on BOTH climb and descent evidence — unlike VAM,
  // it isn't ascent-specific.
  it("includes VI in terrain evidence for both climb and descent, when power data is present", () => {
    const climbTarget = objective({ kind: "terrain", target: { terrain: "climb", durationMin: 8 } });
    const climbLap = { ...lap(480, 220, 0), label: "Climb", maxGradientPct: 9, npWatts: 240 }; // VI 1.09
    const climbResult = gradeObjective(climbTarget, evidence({ laps: [climbLap] }), { laps: [climbLap] });
    expect(climbResult.objective.evidence).toMatch(/VI 1\.09/);

    const descentTarget = objective({ kind: "terrain", target: { terrain: "descent", durationMin: 5 } });
    const descentLap = { ...lap(300, 150, 0), avgGradientPct: -6, npWatts: 140 }; // VI 0.93
    const descentResult = gradeObjective(descentTarget, evidence({ laps: [descentLap] }), { laps: [descentLap] });
    expect(descentResult.objective.evidence).toMatch(/VI 0\.93/);
  });
});

describe("terrain kind — gating and banding", () => {
  it("is gradable at high and medium confidence, not low", () => {
    expect(GRADABLE_KINDS_BY_CONFIDENCE.high).toContain("terrain");
    expect(GRADABLE_KINDS_BY_CONFIDENCE.medium).toContain("terrain");
    expect(GRADABLE_KINDS_BY_CONFIDENCE.low).not.toContain("terrain");
  });
});
```

(`objective`, `lap`, `evidence` — reuse the file's existing fixture helpers. Add
`GRADABLE_KINDS_BY_CONFIDENCE`, `gradeObjective` to the import list if not already present.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/intent-scoring.test.ts -t "gradeTerrain\|terrain kind"
```

Expected: FAIL — `"terrain"` is not yet a valid `kind` in the gating/banding tables, and
`gradeObjective`'s switch doesn't handle it.

- [ ] **Step 3: Add `"terrain"` to the gradable-kinds table**

In `lib/intent-scoring.ts` (`GRADABLE_KINDS_BY_CONFIDENCE:71-75`), replace:

```ts
export const GRADABLE_KINDS_BY_CONFIDENCE: Record<IntentConfidence, readonly ObjectiveKind[]> = {
  high: ["duration", "zone-time", "zone-emphasis", "effort", "structure"],
  medium: ["duration", "zone-time", "zone-emphasis", "effort"], // structure dropped
  low: [],
};
```

with:

```ts
export const GRADABLE_KINDS_BY_CONFIDENCE: Record<IntentConfidence, readonly ObjectiveKind[]> = {
  high: ["duration", "zone-time", "zone-emphasis", "effort", "structure", "terrain"],
  // structure dropped at medium (ordinal/reward-only); terrain KEPT — it is a falsifiable existence
  // claim from lap data, the same rigor class as `effort`, not an ordinal claim like `structure`.
  medium: ["duration", "zone-time", "zone-emphasis", "effort", "terrain"],
  low: [],
};
```

- [ ] **Step 4: Add the `terrain` band**

In `lib/intent-scoring.ts` (`KIND_BAND:173-180`), add after `structure: { min: 0, max: 1 },`:

```ts
  terrain: { min: -2, max: 2 },
```

- [ ] **Step 5: Replace `mergeKey`'s placeholder `"terrain"` case with the real one**

Task 3, Step 4 already added a placeholder `case "terrain": return "terrain|placeholder";` to `mergeKey`
(`lib/intent-scoring.ts`) purely to keep the build green in the meantime (R8b fix) — replace it now with
the real key:

```ts
    case "terrain":
      return `terrain|${target.terrain ?? "-"}|${roundOr(target.durationMin, 1)}`;
```

**Deliberately no new `mergeGroup` case.** Two terrain claims that share a merge key (same terrain
direction, same rounded duration) fall through to `mergeGroup`'s existing `default:` branch — "keep
first entry" — the same behavior `zone-emphasis`/`structure`/`qualitative` already get. This is a
documented choice, not an oversight: terrain claims are rare enough that two truly-identical-sounding
ones collapsing to one is an acceptable default, and it avoids adding merge logic with no test coverage
motivating its exact shape yet.

- [ ] **Step 6: Implement `gradeTerrain`**

Add to `lib/intent-scoring.ts`, near `gradeStructure` (`lib/intent-scoring.ts:686-701`):

```ts
// R11 fix (2026-08-12, second review round): VI (npWatts / avgWatts) rides along as evidence text only
// on any matched lap (design doc §8) — never a scored dimension, purely context on how steady vs surgy
// the effort was, independent of whichever field actually drove the match/grade. Computed from the
// PRIMARY (first) matched lap only — VI is inherently a per-effort ratio; this file doesn't invent a
// multi-lap aggregation formula for it (same "no fabricated formula" discipline as elsewhere here).
// Shared by gradeTerrain (below) and Task 8's gradeHrCeiling/gradeCadenceTarget — the three matched-lap
// grading functions Phase 3b adds. Whole-ride grading has no matched lap, so it's out of scope there.
function viEvidenceText(matched: ExecutedInterval[]): string | null {
  const primary = matched[0];
  if (!primary || primary.avgWatts == null || primary.avgWatts <= 0 || primary.npWatts == null) return null;
  return `VI ${(primary.npWatts / primary.avgWatts).toFixed(2)}`;
}

// Existence + duration compliance ONLY — never a quality/technique grade (design doc §15's non-goal on
// descending/cornering skill). `matchLaps` (Task 6) does the label-first/gradient-fallback selection;
// this function only grades what it returns.
function gradeTerrain(objective: ScoredObjective, pool: ExecutedInterval[]): Verdict {
  const target = objective.target ?? {};
  const terrain = target.terrain;
  if (!terrain) return ungraded("no terrain stated");
  if (pool.length === 0) return ungraded("no interval data");

  const matched = matchLaps(target, pool);
  if (matched.length === 0) {
    return { delta: null, scored: false, measurable: true, scopeMin: 0, evidence: `no ${terrain} found in the curated intervals` };
  }

  const scopeMin = lapMinutes(matched);
  const primary = matched[0];
  // R6 fix (2026-08-12): must check that the label actually mentions THIS terrain, not merely that
  // `primary.label` is non-empty — a gradient-matched lap (guaranteed to not label-match, since
  // filterByTerrain prefers label matches first) can still carry an unrelated label like "Tempo 1".
  const labelled = hasLabelHint(primary, terrain);
  const contextParts = [
    primary.avgGradientPct != null ? `avg ${primary.avgGradientPct.toFixed(1)}%` : null,
    primary.maxGradientPct != null ? `max ${primary.maxGradientPct.toFixed(1)}%` : null,
    // R4 fix (2026-08-12): VAM is an ascent-rate metric; elevationGainM is a gross positive-only
    // accumulation, near-meaningless on a genuine descent lap. Climb evidence only.
    terrain === "climb" && primary.elevationGainM != null && primary.durationSec > 0
      ? `VAM ${Math.round(vam(primary.elevationGainM, primary.durationSec))} m/h`
      : null,
    viEvidenceText(matched), // R11 fix — climb AND descent both get VI, unlike VAM above
  ].filter((part): part is string => part !== null);
  const context = contextParts.length > 0 ? ` — ${contextParts.join(", ")}` : "";
  const source = labelled ? "labelled" : "matched by gradient";

  const stated = numeric(target.durationMin);
  if (stated === null || stated <= 0) {
    return {
      delta: 1,
      scored: true,
      measurable: true,
      scopeMin,
      evidence: `${scopeMin.toFixed(1)} min ${terrain} (${source})${context}`,
      matchedLaps: matched,
    };
  }
  const pct = (scopeMin / stated) * 100;
  return {
    delta: complianceDelta(pct),
    scored: true,
    measurable: true,
    scopeMin,
    evidence: `${scopeMin.toFixed(1)} min ${terrain} vs ${stated} min stated (${source})${context}`,
    matchedLaps: matched,
  };
}
```

- [ ] **Step 7: Replace `gradeObjective`'s placeholder `"terrain"` case with the real dispatch**

Task 3, Step 4 already added a placeholder `case "terrain": verdict = ungraded(...); break;` to
`gradeObjective` (`lib/intent-scoring.ts`) purely to keep the build green in the meantime (R8b fix) —
replace it now with the real dispatch (same location, after `case "structure": ... break;`, before
`case "qualitative":`):

```ts
    case "terrain":
      verdict = gradeTerrain(objective, pool);
      break;
```

- [ ] **Step 8: Run `npx tsc --noEmit` to confirm**

```bash
npx tsc --noEmit
```

Both switches this task needed (`mergeKey`, `gradeObjective`) were already discovered and placeholder-
fixed back in Task 3, Step 4 (R8b fix) — this step is now a confirmation that replacing both placeholders
with real logic didn't introduce a new break, not a discovery step. **If `tsc` reports anything else,
that's a genuinely new break Task 3's investigation didn't anticipate — fix it and note what it was.**

- [ ] **Step 9: Run tests to verify they pass**

```bash
npx vitest run lib/intent-scoring.test.ts
```

Expected: PASS, full file green.

- [ ] **Step 10: Commit**

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "feat(intent-scoring): add the terrain ObjectiveKind — existence+duration grading, never technique"
```

---

## Task 8: Extend `gradeEffort` for HR-ceiling and cadence grading

**Files:**
- Modify: `lib/intent-scoring.ts` (`gradeEffort`, `lib/intent-scoring.ts:611-679`; `RideEvidence`)
- Modify: `lib/intent-runner.ts` — threads the two new `RideEvidence` fields through (R2)
- Test: `lib/intent-scoring.test.ts`

**Interfaces:**
- Produces: `gradeEffort` now grades an objective by `targetHrBpm` or `targetCadenceRpm` when the note
  stated one instead of (or in addition to — the target field itself decides, mirroring
  `resolveTargetWatts`'s existing power/pctFtp exclusivity) a power target.
- **Revised 2026-08-12 (R2 scoping session — resolves the plan's other P0 blocker):** an HR/cadence
  target with NO stated interval duration no longer returns `ungraded("no duration stated")` — it grades
  against the whole ride via two new `RideEvidence` fields, `wholeRideMaxHr`/`wholeRideAvgCadence`
  (sourced from `activity.maxHr`/`activity.avgCadence`, already synced on `ActivitySummary`, zero new
  sync cost). This directly covers the phase's own motivating note ("if HR goes over 154bpm dial back to
  stay in z2" — no stated duration). A duration-stated claim with NO `zone` always prefers the existing
  matched-lap path above — whole-ride grading is the fallback there.
- **Revised 2026-08-12 (R9 + R10, second review round):** whole-ride grading with no
  `wholeRideMaxHr`/`wholeRideAvgCadence` data now returns `ungraded()`, not a presence-based `delta: 1` —
  unlike the matched-lap presence rule, there is no fallback evidence at all here, so scoring it would let
  zero evidence both earn a neutral delta and inflate `evidenceScope` past the minimum-evidence gate
  (R9). Separately, an HR/cadence target whose `durationMin` is stated ALONGSIDE a `zone` (the real "1h z2
  HR cap at 152" shape) now ALSO routes to whole-ride grading rather than matched-lap — `zone` signals a
  whole-ride/phase-shaped claim that won't correspond to any curated interval, the same way `zone`-based
  objectives elsewhere in this file are always graded from whole-ride aggregates, never lap-matching (R10).

- [ ] **Step 1: Write the failing tests**

Add to `lib/intent-scoring.test.ts`:

```ts
describe("gradeEffort — Phase 3b: HR ceiling and cadence", () => {
  it("grades an HR ceiling claim by peak HR, not average — a brief spike still counts", () => {
    const o = objective({ kind: "effort", target: { durationMin: 30, targetHrBpm: 154 } });
    const matchedLap = { ...lap(1800, 200, 0), avgHr: 150, maxHr: 170 }; // avg under, peak well over
    const ev = evidence({ laps: [matchedLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBeLessThan(0); // peak spiked well past the ceiling
    expect(result.objective.evidence).toMatch(/peak HR 170/);
  });

  it("grades an HR ceiling claim as compliant when peak stayed under it", () => {
    const o = objective({ kind: "effort", target: { durationMin: 30, targetHrBpm: 154 } });
    const matchedLap = { ...lap(1800, 200, 0), avgHr: 145, maxHr: 150 };
    const ev = evidence({ laps: [matchedLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBe(2);
  });

  it("grades on presence when HR data is missing on all matched laps — never a failed metric", () => {
    const o = objective({ kind: "effort", target: { durationMin: 30, targetHrBpm: 154 } });
    const matchedLap = lap(1800, 200, 0); // avgHr/maxHr both null via the lap() helper default
    const ev = evidence({ laps: [matchedLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBe(1);
    expect(result.objective.evidence).toMatch(/no HR recorded/);
  });

  it("grades a cadence target using the same adherence-delta shape as power", () => {
    const o = objective({ kind: "effort", target: { durationMin: 20, targetCadenceRpm: 95 } });
    const matchedLap = { ...lap(1200, 200, 0), avgCadenceRpm: 96 }; // ~101% adherence
    const ev = evidence({ laps: [matchedLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBe(2);
    expect(result.objective.evidence).toMatch(/96 rpm vs 95 rpm target/);
  });

  // R11 fix (2026-08-12, second review round): VI rides along as evidence text on any matched lap —
  // design doc §8 — never a scored dimension.
  it("includes VI in evidence text when the matched lap has power data", () => {
    const o = objective({ kind: "effort", target: { durationMin: 30, targetHrBpm: 154 } });
    const matchedLap = { ...lap(1800, 200, 0), avgHr: 145, maxHr: 150, npWatts: 214 }; // VI 1.07
    const ev = evidence({ laps: [matchedLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.evidence).toMatch(/VI 1\.07/);
  });

  it("omits VI from evidence text when the matched lap has no power data", () => {
    const o = objective({ kind: "effort", target: { durationMin: 30, targetHrBpm: 154 } });
    const matchedLap = { ...lap(1800, null, 0), avgHr: 145, maxHr: 150 }; // no avgWatts/npWatts
    const ev = evidence({ laps: [matchedLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.evidence).not.toMatch(/VI/);
  });
});

// R2 (resolved 2026-08-12): the undurated HR/cadence path — the flagship "if HR goes over 154bpm dial
// back to stay in z2" note has no stated interval duration, so it must grade against the whole ride.
describe("gradeEffort — Phase 3b: whole-ride HR/cadence grading (R2, no stated duration)", () => {
  it("grades an undurated HR ceiling by the whole ride's peak HR — the flagship '154bpm' case", () => {
    const o = objective({ kind: "effort", target: { targetHrBpm: 154 } }); // no durationMin
    const ev = evidence({ wholeRideMaxHr: 170 });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBeLessThan(0);
    expect(result.objective.evidence).toMatch(/whole ride/i);
    expect(result.objective.evidence).toMatch(/peak HR 170/);
  });

  it("grades an undurated HR ceiling as compliant when the whole ride's peak stayed under it", () => {
    const o = objective({ kind: "effort", target: { targetHrBpm: 154 } });
    const ev = evidence({ wholeRideMaxHr: 150 });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBe(2);
  });

  // R9 fix (2026-08-12 review): unlike the matched-lap path, there is no fallback evidence here at all
  // when whole-ride HR is missing — this must stay ungraded, not earn a presence-based delta:1 that would
  // also inflate evidenceScope and could pass the minimum-evidence gate on zero real evidence.
  it("stays ungraded — not 'graded on presence' — when the ride has no recorded HR at all", () => {
    const o = objective({ kind: "effort", target: { targetHrBpm: 154 } });
    const ev = evidence({ wholeRideMaxHr: null });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(false);
    expect(result.delta).toBeNull();
    expect(result.objective.scopeMin).toBe(0);
    expect(result.objective.evidence).toMatch(/no HR recorded/);
  });

  it("stays ungraded when the ride has no recorded cadence at all", () => {
    const o = objective({ kind: "effort", target: { targetCadenceRpm: 95 } });
    const ev = evidence({ wholeRideAvgCadence: null });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(false);
    expect(result.delta).toBeNull();
    expect(result.objective.scopeMin).toBe(0);
  });

  it("grades an undurated cadence claim by the whole ride's average cadence", () => {
    const o = objective({ kind: "effort", target: { targetCadenceRpm: 95 } });
    const ev = evidence({ wholeRideAvgCadence: 96 });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBe(2);
  });

  it("prefers the matched-lap path over whole-ride grading when a duration IS stated with NO zone", () => {
    const o = objective({ kind: "effort", target: { durationMin: 30, targetHrBpm: 154 } });
    const matchedLap = { ...lap(1800, 200, 0), avgHr: 145, maxHr: 150 };
    // wholeRideMaxHr is deliberately way over the ceiling — must be ignored when duration is stated.
    const ev = evidence({ laps: [matchedLap], wholeRideMaxHr: 200 });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBe(2); // graded on the matched lap's peak (150), not the whole ride's (200)
    expect(result.objective.evidence).not.toMatch(/whole ride/i);
  });

  // R10 fix (2026-08-12, second review round): a stated duration does NOT always mean "match a curated
  // lap" — the real note "1h z2 HR cap at 152" states a duration describing the ride's Z2 phase, not a
  // discrete interval. `zone` being set alongside the HR/cadence target is the signal to grade whole-ride
  // regardless of the stated duration.
  it("grades whole-ride, not matched-lap, when a stated duration is combined with a zone — the real '1h z2 HR cap at 152' shape", () => {
    const o = objective({ kind: "effort", target: { durationMin: 60, zone: "Z2", targetHrBpm: 152 } });
    // Deliberately NO curated lap anywhere near 60 min — a real curated interval set wouldn't have one
    // for a steady zone-time phase. If this misrouted to matched-lap grading it would report "no lap
    // within ±20% of the stated 60 min effort" (delta: -1) despite the ride being executed correctly.
    const ev = evidence({ laps: [{ ...lap(480, 220, 0), avgHr: 140 }], wholeRideMaxHr: 150 });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBe(2); // whole-ride peak (150) comfortably under the 152 ceiling
    expect(result.objective.evidence).toMatch(/whole ride/i);
  });

  it("grades whole-ride cadence too when a stated duration is combined with a zone", () => {
    const o = objective({ kind: "effort", target: { durationMin: 60, zone: "Z2", targetCadenceRpm: 85 } });
    const ev = evidence({ laps: [], wholeRideAvgCadence: 86 });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBe(2);
    expect(result.objective.evidence).toMatch(/whole ride/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/intent-scoring.test.ts -t "HR ceiling and cadence\|whole-ride HR/cadence"
```

Expected: FAIL — `gradeEffort` currently only grades power, `RideEvidence` doesn't have
`wholeRideMaxHr`/`wholeRideAvgCadence` yet (TypeScript error in the `evidence()` fixture calls above), and
`gradeEffort` returns `ungraded("no duration stated")` for every undurated case.

- [ ] **Step 3: Extend `RideEvidence` for whole-ride grading (R2)**

In `lib/intent-scoring.ts`, add to the `RideEvidence` interface (after `ftpUsed: number;`):

```ts
  // Phase 3b (R2): sourced from activity.maxHr/activity.avgCadence — already synced on ActivitySummary,
  // zero new sync cost. Used only when an HR/cadence target states no interval duration (gradeEffort);
  // a duration-stated claim always prefers the more precise matched-lap path instead.
  wholeRideMaxHr: number | null;
  wholeRideAvgCadence: number | null;
```

In `lib/intent-scoring.test.ts`, patch the `evidence()` fixture helper (`lib/intent-scoring.test.ts:82-95`)
— add the two new fields to its default object literal (same fixture-patch pattern Task 2 used for
`ExecutedInterval`):

```ts
function evidence(over: EvidenceSpec = {}): RideEvidence {
  const { z2Min, zone, ...rest } = over;
  const derivedPower =
    zone ?? (z2Min === undefined ? null : [0, Math.round(z2Min * 60), 0, 0, 0, 0, 0]);
  return {
    durationMin: 90,
    isIndoor: false,
    powerZoneTimes: derivedPower,
    hrZoneTimes: null,
    laps: [],
    ftpUsed: 288,
    wholeRideMaxHr: null,
    wholeRideAvgCadence: null,
    ...rest,
  };
}
```

In `lib/intent-runner.ts`, thread the two fields through where `RideEvidence` is built
(`lib/intent-runner.ts:111-118`) — add after `ftpUsed: entry.ftpUsed,`:

```ts
          wholeRideMaxHr: activity.maxHr,
          wholeRideAvgCadence: activity.avgCadence,
```

(`activity` is already in scope there, typed `ActivitySummary`, which already carries both fields —
no new fetch, no new type import needed.)

- [ ] **Step 4: Add the delta function and grading helpers**

Add to `lib/intent-scoring.ts`, near `adherenceDelta`/`complianceDelta` (`lib/intent-scoring.ts:142-160`):

```ts
// Asymmetric by design, unlike adherenceDelta — an HR ceiling is a cap, not a band to sit inside.
// Under the ceiling is unambiguously fine; the penalty scales with how far peak HR exceeded it.
function hrCeilingDelta(peakHr: number, ceilingBpm: number): number {
  const over = peakHr - ceilingBpm;
  if (over <= 0) return 2;
  if (over <= 3) return 1;
  if (over <= 8) return 0;
  if (over <= 15) return -1;
  return -2;
}
```

Add near `gradeEffort` (`lib/intent-scoring.ts:611`), just above it:

```ts
// Missing data is NEVER a failed metric (design §13, same rule gradeEffort's power branch already
// follows below) — matched-on-duration laps with no HR recorded grade on presence, not as a failure.
// (`viEvidenceText` used below was added in Task 7, alongside gradeTerrain — reused here, not redefined.)
function gradeHrCeiling(matched: ExecutedInterval[], scopeMin: number, ceilingBpm: number): Verdict {
  const withHr = matched.filter((lap) => lap.avgHr != null || lap.maxHr != null);
  if (withHr.length === 0) {
    return {
      delta: 1,
      scored: true,
      measurable: true,
      scopeMin,
      evidence: `${matched.length} matching lap${matched.length === 1 ? "" : "s"} (no HR recorded on them, graded on presence)`,
    };
  }
  // Peak, not average — a brief spike over the ceiling is a real finding even if the average stayed under.
  const peakHr = Math.max(...withHr.map((lap) => lap.maxHr ?? lap.avgHr ?? 0));
  const vi = viEvidenceText(matched);
  return {
    delta: hrCeilingDelta(peakHr, ceilingBpm),
    scored: true,
    measurable: true,
    scopeMin,
    evidence: `${matched.length} matching lap${matched.length === 1 ? "" : "s"}, peak HR ${Math.round(peakHr)} vs ${ceilingBpm} bpm ceiling${vi ? `, ${vi}` : ""}`,
  };
}

function gradeCadenceTarget(matched: ExecutedInterval[], scopeMin: number, targetRpm: number): Verdict {
  const withCadence = matched.filter((lap) => lap.avgCadenceRpm != null);
  if (withCadence.length === 0) {
    return {
      delta: 1,
      scored: true,
      measurable: true,
      scopeMin,
      evidence: `${matched.length} matching lap${matched.length === 1 ? "" : "s"} (no cadence recorded on them, graded on presence)`,
    };
  }
  const meanCadence = withCadence.reduce((sum, lap) => sum + (lap.avgCadenceRpm ?? 0), 0) / withCadence.length;
  const pct = (meanCadence / targetRpm) * 100;
  const vi = viEvidenceText(matched);
  return {
    delta: adherenceDelta(pct), // same symmetric band as power — a cadence TARGET (not ceiling) behaves like one
    scored: true,
    measurable: true,
    scopeMin,
    evidence: `${matched.length} matching lap${matched.length === 1 ? "" : "s"} averaging ${Math.round(meanCadence)} rpm vs ${targetRpm} rpm target (${Math.round(pct)}% adherence)${vi ? `, ${vi}` : ""}`,
  };
}

// R2 (resolved 2026-08-12): the whole-ride fallback for an HR ceiling/cadence target with no stated
// interval duration — the phase's own motivating case. Reuses hrCeilingDelta/adherenceDelta, same curves
// as the matched-lap helpers above, just sourced from the whole ride. scopeMin is the FULL ride duration:
// this genuinely is whole-ride evidence, unlike a matched lap's local scope.
//
// R9 fix (2026-08-12 review): missing data here returns ungraded(), NOT the matched-lap helpers'
// "delta:1, scored:true, graded on presence" shape. Those helpers' presence-grading is defensible because
// a MATCHED LAP already proves real evidence exists (the athlete completed a qualifying effort) even when
// one specific field on it is missing. Here there is no matched lap and no fallback signal at all — if
// wholeRideMaxHr/wholeRideAvgCadence is null, there is LITERALLY NO EVIDENCE for this objective, not one
// missing field among several. Returning scored:true with the full ride's scopeMin would let a ride with
// zero real evidence for this claim both earn a neutral-positive delta AND inflate evidenceScope enough
// to pass the minimum-evidence gate (`assessScoreability`, `lib/intent-scoring.ts:790`) — exactly the
// "data it cannot speak to contributes nothing" rule the scorer's own module header locks in.
function gradeWholeRideHrCeiling(evidence: RideEvidence, ceilingBpm: number): Verdict {
  if (evidence.wholeRideMaxHr == null) {
    return ungraded("no HR recorded for the ride (whole-ride ceiling claim, no evidence to grade)");
  }
  return {
    delta: hrCeilingDelta(evidence.wholeRideMaxHr, ceilingBpm),
    scored: true,
    measurable: true,
    scopeMin: evidence.durationMin,
    evidence: `whole ride, peak HR ${Math.round(evidence.wholeRideMaxHr)} vs ${ceilingBpm} bpm ceiling (no interval duration stated)`,
  };
}

function gradeWholeRideCadence(evidence: RideEvidence, targetRpm: number): Verdict {
  if (evidence.wholeRideAvgCadence == null) {
    return ungraded("no cadence recorded for the ride (whole-ride target, no evidence to grade)");
  }
  const pct = (evidence.wholeRideAvgCadence / targetRpm) * 100;
  return {
    delta: adherenceDelta(pct),
    scored: true,
    measurable: true,
    scopeMin: evidence.durationMin,
    evidence: `whole ride averaged ${Math.round(evidence.wholeRideAvgCadence)} rpm vs ${targetRpm} rpm target (${Math.round(pct)}% adherence, no interval duration stated)`,
  };
}
```

- [ ] **Step 5: Route `gradeEffort` to the new branches — including the R2 whole-ride early return**

`gradeEffort`'s FIRST lines currently are:

```ts
function gradeEffort(objective: ScoredObjective, evidence: RideEvidence, pool: ExecutedInterval[]): Verdict {
  const target = objective.target ?? {};
  const stated = numeric(target.durationMin);
  // Checked first: with no window there is nothing to evaluate over, whatever else is present.
  if (stated === null || stated <= 0) return ungraded("no duration stated for this effort");
```

Replace that early-return line — this is the exact fix for R2, the plan's other P0 blocker (the phase's
motivating note states no interval duration, and this line used to reject it outright with no path to a
score). **Also folds in the R10 fix (2026-08-12, second review round)**, described in the comment below:

```ts
function gradeEffort(objective: ScoredObjective, evidence: RideEvidence, pool: ExecutedInterval[]): Verdict {
  const target = objective.target ?? {};
  const stated = numeric(target.durationMin);
  // R2/R10 (resolved 2026-08-12): an HR/cadence target grades against the whole ride, not a matched lap,
  // whenever EITHER (a) no interval duration is stated at all (R2's flagship "154bpm" case), OR (b) a
  // `zone` is ALSO stated alongside the HR/cadence target (R10) — `zone` signals a whole-ride/aggregate
  // -shaped claim. The real note "1h z2 HR cap at 152" states a 60-min duration, but that duration
  // describes the ride's Z2 PHASE, not a discrete curated interval — Intervals.icu does not curate steady
  // zone-time riding as a lap, so routing it through matchLaps's ±20% duration window would search for a
  // ~60-min curated lap that will almost never exist, and fail the claim outright even though the athlete
  // executed it correctly. This mirrors the codebase's existing convention that zone-based claims are
  // always graded from whole-ride aggregate data (gradeZoneTime/gradeZoneEmphasis), never lap-matching.
  // A duration-only HR/cadence claim with NO zone (a genuinely short structured effort, e.g. "20 min at
  // HR 165") still prefers the more precise matched-lap path below — only `zone`'s presence changes the
  // routing, not duration size alone. (Residual, not solved here: a large duration-only claim with no
  // zone that's actually ride-scale, not a curated interval, can still misroute — no real note sampled
  // during this phase's design exhibited that shape.)
  const noDuration = stated === null || stated <= 0;
  const wholeRideShaped = noDuration || target.zone !== undefined;
  if (wholeRideShaped && target.targetHrBpm != null) return gradeWholeRideHrCeiling(evidence, target.targetHrBpm);
  if (wholeRideShaped && target.targetCadenceRpm != null) return gradeWholeRideCadence(evidence, target.targetCadenceRpm);
  // Checked here: with no window and no whole-ride-gradable field, there is nothing to evaluate over.
  if (noDuration) return ungraded("no duration stated for this effort");
```

The rest of `gradeEffort`'s body (resolveTargetWatts, the `pool.length === 0` check, `matchLaps`, the
`matched.length < required` block) is unchanged — it only runs once a duration IS stated, so it always
takes the matched-lap path over the whole-ride one. Then, after the existing
`if (matched.length < required) { ... }` block and before `const withPower = matched.filter(...)`,
insert (unchanged from the original plan — this is the duration-stated routing, separate from the R2
early return above):

```ts
  // One target field drives grading — same priority matchLaps' ranking already used (Task 6).
  if (target.targetHrBpm != null) return gradeHrCeiling(matched, scopeMin, target.targetHrBpm);
  if (target.targetCadenceRpm != null) return gradeCadenceTarget(matched, scopeMin, target.targetCadenceRpm);
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run lib/intent-scoring.test.ts
npx tsc --noEmit
```

Expected: PASS, no TypeScript errors. `npx tsc --noEmit` also exercises `lib/intent-runner.ts`'s
`RideEvidence` construction — confirm it compiles with the two new fields added in Step 3.

- [ ] **Step 7: Commit**

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts lib/intent-runner.ts
git commit -m "feat(intent-scoring): grade HR-ceiling and cadence effort claims, including the whole-ride undurated case (R2)"
```

---

## Task 9: Verify the debrief renders terrain/HR/cadence evidence with no UI changes

**Why this task exists:** `components/dashboard/ride-intent.tsx`'s `RideIntentBlock` renders every
measurable objective generically — `measurable.map((o) => <li>{o.description}{o.evidence}</li>)`, no
per-kind branching (verified by reading the full 66-line file during this plan's writing). That means
Tasks 6-8's new `terrain`/HR-ceiling/cadence objectives should already render correctly with **zero**
changes to this component. "Should" is not "does" — this task proves it with a real test rather than
leaving it as an assumption the rest of this plan quietly depends on.

**Files:**
- Test: `components/dashboard/ride-intent.test.tsx` (check first whether it exists — if it does, add to
  it; if not, this step's fixture-setup should follow whatever pattern the nearest sibling component test
  uses, e.g. grep `components/dashboard/*.test.tsx` for an existing `EffectiveOutcome`/`IntentOverlay`
  fixture builder to reuse rather than inventing a new one)

- [ ] **Step 1: Check for an existing test file and its fixture pattern**

```bash
ls components/dashboard/ride-intent.test.tsx 2>&1
grep -rn "EffectiveOutcome\|IntentOverlay" components/dashboard/*.test.tsx 2>/dev/null | head -10
```

- [ ] **Step 2: Write the failing test**

Add (to the existing file, or create `components/dashboard/ride-intent.test.tsx` with a
`/** @vitest-environment jsdom */` docblock at the top, matching this repo's per-file jsdom convention):

```tsx
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RideIntentBlock } from "./ride-intent";
import type { EffectiveOutcome, ScoredObjective } from "@/lib/types";

function outcomeWith(objectives: ScoredObjective[]): EffectiveOutcome {
  return {
    effectiveExecutionScore: 7,
    origin: "self-directed",
    source: "overlay",
    overlay: {
      id: "ov-1", activityId: "act-1", date: "2026-08-12", noteFingerprint: "fp",
      status: "active", origin: "self-directed", effectiveExecutionScore: 7, notScoredReason: null,
      interpretation: {
        intent: { primaryPurpose: "endurance with a climb", phases: [] },
        confidence: "high", objectives, model: "claude-sonnet-4-6", promptVersion: 2,
      },
      scoringVersion: 1, schemaVersion: 1, createdAt: "2026-08-12T12:00:00.000Z",
      approvedAt: null, supersededBy: null,
    },
  };
}

describe("RideIntentBlock — Phase 3b evidence rendering (no component changes expected)", () => {
  it("renders a terrain objective's evidence text with no special-casing needed", () => {
    const outcome = outcomeWith([{
      description: "did a climb", kind: "terrain", target: { terrain: "climb", durationMin: 8 },
      zoneBasis: "unspecified", grounded: true, sourceText: "did a climb",
      measurable: true, scored: true, scopeMin: 8,
      evidence: "8.0 min climb vs 8 min stated (labelled) — avg 6.2%, VAM 780 m/h",
    }]);
    render(<RideIntentBlock outcome={outcome} activityDecoupling={1} />);
    expect(screen.getByText(/did a climb/)).toBeTruthy();
    expect(screen.getByText(/VAM 780 m\/h/)).toBeTruthy();
  });

  it("renders an HR-ceiling objective's evidence text", () => {
    const outcome = outcomeWith([{
      description: "stay under 154bpm", kind: "effort", target: { durationMin: 30, targetHrBpm: 154 },
      zoneBasis: "heart-rate", grounded: true, sourceText: "under 154bpm",
      measurable: true, scored: true, scopeMin: 30,
      evidence: "1 matching lap, peak HR 150 vs 154 bpm ceiling",
    }]);
    render(<RideIntentBlock outcome={outcome} activityDecoupling={1} />);
    expect(screen.getByText(/peak HR 150 vs 154 bpm ceiling/)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it currently fails or passes**

```bash
npx vitest run components/dashboard/ride-intent.test.tsx -t "Phase 3b"
```

**Expected: PASS already**, with zero changes to `ride-intent.tsx` — this is the point of the task. If
it fails, that means the "no UI changes needed" claim in this plan's Architecture section was wrong;
investigate `RideIntentBlock`'s actual rendering logic (`components/dashboard/ride-intent.tsx`) rather
than assuming this test is broken, and fix the component if it genuinely can't render a `terrain`-kind
or HR-targeted objective's evidence — do not silently work around a real rendering gap.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/ride-intent.test.tsx
git commit -m "test(ride-intent): prove terrain/HR-ceiling evidence renders with no component changes"
```

---

## Task 10: Docs — `INVARIANTS.md` and the scoring/learning systems doc

**Files:**
- Modify: `docs/INVARIANTS.md`
- Modify: `docs/systems/02-scoring-and-learning.md`

- [ ] **Step 1: Confirm the current invariant ceiling**

```bash
grep -n "^[0-9]\+\." docs/INVARIANTS.md | tail -1
```

Use the printed number + 1 below — do not hard-code 56 if this prints something else (another PR may
have landed an invariant since this plan was written).

- [ ] **Step 2: Append the new invariant**

Add to `docs/INVARIANTS.md`, after the current last item:

```
<N>. **A `terrain` objective is graded on existence and duration compliance only, never on technique.**
    `gradeTerrain` (`lib/intent-scoring.ts`) must never produce a skill/quality verdict for a climb or
    descent — that stays the explicit non-goal it always was (design doc §15: "no scoring technical
    descending/cornering from speed alone"). A future change that makes gradeTerrain's delta depend on
    anything besides matched-lap existence and duration-vs-stated compliance is the thing this invariant
    exists to catch.
```

(Replace `<N>` with the actual next number from Step 1.)

- [ ] **Step 3: Update the scoring/learning systems doc**

In `docs/systems/02-scoring-and-learning.md`'s "Known rough edges" section, add a new bullet (grep the
file for `## Known rough edges` to find the section, add at the end of the existing bullet list):

```
- **Phase 3b (2026-08-12) added HR-ceiling, cadence and terrain claims to self-directed intent-scoring.**
  `ExecutedInterval` gained `maxHr`/`avgCadenceRpm`/`maxGradientPct`/`elevationGainM`/`label`; `matchLaps`
  now ranks by whichever target field an objective stated (never a blend — `TargetSchema` enforces at
  most one of {power, HR, cadence, terrain} per objective; `zone`/`durationMin`/`reps` may still co-occur
  with any of them). Terrain matching is label-first (`ExecutedInterval.label`, athlete-typed free text —
  real per Intervals.icu's own labelling feature, but null on every real ride sampled during design; the
  athlete had not started labelling yet), gradient-fallback second — climb uses `maxGradientPct` (peak),
  descent uses `avgGradientPct` (signed average; a peak-gradient check is the wrong statistic for
  descents, found in this phase's own review). **An HR/cadence claim with no stated interval duration
  (the phase's own motivating note, "if HR goes over 154bpm dial back to stay in z2") grades against the
  WHOLE ride** (`RideEvidence.wholeRideMaxHr`/`wholeRideAvgCadence`, from already-synced
  `activity.maxHr`/`activity.avgCadence`) rather than staying ungraded — a duration-stated claim always
  prefers the more precise matched-lap path instead. **Per-interval `decoupling` is also real and
  synced-for-free on the same payload but has no consumer yet** — flagged here as a future unlock for the
  segment-scoped aerobic drift feature this doc already notes is deferred (Phase 2b's Handoff boundary),
  not built by Phase 3b.
```

- [ ] **Step 4: Commit**

```bash
git add docs/INVARIANTS.md docs/systems/02-scoring-and-learning.md
git commit -m "docs: record Phase 3b's terrain-grading invariant and cross-reference the decoupling unlock"
```

---

## Task 11: Live smoke test

Per AGENTS.md: "LLM-backed paths need one live smoke run. Unit tests + a green build only prove the
deterministic scaffolding around a prompt — they don't exercise the real Anthropic call." This phase
changed `lib/intent-prompt.ts` (Task 3) — that must be exercised against the real API before this phase
is done.

**Files:** none (verification only — do not skip this task or mark it done from unit tests alone).

**Revised 2026-08-12 (R7 review finding).** The original Step 1 below suggested exercising the existing
`/api/intent` flow directly against the primary data store. `runIntentParsing` (which that route calls)
persists via `updateIntentOverlays`/`supersedeAndAppend` — that would write real, superseding
`IntentOverlay` records into the athlete's actual data. **Use the same sandboxed-data-directory pattern
Phase 2b's Task 9 already established** (`docs/superpowers/plans/2026-08-07-adaptive-coach-p2b-intent-scoring.md`,
Task 9 Step 1) instead of inventing a new mechanism: `NODEVELO_DATA_DIR` is read fresh on every store call
(`lib/json-store.ts:21`), so pointing it at a throwaway copy gets the real end-to-end path (real HTTP, real
queue/supersession logic) with zero risk to the primary store.

- [ ] **Step 1: Build the sandbox**

```bash
export SMOKE_DIR="$(mktemp -d -t nodevelo-p3b)"
cp -R "/Users/otis/Cycling App/data/." "$SMOKE_DIR/"
ls "$SMOKE_DIR" | head -30 && echo "SMOKE_DIR=$SMOKE_DIR"
```

Never run this against the primary `data/` directory directly — every subsequent step in this task reads
and writes `$SMOKE_DIR` only.

- [ ] **Step 2: Locate the flagship note in the sandbox, or seed it**

```bash
grep -n "154bpm" "$SMOKE_DIR/last-sync.json" | head -5
```

The athlete's real "if HR goes over 154bpm dial back to stay in z2" note (no stated interval duration —
this is exactly the R2 whole-ride case) was present in the data as of this plan's writing (activity
`i175011797`). If the grep finds it, note that activity's `id` and date from the surrounding JSON. **If
it finds nothing** (the athlete may have edited/removed it since), seed an equivalent note onto any
recent activity in the sandbox the same way P2b's Task 9 seeded `autoFromDate` — a small `node -e` script
reading `$SMOKE_DIR/last-sync.json`, setting that activity's `description` to *"Endurance ride, if HR
goes over 154bpm dial back to stay in z2. Also did a proper climb about 10 minutes long."*, and writing
the file back. Either way, record the activity's `date` — Step 4 needs it.

- [ ] **Step 3: Start the dev server against the sandbox**

```bash
NODEVELO_DATA_DIR="$SMOKE_DIR" npm run dev
```

(In a separate terminal/background process — Step 4 curls it.)

- [ ] **Step 4: Trigger intent parsing for that activity and read the real output**

```bash
curl -sf -X POST http://127.0.0.1:3000/api/intent -H 'content-type: application/json' \
  -d '{"today":"<the activity date from Step 2>","force":true}' | head -80
cat "$SMOKE_DIR/intent-overlays.json"
```

Read the actual model output and the actual graded verdict — don't just confirm the request succeeded.
Confirm, in order:

1. **Parsing (Task 3):** the parsed `StructuredIntent`/`objectives` include an `effort` objective with
   `zoneBasis: "heart-rate"` and `target.targetHrBpm: 154`, with **no `target.durationMin`** (not
   misclassified as `zone-time` or `qualitative`; not given an invented duration). If the note also
   describes a climb, confirm a separate `terrain` objective with `target.terrain: "climb"` — distinct
   from the HR-ceiling objective, not merged, not dropped (this also exercises R5's schema refine: two
   separate objectives, not one objective with both fields set).
2. **Grounding (R1):** confirm the HR-ceiling objective's `grounded` stayed `true` through
   `verifyGrounding` — check the overlay wasn't silently downgraded to "not grounded in the note" in the
   acknowledged-objectives list.
3. **Scoring (R2 — the actual point of this whole task, not just parsing shape):** confirm the overlay's
   `effectiveExecutionScore` is a real number, and the graded `objectives[]` entry for the HR-ceiling
   claim has `scored: true` with an `evidence` string containing **"whole ride"** and a peak-HR-vs-154
   comparison (`gradeWholeRideHrCeiling`, Task 8). A `null` score or a `scored: false` HR objective means
   the whole-ride path did not fire — check `activity.maxHr` is actually present in
   `$SMOKE_DIR/last-sync.json` for this activity before concluding the code is wrong.

This is exactly the `INTENT_PROMPT_VERSION` bump's real test; the prompt wording in Task 3 was a best
guess until this step confirms it — and exactly R2's real test, which unit tests with an injected
`durationMin: 30` never exercised.

- [ ] **Step 5: Record the result**

If the model correctly distinguishes the HR-ceiling claim and the terrain claim, and a real whole-ride
score comes out, note this in the PR description and move on. If it does not — e.g. it classifies the HR
ceiling as `qualitative`, invents a duration, invents a terrain claim from a purely qualitative "nice
climb" phrase, or the score stays `null` — revise `lib/intent-prompt.ts`'s wording from Task 3 Step 8 (or
the `gradeEffort`/`gradeWholeRideHrCeiling` logic from Task 8, if the parsing was correct but the grading
wasn't) and re-run this smoke test before considering the phase done. This is the one step in this plan
that cannot be fully specified in advance; use judgment against the actual output.

- [ ] **Step 6: Tear down the sandbox**

```bash
rm -rf "$SMOKE_DIR"
```

The dev server process from Step 3 can be stopped once Steps 4-5 are done — nothing in the sandbox is
meant to persist past this task.

- [ ] **Step 7: Flag the still-outstanding label-match smoke test**

The label-match path (a `label`-carrying interval actually winning a terrain match) has **not** been
live-smoke-tested by this task, because no real ride in the athlete's data had a label set as of this
plan's writing. Note this explicitly in the PR description: *"Label-match path verified by unit tests
only (Task 6) — needs a second live-smoke check once the athlete has labelled a real ride's intervals."*
Do not claim this path is fully verified; it isn't yet, by design (there's no real data to verify it
against until the athlete adopts the labelling habit).

- [ ] **Step 8: Final check and commit if anything changed**

```bash
npm run check
npx vitest run
```

Expected: PASS. If Step 5 required a prompt or grading-logic revision, commit it:

```bash
git add lib/intent-prompt.ts lib/intent-scoring.ts
git commit -m "fix(intent-prompt): correct HR-ceiling/terrain classification per live smoke test"
```

If no revision was needed, this task ends with no new commit — the smoke run itself is the deliverable,
recorded in the PR description per Steps 5 and 7.

---

## Handoff

This plan implements everything in `docs/superpowers/specs/2026-08-12-adaptive-coach-p3b-interval-context-design.md`.
Explicit non-goals (§10 of that doc) are not tasks here on purpose — Strava segment resolution,
per-interval CP/W′, HR/cadence ranges, speed, torque, per-interval training-load/strain/intensity,
`groupId` cleanup, and any change to the planned-ride adherence path (`lib/interval-match.ts`) all stay
out of scope.
