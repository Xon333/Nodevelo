# FTP-Retest Advisory + Planned-vs-Actual per Session Type (#4) — Design

**Date:** 2026-07-02
**Status:** Shipped 2026-07-02 → [ARCHIVE.md](../../../ARCHIVE.md) "FTP-retest advisory + planned-vs-actual (#4, measurement half)"
**ROADMAP:** `#4 · Validation loop` — the *measurement* half ("surface planned-vs-actual per session
type and, on a consistent gap, flag an FTP re-test in Intervals.icu"). The *demote* half (low hit-rate
in `lib/synthesis.ts` → demote a directive) stays open in #4 — it is time-gated on matured
`intervention-log.json` verdicts, which still don't exist. Ties #2 (thresholds are calibration hooks)
and Track B (per-template attribution already stamps the ledger).

---

## 1. Problem & context

The validation loop *measures* but never *acts*. The ledger (`RideScoreEntry`, `lib/types.ts:455`)
freezes, per ride: the prescribed type, the delivered whole-ride IF, the FTP it was scored against
(`ftpUsed`), completion (`compliancePct`) and the per-athlete band offset that scored it
(`calibration.ifBandOffset`). Nothing reads that record back as a *signal about the athlete's inputs*.

Two consequences today:

1. **A stale-low FTP is invisible until the calendar notices.** The only stale-FTP signal in the app
   is age-based: Profile warns at >90 days since `physiology.current.effectiveFrom`
   (`components/AthleteProfileForm.tsx:419-431`), and Trends flags the w/kg tile on the same basis
   (`components/trends/sections.tsx:168-170`, `wkgStale` in `components/trends/types.ts:41`). But a
   threshold that *moved* during a productive block makes the FTP wrong long before it is old: every
   IF, TSS, zone target and execution score silently degrades, and the athlete reads "great execution"
   off sessions that were actually ridden above prescription.
2. **Per-type adherence exists nowhere as a view.** Trends shows the per-ride score bars and
   block-level `complianceByType` for *completed* blocks, but never "for each session type I was
   prescribed recently, what did I actually deliver against the FTP-derived target?" — the exact
   planned-vs-actual read ROADMAP #4 names.

The ledger already contains everything needed for both. This design adds one small pure module that
reads it, plus two surfacing paths that already exist.

## 2. Locked decisions (user, 2026-07-02 — do not re-open)

1. **Scope = both halves:** the FTP-retest advisory flag AND the planned-vs-actual per-type Trends
   section.
2. **FTP-staleness signal = overdelivery → stale-low ONLY.** Flag when the athlete *consistently
   delivers actual IF above the FTP-derived expected band* on FTP-anchored session types (Threshold,
   VO2max) at high completion. **Underdelivery is intentionally excluded** — fatigue, illness, heat and
   deliberate softening all confound it; a "your FTP may be set too high" inference from low IF would
   be mostly noise and occasionally insulting.
3. **Advisory only — never write FTP or `physiology.json` locally.** `physiology.json` stays the
   synced source of truth; the flag nudges the athlete to re-test in Intervals.icu, and the new value
   syncs back through the existing physiology reconcile. (ROADMAP #4 is explicit on this.)

Rationale for №2's physiological asymmetry: with a *correct* FTP, riding a Threshold session
sustainedly above its band collapses completion — you blow up. Four independent quality sessions
delivered above the band top *at high completion* are only physiologically possible if the real
threshold sits above the configured one. The same logic does not invert: delivering below the band at
high completion is exactly what a tired athlete on a correct FTP does.

## 3. Goals / non-goals

**Goals**
- One deterministic, pure, unit-tested `lib/` module (per-signal-module pattern: `aerobic.ts`,
  `durability-score.ts`, `readiness.ts`) owning both reads: `lib/plan-vs-actual.ts`.
- The retest advisory rides the existing `CoachSignals → CoachSnapshot` spine (`lib/coach-snapshot.ts`)
  so `/api/ask`, `/api/sync` (Today card) and `/api/generate` all resolve it identically (CR-9/RR-6 —
  the compiler-enforced no-drift path).
- The per-type breakdown ships as data on the existing `/api/trends` payload; the component only renders.
- Confidence-gated like the app's other signals: thin data → the flag is `null`, the section hides.

**Non-goals**
- Writing FTP or anything into `physiology.json` (locked №3).
- Any underdelivery / "FTP too high" inference (locked №2).
- The synthesis-demote half of #4 (`lib/synthesis.ts` untouched — still time-gated on matured verdicts).
- "Planned but missed" counting (needs a planned-corpus join against block/history days, not the
  ledger; a future #4 sliver, not this).
- Rendering the advisory in the *generation* prompt (`formatFormFuelLine`). The planner must not
  compensate for a suspected-low FTP — that would be acting on unvalidated physiology; the athlete
  re-tests, the SoT updates, and generation picks up the real number. Ask-Coach + Today card + Trends
  are the advisory surfaces.
- LLM involvement anywhere in the signal. The evidence string is fully deterministic; the ask-coach
  model may rephrase it, never invent it (same contract as every other snapshot line).

## 4. Signal math

### 4.1 The expected band — reuse, don't invent

The per-type "expected IF" already exists as the sweet-spot (+2) tier of the intensity-vs-type bands in
`computeExecutionScore` (`lib/execution-score.ts:114-124`): Threshold `0.82–0.92`, VO2max `0.90–1.10`,
each shifted by the per-athlete `ifBandOffsets` calibration (`lib/calibration.ts:402`). Those literals
are currently inlined in the `switch`. This design lifts the two FTP-anchored ones into one exported
constant that the scorer itself reads:

```ts
// lib/execution-score.ts
export const FTP_ANCHORED_IF_BANDS = {
  Threshold: { lo: 0.82, hi: 0.92 },
  VO2max: { lo: 0.9, hi: 1.1 },
} as const;
```

— so the detector, the Trends "target IF" column and the scorer share one source and cannot drift.
Behaviour-preserving refactor; the existing `execution-score.test.ts` band suite is the guard.
(The other types' bands stay inline: Z2/Recovery/SIT/RaceSim have no single FTP anchor the retest
inference is valid for — `IF_ANCHOR_ZONE_INDEX` in `lib/calibration.ts` anchors Threshold/VO2max to
the Z4/Z5 tops; RaceSim is explicitly unanchored.)

Per entry, the *expected band top that actually scored it* is `band.hi + (entry.calibration?.ifBandOffset ?? 0)`
— the frozen per-entry offset, not today's live calibration, consistent with ledger reproducibility.

### 4.2 Qualifying entries

From `RideScoreEntry[]`, an entry qualifies for the detector when ALL of:

- `planned && !legacy && !compromised` — the trainable slice, same filter as every execution metric;
- `plannedType` ∈ {`Threshold`, `VO2max`} (keys of `FTP_ANCHORED_IF_BANDS`);
- `intensityFactor !== null`;
- `compliancePct !== null && compliancePct >= minCompletionPct` — "high completion". Note
  `resolveCompliance` caps compliance at `executionScore × 18` below 5/10, so ≥85% completion also
  implies executionScore ≥ 5 — a blown-up over-cooked session cannot qualify;
- `date` in the trailing window `(today − windowDays, today]`;
- `ftpUsed === currentFtp` — scored against the FTP *currently* configured. This is the retest
  lifecycle guard: the moment the athlete re-tests (or FTP changes for any reason), old-FTP evidence
  stops counting and the window restarts — the flag can never nag "re-test" right after a re-test.

### 4.3 Trigger

Over the qualifying set, with per-entry overshoot `IF − (band.hi + frozenOffset)`:

fire ⇔ `n ≥ minSessions` AND `overCount / n ≥ minOverFraction` AND `mean(overshoot) ≥ minMeanOvershoot`
(where `overCount` counts entries with overshoot strictly > 0). Anything else → `null` (withheld, like
the app's other confidence-gated signals). `currentFtp` null/≤0 → `null`.

### 4.4 Defaults — explicit, tunable, and a ROADMAP #2 calibration hook

```ts
export const FTP_RETEST_DEFAULTS: FtpRetestConfig = {
  windowDays: 42,        // trailing window
  minSessions: 4,        // n gate — below it the signal is withheld (null)
  minCompletionPct: 85,  // a session must have been delivered to count
  minOverFraction: 0.75, // ≥ this share of qualifying sessions individually above their band top
  minMeanOvershoot: 0.02,// mean IF excess above the band top, as FTP fraction (2% FTP)
};
```

Justification (population defaults, tuned for low false-positives — an advisory that cries wolf gets
ignored):
- **42 days** ≈ one training block plus spillover: long enough to accrue 4 quality sessions at the
  athlete's real cadence (1–2 FTP-anchored sessions/week), short enough that "consistently" means the
  *current* threshold, not last season's.
- **4 sessions**: one hot day is weather/motivation; four independent quality days above the band top
  at full completion is not something a correctly-set FTP permits (§2 rationale).
- **85% completion**: overdelivery only evidences a moved threshold when the work was absorbed, not
  abandoned; combined with the `resolveCompliance` cap this excludes both cut-short and
  poorly-executed sessions.
- **75% over-fraction**: tolerates one structurally diluted outlier (a long-warmup ride's whole-ride
  IF reads low) in four without letting a 50/50 split fire.
- **+2% FTP mean margin**: NP/warmup dilution and day-to-day noise live within ~2% of FTP; real FTP
  drift across a productive block for a trained amateur is ~3–6%. A genuine stale-low FTP clears 2%;
  borderline noise doesn't.

All five live in one exported config object taken as a defaulted parameter — **the ROADMAP #2
per-athlete calibration hook**: population defaults now; later, #2's engine (e.g. deriving the margin
from the athlete's own IF variance, or the window from their actual quality-session cadence) overrides
the object without touching the detector. Same derive-with-fallback shape as `resolveAcwrBands` /
`resolveTsbModifierEdges`.

Known conservatism, accepted: whole-ride VO2max IF rarely exceeds 1.10, so VO2max entries mostly count
in the denominator, diluting toward *not* firing — the correct direction for an advisory. A per-type
split (evaluate Threshold alone at a lower n) is a #2 refinement once the corpus supports it; today's
corpus (15 qualifying planned entries total, 4 FTP-anchored) can't.

### 4.5 The signal shape + evidence line

```ts
export interface FtpRetestSignal {
  n: number;                // qualifying FTP-anchored sessions in the window
  overCount: number;        // how many individually exceeded their band top
  meanOvershootPct: number; // mean (IF − band top) across the n, as % of FTP (round1)
  windowDays: number;
  evidence: string;         // deterministic, human/LLM-readable one-liner
}
```

Evidence is assembled from the numbers above, e.g.: *"4 of 4 FTP-anchored quality sessions
(Threshold/VO2max, last 42d, ≥85% completion) delivered IF above the FTP-derived target band — on
average 3.8% of FTP over the band top. FTP 288W is likely set too low; re-test in Intervals.icu (the
new value syncs back automatically)."* Deterministic numbers only; any LLM downstream may rephrase,
never invent.

### 4.6 Planned-vs-actual aggregation (the Trends half)

Same module, same qualifying base (planned/!legacy/!compromised, windowed — default **90 days**,
matching the "rolling 90 days" era the baselines card speaks in), grouped by `plannedType`:

```ts
export interface TypePlanVsActual {
  type: WorkoutType;
  n: number;                          // qualifying planned sessions of this type
  meanIf: number | null;              // mean delivered whole-ride IF (entries carrying one)
  targetIf: { lo: number; hi: number } | null; // FTP_ANCHORED_IF_BANDS[type] — null off-anchor
  meanCompliancePct: number | null;   // mean completion
  meanExecution: number;              // mean execution score (1–10)
}
```

Rows follow `WORKOUT_TYPES` order; types with n = 0 are omitted. `targetIf` shows the population band
(the per-entry frozen offsets shift the *detector's* math, not the display — a ±≤0.08 display shift
isn't worth a second rendering path; noted for #2).

## 5. Data flow

```
data/score-log.json  (immutable ledger — read-only here)
        │  readScoreLog() (callers already hold it)
        ▼
lib/plan-vs-actual.ts        (NEW · pure · unit-tested)
  aggregatePlanVsActual(entries, today, windowDays=90)  → TypePlanVsActual[]
  detectFtpRetest(entries, today, currentFtp, cfg=FTP_RETEST_DEFAULTS) → FtpRetestSignal | null
        │
        ├─► lib/coach-snapshot.ts
        │     resolveCoachSignals(..., scoreEntries, currentFtp) → CoachSignals.ftpRetest
        │     CoachSnapshotInput extends CoachSignals → buildCoachSnapshot → CoachSnapshot.ftpRetest
        │     buildCoachSnapshotFromSources already holds s.scoreEntries + s.ftp → zero route edits in
        │     /api/ask + /api/sync (GET and POST both build through it)
        │     formatCoachSnapshot → "- FTP check: <evidence>"  → /api/ask prompt (anthropic-prompts.ts:610)
        │     app/api/generate/route.ts:166 → passes scoreEntries + profile FTP (resolved identically;
        │     formatFormFuelLine deliberately does not render it — §3 non-goals)
        │     components/CoachSnapshotCard.tsx → amber advisory line on the Today card
        │
        └─► app/api/trends/route.ts  (GET gains `req`; today = resolveToday(?today=))
              payload += { planVsActual, ftpRetest }
              components/trends/types.ts (TrendsData) → components/trends/sections.tsx
              (new PlanVsActual section) → components/Trends.tsx (card beside Weekly volume)
```

`today` is always caller-supplied: the snapshot paths already resolve a local `today`
(`resolveToday`/`s.date`), and the Trends client starts sending `?today=${localToday()}` — replacing
the trends route's inline UTC `new Date().toISOString().slice(0,10)` (the AGENTS.md "today must be
local" class). The module itself never reads the clock; window cutoffs are pure day-math off the
passed date (`isoDaysAgo`).

## 6. Relation to the age-based stale-FTP flag

Complementary, not colliding — they catch opposite failure modes, and both stay:

| | Execution flag (new) | Age flag (existing, unchanged) |
|---|---|---|
| Detects | threshold **moved** — FTP wrong regardless of age | FTP **old** — no evidence either way |
| Fires | as soon as 4 overdelivered quality sessions accrue (can be well inside 90 days) | at >90 days since `effectiveFrom` |
| Silent when | no recent FTP-anchored quality sessions (e.g. base block of Z2) | FTP recently synced |
| Surfaces | CoachSnapshot (ask/Today card) + Trends section | Profile banner + Trends w/kg tile |
| Copy | "set too **low** … re-test" (directional, evidence-backed) | "may be **stale** … re-test" (neutral) |

The execution flag is the stronger, earlier signal; the age flag is the fallback for exactly the case
the execution flag can't see (an athlete doing no anchored quality work while FTP quietly ages). No
shared code, no interaction, no suppression logic — worst case both fire, and both being visible is
correct ("it's old *and* you're riding over it").

## 7. Edge cases & degradation

- **Thin data** (n < 4 anchored in-window): flag `null` — nothing renders anywhere. Today's real
  corpus does exactly this (4 anchored sessions, IFs 0.73–0.85, none over 0.92): flag stays null,
  table renders. That is the correct live behaviour, and what the smoke run must show.
- **FTP change mid-window** (re-test or any sync-side change): `ftpUsed === currentFtp` drops
  pre-change entries; the signal restarts accumulation against the new FTP. A watt-level mismatch
  between `icuFtp`-stamped entries and the store FTP fails the equality and conservatively withholds —
  acceptable failure direction for an advisory.
- **Athlete with shifted zones** (per-athlete `ifBandOffset`): each entry is compared against the
  band that scored *it* (frozen offset), so a legitimately-higher personal band doesn't false-fire.
- **Deliberate over-riding ("ego pacing")**: indistinguishable from a moved threshold by IF alone —
  but sustained supra-band riding at ≥85% completion four times in six weeks *is* threshold evidence
  (§2); if they can do that, the FTP is low. Residual risk accepted (§9).
- **Off-plan/legacy/compromised rides, missing IF, `Rest`/`Strength` days**: excluded by the
  qualifying filter; never counted in either direction.
- **Today's still-live entry** (CR-E: today re-scores until day rollover): included when qualifying —
  advisory-only, and it freezes at rollover anyway.

## 8. Error handling

No new failure modes: pure functions over an already-loaded array, no IO, no new files, no writes.
Defensive on the inputs it can't trust (`intensityFactor`/`compliancePct` null-guards, non-finite
offsets treated as 0 via `?? 0`, `currentFtp` null/≤0 → null). A `CoachSignals`-shaped required field
(`ftpRetest`) means the compiler — not runtime — catches any constructor that forgets it (the RR-6
pattern).

## 9. Risks

1. **False positive → athlete re-tests unnecessarily.** Cost: one wasted ramp test. Mitigated by the
   four-way gate (n, completion, fraction, margin) tuned conservative; residual ego-pacing case in §7.
2. **False negative / flag feels inert.** Whole-ride IF dilution (long warmups) + the VO2max 1.10 top
   bias toward silence. Accepted: an advisory should under-fire; the age-based flag remains the
   backstop, and the thresholds are one exported object away from #2 tuning.
3. **Prompt growth on `/api/ask`.** One line, only when triggered. Negligible; but it *does* change
   the LLM-facing text → the AGENTS.md live-smoke rule applies (plan Task 8).
4. **`resolveCoachSignals` appends two optional params** (`scoreEntries`, `currentFtp`) — a future
   caller omitting them silently gets `ftpRetest: null` (same degradation contract as the existing
   optional `today`). Accepted to preserve the two existing call sites' shape; the failure direction
   is conservative (flag absent, never wrong).
5. **Trends payload/type churn** (`TrendsData` gains two required fields): single-user local app, one
   deploy unit — no compatibility window needed.

## 10. Pillar alignment

- **Deterministic core** — the entire signal is TypeScript math over the frozen ledger; the LLM only
  ever sees a pre-written evidence line.
- **Immutable ledger** — read-only consumer; per-entry frozen `ftpUsed` + `calibration.ifBandOffset`
  are exactly what make the read reproducible. No merge/freeze logic touched.
- **Two-memory split / AI containment** — the advisory nudges a *human* action in the *source system*
  (Intervals.icu re-test); the app never mutates physiology on its own inference (locked №3).
- **Local-first** — no new files, no new dependencies; two JSON payloads grow by a few fields.
- **Calibrated honesty** — confidence-gated null below the n-gate; evidence line states its own window,
  n and margin.

## 11. Out of scope (v1) — recap

Synthesis demote (#4's other half) · underdelivery/"FTP too high" · local FTP writes · planned-but-missed
counting · per-type detector split + per-athlete threshold derivation (→ #2) · advisory in the
generation prompt · rendering per-entry offset-shifted bands in the Trends table (population band shown).
