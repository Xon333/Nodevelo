# Ledger Interval Adherence at Birth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Planned interval rides (Threshold / VO2max / SIT / RaceSim) enter the immutable ledger scored off **interval-target adherence** — the same primary signal the today path uses — instead of the coarse whole-ride duration/IF proxy, and the adherence signal itself is **frozen onto the entry** so a future formula fix + one-shot rebuild can re-score without re-fetching (the SIT 2/10 bug class: the frozen entry needed a manual correction because the ledger never had the adherence input).

**Why now (leverage):** the ledger is the learning corpus and it is immutable — every planned interval entry born coarse is a *permanent* fidelity loss. The corpus is 16 planned entries and growing 2–3/week; each week this isn't shipped freezes more coarse entries that the athlete model, #4 validation, and every #2 calibration edge then learn from. Tracked in ROADMAP → "Scoring-core gaps" → "Ledger scoring lacks interval-level adherence."

**Architecture (3 moves):**
1. **A frozen `intervals` stamp on `RideScoreEntry`** — compact adherence provenance (`adherencePct`, `structuralMismatch`, `completed`, `total`), frozen like `ftpUsed`. Unlike `formState`/`fuel` (provenance-only), this stamp **does** feed the entry's own `executionScore` — it is the primary scoring input for interval days.
2. **`buildRideScores` gains an optional `adherenceForDate` lookup** — stays pure (no IO). For a planned entry with a stamp, the adherence input flows into `computeExecutionScore` exactly like the today path, and the stamp is written onto the entry.
3. **The sync route feeds the lookup from two sources:** (a) *birth-time fetch* — for a fresh date (not yet in the ledger) with a planned interval-type prescription, fetch that ride's executed intervals and run `matchPrescription` (this closes the late-sync gap: a ride synced a day+ after it happened currently never gets interval-aware scoring at all); (b) *frozen stamps from the existing ledger* — so the one-shot rebuild path re-scores with the frozen signal instead of losing it.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, Vitest. JSON persistence via `lib/json-store.ts` re-exported through `lib/data-store.ts`.

## Global Constraints

- **Deterministic core** — no LLM anywhere in this path; pure TypeScript only.
- **Do NOT modify `mergeScoreLog`** (`lib/score-log.ts:210-215`) — immutability semantics (existing wins, today-exception handled in the route) are correct as-is.
- **Reuse `matchPrescription`** (`lib/interval-match.ts`) — the avg-watts basis, duration-aware completion, structural-mismatch guard, and extras handling are hard-won; do not reimplement any adherence math.
- **Durability days are the deliberate exception** — a day carrying `durabilityTemplate` (or type `Z2`/`Recovery`) grades via its own system (`gradeDurabilityDelivery` / above-Z2); it must NOT enter this adherence path. (Extending executed-interval availability to durability grading is a *follow-up*, not this plan.)
- **Concurrent checkout:** stage only files you touched (`git add <path>...`, never `git add -A`); commit on `main`.
- **Verification loop:** `npx tsc --noEmit && npm run lint && npm test && npm run build`.
- **Float-boundary fixtures:** don't pin exact rounded expectations whose pre-rounding value sits on a `.x5` boundary (IEEE floats flip them).

---

### Task 1: `RideScoreEntry.intervals` stamp type

**Files:**
- Modify: `lib/types.ts:455-493` (`RideScoreEntry`)

**Steps:**
- [ ] Add to `RideScoreEntry` (after `fuel`, matching the stamp-comment house style):

```ts
// Interval-adherence signal frozen at scoring time (ROADMAP scoring-core gap): the prescription-vs-
// executed comparison that scored THIS entry, persisted so (a) the frozen score is reproducible and
// (b) a one-shot rebuild can re-score a corrected formula without re-fetching per-ride intervals
// (the SIT 2/10 lesson). Unlike formState/fuel this DOES feed executionScore — it is the primary
// signal on planned interval days. adherencePct is effectiveAdherencePct (power × duration);
// structuralMismatch true means duration was untrustworthy and scoring fell back (input treated null).
// Absent on: off-plan rides, steady/durability days, entries born before this shipped, fetch failures.
intervals?: {
  adherencePct: number;
  structuralMismatch: boolean;
  completed: number;
  total: number;
};
```

- [ ] `npx tsc --noEmit` — expect clean (optional field).

### Task 2: `buildRideScores` consumes + stamps adherence

**Files:**
- Modify: `lib/score-log.ts:58-201` (`buildRideScores`), `lib/score-log.ts:241-246` (`carryForwardContext`)
- Test: `lib/score-log.test.ts`

**Interfaces:**
- New param (after `history`): `adherenceForDate?: ((date: string) => RideScoreEntry["intervals"] | null) | null`
- New exported pure helper: `intervalStampFrom(cmp: IntervalComparison): RideScoreEntry["intervals"]` — maps `{ effectiveAdherencePct, structuralMismatch, completed, total }` → the stamp. One mapping, used by this module AND the sync route's today-patch (Task 3), so the two capture points can never diverge.

**Steps:**
- [ ] Add `intervalStampFrom`. Source fields: `IntervalComparison` (`lib/types.ts:247-264`) — `effectiveAdherencePct` → `adherencePct`, plus `structuralMismatch`, `completed`, `total` verbatim.
- [ ] In the `planned` branch (`lib/score-log.ts:124-157`): resolve `const stamp = adherenceForDate?.(act.date) ?? null;` **only when** `planned.type` is not `Z2`/`Recovery` AND `!planned.durabilityTemplate`. Pass `adherencePct: stamp && !stamp.structuralMismatch ? stamp.adherencePct : null` into `computeExecutionScore` (mirrors `lib/ride-analysis.ts:129-131` semantics — `execution-score.ts` already accepts `adherencePct` and has the SIT branch at `lib/execution-score.ts:86-98`; **zero changes needed there**). Spread `...(stamp ? { intervals: stamp } : {})` onto the entry.
- [ ] Extend `carryForwardContext` (LEDGER-2 pattern): carry `prev.intervals` forward when `fresh.intervals` is absent — a rebuild must never silently delete the adherence provenance. A fresh stamp always wins.
- [ ] Tests (`lib/score-log.test.ts`):
  - Planned Threshold day + lookup returning a stamp → score differs from the no-lookup control (adherence branch engaged) AND entry carries `intervals`.
  - `structuralMismatch: true` stamp → score equals the no-lookup control (input null) but the stamp is still persisted.
  - Z2 day / day with `durabilityTemplate` → lookup never consulted (pass a lookup that throws — proves the guard).
  - Off-plan ride → no stamp.
  - `mergeScoreLogRebuild`: fresh entry without stamp + prev with stamp → stamp carried; both have stamps → fresh wins.

### Task 3: Sync route — today-patch stamps + birth-time fetch

**Files:**
- Modify: `app/api/sync/route.ts` (today-patch at `:414-437`; `buildRideScores` call at `:281`; new fetch block just before it)
- Test: `app/api/sync/route.test.ts` (follow the existing SUB-3 harness/mocking patterns in that file)

**Steps:**
- [ ] **Today-patch:** in the `updateScoreLog` patch (`:418-432`), when `intervalComparison` is non-null, also spread `intervals: intervalStampFrom(intervalComparison)`. This is the direct fix for the SIT-bug class — today's frozen entry now carries its adherence input when the day rolls over.
- [ ] **Birth-time fetch (the late-sync gap):** before the `buildRideScores` call at `:281`, compute candidate dates:
  - date has a planned prescription (same map logic: current block days + SUB-1 history days) with type ∉ {`Z2`, `Recovery`}, no `durabilityTemplate`, and a non-empty parsed prescription;
  - date is NOT already present in the existing ledger (frozen entries never re-score — immutability preserved);
  - date is not `today` (the richer today path owns it) and not in the future.
  - For each candidate (cap at **6 per sync**, newest first; log a warn if capped): pick the date's **longest ride** (mirrors `buildRideScores`' two-rides-one-date rule at `:196-197`), `fetchIntervals(activityId)` (`lib/intervals-api.ts:187`), re-parse the prescription from `workoutText` when present — the same self-heal as `:365-367` — **but with the entry's FTP basis** (`act.icuFtp ?? ftpForDate(date)`, NOT current FTP; the stamp must match what the entry scores against), then `matchPrescription`. Collect into a `Map<string, stamp>`.
  - Per-candidate failures: catch, `logWarn("/api/sync", "birth-adherence", …)`, skip — the entry is born coarse exactly as today (acceptable fallback, never fails the sync).
- [ ] **Lookup assembly:** `adherenceForDate = (date) => fetchedStamps.get(date) ?? existingLedgerEntryFor(date)?.intervals ?? null` — fetched (fresh) first, frozen stamps second (serves the rebuild path, where `fresh` re-scores overlapping dates). Pass into both `buildRideScores` call sites if the rebuild branch calls it separately (check `:281-300` — one call feeds both merges; thread once).
- [ ] Route tests:
  - Today-patch persists `intervals` alongside `executionScore`.
  - A fresh past planned Threshold date triggers exactly one `fetchIntervals` call and the merged ledger entry carries the stamp + adherence-aware score.
  - A date already in the ledger triggers **no** fetch.
  - `fetchIntervals` rejection → sync succeeds, entry present (coarse), warning logged.
  - Rebuild run: frozen stamp on existing entry reaches the re-score (score changes accordingly) and survives the merge.

### Task 4: Documentation

- [ ] `README.md` §3 (execution scoring): ledger entries for planned interval days are now born interval-aware (birth-time fetch, capped) and carry a frozen `intervals` stamp; note the durability exception stands.
- [ ] `README.md` module map: update `score-log.ts` line ("+ interval-adherence stamps at birth").
- [ ] `ROADMAP.md`: move the "Ledger scoring lacks interval-level adherence" item under "Scoring-core gaps" to `ARCHIVE.md` with a one-paragraph shipped record (house style: what shipped + the one-line why).
- [ ] `ARCHIVE.md`: the shipped record.

## Acceptance criteria

1. A planned VO2max ride synced **the day after** it happened scores off interval adherence in the ledger (fixture-verified) — previously impossible.
2. After day rollover, today's entry carries `intervals` (verified in route test via the today-patch).
3. A one-shot rebuild with a changed scoring formula re-scores interval days from frozen stamps — no re-fetch, no manual correction.
4. A fresh athlete / no interval data behaves byte-identically to today (full suite green — this is the regression contract).
5. `npx tsc --noEmit && npm run lint && npm test && npm run build` all pass.

## Edge cases (handle explicitly)

- Two rides on one date → fetch for the longest (the ledger's winner).
- `matchPrescription` returns null / no executed intervals curated → no stamp, coarse fallback.
- Missing `workoutText` → fall back to the stored `prescription` array (same as `:365-367`).
- `act.icuFtp` absent → `ftpForDate(date)`.
- First sync after deploy with several elapsed planned interval days → cap 6, newest first; the rest stay coarse forever (accepted; log it).
- Do NOT stamp `intervals` on off-plan rides even if the athlete freestyled intervals — there is no prescription to compare against; that axis stays honest-null.
