# Adaptive self-directed coach — Phase 3c: terrain-matching fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** Close the two terrain-matching gaps Phase 3b flagged
(`docs/systems/02-scoring-and-learning.md` § Known rough edges): a compound climb+descent lap silently
grades as pure climb (Gap A), and gradient-fallback matching can reward a 10x duration overmatch as full
compliance when a ride has no meaningfully-segmented curated intervals (Gap B).

**Design doc:** `docs/superpowers/specs/2026-08-14-adaptive-coach-p3c-terrain-fixes-design.md` — read it
first; this plan does not repeat its rationale.

**Architecture:** Both fixes are local to `lib/intent-scoring.ts`'s terrain path
(`filterByTerrain`/`matchTerrain`) plus, conditionally, one new field on `ExecutedInterval`
(`minGradientPct`, `lib/types.ts` + `lib/intervals-api.ts`). No new persistence, no new API route, no new
UI component, no change to `complianceDelta` or any other objective kind.

**Tech Stack:** Next.js 16 (App Router), TypeScript 5, Vitest.

## Global Constraints

- **Gap A is conditional on Task 1's live verification.** Do not write `minGradientPct` sync code or
  compound-lap detection before Task 1 confirms a real raw field exists on the
  `/activity/{id}/intervals` payload. If Task 1 finds no such field, skip Tasks 2-3 entirely and go
  straight to Task 4 (Gap B), then Task 6 with Gap A marked "checked, absent" in the rough-edges doc.
- **Gap B disqualification is gradient-fallback only.** `hasLabelHint(closest, terrain)` must be checked
  before the overmatch rejection — a label-matched lap is exempt (design doc §2/§7).
- **Compound-lap exclusion never applies to the labelled branch of `filterByTerrain`.** Only the
  gradient-fallback branch (`candidates.filter((lap) => clearsGradientFloor(...))`) is affected.
- **Reuse, don't duplicate:** `CLIMB_GRADIENT_FLOOR_PCT` (symmetric compound-floor check, design doc §6)
  and `hasLabelHint` (design doc §7) are both already defined in `lib/intent-scoring.ts` — import/call
  them, do not redefine.
- **Evidence text stays on the existing generic ungraded message** (`"no {terrain} found in the curated
  intervals"`) for both new exclusion paths — no new UI copy (design doc §2).
- **No retro-scoring.** These changes affect only newly-parsed intent overlays going forward; the ledger
  and any already-persisted `IntentOverlay` rows are untouched (append-only precedent,
  `docs/INVARIANTS.md` items 1-2's family).

---

## Task 1 — Verify `minGradientPct`'s raw data source (Gap A gate)

**Goal:** Determine whether Intervals.icu's `/activity/{id}/intervals` payload exposes a usable
minimum/trough gradient field per interval, and its exact raw key name.

- [ ] Step 1: Using the same sandboxed verification pattern Phase 3b's design used (fetch one real
      activity's `/activity/{id}/intervals` payload directly, inspect the raw JSON, do not persist the
      fetched file), find the field(s) available per interval. `lib/intervals-api.ts`'s existing
      `fetchIntervals` (lines ~186-217) shows every raw key currently consumed
      (`average_gradient`, `Maxgradient`, etc.) — cross-reference against those exact names, don't assume
      `Mingradient` mirrors `Maxgradient`'s casing.
- [ ] Step 2: Decision point:
      - **Found**: record the exact raw key name and its value semantics (percentage already, or a raw
        ratio needing the same `* 100` conversion `average_gradient` gets at line 202) in this task's
        completion note. Proceed to Task 2.
      - **Not found**: do not fabricate a compound signal from any other field (stream data, elevation
        arrays, etc. — design doc §2 forbids this). Skip to Task 4 (Gap B). Task 6's doc updates must
        record that this was checked and the field is absent, not merely "deferred."

## Task 2 — Add `minGradientPct` to `ExecutedInterval` (Gap A, only if Task 1 found a field)

**Goal:** Sync the verified field the same way every other gradient field on this type is synced.

- [ ] Step 1: Add `minGradientPct: number | null` to `ExecutedInterval` in `lib/types.ts` (mirror the
      existing `maxGradientPct` doc comment style at lines ~416-418 — note the exact raw key and any
      casing quirk found in Task 1).
- [ ] Step 2: Map it in `lib/intervals-api.ts`'s `fetchIntervals` (alongside `maxGradientPct` at line
      209), using Task 1's verified key name and conversion.
- [ ] Step 3: Update any test fixture builder for `ExecutedInterval` (`lib/intent-scoring.test.ts` and/or
      a shared fixture helper) so `minGradientPct` defaults to `null` on existing fixtures — additive,
      must not break any currently-passing test.
- [ ] Step 4: Run `npx tsc --noEmit` — confirm no other `ExecutedInterval` literal in the codebase needs
      updating (additive optional-shaped field, but check for any exhaustive-object-literal type errors).

## Task 3 — Compound-lap detection and candidacy exclusion (Gap A, only if Task 2 shipped)

**Goal:** A lap whose peak clears the climb floor AND whose trough clears the descent floor is excluded
from gradient-fallback terrain candidacy for both climb and descent.

- [ ] Step 1: Add `isCompoundLap` in `lib/intent-scoring.ts`, next to `clearsGradientFloor` (~line 580),
      reusing `CLIMB_GRADIENT_FLOOR_PCT` symmetrically (design doc §6's exact expression).
- [ ] Step 2: In `filterByTerrain` (~line 591), exclude `isCompoundLap` candidates from the
      gradient-fallback branch only (`candidates.filter((lap) => clearsGradientFloor(...))` →
      also require `!isCompoundLap(lap)`). Leave the labelled branch (`if (labelled.length > 0) return
      labelled`) untouched.
- [ ] Step 3: Tests in `lib/intent-scoring.test.ts`:
      - A lap with `maxGradientPct: 8, minGradientPct: -5` (compound) is excluded from both climb and
        descent gradient-fallback matching, even when it's the only candidate in the pool (result: `[]`
        / ungraded, not a false climb or descent match).
      - The same compound lap, when it carries a matching `label` (e.g. `"Climb 1"`), still matches via
        the labelled branch — compound exclusion must not suppress an explicit athlete label.
      - A non-compound lap (only one gradient extreme clears the floor) is unaffected — regression check
        against Phase 3b's existing climb/descent gradient-fallback tests.

## Task 4 — Gradient-fallback overmatch disqualification (Gap B)

**Goal:** A gradient-fallback terrain match whose duration exceeds `TERRAIN_OVERMATCH_RATIO` (3x) the
stated claim is rejected instead of graded.

- [ ] Step 1: Add `const TERRAIN_OVERMATCH_RATIO = 3;` near `CLIMB_GRADIENT_FLOOR_PCT` in
      `lib/intent-scoring.ts`, with the design doc §7 comment (named constant, not inline magic number).
- [ ] Step 2: In `matchTerrain` (~line 602), after computing `closest` in the duration-stated branch, add
      the overmatch check from design doc §7:
      `if (!hasLabelHint(closest, terrain) && closest.durationSec > targetSec * TERRAIN_OVERMATCH_RATIO) return [];`
      before the existing `return [closest];`.
- [ ] Step 3: Confirm the no-duration branch (`durationMin === null || durationMin <= 0`) is untouched —
      it has no stated length to compare against and keeps its existing single-candidate rule.
- [ ] Step 4: Tests in `lib/intent-scoring.test.ts`:
      - Reproduce the live-smoke case shape: one undivided gradient-qualifying lap at ~10x a stated
        duration → `matchLaps`/`gradeTerrain` returns ungraded, not a full-compliance climb grade.
      - Boundary case: a candidate at exactly `TERRAIN_OVERMATCH_RATIO` (3.0x) — decide and assert
        inclusive/exclusive behavior consistently with the `>` in Step 2 (3.0x itself is NOT disqualified;
        confirm the test matches the code, not the other way around).
      - Boundary case: a candidate just under the ratio (e.g. 2.9x) still matches and grades normally via
        `complianceDelta`.
      - A labelled lap at 10x the stated duration is NOT disqualified (label exemption, design doc §7) —
        still matches, and `complianceDelta`'s own existing behavior applies (this documents the
        exemption; it does not newly bless a bad label match).

## Task 5 — Full-suite regression check

- [ ] Step 1: `npm test` (Vitest) — confirm every existing `intent-scoring`/`intent-runner`/`intent-overlay`
      suite still passes; the only expected diffs are the new tests from Tasks 3-4.
- [ ] Step 2: `npx tsc --noEmit` clean.

## Task 6 — Documentation updates

- [ ] Step 1: `docs/INVARIANTS.md` — add invariant 57 (next available number as of this plan) covering
      both guarantees: a compound climb+descent lap is excluded from gradient-fallback terrain candidacy
      for both terrains (never split, never guessed at), and a gradient-fallback terrain match whose
      duration grossly exceeds ratio the stated claim is disqualified rather than rewarded — cite
      `filterByTerrain`/`matchTerrain` in `lib/intent-scoring.ts`. If Gap A was skipped (Task 1 found no
      field), scope the invariant to Gap B only and say so.
- [ ] Step 2: `docs/systems/02-scoring-and-learning.md` § Known rough edges — close out both Phase 3b
      bullets (compound lap, gradient-fallback overmatch), pointing at this phase the way the existing
      Phase 2c drift-signal-defects bullet documents its own resolution (what broke, what changed, PR/file
      reference). If Gap A was skipped, its bullet stays open but is rewritten to say the data source was
      checked and found absent (per Task 1's decision point), so a future session doesn't re-ask the same
      question.
- [ ] Step 3: `ROADMAP.md`'s Phase 3b entry (~line 65) — the "Two terrain-matching gaps flagged for a
      future scoping session" sentence is stale once this ships; update it to reflect what was fixed (and
      what, if anything, remains open).

---

## Acceptance criteria

- Gap B: the live-smoke reproduction shape (10x+ gradient-fallback overmatch) no longer produces a
  full-compliance grade; it grades as ungraded instead.
- Gap A (if built): a compound lap never grades as a pure climb or pure descent via gradient fallback; a
  labelled compound lap is unaffected.
- No change to any non-terrain objective kind's behavior (duration, zone-time, zone-emphasis, effort,
  structure, qualitative all untouched).
- `npm test` and `npx tsc --noEmit` both clean.
- No live-smoke run required — this phase touches only deterministic matching/grading logic, not the LLM
  intent-parsing path (`INTENT_PROMPT_VERSION` is not bumped, `lib/intent-prompt.ts` is untouched).
