# NodeVelo roadmap

The **forward backlog — work left only.** The goal everything is measured against: **be a coaching
*layer* that fuses signals into one coherent, self-correcting athlete model — not a re-skin of
Intervals.icu.**

Companion docs: live bugs → [todo.md](todo.md) · **shipped detail** → [ARCHIVE.md](ARCHIVE.md) ·
exploratory spikes → [research.md](research.md) · how it all works → [README.md](README.md).

Shipped items appear here only as a one-line pointer with what's *still open* under them; the full
record is in [ARCHIVE.md](ARCHIVE.md). Ordered roughly by leverage. `← X` = blocked-on / derives-from.

---

## Next up

### #2 · Per-athlete calibration — extend the framework  ⭐ (the keystone)
*Framework + decoupling cutoff shipped (ARCHIVE).* Bring more parameters under the same
`parameterise → derive-with-fallback → stamp` machinery:
- **Per-type IF cutoffs** — *shipped (ARCHIVE).* `deriveIfBandOffsets` shifts the IF-vs-type bands to
  the athlete's own power-zone %FTP edges, bounded + 0 for default zones (byte-identical scoring),
  threaded through `resolvedCal` to both ledger + today scoring; the per-type offset is now also
  **stamped onto each ledger entry** for provenance (ARCHIVE). _Open slivers:_ surface on Settings
  (derived live from zones, not yet in `CalibrationStore`); anchor RaceSim. Shares the curve read with **Track A**.
- **Fold in the CR-11 constants** (population fallback, opportunistic): morning-check strain bands +
  TSB-deep cutoff; durability `88%` floor + `≤122%/≤20m` insert envelope; athlete-state fusion weights
  (§5). _`resolveTsbModifier` edges (the TSB adaptation window) — shipped (ARCHIVE): population-validated
  defaults + manual override, the ACWR-bands pattern (not auto-derived — no honest per-athlete signal)._
- **Pattern (follow per param):** default = today's literal value; derive with confidence-gated
  fallback; stamp on any ledger entry it scores; test that a fresh athlete scores identically.
- *Owned elsewhere:* optimal carbs g/h `→ Track C`; ACWR band + EWMA α stay on their current path.

### Scoring-core gaps (route through #2 — they touch `execution-score.ts`)
- **Z2 "dialed-in" overstated** — *shipped (ARCHIVE).* `timeAboveZ2Fraction` + a bounded ±2 discipline
  band score the share of an easy ride spent above the aerobic cap (power zones 3+), the spikes a clean
  *average* IF hides; surfaced in CoachSnapshot (% above cap). _Open sliver:_ a Recovery-specific cap
  (above Z1, not Z2) if the lenient shared cap proves too soft.
- **Power-zone source of truth** — decide: keep zones strictly Intervals.icu vs. a sanctioned local
  override in the calibration framework. (Lean strict-consistency.)

### #4 · Validation loop → auto-down-weight  (time-gated ~4wk)
`intervention-log.json` has no matured verdicts yet. Once data exists, a low hit-rate in
`lib/synthesis.ts` should **demote** a directive (today it only annotates). Plus: surface
planned-vs-actual per session type and, on a consistent gap, **flag an FTP re-test** in Intervals.icu
(never write FTP locally — `physiology.json` stays the synced SoT). Ties Track B template-scoring + #2.

### #1 · CoachSnapshot — fill the reserved slots
*Foundations + Today card + per-athlete `form.tsbModifier` band edges shipped (ARCHIVE).* Open:
`fuel.intakeVsNeed` + `fuel.fuelingState` are reserved `null` `← Track C / §6`.

### #3 · Proactive reschedule — slivers
*Shipped (ARCHIVE).* Open: decision thresholds → per-athlete `← #2`; let the **reactive**
`RescheduleBanner` adopt the shared `findMakeUpSlot` (still rest-only); calendar mirror `← §7`;
possible fully-automatic fatigue-path downgrade (on `fatigueAlert`, before a miss).

### §5 · Athlete-state — slivers
*v1 fusion shipped (ARCHIVE).* Open: energy-availability evaluator `← Track C`; per-athlete fusion
weights `← #2`; tune score→band thresholds + headline against real use; possible score-over-time trend.

---

## Feature tracks (multi-session ⭐)

### Track A · Power-curve intelligence
*Weak-point optimizer + plan-cue generalization shipped (ARCHIVE).* Open: the population reference
multiples → `#2`; feed the rider profile into the **block review / retrospective** (read curve shape,
not just compliance); optionally persist a snapshot if rider-type-over-time is wanted.

### Track B · Session selection & variety
*Goal-driven selection + durability taxonomy shipped (ARCHIVE).* Open: per-template scoring loop
(grade each long ride vs its template's expected signal — the `durabilityTemplate` stamp is in place;
ties #4 + Track C); tighten per-loading-week RaceSim only if real use shows the LLM under-delivering.

### Track C · Fueling intelligence  (inputs already synced — high value)
All open. Turn fueling from a static formula into a learned signal:
- **Correlation engine** — per ride type, correlate synced carbs g/h against decoupling, RPE-vs-IF
  divergence, interval completion, next-day TSB → converge on the athlete's optimal g/h, stored as a
  calibrated parameter `← #2`.
- **Contextual post-ride prompts** (deterministic thresholds, LLM phrases the number).
- **Pre-ride loading loop** — day-before carb bump before long durability, then *learn whether it
  helped* (loaded vs baseline decoupling) and stop if it doesn't move the signal.
- Surfacing layer = **§6**; build the derivation once, reuse in §6 + the Today tile + the Trends overlay.

### Track D · Second-brain learning
*Structured retrospective reflection + athlete-quirk extraction shipped (ARCHIVE).* Open: only
confidence-weighted modeling, which is **folded into #2's** confidence/lock layer — no standalone work.

---

## Platform & performance  (local-first single-user; P4–P7 shipped — ARCHIVE)

- **P8** — structured logging (`{route, step, status, ms}` instead of silent `catch`); AI-route cost
  guard (in-memory token-bucket on `/api/generate` + `/api/ask`).
- **P9** — PWA install (`manifest.ts` + service worker); stream `/api/generate` (blocks 1–2 min today).

---

## UI refinements  (Images 1–5 audit mostly shipped — ARCHIVE)

- **Nutrition-availability tile on Today** ⭐ — EA proxy `(intake − ride burn)/kg`; overlaps §6 / Track C;
  feeds `CoachSnapshot.fuel`. Deterministic.
- **Recent Baselines — pick the useful ~4** (w/kg@threshold, weekly TSS, rides/wk, CTL ramp, decoupling
  trend). Fix TSS-vs-Load naming + the weekly-hours window (todo `MR-2`); split NP from Avg + annotate-or-
  demote IF; verify tiles populate post-sync (todo `TR-4`, avg-speed `RC-1`).
- **Pw:HR × fuel Trends overlay** — carb-intake g/h on the existing `efSeries` chart (build w/ Track C).
- **Page density** — Profile + Plan shipped (ARCHIVE); **Trends** (~1.6/2.2 folds) and **Today on mobile**
  still run over the fold — tighten card rhythm / collapse there next.

*Shipped (ARCHIVE): MetricTip hovers incl. TR-3, mobile zero-horizontal-overflow audit, Profile/Plan density.*

---

## Larger / scoped (when wanted)

- **6a · Event-aware race planning** ⭐ — structured event (date / A-B-C priority / type) → taper +
  carb-load + race-day timeline. KB already holds the protocol; LLM only phrases it, never invents grams.
- **§6 · Nutrition energy-balance** — Track C's surfacing layer: weekly kJ-out vs intake → `fuelingState`;
  then precise fluid/sodium/carb targets pre/intra/post by IF + duration.
- **§7 · Calendar flexibility** — condition-driven swaps + **bidirectional Intervals.icu sync**
  (large + API-risk; only `createEvent` exists today). Unblocks the calendar-mirror slivers under #3.
- **8 · NP-missing → "unverified"** — when NP is absent on an outdoor ride, stamp the entry `unverified`
  instead of scoring off raw avg power. Small.

---

## Exploratory research → [research.md](research.md)
The "Second Brain" spike (LangGraph / Mem0 / GraphRAG / HRV) — findings, not commitments. The real gap
was signal fusion (§5, shipped); lean spin-offs worth pursuing: knowledge-connections, HRV-readiness.

---

## Decided against (don't re-propose without a real reason)
- **Postgres/Supabase + RLS · blob KB storage · auth middleware** — assumed a multi-tenant SaaS; NodeVelo
  is local-first single-user, so `fs`/JSON *is* the store. Revisit only on a deliberate hosted pivot.
- **pgvector RAG for the KB** — small markdown files fit cheaply in the prompt; the context-dump is intentional.
- **RxDB reactive-DB rewrite** — contradicts local-first JSON; the desync it targeted is fixed with refetch-on-sync.
- **SQLite (`better-sqlite3` + Drizzle + `sqlite-vec`) — deferred, not rejected.** Wins are mostly
  theoretical at single-user scale and its standout unlock (`sqlite-vec`) is gated on semantic RAG (also
  deferred). Reconsider when semantic RAG is committed or data volume / multi-user justifies it.
- **uPlot / canvas charting** — `buildRideTrace` already downsamples to ~240 points; no chart renders raw 1 Hz.
- **Cytoscape / knowledge-graph UI** — heavyweight dep re-presenting existing data.
- **Post-ride structured survey** — RPE/feel already sync from Intervals.icu (`icu_rpe`).
