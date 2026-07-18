# Intervals.icu workout-library sync — Design

**Date:** 2026-07-18
**Status:** Design approved 2026-07-18 — implementation plan: TBD (next step)
**ROADMAP:** "Intervals.icu workout-library sync" (`ROADMAP.md`, "Larger / scoped (when wanted)").
Ties `← #4` for the long-run "well-executed" verdict; Track B's per-template durability score is the
interim quality gate.

---

## 1. Problem & context

When a session scores as well-executed, write it into Intervals.icu's own reusable workout library
(`POST /athlete/{id}/workouts`, `/workouts/bulk` — confirmed live, a distinct API from the
calendar-event endpoints `lib/intervals-api.ts` already uses via `/events` / `/events/bulk`). This
builds a curated "proven workouts" folder over time, pullable by the athlete directly in Intervals.icu.

**Key discovery (this session):** `CurrentBlockDay.workoutText` (`lib/types.ts:305`) is already written
in Intervals.icu's native workout-builder step syntax — `%FTP`-based warmup/steady/interval/cooldown
lines, per the syntax guide distilled into `lib/anthropic-prompts.ts:45-51` — and the workout-library
API's `description` field accepts exactly that native format (confirmed against
`intervals.icu/api/v1/docs`). So building the library entry requires **no new parsing or conversion** —
`workoutText` is reused verbatim as the `description`. This removes what looked like the feature's main
technical risk.

**Second correction (this session, ground-truth check before writing this spec):** `executionScore` and
`durabilityDelivery` — the fields the quality gate reads — live on `RideScoreEntry`
(`data/score-log.json`, `lib/types.ts:485-550`), not on `CurrentBlockDay`. `score-log.json` is an
explicit **immutable ledger**: `mergeScoreLog` (`lib/score-log.ts:314`) always lets an existing frozen
entry win over a fresh recompute, and the separate rebuild path `mergeScoreLogRebuild` only carries
forward two named fields (`formState`, `intervals`) via `carryForwardContext` — any other field added to
a `RideScoreEntry` would be silently dropped on a rebuild. Stamping "already saved to the library" onto
that record would entangle this feature with the ledger's rebuild invariants for no reason. Instead, use
a **new, dedicated, tiny store** (`data/workout-library.json`) that only NodeVelo's own write path
touches — see §4.

## 2. Locked decisions (user, 2026-07-18 — do not re-open)

1. **Quality gate is swappable, starts live.** A single pure function reads today's already-computed
   per-session score (`RideScoreEntry.executionScore` / `durabilityDelivery`) — not a dependency on
   `#4`'s calibrated verdict, which is currently dormant (n=1–8 per type). The function is the one seam
   to re-point at `#4` later.
2. **Workout format: structured steps**, achieved for free by reusing `workoutText` verbatim (see §1) —
   not a new PrescribedInterval→DSL converter, not plain prose.
3. **No de-dup.** Every qualifying session becomes its own permanent library entry, even repeat
   occurrences of the same session type. The library is expected to grow unbounded; browsability is
   handled by folder + name, not by curation/overwrite.
4. **Manual trigger**, not automatic. The athlete explicitly pushes each qualifying session — no silent
   writes to their Intervals.icu account as a side effect of sync.
5. **Placement: inline per-day action, gated.** A small action next to the day's score — same pattern as
   the existing Move/Swap buttons in `components/DayAction.tsx` — rendered *only* when that day already
   clears the gate. Not a dedicated review/batch page.
6. **Organization: one Intervals.icu folder per session type** (`WorkoutType`: Z2, Threshold, VO2max,
   SIT, RaceSim, Recovery), resolved/created via the folder endpoints
   (`GET`/`POST /athlete/{id}/folders`).

## 3. Goals / non-goals

**Goals**
- Athlete can push any qualifying completed session — in the live block or an archived one
  (`BlockHistoryEntry.days`, SUB-1) — into their Intervals.icu workout library with one click.
- The pushed entry is immediately usable as a structured, followable workout in Intervals.icu (real
  `%FTP` step targets, not a text blob).
- Re-clicking an already-saved day is a no-op, not a duplicate write.
- The gate is swappable without touching the route, UI, or payload-building code.

**Non-goals**
- `Strength` / `Rest` days — `Strength` prescriptions are prose (sets/reps), not the `%FTP` step DSL
  (`lib/workout-validate.ts:50` comment), so there's nothing to push; `Rest` has no session at all.
- Automatic/batched pushing as a sync side effect.
- De-dup, upsert, or "best exemplar per template" logic.
- Actually re-pointing the gate at `#4` — that's future work once real verdicts accrue; this design only
  keeps the seam open.
- Any change to `score-log.json`'s shape, merge semantics, or immutable-ledger invariants.

## 4. Data model

### New store: `data/workout-library.json`

```ts
export interface WorkoutLibrarySavedEntry {
  date: string;
  savedAt: string; // ISO timestamp
  folder: WorkoutType;
}
export interface WorkoutLibraryLog {
  entries: WorkoutLibrarySavedEntry[];
}
```

Follows the existing `data-store.ts` convention (`readScoreLog`/`writeScoreLog`/`updateScoreLog`):
`readWorkoutLibraryLog()`, `updateWorkoutLibraryLog(mutate)` — the update path uses `json-store.ts`'s
per-file lock (`updateJson`) so a duplicate click can't race past the "already saved" check. Deliberately
separate from `score-log.json` (see §1's second correction) — this file has no ledger/rebuild semantics,
it's just a small append-mostly index of what's already been pushed.

### New pure module: `lib/workout-library.ts`

Mirrors the existing `lib/durability.ts` / `lib/durability-score.ts` split (pure, deterministic, no I/O):

- `isWellExecuted(entry: RideScoreEntry): boolean` — the swappable gate:
  ```ts
  entry.executionScore != null
    && entry.executionScore >= TSB_GOOD_BAR // lib/calibration.ts's existing "nailed it" bar (6) — reused, not reinvented
    && (entry.durabilityDelivery == null || entry.durabilityDelivery.signal >= 0) // reject a durability ride that skipped its embedded stimulus even if the overall score was fine
  ```
- `buildWorkoutLibraryPayload(day: CurrentBlockDay, entry: RideScoreEntry): WorkoutLibraryPayload | null`
  — returns `null` for `Strength`/`Rest` or a missing/empty `workoutText`; otherwise:
  - `name`: `` `${entry.plannedType ?? entry.inferredType} — ${entry.date}` ``
  - `description`: `day.workoutText` (verbatim)
  - `type`: `"Ride"`
  - `folder`: `entry.plannedType ?? entry.inferredType` (resolved to a folder id server-side)
- `findDayRecord(date: string, block: CurrentBlock, history: BlockHistoryEntry[]): CurrentBlockDay | null`
  — checks the live block's `days` first, then scans archived `BlockHistoryEntry.days` (SUB-1) — the
  same "could be live or archived" lookup shape other day-scoped features already use.

## 5. API contract

### `POST /api/workout-library`

**Body:** `{ date: string }`

**Server-side flow** (never trusts a client-side gate check):
1. Look up the `RideScoreEntry` for `date` in `score-log.json` → 404 if absent.
2. Re-run `isWellExecuted(entry)` → 400 `"Session at <date> hasn't cleared the quality gate."` if false.
3. Check `workout-library.json` for an existing entry at `date` → if present, return
   `{ ok: true, alreadySaved: true }` (idempotent no-op, not an error).
4. `findDayRecord(date, ...)` → 404 if the prescription itself can't be located (e.g. history entry
   older than SUB-1, no `days`).
5. `buildWorkoutLibraryPayload(day, entry)` → 400 if `null` (Strength/Rest/empty prescription).
6. `findOrCreateFolder(payload.folder)` (new `lib/intervals-api.ts` function: `GET
   /athlete/{id}/folders`, match by name `` `NodeVelo — ${type}` ``, `POST` to create if absent).
7. `createWorkout(payload with folder_id)` (new `lib/intervals-api.ts` function, `POST
   /athlete/{id}/workouts`, same `icuFetch`/`IntervalsApiError` plumbing as `createEvent`).
8. On success: `updateWorkoutLibraryLog` to append `{ date, savedAt: now, folder }`.
9. Response: `{ ok: true, alreadySaved: false }`, or an error response using the caught
   `IntervalsApiError`'s message (same pattern as every other write route).

**Response:** `{ ok: boolean; alreadySaved?: boolean }`, matching this codebase's existing thin response
shapes.

## 6. UI contract

### `components/SaveToLibrary.tsx` (new)

Same visual/interaction footprint as the existing action buttons in `DayAction.tsx`: a small text
button, busy state while the request is in flight, inline error text with the option to retry on
failure. Renders **only** when the day's `RideScoreEntry` passes `isWellExecuted` client-side (a display
gate — the route re-checks authoritatively) and no `workout-library.json` entry exists yet for that
date. On success, flips to a disabled "Saved" label — no further action, matches the no-dedup decision
(one save per day, not re-saveable).

### Mount point

`components/dashboard/plan.tsx`'s pinned day-cell popover, alongside the two existing
`<DayAction verb="move" .../>` / `<DayAction verb="swap" .../>` lines (`plan.tsx:328-329`) — same
`eligible && pinned` gate block. That file already builds `scoreByDate` (`plan.tsx:191`, currently
`date → executionScore` only) to feed the score display; extend it to also carry `durabilityDelivery`
so the client-side display gate matches `isWellExecuted` exactly instead of a looser
executionScore-only approximation that could show the button on a day the server then rejects.

## 7. Testing plan

- **`lib/workout-library.test.ts`** (new, pure unit tests — no I/O):
  - `isWellExecuted`: score below `TSB_GOOD_BAR` → false; score at/above the bar → true; score above the
    bar but `durabilityDelivery.signal < 0` → false; `executionScore` null (ungraded/in-progress day) →
    false.
  - `buildWorkoutLibraryPayload`: `Strength`/`Rest` → null; missing/empty `workoutText` → null; a normal
    quality day → correct `name`/`description`/`type`/`folder`.
  - `findDayRecord`: found in live block; found in archived history; absent in both → null.
- **`app/api/workout-library/route.test.ts`** (new, matching the existing route-test convention, mocking
  `@/lib/intervals-api`): full success path (folder resolved, workout created, log updated); gate
  rejection even when called directly (server doesn't trust the client); already-saved idempotent
  no-op (no second Intervals.icu call); 404s for unknown date / no day record; Intervals.icu failure
  surfaces the `IntervalsApiError` message without partially updating `workout-library.json`.
- **Live verification required before calling this done**: this is a genuine new write path against a
  real third-party API (not covered by any existing live-tested primitive, unlike the session-swap
  feature which reused an already-proven mirror path). Push one real qualifying session and confirm in
  the Intervals.icu UI that the folder, name, and structured steps all render correctly — a green test
  suite only proves the deterministic scaffolding, not that Intervals.icu actually accepts and renders
  the payload as intended.

## 8. File structure

| File | Change |
|---|---|
| `lib/workout-library.ts` | New — `isWellExecuted`, `buildWorkoutLibraryPayload`, `findDayRecord` |
| `lib/workout-library.test.ts` | New |
| `lib/data-store.ts` | Add `readWorkoutLibraryLog`/`updateWorkoutLibraryLog` |
| `lib/intervals-api.ts` | Add `fetchFolders`, `findOrCreateFolder`, `createWorkout` |
| `lib/types.ts` | Add `WorkoutLibrarySavedEntry`, `WorkoutLibraryLog`, workout-library payload/API types |
| `app/api/workout-library/route.ts` | New — `POST` handler |
| `app/api/workout-library/route.test.ts` | New |
| `components/SaveToLibrary.tsx` | New |
| `components/dashboard/plan.tsx` | Extend `scoreByDate` to carry `durabilityDelivery`; mount `SaveToLibrary` alongside the existing `DayAction` move/swap buttons in the pinned popover |
| `FEATURES.md`, `ROADMAP.md`, `ARCHIVE.md` | Docs, once shipped |
