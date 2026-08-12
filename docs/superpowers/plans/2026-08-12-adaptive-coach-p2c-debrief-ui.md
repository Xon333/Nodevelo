# Adaptive self-directed coach — Phase 2c: debrief UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Phase 2b's already-written, already-scored self-directed intent on the ride debrief:
an "Intent used" line before the score, the effective (overlay-resolved) score or its `Not scored`
reason in place of the old intrinsic-scorer number, concise evidence for measurable objectives,
qualitative objectives acknowledged but not graded, and `Aerobic drift not measurable` wording when no
steady segment qualified.

**Architecture:** Resolve today's effective outcome server-side in `GET`/`POST /api/sync` (reusing
`resolveEffectiveOutcome` — the one seam that already enforces overlay validity — never re-implementing
it), ship the result to the client as a new `todayOutcome` field, and render it through one new
extracted component (`RideIntentBlock`) consumed by `TodayRideCard`. No new persistence, no new API
route, no change to how Phase 2b scores or stores anything.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Vitest + `@testing-library/react`
(jsdom, per-file `/** @vitest-environment jsdom */` docblock).

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
  branch — 2b's own review has not yet run and may append further items before this plan's Task 6 does.
  Task 6 greps the live file for the next number rather than hard-coding one, following the lesson
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
| `app/api/sync/route.test.ts` | **Modify.** New cases: active overlay surfaces, pending/superseded overlay does not, no ledger entry → `null`, ledger-fallback value matches `analysis.executionScore`. |
| `components/SyncProvider.tsx` | **Modify.** Add `todayOutcome: EffectiveOutcome \| null` to `AppState`. |
| `components/dashboard/ride-intent.tsx` | **Create.** `RideIntentBlock` — the new debrief content (intent-used line, score/Not-scored, evidence, qualitative, aerobic-not-measurable). |
| `components/dashboard/ride-intent.test.tsx` | **Create.** Component tests (jsdom). |
| `components/dashboard/today.tsx` | **Modify.** `TodayRideCard` takes a new `outcome` prop, renders `RideIntentBlock` before the score, switches the score number to the effective score. |
| `components/dashboard/TodayView.tsx` | **Modify.** Pass `state.todayOutcome` to both `TodayRideCard` call sites. |
| `docs/INVARIANTS.md` | **Modify.** One new item (exact number resolved at write time) recording that the debrief must read the overlay-resolved score, never the raw ledger/analysis score, once an overlay applies. |
| `docs/systems/08-frontend.md` | **Modify.** Update the `Ride debrief` row of the Feature ownership table; note the new file in Known rough edges' size list. |
| `docs/systems/02-scoring-and-learning.md` | **Modify.** One line in Known rough edges cross-referencing this phase, continuing the existing "re-derive validity at each new read site" note. |

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

  it("falls back to date when activityId is undefined", () => {
    const a = entry({ activityId: undefined, date: "2026-06-15" });
    expect(findLedgerEntry([a], undefined, "2026-06-15")).toBe(a);
  });

  it("falls back to date when activityId is present but matches no entry", () => {
    // A record analysed before Task 1 shipped could carry a stale/absent id while the ledger
    // itself already has activityId — the date fallback must still find it.
    const a = entry({ activityId: "a1", date: "2026-06-15" });
    expect(findLedgerEntry([a], "missing", "2026-06-15")).toBe(a);
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
// against. activityId first — the stable join key — falling back to date only when it's absent or
// stale, mirroring the same legacy-row fallback resolveEffectiveOutcome's own callers use elsewhere.
export function findLedgerEntry(
  entries: RideScoreEntry[],
  activityId: string | undefined,
  date: string
): RideScoreEntry | null {
  if (activityId) {
    const byId = entries.find((e) => e.activityId === activityId);
    if (byId) return byId;
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
- Modify: `components/SyncProvider.tsx` (`AppState`)
- Test: `app/api/sync/route.test.ts`

**Interfaces:**
- Consumes: `findLedgerEntry` (Task 2), `resolveEffectiveOutcome`/`indexOverlaysByActivity`/
  `indexOverlaysByDate` (`lib/intent-overlay.ts`, already on `main` per Task 0), the already-loaded
  `scoreLog`/`intentStore` local variables in both handlers.
- Produces: `todayOutcome: EffectiveOutcome | null` on both `GET` and `POST /api/sync` JSON responses,
  and on `AppState`. Read by Task 5.

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
});
```

(`scoreEntries` — reuse the file's existing shared mutable fixture the `readScoreLog` mock closes over;
grep the file's top-of-describe setup for its declaration rather than introducing a new one.)

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

- [ ] **Step 7: Commit**

```bash
git add app/api/sync/route.ts app/api/sync/route.test.ts components/SyncProvider.tsx
git commit -m "feat(today): resolve today's overlay outcome server-side in /api/sync"
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
            <li key={i}>{o.description}</li>
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
  // Once an overlay applies, its effective score (or Not-scored reason) is authoritative — the old
  // intrinsic scorer's analysis.executionScore must not leak through (design §14.1's "generic 2/10"
  // pathway this phase replaces). outcome is null only when /api/sync found no matching ledger row
  // (e.g. before the first sync writes one) — that's the one case the old fallback still applies.
  const hasOverlay = outcome?.overlay != null;
  const displayScore = outcome ? outcome.effectiveExecutionScore : analysis.executionScore;
```

Replace the score block's guard and value (`components/dashboard/today.tsx:226-234`):

```tsx
      {displayScore != null && (
        <div className="flex items-center gap-3">
          <span className="font-mono text-3xl font-bold leading-none text-zinc-800 dark:text-[#ff49c8]">
            {displayScore}
            <span className="font-sans text-sm font-normal text-zinc-500 dark:text-zinc-400">/10</span>
          </span>
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            {executionScoreLabel(displayScore)}
          </span>
          {onPostNote && analysis.coachNote && (
```

(Leave the rest of that block — the "Post to Intervals.icu" button and its closing tags — unchanged;
only the score-source lines change.)

Add `<RideIntentBlock outcome={outcome ?? null} activityDecoupling={analysis.activityDecoupling} />`
immediately before that same `{displayScore != null && (` block, so the intent line renders before the
score per design §12.2 ("Before the score explanation, show the interpreted target").

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

**Placeholder scan:** no TBD/TODO, no "similar to Task N" without repeated code, every step shows the
actual diff or full new file.

**Type consistency:** `EffectiveOutcome`, `IntentOverlay`, `ScoredObjective`, `NotScoredReason` used
identically (field names and nullability) in Tasks 3, 5 and 6 — all copied from the Ground-truth read
of `lib/types.ts`, not re-derived per task. `findLedgerEntry`'s signature (Task 2) matches its one call
site (Task 3's `resolveTodayOutcome`) exactly. `RideIntentBlock`'s prop names (`outcome`,
`activityDecoupling`) match `TodayRideCard`'s usage in Task 6 exactly.

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

**What Phase 3 must decide, which 2c deliberately does not:** where the no-block weekly-range/suggestion
UI (design §12.1) lives relative to the debrief this phase just built — §12.1 and §12.2 are presented
together on Today (pre-ride vs. post-ride, `TodayView.tsx`'s existing `mode: "pre" | "post"` split
already matches this), but no task in this plan touches the `mode === "pre"` branch at all.

**What Phase 3 must NOT assume carries over:** the same re-derivation warning Phase 2b's plan gave 2c.
Phase 3 adds a new consumer (the weekly envelope) of `origin`/`effectiveExecutionScore`, aggregated
across many rides rather than one — re-verify from scratch that `resolveAll`'s output composes
correctly under aggregation (e.g. a week straddling an overlay's `createdAt` mid-week), don't assume
Phase 2c's single-ride resolution generalizes for free.
