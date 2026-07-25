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
thresholds + headline against real use; possible score-over-time trend.

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

**2026-07-24 research-backed redesign (prompted by a real generated-block review):** a research pass
across TrainerRoad/Xert/TrainingPeaks/Intervals.icu/JOIN Cycling, open-source plan-generator repos,
and coaching-forum consensus, plus a full re-audit of this file's own machinery, replaced the old
"just flip the flag" plan with a 7-part sequence. Root cause: the flag bundles two independent
things — the doubted fixed-phase event arc (`formatSeasonContext`/`backwardScheduleFromEvent`,
`validateSeasonFit`/`validateFocusMatch`) AND the *not*-doubted, already-built, already-tested
rolling/support layer (`chooseNextFocus`→`formatFocusContext`, `validateBlockFocus`,
`formatRecoveryWeeks`, `formatRetestNote`, `/api/season`'s `projectSeasonOutlook`) — so disabling one
disabled both, even though the athlete's standing doubt is specifically about the fixed
phase-sequence model, not about state-scored rolling selection.

- **P1 — split the flag (scoped in full 2026-07-24, ready to implement):** keep the event-anchored
  bundle off; reconnect the rolling/support bundle unconditionally. Concretely: in
  `app/api/generate/route.ts`, the `if (SEASON_SHAPES_GENERATION) {...}` blocks at the season-context
  injection (~L280) and the season-fit/focus-match/block-focus warnings (~L388) each split into an
  `aEventForBlock`-gated (stays behind the flag) branch and a `rollingFocusChoice`-gated (always runs)
  branch; the retest-note block (~L297) and `formatRecoveryWeeks` ungate entirely; `/api/season`'s
  `outlook` (route.ts:17) drops its `SEASON_SHAPES_GENERATION &&` condition (already `!aEvent`-scoped).
  No changes needed inside `lib/season.ts` itself — every function this reconnects already exists and
  already has passing tests (`route.season-enabled.test.ts` already exercises the exact rolling-mode
  bundle this turns on; `route.test.ts` L133–150 and `season/route.test.ts` L114 have "while
  SEASON_SHAPES_GENERATION is off" assertions that need flipping to positive expectations). Known
  residual gap, unchanged by design: A-priority events still get no phase text either
  (`formatSeasonContext` is the only channel for the backward-scheduled taper arc) — same underlying
  gap the athlete's real priority-B event hit, just currently latent since no A-event exists yet.
  Recovery-week *placement* is fixed by this step; recovery-week *depth* is not (→ P2 — the fixed 6–7h
  band was reasonably calibrated against the 10–12h loading target, so the shallow-cut problem found
  live is really loading weeks undershooting their own floor, a generation-adherence problem, not a
  placement bug).
- **P2 — deterministic per-block skeleton. Shipped 2026-07-24, four sub-phases:**
  - **P2a — feasibility pre-check** (`lib/block-skeleton.ts: checkBlockFeasibility`): refuses an
    infeasible `BlockSettings` combination with a 400 before spending an LLM call on it.
  - **P2b — exact hour figure per week** (`computeWeekTargets`/`formatWeekTargets`/`validateWeekHours`):
    replaced the old min-max range (which the reviewed block undershot in 5 of 5 non-recovery weeks)
    with one number per week, and — the piece that was missing entirely — a post-generation check that
    actual hours landed near it. Recovery depth is now derived (60% of the loading target, clamped to
    `recoveryWeekHoursMin/Max` — widened `recoveryWeekHoursMax` 7→8 so the derived figure governs
    instead of being clamped back to the old shallow band) instead of a fixed absolute figure blind to
    what loading actually targets.
  - **P2c — mandatory focus-coverage requirement** (`lib/season.ts: focusSessionMatchers`/
    `formatFocusCoverageLine`): the block's chosen focus (`chooseNextFocus`) now injects "include ≥1
    {matching type} session" upfront, reusing the exact matcher `validateBlockFocus` already enforces
    post-generation, so requirement and enforcement can't drift apart. At least once across the whole
    block, not per loading week — stacking a second per-week requirement onto RaceSim's existing one
    risked the exact over-constrained conflict P2a exists to catch.
  - **P2d — `weeks` before `overview`** (`lib/plan-schema.ts`): Claude's tool-use fills JSON fields in
    declared order, so the model was committing to a narrative before generating a single day. Simple
    field reorder (verified: `z.toJSONSchema` preserves it into the tool's `input_schema`) so the
    overview is now written last, describing the schedule that exists rather than one that doesn't yet.
  - **Live-smoked, honest result:** recovery depth landed within 12 minutes of its derived 7.2h target
    (vs. the old fixed-band defect); the coverage requirement was satisfied in both weeks of a 2-week
    smoke run; a loading week landed at 11h against a 12h target (a ~9% miss, correctly flagged by the
    new HOURS check — much closer than the prior floor violation, but not exact); the new EVENT TAPER
    week-cap check caught the model still overloading a taper week with 3 quality sessions despite the
    strengthened prompt cue; the overview also once mis-stated a 190-minute long ride as "4-hour." **P2
    measurably narrows the defect class (recovery depth precise, coverage satisfied, hour misses far
    smaller and now visible for the first time) but does not eliminate model non-compliance** — exactly
    the residual P3's tiered auto-repair and narrative-coherence critic exist to close.
- **P3 — tier the post-generation validators. P3a/b/c shipped 2026-07-24; P3d/e deliberately
  deferred** (scoped, not built — see below):
  - **P3a — nutrition auto-repair** (`lib/nutrition-validate.ts: repairNutrition`): the correct kcal
    figure is always known (the deterministic reference table), so a mismatch is now overwritten, not
    just flagged — the fix stays visible as a `repairs`/warnings note (calibrated honesty), replacing
    the old `validateNutrition` call in `route.ts` outright. Live-confirmed: a real generation shipped
    an invented 3000 kcal figure, auto-corrected to the real 3810 kcal.
  - **P3b — durability-insert-ceiling classification fix** (`lib/workout-validate.ts`): steps shorter
    than 90s (VO2max's own protocol floor) are now excluded from the 122%/20-min durability-insert
    ceiling check — a short near-maximal touch is a KB-sanctioned neuromuscular pattern (§12 Template D
    + the standing-sprint section), not a malformed durability insert. Confirmed live twice before the
    fix (a Recovery day's 10s touches at 130-140% FTP false-flagged).
  - **P3c — narrative-coherence critic + overview auto-repair** (new `lib/narrative-critic.ts` +
    `lib/anthropic-api.ts: critiqueOverview`): a small, cheap follow-up call (`QUICK_MODEL`, not the
    generation model) fact-checks the written overview against deterministically-extracted per-week
    facts (hours, quality-type counts, longest ride) and rewrites it if it disagrees — never touches
    the schedule itself, bounding the risk. Skipped for a truncated/incomplete block. **Live result,
    honest:** it fired and corrected a real overview on the first smoke run — but the corrected text
    still described a 200-minute long ride as "4-hour," the same class of imprecision it exists to
    catch. P3c measurably helps; it is not a complete fix, and approximate duration language ("a
    4-hour ride") appears to read as descriptive rather than a hard factual claim worth reconciling
    against the exact minute figure — worth sharpening the critic's prompt if this recurs, not
    evidence the mechanism is broken.
  - **P3d — consequence forecast: deferred.** Needs genuinely new forward-projection code (checked:
    `lib/readiness.ts`'s `computeAcwr`/`computeLoadRamp` only analyze past activity, nothing projects
    CTL/ATL/TSB forward from a hypothetical block) and — unlike a/b/c — nothing in two live smoke runs
    has shown a dangerous ramp-rate or bad event-day form yet to justify building it now.
  - **P3e — aggregate-miss hard-fail + targeted single-week regeneration: deferred.** The largest,
    riskiest piece (new partial-regen prompt/schema/splicing/bounded-retry, roughly doubling worst-case
    latency when it fires, a new boundary-conflict failure mode of its own). Recommended as its own
    dedicated session once real data shows how often a/b/c-hardened blocks still miss badly enough to
    need it — both live smoke tests so far only produced modest (<1.5h) hour misses, not clear
    hard-fail cases.
- **P4 — a lightweight taper tier for priority-B/C events**, short of full A-tier backward
  scheduling: capped quality budget + no quality in the final 2 days before the event. Today B/C
  events get only `formatUpcomingEventsForBlock`'s one-line "protect this day" callout — no
  load-shaping at all, which is how a real priority-B KOM attempt ended up with the block's single
  most quality-dense week landing immediately before it.
- **P5 — temporal sequencing + one primary quality per block**, per the applied-sports-science
  consensus (VO2max freshest early in the week, threshold mid-week on some fatigue, durability/
  endurance last) — stops diluting concurrent goals (this athlete's FTP + 1-min power + 5-sec power
  all at once) the way SIT/neuromuscular work quietly disappeared from the back half of the reviewed
  block despite its own overview claiming otherwise. **Grafted (2026-07-24):** carry a lightweight
  per-zone progression ledger (a number per workout-type, TrainerRoad's actual mechanism) as state
  across week boundaries under P5/P6 — not as the planning engine (see the held-for-reopen note
  below), but so a multi-week claim like "SIT escalates" becomes a checkable number instead of a
  narrative promise, and so the sample size that would eventually justify a real progression-engine
  starts accruing now.
- **P6 — week-boundary re-anchoring:** recompute the remaining weeks' skeleton from actual executed
  load at each week rollover — drops the feedback loop from 42 days to 7 without a daily engine.
  Intervals.icu's own developer confirmed (forum) they haven't shipped full auto-replanning yet —
  treat that as evidence the full daily-engine version (Xert/Aixle-style) is genuinely hard, not as
  something to skip straight to.
- **P7 — the phase-sequence doubt: `chooseNextFocus` fixes the structural bug, but a real gap
  remains underneath it (verified 2026-07-24).** The good news: the fixed-sequence engine is gone —
  `aerobic-base` is now one of five scored candidates every block, never an unconditional first
  phase, so the athlete's literal worry ("always assigning base regardless of existing fitness") no
  longer happens *by construction*. The gap: the selector's urgency/staleness signal
  (`exposureFromSessions`, `lib/season-signals.ts:76`) is built **only** from NodeVelo-generated
  block history (`currentBlock.days` + `blockHistory[].days`) — it has no visibility into real
  pre-app or off-app fitness (legacy rides, or a rider brand-new to this app). A focus with zero
  in-app exposure hits `NEVER_SEEN_URGENCY` (1.3 — higher than any bounded staleness score), and for
  `aerobic-base` specifically (high trainability 0.9, goal-relevance hard-pinned to a neutral 0.5 it
  can never rise above) that spike can still win the slot for a goal-neutral block — the test suite's
  own comment on `lib/season.test.ts`'s urgency test names this exactly ("otherwise... it would fall
  back to NEVER_SEEN_URGENCY and... outscore \[everything], which isn't what this test is about" —
  the test sidesteps the case rather than proving it's handled). In practice this is heavily masked
  for a goal-driven athlete (aerobic-base's capped 0.5 goal-relevance loses to any goal-matched focus
  at 0.8–1.0) and further masked for *this* athlete specifically (Z2 riding is common in every block,
  so real exposure data usually exists) — but the original example (a rider new to NodeVelo, or whose
  real base predates its ledger, getting assigned a base emphasis they don't need) is not actually
  closed, just less likely to trigger than under the old engine. **Not scheduled as a fix** — surfaced
  so it isn't mistaken for resolved. If it's worth closing: feed aerobic-base's urgency partly from a
  real, ledger-independent signal (synced CTL/volume-baseline trend, which NodeVelo already syncs from
  Intervals.icu regardless of in-app block history) instead of `NEVER_SEEN_URGENCY`'s flat spike.

**2026-07-24 — was a more drastic re-architecture warranted instead of P1–P7?** Evaluated explicitly,
not assumed away: eleven candidate architectures (LLM-as-copywriter over a fully deterministic
skeleton; a library+guided-search engine; a hard constraint solver; a two-clock macro-envelope/
weekly-fill split; full rolling-horizon generation with no block concept; a TrainerRoad-style per-zone
progression-level state machine; a Xert-style soft-phase+daily-override hybrid; a backward-from-event
planner with block length as an output; a generate→LLM-critique→repair loop; a forecast-only "flight
simulator"; a negotiation UX where the LLM only translates feedback into constraint edits) were
generated and scored against this app's real constraints — solo maintainer, the mission's own "not a
re-skin of Intervals.icu" line, the review-before-write ritual as a deliberately-built explainability
feature (not legacy cruft), the deterministic infra already working (focus selector, durability
templates, execution EWMA, recovery cadence), and — the decisive fact — the athlete model currently
running at n=1–8 observations per type, below its own confidence gates, with the first learning-loop
verdicts maturing ~2026-08-12 (state-of-the-app note, top of this file). **Verdict: P1–P7 already is
the correctly-sized drastic change** — it strips the LLM of exactly the structural authorship where
every reviewed-block defect occurred, and most surviving candidates decompose into ingredients P1–P7
already contains (the three grafts above). Re-architecting toward a data-hungry primitive now would
reset the exact corpus the app's whole thesis depends on, right as it starts accruing.

**Eliminated outright (don't re-propose without a real reason — same convention as "Decided against"
below):** a real constraint solver (debugging infeasibility proofs is machinery a solo maintainer
shouldn't own for a hobby app — the one good idea, refuse-to-silently-arbitrate an over-constrained
ask, is folded into P2 as a plain pre-check instead); full rolling-horizon generation with no block
concept (deletes real look-ahead value — "I know week 4 is hell week" — and turns review into
something that only catches failures after they're ridden); a full backward-from-event planner as the
*primary* generative move (makes a mostly-empty, self-declared event calendar the highest-authority
input in the whole system for no real gain over P4's lightweight tier).

**Held for a scheduled reopen, not rejected:** the TrainerRoad-style per-zone progression-level state
machine (lives as carried state under P5/P6 for now, not yet as the planning engine) — the most
genuinely interesting drastic option, blocked purely by data thinness, not by design. Reopen once
per-type observation counts clear the athlete-model's own ≥3-obs gates (watch after the 2026-08-12
verdict maturation, likely 2–3 more block cycles).

**Tripwire:** if the first block generated *after P2 ships* still produces a structural defect — a
missed hour target, a missing limiter session, a broken escalation the new narrative critic catches —
that is real evidence the LLM should not author structure at all, full stop. The next step in that
case is the terminal composition: a fully deterministic skeleton drawing from parameterized protocol
templates (never a stored workout library — that's the re-skin risk; parameters must come from the
athlete model, not a static catalog), with the LLM narrating only. Don't respond to that signal by
iterating on prompts further.

Tracked debt surfaced by the 2026-07-16 final whole-branch review, none currently worth a dedicated pass:
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
