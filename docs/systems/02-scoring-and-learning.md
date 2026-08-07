# 02 · Scoring & learning — how rides become a model of the athlete

**Why this exists:** a coach that doesn't measure whether its advice worked is a plan printer. This layer grades every ride deterministically, freezes the grades into an immutable ledger, learns a per-athlete model from it, and validates its own past advice — the "second brain." **Where it sits:** consumes [01-sync](01-sync-and-data.md)'s data; its model and calibration feed [05-season](05-season.md) and [06-generation](06-generation.md); its verdicts surface in [03-daily-loop](03-daily-loop.md) and Trends. **Tradeoff:** ledger immutability means schema changes need idempotent backfills, and old entries keep old logic's scores forever — honesty over tidiness.

```mermaid
flowchart TD
  RIDE[Synced ride] --> IM[interval-match: rep-by-rep vs prescription]
  RIDE --> DG[durability-score: did the template deliver?]
  IM & DG --> ES[execution-score.computeExecutionScore → 1–10]
  ES --> LEDGER[(score-log.json — append-only ledger,\nfrozen FTP/calibration/fuel/form stamps)]
  LEDGER --> AM[athlete-model: per-type EWMA, trends, behaviour]
  AM --> INS[deriveInsights → ranked coaching insights]
  INS --> GEN[next block generation directives]
  GEN --> INT[intervention-log: baseline snapshotted]
  INT -->|28-day horizon| VAL[validated / refuted / inconclusive → hit-rate]
  VAL --> GEN
  LEDGER --> CALIB[calibration: derive per-athlete parameters]
  CALIB --> ES
```

## The scorer (`lib/execution-score.ts`, 368 lines)

`computeExecutionScore` grades **every** ride, planned or off-plan: interval adherence + duration compliance, intensity-vs-type IF bands (per-athlete offsets via calibration), the merged easy-ride HR+efficiency read, durability delivery (±2), off-plan aerobic quality, VI pacing, RPE-vs-intensity. Key exported distinction — three words that are not synonyms:

- **Execution score** — the 1–10 grade.
- **Compliance** — duration completed ÷ prescribed, *capped by execution* (`resolveCompliance`): a sub-5/10 session can never show 100% (the trust guarantee).
- **Adherence** — interval-day rep power vs target (`lib/interval-match.ts`, matched by duration, not power, to resist surge false-matches).

### Design details worth knowing (defensive by intent)

#### Adherence & compliance mechanics

- **Adherence reads average watts, not NP** — NP overstates short/variable efforts by 20%+; average power is what the athlete actually held. NP is still used to *filter* warm-up/recovery laps out of the work band.
- **Duration-aware completion** — a rep nailed on watts but cut short isn't a full rep; only reps holding ≥90% of prescribed duration count as completed.
- **Structural-mismatch guard** — when every rep ran ~half its prescribed length but power and rep count matched, that's a plan-definition-vs-detection mismatch (e.g. a SIT day stored as 1-min reps, ridden as 30s): the untrustworthy duration penalty is dropped, and the UI explains why. Extra efforts beyond the prescribed count surface as bonus context, never silently dropped.
- **Easy rides are judged on HR, not power.** Outdoor Z2 *power* is unholdable (descents, corners spike watts), so power-zone time and VI are reward-only on Z2/Recovery days. The judge is `mergedEasyRead`: the HR-zone read (time above the aerobic ceiling — terrain-immune) merged with the ride's Pw:HR efficiency vs the athlete's own 90-day baseline. Dialed HR earns +1 unless efficiency is hollow (0); drift is neutral unless efficiency corroborates it (−2); running hot is always −4 (the overtraining guardrail). Never applied off-plan or to durability templates B–E, where embedded efforts are the point.
- **Interval days are born interval-aware** — a bounded birth-time fetch at sync (≤6 dates, newest first, best-effort) picks up late-synced rides so a quality day isn't frozen with a coarse score forever; the adherence signal is frozen onto the entry (`RideScoreEntry.intervals`) so a rebuild can re-score without re-fetching.

#### PR & FTP handling

- **PRs are curve-vs-curve** (`lib/pr.ts`): the fresh power curve against the previous sync's curve, per standard duration — both sides Intervals.icu's own math, so no stream-vs-curve mismatch (which used to manufacture fake +1W PRs).
- **FTP anchoring**: each ledger entry prefers the ride's own `icu_ftp` (Intervals.icu's per-activity record — exact even when an FTP change synced late), falling back to `physiologyAsOf(rideDate)`. Zones store as **% of FTP** so one FTP change updates every zone coherently — scalar/zone drift is structurally impossible.

#### Long-term markers & model numbers

- **FTP-independent markers are the long-term backbone** (they survive FTP redefinition): Pw:HR/EF — deliberately like-for-like: **outdoor** rides only (indoor ERG flattens power:HR), steady endurance band, ≥45 min, VI within `AEROBIC_MAX_VI` (fail-closed when uncomputable); and the fueling/weight graph aggregates **complete weeks only** (an in-progress week's totals are misleadingly low).
- **The model's numbers**: EWMA α = 0.35 (adaptive via calibration), trend = split-half mean comparison with an epsilon band, minimum 3 observations before any pattern fires.

## The ledger (`lib/score-log.ts`, 411 lines)

`buildRideScores` runs the scorer over the sync window and merges into `data/score-log.json` — **append-only**. Past entries are frozen with provenance stamps: FTP-used (`physiologyAsOf`), calibration values, fuel, NP-fallback, form state. Only today's entry keeps re-deriving until the day rolls over. Capped at 400 entries (~6 months). Two named invariants (**LEDGER-1**: a rebuild can never un-plan a frozen entry; **LEDGER-2**: append-only merge) are enforced by `mergeScoreLog` / `mergeScoreLogRebuild` — see [../INVARIANTS.md](../INVARIANTS.md). A one-shot destructive rebuild exists (`/api/sync` POST with `rebuildLedger: true`), guarded by `data/ledger-rebuild.json` (truthy check, not `=== null` — the migration-flag rule).

Dispositions modulate teaching, not scores: a "compromised" ride keeps its raw score but is excluded from teaching the model (`lib/disposition.ts`).

## The model (`lib/athlete-model.ts`)

Rebuilt fresh from the whole ledger on demand: recency-weighted (EWMA, adaptive α from `calibration.autoEwmaAlpha`) per-type execution quality, trend, and behaviour summary → `deriveInsights` ranks coaching insights. Consumed by generation directives, season focus selection, Trends, and athlete state.

## The validation loop (`lib/intervention.ts`)

When an insight actually drives a generated block, `buildInterventions` snapshots a baseline (execution + physiology markers). After a 28-day maturation horizon, `validateInterventions` re-measures: validated / refuted / inconclusive. `summariseValidation` turns the record into a hit-rate that (a) surfaces on Model/Trends as the coach's honesty score and (b) **demotes** directives with a proven-poor hit-rate (≤34% over ≥3 decisive blocks) in `lib/synthesis.ts` — reframed as "try a different lever," evidence never hidden.

## Calibration (`lib/calibration.ts`, 533 lines)

Replaces population magic numbers with athlete-derived values *only when honestly derivable*. The single precedence rule (`trustedCalibration`): **manual override > derived (if discriminating) > population default**. Derived values must separate failures from successes by a margin (`lib/correlation.ts` — `deriveExecutionEdge` finds where things break, `deriveOptimum` where they work); a non-discriminating signal falls back to the default rather than calibrating to habit. Currently calibrated: ACWR bands, TSB deep-fatigue edge, decoupling-good cutoff, carbs optimum, per-type IF-band offsets, durability-insert envelope, athlete-state weights. Import direction is one-way: `calibration → correlation`, never the reverse (cycle avoidance).

## Where each piece runs

Scoring happens inside `POST /api/sync` (see [01-sync-and-data.md](01-sync-and-data.md)); the model/insights are computed on demand by `/api/trends`, `/api/generate`, `/api/write`; interventions are recorded at write time and validated at sync time.

## Known rough edges

- **Phase 2a is infrastructure — nothing is classified `self-directed` yet.** The origin taxonomy,
  overlay store, and effective-outcome seam landed 2026-08-07, but Phase 2b still must produce intent
  interpretations. The store ships empty; real-ledger verification confirmed unchanged sample size,
  drift percentage, and drift quality. Do not loosen the applicability gates to activate it early.
- **Per-type learning deliberately excludes self-directed rides.** Their current inferred type comes
  from whole-ride IF, so including it would revive circular type learning. Revisit only when Phase 2b
  supplies an authoritative intent-derived type; see INVARIANT 40.
- **Phase 2a's review found the same defect shape four times, across two different authors — read this
  before adding a new place that reads `origin`, `status`, or `legacy`.** Two were caught in the plan
  before implementation: drift accounting read the raw ledger row's origin instead of the effective,
  overlay-resolved one — the ledger freezes at `unspecified` before any parse can ever run, so a
  self-directed ride would have inflated drift forever, the exact inversion of decision #1; and overlay
  selection picked the newest candidate BEFORE checking whether it was even applicable, so a `pending`
  record could silently suppress an already-approved one the moment it existed. Two more survived into
  the implementation of the corrected plan: `isCoherent` validated an overlay's internal consistency but
  never rejected `origin: "prescribed"` — a status only the ledger's own `planned` flag may legitimately
  establish — so a malformed overlay could claim it and revive per-type/compliance pollution; and the new
  `overallScored` admission filter dropped the `legacy` exclusion that used to hold for free under the OLD
  `planned === true` admission rule, once that rule widened to admit self-directed rides too (100 of 149
  rows on the real ledger are legacy — not a hypothetical population). All four share one shape: a
  validity check correct at the ONE point its author was reasoning about, silently absent at a DIFFERENT
  point that reads the same field through a different path. None were visible from "do the tests pass" —
  each needed the actual data lifecycle simulated by hand (a record's real sequence of states over time,
  or two admission points compared side by side) before it surfaced. When a later phase adds a new
  consumer of `origin`, `status`, `supersededBy`, or `legacy`, re-derive from scratch whether every
  existing guarantee still holds there — don't assume it does because it held somewhere else. All four are
  fixed on `main` as of PR #29; see `lib/intent-overlay.ts`'s `isCoherent`/`isApplicable` and
  `lib/athlete-model.ts`'s `overallScored` filter for the closed shape.
- **Off-plan (and planned-but-surgy) rides score flat until intent lands.** Phase 1 (2026-08-06) removed
  the axes that were punishing structurally mixed rides for their own structure — the circular VI penalty,
  and the contaminated intrinsic/merged-read Pw:HR efficiency signal (fixed entirely at its producer,
  `qualifyingPwHr` in `lib/aerobic.ts` — no gate was added in `score-log.ts` or `ride-analysis.ts` for this
  signal). Both removals are correct, but they leave a mixed ride with almost no quality differentiator:
  expect scores clustering around baseline (5/10) for most of them. The differentiator returns in Phase 2,
  when the athlete's activity note becomes the scoring target. Don't "fix" the flatness by re-adding a
  structure-derived penalty, and don't re-add a consumer-side comparability gate for `aerobicEffPct` — it's
  already correctly gated where it's computed.
- **The Pw:HR baseline and decoupling-good cutoff moved when Phase 1 shipped, and will keep moving.** The
  athlete's true steady-ride drift mean was measured well under `DECOUPLING_GOOD_BOUNDS.min` as of the
  2026-08-06 sync window, so `deriveDecouplingGood` clamps to its floor — that's the bounds doing their job
  on a pool that used to include structurally mixed rides, not a calibration failure. Both this value and
  the exact pool sizes are recalculated fresh on every sync from a rolling 90-day window; don't treat any
  specific number recorded in this plan's own text as durable.
- **`qualifyingPwHr` and `isSteadyEnduranceRide` are deliberately different gates.** See INVARIANT 34. A
  future change that needs "is this ride aerobically trustworthy" almost always means ONE of these two,
  not both — check which question is actually being asked before reaching for either.
- **Two other raw-decoupling consumers are still ungated.** `lib/readiness.ts`'s `computeRollingBaselines`
  (feeds `avgDecoupling90d` on the Recent Baselines card) and `app/api/retrospective/route.ts`'s block
  `avgDecoupling` (fed verbatim into the retrospective LLM prompt) both average `activity.decoupling`
  across ALL activities with no `isSteadyEnduranceRide` gate — Phase 1 only touched
  `TodayAnalysis.activityDecoupling`. A mixed climbing day can still inflate these two reads. Gating
  them, if wanted, is a small follow-up in the same shape as Task 4 of this plan, not a Phase 1 gap.
- **`carbsOptimum`'s calibration pool is thin, and this branch narrows it further.** It shares
  `steadyEndurance90d` with `decouplingGood` (see the bullet above on that pool shrinking), then filters
  further to rides ≥90 min with logged carbs and `|aerobicEffPct| ≥ 3%` — as of the 2026-08-06 sync
  window that leaves exactly 1 "good" and 3 "bad" observations. `deriveOptimum` (`lib/correlation.ts:108`)
  only falls back to the frozen prior when EITHER side hits zero, so it still re-derives today, but at
  "low" confidence (it already was, pre-Phase-1) and on a margin thin enough that losing the single good
  observation on a future sync (the rolling 90-day window ages it out with no replacement) would freeze
  the value in place with a refreshed timestamp — indistinguishable from a live one on the Model panel.
  Worth a periodic check, not an immediate fix.

## Common modifications

| Change | Where | Watch out |
|---|---|---|
| Scoring signal weights/bands | `execution-score.ts` | Frozen ledger entries must NOT be retro-scored; new logic applies to new entries only |
| New calibratable parameter | `calibration.ts` (+ `correlation.ts` if a new derivation shape) | Route through `trustedCalibration`; keep the discrimination guard |
| New insight type | `athlete-model.deriveInsights` | It only earns prompt space via `synthesis.ts`'s ranking |
| Ledger schema field | `score-log.ts` + `sync-ledger.backfillLedgerEntries` | Backfill must be idempotent; migration flags use truthy checks |
| Test fixtures | — | Don't pin expectations whose pre-rounding value sits on a .x5 float boundary (known IEEE flip trap) |
