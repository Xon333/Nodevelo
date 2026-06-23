# NodeVelo — archive (completed work)

A record of shipped work, kept out of the lean live trackers so they stay readable.

- **Live punch-list** (incoming bugs / feedback): [todo.md](todo.md)
- **Forward backlog** (what's next): [ROADMAP.md](ROADMAP.md)
- **Research spikes** (not committed): [research.md](research.md)
- **This file**: everything already done.

Entries are grouped by theme. Most reference the module(s) touched; see git history for the
exact commits.

---

## Per-athlete calibration framework — first pass (ROADMAP #2)

The keystone framework + its first calibrated parameter. Three commits; tests grew to 333.

- **The framework (Phase 0).** `lib/calibration.ts` promoted beyond α/ACWR into a uniform
  `CalibratedParameter { value, source, confidence, dataPoints, lastUpdated, locked, manualOverride }`
  (`lib/types.ts`) + `CalibrationStore`. `resolveCalibratedValue` resolves the effective value
  (precedence: manual override > trusted-derived [locked or ≥ medium confidence] > population default;
  never returns NaN); `confidenceFromN` is the sample-size confidence/lock layer (the additive
  uncertainty model Track D deferred into #2 — built once here). `data/calibration.json` is a derived
  store (`readCalibration`/`writeCalibration`, no backup, like rolling-baselines).
- **Decoupling "good" cutoff (Phase 1).** `deriveDecouplingGood` turns `rolling-baselines.avgDecoupling90d`
  (clamped 2.5–8, sample-size confidence) into the band's "good" cutoff, preserving a manual override and
  freezing once locked. `computeExecutionScore` takes optional `calibration.decouplingGood` and scales the
  decoupling bands off it — at the default G=4 the cutoffs are exactly `[2,4,7,10]`, so an uncalibrated
  score is byte-identical (no silent ledger regime split).
- **Immutable-ledger stamping.** `RideScoreEntry.calibration` freezes the values each entry was scored
  against (like `ftpUsed`; absent on pre-calibration entries). `buildRideScores` + the sync POST's
  interval-aware re-score both stamp it; a calibration change only affects new entries.
- **Wiring + UI.** Sync POST derives → writes → resolves → scores+stamps; GET returns `calibration` on
  `AppState`; read-only `CalibrationPanel` on Settings shows the effective value + provenance
  (default / learning / calibrated). Until a sync derives a confident value, everything resolves to the
  population default — a fresh athlete scores exactly as before.
- **Per-type IF cutoffs (second parameter under the framework).** `deriveIfBandOffsets(powerZonePct)`
  (`lib/calibration.ts`) shifts the `computeExecutionScore` `switch (plannedType)` IF bands to the
  athlete's OWN power-zone %FTP edges — Recovery/Z2/Threshold/VO2max/SIT anchored to their zone top
  (Z1/Z2/Z4/Z5/Z6), RaceSim deliberately left on population constants (no single anchoring edge). The
  per-type shift is a bounded FTP-fraction offset (±0.08 clamp, 0.02 deadband) added to every band edge
  in the IF branch; `DEFAULT_POWER_ZONE_TOPS_PCT = [55,75,90,105,120,150]` (Coggan/Intervals defaults)
  yields `{}` → **byte-identical scoring for a default-zoned athlete** (the regression net: the existing
  execution-score suite stays green unchanged). Threaded through `resolvedCal.ifBandOffsets` in the sync
  route to **both** the ledger re-score and today scoring; `execution-score.ts` gained a
  `ScoringCalibration { decouplingGood?, ifBandOffsets? }` type, `o = calibration?.ifBandOffsets?.[type] ?? 0`.
  Pure + deterministic + tested (offset derivation + the IF-branch shift in isolation). _Slivers left
  in ROADMAP #2:_ surface on Settings (derived live from zones, not yet in `CalibrationStore`); anchor RaceSim.

- **IF offset frozen onto ledger entries (provenance, ROADMAP #2 sliver).** `buildRideScores` now stamps
  the per-type IF-band offset that actually scored an entry alongside the decoupling cutoff, via the new
  exported `calStampFor(calibration, scoringType, intrinsic)` helper — replacing the single global
  `calStamp`. Only **planned** entries carry an offset (off-plan rides skip the intensity-vs-type branch,
  so none applied); a zero/deadband offset or an irrelevant type is omitted, so uncalibrated/default-zoned
  entries stay key-free (byte-identical). `RideScoreEntry.calibration` widened to
  `{ decouplingGood?; ifBandOffset? }` (both independently optional — backward-compatible with stored
  entries). The sync route's live-today re-score reuses `calStampFor` so today's entry stamps the same
  shape. Tested (planned stamp, type-scoping, deadband, off-plan omission); full suite green.

- **TSB adaptation-window edges under the framework (ROADMAP #2, closes #1's `form.tsbModifier` sliver).**
  `resolveTsbModifier`'s literal band edges (`-25 / -10 / 5`) are now a calibrated parameter:
  `TsbModifierEdges` + `DEFAULT_TSB_MODIFIER_EDGES` + `resolveTsbModifierEdges(override)` /
  `isTsbModifierEdgesOverridden` in `lib/calibration.ts`, mirroring `resolveAcwrBands` (defensive merge:
  ignore non-finite, clamp to a sane TSB range, enforce strict ascending order). **Deliberately the
  ACWR-bands pattern, NOT auto-derived** — the honest per-athlete signal (where THIS athlete stops
  adapting under fatigue) is measured nowhere; recentering on their TSB *distribution* would calibrate to
  where they train, not where they adapt (the framework header's "don't pretend to derive what we lack
  data for" rule). So: population-validated defaults + a manual override (`BlockSettings.tsbModifierEdges`,
  persisted/clamped in `/api/settings` like `acwrBands`). `resolveTsbModifier` gained an
  `edges = DEFAULT_TSB_MODIFIER_EDGES` param; `buildCoachSnapshot` resolves from a new
  `tsbModifierEdgesOverride` input, threaded through `CoachSnapshotSources` + all four snapshot build
  sites (sync ×2, ask, generate). Absent override → byte-identical classification (the fresh-athlete
  guarantee, tested across a TSB sweep). Tested (resolver clamp/order, override band shift); full suite green.

- **Form-state context stamped onto the ledger (ROADMAP #2 — input side of the context-stamp data play).**
  The play that makes the override-only edges (e.g. the TSB adaptation window) eventually *learnable*:
  freeze the athlete-state context an entry was scored under, so a later state→subsequent-execution
  correlation has something to correlate against. First parameter stamped = **form** (CTL/ATL/TSB).
  `buildFormStateLookup(wellness)` (`lib/readiness.ts`) returns a per-date resolver over intervals.icu's
  OWN per-day CTL/ATL (authoritative, not reconstructed): the most recent **strictly-prior** day (the form
  carried IN — not same-day, whose end-of-day CTL/ATL already absorbed that day's ride, which would leak
  the session's own load into the signal; also matches the PMC "form = yesterday's CTL−ATL" convention),
  carried forward across gaps up to a 10-day staleness cap (CTL drifts over weeks), `tsb = round1(ctl −
  atl)`, null when nothing recent enough exists. _[review-hardened: strictly-prior + staleness cap.]_
  `buildRideScores` gained a 7th optional resolver and stamps `RideScoreEntry.formState = { tsb, ctl, atl }` on each entry
  (spread-ready — absent when no wellness covers the date or no resolver passed → byte-identical). The
  sync route builds the lookup from `lastSync.wellness`. **Provenance only — `formState` never feeds the
  entry's own `executionScore`** (it's the input for a *future* correlation, kept out of the score it
  describes to avoid circularity). Backfill + the live-today re-score preserve it via `...e`. Tested
  (same-day / carry-forward / missing / rounding + the stamp present-and-absent).

- **Morning-check context stamped + resolver generalized (ROADMAP #2 — input side completed).** The
  subjective half of the context stamp: `RideScoreEntry.morningCheck = { fatigue, sleep, soreness }`
  (1–5, same-day only — no carry-forward; the first-person signal not captured by objective load). The
  `buildRideScores` resolver was generalized from `formStateForDate` → `contextForDate: (date) =>
  RideEntryContext | null` (`{ formState?, morningCheck? }`), each field stamped independently and
  spread-ready (byte-identical when absent). The sync route builds the combined resolver from
  `lastSync.wellness` + a `readMorningChecks()` map. **Readiness deliberately NOT stamped** — it's a
  derived composite of form + HRV, reconstructable from what's already frozen, so storing it would
  duplicate derivable state. Tested (form + morning-check together, form-only, absent).

- **First auto-derivation off the stamped context: the TSB deep-fatigue edge (ROADMAP #2 — payoff of
  the data play).** `deriveTsbDeepFatigue(entries)` (`lib/calibration.ts`) recenters the deep-fatigue
  edge on the **median TSB of the athlete's under-executed quality sessions** — **prescribed** quality only
  (`planned && plannedType ∈ {Threshold,VO2max,SIT,RaceSim}`; off-plan rides are scored intrinsically, a
  different failure axis, so they're excluded), `executionScore ≤ 4`, legacy + compromised excluded.
  **Honesty guards**, all falling back to the population default: a confidence gate on the failure count
  (`confidenceFromN`, never applied below medium); a **contrast requirement** — needs ≥1 successful quality
  session, else there's nothing to discriminate against; and a **discrimination guard** — failures must sit
  ≥4 TSB points deeper than the successes' median, else fatigue isn't the driver. _[review-hardened:
  planned-only + required success contrast.]_ Derived value clamped to
  `[-45, -12]`. `resolveTsbEdgesOverride(entries, settingsOverride)` layers the derived edge as the new
  default **under** any manual override (precedence: manual > derived > population), returning a partial
  that flows through the existing `resolveTsbModifierEdges`. Wired at every snapshot site
  (`buildCoachSnapshotFromSources` + generate). No-signal/no-formState athletes resolve to the population
  edges → byte-identical classification. This is the first override-only edge to become *learned*, exactly
  the roadmap worked example — turning the 2b override-only TSB window into a derived one once the data
  earns it. Tested (derivation, both guards, exclusions, clamp, precedence, low-confidence fallback);
  full suite green (834).

- **TSB-derivation review follow-ups CS-5..CS-8 (after findings 1–4 fixed inline).**
  - **CS-5 — per-edge precedence.** `resolveTsbEdgesOverride` now resolves precedence per-edge: a manual
    `deepFatigue` short-circuits the derived value entirely, and a derived edge **yields** below a manually-set
    `productiveOverload` (`min(derived, manualPO − 1)`) so `resolveTsbModifierEdges`' ordering pass can no
    longer nudge a manual neighbour up. Manual > derived > population, for the *neighbour* edges too.
  - **CS-6 — single morning-check read.** The sync POST read `readMorningChecks()` twice (ledger stamp +
    snapshot); hoisted to one read reused by both.
  - **CS-7 — TSB-specific confidence gate.** Replaced `confidenceFromN(nUnder)` with
    `tsbDeepFatigueConfidence(nUnder, nGood)`: lower failure bar (quality failures are rare + informative)
    but now requires real **contrast** (≥3 successes) — effective take-effect gate is nUnder ≥ 5 ∧ nGood ≥ 3
    (was an ~unreachable ≥8 failures). The contrast requirement also blunts CS-8's tiny-N median concern,
    since the applied derivation now rests on ≥3 successes.
  - **CS-8 — shared `lib/stats.ts`.** Extracted `round1` / `round2` / `clamp` / `median` into one module;
    `calibration.ts`, `readiness.ts`, `score-log.ts` now import them instead of re-defining. Tested. Full
    suite green (839 + stats).

### Population-fallback fold-in — strain bands, durability envelope, fusion weights (ROADMAP #2/§5)

Three scattered groups of "magic numbers" brought under the same `resolve-with-fallback` machinery as the
ACWR/TSB-edge bands — population fallback, manually overridable via `BlockSettings`, **no** derivation
(no honest per-athlete signal exists yet). Each consumer takes the resolved value as an optional param
defaulting to the population default, so an absent override behaves byte-identically. Two commits; tests
grew to 462.

- **Morning-check strain bands + TSB-deep cutoff.** `StrainBands` (`high`=15/`med`=12) +
  `resolveStrainBands` in `calibration.ts`; `decideMorningCheck` takes the resolved bands. The TSB-deep
  cutoff dropped its duplicate `-25` literal and now routes through the existing
  `resolveTsbModifierEdges().deepFatigue` (one source for the edge). Wired via the morning-check route.
- **Durability-insert envelope.** `DurabilityInsertEnvelope` (88% floor, ≤122% / ≤20 min) +
  `resolveDurabilityInsertEnvelope`; dedups `EMBEDDED_HARD_PCT` (was defined twice — `prescription.ts`
  + `workout-validate.ts`). `validateWorkoutProtocol` / `validatePlanProtocol` / `carriesEmbeddedIntensity`
  take the resolved value; wired via the generate route.
- **Athlete-state fusion weights.** `athlete-state.ts`'s private `const C` promoted to
  `DEFAULT_ATHLETE_STATE_WEIGHTS` + `resolveAthleteStateWeights` (recursive finite-leaf deep-merge, never
  mutates the default) + a shared `DeepPartial` helper. `computeAthleteState(i, weights = DEFAULT)` —
  evaluators are now pure fns of `(inputs, weights)`. Threaded through `resolveCoachSignals` +
  `CoachSnapshotSources` and every snapshot site (sync GET + POST, `/api/ask`, generate).
- **Overrides** live on `BlockSettings` (`strainBands` / `durabilityInsertEnvelope` /
  `athleteStateWeights`), alongside the existing `acwrBands` / `tsbModifierEdges`. Per-athlete
  *derivation* of any of these stays future work (← #2's shared correlation engine).

### Shared correlation engine + carbs ledger stamp (ROADMAP #2 / Track C)

The reusable substrate the roadmap asked for ("build the derivation once, reuse it") plus the first new
signal stamped against it. Two commits; tests grew to 474.

- **The engine (`lib/correlation.ts`).** `deriveExecutionEdge(entries, spec)` generalises the guarded
  regression `deriveTsbDeepFatigue` hard-coded: population filter (planned · !legacy · !compromised ·
  in-scope type · present signal), under/good outcome partition, a discrimination guard with a
  `failureSide` direction (`lower`|`higher`), confidence gate + clamp → `CalibratedParameter`. Depends
  only on `./types` + `./stats` (no `./calibration`) so calibration consumes it cycle-free.
  `deriveTsbDeepFatigue` is now a thin `failureSide: "lower"` spec over it — behaviour byte-identical
  (every existing deep-fatigue test still green).
- **Carbs input stamped (`fuel.carbsGPerH`).** intervals-api maps `carbs_ingested` ("CHO In") into
  `ActivitySummary.carbsIngestedG`; `score-log.fuelStampFor` freezes it as g/h (grams over moving hours)
  onto each entry, alongside the calibration + context stamps. Only a positive logged intake is stamped
  (a blank/zero field is indistinguishable from "didn't fuel" — no fake zeros). Provenance only; never
  feeds `executionScore`. Sparse until athletes fill it in, accumulating like `formState` did.
- **Not yet built** (ROADMAP Track C): the *optimum*-derivation shape carbs needs (the engine finds a
  failure edge, not an optimum); consuming the derived optimal g/h (#1 fuel slots, §6 surfacing); the
  `productiveOverload`/`balanced` edges (no honest execution outcome) and the morning-check strain edge
  (needs `motivation` stamped — the ledger freezes only fatigue/sleep/soreness).

---

## Scoring-core — Z2 "dialed-in" discipline signal

Closed the ROADMAP scoring-core gap: easy aerobic rides were scored on *average* IF + decoupling, so a
Z2 ride that averaged a textbook 0.68 IF while repeatedly surging into Tempo+ read as disciplined — the
mean hid the spikes and the variability index only blurred them.

- **The measure.** `timeAboveZ2Fraction(powerZoneTimes)` (`lib/execution-score.ts`, pure + defensive)
  returns the share of measured in-zone time spent in **power zones 3+** (above the Z2 aerobic cap),
  from the already-synced `ActivitySummary.powerZoneTimes` — `null` when there's no usable zone data so
  scoring falls back to its other signals.
- **The score.** A bounded **±2** band in `computeExecutionScore` (`aboveZ2Frac` input): ≤5% above cap
  → +1 (genuinely dialed in), ≤15% → 0, ≤30% → −1, >30% → −2. Gated to **prescribed Z2/Recovery** and
  skipped for off-plan (intrinsic) rides — no plan to be disciplined against — and absent-safe, so every
  existing ride without zone data scores byte-identically (the execution-score suite stayed green
  unchanged). Threaded through both score call sites: `buildRideScores` (the ledger; past entries stay
  frozen via `mergeScoreLog`, so only new rides see it) and `buildTodayAnalysis` (today, re-scored live).
- **Surfaced.** `CoachSnapshot.today.execution.aboveZ2Pct` (% above cap, Z2/Recovery only) renders in
  `formatCoachSnapshot` with a qualitative tag (dialed in / drifted / drifted hard) so Ask-Coach reads
  the resolved discipline number instead of inferring it. 12 new tests (helper + band + surfacing); suite 394 → 406.

---

## Code-review hardening sweep (CR-A..H)

A "senior dev who hates this implementation" pass over the whole repo, 2026-06-22 — eight findings,
each shipped as its own atomic commit with tests. Suite grew 333 → 394. Deferred sub-items (real but
lower-leverage) are routed to ROADMAP; the design-judgment calls live there too.

- **CR-A — transactional ledger writes.** `json-store` serialized byte-*writes*, not read-modify-write,
  so a concurrent `/api/sync` + `/api/disposition` each doing `read→mutate→write` on `score-log.json`
  could lose an update. Added `updateJsonFile<T>(file, fallback, mutate)` (reads INSIDE the per-file
  lock via the generalized `withFileLock`) + `updateScoreLog`/`updateDispositions` helpers; wired both
  sync score-log writes and both disposition writes through them. (Other ledger touchers are read-only.)
  `lib/json-store.ts`, `lib/data-store.ts`, `app/api/disposition/route.ts`.
- **CR-B — external-fetch timeouts.** `AbortSignal.timeout(20s)` on `icuFetch` (abort/network → typed
  `IntervalsApiError`), `timeout:240s` + `maxRetries:2` on the Anthropic client, `maxDuration=120` on
  `/api/sync`. New `intervals-api.test.ts`. `lib/intervals-api.ts`, `lib/anthropic-api.ts`.
- **CR-C — refuse a destructive empty sync.** `isSuspectEmptySync(prev, fresh)` (pure, tested): a sync
  with no activities AND no wellness when the prior had data returns 502 instead of overwriting
  `last-sync.json` + resetting baselines from `[]`. _Deferred → ROADMAP P8:_ persistent sub-step
  failures deserve real observability, not a recurring toast. `lib/intervals-api.ts`, `app/api/sync/route.ts`.
- **CR-D — same-origin API guard.** Next 16 `proxy.ts` (the renamed middleware) matching `/api/:path*`,
  backed by unit-tested `lib/csrf.ts` `isForbiddenCrossSiteWrite` (state-changing methods need a
  same-origin `Origin`; safe methods + non-browser clients exempt). Verified live: cross-site POST →
  403 before the handler, same-origin POST passes. Closes the drive-by `/api/import` hole. NEW `proxy.ts`, `lib/csrf.ts`.
- **CR-E — immutability contradictions fixed.** `deriveDecouplingGood` no longer auto-locks at n≥20 —
  it re-derives from the 90-day rolling mean every sync (input is already recency-windowed; a season of
  getting fitter must move the cutoff), confidence gate still guards noise, last-known-good kept across
  an empty window. `mergeScoreLog` comment now states the real contract (past frozen, today re-derived
  live). `lib/calibration.ts`, `lib/score-log.ts`.
- **CR-F — enforce the AI's nutrition numbers.** `validateNutrition` recomputes each day's daily-intake
  kcal from the same deterministic formula the reference table is built from, parses the figure the
  model wrote, flags a material deviation (generous tolerance). Wired into `/api/generate`. _Deferred →
  ROADMAP Track C:_ per-carb (pre/in/post) checks — shared free-text line makes which-number-is-which
  parsing ambiguous. NEW `lib/nutrition-validate.ts`.
- **CR-G — decompose the sync god-route + first mutating-route test (worktree).** Extracted the
  today-ride pure logic into `lib/ride-analysis.ts` (`computeRideMetrics`, `computeAdvisedIntake`,
  `buildTodayAnalysis`) and the ledger schema migration into `lib/sync-ledger.ts` (`backfillLedgerEntries`);
  the route now does I/O + calls the tested pure builders (~130 lines lighter). Added
  `app/api/disposition/route.test.ts` — first coverage for a mutating route (the CR-A transactional path).
  _Deferred → ROADMAP:_ full step-by-step pipeline split + component tests. NEW `lib/ride-analysis.ts`, `lib/sync-ledger.ts`.
- **CR-H — edge cases (H1 shipped, rest triaged).** `resolveAllTimeCurve` merges fresh + prior all-time
  taking max-per-duration so the all-time power curve stays monotonic on a missing/partial/regressed
  fetch (84-day curve only as a first-sync last resort) — PR detection can't false-drop. The other three
  (physiologyAsOf re-sort cost, dual weight-trend display, HR bpm-vs-%LTHR heuristic) triaged as
  not-a-bug / not-worth-the-risk, documented. `lib/intervals-api.ts`.

---

## Code-review hardening pass (CR-1..16)

A self-review of the §5/#1/#3/Track B work, worked as a gated pre-feature pass. All 16 items resolved.

- **CR-1 — durability intensity made visible.** `carriesEmbeddedIntensity` (`lib/prescription.ts`): a
  ride carrying ≥5 min of ≥88%-FTP work counts as hard. `validateSchedule` (now takes `ftp`) treats
  such a Z2 ride as a hard day for back-to-back spacing; `validateWorkoutProtocol` checks the embedded
  inserts against a threshold∪VO2 envelope (≤122%, ≤20 min). Budget stays type-based.
- **CR-2 — guarded the proactive apply.** `proactiveApplyBlock`: `PUT /api/morning-check` refuses
  unless today's stored check recommended `downgrade` and no ride is logged.
- **CR-3 — client-local dates.** `/api/ask` + `/api/morning-check` resolve the client date
  (`resolveToday`); `AskCoach` + `MorningCheckIn` send `localToday()`. UTC-boundary disagreement gone.
- **CR-4 — KB resilience + skeleton.** `knowledge-base-defaults/` (committed schema + cited §-anchors);
  `kb-loader.ts` reads local-else-default and never `readdir`-throws on a fresh clone.
- **CR-5 — one ACWR.** `/api/ask` uses calibrated `resolveAcwrBands(settings)` like Today/generation.
- **CR-6 — carry-forward is real.** A no-make-up-slot downgrade records the dropped session on
  `CurrentBlock.deferredQuality`; generation re-prioritises it. No longer silently lost.
- **CR-7 — negation-aware goal matching.** "avoid hills" / "no racing" stop forcing a RaceSim.
- **CR-8 — route/integration tests.** vitest `@/` alias + IO/LLM-mocked tests for morning-check
  (incl. the CR-2 guard), ask (snapshot assembly), generate (Track-B requirement + durability stamp).
- **CR-9 — one signal resolver.** `resolveCoachSignals` removes the snapshot-assembly duplication
  across `/api/ask` + `/api/generate`.
- **CR-10 — honest deload.** Recovery downgrade capped at `min(45, original)`; docs corrected (only the
  easy-day swap preserves load; the rest-day path is a deload).
- **CR-11 — calibration debt catalogued.** ROADMAP #2 now lists the recent population magic-numbers to
  fold in.
- **CR-12 — per-loading-week RaceSim** enforcement (≥2 quality + no RaceSim flags the week).
- **CR-13 — mild-illness nuance** (sickness always downgrades; mild only with strain/objective).
- **CR-14/15/16** — accepted as designed / deferred to §7 / monitor (rotation cadence, calendar
  mutation, ask-coach cost). See todo history.

Tests grew to 281 across 37 files over the pass.

---

## Re-review hardening pass (RR-1..12)

A senior-dev re-review of `63a9263` (the CR-9..16 batch) caught 12 items; all resolved over 6 atomic commits. Tests grew from 281 → 289.

- **RR-1 — honest deload on the proactive path.** `suggestProactiveReschedule` is now easy-only (`findMakeUpSlot(..., ["easy"])`). A rest day is never raided when the athlete is compromised; with no easy slot, today deloads to a capped Recovery spin and the quality carries forward (CR-6). `toWasRest` removed from the interface, route response, and `MorningCheckIn`. "Only the easy-day swap preserves load" is now true by construction.
- **RR-2 — missing reschedule tests added.** Cases for `min(45, original)` Recovery cap, swap-skips-rest-day, and honest-deload-instead-of-raiding-rest.
- **RR-3 — loading-week detection is theme-aware.** `isLoadingWeek` = ≥2 quality AND `weekTheme` not recovery/deload/unload/taper. A recovery week that keeps 2 quality sessions is no longer flagged as needing a RaceSim.
- **RR-4 — negation is clause-scoped.** Replaced the 15-char back-scan in `tagPresent` with `clauseStart()`, which walks back only to the nearest clause break (punctuation, dashes, `but`/`however`/`yet`). A negation now flips a tag only within its own clause — `"no gym, hilly race"` correctly requires a RaceSim.
- **RR-5 — band resolution lives once.** `resolveCoachSignals` now takes the raw `acwrBands` override and calls `resolveAcwrBands` internally; both routes drop the duplicated call + calibration import.
- **RR-6 — `CoachSnapshotInput extends CoachSignals`.** The six form/fuel/state signal fields are inherited; the compiler now enforces what was a comment-only contract.
- **RR-7 — named ACWR band type.** Opaque `Parameters<typeof computeAcwr>[1]` replaced with `Partial<AcwrBands> | null`.
- **RR-8 — consolidated validator warnings.** One GOAL warning names all offending loading weeks (`"weeks 1, 3 …"`) instead of one per week. Bounded fan-out.
- **RR-9 — validator branch coverage.** Tests for multi-week consolidation, recovery-week exclusion, and the `!anyRaceSim && !flaggedAWeek` block-floor fallback.
- **RR-10 — `proceed-easy` intensity cap (neck-check rule).** Mild illness on fresh legs now produces a third decision state. `applyEasyCap` converts today's quality session to a same-duration Z2 ride (structured intervals dropped) in place — no relocation or deferral. `MorningCheckDecision` type, route, and `MorningCheckIn` all handle the new state.
- **RR-11 — `strainScore` input clamping.** Route is the real validation boundary (400 on non-1–5 ratings); `strainScore` also clamps each input so its 4–20 range holds for any direct caller.
- **RR-12 — week-sort cleanup.** `validateSessionRequirements` sorts the small offending-week array rather than the Map entries; no week-numbering assumptions.

- **RR-1 follow-up — explain the skipped rest day.** When the proactive path deloads because the only free slot is a rest day, `suggestProactiveReschedule` now returns `skippedRestDay` (the clear rest day it deliberately didn't raid). The morning-check preview and the apply note name it ("there's a rest day on X, but moving a hard session there would add load while you're compromised…") instead of implying nothing was available.

---

## Coaching depth — CoachSnapshot, proactive reschedule, session variety

A run of ROADMAP "Next up" + Track B items. Remaining slivers for each stay in [ROADMAP.md](ROADMAP.md).

### CoachSnapshot — resolved-numbers lens (ROADMAP #1)
- `lib/coach-snapshot.ts`: one deterministic snapshot (today execution · form + TSB-as-actionable-
  modifier · fuel · fused state · directives · disposition · morning check) read by Ask-Coach
  (`/api/ask`, fully wired) and generation (`/api/generate`, compact form+fuel line) so the LLM is
  handed resolved numbers instead of inventing them. `buildCoachSnapshot` + `formatCoachSnapshot` +
  `formatFormFuelLine` + `resolveTsbModifier`; the compromised-disposition guard rides in the snapshot.
- **Surfaced on Today (the remaining sliver).** `buildCoachSnapshotFromSources` is now the one shared
  assembler (model → signals → directives → snapshot) the sync GET and `/api/ask` both call, so the
  Today card shows the *identical* snapshot the LLM reads — `/api/ask`'s parallel assembly was removed.
  `coachSnapshot` rides on `AppState` (GET takes `?today=` for the client-local date; POST rebuilds it
  on fresh data so the card updates after a sync), and `components/CoachSnapshotCard.tsx` renders the
  resolved form (TSB-as-actionable-modifier) + fuel in the Today readiness zone, hiding when empty.

### Proactive reschedule — "not feeling it?" morning check-in (ROADMAP #3)
- `lib/morning-check.ts` + `app/api/morning-check` + `components/MorningCheckIn.tsx`: a pre-session
  check (fatigue/sleep/soreness/motivation + illness) → deterministic proceed/downgrade
  (`decideMorningCheck`: subjective strain + objective TSB/readiness/ACWR). Applying it downgrades today
  and moves the quality stimulus to the next rest day (a deload) — else a load-preserving swap with the
  next easy day (`suggestProactiveReschedule` / `applyProactiveReschedule` in `lib/reschedule.ts`). Stored in
  `morning-check.json`; feeds the CoachSnapshot. Also shipped the §3 "wider target slots" sliver.

### Session selection & prescription variety (Track B)
- **Goal-driven selection** — `lib/session-requirements.ts`: terrain/race goal tags → a RaceSim
  requirement injected into the prompt and enforced by `validateSessionRequirements` (warns if the block
  ships none); RaceSim already counts toward the quality budget + spacing.
- **Durability taxonomy** — KB §12 + `lib/durability.ts`: 5 rotating templates (A–E),
  `selectDurabilityTemplate` limiter-driven (Threshold→B, VO2max→C, SIT→D, systemic fatigue→A) else
  rotated; the long ride stays TYPE Z2 with intensity inside the duration. The chosen template is
  stamped on the block (`durabilityTemplate` through generate→write→history) for rotation + scoring.

### Structural debt paydown
- Split `components/Dashboard.tsx` (1453→516 LOC) into `components/dashboard/{shared,today,plan}.tsx`;
  cleared all 11 ESLint problems; deleted the legacy `parsePlan` regex text-parser fallback (structured
  tool-use is now the sole generation path) — `plan-parser.ts` keeps only `planDayToEvent`.

---

## Trends & Today card polish (TR batch)

From a real-use feedback pass on the Trends and Today pages.
- **TR-1 — Weekly-volume card compacted.** The Trends "Weekly volume" card is now half-width
  (paired in a `lg:grid-cols-2`, right column intentionally empty) to match the "Execution quality"
  card instead of spreading full-width. `components/Trends.tsx`
- **TR-2 — Weekly-volume colour-by-magnitude.** Bars are shaded across four blues relative to the
  window max (darker = bigger week), so volume reads by hue as well as height. `components/Trends.tsx`
- **TR-3 — Card ⓘ hovers.** `Card` gained a reusable `tip` prop rendering a `MetricTip` ⓘ next to
  the title; applied to the Weekly-volume + Execution-quality cards. `MetricTip` promoted from
  `components/dashboard/shared.tsx` to `components/ui.tsx` as a generic primitive. (Slice of ROADMAP
  "Popups where needed".)
- **TR-4 — Today metric strip.** Split the combined "NP / Avg" tile into distinct **NP** and **Avg
  power** tiles, kept **Avg speed**, and gave **IF** context (effort-band sublabel + ⓘ hover
  explaining NP÷FTP). Verified the tiles are correctly wired from sync (`app/api/sync/route.ts`) —
  a missing value means absent Intervals data, not a bug. `components/dashboard/today.tsx`

## Feedback sweep — all items cleared

A full pass over a feedback dump (bugs + UX + features), worked P1 → P3.

### Data integrity & interval detection
- **DI-1 — plan-vs-detection mismatch guard.** `matchPrescription` flags `structuralMismatch`
  (every rep ~half its prescribed length yet power nailed + rep count matched = a plan-definition
  vs detection mismatch, not a bail). Scoring drops the untrustworthy duration penalty; the coach
  note + Today card explain it. `lib/interval-match.ts`
- **DI-2 — interval power mis-read.** Adherence now reads `avgWatts` (what was actually held), not
  NP (which overstates short/variable efforts by 20%+). NP is kept only to filter warm-up/recovery
  laps out of the work band. `lib/interval-match.ts`
- **DI-3 — mid-ride added intervals.** Executed work efforts beyond the prescribed count are
  captured as `extras` and shown as dashed "+extra" chips instead of being silently dropped.
- **DI-4 / PW-10 — power-PR recognition.** New PRs surfaced to the coach note (called out first)
  and as a 🏆 trophy banner on Today with the gain over the prior best. `lib/pr.ts`

### Workout protocol & vocabulary
- **PW-2 — SIT consistency.** SIT progress marker moved from 1-min to 30-sec power to match the
  30s all-out protocol; all surfaces (KB, validator, prompt, Ask-Coach, marker) now agree.
- **PW-7 / PW-8 — KB-grounded protocols.** `lib/workout-validate.ts` flags generated workouts that
  violate KB interval protocols (SIT 4–6×20–30s @ 130–200%, VO2max 3–8min @ 106–120%, threshold
  88–105%); the same rules are stated in the generation prompt — guard on both ends.
- **PW-1 — standing-sprint technique.** KB distinguishes seated SIT (aerobic, consistent power)
  from standing sprints (neuromuscular/race skill) + technique cues; generation coaches standing
  only on dedicated sprint/RaceSim work.
- **PW-3 — RaceSim as a real workout type.** Added `RaceSim` to `WorkoutType` (+ styles, nutrition
  factor, execution band, reschedule quality list, generation TYPE list, KB protocol): variable
  race-moves, peaking/event-window use, scored on intensity not rep-match.
- **PW-9 — terrain-flexible sessions.** KB + generation rule to prescribe structured-but-flexible
  outdoor quality (target efforts as ranges + a placement rule + strict-Z2/HR-cap floor), scored
  on intrinsic quality. Keep one fixed ERG benchmark per week.
- **PW-4 / PW-5 — execution cues in descriptions.** Optional `Execution:` line in the DESCRIPTION
  format + KB-grounded cues (HR-ceiling on hilly Z2, sit-down sprints, descents as cornering
  practice). `lib/anthropic-api.ts`

### Coaching context
- **PW-6 — Ask-Coach sees the next session.** The coach now gets the nearest upcoming session's
  exact prescription ("do not invent durations") — kills the "4-min for a 30s SIT day"
  hallucination. `app/api/ask/route.ts`, `lib/anthropic-api.ts`
- **#9 — all-time power PRs.** `fetchPowerCurveAllTime()` pulls Intervals.icu's `curves=all` into
  `SyncData.powerCurveAllTime`; the Profile shows all-time bests and PR detection uses the all-time
  curve as a monotonic baseline (no window false-drops, true all-time deltas), with an 84-day
  fallback. `lib/intervals-api.ts`, `lib/pr.ts`
- **NUT-6 — nutrition formula audit (pass).** Verified: weight is live-synced, the buffer is
  weight-trend-adaptive + clamped (0–600) and skipped on rest days, carbs scale by mass (glycogen)
  while protein is flat (MPS saturates). Sound; the real enhancement (energy-availability signal)
  is ROADMAP §6.

### Today / Plan / Trends UX
- **TODAY-1 — ride-card de-dup.** Merged NP + Avg into one tile and dropped TSS (identical to
  Intervals' "Load"); 6 → 4 metric tiles.
- **TODAY-6 / TODAY-8 — ACWR & TSB tooltips.** What they are, calc basis, good/concerning bands.
- **TODAY-7 — session-state fix.** The calendar showed *compromised* rides as "Missed" (they're
  excluded from `scores`). Threaded `compromisedDates`/`partialDates` through sync → state →
  calendar; compromised now reads "Compromised — ridden, excluded from scoring", partial reads
  "Partial". `missed` confirmed correctly auto-derived.
- **TODAY-2 / TODAY-3 / TODAY-5** — power-zone bar labels → hover tooltip; Trend-Pulse per-week
  hover + "this wk" label; ride-card energy unit kJ → kcal.
- **PLAN-3** — audited; "This week" Hours/TSS aren't duplicated on the Plan page itself, left as-is.
- **TRENDS-1** — Pw:HR excludes indoor rides (distorted power:HR); ≥45-min + endurance-band +
  Intervals' efficiency-factor method. `lib/trends.ts`
- **TRENDS-2** — fueling/weight graph shows complete weeks only (drops the partial current week).
- **TRENDS-3** — replaced trivial 7-day avg RPE with an actionable 7-day training-load total.
- **UI-5 — ride-card power trace.** 30s rolling-mean smoothing tames the jumpy line; short
  work-interval bands get a minimum width + stronger fill so 30s reps are visible; band-alignment
  fixed (bands sit exactly under the line). `lib/trace.ts`, `components/RideTrace.tsx`

---

## Platform & performance (P-series)

The local-first cost / robustness / observability hardening, in order. Forward items live under
ROADMAP "Platform & performance"; P4 is partially done (1 of 4 items shipped).

- **P1 — Prompt caching + singleton Anthropic client.** One lazily-constructed `Anthropic`
  client reused across all calls (was `new Anthropic()` per call ×4) for connection pooling.
  Generation's system prompt is split into a cached prefix (persona + workout-syntax guide +
  reference KB, marked `cache_control: ephemeral`) and a dynamic tail (carry-forward seeds +
  directives + athlete data + block params), so a repeat generation within the cache TTL re-reads
  the bulk at ~0.1× input cost. A test locks the invariant that per-block dynamic content never
  leaks into the cached prefix (which would defeat the cache). `lib/anthropic-api.ts`,
  `app/api/generate/route.ts`.
- **P2 — Structured generation via tool-use.** Generation no longer regex-parses Claude's
  markdown — it forces a `submit_training_block` tool whose `input_schema` is derived (via
  `z.toJSONSchema`) from one shared zod schema (`lib/plan-schema.ts`), which also validates the
  response. The route maps the typed output → `PlannedDay[]` and falls back to the regex parser
  (`plan-parser.ts`, retained) only if the tool payload is absent/malformed. `workout-validate`
  stays as the coaching-validity guard (tool-use is only *schema*-valid). Added `zod` v4. New
  schema/mapping tests. `lib/plan-schema.ts`, `lib/anthropic-api.ts`, `app/api/generate/route.ts`.
- **P3 — Decoupled sync + surfaced warnings.** `/api/sync` now returns fast with the
  deterministic analysis (metrics, zones, intervals, PRs, execution score) and defers only the slow
  LLM coach note to a follow-up `/api/analyze` (extracted `lib/sync-analysis.ts addCoachNote`,
  idempotent — preserves a note across re-syncs, auto-posts once). PR detection stays in the fast
  path (it needs the pre-sync curve). Non-fatal step failures (intervention validation, ride
  analysis, coach note) now collect into a `warnings[]` array surfaced in the nav rail instead of
  being swallowed by best-effort catches; the Today card shows "Analysing today's ride…" while the
  note lands. `app/api/sync/route.ts`, `app/api/analyze/route.ts`, `lib/sync-analysis.ts`,
  `components/SyncProvider.tsx`, `components/Nav.tsx`, `components/Dashboard.tsx`.
- **P4 (item 4 of 4 — section COMPLETE) — Generation dedupe.** Decision: a **short dedupe-only
  window**, not a long reuse cache (generation runs at temperature 0.3, so a considered regenerate is
  partly *for* the variation). `lib/generate-cache.ts dedupeGeneration(key, compute)` keys on a sha256
  of the three assembled prompt parts and runs `compute` at most once per key while it's in flight +
  ~60 s after it completes — so a double-click or a second request landing mid-generation shares the
  one Claude call, a failure evicts immediately so retries re-run, and a deliberate regenerate
  outside the window re-calls. In-memory + single-process (same assumption as the singleton client; a
  restart just forgets the window). Wired into `app/api/generate/route.ts`. 6 new tests
  (in-flight dedupe, per-key, failure-evict, fake-timer window expiry). `lib/generate-cache.ts`.
- **P4 (item 3 of 4) — Stream `/api/ask`.** `streamAskCoach` (async generator) yields Anthropic text
  deltas as they arrive and records usage from the final message; `/api/ask` wraps it in a plain-text
  `ReadableStream` (validation still returns JSON errors *before* the 200 stream; a mid-stream failure
  surfaces as the stream erroring); `AskCoach` reads `res.body` incrementally and renders the reply as
  it streams ("thinking…" only until the first token). `lib/anthropic-api.ts`, `app/api/ask/route.ts`,
  `components/AskCoach.tsx`. Type-checked + build-verified; live token path needs a real Anthropic key
  to exercise. _P4 now has only generation caching left — blocked on the regenerate-vs-cache product
  question (ROADMAP)._
- **P4 (item 2 of 4) — Coach-accuracy % on the dashboard.** `overallCoachAccuracy(log)` rolls the
  intervention validation loop into one headline hit-rate (validated / decisive across all
  dimensions; null until the 28-day horizon produces a decisive outcome). Computed in the `/api/sync`
  GET handler, carried on `AppState.coachAccuracy`, surfaced as a compact line in the Today
  Trend-pulse zone — hidden entirely until there's a decisive % *or* pending interventions, so it
  never shows an empty tile on a fresh install. `lib/intervention.ts`, `app/api/sync/route.ts`,
  `components/SyncProvider.tsx`, `components/Dashboard.tsx`. 2 new tests.
- **P4 (item 1 of 4) — Token/cost tracker.** `lib/ai-usage.ts` folds every Anthropic call's
  `usage` into `data/ai-usage.json` (best-effort, fire-and-forget — never blocks the request; a
  serialized read-modify-write chain prevents lost increments under concurrency). Cost is estimated
  from a per-model price table (sonnet-4-6 $3/$15, haiku-4-5 $1/$5 per 1M) with the cache-write
  premium (1.25×) and cache-read discount (0.1×) applied to the input rate. `recordUsage` wired into
  all four call sites (generate, ride analysis, retrospective, ask-coach); `AiUsageCard` shows total
  + per-model spend on the (now dynamic) Settings page. Pure `estimateCostUsd` unit-tested.
  `lib/ai-usage.ts`, `lib/anthropic-api.ts`, `components/AiUsageCard.tsx`, `app/settings/page.tsx`.
  (P4 is now complete — items 2/3/4 above.)
- **P5 — Deterministic schedule validator.** Generation was *instructed* to space quality
  sessions ("avoid back-to-back hard days") and cap them at the weekly budget, but nothing enforced
  placement — `workout-validate.ts` checks each session's protocol bands in isolation. New
  `lib/schedule-validate.ts validateSchedule(days, settings)` does a post-generation pass over the
  block's day sequence and flags (a) two hard/quality days on consecutive calendar dates (by date
  adjacency, so it spans the week boundary and never false-pairs across a gap) and (b) any week over
  the `qualitySessionsPerLoadingWeek` budget. Quality set = Threshold/VO2max/SIT/**RaceSim** (RaceSim
  counts toward the budget + spacing). Folded into the generate route's `warnings[]` next to the
  protocol checks — warns only, never reorders. 11 new tests. `lib/schedule-validate.ts`,
  `app/api/generate/route.ts`.
- **P6 — Reliability & resilience quick-wins.** Five independent hardening wins:
  - **Error boundaries** — `app/error.tsx` (route-segment fallback; the nav rail above it stays
    mounted) + `app/global-error.tsx` (root-shell fallback). Use Next 16's `unstable_retry` prop
    (not `reset` — verified against `node_modules/next/dist/docs`).
  - **Provenance stamping** — `PROMPT_VERSION` constant + `model`/`promptVersion` (optional) on
    `GeneratedPlan`, `TodayAnalysis`, `BlockHistoryEntry`, `CurrentBlock`, stamped at generation /
    coach-note time and carried through block archive → history; makes past AI outputs auditable
    when the model or prompt later changes. `lib/anthropic-api.ts`, `lib/types.ts`, generate/write/
    retrospective routes, `lib/sync-analysis.ts`.
  - **Export / import backup** — `GET /api/export` bundles `data/*.json` + `knowledge-base/**/*.md`
    into one downloadable JSON (no zip dep); `POST /api/import` restores it, guarded (must self-id as
    a NodeVelo backup, path-traversal-confined, data files go through `writeJsonFile` so critical
    stores keep their pre-import `.bak`). Settings "Backup & restore" card. `components/BackupRestore.tsx`.
  - **json-store per-file write mutex** — concurrent writes to the same store chain one-at-a-time
    (last-write-wins) so a sync + disposition POST can't clobber the shared temp file; different
    files stay parallel. Data dir made env-overridable (`NODEVELO_DATA_DIR`) for test isolation.
    `lib/json-store.ts` + new mutex/round-trip tests.
  - **Manual re-analyse** — `addCoachNote(today, warnings, force)` regenerates today's coach note on
    demand (force bypasses the idempotency guard); `/api/analyze` reads `force`; `SyncProvider`
    exposes `reAnalyse`; the Today coach-note card shows a re-analyse / "generate note" button so an
    Anthropic hiccup is recoverable without a full re-sync. The sync route already preserves a good
    note + its stamp across a re-sync (never overwrites with empty).

- **P7 — TanStack Query data layer.** Replaced the hand-rolled cache (`SyncProvider`'s
  fetch-on-mount `useEffect` + a separate `useEffect` fetch in Trends) with `@tanstack/react-query`
  v5. New `QueryProvider` (one `QueryClient`, `staleTime` 30 s, `refetchOnWindowFocus` +
  `refetchOnReconnect` + retry) wraps the app above `SyncProvider`. The `['sync']` GET is now a
  `useQuery`; Trends uses `useQuery(['trends', syncedAt])` (re-fetches when a sync completes, plus
  focus/reconnect/dedup/retry). Crucially the **`useSync()` context API is unchanged** — `state`
  comes from the query, and `setState` writes through to the query cache via `setQueryData`, so
  every existing `setState(...)` call in `doSync`/`runAnalysis`/`RescheduleBanner` keeps working and
  Nav/Dashboard/RescheduleBanner needed no changes. `doSync` (the POST that hits Intervals.icu) and
  the deferred `/api/analyze` step stay explicit actions that write results back into the cache.
  Fixes the "stale after an overnight tab" UX. Verified: tsc/build/lint clean, 211 tests, dev server
  boots and Today/Trends render with the new provider wiring. `components/QueryProvider.tsx`,
  `components/SyncProvider.tsx`, `components/Trends.tsx`, `app/layout.tsx`, `package.json`
  (`@tanstack/react-query`). _Deferred:_ `doSync`→`useMutation` + optimistic updates (not needed for
  the win).

## Signal fusion — Athlete State v1 (ROADMAP §5)

- **`computeAthleteState` (the fused glance).** `lib/athlete-state.ts` collapses the parallel signals
  the brain otherwise surfaces (and lets contradict) — TSB, ACWR, execution-trend (EWMA), decoupling
  vs the 90d baseline, RPE recent-vs-baseline, off-plan behaviour — into one **0–100 score** + band
  (`primed/ready/steady/strained/depleted`) + recommendation + `drivers[]` + confidence. Built as a
  **list of signal evaluators** (add energy-availability later = one evaluator); score = base + Σ
  effects, clamped, then a **lived-signal override** (≥2 of execution-down / decoupling-up / RPE-up
  cap the score even when TSB looks fresh — corroborated fatigue beats a fresh load model). All
  weights/thresholds are named constants in one block (foundations — built to be tuned). Deterministic;
  the AI only phrases the headline. 8 directional tests (not pinned to exact numbers). Design spec:
  `docs/specs/athlete-state.md`.
- **Surfaced + consumed (all three).** `AthleteStateCard` on Today — the 0–100 score is the glance,
  band + drivers reveal on hover (above the individual signals, not replacing them). Computed in the
  `/api/sync` GET **and** POST (so it refreshes after a sync), carried on `AppState.athleteState`.
  Folded into **generation** (a fused-state directive line) and **Ask-Coach** (context), both via the
  pure `athleteStateInputsFrom` adapter. `lib/athlete-state.ts`, `app/api/sync/route.ts`,
  `app/api/generate/route.ts`, `app/api/ask/route.ts`, `lib/anthropic-api.ts`,
  `components/AthleteStateCard.tsx`, `components/SyncProvider.tsx`, `components/Dashboard.tsx`,
  `lib/types.ts`. (v1 foundations; tuning + energy-availability + per-athlete weights remain — ROADMAP §5.)

## Metric-consistency + Today/Trends UX (feedback batch)

A batch of real-use feedback, routed through todo.md (MR/UX/RC) and cleared:
- **MR-1 — IF basis consistency.** The coach-note prompt (`analyseRide`) computed IF from *avg*
  watts while the Today card + `score-log` use NP (`normalizedPower ?? avgWatts`). Made the note
  NP-based too (and ftp>0-guarded), so the note's IF can't disagree with the card; fixed the stale
  `// avg watts / FTP` comment on `TodayAnalysis.intensityFactor`. (NP was already synced from
  `icu_normalized_power`.) `lib/anthropic-api.ts`, `lib/types.ts`.
- **MR-2 — Weekly-hours window.** Recent-Baselines "Weekly hours" was an all-logged-window mean
  while its sibling tiles are 90-day rolling. Added `avgWeeklyHours90d` to `RollingBaselines`
  (computed in `computeRollingBaselines` as total hours ÷ 90/7 over the same 90d window); the card
  now reads it, so all four tiles share one horizon. Populates on the next sync. `lib/readiness.ts`,
  `lib/types.ts`, `lib/data-store.ts`, `components/Trends.tsx`.
- **RC-1 — Avg speed on the Today ride card.** Threaded `activityDistanceMeters` onto `TodayAnalysis`
  (sync route) and added an "Avg speed" tile (distance ÷ moving time). Populates on the next sync.
  `lib/types.ts`, `app/api/sync/route.ts`, `components/Dashboard.tsx`.
- **UX-1 — Power bar horizontal overflow.** `ZoneBars` segments had `shrink-0` + `gap-px`, so widths
  summed past 100% and the bar overflowed on narrow cards. Switched to `min-w-0` (let flex absorb the
  gap). `components/Dashboard.tsx`.
- **UX-2 — Trend-pulse "Weekly volume" tile dead-end.** The tile pushed to /trends, which had no
  weekly-volume view. Added a "Weekly volume" card (`WeeklyVolumeBars` over the existing
  `data.weeklyHours`) so the click lands somewhere. `components/Trends.tsx`.
- **UX-3 — Execution-quality card compression + hover.** `ScoreBars` (capped at 24) used
  `min-w-[4px]` + `gap-[3px]` (~165px min → overflowed narrow cards); reduced to `min-w-[2px]` +
  `gap-px` (~71px) and added a `hover:opacity` affordance on top of the existing per-bar title.
  `components/Trends.tsx`.

## Foundations & earlier milestones

- **Timezone-correct "today" (code-audit fix).** The server matched today's ride on a UTC date
  while activities carry their *local* date, so an evening ride could be missed entirely (no
  analysis/PR). `lib/date.ts` now makes the client's local date the single source of "today"
  (client sends it; server prefers it, UTC fallback). No date-fns dep.
- **Disposition flag + learning gate.** Athlete marks Completed / Partial / Compromised(reason);
  compromised rides stay as history but are excluded from the execution EWMA + metric and surfaced
  to Ask-Coach, so a fluke can't be misread as under-recovery. `data/dispositions.json`
- **Auto-reschedule engine.** `lib/reschedule.ts` + `/api/reschedule` + RescheduleBanner detects a
  not-delivered quality session and suggests/applies a make-up on the next clear rest day in the
  local block (no back-to-back hard days), athlete-confirmed.
- **UI refinements (audit images 1–5).** Readiness card trimmed to TSB/ACWR/Polarization; Trend
  Pulse reworked to CTL + weekly-volume + time-in-zone bars; Trends compacted to a 2-col pair;
  Profile modernized to match the other pages.
- **Calibration v1.** Auto-tuned EWMA α + ACWR bands with a manual override (`lib/calibration.ts`).
- **Synthesis.** One ranked coaching-directive block fed to generation; dropped redundant
  `compliance-memory`.
- **Closed learning loop.** All rides scored into the immutable ledger; interventions snapshotted
  at block-write and later validated/refuted.
- **Atomic writes + ledger backup/recovery** (`lib/json-store.ts`).
- **Compliance unified** into the execution/completion index; duration-aware interval scoring;
  time-in-zone polarization; physiology single-source-of-truth; Ask-Coach (block + form context).
