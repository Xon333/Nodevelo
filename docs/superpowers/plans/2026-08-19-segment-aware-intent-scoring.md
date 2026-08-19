# Segment-aware intent scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grade named self-directed ride segments from their athlete-curated Intervals.icu laps, producing 9/10 for the August 19 acceptance ride while removing the generic-score flash and false `Rest` classification.

**Architecture:** Add one `segment` objective that preserves label, duration range, average-power zone, and NP zone. The existing deterministic intent scorer matches each objective to one labelled lap and grades it with ride-date FTP/zone boundaries; existing whole-ride objectives remain unchanged. The current deferred analysis state supplies the UI pending treatment, so no new persistence or route is added.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Zod, Vitest, Testing Library.

**Design doc:** `docs/superpowers/specs/2026-08-19-segment-aware-intent-scoring-design.md`

## Global Constraints

- Use Intervals.icu labels only; never infer segment boundaries from streams, duration, terrain, or zones.
- Use `physiologyAsOf(store, rideDate)?.powerZonePct`; never population/default zones for segment NP.
- Average zone reads `avgWatts`; normalized-power zone reads `npWatts`; neither reads whole-ride zone seconds.
- Missing/ambiguous labels or required metrics are ungraded, not failed and not whole-ride fallbacks.
- Frozen ledger rows and historical overlays are never rewritten.
- Bump `INTENT_PROMPT_VERSION`, `INTENT_SCORING_VERSION`, and new overlay schema writes; do not bump block-generation `PROMPT_VERSION`.
- Any changed AI path gets one live forced re-analysis and human-readable output inspection.
- Preserve all existing canonicalisation stage ordering and confidence/grounding monotonicity.
- Stage only files named by the active task; never `git add .` or `git add -A`.

---

### Task 1: Represent and ground named segment intent

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/intent-schema.ts`
- Modify: `lib/intent-prompt.ts`
- Modify: `lib/anthropic-api.ts`
- Modify: `lib/intent-grounding.ts`
- Test: `lib/intent-schema.test.ts`
- Test: `lib/intent-prompt.test.ts`
- Test: `lib/intent-grounding.test.ts`

**Interfaces:**
- Produces: `ObjectiveKind` including `"segment"`; `IntentTarget.segmentLabel`, `durationMaxMin`, `avgPowerZone`, `normalizedPowerZone`; matching phase fields in `StructuredIntent`.
- Preserves: parser input remains exactly note + ride duration.

- [ ] **Step 1: Write failing schema tests** for a valid Rolling segment, a valid 45–60 minute Flat segment, and rejection of a segment without a label, an upper duration without a lower duration, or an inverted range.

```ts
const rolling = {
  description: "Rolling Terrain: Z3 avg, Z4 NP, 20m",
  kind: "segment",
  zoneBasis: "power",
  target: {
    segmentLabel: "Rolling Terrain",
    durationMin: 20,
    avgPowerZone: "Z3",
    normalizedPowerZone: "Z4",
  },
  grounded: true,
  sourceText: "Rolling Terrain segment (Z3 avg, Z4 NP, 20m)",
};
expect(parseIntentToolOutput(toolInput({ objectives: [rolling] })).data).not.toBeNull();
expect(parseIntentToolOutput(toolInput({ objectives: [{ ...rolling, target: { durationMin: 20 } }] })).data).toBeNull();
expect(parseIntentToolOutput(toolInput({ objectives: [{ ...rolling, target: { segmentLabel: "Flat 1", durationMaxMin: 60 } }] })).data).toBeNull();
expect(parseIntentToolOutput(toolInput({ objectives: [{ ...rolling, target: { segmentLabel: "Flat 1", durationMin: 60, durationMaxMin: 45 } }] })).data).toBeNull();
```

- [ ] **Step 2: Run the schema tests and verify failure.**

Run: `npx vitest run lib/intent-schema.test.ts`

Expected: FAIL because `segment` and the new strict-schema fields are unknown.

- [ ] **Step 3: Add the minimal types and Zod refinements.** Add the four target fields, mirror them on `PhaseSchema`, and refine `ObjectiveSchema` so `segment` requires a label and one measurable target. Map every phase field explicitly in `parseRideIntent`; do not use a spread.

```ts
export type ObjectiveKind = "duration" | "zone-time" | "zone-emphasis" | "effort" | "structure" | "qualitative" | "terrain" | "segment";

export interface IntentTarget {
  durationMin?: number;
  durationMaxMin?: number;
  segmentLabel?: string;
  avgPowerZone?: string;
  normalizedPowerZone?: string;
  // existing fields unchanged
}
```

- [ ] **Step 4: Write failing grounding tests** proving `45–60m` grounds both bounds, `Z3 avg` grounds only `avgPowerZone`, `Z4 NP` grounds only `normalizedPowerZone`, and another segment's same-zone text cannot ground the wrong source span.

```ts
expect(verifyGrounding(segmentObjective({
  segmentLabel: "Flat 1", durationMin: 45, durationMaxMin: 60, avgPowerZone: "Z3",
  sourceText: "Flat 1 segment (Steady Z3 45-60m)",
}), NOTE)).toBe(true);

expect(verifyGrounding(segmentObjective({
  segmentLabel: "Rolling Terrain", normalizedPowerZone: "Z5",
  sourceText: "Rolling Terrain segment (Z3 avg, Z4 NP, 20m)",
}), NOTE)).toBe(false);
```

- [ ] **Step 5: Implement field-specific grounding.** Add `groundsDurationRange`, `groundsSegmentLabel`, and qualified-zone checks. `verifyGrounding` must require both range endpoints and every supplied segment field.

```ts
const avgQualified = new RegExp(`(?:${zonePattern}[^\n]{0,24}(?:avg|average)|(?:avg|average)[^\n]{0,24}${zonePattern})`, "i");
const npQualified = new RegExp(`(?:${zonePattern}[^\n]{0,24}(?:np|normalized power)|(?:np|normalized power)[^\n]{0,24}${zonePattern})`, "i");
```

- [ ] **Step 6: Update the prompt and its leak/contract tests.** Instruct the model to emit one `segment` objective for each explicitly named phase, preserve duration ranges, treat avg/NP as power, and never decompose them into `zone-time`. Bump `INTENT_PROMPT_VERSION` from 2 to 3.

- [ ] **Step 7: Run targeted tests.**

Run: `npx vitest run lib/intent-schema.test.ts lib/intent-prompt.test.ts lib/intent-grounding.test.ts lib/anthropic-api.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add lib/types.ts lib/intent-schema.ts lib/intent-prompt.ts lib/anthropic-api.ts lib/intent-grounding.ts lib/intent-schema.test.ts lib/intent-prompt.test.ts lib/intent-grounding.test.ts lib/anthropic-api.test.ts
git commit -m "feat(intent): preserve named segment targets"
```

### Task 2: Match curated labels without guessing

**Files:**
- Modify: `lib/intent-scoring.ts`
- Test: `lib/intent-scoring.test.ts`

**Interfaces:**
- Produces: exported `segmentLabelKey(label: string): string` and `matchSegment(target, laps): ExecutedInterval[]` for deterministic tests.
- Consumes: Task 1 segment target fields.

- [ ] **Step 1: Write failing label-matching tests.** Cover `Flat 1` ↔ `Flat1`, `Rolling Terrain segment` ↔ `Rolling Terrain 1`, exact-match precedence, unique trailing-number fallback, ambiguity, null labels, and lap consumption.

```ts
expect(matchSegment({ segmentLabel: "Flat 1" }, [namedLap("Flat1")])).toEqual([expect.objectContaining({ label: "Flat1" })]);
expect(matchSegment({ segmentLabel: "Rolling Terrain segment" }, [namedLap("Rolling Terrain 1")])).toHaveLength(1);
expect(matchSegment({ segmentLabel: "Rolling Terrain" }, [namedLap("Rolling Terrain 1"), namedLap("Rolling Terrain 2")])).toEqual([]);
expect(matchSegment({ segmentLabel: "Flat 1" }, [namedLap(null)])).toEqual([]);
```

- [ ] **Step 2: Run the test and verify failure.**

Run: `npx vitest run lib/intent-scoring.test.ts -t "segment label"`

Expected: FAIL because the helpers do not exist.

- [ ] **Step 3: Implement the conservative matcher next to existing lap matching.**

```ts
export function segmentLabelKey(label: string): string {
  return label.toLowerCase().replace(/\bsegment\b/g, "").replace(/[^a-z0-9]+/g, "");
}

export function matchSegment(target: IntentTarget, laps: ExecutedInterval[]): ExecutedInterval[] {
  const wanted = target.segmentLabel ? segmentLabelKey(target.segmentLabel) : "";
  if (!wanted) return [];
  const exact = laps.filter((lap) => lap.label && segmentLabelKey(lap.label) === wanted);
  if (exact.length === 1) return exact;
  if (exact.length > 1 || /\d$/.test(wanted)) return [];
  const suffixed = laps.filter((lap) => lap.label && new RegExp(`^${wanted}\\d+$`).test(segmentLabelKey(lap.label)));
  return suffixed.length === 1 ? suffixed : [];
}
```

- [ ] **Step 4: Add `segment` to canonical identity/merge rules.** Identity includes all new fields. `mergeKey` includes normalized label; `mergeGroup` keeps one segment and never sums duration. Subsumption drops same-source duration, zone-time, zone-emphasis, and structure objectives when a stronger segment objective exists.

- [ ] **Step 5: Add decomposition-invariance tests.** The August 19 four segments must remain four canonical segment objectives; Rolling Z3 and Flat 1 Z3 must never become 65 minutes, and Rolling Z4 NP must never merge with Short Effort Z4 avg.

- [ ] **Step 6: Run targeted tests and commit.**

Run: `npx vitest run lib/intent-scoring.test.ts -t "segment"`

Expected: PASS.

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "feat(intent): bind objectives to curated segment labels"
```

### Task 3: Grade segment duration, average power, NP, order, and precision

**Files:**
- Modify: `lib/intent-scoring.ts`
- Test: `lib/intent-scoring.test.ts`

**Interfaces:**
- Extends: `RideEvidence.powerZoneTopsPct: number[] | null`.
- Produces: segment evidence naming the matched label, duration, average watts/zone, and NP watts/zone.

- [ ] **Step 1: Write failing component-boundary tests.** Include exact-duration ratios 0.69/0.70/0.85/1.15/1.30/1.31; inclusive range bounds; 15% range-near-miss; same/adjacent/two-zones-away power; and missing NP/zone boundaries.

- [ ] **Step 2: Add the August 19 acceptance test before implementation.** Use four labelled laps with start indices in order, FTP 288, and zone tops `[55,75,90,105,120,150,999]`.

```ts
const result = scoreIntentExecution(aug19Interpretation(), evidence({
  durationMin: 109,
  ftpUsed: 288,
  powerZoneTopsPct: [55, 75, 90, 105, 120, 150, 999],
  laps: [
    namedLap("Rolling Terrain 1", 1312, 238, 263, 100),
    namedLap("Flat 1", 3249, 220, 232, 1412),
    namedLap("Flat 2", 1156, 190, 214, 4661),
    namedLap("Short Effort", 411, 285, 309, 5817),
  ],
}), AUG_19_NOTE);
expect(result.score).toBe(9);
expect(result.objectives).toHaveLength(4);
expect(result.objectives.every((o) => !o.evidence?.includes("min in Z"))).toBe(true);
```

- [ ] **Step 3: Run and verify failure.**

Run: `npx vitest run lib/intent-scoring.test.ts -t "August 19|segment grading"`

Expected: FAIL with no segment grader / score not 9.

- [ ] **Step 4: Implement ride-date zone resolution and component grading.** Reject malformed/nonascending tops. Use `lap.zone` only as an average-zone fallback; NP requires watt boundaries.

```ts
function powerZoneIndex(watts: number, ftp: number, tops: number[]): number | null {
  if (!(watts > 0 && ftp > 0) || tops.length < 2 || tops.some((v, i) => i > 0 && v <= tops[i - 1])) return null;
  const pct = (watts / ftp) * 100;
  const index = tops.findIndex((top) => pct <= top);
  return index < 0 ? tops.length : index;
}
```

- [ ] **Step 5: Implement segment deltas exactly as the design specifies.** Add `segment: { min: -3, max: 3 }` to `KIND_BAND`. Missing required power evidence returns ungraded. Store the matched lap/start index and precision bit internally without persisting new telemetry fields.

- [ ] **Step 6: Implement group order and precision bonuses.** After ordinary bounded aggregation, add one point for strictly increasing known segment start indices and one point only when every scored segment is precise. Drop same-source structure scoring when segments own order. Clamp final result to 1–10.

- [ ] **Step 7: Add regression tests.** Whole-ride `zone-time` without a segment label still reads aggregate arrays; an unmatched labelled segment never falls back; each lap is consumed once; wrong/unknown order earns no point but no penalty; all-precise ordered segments reach 10; one merely compliant segment keeps the result at 9.

- [ ] **Step 8: Run the full scorer suite and commit.**

Run: `npx vitest run lib/intent-scoring.test.ts`

Expected: PASS.

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "feat(intent): score average and NP by named segment"
```

### Task 4: Supply effective-dated zones and version new overlays

**Files:**
- Modify: `lib/intent-runner.ts`
- Modify: `lib/intent-scoring.ts`
- Test: `lib/intent-runner.test.ts`
- Test: `lib/intent-overlay.test.ts`

**Interfaces:**
- Consumes: `readPhysiology()` and `physiologyAsOf(store, item.date)?.powerZonePct`.
- Produces: newly parsed overlays stamped with intent scoring version 2 and overlay schema version 2.

- [ ] **Step 1: Write a failing runner test** with a physiology history whose current zones differ from the ride-date snapshot. Assert the scorer receives the historical tops, not current tops.

- [ ] **Step 2: Run and verify failure.**

Run: `npx vitest run lib/intent-runner.test.ts -t "ride-date power zones"`

Expected: FAIL because the runner does not read physiology or populate `powerZoneTopsPct`.

- [ ] **Step 3: Read physiology with the runner's existing parallel store reads and populate evidence.**

```ts
const [lastSync, scoreLog, initialStore, physiology] = await Promise.all([
  readLastSync(), readScoreLog(), readIntentOverlays(), readPhysiology(),
]);
// ...
powerZoneTopsPct: physiologyAsOf(physiology, item.date)?.powerZonePct ?? null,
```

- [ ] **Step 4: Bump deterministic versions.** Set `INTENT_SCORING_VERSION = 2` and new overlay writes to schema version 2. Keep old schema-1 overlays coherent/applicable; add a round-trip test for both versions.

- [ ] **Step 5: Run runner/overlay tests and commit.**

Run: `npx vitest run lib/intent-runner.test.ts lib/intent-overlay.test.ts`

Expected: PASS.

```bash
git add lib/intent-runner.ts lib/intent-scoring.ts lib/intent-runner.test.ts lib/intent-overlay.test.ts
git commit -m "feat(intent): anchor segments to ride-date power zones"
```

### Task 5: Prevent contextual “rest day” misclassification

**Files:**
- Modify: `lib/intent-scoring.ts`
- Test: `lib/intent-scoring.test.ts`

- [ ] **Step 1: Write failing provenance tests.** The August 19 purpose plus segment phases must resolve from the highest stated segment zone (`VO2max` for Z5 NP), not `Rest`; a bare rest purpose with no zones remains `Rest`; a recovery spin after a rest day remains `Recovery`.

- [ ] **Step 2: Run and verify failure.**

Run: `npx vitest run lib/intent-scoring.test.ts -t "rest day"`

Expected: FAIL with `Rest` for the August 19 fixture.

- [ ] **Step 3: Make Rest a fallback after phase-zone resolution.** Remove `rest` from the first-pass purpose patterns, inspect both ordinary `targetZone` and segment avg/NP zones, then apply the Rest regex only when no workout-bearing purpose or phase zone resolved.

- [ ] **Step 4: Run tests and commit.**

Run: `npx vitest run lib/intent-scoring.test.ts`

Expected: PASS.

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "fix(intent): ignore contextual rest-day wording"
```

### Task 6: Replace the temporary generic score with an intent-pending state

**Files:**
- Modify: `components/dashboard/today.tsx`
- Test: `components/dashboard/today.test.tsx`
- Test: `components/SyncProvider.test.tsx`

- [ ] **Step 1: Write failing UI tests.** An unplanned noted ride with `analyzing` and no overlay shows `Evaluating your intent…` and not `5/10`; a ride with an overlay keeps its effective score during manual re-analysis; a planned ride and an unnoted ride keep their ordinary score.

```tsx
render(<TodayRideCard analysis={analysis({ plannedName: null, activityDescription: "Intent: Flat 1" })} outcome={null} analyzing />);
expect(screen.getByText("Evaluating your intent…")).toBeInTheDocument();
expect(screen.queryByText("5/10")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run and verify failure.**

Run: `npx vitest run components/dashboard/today.test.tsx components/SyncProvider.test.tsx`

Expected: FAIL because the raw analysis score still renders.

- [ ] **Step 3: Add the minimal display guard.** Derive `intentPending` from `analyzing`, unplanned status, non-empty activity description, and absent overlay. Keep overlay precedence unchanged.

```ts
const intentPending = Boolean(analyzing && !analysis.plannedName && analysis.activityDescription?.trim() && outcome?.overlay == null);
const displayScore = outcome?.overlay != null
  ? outcome.effectiveExecutionScore
  : intentPending ? null : analysis.executionScore;
```

- [ ] **Step 4: Confirm SyncProvider enters analyzing before the fast-path render settles.** Add/adjust a provider test asserting the state sequence never exposes `syncing=false` and `analyzing=false` between POST sync completion and `/api/intent`. Reorder the existing synchronous state calls only if the test demonstrates a gap; add no new persisted/API state.

- [ ] **Step 5: Run tests and commit.**

Run: `npx vitest run components/dashboard/today.test.tsx components/SyncProvider.test.tsx`

Expected: PASS.

```bash
git add components/dashboard/today.tsx components/dashboard/today.test.tsx components/SyncProvider.test.tsx
git commit -m "fix(today): hold generic score while intent resolves"
```

### Task 7: Documentation, full verification, and live acceptance

**Files:**
- Modify: `docs/INVARIANTS.md`
- Modify: `docs/systems/02-scoring-and-learning.md`
- Modify: `FEATURES.md`
- Modify: `ARCHIVE.md`
- Modify only if an open entry exists: `todo.md`

- [ ] **Step 1: Update invariants.** Amend objective-decomposition and zone-basis contracts for segment identity; add explicit guarantees that named segments use one labelled lap, average/NP retain their meanings, and missing segment evidence never falls back to whole-ride arrays.

- [ ] **Step 2: Close the documented rough edge.** Replace the whole-ride phase-scoping bullet in `docs/systems/02-scoring-and-learning.md` with shipped behavior and retain the narrower truth: genuinely whole-ride zone objectives still use aggregate arrays.

- [ ] **Step 3: Update product records.** Add segment-aware intent scoring to `FEATURES.md`, record the shipped fix and August 19 reproduction in `ARCHIVE.md`, and remove/update the matching `todo.md` residual-gap text if present. Do not rename linked headings.

- [ ] **Step 4: Run targeted tests together.**

Run: `npx vitest run lib/intent-schema.test.ts lib/intent-prompt.test.ts lib/intent-grounding.test.ts lib/intent-scoring.test.ts lib/intent-runner.test.ts lib/intent-overlay.test.ts components/dashboard/today.test.tsx components/SyncProvider.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run the repository verification gate.**

Run: `npm run check`

Expected: TypeScript, ESLint, all Vitest tests, and markdown-link checks pass with zero errors/warnings.

- [ ] **Step 6: Run the mandatory live AI smoke test.** With the dev server and real Anthropic/Intervals configuration active, force re-analysis of 2026-08-19 activity `i177434779` through the existing Re-analyse action. Do not edit `data/*.json` directly.

- [ ] **Step 7: Inspect the real output before completion.** Confirm the active overlay:
  - contains four separate `segment` objectives;
  - matches `Rolling Terrain 1`, `Flat 1`, `Flat 2`, and `Short Effort`;
  - reports 9/10;
  - uses 238/263, 220, 190, and 285/309 W segment evidence;
  - contains no `31.6 min in Z3 vs 65`, `17.3 min in Z4 vs 26`, or other whole-ride phase evidence;
  - does not classify the ride as `Rest`;
  - supersedes the old overlay transactionally.

- [ ] **Step 8: Re-run `npm run check` if the smoke test required any correction.** A changed AI path is not complete until both the deterministic gate and one read live output are clean.

- [ ] **Step 9: Commit documentation.**

```bash
git add docs/INVARIANTS.md docs/systems/02-scoring-and-learning.md FEATURES.md ARCHIVE.md todo.md
git commit -m "docs(intent): close segment-scoping rough edge"
```

- [ ] **Step 10: Finish through the sanctioned integration path.**

Run: `npm run finish:agent-task`

Expected: checks pass and a Codex PR is opened for Claude review; do not manually push/merge.

- [ ] **Step 11: Post-completion reminder.** Tell the user the requested work is finished, then remind them that the unrelated open rough edges are (1) segment decoupling and (2) unlabelled compound climb/descent terrain fallback.

---

## Acceptance Criteria

- The August 19 ride deterministically resolves to 9/10 from four segment-local comparisons.
- Flat 1's 45–60 minute range remains a range.
- Average and NP targets use their corresponding per-lap watts and ride-date zones.
- Different named segments never merge by zone, and unmatched/ambiguous labels never use whole-ride zone totals.
- Complete ordered execution yields 9; 10 requires every scored segment to meet precision criteria.
- The first fast sync render never exposes a generic off-plan score while noted intent is pending.
- “After a rest day” cannot classify a ride containing workout-bearing phases as `Rest`.
- Existing whole-ride objectives, old overlays, ledger history, prescribed rides, and manual re-analysis score visibility remain unchanged.
- `npm run check` passes and one live forced re-analysis is inspected successfully.
