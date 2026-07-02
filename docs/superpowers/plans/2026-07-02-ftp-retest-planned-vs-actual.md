# #4 (measurement half) · FTP-Retest Advisory + Planned-vs-Actual per Session Type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ROADMAP #4's measurement half — an execution-driven **FTP-retest advisory** (overdelivery→stale-low only, advisory only) threaded through the CoachSnapshot spine, plus a **planned-vs-actual per-session-type** section on Trends — per the approved design `docs/superpowers/specs/2026-07-02-ftp-retest-planned-vs-actual-design.md`.

**Architecture:** One new pure module `lib/plan-vs-actual.ts` reads the immutable score ledger (`RideScoreEntry[]`) and produces (a) `aggregatePlanVsActual` rows and (b) a `detectFtpRetest` signal gated by explicit tunable thresholds (`FTP_RETEST_DEFAULTS` — a ROADMAP #2 calibration hook). The flag rides `CoachSignals → CoachSnapshot → formatCoachSnapshot` so `/api/ask`, `/api/sync` (Today card) and `/api/generate` resolve it identically (CR-9/RR-6); the Trends half ships as two new fields on the `/api/trends` payload with a presentational section component. The expected IF bands are lifted out of `computeExecutionScore`'s switch into one exported constant the scorer itself reads — reuse, never re-invent.

**Tech Stack:** Next.js 16 App Router route handlers, React 19 client components, TypeScript 5, Vitest 4 (`npm test`), Tailwind v4 class conventions already in the files being edited.

## Global Constraints

- **NEVER write FTP or `physiology.json`** (locked decision №3). The new code is a read-only consumer of the ledger; if any task seems to need a physiology write, STOP and report.
- **No underdelivery inference** (locked decision №2): the detector fires only on IF *above* the band top. Do not "improve" it with a too-high branch.
- **`lib/synthesis.ts` is OUT OF SCOPE** — that 29-line file is #4's *demote* half, not this plan.
- **TDD:** every task that changes production code writes its failing test first, watches it fail, then implements. Tests live next to sources (`lib/*.test.ts`) per repo convention.
- **No new dependencies.** `package.json` is untouched.
- **Run a single file with:** `npm test -- lib/plan-vs-actual.test.ts` (path varies per task). Full gate: `npm run check` (`tsc --noEmit && eslint && vitest run`).
- **Concurrent-agent checkout:** commit on `main` directly (no branches), stage ONLY the file(s) you touched (`git add <exact path>` — never `git add -A` or `git add .`). If a check fails in a file you did not edit, run `git status --short <file>` first — an uncommitted file is the other session's WIP; wait ~30s, retry once, then report rather than fix.
- **Commit messages:** conventional-commit style (`feat(validate): …`, `feat(snapshot): …`, `docs(roadmap): …`), each ending with a `Co-Authored-By` trailer naming the ACTUAL implementing model (not boilerplate) — e.g. `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` if Fable 5 is executing the task.
- **Recurring bug classes (AGENTS.md) — checked explicitly here:**
  - **(i) Live LLM smoke run is REQUIRED before "done"** (Task 8): this plan changes `CoachSnapshot` + `formatCoachSnapshot`, which feed `/api/ask` and `/api/generate`. Unit tests + a green build only prove the deterministic scaffolding — one real `/api/ask` call must be made and its output read.
  - **(ii) "Today" must be local, not UTC:** all new logic takes `today` as a parameter (never reads the clock); the snapshot paths already pass `resolveToday`/`s.date`, and Task 6 upgrades `/api/trends` from inline UTC to `resolveToday(?today=)` with the client sending `localToday()`. Do not inline `new Date().toISOString().slice(0, 10)` in any new "what day is it now" code. (Pure lookback day-math via `isoDaysAgo` stays UTC-anchored — that's fine.)
  - **(iii) Migration flags:** this feature adds none. If you find yourself adding a `fooMigratedAt`-style field anywhere, guard it with a truthy check, never `=== null`.
- **Fixture typing:** never widen with `any`; the repo's escape hatch is `as unknown as T` / `as never` on fixtures (see `lib/coach-snapshot.test.ts`).

## File Structure

- **Modify:** `lib/execution-score.ts` — Task 1 exports `FTP_ANCHORED_IF_BANDS` and makes the two switch cases read it (behaviour-preserving).
- **Create:** `lib/plan-vs-actual.ts` + `lib/plan-vs-actual.test.ts` — Tasks 2–3, the whole deterministic signal.
- **Modify:** `lib/coach-snapshot.ts` + `lib/coach-snapshot.test.ts` — Task 4 threads the flag; `app/api/generate/route.ts` gets a two-argument call-site update in the same task (compile-coupled).
- **Modify:** `components/CoachSnapshotCard.tsx` — Task 5, one advisory line.
- **Modify:** `app/api/trends/route.ts`, `components/trends/types.ts`, `components/Trends.tsx` — Task 6, payload + local-today.
- **Modify:** `components/trends/sections.tsx`, `components/Trends.tsx` — Task 7, the section UI.
- **Modify (docs):** `ROADMAP.md`, `ARCHIVE.md` — Task 9.

---

### Task 1: Export `FTP_ANCHORED_IF_BANDS` from the scorer (single band source)

**Files:**
- Modify: `lib/execution-score.ts` (constant near the top; switch cases at lines ~114–124)
- Test: `lib/execution-score.test.ts` (append one drift-guard describe at the end)

**Interfaces:**
- Consumes: existing `computeExecutionScore` behaviour (must NOT change — the file's band tests are the guard).
- Produces (used verbatim by Tasks 2–3):
  ```ts
  export const FTP_ANCHORED_IF_BANDS = {
    Threshold: { lo: 0.82, hi: 0.92 },
    VO2max: { lo: 0.9, hi: 1.1 },
  } as const;
  ```

- [ ] **Step 1: Write the failing drift-guard test**

Append at the END of `lib/execution-score.test.ts`:

```ts
// #4: the exported FTP-anchored bands must be the very numbers the scorer's +2 sweet-spot tier uses —
// this pins export↔scorer so the retest detector / Trends "target IF" can never drift from scoring.
describe("FTP_ANCHORED_IF_BANDS export (#4)", () => {
  it("matches the scorer's +2 sweet-spot behaviour at the band edges", () => {
    for (const [type, band] of Object.entries(FTP_ANCHORED_IF_BANDS)) {
      const at = (IF: number) => computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: IF, plannedType: type })!;
      expect(at(band.lo)).toBe(at(band.hi)); // both sweet-spot edges score identically (+2 tier)
      expect(at(band.hi)).toBeGreaterThan(at(band.hi + 0.05)); // just above the top drops out of the tier
    }
  });
});
```

And add `FTP_ANCHORED_IF_BANDS` to the file's existing import from `./execution-score` (line 2).

- [ ] **Step 2: Run it — fails on the missing export**

Run: `npm test -- lib/execution-score.test.ts`
Expected: FAIL — `FTP_ANCHORED_IF_BANDS` is not exported.

- [ ] **Step 3: Add the constant + refactor the two switch cases**

In `lib/execution-score.ts`, directly below the `DEFAULT_DECOUPLING_GOOD` export (line ~11), add:

```ts
// The "sweet spot" whole-ride IF bands for the FTP-anchored quality types — the range the scorer
// awards +2 for. Exported as the SINGLE source for ROADMAP #4's planned-vs-actual read and the
// FTP-retest overdelivery detector (lib/plan-vs-actual.ts), so the "expected IF" those surfaces show
// can never drift from what scoring rewards. Per-athlete calibration shifts these via ifBandOffsets
// at the point of use (see the switch below / the detector).
export const FTP_ANCHORED_IF_BANDS = {
  Threshold: { lo: 0.82, hi: 0.92 },
  VO2max: { lo: 0.9, hi: 1.1 },
} as const;
```

Then replace the two cases inside `computeExecutionScore`'s `switch (plannedType)` — currently:

```ts
      case "Threshold":
        if (IF >= 0.82 + o && IF <= 0.92 + o) score += 2;
        else if (IF >= 0.78 + o && IF <= 0.96 + o) score += 1;
        else if (IF < 0.74 + o || IF > 1.05 + o) score -= 2;
        else score -= 1;
        break;
      case "VO2max":
        if (IF >= 0.90 + o && IF <= 1.10 + o) score += 2;
        else if (IF >= 0.86 + o && IF <= 1.15 + o) score += 1;
        else if (IF < 0.80 + o) score -= 2;
        else if (IF > 1.20 + o) score -= 1; // sustained way over VO2 isn't the prescribed session either (RV2-8)
        break;
```

with:

```ts
      case "Threshold": {
        const b = FTP_ANCHORED_IF_BANDS.Threshold;
        if (IF >= b.lo + o && IF <= b.hi + o) score += 2;
        else if (IF >= 0.78 + o && IF <= 0.96 + o) score += 1;
        else if (IF < 0.74 + o || IF > 1.05 + o) score -= 2;
        else score -= 1;
        break;
      }
      case "VO2max": {
        const b = FTP_ANCHORED_IF_BANDS.VO2max;
        if (IF >= b.lo + o && IF <= b.hi + o) score += 2;
        else if (IF >= 0.86 + o && IF <= 1.15 + o) score += 1;
        else if (IF < 0.80 + o) score -= 2;
        else if (IF > 1.20 + o) score -= 1; // sustained way over VO2 isn't the prescribed session either (RV2-8)
        break;
      }
```

(Only the +2 tier reads the constant; the other tiers keep their literals — they have no consumer outside the scorer.)

- [ ] **Step 4: Run the WHOLE file — refactor is behaviour-preserving**

Run: `npm test -- lib/execution-score.test.ts`
Expected: all existing tests + the new one pass. If any pre-existing band test fails, your refactor changed behaviour — fix the refactor, never the old test.

- [ ] **Step 5: Commit**

```bash
git add lib/execution-score.ts lib/execution-score.test.ts
git commit -m "refactor(score): export FTP_ANCHORED_IF_BANDS as the single band source (#4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `lib/plan-vs-actual.ts` — per-type planned-vs-actual aggregation

**Files:**
- Create: `lib/plan-vs-actual.ts`
- Create: `lib/plan-vs-actual.test.ts`

**Interfaces:**
- Consumes: `FTP_ANCHORED_IF_BANDS` (Task 1); `isoDaysAgo` from `./date`; `round1`, `round2` from `./stats`; `WORKOUT_TYPES`, types `RideScoreEntry`, `WorkoutType` from `./types`.
- Produces (used verbatim by Tasks 3, 6, 7 — do not rename):
  ```ts
  export interface TypePlanVsActual {
    type: WorkoutType;
    n: number;
    meanIf: number | null;
    targetIf: { lo: number; hi: number } | null;
    meanCompliancePct: number | null;
    meanExecution: number;
  }
  export function aggregatePlanVsActual(entries: RideScoreEntry[], today: string, windowDays = 90): TypePlanVsActual[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `lib/plan-vs-actual.test.ts` with exactly:

```ts
import { describe, expect, it } from "vitest";
import { aggregatePlanVsActual } from "./plan-vs-actual";
import { FTP_ANCHORED_IF_BANDS } from "./execution-score";
import type { RideScoreEntry } from "./types";

const TODAY = "2026-07-02";

// A qualifying planned Threshold entry; override per test.
const mk = (over: Partial<RideScoreEntry> = {}): RideScoreEntry => ({
  date: "2026-06-25",
  executionScore: 8,
  plannedType: "Threshold",
  inferredType: "Threshold",
  planned: true,
  legacy: false,
  compliancePct: 100,
  intensityFactor: 0.96,
  ftpUsed: 288,
  durationMin: 75,
  tss: 90,
  ...over,
});

describe("aggregatePlanVsActual", () => {
  it("groups planned rides by type with means and the FTP-anchored target band", () => {
    const rows = aggregatePlanVsActual(
      [
        mk({ date: "2026-06-20", intensityFactor: 0.85, compliancePct: 100, executionScore: 8 }),
        mk({ date: "2026-06-25", intensityFactor: 0.91, compliancePct: 90, executionScore: 7 }),
        mk({ date: "2026-06-22", plannedType: "Z2", inferredType: "Z2", intensityFactor: 0.68, compliancePct: 95, executionScore: 9 }),
      ],
      TODAY
    );
    expect(rows.map((r) => r.type)).toEqual(["Z2", "Threshold"]); // WORKOUT_TYPES order
    const th = rows.find((r) => r.type === "Threshold")!;
    expect(th).toMatchObject({ n: 2, meanIf: 0.88, meanCompliancePct: 95, meanExecution: 7.5 });
    expect(th.targetIf).toEqual({ lo: FTP_ANCHORED_IF_BANDS.Threshold.lo, hi: FTP_ANCHORED_IF_BANDS.Threshold.hi });
    expect(rows.find((r) => r.type === "Z2")!.targetIf).toBeNull(); // no single FTP anchor for Z2
  });

  it("excludes off-plan, legacy, compromised and out-of-window entries", () => {
    const rows = aggregatePlanVsActual(
      [
        mk({ date: "2026-06-25" }),
        mk({ date: "2026-06-26", planned: false, plannedType: null }),
        mk({ date: "2026-06-27", legacy: true }),
        mk({ date: "2026-06-28", compromised: true }),
        mk({ date: "2026-03-01" }), // beyond the 90d window
        mk({ date: "2026-07-03" }), // future — not yet lived
      ],
      TODAY
    );
    expect(rows).toEqual([expect.objectContaining({ type: "Threshold", n: 1 })]);
  });

  it("averages IF over only the entries that carry one, but counts all in n", () => {
    const rows = aggregatePlanVsActual([mk({ intensityFactor: 0.9 }), mk({ date: "2026-06-26", intensityFactor: null })], TODAY);
    expect(rows[0]).toMatchObject({ n: 2, meanIf: 0.9 });
  });
});
```

- [ ] **Step 2: Run it — fails on the missing module**

Run: `npm test -- lib/plan-vs-actual.test.ts`
Expected: FAIL — cannot resolve `./plan-vs-actual`.

- [ ] **Step 3: Write the module (aggregation half)**

Create `lib/plan-vs-actual.ts` with exactly:

```ts
// ROADMAP #4 (measurement half): the planned-vs-actual read over the immutable score ledger, and the
// execution-driven FTP-retest advisory derived from it. Pure + deterministic — no IO, no clock (the
// caller passes `today`), no LLM: any model downstream only ever REPHRASES the evidence string here.
// Advisory only: nothing in this module (or its consumers) writes FTP — physiology.json stays the
// synced source of truth; the athlete re-tests in Intervals.icu and the new value syncs back.

import { FTP_ANCHORED_IF_BANDS } from "./execution-score";
import { isoDaysAgo } from "./date";
import { round1, round2 } from "./stats";
import { WORKOUT_TYPES } from "./types";
import type { RideScoreEntry, WorkoutType } from "./types";

// The trainable slice of the ledger, windowed: executed-against-a-real-prescription entries only.
// legacy (pre-app — no plan to be "off") and compromised (equipment/sickness — must not teach) are
// excluded, matching the execution-metric filter used across the app. Window is (today−windowDays,
// today] — pure day-math off the passed local date (AGENTS.md: the module never reads the clock).
function qualifying(entries: RideScoreEntry[], today: string, windowDays: number): RideScoreEntry[] {
  const cutoff = isoDaysAgo(windowDays, Date.parse(today));
  return entries.filter((e) => e.planned && !e.legacy && !e.compromised && e.date > cutoff && e.date <= today);
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export interface TypePlanVsActual {
  type: WorkoutType;
  n: number; // qualifying planned sessions of this type in the window
  meanIf: number | null; // mean delivered whole-ride IF (over the entries that carry one)
  // The FTP-derived "prescribed intensity" for FTP-anchored types — the same sweet-spot band
  // computeExecutionScore awards +2 for (population values; per-entry calibration offsets shift the
  // DETECTOR's math below, not this display band — a ≤±0.08 display shift isn't worth a second path).
  targetIf: { lo: number; hi: number } | null;
  meanCompliancePct: number | null;
  meanExecution: number; // qualifying entries always carry an executionScore
}

// Per-session-type planned-vs-actual over the trailing window: what was prescribed (type + its IF
// band) vs what was delivered (mean IF, completion, execution). Types with no qualifying sessions are
// omitted; rows follow WORKOUT_TYPES order. Default 90d = the same "rolling 90 days" era the Trends
// baselines card speaks in.
export function aggregatePlanVsActual(entries: RideScoreEntry[], today: string, windowDays = 90): TypePlanVsActual[] {
  const byType = new Map<WorkoutType, RideScoreEntry[]>();
  for (const e of qualifying(entries, today, windowDays)) {
    if (!e.plannedType) continue; // planned entries always carry one; defensive
    const arr = byType.get(e.plannedType) ?? [];
    arr.push(e);
    byType.set(e.plannedType, arr);
  }
  return [...byType.entries()]
    .map(([type, es]) => {
      const ifMean = mean(es.map((e) => e.intensityFactor).filter((v): v is number => v !== null));
      const compMean = mean(es.map((e) => e.compliancePct).filter((v): v is number => v !== null));
      const band = type in FTP_ANCHORED_IF_BANDS ? FTP_ANCHORED_IF_BANDS[type as keyof typeof FTP_ANCHORED_IF_BANDS] : null;
      return {
        type,
        n: es.length,
        meanIf: ifMean !== null ? round2(ifMean) : null,
        targetIf: band ? { lo: band.lo, hi: band.hi } : null,
        meanCompliancePct: compMean !== null ? Math.round(compMean) : null,
        meanExecution: round1(es.reduce((s, e) => s + e.executionScore, 0) / es.length),
      };
    })
    .sort((a, b) => WORKOUT_TYPES.indexOf(a.type) - WORKOUT_TYPES.indexOf(b.type));
}
```

- [ ] **Step 4: Run — 3 tests pass**

Run: `npm test -- lib/plan-vs-actual.test.ts`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/plan-vs-actual.ts lib/plan-vs-actual.test.ts
git commit -m "feat(validate): planned-vs-actual per-type aggregation over the ledger (#4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `detectFtpRetest` — the overdelivery→stale-low advisory

**Files:**
- Modify: `lib/plan-vs-actual.ts` (append below the aggregation)
- Modify: `lib/plan-vs-actual.test.ts` (append a describe; extend the import line)

**Interfaces:**
- Consumes (Task 2, same file): `qualifying`, `FTP_ANCHORED_IF_BANDS`, `round1`.
- Produces (used verbatim by Tasks 4 and 6 — do not rename):
  ```ts
  export interface FtpRetestConfig { windowDays: number; minSessions: number; minCompletionPct: number; minOverFraction: number; minMeanOvershoot: number }
  export const FTP_RETEST_DEFAULTS: FtpRetestConfig;
  export interface FtpRetestSignal { n: number; overCount: number; meanOvershootPct: number; windowDays: number; evidence: string }
  export function detectFtpRetest(entries: RideScoreEntry[], today: string, currentFtp: number | null, cfg?: FtpRetestConfig): FtpRetestSignal | null;
  ```

- [ ] **Step 1: Write the failing tests**

Extend the test file's first import to `import { aggregatePlanVsActual, detectFtpRetest, FTP_RETEST_DEFAULTS } from "./plan-vs-actual";`, then append at the END of `lib/plan-vs-actual.test.ts`:

```ts
describe("detectFtpRetest", () => {
  // 3 Threshold sessions at IF 0.96 (top 0.92 → +0.04 each) + 1 VO2max at 1.13 (top 1.10 → +0.03):
  // n=4, all over, mean overshoot 0.0375 → fires with meanOvershootPct 3.8.
  const trippingLedger = [
    mk({ date: "2026-06-10" }),
    mk({ date: "2026-06-16" }),
    mk({ date: "2026-06-22" }),
    mk({ date: "2026-06-28", plannedType: "VO2max", inferredType: "VO2max", intensityFactor: 1.13 }),
  ];

  it("fires on consistent overdelivery above the band top at high completion", () => {
    const sig = detectFtpRetest(trippingLedger, TODAY, 288);
    expect(sig).toMatchObject({ n: 4, overCount: 4, windowDays: 42, meanOvershootPct: 3.8 });
    expect(sig!.evidence).toContain("288");
    expect(sig!.evidence).toContain("re-test in Intervals.icu");
  });

  it("withholds below the session gate (thin data → null)", () => {
    expect(detectFtpRetest(trippingLedger.slice(0, 3), TODAY, 288)).toBeNull();
  });

  it("withholds when the over-fraction is too low, even with a big mean overshoot", () => {
    const mixed = [
      mk({ date: "2026-06-10", intensityFactor: 1.05 }),
      mk({ date: "2026-06-16", intensityFactor: 1.05 }),
      mk({ date: "2026-06-22", intensityFactor: 0.9 }),
      mk({ date: "2026-06-28", intensityFactor: 0.9 }),
    ];
    expect(detectFtpRetest(mixed, TODAY, 288)).toBeNull(); // 2/4 over < 0.75 despite mean +0.055
  });

  it("withholds when the mean margin is thin (borderline noise)", () => {
    const thin = trippingLedger.map((e) => ({ ...e, intensityFactor: e.plannedType === "VO2max" ? 1.11 : 0.93 }));
    expect(detectFtpRetest(thin, TODAY, 288)).toBeNull(); // all over, but mean +0.01 < 0.02
  });

  it("respects each entry's frozen per-athlete band offset (ROADMAP #2)", () => {
    const shifted = trippingLedger.map((e) => ({ ...e, calibration: { ifBandOffset: 0.06 } }));
    expect(detectFtpRetest(shifted, TODAY, 288)).toBeNull(); // tops move to 0.98 / 1.16 — nothing is over
  });

  it("counts only sessions scored against the CURRENT FTP — a re-test resets the window", () => {
    const reTested = trippingLedger.map((e) => ({ ...e, ftpUsed: 260 }));
    expect(detectFtpRetest(reTested, TODAY, 288)).toBeNull(); // old-FTP evidence must not nag post-re-test
  });

  it("gates on completion and skips non-anchored / IF-less / off-plan entries", () => {
    const noisy = [
      ...trippingLedger.slice(0, 3),
      mk({ date: "2026-06-29", compliancePct: 70 }), // cut short / blown up — not threshold evidence
      mk({ date: "2026-06-30", plannedType: "Z2", inferredType: "Z2" }), // not FTP-anchored
      mk({ date: "2026-07-01", intensityFactor: null }),
      mk({ date: "2026-07-02", planned: false, plannedType: null }),
    ];
    expect(detectFtpRetest(noisy, TODAY, 288)).toBeNull(); // only 3 qualify — below the gate
  });

  it("returns null without a current FTP", () => {
    expect(detectFtpRetest(trippingLedger, TODAY, null)).toBeNull();
  });

  it("takes overridden thresholds — the ROADMAP #2 calibration hook", () => {
    const sig = detectFtpRetest(trippingLedger.slice(0, 3), TODAY, 288, { ...FTP_RETEST_DEFAULTS, minSessions: 3 });
    expect(sig).toMatchObject({ n: 3, overCount: 3 });
  });
});
```

- [ ] **Step 2: Run — the new describe fails on missing exports**

Run: `npm test -- lib/plan-vs-actual.test.ts`
Expected: 3 pass (Task 2), the new ones FAIL — `detectFtpRetest` is not exported.

- [ ] **Step 3: Append the detector to `lib/plan-vs-actual.ts`**

```ts
// ---------- FTP-retest advisory (#4) — overdelivery → stale-low ONLY ----------
// Physiological asymmetry (locked design decision): with a CORRECT FTP, sustained riding above the
// band collapses completion — you blow up. Repeated above-band delivery AT HIGH COMPLETION is only
// possible if the real threshold sits above the configured one. The inverse does NOT hold
// (underdelivery is fatigue/illness/heat-confounded), so no "FTP too high" branch exists — by design.

// Population defaults, tuned low-false-positive (an advisory that cries wolf gets ignored). All five
// are a ROADMAP #2 calibration hook: per-athlete derivation (e.g. margin from the athlete's own IF
// variance) later overrides this object; the detector itself never changes.
export interface FtpRetestConfig {
  windowDays: number; // trailing window (~a training block + spillover)
  minSessions: number; // n gate — below it the signal is withheld (null), like other gated signals
  minCompletionPct: number; // a session must have been DELIVERED to count (compliancePct gate; the
  // resolveCompliance cap means ≥85 also implies executionScore ≥ 5 — blow-ups can't qualify)
  minOverFraction: number; // ≥ this share individually above their band top (tolerates one diluted outlier)
  minMeanOvershoot: number; // mean IF excess above the band top, as FTP fraction (noise floor ~2% FTP)
}
export const FTP_RETEST_DEFAULTS: FtpRetestConfig = {
  windowDays: 42,
  minSessions: 4,
  minCompletionPct: 85,
  minOverFraction: 0.75,
  minMeanOvershoot: 0.02,
};

export interface FtpRetestSignal {
  n: number; // qualifying FTP-anchored sessions in the window
  overCount: number; // how many individually exceeded their band top
  meanOvershootPct: number; // mean (IF − band top) across the n, as % of FTP
  windowDays: number;
  evidence: string; // deterministic human/LLM-readable line — a model may rephrase, never invent
}

// The execution-driven FTP-staleness read. Each entry is judged against the band that scored IT
// (population top + the entry's frozen calibration.ifBandOffset — ledger-reproducible), and only
// entries scored against the CURRENT ftp count (`ftpUsed === currentFtp`): the moment the athlete
// re-tests, old-FTP evidence stops counting and the window restarts — the flag can never nag
// "re-test" right after a re-test.
export function detectFtpRetest(
  entries: RideScoreEntry[],
  today: string,
  currentFtp: number | null,
  cfg: FtpRetestConfig = FTP_RETEST_DEFAULTS
): FtpRetestSignal | null {
  if (currentFtp === null || !Number.isFinite(currentFtp) || currentFtp <= 0) return null;
  const anchored = qualifying(entries, today, cfg.windowDays).filter(
    (e) =>
      e.plannedType !== null &&
      e.plannedType in FTP_ANCHORED_IF_BANDS &&
      e.intensityFactor !== null &&
      e.compliancePct !== null &&
      e.compliancePct >= cfg.minCompletionPct &&
      e.ftpUsed === currentFtp
  );
  if (anchored.length < cfg.minSessions) return null;
  const overshoots = anchored.map((e) => {
    const band = FTP_ANCHORED_IF_BANDS[e.plannedType as keyof typeof FTP_ANCHORED_IF_BANDS];
    return (e.intensityFactor as number) - (band.hi + (e.calibration?.ifBandOffset ?? 0));
  });
  const overCount = overshoots.filter((d) => d > 0).length;
  const meanOvershoot = overshoots.reduce((a, b) => a + b, 0) / overshoots.length;
  if (overCount / anchored.length < cfg.minOverFraction || meanOvershoot < cfg.minMeanOvershoot) return null;
  const meanOvershootPct = round1(meanOvershoot * 100);
  return {
    n: anchored.length,
    overCount,
    meanOvershootPct,
    windowDays: cfg.windowDays,
    evidence:
      `${overCount} of ${anchored.length} FTP-anchored quality sessions (Threshold/VO2max, last ${cfg.windowDays}d, ` +
      `≥${cfg.minCompletionPct}% completion) delivered IF above the FTP-derived target band — on average ` +
      `${meanOvershootPct}% of FTP over the band top. FTP ${currentFtp}W is likely set too low; re-test in ` +
      `Intervals.icu (the new value syncs back automatically).`,
  };
}
```

- [ ] **Step 4: Run — 12 tests pass**

Run: `npm test -- lib/plan-vs-actual.test.ts`
Expected: `12 passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/plan-vs-actual.ts lib/plan-vs-actual.test.ts
git commit -m "feat(validate): execution-driven FTP-retest advisory detector (#4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Thread `ftpRetest` through the CoachSnapshot spine (+ generate call site)

**Files:**
- Modify: `lib/coach-snapshot.ts` (interfaces + `resolveCoachSignals` + `buildCoachSnapshot` + `buildCoachSnapshotFromSources` + `formatCoachSnapshot`)
- Modify: `app/api/generate/route.ts:166` (one call-site line — compile-coupled: `CoachSignals.ftpRetest` is a REQUIRED field, and generate spreads `...signals`)
- Test: `lib/coach-snapshot.test.ts`

**Interfaces:**
- Consumes: `detectFtpRetest`, `FtpRetestSignal` (Task 3).
- Produces (relied on by Tasks 5, 8):
  - `CoachSignals.ftpRetest: FtpRetestSignal | null` (required — the compiler enforces every constructor)
  - `CoachSnapshot.ftpRetest: FtpRetestSignal | null`
  - `resolveCoachSignals(sync, athleteModel, baselines, acwrBandsOverride?, athleteStateWeightsOverride?, today?, scoreEntries: RideScoreEntry[] = [], currentFtp: number | null = null): CoachSignals`
  - `formatCoachSnapshot` emits `- FTP check: <evidence>` when the flag is set.
- Zero changes to `/api/ask` and `/api/sync`: both build via `buildCoachSnapshotFromSources`, which already holds `s.scoreEntries` + `s.ftp` (verified — `app/api/ask/route.ts:66`, `app/api/sync/route.ts:92` and `:456`).
- `formatFormFuelLine` is deliberately NOT changed (design §3: the planner must not act on unvalidated physiology).

- [ ] **Step 1: Write the failing tests**

In `lib/coach-snapshot.test.ts`:

1. Add `RideScoreEntry` to the type import (line 4): `import type { AthleteState, CurrentBlock, DispositionEntry, InterventionLog, MorningCheckEntry, RideScoreEntry, RollingBaselines, SyncData, TodayAnalysis } from "./types";`
2. In `baseInput` (line ~46), add one field after `morningCheck: null,`:

```ts
    ftpRetest: null,
```

3. Inside the existing `describe("buildCoachSnapshotFromSources", …)` block, append BEFORE its closing `});` (after the energy-availability test, line ~235):

```ts
  // #4: the FTP-retest advisory rides CoachSignals so every snapshot consumer resolves it identically.
  // Fixture: 4 in-window Threshold rides at IF 0.96 (band top 0.92), full completion, scored against
  // the sources() FTP of 280 → n=4, all over, mean overshoot +0.04 → fires.
  const overRide = (date: string): RideScoreEntry => ({
    date,
    executionScore: 8,
    plannedType: "Threshold",
    inferredType: "Threshold",
    planned: true,
    legacy: false,
    compliancePct: 100,
    intensityFactor: 0.96,
    ftpUsed: 280,
    durationMin: 75,
    tss: 90,
  });

  it("resolves the FTP-retest advisory from the ledger and formats it end-to-end (#4)", () => {
    const scoreEntries = [overRide("2026-06-13"), overRide("2026-06-15"), overRide("2026-06-17"), overRide("2026-06-19")];
    const s = buildCoachSnapshotFromSources(sources({ scoreEntries }));
    expect(s.ftpRetest).toMatchObject({ n: 4, overCount: 4 });
    const out = formatCoachSnapshot(s);
    expect(out).toContain("- FTP check:");
    expect(out).toContain("re-test in Intervals.icu");
  });

  it("stays null on a thin ledger and renders no FTP-check line (#4)", () => {
    const s = buildCoachSnapshotFromSources(sources({ scoreEntries: [overRide("2026-06-13")] }));
    expect(s.ftpRetest).toBeNull();
    expect(formatCoachSnapshot(s)).not.toContain("FTP check");
  });
```

- [ ] **Step 2: Run — fails (property doesn't exist / type error)**

Run: `npm test -- lib/coach-snapshot.test.ts`
Expected: FAIL — `ftpRetest` unknown on the input/snapshot types.

- [ ] **Step 3: Implement the threading in `lib/coach-snapshot.ts`**

Six surgical edits:

1. **Import** — below the `timeAboveZ2Fraction` import (line ~26) add:

```ts
import { detectFtpRetest, type FtpRetestSignal } from "./plan-vs-actual";
```

2. **`CoachSnapshot`** — after the `disposition` field (line ~83) add:

```ts
  // Execution-driven FTP-retest advisory (ROADMAP #4): non-null only when recent FTP-anchored quality
  // sessions consistently over-delivered vs the FTP-derived band (lib/plan-vs-actual.ts). Advisory
  // ONLY — nudges an Intervals.icu re-test; never writes FTP locally (physiology.json stays the SoT).
  ftpRetest: FtpRetestSignal | null;
```

3. **`CoachSignals`** — after `energyAvailability` (line ~96) add:

```ts
  // Execution-driven FTP-retest advisory (#4) — resolved here so /ask, /sync and /generate can't
  // drift (CR-9). Null below the overdelivery gates (thin data / nothing over / no current FTP).
  ftpRetest: FtpRetestSignal | null;
```

4. **`resolveCoachSignals`** — extend the signature after `today?: string` (line ~128):

```ts
  today?: string,
  // #4: the frozen ledger + the FTP currently configured (physiology SoT with profile fallback) —
  // the retest detector's inputs. Omitted → the advisory resolves null (same silent-degradation
  // contract as the optional `today` above; the failure direction is conservative: flag absent).
  scoreEntries: RideScoreEntry[] = [],
  currentFtp: number | null = null
```

Extend the early return (line ~130) to `{ fitness: null, readiness: null, acwr: null, loadRamp: null, athleteState: null, weightTrend7dKg: null, energyAvailability: null, ftpRetest: null }`, and add to the main return object (after the `energyAvailability:` entry):

```ts
    ftpRetest: detectFtpRetest(scoreEntries, today ?? utcToday(), currentFtp),
```

5. **`buildCoachSnapshot`** — in the returned object, after the `disposition:` mapping (line ~268) add:

```ts
    ftpRetest: input.ftpRetest,
```

(No other change — `CoachSnapshotInput extends CoachSignals`, so the field arrives for free.)

6. **`buildCoachSnapshotFromSources`** — the `resolveCoachSignals` call (line ~295) gains the two arguments:

```ts
  const signals = resolveCoachSignals(s.sync, athleteModel, s.baselines, s.acwrBandsOverride, s.athleteStateWeightsOverride, s.date, s.scoreEntries, s.ftp);
```

7. **`formatCoachSnapshot`** — directly below `if (s.ftp) lines.push(`- FTP: ${s.ftp} W.`);` (line ~392) add:

```ts
  if (s.ftpRetest) lines.push(`- FTP check: ${s.ftpRetest.evidence}`);
```

- [ ] **Step 4: Update the generate call site**

In `app/api/generate/route.ts` line 166, change:

```ts
    const signals = resolveCoachSignals(sync, athleteModel, baselines, blockSettings.acwrBands, blockSettings.athleteStateWeights, new Date().toISOString().slice(0, 10));
```

to:

```ts
    const signals = resolveCoachSignals(sync, athleteModel, baselines, blockSettings.acwrBands, blockSettings.athleteStateWeights, new Date().toISOString().slice(0, 10), scoreLog.entries, profile.performance.ftp);
```

(`scoreLog` and `profile` are already in scope — the route loads both. The inline UTC date is pre-existing and out of scope here; do not refactor it in this task. `formatFormFuelLine` does not render the flag, so generation's prompt is unchanged — the resolution exists so the two paths can't drift.)

- [ ] **Step 5: Run the file, then the full suite**

Run: `npm test -- lib/coach-snapshot.test.ts`
Expected: all existing tests + 2 new ones pass (`baseInput`'s `ftpRetest: null` keeps every old case behaviour-identical).

Run: `npm test`
Expected: full suite green — this catches any other `CoachSignals` constructor the compiler flags (there are none as of plan-writing: `resolveCoachSignals` + the test `baseInput` are the only literal constructors).

- [ ] **Step 6: Commit**

```bash
git add lib/coach-snapshot.ts lib/coach-snapshot.test.ts app/api/generate/route.ts
git commit -m "feat(snapshot): thread the FTP-retest advisory through CoachSignals (#4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Today card — advisory line on `CoachSnapshotCard`

**Files:**
- Modify: `components/CoachSnapshotCard.tsx`

**Interfaces:**
- Consumes: `CoachSnapshot.ftpRetest` (Task 4). No component-test infra exists in this repo — the render is verified by the Task 8 smoke + typecheck; keep the change minimal.

- [ ] **Step 1: Add the line + widen the hide-guard**

In `components/CoachSnapshotCard.tsx`, change the early return (line ~18):

```ts
  if (!form.tsbModifier && fuelBits.length === 0 && !snapshot.ftpRetest) return null;
```

and after the fuel `<p>` block (line ~36, still inside the card `<div>`), add:

```tsx
      {snapshot.ftpRetest && (
        <p className="mt-1 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
          <span className="font-semibold">FTP check:</span> {snapshot.ftpRetest.evidence}
        </p>
      )}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (If an error appears in a file you did NOT touch, apply the concurrent-agent rule from Global Constraints.)

- [ ] **Step 3: Commit**

```bash
git add components/CoachSnapshotCard.tsx
git commit -m "feat(today): FTP-retest advisory line on the coach's-read card (#4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `/api/trends` payload + local-today resolution

**Files:**
- Modify: `app/api/trends/route.ts`
- Modify: `components/trends/types.ts`
- Modify: `components/Trends.tsx` (query only — the section UI is Task 7)

**Interfaces:**
- Consumes: `aggregatePlanVsActual`, `detectFtpRetest`, `TypePlanVsActual`, `FtpRetestSignal` (Tasks 2–3); `resolveToday`/`localToday` from `lib/date.ts:33/12`.
- Produces (relied on by Task 7): `TrendsData.planVsActual: TypePlanVsActual[]` and `TrendsData.ftpRetest: FtpRetestSignal | null`.
- No route-test file exists for `/api/trends` (only sync/generate/disposition have them — SUB-3 scope); the aggregation is fully unit-tested in `lib/`, the route addition is a two-line pass-through, and Task 8's smoke exercises it live. Do not build a new route-test harness for this.

- [ ] **Step 1: Route changes** (`app/api/trends/route.ts`)

Add two imports below the existing `@/lib/trends` import:

```ts
import { resolveToday } from "@/lib/date";
import { aggregatePlanVsActual, detectFtpRetest } from "@/lib/plan-vs-actual";
```

Change the handler signature `export async function GET() {` to:

```ts
export async function GET(req: Request) {
```

Replace line 31's inline UTC today —

```ts
  const today = new Date().toISOString().slice(0, 10);
```

with:

```ts
  // Client-supplied local date (AGENTS.md: "today" must be the athlete's local day, not server UTC);
  // falls back to UTC when absent. Also anchors the #4 planned-vs-actual / retest windows below.
  const today = resolveToday(new URL(req.url).searchParams.get("today"));
```

(`today` already feeds `weeklyEnergy` — semantics preserved, now local-correct. Leave the `zoneCutoff`/`cutoff7` `Date.now()` lookbacks alone: pure day-math, explicitly fine per AGENTS.md.)

In the `NextResponse.json({ … })` payload, add directly above `syncedAt`:

```ts
    // #4 planned-vs-actual: per-type prescription-vs-delivery (trailing 90d) + the execution-driven
    // FTP-retest advisory — the same detector the CoachSnapshot carries, so the two surfaces agree.
    // FTP source mirrors the snapshot paths: physiology SoT first, profile fallback.
    planVsActual: aggregatePlanVsActual(scoreLog.entries, today),
    ftpRetest: detectFtpRetest(scoreLog.entries, today, physiology?.current.ftp ?? ftp),
```

- [ ] **Step 2: Payload type** (`components/trends/types.ts`)

Add below the existing imports:

```ts
import type { FtpRetestSignal, TypePlanVsActual } from "@/lib/plan-vs-actual";
```

and inside `interface TrendsData`, after `zones: number[];`:

```ts
  // #4: prescription-vs-delivery per planned session type (trailing 90d) + the FTP-retest advisory.
  planVsActual: TypePlanVsActual[];
  ftpRetest: FtpRetestSignal | null;
```

- [ ] **Step 3: Client sends its local day** (`components/Trends.tsx`)

Add to the imports:

```ts
import { localToday } from "@/lib/date";
```

and change the query (line ~23):

```ts
    queryFn: () => api<TrendsData>(`/api/trends?today=${localToday()}`),
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: clean + full suite green (no test asserts the trends payload shape — the type system is the contract here).

- [ ] **Step 5: Commit**

```bash
git add app/api/trends/route.ts components/trends/types.ts components/Trends.tsx
git commit -m "feat(trends): planned-vs-actual + ftpRetest payload, local-today resolution (#4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Trends UI — the Planned-vs-actual section

**Files:**
- Modify: `components/trends/sections.tsx` (append one component)
- Modify: `components/Trends.tsx` (mount it beside Weekly volume)

**Interfaces:**
- Consumes: `TrendsData.planVsActual` / `TrendsData.ftpRetest` (Task 6); `TYPE_STYLES` (already imported in sections.tsx); the file's existing `Card` layout conventions in Trends.tsx.

- [ ] **Step 1: Append the section component**

At the END of `components/trends/sections.tsx`:

```tsx
// #4 planned-vs-actual: prescription (type + FTP-derived IF band) vs delivery (mean IF, completion,
// execution) per planned session type over the trailing 90 days, straight off the immutable ledger.
// The FTP-retest advisory (the same deterministic detector the CoachSnapshot carries) renders beneath
// when triggered — advisory only: the athlete re-tests in Intervals.icu and the new FTP syncs back.
export function PlanVsActual({ rows, ftpRetest }: { rows: TrendsData["planVsActual"]; ftpRetest: TrendsData["ftpRetest"] }) {
  if (rows.length === 0) return null;
  const f2 = (v: number) => v.toFixed(2);
  return (
    <div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.type} className="rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${TYPE_STYLES[r.type]?.cell ?? "bg-zinc-400"}`} />
              <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{r.type}</span>
              <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">n={r.n}</span>
              <span className="ml-auto font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                {r.targetIf && (
                  <span className="text-zinc-500 dark:text-zinc-400">
                    target IF {f2(r.targetIf.lo)}–{f2(r.targetIf.hi)} ·{" "}
                  </span>
                )}
                {r.meanIf !== null ? (
                  <span className={r.targetIf && r.meanIf > r.targetIf.hi ? "font-semibold text-amber-600 dark:text-amber-400" : ""}>
                    actual {f2(r.meanIf)}
                  </span>
                ) : (
                  "actual —"
                )}
              </span>
            </div>
            <p className="mt-0.5 pl-3.5 text-[10px] text-zinc-500 dark:text-zinc-400">
              {r.meanCompliancePct !== null ? `${r.meanCompliancePct}% completion · ` : ""}exec {r.meanExecution}/10
            </p>
          </li>
        ))}
      </ul>
      {ftpRetest && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300">
          <span className="font-semibold">FTP check: </span>
          {ftpRetest.evidence}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `components/Trends.tsx`**

Extend the sections import (line 10):

```ts
import { BlockTimeline, PlanVsActual, ScoreBars, WeeklyVolumeBars, baselineCards, trendDir } from "./trends/sections";
```

Replace the whole Weekly-volume block (lines ~251–263) —

```tsx
      {/* Weekly volume — the landing view for the Today trend-pulse "Weekly volume" tile (UX-2).
          Half-width to match the Execution-quality card; the right column is left empty by design. */}
      {data.weeklyHours.length >= 2 && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card
            title="Weekly volume"
            hint="ride hours · complete weeks"
            tip="Total ride hours per complete week over the last ~16 weeks (the in-progress week is excluded). Bar height and blue shade both track weekly training volume — your consistency and ramp at a glance."
          >
            <WeeklyVolumeBars weeks={data.weeklyHours} />
          </Card>
        </div>
      )}
```

with:

```tsx
      {/* Weekly volume (the landing view for the Today trend-pulse tile, UX-2) paired with the #4
          planned-vs-actual read — the formerly empty right column now earns its keep. */}
      {(data.weeklyHours.length >= 2 || data.planVsActual.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.weeklyHours.length >= 2 && (
            <Card
              title="Weekly volume"
              hint="ride hours · complete weeks"
              tip="Total ride hours per complete week over the last ~16 weeks (the in-progress week is excluded). Bar height and blue shade both track weekly training volume — your consistency and ramp at a glance."
            >
              <WeeklyVolumeBars weeks={data.weeklyHours} />
            </Card>
          )}
          {data.planVsActual.length > 0 && (
            <Card
              title="Planned vs actual"
              hint="by session type · last 90 days"
              tip="Prescription vs delivery for each planned session type over the trailing 90 days: the FTP-derived target IF band (Threshold/VO2max), your mean ridden IF, completion and execution. Consistently delivering above the band at high completion triggers the FTP re-test advisory."
            >
              <PlanVsActual rows={data.planVsActual} ftpRetest={data.ftpRetest} />
            </Card>
          )}
        </div>
      )}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/trends/sections.tsx components/Trends.tsx
git commit -m "feat(trends): planned-vs-actual section UI (#4)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Full check + REQUIRED live smoke run

**Files:** none modified. This task is the AGENTS.md live-LLM gate — the plan changes `CoachSnapshot`/`formatCoachSnapshot`, which feed `/api/ask` and `/api/generate`; unit tests do not exercise the real Anthropic call.

**NEVER modify `data/*.json` to force the flag** — that's the athlete's real ledger. The triggered path is proven by unit tests (Tasks 3–4); the smoke proves live wiring + the null path, which is the expected state of the real corpus (only ~4 FTP-anchored sessions, IFs 0.73–0.85, none above 0.92 as of plan-writing).

- [ ] **Step 1: Full gate**

Run: `npm run check`
Expected: tsc clean, eslint clean, all Vitest suites pass (SUB-3 baseline was 647 tests / 58 files; this plan adds ~13 tests and one file). Apply the concurrent-agent rule to any failure in an untouched file.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev` in the background; note the port it reports (assume 3000 below; substitute if different). Wait for "Ready".

- [ ] **Step 3: Deterministic surfaces (use the REAL local date, not a literal)**

```bash
TODAY=$(date +%F)
curl -s "http://localhost:3000/api/trends?today=$TODAY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(JSON.stringify({planVsActual:j.planVsActual,ftpRetest:j.ftpRetest},null,2))})"
curl -s "http://localhost:3000/api/sync?today=$TODAY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('coachSnapshot.ftpRetest =', JSON.stringify(j.coachSnapshot?.ftpRetest))})"
```

Expected: `planVsActual` is a non-empty array (rows for Threshold, VO2max, Z2 … each with `n`, `meanIf`, `targetIf` on the anchored types); `ftpRetest` is `null` on both surfaces (correct for the real corpus — see the task preamble). Any thrown error or missing field = stop and fix before proceeding.

- [ ] **Step 4: LIVE LLM smoke — `/api/ask` (REQUIRED)**

```bash
curl -s -X POST "http://localhost:3000/api/ask" -H 'Content-Type: application/json' \
  -d "{\"query\":\"Is my FTP still accurate? Anything in my recent quality sessions suggesting a re-test?\",\"today\":\"$TODAY\"}"
```

READ the streamed answer end-to-end. Pass criteria: (a) a real coherent answer streams (the changed `formatCoachSnapshot` didn't break the prompt), (b) the coach does NOT claim an overdelivery-based retest flag fired — the flag is null on live data, so any "your sessions ran above target" claim would be an invention; grounding in the resolved numbers (FTP 288W etc.) is what good looks like. If the model asserts a fired flag, investigate the prompt text before calling this done.

- [ ] **Step 5: Stop the dev server**

Kill the background dev process. No commit for this task.

---

### Task 9: Close the shipped portion in the docs

**Files:**
- Modify: `ROADMAP.md` (the `### #4 · Validation loop → auto-down-weight` subsection, lines ~199–203)
- Modify: `ARCHIVE.md` (new entry at the top, after the intro `---`)

- [ ] **Step 1: Update ROADMAP.md**

Replace the `### #4` subsection body (keep the heading) so only the demote half stays open, following the exact precedent #1's subsection sets (✅ line pointing at ARCHIVE, open work stated first):

```markdown
### #4 · Validation loop → auto-down-weight  (time-gated ~4wk)
`intervention-log.json` has no matured verdicts yet. Once data exists, a low hit-rate in
`lib/synthesis.ts` should **demote** a directive (today it only annotates). Ties Track B template-scoring + #2.
✅ The measurement half shipped 2026-07-02 — planned-vs-actual per session type (Trends) + the
execution-driven FTP-retest advisory (overdelivery→stale-low only; CoachSnapshot/Today card/Trends;
never writes FTP locally — `physiology.json` stays the synced SoT) → see "FTP-retest advisory +
planned-vs-actual" in [ARCHIVE.md](ARCHIVE.md). Its thresholds (`FTP_RETEST_DEFAULTS`,
`lib/plan-vs-actual.ts`) are population defaults — a `← #2` calibration hook.
```

Leave every other #4 cross-reference alone (`#4 validation has 0 records`, "close #4 (low hit-rate → demote…)", Track B's "#4 outcome attribution") — they all describe the still-open demote half.

- [ ] **Step 2: Update ARCHIVE.md**

Read the top of `ARCHIVE.md` and add a new entry ABOVE the SUB-3 entry, copying its format exactly:

```markdown
## FTP-retest advisory + planned-vs-actual (#4, measurement half) (2026-07-02)

ROADMAP #4's measurement half — the validation loop starts ACTING on execution data. Spec:
[design](docs/superpowers/specs/2026-07-02-ftp-retest-planned-vs-actual-design.md) · plan:
[plan](docs/superpowers/plans/2026-07-02-ftp-retest-planned-vs-actual.md).

- **`lib/plan-vs-actual.ts` created** (pure, unit-tested): `aggregatePlanVsActual` — per-type n /
  mean IF / target band / completion / execution over the trailing 90d of planned, non-legacy,
  non-compromised ledger entries — and `detectFtpRetest` — the overdelivery→stale-low advisory
  (≥4 FTP-anchored sessions in 42d, ≥75% individually above their frozen band top at ≥85% completion,
  mean overshoot ≥2% FTP, all scored against the *current* FTP so a re-test resets the window).
  Underdelivery deliberately excluded (fatigue-confounded). Thresholds exported as
  `FTP_RETEST_DEFAULTS` — a #2 per-athlete calibration hook.
- **`FTP_ANCHORED_IF_BANDS` exported from `lib/execution-score.ts`** (behaviour-preserving refactor):
  scorer, detector and the Trends target-band column share one source and can't drift.
- **CoachSnapshot gains `ftpRetest`** via `CoachSignals`/`resolveCoachSignals` → the `/api/ask` prompt
  ("FTP check: …" in `formatCoachSnapshot`), the Today card (amber advisory on `CoachSnapshotCard`),
  and `/api/generate`'s resolution (not rendered in the generation prompt by design — the planner must
  not compensate for unvalidated physiology).
- **`/api/trends`** now resolves the client's local `?today=` (AGENTS.md local-today class) and ships
  `planVsActual` + `ftpRetest`; new "Planned vs actual" card beside Weekly volume
  (`components/trends/sections.tsx`). Complements — doesn't replace — the age-based >90d stale-FTP
  warnings (Profile banner, Trends w/kg tile): execution flag = threshold moved; age flag = the
  fallback when no anchored quality work exists to measure.
- Advisory ONLY: nothing writes FTP or `physiology.json` (locked design decision). Live-smoked against
  the real corpus (flag correctly null at n=4 anchored sessions, none over band) + a live `/api/ask` run.
```

- [ ] **Step 3: Commit + push**

```bash
git add ROADMAP.md ARCHIVE.md
git commit -m "docs(roadmap): move #4 measurement half (FTP-retest + planned-vs-actual) to ARCHIVE

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

(Also pushes the earlier feature commits.)

---

## Self-Review Notes (already applied)

- **Spec coverage:** design §4.1 → Task 1; §4.6 → Task 2; §4.2–4.5 → Task 3; §5 snapshot spine → Task 4 (ask/sync verified zero-change via `buildCoachSnapshotFromSources` at `app/api/ask/route.ts:66`, `app/api/sync/route.ts:92/456`); Today card → Task 5; §5 trends path + AGENTS local-today → Task 6; Trends UI → Task 7; §9 risk 3 / AGENTS smoke rule → Task 8; ROADMAP hygiene → Task 9. Non-goals (no `synthesis.ts`, no `formatFormFuelLine` render, no underdelivery, no FTP writes) are enforced as Global Constraints.
- **Type consistency:** `FtpRetestSignal`/`FtpRetestConfig`/`TypePlanVsActual`/`FTP_ANCHORED_IF_BANDS`/`FTP_RETEST_DEFAULTS` names identical across Tasks 1–7; `resolveCoachSignals`' appended params match between Task 4's implementation and the generate call site; fixture shapes verified against `lib/types.ts:455` (`RideScoreEntry` — all 11 required fields present in every `mk`/`overRide` fixture).
- **Arithmetic spot-checks:** Task 2 — mean IF (0.85+0.91)/2 = 0.88, compliance (100+90)/2 = 95, exec (8+7)/2 = 7.5; 90d cutoff from 2026-07-02 is 2026-04-03 (2026-03-01 excluded). Task 3 — overshoots 0.04×3 + 0.03 → mean 0.0375 → `round1(3.75)` = 3.8; mixed case 2/4 = 0.5 < 0.75; thin case mean +0.01 < 0.02; offset 0.06 lifts tops to 0.98/1.16 → nothing over.
- **Known soft spots:** (1) Task 4 makes `CoachSignals.ftpRetest` required — if a third literal constructor of `CoachSignals` has appeared since plan-writing (concurrent session), `tsc` will name it; add `ftpRetest: null` there, that is an expected mechanical fix, not a plan deviation. (2) Task 8's expected live values (flag null, 4 anchored sessions) describe the corpus as of 2026-07-02; more rides may exist at execution time — the pass criterion is coherence + no invented flag, not exact numbers.
