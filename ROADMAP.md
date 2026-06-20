# NodeVelo roadmap

The **forward backlog** — unfinished / deferred work, ordered roughly by leverage. The goal
everything is measured against: **be a coaching *layer* that fuses signals into one coherent,
self-correcting athlete model — not a re-skin of Intervals.icu.**

Companion docs: live bugs → [todo.md](todo.md) · shipped work → [ARCHIVE.md](ARCHIVE.md) ·
exploratory spikes → [research.md](research.md) · how it all works → [README.md](README.md).

---

## Next up (prioritized)

### 1. Per-athlete execution-score bands  ⭐ (the remaining calibration frontier)
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
Parameters to bring under it: **per-type IF cutoffs** (from `physiology.json` zones), **decoupling /
Pw:HR "good" threshold** (from `avgDecoupling90d`), **ACWR band** (narrow if load-tolerant, widen if
fragile), **EWMA α / fitness-decay rate** (lengthen if the athlete retains fitness, shorten if rapid
decay), **TSB adaptation window** (the range that actually produced adaptation), and **optimal carbs
g/h per ride type** (owned by the fueling engine — see "Fueling intelligence"). The `confidence` +
`lock_threshold` layer is the additive uncertainty model the second-brain item already calls for —
build it once here, not twice.

### 2. CoachSnapshot + Ask-Coach context (the "objective telemetry lens")
Build one pre-computed `CoachSnapshot` that generation and Ask-Coach read, so the LLM is handed
resolved numbers and can't invent them. Shape: `today.execution {score, completed/total,
effective%, power%, duration%}` · `form {tsb, acwr, readiness, loadRamp}` · `fuel {todayTargetKcal,
intakeVsNeed, fuelingState, weightTrend7d}` · `block {goal, week/total}` · `directives[]`.
Ask-Coach already gets block+form; **add `today.execution` + `fuel`.**

**TSB as an actionable modifier, not a raw number (from the external spec).** A bare "TSB −12" is
useless to the athlete. The snapshot's `form` must resolve TSB *against today's prescription*: is the
athlete in a range where the prescribed stimulus still produces adaptation, or too fatigued to
benefit? Surface it as a conditional modifier tied to the session — e.g. *"Form −12: today's VO2
still adapts, but drop a rep if RPE > 8 by set 3."* The window that counts as "adaptive" is itself a
calibrated parameter (TSB adaptation window in §1's framework), not a fixed −10…+5. The LLM phrases
it; the band + decision are deterministic.

> **⚠️ Ask-Coach anti-pattern (from a real test — this is what must NOT happen).**
> Prompt: *"should I stay on plan tomorrow although I only managed 41% of the prescribed intervals?"*
> A response like *"No — skip tomorrow, you're under-recovered or under-fuelled (execution 1/10)…"*
> is **wrong**: it hallucinates a physiological cause and prescribes a skip from a single low
> session — when in this case the 41% was caused by **equipment failure** (ghost resistance), not
> fatigue. **Correct behaviour:** the coach must read the session's `disposition` (see §3) before
> diagnosing. If `compromised: equipment` → say so ("that session doesn't reflect your form —
> equipment skewed it; tomorrow stands, just refuel normally"), don't infer recovery debt. Never
> confidently diagnose under-recovery/under-fuelling or prescribe a skip off one compromised data
> point. Ask/condition, don't assert.

### 3. Adaptive logic — DONE (only the Intervals.icu calendar mirror remains)
Both halves shipped: the disposition flag + learning gate, and the auto-reschedule engine
(`lib/reschedule.ts` + `/api/reschedule` + RescheduleBanner) that detects a not-delivered quality
session and suggests/applies a make-up on the next clear rest day in the **local** block.
- **Remaining:** the reschedule rewrites the local block only — it doesn't yet move the event on
  the **Intervals.icu calendar** (needs the event-mutation API; bundle with #7 bidirectional sync).
  The banner currently tells the athlete to mirror the move manually.
- **Possible follow-up:** a *proactive* sickness/fatigue path (downgrade today + reschedule before
  the session is even missed, on a `fatigueAlert`), vs. the current reactive "you missed it" flow.
- **Wider target slots:** today `suggestReschedule` only lands a make-up on a *rest* day. Let it
  also use an **easy endurance day** (Z2/Recovery, e.g. a 90 min Z2) — swap the quality work onto
  it and displace the easy ride (shorten, move, or drop it) rather than requiring a free rest day.
  Keep the guardrails: preserve weekly load, no back-to-back hard days, athlete-confirmed. Widens
  how often a make-up can actually be placed.

### 3b. Proactive reschedule — "not feeling it?" morning check-in  ⭐
A button on Today (prominent when today is a quality day) you tap *before* the session — e.g. you
wake up wrecked on an interval day. It opens a short set of **standardised questions** (uniform,
schema-friendly so they trend over time): fatigue 1–5, sleep last night 1–5, leg soreness 1–5,
motivation 1–5, illness none/mild/sick. Stored as structured JSON (a `morning-check` store).
- **Deterministic decision:** combine the answers with existing readiness (TSB / ACWR) against
  thresholds → either "you're good, proceed" or "downgrade to recovery + reschedule the quality
  stimulus" (reuse `lib/reschedule.ts`). No AI in the decision.
- This is the proactive counterpart to the reactive "you missed it" banner — catch it at wake-up.
- Distinct from the (removed) post-ride RPE survey: this is a *pre-session scheduling input*
  (fatigue/sleep/soreness the system can't sync) that the deliberately-absent HRV/sleep feed would
  otherwise provide. Keep it lean — a few chips, one tap to reschedule.

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
  durability-template scoring loop (below) and §1 calibration.

### 5. Signal fusion → one coherent athlete state  ⭐ (biggest gap to a "true" second brain)
The brain *surfaces* parallel signals (execution, behaviour, validation, readiness, RPE); it
doesn't *fuse* them. e.g. RPE-high + execution-down + decoupling-up → one "systemic fatigue →
recover" conclusion, not three lines. Design a single `athleteState` synthesis before
generation/readiness. This is the heart of the goal.

### Weak-Point Optimizer & rider-type ID  ⭐ (the proprietary edge)
The distinct value over Intervals.icu / TrainerRoad / TrainingPeaks: translate the raw power curve
into structured coaching. Deterministically analyse the **shape** of the synced power curve (ratios
across 5s / 1min / 5min / 20min, plus W/kg) to:
- **Classify rider type** (sprinter / puncheur / TT / all-rounder) from the curve profile.
- **Flag the "easy win"** — the duration most depressed relative to the rider's own profile / type
  norm — as an explicit micro-target for the next block.
- Surface both on Profile + feed them into generation **and the block review** (this absorbs the
  "telemetry-graph ingestion" idea — the review reads the curve shape, not just compliance).
- Replaces today's **manual** weak points (`athlete_profile.md`) with an auto-derived layer; manual
  stays as an override.
Keep it **deterministic** — classification + easy-win in TypeScript, the LLM only phrases it. Shares
the power-profile read with #1 (per-athlete bands): build the curve-shape analysis once.

### Plan-cue generalization
Execution cues in generation are grounded in weak points, but the *examples* are hardcoded text
(descending / cornering / standing sprints — this athlete's). Make the cues derive from the
athlete's actual weak points + goals (and, once the Weak-Point Optimizer lands, the auto-identified
weak point), so they generalise to any rider instead of baking one athlete's limiters into the prompt.

### Goal-driven session selection  ⭐ (high priority — make the brain actually use the new types)
The building blocks already ship — **RaceSim** (KB §10: attack hills / KOM-hunt rehearsal) and
**athlete-directed / terrain-flexible** sessions (KB §11: *"find 2×20m climbs, push; Z2 otherwise"*
· *"5 short climbs 2–8 min, stay in VO2max"* · *"Z2 but sprint ≤6 short hills"*). The gap is
*selection*: the generator only reaches for them when the prompt happens to nudge it. Make it
**goal-driven and reliable** — when the macro-goal implies terrain/race demands (hill-KOM hunting),
the block must include race-sim + flexible-climb sessions as *key quality work*, not optional
flavour. Prefer a deterministic nudge (goal tags → require ≥1 such quality session per loading week)
over hoping the LLM picks them. They count toward the quality budget and respect spacing (see P5
schedule validator) so they don't interfere with the fixed-ERG benchmark + interval priority — the
point is to keep intervals primary while breaking indoor-ladder monotony with structured-but-flexible
outdoor quality the athlete will actually ride. (Foundation: PW-3/PW-9, shipped — see ARCHIVE.)

### Durability prescription taxonomy  ⭐ (durability is a category, not one workout)
From the external spec. The system today treats "durability" as a single long-Z2 template; it must
treat it as a **stimulus category with rotating templates**, each training a different
fatigue-resistance mechanism. Encode the templates and a *placement* rule (the intensity sits inside
the duration target, never replaces it):
- **A — Pure accumulation:** long Z2 (volume → fatigue resistance).
- **B — Fatigue-then-threshold:** ~3 h Z2 → threshold climb(s) late → Z1/Z2 to fill (threshold power
  *after* accumulated fatigue).
- **C — Fatigue-then-VO2:** Z2 → VO2 efforts placed late → fill (high-end aerobic under fatigue).
- **D — Fatigue-then-neuromuscular:** Z2 → late sprints → fill (recruitment when glycogen-depleted).
- **E — Mixed density:** micro-doses (surges / under-overs) woven through the Z2, not back-loaded.

Selection (deterministic; the LLM only phrases the chosen template):
- **Limiter-driven** when the athlete model flags one (threshold-under-fatigue → B; VO2 repeatability
  → C; explosive finish → D; low volume tolerance → A).
- **Rotate** even with no clear limiter — stacking one template breeds one-dimensional adaptation.
- **Duration-respecting + terrain/time-adaptive:** 3 h instead of 4 h → shorter Z2 block, same
  late-ride placement, adjusted target. Must respect P5 spacing + the quality budget.
- **Future scoring loop (compat, not now):** score each ride against its template's expected
  adaptation signal (did a B session raise threshold-under-fatigue vs the prior B?) → a per-template
  **prescription-accuracy** weight per athlete. Build the classification so this can bolt on later
  (ties to §4 + the fueling correlation engine).
Extends Goal-driven session selection (shared selection/spacing machinery) — build the two together.

### Second-brain learning upgrades  ⭐ (semantic memory + confidence — additive to the deterministic core)
Make the brain reason about *why*, not just track scalars — **without** surrendering the
deterministic guarantees (the AI only ever writes the language; the math + validation stay in TS).
Shared theme: ride notes (athlete `activityDescription` + `coachNote`) are currently generated, shown,
then discarded — these turn them into durable, queryable memory.

- **Structured retrospective reflection.** `generateRetrospective` emits prose and the forward
  "learnings" are deterministic seeds. Instead, feed the previous block's `intervention-log`
  (hypothesis) + actual outcomes to the model and have it return **structured JSON** via Anthropic
  native tool-use + `zod` — `{hypothesis, observation, root_cause, adjusted_strategy}` — stored on
  `BlockHistoryEntry` and injected into the next block's system prompt, so the AI reads its own past
  clinical notes, not just seeds. (Ties to #4 validation loop + P2 structured outputs; one extra
  call per ~4-week block — negligible. Use native tool-use, **not** the Vercel AI SDK.)
- **Athlete-quirk extraction (lean).** A small local NER (`compromise`, ~200kb pure JS) over
  accumulated `activityDescription` notes on sync → recurring symptoms / equipment / psych states
  (e.g. "left-leg cramp in heat", "indoor aversion") as tags in a **derived** store — *not*
  `athlete_profile.md` (owned-intent stays authoritative; auto-derived stays separate). Inject the
  tags into generation so the coach recalls history without RAG-ing it. Tags are hints, not facts
  (pattern-matching is noisy). This is the lean slice of the semantic-memory spike (research.md).
- **Confidence-weighted modeling.** EWMA gives a point estimate with no sense of sample size. Add an
  **uncertainty layer alongside** EWMA (sample-size / variance, or a Beta/Normal conjugate posterior)
  so the model distinguishes "45% after 1 session, wide" from "tight after 10" — feeding per-athlete
  bands (#1) and letting low-confidence signals be down-weighted. **Additive, not a rip-out:** keep
  EWMA's gradation (don't binarise 1–10 → pass/fail and lose the 6-vs-9 distinction). Pure TS
  (`simple-statistics` or hand-rolled conjugate update).

### Fueling intelligence: correlation engine + pre-ride loading loop  ⭐ (data already synced)
From the external spec; the highest-value new insight because the inputs already exist (intervals.icu
syncs intra-ride carbs g/h, and `lib/nutrition.ts` already computes pre/in-ride targets). Turn
fueling from a static formula into a learned, per-athlete signal:
- **Correlation engine.** Per ride type, correlate the synced **carbs g/h** against the outcome
  signals we already compute: **Pw:HR decoupling** (fueling-adequacy proxy), **RPE-vs-IF divergence**
  (high RPE for low IF = under-fuelled), **interval completion rate**, and **next-day TSB**. Over
  successive same-type rides, **converge on the athlete's own optimal g/h** — stored as a calibrated
  parameter in §1's framework (with confidence + lock), not a generic guideline.
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

---

## Platform & performance (local-first)

Deployment is **local-first, single-user** (confirmed). The hosted-SaaS migration items from the
external audit (Postgres/RLS, blob storage, auth) are intentionally out of scope — see "Decided
against". The items below are deployment-agnostic cost / robustness / UX wins.

### P4. Observability + generation caching
- [x] **Token/cost tracker in Settings** — DONE (see ARCHIVE). `lib/ai-usage.ts` records every
  Anthropic call's `usage` into `data/ai-usage.json` (priced per-model, cache read/write aware);
  `AiUsageCard` surfaces running spend on Settings.
- [ ] Generate caching: skip the Claude call when the assembled prompt is byte-identical to a recent
  one. **Open product question:** with temperature 0.3, a deliberate "regenerate" partly exists *to
  get variation* — decide whether a cache hit reuses the prior plan (cost win) or whether regenerate
  must always re-call (needs a `refresh` bypass / short dedupe-only TTL). Resolve before building.
- [x] **Coach-accuracy % on the dashboard** — DONE (see ARCHIVE). `overallCoachAccuracy` rolls the
  validation loop into one hit-rate %; surfaced in the Trend-pulse zone, hidden until a decisive
  outcome or pending interventions exist.
- [x] **Stream `/api/ask` responses** — DONE (see ARCHIVE). `streamAskCoach` async-generator → the
  route returns a plain-text `ReadableStream`; `AskCoach` reads the body incrementally so tokens
  render as they arrive.
- [ ] Generate caching — **the only remaining P4 item, and it's blocked on the product question
  above** (regenerate-for-variation vs cache reuse). Decide before building.

### P5. Deterministic schedule validator — DONE (see ARCHIVE)
`lib/schedule-validate.ts validateSchedule` flags adjacent hard days + quality sessions over the
weekly budget as generation warnings. Closes the placement gap (`workout-validate` checks protocol,
not placement).

### P6. Reliability & resilience quick-wins — DONE (see ARCHIVE)
All five shipped: `error.tsx`/`global-error.tsx` boundaries; model+`promptVersion` stamping on
`GeneratedPlan`/`TodayAnalysis`/`BlockHistoryEntry`/`CurrentBlock`; export/import backup
(`/api/export` + `/api/import`, no-dep JSON bundle, Settings UI); per-file write mutex in
`lib/json-store.ts`; and manual re-analyse (`addCoachNote(force)` + Today button, with the
note-preserved-across-resync guard).

### P7. TanStack Query client
`SyncProvider` + `lib/client-api.ts` are a hand-rolled cache (fetch-on-mount, manual refetch, no
refetch-on-focus/reconnect, no dedup, no retry; Trends does a second manual fetch keyed on
`syncedAt`). Move the data layer to TanStack Query (`useQuery(['sync'])` + `useMutation` with
invalidation) for focus/reconnect refetch, dedup, retry, optimistic updates — keep the sync-button
UI as a thin wrapper. Fixes the "stale after an overnight tab" UX. ~2-day refactor.

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
  session can be attributed to fuelling rather than fitness. Overlaps with #6 (nutrition energy
  balance) — build the derivation once, surface on Today + feed `CoachSnapshot.fuel`. Deterministic;
  no AI. (Rough EA proxy: (intake − ride burn) per kg bodyweight; flag low.)
- **Recent Baselines — decide the *useful* set:** current tiles (Avg TSS/ride, Weekly hours,
  decoupling, cadence) are okay but not all high-value. Audit and replace with what actually informs
  training: candidates — **w/kg at threshold** (20-min power ÷ weight), **weekly TSS**, **rides/week
  consistency**, **CTL ramp rate**, **decoupling trend**. Pick ~4 that aren't redundant with the graphs.
- **Pw:HR-drift × fueling overlay on Trends (from the external spec):** the **filtering is already
  shipped** — `lib/trends.ts efSeries` uses Intervals' `icu_efficiency_factor`, outdoor-only,
  endurance band (0.56–0.85 FTP), ≥45 min, as a *trajectory* not single-ride snapshots. The new ask
  is the **carb-intake (g/h) overlay on the same chart** so the fuelling → drift relationship is
  visible. Build with the fueling correlation engine (shared filtered series). _Already-resolved
  metric SoT to keep, not redo:_ TSS is dropped (= Intervals' Load); Pw:HR is synced not recomputed;
  Today card already shows IF · NP/Avg · Decoupling · RPE with per-metric context.
- **Page layout / open-state density (less scrolling):** each page should show its decision-critical
  content above the fold on open. Audit Today/Plan/Trends/Profile for what's pushed below the fold,
  tighten spacing + reorder so the first screen answers "what do I do now?" without scrolling.
- **Popups where needed:** add styled `MetricTip` hovers to metrics that lack an explanation —
  the interval completion % (Img 2), the new nutrition-availability metric, Recent Baselines tiles,
  Trend Pulse tiles. Consistent hover affordance across the app.
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
  and a polling hook for external date shifts. Scope as its own session.

### 8. NP-missing → "unverified" execution hardening
Execution already uses NP-first + time-in-zone (so descent-skew is handled). The one gap: when NP
is absent on an outdoor ride, don't score off raw avg power — stamp the entry `unverified` rather
than producing a flawed number. Small, zero-hallucination-correct.

---

## Exploratory research

Bigger architectural directions (the "Second Brain" spike: LangGraph / Mem0 / GraphRAG / Logseq /
HRV) are evaluated in **[research.md](research.md)** — recorded as findings, not build commitments.
The short version: the capabilities mostly already exist in lean form; the real gap is **signal
fusion (§5)**, and the lean spin-offs worth pursuing are knowledge-connections and HRV-readiness.

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
