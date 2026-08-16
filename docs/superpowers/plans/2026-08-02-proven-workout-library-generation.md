# Proven Workout Library Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a manually-curated quality-workout library (v1 — see 2026-08-05 re-scope below) that
increasingly replaces AI-authored block sessions and mirrors promoted workouts to Intervals.icu.

**Architecture:** Keep `computeBlockSkeleton` as composition authority. A local JSON library holds
immutable quality prescriptions the athlete manually promotes, fills compatible slots deterministically,
and asks Claude only for uncovered quality slots; static templates fill routine days and a cheap call
writes the overview.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod, Vitest, React Testing Library, existing atomic JSON store, Anthropic tool use, Intervals.icu REST API.

**2026-08-05 re-scope (athlete decision):** automatic evidence-based promotion and the historical
bootstrap are deferred to a follow-on task (design §5a) — real evidence is too sparse right now to
justify their persistence/locking/bootstrap surface before the manually-curated path proves itself. Task
1's `applyEvidence` (score-threshold logic) already shipped as a tested, uncalled primitive for that
later task to pick up. Tasks 2–4 below are narrowed accordingly; Tasks 5–10 are largely unaffected since
they don't care where a library entry came from.

**2026-08-11 correction (hostile review against the live codebase, 7 findings closed):** Task 2 needs
`workout-library.json` added to `json-store.ts`'s `CRITICAL` set and a precise "completed" check.
Task 3's export needs a single-flight + remote-identity-lookup guard, not just "read before POST." Task 5
is rewritten from four fixed-duration Z2 templates to one parameterized template, gated by the block's
active durability template (`lib/durability.ts` A–E) so embedded-effort prescriptions never get silently
replaced by a generic ride while `durabilityTemplate` is still stamped as if they weren't. Task 6's AI
contract now also covers event-kind (`kind: "event"`) dates and durability-driven long-ride dates, not
only `kind: "quality"` ones. Task 7 gets a RaceSim-reservation fill order and `GeneratedPlan` provenance
fixes. Full rationale in design doc §3, §5, §6, §7, §8, §10.

## Global Constraints

- NodeVelo's local JSON library is authoritative; Intervals.icu is export-only.
- Learned types are exactly Threshold, VO2max, SIT, and RaceSim; prescriptions are immutable.
- v1 activation is manual only: requires a ride with no explicit `data/dispositions.json` entry tagged
  `"partial"`, `"missed"`, or `"compromised"` for that date (absence of an entry, or an explicit
  `"completed"` one, both qualify — disposition tagging is athlete-optional, and most rides never get one),
  and cannot override structural/protocol safety. (Automatic activation — one uncompromised score ≥8 or
  two distinct uncompromised scores ≥6 — is designed in §5a but deferred; do not wire it up in this pass.)
- Z2 is one parameterized template scaled to any duration in the athlete's configured 60–480 min
  long-ride range — not four fixed points. It's selected only when the week's long ride is supposed to be
  unbroken Z2 (durability template A, or any recovery week); Recovery, Rest, and Strength are
  deterministic as before.
- A "quality slot" for selection and AI-authoring purposes includes `kind: "event"` skeleton days
  (`allowedTypes: ["RaceSim"]`), not only `kind: "quality"` ones.
- `workout-library.json` must be in `json-store.ts`'s `CRITICAL` set (Task 2) — it's exactly the kind of
  irreplaceable data that set exists to protect.
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

### Task 2: Atomic persistence and manual promotion

**Scope note (2026-08-05 re-scope):** automatic evidence ingestion and the historical bootstrap are
deferred (design §5a) — not built in this task. `bootstrapWorkoutLibrary` and `ingestWorkoutEvidence` are
cut from this plan entirely; re-add them as their own task when §5a is picked back up.

**Files:** Modify `lib/data-store.ts`; create `lib/workout-library-service.ts`, `lib/workout-library-service.test.ts`.

**Interfaces:** Produce `readWorkoutLibrary`, `updateWorkoutLibrary`, `promoteWorkoutManually`, `setWorkoutLibraryStatus`, and `recordAcceptedLibraryUses`.

- [x] Write failing scratch-store tests covering: promotion looks up the day's prescription in the live
  block first, then archived `BlockHistoryEntry.days` (SUB-1's "could be live or archived" lookup shape);
  a new fingerprint creates an entry, a repeat fingerprint updates the existing one; a ride with **no**
  `data/dispositions.json` entry at all is eligible (most rides never get tagged — absence is not a
  rejection); a ride whose entry is explicitly `"partial"` or `"missed"` is rejected even if it carries a
  real score; compromised/unsupported-type/protocol-invalid rides are rejected with the concrete reason;
  already-active entries are a no-op, not a duplicate; retirement and restore persistence; accepted-use
  counting; and a simulated double corruption (live file + `.bak` both unreadable) refuses to persist the
  empty fallback.
- [x] Run `npx vitest run lib/workout-library-service.test.ts`; expect missing-export failures.
- [x] Add `"workout-library.json"` to the `CRITICAL` set in `lib/json-store.ts` (alongside `score-log.json`,
  `current-block.json`, etc.) — this gets `.bak` rotation and `updateJsonFile`'s existing refusal to
  persist a corrupt-fallback as truth for free; no other code change needed for this protection.
- [x] Add the store through the existing aliases:

```ts
const DEFAULT_WORKOUT_LIBRARY: WorkoutLibraryStore = { entries: [] };
export const readWorkoutLibrary = () => readJson<WorkoutLibraryStore>("workout-library.json", DEFAULT_WORKOUT_LIBRARY);
export const updateWorkoutLibrary = (mutate: (s: WorkoutLibraryStore) => WorkoutLibraryStore | Promise<WorkoutLibraryStore>) =>
  updateJson("workout-library.json", DEFAULT_WORKOUT_LIBRARY, mutate);
```

- [x] Implement `promoteWorkoutManually(date)`: find the day's record (live block, else block history),
  compute its fingerprint, fetch the matching score-log entry AND look up that date in
  `data/dispositions.json` — reject only when an entry exists AND its `disposition` is `"partial"`,
  `"missed"`, or `"compromised"` (no entry, or an explicit `"completed"` one, both pass — disposition
  tagging is athlete-optional, so absence must not read as rejection) — run `canManuallyPromote` (Task 1),
  and on success either create a new entry (`status: "active"`, `promotedBy: "manual"`, one evidence item)
  or fold the evidence into an existing entry at that fingerprint. Never write `score-log.json`.
  Implemented as `PromoteWorkoutResult` (`{ok:true, entry}` or `{ok:false, reason}`) with reasons
  `day-not-found | not-scored | not-completed | unsupported-type | retired | protocol-invalid` — a
  `PromotionRejectedError` thrown inside the lock and caught at the boundary keeps the re-check atomic
  (design §10) while still returning a clean, typed result instead of an unhandled rejection.
- [x] Perform every state re-check and mutation inside `updateWorkoutLibrary`. Set export `pending` only
  on first activation. Cap `recentUses` at 10 accepted dates.
- [x] Run Tasks 1-2 tests; expect PASS. (19/19 new tests, 2238/2238 full suite, typecheck + lint clean.)
- [x] Commit with `git add lib/data-store.ts lib/json-store.ts lib/workout-library-service.ts lib/workout-library-service.test.ts && git commit -m "feat: persist workout library evidence"`.

### Task 3: Intervals.icu export

**Scope note (2026-08-05 re-scope):** v1 only ever promotes one entry at a time from an explicit athlete
action, so this task no longer touches `app/api/sync/route.ts` at all — export is a single-entry call
from Task 4's promotion route, not a sync-triggered sweep. `exportPendingWorkoutLibraryEntries` (bulk
sweep) is cut; re-add it alongside §5a's bootstrap when that ships.

**Files:** Modify `lib/intervals-api.ts`; create `lib/workout-library-export.ts`, `lib/workout-library-export.test.ts`.

**Interfaces:** Produce `findOrCreateWorkoutFolder`, `createLibraryWorkout`, `findRemoteLibraryWorkout`, and `exportWorkoutLibraryEntry`.

- [x] Write failing mocked tests for folder reuse/create, verbatim `workoutText` as `description`, `type: "Ride"`, remote ID persistence, failed state, retry (no second POST after a stored remote ID), **two concurrent `exportWorkoutLibraryEntry` calls for the same entry producing exactly one remote workout** (single-flight), and **a simulated crash-after-POST** (a retry after the process "died" between the successful create and the local persist must find the prior remote workout via `findRemoteLibraryWorkout` — matched on the deterministic `<type> — <duration> min — <id-prefix>` name — rather than creating a duplicate).
- [x] Run `npx vitest run lib/workout-library-export.test.ts`; expect failures.
- [x] Add thin Intervals primitives using existing athlete URL, `icuFetch`, and `IntervalsApiError`. Folder is `NodeVelo — <type>`; workout name is `<type> — <duration> min — <id-prefix>` — deterministic and unique enough to look up by.
  Forum research (2026-08-16) confirmed no `external_id`/`upsert` exists on this endpoint (unlike
  `/events/bulk`) and that `GET /folders`'s exact nesting (workouts per-folder vs. flat + `folder_id`)
  isn't documented — `parseFolderTree` in `lib/intervals-api.ts` handles either shape defensively; also
  added 42 low-level tests to `lib/intervals-api.test.ts` (not originally in this task's file list, but
  the natural existing home for intervals-api primitive tests) exercising both shapes.
- [x] Implement export by reading state, returning if synced, then — inside a per-entry-ID in-process single-flight (a `Map<string, Promise<...>>` keyed by entry ID, mirroring `json-store.ts`'s own per-file lock pattern) — first calling `findRemoteLibraryWorkout` in the target folder by the deterministic name, using it if found instead of creating; otherwise doing the remote create outside the JSON lock, then atomically persisting `synced` or `failed`. Never deactivate on export failure. The single-flight closes the concurrent-request case; the remote lookup-before-create closes the crash-after-POST case that no local lock can catch.
- [x] Run `npx vitest run lib/workout-library-export.test.ts`; expect PASS. (7/7, plus 42/42 in `lib/intervals-api.test.ts`; 2253/2253 full suite, typecheck + lint clean.)
- [x] Commit with `git add lib/intervals-api.ts lib/workout-library-export.ts lib/workout-library-export.test.ts && git commit -m "feat: mirror promoted workouts to Intervals"`.

### Task 4: Library API

**Files:** Create `app/api/workout-library/route.ts`, `app/api/workout-library/[id]/route.ts`, `app/api/workout-library/route.test.ts`.

**Interfaces:** `GET /api/workout-library -> { entries }`; `POST` body `{ date } -> { entry }`; `PATCH /api/workout-library/:id` body `{ action: "retire" | "restore" | "retry-export" } -> { entry }`.

- [x] Write failing route tests for malformed bodies, unknown dates/IDs, blocked protocols, completion requirement, successful manual promotion, retire/restore, and export failure returning an active local entry with failed export state.
- [x] Run `npx vitest run app/api/workout-library/route.test.ts`; expect missing-route failures.
- [x] Implement Zod parsing and thin service calls. Keep central CSRF authoritative. Map not-found to 404, invalid promotion to 400, and local-store failure to 500.
  **Deviation:** used the same manual `typeof`/regex body validation every other route in the app uses
  (`app/api/disposition/route.ts` etc.) instead of Zod — grepped the whole `app/api` tree first: zero
  existing routes parse request bodies with Zod (it's only used for Anthropic tool-call schemas,
  `lib/*-schema.ts`), so introducing it here would be a first-of-its-kind pattern for one route rather
  than matching the other ~20. CSRF confirmed centrally enforced via `proxy.ts` (matcher `/api/:path*`)
  — no per-route code needed, as the plan says. `[id]/route.ts` is the app's first dynamic route segment;
  Next.js 16's `params` is `Promise<{id}>` (checked `node_modules/next/dist/docs` per AGENTS.md — this is
  exactly the kind of breaking change it warns about) and a full `npm run build` confirms both routes are
  recognized correctly (`/api/workout-library`, `/api/workout-library/[id]` both listed as dynamic).
- [x] After activation call `exportWorkoutLibraryEntry` for that one entry; if remote export fails, return the freshly read active entry because the exporter has persisted failure state.
- [x] Run route/service/export tests; expect PASS. (17/17 new route tests; 2270/2270 full suite, typecheck + lint + build clean.)
- [x] Commit with `git add app/api/workout-library app/api/workout-library/route.test.ts && git commit -m "feat: expose workout library API"`.

### Task 5: Deterministic routine templates

**Scope note (2026-08-11 correction):** the original four fixed-duration Z2 templates (90/120/180/240
min) leave most of the athlete's configurable 60–480 min long-ride range with no matching template
(`app/api/settings/route.ts` validates `longRideDurationMinutes` across that whole span; `DURATION_SLACK_MIN`
is only ±15 min). Replaced with one parameterized template. Also: the pre-plan generator builds the long
Z2 ride according to the block's rotating durability template (`lib/durability.ts`, A–E) and
`app/api/write/route.ts` stamps whichever template was selected onto every long-ride day regardless of
what actually produced its content — so a generic Z2 template can only stand in for template A (no
embedded efforts) or a recovery week (same exception); templates B–E's embedded harder efforts are fuzzy
prose ranges meant for an LLM, not something this task can build a deterministic schedule for. `buildTemplateDay`
must therefore signal ineligibility so Task 7 routes those days to AI authoring instead of silently
losing the durability stimulus. Design §3 has the full rationale.

**Files:** Create `lib/workout-templates.ts`, `lib/workout-templates.test.ts`.

**Interfaces:** Produce `buildTemplateDay(type, slot, durabilityTemplateId, isRecoveryWeek, nutrition): (PlannedDay & { source: WorkoutSource }) | null` for Z2, Recovery, Rest, and Strength — `null` return means "not template-eligible, Task 7 must send this date to AI."
**Deviation (implementation-time):** added an explicit `type` parameter, not in the original 4-argument
signature. `slot.allowedTypes` for an `"easy"`-kind slot is `["Z2", "Recovery"]` (block-skeleton.ts) —
two elements, and nothing else in the 4-argument signature disambiguates which one the caller wants.
Task 7 already has to decide, per slot, which type it's filling when it assembles a block; that's the
natural (and only available) place for that decision to live, so it's now passed in rather than guessed.

- [x] Write failing tests asserting: the parameterized Z2 template produces the exact requested duration (via `totalPrescribedMinutes`) at both the 60 min and 480 min extremes and at an arbitrary non-round point (e.g. 150 min) inside the slot envelope, not just the four old fixed points; Z2 returns `null` when `durabilityTemplateId` is `"B"`–`"E"` and `isRecoveryWeek` is `false`; Z2 returns the deterministic template (not `null`) when `durabilityTemplateId` is `"A"` OR `isRecoveryWeek` is `true` regardless of `durabilityTemplateId`; Recovery template's exact `totalPrescribedMinutes`; Rest has empty text; Strength has the configured duration; all cycling templates pass protocol validation.
- [x] Run `npx vitest run lib/workout-templates.test.ts`; expect missing export.
- [x] Implement one parameterized Z2 template: fixed-length warmup and cooldown, steady segment sized to exactly fill the remainder of the slot's requested duration — covering the full legal range with no coverage gap, so `TemplateCoverageError` (kept as a defensive invariant check, not the primary duration-mismatch path it was before) should no longer be reachable via duration alone.
  Warmup/cooldown fixed at 10 min each at 55%/50% FTP; steady at 68% FTP (under the 75% easy ceiling and
  88% durability-insert floor, so `validateWorkoutProtocol` finds nothing to flag by construction).
  Recovery is one flat block at 50% FTP (KB cycling_database.md: "under 60% FTP throughout").
- [x] Add one static KB-backed Strength prescription and deterministic Recovery/Rest copy. Copy caller-supplied nutrition numbers; do not calculate them here.
  Strength text is the KB's "Core Programme — Heavy Compound Lifts" table verbatim (cycling_database.md
  §4, the 7-exercise year-round programme). `nutrition: WorkoutNutritionPlan` (`lib/nutrition.ts`) is
  formatted into `description`, not calculated — no nutrition math added here.
- [x] Run tests; expect PASS. (16/16 new tests, including protocol-validation coverage across every
  cycling template + duration combination; 2286/2286 full suite, typecheck + lint clean.)
- [x] Commit with `git add lib/workout-templates.ts lib/workout-templates.test.ts && git commit -m "feat: add deterministic routine workout templates"`.

### Task 6: Missing-slot AI contract

**Files:** Create `lib/slot-generation-schema.ts`, `lib/slot-generation-schema.test.ts`; modify `lib/anthropic-api.ts`, `lib/anthropic-prompts.ts`, `lib/ai-usage.ts`.

**Interfaces:** Produce `MissingWorkoutSlot`, `GeneratedWorkoutSlot`, `buildMissingSlotPrompt`, `generateWorkoutSlots`, and `generateBlockOverview`.

**Scope note (2026-08-11 correction):** `MissingWorkoutSlot` must accept `kind: "event"` dates
(`allowedTypes: ["RaceSim"]`) identically to `kind: "quality"` ones — event slots are a live mechanism
(event-aware race planning) that Task 5/7's earlier "quality-only" framing would otherwise leave
permanently unfillable, throwing generation. It must also accept a long-ride date whenever Task 5's
`buildTemplateDay` returned `null` (durability template B–E, non-recovery week) — carrying
`formatDurabilityForPrompt`'s instruction for that date so the AI-authored long ride still matches the
block's actual durability prescription instead of defaulting to plain Z2.

- [ ] Write failing schema tests that accept exactly requested dates — including `kind: "event"` dates and a durability-driven long-ride date — and reject extra, duplicate, missing, and dates the skeleton doesn't actually require authored content for (a locked Rest/Strength/template-eligible-Z2 day).
- [ ] Run `npx vitest run lib/slot-generation-schema.test.ts`; expect failures.
- [ ] Define one forced tool whose input is `{ days: GeneratedWorkoutSlot[] }`; each day has `date`, `name`, `type`, `durationMin`, `workoutText`, and `description`. Validate the output date set against the request.
- [ ] Implement `generateWorkoutSlots` with the current generation model/cache split/usage recorder, sizing output tokens from missing-slot count. Record purpose `workout-slots`. For any requested date whose skeleton day is the long ride, inject `formatDurabilityForPrompt`'s instruction into that date's context.
- [ ] Implement `generateBlockOverview` with `QUICK_MODEL`; return `null` on failure. Populate the new `overview?: { model, raw }` field on `GeneratedPlan` (Task 7) rather than overwriting the plan's top-level `model`/`raw`. Bump `PROMPT_VERSION`. Keep protocol rules unchanged unless bands change, in which case update all three copies.
- [ ] Run `npx vitest run lib/slot-generation-schema.test.ts lib/system-prompt.test.ts lib/ai-usage.test.ts`; expect PASS.
- [ ] Commit with `git add lib/slot-generation-schema.ts lib/slot-generation-schema.test.ts lib/anthropic-api.ts lib/anthropic-prompts.ts lib/ai-usage.ts && git commit -m "feat: generate uncovered workout slots only"`.

### Task 7: Mixed-source block assembly

**Files:** Create `lib/block-assembly.ts`, `lib/block-assembly.test.ts`; modify `lib/types.ts`, `app/api/generate/route.ts`.

**Interfaces:** Produce `assembleBlock({ skeleton, library, context, nutrition, ftp, durabilityTemplateId }) -> { days, overview, overviewProvenance, raw, model, promptVersion, sources }`.

**Scope note (2026-08-11 correction):** this task absorbs the review's four remaining findings — event
slots, RaceSim reservation order, the durability↔template hookup from Task 5, and `GeneratedPlan`
provenance. `lib/workout-library.ts`'s already-shipped `selectLibraryWorkout` currently hardcodes
`slot.kind === "quality"`, which would silently exclude every event day forever; that one-line fix lands
in this task (see its own bullet below) rather than waiting to be rediscovered later, since nothing calls
the function yet and the design doc (§3) already documents the corrected behavior.

- [ ] Write failing tests for full coverage without `generateWorkoutSlots`, partial coverage requesting only missing dates, byte-identical library text, deterministic sources (including `template:z2-<duration>` reflecting the actual duration used, not a fixed name), template days, duplicate avoidance, bad AI date sets, overview fallback, chronological output, **an event-kind (`kind: "event"`) day filled from the library exactly like a quality day, and one filled by AI when no matching entry exists**, **a block whose `requireRaceSim` floor is satisfied by the reservation pass even when every flexible slot's best library match by raw ranking would otherwise be non-RaceSim**, and **a durability-template-B block whose long-ride day is never template-filled and is included in the AI request with the durability instruction attached**.
- [ ] Run `npx vitest run lib/block-assembly.test.ts`; expect failures.
- [ ] Widen `lib/workout-library.ts`'s `selectLibraryWorkout` filter from `slot.kind === "quality"` to `(slot.kind === "quality" || slot.kind === "event")`; add a focused test to `lib/workout-library.test.ts` proving an event-kind RaceSim slot now matches. This is the one already-shipped-code correction this plan makes.
- [ ] Read the local library (no bootstrap to run — §5a is deferred, so the library only holds whatever the athlete has manually promoted). Then implement four passes in order: (1) for each unmet block-wide requirement from `deriveSessionRequirements` (currently just `requireRaceSim`), reserve one flexible slot and fill it from the library if a matching active entry exists, else leave it uncovered for AI — before any type-agnostic ranking runs, so a greedy fill can't consume every flexible slot with the wrong type first; (2) select remaining library quality-or-event days by ordinary best-match ranking; (3) build routine templates for Z2/Recovery/Rest/Strength slots, passing the block's `durabilityTemplateId` and each week's recovery flag to `buildTemplateDay` — a `null` return (durability B–E, non-recovery) makes that long-ride date part of the uncovered set; (4) send all uncovered quality-or-event-or-long-ride slots in one bounded call and merge by date. Throw if any skeleton date remains unfilled.
- [ ] `selectLibraryWorkout` is single-slot and stateless — it has no memory of entries already picked earlier in the same block. Track selected entry IDs across passes (1) and (2) and exclude them from the candidate list on each subsequent call, falling back to reuse only when no alternative of the required type remains (design §6, "An entry may appear only once in a block while another eligible entry of the same type exists").
- [ ] Add optional `sources?: Record<string, WorkoutSource>` to `GeneratedPlan`. Make `model`/`promptVersion`/`raw` properly optional (a full-coverage block makes no slot-authoring call, so there's nothing to stamp there) and add `overview?: { model: string; raw: string }` for `generateBlockOverview`'s separate `QUICK_MODEL` call, so two different AI calls with two different models no longer share one set of fields. Keep per-block data out of the cached system prompt.
- [ ] Replace only the authoring segment of `app/api/generate/route.ts`. Preserve feasibility, skeleton, nutrition, duration reconciliation, nutrition repair, every validator, season persistence, and response semantics.
- [ ] Run `npx vitest run lib/block-assembly.test.ts app/api/generate/route.test.ts lib/workout-library.test.ts`; expect PASS.
- [ ] Commit with `git add lib/types.ts lib/workout-library.ts lib/workout-library.test.ts lib/block-assembly.ts lib/block-assembly.test.ts app/api/generate/route.ts && git commit -m "feat: assemble blocks from proven workouts"`.

### Task 8: Count accepted reuse

**Files:** Modify `app/api/write/route.ts`, `app/api/write/route.test.ts`.

- [ ] Write a failing test proving generation alone does not alter use count, successful write increments each distinct `library:<id>` once, and failed writes do not increment.
- [ ] Run the focused route test; expect failure.
- [ ] After the existing calendar/block commit succeeds, extract library IDs from accepted sources and call `recordAcceptedLibraryUses`. Keep this accounting best-effort so it cannot roll back a committed block.
- [ ] Run `npx vitest run app/api/write/route.test.ts lib/workout-library-service.test.ts`; expect PASS.
- [ ] Commit with `git add app/api/write/route.ts app/api/write/route.test.ts && git commit -m "feat: record accepted workout library reuse"`.

### Task 9: Management and manual-promotion UI

**Files:** Create `app/library/page.tsx`, `components/WorkoutLibrary.tsx`, `components/WorkoutLibrary.test.tsx`, `components/SaveToLibrary.tsx`, `components/SaveToLibrary.test.tsx`; modify `components/dashboard/plan.tsx`, `components/Nav.tsx`.

- [ ] Write failing interaction tests for Active/Candidate/Retired groups (Candidate is always empty in v1 — assert it renders an empty state, not that it's omitted, since §5a will populate it later), displayed evidence/best/recent/source/use/export data, retire/restore/retry, busy states, inline promotion, and server rejection text.
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
- [ ] Live-run one block whose date range includes a real calendar event, and confirm the event day is filled (library or AI) rather than throwing.
- [ ] Live-run one block with `longRideDurationMinutes` set to a non-round value (e.g. 150) and confirm the Z2 template covers it without `TemplateCoverageError`.
- [ ] Promote one real completed quality workout and confirm local activation plus structured rendering in the correct Intervals.icu folder.
- [ ] Document manual promotion in system 02 (note automatic evidence-based promotion + the historical bootstrap are designed but deferred — design §5a — not silently missing), mixed assembly in system 06, both AI call sites/models in system 07, new routes/files in FILE_INDEX, capability in FEATURES, and move the shipped roadmap item to ARCHIVE with the deferred §5a scope left behind as a new "Later" entry rather than dropped. Check every changed anchor with `rg`.
- [ ] Commit docs with `git add docs/systems/02-scoring-and-learning.md docs/systems/06-generation.md docs/systems/07-ai-layer.md docs/FILE_INDEX.md FEATURES.md ROADMAP.md ARCHIVE.md && git commit -m "docs: record proven workout library shipped"`.
