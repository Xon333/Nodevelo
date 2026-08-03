# Proven Workout Library Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an evidence-backed quality-workout library that increasingly replaces AI-authored block sessions and mirrors promoted workouts to Intervals.icu.

**Architecture:** Keep `computeBlockSkeleton` as composition authority. A local JSON library promotes immutable quality prescriptions from execution evidence, fills compatible slots deterministically, and asks Claude only for uncovered quality slots; static templates fill routine days and a cheap call writes the overview.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod, Vitest, React Testing Library, existing atomic JSON store, Anthropic tool use, Intervals.icu REST API.

## Global Constraints

- NodeVelo's local JSON library is authoritative; Intervals.icu is export-only.
- Learned types are exactly Threshold, VO2max, SIT, and RaceSim; prescriptions are immutable.
- Automatic activation is one uncompromised score >=8 or two distinct uncompromised scores >=6.
- Manual activation requires a completed ride and cannot override structural/protocol safety.
- Z2 templates are exactly 90, 120, 180, and 240 minutes; Recovery, Rest, and Strength are deterministic.
- Existing skeleton, nutrition, validators, two-phase commit, CAS, and append-only-ledger contracts remain intact.
- Add no dependency. Persist only through `json-store.ts`; guard migration markers with truthy checks.
- Changed AI paths require live partial-coverage and full-coverage smoke runs.

---

### Task 1: Pure library domain

**Files:** Create `lib/workout-library.ts`, `lib/workout-library.test.ts`; modify `lib/types.ts`.

**Interfaces:** Produce `WorkoutLibraryEntry`, `WorkoutLibraryStore`, `WorkoutSource`, `fingerprintWorkout`, `applyEvidence`, `canManuallyPromote`, and `selectLibraryWorkout`.

- [ ] Write failing tests proving labels/dates do not affect fingerprints but step order, repetitions, durations, and targets do; evidence dates de-duplicate; one score 8 or two scores 6 activate; compromised rides do not count; retired entries stay retired; selection filters exact type and slot envelope and ranks by evidence, duration distance, recent use, then ID.
- [ ] Run `npx vitest run lib/workout-library.test.ts`; expect missing-export failures.
- [ ] Add these exact type shapes to `lib/types.ts`:

```ts
export type QualityLibraryType = Extract<WorkoutType, "Threshold" | "VO2max" | "SIT" | "RaceSim">;
export type WorkoutSource = `library:${string}` | `template:${string}` | `ai:${string}/${number}`;
export interface WorkoutLibraryEvidence { date: string; executionScore: number }
export interface WorkoutLibraryEntry {
  id: string; workoutType: QualityLibraryType; durationMin: number; workoutText: string;
  status: "candidate" | "active" | "retired"; promotedBy?: "automatic" | "manual";
  evidence: WorkoutLibraryEvidence[]; useCount: number; recentUses: string[];
  createdAt: string; promotedAt?: string;
  intervalsExport?: { status: "pending" | "synced" | "failed"; workoutId?: string; error?: string };
}
export interface WorkoutLibraryStore { entries: WorkoutLibraryEntry[]; bootstrappedAt?: string }
```

- [ ] Implement fingerprinting with `node:crypto`, normalization over structured step lines, protocol checks through `validateWorkoutProtocol`, evidence state transitions, and stable selector ranking. Reuse `DaySlot`; do not add a selector abstraction or dependency.
- [ ] Run `npx vitest run lib/workout-library.test.ts`; expect PASS.
- [ ] Commit with `git add lib/types.ts lib/workout-library.ts lib/workout-library.test.ts && git commit -m "feat: add proven workout library domain"`.

### Task 2: Atomic persistence, bootstrap, and promotion

**Files:** Modify `lib/data-store.ts`; create `lib/workout-library-service.ts`, `lib/workout-library-service.test.ts`.

**Interfaces:** Produce `readWorkoutLibrary`, `updateWorkoutLibrary`, `bootstrapWorkoutLibrary`, `ingestWorkoutEvidence`, `promoteWorkoutManually`, `setWorkoutLibraryStatus`, and `recordAcceptedLibraryUses`.

- [ ] Write failing scratch-store tests covering current/history prescription joins by date, skipped off-plan/compromised/unsupported/invalid rides, idempotent repeated ingestion, truthy `bootstrappedAt`, manual completion requirement, retirement persistence, and accepted-use counting.
- [ ] Run `npx vitest run lib/workout-library-service.test.ts`; expect missing-export failures.
- [ ] Add the store through the existing aliases:

```ts
const DEFAULT_WORKOUT_LIBRARY: WorkoutLibraryStore = { entries: [] };
export const readWorkoutLibrary = () => readJson<WorkoutLibraryStore>("workout-library.json", DEFAULT_WORKOUT_LIBRARY);
export const updateWorkoutLibrary = (mutate: (s: WorkoutLibraryStore) => WorkoutLibraryStore | Promise<WorkoutLibraryStore>) =>
  updateJson("workout-library.json", DEFAULT_WORKOUT_LIBRARY, mutate);
```

- [ ] Implement one date join over `readCurrentBlock`, `readBlockHistory`, and `readScoreLog`. Reuse preserved `workoutText`, `durationMin`, `type`, `protocolFindings`, and frozen score fields. Never write `score-log.json`.
- [ ] Perform every state re-check and mutation inside `updateWorkoutLibrary`. Set export `pending` only on first activation. Preserve `retired` on later evidence. Cap `recentUses` at 10 accepted dates.
- [ ] Run Tasks 1-2 tests; expect PASS.
- [ ] Commit with `git add lib/data-store.ts lib/workout-library-service.ts lib/workout-library-service.test.ts && git commit -m "feat: persist workout library evidence"`.

### Task 3: Intervals.icu export

**Files:** Modify `lib/intervals-api.ts`, `app/api/sync/route.ts`, `app/api/sync/route.test.ts`; create `lib/workout-library-export.ts`, `lib/workout-library-export.test.ts`.

**Interfaces:** Produce `findOrCreateWorkoutFolder`, `createLibraryWorkout`, `exportWorkoutLibraryEntry`, and `exportPendingWorkoutLibraryEntries`.

- [ ] Write failing mocked tests for folder reuse/create, verbatim `workoutText` as `description`, `type: "Ride"`, remote ID persistence, failed state, retry, no second POST after sync, and sync invoking evidence ingestion plus pending export after the score ledger has been updated.
- [ ] Run `npx vitest run lib/workout-library-export.test.ts`; expect failures.
- [ ] Add thin Intervals primitives using existing athlete URL, `icuFetch`, and `IntervalsApiError`. Folder is `NodeVelo — <type>`; workout name is `<type> — <duration> min — <id-prefix>`.
- [ ] Implement export by reading state, returning if synced, doing remote I/O outside the JSON lock, then atomically persisting `synced` or `failed`. Never deactivate on export failure.
- [ ] At the end of successful sync scoring, call `ingestWorkoutEvidence` then `exportPendingWorkoutLibraryEntries` best-effort. A library/export failure must be logged and must not fail otherwise-successful ride sync.
- [ ] Run `npx vitest run lib/workout-library-export.test.ts app/api/sync/route.test.ts`; expect PASS.
- [ ] Commit with `git add lib/intervals-api.ts lib/workout-library-export.ts lib/workout-library-export.test.ts app/api/sync/route.ts app/api/sync/route.test.ts && git commit -m "feat: mirror promoted workouts to Intervals"`.

### Task 4: Library API

**Files:** Create `app/api/workout-library/route.ts`, `app/api/workout-library/[id]/route.ts`, `app/api/workout-library/route.test.ts`.

**Interfaces:** `GET /api/workout-library -> { entries }`; `POST` body `{ date } -> { entry }`; `PATCH /api/workout-library/:id` body `{ action: "retire" | "restore" | "retry-export" } -> { entry }`.

- [ ] Write failing route tests for malformed bodies, unknown dates/IDs, blocked protocols, completion requirement, successful manual promotion, retire/restore, and export failure returning an active local entry with failed export state.
- [ ] Run `npx vitest run app/api/workout-library/route.test.ts`; expect missing-route failures.
- [ ] Implement Zod parsing and thin service calls. Keep central CSRF authoritative. Map not-found to 404, invalid promotion to 400, and local-store failure to 500.
- [ ] After activation call `exportWorkoutLibraryEntry`; if remote export fails, return the freshly read active entry because the exporter has persisted failure state. After GET bootstrap, best-effort export any entries that the historical scan newly activated.
- [ ] Run route/service/export tests; expect PASS.
- [ ] Commit with `git add app/api/workout-library app/api/workout-library/route.test.ts && git commit -m "feat: expose workout library API"`.

### Task 5: Deterministic routine templates

**Files:** Create `lib/workout-templates.ts`, `lib/workout-templates.test.ts`.

**Interfaces:** Produce `buildTemplateDay(slot, nutrition): PlannedDay & { source: WorkoutSource }` for Z2, Recovery, Rest, and Strength.

- [ ] Write failing tests asserting exact `totalPrescribedMinutes` for Z2 90/120/180/240 and Recovery; Rest has empty text; Strength has the configured duration; cycling templates pass protocol validation.
- [ ] Run `npx vitest run lib/workout-templates.test.ts`; expect missing export.
- [ ] Implement the four Z2 templates with warmup/steady/cooldown Intervals syntax. Choose the nearest fixed duration inside the slot envelope; throw `TemplateCoverageError` if none fits.
- [ ] Add one static KB-backed Strength prescription and deterministic Recovery/Rest copy. Copy caller-supplied nutrition numbers; do not calculate them here.
- [ ] Run tests; expect PASS.
- [ ] Commit with `git add lib/workout-templates.ts lib/workout-templates.test.ts && git commit -m "feat: add deterministic routine workout templates"`.

### Task 6: Missing-slot AI contract

**Files:** Create `lib/slot-generation-schema.ts`, `lib/slot-generation-schema.test.ts`; modify `lib/anthropic-api.ts`, `lib/anthropic-prompts.ts`, `lib/ai-usage.ts`.

**Interfaces:** Produce `MissingWorkoutSlot`, `GeneratedWorkoutSlot`, `buildMissingSlotPrompt`, `generateWorkoutSlots`, and `generateBlockOverview`.

- [ ] Write failing schema tests that accept exactly requested dates and reject extra, duplicate, missing, and non-quality dates.
- [ ] Run `npx vitest run lib/slot-generation-schema.test.ts`; expect failures.
- [ ] Define one forced tool whose input is `{ days: GeneratedWorkoutSlot[] }`; each day has `date`, `name`, `type`, `durationMin`, `workoutText`, and `description`. Validate the output date set against the request.
- [ ] Implement `generateWorkoutSlots` with the current generation model/cache split/usage recorder, sizing output tokens from missing-slot count. Record purpose `workout-slots`.
- [ ] Implement `generateBlockOverview` with `QUICK_MODEL`; return `null` on failure. Bump `PROMPT_VERSION`. Keep protocol rules unchanged unless bands change, in which case update all three copies.
- [ ] Run `npx vitest run lib/slot-generation-schema.test.ts lib/system-prompt.test.ts lib/ai-usage.test.ts`; expect PASS.
- [ ] Commit with `git add lib/slot-generation-schema.ts lib/slot-generation-schema.test.ts lib/anthropic-api.ts lib/anthropic-prompts.ts lib/ai-usage.ts && git commit -m "feat: generate uncovered workout slots only"`.

### Task 7: Mixed-source block assembly

**Files:** Create `lib/block-assembly.ts`, `lib/block-assembly.test.ts`; modify `lib/types.ts`, `app/api/generate/route.ts`.

**Interfaces:** Produce `assembleBlock({ skeleton, library, context, nutrition, ftp }) -> { days, overview, raw, sources }`.

- [ ] Write failing tests for full coverage without `generateWorkoutSlots`, partial coverage requesting only missing dates, byte-identical library text, deterministic sources, template days, duplicate avoidance, bad AI date sets, overview fallback, and chronological output.
- [ ] Run `npx vitest run lib/block-assembly.test.ts`; expect failures.
- [ ] Before selection, run the idempotent bootstrap and read the local library. Then implement three passes: select library quality days; build routine templates; send all uncovered quality slots in one bounded call and merge by date. Throw if any skeleton date remains unfilled.
- [ ] Add optional `sources?: Record<string, WorkoutSource>` to `GeneratedPlan`. Keep per-block data out of the cached system prompt.
- [ ] Replace only the authoring segment of `app/api/generate/route.ts`. Preserve feasibility, skeleton, nutrition, duration reconciliation, nutrition repair, every validator, season persistence, and response semantics.
- [ ] Run `npx vitest run lib/block-assembly.test.ts app/api/generate/route.test.ts`; expect PASS.
- [ ] Commit with `git add lib/types.ts lib/block-assembly.ts lib/block-assembly.test.ts app/api/generate/route.ts && git commit -m "feat: assemble blocks from proven workouts"`.

### Task 8: Count accepted reuse

**Files:** Modify `app/api/write/route.ts`, `app/api/write/route.test.ts`.

- [ ] Write a failing test proving generation alone does not alter use count, successful write increments each distinct `library:<id>` once, and failed writes do not increment.
- [ ] Run the focused route test; expect failure.
- [ ] After the existing calendar/block commit succeeds, extract library IDs from accepted sources and call `recordAcceptedLibraryUses`. Keep this accounting best-effort so it cannot roll back a committed block.
- [ ] Run `npx vitest run app/api/write/route.test.ts lib/workout-library-service.test.ts`; expect PASS.
- [ ] Commit with `git add app/api/write/route.ts app/api/write/route.test.ts && git commit -m "feat: record accepted workout library reuse"`.

### Task 9: Management and manual-promotion UI

**Files:** Create `app/library/page.tsx`, `components/WorkoutLibrary.tsx`, `components/WorkoutLibrary.test.tsx`, `components/SaveToLibrary.tsx`, `components/SaveToLibrary.test.tsx`; modify `components/dashboard/plan.tsx`, `components/Nav.tsx`.

- [ ] Write failing interaction tests for Active/Candidate/Retired groups, displayed evidence/best/recent/source/use/export data, retire/restore/retry, busy states, inline promotion, and server rejection text.
- [ ] Run both component tests; expect missing components.
- [ ] Build one compact management list with existing UI/API/React Query patterns. Add Retire, Restore, and Retry export only—no editor, ratings, folder UI, merging, or charts.
- [ ] Build `SaveToLibrary` beside `DayAction`, render it for completed quality days not already active, POST `{ date }`, invalidate affected queries, and retain retryable inline errors.
- [ ] Add `/library` to non-mobile system navigation. Preserve keyboard operation and focus visibility.
- [ ] Run `npx vitest run components/WorkoutLibrary.test.tsx components/SaveToLibrary.test.tsx components/dashboard/plan.test.tsx`; expect PASS.
- [ ] Commit the seven UI files with message `feat: add workout library management UI`.

### Task 10: Verification and owned docs

**Files:** Modify `docs/systems/02-scoring-and-learning.md`, `docs/systems/06-generation.md`, `docs/systems/07-ai-layer.md`, `docs/FILE_INDEX.md`, `FEATURES.md`, `ROADMAP.md`, `ARCHIVE.md`.

- [ ] Run all new focused tests plus `app/api/generate/route.test.ts` and `app/api/write/route.test.ts`; expect PASS.
- [ ] Run `npm test` and `npm run check`; expect a green suite, lint, typecheck, and build. Do not edit unrelated dirty files to fix concurrent-session failures.
- [ ] Live-run a partial-coverage block and confirm only uncovered quality dates reach `workout-slots`, selected library text is unchanged, and all validators run.
- [ ] Live-run a full-coverage block and confirm no workout-authoring call occurs, the cheap overview call occurs, sources are present, and validation passes.
- [ ] Promote one real completed quality workout and confirm local activation plus structured rendering in the correct Intervals.icu folder.
- [ ] Document promotion in system 02, mixed assembly in system 06, both AI call sites/models in system 07, new routes/files in FILE_INDEX, capability in FEATURES, and move the shipped roadmap item to ARCHIVE. Check every changed anchor with `rg`.
- [ ] Commit docs with `git add docs/systems/02-scoring-and-learning.md docs/systems/06-generation.md docs/systems/07-ai-layer.md docs/FILE_INDEX.md FEATURES.md ROADMAP.md ARCHIVE.md && git commit -m "docs: record proven workout library shipped"`.
