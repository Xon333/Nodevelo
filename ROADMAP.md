# NodeVelo roadmap

The **forward backlog — work left only.** The goal everything is measured against: **be a coaching
*layer* that fuses signals into one coherent, self-correcting athlete model — not a re-skin of
Intervals.icu.**

Companion docs: live bugs → [todo.md](todo.md) · **shipped detail** → [ARCHIVE.md](ARCHIVE.md) ·
exploratory spikes → [research.md](research.md) · how it all works → [README.md](README.md).

Only open work appears here — anything shipped moves out to [ARCHIVE.md](ARCHIVE.md). Ordered roughly by
leverage. `← X` = blocked-on / derives-from; numeric IDs (#1–4, §5–7) are stable cross-reference handles.

---

## Next up

### #2 · Per-athlete calibration — extend the framework  ⭐ (the keystone)
Bring more parameters under the same `parameterise → derive-with-fallback → stamp` machinery. The
marquee data-play — context-stamp the ledger, then auto-derive off it — has shipped its spine: the input
stamps (`formState` + morning-check), the first derived edge (`deriveTsbDeepFatigue`), and the shared
`deriveExecutionEdge` engine it now rides on (all in ARCHIVE). What's left:
- **Per-type IF cutoffs — open slivers:** surface the offsets on Settings (derived live from zones, not
  yet in `CalibrationStore`); anchor RaceSim. Shares the curve read with **Track A**.
- **More honest auto-derivations off the engine** — each new edge is a *spec* over
  `lib/correlation.ts`, not new code, but only where an **honest** execution outcome separates failures
  from successes. Active build = the morning-check **strain edge**, but **re-sourced**: motivation (and the
  whole morning read) now comes from the **Intervals.icu wellness sync**, not a NodeVelo form — see
  *Subjective wellness from Intervals.icu* below. Still lacking a defensible outcome signal: the
  `productiveOverload`/`balanced` edges and the #3 reschedule thresholds. Carbs is the other consumer →
  **Track C** (ties **#4**).
- **Pattern (follow per param):** default = today's literal value; derive with confidence-gated
  fallback; stamp on any ledger entry it scores; test that a fresh athlete scores identically.
- *Owned elsewhere:* optimal carbs g/h `→ Track C`; ACWR band + EWMA α stay on their current path.

### Subjective wellness from Intervals.icu — retire the morning-check form  ⭐ (active; resume here)
Source the morning subjective read (soreness / fatigue / stress / mood / motivation / injury) from the
Intervals.icu **wellness sync** instead of NodeVelo's own form: the athlete already logs it there next to
weight + kcal, it gets richer for free with a wearable (HRV / readiness / resting-HR auto-fill), and it
matches the "Intervals.icu is the synced SoT" pattern. **Decision: sync-only** — retire `MorningCheckIn` +
`morning-check.json`; the proactive "downgrade today?" then needs the morning wellness logged in
Intervals.icu + a sync (no instant in-app capture — an accepted tradeoff). Wellness *write-back* (so the app
could still capture it) is a separate `← §7` API piece (only `createEvent` exists today).
- ☑ **Inc 1 (shipped, `98464b9` → ARCHIVE):** the six subjective fields now map into `WellnessEntry` (raw
  Intervals 1–4 ordinals, higher = worse).
- ☑ **Inc 2 (shipped → ARCHIVE):** the ledger morning-context stamp now reads the subjective signals from
  synced wellness (`wellnessToMorningAnswers` in `morning-check.ts`, wired in `app/api/sync/route.ts`) and
  carries the composite `strain` on `RideMorningContext`. The strain edge rides the shared engine —
  `deriveStrainHigh` + `resolveStrainBandsOverride` (one derived edge → the `high` band; `med` stays
  population/override), mirroring `deriveTsbDeepFatigue` / `resolveTsbEdgesOverride`.
- ☐ **Inc 3:** run `decideMorningCheck` at sync-time off synced wellness, **wiring `resolveStrainBandsOverride`**
  into the live decision (it's built + tested but has no production caller yet — Inc 3 is the pure wiring);
  **keep** the proactive reschedule apply (`PUT` / `applyProactiveReschedule` / `RescheduleBanner` — it just
  triggers off the synced decision); remove `MorningCheckIn` + the form `POST` + `morning-check.json` (the
  decision recomputes from wellness).
- ✅ **Strain-scale decision — SETTLED (A):** map 1–4 → 1–5, **flip motivation** (Intervals higher = worse →
  formula higher = better), keep the existing formula + bands + thresholds + their tests. stress/mood/injury
  **deferred** — each becomes its own derived edge later only if it discriminates. B (native redefine) was
  rejected: it needs re-tuned bands with no ledger data to tune against yet; A is the honest on-ramp since
  `deriveStrainHigh` personalises the `high` band from real stamps as data accrues.
- 🔎 **Confirmed vs the live payload (`data/last-sync.json`):** subjective fields populate 1–4 as documented;
  **motivation** higher = worse (handled by the flip). **`sleepQuality` is null in every row** (no wearable
  autofill) → the strain `sleep` term feeds the **neutral midpoint (3)**; wire `map5(w.sleepQuality)` and
  confirm its direction only once a wearable starts filling it. **No illness/sickness field** (injury ≠ sick)
  → the synced decision can't downgrade for reported illness (accepted limitation; `injury` ≥3 as a downgrade
  trigger is a possible later add, deferred).

### Scoring-core gaps (route through #2 — they touch `execution-score.ts`)
- **Off-plan aerobic signal — fill the gap decoupling left** ⭐ — decoupling was demoted out of execution
  scoring (`ACC-2026-06-25`: too noisy per-ride, whole-ride drift is a ride-structure artifact on
  non-steady days; it's now a steady-ride **durability** reference only — `decouplingGood`). Off-plan
  rides now rest on pacing (VI) + RPE alone — the intent-independent aerobic read is gone. Give them a
  **non-circular** aerobic signal, e.g. Z2-isolated Pw:HR vs the athlete's own baseline (the same signal
  the athlete-state path already uses), so an off-plan endurance ride is graded on aerobic quality without
  inferring intensity from the type it was inferred from.
- **Recovery-specific Z2 cap** — give Recovery its own "dialed-in" cap (above Z1, not Z2) *if* the
  lenient shared aerobic cap proves too soft in real use.
- **Power-zone source of truth** — decide: keep zones strictly Intervals.icu vs. a sanctioned local
  override in the calibration framework. (Lean strict-consistency.)

### #4 · Validation loop → auto-down-weight  (time-gated ~4wk)
`intervention-log.json` has no matured verdicts yet. Once data exists, a low hit-rate in
`lib/synthesis.ts` should **demote** a directive (today it only annotates). Plus: surface
planned-vs-actual per session type and, on a consistent gap, **flag an FTP re-test** in Intervals.icu
(never write FTP locally — `physiology.json` stays the synced SoT). Ties Track B template-scoring + #2.

### #1 · CoachSnapshot — fill the reserved slots
`fuel.intakeVsNeed` + `fuel.fuelingState` are reserved `null` `← Track C / §6`.

### #3 · Proactive reschedule — slivers
Decision thresholds → per-athlete `← #2`; let the **reactive** `RescheduleBanner` adopt the shared
`findMakeUpSlot` (still rest-only); calendar mirror `← §7`; possible fully-automatic fatigue-path
downgrade (on `fatigueAlert`, before a miss).

### §5 · Athlete-state — slivers
Energy-availability evaluator `← Track C`; *derive* the per-athlete fusion weights off the engine `← #2`
(the population fold-in + override shipped — derivation is the open part); tune score→band thresholds +
headline against real use; possible score-over-time trend.

---

## Feature tracks (multi-session ⭐)

### Track A · Power-curve intelligence
The population reference multiples → `#2`; feed the rider profile into the **block review / retrospective**
(read curve shape, not just compliance); optionally persist a snapshot if rider-type-over-time is wanted.

### Track B · Session selection & variety
Per-template scoring loop (grade each long ride vs its template's expected signal — the
`durabilityTemplate` stamp is in place; ties #4 + Track C); tighten per-loading-week RaceSim only if real
use shows the LLM under-delivering.

### Track C · Fueling intelligence + the shared correlation engine  (high value)
Turn fueling from a static formula into a learned signal, on the **shared correlation engine**. The
engine itself is **built** (`lib/correlation.ts` `deriveExecutionEdge` — the generalised guarded
regression `deriveTsbDeepFatigue` now rides on; "build the derivation once, reuse it" for carbs **and**
the calibration edges). The carbs **input is now stamped** too (`fuel.carbsGPerH`, from intervals.icu
`carbs_ingested`) — sparse until athletes fill it in, accumulating like `formState` did before its edge
could fire. What's left:
- **Optimum-derivation shape** — the engine's `deriveExecutionEdge` finds a *failure edge*; carbs needs
  an *optimum* (the g/h band tied to the best outcomes). Add that shape, then per ride type correlate
  `fuel.carbsGPerH` against decoupling / RPE-vs-IF divergence / interval completion / next-day TSB →
  converge on optimal g/h, stored as a calibrated parameter `← #2`.
- **Contextual post-ride prompts** (deterministic thresholds, LLM phrases the number) — also the nudge
  that gets `carbs_ingested` filled in, which feeds the derivation above.
- **Pre-ride loading loop** — day-before carb bump before long durability, then *learn whether it
  helped* (loaded vs baseline decoupling) and stop if it doesn't move the signal.
- Surfacing layer = **§6**; reuse the one derivation in §6 + the Today tile + the Trends overlay.

---

## Platform & performance  (local-first single-user)

- **P8** — structured logging (`{route, step, status, ms}` instead of silent `catch`); AI-route cost
  guard (in-memory token-bucket on `/api/generate` + `/api/ask`).
- **P9** — PWA install (`manifest.ts` + service worker); stream `/api/generate` (blocks 1–2 min today).

---

## UI refinements

- **Nutrition-availability tile on Today** ⭐ — EA proxy `(intake − ride burn)/kg`; overlaps §6 / Track C;
  feeds `CoachSnapshot.fuel`. Deterministic.
- **Recent Baselines — pick the useful ~4** (w/kg@threshold, weekly TSS, rides/wk, CTL ramp, decoupling
  trend). Fix TSS-vs-Load naming + the weekly-hours window (todo `MR-2`); split NP from Avg + annotate-or-
  demote IF; verify tiles populate post-sync (todo `TR-4`, avg-speed `RC-1`).
- **Pw:HR × fuel Trends overlay** — carb-intake g/h on the existing `efSeries` chart (build w/ Track C).
- **Page density** — **Trends** (~1.6/2.2 folds) and **Today on mobile** still run over the fold —
  tighten card rhythm / collapse there next.

---

## Tooling & workflow (operating decision — UI refinement program)

The UI refinement program (consistency → density/IA → hybrid transparency) runs with a **broad
design-tooling adoption**, kept reversible so the unique cyberpunk identity is never homogenised.
- **Source-of-truth rule:** [`DESIGN.md`](DESIGN.md) is canonical. External kits *propose*; DESIGN.md
  *disposes* — any token/aesthetic suggestion that conflicts is rejected. Adoption is **workflow-level
  only** (Claude skills / plugins / MCPs); **no new app runtime dependencies**, so reverting is
  config-only with zero code impact.
- **Broad set (active):** design-idea kits (`awesome-claude-design` families + anti-slop kit, UI/UX
  Pro Max, a Tailwind-v4 dark kit) for ideation; a browser-verify MCP (Chrome DevTools / Playwright);
  Addy Osmani `web-quality-skills` (a11y / Core Web Vitals).
- **Selective fallback (reserve):** browser-verify MCP + the a11y/quality skill **only**. **Revert
  trigger:** on request → drop the idea-kits from config; the app does not change.

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
The "Second Brain" spike (LangGraph / Mem0 / GraphRAG / HRV) — findings, not commitments. Lean spin-offs
worth pursuing: knowledge-connections, HRV-readiness.

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
