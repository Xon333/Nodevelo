# Adaptive self-directed coach — Phase 2a: origin resolution & overlay envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic infrastructure Phase 2b's intent parser writes into — a stable activity key on the ledger, a correctly-gated overlay envelope, and a single effective-outcome seam that **both** execution modelling and drift accounting read — proven inert against the real frozen ledger.

**Architecture:** The ledger stays the frozen raw record and gains exactly one new field: `activityId`. Origin is **never persisted on the ledger** — it is derived (`planned` → prescribed/unspecified) or asserted by an overlay, so there is one place `self-directed` can ever come from and no possibility of the two disagreeing. A new permanent `data/intent-overlays.json` holds interpretations with an explicit `status` gate. `buildAthleteModel` resolves every ride's effective outcome **once**, then feeds that same resolution to execution modelling *and* behaviour/drift — which is what makes decision #1 ("a self-directed ride must never increase `offPlanPct`") actually hold once 2b starts writing overlays.

**Tech Stack:** TypeScript 5, Next.js 16 (App Router), Vitest. No new dependencies. One new `data/` file (`intent-overlays.json`).

## This phase is infrastructure. It changes nothing the athlete sees.

Stated plainly because an earlier draft of this plan got it wrong: **Phase 2a produces no user-visible behavioural change.** Nothing is classified `self-directed` in this phase — only Phase 2b's parser can establish a scoreable intent — so the overlay store ships empty, every resolution falls through to the ledger, and Task 5 *verifies* that `offPlanPct`, `sampleSize` and `overallExecEwma` are identical on the athlete's real 400-entry ledger before and after.

The value of shipping it separately is that it settles the shapes and the resolution seam under a small, reviewable diff, and proves inertness — so 2b's risky LLM work lands on foundations that are already correct. The prior draft claimed 2a "ships user-visible correctness" while simultaneously containing a test asserting nothing changes. It doesn't, and the framing here is the honest one.

## Why this plan was rewritten before implementation

An independent review of the first draft found three blocking defects and a schema-stability claim that didn't hold. All were verified against the code and confirmed. Recording them so they are not reintroduced:

1. **Drift would have read the wrong origin — the defect that would have silently defeated decision #1.** The intent parse cannot run during sync (INVARIANT 23 keeps it LLM-free), so the ledger entry is written and frozen *before* any overlay exists. The ledger therefore holds `unspecified` while the overlay holds `self-directed`. The first draft computed drift from the raw ledger row, so the moment 2b worked, a self-directed ride would have joined the execution EWMA *and kept inflating `offPlanPct`* — the exact inversion of the decision it claimed to implement. Drift must use the **effective** origin. Task 4 does, and pins it with a test.
2. **Overlay approval state was unsafe.** The first draft's `approvedAt: null` meant "auto-accepted **or** not yet reviewed" — opposite states in one field — and applicability ignored it entirely. A Phase 4 overlay prepared for human review would have overridden the ledger *before* approval, violating design §11.1 ("before changing any effective state") and decision #10. Replaced by an explicit `status: "pending" | "active" | "disabled"`, where **only `active` affects derived state**, plus a real `id` (the draft's `supersededBy` pointed at an informal `activityId+createdAt` convention rather than a key).
3. **Per-type learning would have been polluted.** The draft fed self-directed rides into the existing per-type grouping, which keys on `inferredType` — derived from whole-ride IF. A mixed climbing ride at IF 0.84 would have taught the model "your Threshold execution is X," reintroducing exactly the circular inference Phase 1 removed. Worse, `complianceEwma`'s `comps.length ? … : 0` ([athlete-model.ts:110](../../../lib/athlete-model.ts)) reports **0% compliance** for a group of rides that have no compliance concept, contradicting decision #7. Fixed: overall execution admits self-directed; **per-type stats and compliance stay prescribed-only** until 2b supplies a trustworthy intent-derived type.
4. **The overlay schema was not independent of 2b/2c.** A missing note needs `Not scored — no intent found` with no LLM call at all, yet the draft's type required `intent`/`confidence`/`model`/`promptVersion`. `effectiveExecutionScore: null` couldn't distinguish design §13's four distinct causes, which 2c must display. And flat `evidence: string[]` couldn't express §12.2's per-objective evidence plus acknowledged-but-ungraded objectives. Corrected here.

Two further corrections adopted beyond the review's findings:

- **Ledger `origin` is not persisted at all.** In 2a it is fully derivable from `planned`, and the ledger can never legitimately carry `self-directed` (intent is never known at scoring time). Storing it would create a second source of truth that can disagree with the overlay. `activityId` stays — that is genuinely new information.
- **Date-fallback matching is restricted to rows with no `activityId`.** Decision #9's date rule exists for legacy rows only. Letting a row that *has* an id fall back to a date match would let a same-day secondary ride's overlay bind to the primary ride. 2b binds overlays to the primary ride's `activityId` at write time.

### Decisions this phase implements (already resolved — do not reopen)

- **#1**: An approved self-directed execution score joins the same `overallExecEwma` as a prescribed one. Only outcomes passing deterministic intent-quality requirements join. **A self-directed ride must never increase `offPlanPct`.**
- **#2**: The overlay store is **permanent**, for all self-directed rides — not a one-time historical-repair artifact.
- **#3**: `effectiveExecutionScore: number | null`. `null` = recorded but no trustworthy measurable intent. The ride still contributes TSS, hours, frequency, CTL/ATL/TSB, recent intensity and recovery context; it never joins execution EWMA, execution trends, or strength/weakness claims. "No row" was explicitly rejected.
- **#7**: Self-directed rides receive **execution, not compliance**. `compliancePct` stays `null`; `resolveCompliance` does not apply.
- **#9**: Overlays key by Intervals activity ID, date secondary. Legacy rows with no ID resolve by date + the primary/longest-ride rule. Every cycling activity contributes TSS; execution scoring retains the primary-ride-per-date rule.
- **#10**: Historical overlays are human-approved before they change effective state. Originals are never deleted.
- **#14**: A post-ride note can never replace a block prescription.

## Global Constraints

- **The ledger stays append-only.** `mergeScoreLog` keeps `existing` over `fresh`; past entries are frozen (INVARIANT 1). This plan must NOT rewrite or backfill frozen entries — historical repair is Phase 4's.
- **Only `status === "active"` overlays affect derived state.** A `pending` overlay (Phase 4 prepared-for-review) must be invisible to every consumer. This is decision #10's safety contract and is pinned by test.
- **Drift and execution read the SAME resolved outcome.** Resolve once per ride, feed both. A consumer computing drift from a raw ledger row is the defect that forced this rewrite.
- **Migration flags use truthy checks, never `=== null`** (INVARIANT 3). Entries written before this phase parse back with `activityId` **`undefined`**, not `null`, and a test proves the consequences against a literal pre-2a fixture.
- **All persistence goes through `json-store.ts`** (INVARIANT 2). `intent-overlays.json` joins the **CRITICAL** set — an approved overlay is a human decision a fresh sync cannot re-derive, exactly that set's stated criterion.
- **Per-type stats and compliance stay prescribed-only in 2a.** Self-directed rides may join only `overallExecEwma`, `overallTrend` and `sampleSize`.
- **`compliancePct` stays `null` for self-directed rides** (decision #7).
- **The sync route stays LLM-free** (INVARIANT 23). Nothing here adds an Anthropic call; the overlay store gains no producer until 2b.
- **Phase 1's `AEROBIC_MAX_VI`, `qualifyingPwHr`, `isSteadyEnduranceRide` are not touched.**
- Tests are colocated `lib/*.test.ts`, Vitest. Verify with `npm run check` (`tsc --noEmit && eslint && vitest run`).
- Commit after every task. Stage only the files that task names — never `git add -A`.

## File Structure

| File | Change | Responsibility after this plan |
|---|---|---|
| `lib/types.ts` | Modify | `RideOrigin`; `RideScoreEntry.activityId`; the corrected `IntentOverlay` envelope + `OverlayStatus`, `NotScoredReason`, `ScoredObjective`, `IntentInterpretation`, `IntentOverlayStore`, `EffectiveOutcome`, `ResolvedRide` |
| `lib/ride-origin.ts` | **Create** | Pure: `originOf()` (derive from `planned`), `countsAsDrift()` |
| `lib/ride-origin.test.ts` | **Create** | Derivation + the drift rule |
| `lib/intent-overlay.ts` | **Create** | Pure: `indexOverlaysByActivity()`, `indexOverlaysByDate()`, `resolveEffectiveOutcome()`, `resolveAll()` |
| `lib/intent-overlay.test.ts` | **Create** | Status gating, precedence, `null` score, empty-store identity |
| `lib/data-store.ts` | Modify | `readIntentOverlays()` / `updateIntentOverlays()` |
| `lib/json-store.ts` | Modify | `intent-overlays.json` → `CRITICAL` |
| `lib/score-log.ts` | Modify | Stamp `activityId`; `summariseBehaviour` takes resolved rides and counts drift by effective origin |
| `lib/score-log.test.ts` | Modify | `activityId` stamping, drift-by-effective-origin, back-compat |
| `lib/athlete-model.ts` | Modify | Resolve once; overall execution admits self-directed; per-type/compliance prescribed-only |
| `lib/athlete-model.test.ts` | Modify | Admission, per-type isolation, the decisive drift test |
| `lib/athlete-state.test.ts` | Modify | `evalBehaviour` silent on self-directed volume |
| `docs/INVARIANTS.md`, `docs/systems/02-scoring-and-learning.md`, `docs/FILE_INDEX.md`, `ROADMAP.md` | Modify | Record the contracts |

`lib/athlete-state.ts` needs **no source change**: `evalBehaviour` reads `model.behaviour.offPlanPct`, fixed at its producer. Its test file gains a case proving it. A reviewer expecting a change there should read Task 4's Step 6 first.

---

### Task 1: Origin derivation and the drift rule

**Files:**
- Modify: `lib/types.ts` (add `RideOrigin`; add `activityId` to `RideScoreEntry`)
- Create: `lib/ride-origin.ts`, `lib/ride-origin.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `export type RideOrigin = "prescribed" | "self-directed" | "unspecified"`
  - `RideScoreEntry.activityId?: string` (optional — pre-2a rows lack it)
  - `export function originOf(e: Pick<RideScoreEntry, "planned">): RideOrigin`
  - `export function countsAsDrift(origin: RideOrigin, legacy: boolean): boolean`

Tasks 2–4 consume both functions.

**Why origin is derived, not stored.** A ledger row can only ever be `prescribed` (a block covered the date) or `unspecified` (it didn't) — both fully determined by `planned`. It can never be `self-directed`, because intent is never known when the row is written (sync is LLM-free) and the row is frozen before the parse runs. Persisting a field that is always derivable would create a second source of truth able to disagree with the overlay. `self-directed` is asserted in exactly one place: an active overlay.

**`countsAsDrift` takes an origin, not an entry**, so callers must have already decided *which* origin they mean — the raw-ledger-vs-effective distinction that the first draft got wrong. Making it impossible to pass an entry is the point.

- [ ] **Step 1: Write the failing tests**

Create `lib/ride-origin.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { countsAsDrift, originOf } from "./ride-origin";

describe("originOf — derived from `planned`, never stored", () => {
  it("is prescribed when a block covered the date", () => {
    expect(originOf({ planned: true })).toBe("prescribed");
  });

  it("is unspecified when no block covered the date", () => {
    // NOT self-directed: a ledger row can never be self-directed, because intent isn't known when
    // the row is written (sync is LLM-free) and the row freezes before the parse runs. Only an
    // active overlay can assert self-directed.
    expect(originOf({ planned: false })).toBe("unspecified");
    expect(originOf({ planned: false })).not.toBe("self-directed");
  });
});

describe("countsAsDrift", () => {
  it("counts an unspecified ride during structured training", () => {
    expect(countsAsDrift("unspecified", false)).toBe(true);
  });

  it("never counts a self-directed ride — decision #1's hard requirement", () => {
    expect(countsAsDrift("self-directed", false)).toBe(false);
  });

  it("never counts a prescribed ride", () => {
    expect(countsAsDrift("prescribed", false)).toBe(false);
  });

  it("never counts a legacy (pre-first-block) ride, whatever its origin", () => {
    for (const o of ["prescribed", "self-directed", "unspecified"] as const) {
      expect(countsAsDrift(o, true)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/ride-origin.test.ts
```

Expected: FAIL — `Failed to resolve import "./ride-origin"`.

- [ ] **Step 3: Add the types to `lib/types.ts`**

Add near `RideScoreEntry` (starts around line 652 — confirm against the file):

```ts
// Why a ride was (or wasn't) judged against a target — the semantic distinction the boolean `planned`
// could not carry. `planned` conflated two facts: "a prescription existed" and "this ride is evidence
// the athlete is drifting off-plan." A self-directed ride is off-PLAN but not off-TRACK: no block
// existed, the athlete stated an objective in the ride note, and they executed against it.
//   • prescribed    — a block/session existed for the date and remains the scoring target. A post-ride
//                     note can never displace it (decision #14).
//   • self-directed — no prescription, but a sufficiently clear intent was recovered and scored.
//                     Asserted ONLY by an active intent overlay, never by a ledger row.
//   • unspecified   — no prescription and not enough trustworthy intent to score execution.
// Physical load (TSS/CTL/ATL/TSB, hours, frequency) counts identically for all three.
export type RideOrigin = "prescribed" | "self-directed" | "unspecified";
```

Then add ONE optional field to `RideScoreEntry`, after `planned`:

```ts
  // The Intervals.icu activity this entry scored — the stable key intent overlays join on
  // (decision #9). OPTIONAL because every entry written before this field existed parses back
  // `undefined`, not null (INVARIANT 3). Entries still key by DATE; this is the provenance that lets
  // an overlay bind to the exact activity instead of inferring it. Deliberately NOT accompanied by a
  // stored `origin`: a ledger row's origin is always derivable from `planned` and can never be
  // self-directed, so storing it would only create a second source of truth (see lib/ride-origin.ts).
  activityId?: string;
```

- [ ] **Step 4: Create `lib/ride-origin.ts`**

```ts
// Ride origin: the semantic distinction the boolean `planned` conflated — whether a prescription
// existed, versus whether the ride is evidence of drift. A self-directed ride is off-PLAN but not
// off-TRACK, and counting it as drift is the defect this whole phase exists to make impossible.
//
// Origin is DERIVED here, never stored on the ledger. A frozen row can only be prescribed or
// unspecified; `self-directed` is asserted exclusively by an active intent overlay, resolved through
// lib/intent-overlay.ts. One assertion point means the ledger and the overlay can never disagree.
//
// Pure, no I/O.

import type { RideOrigin, RideScoreEntry } from "./types";

export function originOf(e: Pick<RideScoreEntry, "planned">): RideOrigin {
  return e.planned ? "prescribed" : "unspecified";
}

// Does this ride count toward the "training is drifting off-plan" signal? Only an `unspecified` ride
// during structured training. Self-directed rides are excluded by decision #1's hard requirement;
// legacy (pre-first-block) rides keep their existing exemption — there was no plan for them to be off.
//
// Takes an ORIGIN, not an entry, on purpose: the caller must have already decided whether it holds the
// raw ledger origin or the EFFECTIVE (overlay-resolved) one. Passing a ledger row here is the exact
// mistake that would let self-directed rides keep inflating offPlanPct — so the signature makes it
// impossible. Drift must always be computed from the effective origin.
export function countsAsDrift(origin: RideOrigin, legacy: boolean): boolean {
  if (legacy) return false;
  return origin === "unspecified";
}
```

- [ ] **Step 5: Run the tests, then the full check**

```bash
npx vitest run lib/ride-origin.test.ts && npm run check
```

Expected: both PASS. `activityId` is optional, so no construction site breaks.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/ride-origin.ts lib/ride-origin.test.ts
git commit -m "$(cat <<'EOF'
feat(scoring): derive ride origin, and add activityId to the ledger

`planned` conflated two facts: whether a prescription existed, and whether a ride
is evidence of drift. Origin is derived from `planned`, never stored — a frozen
row can only be prescribed or unspecified, so persisting it would create a second
source of truth able to disagree with the overlay that asserts self-directed.

countsAsDrift takes an origin rather than an entry so a caller cannot accidentally
compute drift from a raw ledger row instead of the effective outcome.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The overlay envelope, store, and effective-outcome seam

**Files:**
- Modify: `lib/types.ts`, `lib/json-store.ts` (CRITICAL, ~line 25), `lib/data-store.ts` (type import line 4 + accessors)
- Create: `lib/intent-overlay.ts`, `lib/intent-overlay.test.ts`

**Interfaces:**
- Consumes: `RideOrigin`, `originOf` from Task 1.
- Produces:
  - `OverlayStatus`, `NotScoredReason`, `ScoredObjective`, `IntentInterpretation`, `IntentOverlay`, `IntentOverlayStore`, `EffectiveOutcome`, `ResolvedRide`
  - `indexOverlaysByActivity(overlays)`, `indexOverlaysByDate(overlays)` — both newest-wins by `createdAt`
  - `resolveEffectiveOutcome(entry, byActivity, byDate): EffectiveOutcome`
  - `resolveAll(entries, overlays): ResolvedRide[]` — the convenience seam callers use
  - `readIntentOverlays()`, `updateIntentOverlays(mutate)`

Tasks 3–4 consume `resolveAll`. Phase 2b writes through `updateIntentOverlays`.

**Envelope design notes** (each fixes a defect the first draft shipped):

- `status: "pending" | "active" | "disabled"` — **only `active` affects derived state.** Phase 2b's auto-accepted future rides create `active`; Phase 4's historical preparation creates `pending`, and human approval flips it. The draft's `approvedAt: null` meant both "auto-accepted" and "awaiting review," which would have let unapproved historical overlays silently override the ledger.
- `id: string` — a real stable key; `supersededBy` references it. 2b generates it with `crypto.randomUUID()` (Node built-in, no dependency); 2a has no producer and its tests use literal ids.
- `interpretation: IntentInterpretation | null` — **null when no LLM ran.** A missing note yields `Not scored — no intent found` deterministically; demanding `model`/`promptVersion` for that case would force fabricated provenance. When non-null it carries `model` + `promptVersion` (INVARIANT 16).
- `notScoredReason` — design §13 enumerates distinct causes and 2c must display them; a bare `null` score cannot.
- `objectives: ScoredObjective[]` inside the interpretation — binds evidence to the objective it supports, and marks acknowledged-but-ungraded qualitative objectives (§12.2). Flat `string[]` could express neither.

- [ ] **Step 1: Write the failing tests**

Create `lib/intent-overlay.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { indexOverlaysByActivity, indexOverlaysByDate, resolveAll, resolveEffectiveOutcome } from "./intent-overlay";
import type { IntentOverlay, NotScoredReason, RideScoreEntry } from "./types";

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

const overlay = (over: Partial<IntentOverlay> = {}): IntentOverlay => ({
  id: "ov-1",
  activityId: "a1",
  date: "2026-06-15",
  noteFingerprint: "fp-1",
  status: "active",
  origin: "self-directed",
  effectiveExecutionScore: 8,
  notScoredReason: null,
  interpretation: {
    intent: { primaryPurpose: "steady endurance", phases: [] },
    confidence: "high",
    objectives: [{ description: "45 min Z2", measurable: true, scored: true, evidence: "44 min in Z2" }],
    model: "claude-sonnet-4-6",
    promptVersion: 7,
  },
  scoringVersion: 1,
  schemaVersion: 1,
  createdAt: "2026-06-15T10:00:00.000Z",
  approvedAt: null,
  supersededBy: null,
  ...over,
});

// A `Not scored` overlay, with the origin the taxonomy requires for the given reason. Kept as a helper
// so no test accidentally pairs "couldn't read the note" with `self-directed` — the exact mistake an
// earlier draft of this plan made in its own fixture.
const notScored = (reason: NotScoredReason, over: Partial<IntentOverlay> = {}): IntentOverlay =>
  overlay({
    effectiveExecutionScore: null,
    notScoredReason: reason,
    scoringVersion: null,
    origin: reason === "no-measurable-objectives" ? "self-directed" : "unspecified",
    interpretation: reason === "no-intent-found" ? null : overlay().interpretation,
    ...over,
  });

describe("resolveEffectiveOutcome — empty store is identity", () => {
  it("falls back to the ledger entry when no overlay exists", () => {
    const r = resolveEffectiveOutcome(entry({ executionScore: 6 }), new Map(), new Map());
    expect(r.effectiveExecutionScore).toBe(6);
    expect(r.source).toBe("ledger");
    expect(r.overlay).toBeNull();
  });

  it("derives origin from the entry when falling back", () => {
    expect(resolveEffectiveOutcome(entry({ planned: true }), new Map(), new Map()).origin).toBe("prescribed");
    expect(resolveEffectiveOutcome(entry({ planned: false }), new Map(), new Map()).origin).toBe("unspecified");
  });
});

describe("resolveEffectiveOutcome — status gating (decision #10's safety contract)", () => {
  it("applies an active overlay", () => {
    const e = entry({ activityId: "a1", executionScore: 3 });
    const r = resolveEffectiveOutcome(e, indexOverlaysByActivity([overlay({ status: "active" })]), new Map());
    expect(r.effectiveExecutionScore).toBe(8);
    expect(r.origin).toBe("self-directed");
    expect(r.source).toBe("overlay");
  });

  it("IGNORES a pending overlay — it must not change effective state before human approval", () => {
    // The first draft of this plan would have applied this overlay. Phase 4 prepares historical
    // overlays as `pending`; applying one before approval violates design §11.1 and decision #10.
    const e = entry({ activityId: "a1", executionScore: 3 });
    const r = resolveEffectiveOutcome(e, indexOverlaysByActivity([overlay({ status: "pending" })]), new Map());
    expect(r.effectiveExecutionScore).toBe(3);
    expect(r.origin).toBe("unspecified");
    expect(r.source).toBe("ledger");
  });

  it("ignores a disabled overlay, restoring the original frozen score", () => {
    const e = entry({ activityId: "a1", executionScore: 3 });
    const r = resolveEffectiveOutcome(e, indexOverlaysByActivity([overlay({ status: "disabled" })]), new Map());
    expect(r.effectiveExecutionScore).toBe(3);
    expect(r.source).toBe("ledger");
  });
});

describe("resolveEffectiveOutcome — matching rules", () => {
  it("matches by activityId", () => {
    const e = entry({ activityId: "a1", executionScore: 2 });
    expect(resolveEffectiveOutcome(e, indexOverlaysByActivity([overlay()]), new Map()).effectiveExecutionScore).toBe(8);
  });

  it("falls back to a date match ONLY for a row with no activityId (decision #9)", () => {
    const legacyRow = entry({ activityId: undefined, executionScore: 2 });
    const byDate = indexOverlaysByDate([overlay({ effectiveExecutionScore: 7 })]);
    expect(resolveEffectiveOutcome(legacyRow, new Map(), byDate).effectiveExecutionScore).toBe(7);
  });

  it("does NOT date-match a row that has an activityId but no id match", () => {
    // Otherwise a same-day SECONDARY ride's overlay could bind to the primary ride's entry. 2b binds
    // overlays to the primary ride's activityId at write time; date matching is for legacy rows only.
    const e = entry({ activityId: "primary", executionScore: 2 });
    const byDate = indexOverlaysByDate([overlay({ activityId: "secondary", effectiveExecutionScore: 9 })]);
    const r = resolveEffectiveOutcome(e, new Map(), byDate);
    expect(r.effectiveExecutionScore).toBe(2);
    expect(r.source).toBe("ledger");
  });

  it("carries a null effective score through as null, not the ledger's number (decision #3)", () => {
    const e = entry({ activityId: "a1", executionScore: 5 });
    const r = resolveEffectiveOutcome(e, indexOverlaysByActivity([notScored("intent-unreliable")]), new Map());
    expect(r.effectiveExecutionScore).toBeNull();
    expect(r.source).toBe("overlay");
    expect(r.overlay?.notScoredReason).toBe("intent-unreliable");
  });

  it("represents a missing note with no LLM provenance at all", () => {
    // A missing note is decided deterministically — no model, no promptVersion, no scorer to record.
    const r = resolveEffectiveOutcome(entry({ activityId: "a1" }), indexOverlaysByActivity([notScored("no-intent-found")]), new Map());
    expect(r.overlay?.interpretation).toBeNull();
    expect(r.overlay?.scoringVersion).toBeNull();
    expect(r.overlay?.notScoredReason).toBe("no-intent-found");
  });
});

describe("resolveEffectiveOutcome — a prescription is never displaced (decision #14)", () => {
  it("returns the ledger for a planned ride even when an active overlay matches its activity", () => {
    // Enforced at the seam, not merely trusted to the 2b writer: a malformed or misdirected overlay
    // must not be able to reclassify a block session as self-directed or replace its score. The
    // ledger's own `planned` flag is authoritative and independent of anything the overlay claims.
    const e = entry({ planned: true, activityId: "a1", executionScore: 6, compliancePct: 100 });
    const r = resolveEffectiveOutcome(e, indexOverlaysByActivity([overlay({ effectiveExecutionScore: 9 })]), new Map());
    expect(r.effectiveExecutionScore).toBe(6);
    expect(r.origin).toBe("prescribed");
    expect(r.source).toBe("ledger");
    expect(r.overlay).toBeNull();
  });
});

describe("origin coherence — an overlay cannot claim self-directed on unreadable intent", () => {
  // The taxonomy: sufficiently clear intent ⇒ self-directed; missing/unreliable/failed ⇒ unspecified.
  // Without this an overlay could exempt a ride from drift on the strength of a note nothing could read.
  it.each(["no-intent-found", "interpreter-failed", "intent-unreliable"] as const)(
    "rejects a self-directed overlay whose reason is %s",
    (reason) => {
      const bad = notScored(reason, { origin: "self-directed" });
      const r = resolveEffectiveOutcome(entry({ activityId: "a1", executionScore: 5 }), indexOverlaysByActivity([bad]), new Map());
      expect(r.source).toBe("ledger");
      expect(r.origin).toBe("unspecified");
    }
  );

  it("ACCEPTS self-directed when the intent was clear but nothing was measurable", () => {
    // The one reason compatible with self-directed: intent understood, ride data just can't verify it
    // (design §6 — technical descending is acknowledged, never graded). This ride is NOT drift.
    const ok = notScored("no-measurable-objectives");
    const r = resolveEffectiveOutcome(entry({ activityId: "a1", executionScore: 5 }), indexOverlaysByActivity([ok]), new Map());
    expect(r.source).toBe("overlay");
    expect(r.origin).toBe("self-directed");
    expect(r.effectiveExecutionScore).toBeNull();
  });

  it("rejects an overlay whose score and reason disagree in either direction", () => {
    const scoreWithReason = overlay({ effectiveExecutionScore: 8, notScoredReason: "intent-unreliable" });
    const nullWithoutReason = overlay({ effectiveExecutionScore: null, notScoredReason: null });
    for (const bad of [scoreWithReason, nullWithoutReason]) {
      const r = resolveEffectiveOutcome(entry({ activityId: "a1", executionScore: 5 }), indexOverlaysByActivity([bad]), new Map());
      expect(r.source).toBe("ledger");
    }
  });
});

describe("supersession lifecycle", () => {
  it("ignores a superseded overlay even while its status still reads active", () => {
    const superseded = overlay({ id: "ov-old", supersededBy: "ov-new", effectiveExecutionScore: 9 });
    const r = resolveEffectiveOutcome(entry({ activityId: "a1", executionScore: 5 }), indexOverlaysByActivity([superseded]), new Map());
    expect(r.source).toBe("ledger");
  });

  it("keeps the ACTIVE overlay applying while its PENDING successor awaits approval", () => {
    // The bug this ordering exists to prevent: selecting the newest record and only then testing
    // applicability would let the pending successor suppress the live correction, silently reverting
    // an approved score the moment Phase 4 drafted its replacement.
    const active = overlay({ id: "ov-1", effectiveExecutionScore: 8, createdAt: "2026-06-15T10:00:00.000Z" });
    const pendingSuccessor = overlay({ id: "ov-2", status: "pending", effectiveExecutionScore: 3, createdAt: "2026-06-16T10:00:00.000Z" });
    const r = resolveEffectiveOutcome(
      entry({ activityId: "a1", executionScore: 5 }),
      indexOverlaysByActivity([active, pendingSuccessor]),
      new Map()
    );
    expect(r.effectiveExecutionScore).toBe(8);
    expect(r.overlay?.id).toBe("ov-1");
  });

  it("falls back to the ledger once the current correction is disabled and none other applies", () => {
    const disabled = overlay({ id: "ov-1", status: "disabled", effectiveExecutionScore: 8 });
    const r = resolveEffectiveOutcome(entry({ activityId: "a1", executionScore: 5 }), indexOverlaysByActivity([disabled]), new Map());
    expect(r.effectiveExecutionScore).toBe(5);
    expect(r.source).toBe("ledger");
  });
});

describe("index helpers", () => {
  it("keep the newest overlay by createdAt, independent of array order", () => {
    const older = overlay({ id: "old", effectiveExecutionScore: 4, createdAt: "2026-06-15T10:00:00.000Z" });
    const newer = overlay({ id: "new", effectiveExecutionScore: 8, createdAt: "2026-06-16T10:00:00.000Z" });
    expect(indexOverlaysByActivity([newer, older]).get("a1")?.id).toBe("new");
    expect(indexOverlaysByActivity([older, newer]).get("a1")?.id).toBe("new");
    expect(indexOverlaysByDate([newer, older]).get("2026-06-15")?.id).toBe("new");
    expect(indexOverlaysByDate([older, newer]).get("2026-06-15")?.id).toBe("new");
  });

  it("skip overlays missing their key", () => {
    expect(indexOverlaysByActivity([overlay({ activityId: "" })]).size).toBe(0);
    expect(indexOverlaysByDate([overlay({ date: "" })]).size).toBe(0);
  });

  it("exclude non-applicable overlays from the index entirely", () => {
    // Applicability is filtered BEFORE newest-wins selection, so an inapplicable record can never
    // occupy a key and shadow an applicable one behind it.
    expect(indexOverlaysByActivity([overlay({ status: "pending" })]).size).toBe(0);
    expect(indexOverlaysByActivity([overlay({ status: "disabled" })]).size).toBe(0);
    expect(indexOverlaysByActivity([overlay({ supersededBy: "ov-2" })]).size).toBe(0);
  });
});

describe("resolveAll", () => {
  it("pairs every entry with its outcome, preserving order", () => {
    const entries = [entry({ date: "2026-06-14", activityId: "x" }), entry({ date: "2026-06-15", activityId: "a1" })];
    const resolved = resolveAll(entries, [overlay()]);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].outcome.source).toBe("ledger");
    expect(resolved[1].outcome.source).toBe("overlay");
    expect(resolved[1].entry.date).toBe("2026-06-15");
  });

  it("with an empty store, every outcome mirrors its ledger entry exactly", () => {
    const entries = [entry({ executionScore: 4 }), entry({ date: "2026-06-16", executionScore: 9, planned: true })];
    for (const r of resolveAll(entries, [])) {
      expect(r.outcome.effectiveExecutionScore).toBe(r.entry.executionScore);
      expect(r.outcome.source).toBe("ledger");
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/intent-overlay.test.ts
```

Expected: FAIL — `Failed to resolve import "./intent-overlay"`.

- [ ] **Step 3: Add the envelope types to `lib/types.ts`**

Add after the `RideOrigin` block:

```ts
// Only an `active` overlay affects derived coaching state. Phase 2b's auto-accepted future rides are
// created `active`; Phase 4's historical preparation creates `pending`, and human approval flips it
// (decision #10, design §11.1 — nothing changes effective state before approval). `disabled` is a soft
// retirement: the record survives so history stays auditable.
export type OverlayStatus = "pending" | "active" | "disabled";

// Why an outcome carries no execution score. Design §13 distinguishes these, and the debrief (Phase 2c)
// must say which — a bare null score cannot.
export type NotScoredReason =
  | "no-intent-found" // no note at all — decided deterministically, no LLM call
  | "intent-unreliable" // parsed, but confidence/validation too low to trust
  | "no-measurable-objectives" // intent understood; nothing the ride data can verify
  | "interpreter-failed"; // the parse itself errored

// The structured intent recovered from a note. Deliberately loose — Phase 2b's zod schema is the
// authority on validity; duplicating those constraints here would create two definitions to drift.
export interface StructuredIntent {
  primaryPurpose: string;
  phases: Array<{ description: string; durationMin?: number; targetZone?: string; targetWatts?: number }>;
}

// One stated objective and what the ride data could say about it. `scored: false` with
// `measurable: false` is the "acknowledged but not graded" case design §12.2 requires (e.g. technical
// descending, which sensors cannot validate) — a flat evidence string list could not express it.
export interface ScoredObjective {
  description: string;
  measurable: boolean;
  scored: boolean;
  evidence: string | null;
}

// The AI-derived half of an overlay. NULL when no model ran — a missing note is decided
// deterministically, and demanding model/promptVersion there would force fabricated provenance.
// When present it carries both (INVARIANT 16).
export interface IntentInterpretation {
  intent: StructuredIntent;
  confidence: "high" | "medium" | "low";
  objectives: ScoredObjective[];
  model: string;
  promptVersion: number;
}

// A permanent interpretation of one ride's stated intent plus the effective outcome derived from it
// (decision #2). Keyed by Intervals activity id, date secondary (decision #9). The ledger remains the
// raw audit record and is NEVER rewritten by an overlay (INVARIANT 1).
export interface IntentOverlay {
  id: string; // stable unique key; `supersededBy` references it. 2b generates via crypto.randomUUID()
  activityId: string;
  date: string; // YYYY-MM-DD — secondary key, used only for legacy rows carrying no activityId
  noteFingerprint: string; // a note edit produces a NEW overlay superseding this one, never a mutation
  status: OverlayStatus;
  // MUST be `unspecified` whenever notScoredReason is no-intent-found / interpreter-failed /
  // intent-unreliable — those mean no trustworthy intent was recovered, which is the definition of
  // unspecified. Only `no-measurable-objectives` pairs with `self-directed`: the intent WAS clear, the
  // ride data just couldn't verify it. `isApplicable` enforces this and rejects an incoherent overlay.
  origin: RideOrigin;
  // null = "Not scored" (decision #3) — recorded, still contributes load, but no execution verdict.
  // Distinct from "no overlay exists," which falls back to the ledger's own score.
  effectiveExecutionScore: number | null;
  notScoredReason: NotScoredReason | null; // non-null exactly when effectiveExecutionScore is null
  interpretation: IntentInterpretation | null;
  // The DETERMINISTIC scorer version behind effectiveExecutionScore — distinct from the
  // interpretation's promptVersion (which versions the LLM parse). Design §11.3 requires both, and
  // §11.2 requires retro scoring to use "the same deterministic scorer" as future rides, which is
  // unverifiable without recording which one ran. null exactly when no score was produced.
  scoringVersion: number | null;
  schemaVersion: number; // this envelope's version, bumped on structural change
  createdAt: string;
  approvedAt: string | null; // set when a human approves a `pending` overlay; provenance, not a gate
  // The `id` of the overlay that replaced this one. A superseded overlay never applies, even while its
  // status still reads "active" — activation of a successor and superseding of its predecessor happen
  // in one `updateIntentOverlays` transaction (Phase 2b/4), but resolution must not depend on that
  // write having been atomic.
  supersededBy: string | null;
}

export interface IntentOverlayStore {
  overlays: IntentOverlay[];
  updatedAt: string;
}

// What derived coaching state reads: the active overlay's verdict when one applies, else the ledger's.
export interface EffectiveOutcome {
  effectiveExecutionScore: number | null;
  origin: RideOrigin;
  source: "overlay" | "ledger";
  overlay: IntentOverlay | null;
}

// A ledger entry paired with its resolved outcome. Execution modelling AND drift accounting both read
// this same pair — resolving twice, or resolving for one and not the other, is the defect class this
// type exists to prevent.
export interface ResolvedRide {
  entry: RideScoreEntry;
  outcome: EffectiveOutcome;
}
```

- [ ] **Step 4: Create `lib/intent-overlay.ts`**

```ts
// Resolution of a ride's EFFECTIVE outcome: an active intent overlay's verdict when one applies,
// otherwise the frozen ledger entry's own score. One seam, so no consumer re-implements
// overlay-then-ledger fallback (INVARIANT 34's "gate at the producer", applied to a read path).
//
// The ledger is never rewritten (INVARIANT 1) — an overlay layers OVER it, which is what makes an
// approved correction reversible: disable the overlay and the original score is authoritative again.
//
// Pure, no I/O: the caller loads the store once and resolves many entries.

import { originOf } from "./ride-origin";
import type { EffectiveOutcome, IntentOverlay, NotScoredReason, ResolvedRide, RideScoreEntry } from "./types";

// These three reasons all mean "no trustworthy intent was recovered" — which IS the definition of
// `unspecified`. Only `no-measurable-objectives` is compatible with `self-directed`: there the intent
// was clear, the ride data simply couldn't verify it (design §6's technical-descending case).
const NO_TRUSTWORTHY_INTENT: ReadonlySet<NotScoredReason> = new Set([
  "no-intent-found",
  "interpreter-failed",
  "intent-unreliable",
]);

// An overlay whose own fields contradict each other is not trusted — better to fall back to the frozen
// ledger than to let a malformed record silently reclassify a ride or grant it a score. Fail-closed,
// matching this repo's "better absent than wrong" convention.
function isCoherent(o: IntentOverlay): boolean {
  // A missing score and a stated reason must accompany each other, in both directions.
  if ((o.effectiveExecutionScore === null) !== (o.notScoredReason !== null)) return false;
  // No trustworthy intent ⇒ unspecified. Without this an overlay could label a ride self-directed on
  // the strength of a note that couldn't be read at all, quietly exempting it from drift.
  if (o.notScoredReason && NO_TRUSTWORTHY_INTENT.has(o.notScoredReason) && o.origin !== "unspecified") return false;
  return true;
}

// Whether this overlay may affect derived state at all. Three independent gates:
//   • status === "active" — `pending` is Phase 4 work awaiting human approval; applying it early would
//     change effective state without consent (design §11.1, decision #10). `disabled` is soft-retired.
//   • supersededBy === null — a replaced overlay never applies, even if its status still reads active.
//     Resolution must not depend on the superseding write having been atomic.
//   • isCoherent — see above.
export function isApplicable(o: IntentOverlay): boolean {
  return o.status === "active" && o.supersededBy === null && isCoherent(o);
}

// Applicability is filtered BEFORE newest-wins selection, deliberately. Selecting the newest record and
// then testing it would let a `pending` successor silently suppress the `active` overlay it hasn't
// replaced yet — the correction would vanish from derived state the moment Phase 4 prepared its
// replacement, with no approval and no disable. Filtering first means the current active overlay keeps
// applying until its successor is actually approved.
function newestApplicable(overlays: IntentOverlay[], keyOf: (o: IntentOverlay) => string): Map<string, IntentOverlay> {
  const out = new Map<string, IntentOverlay>();
  for (const o of overlays) {
    if (!isApplicable(o)) continue;
    const key = keyOf(o);
    if (!key) continue;
    const prev = out.get(key);
    if (!prev || o.createdAt > prev.createdAt) out.set(key, o);
  }
  return out;
}

// Newest applicable wins, independent of array order — a store appended to over time must resolve
// deterministically regardless of how it happens to sit on disk.
export function indexOverlaysByActivity(overlays: IntentOverlay[]): Map<string, IntentOverlay> {
  return newestApplicable(overlays, (o) => o.activityId);
}

// The date-keyed fallback index, for legacy ledger rows carrying no activityId (decision #9).
export function indexOverlaysByDate(overlays: IntentOverlay[]): Map<string, IntentOverlay> {
  return newestApplicable(overlays, (o) => o.date);
}

// Overlay first, ledger second — with two hard exceptions.
//
// (1) A PRESCRIBED ride always resolves to the ledger, before any lookup. Decision #14: a post-ride
//     note can never redefine a formal session after the fact to improve its score. Enforcing that here
//     rather than trusting every future writer means a malformed or misdirected overlay cannot
//     reclassify a block session — the ledger's own `planned` flag is authoritative and independent.
// (2) Date matching applies ONLY to a row with no activityId. Letting a row that HAS an id fall back to
//     a date match would let a same-day secondary ride's overlay bind to the primary ride's entry.
export function resolveEffectiveOutcome(
  entry: RideScoreEntry,
  byActivity: Map<string, IntentOverlay>,
  byDate: Map<string, IntentOverlay>
): EffectiveOutcome {
  const ledger: EffectiveOutcome = {
    effectiveExecutionScore: entry.executionScore,
    origin: originOf(entry),
    source: "ledger",
    overlay: null,
  };
  if (entry.planned) return ledger; // decision #14 — a prescription is never displaced by a note

  const matched = entry.activityId ? byActivity.get(entry.activityId) : byDate.get(entry.date);
  if (!matched) return ledger;
  return {
    effectiveExecutionScore: matched.effectiveExecutionScore,
    origin: matched.origin,
    source: "overlay",
    overlay: matched,
  };
}

// Resolve a whole ledger once. Every consumer that needs effective outcomes — execution modelling and
// drift accounting alike — takes the result of this, so the two can never diverge on what a ride was.
export function resolveAll(entries: RideScoreEntry[], overlays: IntentOverlay[]): ResolvedRide[] {
  const byActivity = indexOverlaysByActivity(overlays);
  const byDate = indexOverlaysByDate(overlays);
  return entries.map((entry) => ({ entry, outcome: resolveEffectiveOutcome(entry, byActivity, byDate) }));
}
```

- [ ] **Step 5: Add `intent-overlays.json` to CRITICAL**

In `lib/json-store.ts`'s `CRITICAL` set (~line 25), append one entry, leaving the existing comment intact:

```ts
  // An approved overlay carries a human review decision (Phase 4) that a fresh sync cannot re-derive —
  // exactly this set's criterion. Losing one would silently revert a correction to its original score.
  "intent-overlays.json",
```

- [ ] **Step 6: Add the data-store accessors**

Extend the type import on line 4 with `IntentOverlay` and `IntentOverlayStore`, then add near `readLoadingLog` (~line 423):

```ts
// Phase 2a: the permanent intent-overlay store. Append-oriented and CRITICAL-backed — an approved
// overlay is a human decision, not a re-derivable computation. Transactional update so a sync, the
// deferred analyze step and a future review action can't clobber one another (why updateScoreLog exists).
const DEFAULT_INTENT_OVERLAYS: IntentOverlayStore = { overlays: [], updatedAt: new Date(0).toISOString() };

export async function readIntentOverlays(): Promise<IntentOverlayStore> {
  return readJson<IntentOverlayStore>("intent-overlays.json", DEFAULT_INTENT_OVERLAYS);
}

export async function updateIntentOverlays(
  mutate: (overlays: IntentOverlay[]) => IntentOverlay[] | Promise<IntentOverlay[]>
): Promise<IntentOverlayStore> {
  return updateJson<IntentOverlayStore>("intent-overlays.json", DEFAULT_INTENT_OVERLAYS, async (store) => ({
    overlays: await mutate(store.overlays),
    updatedAt: new Date().toISOString(),
  }));
}
```

- [ ] **Step 7: Run the tests, then the full check**

```bash
npx vitest run lib/intent-overlay.test.ts && npm run check
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/types.ts lib/intent-overlay.ts lib/intent-overlay.test.ts lib/json-store.ts lib/data-store.ts
git commit -m "$(cat <<'EOF'
feat(scoring): add the intent-overlay envelope, store, and resolution seam

Only `active` overlays affect derived state — `pending` is Phase 4 work awaiting
human approval, and applying one early would change effective state without
consent (design 11.1, decision 10). Envelope carries a stable id, an explicit
not-scored reason, and a NULLABLE interpretation so a missing note needs no
fabricated model/promptVersion provenance.

Date matching is restricted to rows with no activityId, so a same-day secondary
ride's overlay can't bind to the primary ride. Ships empty: every resolution
falls through to the ledger.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Stamp `activityId` onto new ledger entries

**Files:**
- Modify: `lib/score-log.ts` (both branches of `buildRideScores`)
- Test: `lib/score-log.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: entries written from now on carry `activityId`. No signature change.

Frozen historical entries are untouched (LEDGER-1) and keep `activityId: undefined`, which is why Task 2's date fallback exists.

- [ ] **Step 1: Write the failing tests**

Add to `lib/score-log.test.ts`, reusing the existing `activity()`/`block()` helpers (`activity()` takes `Partial<ActivitySummary> & { date: string }`):

```ts
describe("buildRideScores — activityId stamping (Phase 2a)", () => {
  const ftp = () => 288;

  it("stamps the activity id on a planned ride", () => {
    const b = block([{ date: "2026-01-05", type: "Z2", durationMin: 60 }]);
    const entry = buildRideScores(b, [activity({ date: "2026-01-05", id: "act-planned" })], ftp, "2026-01-10")[0];
    expect(entry.activityId).toBe("act-planned");
  });

  it("stamps the activity id on an off-plan ride", () => {
    const entry = buildRideScores(null, [activity({ date: "2026-01-05", id: "act-offplan" })], ftp, "2026-01-10", "2026-01-01")[0];
    expect(entry.activityId).toBe("act-offplan");
  });

  it("stamps the id of the ride that actually won a two-ride date", () => {
    // buildRideScores keeps the LONGER ride per date; the stamped id must be that ride's, not
    // whichever came first in the array (decision #9's primary-ride rule).
    const acts = [
      activity({ date: "2026-01-05", id: "short", movingTimeSec: 1800 }),
      activity({ date: "2026-01-05", id: "long", movingTimeSec: 5400 }),
    ];
    const entry = buildRideScores(null, acts, ftp, "2026-01-10", "2026-01-01")[0];
    expect(entry.durationMin).toBe(90);
    expect(entry.activityId).toBe("long");
  });

  it("keeps compliancePct null on an off-plan ride (decision #7)", () => {
    expect(buildRideScores(null, [activity({ date: "2026-01-05", id: "a" })], ftp, "2026-01-10", "2026-01-01")[0].compliancePct).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run lib/score-log.test.ts -t "activityId stamping"
```

Expected: FAIL — `activityId` is `undefined`.

- [ ] **Step 3: Stamp both branches**

In `lib/score-log.ts`, add `activityId: act.id,` to **both** entry-construction object literals — in the planned branch after `legacy: false,`, and in the off-plan branch after `legacy: isLegacy,`. Add this comment above the first one:

```ts
          // Phase 2a: the stable key intent overlays bind to (decision #9). `act` is already the
          // date's winning ride here (the longest — see the byDate reconciliation below), so this is
          // the primary-ride id by construction.
```

- [ ] **Step 4: Run the tests, then the full check**

```bash
npx vitest run lib/score-log.test.ts && npm run check
```

Expected: PASS including every pre-existing test — `activityId` is additive. If any pre-existing test compares a whole entry with `toEqual`, extend its expected object rather than deleting the assertion.

- [ ] **Step 5: Commit**

```bash
git add lib/score-log.ts lib/score-log.test.ts
git commit -m "$(cat <<'EOF'
feat(scoring): stamp activityId onto new ledger entries

The stable key intent overlays bind to. Frozen historical entries keep it
undefined, which is why resolution retains a date fallback for them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Resolve once — feed execution AND drift from the same outcome

**Files:**
- Modify: `lib/score-log.ts` (`summariseBehaviour`), `lib/types.ts` (`BehaviourSummary` field rename)
- Modify: `lib/athlete-model.ts` (`buildAthleteModel`)
- Test: `lib/score-log.test.ts`, `lib/athlete-model.test.ts`, `lib/athlete-state.test.ts`
- Test (fixture updates forced by the rename — **verified present, do not skip**): `lib/season.test.ts` (4 occurrences of `unplannedAvgQuality`), `lib/intervention.test.ts` (2), `lib/score-log.test.ts:846` (1 assertion). These construct literal `BehaviourSummary` objects, so `tsc --noEmit` fails until every one is renamed. Confirm the full set before editing with:
  ```bash
  grep -rn "unplannedAvgQuality" --include='*.ts' --include='*.tsx' lib/ app/ components/
  ```

**Interfaces:**
- Consumes: `countsAsDrift` (Task 1), `resolveAll` (Task 2).
- Produces:
  - `summariseBehaviour(resolved: ResolvedRide[]): BehaviourSummary` — **signature change** from `RideScoreEntry[]`
  - `BehaviourSummary.driftAvgQuality` replaces `unplannedAvgQuality`
  - `buildAthleteModel(scores, overlays?)` — optional second parameter

**This is the task the rewrite exists for.** Both the execution model and the drift signal now read one resolution. Getting this wrong is what would let a self-directed ride join the EWMA while still inflating `offPlanPct`.

> **Note on step order:** steps run test → impl → impl → test → run, rather than strict red-green per change. That is forced by compile coupling, not laziness: changing `summariseBehaviour`'s signature (Step 2) immediately breaks its only caller, `buildAthleteModel`, so the suite cannot run again until Step 3 lands. Write Step 1's tests first and confirm they fail before touching either file; after that, Steps 2 and 3 are a single compile unit and Step 5 is the green gate for both.

**Three rules this task enforces, each pinned by test:**

1. **Drift uses the EFFECTIVE origin**, never the ledger row's.
2. **Per-type stats and compliance stay prescribed-only.** A self-directed ride's `inferredType` comes from whole-ride IF — grouping by it would teach the model that a mixed climbing ride was a Threshold session, reviving the circularity Phase 1 removed. And `complianceEwma`'s `comps.length ? … : 0` would report **0% compliance** for rides that have no compliance concept (decision #7). Only `overallExecEwma`, `overallTrend` and `sampleSize` admit self-directed outcomes.
3. **`unplannedAvgQuality` → `driftAvgQuality`.** [athlete-model.ts:243](../../../lib/athlete-model.ts) renders both figures in ONE sentence (`"X% of your last N rides were off-plan (avg quality Y/10)"`). Once drift excludes self-directed rides but the quality average doesn't, that sentence describes two different populations while reading as one. `unplannedRides` stays a factual volume count — a self-directed ride genuinely had no prescription.

- [ ] **Step 1: Write the failing tests — behaviour**

Add to `lib/score-log.test.ts`. Import `ResolvedRide`/`IntentOverlay` types as needed:

```ts
describe("summariseBehaviour — drift uses the EFFECTIVE origin (Phase 2a)", () => {
  const ride = (date: string, over: Partial<RideScoreEntry> = {}): RideScoreEntry => ({
    date, executionScore: 7, plannedType: "Z2", inferredType: "Z2", planned: true, legacy: false,
    compliancePct: 100, intensityFactor: 0.68, ftpUsed: 288, durationMin: 60, tss: 60, ...over,
  });
  const resolved = (entry: RideScoreEntry, origin: RideOrigin, score: number | null = entry.executionScore): ResolvedRide => ({
    entry,
    outcome: { effectiveExecutionScore: score, origin, source: origin === "self-directed" ? "overlay" : "ledger", overlay: null },
  });

  // THE decisive test: this is exactly the state Phase 2b produces — a frozen ledger row that says
  // "unspecified" (written during LLM-free sync, before any parse) with an active overlay that says
  // "self-directed". Reading drift off the ledger row would report 50% here.
  it("excludes a ride whose LEDGER says unspecified but whose OVERLAY says self-directed", () => {
    const s = summariseBehaviour([
      resolved(ride("2026-01-01"), "prescribed"),
      resolved(ride("2026-01-02", { planned: false, compliancePct: null }), "self-directed"),
    ]);
    expect(s.offPlanPct).toBe(0);
  });

  it("still counts an unspecified ride toward drift", () => {
    const s = summariseBehaviour([
      resolved(ride("2026-01-01"), "prescribed"),
      resolved(ride("2026-01-02", { planned: false, compliancePct: null }), "unspecified"),
    ]);
    expect(s.offPlanPct).toBe(50);
  });

  it("keeps unplannedRides a factual volume count, distinct from drift", () => {
    const s = summariseBehaviour([
      resolved(ride("2026-01-01"), "prescribed"),
      resolved(ride("2026-01-02", { planned: false, compliancePct: null }), "self-directed"),
    ]);
    expect(s.unplannedRides).toBe(1); // it genuinely had no prescription — that stays true
    expect(s.plannedRides).toBe(1);
    expect(s.totalRides).toBe(2);
  });

  it("averages quality over DRIFT rides only, matching the insight sentence's population", () => {
    const s = summariseBehaviour([
      resolved(ride("2026-01-01"), "prescribed"),
      resolved(ride("2026-01-02", { planned: false, compliancePct: null, executionScore: 4 }), "unspecified"),
      resolved(ride("2026-01-03", { planned: false, compliancePct: null, executionScore: 10 }), "self-directed"),
    ]);
    expect(s.offPlanPct).toBe(33);
    expect(s.driftAvgQuality).toBe(4); // the self-directed 10 must not inflate the drift narrative
  });

  it("reports null drift quality when no ride drifted", () => {
    expect(summariseBehaviour([resolved(ride("2026-01-01"), "prescribed")]).driftAvgQuality).toBeNull();
  });

  it("reports 0% rather than dividing by zero on an all-self-directed window", () => {
    const s = summariseBehaviour([resolved(ride("2026-01-02", { planned: false, compliancePct: null }), "self-directed")]);
    expect(s.offPlanPct).toBe(0);
    expect(s.totalRides).toBe(1);
  });
});
```

- [ ] **Step 2: Change `summariseBehaviour` and the `BehaviourSummary` field**

In `lib/types.ts`, rename the field on `BehaviourSummary`:

```ts
  // Mean effective execution score across DRIFT rides only. Renamed from unplannedAvgQuality in Phase
  // 2a: deriveInsights renders it in the same sentence as offPlanPct, so once drift stopped meaning
  // "unplanned" the two had to be computed over the same population or that sentence would describe
  // two different sets of rides while reading as one.
  driftAvgQuality: number | null;
```

In `lib/score-log.ts`, add imports and rewrite the function's head:

```ts
import { countsAsDrift } from "./ride-origin";
import type { ResolvedRide } from "./types";
```

```ts
// Complete-riding-behaviour signal from ALL logged rides. Takes RESOLVED rides, not raw entries: a
// self-directed ride's origin lives on its overlay, not on the frozen ledger row (the row is written
// during LLM-free sync, before any parse exists), so computing drift from the row would count exactly
// the rides decision #1 says must never count.
export function summariseBehaviour(resolved: ResolvedRide[]): BehaviourSummary {
  const total = resolved.length;
  const plannedRides = resolved.filter((r) => r.outcome.origin === "prescribed").length;
  // Factual volume: rides that carried no prescription. Stays true of a self-directed ride, so real
  // riding never disappears from volume statistics.
  const unplannedRides = total - plannedRides;

  // DRIFT is a different question from "unplanned" (Phase 2a). Only `unspecified` structured rides.
  const driftRides = resolved.filter((r) => countsAsDrift(r.outcome.origin, r.entry.legacy));
  const offPlanPct = total > 0 ? Math.round((driftRides.length / total) * 100) : 0;

  const driftScores = driftRides
    .map((r) => r.outcome.effectiveExecutionScore)
    .filter((v): v is number => v !== null);
  const driftAvgQuality = driftScores.length
    ? round1(driftScores.reduce((s, v) => s + v, 0) / driftScores.length)
    : null;

  let weeklyHours: number | null = null;
  if (total > 0) {
    const dates = resolved.map((r) => r.entry.date).sort();
    const spanDays = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000 + 1;
    const weeks = Math.max(1, spanDays / 7);
    const totalHours = resolved.reduce((s, r) => s + r.entry.durationMin, 0) / 60;
    weeklyHours = round1(totalHours / weeks);
  }

  return { totalRides: total, plannedRides, unplannedRides, offPlanPct, driftAvgQuality, weeklyHours };
}
```

- [ ] **Step 3: Restructure `buildAthleteModel`**

In `lib/athlete-model.ts`, add:

```ts
import { resolveAll } from "./intent-overlay";
import type { IntentOverlay, ResolvedRide } from "./types";
```

Replace the function's head (currently `const sorted = …; const planned = sorted.filter((s) => s.planned && !s.compromised);`) with:

```ts
// `overlays` is optional and defaults to none — with an empty store every outcome resolves to the
// ledger, reproducing pre-Phase-2a behaviour exactly. Phase 2b threads the real store in at the live
// call sites (grep `buildAthleteModel(` — there are eight in production, three of them in sync/route.ts).
export function buildAthleteModel(scores: RideScoreEntry[], overlays: IntentOverlay[] = []): AthleteModel {
  const sorted = [...scores].sort((a, b) => a.date.localeCompare(b.date));
  // Resolve ONCE. Execution modelling and drift accounting below both read this same array — resolving
  // separately, or resolving for one and not the other, is precisely how a self-directed ride could
  // join the execution EWMA while still inflating offPlanPct.
  const resolved = resolveAll(sorted, overlays);

  // PER-TYPE + COMPLIANCE: prescribed only, in Phase 2a. A self-directed ride's `inferredType` comes
  // from whole-ride IF, so grouping by it would teach the model that a mixed climbing ride was a
  // Threshold session — the circular inference Phase 1 removed. And complianceEwma's `: 0` fallback
  // would report 0% compliance for rides that have no compliance concept (decision #7). Phase 2b can
  // revisit once an intent-derived type exists.
  const prescribed = resolved.filter((r) => r.outcome.origin === "prescribed" && !r.entry.compromised);

  // OVERALL EXECUTION: prescribed AND self-directed, when the outcome carries a real score. Execution
  // now means "how well did the athlete execute the AUTHORITATIVE intent" — the prescription when one
  // existed, the accepted self-directed intent when it didn't (decision #1). A null effective score
  // (`Not scored`, decision #3) never teaches the model; compromised sessions stay excluded.
  const overallScored = resolved.filter(
    (r) =>
      !r.entry.compromised &&
      r.outcome.effectiveExecutionScore !== null &&
      (r.outcome.origin === "prescribed" || r.outcome.origin === "self-directed")
  );

  // TWO alphas, deliberately. `autoEwmaAlpha` adapts smoothing to sample size, so a single alpha
  // derived from the overall population would let self-directed VOLUME change the smoothing of
  // prescribed-only per-type statistics — an indirect leak of exactly the influence the
  // prescribed-only split above exists to prevent. Each EWMA is smoothed by its own sample.
  const overallAlpha = autoEwmaAlpha(overallScored.length);
  const typeAlpha = autoEwmaAlpha(prescribed.length);

  const byTypeMap = new Map<WorkoutType, RideScoreEntry[]>();
  for (const r of prescribed) {
    const arr = byTypeMap.get(r.entry.inferredType) ?? [];
    arr.push(r.entry);
    byTypeMap.set(r.entry.inferredType, arr);
  }
```

In the existing `byType` loop below, replace both uses of `alpha` with `typeAlpha` (they appear in `execEwma: round1(ewma(execs, alpha))` and `complianceEwma: comps.length ? Math.round(ewma(comps, alpha)) : 0`). Then replace the tail:

```ts
  const structured = resolved.filter((r) => !r.entry.legacy);
  const recentResolved = structured.length
    ? (() => {
        const latest = structured[structured.length - 1].entry.date;
        const cutoff = addDaysIso(latest, -(RECENT_BEHAVIOUR_DAYS - 1));
        return structured.filter((r) => r.entry.date >= cutoff);
      })()
    : structured;

  const allExecs = overallScored.map((r) => r.outcome.effectiveExecutionScore as number);
  return {
    byType,
    overallExecEwma: round1(ewma(allExecs, overallAlpha)),
    overallTrend: trendOf(allExecs),
    sampleSize: overallScored.length,
    behaviour: summariseBehaviour(recentResolved),
    behaviourAllTime: summariseBehaviour(structured),
  };
}
```

Update `deriveInsights`'s reference at [athlete-model.ts:243](../../../lib/athlete-model.ts) from `b.unplannedAvgQuality` to `b.driftAvgQuality` (two occurrences on that line — the guard and the interpolation).

Then grep for other readers of the old field name and update them:

```bash
grep -rn "unplannedAvgQuality" --include='*.ts' --include='*.tsx' lib/ app/ components/
```

Expected after the change: no hits outside test files you are updating.

- [ ] **Step 4: Write the failing tests — model**

Add to `lib/athlete-model.test.ts` (extend its type import with `IntentOverlay`):

```ts
describe("buildAthleteModel — resolution feeds execution AND drift (Phase 2a)", () => {
  const scored = (date: string, over: Partial<RideScoreEntry> = {}): RideScoreEntry => ({
    date, executionScore: 8, plannedType: "Z2", inferredType: "Z2", planned: true, legacy: false,
    compliancePct: 100, intensityFactor: 0.68, ftpUsed: 288, durationMin: 60, tss: 60, ...over,
  });
  const selfDirected = (activityId: string, date: string, score: number | null): IntentOverlay => ({
    id: `ov-${activityId}`, activityId, date, noteFingerprint: "fp", status: "active",
    origin: "self-directed", effectiveExecutionScore: score, notScoredReason: score === null ? "intent-unreliable" : null,
    interpretation: null, schemaVersion: 1, createdAt: `${date}T10:00:00.000Z`, approvedAt: null, supersededBy: null,
  });

  it("omitting overlays reproduces pre-Phase-2a behaviour", () => {
    const entries = [scored("2026-01-01"), scored("2026-01-02", { planned: false, compliancePct: null })];
    expect(buildAthleteModel(entries).sampleSize).toBe(1);
    expect(buildAthleteModel(entries).sampleSize).toBe(buildAthleteModel(entries, []).sampleSize);
  });

  it("admits a self-directed outcome into overall execution, using the OVERLAY's score", () => {
    const entries = [scored("2026-01-01"), scored("2026-01-02", { planned: false, compliancePct: null, activityId: "a2", executionScore: 4 })];
    const model = buildAthleteModel(entries, [selfDirected("a2", "2026-01-02", 9)]);
    expect(model.sampleSize).toBe(2);
    expect(model.overallExecEwma).toBeGreaterThan(8); // not the ledger's frozen 4
  });

  it("and simultaneously excludes it from drift — the two must agree", () => {
    const entries = [scored("2026-01-01"), scored("2026-01-02", { planned: false, compliancePct: null, activityId: "a2" })];
    const model = buildAthleteModel(entries, [selfDirected("a2", "2026-01-02", 9)]);
    expect(model.behaviour.offPlanPct).toBe(0);
    expect(model.behaviour.unplannedRides).toBe(1); // still factually unplanned
  });

  it("keeps a self-directed ride OUT of per-type stats (its inferredType came from whole-ride IF)", () => {
    const entries = [
      scored("2026-01-01", { inferredType: "Threshold", plannedType: "Threshold" }),
      scored("2026-01-02", { planned: false, compliancePct: null, activityId: "a2", inferredType: "Threshold" }),
    ];
    const model = buildAthleteModel(entries, [selfDirected("a2", "2026-01-02", 9)]);
    const threshold = model.byType.find((t) => t.type === "Threshold");
    expect(threshold?.n).toBe(1); // only the prescribed ride teaches type-level statistics
  });

  it("leaves prescribed per-type statistics bit-identical when self-directed volume is added", () => {
    // The indirect leak the two-alpha split closes: autoEwmaAlpha adapts to sample size, so a single
    // shared alpha would let self-directed VOLUME change the smoothing of prescribed-only type stats
    // without any self-directed ride ever entering a type group.
    const prescribedRides = [
      scored("2026-01-01", { inferredType: "Z2", plannedType: "Z2", executionScore: 6 }),
      scored("2026-01-03", { inferredType: "Z2", plannedType: "Z2", executionScore: 9 }),
      scored("2026-01-05", { inferredType: "Threshold", plannedType: "Threshold", executionScore: 7 }),
    ];
    const extra = Array.from({ length: 6 }, (_, i) =>
      scored(`2026-02-${String(i + 1).padStart(2, "0")}`, {
        planned: false, compliancePct: null, activityId: `sd${i}`, inferredType: "Z2",
      })
    );
    const overlays = extra.map((e, i) => selfDirected(`sd${i}`, e.date, 9));

    const before = buildAthleteModel(prescribedRides);
    const after = buildAthleteModel([...prescribedRides, ...extra], overlays);

    expect(after.sampleSize).toBeGreaterThan(before.sampleSize); // overall execution DID change
    expect(after.byType).toEqual(before.byType); // ...but per-type statistics did not, at all
  });

  it("never lets a self-directed ride produce a 0% compliance group (decision #7)", () => {
    const entries = [scored("2026-01-02", { planned: false, compliancePct: null, activityId: "a2", inferredType: "VO2max" })];
    const model = buildAthleteModel(entries, [selfDirected("a2", "2026-01-02", 9)]);
    expect(model.byType.find((t) => t.type === "VO2max")).toBeUndefined();
  });

  it("never admits a Not-scored outcome (decision #3)", () => {
    const entries = [scored("2026-01-01"), scored("2026-01-02", { planned: false, compliancePct: null, activityId: "a2" })];
    expect(buildAthleteModel(entries, [selfDirected("a2", "2026-01-02", null)]).sampleSize).toBe(1);
  });

  it("ignores a pending overlay entirely — execution and drift both fall back to the ledger", () => {
    const entries = [scored("2026-01-01"), scored("2026-01-02", { planned: false, compliancePct: null, activityId: "a2" })];
    const pending: IntentOverlay = { ...selfDirected("a2", "2026-01-02", 9), status: "pending" };
    const model = buildAthleteModel(entries, [pending]);
    expect(model.sampleSize).toBe(1);
    expect(model.behaviour.offPlanPct).toBe(50);
  });

  it("still excludes compromised sessions, self-directed or not", () => {
    const entries = [scored("2026-01-01"), scored("2026-01-02", { planned: false, compliancePct: null, activityId: "a2", compromised: true })];
    expect(buildAthleteModel(entries, [selfDirected("a2", "2026-01-02", 9)]).sampleSize).toBe(1);
  });
});
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run lib/score-log.test.ts lib/athlete-model.test.ts
```

Expected: PASS. Pre-existing `summariseBehaviour` tests will need their fixtures wrapped as `ResolvedRide`s — that is a mechanical adaptation to the signature change, not a semantic one; keep every existing assertion's expected value unchanged. If any expected value has to move, stop: that means the change altered behaviour on ledger-only data, which it must not.

- [ ] **Step 6: Prove the fix reaches `evalBehaviour` without touching `athlete-state.ts`**

Add to `lib/athlete-state.test.ts`, matching the file's existing helper signatures (read them first — do not invent new helpers):

```ts
it("does not fire the plan-adherence driver on self-directed volume (Phase 2a)", () => {
  // evalBehaviour reads model.behaviour.offPlanPct, now computed from effective origins — so this is
  // fixed at the producer, with no change to athlete-state.ts.
  const entries = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    executionScore: 7, plannedType: null, inferredType: "Z2" as const, planned: false, legacy: false,
    compliancePct: null, intensityFactor: 0.7, ftpUsed: 288, durationMin: 90, tss: 80,
    activityId: `a${i}`,
  }));
  const overlays = entries.map((e) => ({
    id: `ov-${e.activityId}`, activityId: e.activityId!, date: e.date, noteFingerprint: "fp",
    status: "active" as const, origin: "self-directed" as const, effectiveExecutionScore: 7,
    notScoredReason: null, interpretation: null, schemaVersion: 1,
    createdAt: `${e.date}T10:00:00.000Z`, approvedAt: null, supersededBy: null,
  }));
  const model = buildAthleteModel(entries, overlays);
  expect(model.behaviour.offPlanPct).toBe(0);
  const state = computeAthleteState(athleteStateInputsFrom(sync([]), model, null, iso(0)));
  expect(state?.drivers.some((d) => d.key === "behaviour")).toBe(false);
});
```

- [ ] **Step 7: Run the full check and commit**

```bash
npm run check
```

```bash
git add lib/types.ts lib/score-log.ts lib/score-log.test.ts lib/athlete-model.ts lib/athlete-model.test.ts lib/athlete-state.test.ts lib/season.test.ts lib/intervention.test.ts
git commit -m "$(cat <<'EOF'
fix(scoring): resolve effective outcomes once, feeding execution AND drift

A self-directed ride's origin lives on its overlay, not the frozen ledger row —
the row is written during LLM-free sync, before any parse exists. Computing
drift from the row would have counted exactly the rides decision #1 says must
never count, even as they joined the execution EWMA.

summariseBehaviour now takes resolved rides. Per-type stats and compliance stay
prescribed-only: a self-directed ride's inferredType comes from whole-ride IF,
and complianceEwma's zero fallback would report 0% for rides with no compliance
concept. unplannedAvgQuality becomes driftAvgQuality so it shares a population
with offPlanPct, which deriveInsights renders in the same sentence.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Prove inertness against the real ledger, then docs

**Files:**
- Create (temporary, never committed): `lib/_verify-p2a.test.ts`
- Modify: `docs/INVARIANTS.md`, `docs/systems/02-scoring-and-learning.md`, `docs/FILE_INDEX.md`, `ROADMAP.md`

**Why:** every test so far uses synthetic fixtures. They cannot prove this phase leaves the athlete's **actual** ~400-entry frozen ledger reading exactly as before — the central claim of an infrastructure-only phase.

**Safety boundary:** read `/Users/otis/Cycling App/data/score-log.json` with a plain `readFileSync`. Never run a git command in that directory, never `cd` there, never write there.

- [ ] **Step 1: Write and run the disposable check**

```ts
// lib/_verify-p2a.test.ts — TEMPORARY, delete in Step 2. Proves Phase 2a is inert on the real ledger.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { buildAthleteModel } from "./athlete-model";
import type { ScoreLog } from "./types";

const LEDGER = process.env.SCORE_LOG_PATH ?? "/Users/otis/Cycling App/data/score-log.json";

describe("Phase 2a — inert against the real frozen ledger", () => {
  it("reproduces the pre-2a execution model and drift percentage exactly", () => {
    const { entries } = JSON.parse(readFileSync(LEDGER, "utf8")) as ScoreLog;
    console.log(`ledger entries: ${entries.length}`);
    console.log(`entries already carrying activityId: ${entries.filter((e) => e.activityId !== undefined).length} (expect 0 pre-2a)`);

    const model = buildAthleteModel(entries); // no overlays — the shipped state
    const expectedSample = entries.filter((e) => e.planned && !e.compromised).length;
    console.log(`sampleSize=${model.sampleSize} (pre-2a formula: ${expectedSample})`);
    expect(model.sampleSize).toBe(expectedSample);

    const structured = entries.filter((e) => !e.legacy);
    const oldOffPlanPct = structured.length
      ? Math.round((structured.filter((e) => !e.planned).length / structured.length) * 100)
      : 0;
    console.log(`behaviourAllTime.offPlanPct=${model.behaviourAllTime.offPlanPct} (pre-2a formula: ${oldOffPlanPct})`);
    expect(model.behaviourAllTime.offPlanPct).toBe(oldOffPlanPct);

    console.log(`overallExecEwma=${model.overallExecEwma} trend=${model.overallTrend}`);
    console.log(`driftAvgQuality=${model.behaviourAllTime.driftAvgQuality}`);
    // With no overlays every ride resolves to its ledger row, so drift quality must equal the old
    // unplanned-quality average over the same population.
    const oldUnplanned = structured.filter((e) => !e.planned).map((e) => e.executionScore);
    const oldAvg = oldUnplanned.length
      ? Math.round((oldUnplanned.reduce((s, v) => s + v, 0) / oldUnplanned.length) * 10) / 10
      : null;
    expect(model.behaviourAllTime.driftAvgQuality).toBe(oldAvg);
  });
});
```

```bash
npx vitest run lib/_verify-p2a.test.ts
```

Expected: PASS. **If any assertion fails, STOP and report** — that means this phase changed historical behaviour, which it must not. Do not adjust the test to match.

- [ ] **Step 2: Record the numbers in the report, then delete the script**

```bash
rm lib/_verify-p2a.test.ts && git status --short lib/_verify-p2a.test.ts
```

Expected: no output.

- [ ] **Step 3: Add the invariants**

Append a new trailing section to `docs/INVARIANTS.md` (Phase 1 added `## Aerobic comparability` last; add after it so numbering stays monotonic in reading order):

```markdown
## Ride origin & intent overlays

36. **Ride origin is derived or asserted by an overlay — never stored on the ledger.** A frozen row can
    only be `prescribed` or `unspecified` (`originOf`, `lib/ride-origin.ts`); `self-directed` is
    asserted exclusively by an active intent overlay. Storing it would create a second source of truth
    able to disagree with the overlay, because the row is written during LLM-free sync and frozen
    before any intent parse runs.
37. **Drift is computed from the EFFECTIVE origin, never a raw ledger row.** `countsAsDrift` takes an
    origin rather than an entry precisely so a caller cannot pass a row by accident. A self-directed
    ride must never increase `offPlanPct` (decision #1) — and since its ledger row says `unspecified`,
    reading the row is exactly how that guarantee breaks. `summariseBehaviour` takes `ResolvedRide[]`;
    `buildAthleteModel` resolves once and feeds execution and behaviour the same array.
38. **An overlay applies only when `status === "active"`, `supersededBy === null`, and its own fields
    cohere** (`isApplicable`, `lib/intent-overlay.ts`). `pending` is Phase 4 work awaiting human
    approval — applying one early changes effective state without consent (design §11.1, decision #10).
    Applicability is filtered **before** newest-wins selection, so a pending successor can never
    suppress the live correction it hasn't replaced. Coherence means: a null score and a
    `notScoredReason` accompany each other, and `no-intent-found` / `interpreter-failed` /
    `intent-unreliable` may only carry origin `unspecified` — an overlay must not claim `self-directed`
    on the strength of a note nothing could read. An incoherent overlay falls back to the ledger.
39. **A prescribed ride always resolves to the ledger.** `resolveEffectiveOutcome` returns before any
    overlay lookup when `entry.planned` is true. Decision #14 — a post-ride note can never redefine a
    formal session — is enforced at the seam, not merely trusted to whichever code writes overlays, so
    a malformed or misdirected record cannot reclassify a block session or replace its score.
40. **Self-directed outcomes join overall execution only.** `overallExecEwma`, `overallTrend` and
    `sampleSize` admit them; per-type statistics and compliance stay prescribed-only, because a
    self-directed ride's `inferredType` is derived from whole-ride IF (grouping by it revives the
    circularity INVARIANT 35 forbids) and it carries no compliance by decision #7. The two EWMAs use
    **separate alphas** (`overallAlpha` / `typeAlpha`): `autoEwmaAlpha` adapts to sample size, so one
    shared alpha would let self-directed volume change prescribed-only smoothing indirectly.
```

- [ ] **Step 4: Update the systems doc**

Add to `docs/systems/02-scoring-and-learning.md`'s existing `## Known rough edges` section (added by Phase 1):

```markdown
- **Phase 2a is infrastructure — nothing is classified `self-directed` yet.** The origin taxonomy,
  overlay envelope and `resolveEffectiveOutcome` seam landed 2026-08-07, but only Phase 2b's intent
  parser can assert `self-directed`, so the overlay store ships empty and every resolution falls
  through to the ledger. Verified inert against the real ledger: `sampleSize`, `offPlanPct` and
  `driftAvgQuality` are unchanged. Don't "activate" it by loosening a gate — 2b supplies the producer.
- **Per-type learning deliberately excludes self-directed rides.** Their `inferredType` comes from
  whole-ride IF, so grouping by it would teach the model that a mixed climbing ride was a Threshold
  session. Revisit only when 2b provides an intent-derived type; see INVARIANT 39.
```

- [ ] **Step 5: Update `docs/FILE_INDEX.md` and `ROADMAP.md`**

`FILE_INDEX.md` — add rows for `lib/ride-origin.ts` ("origin derivation + the drift rule") and `lib/intent-overlay.ts` ("overlay envelope + effective-outcome resolution"); note `data/intent-overlays.json` wherever `data/` stores are listed. Match the existing column shape.

`ROADMAP.md` — update the existing "Adaptive self-directed coach — Phase 2" row in `## Then`: 2a landed as infrastructure (no behavioural change), 2b (parser) and 2c (re-analysis + UI) remain. Keep the table's 1–2 line discipline; link this plan. Do not renumber IDs (INVARIANT 26).

- [ ] **Step 6: Run the full check and commit**

```bash
npm run check
```

Expected: PASS. Confirm `lib/_verify-p2a.test.ts` is gone first — it would fail anywhere without this athlete's `score-log.json`.

```bash
git add docs/INVARIANTS.md docs/systems/02-scoring-and-learning.md docs/FILE_INDEX.md ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: record the ride-origin and intent-overlay contracts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## What Phase 2b consumes

- `updateIntentOverlays(mutate)` — the transactional writer. Auto-accepted future rides are created `status: "active"`; Phase 4's historical preparation creates `status: "pending"`. **Activating a successor and setting the predecessor's `supersededBy` must happen in one `updateIntentOverlays` call** — though resolution does not depend on that atomicity, since a superseded overlay is rejected regardless of its status.
- `IntentOverlay` — 2b fills `id` (`crypto.randomUUID()`), `noteFingerprint`, `origin`, `effectiveExecutionScore`, `notScoredReason`, `scoringVersion`, `interpretation` (or `null` for a deterministic missing note), `schemaVersion`.

  **`origin` is NOT always `self-directed`** — it follows the recovered intent, and `isApplicable` rejects an overlay that gets this wrong:

  | Outcome | `origin` | `effectiveExecutionScore` | `notScoredReason` |
  |---|---|---|---|
  | No note at all | `unspecified` | `null` | `no-intent-found` |
  | Parse errored | `unspecified` | `null` | `interpreter-failed` |
  | Intent too unreliable to trust | `unspecified` | `null` | `intent-unreliable` |
  | Intent clear, nothing measurable | `self-directed` | `null` | `no-measurable-objectives` |
  | Intent clear and measurable | `self-directed` | number | `null` |

  The distinction matters beyond bookkeeping: only `self-directed` is exempt from drift. Labelling an unreadable note `self-directed` would quietly excuse a ride from the off-plan signal.
- `resolveAll(entries, overlays)` / `buildAthleteModel(scores, overlays)` — 2b threads the real store through **eight** production call sites: `lib/coach-snapshot.ts:335`, `lib/season-signals.ts:67`, `app/api/generate/route.ts:182`, `app/api/write/route.ts:277`, `app/api/trends/route.ts:111`, and three in `app/api/sync/route.ts` (`:111`, `:720`, `:960`). Re-grep before assuming that list is current.
- `PROMPT_VERSION` is `6` in `lib/anthropic-api.ts` — 2b's new call site bumps it and must add its model id to `lib/ai-usage.ts`'s `PRICING` (INVARIANT 18: an unknown id silently records $0).

Four questions 2b/Phase 4 must answer that 2a deliberately does not:

1. **What makes an intent "scoreable"** — decision #8 lists the deterministic checks (explicit durations? zones/power stated? phase order? measurable objectives? do extracted numbers appear in the note?) but not the threshold combining them. The LLM's own confidence may only downgrade, never promote.
2. **Where the parse runs.** Decision #12 requires it work for any newly-synced or changed activity, not just today, while INVARIANT 23 keeps sync LLM-free. `/api/analyze` is today-only (`addCoachNote` early-returns unless `analysis.activityDate === today`), so 2b needs a widened or sibling route.
3. **Whether per-type learning should admit self-directed rides** once an intent-derived type exists (INVARIANT 40's explicit revisit point). That needs an authoritative `effectiveWorkoutType` on the overlay, designed in 2b — not inferred from IF.
4. **Which ride owns a legacy multi-ride date.** 2a's date fallback selects the newest *applicable* overlay for a date, which is not inherently the overlay for that date's **primary (longest) ride** — the only ride the ledger scored. Before Phase 4 writes any historical overlay, it must guarantee that a legacy date containing several rides receives at most one `active` execution overlay, and that it belongs to the reviewed primary ride. The cheapest enforcement is for Phase 4's review step to resolve the primary activity id per date (the same longest-ride rule `buildRideScores` applies) and stamp it on the overlay, so the `activityId` path matches and the date path is never exercised for it.

---

## Appendix — dispatching this plan to Codex

This plan is written to be executed by an agent that has not seen the conversation that produced it. Everything an implementer needs is in the task bodies; the prompt below supplies only orientation and the operating rules that live outside the plan file.

**Before starting**, from the primary checkout:

```bash
npm run sync
npm run start:agent-task -- codex adaptive-coach-p2a-origin-and-overlay
```

That creates an isolated worktree on `codex/adaptive-coach-p2a-origin-and-overlay` off current `origin/main`. Note that this plan file currently lives on the branch `claude/adaptive-coach-p2-intent-overlay`, which is **not** merged — so the new worktree will not contain it. Bring it across first:

```bash
cd .worktrees/codex-adaptive-coach-p2a-origin-and-overlay
git checkout claude/adaptive-coach-p2-intent-overlay -- docs/superpowers/plans/2026-08-07-adaptive-coach-p2a-origin-and-overlay.md
git add docs/superpowers/plans/2026-08-07-adaptive-coach-p2a-origin-and-overlay.md
git commit -m "docs: bring Phase 2a plan onto the implementation branch"
```

### The prompt

> You are implementing a 5-task plan in an isolated git worktree. Work from `/Users/otis/Cycling App/.worktrees/codex-adaptive-coach-p2a-origin-and-overlay` on branch `codex/adaptive-coach-p2a-origin-and-overlay`. This is not the primary checkout — commit freely here, and never run git commands against `/Users/otis/Cycling App` itself.
>
> **Read first, in this order:** `AGENTS.md` (operating law and four recurring bug classes), `docs/INVARIANTS.md` (hard contracts), then your plan: `docs/superpowers/plans/2026-08-07-adaptive-coach-p2a-origin-and-overlay.md`. Read the plan's preamble — "This phase is infrastructure", "Why this plan was rewritten before implementation", and "Global Constraints" — in full before Task 1. They explain defects a previous draft shipped, and re-introducing any of them is the main failure mode for this work.
>
> **What this builds:** deterministic infrastructure for a cycling training app's scoring engine. A ride the athlete did on their own — no training block prescribing it — is currently counted as "training is drifting off-plan," which is wrong when they stated an objective in the ride note and executed it. This phase adds the taxonomy, the permanent overlay store, and the single resolution seam that a later phase's intent parser will write into. **It deliberately changes no user-visible behaviour**: nothing is classified `self-directed` yet, the overlay store ships empty, and Task 5 verifies the athlete's real ledger reads identically before and after. That inertness is the deliverable — do not "activate" anything to make the phase feel more substantial.
>
> **Execute the tasks in order, one at a time.** Each task's steps are numbered and include the exact code to write. Follow TDD as written: write the failing tests, run them and confirm they fail for the stated reason, then implement, then confirm green. Run `npm run check` (`tsc --noEmit && eslint && vitest run`) before each commit. Commit after every task using the exact commit message in that task's final step, staging only the files that task names — never `git add -A`.
>
> **Where the plan and reality disagree, stop and report rather than improvising.** Line numbers in the plan were accurate when written but may have drifted; locate code by content, and say so in your report when a cited line moved. If a *pre-existing* test breaks in a way the plan did not predict, do not adjust its expected value to make it pass — that would mean the change altered behaviour it must not. Report it.
>
> Specific traps this plan calls out, all of which a previous draft got wrong:
> - Drift must be computed from the **effective** origin (overlay-resolved), never from a raw ledger row. The ledger is frozen at `unspecified` before any parse runs, so reading the row is exactly how the guarantee breaks.
> - Only `status: "active"` overlays with `supersededBy === null` and coherent fields may affect anything, and applicability is filtered **before** newest-wins selection.
> - Per-type statistics and compliance stay prescribed-only, with a **separate alpha** from the overall EWMA.
> - Task 4's field rename breaks fixtures in `lib/season.test.ts` and `lib/intervention.test.ts`. Grep first; `tsc` fails until all of them are updated.
> - Task 5's temporary verification script must be deleted before the final commit and must never be staged.
>
> **Do not run `npm run finish:agent-task`.** Stop after Task 5's commit and report. A Claude review gates this branch before it merges (`WORKFLOW.md § Reviewing a codex PR`).
>
> When done, report: which tasks completed, the commit SHAs, `npm run check` output, the real numbers Task 5's verification script printed, anything where the plan and the code disagreed, and anything you were unsure about.

### After Codex finishes

Ask a Claude session: **"review PR #`<n>`"** — or, if Codex stopped before opening a PR, **"review the `codex/adaptive-coach-p2a-origin-and-overlay` branch against its plan."** The review reads the real diff against this plan's tasks, `docs/INVARIANTS.md`, and AGENTS.md's four recurring bug classes, and specifically re-verifies that the decisive tests exercise what they claim — a green suite whose fixtures encode the wrong expectation is the failure mode this plan's own history demonstrates twice.
