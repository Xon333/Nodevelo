# On-plan Z2/Recovery aerobic-baseline merge + diagnostic insight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Planned Z2/Recovery rides currently only get graded against a single-ride HR-ceiling breach (`aerobicDisciplineRead`). They never get compared to the athlete's own 90-day aerobic baseline (`aerobicEffPct`, `lib/aerobic.ts`) — that machinery is wired for off-plan rides and the Today athlete-state driver only. Merge the two into one non-double-counting read for on-plan Z2/Recovery scoring, stamp the inputs onto the ledger for provenance, and rewrite the generic "ease the Z2 prescription" insight into a diagnostic one that names the real pattern this athlete's data shows (indoor Z2 dialed in; some outdoor rides run hot) instead of prescribing a blanket volume cut.

**Origin:** athlete-flagged discrepancy between the retrospective's `complianceByType.Z2 = 107%` (pure duration ratio) and the coaching insight "Z2 is a weak point, 5.4/10" (HR-ceiling-driven execution score) — verified against real ledger data (`data/score-log.json` + `data/last-sync.json`, 2026-06 block): all 4 indoor VirtualRide Z2 sessions score 9–10 at 0–1.5% HR time above the aerobic ceiling; outdoor rides split bimodally (controlled: 1.3–8.7% above ceiling, score 8–10; ran hot: 17.7–34.1% above ceiling, score 1–6). Fatigue-cost tracking (CTL/ATL/TSB/ACWR) already reads real Intervals.icu `trainingLoad`, so "ran hot" rides already cost more load (measured ~0.73–0.84 TSS/min controlled vs ~1.03–1.15 TSS/min ran-hot) — no code change needed there, only narration.

**Architecture — the merge decision:** Mechanism A (`aerobicDisciplineRead`, within-ride HR-ceiling breach, −4 "ran hot" guardrail) and Mechanism B (`aerobicEffPct`, cross-ride Pw:HR vs the athlete's own 90-day baseline) share one physiological cause observed at two granularities. They resolve to **one merged read, never two stacked penalties**: A is the primary judge (its "hot" already carries the full guardrail — B adds nothing there, or it double-counts the same failure). B only *withholds* a bonus or *deepens* a penalty on-plan (never adds a new bonus, protecting the documented zero-margin "−4 clears the +4 stack" invariant). B's strong band (≤ −6%, i.e. ≤ −2×`AEROBIC_DEADBAND_PCT`) corroborates; the weak band (−3…−6%) only acts when B is the *sole* judge (no HR-zone data). See the merged table in Task 1.

**Tech Stack:** TypeScript 5, Vitest (`npm test` → `vitest run`), Next.js 16 App Router, React 19, local JSON filesystem (no DB).

## Global Constraints

- **Run tests with `npm test`.** Unit tests sit next to source in `lib/` as `*.test.ts`.
- **No new dependencies.** Pure arithmetic on already-synced data.
- **Determinism:** every changed function stays pure (no `Date.now()`, no IO). Same inputs → same output.
- **No double-counting:** a ride that trips the HR-ceiling "hot" read must score identically whether or not `aerobicEffPct` is also present/negative — pin this as an explicit regression test.
- **No new bonus from `aerobicEffPct` on-plan.** It can only withhold the existing +1 or deepen a penalty. This preserves the existing guardrail sizing (`lib/execution-score.ts` lines ~167–176) without re-deriving it.
- **Sparse/optional fields only** — every new stamp/field is optional and absent on rides it doesn't apply to (durability templates B–E, off-plan, non-Z2/Recovery, pre-feature ledger entries). Follow the existing `fuel`/`intervals`/`calStampFor` provenance pattern in `lib/score-log.ts` verbatim — don't invent a new convention.
- **Migration flags:** any new stamp presence must be checked with a truthy guard, never `=== null` (pre-existing entries parse back as `undefined`, not `null` — see AGENTS.md).
- **Do not touch:** `app/api/retrospective/route.ts`'s `complianceByType` (intentionally a different, duration-only axis) or `lib/readiness.ts`/the load pipeline (already correct — TSS already reflects real intensity).
- **LLM-adjacent changes need a live smoke run, not just unit tests** (AGENTS.md hard rule) — Task 6 (insight → generation directive) and Task 5 (ride-note discipline line) both touch LLM prompt inputs.

## Resolved judgment calls (flagged by the design pass, decided here — see rationale inline in each task)

1. **Hollow-dialed** (HR dialed in, but `aerobicEffPct ≤ −6%`) → bonus withheld (score stays neutral), not penalized. A flaky Pw:HR reading (heat, hydration, caffeine) shouldn't cost points on a ride where the HR-ceiling discipline itself was clean.
2. **Corroborated-drift penalty** → **−2** (not −3), keeping the new "drift + bad baseline" ceiling at 7/10 — a deliberate step between the existing 0 (plain drift) and −4 (hot), not a second cliff.
3. **No-HR-data fallback** → `aerobicEffPct` becomes the *sole* judge, using the exact off-plan bands (penalty-only, no bonus) — rare path (needs `icu_power_hr_z2` present while `hrZoneTimes` is unusable), but keeps a ride from escaping all judgment just because HR-zone buckets are missing.
4. **Z1-drift (undershoot)** → no new explicit IF-undershoot branch. A fatigue-driven fade (HR stays relatively elevated at low power) is already caught by the hollow-dialed/drift bands once ≥15 min of Z2-isolated data qualifies (`AEROBIC_MIN_Z2_MINS`); a total-fade ride with genuinely low HR is just an easy day and already forfeits the IF-band +1. Re-litigating power-based undershoot penalties would reverse the 2026-07-10/11 rework's deliberate "HR is the sole too-hard judge" decision. Chronic intensity under-delivery has its own surface (`lib/plan-vs-actual.ts`, ROADMAP #4) — not this axis.

If any of these read wrong once you see it against real data (Task 8's rebuild), they're single-constant changes, not redesigns — flag it and we'll adjust.

---

## File Structure

- `lib/execution-score.ts` — **modify.** Extract a pure `mergedEasyRead()` helper; replace the HR-only judge block with the merged table; update guardrail comments + `ExecutionScoreInput` doc.
- `lib/execution-score.test.ts` — **modify.** New cases for the merged table, the no-stacking regression, and updated boundary tests.
- `lib/types.ts` — **modify.** Add sparse `easy` stamp to `RideScoreEntry`; add sparse `aerobicEffPct` to `TodayAnalysis`; add `easy` diagnostics to `AthleteTypeStat`.
- `lib/score-log.ts` — **modify.** Compute `aerobicEffPct` once per ride (hoisted above the planned/off-plan split); pass into `computeExecutionScore` for planned rides; add `easyStampFor()` gated identically to the scorer.
- `lib/score-log.test.ts` — **modify.** Stamp presence/absence cases.
- `app/api/sync/route.ts` — **modify.** Today-patch path stamps `easy` too, from the same re-bucketed HR data `buildTodayAnalysis` already uses (prevents the frozen score and its stamp disagreeing).
- `lib/ride-analysis.ts` — **modify.** Stale doc comments only (no logic change — `aerobicEffPct` already flows in); `TodayAnalysis.aerobicEffPct` set alongside `aerobicDiscipline`.
- `lib/anthropic-prompts.ts` — **modify.** `RideAnalysisInput` gains optional `aerobicEffPct`; `disciplineLine` appends an efficiency clause; "hot" label gains the fatigue-cost sentence.
- `lib/coach-snapshot.ts` — **modify.** `today.execution` carries the same optional eff figure through to the Ask-Coach SITUATION line.
- `lib/athlete-model.ts` — **modify.** `AthleteTypeStat.easy` diagnostics aggregation; `deriveInsights` gains the bimodal-pattern branch ahead of the existing generic chain.
- `lib/athlete-model.test.ts` — **modify.** Bimodal fixture, split-insight assertions, generic-fallback-still-works case.
- `lib/anthropic-prompts.test.ts`, `lib/coach-snapshot.test.ts`, `lib/ride-analysis.test.ts` — **modify.** New optional-field render/omit cases.

---

### Task 1: Merged easy-ride read — `lib/execution-score.ts`

**Files:**
- Modify: `lib/execution-score.ts` (the HR-judge block, currently ~lines 180–190; the `ExecutionScoreInput.aerobicEffPct` doc, ~lines 47–51; the guardrail comment, ~lines 167–176)
- Test: `lib/execution-score.test.ts`

**Steps:**
- [ ] Extract a pure exported helper, e.g.:
  ```ts
  export function mergedEasyRead(
    aboveAerobicHrFrac: number | null | undefined,
    aerobicEffPct: number | null | undefined
  ): number
  ```
  implementing exactly this table (deadband constant = `AEROBIC_DEADBAND_PCT` from `lib/aerobic.ts`, already imported):

  | HR read (`aerobicDisciplineRead`) | `aerobicEffPct` | Delta |
  |---|---|---|
  | `dialed` | `> −2×deadband` or null | **+1** |
  | `dialed` | `≤ −2×deadband` | **0** |
  | `drift` | `> −2×deadband` or null | **0** |
  | `drift` | `≤ −2×deadband` | **−2** |
  | `hot` | anything (ignored) | **−4** |
  | null (no HR-zone data) | `≤ −2×deadband` → **−2**; `≤ −deadband` → **−1**; else **0** |

- [ ] Replace the current block (`if (input.aboveAerobicHrFrac != null && !intrinsic && !embedsEfforts && (plannedType === "Z2" || plannedType === "Recovery"))`) — broaden the gate to `(input.aboveAerobicHrFrac != null || input.aerobicEffPct != null) && !intrinsic && !embedsEfforts && (plannedType === "Z2" || plannedType === "Recovery")`, and call `mergedEasyRead(input.aboveAerobicHrFrac, input.aerobicEffPct)`.
- [ ] Update the guardrail comment to state the new invariants:
  - Hot guardrail unchanged: `5 + 2 (duration) + 1 (IF-band) + 1 (VI) − 4 = 5`; RPE-substitution path unchanged.
  - New: corroborated-drift ceiling `5 + 4 (max stack) − 2 = 7` — a drift ride with a real baseline deficit can be "Good" at best, never "Excellent".
  - No-stacking rule stated explicitly: hot + any eff value scores identically to hot + eff null.
- [ ] Update `ExecutionScoreInput.aerobicEffPct` doc (~line 47–51) — it's no longer "off-plan only"; note it now also feeds the on-plan merged read via `mergedEasyRead`.
- [ ] Leave the off-plan block (`intrinsic && input.aerobicEffPct != null`, ~lines 203–215) and the Z2 IF-band case (~lines 124–130) untouched.
- [ ] Tests (add to the "easy-ride execution" describe block):
  - [ ] No-stacking regression: `hot` + `eff = −10` produces the same score as `hot` + `eff = null`.
  - [ ] Zero-margin boundaries: `drift` + `eff = −6.0` → −2; `drift` + `eff = −5.9` → 0; `dialed` + `eff = −6.0` → 0; `dialed` + `eff = −5.9` → +1.
  - [ ] Corroborated-drift ceiling: max positive stack (duration ≥95%, in-band IF, VI ≤1.06) + `drift` + `eff ≤ −6` → exactly 7.
  - [ ] Null-HR fallback: `hrFrac = null`, `eff = −6/−3.0/−2.9` → −2/−1/0; `eff = +10` → no bonus (penalty-only path).
  - [ ] Inert on non-easy types: planned `Threshold` + `eff` → no effect. Inert on `intrinsic` (off-plan keeps its own ±2 axis, unchanged). Inert on durability templates B–E (`embedsEfforts`).
  - [ ] Update the existing "ignores the aerobic read on a planned ride" test (~line 30) — its intent narrows to planned *non-easy* types; the two pre-existing zero-margin guardrail tests (~lines 452–464) must still pass unmodified.

---

### Task 2: Ledger provenance stamp — `lib/types.ts`, `lib/score-log.ts`

**Files:**
- Modify: `lib/types.ts` (`RideScoreEntry`, ~line 519)
- Modify: `lib/score-log.ts` (`buildRideScores`, planned branch ~line 165, off-plan branch ~line 228)
- Test: `lib/score-log.test.ts`

**Why stamp on the ledger, not join at read time:** matches the established `fuel`/`intervals`/`calStampFor` provenance pattern; the ledger (~400 entries, ~6 months) and the sync window (`SYNC_WINDOW_DAYS = 182`) don't fully overlap, so a read-time join would silently lose the oldest slice; a second, independent re-derivation of the HR read + gates is exactly the drift class the 2026-07-11 "Coach-prompt aerobic-discipline gap closed" fix (ARCHIVE.md) had to clean up after — don't reintroduce it.

**Steps:**
- [ ] Add to `RideScoreEntry`:
  ```ts
  // Easy-ride merged-read provenance (planned Z2/Recovery, non-embeds-efforts only): the inputs
  // behind the merged aerobic execution read, frozen so the score is re-derivable and the athlete
  // model can diagnose indoor/outdoor + ran-hot patterns without re-joining activities. Absent on
  // other types, off-plan rides, durability templates B–E, and pre-feature entries.
  easy?: { indoor: boolean; hrRead?: AerobicDiscipline; aerobicEffPct?: number };
  ```
  (omit `hrRead`/`aerobicEffPct` keys when null; round `aerobicEffPct` to 1 dp.)
- [ ] In `buildRideScores`, hoist the `aerobicEffPct` computation (`aerobicEffPct(act, z2PwHrBaselineBefore(activities, act.date))`) above the planned/off-plan split — the off-plan branch already computes this; compute once, use in both. (O(n²) rebuild cost is pre-accepted per the "ponytail" note in `lib/aerobic.ts`.)
- [ ] Pass `aerobicEffPct` into `computeExecutionScore` for the planned branch too (currently off-plan only).
- [ ] Add an `easyStampFor(...)` helper mirroring `calStampFor`/`fuelStampFor`: returns the `easy` stamp only when `planned.type` is Z2/Recovery **and** `!EXPECTS_EMBEDDED_EFFORTS.has(planned.durabilityTemplate ?? "")` — gated identically to the scorer, so stamp presence implies the merged read applied. `indoor = act.type === "VirtualRide"`.
- [ ] Spread the stamp into the planned entry.
- [ ] Tests: planned Z2 with outdoor baseline history → `easy` stamp present with expected `hrRead`/`aerobicEffPct`; Threshold/off-plan/durability-templates-B–E → stamp absent; VirtualRide → `indoor: true`, `aerobicEffPct` key absent (fails `qualifyingPwHr`'s outdoor-only gate); rebuild (`rebuildLedger`) carries the stamp on re-derived entries.

---

### Task 3: Today-patch consistency — `app/api/sync/route.ts`

**Files:**
- Modify: `app/api/sync/route.ts` (today-patch block, ~lines 665–700)

**Why:** `buildTodayAnalysis`'s `hrZoneTimes` are re-bucketed from raw streams (~lines 564–579) and can differ from the `act.hrZoneTimes` the ledger stamp used in Task 2 — without this, today's frozen score and its frozen `easy` stamp could disagree (the exact drift-class bug the 2026-07-11 fix addressed for a different surface).

**Steps:**
- [ ] Add `...easyStampFor(...)` to the today-patch, built from the today-path inputs: re-bucketed `hrZoneTimes` → `timeAboveAerobicHrFraction` → HR read, plus the `aerobicEffPct` already computed at ~line 630. Gate identically (`plannedDay?.type` Z2/Recovery, not an embeds-efforts template).
- [ ] Test: sync's today-patch stamps `easy` consistently with what a full rebuild would produce for the same ride.

---

### Task 4: `TodayAnalysis` + doc cleanup — `lib/ride-analysis.ts`, `lib/types.ts`

**Files:**
- Modify: `lib/ride-analysis.ts` (stale doc comments only, ~lines 82–84, 136)
- Modify: `lib/types.ts` (`TodayAnalysis`, ~line 774, next to `aerobicDiscipline`)
- Test: `lib/ride-analysis.test.ts`

**Steps:**
- [ ] Add sparse `aerobicEffPct?: number | null` to `TodayAnalysis`, set only when the merged read applied (same gate as `aerobicDiscipline`, ~lines 155–159). No scoring logic changes here — `buildTodayAnalysis` already passes `aerobicEffPct` into scoring unconditionally; the new on-plan path in Task 1 engages automatically.
- [ ] Update the stale comments describing the HR read as the sole judge for easy rides.
- [ ] Test: on-plan Z2 today with an efficiency deficit → merged read applied, `aerobicEffPct` set; off-plan/durability-B–E today → `aerobicEffPct` absent.

---

### Task 5: Narrate the read — `lib/anthropic-prompts.ts`, `lib/coach-snapshot.ts`

**Files:**
- Modify: `lib/anthropic-prompts.ts` (`RideAnalysisInput` ~line 345, `disciplineLine`/`disciplineLabel` ~lines 444–446)
- Modify: `lib/coach-snapshot.ts` (`today.execution` type ~line 56, build ~line 254, format ~lines 379–383)
- Test: `lib/anthropic-prompts.test.ts`, `lib/coach-snapshot.test.ts`

**Steps:**
- [ ] Add optional `aerobicEffPct` to `RideAnalysisInput`; wire it from the stored `TodayAnalysis` field (Task 4) in `buildRideAnalysisInput`.
- [ ] Extend `disciplineLine` to append `· aerobic efficiency ${x}% below your 90-day baseline` when `aerobicEffPct ≤ −3%` (the weak-band deadband, matching the off-plan axis's own threshold).
- [ ] Extend the "hot" discipline label with a fatigue-cost sentence: the ride's actual training load (not the plan's) is what the fatigue model reads, so a ran-hot ride's extra cost is already counted against freshness — narration only, references no new computation (per Part 4 of the design: don't build a new subsystem for this, `lib/readiness.ts` is untouched).
- [ ] Extend `coach-snapshot.ts`'s `today.execution` with the same optional eff figure so the Ask-Coach SITUATION line doesn't call a −2-scored corroborated-drift ride merely "some drift" with no further detail.
- [ ] Tests: discipline line renders the efficiency clause when present, omits it when absent; coach-snapshot execution line likewise.

---

### Task 6: Diagnostic insight — `lib/athlete-model.ts`

**Files:**
- Modify: `lib/athlete-model.ts` (`AthleteTypeStat` origin ~`buildAthleteModel`, `deriveInsights` ~lines 103–147)
- Modify: `lib/types.ts` (`AthleteTypeStat`, ~line 549)
- Test: `lib/athlete-model.test.ts`

**Steps:**
- [ ] Add to `AthleteTypeStat` (Z2/Recovery only; computed from the same `planned && !compromised` entry set the exec EWMA already uses, reading each entry's `easy` stamp from Task 2):
  ```ts
  easy?: {
    reads: number;
    indoorN: number; outdoorN: number;
    indoorExecAvg: number | null; outdoorExecAvg: number | null; // round1, null under 2 samples
    outdoorHotN: number; // hrRead === "hot"
    hotTssPerMin: number | null; controlledTssPerMin: number | null; // round2, ≥2 samples each
  }
  ```
  `hotTssPerMin`/`controlledTssPerMin` come from each entry's existing `tss`/`durationMin` fields, split by `hrRead === "hot"` vs not — this produces the real "blown-up rides cost ~X% more load per minute" figure from data already on the ledger, no new computation elsewhere.
- [ ] In `deriveInsights`, inside the per-type loop, add a bimodal-pattern check **before** the existing `execEwma < 5.5` branch, gated on:
  - `easy.outdoorHotN >= 2 && easy.outdoorN >= 3 && easy.reads >= MIN_OBSERVATIONS`
  - AND a "rest is healthy" condition: `indoorExecAvg >= 7` (with `indoorN >= 2`) OR the non-hot outdoor average ≥ 7.
  - Severity: `alert` if `execEwma < 5.5` (matches existing threshold), else `watch`.
  - Title: `"${type} splits indoor vs outdoor"`.
  - Evidence: names the split explicitly — e.g. `Execution ${execEwma}/10 across ${n} sessions — but split: indoor ${indoorExecAvg}/10 (${indoorN} rides), while ${outdoorHotN} of ${outdoorN} outdoor rides ran hot (HR above the aerobic ceiling for >25% of the ride).`
  - Suggestion: names the real fix and the fatigue-cost fact — e.g. `Not a case for easing the ${type} target — the hot outdoor days are the problem: flatter routes or capped effort on climbs. Those rides already cost extra (~${premiumPct}% more training load per minute), which your fatigue tracking absorbs automatically.` (premium clause only when both `hotTssPerMin`/`controlledTssPerMin` exist.)
  - Falls through to the existing generic chain untouched when stamps are absent/thin (pre-rebuild ledger, new athlete, or the pattern gate doesn't fire) — byte-identical to today's behavior in that case.
- [ ] No changes needed in `lib/synthesis.ts` (plain `Insight[]` passthrough) or `lib/intervention.ts` (keys on `dimension`, not `title`) — verify both still compile/pass unchanged.
- [ ] No UI changes needed — `components/StandingGuidance.tsx`, `components/Trends.tsx`, `components/trends/verdict.tsx` all render `title`/`evidence`/`suggestion` generically.
- [ ] Tests: bimodal fixture (mirroring the real June data — 4 indoor at 9–10, controlled + hot outdoor mix) fires the split insight at the right severity; generic fallback still fires when stamps are absent or the pattern gate doesn't clear; TSS-premium clause appears/is omitted correctly based on sample counts; `MIN_OBSERVATIONS` floor still respected.

---

### Task 7: Docs

**Files:**
- Modify: `ROADMAP.md` / `FEATURES.md` scoring-core section (remove/resolve the now-closed "Z2 discipline is terrain-blunt" gap if listed; note the new merge)
- New: ARCHIVE.md entry once shipped, following the existing "HR-judged easy-ride discipline" entry's format/detail level as precedent

**Steps:**
- [ ] Update ROADMAP scoring-core gaps section.
- [ ] Write the ARCHIVE.md entry after Task 8 verification passes (timing: lead session's call).

---

### Task 8: Verification and migration

**Steps:**
- [ ] `npm test` green.
- [ ] **Live LLM smoke runs (required, not optional — AGENTS.md):**
  - [ ] Run one real block generation (or the `/api/ask` snapshot path) and read the actual output — confirms the reworked insight reaches the generation directive block correctly.
  - [ ] Regenerate a real ride note via `/api/analyze` for a known hot Z2 day — confirms the new discipline-line clause renders correctly against the live API, not just a mocked test.
- [ ] **Ledger rebuild:** `POST /api/sync` with `{"rebuildLedger": true, "force": true}` — `force` is required since the one-shot rebuild marker was already consumed by the 2026-07-11 HR-judged rework. This re-scores and stamps all in-window entries (the 182-day sync window covers essentially the full ~400-entry ledger).
- [ ] Spot-check known dates post-rebuild against the background data gathered in this investigation: the 17.7–25%-above-ceiling rides are where scores should move (0 → possibly −2 if `aerobicEffPct` also corroborates); the >25% ("hot") rides stay unchanged (≤5, guardrail already applied); indoor and clean outdoor rides stay byte-identical.
- [ ] **Stale-consumer sweep** (repeat of the check that closed the 2026-07-11 gap — confirm every consumer of the old on-plan Z2 HR-only logic was updated, not just `computeExecutionScore` itself): `computeExecutionScore` ✓ (Task 1), `score-log.ts` planned branch ✓ (Task 2), sync today-patch stamp ✓ (Task 3), `ride-analysis.ts`/`TodayAnalysis` ✓ (Task 4), `coach-snapshot.ts` execution line ✓ (Task 5), `anthropic-prompts.ts` discipline line ✓ (Task 5), `athlete-model.ts` ✓ (Task 6); explicitly confirm `synthesis.ts` (passthrough, unchanged), `intervention.ts` (dimension-keyed, unchanged), the three Insight-rendering UI components (text passthrough, unchanged), `app/api/retrospective/route.ts` `complianceByType`, and `lib/readiness.ts` remain untouched as intended.
