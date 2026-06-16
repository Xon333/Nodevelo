# Nodevelo roadmap

A living backlog of unfinished / deferred work, so it's never lost between sessions. Ordered
roughly by leverage. The main goal everything is measured against: **be a coaching *layer* that
fuses signals into one coherent, self-correcting athlete model — not a re-skin of Intervals.icu.**

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

### 3. Adaptive logic — session `disposition` + decision trees  ⭐
Add a per-day **`disposition: completed | partial | missed | compromised(reason)`** the athlete
can set — the objective fact telemetry can't infer. It gates how a session feeds the model.

- **Sickness / extreme fatigue on a quality day:** flag/`fatigueAlert` on a Threshold/VO2/SIT day
  → downgrade today to recovery, tag `missed: fatigue`, and **reschedule the stimulus** (shift
  remaining quality days forward, preserve load) or carry it as a next-block seed if near the end.
  Never silently delete prescribed work.
- **Equipment malfunction (ghost-resistance case):** prescribed 2×20 threshold executed as
  1×12 + 1×5 in Z5. Raw score stays honest (~1/10) — that's the truthful read of the file — but
  `disposition: compromised(equipment)` **excludes it from the execution EWMA** (same mechanism as
  `legacy` rides: kept as history, not taught from), the Z5 work is **not** logged as a VO2 stimulus,
  and the threshold target is marked **not delivered** → feeds the reschedule logic. Principle:
  *raw scoring is honest; attribution decides whether it teaches the model.*

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

## UI refinements (from the Images 1–5 audit)

- **Readiness card (Img 1) — trim bloat:** keep the verdict + TSB + ACWR + Polarization (decision-
  relevant); demote CTL/ATL/7-day-hours to Trends (status, not a daily decision).
- **Trend Pulse (Img 5) — redesign:** keep CTL; replace the Pw:HR + Execution tiles (both already
  on Trends) with a **weekly-volume bar** (~8 wk hours) and a **time-in-zones mini-bar** (polarization
  split) — the two things a glance should answer.
- **Trends Execution-Quality + Recent-Baselines (Img 4) — compact layout:** they're full-width and
  sparse; pair into a 2-column row or square cards.
- **Recent Baselines replacement metric (Img 4):** Avg CTL removed (done); fill the slot with a
  higher-value baseline — **weekly ride hours**, **off-plan %** (behaviour signal already computed),
  or **20-min power / w·kg**.
- **Profile (Img 3) — spacing:** larger section gaps + `leading-relaxed` on the prose blobs + a
  hairline divider after the PR bracket. No logic change.
- **Interval-execution completion % (Img 2):** make the "41%" a `MetricTip` hover explaining
  power × duration completion (component already exists).

---

## Larger / scoped features (when wanted)

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

## Done recently (context)
- Quick UI wins: Sparkline tooltip border/guide now match the chart accent (cyan CTL / pink Pw:HR);
  removed Avg CTL from Recent Baselines; "Week W of N · N sessions to go" (also fixed rest-days
  being counted as sessions).
- Atomic writes + ledger backup/recovery (`lib/json-store.ts`).
- Synthesis: one coaching-directive block; dropped redundant `compliance-memory`.
- Calibration v1: auto-α + ACWR bands (manual override).
- Closed the learning loop: score all rides + intervention validation.
- Compliance unified into the execution/completion index; duration-aware interval scoring;
  time-in-zone polarization; physiology single-source-of-truth; Ask-Coach (block+form context).

## Decided against (don't re-propose without a real reason)
- **RxDB / better-sqlite3 reactive-DB rewrite** — contradicts the local-first JSON design; the
  desync it targeted is already fixed with refetch-on-sync.
- **Cytoscape / Obsidian-style knowledge graph** — heavyweight dep that re-presents existing data;
  against the zero-bloat mandate.
- **Post-ride structured survey** — RPE/feel already sync from Intervals.icu (`icu_rpe`).
