# NodeVelo roadmap

The **forward backlog — work left only.** The goal everything is measured against: **be a coaching
*layer* that fuses signals into one coherent, self-correcting athlete model — not a re-skin of
Intervals.icu.**

Companion docs: live bugs → [todo.md](todo.md) · **shipped detail** → [ARCHIVE.md](ARCHIVE.md) ·
exploratory spikes → [research.md](research.md) · how it all works → [README.md](README.md).

Only open work appears here — anything shipped moves out to [ARCHIVE.md](ARCHIVE.md). Ordered roughly by
leverage. `← X` = blocked-on / derives-from; numeric IDs (#1–4, §5–7) are stable cross-reference handles.

---

## ⚑ State-of-the-app audit (2026-06-30)

Senior-dev + cycling-coach review against the five README pillars. **Verdict: engineering quality
substantially exceeds data maturity** — the deterministic core and the learning architecture are
well-built, but the *self-correcting* loop (the thesis) has barely turned over.

**Central finding — the trainable corpus is ~2 weeks, not 6 months.** The score ledger holds 114
entries but only **13 `planned`** (planned rides are the only ones that teach the model); 100 are
`legacy`. The cause is **not** elapsed time — the athlete has trained 6 mo / 6 days-a-wk (140 rides
in-window). It's that the **first in-app block was written 2026-06-15**, so only rides on/after that
date match an app prescription; the prior ~6 months are real training but **un-prescribed from the
app's view**, so they're `legacy` and excluded from execution/adherence learning by design ("no plan
to be off"). Compounding it *(at audit time)*: `buildRideScores` knew only the CURRENT block and no
`block-history` retained per-day prescriptions, so historical planned rides couldn't be re-matched on a
ledger rebuild (only frozen-in-place entries survived — LEDGER-1). **Resolved 2026-07-02** — see
"Durable planned corpus" in [ARCHIVE.md](ARCHIVE.md); fixes future corpus *shrinkage*, not the
pre-2026-06-15 numbers above (that's SUB-2, paused, below). `intervention-log.json` doesn't exist yet →
**#4 validation has 0 records**; the athlete model runs at n=1–8 per type (below the
≥3-obs trend gate and the correlation engine's discrimination gate) → most learning returns population
defaults.

**Holds well (don't disturb):** pillar 1 (layer-not-replacement), pillar 2 (deterministic core /
generative shell — nutrition + interval protocols guarded on *both* ends, generation & validation),
pillar 3 (two-memory split, structurally enforced), pillar 4 (immutable ledger). The "calibrated
honesty" UX (provenance stamps, confidence tiers, withheld thin reads) is a real differentiator.

**Strict findings (severity):**
- ⚠️ **Learning loop dormant for lack of first-party data** (above). #4 is now mechanism-complete — it
  both *measures* and *demotes* — but `intervention-log.json` is empty, so there are 0 matured verdicts
  to act on; per-athlete calibration/correlation likewise sit on defaults below their gates.
- ⚠️ **Planned corpus isn't durable across blocks** — **Resolved 2026-07-02** — see "Durable planned
  corpus" in [ARCHIVE.md](ARCHIVE.md): `block-history` now retains per-day prescriptions, so adherence
  history survives block roll-off + rebuilds. The backfill half (legacy pre-app months) was investigated
  and **paused** — see SUB-2 below. (The legacy rides *can* already feed FTP-independent trends —
  Pw:HR, polarization, volume baselines — which need no prescription.)
- ⚠️ **Test coverage lopsided** — ~all 49 suites are `lib/*`; the 494-line `sync` + 272-line `generate`
  routes (reconciliation, scoring orchestration, tool-use parsing) are the highest-stakes, least-tested
  code, and they guard the immutable ledger everything learns from. **Resolved 2026-07-02** — see "Route tests (sync + generate)" in [ARCHIVE.md](ARCHIVE.md).
- 🔸 **No periodization above the block** (as of this 2026-06-30 audit) — no season/macrocycle scope, no
  cross-block progression, no taper/peak logic (`6a` deferred). The planner optimises 2–4 weeks in
  isolation; previous-block insight only flows as retrospective `next_block_seeds`, and there are no
  completed blocks yet. **Resolved 2026-07-01** — see "Macro periodization & season scope" below.
- 🔸 **Local-first durability** rests on homegrown `.bak` files on one machine. **Off-machine backup
  resolved 2026-07-02** — see "Off-machine backup" in [ARCHIVE.md](ARCHIVE.md). Trunk-based with a
  concurrent agent is still operationally fragile (branch discipline, SUB-4's other half).
- 🔸 **Observability + cost guard absent (P8)** — silent `catch`es, unbounded AI routes; generation
  blocks 1–2 min with no streaming (P9).
- 🔸 **Fueling is per-session, not periodised**; strength is a stub (5 kcal/min); recovery is
  one-dimensional (HRV honestly gated off — no source).
- 🔸 **Doc drift** (as of this 2026-06-30 audit) — README claimed the nutrition formula computes protein
  (carbs only) and cited a stale test count. Both fixed since in a full documentation sweep (2026-07-01);
  a stale count is a recurring failure mode worth staying alert to as work continues.

**Priorities (data > features):**
1. **Turn the loop over.** Retain block prescriptions (`block-history`) — ✅ done, 2026-07-02 (SUB-1).
   #4 measurement + demote mechanisms — ✅ done, 2026-07-02 (both halves). Left: reduce friction so
   generate→ride→score→learn actually accrues the first matured verdicts (the loop is code-complete but
   dormant until data).
2. **Test the `sync` + `generate` routes** — protect the ledger from silent reconciliation/scoring bugs. ✅ done, 2026-07-02 (SUB-3).
3. ✅ **Off-machine backup of `data/`** done, 2026-07-02 (SUB-4, half). Left: branch discipline for the
   shared checkout.
4. **Periodization / season scope** — ✅ done (see "Macro periodization & season scope" below); event-aware
   *race* planning (`6a`, the surfacing layer once an athlete adds an event) remains open.

_Expanded below: **Data substrate** (priority 1's block-history half shipped 2026-07-02, its backfill
half paused; priority 3 still a plain open item, no open design questions) and **Macro periodization &
season scope** (priority 4, since shipped — expanded section now records what's live + the tracked debt,
not open questions)._

---

## Data substrate — turn the loop over ⭐ (audit P1–3)

The foundation: most of the learning engine is dormant for lack of first-party data. SUB-1 (block-history
durability) shipped 2026-07-02 → [ARCHIVE.md](ARCHIVE.md); SUB-2 (legacy backfill) investigated and
paused same day; SUB-3 (route tests) shipped 2026-07-02 → [ARCHIVE.md](ARCHIVE.md). SUB-4's backup half
shipped 2026-07-02 → [ARCHIVE.md](ARCHIVE.md); its branch-discipline half remains open below, a plain
backlog item — no open design questions.

### SUB-5 · First loop-turnover readiness — **deadline 2026-07-12** (current block's end)
The first-ever full turnover (retrospective → `block-history.json` born → next block write →
`intervention-log.json` born) fires around 2026-07-12, and neither first-write path has ever run
live — `/api/retrospective` is the only turnover-critical route with **no route test**, and it
destructively clears the current block. Plan (tests + the season-stamp known-debt fix + an attended
runbook): [first-loop-turnover-readiness](docs/superpowers/plans/2026-07-03-first-loop-turnover-readiness.md).
If this event silently fails, audit-P1 loop data slips a full block.

### SUB-2 · Legacy backfill importer — paused (2026-07-02)
**Problem.** The prior ~6 months (100 legacy rides) followed real structure, but the app has no
prescription to grade them against → excluded from execution learning.
**Live-API check (2026-07-02) falsified the "whole window recoverable" assumption.** Queried
Intervals.icu's actual `/events` endpoint against the 100 legacy dates: only **28 have a same-date
calendar event at all** (22 with a machine-parseable `workout_doc.steps`); **72 have none** — Jan/Feb
(29 rides) has zero calendar events in the window. Athlete's read: the legacy structure was Z2 +
2 interval sessions/week, and only the interval days tended to get a named calendar entry — Z2 was
routine enough not to warrant one. So the calendar recovers roughly the hard-day subset, not the
window.
**Decision (2026-07-02):** paused as an engineering effort — 22–28% recovery doesn't clearly justify
an importer. Athlete will handle any legacy relabeling manually (e.g. renaming calendar events) if they
want specific rides gradable. Revisit only if that manual path proves painful enough to reopen, or a
better recovery signal surfaces (the ride's own executed profile, without an independent prescription,
is circular and was not pursued).

### SUB-4 · `data/` durability + branch discipline
✅ Off-machine backup done, 2026-07-02 → [ARCHIVE.md](ARCHIVE.md). Left: lightweight branch discipline
for the shared trunk checkout (the immutable ledger sits behind homegrown `.bak` files on one disk *and*
a trunk shared with a concurrent agent session — two different fragility axes, only the first is closed).

---

## Macro periodization & season scope ⭐ (audit P4 · shipped 2026-07-01 → ARCHIVE)

✅ **Fully shipped.** The whole arc the P4 audit finding ("no periodization above the block") opened is
now live end to end: the macro-periodization engine (`lib/season.ts`), `/api/season`, generate-flow
integration (`seasonContext` + `validateSeasonFit`, `lengthWeeks` 2/4/6/8), the `SeasonRoadmap` stepper
UI on `/plan`, the Season event-entry section on `/profile` (objective field + add/edit/delete event
list), Goals/Weakpoints centralization (off hand-edited markdown into a real JSON form, one-time
migrated), the season-aware block generator (suggested length + focus-filtered goal pre-fill + a
readout), and a block-completion prompt on `/today`. Mode-C (no-event, rolling base→build→realize cycle
with deload cadence + ACWR-capped load ramp) is the live default; event-anchored mode (backward
taper→peak→build schedule) is built and tested and now **activatable** through the Season UI, but still
**dormant** until an athlete actually adds a future A-priority event. Full design/build records:
[macro-periodization](docs/superpowers/specs/2026-07-01-macro-periodization-design.md)
([plan](docs/superpowers/plans/2026-07-01-macro-periodization.md)) ·
[season-event-entry-ui](docs/superpowers/specs/2026-07-01-season-event-entry-ui-design.md) ·
[goals-weakpoints-centralization](docs/superpowers/specs/2026-07-01-goals-weakpoints-centralization-design.md) ·
[season-block-hierarchy](docs/superpowers/specs/2026-07-01-season-block-hierarchy-design.md)
([plan](docs/superpowers/plans/2026-07-01-season-block-goals-flow.md)) ·
[block-completion-prompt](docs/superpowers/specs/2026-07-01-block-completion-prompt-design.md). Shipped-work
detail → [ARCHIVE.md](ARCHIVE.md).

### Known debt (accept-as-tracked)
- Event-mode peak vs. taper share one `focus: "sharpen"` value → same roadmap color/label, only the phase
  caption distinguishes them. Cosmetic; only visible once event mode activates.
- `anaerobic` is a valid build focus but unreachable via the default rotation fallback (only via a confident
  limiter) — intentional per KB, but the two lists (`BUILD_FOCI` vs `defaultBuildOrder()`) silently diverge.
- No re-plan trigger from the Season form itself — the next `POST /api/generate` already re-plans and
  activates event mode the moment a future A-event exists. No UI warning about multiple A-events or the
  engine's array-order tie-break. No dedicated `/settings`-style page for events — Profile houses it.
- The Goals form's Focus dropdown omits `sharpen` (the race-taper focus) — the API/engine both accept it,
  only the picker is short one option, so a `sharpen`-focused period can't have a goal directly authored
  via the UI yet. One-line follow-up: add `<option value="sharpen">`.
- `PlanView`'s season-context fetch can silently overwrite a manual in-progress edit to the goal textarea
  if the athlete types between the two independent profile/season fetches resolving — a narrow,
  single-user timing window, not observed in practice.

**Ties:** `6a` event-aware race planning is the surfacing of event mode; `§7` calendar; `#4` validates whether
a phase sequence worked; `#2` calibrates the ramp/deload constants (currently KB-grounded population defaults).

---

## Next up

### #2 · Per-athlete calibration — extend the framework  ⭐ (the keystone)
Bring more parameters under the same `parameterise → derive-with-fallback → stamp` machinery. The
marquee data-play — context-stamp the ledger, then auto-derive off it — has shipped its spine: the input
stamp (`formState`; the morning-check stamp was removed with the subjective-wellness revert), the first
derived edge (`deriveTsbDeepFatigue`), and the shared `deriveExecutionEdge` engine it now rides on (all in
ARCHIVE). What's left:
- **Per-type IF cutoffs — open slivers:** ✅ offsets now surfaced read-only on `/model`
  (`ifBandOffsetRows` → `IfBandOffsets`, derived live from synced zones). Left: RaceSim stays intentionally
  unanchored (surgy/mixed — no single zone edge; revisit only if real use wants it); the offsets are
  derived-live (not persisted in `CalibrationStore`) — fine unless a manual override is ever wanted. Shares
  the curve read with **Track A**.
- **More honest auto-derivations off the engine** — each new edge is a *spec* over
  `lib/correlation.ts`, not new code, but only where an **honest** execution outcome separates failures
  from successes. (The morning-check strain edge was dropped with the subjective-wellness revert — the
  morning read is now a manual flag, not a derived signal.) Still lacking a defensible outcome signal: the
  `productiveOverload`/`balanced` edges and the #3 reschedule thresholds. Carbs is the other consumer →
  **Track C** (ties **#4**).
- **Pattern (follow per param):** default = today's literal value; derive with confidence-gated
  fallback; stamp on any ledger entry it scores; test that a fresh athlete scores identically.
- *Owned elsewhere:* optimal carbs g/h `→ Track C`; ACWR band + EWMA α stay on their current path.

### Morning override — a manual "feeling ill / extreme fatigue" flag  (shipped → ARCHIVE)
**Reversed direction (2026-06-26).** The subjective-wellness sync pivot (Inc 1 + Inc 2) was removed — it was
latent/dead and un-utilitarian, and a wearable will give objective morning-readiness (HRV / sleep /
resting-HR) that's strictly better. The morning read is now a small Today **two-button flag** (feeling ill /
extreme fatigue) that downgrades today's quality session; objective fatigue stays surfaced by `readiness`.
Removed: the six subjective `WellnessEntry` fields, `wellnessToMorningAnswers`, the strain bands + edge
(`deriveStrainHigh` / `resolveStrainBandsOverride`), the ledger morning stamp. Objective wellness
(weight / CTL/ATL / HRV / sleep / kcal) is untouched. Spec:
`docs/superpowers/specs/2026-06-26-remove-subjective-wellness-manual-flag-design.md`.
- *Future:* when a wearable lands, objective morning-readiness slots into the same place (the load model /
  athlete-state), replacing the manual flag for the fatigue case.

### Scoring-core gaps (route through #2 — they touch `execution-score.ts`)
- ✅ **Off-plan aerobic signal — fill the gap decoupling left (shipped → ARCHIVE).** Off-plan rides are now
  graded on a non-circular aerobic read: the ride's Z2-isolated Pw:HR vs the athlete's own trailing baseline
  (`lib/aerobic.ts`, shared with the athlete-state driver), ±2 in `computeExecutionScore` for intrinsic
  rides. Baseline is per-ride strictly-before (no self-reference); a thin-Z2 ride or missing baseline → no
  effect. Applies in the ledger + the Today card.
- **Recovery-specific Z2 cap** — give Recovery its own "dialed-in" cap (above Z1, not Z2) *if* the
  lenient shared aerobic cap proves too soft in real use.
- **Power-zone source of truth** — decide: keep zones strictly Intervals.icu vs. a sanctioned local
  override in the calibration framework. (Lean strict-consistency.)

### #4 · Validation loop → auto-down-weight  (mechanism-complete; dormant until data)
✅ Both halves shipped 2026-07-02 — the loop is code-complete end to end. Measurement: planned-vs-actual
per session type + the execution-driven FTP-retest advisory. Demote: `synthesizeCoachingDirectives` now
**demotes** a directive whose past nudges have a proven-poor track record (≥3 decisive verdicts, ≤34%
validated) — reframing it and sinking it below still-trusted ones, not just annotating — see "Directive
demote" and "FTP-retest advisory + planned-vs-actual" in [ARCHIVE.md](ARCHIVE.md). **Nothing left to
build; dormant until data:** `intervention-log.json` is still empty, so no matured verdicts exist to
demote against yet — the loop won't visibly act until real generate→ride→score verdicts accrue over ~4wk
horizons (a friction/usage problem, not code). Thresholds (`FTP_RETEST_DEFAULTS`,
`DIRECTIVE_DEMOTE_DEFAULTS`) are population defaults — `← #2` hooks. Ties Track B template-scoring + #2.

### #1 · CoachSnapshot — fill the reserved slots
✅ The energy-availability read now fills both slots (`fuelingState` = low/adequate/ample band,
`intakeVsNeed` = its kcal/kg figure) — computed once in `resolveCoachSignals`, surfaced in both LLM paths
and the athlete card → ARCHIVE. Left: the *precise* weekly intake-vs-need ratio (kJ-out vs intake) is still
`§6` energy-balance; a *personalised* adequate line is `← Track C`. #1 stays as the cross-ref handle.

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
✅ The rider profile now feeds the **retrospective** (curve shape, not just compliance): the 84-day profile
goes into both retrospective prompts + a deterministic curve-shape seed (`powerProfileSeed`). The profile
already fed block generation. Left: the population reference multiples → `#2` (still local magic-numbers in
`power-profile.ts`); optionally persist a per-block snapshot for *rider-type-over-time* (deferred — one
block barely moves the curve, so the over-time read only pays off across a season).

### Track B · Session selection & variety
✅ Per-template scoring loop shipped: the durability template is stamped on the week's long Z2 ride at write
time, and `computeExecutionScore` grades that ride against its template's expected signal — above-Z2 time is
no longer penalised for B–E (they embed efforts), and `gradeDurabilityDelivery` (`lib/durability-score.ts`)
checks whether the prescribed efforts actually landed at the right intensity + timing (±2). The template is
also stamped on the ledger entry for #4 outcome attribution. Limits: the effort-delivery grade needs
interval timing only the **today** path fetches (the ledger gets the template-aware above-Z2 only); the
**long-ride identification** is a write-time heuristic (Z2 day near the block's longest Z2), and it activates
on the next written block. Left: tighten per-loading-week RaceSim only if real use shows under-delivery.

### Track C · Fueling intelligence + the shared correlation engine  (high value)
Turn fueling from a static formula into a learned signal, on the **shared correlation engine**. The
engine itself is **built** (`lib/correlation.ts` `deriveExecutionEdge` — the generalised guarded
regression `deriveTsbDeepFatigue` now rides on; "build the derivation once, reuse it" for carbs **and**
the calibration edges). The carbs **input is now stamped** too (`fuel.carbsGPerH`, from intervals.icu
`carbs_ingested`) — sparse until athletes fill it in, accumulating like `formState` did before its edge
could fire. What's left:
- ✅ **Optimum-derivation shape — engine + first consumer shipped, 2026-07-02** (`deriveOptimum` in
  `lib/correlation.ts`; `carbsOptimum` derived each sync from steady long rides classified against the
  athlete's own `decouplingGood`, overridable on `/model` — see ARCHIVE). Dormant until `carbs_ingested`
  data accrues (like every calibrated param). Left: per-ride-type optimums + richer outcome signals
  (RPE-vs-IF divergence, interval completion, next-day TSB) once the endurance read proves out.
- **Contextual post-ride prompts** (deterministic thresholds, LLM phrases the number) — also the nudge
  that gets `carbs_ingested` filled in, which feeds the derivation above. **Implementation plan ready:**
  [postride-fuel-prompt](docs/superpowers/plans/2026-07-03-postride-fuel-prompt.md) (success metric
  inside: fuel-stamp fill-rate ≥60% of qualifying rides in ~3 wks, `carbsOptimum.dataPoints` 1 → ≥8).
- **Pre-ride loading loop** — day-before carb bump before long durability, then *learn whether it
  helped* (loaded vs baseline decoupling) and stop if it doesn't move the signal.
- Surfacing layer = **§6**; reuse the one derivation in §6 + the Today tile + the Trends overlay.

---

## Platform & performance  (local-first single-user)

- **P8** — ✅ structured logging done, 2026-07-02 (`lib/log.ts`, routed through the substrate-facing
  silent catches — see [ARCHIVE.md](ARCHIVE.md)). Left: AI-route cost guard (in-memory token-bucket on
  `/api/generate` + `/api/ask`).
- **P9** — PWA install (`manifest.ts` + service worker); stream `/api/generate` (blocks 1–2 min today).

---

## UI refinements

- **UX program → [`UX-MASTERPLAN.md`](UX-MASTERPLAN.md)** (2026-07-03 full-product audit; governed by
  [`UX-CONSTITUTION.md`](UX-CONSTITUTION.md)) — the ranked S1–S3 backlog lives there, not here.
  Waves 1–2 shipped 2026-07-04: tap/focus-capable explanation layer (was hover-only → invisible on
  mobile), visible degraded-states for best-effort fetches, dark-mode FOUC script, and the Today page's
  one-verdict restructure (was 4 same-altitude instruments in 3 vocabularies → the fused athlete-state
  card alone, evidence collapsed beneath it). Open: S1-4 empty-states-as-onboarding + the S2/S3
  page-level backlog, Waves 3–4 sequenced in the plan.
- **Energy-availability tile — open slivers** — the deterministic EA proxy shipped (Today, trailing-window
  `(intake − ride burn)/kg`; now reads low/adequate/ample on a body-weight basis, and feeds
  `CoachSnapshot.fuel` `← #1` → ARCHIVE). Left: a *personalised* "adequate" line `← Track C` calibration.
- **Pw:HR × fuel Trends overlay** — carb-intake g/h on the existing `efSeries` chart (build w/ Track C).
- **Page density** — **Trends** (~1.6/2.2 folds) and **Today on mobile** still run over the fold (the EA tile
  added one more row to the readiness glance) — tighten card rhythm / collapse there next.

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
