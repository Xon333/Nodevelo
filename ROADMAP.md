# NodeVelo roadmap

The **forward backlog** — unfinished / deferred work, ordered roughly by leverage. The goal
everything is measured against: **be a coaching *layer* that fuses signals into one coherent,
self-correcting athlete model — not a re-skin of Intervals.icu.**

Companion docs: live bugs → [todo.md](todo.md) · shipped work → [ARCHIVE.md](ARCHIVE.md) ·
exploratory spikes → [research.md](research.md) · how it all works → [README.md](README.md).

**How this list is organised:** **Next up** = the immediate, mostly self-contained moves, in
priority order. **Feature tracks** = the larger multi-session ⭐ features, clustered by the
machinery they share (so the "build the two together" overlaps are explicit). Done work lives in
[ARCHIVE.md](ARCHIVE.md); only the *remaining slivers* of shipped items appear here.

---

## Next up (prioritized)

> **✅ Hardening gate cleared.** The pre-feature self-review pass (`CR-1..16`, full record in
> [ARCHIVE.md](ARCHIVE.md)) is done — the features below are unblocked.

### 1. CoachSnapshot + Ask-Coach context (the "objective telemetry lens")  ⭐ — foundations SHIPPED
Foundations shipped — full record in [ARCHIVE.md](ARCHIVE.md). `lib/coach-snapshot.ts` hands Ask-Coach
+ generation one deterministic resolved-numbers snapshot (execution · form+TSB-modifier · fuel · state ·
directives · disposition · morning check) so the LLM can't invent figures.

**Remaining (foundations left extensible — these wire in without reshaping the type):**
- **`fuel.intakeVsNeed` + `fuel.fuelingState` are reserved (`null`)** — populate when **Track C / §6**
  land (no intake logging yet; needs the fueling engine + the energy-availability evaluator).
- **`form.tsbModifier` band edges are population defaults** (`resolveTsbModifier`) — make per-athlete
  via **#2** (the TSB adaptation window parameter). The modifier text is deterministic; only the edges
  need calibrating.
- **Also surface on Today — SHIPPED.** `buildCoachSnapshotFromSources` (`lib/coach-snapshot.ts`) is the
  one shared assembler the sync GET and `/api/ask` both call, so the Today card shows the *identical*
  snapshot the LLM reads (no drift). `coachSnapshot` rides on `AppState` (GET takes `?today=`; POST
  rebuilds it on fresh data) and `CoachSnapshotCard` renders the resolved form (TSB-as-actionable-
  modifier) + fuel on Today. Full record in [ARCHIVE.md](ARCHIVE.md).

**TSB-as-actionable-modifier (SHIPPED v1):** `resolveTsbModifier` resolves TSB against today's
prescription (e.g. *"Form −12: today's VO2 still adapts, but drop a rep if RPE > 8"*) — population band
edges, per-athlete calibration via #2. The LLM phrases it; the band + decision stay deterministic.

> **⚠️ Ask-Coach anti-pattern (from a real test — now guarded by the snapshot's `disposition` line, which Ask-Coach reads; kept as the regression spec).**
> Prompt: *"should I stay on plan tomorrow although I only managed 41% of the prescribed intervals?"*
> A response like *"No — skip tomorrow, you're under-recovered or under-fuelled (execution 1/10)…"*
> is **wrong**: it hallucinates a physiological cause and prescribes a skip from a single low
> session — when in this case the 41% was caused by **equipment failure** (ghost resistance), not
> fatigue. **Correct behaviour:** the coach must read the session's `disposition` before
> diagnosing. If `compromised: equipment` → say so ("that session doesn't reflect your form —
> equipment skewed it; tomorrow stands, just refuel normally"), don't infer recovery debt. Never
> confidently diagnose under-recovery/under-fuelling or prescribe a skip off one compromised data
> point. Ask/condition, don't assert. (Threading `disposition` into the snapshot is what closes this.)

### 2. Per-athlete calibration framework  ⭐ (the keystone — several tracks derive params into it)
The execution score (`lib/execution-score.ts`) still uses **population magic numbers**:
- Per-type intensity-appropriateness IF bands (e.g. Z2 rewards IF 0.60–0.74, Threshold 0.82–0.92).
- Decoupling bands (`< 2%` great … `> 10%` poor) and the ± weightings.

Make them personal via `lib/calibration.ts` (the hybrid auto + manual pattern used for α / ACWR):
- **IF bands → derive from `physiology.json` power zones** (the athlete's %FTP zone edges *are*
  their personal IF cutoffs).
- **Decoupling "good" threshold → from `rolling-baselines.avgDecoupling90d`**, not a fixed 4%.
- Extend `AthleteCalibration` (`decouplingGood` + per-type IF bands); thread into `computeExecutionScore`.
- **Caution:** touches the frozen scoring core. Immutable ledger means changes only affect *new*
  entries. Needs careful tests + a manual-override hook; auto-derive with population fallback.

**Generalise into one calibration framework (absorbs the external "per-athlete threshold learning"
spec + the confidence-weighted-modeling sub-item below).** Today `lib/calibration.ts` only holds α +
ACWR bands. Promote it to a uniform per-parameter record so every learned value carries its own
provenance and a guard against chasing noise:
`{ current_value, confidence (sample-size/variance), data_points_count, last_updated, lock_threshold,
manual_override? }` — auto-derive once enough data, then **lock** and require manual override.
Parameters to bring under it: **per-type IF cutoffs** (from `physiology.json` zones — the power-curve
read is shared with Track A), **decoupling / Pw:HR "good" threshold** (from `avgDecoupling90d`),
**ACWR band** (narrow if load-tolerant, widen if fragile), **EWMA α / fitness-decay rate** (lengthen
if the athlete retains fitness, shorten if rapid decay), **TSB adaptation window** (the range that
actually produced adaptation — consumed by #1), and **optimal carbs g/h per ride type** (owned by
Track C). The `confidence` + `lock_threshold` layer is the additive uncertainty model the
second-brain item (Track D) also calls for — build it once here, not twice.

**Population magic-numbers added by recent features (CR-11) — fold these in too, don't keep scattering
more:** the morning-check **strain bands** (`STRAIN_HIGH=15`, `STRAIN_MED=12`) + **TSB-deep cutoff**
(`-25`) in `lib/morning-check.ts`; the **TSB-modifier band edges** in `lib/coach-snapshot.ts`
(`resolveTsbModifier`); the **durability limiter→template map** + the **embedded-intensity floor**
(`88%`, `lib/prescription.ts`/`lib/durability.ts`); and the **durability-insert envelope** (`≤122%`,
`≤20 min`, `lib/workout-validate.ts`). All are uncalibrated population defaults today — each new
deterministic feature adds a few, so #2 should absorb them rather than let them drift per-module.

**Two execution-accuracy gaps surfaced in real use (route here — they touch the scoring core):**
- **Z2 "dialed-in" is overstated.** Z2 execution scores on avg IF + decoupling, *not time above
  zone* — so a long Z2 ride with efforts above Z2 still scores well and the coach note says "Z2
  dialed in / execution improved." Add a deterministic **Z2-discipline signal** (% time above the Z2
  cap, from the already-synced `powerZoneTimes`) into the execution score + the CoachSnapshot, so the
  coach grades on actual zone adherence and stops inflating it (AI-containment: phrase the number,
  don't overstate it). Ties to §5 fusion + #1.
- **Power-zone source of truth.** Zones come from Intervals.icu sport-settings (`lib/physiology.ts`,
  effective-dated + reconciled) — there's no sanctioned *local* tweak, so a hand-edited Z2 would be
  reconciled away on the next sync. **Decide:** keep zones strictly Intervals.icu (consistent — do
  any tweak there) vs. add a sanctioned per-athlete override living in this calibration framework
  with override semantics. Lean strict-consistency unless there's a real reason to diverge.

### 3. Proactive reschedule — "not feeling it?" morning check-in  ⭐ — SHIPPED
Full record in [ARCHIVE.md](ARCHIVE.md). `MorningCheckIn` on Today (rank-1 readiness zone, shown before a quality session is ridden) →
standardised chips (fatigue / sleep / soreness / motivation 1–5 + illness none/mild/sick) → a
**deterministic** decision (`lib/morning-check.ts decideMorningCheck`: subjective strain + objective
TSB/readiness/ACWR) → "proceed" or "downgrade + reschedule". Apply (athlete-confirmed) downgrades today
to recovery and moves the quality stimulus to the next rest day (a deload — today becomes a short
recovery spin, the rest day takes the quality), **else a load-preserving swap with the next easy day**
(the two days trade) — `suggestProactiveReschedule` / `applyProactiveReschedule` in `lib/reschedule.ts`.
Stored in `morning-check.json`; today's check also feeds the **CoachSnapshot** (Ask-Coach reads it). No
AI in the decision — it only phrases the result.
- **Also shipped the §3 "wider target slots" sliver** (rest *or* easy-day targeting via a shared
  slot-finder) for the proactive path; the reactive `RescheduleBanner` stays rest-only (can adopt it).
- **Remaining:** decision **thresholds are population defaults** (`STRAIN_HIGH`/`STRAIN_MED`, TSB −25) —
  make per-athlete via **#2**. Local-block only; the Intervals.icu calendar move stays manual (bundle
  with §7 bidirectional sync), same as the reactive reschedule.

### 4. Let the validation loop accrue, then auto-down-weight
`intervention-log.json` records verdicts after a 28-day horizon but has none yet. Once data exists,
make a low hit-rate in `lib/synthesis.ts` actually **demote** that directive (today it only
annotates). Revisit ~4 weeks after the next block is written.
- **Prescription-accuracy → re-test flag (from the external spec; decision: flag-only).** Beyond
  demoting *directives*, surface planned-vs-actual per session type on the Plan page and act on a
  consistent gap — e.g. *"3 of your last 4 threshold sessions landed below prescribed power."* The
  response is to **flag it and recommend an FTP re-test in Intervals.icu** — never write FTP locally;
  `physiology.json` stays the synced zone SoT and the next sync carries any new FTP in. (Chosen over
  an "effective FTP" shadow or a confirmed local override, to keep one source of truth.) Ties to the
  durability-template scoring loop (Track B) and #2 calibration.

### Remaining slivers from shipped work
The bulk of these shipped — full records in [ARCHIVE.md](ARCHIVE.md). Only what's left is tracked here.

- **Adaptive logic (§3 — DONE).** Disposition flag + learning gate and the auto-reschedule engine
  (`lib/reschedule.ts` + `/api/reschedule` + RescheduleBanner) both shipped. Remaining:
  - The reschedule rewrites the **local** block only — it doesn't move the event on the
    **Intervals.icu calendar** (needs the event-mutation API; bundle with §7 bidirectional sync).
    The banner currently tells the athlete to mirror the move manually.
  - **Possible follow-up:** a *proactive* sickness/fatigue path (downgrade today + reschedule before
    the session is even missed, on a `fatigueAlert`) — overlaps with #3's morning check-in.
  - **Wider target slots — DONE for the proactive path (#3):** `findMakeUpSlot` in `lib/reschedule.ts`
    now lands a make-up on a rest day (a deload) *or* an **easy endurance day** (Z2/Recovery) via a
    load-preserving swap, with the no-back-to-back-hard-days guard. Remaining: let the **reactive** `suggestReschedule`
    use the same finder (it's still rest-only).
- **Signal fusion → one coherent athlete state (§5 — v1 foundations SHIPPED).**
  `lib/athlete-state.ts computeAthleteState` fuses TSB/ACWR + execution/decoupling/RPE + behaviour
  into one 0–100 score (band on hover) + drivers + a lived-signal override; surfaced on Today
  (`AthleteStateCard`) and fed into generation + Ask-Coach. Design:
  [docs/specs/athlete-state.md](docs/specs/athlete-state.md). Remaining (the weights are conservative
  population defaults in one constants block — expect tuning):
  - Add the **energy-availability evaluator** (its hook is left; blocked on the fueling engine — Track C).
  - **Per-athlete calibrated weights** (via #2's framework instead of population defaults).
  - Tune the score→band thresholds + headline phrasing against real use; possible **score-over-time
    trend**. Keep the math in TS; the AI never computes the state.

---

## Feature tracks (larger ⭐ — grouped by shared machinery)

The multi-session features. Each track bundles items that share build machinery, so they're scoped
and built together rather than re-deriving the same foundation twice.

### Track A — Power-curve intelligence  ⭐ (the proprietary edge)
Translate the raw power curve into structured coaching — the distinct value over Intervals.icu /
TrainerRoad / TrainingPeaks. **Shares the power-profile read with #2's per-athlete IF bands — build
the curve-shape analysis once.**

- **Weak-Point Optimizer & rider-type ID — SHIPPED.** `lib/power-profile.ts` (`analyzePowerProfile`)
  classifies the curve **shape** deterministically: each anchor (5s / 1min / 5min) is taken as a
  multiple of FTP, divided by a population reference multiple → a per-system *relative strength*
  (20 min ≈ FTP is the baseline, so bodyweight cancels — the read works without a weigh-in; W/kg is
  display-only). Rider type = the dominant system (sprinter / puncheur / time-trialist / all-rounder);
  the **"easy win"** = the most-depressed system vs the rider's own engine. Computed **on demand** (no
  persisted store — a trivial pure transform of already-loaded curve + physiology FTP; avoids
  staleness). Surfaced read-only on Profile (`AthleteProfileForm` "Rider profile" card) and injected
  into generation as an auto-derived weak-point **hint alongside** the manual weakpoints
  (`formatPowerProfileForPrompt`, not a replacement). LLM only phrases it.
  - **Remaining:** the population reference multiples are the one magic-number block — fold into #2's
    calibration framework. Also still to do: feed the profile into the **block review / retrospective**
    (the "telemetry-graph ingestion" idea — review reads the curve shape, not just compliance), and
    optionally persist a snapshot if rider-type-over-time is wanted.
- **Plan-cue generalization — SHIPPED.** The hardcoded execution-cue examples (this athlete's
  grey-zone drift / descending-cornering / out-of-saddle) in `buildUserMessage` (`lib/anthropic-api.ts`)
  now state the **principle conditioned on the injected data** — pacing discipline *when* drift is a
  weakpoint, technique practice *only when* a matching weakpoint/easy-win exists, position by effort
  type — so cues derive from this athlete's weakpoints + rider profile/easy-win and generalise to any
  rider. `PROMPT_VERSION` bumped 2→3.

### Track B — Session selection & prescription variety  ⭐ — SHIPPED
Both sub-items shipped (full record in [ARCHIVE.md](ARCHIVE.md)); selection is now deterministic (the LLM only phrases the chosen prescription):

- **Goal-driven session selection — DONE.** `lib/session-requirements.ts deriveSessionRequirements`
  tags the goal + weakpoints (climbing / racing / punchy / gravel); a terrain/race goal injects a
  RaceSim requirement into the prompt and `validateSessionRequirements` warns if the block ships none.
  RaceSim already counts toward the quality budget + spacing (`schedule-validate.ts`), so intervals stay
  primary. (Foundation: PW-3/PW-9 + KB §10/§11.)
- **Durability taxonomy — DONE.** KB **§12** + `lib/durability.ts`: 5 templates (A pure accumulation …
  E mixed density), `selectDurabilityTemplate` picks limiter-driven from `deriveInsights` (Threshold→B,
  VO2max→C, SIT→D, systemic fatigue→A) else rotates from the last block's stamp; the long ride stays
  TYPE Z2 with the intensity placed inside the duration. The chosen template is stamped on the block
  (`durabilityTemplate` on GeneratedPlan/CurrentBlock/BlockHistoryEntry).

**Remaining:**
- **Future per-template scoring loop (compat, not now):** grade each long ride against its template's
  expected signal (did a B raise threshold-under-fatigue vs the prior B?) → a per-template
  prescription-accuracy weight (ties #4 + Track C). The `durabilityTemplate` stamp is in place for it.
- Per-loading-week RaceSim is **prompt-level**; the validator enforces only ≥1/block (loading-vs-recovery
  week detection is fuzzy). Terrain-flexible (KB §11) sessions stay prompt-encouraged — not cleanly
  type-detectable for a deterministic check. Tighten either if real use shows the LLM under-delivering.

### Track C — Fueling intelligence  ⭐ (data already synced)
From the external spec; the highest-value new insight because the inputs already exist (intervals.icu
syncs intra-ride carbs g/h, and `lib/nutrition.ts` already computes pre/in-ride targets). Turn
fueling from a static formula into a learned, per-athlete signal. **The optimal-g/h parameter lives
in #2's calibration framework; the surfacing layer is §6 + the Today nutrition-availability tile +
the Pw:HR×fuel Trends overlay (under UI refinements) — build the derivation once, surface in all three.**

- **Correlation engine.** Per ride type, correlate the synced **carbs g/h** against the outcome
  signals we already compute: **Pw:HR decoupling** (fueling-adequacy proxy), **RPE-vs-IF divergence**
  (high RPE for low IF = under-fuelled), **interval completion rate**, and **next-day TSB**. Over
  successive same-type rides, **converge on the athlete's own optimal g/h** — stored as a calibrated
  parameter in #2's framework (with confidence + lock), not a generic guideline.
- **Contextual post-ride prompts** (deterministic thresholds, LLM phrases): *"65 g/h on a 3 h ride —
  decoupling 8% worse than your best-fuelled 4 h (90 g/h); raise intake next time"* · *"matched your
  best VO2 fuelling (80 g/h) — locking as reference"* · *"40 g/h, below your learned 70 g/h floor for
  >90 min; decoupling confirms it."*
- **Pre-ride loading loop.** Day-before carb bump before long durability (3 h+), scaled by
  duration/intensity (reuse `preRideCarbTarget`); races already use the KB race-nutrition logic
  (§6a — reference, don't rebuild); <90 min quality needs no load (flag over/under-fuelling). Then
  **learn whether loading actually helped** (loaded vs baseline decoupling) — if it doesn't move the
  signal for *this* athlete at *this* duration, stop prescribing it.

This is the concrete build-out of §6 (nutrition energy-balance) — do them as one workstream; §6's
`fuelingState` + the Today "nutrition availability" flag are the surfacing layer for this engine.

### Track D — Second-brain learning upgrades  ⭐ (semantic memory + confidence — additive to the deterministic core)
Make the brain reason about *why*, not just track scalars — **without** surrendering the
deterministic guarantees (the AI only ever writes the language; the math + validation stay in TS).
Shared theme: ride notes (athlete `activityDescription` + `coachNote`) and block outcomes were
generated, shown, then discarded as reasoning — these turn them into durable, queryable memory.

- **Structured retrospective reflection — SHIPPED.** `generateStructuredRetrospective`
  (`lib/anthropic-api.ts`) feeds the completed block's matured `intervention-log` records (hypothesis
  + scored outcome) to the model via native tool-use + `zod` (`lib/retrospective-schema.ts`, sharing
  the `lib/tool-schema.ts` bridge with the plan tool) and returns
  `{dimension, hypothesis, observation, root_cause, adjusted_strategy}[]`. Stored on
  `BlockHistoryEntry.structuredReflections` (+ a *Coach reflections* markdown section) and injected
  into the next block's dynamic prompt (`formatReflectionsForPrompt`). Additive to the prose
  retrospective (one extra call/block); degrades to `[]` when there are no matured interventions or
  the call fails. The model only phrases — every number is supplied.
- **Athlete-quirk extraction (lean) — SHIPPED.** `lib/quirks.ts` mines the synced
  `activityDescription` notes on each sync (`extractQuirks`, after `writeRollingBaselines`) using
  `compromise` (sentence segmentation + a curated, negation-aware cycling lexicon across symptom /
  equipment / psyche / condition). Recurring patterns (≥2 distinct rides) land in a **derived** store
  `data/athlete-quirks.json` (regenerated each sync, no backup — like rolling-baselines; kept separate
  from the authoritative `athlete_profile.md`) and are injected into generation as explicit
  *hints, not facts* (`formatQuirksForPrompt`). Deterministic; no AI.
- **Confidence-weighted modeling — deferred to #2.** The `confidence` + `lock_threshold` machinery is
  shared with the per-athlete calibration keystone (#2), which says "build it once"; doing it
  standalone risks duplicate/throwaway work and touches the frozen scoring core. Spec retained below;
  build it inside #2's framework. EWMA gives a point estimate with no sense of sample size. Add an
  **uncertainty layer alongside** EWMA (sample-size / variance, or a Beta/Normal conjugate posterior)
  so the model distinguishes "45% after 1 session, wide" from "tight after 10" — feeding per-athlete
  bands (#2) and letting low-confidence signals be down-weighted. **Additive, not a rip-out:** keep
  EWMA's gradation (don't binarise 1–10 → pass/fail and lose the 6-vs-9 distinction). Pure TS
  (`simple-statistics` or hand-rolled conjugate update). **This is the same `confidence` +
  `lock_threshold` layer #2 calls for — build it once, shared.**

---

## Platform & performance (local-first)

Deployment is **local-first, single-user** (confirmed). The hosted-SaaS migration items from the
external audit (Postgres/RLS, blob storage, auth) are intentionally out of scope — see "Decided
against". The items below are deployment-agnostic cost / robustness / UX wins.

### P4–P7 — DONE (see ARCHIVE)
- **P4. Observability + generation caching** — all four shipped: token/cost tracker
  (`lib/ai-usage.ts` + `AiUsageCard`), coach-accuracy % on the dashboard (`overallCoachAccuracy`),
  streamed `/api/ask` (`streamAskCoach`), and generation dedupe (`lib/generate-cache.ts`). The
  regenerate-vs-cache product question is **resolved** — decision: a short **dedupe-only** window
  (not a long reuse cache), since generation runs at temperature 0.3 and a considered regenerate is
  partly *for* the variation.
- **P5. Deterministic schedule validator** — `lib/schedule-validate.ts` flags adjacent hard days +
  over-budget quality sessions as generation warnings.
- **P6. Reliability & resilience quick-wins** — error boundaries, model+`promptVersion` stamping,
  export/import backup, per-file write mutex, manual re-analyse.
- **P7. TanStack Query client** — the `['sync']` GET + Trends fetch are TanStack queries
  (focus/reconnect refetch, dedup, retry); `useSync()`'s public API unchanged.

### P8. Logging + AI-route rate-limit
- [ ] **Structured logging** — replace silent `catch`/`console` with a small logger (pino or a lean
  wrapper) carrying `{route, step, status, ms}`; turns "sync succeeded but no coach note" into a
  traceable event. Pairs with P3's `warnings[]`. (Weigh the dep vs. a tiny console+file wrapper for
  single-user.)
- [ ] **AI-route cost guard** — an in-memory token-bucket on `/api/generate` + `/api/ask` (e.g.
  N/hour) so a client loop or fat-finger can't run up Anthropic spend. Mild single-user value,
  table-stakes for multi-user.

### P9. PWA + streamed generation
- [ ] **PWA install** — `app/manifest.ts` + service worker + install prompt; "add to home screen"
  for an app checked before every ride.
- [ ] **Stream `/api/generate`** — it blocks 1–2 min today; stream the block so the overview, then
  each day, appears as it's built ("Claude is building your plan" vs. "is it stuck?"). Extends P4.

---

## UI refinements

Most of the Images 1–5 audit shipped (see [ARCHIVE.md](ARCHIVE.md)). Remaining:
- **Nutrition availability metric on the Today card** ⭐: derive an energy-availability / fuelling
  signal from the data we already have (weekly ride output kJ, weekly intake kcal, median weekly
  weight) and surface it on Today. Goal: a glanceable "are you under-fuelled?" flag, so a bad
  session can be attributed to fuelling rather than fitness. Overlaps with §6 (nutrition energy
  balance) + Track C — build the derivation once, surface on Today + feed `CoachSnapshot.fuel`.
  Deterministic; no AI. (Rough EA proxy: (intake − ride burn) per kg bodyweight; flag low.)
- **Recent Baselines — decide the *useful* set:** current tiles (Avg TSS/ride, Weekly hours,
  decoupling, cadence) are okay but not all high-value. Audit and replace with what actually informs
  training: candidates — **w/kg at threshold** (20-min power ÷ weight), **weekly TSS**, **rides/week
  consistency**, **CTL ramp rate**, **decoupling trend**. Pick ~4 that aren't redundant with the graphs.
  _From real-use feedback:_ also resolve the **TSS-vs-Load naming** ("Avg TSS / ride" is Intervals'
  Load — name it consistently), fix the **Weekly-hours window** (it uses the logged-window mean, not
  the 90d rolling its sibling tiles use — see todo `MR-2`), and reconsider the Today card's **"NP /
  Avg" two-value tile + IF** for clarity (NP + NP-based IF are the signal; raw Avg is secondary).
  _Latest feedback (sharpens this):_ **IF lacks context on its own** — decide whether to pair it with
  a plain-language read (zone/effort label) or replace it with a more legible intensity metric; and
  surface **avg power · NP · speed as distinct, clearly-labelled synced tiles** (today NP+Avg share one
  tile and speed shows only when distance+duration are present). Likely outcome: split NP from Avg,
  keep speed as a sanity tile, and either annotate or demote IF. (Verify the tiles actually populate
  post-sync first — todo `TR-4`; avg-speed `RC-1` is a new synced field.)
- **Pw:HR-drift × fueling overlay on Trends (from the external spec):** the **filtering is already
  shipped** — `lib/trends.ts efSeries` uses Intervals' `icu_efficiency_factor`, outdoor-only,
  endurance band (0.56–0.85 FTP), ≥45 min, as a *trajectory* not single-ride snapshots. The new ask
  is the **carb-intake (g/h) overlay on the same chart** so the fuelling → drift relationship is
  visible. Build with Track C's correlation engine (shared filtered series). _Already-resolved
  metric SoT to keep, not redo:_ TSS is dropped (= Intervals' Load); Pw:HR is synced not recomputed;
  Today card already shows IF · NP/Avg · Decoupling · RPE with per-metric context.
- **Page layout / open-state density (less scrolling):** each page should show its decision-critical
  content above the fold on open. Audit Today/Plan/Trends/Profile for what's pushed below the fold,
  tighten spacing + reorder so the first screen answers "what do I do now?" without scrolling.
- **Popups where needed:** add styled `MetricTip` hovers to metrics that lack an explanation —
  the interval completion % (Img 2), the new nutrition-availability metric, Recent Baselines tiles,
  Trend Pulse tiles, and the Trends **Weekly-volume** + **Execution-quality** cards (the last two
  tracked actionable in todo `TR-3`). Consistent hover affordance across the app.
- **Mobile horizontal-overflow audit:** verify **zero** horizontal scroll on Today/Plan/Trends at
  narrow viewports (the lean-UX mandate). The layout looks responsive (grids stack at `sm`, vertical
  containment via `lg:overflow-hidden`) but hasn't been checked on a real phone-width screen — fix
  any overflow source found (watch the 3-col tile rows + `whitespace-nowrap` chips).

---

## Larger / scoped features (when wanted)

### 6a. Event-aware (race) block planning  ⭐
Let the athlete name a target event and have block generation actually plan around it — taper,
carb-load, race-day fuelling — instead of treating the race as just another goal string.
- **Structured event:** date + priority (A/B/C) + expected duration/type. Today goals are
  free-text (`athlete_profile.md` goal+target); add a parsed/structured race field (or a small
  store) so generation knows the date deterministically.
- **Periodization anchoring:** count down to the race; if it falls in the block, the final
  ~1–2 weeks become a **taper** (KB `cycling_database.md` Taper/Event phase: reduced volume,
  freshness), and the build peaks before it.
- **Carb-load + 48h protocol:** the 36–48h-before days get elevated carb targets (KB
  `nutrition_knowledge.md` Race Week: 8–12 g/kg) wired through `lib/nutrition.ts`; the day-before
  + race morning get the **Race-Day 24h timeline** (pre-race meal T−4 to −3.5h, in-race g/h,
  caffeine protocol) baked into the planned-ride descriptions.
- **Race entry itself:** a planned event with its fuelling plan in the description.
- **Contained AI:** the KB already *holds* all of this (carb-load tables, race-week, race-day
  timeline, taper phase) + the nutrition engine computes the grams — the LLM only phrases the
  hardwired protocol into each ride's description; it must not invent fuelling numbers.
- This is the "Planned Event Framework" from the §2C audit (A/B/C races anchoring periodization),
  which never made it in. Prereq for it to feel real: the structured event + taper logic.

### 6. Nutrition energy-balance wiring + expanded fueling
The surfacing layer for Track C (build together):
- Feed the weekly graph's third axis (actual **weekly output kJ vs. weekly intake** + median weight
  trend) into a derived `fuelingState` that refines the buffer and lands in `CoachSnapshot.fuel`.
- Then expand `lib/nutrition.ts` to precise fluid + sodium + carb-gram targets pre/intra/post,
  scaled by target IF + duration. (Note: digestive-feedback tuning is gone — survey was removed —
  so IF/duration-driven, RPE as a possible proxy.)

### 7. Calendar flexibility — condition-driven swaps + bidirectional sync
- **[note]** Let the calendar reorder itself for conditions: e.g. bad weather today → do the long
  ride on a better-weather day and swap the rest of the week's layout, keeping weekly load intact.
  Athlete drags/swaps; system can also *suggest* a swap. Should respect quality-day spacing.
- Bidirectional Intervals.icu sync for the swap: **large + API-risk** — the client only has
  `createEvent`; needs move/update/delete event methods, verification the API supports mutation,
  and a polling hook for external date shifts. Scope as its own session. (Unblocks the §3 calendar
  mirror remaining-sliver.)

### 8. NP-missing → "unverified" execution hardening
Execution already uses NP-first + time-in-zone (so descent-skew is handled). The one gap: when NP
is absent on an outdoor ride, don't score off raw avg power — stamp the entry `unverified` rather
than producing a flawed number. Small, zero-hallucination-correct.

---

## Exploratory research

Bigger architectural directions (the "Second Brain" spike: LangGraph / Mem0 / GraphRAG / Logseq /
HRV) are evaluated in **[research.md](research.md)** — recorded as findings, not build commitments.
The short version: the capabilities mostly already exist in lean form; the real gap is **signal
fusion (§5, v1 shipped)**, and the lean spin-offs worth pursuing are knowledge-connections and
HRV-readiness.

---

## Shipped

Completed work has moved to **[ARCHIVE.md](ARCHIVE.md)** to keep this list forward-looking.

---

## Decided against (don't re-propose without a real reason)
- **Postgres/Supabase + RLS · blob storage for KB · auth middleware** — an external audit flagged
  these as "Phase 1 blockers", but it assumed a Vercel/serverless multi-tenant SaaS. Nodevelo is
  local-first single-user by design (CLAUDE.md + README); on `localhost` there's no athlete-isolation
  or URL-exposure threat, and `fs`/JSON *is* the intended store. Revisit only on a deliberate pivot
  to a hosted multi-user product.
- **pgvector RAG for the KB** — the KB is a handful of small markdown files that fit cheaply in the
  prompt; the context-dump is intentional. Against the "no heavy DB abstractions" rule.
- **RxDB reactive-DB rewrite** — contradicts the local-first JSON design; the desync it targeted is
  already fixed with refetch-on-sync.
- **SQLite (`better-sqlite3` + Drizzle + `sqlite-vec`) — deferred, not rejected.** A storage-engine
  swap (transactions, indexed queries, cheap local vectors) is genuinely more justified than the
  reactive rewrite above. But at single-user scale its wins are mostly theoretical (filtering a few
  hundred rows is instant; the concurrency race is fixable by P6's mutex), and its standout unlock
  (`sqlite-vec` semantic memory) is gated on semantic RAG — itself deferred (research.md). The
  migration also replaces json-store's atomic-write + `.bak` recovery + immutable-ledger logic and
  adds a native dep. **Reconsider when semantic RAG is committed OR data volume / multi-user
  justifies it** — then it's the right foundation; just not worth the risk now.
- **uPlot / canvas charting** — the "long ride freezes the SVG" premise is stale: `buildRideTrace`
  already downsamples to ~240 points, so no chart ever renders raw 1 Hz streams. Revisit only if we
  add full-resolution interactive charts (not planned).
- **Cytoscape / Obsidian-style knowledge graph** — heavyweight dep that re-presents existing data;
  against the zero-bloat mandate.
- **Post-ride structured survey** — RPE/feel already sync from Intervals.icu (`icu_rpe`).
