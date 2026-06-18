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

### 2. CoachSnapshot + Ask-Coach context (the "objective telemetry lens")
Build one pre-computed `CoachSnapshot` that generation and Ask-Coach read, so the LLM is handed
resolved numbers and can't invent them. Shape: `today.execution {score, completed/total,
effective%, power%, duration%}` · `form {tsb, acwr, readiness, loadRamp}` · `fuel {todayTargetKcal,
intakeVsNeed, fuelingState, weightTrend7d}` · `block {goal, week/total}` · `directives[]`.
Ask-Coach already gets block+form; **add `today.execution` + `fuel`.**

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

### 5. Signal fusion → one coherent athlete state  ⭐ (biggest gap to a "true" second brain)
The brain *surfaces* parallel signals (execution, behaviour, validation, readiness, RPE); it
doesn't *fuse* them. e.g. RPE-high + execution-down + decoupling-up → one "systemic fatigue →
recover" conclusion, not three lines. Design a single `athleteState` synthesis before
generation/readiness. This is the heart of the goal.

---

## Platform & performance (local-first)

Deployment is **local-first, single-user** (confirmed). The hosted-SaaS migration items from the
external audit (Postgres/RLS, blob storage, auth) are intentionally out of scope — see "Decided
against". The items below are deployment-agnostic cost / robustness / UX wins.

### P1. Prompt caching (token cost)  ⭐
Apply `cache_control` to the static system-prompt prefix (coach persona + KB context + resolved
zones) in `lib/anthropic-api.ts`, ordered before the volatile per-request context so the cache
breakpoint actually lands. Largest spend reduction with no design change; aligns with the
token-economy mandate. Verified absent today (`cache_control` appears nowhere).
- [ ] cache_control on the static prefix in generation + ride-analysis calls
- [ ] verify prefix ordering (static → volatile) so the cached segment is reused

### P2. Structured outputs (parse robustness)
Replace the regex plan parser (`lib/plan-parser.ts`) with Anthropic tool-use / structured JSON for
the generated block — removes the regex as a failure surface; the model returns structured days.
- [ ] define a `create_block` / day tool schema; switch generation to tool-use
- [ ] keep `workout-validate.ts` + KB protocol rules as the post-generation guard
- [ ] keep the regex parser as a fallback for one release in case of malformed tool output

### P3. Decouple `/api/sync` from AI analysis
`/api/sync` is a God function (fetch → reconcile → score → PR → AI → validate → post-back): a step-5
crash leaves inconsistent state and users wait for the whole chain. Split it so the data fetch +
deterministic metrics return fast (instant chart/calendar), then AI analysis runs as a separate
triggered call and patches `today-analysis.json`.
- [ ] return after data + deterministic metrics; move `analyseRide` to a follow-up call/endpoint
- [ ] frontend: render the fast path, then fill in coach note / PRs when analysis lands
- [ ] keep it local — a triggered second call, NOT a serverless queue / Trigger.dev

### P4. Observability + generation caching
- [ ] Generate caching: skip the Claude call when the assembled prompt is byte-identical to a recent one
- [ ] Stream `/api/ask` responses (token streaming) for snappier coach replies
- [ ] Surface intervention **coach-accuracy %** (from `intervention-log.json`) on the dashboard
- [ ] Token/cost tracker in Settings (tally input/output tokens per call → running cost estimate)

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
- **Page layout / open-state density (less scrolling):** each page should show its decision-critical
  content above the fold on open. Audit Today/Plan/Trends/Profile for what's pushed below the fold,
  tighten spacing + reorder so the first screen answers "what do I do now?" without scrolling.
- **Popups where needed:** add styled `MetricTip` hovers to metrics that lack an explanation —
  the interval completion % (Img 2), the new nutrition-availability metric, Recent Baselines tiles,
  Trend Pulse tiles. Consistent hover affordance across the app.

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
- **RxDB / better-sqlite3 reactive-DB rewrite** — contradicts the local-first JSON design; the
  desync it targeted is already fixed with refetch-on-sync.
- **Cytoscape / Obsidian-style knowledge graph** — heavyweight dep that re-presents existing data;
  against the zero-bloat mandate.
- **Post-ride structured survey** — RPE/feel already sync from Intervals.icu (`icu_rpe`).
