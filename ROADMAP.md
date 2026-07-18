# NodeVelo roadmap

The **forward backlog — work left only.** The goal everything is measured against: **be a coaching
*layer* that fuses signals into one coherent, self-correcting athlete model — not a re-skin of
Intervals.icu.**

Companion docs: live bugs → [todo.md](todo.md) · **shipped detail** → [ARCHIVE.md](ARCHIVE.md) ·
exploratory spikes → [research.md](research.md) · how it all works → [README.md](README.md).

Only open work appears here — anything shipped moves out to [ARCHIVE.md](ARCHIVE.md). Ordered roughly by
leverage. `← X` = blocked-on / derives-from; numeric IDs (#1–4, §5–7, Tracks A–C) are stable
cross-reference handles — append new ones, never renumber.

---

## ⚑ State of the app — the one strategic fact

From the 2026-06-30 senior-dev + coach audit (resolved findings → [ARCHIVE.md](ARCHIVE.md)):
**engineering quality substantially exceeds data maturity.** The deterministic core, the five README
pillars, and the "calibrated honesty" UX all hold — but the *self-correcting* loop (the thesis) has
barely turned over, because the trainable corpus is thin:

- Only rides on/after the **first in-app block (2026-06-15)** match an app prescription; the ~6
  months before are `legacy` — real training, but excluded from execution/adherence learning by
  design ("no plan to be off"). Recovering them was investigated and paused (SUB-2 below).
- `intervention-log.json` is still empty → **#4 has 0 matured verdicts**; the athlete model runs at
  n=1–8 per type, below its ≥3-obs trend gate and the correlation engine's discrimination gates →
  most calibrated params still return population defaults.

**The standing priority is therefore data over features:** every learning mechanism is
code-complete and dormant — the loop starts paying out only as generate→ride→score→learn cycles
accrue. The first full turnover is SUB-5, days away.

---

## Data substrate — turn the loop over ⭐ (audit P1–3)

SUB-1 (block-history durable corpus), SUB-3 (sync/generate route tests), and SUB-4's off-machine
backup half all shipped 2026-07-02 → [ARCHIVE.md](ARCHIVE.md).

### SUB-5 · First loop turnover — **run the runbook, ~2026-07-12** (current block's end)
The build half shipped 2026-07-03 → [ARCHIVE.md](ARCHIVE.md) (`/api/retrospective` route tests, the
season-stamp fix, the attended runbook). What's left is the *event itself*: the first-ever full
turnover (retrospective → `block-history.json` born → next block write → `intervention-log.json`
born) fires around 2026-07-12 and must be run attended per the runbook in
[WORKFLOW.md](WORKFLOW.md) — backup first; if any step fails, restore and report. If it silently
fails, audit-P1 loop data slips a full block.

### SUB-2 · Legacy backfill importer — paused (2026-07-02)
A live-API check showed the Intervals.icu calendar recovers only ~22–28% of the 100 legacy rides
(the hard-day subset — Z2 days rarely got calendar entries), which doesn't justify an importer.
Full investigation record → [ARCHIVE.md](ARCHIVE.md). The athlete relabels legacy calendar events
manually if specific rides should become gradable. Revisit only if that manual path proves painful
or a better recovery signal surfaces. (Legacy rides *do* already feed FTP-independent trends —
Pw:HR, polarization, volume baselines — which need no prescription.)

### SUB-4 · Branch discipline (remaining half)
The immutable ledger's off-machine backup shipped → [ARCHIVE.md](ARCHIVE.md). Left: lightweight
branch discipline for the trunk checkout shared with a concurrent agent session — the second
fragility axis is operational, not storage.

---

## Next up

### #2 · Per-athlete calibration — extend the framework  ⭐ (the keystone)
Bring more parameters under the same `parameterise → derive-with-fallback → stamp` machinery. The
spine has shipped (the `formState` ledger stamp, the first derived edge `deriveTsbDeepFatigue`, and
the shared `deriveExecutionEdge` engine — all in ARCHIVE). What's left:
- **Per-type IF cutoffs — open slivers:** RaceSim stays intentionally unanchored (surgy/mixed — no
  single zone edge; revisit only if real use wants it); the `/model` offsets are derived-live, not
  persisted in `CalibrationStore` — fine unless a manual override is ever wanted. Shares the curve
  read with **Track A**.
- **More honest auto-derivations off the engine** — each new edge is a *spec* over
  `lib/correlation.ts`, not new code, but only where an **honest** execution outcome separates
  failures from successes. Still lacking a defensible outcome signal: the
  `productiveOverload`/`balanced` edges and the #3 reschedule thresholds. Carbs is the other
  consumer → **Track C** (ties **#4**).
- **Pattern (follow per param):** default = today's literal value; derive with confidence-gated
  fallback; stamp on any ledger entry it scores; test that a fresh athlete scores identically.
- *Owned elsewhere:* optimal carbs g/h `→ Track C`; ACWR band + EWMA α stay on their current path.

### Scoring-core gaps (route through #2 — they touch `execution-score.ts`)
- **Recovery-specific aerobic cap** — give Recovery its own "dialed-in" HR band (above Z1, not Z2)
  *if* the lenient shared `aerobicDisciplineRead` bands (2026-07-11 HR-judged rework → ARCHIVE) prove
  too soft for Recovery specifically in real use.
- **Power-zone source of truth** — decide: keep zones strictly Intervals.icu vs. a sanctioned local
  override in the calibration framework. (Lean strict-consistency.)

### #4 · Validation loop → auto-down-weight  (mechanism-complete; dormant until data)
Both halves shipped 2026-07-02 → [ARCHIVE.md](ARCHIVE.md) ("Directive demote", "FTP-retest advisory
+ planned-vs-actual"). **Nothing left to build** — the loop won't visibly act until real
generate→ride→score verdicts accrue over ~4wk horizons (a usage problem, not code). Thresholds
(`FTP_RETEST_DEFAULTS`, `DIRECTIVE_DEMOTE_DEFAULTS`) are population defaults — `← #2` hooks. Ties
Track B template-scoring + #2.

### #1 · CoachSnapshot — fill the reserved slots
Reserved slots all filled (EA-proxy `fuelingState`/`intakeVsNeed`, then the precise weekly ratio →
ARCHIVE) → #1 stays as the cross-ref handle; nothing left under it. (The separately-tracked
*personalised* adequate line is `← Track C` — not one of #1's slots.)

### #3 · Proactive reschedule — slivers
Decision thresholds → per-athlete `← #2`; let the **reactive** `RescheduleBanner` adopt the shared
`findMakeUpSlot` (still rest-only); possible fully-automatic fatigue-path downgrade (on
`fatigueAlert`, before a miss).

### §5 · Athlete-state — slivers
Energy-availability evaluator `← Track C`; *derive* the per-athlete fusion weights off the engine
`← #2` (the population fold-in + override shipped — derivation is the open part); tune score→band
thresholds + headline against real use; possible score-over-time trend.

### Season engine — known debt (accept-as-tracked)
The macro-periodization arc + scored coverage selector + macro-structure layer (bounded arcs, genuine
season breaks, FTP retest nudge) are fully shipped → [ARCHIVE.md](ARCHIVE.md); specs/plans under
`docs/superpowers/`. The old "anaerobic unreachable via the default fallback" debt item is resolved
(the scored selector replaced that fallback entirely) and removed.

**Season is currently NOT shaping or gating block generation (2026-07-16 athlete decision, `←` a
future dedicated research session on the fixed phase-sequence model itself — e.g. whether always
prescribing an aerobic-base phase regardless of a rider's existing base fitness is even right).**
`SEASON_SHAPES_GENERATION` (`lib/season.ts`, default `false`) gates `formatSeasonContext`'s phase
text, `formatRetestNote`'s retest nudge, and the `validateSeasonFit`/`validateFocusMatch` warnings out
of every `/api/generate` call. Season state keeps being tracked underneath regardless — `season-
plan.json` still updates every call, B/C-priority event surfacing stays on (a calendar fact, not a
phase opinion) — so nothing here atrophies while the model question is open. Flip the flag back once
that research session lands; until then, treat every debt item below through that lens (most only
matter again once phase text reaches generation again).

Tracked debt surfaced by the 2026-07-16 final whole-branch review, none currently worth a dedicated pass:
- **Event-anchored path bypasses the whole macro layer, not just deload cadence.** A future A-event
  routes `draftSeasonArc` to `backwardScheduleFromEvent`, which gets the scored selector
  (`pickBuildFocus`) but none of the rest: no arc caps, no base re-touches (the fill loop only ever
  emits `phase: "build"`), no transitions, no deload flags (already documented as deliberate), and no
  load targets (`targetWeeklyTss` stays null throughout). For a long runway (the athlete's real Alpe
  KOM case is ~21 weeks) that's 15+ consecutive loading weeks with zero base touches — exactly the
  Foster load×monotony pattern the arc cap exists to prevent, structurally unreachable on this path.
  Cheap fix if it's ever worth doing: insert an aerobic-base touch into the backward fill every
  `~arcWeeks` of runway, or event-anchor only the final peak+taper+one-arc window and let the rolling
  path (caps and all) fill the earlier weeks.
- Event-mode peak vs. taper share one `focus: "sharpen"` value → same roadmap color/label; only the
  phase caption distinguishes them. Cosmetic; visible only once event mode activates.
- `formatRetestNote`'s "best slot" label is misleading on the event path: its earliest `sharpen`
  period is the **peak**, which the engine elsewhere insists must hold near-race load, yet the note
  would call it lighter. Prompt-only impact. (The rolling-path half of this note — cadence math
  flagging nearly every 3–4wk period, making "the lighter deload period" meaningless — is resolved:
  the 2026-07-16 block-generation-fidelity fixes corrected `applyDeloadCadence`'s threshold math to a
  genuine ~4wk rolling count → ARCHIVE.md. Moot either way right now: `formatRetestNote`'s prompt
  injection is currently switched off entirely, see the note below.)
- `exposureFromSessions` measures generated (prescribed) sessions, not ridden ones — a planned-but-
  skipped VO2max day still counts as real exposure. `execQualityByFocus` only partially compensates.
  Worth a join against the score log if this ever mis-steers the selector in practice.
- No re-plan trigger from the Season form itself (the next `POST /api/generate` re-plans and
  activates event mode the moment a future A-event exists); no UI warning about multiple A-events
  or the array-order tie-break.
- `PlanView`'s season-context fetch can overwrite a manual in-progress goal-textarea edit if the
  athlete types between the two independent fetches resolving — narrow single-user timing window,
  not observed in practice.
- B/C-priority event surfacing (`formatUpcomingEventsForBlock`) and `formatSeasonContext`'s call
  currently share one `try`/`catch` in `app/api/generate/route.ts` — if `replanSeasonArc` itself ever
  throws, the (currently-disabled anyway) phase text AND the always-on event line are silently dropped
  together. Found during the 2026-07-16 block-generation-fidelity plan's task review; pre-existing
  fragility inherited from the original event-surfacing plan's own "best-effort" design, not introduced
  that session. Worth unwinding (pull the event-line computation out of the replan's try/catch) if
  event-surfacing reliability ever matters more than it does today.

**Ties:** `6a` event-aware race planning is the surfacing of event mode; `§7` calendar; `#4`
validates whether a phase sequence worked; `#2` calibrates the ramp/deload constants (currently
KB-grounded population defaults).

---

## Feature tracks (multi-session ⭐)

### Track A · Power-curve intelligence
The rider profile feeds generation *and* the retrospective (curve shape + deterministic
`powerProfileSeed`) → ARCHIVE. Left: the population reference multiples → `#2` (still local
magic-numbers in `power-profile.ts`); optionally persist a per-block snapshot for
*rider-type-over-time* (deferred — one block barely moves the curve; pays off only across a season).

### Track B · Session selection & variety
Per-template durability scoring shipped end to end → ARCHIVE. Known limits: the effort-delivery
grade needs interval timing only the **today** path fetches (the ledger gets template-aware above-Z2
only); long-ride identification is a write-time heuristic (Z2 day near the block's longest Z2).
Left: tighten per-loading-week RaceSim only if real use shows under-delivery.

### Track C · Fueling intelligence + the shared correlation engine  (high value)
Turn fueling from a static formula into a learned signal. The engine (`deriveExecutionEdge`,
`deriveOptimum` in `lib/correlation.ts`), the carbs ledger stamp (`fuel.carbsGPerH`), the derived
`carbsOptimum` (overridable on `/model`), and the post-ride fuel prompt all shipped → ARCHIVE —
dormant until `carbs_ingested` data accrues, like every calibrated param. What's left:
- **Per-ride-type optimums + richer outcome signals** (RPE-vs-IF divergence, interval completion,
  next-day TSB) once the endurance read proves out.
- **Pre-ride loading loop v1 shipped** → ARCHIVE; verdict surfacing on `/model` + actual-grams logging remain open slivers.
- Surfacing layer = **§6**; reuse the one derivation in §6 + the Today tile + the Trends overlay.

---

## Platform & performance  (local-first single-user)

- **P8** — structured logging shipped (`lib/log.ts`) → ARCHIVE. Left: AI-route cost guard
  (in-memory token-bucket on `/api/generate` + `/api/ask`).
- **P9** — PWA install (`manifest.ts` + service worker); stream `/api/generate` (blocks 1–2 min today).

---

## UI refinements

- **UX program — all 4 waves shipped 2026-07-04/05** → [ARCHIVE.md](ARCHIVE.md) (summary) ·
  [UX-MASTERPLAN.md](UX-MASTERPLAN.md) (per-item detail, governed by
  [UX-CONSTITUTION.md](UX-CONSTITUTION.md)). Nothing left open; S2-4 (mobile nav IA) was evaluated
  and deliberately deferred.
- **UX v2 — the zero-based redesign, all 5 waves shipped 2026-07-08/09** →
  [ARCHIVE.md](ARCHIVE.md) (summary) · [UX-MASTERPLAN.md](UX-MASTERPLAN.md) (per-wave detail).
- **Energy-availability tile — open sliver** — the deterministic EA proxy shipped → ARCHIVE. Left:
  a *personalised* "adequate" line `← Track C` calibration.
- **Pw:HR × fuel Trends overlay** — carb-intake g/h on the existing `efSeries` chart (build w/ Track C).
- **Mobile density polish** — UX-MASTERPLAN §3 recorded but deliberately deferred all mobile
  execution (desktop-first scope decision); no desktop page runs over the fold post-v2.
- **Two small UI-polish items surfaced by the UX v2 Wave 5 closing review — both shipped 2026-07-11**
  → [ARCHIVE.md](ARCHIVE.md).

---

## Tooling & workflow (standing decision)

Design tooling (idea-kits, browser-verify MCP, a11y/quality skills) is adopted **workflow-level
only** — no new app runtime dependencies. **Source-of-truth rule:** [DESIGN.md](DESIGN.md) is
canonical; external kits *propose*, DESIGN.md *disposes* — any conflicting token/aesthetic
suggestion is rejected. **Revert trigger:** on request, drop the idea-kits from config; the app
does not change.

---

## Larger / scoped (when wanted)

- **6a · Event-aware race planning** ⭐ — structured event (date / A-B-C priority / type) → taper +
  carb-load + race-day timeline. KB already holds the protocol; LLM only phrases it, never invents grams.
- **§6 · Nutrition energy-balance** — Track C's surfacing layer. Part (a) shipped: the precise
  weekly intake-vs-need ratio → `fuelingState` → [ARCHIVE.md](ARCHIVE.md). Remaining open scope:
  precise fluid/sodium/carb targets pre/intra/post by IF + duration — always out of that plan,
  still genuinely later-scoped.
- **§7 · Calendar flexibility — remaining scope** — the in-app rescheduling + bidirectional
  Intervals.icu calendar mirror lean slice shipped 2026-07-10, plus the two-way session swap shipped
  2026-07-11 → [ARCHIVE.md](ARCHIVE.md). Left, deliberately out of scope: **condition-driven
  auto-swaps** (react to a fatigue/load condition directly and automatically, not an athlete-initiated
  swap) and **content-edit inbound sync** (an athlete editing a workout's content — not just its
  date — on Intervals.icu, flowing back into the block). Calendar-side (inbound) swap-pairing also
  stays open — a swap made directly on Intervals.icu still surfaces as two separate conflict
  warnings, not auto-applied.
- **Wearable morning-readiness** — when a wearable lands, objective HRV / sleep / resting-HR slots
  into readiness + athlete-state, replacing the manual ill/fatigue flag for the fatigue case (the
  subjective-wellness sync was deliberately removed 2026-06-26 — don't re-propose it).
- **Intervals.icu workout-library sync** — when a session scores as well-executed, write it into
  Intervals.icu's own reusable workout library (confirmed feasible: `POST
  /api/v1/athlete/{id}/workouts`, `/workouts/bulk` — a distinct API from the calendar-event endpoints
  `lib/intervals-api.ts` already uses). Builds a curated "proven workouts" folder over blocks —
  pullable by the athlete directly in Intervals.icu, and a future hook for cutting generation cost on
  repeat sessions. A **write-time side effect after scoring**, not an input to `generateTrainingBlock`
  — that call stays one holistic per-block LLM pass; this doesn't touch its shape. Deliberately split
  out of the 2026-07-17 season-architecture redesign (spec §2 non-goals) as its own future design
  session — build it on the enriched block-history data (real execution outcome + persisted protocol
  findings on each `CurrentBlockDay`) that plan's block-history-enrichment slice produces, once shipped:
  `docs/superpowers/plans/2026-07-17-season-block-history-enrichment.md`. `← #4` for
  "well-executed" (needs real scored verdicts — currently n=1–8, see the state-of-the-app note at the
  top of this doc); Track B's per-template durability score is the natural quality gate to reuse.

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
- **Subjective-wellness morning sync** — removed 2026-06-26 (latent/dead, un-utilitarian); a wearable
  gives strictly better objective morning-readiness. Spec:
  `docs/superpowers/specs/2026-06-26-remove-subjective-wellness-manual-flag-design.md`.
