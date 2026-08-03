# Proven workout library generation — Design

**Date:** 2026-08-02  
**Status:** Design approved 2026-08-02  
**Related design:** `2026-07-18-workout-library-sync-design.md`

## 1. Problem

Block generation currently asks Claude to author every session even when NodeVelo has already prescribed
and observed successful quality workouts. This repeats work, spends the same generation cost as the
library grows, and does not turn execution history into reusable training assets.

NodeVelo will build a local, evidence-backed library of proven quality workouts. Existing deterministic
block logic remains responsible for focus, weekly volume, session budgets, placement, sequencing, and
slot constraints. The library fills compatible quality slots with unchanged prescriptions; Claude
authors only quality slots that have no suitable match. Fixed templates cover routine endurance work.

## 2. Goals and non-goals

### Goals

- Grow a curated library automatically from completed workouts.
- Allow the athlete to promote a personally valued completed workout manually.
- Reuse proven prescriptions unchanged while preserving existing block-creation rules.
- Reduce workout-authoring calls as library coverage grows.
- Export every promoted workout to Intervals.icu without making that service the source of truth.
- Make selection, provenance, evidence, retirement, and export state inspectable.

### Non-goals

- Replacing season selection, the block skeleton, scheduling, nutrition, or validators.
- Learning Z2, Recovery, Rest, or Strength prescriptions from execution history.
- Scaling or editing proven workout steps to fit a slot.
- A workout editor, ratings system, folders UI, duplicate-merging UI, or savings dashboard.
- Depending on Intervals.icu availability during block generation.

## 3. Architecture

The existing deterministic engines remain authoritative for:

- season focus and session requirements;
- weekly hours and recovery structure;
- day placement, sequencing, and quality-session budget;
- slot workout type and duration envelope;
- nutrition targets and validation.

After `computeBlockSkeleton`, a new selector attempts to fill each quality slot from the local library.
Learned entries are limited to `Threshold`, `VO2max`, `SIT`, and `RaceSim`. Z2 uses deterministic
90-minute, 2-hour, 3-hour, and 4-hour templates. Recovery remains deterministic. Rest and Strength stay
outside the library; configured Strength days use one static, existing-KB-backed prescription so they
do not require workout authoring.

Library prescriptions are immutable. Selection controls where an entry is used but cannot resize,
rewrite, or otherwise adapt its steps. If no active entry satisfies a slot, Claude authors only that
missing quality session with the surrounding week, focus, adjacent sessions, and slot constraints in
context. Once all days are assembled, the existing repair and validation pipeline runs over the whole
block. A separate cheap call writes the overview; on failure, generation returns the valid block with a
deterministic fallback overview.

NodeVelo's local JSON store is authoritative. Intervals.icu is an athlete-facing export mirror and is
never read during generation.

## 4. Library record and identity

Each normalized quality prescription has one record:

```ts
type WorkoutLibraryEntry = {
  id: string;
  workoutType: "Threshold" | "VO2max" | "SIT" | "RaceSim";
  durationMin: number;
  workoutText: string;
  status: "candidate" | "active" | "retired";
  promotedBy?: "automatic" | "manual";
  evidence: Array<{
    date: string;
    executionScore: number;
  }>;
  useCount: number;
  createdAt: string;
  promotedAt?: string;
  intervalsExport?: {
    status: "pending" | "synced" | "failed";
    workoutId?: string;
    error?: string;
  };
};
```

The stable `id` is a hash of normalized structured steps. Normalization removes names, dates, and
prose-only differences while preserving step order, repetitions, durations, and targets. Two rides
count as evidence for the same prescription only when their normalized structured steps match.

The prescription fields are immutable. Evidence, usage count, status, and export state may change.
Evidence dates are unique.

## 5. Promotion and retirement

A completed prescription becomes active automatically when either condition is met:

1. one uncompromised execution has `executionScore >= 8`; or
2. two distinct uncompromised executions of the same normalized prescription each have
   `executionScore >= 6`.

Scores below 6 do not contribute qualifying evidence. A manual promotion requires at least one
completed ride and overrides the score thresholds, but not structural safety checks.

Both promotion paths require:

- a supported quality workout type;
- non-empty structured workout steps;
- no severe protocol violation under current validation rules; and
- a completed, non-compromised ride for every evidence item being counted.

Retirement prevents future selection but preserves the prescription, evidence, usage, and export
history. New evidence never restores a retired entry automatically. Restore is an explicit athlete
action.

On first use, one truthy-marker-guarded, idempotent bootstrap scans current-block and enriched
block-history days. When a preserved prescription can be joined by date to a frozen score-ledger entry,
the same evidence and promotion rules apply. Days without preserved prescriptions are skipped; no
workout is reconstructed or guessed, and the append-only score ledger is never mutated.

## 6. Matching and selection

For each quality slot, selection filters active entries by:

- exact required workout type;
- duration inside the skeleton's existing slot envelope;
- compatibility with current session requirements; and
- passing current protocol validation.

Eligible entries are ranked deterministically by:

1. strongest execution evidence;
2. closest duration to the slot's nominal duration;
3. fewest recent uses; and
4. stable entry ID as the final tie-breaker.

Repeated evidence ranks above a manual promotion with weak evidence; manual promotion grants
eligibility but does not invent a high score. An entry may appear only once in a block while another
eligible entry of the same type exists. Reuse within a block is allowed only when no alternative can
fill the required type and slot.

An AI-authored fallback is a candidate, not an active entry. It must later satisfy the same execution
or manual-promotion rules.

## 7. Generation flow and provenance

The assembled plan preserves the existing two-phase contract: generation proposes and `/api/write`
commits. Library promotion and export occur from completed score/history processing or an explicit
manual action, not from `/api/generate`.

Each generated day records one source:

- `library:<entry-id>`;
- `template:z2-90`, `template:z2-120`, `template:z2-180`, or `template:z2-240`; or
- `ai:<model>/<prompt-version>`.

AI usage records distinguish missing-slot authoring from overview writing. This permits later reporting
of coverage and avoided authoring calls without adding a dashboard in this release.

If every quality slot is covered, NodeVelo makes no workout-authoring call. It still makes the cheap
overview call. If only some slots are covered, one bounded authoring request produces the missing
quality sessions only; it must not rewrite library- or template-backed days.

## 8. Intervals.icu export

Every automatic or manual promotion immediately marks export `pending` and attempts to create the
workout in the appropriate `NodeVelo — <WorkoutType>` folder. Successful export stores the remote
workout ID and marks the entry `synced`.

Export failure marks the entry `failed` with a displayable error. The local active entry remains usable
and block generation continues normally. Retry is explicit and idempotent: an entry with a stored remote
workout ID is never created again.

This replaces the earlier sync design's manual-only export trigger for this feature. Its confirmed
reuse of `workoutText` as Intervals.icu's structured `description`, folder convention, and dedicated
export plumbing remain applicable.

## 9. UI

The first release adds a Workout Library view with active, candidate, and retired sections. Each entry
shows:

- workout type and duration;
- qualifying evidence count plus best and most recent score;
- automatic or manual promotion source;
- usage count;
- active or retired state; and
- Intervals.icu export state.

Available actions are Retire, Restore, and Retry export. Completed quality-session surfaces expose
`Add to library` when the prescription is not active. A blocked manual promotion explains the concrete
structural or protocol reason. Editing, ratings, folder management, and duplicate merging are omitted.

## 10. Failure handling

- **Library read or parse failure:** stop before spending an AI call and return a local-data error.
- **No eligible match:** author only the uncovered quality slot or slots.
- **Slot-authoring failure:** fail generation without persisting a partial block.
- **Overview failure:** return the valid assembled block with deterministic fallback prose.
- **Intervals.icu export failure:** retain the local entry, mark export failed, and allow retry.
- **Current validator rejects a stored entry:** exclude it from selection without silently retiring it;
  show the validation issue in the library view.
- **Concurrent promotion/retry:** use `updateJsonFile` locking and re-check state inside the lock.

## 11. Verification

Automated checks cover:

- fingerprint normalization, stable identity, and evidence-date de-duplication;
- automatic and manual promotion gates, including compromised rides;
- aggregation across two distinct successful dates;
- idempotent historical bootstrap with a truthy migration marker;
- retirement, restoration, and validation-based selection exclusion;
- deterministic filtering, ranking, tie-breaking, and within-block repetition policy;
- fixed Z2 template selection;
- mixed library/AI assembly and complete-library assembly;
- proof that a fully covered block makes no workout-authoring call;
- full-plan repair and validation after mixed-source assembly;
- source provenance and usage counting only on accepted blocks;
- export idempotency, failure state, and retry behavior; and
- API/UI behavior for manual promotion and library management.

Before completion, run one live partial-coverage generation, one live full-coverage generation, and one
real Intervals.icu export. Confirm the full-coverage run skips workout authoring and confirm the exported
workout renders as structured steps in Intervals.icu.

## 12. Scope boundary

This is one feature delivered in slices, not a replacement training engine. The implementation plan
must preserve the current block skeleton and validators, establish the local library and promotion flow
first, then change generation to consume it. Savings dashboards, automatic workout adaptation, and
non-quality learned workouts require separate evidence and design work.
