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
- **The first loop turnover happened** (SUB-5, below → ARCHIVE.md) — `intervention-log.json` now
  holds 6 real directives (`outcome: null`, 28-day horizons, oldest fired 2026-07-15) — but **none
  have matured yet**, so **#4 still has 0 matured verdicts** in practice; the athlete model runs at
  n=1–8 per type, below its ≥3-obs trend gate and the correlation engine's discrimination gates →
  most calibrated params still return population defaults. First verdicts mature ~2026-08-12.

**The standing priority is therefore data over features:** every learning mechanism is
code-complete and dormant — the loop starts paying out only as generate→ride→score→learn cycles
accrue. The first turnover has fired (SUB-5); the wait now is for its directives to mature (~4wk
horizons), not for the mechanism to run at all.

---

## For the athlete — verify + decide (post 2026-07-22 audit)

The full UX/UI audit (61 findings) and the 2026-07-17 hostile review (15 findings) are both fully
shipped → [ARCHIVE.md](ARCHIVE.md). Everything passed `tsc`/lint/tests and most of it was checked live
in the browser — but a few things were deliberately never exercised against real data, and a few
fixes involved a judgment call worth a second pair of eyes. Nothing below is a known bug; it's the
honest list of what wasn't (or couldn't be) fully verified, plus the calls worth weighing in on.

**Worth trying live:**
- **Cross-tab guard (UXA-24)** — open Plan in two tabs on the same block, delete/write/move/swap in
  one, then try any of those in the other. Expect *"This plan changed in another tab — reload to see
  the latest before continuing."* instead of a silent overwrite. Verified with unit tests (mocked
  stale `createdAt`), never against two real tabs on your real `current-block.json`.
- **Keyboard shortcuts (UXA-48)** — `1`–`7` for nav, `s` for sync, `?` for the legend. Verified via
  synthetic key events and a few live clicks; worth a real run from an actual keyboard, and worth
  deciding whether they matter enough on mobile/tablet to need a touch equivalent (right now they're
  simply absent there — no regression, just no shortcut).
- **Unconfigured-Intervals.icu branch (UXA-2)** — Today's "not connected yet" copy was verified by
  code inspection + tests, not live, since exercising it on the shared dev server would have meant
  unsetting your real credentials.
- **The 9 newly-`<form>`-wrapped forms (UXA-21)** — Enter-to-submit was verified structurally (every
  non-submit button explicitly typed `type="button"`) but never by actually pressing Enter with real
  values in the running app, to avoid writing real Settings/Profile data mid-session.
- **Nutrition range hints (UXA-51)** — worth confirming the numbers in the "Edit" disclosure on
  Profile read sensibly against your own real values, not just the fixture data checked live.

**Judgment calls worth weighing in on:**
- **The PlanView goal-textarea race** — a judgment call, not a bug: full description under "Season
  engine — known debt" below (UXA-19's refactor narrowed the old race but didn't eliminate it). Decide
  whether it's worth a guard or fine to leave (same page, two adjacent actions, low real-world odds).
- **Nutrition bounds (UXA-51)** — I gave `baseCalories`/`restDayTarget`/`targetWeightKg` a floor of 0
  and no ceiling (no authoritative one exists in the codebase); a typo like `750` instead of `75` for
  target weight still passes silently. Worth deciding if any of these deserve a real sanity ceiling.
- **`Card`'s widened surface (UXA-54)** — I added attribute-spreading (`tabIndex`, `aria-describedby`,
  etc.) to the shared `Card` primitive so `AthleteStateCard` could compose it — additive and
  backward-compatible, but it does widen a primitive used by 15+ components for one caller's benefit,
  the exact kind of drift risk the audit itself flagged elsewhere. Worth a glance if `Card` ever grows
  a second such consumer.
- **UXA-24's version token** — reuses `CurrentBlock.createdAt` rather than a dedicated version/etag
  field. Cheap and shipped, but means a manual edit to `current-block.json` (e.g. via a backup
  restore) that doesn't touch `createdAt` wouldn't be detected as "changed." Unlikely in practice,
  worth knowing.
- **Season-architecture doubt (pre-existing, not resolved by this sweep)** — you'd separately flagged
  that the season engine's fixed phase-sequence model itself, not just its bugs, might be wrong (e.g.
  ignoring a rider's existing base before assigning an aerobic-base period) — deliberately deferred to
  its own research session. Worth noting: `chooseNextFocus` (the rolling-mode redesign, still behind
  `SEASON_SHAPES_GENERATION=false`) scores focus candidates off the athlete's current limiter rather
  than marching a fixed calendar sequence, which is a step toward "adapt to current state" — but
  whether it specifically addresses your original example (skipping aerobic-base when the rider
  already has a strong one) isn't something this sweep checked. Worth a fresh look at
  `scoreFocusCandidates` before assuming the redesign already answers the doubt, rather than treating
  it as still fully open either way.

---

## Data substrate — turn the loop over ⭐ (audit P1–3)

SUB-1 (block-history durable corpus), SUB-3 (sync/generate route tests), SUB-4 (off-machine backup +
branch discipline, both halves), and SUB-5 (the first loop turnover — retrospective →
`block-history.json` born → next block write → `intervention-log.json` born, run attended per the
WORKFLOW.md runbook) all shipped → [ARCHIVE.md](ARCHIVE.md). The runbook itself stays in
[WORKFLOW.md](WORKFLOW.md) as a reusable reference for any future turnover, not just the first one.

### SUB-2 · Legacy backfill importer — paused (2026-07-02)
A live-API check showed the Intervals.icu calendar recovers only ~22–28% of the 100 legacy rides
(the hard-day subset — Z2 days rarely got calendar entries), which doesn't justify an importer.
Full investigation record → [ARCHIVE.md](ARCHIVE.md). The athlete relabels legacy calendar events
manually if specific rides should become gradable. Revisit only if that manual path proves painful
or a better recovery signal surfaces. (Legacy rides *do* already feed FTP-independent trends —
Pw:HR, polarization, volume baselines — which need no prescription.)

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
Decision thresholds → per-athlete `← #2`; possible fully-automatic fatigue-path downgrade (on
`fatigueAlert`, before a miss).

### §5 · Athlete-state — slivers
Energy-availability evaluator `← Track C`; *derive* the per-athlete fusion weights off the engine
`← #2` (the population fold-in + override shipped — derivation is the open part); tune score→band
thresholds + headline against real use; possible score-over-time trend. Design spec:
[docs/specs/athlete-state.md](docs/specs/athlete-state.md).

### Season engine — known debt (accept-as-tracked)
The macro-periodization arc + scored coverage selector + macro-structure layer (bounded arcs, genuine
season breaks, FTP retest nudge) are fully shipped → [ARCHIVE.md](ARCHIVE.md); specs/plans under
`docs/superpowers/`. The old "anaerobic unreachable via the default fallback" debt item is resolved
(the scored selector replaced that fallback entirely) and removed.

**Season is currently NOT shaping or gating block generation (2026-07-16 athlete decision).** The old
fixed phase-sequence engine was replaced by `chooseNextFocus` (a fresh, real-data-scored decision made
every `/api/generate` call) plus a roadmap-preview UI (`projectSeasonOutlook`, already wired into
`SeasonRoadmap.tsx`/`PlanView.tsx`) — both shipped and hardened by a follow-up hostile review (15
findings, all fixed) → [ARCHIVE.md](ARCHIVE.md) "Season continuous-focus-selection + roadmap-preview
outlook." `SEASON_SHAPES_GENERATION` (`lib/season.ts`) still defaults `false`, gating the phase-derived
prompt text/warnings out of generation — though `season-plan.json` and `GeneratedPlan.seasonFocus`
keep tracking underneath regardless, so nothing atrophies while it's off.

**2026-07-24 research-backed redesign — P1–P7, shipped.** Root cause + full per-item detail, live-smoke
results, and the 11-candidate re-architecture evaluation → [ARCHIVE.md](ARCHIVE.md) "Block-generation
architecture redesign — P1–P7 (2026-07-24)". `SEASON_SHAPES_GENERATION` still stays `false` — P1
split the flag so the rolling/support layer (`chooseNextFocus`, `validateBlockFocus`, recovery
placement, retest, roadmap-preview) now runs unconditionally; only the doubted fixed-phase event arc
stays gated.

**Left (genuinely open):**
- **P3d — consequence forecast.** Deliberately not built: needs new forward-projection code
  (`lib/readiness.ts`'s `computeAcwr`/`computeLoadRamp` only analyze past activity, nothing projects
  CTL/ATL/TSB forward from a hypothetical block) and no live smoke run has yet shown a dangerous
  ramp-rate or bad event-day form to justify it.
- **P3e — aggregate-miss hard-fail + targeted single-week regeneration.** Deliberately not built: the
  largest, riskiest piece (new partial-regen prompt/schema/splicing/bounded-retry, ~doubling
  worst-case latency when it fires, a new boundary-conflict failure mode of its own). Recommended as
  its own dedicated session once real data shows a/b/c/P5-hardened blocks still miss badly enough to
  need it — smoke tests so far have only produced modest (≤1.5h) misses.
- **P6 — week-boundary re-anchoring.** Not yet scoped to file/function detail. Recompute the
  remaining weeks' skeleton from actual executed load at each week rollover — drops the feedback loop
  from 42 days to 7 without a daily engine. Carries the per-zone progression ledger as state.
- **[P1] A-priority events still get no phase text.** `formatSeasonContext` is the only channel for
  the backward-scheduled taper arc, and it stays behind `SEASON_SHAPES_GENERATION` by design —
  currently latent since no A-event exists yet.
- **[P2] Recovery-week depth and hour-target precision are narrowed, not exact.** Live smoke: a
  loading week landed ~9% under a 12h target; a recovery week ranged from 12min under to 1.5h over its
  derived target across runs. Now visible (`validateWeekHours`), not solved.
- **[P3c] The narrative critic doesn't reliably catch approximate duration language.** Fired and
  corrected a real overview on one smoke run; a later run let a "4-hour" mis-description of a
  200-minute ride through. Inconsistent, not proven broken; worth sharpening the prompt if it recurs.
- **[P4 / P5] The event week can still overstack, and a hard ride can still land the day before the
  event.** Live-confirmed after P5 shipped: the KOM event's own week stacked 3 quality sessions and a
  hard embedded-effort Z2 landed the day immediately before the event — `validateEventTaper`'s "no
  quality in the final 2 days" rule checks standalone quality types only, not embedded-effort
  endurance rides the way `validateSchedule`'s older, broader "hard day" definition already does.
  Worth extending `validateEventTaper` to reuse that broader definition if this recurs.
- **[P7] The focus selector's urgency signal is blind to pre-app fitness.** `exposureFromSessions`
  (`lib/season-signals.ts:76`) is built only from NodeVelo-generated block history. A focus with no
  in-app exposure hits `NEVER_SEEN_URGENCY` (1.3), and for `aerobic-base` specifically that spike can
  still win a goal-neutral block's slot. Heavily masked in practice (goal-driven blocks out-score it)
  but not structurally closed. **Not scheduled.** Fix direction: feed `aerobic-base`'s urgency partly
  from a real, ledger-independent signal (synced CTL/volume-baseline trend) instead of the flat spike.
- **Tripwire:** if a future block reproduces a structural defect (a missed hour target, a missing
  limiter session, an escalation the narrative critic misses), that's real evidence the LLM shouldn't
  author structure at all — next step would be a fully deterministic skeleton with parameterized
  protocol templates, LLM narrating only. Hasn't fired yet; the P4/P5 event-week overstack above is
  the closest call so far.
- **Held for a scheduled reopen, not rejected:** the TrainerRoad-style per-zone progression-level
  state machine (→ ARCHIVE for why it's the standout alternative). Reopen once per-type observation
  counts clear the athlete-model's own ≥3-obs gates (watch after the 2026-08-12 verdict maturation).
- **Eliminated outright (don't re-propose without a real reason):** a full constraint solver (its one
  good idea — refuse to silently arbitrate an over-constrained ask — is already in P2a); full
  rolling-horizon generation with no block concept; a full backward-from-event planner as the
  *primary* generative move (→ ARCHIVE for the full evaluation).

**Other debt** (surfaced by the 2026-07-16 final whole-branch review, none currently worth a
dedicated pass — unrelated to the 2026-07-24 redesign above, kept here since it's the same "known
gaps" ledger):
- Event-mode peak vs. taper share one `focus: "sharpen"` value → same roadmap color/label; only the
  phase caption distinguishes them. Cosmetic; visible only once event mode activates.
- `exposureFromSessions` measures generated (prescribed) sessions, not ridden ones — a planned-but-
  skipped VO2max day still counts as real exposure. `execQualityByFocus` only partially compensates.
  Worth a join against the score log if this ever mis-steers the selector in practice.
- No re-plan trigger from the Season form itself (the next `POST /api/generate` re-plans and
  activates event mode the moment a future A-event exists); no UI warning about multiple A-events
  or the array-order tie-break.
- `PlanView`'s season-context sync (UXA-19, 2026-07-22, → ARCHIVE.md) collapsed the old two-independent-
  fetches race into a narrower one: `seasonQuery`'s render-time sync block re-applies `goalPrefill` onto
  the goal textarea any time the query result changes reference, with no check for whether the athlete
  has already started editing. Saving the Season form bumps `seasonVersion` → a real refetch → a real
  trigger, so an athlete who saves Season while mid-edit on the goal textarea below it can still get
  overwritten — same shape as before, one specific trigger instead of a timing race. Worth deciding
  whether the sync should also skip once the textarea has unsaved user edits, or whether this is rare
  enough (same page, two adjacent actions) to leave as-is.
- B/C-priority event surfacing (`formatUpcomingEventsForBlock`) and `formatSeasonContext`'s call
  currently share one `try`/`catch` in `app/api/generate/route.ts` — if
  `chooseNextFocus`/`replanEventArc`/`settleSeasonHistory` itself ever throws, the (currently-disabled
  anyway) phase text AND the always-on event line are silently dropped
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
- **Mobile density polish** — deliberately deferred (UX-MASTERPLAN §3, desktop-first scope decision).
  Real state (measured 1440×900, 2026-07-22 → ARCHIVE.md): only 3 of 7 pages (Today, Model, Knowledge)
  fit in one viewport; Plan/Trends/Profile/Settings scroll, Settings by over 1000px. Fold-1
  decision-critical content (verdicts, prescriptions) still fits everywhere — worth a phrasing tweak
  here if that distinction ever causes real confusion, not urgent enough to reopen build work on its own.
- **Two small UI-polish items surfaced by the UX v2 Wave 5 closing review — both shipped 2026-07-11**
  → [ARCHIVE.md](ARCHIVE.md).
- **Full-app UX/UI audit — 61 findings across 8 parallel reviews, all shipped 2026-07-22** →
  [ARCHIVE.md](ARCHIVE.md). Nothing left open; see "For the athlete — verify + decide" below for what
  to try live and what to weigh in on.

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
