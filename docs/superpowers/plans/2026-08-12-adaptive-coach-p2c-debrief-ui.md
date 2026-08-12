# Adaptive self-directed coach — Phase 2c: debrief UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Phase 2b's already-written, already-scored self-directed intent on the ride debrief:
an "Intent used" line before the score, the effective (overlay-resolved) score or its `Not scored`
reason in place of the old intrinsic-scorer number, concise evidence for measurable objectives,
qualitative objectives acknowledged but not graded, and `Aerobic drift not measurable` wording when no
steady segment qualified. Also fixes two drift-signal defects found in Phase 2b's PR #35 review
(Tasks 8-9) before this phase renders numbers derived from them, four correctness defects an external
review found in this plan's own original Tasks 1-7 before any of them were implemented (corrected in
place, see the "Round 2" Amendment below), and adds curated-interval-aware intent matching (Tasks 11-13)
plus a fifth Phase-2b-adjacent fix (Task 10).

**Architecture:** Resolve today's effective outcome server-side in `GET`/`POST /api/sync` (reusing
`resolveEffectiveOutcome` — the one seam that already enforces overlay validity — never re-implementing
it), ship the result to the client as a new `todayOutcome` field, and render it through one new
extracted component (`RideIntentBlock`) consumed by `TodayRideCard`. No new persistence, no new API
route, no change to how Phase 2b scores or stores anything. Tasks 8-9 are self-contained deterministic
fixes in `lib/score-log.ts`/`lib/intent-scoring.ts` with no dependency on Tasks 1-7's UI work.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Vitest + `@testing-library/react`
(jsdom, per-file `/** @vitest-environment jsdom */` docblock).

## Amendment (2026-08-12, post-merge)

Tasks 0-7 below are this plan's original, approved scope, written before Phase 2b merged.
**Corrected 2026-08-12 (external review, before any of Tasks 1-7 were implemented): four correctness
defects were found and fixed IN PLACE within Tasks 2, 3, 5 and 6** — a refresh race (Task 3 gained a
Step 7-8), an unsafe activity-id-mismatch fallback (Task 2), a score-fallback bug that would have leaked
the ledger score onto rides with no overlay (Task 6), and a disappearing Post-to-Intervals.icu button
(Task 6). Unlike Tasks 8-9 below, these are edits to this plan's OWN not-yet-executed task text, not
findings about already-shipped code elsewhere — there is no implementation history to preserve, so they
are corrected at the source rather than patched around, each marked inline with what changed and why.
**Tasks 8-9 were added after Phase 2b merged as PR #35**, folding in two non-blocking findings from that
PR's review (both independently verified against the merged code, not taken from the review report on
faith) at the user's explicit direction, rather than opening a separate phase for two small, well-scoped
fixes. Both change numbers this phase's own UI will render (drift % and average drift quality), so
fixing them before Tasks 1-7 ship the debrief is the reason they live here instead of standing alone.
**A second, later amendment — "Amendment (2026-08-12, round 2)", after Task 9 — adds Task 10 (a fifth
review finding, about already-shipped code) and Tasks 11-14 (new scope: richer curated-interval data
and matching, requested directly by the user).**

## Amendment (2026-08-12, round 3 — external review, before Tasks 8-14 were implemented)

A second external review (independently verified against this branch's actual code and history before
accepting any of it, same discipline as round 2) found one blocking design gap and six non-blocking
drift/correctness issues in round 2's own not-yet-executed task text. All seven are corrected IN PLACE
below, same policy as round 2's own four fixes — this is plan text no implementer has started, so there
is no implementation history to preserve around.

- **[P0 — blocking] Task 12's matching hierarchy could not reach the inputs it described.**
  `IntentTarget` (`lib/types.ts:681`) carries no gradient, HR, or ordinal/phase-link field, and
  `matchLaps`'s signature was locked to its existing 3 arguments — so levels 2 (HR/gradient) and 3
  (ordered phase reference) of the original hierarchy had no data path to the function, and the level-2
  example test asserted a "zone + gradient" match from a target that only set `zone`. **Fixed by
  narrowing the hierarchy to what the schema actually carries** (duration+power, then zone alone;
  HR/gradient/ordinal dropped as matching keys, gradient kept as evidence-text context only) rather than
  extending Phase 2b's already-shipped parser schema, which is out of this UI phase's scope.
- **Tasks 8-9 shipped independently and are already ancestors of this branch** (`claude/p2c-tasks-8-9-drift-fixes`,
  merged `main` as `b184e95`/PR #38, before this branch's own round-2 amendment commit). Both tasks'
  code and tests are already present and green here. Converted from executable red-green steps to a
  verify-only note — see Tasks 8-9 below.
- **Round-2's Task 10, 12, and 13 test bodies were comments, not tests** — `it(...)` blocks describing
  the expected behavior in prose with no arrange/act/assert, which Vitest reports as passing (empty)
  rather than failing red. Replaced with real fixtures and assertions in all three.
- **Task 10 also claimed reusable `addCoachNote` test scaffolding that doesn't exist** — `lib/sync-analysis.test.ts`
  currently only tests `formatFuelPromptContext`; there is no `createEvent`/`data-store` mocking to
  reuse. Task 10 now includes the `vi.mock` scaffolding it actually needs, following the pattern already
  established in `app/api/sync/route.test.ts`.
- **Task 11's five new required `ExecutedInterval` fields would break existing fixtures outside its own
  file list** — `lib/durability-score.test.ts`, `lib/trace.test.ts`, and `lib/intent-scoring.test.ts` all
  construct `ExecutedInterval`-typed literals with the current 7 fields only; `app/api/sync/route.test.ts`
  does the same inline. Task 11's file list and steps now include the fixture patch each needs.
- **Two of Task 11's five new fields had no consumer.** Neither `avgCadence` nor `intensity` is read
  anywhere in Task 12's (narrowed) hierarchy or rules — dropped from Task 11 entirely rather than shipped
  speculatively. `avgGradientPct`, `groupId`, and `zone` remain; all three are load-bearing for Task 12.
- **Task 14 understated what Phase 2b already verified.** `docs/systems/02-scoring-and-learning.md`'s
  "Known rough edges" already records three live-smoke overlays run against the real intent-scoring
  pipeline during Phase 2b (sample reads moved from EWMA 6.7/50%/5.0 to 29/5.5/46%/5.3). Task 14 is still
  warranted — Tasks 11-13's new matching logic specifically has not been live-tested — but is now framed
  as a regression smoke for the changed matching path, not the pipeline's first live run.

## Global Constraints

- **Phase 2b must be merged to `main` before this plan starts.** Every type, function and file this
  plan references (`TodayAnalysis` fields aside) lives on `codex/adaptive-coach-p2b-intent-scoring`,
  not `main`, as of this plan's writing (2026-08-12). Task 0 verifies this.
- **Reuse the resolution seam; never re-implement it.** `resolveEffectiveOutcome`,
  `indexOverlaysByActivity`, `indexOverlaysByDate` (`lib/intent-overlay.ts`) are the only code allowed
  to decide whether an overlay applies. No task in this plan re-derives `isApplicable`'s logic by hand.
- **`activityId` is optional and may be `undefined`, never check `=== null`.** A `today-analysis.json`
  written before Task 1 ships parses back with the key absent (`undefined`), not `null` — this is the
  AGENTS.md migration-flag bug class. Every read site truthy-checks.
- **`TodayAnalysis` is a single persisted record, not a history.** Both places `TodayRideCard` renders
  (`components/dashboard/TodayView.tsx:168` interactive, `:245` read-only "Last debrief") show the same
  object. `todayOutcome` is resolved once server-side per request and threaded through both identically.
- **Resolve fresh per request; never persist the overlay verdict into `today-analysis.json`.** Phase
  2b's intent parse is deferred/async (`lib/intent-runner.ts`) and can complete, or a note edit can
  supersede an overlay, after `today-analysis.json` was last written. Baking the verdict into that file
  would go stale until the next full sync.
- **The old intrinsic score (`TodayAnalysis.executionScore`) must not leak through once an overlay
  applies.** This is the exact "generic 2/10" pathway design §14.1 calls out — a self-directed ride's
  displayed score is `todayOutcome.effectiveExecutionScore` (or its `Not scored` reason) whenever
  `todayOutcome.overlay` is non-null, never the old scorer's number.
- **Don't grow `components/dashboard/today.tsx` further.** It is already flagged as a split candidate
  (`docs/systems/08-frontend.md#known-rough-edges`, and the file's own header comment). New debrief
  content is a new component, not more inline JSX in `TodayRideCard`.
- **Evidence/qualitative partition is on `ScoredObjective.measurable`, not `.scored`.** A qualitative
  objective can be `scored: false` with `measurable: false` (acknowledged, not graded) — partitioning
  on `scored` would misclassify it.
- **`interpretation` is `null` for exactly two of the four `notScoredReason` values** —
  `no-intent-found` and `interpreter-failed` (`lib/intent-runner.ts`'s `buildOverlay` calls for those
  two omit `interpretation` entirely). `intent-unreliable` and `no-measurable-objectives` both carry a
  real `interpretation`. The "Intent used" line's guard is `interpretation !== null`, never
  `notScoredReason == null`.
- **Segment-scoped aerobic drift (design §7 steps 2–4, the "opening 45-minute Z2 segment" display) is
  out of scope.** Phase 1 already gates `activityDecoupling` to `null` for any non-whole-ride-steady
  ride; this plan only adds the `Not measurable` wording for that already-correct `null`, per the
  Phase 2b plan's own Handoff boundary: "The value is already correctly `null`; only the wording is
  missing."
- **Four `Not scored` strings; two are design-mandated verbatim, two are this plan's own wording**
  (Phase 2b's plan Handoff boundary: "The wording is 2c's; 2b ships the discriminator only"):
  - `no-intent-found` → `"Not scored — no intent found"` (design §5.3, verbatim)
  - `intent-unreliable` → `"Not scored — intent could not be determined reliably"` (design §5.3,
    verbatim)
  - `interpreter-failed` → `"Not scored — the ride note couldn't be parsed"` (this plan)
  - `no-measurable-objectives` → `"Not scored — nothing measurable to verify"` (this plan)
  - medium-confidence caption (not a `Not scored` state — scored objectives still render a number) →
    `"Limited basis — only objectives directly supported by the note and data were scored."` (this
    plan, paraphrasing design §5.3)
  - aerobic drift → `"Aerobic drift not measurable — no sufficiently steady aerobic segment"` (design
    §7 step 5, verbatim)

---

## Ground truth measured against the real stores (2026-08-12)

Read directly from `codex/adaptive-coach-p2b-intent-scoring` (10 commits, pushed to origin, not yet
reviewed or merged as of this writing):

- `TodayAnalysis` (`lib/types.ts:1118`) has **no `activityId` field**. `ActivitySummary.id`
  (`lib/types.ts:168`) is available at `buildTodayAnalysis` call time (`lib/ride-analysis.ts:152`,
  `input.activity.id`) — the same source field `lib/score-log.ts:270,320` stamps onto
  `RideScoreEntry.activityId`. Nothing currently threads it into `TodayAnalysis`.
- The client already receives the raw ledger (`AppState.scores: RideScoreEntry[]`,
  `components/SyncProvider.tsx:34`) but **never** receives intent overlays — no `overlay` reference
  anywhere in `components/SyncProvider.tsx` or `app/api/sync/route.ts` as shipped to the client.
- `app/api/sync/route.ts` already reads `readIntentOverlays()` in both `GET` (line 93, bound to
  `intentStore`) and `POST` (line ~721 and again near the final response), and **already** threads
  `intentStore.overlays` into all `buildAthleteModel(scoreLog.entries, intentStore.overlays)` calls
  (verified across all 8 production call sites — `app/api/sync/route.ts` ×3, `app/api/write/route.ts`,
  `app/api/trends/route.ts`, `app/api/generate/route.ts`, `lib/season-signals.ts`,
  `lib/coach-snapshot.ts`). That wiring is athlete-state/trends/write/generate's own consumption of
  overlays — separate from and already correctly done; this plan does not touch it.
- `GET`'s response object literal starts at `app/api/sync/route.ts:181`
  (`return NextResponse.json({ configured: …, todayAnalysis, …, scores: … })`).
  `POST`'s equivalent is one line, `app/api/sync/route.ts:1011`
  (`return NextResponse.json({ lastSync, todayAnalysis, …, scores: …, athleteState, coachSnapshot,
  calibration });`).
- `TodayRideCard` (`components/dashboard/today.tsx:149`) is rendered from exactly two call sites, both
  in `components/dashboard/TodayView.tsx`: the interactive "post" mode (`:168`, full props including
  `onPostNote`/`onReAnalyse`) and the read-only "Last debrief" disclosure (`:245`, `analysis` only —
  "No re-analyse / note-post actions on a past ride's debrief"). Both read from the single
  `state.todayAnalysis`.
- The existing score display (`components/dashboard/today.tsx:226-252`) renders
  `analysis.executionScore` unconditionally whenever it's non-null — it has no concept of an overlay
  and does not currently distinguish a self-directed ride's old intrinsic score from an effective one.
- The existing "Decoupling" chip (`components/dashboard/today.tsx:397-411`) already silently omits
  itself when `activityDecoupling == null` (Phase 1's "better absent than wrong" convention, for mixed
  *prescribed* rides). This plan adds the `Not measurable` wording as new content inside the new
  self-directed block — it does not touch this existing chip.
- The existing "Your note" disclosure (`components/dashboard/today.tsx:525-532`) already
  unconditionally shows `activityDescription` whenever present — design §13's "Interpreter failure →
  preserve the raw note" is already satisfied by existing code; no task needed for it.
- `lib/ride-origin.ts` (Phase 2a) currently exports only `originOf` and `countsAsDrift` — both small,
  ride-origin-adjacent pure functions. This plan adds one more of the same shape there rather than a
  new file.
- `docs/INVARIANTS.md` currently ends at item 40 (`main`, as of `c1a7547`) and is unchanged on the 2b
  branch — 2b's own review has not yet run and may append further items before this plan's Task 7 does.
  Task 7 greps the live file for the next number rather than hard-coding one, following the lesson
  already recorded in
  [`docs/superpowers/plans/2026-08-07-adaptive-coach-p2a-origin-and-overlay.md`](2026-08-07-adaptive-coach-p2a-origin-and-overlay.md)'s
  own sibling-collision fix.

## The types this plan reads (already shipped on `codex/adaptive-coach-p2b-intent-scoring`)

No new types. This plan is a pure consumer of `lib/types.ts`'s existing shapes:

```ts
export type RideOrigin = "prescribed" | "self-directed" | "unspecified";

export type NotScoredReason =
  | "no-intent-found"
  | "intent-unreliable"
  | "no-measurable-objectives"
  | "interpreter-failed";

export type ObjectiveKind = "duration" | "zone-time" | "zone-emphasis" | "effort" | "structure" | "qualitative";

export interface StructuredIntent {
  primaryPurpose: string;
  phases: Array<{ description: string; kind: ObjectiveKind; durationMin?: number; targetZone?: string; targetWatts?: number }>;
}

export interface ScoredObjective {
  description: string;
  kind: ObjectiveKind;
  target: IntentTarget | null;
  zoneBasis: ZoneBasis;
  grounded: boolean;
  sourceText: string | null;
  measurable: boolean;
  scored: boolean;
  scopeMin: number | null;
  evidence: string | null;
}

export interface IntentInterpretation {
  intent: StructuredIntent;
  confidence: "high" | "medium" | "low";
  objectives: ScoredObjective[];
  model: string;
  promptVersion: number;
}

export interface IntentOverlay {
  id: string;
  activityId: string;
  date: string;
  noteFingerprint: string;
  status: "pending" | "active" | "disabled";
  origin: RideOrigin;
  effectiveExecutionScore: number | null;
  notScoredReason: NotScoredReason | null;
  interpretation: IntentInterpretation | null;
  scoringVersion: number | null;
  effectiveWorkoutType?: WorkoutType | null;
  schemaVersion: number;
  createdAt: string;
  approvedAt: string | null;
  supersededBy: string | null;
}

export interface EffectiveOutcome {
  effectiveExecutionScore: number | null;
  origin: RideOrigin;
  source: "overlay" | "ledger";
  overlay: IntentOverlay | null;
}

export interface RideScoreEntry {
  date: string;
  executionScore: number;
  planned: boolean;
  activityId?: string;
  // …unchanged fields elided
}
```

```ts
// lib/intent-overlay.ts
export function resolveEffectiveOutcome(
  entry: RideScoreEntry,
  byActivity: Map<string, IntentOverlay>,
  byDate: Map<string, IntentOverlay>
): EffectiveOutcome;
export function indexOverlaysByActivity(overlays: IntentOverlay[]): Map<string, IntentOverlay>;
export function indexOverlaysByDate(overlays: IntentOverlay[]): Map<string, IntentOverlay>;
```

## File structure

| File | Responsibility |
|---|---|
| `lib/types.ts` | **Modify.** Add `activityId?: string` to `TodayAnalysis`. |
| `lib/ride-analysis.ts` | **Modify.** Thread `activity.id` into the built `TodayAnalysis`. |
| `lib/ride-origin.ts` | **Modify.** Add `findLedgerEntry` — locate the `RideScoreEntry` matching a `TodayAnalysis`. |
| `lib/intent-display.ts` | **Create.** Pure formatting: `formatIntentUsed`, `notScoredMessage`, `confidenceCaption`, `AEROBIC_DRIFT_NOT_MEASURABLE`. No React, no fs. |
| `lib/intent-display.test.ts` | **Create.** Unit tests for the above. |
| `app/api/sync/route.ts` | **Modify.** Compute `todayOutcome` in `GET` and `POST` via the existing `scoreLog`/`intentStore`; add to both response objects. |
| `app/api/sync/route.test.ts` | **Modify.** New cases: active overlay surfaces, pending/superseded overlay does not, no ledger entry → `null`, ledger-fallback value matches `analysis.executionScore`. Also a fixture patch (Task 11, round 3 correction): its inline `ExecutedInterval` literals gain the three new required fields (null). |
| `components/SyncProvider.tsx` | **Modify.** Add `todayOutcome: EffectiveOutcome \| null` to `AppState`. |
| `components/dashboard/ride-intent.tsx` | **Create.** `RideIntentBlock` — the new debrief content (intent-used line, score/Not-scored, evidence, qualitative, aerobic-not-measurable). |
| `components/dashboard/ride-intent.test.tsx` | **Create.** Component tests (jsdom). |
| `components/dashboard/today.tsx` | **Modify.** `TodayRideCard` takes a new `outcome` prop, renders `RideIntentBlock` before the score, switches the score number to the effective score. |
| `components/dashboard/TodayView.tsx` | **Modify.** Pass `state.todayOutcome` to both `TodayRideCard` call sites. |
| `docs/INVARIANTS.md` | **Modify.** One new item (exact number resolved at write time) recording that the debrief must read the overlay-resolved score, never the raw ledger/analysis score, once an overlay applies. |
| `docs/systems/08-frontend.md` | **Modify.** Update the `Ride debrief` row of the Feature ownership table; note the new file in Known rough edges' size list. |
| `docs/systems/02-scoring-and-learning.md` | **Modify.** One line in Known rough edges cross-referencing this phase, continuing the existing "re-derive validity at each new read site" note; a second line from Task 9 recording the two PR #35 fixes. |
| `lib/score-log.ts` | **Modify (Task 8).** `summariseBehaviour`'s `driftScores` falls back to the ledger's own score instead of excluding a Not-scored drift ride. |
| `lib/intent-scoring.ts` | **Modify (Task 9, then Task 12).** `scoreIntentExecution` reclassifies a zero-objective note (Task 9); `matchLaps` gains a zone-only fallback level (Task 12, narrowed from the original order/gradient hierarchy — round 3 correction). |
| `lib/sync-analysis.ts` | **Modify (Task 10, round 2).** `addCoachNote` omits the auto-posted score line for an unplanned ride, so Intervals.icu never receives a number the in-app debrief has since overridden. |
| `lib/sync-analysis.test.ts` | **Modify (Task 10, round 2).** Cases for the unplanned-omits and prescribed-still-posts branches, plus the `addCoachNote` mock scaffolding itself (round 3 correction — none existed). |
| `lib/types.ts` | **Modify (Task 1; then Task 11, round 2).** `TodayAnalysis.activityId` (Task 1); `ExecutedInterval` gains `avgGradientPct`, `groupId`, `zone` (Task 11 — narrowed from five fields to three, `avgCadence`/`intensity` dropped as unconsumed, round 3 correction). |
| `lib/intervals-api.ts` | **Modify (Task 11, round 2).** `fetchIntervals`'s mapping reads the three new fields from the raw payload. |
| `lib/intervals-api.test.ts` | **Modify (Task 11, round 2).** Cases for all three fields present and all three absent. |
| `lib/intent-scoring.test.ts` | **Modify (Tasks 9 and 12).** Task 9's zero-objective test cases; Task 12's zone-only fallback tests. Also a fixture patch (Task 11, round 3 correction): the `lap()` helper gains the three new required `ExecutedInterval` fields (null). |
| `lib/durability-score.test.ts` | **Fixture patch (Task 11, round 3 correction).** `iv()` helper gains the three new required `ExecutedInterval` fields (null). |
| `lib/trace.test.ts` | **Fixture patch (Task 11, round 3 correction).** `work()` helper gains the three new required `ExecutedInterval` fields (null). |
| `lib/intent-runner.test.ts` | **Modify (Task 13, round 2).** Regression test: `force` re-analysis picks up curated intervals the athlete edited after the first parse, not stale evidence from the superseded overlay. |

---

## Task 0: Confirm Phase 2b is on `main`

**Files:** none (verification only).

- [ ] **Step 1: Verify the branch and types exist**

```bash
npm run sync
grep -n "notScoredReason" lib/types.ts
grep -n "export function resolveEffectiveOutcome" lib/intent-overlay.ts
```

Expected: both greps print a match. If either is empty, **stop** — Phase 2b has not merged yet. Do not
proceed; this plan's every subsequent task assumes 2b's types and `lib/intent-overlay.ts` are present
on `main`.

- [ ] **Step 2: Confirm the current INVARIANTS.md ceiling**

```bash
grep -n "^[0-9]\+\." docs/INVARIANTS.md | tail -1
```

Note the printed number — Task 6 appends the next one after it, not a hard-coded value.

---

## Task 1: Thread `activityId` onto `TodayAnalysis`

**Files:**
- Modify: `lib/types.ts` (`TodayAnalysis` interface, `lib/types.ts:1118`)
- Modify: `lib/ride-analysis.ts` (`buildTodayAnalysis`, `lib/ride-analysis.ts:151`)
- Test: `lib/ride-analysis.test.ts`

**Interfaces:**
- Produces: `TodayAnalysis.activityId?: string` — read by Task 3's `findLedgerEntry` and by nothing
  else in this plan.

- [ ] **Step 1: Write the failing test**

Find the existing `buildTodayAnalysis` test fixture in `lib/ride-analysis.test.ts` (it already
constructs a full `TodayAnalysisInputs` with an `activity` object — reuse that fixture's `activity.id`
value, whatever it is, in the assertion rather than hard-coding a new one) and add:

```ts
it("stamps the activity's own id onto the analysis", () => {
  const { todayAnalysis } = buildTodayAnalysis(baseInput);
  expect(todayAnalysis.activityId).toBe(baseInput.activity.id);
});
```

(`baseInput` — use whatever the file's existing shared fixture is named; grep the file for the first
`buildTodayAnalysis(` call to find it.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/ride-analysis.test.ts -t "stamps the activity's own id"
```

Expected: FAIL — `todayAnalysis.activityId` is `undefined`, not the expected id.

- [ ] **Step 3: Add the field to the type**

In `lib/types.ts`, inside `export interface TodayAnalysis {` (`lib/types.ts:1118`), add just above
`analysedAt: string;`:

```ts
  // Intervals.icu's own activity id — the join key intent-overlay resolution matches on
  // (lib/ride-origin.ts's findLedgerEntry). Optional: a record written before this field existed
  // parses back as undefined, not null — read sites must truthy-check, never `=== null`.
  activityId?: string;
```

- [ ] **Step 4: Thread it through the builder**

In `lib/ride-analysis.ts`, inside the `todayAnalysis: TodayAnalysis = {` object literal
(`lib/ride-analysis.ts:220`), add immediately after `activityDate: input.today,`:

```ts
    activityId: activity.id,
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run lib/ride-analysis.test.ts
```

Expected: PASS, full file green (no other test's snapshot of the `todayAnalysis` object should break —
if any test does an exact-shape `toEqual` against the full object rather than a subset, add
`activityId: expect.any(String)` or the fixture's own id to that expectation).

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/ride-analysis.ts lib/ride-analysis.test.ts
git commit -m "feat(today): stamp the activity id onto TodayAnalysis"
```

---

## Task 2: `findLedgerEntry` — locate today's ledger row

**Files:**
- Modify: `lib/ride-origin.ts`
- Test: `lib/ride-origin.test.ts`

**Interfaces:**
- Consumes: `RideScoreEntry[]` (unfiltered — legacy/compromised rows included; resolution doesn't care
  about either), `activityId: string | undefined`, `date: string`.
- Produces: `findLedgerEntry(entries, activityId, date): RideScoreEntry | null` — read by Task 3.

**Corrected 2026-08-12 (external review, independently verified against `lib/intent-overlay.ts:114-116`
before accepting): a present-but-unmatched `activityId` must return `null`, never fall back to date.**
`resolveEffectiveOutcome`'s own contract is `entry.activityId ? byActivity.get(entry.activityId) :
byDate.get(entry.date)` — a row carrying an id NEVER consults the date index, precisely because a
same-day secondary ride's overlay could otherwise bind to the wrong entry. `TodayAnalysis.activityId`
(Task 1) and the ledger's own primary-ride id are independently reachable: `TodayAnalysis`'s activity
is picked by `.find()` (first `Ride`/`VirtualRide` in sync order — `lib/sync-analysis.ts:51`,
`app/api/sync/route.ts:734`), while the ledger's is picked by `buildRideScores`'s "longest ride wins"
rule. On a genuine multi-ride date these two selections can diverge, and the original date-fallback
would then silently substitute a *different ride's* ledger row (and any overlay bound to it) for the
one `TodayAnalysis` was actually built from. The one legitimate fallback case — a legacy `TodayAnalysis`
record written before Task 1 shipped, carrying no `activityId` at all — is unaffected: `activityId ===
undefined` is falsy and still takes the date path below.

- [ ] **Step 1: Write the failing test**

Add to `lib/ride-origin.test.ts`:

```ts
import { findLedgerEntry } from "./ride-origin";

describe("findLedgerEntry", () => {
  const entry = (over: Partial<RideScoreEntry> = {}): RideScoreEntry => ({
    date: "2026-06-15",
    executionScore: 5,
    plannedType: null,
    inferredType: "Z2",
    planned: false,
    legacy: false,
    compliancePct: null,
    intensityFactor: 0.7,
    ftpUsed: 288,
    durationMin: 90,
    tss: 80,
    ...over,
  });

  it("matches by activityId first", () => {
    const a = entry({ activityId: "a1", date: "2026-06-14" });
    const b = entry({ activityId: "a2", date: "2026-06-15" });
    expect(findLedgerEntry([a, b], "a2", "2026-06-15")).toBe(b);
  });

  it("falls back to date when activityId is undefined (legacy TodayAnalysis record)", () => {
    const a = entry({ activityId: undefined, date: "2026-06-15" });
    expect(findLedgerEntry([a], undefined, "2026-06-15")).toBe(a);
  });

  it("returns null — NEVER falls back to date — when activityId is present but matches no entry", () => {
    // A same-day SECONDARY ride's ledger row must not be silently substituted for the primary ride
    // TodayAnalysis actually analysed. Mirrors resolveEffectiveOutcome's own id-present-never-date-
    // falls-back rule (lib/intent-overlay.ts) — this function must not diverge from that contract.
    const primary = entry({ activityId: "primary-ride", date: "2026-06-15" });
    const secondary = entry({ activityId: "secondary-ride", date: "2026-06-15", durationMin: 20 });
    expect(findLedgerEntry([primary, secondary], "missing-id", "2026-06-15")).toBeNull();
  });

  it("returns null when nothing matches either key", () => {
    const a = entry({ activityId: "a1", date: "2026-06-15" });
    expect(findLedgerEntry([a], "missing", "2026-06-16")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/ride-origin.test.ts -t "findLedgerEntry"
```

Expected: FAIL — `findLedgerEntry` is not exported.

- [ ] **Step 3: Implement it**

Add to `lib/ride-origin.ts`:

```ts
// Locates the ledger row a TodayAnalysis (or any single-ride read site) should resolve its overlay
// against. Mirrors resolveEffectiveOutcome's own contract (lib/intent-overlay.ts) exactly: a present
// activityId is authoritative and NEVER falls back to date, even on a miss — a same-day secondary
// ride's row must not be silently substituted for the one actually analysed. Date is consulted only
// when activityId is absent (a legacy TodayAnalysis record predating Task 1).
export function findLedgerEntry(
  entries: RideScoreEntry[],
  activityId: string | undefined,
  date: string
): RideScoreEntry | null {
  if (activityId) {
    return entries.find((e) => e.activityId === activityId) ?? null;
  }
  return entries.find((e) => e.date === date) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run lib/ride-origin.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ride-origin.ts lib/ride-origin.test.ts
git commit -m "feat(scoring): add findLedgerEntry to locate a single ride's ledger row"
```

---

## Task 3: Resolve `todayOutcome` server-side in `/api/sync`

**Files:**
- Modify: `app/api/sync/route.ts`
- Modify: `components/SyncProvider.tsx` (`AppState`, and Step 8 below — `runAnalysis`)
- Test: `app/api/sync/route.test.ts`

**Interfaces:**
- Consumes: `findLedgerEntry` (Task 2), `resolveEffectiveOutcome`/`indexOverlaysByActivity`/
  `indexOverlaysByDate` (`lib/intent-overlay.ts`, already on `main` per Task 0), the already-loaded
  `scoreLog`/`intentStore` local variables in both handlers.
- Produces: `todayOutcome: EffectiveOutcome | null` on both `GET` and `POST /api/sync` JSON responses,
  and on `AppState`. Read by Task 5.

**Corrected 2026-08-12 (external review): resolving `todayOutcome` server-side is necessary but not
sufficient — nothing currently causes the client to RE-FETCH it after Phase 2b's intent parser actually
writes an overlay.** Verified against the real, already-merged `components/SyncProvider.tsx:135-170`:
`runAnalysis` calls `/api/analyze`, then loops `/api/intent` up to 6 rounds, but never touches
`SYNC_QUERY_KEY` — the query `useQuery({ queryKey: SYNC_QUERY_KEY, ... })` binds to. A sync can complete
(and populate `todayOutcome` from whatever overlay state existed *before* parsing started) while the
overlay Phase 2b's parser writes moments later never reaches the UI until the athlete triggers another
full sync. Step 8 below closes this — it must land in the same commit as the rest of this task, since
`todayOutcome` is not actually usable without it.

- [ ] **Step 1: Write the failing tests**

Add to `app/api/sync/route.test.ts` (the file already mocks `readScoreLog`/`readIntentOverlays` — see
`beforeEach` around line 239-240):

```ts
describe("GET /api/sync — todayOutcome", () => {
  it("surfaces an active overlay for today's activity", async () => {
    scoreEntries = [
      {
        date: "2026-08-11",
        executionScore: 3,
        plannedType: null,
        inferredType: "Z2",
        planned: false,
        legacy: false,
        activityId: "act-1",
        compliancePct: null,
        intensityFactor: 0.7,
        ftpUsed: 280,
        durationMin: 90,
        tss: 70,
      },
    ];
    vi.mocked(store.readTodayAnalysis).mockResolvedValue({
      analysedAt: "2026-08-11T12:00:00.000Z",
      activityDate: "2026-08-11",
      activityId: "act-1",
      activityName: "Ride",
      activityDurationMin: 90,
      activityAvgWatts: null,
      activityNormalizedPower: null,
      activityMaxWatts: null,
      activityAvgHr: null,
      activityMaxHr: null,
      activityKj: null,
      activityBurnKcal: null,
      activityTrainingLoad: null,
      activityRpe: null,
      activityDecoupling: null,
      aerobicDiscipline: null,
      aerobicEffPct: null,
      activityDistanceMeters: null,
      plannedName: null,
      plannedType: null,
      plannedDurationMin: null,
      compliancePct: null,
      intensityFactor: 0.7,
      advisedIntakeKcal: null,
      advisedBaseKcal: null,
      advisedBufferKcal: null,
      advisedRideFuelKcal: null,
      activityDescription: "45 min Z2 then some climbing",
      powerZoneTimes: null,
      hrZoneTimes: null,
      powerZoneTopsPct: null,
      executionScore: 3,
      coachNote: "",
      intervalComparison: null,
      trace: null,
    } as never);
    vi.mocked(store.readIntentOverlays).mockResolvedValue({
      overlays: [
        {
          id: "ov-1",
          activityId: "act-1",
          date: "2026-08-11",
          noteFingerprint: "fp-1",
          status: "active",
          origin: "self-directed",
          effectiveExecutionScore: 8,
          notScoredReason: null,
          interpretation: {
            intent: { primaryPurpose: "endurance", phases: [] },
            confidence: "high",
            objectives: [],
            model: "claude-sonnet-4-6",
            promptVersion: 1,
          },
          scoringVersion: 1,
          schemaVersion: 1,
          createdAt: "2026-08-11T13:00:00.000Z",
          approvedAt: null,
          supersededBy: null,
        },
      ],
      updatedAt: "2026-08-11T13:00:00.000Z",
    });

    const res = await GET(new Request("http://localhost/api/sync"));
    const body = await res.json();
    expect(body.todayOutcome.source).toBe("overlay");
    expect(body.todayOutcome.effectiveExecutionScore).toBe(8);
    expect(body.todayOutcome.origin).toBe("self-directed");
  });

  it("does not surface a pending overlay — falls back to the ledger", async () => {
    scoreEntries = [
      {
        date: "2026-08-11",
        executionScore: 3,
        plannedType: null,
        inferredType: "Z2",
        planned: false,
        legacy: false,
        activityId: "act-1",
        compliancePct: null,
        intensityFactor: 0.7,
        ftpUsed: 280,
        durationMin: 90,
        tss: 70,
      },
    ];
    vi.mocked(store.readTodayAnalysis).mockResolvedValue({
      activityDate: "2026-08-11",
      activityId: "act-1",
      executionScore: 3,
    } as never);
    vi.mocked(store.readIntentOverlays).mockResolvedValue({
      overlays: [
        {
          id: "ov-1",
          activityId: "act-1",
          date: "2026-08-11",
          noteFingerprint: "fp-1",
          status: "pending",
          origin: "self-directed",
          effectiveExecutionScore: 9,
          notScoredReason: null,
          interpretation: null,
          scoringVersion: 1,
          schemaVersion: 1,
          createdAt: "2026-08-11T13:00:00.000Z",
          approvedAt: null,
          supersededBy: null,
        },
      ],
      updatedAt: "2026-08-11T13:00:00.000Z",
    });

    const res = await GET(new Request("http://localhost/api/sync"));
    const body = await res.json();
    expect(body.todayOutcome.source).toBe("ledger");
    expect(body.todayOutcome.effectiveExecutionScore).toBe(3);
  });

  it("is null when there is no today-analysis record", async () => {
    vi.mocked(store.readTodayAnalysis).mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/sync"));
    const body = await res.json();
    expect(body.todayOutcome).toBeNull();
  });

  // Corrected 2026-08-12 (external review): the three cases above leave three real gaps — the file
  // table's own promise ("active overlay surfaces, pending/superseded overlay does not, no ledger
  // entry → null, ledger-fallback value matches analysis.executionScore") was only half delivered.
  // "pending/superseded" tested only pending; "no ledger entry" tested only "no analysis record",
  // which is a different case from "analysis exists but nothing in the ledger matches it".

  it("is null when today-analysis exists but no ledger row matches it — NOT the same as no analysis record", async () => {
    scoreEntries = []; // the ledger has nothing for this date/activity at all
    vi.mocked(store.readTodayAnalysis).mockResolvedValue({
      activityDate: "2026-08-11",
      activityId: "act-1",
      executionScore: 3,
    } as never);
    vi.mocked(store.readIntentOverlays).mockResolvedValue({ overlays: [], updatedAt: "" });
    const res = await GET(new Request("http://localhost/api/sync"));
    const body = await res.json();
    expect(body.todayOutcome).toBeNull();
  });

  it("does not surface a SUPERSEDED overlay, even while its status still reads active — distinct from pending", async () => {
    // A genuinely different isApplicable branch (supersededBy !== null) than the "pending" case above
    // (status !== "active"). The two are independent gates and one passing tells you nothing about
    // the other — this is exactly the Phase 2a review lesson: a gate correct where its author was
    // looking, silently untested one path over.
    scoreEntries = [
      {
        date: "2026-08-11", executionScore: 3, plannedType: null, inferredType: "Z2", planned: false,
        legacy: false, activityId: "act-1", compliancePct: null, intensityFactor: 0.7, ftpUsed: 280,
        durationMin: 90, tss: 70,
      },
    ];
    vi.mocked(store.readTodayAnalysis).mockResolvedValue({
      activityDate: "2026-08-11", activityId: "act-1", executionScore: 3,
    } as never);
    vi.mocked(store.readIntentOverlays).mockResolvedValue({
      overlays: [
        {
          id: "ov-1", activityId: "act-1", date: "2026-08-11", noteFingerprint: "fp-1",
          status: "active", origin: "self-directed", effectiveExecutionScore: 9, notScoredReason: null,
          interpretation: null, scoringVersion: 1, schemaVersion: 1,
          createdAt: "2026-08-11T13:00:00.000Z", approvedAt: null,
          supersededBy: "ov-2", // superseded — must not apply, regardless of status
        },
      ],
      updatedAt: "2026-08-11T13:00:00.000Z",
    });
    const res = await GET(new Request("http://localhost/api/sync"));
    const body = await res.json();
    expect(body.todayOutcome.source).toBe("ledger");
    expect(body.todayOutcome.effectiveExecutionScore).toBe(3);
  });
});

describe("POST /api/sync — todayOutcome", () => {
  // Mirrors the GET describe block above at the one case most likely to diverge: GET and POST build
  // their response object literals independently (app/api/sync/route.ts's two separate handlers), so
  // a fix applied to one has no structural guarantee of reaching the other. The plan's own file-table
  // promise names "both GET and POST" explicitly — this is that promise, not a restatement of GET's
  // coverage under a different name.
  it("surfaces an active overlay for today's activity", async () => {
    scoreEntries = [
      {
        date: "2026-08-11", executionScore: 3, plannedType: null, inferredType: "Z2", planned: false,
        legacy: false, activityId: "act-1", compliancePct: null, intensityFactor: 0.7, ftpUsed: 280,
        durationMin: 90, tss: 70,
      },
    ];
    vi.mocked(store.readTodayAnalysis).mockResolvedValue({
      activityDate: "2026-08-11", activityId: "act-1", executionScore: 3,
    } as never);
    vi.mocked(store.readIntentOverlays).mockResolvedValue({
      overlays: [
        {
          id: "ov-1", activityId: "act-1", date: "2026-08-11", noteFingerprint: "fp-1",
          status: "active", origin: "self-directed", effectiveExecutionScore: 8, notScoredReason: null,
          interpretation: null, scoringVersion: 1, schemaVersion: 1,
          createdAt: "2026-08-11T13:00:00.000Z", approvedAt: null, supersededBy: null,
        },
      ],
      updatedAt: "2026-08-11T13:00:00.000Z",
    });
    // Reuse whatever minimal POST body/mocks the file's existing POST tests already establish (sync
    // settings, Intervals client, etc. — grep the file's other `await POST(` calls for the pattern
    // rather than reconstructing it here) so this test isolates the todayOutcome assertion only.
    const res = await POST(new Request("http://localhost/api/sync", { method: "POST", body: "{}" }));
    const body = await res.json();
    expect(body.todayOutcome.source).toBe("overlay");
    expect(body.todayOutcome.effectiveExecutionScore).toBe(8);
  });
});
```

(`scoreEntries` — reuse the file's existing shared mutable fixture the `readScoreLog` mock closes over;
grep the file's top-of-describe setup for its declaration rather than introducing a new one. The `POST`
describe block will need whatever additional store mocks the file's other POST tests already set up —
read one of those first rather than guessing at POST's full dependency list.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run app/api/sync/route.test.ts -t "todayOutcome"
```

Expected: FAIL — `body.todayOutcome` is `undefined` in all three cases.

- [ ] **Step 3: Implement the resolution**

Add the import at the top of `app/api/sync/route.ts`:

```ts
import { findLedgerEntry } from "@/lib/ride-origin";
import { indexOverlaysByActivity, indexOverlaysByDate, resolveEffectiveOutcome } from "@/lib/intent-overlay";
```

Add a small local helper near the top of the file (below the imports, above `GET`) — shared by both
handlers so the resolution logic exists exactly once:

```ts
function resolveTodayOutcome(
  todayAnalysis: TodayAnalysis | null,
  entries: RideScoreEntry[],
  overlays: IntentOverlay[]
): EffectiveOutcome | null {
  if (!todayAnalysis) return null;
  const entry = findLedgerEntry(entries, todayAnalysis.activityId, todayAnalysis.activityDate);
  if (!entry) return null;
  return resolveEffectiveOutcome(entry, indexOverlaysByActivity(overlays), indexOverlaysByDate(overlays));
}
```

(Add `TodayAnalysis`, `RideScoreEntry`, `IntentOverlay`, `EffectiveOutcome` to the file's existing
`from "@/lib/types"` import if any are missing — grep the current import list first.)

In `GET` (`app/api/sync/route.ts:181`), add one line to the response object, immediately after
`todayAnalysis,`:

```ts
    todayOutcome: resolveTodayOutcome(todayAnalysis, scoreLog.entries, intentStore.overlays),
```

In `POST`'s response (`app/api/sync/route.ts:1011`, the single-line object literal), insert
`todayOutcome: resolveTodayOutcome(todayAnalysis, scoreLog.entries, intentStore.overlays),`
immediately after `todayAnalysis,` in that same line. Confirm `intentStore` is in scope at that point
in `POST` — the `Ground truth` section above notes it's read again near line 721/957; use whichever
local binding is in scope at the return statement (grep the function for its nearest preceding
`readIntentOverlays()` call if the name differs from `intentStore`).

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run app/api/sync/route.test.ts
```

Expected: PASS, full file green.

- [ ] **Step 5: Add `todayOutcome` to `AppState`**

In `components/SyncProvider.tsx`, add to the `AppState` interface (`components/SyncProvider.tsx:23`),
immediately after `todayAnalysis: TodayAnalysis | null;`:

```ts
  // Phase 2c: today's overlay-resolved outcome (null score display is wrong without this — the
  // debrief must not fall back to TodayAnalysis.executionScore once a self-directed overlay applies).
  todayOutcome: EffectiveOutcome | null;
```

Add `EffectiveOutcome` to the file's existing `from "@/lib/types"` import.

- [ ] **Step 6: Run the full suite**

```bash
npx vitest run
```

Expected: PASS. (`SyncProvider`'s own component test may assert the full shape of the state object
built from a `GET`/`POST` response — if it does an exact-shape match, add `todayOutcome: null` to that
fixture's expected response.)

- [ ] **Step 7: Refetch `/api/sync` after the intent loop — closes the refresh race**

Without this, `todayOutcome` can go stale the moment Phase 2b's parser writes an overlay after this
sync's response was already rendered — see the note under Task 3's header. In
`components/SyncProvider.tsx`, `runAnalysis` (`:135`) already has `queryClient` in scope (it's a
dependency of `doSync` a few lines below) — add it to `runAnalysis`'s own closure and invalidate after
the intent loop, inside the same `finally` block that already resets `analyzingRef`:

```ts
  const runAnalysis = useCallback(async (force: boolean) => {
```

becomes (add `queryClient` to the existing deps array at the bottom of the callback):

```ts
  const runAnalysis = useCallback(async (force: boolean) => {
```

Inside the function, replace the existing `finally` block:

```ts
    } finally {
      setAnalyzing(false);
      analyzingRef.current = false;
    }
  }, [setState]);
```

with:

```ts
    } finally {
      // Phase 2c: an overlay this loop just wrote is invisible to the UI until /api/sync is
      // re-fetched — todayOutcome was resolved from whatever the store held BEFORE this loop ran.
      // Invalidating (not just marking stale) forces the refetch even if the athlete isn't looking at
      // a component that would otherwise trigger one on its own.
      await queryClient.invalidateQueries({ queryKey: SYNC_QUERY_KEY });
      setAnalyzing(false);
      analyzingRef.current = false;
    }
  }, [setState, queryClient]);
```

Applies identically whether `runAnalysis` was triggered by the automatic post-sync run (`force=false`,
from `doSync`) or the manual re-analyse action (`force=true`, from `reAnalyse`) — both paths share this
one callback, so no separate wiring is needed for either.

- [ ] **Step 8: Test the refetch**

Add to whichever test file already covers `SyncProvider`'s `runAnalysis`/`reAnalyse` behavior (grep for
an existing `describe` block exercising `/api/analyze` or `/api/intent` mocks — reuse its render/act
setup rather than inventing new scaffolding):

```tsx
it("invalidates the sync query after the intent loop, so a newly-written overlay becomes visible without another manual sync", async () => {
  // Arrange /api/intent to report one round with no more work, and spy on invalidateQueries.
  // Act: trigger runAnalysis (via the post-sync auto-run or reAnalyse). Assert invalidateQueries was
  // called with { queryKey: SYNC_QUERY_KEY } after the intent loop settles.
});
```

Run it:

```bash
npx vitest run components/SyncProvider.test.tsx -t "invalidates the sync query"
```

Expected: PASS once Step 7 lands; FAIL beforehand (the exact bug this step exists to close).

- [ ] **Step 9: Commit**

```bash
git add app/api/sync/route.ts app/api/sync/route.test.ts components/SyncProvider.tsx components/SyncProvider.test.tsx
git commit -m "feat(today): resolve today's overlay outcome server-side in /api/sync, and refetch it after intent parsing completes"
```

---

## Task 4: `lib/intent-display.ts` — pure formatting helpers

**Files:**
- Create: `lib/intent-display.ts`
- Test: `lib/intent-display.test.ts`

**Interfaces:**
- Produces: `formatIntentUsed(intent: StructuredIntent): string`,
  `notScoredMessage(reason: NotScoredReason): string`,
  `confidenceCaption(confidence: IntentInterpretation["confidence"]): string | null`,
  `AEROBIC_DRIFT_NOT_MEASURABLE: string`. Read by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `lib/intent-display.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AEROBIC_DRIFT_NOT_MEASURABLE, confidenceCaption, formatIntentUsed, notScoredMessage } from "./intent-display";
import type { NotScoredReason, StructuredIntent } from "./types";

describe("formatIntentUsed", () => {
  it("joins ordered phase descriptions with an arrow, matching design §12.2's example", () => {
    const intent: StructuredIntent = {
      primaryPurpose: "mixed endurance",
      phases: [
        { description: "45 min steady Z2", kind: "zone-time" },
        { description: "variable climbing", kind: "qualitative" },
        { description: "9 min around 292 W", kind: "effort" },
        { description: "descending practice", kind: "qualitative" },
      ],
    };
    expect(formatIntentUsed(intent)).toBe(
      "45 min steady Z2 → variable climbing → 9 min around 292 W → descending practice"
    );
  });

  it("returns just the primary purpose when there are no phases", () => {
    const intent: StructuredIntent = { primaryPurpose: "easy spin", phases: [] };
    expect(formatIntentUsed(intent)).toBe("easy spin");
  });
});

describe("notScoredMessage", () => {
  it.each<[NotScoredReason, string]>([
    ["no-intent-found", "Not scored — no intent found"],
    ["intent-unreliable", "Not scored — intent could not be determined reliably"],
    ["interpreter-failed", "Not scored — the ride note couldn't be parsed"],
    ["no-measurable-objectives", "Not scored — nothing measurable to verify"],
  ])("maps %s to its design-specified or plan-authored string", (reason, expected) => {
    expect(notScoredMessage(reason)).toBe(expected);
  });
});

describe("confidenceCaption", () => {
  it("returns the limited-basis caption for medium confidence", () => {
    expect(confidenceCaption("medium")).toBe(
      "Limited basis — only objectives directly supported by the note and data were scored."
    );
  });

  it("returns null for high and low confidence", () => {
    expect(confidenceCaption("high")).toBeNull();
    expect(confidenceCaption("low")).toBeNull();
  });
});

describe("AEROBIC_DRIFT_NOT_MEASURABLE", () => {
  it("matches design §7 step 5 verbatim", () => {
    expect(AEROBIC_DRIFT_NOT_MEASURABLE).toBe("Aerobic drift not measurable — no sufficiently steady aerobic segment");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/intent-display.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `lib/intent-display.ts`:

```ts
// Debrief copy for Phase 2b's intent overlay (Phase 2c). Design §13/§5.3 specify two of the four
// Not-scored strings verbatim; the other two, and the medium-confidence caption, are this file's own
// wording — Phase 2b's plan Handoff boundary is explicit that "the wording is 2c's; 2b ships the
// discriminator only." Pure string formatting, no React, so it's testable without jsdom.
import type { IntentInterpretation, NotScoredReason, StructuredIntent } from "./types";

export function formatIntentUsed(intent: StructuredIntent): string {
  if (intent.phases.length === 0) return intent.primaryPurpose;
  return intent.phases.map((p) => p.description).join(" → ");
}

const NOT_SCORED_MESSAGES: Record<NotScoredReason, string> = {
  "no-intent-found": "Not scored — no intent found",
  "intent-unreliable": "Not scored — intent could not be determined reliably",
  "interpreter-failed": "Not scored — the ride note couldn't be parsed",
  "no-measurable-objectives": "Not scored — nothing measurable to verify",
};

export function notScoredMessage(reason: NotScoredReason): string {
  return NOT_SCORED_MESSAGES[reason];
}

// Design §5.3: medium confidence still scores supported objectives — this is not a Not-scored state,
// it's a disclosure shown alongside a real number. High/low confidence need no caption: high is
// unqualified, low is already fully covered by the "intent-unreliable" Not-scored message.
export function confidenceCaption(confidence: IntentInterpretation["confidence"]): string | null {
  if (confidence !== "medium") return null;
  return "Limited basis — only objectives directly supported by the note and data were scored.";
}

// Design §7 step 5, verbatim. Segment-scoped drift (design §7 steps 2-4, "Aerobic drift 3.8% —
// opening 45-minute Z2 segment") is not implemented by any phase through 2c — this is the only
// aerobic-drift string a self-directed ride's debrief can show.
export const AEROBIC_DRIFT_NOT_MEASURABLE = "Aerobic drift not measurable — no sufficiently steady aerobic segment";
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/intent-display.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/intent-display.ts lib/intent-display.test.ts
git commit -m "feat(today): add debrief copy formatters for self-directed intent"
```

---

## Task 5: `RideIntentBlock` component

**Files:**
- Create: `components/dashboard/ride-intent.tsx`
- Test: `components/dashboard/ride-intent.test.tsx`

**Interfaces:**
- Consumes: `EffectiveOutcome` (Task 3's shape), `formatIntentUsed`/`notScoredMessage`/
  `confidenceCaption`/`AEROBIC_DRIFT_NOT_MEASURABLE` (Task 4).
- Produces: `RideIntentBlock({ outcome, activityDecoupling }: { outcome: EffectiveOutcome | null;
  activityDecoupling: number | null }): JSX.Element | null`. Read by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `components/dashboard/ride-intent.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RideIntentBlock } from "./ride-intent";
import type { EffectiveOutcome, IntentOverlay } from "@/lib/types";

const overlay = (over: Partial<IntentOverlay> = {}): IntentOverlay => ({
  id: "ov-1",
  activityId: "a1",
  date: "2026-08-11",
  noteFingerprint: "fp-1",
  status: "active",
  origin: "self-directed",
  effectiveExecutionScore: 8,
  notScoredReason: null,
  interpretation: {
    intent: {
      primaryPurpose: "mixed",
      phases: [
        { description: "45 min steady Z2", kind: "zone-time" },
        { description: "9 min around 292 W", kind: "effort" },
      ],
    },
    confidence: "high",
    objectives: [
      { description: "45 min Z2", kind: "zone-time", target: null, zoneBasis: "power", grounded: true, sourceText: "45 min Z2", measurable: true, scored: true, scopeMin: 45, evidence: "44 min in Z2" },
      { description: "descending practice", kind: "qualitative", target: null, zoneBasis: "unspecified", grounded: true, sourceText: "descending practice", measurable: false, scored: false, scopeMin: null, evidence: null },
    ],
    model: "claude-sonnet-4-6",
    promptVersion: 1,
  },
  scoringVersion: 1,
  schemaVersion: 1,
  createdAt: "2026-08-11T13:00:00.000Z",
  approvedAt: null,
  supersededBy: null,
  ...over,
});

const outcome = (over: Partial<EffectiveOutcome> = {}): EffectiveOutcome => ({
  effectiveExecutionScore: 8,
  origin: "self-directed",
  source: "overlay",
  overlay: overlay(),
  ...over,
});

describe("RideIntentBlock", () => {
  it("renders nothing for a prescribed ride (no overlay)", () => {
    const { container } = render(
      <RideIntentBlock outcome={{ effectiveExecutionScore: 6, origin: "prescribed", source: "ledger", overlay: null }} activityDecoupling={null} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no outcome at all", () => {
    const { container } = render(<RideIntentBlock outcome={null} activityDecoupling={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the intent-used line joining phases with an arrow", () => {
    render(<RideIntentBlock outcome={outcome()} activityDecoupling={null} />);
    expect(screen.getByText(/Intent used:/)).toBeInTheDocument();
    expect(screen.getByText(/45 min steady Z2 → 9 min around 292 W/)).toBeInTheDocument();
  });

  it("partitions objectives on measurable, not scored", () => {
    render(<RideIntentBlock outcome={outcome()} activityDecoupling={null} />);
    // measurable: true → evidence line
    expect(screen.getByText(/44 min in Z2/)).toBeInTheDocument();
    // measurable: false → acknowledged, not graded, no evidence claim
    expect(screen.getByText("descending practice")).toBeInTheDocument();
  });

  it("labels a qualitative objective explicitly, not just via italic styling", () => {
    // Corrected 2026-08-12 (external review): italic styling alone doesn't communicate the locked
    // "acknowledged but not graded" requirement — a screen reader gets no signal from font-style, and
    // a sighted athlete could easily read the item as simply un-evidenced rather than deliberately
    // ungraded. The label text itself must be present and queryable, not inferred from CSS.
    render(<RideIntentBlock outcome={outcome()} activityDecoupling={null} />);
    expect(screen.getByText(/Acknowledged, not graded:/)).toBeInTheDocument();
    expect(screen.getByText(/Acknowledged, not graded:.*descending practice/)).toBeInTheDocument();
  });

  it("shows the Not-scored message and suppresses any score when effectiveExecutionScore is null", () => {
    const notScored = outcome({
      effectiveExecutionScore: null,
      overlay: overlay({ effectiveExecutionScore: null, notScoredReason: "no-measurable-objectives" }),
    });
    render(<RideIntentBlock outcome={notScored} activityDecoupling={null} />);
    expect(screen.getByText("Not scored — nothing measurable to verify")).toBeInTheDocument();
  });

  it("does not render an intent-used line when interpretation is null (no-intent-found)", () => {
    const noIntent = outcome({
      effectiveExecutionScore: null,
      overlay: overlay({ effectiveExecutionScore: null, notScoredReason: "no-intent-found", interpretation: null }),
    });
    render(<RideIntentBlock outcome={noIntent} activityDecoupling={null} />);
    expect(screen.queryByText(/Intent used:/)).not.toBeInTheDocument();
    expect(screen.getByText("Not scored — no intent found")).toBeInTheDocument();
  });

  it("shows the medium-confidence caption alongside a real score", () => {
    const medium = outcome({ overlay: overlay({ interpretation: { ...overlay().interpretation!, confidence: "medium" } }) });
    render(<RideIntentBlock outcome={medium} activityDecoupling={null} />);
    expect(screen.getByText(/Limited basis/)).toBeInTheDocument();
  });

  it("shows the aerobic-drift-not-measurable line for a self-directed ride with no segment", () => {
    render(<RideIntentBlock outcome={outcome()} activityDecoupling={null} />);
    expect(screen.getByText("Aerobic drift not measurable — no sufficiently steady aerobic segment")).toBeInTheDocument();
  });

  it("does not show the aerobic-drift line when a decoupling value is present", () => {
    render(<RideIntentBlock outcome={outcome()} activityDecoupling={3.8} />);
    expect(screen.queryByText(/Aerobic drift not measurable/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run components/dashboard/ride-intent.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `components/dashboard/ride-intent.tsx`:

```tsx
"use client";
// Phase 2c: the self-directed debrief content design §12.2 requires, extracted as its own module
// rather than grown into today.tsx's TodayRideCard (already a flagged split candidate —
// docs/systems/08-frontend.md#known-rough-edges). Renders nothing for a prescribed ride or when no
// overlay applies — TodayRideCard's existing score display already covers that case unchanged.

import type { EffectiveOutcome } from "@/lib/types";
import { AEROBIC_DRIFT_NOT_MEASURABLE, confidenceCaption, formatIntentUsed, notScoredMessage } from "@/lib/intent-display";

export function RideIntentBlock({
  outcome,
  activityDecoupling,
}: {
  outcome: EffectiveOutcome | null;
  activityDecoupling: number | null;
}) {
  const overlay = outcome?.overlay ?? null;
  if (!overlay) return null;

  const interpretation = overlay.interpretation;
  const caption = interpretation ? confidenceCaption(interpretation.confidence) : null;
  const measurable = interpretation?.objectives.filter((o) => o.measurable) ?? [];
  const qualitative = interpretation?.objectives.filter((o) => !o.measurable) ?? [];

  return (
    <div className="mb-3 space-y-2 border-l-2 border-zinc-300 pl-3 dark:border-[#00d4ff]/30">
      {interpretation && (
        <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-300">
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">Intent used: </span>
          {formatIntentUsed(interpretation.intent)}
        </p>
      )}

      {overlay.notScoredReason && (
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{notScoredMessage(overlay.notScoredReason)}</p>
      )}

      {caption && <p className="text-[11px] italic text-zinc-500 dark:text-zinc-400">{caption}</p>}

      {measurable.length > 0 && (
        <ul className="space-y-0.5 text-xs text-zinc-600 dark:text-zinc-300">
          {measurable.map((o, i) => (
            <li key={i}>
              {o.description}
              {o.evidence && <span className="text-zinc-500 dark:text-zinc-400"> — {o.evidence}</span>}
            </li>
          ))}
        </ul>
      )}

      {qualitative.length > 0 && (
        <ul className="space-y-0.5 text-xs italic text-zinc-500 dark:text-zinc-400">
          {qualitative.map((o, i) => (
            // Corrected 2026-08-12: italic alone doesn't communicate "acknowledged but not graded" —
            // the label text carries the meaning, italic is styling on top of it, not instead of it.
            <li key={i}>
              <span className="font-medium not-italic">Acknowledged, not graded:</span> {o.description}
            </li>
          ))}
        </ul>
      )}

      {activityDecoupling == null && <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{AEROBIC_DRIFT_NOT_MEASURABLE}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run components/dashboard/ride-intent.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/ride-intent.tsx components/dashboard/ride-intent.test.tsx
git commit -m "feat(today): add RideIntentBlock for the self-directed debrief"
```

---

## Task 6: Wire `RideIntentBlock` into `TodayRideCard`; switch the score to the effective value

**Files:**
- Modify: `components/dashboard/today.tsx`
- Modify: `components/dashboard/TodayView.tsx`
- Test: `components/dashboard/today.test.tsx`

**Interfaces:**
- Consumes: `RideIntentBlock` (Task 5), `state.todayOutcome` (Task 3).
- Produces: `TodayRideCard`'s new `outcome?: EffectiveOutcome | null` prop.

- [ ] **Step 1: Write the failing tests**

Add to `components/dashboard/today.test.tsx` (the file already renders `TodayRideCard` with a base
`analysis` fixture — reuse it, grep the file for its name rather than inventing a new one):

```tsx
it("shows the effective (overlay) score instead of the analysis's own score once an overlay applies", () => {
  render(
    <TodayRideCard
      analysis={{ ...baseAnalysis, executionScore: 2 }}
      outcome={{
        effectiveExecutionScore: 8,
        origin: "self-directed",
        source: "overlay",
        overlay: {
          id: "ov-1", activityId: "a1", date: baseAnalysis.activityDate, noteFingerprint: "fp",
          status: "active", origin: "self-directed", effectiveExecutionScore: 8, notScoredReason: null,
          interpretation: { intent: { primaryPurpose: "endurance", phases: [] }, confidence: "high", objectives: [], model: "m", promptVersion: 1 },
          scoringVersion: 1, schemaVersion: 1, createdAt: "2026-08-11T00:00:00.000Z", approvedAt: null, supersededBy: null,
        },
      }}
    />
  );
  expect(screen.getByText("8")).toBeInTheDocument();
  expect(screen.queryByText("2")).not.toBeInTheDocument();
});

it("suppresses the score entirely when the overlay says Not scored", () => {
  render(
    <TodayRideCard
      analysis={{ ...baseAnalysis, executionScore: 2 }}
      outcome={{
        effectiveExecutionScore: null,
        origin: "unspecified",
        source: "overlay",
        overlay: {
          id: "ov-1", activityId: "a1", date: baseAnalysis.activityDate, noteFingerprint: "fp",
          status: "active", origin: "unspecified", effectiveExecutionScore: null,
          notScoredReason: "intent-unreliable",
          interpretation: { intent: { primaryPurpose: "endurance", phases: [] }, confidence: "low", objectives: [], model: "m", promptVersion: 1 },
          scoringVersion: null, schemaVersion: 1, createdAt: "2026-08-11T00:00:00.000Z", approvedAt: null, supersededBy: null,
        },
      }}
    />
  );
  expect(screen.queryByText("2")).not.toBeInTheDocument();
  expect(screen.getByText("Not scored — intent could not be determined reliably")).toBeInTheDocument();
});

it("renders exactly as before when outcome is null (backward compatible)", () => {
  render(<TodayRideCard analysis={{ ...baseAnalysis, executionScore: 5 }} outcome={null} />);
  expect(screen.getByText("5")).toBeInTheDocument();
});

it("keeps the analysis's own score when a ledger outcome resolved but NO overlay applies — the actual bug this guards", () => {
  // Corrected 2026-08-12 (external review). This is the one case none of the three tests above can
  // catch: `outcome` is non-null (a ledger row WAS found — resolveEffectiveOutcome returns a real
  // EffectiveOutcome for every matched row, prescribed rides included) but `outcome.overlay` is null,
  // meaning no overlay applies and `source: "ledger"`. The three tests above all happen to pass
  // whether displayScore gates on `outcome != null` OR `outcome?.overlay != null`, because either the
  // overlay exists (both gates agree) or outcome itself is null (both gates agree). This is the only
  // fixture that can tell the two conditions apart: deliberately mismatched scores, no overlay.
  render(
    <TodayRideCard
      analysis={{ ...baseAnalysis, executionScore: 7 }}
      outcome={{ effectiveExecutionScore: 3, origin: "prescribed", source: "ledger", overlay: null }}
    />
  );
  expect(screen.getByText("7")).toBeInTheDocument();
  expect(screen.queryByText("3")).not.toBeInTheDocument();
});

it("keeps the Post-to-Intervals.icu button visible for a Not-scored ride", () => {
  // Corrected 2026-08-12 (external review). The button lives inside the score's guard block in the
  // pre-2c code; naively reusing that same guard for displayScore would hide "Post to Intervals.icu"
  // whenever the ride is Not scored — which is now a materially more common state than before Phase
  // 2b (any self-directed ride with an empty/unreliable/unmeasurable note), not an edge case.
  render(
    <TodayRideCard
      analysis={{ ...baseAnalysis, executionScore: 2, coachNote: "Good effort out there." }}
      outcome={{
        effectiveExecutionScore: null,
        origin: "unspecified",
        source: "overlay",
        overlay: {
          id: "ov-1", activityId: "a1", date: baseAnalysis.activityDate, noteFingerprint: "fp",
          status: "active", origin: "unspecified", effectiveExecutionScore: null,
          notScoredReason: "intent-unreliable",
          interpretation: { intent: { primaryPurpose: "endurance", phases: [] }, confidence: "low", objectives: [], model: "m", promptVersion: 1 },
          scoringVersion: null, schemaVersion: 1, createdAt: "2026-08-11T00:00:00.000Z", approvedAt: null, supersededBy: null,
        },
      }}
      onPostNote={() => {}}
    />
  );
  expect(screen.queryByText("2")).not.toBeInTheDocument();
  expect(screen.getByTitle("Post coach note to Intervals.icu")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run components/dashboard/today.test.tsx
```

Expected: FAIL — `outcome` prop doesn't exist yet, score always reads `analysis.executionScore`.

- [ ] **Step 3: Implement**

In `components/dashboard/today.tsx`, add the import:

```ts
import { RideIntentBlock } from "./ride-intent";
```

Update `TodayRideCard`'s props (`components/dashboard/today.tsx:149-165`) — add `outcome` to the
destructure and its type:

```ts
export function TodayRideCard({
  analysis,
  outcome,
  onPostNote,
  notePosting,
  notePosted,
  notePostFailed,
  analyzing,
  onReAnalyse,
}: {
  analysis: TodayAnalysis;
  outcome?: EffectiveOutcome | null;
  onPostNote?: () => void;
  notePosting?: boolean;
  notePosted?: boolean;
  notePostFailed?: boolean;
  analyzing?: boolean;
  onReAnalyse?: () => void;
}) {
```

Add `EffectiveOutcome` to the file's `from "@/lib/types"` import.

Immediately before computing `metrics` (`components/dashboard/today.tsx:186`, right after the
`grossBurnKcal` comment block), add the resolved-score derivation:

```ts
  // Once an overlay APPLIES, its effective score (or Not-scored reason) is authoritative — the old
  // intrinsic scorer's analysis.executionScore must not leak through (design §14.1's "generic 2/10"
  // pathway this phase replaces). Gating on `outcome != null` instead of `outcome?.overlay != null`
  // was a real bug caught by external review (2026-08-12): resolveEffectiveOutcome returns a non-null
  // EffectiveOutcome for EVERY matched ledger row, prescribed rides included — `outcome` being present
  // means only "a ledger row was found," not "an overlay applies." The unfixed version would have
  // swapped in outcome.effectiveExecutionScore for a prescribed ride or an unplanned ride with no
  // overlay at all, the exact "wrong fallback" this phase's Global Constraints forbid.
  //
  // The condition is written inline (not through a separately-assigned boolean) so TypeScript narrows
  // `outcome` to non-null in the true branch — `outcome?.overlay != null` implies `outcome` itself is
  // non-null, and modern TS's optional-chain narrowing carries that through automatically here.
  const displayScore = outcome?.overlay != null ? outcome.effectiveExecutionScore : analysis.executionScore;
```

**Corrected 2026-08-12 (external review): the Post-to-Intervals.icu button must not disappear when
`displayScore` is null.** The pre-2c code nests the button inside the score's guard block — harmless
before this phase, since `analysis.executionScore` was rarely null for a ride with a coach note. It
stops being harmless once self-directed rides route through `displayScore`: a `Not scored` ride (now a
materially common state — any self-directed ride with an empty, unreliable, or unmeasurable note) would
silently lose its only way to post the coach note to Intervals.icu. Restructure so the outer block
renders whenever EITHER a score OR the button has something to show, and the score span is the part
gated internally:

Replace the score block (`components/dashboard/today.tsx:226-252`, from the `{analysis.executionScore
!= null && (` guard through that `<div>`'s closing `)}`) with:

```tsx
      {(displayScore != null || (onPostNote && analysis.coachNote)) && (
        <div className="flex items-center gap-3">
          {displayScore != null && (
            <>
              <span className="font-mono text-3xl font-bold leading-none text-zinc-800 dark:text-[#ff49c8]">
                {displayScore}
                <span className="font-sans text-sm font-normal text-zinc-500 dark:text-zinc-400">/10</span>
              </span>
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {executionScoreLabel(displayScore)}
              </span>
            </>
          )}
          {onPostNote && analysis.coachNote && (
```

(Leave the button itself — `<button onClick={onPostNote} ...>` through its closing `</button>` and the
`)}` that closes the `onPostNote && analysis.coachNote &&` block — completely unchanged; only the
wrapping guard and the score's own conditional changed. The button keeps its existing `ml-auto`, which
still pushes it right whether or not the score span rendered beside it.)

Add `<RideIntentBlock outcome={outcome ?? null} activityDecoupling={analysis.activityDecoupling} />`
immediately before that same `{(displayScore != null || (onPostNote && analysis.coachNote)) && (` block,
so the intent line renders before the score per design §12.2 ("Before the score explanation, show the
interpreted target").

In `components/dashboard/TodayView.tsx`, pass the new prop at both call sites. Line 168:

```tsx
            <TodayRideCard
              analysis={todayRide}
              outcome={state.todayOutcome}
              onPostNote={state.configured ? postNote : undefined}
```

Line 245:

```tsx
                  <TodayRideCard analysis={state.todayAnalysis} outcome={state.todayOutcome} />
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run components/dashboard/today.test.tsx components/dashboard/ride-intent.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run the full suite and typecheck**

```bash
npm test
npx tsc --noEmit
```

Expected: both green. `npx tsc --noEmit` in particular catches any other `TodayRideCard` call site
(there are exactly two, both just edited) or `AppState` shape assumption this task missed.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/today.tsx components/dashboard/TodayView.tsx components/dashboard/today.test.tsx
git commit -m "feat(today): render the self-directed intent block and effective score in the debrief"
```

---

## Task 7: Ledger-fallback consistency + real-data verification + docs

**Files:**
- Modify: `docs/INVARIANTS.md`
- Modify: `docs/systems/08-frontend.md`
- Modify: `docs/systems/02-scoring-and-learning.md`

**Interfaces:** none — documentation and one verification script, no source change.

- [ ] **Step 1: Verify the ledger-fallback score matches the analysis score in the common case**

This is the regression test proving Task 3's fallback branch (`outcome.overlay === null`) never
silently diverges from what the debrief showed before this phase — write it directly in
`app/api/sync/route.test.ts` next to Task 3's other `todayOutcome` cases:

```ts
it("ledger-fallback effectiveExecutionScore equals the analysis's own executionScore", async () => {
  scoreEntries = [
    {
      date: "2026-08-11", executionScore: 6, plannedType: "Z2", inferredType: "Z2", planned: true,
      legacy: false, activityId: "act-1", compliancePct: 95, intensityFactor: 0.68, ftpUsed: 280,
      durationMin: 90, tss: 62,
    },
  ];
  vi.mocked(store.readTodayAnalysis).mockResolvedValue({
    activityDate: "2026-08-11", activityId: "act-1", executionScore: 6,
  } as never);
  vi.mocked(store.readIntentOverlays).mockResolvedValue({ overlays: [], updatedAt: "" });

  const res = await GET(new Request("http://localhost/api/sync"));
  const body = await res.json();
  expect(body.todayOutcome.source).toBe("ledger");
  expect(body.todayOutcome.effectiveExecutionScore).toBe(body.todayAnalysis.executionScore);
});
```

Run it:

```bash
npx vitest run app/api/sync/route.test.ts -t "ledger-fallback"
```

Expected: PASS without any implementation change — this confirms Task 3's existing code already
satisfies this, it does not add new behavior. If it fails, that's a real bug in Task 3 to fix before
continuing.

- [ ] **Step 2: Real-data verification (offline, read-only)**

Follow the same pattern the Phase 1 plan used for its live-verification task — no calendar writes, no
Intervals.icu calls. From the primary checkout (not this worktree):

```bash
node -e "
const fs = require('fs');
const scoreLog = JSON.parse(fs.readFileSync('data/score-log.json', 'utf8'));
const overlays = JSON.parse(fs.readFileSync('data/intent-overlays.json', 'utf8'));
const activeOverlays = overlays.overlays.filter(o => o.status === 'active' && !o.supersededBy);
console.log('score-log entries:', scoreLog.entries.length);
console.log('active overlays:', activeOverlays.length);
for (const o of activeOverlays.slice(0, 3)) {
  console.log(JSON.stringify({ activityId: o.activityId, origin: o.origin, notScoredReason: o.notScoredReason, effectiveExecutionScore: o.effectiveExecutionScore, hasInterpretation: o.interpretation != null }, null, 2));
}
"
```

If `data/intent-overlays.json` doesn't exist yet or has zero active overlays (likely — Phase 2b's
parse queue only runs on future syncs after `autoFromDate`, per that plan's Task 0), this step has
nothing to inspect yet. Note that in the task's completion report rather than fabricating a result; the
component tests (Tasks 5-6) are the verification of correctness until a real overlay exists to inspect.
If overlays are present, confirm at least one `formatIntentUsed`/`notScoredMessage` output by hand
against the raw `interpretation`/`notScoredReason` to catch anything the synthetic test fixtures didn't
anticipate about real LLM output shape (e.g. an empty `phases[]` with a non-trivial `primaryPurpose`).

- [ ] **Step 3: Append the INVARIANTS.md item**

```bash
grep -n "^[0-9]\+\." docs/INVARIANTS.md | tail -1
```

Take the printed number, add 1, and append under the "Ride origin & intent overlays" section (the same
section Phase 2a's items 36-40 live in — this is a render-layer consequence of that same seam, not a
new section):

```markdown
{N}. **The debrief never displays the raw ledger/analysis score once an overlay applies.**
    `RideIntentBlock`/`TodayRideCard` (`components/dashboard/ride-intent.tsx`,
    `components/dashboard/today.tsx`) read `todayOutcome.effectiveExecutionScore` — resolved
    server-side by the same `resolveEffectiveOutcome` seam items 36-40 govern — never
    `TodayAnalysis.executionScore` directly once `todayOutcome.overlay` is non-null. The old
    intrinsic scorer's number is the exact "generic 2/10" pathway design §14.1 replaces; a future
    consumer of `TodayAnalysis` that reads `.executionScore` for display without checking
    `todayOutcome` first would silently reintroduce it.
```

- [ ] **Step 4: Update `docs/systems/08-frontend.md`**

In the Feature ownership table (`docs/systems/08-frontend.md:30`), change the `Ride debrief` row's
Components column from:

```
`dashboard/today.tsx` → `TodayRideCard`, `RideTrace`
```

to:

```
`dashboard/today.tsx` → `TodayRideCard`, `dashboard/ride-intent.tsx` → `RideIntentBlock`, `RideTrace`
```

In Known rough edges (`docs/systems/08-frontend.md:52`), update the `dashboard/today.tsx` line count
(re-measure — it grew again in this phase) and add a note that a second debrief file now exists
alongside it:

```bash
wc -l components/dashboard/today.tsx components/dashboard/ride-intent.tsx
```

Edit the line to read (with the real numbers from that command):

```markdown
- **Big files (split candidates, in order):** `dashboard/today.tsx` ({N} — `TodayRideCard` alone
  ~{M}), `AthleteProfileForm.tsx` (712, five distinct sections), `dashboard/plan.tsx` (604). Precedent
  for extraction: `SeasonSection` was already split out of the profile form; Phase 2c split
  `RideIntentBlock` out into `dashboard/ride-intent.tsx` rather than growing `TodayRideCard` further —
  follow that precedent for the next addition too, rather than reversing it.
```

- [ ] **Step 5: Update `docs/systems/02-scoring-and-learning.md`**

Find the "Known rough edges" bullet Phase 2a's review-lessons PR added (search for "re-derive every
validity guarantee" — it should be the most recent entry in that section). Add one sentence after it:

```markdown
  Phase 2c (the debrief UI) is the first render-layer consumer of `resolveEffectiveOutcome`'s output —
  it resolves fresh per `/api/sync` request rather than persisting the verdict into
  `today-analysis.json`, specifically because Phase 2b's intent parse is deferred/async and can
  complete after the day's analysis was last written.
```

- [ ] **Step 6: Run the full check**

```bash
npm run check
```

Expected: PASS (typecheck, lint, full test suite).

- [ ] **Step 7: Commit**

```bash
git add app/api/sync/route.test.ts docs/INVARIANTS.md docs/systems/08-frontend.md docs/systems/02-scoring-and-learning.md
git commit -m "docs(scoring): record the debrief's overlay-score invariant; verify against real data"
```

---

## Task 8: `driftAvgQuality` falls back to the ledger's own score (PR #35 finding N1)

**Status (2026-08-12, round 3): already shipped — verify only, do not re-implement.** This task's fix
landed via a separate branch, `claude/p2c-tasks-8-9-drift-fixes`, merged to `main` as commit `b184e95`
(PR #38) — an ancestor of this branch, merged before this branch's own round-2 amendment commit. The
code below and its test are already present and passing on this branch. Run
`npx vitest run lib/score-log.test.ts -t "falls back to the ledger's own score"` to confirm PASS, then
move on to Task 9 — do not write the test as failing-first or recommit unchanged code.

**Files:**
- Modify: `lib/score-log.ts` (`summariseBehaviour`, `lib/score-log.ts:394-408`)
- Test: `lib/score-log.test.ts`

**Interfaces:** none new — `summariseBehaviour(resolved: ResolvedRide[]): BehaviourSummary`'s
signature and `BehaviourSummary`'s shape are unchanged; only `driftAvgQuality`'s computed value changes.

**The bug, verified directly against the merged code (2026-08-12):** `resolveEffectiveOutcome`
(`lib/intent-overlay.ts:103-122`) returns the overlay's `effectiveExecutionScore` in place of the
ledger's own whenever an applicable overlay exists. For a drift ride whose overlay carries a
`notScoredReason` (an empty, unreliable, or failed-to-parse note — origin `unspecified`), that overlay
score is `null` — even though the ledger's own `entry.executionScore` (the deterministic intrinsic
scorer's output, computed at sync time regardless of intent parsing) is still a normal number.
`driftRides.map((r) => r.outcome.effectiveExecutionScore).filter((v): v is number => v !== null)`
excludes that ride from `driftAvgQuality`'s average entirely, rather than falling back to the ledger's
value. Since a self-directed-origin ride is already excluded from `driftRides` upstream (`countsAsDrift`
returns `false` for it), every ride that reaches this filter is `unspecified` — and as more of them
acquire a Not-scored overlay over time, `driftAvgQuality` trends toward permanently `null` with no
signal it ever carried a value.

**Already implemented** (`lib/score-log.ts:406`, verified on this branch, 2026-08-12):

```ts
  const driftScores = driftRides.map((r) => r.outcome.effectiveExecutionScore ?? r.entry.executionScore);
```

(`RideScoreEntry.executionScore` is `number`, never `null` or `undefined`, so every element of
`driftScores` is always a number — no filter needed.)

**Already present** (`lib/score-log.test.ts:933`):

```ts
it("falls back to the ledger's own score when the overlay is Not scored (PR #35 finding N1)", () => {
  const summary = summariseBehaviour([
    resolved(ride("2026-01-01"), "prescribed"),
    resolved(ride("2026-01-02", { planned: false, compliancePct: null, executionScore: 6 }), "unspecified", null),
  ]);
  expect(summary.driftAvgQuality).toBe(6);
});
```

- [ ] **Step 1: Confirm, don't recommit**

```bash
npx vitest run lib/score-log.test.ts
```

Expected: PASS, full file green, including the test above. No implementation step, no commit — this
task is complete history, not pending work.

---

## Task 9: A zero-objective note is `intent-unreliable`, not `no-measurable-objectives` (PR #35 finding N2)

**Status (2026-08-12, round 3): already shipped — verify only, do not re-implement.** Same history as
Task 8 — landed on `claude/p2c-tasks-8-9-drift-fixes`, merged `main` as `b184e95`/PR #38, an ancestor of
this branch. `docs/systems/02-scoring-and-learning.md`'s "Known rough edges" already documents this fix
(the "Two drift-signal defects found in PR #35's review" entry). Run
`npx vitest run lib/intent-scoring.test.ts -t "zero-objective vs. ungradable-objective"` to confirm PASS,
then move on to Task 10 — no doc edit, no commit, nothing to re-implement.

**Files:**
- Modify: `lib/intent-scoring.ts` (`scoreIntentExecution`, `lib/intent-scoring.ts:818-910`)
- Test: `lib/intent-scoring.test.ts`
- Modify: `docs/systems/02-scoring-and-learning.md` (Known rough edges — folds in this task's docs step)

**Interfaces:** none new — `scoreIntentExecution`'s signature and `IntentVerdict`'s shape are
unchanged; only `.reason`'s value changes for one previously-conflated input shape.
`assessScoreability`'s own signature and its existing tests are untouched — this task overrides its
result at the one call site, not the shared predicate function three other things might come to rely on.

**The bug, verified directly against the merged code (2026-08-12):** `assessScoreability`
(`lib/intent-scoring.ts:780-793`) returns `reason: "no-measurable-objectives"` whenever
`gradableCount < 1` — which conflates two different situations under one reason: (a) the note produced
real objectives that simply aren't verifiable from the ride's data (the reason's own documented
contract, `lib/types.ts`: "intent understood; nothing the ride data can verify"), and (b) the note
produced *zero* objectives at all — nothing was extracted in the first place. `buildOverlay`
(`lib/intent-scoring.ts:981-1013`) maps `no-measurable-objectives` to `origin: "self-directed"`
unconditionally, so case (b) — a note like *"felt good today, saw a hawk"* — gets classified
self-directed and stops counting toward `offPlanPct`, even though nothing about training intent was
actually recovered. This is reachable at real confidence tiers (not only `low`, which is already
diverted to `intent-unreliable` first): a `medium`- or `high`-confidence interpretation can still
legitimately extract zero objectives from a note with no trainable content.

**The fix:** at `scoreIntentExecution`'s one call site, override `no-measurable-objectives` to
`intent-unreliable` specifically when zero objectives were extracted (`interpretation.objectives.length
=== 0`) — leaving case (a), where real objectives exist but none are gradable or in-scope, as
`no-measurable-objectives`/self-directed exactly as before. `intent-unreliable` maps to `unspecified`
(`buildOverlay`'s `selfDirected` check only fires for `no-measurable-objectives`), matching design
§5.3's "Not scored — intent could not be determined reliably" — an accurate description of "nothing
usable was extracted," not just "confidence was rated low."

**Already implemented** (`lib/intent-scoring.ts:884`, verified on this branch, 2026-08-12) and already
present as tests (`lib/intent-scoring.test.ts:1335`, the full `describe("scoreIntentExecution —
zero-objective vs. ungradable-objective notes (PR #35 finding N2)", ...)` block with all three cases).
The "Known rough edges" doc entry from the original Step 5 is also already present.

- [ ] **Step 1: Confirm, don't recommit**

```bash
npx vitest run lib/intent-scoring.test.ts -t "zero-objective vs. ungradable-objective"
```

Expected: PASS, all three cases. No implementation step, no doc edit, no commit — this task is complete
history, not pending work.

---

## Amendment (2026-08-12, round 2)

Tasks 0-9 above (including their own "Amendment, post-merge" section) are unchanged by this second
amendment — same discipline as before: append dated tasks, never silently rewrite. This round folds in
two things found after Tasks 0-9 were written: **Task 10** is a fifth external-review finding (the
first four — the P1s corrected in place above — were bugs in Tasks 1-7's own not-yet-implemented text,
so those were fixed directly at the source; this one is a bug in already-shipped Phase 2b code this
plan's UI will make visibly worse, structurally identical to Tasks 8-9's own "found in review, fixed as
a new task" shape). **Tasks 11-14** are new scope — richer curated-interval data and smarter
intent-to-interval matching — requested directly by the user, verified against `main` and (where
marked) the live Intervals.icu API on 2026-08-12.

**Everything in Tasks 11-14 that cites the live API was verified in the conversation that produced this
amendment, not independently re-verified while writing it up — where a claim couldn't be checked
against static code, it's marked so a future implementer re-confirms rather than trusting it silently.**

## Task 10: Stop posting a score to Intervals.icu that the debrief no longer shows (external review, 2026-08-12)

**Files:**
- Modify: `lib/sync-analysis.ts` (`addCoachNote`)
- Test: `lib/sync-analysis.test.ts`

**Interfaces:** none new — `addCoachNote`'s signature is unchanged; only the auto-posted description
string's content changes for one case.

**The bug, verified directly against the merged code (2026-08-12):** `addCoachNote`
(`lib/sync-analysis.ts:95-101`) posts `updated.executionScore` — `TodayAnalysis`'s raw intrinsic
score — to Intervals.icu whenever `autoPostCoachNote` is on, unconditionally:

```ts
if (settings.autoPostCoachNote) {
  const scoreLine = updated.executionScore !== null ? `\nExecution score: ${updated.executionScore}/10` : "";
```

`/api/analyze` (which calls `addCoachNote`) runs BEFORE `/api/intent` in the same deferred
`runAnalysis` step (`components/SyncProvider.tsx:135-170`) — so at the moment this posts, Phase 2b's
intent parser has not run yet for a fresh sync, and even once it has, `addCoachNote` has no path back
to re-post. This plan's own Task 6 makes the in-app debrief show `todayOutcome.effectiveExecutionScore`
instead of the raw score whenever an overlay applies — so a self-directed ride can now show one number
in NodeVelo and a *different* number on Intervals.icu, permanently, for exactly the rides this whole
programme exists to score honestly. `plannedDay` (`lib/sync-analysis.ts:55`, already in scope at the
posting call site) tells the function whether the ride was prescribed — this is enough to fix the
inconsistency without threading the overlay-resolution seam into a route that Phase 2b's own Global
Constraints require to stay decoupled from `/api/intent`'s timing.

**The fix — minimal, not the "ideally" option:** for a ride with no `plannedDay` (unplanned — every
self-directed candidate, and the only population this bug affects, since a prescribed ride's ledger
score is never displaced by an overlay per decision #14), omit the score line entirely rather than post
a number that may be wrong. This is the repo's own established "better absent than wrong" convention
(the same one Phase 1 used for whole-ride decoupling on mixed rides). Reordering `/api/analyze` after
`/api/intent` so the posted note could use the resolved outcome — the "ideally" option raised in
review — is explicitly OUT of scope here: it touches two phases' sequencing and a coach-note prompt
Phase 2b's own Handoff boundary deliberately left untouched ("no task modifies `buildRideAnalysisPrompt`
or anything under `lib/anthropic-prompts.ts`"); reopening that boundary is a decision for whoever owns
Phase 2b's plan, not a side effect of this UI phase.

- [ ] **Step 1: Write the failing tests**

**Correction (2026-08-12, round 3):** `lib/sync-analysis.test.ts` currently has no `addCoachNote` test
scaffolding at all — it only tests `formatFuelPromptContext`. There is nothing to reuse; the mocks below
must be added fresh, following the same partial-mock + `as never` pattern already established in
`app/api/sync/route.test.ts` (e.g. `readAthleteProfile.mockResolvedValue(profile as never)`) for fixtures
that don't need every field of a large interface filled in.

Add to `lib/sync-analysis.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivitySummary, CurrentBlock, TodayAnalysis } from "./types";
import { DEFAULT_BLOCK_SETTINGS } from "./types";

vi.mock("./anthropic-api", async (orig) => {
  const actual = await orig<typeof import("./anthropic-api")>();
  return { ...actual, isAnthropicConfigured: vi.fn(), analyseRide: vi.fn() };
});
vi.mock("./intervals-api", () => ({ createEvent: vi.fn() }));
vi.mock("./data-store", () => ({
  readAthleteProfile: vi.fn(),
  readBlockSettings: vi.fn(),
  readCurrentBlock: vi.fn(),
  readLastSync: vi.fn(),
  readTodayAnalysis: vi.fn(),
  writeTodayAnalysis: vi.fn(),
}));

import * as anthropic from "./anthropic-api";
import * as api from "./intervals-api";
import * as store from "./data-store";
import { addCoachNote } from "./sync-analysis";

const TODAY = "2026-08-11";

const activity = (over: Partial<ActivitySummary> = {}): ActivitySummary =>
  ({
    id: "a1", date: TODAY, type: "Ride", name: "Morning Ride", movingTimeSec: 3600,
    avgWatts: 190, normalizedPower: 192, maxWatts: 400, icuFtp: null, avgHr: 155, maxHr: 172,
    kj: 700, activeBurnKcal: null, trainingLoad: 60, rpe: null, carbsIngestedG: null,
    decoupling: null, efficiencyFactor: null, powerHrZ2: null, powerHrZ2Mins: null,
    description: "solo ride", avgCadence: 88, distanceMeters: 30000, elevationGain: 300,
    powerZoneTimes: null, hrZoneTimes: null, hrrc: null, wPrimeRollingJ: null, wBalDepletionJ: null,
    ...over,
  }) as ActivitySummary;

const analysis = (over: Partial<TodayAnalysis> = {}) =>
  ({
    activityDate: TODAY, coachNote: null, executionScore: 2, activityName: "Morning Ride",
    powerZoneTimes: null, hrZoneTimes: null, intervalComparison: null, powerPRs: null,
    aerobicDiscipline: null, aerobicEffPct: null, fuelPrompt: null,
    ...over,
  }) as never as TodayAnalysis;

const profile = {
  performance: { ftp: 280, maxHr: 190, thresholdHr: 165, weightKg: 75, weeklyHoursMin: 6, weeklyHoursMax: 10 },
  goals: [], weakpoints: [],
  nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 75 },
  goalsMigratedAt: null, updatedAt: "",
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.readTodayAnalysis).mockResolvedValue(analysis());
  vi.mocked(store.readLastSync).mockResolvedValue({ activities: [activity()] } as never);
  vi.mocked(store.readCurrentBlock).mockResolvedValue(null);
  vi.mocked(store.readAthleteProfile).mockResolvedValue(profile);
  vi.mocked(store.readBlockSettings).mockResolvedValue({ ...DEFAULT_BLOCK_SETTINGS, autoPostCoachNote: true });
  vi.mocked(store.writeTodayAnalysis).mockResolvedValue(undefined as never);
  vi.mocked(anthropic.isAnthropicConfigured).mockReturnValue(true);
  vi.mocked(anthropic.analyseRide).mockResolvedValue("Solid session, nice work.");
  vi.mocked(api.createEvent).mockResolvedValue(null as never);
});

describe("addCoachNote — score-line posting (external review, 2026-08-12)", () => {
  it("omits the score line when posting for an UNPLANNED ride — the debrief may show a different, overlay-resolved number", async () => {
    await addCoachNote(TODAY, []);

    const [call] = vi.mocked(api.createEvent).mock.calls;
    expect(call[0].description).not.toContain("Execution score:");
  });

  it("still posts the score line for a PRESCRIBED ride — decision #14: a note never displaces a formal session's score", async () => {
    vi.mocked(store.readCurrentBlock).mockResolvedValue({
      goal: "Build", lengthWeeks: 4, startDate: TODAY, endDate: TODAY, overview: "", createdAt: TODAY,
      days: [{ date: TODAY, name: "Endurance", type: "Z2", durationMin: 90 }],
    } as CurrentBlock);

    await addCoachNote(TODAY, []);

    const [call] = vi.mocked(api.createEvent).mock.calls;
    expect(call[0].description).toContain("Execution score: 2/10");
  });
});
```

- [ ] **Step 2: Run tests to verify the first one fails**

```bash
npx vitest run lib/sync-analysis.test.ts -t "omits the score line"
```

Expected: FAIL — the current code posts the score line unconditionally.

- [ ] **Step 3: Implement**

In `lib/sync-analysis.ts`, replace the `scoreLine` computation (`:96`):

```ts
        const scoreLine = updated.executionScore !== null ? `\nExecution score: ${updated.executionScore}/10` : "";
```

with:

```ts
        // A prescribed ride's ledger score is never displaced by an overlay (decision #14) — safe to
        // post as-is. An UNPLANNED ride may acquire a Phase 2b overlay-resolved score that differs
        // from this raw intrinsic one, and /api/analyze runs before /api/intent parses it — post
        // nothing rather than a number the in-app debrief may soon disagree with (Phase 1's own
        // "better absent than wrong" convention; external review, 2026-08-12).
        const scoreLine =
          plannedDay && updated.executionScore !== null ? `\nExecution score: ${updated.executionScore}/10` : "";
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/sync-analysis.test.ts
```

Expected: PASS, full file green.

- [ ] **Step 5: Commit**

```bash
git add lib/sync-analysis.ts lib/sync-analysis.test.ts
git commit -m "fix(coach-note): stop posting a score to Intervals.icu the debrief may no longer show"
```

---

## Task 11: Enrich `ExecutedInterval` with fields Intervals.icu already returns

**Files:**
- Modify: `lib/types.ts` (`ExecutedInterval`)
- Modify: `lib/intervals-api.ts` (`fetchIntervals`)
- Test: `lib/intervals-api.test.ts`
- Fixture patch (external review, 2026-08-12 — see Step 5): `lib/durability-score.test.ts`,
  `lib/trace.test.ts`, `lib/intent-scoring.test.ts`, `app/api/sync/route.test.ts`

**Interfaces:**
- Produces: `ExecutedInterval` gains `avgGradientPct: number | null`, `groupId: string | null`,
  `zone: number | null`. Read by Task 12.

**Corrected 2026-08-12 (external review, before this task was implemented): dropped `avgCadence` and
`intensity`.** Both were mapped from the live API but had no consumer anywhere in Task 12's (also
corrected, see that task) matching hierarchy — speculative fields this repo's own convention (no
unused abstractions) argues against shipping. If a future task needs cadence or intensity data, add it
then, against a real consumer, not here against none.

**Locked product decision — do not reopen (user-confirmed):** for self-directed rides, the athlete's
own curated intervals in Intervals.icu are the authoritative execution boundaries.
- No distance/kilometre/GPS/position-locator system.
- No attempt to infer seated-vs-standing position.
- Preserve Intervals.icu's own interval order and curated grouping.
- Use only metrics already attached to each curated interval — nothing derived from raw stream data.
- A genuinely ambiguous intent-to-interval match stays ungraded — never guessed.

**Verified against `main` (2026-08-12):** `ExecutedInterval` (`lib/types.ts:398-406`) currently has only
`type`, `durationSec`, `avgWatts`, `npWatts`, `avgHr`, `startIndex`, `endIndex`. `fetchIntervals`'s
mapping (`lib/intervals-api.ts:186-207`) reads none of the three fields below from the raw payload.
**Also verified (external review, 2026-08-12): making these fields required (no `?`) breaks every
existing `ExecutedInterval`-typed literal outside this task's own files** — `lib/durability-score.test.ts:7`'s
`iv()` helper, `lib/trace.test.ts`'s `work()` helper, `lib/intent-scoring.test.ts`'s `lap()` helper, and
inline literals in `app/api/sync/route.test.ts` (e.g. `:951`) all construct the current 7-field shape
only. Step 5 below patches all four.

**Verified against the live Intervals.icu API, 2026-08-12** (activity `i174624272`, one curated `WORK`
interval — this specific data point was pulled live in the conversation that produced this amendment;
re-confirm before relying on exact field names if the implementing session can't see that history): the
raw response already includes `average_gradient` (a ratio — `0.07907035` = 7.91%), `zone` (plain int),
and `group_id` (a string shared by repeated efforts — three short efforts on that ride all carried
`group_id: "237s@267w80rpm"`). **`group_id`'s exact semantics are not fully confirmed** — it reads like
a nominal target/template string Intervals.icu assigns per repeat group, but whether it's
athlete-authored or derived from the first rep needs confirming (e.g. against a second real multi-rep
ride, or Intervals.icu's own API docs if published) before Task 12 leans on it for anything beyond
display/grouping — Task 12's matching hierarchy already treats it as the *weakest* signal for exactly
this reason.

- [ ] **Step 1: Write the failing test**

Add to `lib/intervals-api.test.ts` (extend the existing `fetchIntervals` test's mocked raw payload
rather than constructing a new one — grep the file for its current mock shape first):

```ts
it("maps the three newly-added interval fields", async () => {
  // raw payload includes average_gradient: 0.07907035, zone: 4, group_id: "237s@267w80rpm"
  const [interval] = await fetchIntervals("act-1");
  expect(interval.avgGradientPct).toBeCloseTo(7.907, 2);
  expect(interval.zone).toBe(4);
  expect(interval.groupId).toBe("237s@267w80rpm");
});

it("maps all three to null when the raw payload omits them", async () => {
  // raw payload has none of the three keys
  const [interval] = await fetchIntervals("act-1");
  expect(interval.avgGradientPct).toBeNull();
  expect(interval.zone).toBeNull();
  expect(interval.groupId).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/intervals-api.test.ts -t "maps the three newly-added"
```

Expected: FAIL — the three fields don't exist on the mapped object.

- [ ] **Step 3: Add the fields to the type**

In `lib/types.ts`, inside `ExecutedInterval` (`:398-406`), add after `endIndex: number | null;`:

```ts
  // Curated-interval context Intervals.icu already returns per rep, unused until Task 12's matching
  // hierarchy needs it. Gradient converted to a percentage exactly once, here — never re-derived
  // downstream. No distance/GPS/position field is added; see this amendment's locked decision.
  avgGradientPct: number | null;
  // Shared by repeated efforts in one curated set (e.g. three reps of "237s@267w80rpm" all carry the
  // same string) — semantics not fully confirmed beyond that grouping behavior; treat as the weakest
  // matching signal (Task 12), never authoritative on its own.
  groupId: string | null;
  zone: number | null;
```

- [ ] **Step 4: Thread the mapping through**

In `lib/intervals-api.ts`'s `fetchIntervals` (`:192-203`), add to the mapped object literal, after
`endIndex: num(iv.end_index),`:

```ts
        avgGradientPct: (() => { const g = num(iv.average_gradient); return g === null ? null : g * 100; })(),
        groupId: typeof iv.group_id === "string" && iv.group_id ? iv.group_id : null,
        zone: num(iv.zone),
```

- [ ] **Step 5: Patch existing `ExecutedInterval` fixtures (external review, 2026-08-12)**

Each of these constructs `ExecutedInterval`-typed literals with the pre-Task-11 7-field shape; add the
three new fields (null is fine — none of these tests exercise gradient/zone/group matching) so they
still typecheck:

`lib/durability-score.test.ts:7-9` — add to the `iv()` base literal:

```ts
const iv = (over: Partial<ExecutedInterval>): ExecutedInterval => ({
  type: "WORK", durationSec: 0, avgWatts: null, npWatts: null, avgHr: null, startIndex: null, endIndex: null,
  avgGradientPct: null, groupId: null, zone: null, ...over,
});
```

`lib/trace.test.ts` — same pattern: add `avgGradientPct: null, groupId: null, zone: null,` to the
`work()` helper's base literal.

`lib/intent-scoring.test.ts` — same pattern: add the three fields to the `lap()` helper's base literal.

`app/api/sync/route.test.ts` (e.g. `:951-953`, `:1011`, `:1175-1177`, `:1204-1206`) — these are inline
literals, not a shared helper; add `avgGradientPct: null, groupId: null, zone: null` to each one.

- [ ] **Step 6: Run tests to verify they pass, then the full check**

```bash
npx vitest run lib/intervals-api.test.ts lib/durability-score.test.ts lib/trace.test.ts lib/intent-scoring.test.ts app/api/sync/route.test.ts && npm run check
```

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/intervals-api.ts lib/intervals-api.test.ts lib/durability-score.test.ts lib/trace.test.ts lib/intent-scoring.test.ts app/api/sync/route.test.ts
git commit -m "feat(intervals): map gradient, zone and group id onto ExecutedInterval"
```

---

## Task 12: Smarter intent-to-curated-interval matching

**Files:**
- Modify: `lib/intent-scoring.ts` (`matchLaps` and its callers)
- Test: `lib/intent-scoring.test.ts`

**Interfaces:**
- Consumes: the three fields Task 11 adds to `ExecutedInterval` (`avgGradientPct`, `groupId`, `zone`).
- Produces: `matchLaps`'s matching behavior extends; no signature change to its existing 3-argument
  shape (target, laps, resolvedWatts) — the additional hierarchy level is internal.

**Corrected 2026-08-12 (external review, before this task was implemented) — [P0, blocking]: the
original hierarchy's levels 2 and 3 could not reach the inputs they described, and were dropped.**
`IntentTarget` (`lib/types.ts:681`) is the ONLY thing `matchLaps` receives about what the note asked
for, and it carries just `durationMin?`, `watts?`, `targetPctFtp?`, `zone?: string`, `reps?` — no HR
field, no gradient field, no ordinal/phase-link field. `StructuredIntent.phases[]` (`lib/types.ts:693`)
exists but has no field linking a phase entry back to the `ScoredObjective` matchLaps is grading, and
carries no gradient either. Concretely: there was never a `target.avgGradientPct` or `target.hrTarget`
for level 2 to compare against a curated interval's `avgGradientPct`/HR, and no ordinal index for level
3 to compare against `startIndex`. The original level-2 example test's own fixture proved this by
accident — it set `target: { zone: "Z4" }` (zone only) but titled itself a "zone + gradient" match; there
was no gradient anywhere in the target to match on. **Fix chosen: narrow the hierarchy to what the
schema already carries (duration+power, then zone alone), rather than extending `IntentTarget` and the
Phase-2b parser schema/prompt that populates it** (`lib/intent-schema.ts`, `lib/intent-prompt.ts`) —
reopening Phase 2b's parser surface is a decision for whoever owns that plan, the same boundary Task 10
already respects for `buildRideAnalysisPrompt`. An objective that only names a gradient, HR, or ordinal
reference ("the steep climb", "the second effort") has no matching key under either level and correctly
falls through to "ungraded, never guessed" — which is the locked decision anyway, so nothing about this
narrowing is a new risk, only a smaller hierarchy that matches what can actually be evaluated.

**Verified against `main` (2026-08-12):** matching lives in `matchLaps` (`lib/intent-scoring.ts:512-529`)
— candidates within ±20% (`LAP_DURATION_TOLERANCE`, `:79`) of the stated duration, ranked by closeness
to resolved watts (or duration alone with no resolved wattage). This already handles an objective with
an explicit duration and power/percentage target — the strongest case — but has no fallback when a
target has no explicit duration at all: `gradeDuration`/the effort grader return `ungraded("no duration
stated...")` for those (`lib/intent-scoring.ts:558` on) rather than attempting any other match. Zone
parsing already exists (`zoneIndex`, `lib/intent-scoring.ts:196` — 0-based, e.g. `"Z4"` → `3`); the live
API's `zone` field is a plain 1-based int (`zone: 4` means Z4), so the new level compares
`zoneIndex(target.zone) + 1 === lap.zone`.

**Required hierarchy** (strongest to weakest; fall to the next level only when the current one can't
resolve a match — never blend levels for one objective):

1. **Explicit duration + power/percentage target** — current behavior, unchanged, remains strongest.
2. **Explicit power-zone constraint alone** (needs Task 11's `zone` field) — an objective whose note
   said "zone 4 effort" with no stated duration matches against a curated interval's own `zone` instead.
   If more than one curated interval shares that zone, there is no second signal to break the tie (no
   duration/watts was stated) — falls straight to level 3, never picks the closest by an unstated axis.
3. **Remaining ambiguity → ungraded, never guessed** — the locked decision from Task 11, applied here:
   if no candidate remains after level 1-2, or more than one remains plausible at level 2, the objective
   stays `measurable: true, scored: false` with an evidence string naming the ambiguity, not a
   best-effort pick. An objective whose only stated constraint is gradient, HR, or an ordinal phase
   reference lands here directly — there is no level for it to match at (see the Correction above).

**Additional rules:**
- Efforts sharing a `groupId` are presented as one repeated set (e.g. "3 × ~237s @ ~267W"), not graded
  as N unrelated objectives — this applies to laps level 1 or 2 already matched (typically via an
  explicit `reps` target), grouping them for EVIDENCE PRESENTATION only; `groupId` is not itself a
  matching key and never substitutes for level 1/2 resolving the match. Canonicalisation-adjacent to how
  `lib/intent-scoring.ts`'s existing `identityKey`/`mergeKey` already dedupe/merge stated objectives, but
  keep the two concerns in separate code — don't extend the existing canonicalisation keys to cover this.
- Gradient is terrain CONTEXT for an already-matched effort (useful in the evidence string — "9 min at
  289W on a 7.9% climb"), never itself proof of execution quality, and never a matching key — it must
  not introduce a new scoring axis or change which lap(s) are selected.
- Seated/standing transitions and cornering/braking technique stay `qualitative`/unscored exactly as
  today — there is no sensor evidence for either, and none of Task 11's new fields changes that.

- [ ] **Step 1: Write the failing tests**

Add to `lib/intent-scoring.test.ts`, near the existing `matchLaps` tests (`lap()`'s base literal already
has `avgGradientPct`/`groupId`/`zone` defaulted to `null` per Task 11's Step 5 patch — override per-lap
with a spread, e.g. `{ ...lap(600, 220), zone: 4 }`):

```ts
describe("matchLaps — zone-only fallback (narrowed hierarchy, external review 2026-08-12)", () => {
  it("matches on zone alone when the target has no explicit duration", () => {
    const target: IntentTarget = { zone: "Z4" };
    const candidate = { ...lap(600, 220), zone: 4 };
    const other = { ...lap(600, 220), zone: 2 };
    expect(matchLaps(target, [other, candidate], null)).toEqual([candidate]);
  });

  it("stays ungraded on a gradient/ordinal-only reference — no matching key exists for either", () => {
    // "the steep climb" / "the second effort" carry no field IntentTarget can express (see this task's
    // Correction) — matchLaps has nothing to compare against and must not guess.
    const target: IntentTarget = {};
    const laps = [lap(600, 220), lap(700, 240)];
    expect(matchLaps(target, laps, null)).toEqual([]);
  });

  it("groups efforts sharing a groupId into one presented set, not N separate objectives", () => {
    const target: IntentTarget = { durationMin: 4, watts: 267, reps: 3 };
    const laps = [
      { ...lap(237, 265), groupId: "237s@267w80rpm" },
      { ...lap(237, 268), groupId: "237s@267w80rpm" },
      { ...lap(237, 270), groupId: "237s@267w80rpm" },
    ];
    const matched = matchLaps(target, laps, 267);
    expect(matched).toHaveLength(3);
    expect(new Set(matched.map((m) => m.groupId))).toEqual(new Set(["237s@267w80rpm"]));
  });

  it("stays ungraded when multiple zone-only candidates remain plausible — never guesses", () => {
    const target: IntentTarget = { zone: "Z4" };
    const a = { ...lap(600, 220), zone: 4 };
    const b = { ...lap(900, 230), zone: 4 };
    expect(matchLaps(target, [a, b], null)).toEqual([]);
  });

  it("never introduces a gradient-based scoring axis — gradient is evidence text only", () => {
    const target: IntentTarget = { durationMin: 10, watts: 250, reps: 1 };
    const steep = { ...lap(600, 250), avgGradientPct: 7.9 };
    const flat = { ...steep, avgGradientPct: 0.5 };
    expect(matchLaps(target, [steep], 250)).toEqual([steep]);
    expect(matchLaps(target, [flat], 250)).toEqual([flat]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/intent-scoring.test.ts -t "zone-only fallback"
```

Expected: FAIL on the zone-matching and ambiguity tests (the fallback level doesn't exist yet); the
groupId and gradient tests may already pass by construction (level 1 already ranks by watts and never
reads `avgGradientPct`) — confirm which, don't assume.

- [ ] **Step 3: Implement the zone-only fallback**

Extend `matchLaps` (or add a sibling function it delegates to when level 1 finds nothing, following
whatever decomposition keeps each level independently testable — mirror Task 4 of the Phase 2b plan's
own precedent of one named function per concern rather than one large conditional): when
`target.durationMin` is absent but `target.zone` is present, filter `laps` to those whose `zone` equals
`zoneIndex(target.zone) + 1`; return the match only if exactly one candidate remains, `[]` otherwise
(ambiguous → the caller's existing `ungraded` path already handles an empty match, no new "ambiguous"
return shape needed). Level 2 must not silently fall through to level 1's duration-based ranking by
accident — pin this with the "stays ungraded" tests above before considering the task done.

- [ ] **Step 4: Run tests to verify they pass, then the full check**

```bash
npx vitest run lib/intent-scoring.test.ts && npm run check
```

- [ ] **Step 5: Commit**

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "feat(scoring): match intent to curated intervals by zone alone, never by guessing"
```

---

## Task 13: Force re-analysis regression test — changed curated intervals

**Files:**
- Test only: `lib/intent-runner.test.ts`

**Interfaces:** none new — this task adds coverage, no production code changes.

**Verified against `main` (2026-08-12):** `force` is already tested at the boundary/gating level —
`autoFromDate` still refuses to write anything even with `force: true`, and a prescribed ride is never
written even with `force: true` (`lib/intent-runner.test.ts:232-280`). `fetchIntervals` is called fresh
on every run with no caching (`lib/intent-runner.ts:91`, `.catch(() => [])`), so a `force`-triggered
re-run should already pick up new laps mechanically — but nothing proves this end-to-end, and a search
of the test file for a two-call sequence with differing `fetchIntervals` mock returns found none.

- [ ] **Step 1: Write the failing test**

The file's default `interpretation()` fixture uses an objective of `kind: "duration"`, which grades
against the whole ride's `evidence.durationMin` and never calls `matchLaps` (`gradeDuration`,
`lib/intent-scoring.ts:558`, reads no laps at all). To actually exercise the `fetchIntervals` → laps →
`matchLaps` path, this test needs a `kind: "effort"` objective with a duration+watts target instead —
build it locally by overriding the shared fixture rather than changing its default (other tests in this
file rely on the `"duration"` default).

```ts
it("force re-analysis picks up curated intervals the athlete edited after the first parse", async () => {
  const effortInterpretation: IntentInterpretation = {
    ...interpretation(),
    intent: {
      primaryPurpose: "10 min effort",
      phases: [{ description: "10 min at 250W", kind: "effort", durationMin: 10, targetWatts: 250 }],
    },
    objectives: [
      {
        description: "10 min at 250W",
        kind: "effort",
        target: { durationMin: 10, watts: 250, reps: 1 },
        zoneBasis: "unspecified",
        grounded: true,
        sourceText: "10 min at 250W",
        measurable: false,
        scored: false,
        scopeMin: null,
        evidence: null,
      },
    ],
  };

  // Task 11's three new fields are required on ExecutedInterval — null is fine, this test doesn't
  // exercise zone/gradient/group matching.
  const curatedLap = (avgWatts: number) => ({
    type: "WORK", durationSec: 600, avgWatts, npWatts: avgWatts, avgHr: null,
    startIndex: 0, endIndex: 600, avgGradientPct: null, groupId: null, zone: null,
  });

  vi.mocked(anthropic.parseRideIntent).mockResolvedValue(effortInterpretation);
  vi.mocked(intervals.fetchIntervals).mockResolvedValueOnce([curatedLap(250)]);
  await runIntentParsing(TODAY, [], { force: true });

  const first = overlayStore.overlays.find((o) => o.supersededBy === null);
  expect(first?.interpretation?.objectives[0].evidence).toContain("at 250 W vs");

  // Athlete edits their curated intervals in Intervals.icu (same note, no fingerprint change) — force
  // re-analysis must pick up the NEW laps, not silently reuse the first run's stale match.
  vi.mocked(anthropic.parseRideIntent).mockResolvedValue(effortInterpretation);
  vi.mocked(intervals.fetchIntervals).mockResolvedValueOnce([curatedLap(200)]);
  await runIntentParsing(TODAY, [], { force: true });

  const active = overlayStore.overlays.filter((o) => o.supersededBy === null);
  expect(active).toHaveLength(1);
  expect(active[0].interpretation?.objectives[0].evidence).toContain("at 200 W vs");
  expect(active[0].interpretation?.objectives[0].evidence).not.toContain("at 250 W vs");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/intent-runner.test.ts -t "force re-analysis picks up curated intervals"
```

Expected: PASS or FAIL depending on whether the mechanism already works as designed — per the Ground
truth above, no code change is anticipated; if it fails, that is a real gap in the runner to fix before
continuing, not a test to loosen.

- [ ] **Step 3: Commit**

```bash
git add lib/intent-runner.test.ts
git commit -m "test(scoring): prove force re-analysis picks up edited curated intervals"
```

---

## Task 14: Live smoke test — the real mixed-effort ride

**Files:** none — verification only, per AGENTS.md's "LLM-backed paths need one live smoke run".

**Corrected 2026-08-12 (external review): this is a regression smoke for the changed matching path, not
the pipeline's first live run.** `docs/systems/02-scoring-and-learning.md`'s "Known rough edges" already
records three live-smoke overlays run against the real intent-parsing/scoring pipeline during Phase 2b
(sample reads moved from EWMA 6.7/50%/5.0 to 29/5.5/46%/5.3) — the pipeline itself has been live-tested.
What hasn't: Tasks 11-13's new zone-fallback matching and `groupId` grouping, which didn't exist at
Phase 2b's smoke run. Run the real pipeline against activity `i174624272` (2026-08-11 — note text and
curated-interval data already pulled live in the conversation that produced this amendment) and confirm,
reading actual output rather than asserting a hard-coded expected score:

- Both described effort blocks survive parsing intact (not just the first — the original 400-char
  coach-note truncation bug's exact failure mode; already fixed for the coach-note prompt via
  `INTENT_NOTE_MAX_CHARS`, worth reconfirming here against this specific note too).
- The 20-min climb (`1200s @ 289W / NP 293 / HR 175 / grad 7.91%` — this exact figure set was read live
  in the conversation that produced this amendment; re-pull from the API rather than trusting it stale)
  matches to its intended objective via Task 12's level 1 (explicit duration + power) — gradient (7.91%)
  should appear only in the evidence STRING as terrain context, per Task 12's narrowed hierarchy, never
  as a separate matching signal or a second scoring axis.
- The three short efforts sharing `groupId: "237s@267w80rpm"` are recognizable as one repeated set, not
  three independent grades.
- Seated/standing, technical descending, and breathing-technique objectives are acknowledged but stay
  unscored — not silently dropped, not falsely graded.
- No aerobic-decoupling claim is made for this ride: its whole-ride VI is 1.23 (verified live,
  2026-08-12), above `AEROBIC_MAX_VI` (`lib/aerobic.ts:20`, value `1.12`) — `qualifyingPwHr`
  (`lib/aerobic.ts:59`) should return `null` for it; confirm rather than assume.
- Judge the output for defensibility against a human reading the note. Do not hard-code an expected
  score anywhere in this step — a specific number pinned here would be exactly the "example test that
  happens to pass" this repo's own review history has warned against repeatedly.

- [ ] **Step 1: Run it**

```bash
curl -sf -X POST http://127.0.0.1:3000/api/intent -H 'content-type: application/json' -d '{"today":"<local date covering 2026-08-11>","force":true}'
```

**Considered and rejected (external review, 2026-08-12): hardcoding `"today":"2026-08-11"`.** The
placeholder is deliberate, not an oversight — AGENTS.md's own recurring-bug-class list warns that
"today" must resolve from the athlete's LOCAL date, never assumed from a UTC string, and activity
`i174624272` sits close enough to a day boundary that a naively hardcoded date could silently exclude
it depending on the runner's timezone. Resolve the placeholder to the correct local date at run time;
don't replace it with a literal.

Against a sandboxed `NODEVELO_DATA_DIR`, not the primary athlete data — follow the exact sandboxing
discipline the Phase 2b plan's own Task 9 established (copy `data/`, seed if needed, tear down after,
verify the primary store was never written) rather than re-deriving a lighter-weight version of it here.

- [ ] **Step 2: Record the result**

No commit — this is a verification step. Record the actual parsed objectives, their matches, and the
final score/reason in whatever session or handoff notes are tracking this round's completion, and flag
anything that reads as wrong (an invented number, a falsely-graded qualitative claim, a guessed match
where the hierarchy should have stayed ungraded) as a new finding rather than silently accepting it.

---

## Self-review

**Spec coverage** (design §12.2 + Phase 2b plan's Handoff boundary, the two sources this plan was
scoped from):

- "Intent used" line before the score → Task 6 (placement), Task 4 (`formatIntentUsed`), Task 5
  (`RideIntentBlock` render order).
- Execution score or explicit `Not scored` reason → Task 6 (`displayScore` derivation, suppression),
  Task 4 (`notScoredMessage`).
- Concise evidence for measurable objectives → Task 5 (`measurable` list with `.evidence`).
- Qualitative objectives acknowledged but not graded → Task 5 (`qualitative` list, no evidence claim).
- Scoped aerobic drift or `Not measurable` → Task 4 (`AEROBIC_DRIFT_NOT_MEASURABLE`), Task 5 (render
  gated on `activityDecoupling == null`). Segment-scoped drift itself is an explicit non-goal (Global
  Constraints), matching the Handoff boundary's own scoping.
- "The existing re-analysis control remains sufficient" → no task touches `onReAnalyse`; verified by
  the Ground truth section confirming it's unconditional on `analysis.coachNote`, unrelated to overlays.
- Handoff point 1 (making the debrief overlay-aware) → Task 3 (server resolution) + Task 6 (render
  switch) — the plan's entire spine.
- Handoff point 2 (intent block placement, `unspecified` ride behavior) → Task 6 places it before the
  score; `RideIntentBlock` returns `null` for `unspecified`-with-no-overlay exactly like `prescribed`
  (Task 5's first test case covers the no-overlay path generally).
- Handoff point 3 (aerobic-drift wording) → Task 4/5, above.
- Handoff point 4 (coach-note prompt not touched) → no task modifies `buildRideAnalysisPrompt` or
  anything under `lib/anthropic-prompts.ts`; confirmed by the File structure table's exclusion.
- Handoff's "what 2c must NOT assume" warning (re-derive validity at the new render read site) → Task 3
  Step 1's pending-overlay test is exactly this regression test, exercised at the new call site rather
  than assumed from Phase 2a's own tests.
- PR #35 review finding N1 (`driftAvgQuality` degrading toward `null`) → Task 8, with a regression test
  proving the pre-fix behavior would have failed it.
- PR #35 review finding N2 (zero-objective notes misclassified self-directed) → Task 9, scoped narrowly
  to `all.length === 0` so case (a) — real but ungradable objectives — is provably unchanged (Step 4's
  explicit call-out of the pre-existing test that must still pass).
- External review P1 #1 (refresh race) → Task 3 Steps 7-8, with a `SyncProvider` test proving the
  invalidation actually fires.
- External review P1 #2 (wrong score fallback) → Task 6, corrected in place; the new regression test is
  the one fixture (mismatched scores, no overlay) that can actually distinguish the bug from the fix —
  the plan's original three tests all passed under either version.
- External review P1 #3 (unsafe date fallback on ID mismatch) → Task 2, corrected in place to mirror
  `resolveEffectiveOutcome`'s own id-present-never-falls-back contract exactly.
- External review P1 #4 (aerobic-drift message claiming a segment search that never ran) — **already
  correct as originally written**: the Global Constraints' locked string ("no sufficiently steady
  aerobic segment") is design §7 step 5 verbatim, and Phase 2b's own Handoff boundary already scoped
  segment search out with "the value is already correctly null; only the wording is missing" — the
  wording IS design's own, not an invented claim. Re-verified against `lib/ride-analysis.ts:242` during
  this amendment: no change made.
- External review's "Post button disappears for Not-scored rides" → Task 6, corrected in place.
- External review's "qualitative objectives need an explicit label" → Task 5, corrected in place.
- External review's "route tests incomplete" (GET-only, pending-only, no-analysis-only) → Task 3's test
  block gained the three missing cases (present-but-unmatched ledger, genuinely superseded vs. merely
  pending, and a `POST` describe block) directly, rather than being left for Task 7 to patch around.
- External review's "external coach-note/Intervals-post inconsistency" → Task 10 (round 2). Does NOT
  touch `buildRideAnalysisPrompt` or `lib/anthropic-prompts.ts` — it only changes the auto-posted
  DESCRIPTION string's score line in `lib/sync-analysis.ts`, leaving Handoff point 4's boundary intact.
- Round 2's own locked decision (curated intervals are authoritative; no distance/GPS/position
  inference; ambiguous matches stay ungraded) → Task 11 states it verbatim; Task 12's hierarchy
  Step 3/4 and its "never guesses" test are where it's actually enforced.

**Placeholder scan:** no TBD/TODO, no "similar to Task N" without repeated code, every step shows the
actual diff or full new file.

**Type consistency:** `EffectiveOutcome`, `IntentOverlay`, `ScoredObjective`, `NotScoredReason` used
identically (field names and nullability) in Tasks 3, 5 and 6 — all copied from the Ground-truth read
of `lib/types.ts`, not re-derived per task. `findLedgerEntry`'s signature (Task 2) matches its one call
site (Task 3's `resolveTodayOutcome`) exactly. `RideIntentBlock`'s prop names (`outcome`,
`activityDecoupling`) match `TodayRideCard`'s usage in Task 6 exactly. Tasks 8-9 introduce no new types
or exported signatures — verified against the real merged `lib/score-log.ts`/`lib/intent-scoring.ts` on
2026-08-12, not against the plan-doc excerpts quoted in PR #35's review.

---

## Handoff boundary to Phase 3

**2c ends with the debrief fully overlay-aware. Phase 3 (§8/§9 — the personalized weekly TSS envelope
and next-session suggestion) needs none of this phase's rendering work**, but does need what Phase 2b
already writes and this phase now correctly reads:

- `resolveEffectiveOutcome`'s `EffectiveOutcome.origin` — Phase 3's weekly-range/suggestion logic must
  use effective origin the same way `countsAsDrift` already does (INVARIANT 37), not a raw ledger row,
  for the same reason: a self-directed ride must not count as "off-plan" when there was no plan to be
  off of (design decision #1, §9's "ignored suggestion: record no adherence or execution penalty").
- `TodayAnalysis.activityId` (Task 1) — now a general-purpose join key, not `todayOutcome`-specific;
  any future single-ride feature can reuse `findLedgerEntry` rather than re-deriving its own lookup.
- `summariseBehaviour`'s `driftAvgQuality` and `scoreIntentExecution`'s zero-objective classification
  (Tasks 8-9) — Phase 3's weekly envelope (§8.1 lists "recent execution" among its inputs) reads
  behaviour derived from the same `driftRides`/`origin` machinery these tasks correct; it inherits the
  fix rather than needing its own.

**What Phase 3 must decide, which 2c deliberately does not:** where the no-block weekly-range/suggestion
UI (design §12.1) lives relative to the debrief this phase just built — §12.1 and §12.2 are presented
together on Today (pre-ride vs. post-ride, `TodayView.tsx`'s existing `mode: "pre" | "post"` split
already matches this), but no task in this plan touches the `mode === "pre"` branch at all.

**What Phase 3 must NOT assume carries over:** the same re-derivation warning Phase 2b's plan gave 2c.
Phase 3 adds a new consumer (the weekly envelope) of `origin`/`effectiveExecutionScore`, aggregated
across many rides rather than one — re-verify from scratch that `resolveAll`'s output composes
correctly under aggregation (e.g. a week straddling an overlay's `createdAt` mid-week), don't assume
Phase 2c's single-ride resolution generalizes for free.
