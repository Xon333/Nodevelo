# Phase 1 retrospective & turnover trust contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the block-closeout trust boundary so a deterministic closeout (evidence + proposed
seeds + history entry) works without Claude, progression decisions require meaningful execution/
compliance evidence rather than uncapped duration ratios, and NOTHING authored or proposed at
closeout influences another block without explicit athlete adoption.

**Architecture:** One new pure module (`lib/block-closeout.ts`) owns all closeout math at the seam
between `/api/retrospective` and the frozen score ledger; `/api/retrospective` is reordered so
deterministic facts compute first, both Claude calls become best-effort enrichment, and the
active-block clear happens strictly last behind the existing CAS guard. Three additive optional
fields on `BlockHistoryEntry` carry the separation (`closeout` facts vs `retrospective` narrative vs
`reflectionsApprovedAt` approval stamp); seed approval lives IN the retro markdown as a
`seeds_approved:` frontmatter flag so the athlete's hand-edit steering keeps working unchanged.
Generation injects reflections only from the newest reflection-bearing entry AND only when its
truthy stamp is present. No new store, no new LLM call site, no prompt-text change, no
PROMPT_VERSION bump.

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript 5, Vitest + Testing Library. No new
dependencies.

## Global Constraints

Restate the accepted review boundaries ([review §Retrospective and turnover](../../../docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md),
decisions #49–51) plus repo law. Every task implicitly inherits them.

- **A normal completed block or an explicit early-end decision precedes closeout.** Gate:
  `isBlockFinished(block, today)` OR request carries `{ endedEarly: true, endReason: <non-empty
  after trim> }`. Otherwise 409 BEFORE any write. No silent closeouts of mid-flight blocks.
- **Minimal deterministic closeout works without Claude.** `isAnthropicConfigured()` false
  (= `ANTHROPIC_API_KEY` unset, `lib/anthropic-config.ts:3`) must not prevent evidence collection,
  markdown persistence, history append, or the block clear. The hard `400 Anthropic API is not
  configured.` preflight is deleted. Narrative absence reaches the UI as `retrospective: null` —
  never as a blank success card.
- **Progression evidence is execution + capped compliance, never raw duration ratio alone.**
  Compliance figures come from frozen `RideScoreEntry.compliancePct` — already
  `resolveCompliance`-capped by execution (INVARIANT 25). The route's inline uncapped
  `actualMin / day.durationMin * 100` math is deleted, not kept alongside.
- **Large overshoots cannot imply "safe to progress".** A session whose scored ride ran past
  `CLOSEOUT_OVERSHOOT_RATIO` (>1.25× planned duration) is recorded as an overshoot fact; any type
  containing one is barred from progression seeds regardless of capped numbers.
- **Overshoot is attributed to the ride the LEDGER scored** (INVARIANT 52's primary-ride rule):
  match the activity via `entry.activityId`, falling back to `primaryRideOfDate` only for legacy
  rows without an id — never "first activity on that date".
- **An early end closes out only lived days.** Evidence covers planned days ≤
  `min(today, block.endDate)`; days after the effective closeout date are excluded entirely, never
  counted as missed.
- **Facts, narrative, and seeds stay separate fields/artifacts.** `BlockHistoryEntry.closeout`
  (deterministic), `.retrospective` (optional Claude prose), `.nextBlockSeeds` (deterministic
  proposals mirrored into the markdown frontmatter). Never merge them into one blob.
- **Nothing steers the next block without explicit athlete adoption.** Reflections: generation
  injects only from an entry with truthy `reflectionsApprovedAt` — and considers ONLY the newest
  reflection-bearing entry (an older approved entry never masquerades as "FROM LAST BLOCK" once a
  newer unapproved one exists; no silent fallback). Seeds: `next_block_seeds` steer only once the
  markdown carries `seeds_approved: true`; hand edits to the list remain live (the file stays the
  single source of truth for seeds).
- **Adoption itself is failure-safe.** `/api/history`'s POST derives the retro filename from the
  history entry, flips the markdown BEFORE stamping, and both steps are idempotent — a failure at
  any point leaves a state a plain retry completes; it can never strand "stamped but never
  seed-approved" behind a 409.
- **The score ledger stays frozen (INVARIANT 1).** Closeout only READS `score-log.json`.
- **Existing JSON/markdown without new fields remains readable (INVARIANT 3).** All new
  `BlockHistoryEntry` fields are optional; every read site uses truthy checks. Old retro files
  without `seeds_approved:` parse as unapproved ([]), never throw.
- **Failures cannot clear the active block before durable closeout succeeds.** Write order inside
  the route: retro markdown → `appendBlockHistory` → CAS-guarded
  `updateCurrentBlock(() => null, expectedCreatedAt)` LAST. Any throw before the clear leaves the
  active block intact.
- **A degraded closeout's history entry is protected like a rich one.** `appendBlockHistory`'s
  HR-37 collision rule treats an entry carrying `closeout` (even with no `retrospective`) as rich,
  so a racing bare archive cannot wipe evidence/seeds/reflections.
- **No prompt text changes, therefore no PROMPT_VERSION bump.** `buildRetrospectivePrompt` /
  `buildStructuredRetrospectivePrompt` signatures and text are untouched; only the *values* fed
  through existing `overallCompliancePct` / `complianceByType` inputs change (now capped).
  `formatReflectionsForPrompt`'s wording stays as-is — with adoption gating, "your own clinical
  notes" becomes accurate rather than misleading (INVARIANTS 16/54 considered; documented decision
  NOT to bump).
- **"Today" is local** (`resolveToday(b.today)`, INVARIANT 10); reuse the route's existing binding.
- **Live smoke runs are attended and reversible.** The normal-path smoke follows RECIPES' backup-
  first turnover discipline; the degraded-mode smoke uses an explicitly isolated throwaway block
  with exact creation, verification, and restore steps (Task 14) — never improvisation against live
  data.

---

## Task 0: Confirm baseline

**Files:** none (verification only).

- [ ] **Step 0.1: Verify branch and anchors**

Run:

```bash
git branch --show-current                                              # codex/* task branch (worktree)
grep -n "export function resolveCompliance" lib/execution-score.ts     # ~373
grep -n "isAnthropicConfigured())" app/api/retrospective/route.ts      # preflight to delete (~43)
grep -n "formatReflectionsForPrompt" app/api/generate/route.ts         # ~169
grep -n "export function primaryRideOfDate" lib/intent-queue.ts        # ~78 (pure module — safe import)
grep -n "existing?.retrospective && !entry.retrospective" lib/data-store.ts   # HR-37 winner rule ~285
grep -rn "safe to progress" app/api/retrospective/route.test.ts        # seed assertions to rewrite
```

Expected: all six greps match. Read `app/api/retrospective/route.ts` and
`app/api/retrospective/route.test.ts` in full before Task 6 — the tests encode HR-32/33/35 behavior
that must survive unchanged except where a step below explicitly rewrites it.

---

## Task 1: Types — closeout shapes + additive `BlockHistoryEntry` fields

**Files:**
- Modify: `lib/types.ts` (add shapes near `StructuredReflection` ~line 650; extend `BlockHistoryEntry`)

**Interfaces:**
- Produces (all optional on stored JSON; absent ⇒ falsy ⇒ unapproved/unrecorded):

```ts
// ---------- Block closeout (Phase 1 trust contract) ----------
// Deterministic facts computed by lib/block-closeout.ts from the FROZEN score ledger. Compliance
// figures are resolveCompliance-capped; overshoot counts sessions whose scored ride ran past
// CLOSEOUT_OVERSHOOT_RATIO of prescription. Stored verbatim on BlockHistoryEntry.closeout.
export interface CloseoutTypeEvidence {
  type: WorkoutType;
  planned: number;                  // days with durationMin > 0 on/before the closeout date
  scored: number;                   // with a matching frozen ledger row
  missed: number;                   // planned but with no frozen score
  meanExecution: number | null;     // null when scored === 0
  meanCompliancePct: number | null; // ledger values only — never raw duration ratios
  overshootDays: string[];          // ISO dates whose SCORED ride overshot prescription
}

export interface CloseoutEvidence {
  perType: CloseoutTypeEvidence[];
  plannedSessions: number;
  scoredSessions: number;
  missedSessions: number;
  overshootSessions: number;
  overallMeanExecution: number | null;
  overallMeanCompliancePct: number | null;
}
```

Extend `BlockHistoryEntry` (after `structuredReflections`, ~line 667):

```ts
  // Phase 1 trust contract — all three absent on entries written before this shipped; read sites
  // MUST truthy-check, never compare against null/undefined (INVARIANT 3).
  closeout?: CloseoutEvidence;        // deterministic facts (shape above), frozen at closeout
  retrospective?: string;             // (exists) optional Claude prose — absent in degraded closeouts
  reflectionsApprovedAt?: string;     // ISO instant; set ONLY by POST /api/history adoption action
  endedEarlyAt?: string;              // ISO instant when closeout was an explicit early end
  endedEarlyReason?: string;          // the athlete-typed reason recorded with the early end
```

Note the ownership direction: the two interfaces LIVE in `types.ts` (mirroring how
`StructuredReflection` lives here while `retrospective-schema.ts` mirrors its shape);
`lib/block-closeout.ts` imports them from `./types`. `types.ts` imports nothing from
`block-closeout.ts` — no cycle.

- [ ] **Step 1.1: Apply the type edits above** (add both interfaces after `StructuredReflection`;
  add the four optional fields to `BlockHistoryEntry`). Run `npx tsc --noEmit -p .`
  Expected: clean (nothing consumes them yet).

- [ ] **Step 1.2: Add the back-compat test.** In `lib/data-store.test.ts`, inside the existing
  block-history describe (near the HR-37 cases), append:

```ts
  it("Phase 1: an entry written before closeout/approval fields existed reads back with them undefined", async () => {
    const legacy = entry("legacy-id", {}); // entry() helper builds a pre-Phase-1-shaped record
    delete (legacy as Partial<BlockHistoryEntry>).closeout;
    await appendBlockHistory(legacy);
    const out = await readBlockHistory();
    expect(out.find((e) => e.id === "legacy-id")?.closeout).toBeUndefined();
    expect(out.find((e) => e.id === "legacy-id")?.reflectionsApprovedAt).toBeUndefined();
    expect(out.find((e) => e.id === "legacy-id")?.endedEarlyAt).toBeUndefined();
  });
```

(The local `entry()` helper in that file constructs a valid `BlockHistoryEntry`; the deletes make
the pre-phase-1 shape explicit even if the helper later grows defaults.)

- [ ] **Step 1.3: Run**

Run: `npx vitest run lib/data-store.test.ts`
Expected: PASS (including the new case).

- [ ] **Step 1.4: Commit**

```bash
git add lib/types.ts lib/data-store.test.ts
git commit -m "feat(types): closeout evidence shapes + additive approval/early-end fields"
```

---

## Task 2: `lib/block-closeout.ts` — deterministic evidence module (TDD)

Deep module at the closeout seam: callers pass plain data, receive the complete separated fact set
and proposed seeds. Pure — no IO, no clock, no LLM. All route-side closeout math moves here.

**Files:**
- Create: `lib/block-closeout.ts`
- Create: `lib/block-closeout.test.ts`

**Interfaces:**
- Consumes: `CloseoutEvidence`/`CloseoutTypeEvidence` + entity types from `./types`;
  `primaryRideOfDate` from `./intent-queue` (verified pure: only `node:crypto` + types);
  `round1` from `./stats`.
- Produces:

```ts
export const CLOSEOUT_OVERSHOOT_RATIO = 1.25;
export function buildCloseoutEvidence(
  block: CurrentBlock,
  entries: RideScoreEntry[],
  activities: ActivitySummary[],
  throughIso: string                      // evidence window: planned days <= throughIso ONLY
): CloseoutEvidence;
export function deriveCloseoutSeeds(
  evidence: CloseoutEvidence,
  ctlStart: number | null,
  ctlEnd: number | null,
  curveSeed: string | null
): string[];
```

- [ ] **Step 2.1: Write the failing test file** (complete contents):

```ts
import { describe, expect, it } from "vitest";
import {
  CLOSEOUT_OVERSHOOT_RATIO,
  buildCloseoutEvidence,
  deriveCloseoutSeeds,
} from "./block-closeout";
import type { ActivitySummary, CloseoutEvidence, CurrentBlock, RideScoreEntry, WorkoutType } from "./types";

// ---- fixtures -------------------------------------------------------------
const block = (days: Array<{ date: string; type: WorkoutType; durationMin: number }>): CurrentBlock =>
  ({
    goal: "Build FTP",
    lengthWeeks: 2,
    startDate: days[0]?.date ?? "2026-06-01",
    endDate: "2026-06-14",
    overview: "",
    createdAt: "2026-06-01T00:00:00.000Z",
    days,
  }) as CurrentBlock;

const entry = (over: Partial<RideScoreEntry> & { date: string }): RideScoreEntry =>
  ({ planned: true, executionScore: 7, compliancePct: 100, plannedType: "Z2", ...over }) as RideScoreEntry;

const act = (id: string, date: string, minutes: number): ActivitySummary =>
  ({ id, date, movingTimeSec: minutes * 60 }) as ActivitySummary;

const day = (date: string, type: WorkoutType, durationMin: number) => ({ date, type, durationMin });

// ---- buildCloseoutEvidence ------------------------------------------------

describe("buildCloseoutEvidence", () => {
  it("takes compliance from the frozen ledger, never the raw duration ratio", () => {
    const ev = buildCloseoutEvidence(
      block([day("2026-06-02", "Threshold", 60)]),
      [entry({ date: "2026-06-02", plannedType: "Threshold", executionScore: 8, compliancePct: 100 })],
      [act("a1", "2026-06-02", 96)], // ridden 160% of prescription
      "2026-06-14"
    );
    expect(ev.overallMeanCompliancePct).toBe(100); // capped ledger value, NOT 160
    expect(ev.overallMeanExecution).toBe(8);
    expect(ev.scoredSessions).toBe(1);
    expect(ev.overshootSessions).toBe(1);
  });

  it("attributes overshoot to the ride the LEDGER scored, not the first same-date ride", () => {
    const ev = buildCloseoutEvidence(
      block([day("2026-06-02", "Threshold", 60)]),
      // ledger row names the 96-minute ride by id…
      [entry({ date: "2026-06-02", plannedType: "Threshold", executionScore: 8, compliancePct: 100, activityId: "long" })],
      // …but a SHORT ride sorts first on that date.
      [act("short", "2026-06-02", 20), act("long", "2026-06-02", 96)],
      "2026-06-14"
    );
    expect(ev.perType[0].overshootDays).toEqual(["2026-06-02"]);
  });

  it("does NOT flag overshoot when the scored ride stayed within prescription", () => {
    const ev = buildCloseoutEvidence(
      block([day("2026-06-02", "Threshold", 60)]),
      [entry({ date: "2026-06-02", plannedType: "Threshold", executionScore: 8, compliancePct: 100, activityId: "short" })],
      [act("short", "2026-06-02", 20), act("long", "2026-06-02", 96)], // someone ELSE rode long that day
      "2026-06-14"
    );
    expect(ev.overshootSessions).toBe(0);
  });

  it("binds legacy rows without activityId to the date's primary (longest) ride", () => {
    const ev = buildCloseoutEvidence(
      block([day("2026-06-02", "Z2", 60)]),
      [entry({ date: "2026-06-02", plannedType: "Z2", executionScore: 6, compliancePct: 95 })], // no activityId
      [act("short", "2026-06-02", 30), act("long", "2026-06-02", 130)], // 130 > 60*1.25
      "2026-06-14"
    );
    expect(ev.overshootSessions).toBe(1);
  });

  it("excludes days AFTER the closeout date entirely — an early end never counts future workouts as missed", () => {
    const ev = buildCloseoutEvidence(
      block([day("2026-06-02", "Z2", 60), day("2026-06-20", "SIT", 45)]), // second day is "future"
      [], // nothing scored
      [],
      "2026-06-08" // early-ended on the 8th
    );
    expect(ev.plannedSessions).toBe(1);
    expect(ev.missedSessions).toBe(1); // only the lived, unscored day
  });

  it("reports zero scored sessions honestly (null means, thin counts)", () => {
    const ev = buildCloseoutEvidence(
      block([day("2026-06-02", "Z2", 60), day("2026-06-05", "Z2", 60)]),
      [],
      [],
      "2026-06-14"
    );
    expect(ev.overallMeanExecution).toBeNull();
    expect(ev.overallMeanCompliancePct).toBeNull();
    expect(ev.missedSessions).toBe(2);
  });
});

// ---- deriveCloseoutSeeds --------------------------------------------------

describe("deriveCloseoutSeeds", () => {
  const base: CloseoutEvidence = {
    perType: [
      { type: "Z2", planned: 4, scored: 4, missed: 0, meanExecution: 7, meanCompliancePct: 95, overshootDays: [] },
    ],
    plannedSessions: 4, scoredSessions: 4, missedSessions: 0, overshootSessions: 0,
    overallMeanExecution: 7, overallMeanCompliancePct: 95,
  };

  it("proposes progression ONLY for a clean executed type (exec ≥ 6, compliance ≥ 85, no misses, no overshoot)", () => {
    const seeds = deriveCloseoutSeeds(base, null, null, null);
    expect(seeds.some((s) => s.includes("evidence supports progressing"))).toBe(true);
  });

  it("never proposes progression for a type with overshoot days, even with strong capped numbers", () => {
    const ev: CloseoutEvidence = {
      ...base,
      perType: [{ ...base.perType[0], overshootDays: ["2026-06-09"] }],
      overshootSessions: 1,
    };
    const seeds = deriveCloseoutSeeds(ev, null, null, null);
    expect(seeds.some((s) => s.toLowerCase().includes("progressing"))).toBe(false);
    expect(seeds.some((s) => s.includes("data signal"))).toBe(true);
    expect(seeds.some((s) => s.includes("2026-06-09"))).toBe(true);
  });

  it("bars progression when execution ran low even if completion looks high", () => {
    const ev: CloseoutEvidence = {
      ...base,
      perType: [{ ...base.perType[0], meanExecution: 3 }],
      overallMeanExecution: 3,
    };
    const seeds = deriveCloseoutSeeds(ev, null, null, null);
    expect(seeds.some((s) => s.toLowerCase().includes("progressing"))).toBe(false);
    expect(seeds.some((s) => s.includes("review session quality"))).toBe(true);
  });

  it("bars progression and reports honestly when scheduled sessions went unrecorded", () => {
    const ev: CloseoutEvidence = {
      ...base,
      perType: [{ ...base.perType[0], planned: 4, scored: 3, missed: 1 }],
      scoredSessions: 3, missedSessions: 1,
    };
    const seeds = deriveCloseoutSeeds(ev, null, null, null);
    expect(seeds.some((s) => s.includes("no recorded ride"))).toBe(true);
    expect(seeds.some((s) => s.toLowerCase().includes("progressing"))).toBe(false);
  });

  it("emits the thin-evidence seed and NO progression language when nothing scored", () => {
    const empty: CloseoutEvidence = {
      perType: [{ type: "Z2", planned: 2, scored: 0, missed: 2, meanExecution: null, meanCompliancePct: null, overshootDays: [] }],
      plannedSessions: 2, scoredSessions: 0, missedSessions: 2, overshootSessions: 0,
      overallMeanExecution: null, overallMeanCompliancePct: null,
    };
    const seeds = deriveCloseoutSeeds(empty, null, null, null);
    expect(seeds.some((s) => s.startsWith("Insufficient scored sessions"))).toBe(true);
    expect(seeds.some((s) => s.toLowerCase().includes("progressing"))).toBe(false);
  });

  it("keeps CTL observation branches and appends the curve seed verbatim last", () => {
    const high = deriveCloseoutSeeds(base, 50, 62, "Rider type: puncheur");
    expect(high.some((s) => s.includes("Strong CTL gain (+12)"))).toBe(true);
    expect(high[high.length - 1]).toBe("Rider type: puncheur");
    const low = deriveCloseoutSeeds(base, 50, 51, null);
    expect(low.some((s) => s.includes("Minimal CTL gain (+1)"))).toBe(true);
  });
});
```

- [ ] **Step 2.2: Run, verify failure**

Run: `npx vitest run lib/block-closeout.test.ts`
Expected: FAIL — `Cannot find module './block-closeout'`.

- [ ] **Step 2.3: Implement `lib/block-closeout.ts`** (complete contents):

```ts
// Phase 1 trust contract (review decisions #49–51): the ONE place block-closeout math lives.
// Pure and deterministic — no IO, no clock, no LLM. Compliance figures come ONLY from the frozen
// ledger (already resolveCompliance-capped by execution, INVARIANT 25); raw duration ratios are
// used exclusively to DETECT overshoot, never to grade it. Overshoot binds to the ride the ledger
// scored (INVARIANT 52's primary-ride rule), never "first activity on the date".
import { primaryRideOfDate } from "./intent-queue";
import { round1 } from "./stats";
import type {
  ActivitySummary,
  CloseoutEvidence,
  CloseoutTypeEvidence,
  CurrentBlock,
  RideScoreEntry,
  WorkoutType,
} from "./types";

export const CLOSEOUT_OVERSHOOT_RATIO = 1.25;

interface TypeAccumulator {
  type: WorkoutType;
  planned: number;
  scores: number[];
  compliances: number[];
  missed: number;
  overshootDays: string[];
}

export function buildCloseoutEvidence(
  block: CurrentBlock,
  entries: RideScoreEntry[],
  activities: ActivitySummary[],
  throughIso: string
): CloseoutEvidence {
  const acc = new Map<WorkoutType, TypeAccumulator>();
  for (const d of block.days) {
    if (d.durationMin <= 0 || d.date > throughIso) continue; // future days: excluded, never "missed"
    const t = acc.get(d.type) ?? { type: d.type, planned: 0, scores: [], compliances: [], missed: 0, overshootDays: [] };
    t.planned += 1;
    const row = entries.find((e) => e.planned && e.date === d.date);
    if (row && row.executionScore !== null) {
      t.scores.push(row.executionScore);
      if (row.compliancePct !== null) t.compliances.push(row.compliancePct);
      // INVARIANT 52: judge the ride the ledger actually scored.
      const scoredActivity = row.activityId
        ? activities.find((a) => a.id === row.activityId)
        : primaryRideOfDate(activities, d.date);
      if (scoredActivity && scoredActivity.movingTimeSec / 60 > d.durationMin * CLOSEOUT_OVERSHOOT_RATIO) {
        t.overshootDays.push(d.date);
      }
    } else {
      t.missed += 1;
    }
    acc.set(d.type, t);
  }

  const types = [...acc.values()];
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const allScores = types.flatMap((t) => t.scores);
  const allComps = types.flatMap((t) => t.compliances);

  return {
    perType: types.map(
      (t): CloseoutTypeEvidence => ({
        type: t.type,
        planned: t.planned,
        scored: t.scores.length,
        missed: t.missed,
        meanExecution: mean(t.scores) !== null ? round1(mean(t.scores) as number) : null,
        meanCompliancePct: mean(t.compliances) !== null ? Math.round(mean(t.compliances) as number) : null,
        overshootDays: t.overshootDays,
      })
    ),
    plannedSessions: types.reduce((s, t) => s + t.planned, 0),
    scoredSessions: allScores.length,
    missedSessions: types.reduce((s, t) => s + t.missed, 0),
    overshootSessions: types.reduce((s, t) => s + t.overshootDays.length, 0),
    overallMeanExecution: mean(allScores) !== null ? round1(mean(allScores) as number) : null,
    overallMeanCompliancePct: mean(allComps) !== null ? Math.round(mean(allComps) as number) : null,
  };
}

// Proposed next-block priorities. GATING RULES (each independently bars progression language):
// overshoot days on the type · unrecorded sessions on the type · mean execution < 6.
// Everything here is an observation templated from evidence — never coaching invention.
export function deriveCloseoutSeeds(
  evidence: CloseoutEvidence,
  ctlStart: number | null,
  ctlEnd: number | null,
  curveSeed: string | null
): string[] {
  const seeds: string[] = [];
  for (const t of evidence.perType) {
    if (t.scored === 0) continue;
    const overshoot = t.overshootDays.length > 0;
    const lowExec = (t.meanExecution ?? 0) < 6;
    if (!overshoot && t.missed === 0 && !lowExec && (t.meanCompliancePct ?? 0) >= 85) {
      seeds.push(
        `${t.type} sessions executed well (mean execution ${t.meanExecution}/10, completion ${t.meanCompliancePct}%) — evidence supports progressing ${t.type} load`
      );
    }
    if (overshoot) {
      seeds.push(
        `${t.type} ran past ${Math.round(CLOSEOUT_OVERSHOOT_RATIO * 100)}% of prescribed duration on ${t.overshootDays.length} day(s) (${t.overshootDays.join(", ")}) — treated as a data signal to review, not progression evidence`
      );
    }
    if (lowExec) {
      seeds.push(`${t.type} mean execution ${t.meanExecution}/10 — review session quality before adding load`);
    }
    if (t.missed > 0) {
      seeds.push(`${t.missed} scheduled ${t.type} session(s) have no recorded ride — account for them before progressing ${t.type}`);
    }
  }
  if (evidence.plannedSessions > 0 && evidence.scoredSessions === 0) {
    seeds.push(`Insufficient scored sessions this block (0/${evidence.plannedSessions}) — progression decisions need scored evidence`);
  }
  if (ctlStart !== null && ctlEnd !== null) {
    const gain = round1(ctlEnd - ctlStart);
    if (gain >= 10) seeds.push(`Strong CTL gain (+${gain}) across the block`);
    else if (gain <= 2) seeds.push(`Minimal CTL gain (+${gain}) — review session quality or effective volume`);
  }
  if (curveSeed) seeds.push(curveSeed);
  return seeds;
}
```

- [ ] **Step 2.4: Run, verify green**

Run: `npx vitest run lib/block-closeout.test.ts`
Expected: PASS, all cases.

- [ ] **Step 2.5: Commit**

```bash
git add lib/block-closeout.ts lib/block-closeout.test.ts
git commit -m "feat(closeout): deterministic evidence + gated seed derivation from the frozen ledger"
```

---

## Task 3: `appendBlockHistory` — protect degraded closeouts from bare-archive collisions

HR-37 protects an entry carrying `retrospective` from being displaced by a bare archive. A
degraded closeout deliberately lacks `retrospective` but carries `closeout` — it must count as rich.

**Files:**
- Modify: `lib/data-store.ts:277-292` (`appendBlockHistory`)
- Test: `lib/data-store.test.ts` (extend the HR-37 describe)

- [ ] **Step 3.1: Write failing tests** (append inside the HR-37 describe):

```ts
  it("Phase 1: a bare archive landing AFTER a degraded closeout (closeout, no retrospective) does not wipe it", async () => {
    await appendBlockHistory(entry("shared-id", {
      closeout: { perType: [], plannedSessions: 2, scoredSessions: 1, missedSessions: 1, overshootSessions: 0, overallMeanExecution: 7, overallMeanCompliancePct: 95 },
      nextBlockSeeds: ["Insufficient scored sessions this block (1/2)"],
      structuredReflections: [{ dimension: "Overall", hypothesis: "h", observation: "o", root_cause: "r", adjusted_strategy: "a" }],
      // deliberate: NO retrospective — the degraded path
    }));
    await appendBlockHistory(entry("shared-id", { overview: "bare DELETE archive" }));

    const survivor = (await readBlockHistory()).find((h) => h.id === "shared-id");
    expect(survivor?.closeout?.scoredSessions).toBe(1);
    expect(survivor?.nextBlockSeeds).toEqual(["Insufficient scored sessions this block (1/2)"]);
    expect(survivor?.structuredReflections?.length).toBe(1);
  });

  it("Phase 1: still replaces normally when BOTH entries are degraded (last write wins)", async () => {
    await appendBlockHistory(entry("shared-id", { nextBlockSeeds: ["first"] }));
    await appendBlockHistory(entry("shared-id", { nextBlockSeeds: ["second"] }));
    expect((await readBlockHistory()).find((h) => h.id === "shared-id")?.nextBlockSeeds).toEqual(["second"]);
  });
```

- [ ] **Step 3.2: Run, verify failure**

Run: `npx vitest run lib/data-store.test.ts`
Expected: first new case FAILS (survivor is the bare archive — `closeout` undefined).

- [ ] **Step 3.3: Implement.** Replace the winner line (`lib/data-store.ts:285`) and extend the
  HR-37 comment directly above it:

```ts
    // HR-37 + Phase 1: field-preserving on id-collision — a DELETE/write-replace's bare archive (no
    // retrospective, no closeout) can race a slow retrospective's own archive for the SAME block id
    // (both key off `block.createdAt`). Whichever landed second used to win wholesale under plain
    // filter+prepend, silently dropping the retrospective narrative, structured reflections,
    // compliance, and seeds the instant a bare entry happened to land after the rich one. An entry
    // lacking BOTH `retrospective` and `closeout` may never displace one that has either — a
    // DEGRADED closeout (deterministic, Claude-free) carries closeout but no retrospective and is
    // exactly as irreplaceable. Keep the richer entry's content, still bumped to the front.
    const isRich = (e: BlockHistoryEntry | undefined): boolean => Boolean(e && (e.retrospective || e.closeout));
    const winner = isRich(existing) && !isRich(entry) ? existing : entry;
```

- [ ] **Step 3.4: Run, verify green**

Run: `npx vitest run lib/data-store.test.ts`
Expected: PASS including both new cases and all existing HR-37 cases.

- [ ] **Step 3.5: Commit**

```bash
git add lib/data-store.ts lib/data-store.test.ts
git commit -m "fix(history): degraded closeouts resist bare-archive collisions (HR-37 extension)"
```

---

## Task 4: kb-loader — `seeds_approved` gate + pure transforms

ROADMAP Phase 1: "**athlete-approved** future seeds." The retro markdown stays the single source of
truth for seeds (athlete hand-edits keep working); an explicit frontmatter flag gates whether they
steer generation. Old files without the flag parse as unapproved — never throw.

**Files:**
- Modify: `lib/kb-loader.ts` (block-retrospectives section, ~lines 302–364)
- Test: `lib/kb-loader.test.ts` (new — pure-function tests only, no fs)

**Interfaces:**
- Produces:

```ts
export function slugifyGoal(str: string): string;                    // moved verbatim from the route
export function retroFileId(startDate: string, goal: string): string; // `${startDate}_${slugifyGoal(goal)}`
export function parseRetroSeeds(content: string): string[];           // [] unless seeds_approved: true
export function approveSeedsInMarkdown(content: string): string;      // flip-or-insert the flag (pure)
export async function latestRetrospectiveSeeds(): Promise<string[]>;  // unchanged signature, now gated
export async function markRetroSeedsApproved(name: string): Promise<void>; // IO wrapper over the pure flip
```

- [ ] **Step 4.1: Write the failing test** (`lib/kb-loader.test.ts`, complete):

```ts
import { describe, expect, it } from "vitest";
import { approveSeedsInMarkdown, parseRetroSeeds, retroFileId } from "./kb-loader";

const md = (flag: string) => `---
id: "2026-06-01_build-ftp"
goal: "Build FTP"
start_date: "2026-06-01"
${flag}
next_block_seeds:
  - "Threshold executed well — evidence supports progressing Threshold load"
  - "Minimal CTL gain (+1) — review session quality or effective volume"
generated_at: "2026-06-15T08:00:00.000Z"
---
## Retrospective
Fine block.`;

describe("parseRetroSeeds", () => {
  it("returns [] when seeds_approved is absent (pre-Phase-1 file)", () => {
    expect(parseRetroSeeds(md(`status: completed`))).toEqual([]);
  });

  it("returns [] when seeds_approved is false", () => {
    expect(parseRetroSeeds(md(`seeds_approved: false\nstatus: completed`))).toEqual([]);
  });

  it("returns the list when seeds_approved is true", () => {
    const out = parseRetroSeeds(md(`seeds_approved: true\nstatus: completed`));
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("Threshold");
  });
});

describe("approveSeedsInMarkdown", () => {
  it("flips false → true", () => {
    const out = approveSeedsInMarkdown(md(`seeds_approved: false\nstatus: completed`));
    expect(out).toContain("seeds_approved: true");
    expect(parseRetroSeeds(out)).toHaveLength(2);
  });

  it("inserts the flag into a pre-Phase-1 file without one", () => {
    const out = approveSeedsInMarkdown(md(`status: completed`));
    expect(out).toContain("seeds_approved: true");
    expect(out.indexOf("seeds_approved")).toBeLessThan(out.indexOf("next_block_seeds"));
  });

  it("is idempotent", () => {
    const once = approveSeedsInMarkdown(md(`seeds_approved: false\nstatus: completed`));
    expect(approveSeedsInMarkdown(once)).toBe(once);
  });
});

describe("retroFileId", () => {
  it("matches the filename the retrospective route writes", () => {
    expect(retroFileId("2026-06-01", "Build FTP!")).toBe("2026-06-01_build-ftp");
  });
});
```

- [ ] **Step 4.2: Run, verify failure**

Run: `npx vitest run lib/kb-loader.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 4.3: Implement in `lib/kb-loader.ts`.** Replace `latestRetrospectiveSeeds` and add:

```ts
// Moved verbatim from app/api/retrospective/route.ts (which now imports this) so filename
// derivation has exactly one owner.
export function slugifyGoal(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function retroFileId(startDate: string, goal: string): string {
  return `${startDate}_${slugifyGoal(goal)}`;
}

// Phase 1: proposed seeds steer generation ONLY once the athlete (via the Plan-page adoption
// action or a hand edit) stamped the file. Absent/false ⇒ [] — old files degrade to unapproved.
export function parseRetroSeeds(content: string): string[] {
  if (!/^seeds_approved:\s*true\s*$/m.test(content)) return [];
  const lines = content.split("\n");
  const seeds: string[] = [];
  let inSeeds = false;
  for (const line of lines) {
    if (/^next_block_seeds:\s*$/.test(line)) { inSeeds = true; continue; }
    if (inSeeds) {
      const m = line.match(/^\s+-\s+"?(.*?)"?\s*$/);
      if (m && m[1].trim()) { seeds.push(m[1].trim()); continue; }
      if (line.trim() !== "" && !/^\s+-/.test(line)) break;
    }
  }
  return seeds;
}

// Pure transform: flip an existing flag, or insert one right after the opening delimiter.
export function approveSeedsInMarkdown(content: string): string {
  if (/^seeds_approved:\s*true\s*$/m.test(content)) return content;
  if (/^seeds_approved:.*$/m.test(content)) {
    return content.replace(/^seeds_approved:.*$/m, "seeds_approved: true");
  }
  return content.replace(/^---\n/, "---\nseeds_approved: true\n");
}
```

Rewrite `latestRetrospectiveSeeds` to delegate:

```ts
export async function latestRetrospectiveSeeds(): Promise<string[]> {
  const all = await listRetrospectives();
  const dated = all.filter((f) => /^\d{4}-\d{2}-\d{2}_/.test(f));
  if (dated.length === 0) return [];
  try {
    return parseRetroSeeds(await fs.readFile(path.join(RETRO_DIR, dated[0]), "utf-8"));
  } catch {
    return [];
  }
}

export async function markRetroSeedsApproved(name: string): Promise<void> {
  assertSafeName(name);
  const file = path.join(RETRO_DIR, name);
  let content: string;
  try {
    content = await fs.readFile(file, "utf-8");
  } catch {
    return; // missing/unreadable file: nothing to mark; adoption of reflections already succeeded
  }
  const next = approveSeedsInMarkdown(content);
  if (next !== content) await fs.writeFile(file, next, "utf-8");
}
```

- [ ] **Step 4.4: Run, verify green**

Run: `npx vitest run lib/kb-loader.test.ts && npx vitest run lib/kb-loader.test.ts -t "" && npx tsc --noEmit -p .`
Expected: PASS; tsc clean.

- [ ] **Step 4.5: Commit**

```bash
git add lib/kb-loader.ts lib/kb-loader.test.ts
git commit -m "feat(kb): seeds_approved frontmatter gate — proposed seeds steer only after adoption"
```

---

## Task 5: `latestApprovedReflections` — newest-entry-only injection helper

Provenance rule: the prompt section says "FROM LAST BLOCK", so the helper considers ONLY the newest
reflection-bearing entry. If THAT entry is unapproved, inject nothing — never fall back to an older
approved entry that would silently misattribute stale lessons.

**Files:**
- Modify: `lib/retrospective-schema.ts` (append after `formatReflectionsForPrompt`)
- Test: `lib/retrospective-schema.test.ts` (extend)

- [ ] **Step 5.1: Write the failing tests** (append):

```ts
import { latestApprovedReflections } from "./retrospective-schema";
import type { BlockHistoryEntry } from "./types";

const hist = (over: Partial<BlockHistoryEntry>): BlockHistoryEntry =>
  ({
    id: "h", goal: "g", startDate: "2026-06-01", endDate: "2026-06-14", lengthWeeks: 2,
    overview: "", createdAt: "2026-06-01T00:00:00.000Z",
    structuredReflections: [{ dimension: "Overall", hypothesis: "h", observation: "o", root_cause: "r", adjusted_strategy: "a" }],
    ...over,
  }) as BlockHistoryEntry;

describe("latestApprovedReflections", () => {
  const refl = [{ dimension: "Overall", hypothesis: "h", observation: "o", root_cause: "r", adjusted_strategy: "a" }];

  it("injects the NEWEST reflection-bearing entry only when its approval stamp is truthy", () => {
    expect(latestApprovedReflections([
      hist({ id: "new", structuredReflections: refl }),                                  // newest, unapproved
      hist({ id: "old", reflectionsApprovedAt: "2026-06-15T00:00:00.000Z", structuredReflections: refl }),
    ])).toEqual([]); // NO fallback to the older approved entry
  });

  it("injects when the newest reflection-bearing entry is approved", () => {
    expect(latestApprovedReflections([
      hist({ id: "new", reflectionsApprovedAt: "2026-06-15T00:00:00.000Z", structuredReflections: refl }),
      hist({ id: "old" }),
    ])).toEqual(refl);
  });

  it("skips newer entries WITHOUT reflections and honors an older approved one", () => {
    expect(latestApprovedReflections([
      hist({ id: "bare" }),                                                              // no reflections at all
      hist({ id: "approved", reflectionsApprovedAt: "2026-06-15T00:00:00.000Z", structuredReflections: refl }),
    ])).toEqual(refl);
  });

  it("returns [] for empty history and for entries with empty reflection arrays", () => {
    expect(latestApprovedReflections([])).toEqual([]);
    expect(latestApprovedReflections([hist({ id: "x", structuredReflections: [] })])).toEqual([]);
  });
});
```

- [ ] **Step 5.2: Run, verify failure**

Run: `npx vitest run lib/retrospective-schema.test.ts`
Expected: FAIL — export missing.

- [ ] **Step 5.3: Implement** (append to `lib/retrospective-schema.ts`; extend the existing
  `./types` import with `BlockHistoryEntry`):

```ts
// Phase 1: AI-authored reflections influence another block ONLY after explicit athlete approval
// (POST /api/history stamps reflectionsApprovedAt). Newest-reflection-bearing-entry-only: the
// consumer prompt labels this "FROM LAST BLOCK", so an older APPROVED entry must never leak in
// behind a newer UNAPPROVED one — silence beats misattribution.
export function latestApprovedReflections(history: BlockHistoryEntry[]): StructuredReflection[] {
  const newest = history.find((h) => h.structuredReflections?.length);
  return newest?.reflectionsApprovedAt ? (newest.structuredReflections ?? []) : [];
}
```

- [ ] **Step 5.4: Run, verify green; commit**

Run: `npx vitest run lib/retrospective-schema.test.ts` → PASS.

```bash
git add lib/retrospective-schema.ts lib/retrospective-schema.test.ts
git commit -m "feat(reflections): newest-entry-only approval-gated prompt injection helper"
```

---

## Task 6: `/api/retrospective` — gate, reorder, de-hard-Claude

Keep GET, `closestCtl`, the power-profile block, and every HR-32/33/35 guard. Delete the
Anthropic preflight and the inline compliance math. `slugify` moves to `kb-loader.slugifyGoal`
(Task 4) — the route imports `retroFileId` instead.

**Files:**
- Modify: `app/api/retrospective/route.ts`
- Test: `app/api/retrospective/route.test.ts`

**New request contract:** existing optional `today`, `expectedBlockCreatedAt`; plus
`endedEarly?: boolean` and `endReason?: string` (meaningful only together).

- [ ] **Step 6.1: Extend the test harness.** In `route.test.ts`: add `readScoreLog: vi.fn()` and
  `readBlockHistory: vi.fn()` (GET already uses the latter) to the `vi.hoisted` `h` object and to
  the `vi.mock("@/lib/data-store", …)` factory; add a default so every existing case sees a ledger
  consistent with its fixture activities (same dates, capped compliance 100, execution 7):

```ts
beforeEach(() => {
  h.readScoreLog.mockReset();
  h.readScoreLog.mockResolvedValue({
    entries: [
      { date: "2026-06-15", planned: true, executionScore: 7, compliancePct: 100, plannedType: "Z2", activityId: "a1" },
      { date: "2026-06-17", planned: true, executionScore: 7, compliancePct: 100, plannedType: "Threshold", activityId: "a2" },
    ],
  });
});
```

- [ ] **Step 6.2: Write the failing tests** (complete bodies; `post`, `day`, `block`, `sync`,
  `athleteProfile` are the file's existing helpers):

```ts
describe("Phase 1 trust contract", () => {
  const unfinished = { ...block(), endDate: "2099-01-01" };

  it("409s an unfinished block with no explicit early-end decision — and writes NOTHING", async () => {
    h.readCurrentBlock.mockResolvedValue(unfinished);
    const res = await post();
    expect(res.status).toBe(409);
    expect(h.writeRetrospective).not.toHaveBeenCalled();
    expect(h.appendBlockHistory).not.toHaveBeenCalled();
    expect(h.updateCurrentBlock).not.toHaveBeenCalled();
  });

  it("proceeds on an explicit early-end decision and records it on the history entry", async () => {
    h.readCurrentBlock.mockResolvedValue(unfinished);
    const res = await post({ endedEarly: true, endReason: "Race prep pivot" });
    expect(res.status).toBe(200);
    const arg = h.appendBlockHistory.mock.calls[0][0];
    expect(arg.endedEarlyAt).toBeTruthy();
    expect(arg.endedEarlyReason).toBe("Race prep pivot");
  });

  it("409s an early-end decision with a blank reason", async () => {
    h.readCurrentBlock.mockResolvedValue(unfinished);
    const res = await post({ endedEarly: true, endReason: "   " });
    expect(res.status).toBe(409);
    expect(h.appendBlockHistory).not.toHaveBeenCalled();
  });

  it("closes out a normally finished block without any endedEarly fields", async () => {
    h.readCurrentBlock.mockResolvedValue(block()); // endDate 2026-06-28 < today fixture usage below
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(200);
    const arg = h.appendBlockHistory.mock.calls[0][0];
    expect(arg.endedEarlyAt).toBeUndefined();
    expect(arg.closeout).toBeTruthy();
  });

  it("completes the whole closeout when Anthropic is NOT configured", async () => {
    h.isAnthropicConfigured.mockReturnValue(false);
    h.readCurrentBlock.mockResolvedValue(block());
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.retrospective).toBeNull();
    expect(body.narrativeDegraded).toBe(true);
    expect(h.generateRetrospective).not.toHaveBeenCalled();
    const arg = h.appendBlockHistory.mock.calls[0][0];
    expect(arg.retrospective).toBeUndefined();
    expect(arg.closeout).toBeTruthy();
    expect(arg.nextBlockSeeds.length).toBeGreaterThan(0);
    expect(h.updateCurrentBlock).toHaveBeenCalled(); // the clear STILL happened
  });

  it("degrades gracefully when the narrative call THROWS (no 502, closeout completes)", async () => {
    h.generateRetrospective.mockRejectedValueOnce(new Error("429 overload"));
    h.readCurrentBlock.mockResolvedValue(block());
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(200);
    expect((await res.json()).retrospective).toBeNull();
    expect(h.appendBlockHistory).toHaveBeenCalledTimes(1);
  });

  it("a markdown-write failure leaves history and the active block untouched", async () => {
    h.writeRetrospective.mockRejectedValueOnce(new Error("disk full"));
    h.readCurrentBlock.mockResolvedValue(block());
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(502);
    expect(h.appendBlockHistory).not.toHaveBeenCalled();
    expect(h.updateCurrentBlock).not.toHaveBeenCalled();
  });

  it("a history-append failure leaves the active block uncleared", async () => {
    h.appendBlockHistory.mockRejectedValueOnce(new Error("lock poisoned"));
    h.readCurrentBlock.mockResolvedValue(block());
    const res = await post({ today: "2026-06-29" });
    expect(res.status).toBe(502);
    expect(h.updateCurrentBlock).not.toHaveBeenCalled();
  });

  it("persists closeout evidence built from CAPPED ledger values, and no approval stamp", async () => {
    h.readCurrentBlock.mockResolvedValue(block());
    h.readScoreLog.mockResolvedValue({
      entries: [
        { date: "2026-06-17", planned: true, executionScore: 3, compliancePct: 54, plannedType: "Threshold", activityId: "a2" },
      ],
    });
    const res = await post({ today: "2026-06-29" });
    const body = await res.json();
    const threshold = body.closeout.perType.find((t: { type: string }) => t.type === "Threshold");
    expect(threshold.meanCompliancePct).toBe(54);  // capped ledger value…
    expect(threshold.meanCompliancePct).not.toBe(100); // …not the raw 60/60 ratio
    const arg = h.appendBlockHistory.mock.calls[0][0];
    expect(arg.reflectionsApprovedAt).toBeUndefined();
  });

  it("flags overshoot against the ride the ledger scored when a shorter ride sorts first", async () => {
    const twoRides = {
      ...sync,
      activities: [
        { ...sync.activities[0], id: "short", movingTimeSec: 20 * 60 },               // first on 06-15
        { ...sync.activities[0], id: "long", movingTimeSec: 120 * 60 },               // actual primary
      ],
    };
    h.readLastSync.mockResolvedValue(twoRides);
    h.readCurrentBlock.mockResolvedValue(block());
    h.readScoreLog.mockResolvedValue({
      entries: [{ date: "2026-06-15", planned: true, executionScore: 7, compliancePct: 100, plannedType: "Z2", activityId: "long" }],
    });
    const res = await post({ today: "2026-06-29" });
    const body = await res.json();
    expect(body.closeout.overshootSessions).toBe(1); // 120min vs 90 planned > 1.25× — judged on "long"
  });

  it("early ends count only lived days as missed", async () => {
    const early = { ...unfinished, days: [day("2026-06-16", "Z2", 60), day("2098-12-31", "SIT", 45)] };
    h.readCurrentBlock.mockResolvedValue(early);
    h.readScoreLog.mockResolvedValue({ entries: [] });
    const res = await post({ today: "2026-06-20", endedEarly: true, endReason: "injury" });
    const body = await res.json();
    expect(body.closeout.plannedSessions).toBe(1);  // the 2098 day excluded entirely
    expect(body.closeout.missedSessions).toBe(1);
  });
});
```

Also REWRITE the existing narrative-failure test (currently expecting 502): keep its arrange/act,
change assertions to the degradation expectation above (`200`, `retrospective: null`, history still
appended). And update any exact-string seed assertions (grep `safe to progress`): replace with
structural checks — e.g. `expect(body.seeds.some(s => s.includes("evidence supports progressing"))).toBe(false)`
for the default fixtures, whose ledger rows carry no overshoot but DO carry `executionScore 7` /
`compliancePct 100` on only 2 of 5 planned days (missed > 0 bars progression — assert the
`no recorded ride` seed instead).

- [ ] **Step 6.3: Run, verify failures**

Run: `npx vitest run app/api/retrospective/route.test.ts`
Expected: the new describe fails (route has no such behavior); pre-existing suites pass or fail only
in the categories Step 6.2 lists for rewrite.

- [ ] **Step 6.4: Rewrite the POST handler.** Full replacement body (imports adjusted as noted;
  GET unchanged):

```ts
import { NextResponse } from "next/server";
import { logError, logWarn } from "@/lib/log";
import {
  appendBlockHistory,
  readAthleteProfile,
  readBlockHistory,
  readCurrentBlock,
  readInterventionLog,
  readLastSync,
  readScoreLog,
  updateCurrentBlock,
} from "@/lib/data-store";
import { analyzePowerProfile, formatPowerProfileForPrompt, powerProfileSeed } from "@/lib/power-profile";
import { retroFileId, writeRetrospective } from "@/lib/kb-loader";
import { blockChangedResponse } from "@/lib/block-version";
import { isBlockFinished, resolveToday } from "@/lib/date";
import { truncateBlockDays } from "@/lib/score-log";
import { isSeasonFocus } from "@/lib/season";
import { isSteadyEnduranceRide } from "@/lib/aerobic";
import { buildCloseoutEvidence, deriveCloseoutSeeds } from "@/lib/block-closeout";
import {
  generateRetrospective,
  generateStructuredRetrospective,
  isAnthropicConfigured,
  type ReflectionInterventionInput,
} from "@/lib/anthropic-api";
import type { BlockHistoryEntry, StructuredReflection, WorkoutType } from "@/lib/types";

// slugify deleted — kb-loader.retroFileId owns filename derivation (single owner).

export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // no body sent — fine
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const today = resolveToday(b.today); // HR-32

  const [block, sync, interventionLog, athleteProfile, scoreLog] = await Promise.all([
    readCurrentBlock(),
    readLastSync(),
    readInterventionLog(),
    readAthleteProfile(),
    readScoreLog(),
  ]);

  if (!block) {
    return NextResponse.json({ error: "No active block found." }, { status: 404 });
  }
  const expectedCreatedAt =
    "expectedBlockCreatedAt" in b ? (b.expectedBlockCreatedAt as string | null) : undefined;
  const versionError = blockChangedResponse(block, expectedCreatedAt); // HR-33
  if (versionError) return versionError;
  if (!sync) {
    return NextResponse.json({ error: "No sync data — sync first." }, { status: 400 });
  }

  // Phase 1 gate: a normal completion or an EXPLICIT early-end decision precedes closeout.
  const endReason = typeof b.endReason === "string" ? b.endReason.trim() : "";
  const endedEarly = b.endedEarly === true && endReason.length > 0;
  if (!isBlockFinished(block, today) && !endedEarly) {
    return NextResponse.json(
      { error: "This block hasn't finished yet. Wait for its end date, or record why it's ending early." },
      { status: 409 }
    );
  }

  const blockActivities = sync.activities.filter(
    (a) => a.date >= block.startDate && a.date <= block.endDate && (a.type === "Ride" || a.type === "VirtualRide")
  );

  // Deterministic FIRST (works with Claude fully unavailable). Evidence covers only lived days.
  const evidence = buildCloseoutEvidence(
    block,
    scoreLog.entries,
    blockActivities,
    today < block.endDate ? today : block.endDate
  );

  const ctlStart = closestCtl(sync.wellness, block.startDate);
  const ctlEnd = closestCtl(sync.wellness, block.endDate);

  const decoupList = blockActivities
    .filter((a) => isSteadyEnduranceRide(a, athleteProfile.performance.ftp))
    .map((a) => a.decoupling)
    .filter((v): v is number => v !== null);
  const avgDecoupling =
    decoupList.length > 0 ? Math.round((decoupList.reduce((s, v) => s + v, 0) / decoupList.length) * 10) / 10 : null;

  const topSessions = [...blockActivities]
    .filter((a) => a.trainingLoad !== null)
    .sort((a, b) => (b.trainingLoad ?? 0) - (a.trainingLoad ?? 0))
    .slice(0, 3)
    .map((a) => ({ date: a.date, name: a.name, tss: a.trainingLoad as number }));

  const latestWeight =
    [...sync.wellness].filter((w) => w.weightKg !== null).sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ??
    athleteProfile.performance.weightKg;
  const powerProfile = analyzePowerProfile(sync.powerCurve, athleteProfile.performance.ftp, latestWeight, "84-day");
  const powerProfileText = formatPowerProfileForPrompt(powerProfile);

  // Model-input compliance switches to the CAPPED ledger figure (same RetrospectiveInput shape).
  const overallCompliancePct = evidence.overallMeanCompliancePct ?? 0;
  const complianceMap: Record<string, number> = {};
  for (const t of evidence.perType) {
    if (t.scored > 0 && t.meanCompliancePct !== null) complianceMap[t.type] = t.meanCompliancePct;
  }

  // Best-effort narrative: skip unconfigured, survive failure — closeout never depends on Claude.
  let retrospective: string | undefined;
  let narrativeDegraded = false;
  if (!isAnthropicConfigured()) {
    narrativeDegraded = true;
    logWarn("/api/retrospective", "narrative", "skipped — Anthropic not configured; closing out deterministically");
  } else {
    try {
      retrospective = await generateRetrospective({
        goal: block.goal,
        lengthWeeks: block.lengthWeeks,
        startDate: block.startDate,
        endDate: block.endDate,
        plannedHours,
        actualHours,
        overallCompliancePct,
        ctlStart,
        ctlEnd,
        complianceByType: complianceMap,
        topSessions,
        avgDecoupling,
        powerProfile: powerProfileText,
      });
    } catch (err) {
      narrativeDegraded = true;
      logWarn("/api/retrospective", "generate", err instanceof Error ? err.message : String(err));
    }
  }
  void 0; // DELETE this marker line when transcribing (see the two completions below the block)

  // Structured reflections: unchanged degrade-to-[] logic, persisted UNAPPROVED.
  const maturedInterventions: ReflectionInterventionInput[] = interventionLog.records
    .filter((r) => r.blockStartDate === block.startDate && r.outcome !== null)
    .map((r) => ({ /* verbatim existing mapping */ }));
  let structuredReflections: StructuredReflection[] = [];
  if (maturedInterventions.length > 0) {
    try {
      structuredReflections = await generateStructuredRetrospective({ /* verbatim existing input */ });
    } catch (err) {
      logWarn("/api/retrospective", "structured-reflections", err instanceof Error ? err.message : String(err));
      structuredReflections = [];
    }
  }

  const seeds = deriveCloseoutSeeds(evidence, ctlStart, ctlEnd, powerProfileSeed(powerProfile));

  const fileId = retroFileId(block.startDate, block.goal);
  const frontmatter = [
    "---",
    `id: "${fileId}"`,
    `goal: "${block.goal}"`,
    `start_date: "${block.startDate}"`,
    `end_date: "${block.endDate}"`,
    `length_weeks: ${block.lengthWeeks}`,
    `status: completed`,
    ...(endedEarly ? [`ended_early: true`, `ended_early_reason: "${endReason.replace(/"/g, "'")}"`] : []),
    `execution_scored: ${evidence.scoredSessions}/${evidence.plannedSessions}`,
    `execution_missed_sessions: ${evidence.missedSessions}`,
    `execution_overshoot_days: ${evidence.overshootSessions}`,
    `execution_mean_score: ${evidence.overallMeanExecution ?? "n/a"}`,
    `seeds_approved: false`,
    `generated_at: "${new Date().toISOString()}"`,
    "---",
    "",
    ...(retrospective ? ["## Retrospective", "", retrospective, ""] : []),
    ...(structuredReflections.length
      ? [
          "## Coach reflections (UNAPPROVED — adopt on Plan before they reach the next block)",
          "",
          ...structuredReflections.map(
            (r) =>
              `- **${r.dimension}** — _hypothesis:_ ${r.hypothesis} _observed:_ ${r.observation} ` +
              `_root cause:_ ${r.root_cause} _next:_ ${r.adjusted_strategy}`
          ),
          "",
        ]
      : []),
  ].join("\n");

  await writeRetrospective(`${fileId}.md`, frontmatter);

  const historyEntry: BlockHistoryEntry = {
    id: block.createdAt,
    goal: block.goal,
    startDate: block.startDate,
    endDate: block.endDate,
    lengthWeeks: block.lengthWeeks,
    overview: block.overview,
    createdAt: block.createdAt,
    complianceByType: complianceMap as Partial<Record<WorkoutType, number>>,
    actualHours: Math.round(actualHours * 10) / 10,
    plannedHours: Math.round(plannedHours * 10) / 10,
    ctlGain: ctlStart !== null && ctlEnd !== null ? Math.round((ctlEnd - ctlStart) * 10) / 10 : null,
    nextBlockSeeds: seeds,
    closeout: evidence,
    ...(retrospective ? { retrospective } : {}),
    structuredReflections,
    model: block.model,
    promptVersion: block.promptVersion,
    ...(block.seasonFocus && isSeasonFocus(block.seasonFocus) ? { seasonFocus: block.seasonFocus } : {}),
    ...(endedEarly ? { endedEarlyAt: new Date().toISOString(), endedEarlyReason: endReason } : {}),
    days: truncateBlockDays(block.days, today),
  };
  await appendBlockHistory(historyEntry);

  const written = await updateCurrentBlock(() => null, expectedCreatedAt); // ALWAYS last (HR-35)
  if (written !== null) {
    return NextResponse.json(
      {
        error: "This plan changed in another tab while generating the retrospective — it was saved to Plan history, but the active block wasn't cleared. Reload to see the latest.",
        retrospective: retrospective ?? null,
        narrativeDegraded,
        seeds,
        structuredReflections,
        fileId,
        complianceByType: complianceMap,
        closeout: evidence,
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    retrospective: retrospective ?? null,
    narrativeDegraded,
    seeds,
    structuredReflections,
    fileId,
    complianceByType: complianceMap,
    closeout: evidence,
  });
}
```

Two completions for the implementer:
1. Delete the `void 0;` marker line from the block above — it marks where nothing further goes.
2. `plannedHours` / `actualHours` are display-only numbers NOT on `CloseoutEvidence`: keep the
   route's existing computations as consts BEFORE the evidence call and use them directly —

```ts
  const actualHours = blockActivities.reduce((s, a) => s + a.movingTimeSec, 0) / 3600;
  const plannedHours = block.days.reduce((s, d) => s + d.durationMin, 0) / 60;
```

— then `generateRetrospective({ … plannedHours, actualHours, … })` unchanged, and in
`historyEntry`: `actualHours: Math.round(actualHours * 10) / 10`, same for `plannedHours`.

- [ ] **Step 6.5: Run, verify green**

Run: `npx vitest run app/api/retrospective/route.test.ts`
Expected: PASS — new describe green, rewritten cases green, untouched HR-32/33/35 cases green.

- [ ] **Step 6.6: Commit**

```bash
git add app/api/retrospective/route.ts app/api/retrospective/route.test.ts
git commit -m "feat(retro): gated deterministic-first closeout; Claude becomes best-effort enrichment"
```

---

## Task 7: RetroSection — null-narrative fallback display

The degraded closeout returns `retrospective: null`; the success card must say so instead of
rendering blank.

**Files:**
- Modify: `components/dashboard/plan.tsx` (`RetroSection` result prop type + render)
- Test: `components/dashboard/plan.test.tsx` (extend — this file already RTL-renders exported
  sections from `./plan` with `@/lib/client-api` mocked)

- [ ] **Step 7.1: Write failing render tests** (append to `plan.test.tsx`; import `RetroSection`
  alongside `CurrentBlockSection`):

```tsx
import { RetroSection } from "./plan";

const retroResult = (retrospective: string | null) => ({
  retrospective,
  narrativeDegraded: retrospective === null,
  seeds: ["Threshold executed well — evidence supports progressing Threshold load"],
  complianceByType: { Threshold: 95 },
  fileId: "2026-06-01_build-ftp",
});

describe("RetroSection — degraded (Claude-free) closeouts", () => {
  it("renders the deterministic fallback copy when retrospective is null", () => {
    render(<RetroSection block={null} generating={false} result={retroResult(null)} error={null} onGenerate={() => {}} />);
    expect(screen.getByText(/Closed deterministically/i)).toBeTruthy();
    expect(screen.getByText(/evidence supports progressing/i)).toBeTruthy();
  });

  it("still renders the narrative when one exists", () => {
    render(<RetroSection block={null} generating={false} result={retroResult("Solid block overall.")} error={null} onGenerate={() => {}} />);
    expect(screen.getByText("Solid block overall.")).toBeTruthy();
  });
});
```

- [ ] **Step 7.2: Run, verify failure.**

Run: `npx vitest run components/dashboard/plan.test.tsx`
Expected: FAIL — TypeScript rejects `retrospective: null` (prop type is `string`).

- [ ] **Step 7.3: Implement.** In `plan.tsx`:

```tsx
// RetroSection props — widen the response contract to the degraded reality:
result: {
  retrospective: string | null;
  narrativeDegraded?: boolean;
  seeds: string[];
  complianceByType: Record<string, number>;
  fileId: string;
} | null;
```

Render body swaps the prose line for:

```tsx
<p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
  {result.retrospective ??
    "Closed deterministically — no AI narrative was produced for this block. The execution facts and proposed seeds below were still recorded."}
</p>
```

- [ ] **Step 7.4: Run, verify green; commit**

Run: `npx vitest run components/dashboard/plan.test.tsx` → PASS.

```bash
git add components/dashboard/plan.tsx components/dashboard/plan.test.tsx
git commit -m "feat(plan): degraded closeouts render deterministic fallback, never a blank card"
```

---

## Task 8: PlanView — explicit early-end flow + updated response typing

Fetch wiring lives HERE (`generateRetro`), so its tests live in the EXISTING
`components/dashboard/PlanView.test.tsx` (which stubs siblings and drives the real component).

**Files:**
- Modify: `components/dashboard/PlanView.tsx`
- Modify: `components/dashboard/plan.tsx` (`RetroSection` gains the early-end confirm panel)
- Test: `components/dashboard/PlanView.test.tsx` (extend)

**Design:** An ACTIVE (unfinished) block's page shows a quiet "End block early…" control in
`CurrentBlockSection`'s header actions. Activating it reveals `RetroSection`'s confirm panel:
required one-line reason + Cancel/Confirm. Finished blocks keep today's amber nudge unchanged and
send no early-end fields.

- [ ] **Step 8.1: Write failing tests** (append to `PlanView.test.tsx`; reuse its `mkState`,
  `mockSync`, `renderPlanView` helpers):

```tsx
describe("Phase 1 — explicit early-end closeout", () => {
  const active = (): CurrentBlock => ({ ...block(), endDate: "2099-01-07", startDate: "2098-12-27", createdAt: "2098-12-26T00:00:00Z" });

  it("requires a reason before Confirm fires, then posts endedEarly + endReason", async () => {
    mockSync(active());
    h.api.mockResolvedValue({ retrospective: "done", narrativeDegraded: false, seeds: [], complianceByType: {}, fileId: "x" });
    renderPlanView();

    fireEvent.click(await screen.findByRole("button", { name: /end block early/i }));

    const confirm = screen.getByRole("button", { name: /^confirm early end$/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // disabled while the reason is empty
    fireEvent.change(screen.getByLabelText(/why is it ending early/i), { target: { value: "Race prep pivot" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(h.api).toHaveBeenCalledWith(
      "/api/retrospective",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"endedEarly":true'),
      })
    ));
    expect(JSON.parse(h.api.mock.calls[0][1].body)).toMatchObject({ endedEarly: true, endReason: "Race prep pivot" });
  });

  it("a FINISHED block wraps up without any early-end fields", async () => {
    const finished = block(); // endDate 2026-08-14 fixture — override to a fixed past date below
    mockSync({ ...finished, endDate: "2020-01-01", startDate: "2019-12-18", createdAt: "2019-12-17T00:00:00Z" });
    h.api.mockResolvedValue({ retrospective: "done", narrativeDegraded: false, seeds: [], complianceByType: {}, fileId: "x" });
    renderPlanView();

    fireEvent.click(await screen.findByRole("button", { name: /wrap up block/i }));
    await waitFor(() => expect(h.api).toHaveBeenCalled());
    const sent = JSON.parse(h.api.mock.calls[0][1].body);
    expect(sent.endedEarly).toBeUndefined();
    expect(sent.endReason).toBeUndefined();
  });

  it("renders the degraded fallback copy when the closeout came back narrative-less", async () => {
    const finished = { ...block(), endDate: "2020-01-01", startDate: "2019-12-18", createdAt: "2019-12-17T00:00:00Z" };
    mockSync(finished);
    h.api.mockResolvedValue({ retrospective: null, narrativeDegraded: true, seeds: ["s"], complianceByType: {}, fileId: "x" });
    renderPlanView();
    fireEvent.click(await screen.findByRole("button", { name: /wrap up block/i }));
    expect(await screen.findByText(/closed deterministically/i)).toBeTruthy();
  });
});
```

- [ ] **Step 8.2: Run, verify failure**

Run: `npx vitest run components/dashboard/PlanView.test.tsx`
Expected: FAIL — no "End block early" button exists.

- [ ] **Step 8.3: Implement.**

`PlanView.tsx` — state + handler + wiring:

```tsx
const [endEarlyOpen, setEndEarlyOpen] = useState(false);
const [endReason, setEndReason] = useState("");

const generateRetro = async () => {
  setRetroGenerating(true);
  setRetroError(null);
  try {
    const result = await api<{
      retrospective: string | null;
      narrativeDegraded?: boolean;
      seeds: string[];
      complianceByType: Record<string, number>;
      fileId: string;
    }>("/api/retrospective", {
      method: "POST",
      body: JSON.stringify({
        today: localToday(),
        expectedBlockCreatedAt: state?.currentBlock?.createdAt ?? null,
        // Only an unfinished block sends the explicit decision; finished blocks send neither field.
        ...(state.currentBlock && state.currentBlock.endDate >= localToday()
          ? { endedEarly: true, endReason: endReason.trim() }
          : {}),
      }),
    });
    setRetroResult(result);
    setState((s) => (s ? { ...s, currentBlock: null } : s));
    void loadBlockHistory();
  } catch (err) {
    setRetroError(err instanceof Error ? err.message : "Couldn't generate the retrospective — try again.");
  } finally {
    setRetroGenerating(false);
  }
};
```

Pass
to `<RetroSection … />`:

```tsx
endEarlyOpen={endEarlyOpen}
endReason={endReason}
onEndReasonChange={setEndReason}
onCancelEndEarly={() => { setEndEarlyOpen(false); setEndReason(""); }}
```

And to `<CurrentBlockSection … />`: `onEndEarly={() => setEndEarlyOpen(true)}`.

`plan.tsx` — `CurrentBlockSection` header gains (next to the existing Delete control):

```tsx
{onEndEarly && (
  <button onClick={onEndEarly} className="…existing secondary-button classes…">
    End block early…
  </button>
)}
```

`RetroSection` — render condition widens and gains the confirm panel:

```tsx
if (!result && !blockEnded && !endEarlyOpen) return null;   // was: !result && !blockEnded

if (!result && !blockEnded && endEarlyOpen) {
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-zinc-600 dark:bg-zinc-800">
      <p className="text-sm font-semibold text-amber-900 dark:text-zinc-100">End this block early?</p>
      <p className="mt-0.5 text-xs text-amber-700 dark:text-zinc-400">
        The remaining scheduled sessions won&apos;t count against you. This closes the block now.
      </p>
      <input
        aria-label="Why is it ending early?"
        value={endReason}
        onChange={(e) => onEndReasonChange(e.target.value)}
        placeholder="Why is it ending early?"
        className="mt-2 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
      />
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={onCancelEndEarly} className="…secondary…">Cancel</button>
        <button
          onClick={onGenerate}
          disabled={generating || !endReason.trim()}
          className="…primary…"
        >
          {generating ? "Closing…" : "Confirm early end"}
        </button>
      </div>
    </section>
  );
}
```

(New `RetroSection` props: `endEarlyOpen: boolean; endReason: string; onEndReasonChange: (v: string) => void; onCancelEndEarly: () => void;` — threaded from PlanView.)

- [ ] **Step 8.4: Run, verify green**

Run: `npx vitest run components/dashboard/PlanView.test.tsx components/dashboard/plan.test.tsx`
Expected: PASS (new + all existing HR-56 delete-flow cases).

- [ ] **Step 8.5: Commit**

```bash
git add components/dashboard/PlanView.tsx components/dashboard/PlanView.test.tsx \
        components/dashboard/plan.tsx
git commit -m "feat(plan): explicit early-end closeout flow with required reason"
```

---

## Task 9: `/api/history` — the adoption action

One endpoint adopts a closed block's lessons: it flips the retro markdown's `seeds_approved` flag
AND stamps `reflectionsApprovedAt`. **Failure-safe by construction:** the retro filename is DERIVED
from the entry itself (the client cannot omit it, so neither channel can be silently skipped); the
flip runs BEFORE the stamp; both steps are idempotent, so any interrupted attempt converges on
retry — a markdown failure leaves nothing stamped (clean retry), a stamp failure after the flip is
healed by the next attempt rather than dead-ending on 409. GET stays byte-identical.

**Files:**
- Modify: `app/api/history/route.ts`
- Create: `app/api/history/route.test.ts`

- [ ] **Step 9.1: Write the failing route test** (complete file; follow the repo's hoisted-mock
  pattern):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockHistoryEntry } from "@/lib/types";

const h = vi.hoisted(() => ({
  readBlockHistory: vi.fn(),
  updateBlockHistory: vi.fn(),
  markRetroSeedsApproved: vi.fn(),
}));
vi.mock("@/lib/data-store", () => ({ readBlockHistory: h.readBlockHistory, updateBlockHistory: h.updateBlockHistory }));
vi.mock("@/lib/kb-loader", () => ({ markRetroSeedsApproved: h.markRetroSeedsApproved }));

import { POST } from "@/app/api/history/route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/history", { method: "POST", body: JSON.stringify(body) }));

const entry = (): BlockHistoryEntry =>
  ({
    id: "b1", goal: "Build FTP", startDate: "2026-06-01", endDate: "2026-06-14",
    lengthWeeks: 2, overview: "", createdAt: "2026-06-01T00:00:00.000Z",
  }) as BlockHistoryEntry;

describe("POST /api/history — adoption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.markRetroSeedsApproved.mockResolvedValue(undefined);
    h.readBlockHistory.mockResolvedValue([entry()]);
    h.updateBlockHistory.mockImplementation(async (mutate: (e: BlockHistoryEntry[]) => BlockHistoryEntry[]) =>
      mutate([entry()])
    );
  });

  it("DERIVES the retro filename from the entry — the client sends only { id }", async () => {
    const res = await post({ id: "b1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.markRetroSeedsApproved).toHaveBeenCalledWith("2026-06-01_build-ftp.md");
    expect(h.updateBlockHistory).toHaveBeenCalledTimes(1);
  });

  it("502s WITHOUT stamping when the markdown write fails — nothing partial persists", async () => {
    h.markRetroSeedsApproved.mockRejectedValueOnce(new Error("EACCES"));
    const res = await post({ id: "b1" });
    expect(res.status).toBe(502);
    expect(h.updateBlockHistory).not.toHaveBeenCalled(); // no orphaned reflectionsApprovedAt
  });

  it("a retry after that failure completes end-to-end", async () => {
    h.markRetroSeedsApproved.mockRejectedValueOnce(new Error("EACCES")); // attempt 1 dies on the flip
    expect((await post({ id: "b1" })).status).toBe(502);

    const res = await post({ id: "b1" });                                // attempt 2
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("converges when a prior attempt flipped the file but failed before stamping", async () => {
    h.updateBlockHistory.mockRejectedValueOnce(new Error("lock poisoned")); // attempt 1: stamp dies AFTER flip
    expect((await post({ id: "b1" })).status).toBe(502);

    const res = await post({ id: "b1" });                                   // attempt 2: flip no-ops, stamp lands
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("is idempotent once fully adopted — 200 with alreadyAdopted, never a 409 dead-end", async () => {
    h.readBlockHistory.mockResolvedValue([{ ...entry(), reflectionsApprovedAt: "2026-06-15T00:00:00.000Z" }]);
    const res = await post({ id: "b1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyAdopted: true });
  });

  it("404s an unknown id before any write", async () => {
    h.readBlockHistory.mockResolvedValue([]);
    const res = await post({ id: "nope" });
    expect(res.status).toBe(404);
    expect(h.markRetroSeedsApproved).not.toHaveBeenCalled();
    expect(h.updateBlockHistory).not.toHaveBeenCalled();
  });

  it("400s a missing id", async () => {
    expect((await post({})).status).toBe(400);
  });
});
```

Plus a store-level freeze assertion appended to `lib/data-store.test.ts`:

```ts
  it("Phase 1: approving reflections never touches the score ledger", async () => {
    const before = await readJsonRawForTest("score-log.json"); // read via the test's data dir helper
    await updateBlockHistory((entries) => entries.map((e) => (e.id === "a" ? { ...e, reflectionsApprovedAt: "X" } : e)));
    const after = await readJsonRawForTest("score-log.json");
    expect(after).toEqual(before);
  });
```

(Use that file's existing raw-read helper for the data directory; if none exists, `JSON.parse(await fs.readFile(path.join(testDataDir, "score-log.json"), "utf-8"))` with its established path helper.)

- [ ] **Step 9.2: Run, verify failure**

Run: `npx vitest run app/api/history/route.test.ts`
Expected: FAIL — no POST export.

- [ ] **Step 9.3: Implement.** Append to `app/api/history/route.ts`:

```ts
import { logError } from "@/lib/log";
import { readBlockHistory, updateBlockHistory } from "@/lib/data-store"; // extends existing import
import { markRetroSeedsApproved, retroFileId } from "@/lib/kb-loader";

// Phase 1 adoption: the ONE explicit action that lets a closed block's proposed lessons influence
// another block — flips `seeds_approved:` on the retro markdown and stamps reflectionsApprovedAt
// on the entry. FAILURE-SAFE by construction:
//   * the retro filename is DERIVED from the entry itself — a caller cannot omit it, so neither
//     adoption channel can be silently skipped;
//   * the flip runs BEFORE the stamp and both steps are idempotent: a crash between them leaves at
//     most "flipped but unstamped", which a retry CONVERGES out of (no 409 dead-end);
//   * a flip failure means NOTHING was stamped, so the athlete's retry starts clean.
export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    const b = (body ?? {}) as Record<string, unknown>;
    const id = typeof b.id === "string" ? b.id : "";
    if (!id) return NextResponse.json({ error: "History entry id required." }, { status: 400 });

    const target = (await readBlockHistory()).find((e) => e.id === id);
    if (!target) return NextResponse.json({ error: "No such history entry." }, { status: 404 });

    await markRetroSeedsApproved(`${retroFileId(target.startDate, target.goal)}.md`);

    let alreadyAdopted = false;
    const updated = await updateBlockHistory((entries) =>
      entries.map((e) => {
        if (e.id !== id) return e;
        if (e.reflectionsApprovedAt) {
          alreadyAdopted = true;
          return e;
        }
        return { ...e, reflectionsApprovedAt: new Date().toISOString() };
      })
    );
    if (!updated.some((e) => e.id === id)) {
      // The entry vanished between the read and the lock — nothing was adopted.
      return NextResponse.json({ error: "No such history entry." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...(alreadyAdopted ? { alreadyAdopted: true } : {}) });
  } catch (err) {
    logError("/api/history", "adopt", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Couldn't record the adoption." }, { status: 502 });
  }
}
```

- [ ] **Step 9.4: Run, verify green; commit**

Run: `npx vitest run app/api/history/route.test.ts lib/data-store.test.ts` → PASS.

```bash
git add app/api/history/route.ts app/api/history/route.test.ts lib/data-store.test.ts
git commit -m "feat(history): explicit adoption endpoint for reflections + seeds approval"
```

---

## Task 10: Plan history UI — review-and-adopt control

**Files:**
- Modify: `components/dashboard/plan.tsx` (`BlockHistory`)
- Test: `components/dashboard/plan.test.tsx` (extend)

- [ ] **Step 10.1: Write failing tests** (append; `historyEntry` builder mirrors the file-local
  style — full valid `BlockHistoryEntry`):

```tsx
import { BlockHistory } from "./plan";
import type { BlockHistoryEntry } from "@/lib/types";

const histEntry = (over: Partial<BlockHistoryEntry>): BlockHistoryEntry =>
  ({
    id: "h1", goal: "Build FTP", startDate: "2026-06-01", endDate: "2026-06-14",
    lengthWeeks: 2, overview: "", createdAt: "2026-06-01T00:00:00.000Z", ...over,
  }) as BlockHistoryEntry;

const refl = [{ dimension: "Overall", hypothesis: "h", observation: "o", root_cause: "r", adjusted_strategy: "a" }];

describe("BlockHistory — reflection adoption", () => {
  it("offers Review & adopt for unapproved reflections and posts the entry id", async () => {
    h.api.mockResolvedValue({ ok: true });
    render(<BlockHistory history={[histEntry({ structuredReflections: refl })]} />);
    fireEvent.click(await screen.findByRole("button", { name: /review & adopt/i }));
    await waitFor(() =>
      expect(h.api).toHaveBeenCalledWith("/api/history", {
        method: "POST",
        body: JSON.stringify({ id: "h1" }), // filename derived server-side — client sends only the id
      })
    );
  });

  it("shows the adopted stamp and no button once approved", () => {
    render(<BlockHistory history={[histEntry({ structuredReflections: refl, reflectionsApprovedAt: "2026-06-15T00:00:00.000Z" })]} />);
    expect(screen.queryByRole("button", { name: /review & adopt/i })).toBeNull();
    expect(screen.getByText(/adopted/i)).toBeTruthy();
  });

  it("entries without reflections render no adoption control", () => {
    render(<BlockHistory history={[histEntry({})]} />);
    expect(screen.queryByRole("button", { name: /review & adopt/i })).toBeNull();
  });
});
```

- [ ] **Step 10.2: Run, verify failure.** `npx vitest run components/dashboard/plan.test.tsx` →
  FAIL (no such button).

- [ ] **Step 10.3: Implement.** Inside `BlockHistory`'s per-entry card (after the existing summary
  lines), add:

```tsx
{entry.structuredReflections?.length ? (
  entry.reflectionsApprovedAt ? (
    <p className="mt-2 text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
      Adopted {new Date(entry.reflectionsApprovedAt).toLocaleDateString()} — these notes reach the next block
    </p>
  ) : (
    <ReflectionAdopt id={entry.id} />
  )
) : null}
```

With the worker component (module scope, same file):

```tsx
function ReflectionAdopt({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api("/api/history", { method: "POST", body: JSON.stringify({ id }) });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't adopt.");
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="rounded-md border border-amber-400 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-[#ff49c8]/40 dark:text-[#ff49c8]"
      >
        {busy ? "Adopting…" : "Review & adopt"}
      </button>
      <span className="text-[10px] text-zinc-500 dark:text-zinc-400">lets these notes steer the next block</span>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}
```

Imports to add in `plan.tsx`: `useState` (likely present). No `retroFileId` import — the endpoint
derives the filename server-side. After a successful adopt the stamp won't appear until reload —
acceptable (matches the view's existing load-on-mount pattern); optionally bubble a refresh
callback if `BlockHistory` already receives one.

- [ ] **Step 10.4: Run, verify green; commit**

Run: `npx vitest run components/dashboard/plan.test.tsx` → PASS.

```bash
git add components/dashboard/plan.tsx components/dashboard/plan.test.tsx
git commit -m "feat(plan): review-and-adopt control for AI-authored block reflections"
```

---

## Task 11: Generation consumption — swap the filter

**Files:**
- Modify: `app/api/generate/route.ts` (~line 169)
- Test: covered by Task 5's unit tests through the helper; the route line is a one-call swap.

- [ ] **Step 11.1: Swap the selection.** Replace:

```ts
    const reflectionsContext = formatReflectionsForPrompt(
      blockHistory.find((h) => h.structuredReflections?.length)?.structuredReflections ?? []
    );
```

with:

```ts
    const reflectionsContext = formatReflectionsForPrompt(latestApprovedReflections(blockHistory));
```

Update the import: `formatReflectionsForPrompt` and `latestApprovedReflections` both live in
`@/lib/retrospective-schema` — extend whichever existing import brings the former (check the file's
import block; it may come via `@/lib/anthropic-api`'s re-export — if so, import
`latestApprovedReflections` directly from `@/lib/retrospective-schema` alongside).

Seeds need NO change here: `latestRetrospectiveSeeds()` (line ~98) is already gated inside
kb-loader by Task 4.

- [ ] **Step 11.2: Verify.**

Run: `npx vitest run lib/system-prompt.test.ts app/api/generate 2>/dev/null || npx vitest run lib/system-prompt.test.ts`
then `npx tsc --noEmit -p .`
Expected: cached/dynamic split contract still holds; tsc clean.

- [ ] **Step 11.3: Commit**

```bash
git add app/api/generate/route.ts
git commit -m "feat(generate): inject only athlete-approved reflections from the newest entry"
```

---

## Task 12: Docs — canonical descriptions follow the code

**Files:**
- `docs/systems/04-knowledge.md`: rewrite "The two feedback channels" — channel 1 (seeds) now
  adoption-gated via `seeds_approved:`; channel 2 (structured reflections) approval-stamped via
  `reflectionsApprovedAt`, newest-entry-only injection; frontmatter contract section gains the new
  keys (`seeds_approved`, `ended_early*`, `execution_*`).
- `docs/systems/02-scoring-and-learning.md`: in "Where each piece runs"/rough edges, note the
  closeout consumes the frozen ledger read-only and that retro compliance figures are capped.
- `docs/RECIPES.md` § Turn over a block: new steps — wrap up (finished blocks proceed; unfinished
  require the explicit reason), VERIFY `data/block-history.json` newest entry has `closeout`,
  REVIEW + ADOPT on Plan before generating the next block, degraded mode note (key unset ⇒ facts +
  seeds still land, narrative absent).
- `docs/FILE_INDEX.md`: add `lib/block-closeout.ts`; note `/api/history` POST.
- `docs/INVARIANTS.md`: append ONE numbered invariant (next free number): closeout write order
  (markdown → history → CAS-clear LAST), adoption-gated reflection/seed injection, the overshoot
  bar, and the effective-closeout-date window; cross-reference review decisions #49–51.
- `FEATURES.md`: update the Plan-page capability lines (early-end closeout, adoption control,
  degraded mode).
- Stale-pointer sweep (AGENTS.md bug class): `grep -rn "next_block_seeds\|Coach reflections\|safe
  to progress" docs/*.md docs/systems components` — fix anchors/copy the rename touches
  (KnowledgeBaseEditor's line-141 blurb becomes "…steers the next generated block once you adopt it
  on the Plan page").

- [ ] **Step 12.1:** Apply edits. Run: `npm run check-links` → no broken links.
- [ ] **Step 12.2: Commit**

```bash
git add docs/systems/04-knowledge.md docs/systems/02-scoring-and-learning.md docs/RECIPES.md \
        docs/FILE_INDEX.md docs/INVARIANTS.md FEATURES.md components/KnowledgeBaseEditor.tsx
git commit -m "docs: adoption-gated closeout descriptions follow the code"
```

(Stage only files actually modified.)

---

## Task 13: Full verification

- [ ] **Step 13.1:**

Run: `npm run check`
Expected: tsc + lint + vitest ALL green, `check-links` green.

---

## Task 14: Attended live smoke run (with the athlete — backup first, exact steps)

Two runs: the REAL closeout (Claude attended, RECIPES discipline) and an ISOLATED degraded-mode run
on a throwaway block with exact create/verify/restore steps. Do NOT improvise beyond these steps.

**Part A — normal path (real block)**

- [ ] **Step 14.1:** `curl -s http://localhost:3000/api/export -o ~/nodevelo-export-$(date +%Y%m%d-%H%M%S).json`
  (the undo for everything below).
- [ ] **Step 14.2:** Sync so final rides are scored. Confirm the block is genuinely finished, or agree the
  early-end reason together.
- [ ] **Step 14.3:** Wrap up from /plan. READ the generated markdown
  (`knowledge-base/block-retrospectives/<fileId>.md`): compliance figures must equal capped ledger
  values; any overshoot day labeled a data signal (never "landed well"); `seeds_approved: false`
  present; narrative sane.
- [ ] **Step 14.4:** On /plan, Review & Adopt the entry. Verify:
  `jq '.[0].reflectionsApprovedAt' data/block-history.json` → timestamp; the retro file now contains
  `seeds_approved: true`; `data/ai-usage.json` gained the retrospective call(s).
- [ ] **Step 14.5:** Generate the next block and confirm PREVIOUS BLOCK PRIORITIES / COACH REFLECTIONS
  appear only because adoption happened (this doubles as the changed-AI-path smoke for generation).

**Part B — degraded mode (isolated throwaway, exact restore)**

- [ ] **Step 14.6:** Stop the dev server (Ctrl-C). Write the throwaway DIRECTLY to disk (no LLM, no
  calendar events; unique `createdAt` cannot collide with real ids):

```bash
cat > data/current-block.json <<'EOF'
{
  "goal": "Degraded-mode smoke",
  "lengthWeeks": 1,
  "startDate": "2026-08-10",
  "endDate": "2099-01-01",
  "overview": "throwaway",
  "createdAt": "smoke-degraded-0000000000000",
  "model": "claude-sonnet-4-6",
  "promptVersion": 7,
  "days": [
    { "date": "2026-08-12", "name": "Z2", "type": "Z2", "durationMin": 60 }
  ]
}
EOF
```

- [ ] **Step 14.7:** Start WITHOUT the key: `env -u ANTHROPIC_API_KEY npm run dev`
  (`isAnthropicConfigured` reads exactly that var; dotenv never overrides an unset env).
- [ ] **Step 14.8:** Sync → Plan → "End block early…" → reason `degraded-mode smoke` → Confirm early end.
  Expected: success card WITH fallback copy (no narrative), seeds listed.
- [ ] **Step 14.9:** Verify:

```bash
jq '.[0] | {hasCloseout: (.closeout != null), noNarrative: (.retrospective == null), unapproved: (.reflectionsApprovedAt == null), endedEarlyReason}' data/block-history.json
jq 'null' data/current-block.json                       # prints null — block cleared
head -20 knowledge-base/block-retrospectives/2026-08-10_degraded-mode-smoke.md   # facts frontmatter, no ## Retrospective
```

Expected: `hasCloseout: true`, `noNarrative: true`, `unapproved: true`, reason echoed; cleared
block; markdown without narrative section.

- [ ] **Step 14.10:** Restore exactly: Ctrl-C the server →
  `curl -s -X POST --data-binary @~/nodevelo-export-<timestamp>.json -H 'Content-Type: application/json' http://localhost:3000/api/import`
  (confirm the accepted request shape in `app/api/import/route.ts` first — one-line read) →
  `rm knowledge-base/block-retrospectives/2026-08-10_degraded-mode-smoke.md` → restart `npm run dev`
  normally → spot-check /plan and Trends render.

- [ ] **Step 14.11:** If ANY step misbehaves: stop, re-import the backup, report in the PR — do not
  improvise against live data.

---

## Completion criteria

| Boundary | Proof |
|---|---|
| Completed block or explicit early-end precedes closeout | Task 6 tests (409s, early-end recording); Task 8 UI flow |
| Deterministic closeout without Claude | Task 6 unconfigured/degraded tests; Task 14 Part B |
| Execution/compliance evidence, not uncapped ratio | Task 2 ledger-vs-ratio tests; Task 6 capped-values test |
| Overshoot ≠ safe-to-progress | Task 2 gating tests; Task 6 primary-ride attribution test; Task 14 Step 14.3 reading |
| Overshoot attributed to the scored ride | Task 2 same-date two-ride tests |
| Early end excludes future sessions | Task 2 cutoff test; Task 6 early-end evidence test |
| Facts/narrative/seeds separate | Distinct `closeout`/`retrospective`/`nextBlockSeeds` fields; markdown section split |
| Nothing steers the next block without adoption | Task 4 seeds gate + tests; Task 5 newest-only approval tests; Task 9 endpoint; Tasks 7/10 UI |
| Adoption is failure-safe and retryable | Task 9: markdown-failure stamps nothing, retry completes, flip-then-die converges, filename derived server-side |
| Degraded closeout survives bare archives | Task 3 collision tests |
| Ledger stays frozen | Task 9 freeze assertion; zero score-log writes across the diff |
| Old JSON/markdown readable | Task 1 back-compat; Task 4 absent-flag parsing |
| Failures never clear the block early | Task 6 ordering tests; invariant text |
| Changed AI path smoked live | Task 14 Parts A+B artifacts quoted in the PR |

Final gate: `npm run check` green → `npm run finish:agent-task` opens the implementation PR. The
closing ritual (ROADMAP Phase 1 bullet status, ARCHIVE line) happens in THAT PR — never by editing
`docs/superpowers/plans/` (immutable, INVARIANT 27).
