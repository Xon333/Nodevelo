# NodeVelo — feature catalogue

What the app can do today, grouped by area. This is the **capability map**; for *how* it works see
[docs/systems/](docs/systems/) (via [docs/COMPASS.md](docs/COMPASS.md)), for *what's next* see
[ROADMAP.md](ROADMAP.md), and for the *work log* see [ARCHIVE.md](ARCHIVE.md). Everything here is deterministic TypeScript unless noted as
AI — and the AI only ever phrases numbers the code already computed.

---

## Sync & physiology
- **One-way Intervals.icu pull** — activities, wellness, power curve, sport-settings, intervals, over a
  182-day window; `GET /api/sync` is pure (cached), `POST /api/sync` is the only network path. `lib/intervals-api.ts`
- **Effective-dated physiology** — FTP, power/HR zones (power as %FTP), threshold/max HR stored with
  effective dates; one FTP change re-resolves every zone coherently. `lib/physiology.ts`
- **Discrepancy reconciliation** — an FTP/zone change archives the old snapshot and starts the new one
  effective today ("FTP changed 288 → 300 W on …; zones updated"). `reconcile()`
- **History anchored to the right FTP** — each ride is scored against the physiology in effect *that day*.
- **Self-directed intent learning (deterministic)** — after sync, strict labelled bullets in an
  athlete-authored ride note are parsed independently and graded against synced Intervals.icu laps. A note naming
  curated Intervals.icu segments grades each from its own lap (duration range, average-power zone,
  normalized-power zone against the ride-date zones); unmatched or ambiguous labels stay unscored
  rather than guessed from whole-ride totals. While a noted unplanned ride's intent is being evaluated,
  Today shows "Evaluating your intent…" instead of a generic off-plan score. A trustworthy
  result teaches the overall athlete model and no longer counts as plan drift; prescribed sessions
  remain ledger-authoritative. The Today debrief shows the interpreted intent, supported evidence,
  and overlay-resolved score or `Not scored` reason. `app/api/intent`, `lib/intent-runner.ts`,
  `lib/intent-note-parser.ts`, `lib/intent-scoring.ts`, `components/dashboard/ride-intent.tsx`

## Season & macro-periodization (Plan page)
- **Season objective + target events** — an athlete-owned objective string and A/B/C-priority event
  list; a compact objective + upcoming-events card sits on `/plan` beside the generator it feeds. The
  intro copy + objective label state the season↔block relationship explicitly ("blocks are generated
  *against* it") rather than reading as a vague freeform box. `GET`/`PUT /api/season`, `lib/season.ts`,
  `components/SeasonSection.tsx`
- **Macro-periodization engine** — `chooseNextFocus` scores the next block's focus fresh from real
  data every `/api/generate` call (goal-relevance, decay-urgency, trainability, execution quality) —
  the rolling default with no event on the calendar; a fully-built event-anchored mode (backward
  taper→peak→build scheduling) activates automatically the moment a future A-event exists. The
  event-anchored phase text/warnings (`formatSeasonContext`, `validateSeasonFit`/`validateFocusMatch`)
  stay behind `SEASON_SHAPES_GENERATION` (default `false`) — season shaping doesn't currently gate
  block generation; `season-plan.json` keeps evolving underneath regardless, and a roadmap-preview
  (`projectSeasonOutlook`) re-runs the selector forward for display on `/plan`. `chooseNextFocus`,
  `replanEventArc` — `lib/season.ts`
- **Honest focus labels** — `FOCUS_LABELS` maps a goal's `"general"` tag to **"all phases"** display
  text instead of a meaningless-looking default (stored value unchanged; display-only). Shared by the
  Profile goals grouping below. `lib/season.ts`
- **No-season teaching stub** — when no season exists yet, the `/plan` roadmap slot teaches "what a
  season does" in three steps instead of sitting empty. `components/SeasonRoadmap.tsx`
- **Season-aware block pre-fill** — the block generator's length selector (now **2/4/6/8** weeks)
  pre-fills from the season's current period (`suggestedBlockWeeks`); the goal textarea pre-fills to
  goals tagged with the period's focus + every general-tagged goal (`filterGoalsByFocus`); a
  "Targeting `<phase>` · pulling N goals · edit profile →" line renders above the generator fields
  stating what it's pulling from. All freely overridable, never locked.
  `components/dashboard/{PlanView,BlockGenerator}.tsx`
- **Block-completion prompt** — once the active block's `endDate` has passed, the Today planned-
  session card proactively nudges the athlete to generate the next one instead of sitting on stale
  "no session planned" copy. `isBlockFinished`, `lib/date.ts`, `components/dashboard/today.tsx`
- **Plan hero orientation (Wave 5)** — header reads "week N of M · `<week character>`"; the week
  character label is volume-derived (planned weekly volume relative to the block), an honest read
  not real per-week periodization — the data model carries one whole-block `seasonPhase`, never
  spread per week. A "next: `<session>`, `<when>`" pointer sits alongside.
- **In-hero week strip** — hours-vs-target (aligned current-block-week window) · load · top session,
  replacing the old standalone "This week" panel. `components/dashboard/plan.tsx`
- **Block calendar hoisted + resized** — sits directly under the hero header (was buried under
  393px of text/stats), with a proper drag/tap cell height for reschedule — the block's primary
  artifact reads as primary. `components/dashboard/plan.tsx`

## Block generation (Plan page)
- **Goal-driven deterministic generation** — resolved focus, live physiology, settings, durability,
  events, and nutrition feed `compileTrainingBlock`; identical inputs produce identical complete
  `PlannedDay[]` with no Anthropic dependency. `app/api/generate`, `lib/block-compiler.ts`
- **Feasibility pre-check + deterministic week targets** — `checkBlockFeasibility` refuses an
  infeasible `BlockSettings` combination with a 400 before composition; `computeWeekTargets`
  sets one exact hour figure per week (recovery depth derived from the loading target, clamped 6–8h),
  checked post-generation (`validateWeekHours`). `lib/block-skeleton.ts`
- **Deterministic session selection (Track B)** — a terrain/race goal makes RaceSim a sporadic/
  block-wide requirement rather than competing weekly with the block's primary quality; the block's
  chosen focus must show its matching session in every loading week
  (`validatePrimaryQualityCadence`). `lib/session-requirements.ts`, `lib/season.ts`
- **Durability templates (Track B)** — durability is a category of 5 rotating long-ride templates
  (A pure accumulation … E mixed density), picked limiter-driven from the athlete model else rotated,
  and stamped on the block. KB §12 + `lib/durability.ts`
- **Typed canonical workout syntax** — every cycling prescription has one power or heart-rate target
  family and must survive typed render → parse semantic equality. Supports standard zones/% targets,
  repeats, cues, warmup/cooldown ramps, HR-cap cue text, and guarded default-off `Press lap`; generates
  no cadence targets. `lib/prescription.ts`, `lib/workout-templates.ts`
- **KB-grounded protocol validation** — every generated workout checked against KB interval bands
  (SIT 4–6×20–30s all-out · VO2max 3–8min 106–120% · threshold 88–105%); protocol breaches block publication.
  `lib/workout-validate.ts`
- **Schedule-placement validation** — flags back-to-back hard days, any week over the quality budget,
  a capped/no-quality taper window ahead of a priority-B/C event (`validateEventTaper`), and
  freshness-dependent quality (VO2max/SIT) landing later in the week than fatigue-tolerant quality
  (Threshold/RaceSim) (`validateWeekSequencing`); the publication gate classifies each emitter's
  findings as blockers, preferences, or advisories. `lib/schedule-validate.ts`, `lib/publication-gate.ts`
- **Compiler-owned nutrition and overview** — daily nutrition and the block overview are assembled
  directly from resolved facts; there is no copy/repair or prose-consistency stage.
- **Execution cues** — each day can carry one deterministic protocol/pacing cue, including an HR cap
  on a power-led workout without creating a second structured target.
- **Preview → publication gate → write** — `PlanPreview` shows every day plus blockers,
  preferences requiring acknowledgment, and the existing "Notes — for your awareness" warnings. `POST /api/write`
  refuses blockers or an unknown persisted verdict before any write; accepted plans post to the
  Intervals.icu calendar and freeze the block (with the FTP used). `lib/publication-gate.ts`,
  `app/api/write`
- **Stable regeneration** — a repeated request with unchanged facts returns the same raw compiler
  JSON, days, weekly sums, and findings; there is no model call or generation cache.

## Block closeout (Plan page)
- **Gated wrap-up** — closing a block is one Plan-page action: a finished block proceeds straight to
  deterministic closeout; an unfinished one requires typing why it's ending early (the reason is stamped
  on the retro + history entry, and un-lived days are cut from the archive). `POST /api/retrospective`
  (409 otherwise), `lib/block-closeout.ts`, `components/dashboard/plan.tsx`
- **Deterministic-first evidence card** — the closeout card renders per-type execution/compliance/
  missed/overshoot evidence from the frozen ledger (compliance figures capped by execution; sessions over
  125% of prescribed duration flagged as overshoot, never graded down for it), with deterministic seeds.
  Claude's narrative and structured reflections are best-effort enrichment on top. `CloseoutEvidence`,
  `deriveCloseoutSeeds`
- **Degraded mode never blanks out** — with no Anthropic key or a failed narrative call, the closeout
  still lands: facts + seeds persist, only the prose is absent (the card says so).
  `narrativeDegraded`, `components/dashboard/PlanView.tsx`
- **Review & adopt control** — nothing AI-written reaches the next block until the athlete presses
  "Review & adopt" on Plan history: it flips `seeds_approved: true` on the retro markdown and stamps
  `reflectionsApprovedAt` on the entry; unadopted seeds/reflections inject as empty.
  `POST /api/history`, `lib/kb-loader.ts`, `lib/retrospective-schema.ts`

## Today page
- **No-block Today** — when there's no active block (never had one, or one finished and hasn't been
  regenerated), Today replaces the bare "no active training block" fallback with a weekly TSS
  envelope (Monday-resolved, tightens only, never widens mid-week), one suggested session gated on
  that range vs. week-to-date load (never a menu, never a plan), and a plain-language
  Load/Recovery/Execution readout. No LLM call. `lib/weekly-envelope.ts`, `lib/session-suggestion.ts`,
  `lib/no-block-summary.ts`, `components/dashboard/today.tsx`
- **Pre-ride / post-ride auto-switch (Wave 2)** — mode is data-derived, never athlete-picked: a
  synced ride matching today's *local* date (`localToday()`) → post-ride mode, else pre-ride.
  Pre-ride promotes the readiness verdict + full session-prescription card (name, type, duration,
  step/rep targets — *what am I about to ride*). Post-ride compresses the verdict to a one-line
  strip and promotes the debrief hero + an "Eat today" fuel card. A quiet corner link flips the view
  client-side for the odd case (evening plan-check after a morning ride); no persistence.
  `components/dashboard/today.tsx`
- **Readiness zone** — one verdict: the fused **Athlete State** card (0–100 + band + recommendation,
  §5 signal fusion; visible score/band without interaction, ranked drivers behind hover/focus), with
  triggered fatigue/load-ramp alerts above it (alarms outrank verdicts) and the raw TSB·ACWR·polarization·
  energy-availability signals collapsed into a "Supporting signals" drill-down below. One vocabulary
  owns the verdict — the old separate Build/Hold/Recover badge and coach's-read card were retired into
  it (UX-MASTERPLAN S1-1). `components/AthleteStateCard.tsx`, `lib/athlete-state.ts`, `lib/readiness.ts`
- **Proactive morning check-in (#3)** — all three one-tap flags (feeling ill / extreme fatigue /
  injured) on any day a ride is planned. On a *quality* day, ill/fatigue deterministically
  *downgrade* — swap the stimulus onto an upcoming easy day, or an honest deload if none exists. On an
  *easy* day they verdict *rest* — skip the volume day: missing easy volume costs little, grinding
  through illness/deep fatigue digs the hole deeper. Injury verdicts *rest* on any ride day (it's
  musculoskeletal — the motion itself is the risk, no swap helps), with guidance to see a professional
  if it persists. The verdict card **survives a refresh** — reasons are frozen onto the stored entry at
  flag time, an applied downgrade is stamped `appliedAt`, and a "Change" affordance re-opens the prompt
  (one entry per day; re-submission replaces). `components/MorningCheckIn.tsx`, `lib/morning-check.ts`,
  `app/api/morning-check`
- **Debrief hero (post-ride)** — execution score leads (not buried): planned vs actual, a curated
  metric strip (IF + effort band + **basis stamp** `· NP`/`· avg` · NP · avg power · RPE), the 1–10
  execution score, prescription-vs-execution rep breakdown, a smoothed power/HR trace with interval
  bands, and power-zone bars. *Decoupling* lives in the collapsed "Power execution" drill-down (it's
  context, not a scored signal); avg speed was dropped. `components/dashboard/today.tsx`, `lib/trace.ts`
- **"Eat today" fuel card** — advised daily intake + the base+ride+buffer formula, its own promoted
  card post-ride (no longer embedded in the ride card). `lib/nutrition.ts`
- **Energy-availability tile** ⭐ — a deterministic fuel proxy `(logged intake − ride burn)/kg`, averaged
  over recent *complete* days (today excluded), with a week-over-week trend. No clinical band (it's a
  body-weight proxy off self-logged intake — said so in copy); withheld below 3 logged days. `lib/nutrition.ts`
- **Calibrated-honesty UX** — the UI grades its own certainty: metric **provenance** stamped (IF NP-vs-avg),
  thin **Athlete-State** reads flagged (amber "low confidence"), and numbers the engine can't trust yet are
  withheld (`—`) rather than shown flaky. `components/AthleteStateCard.tsx`, `components/dashboard/today.tsx`
- **Power-PR trophy** — a new best vs the previous sync's curve is called out (banner + coach note). `lib/pr.ts`
- **Session disposition** — attribute a ride completed/partial/compromised; only *compromised* changes scoring.
- **Coach note** — AI 2–3 sentence narrative of today vs plan; re-analysable. `app/api/analyze`
## Coaching intelligence & learning
- **Immutable execution ledger** — every ride scored 1–10 once, frozen against that day's FTP.
  `lib/execution-score.ts`, `lib/score-log.ts`
- **Interval adherence** — avg-watts (not NP), duration-aware completion, a structural-mismatch guard, and
  "extra" efforts surfaced. `lib/interval-match.ts`
- **Athlete model** — EWMA per workout type + split-half trend → ranked insights (alert/watch/good).
  `lib/athlete-model.ts`
- **Coaching directives + validation loop** — insights synthesised into one directive block for
  generation, snapshotted at write, then validated/refuted after a 28-day horizon. `lib/synthesis.ts`, `lib/intervention.ts`
- **CoachSnapshot (#1)** — one deterministic resolved-numbers bundle (today execution · form + TSB-as-
  actionable-modifier · fuel · fused state · directives · disposition · morning check) shared by
  Today and generation, so the LLM can't invent numbers. `lib/coach-snapshot.ts`
- **Per-athlete calibration (partial)** — sample-tiered EWMA α plus confidence-gated deep-fatigue,
  decoupling, endurance-carb, and per-type IF values. ACWR, the remaining TSB edges, durability, and
  athlete-state weights keep population defaults with manual overrides. `lib/calibration.ts`

## Model page (Wave 5)
Three stacked groups, reading order matching how the athlete actually asks:
- **NOW** — the fused state's ranked drivers as signed-magnitude bars (−10/−9/−8/+4 …, largest
  first; negative bars render red) — the same data Today's "why? →" links to, finally visual.
- **LEARNED** — one calibration card per learned value: number · provenance ("learned · N rides") ·
  confidence tier · override/contest inline with a "use learned value" escape.
- **STANDING GUIDANCE** — directives grouped by dimension, evidence behind "why ▸", validation ✓
  marks where earned; the group header also carries the **validation track record — validated/refuted
  counts per dimension** (moved here from Today's retired Trend Pulse tile).
Effort bands live on Profile; long-form metric explanations live here. `app/model/page.tsx`, `components/StandingGuidance.tsx`

## Adaptive scheduling
- **Reactive reschedule** — a missed/compromised quality session is detected and offered a make-up on the
  next clear rest day (athlete-confirmed, local block). `lib/reschedule.ts`, `components/RescheduleBanner.tsx`
- **Proactive reschedule** — the morning check-in's downgrade path, with a load-preserving rest-or-easy-day swap (Track B / §3 slot-finder).
- **Manual move (§7)** — a click-to-pin popover on a future day cell lets the athlete shift a planned
  session directly onto a clear rest day, no waiting for a miss; validated server-side (future-only,
  rest-target-only). `PUT /api/reschedule`, `components/MoveDay.tsx`
- **Session swap (§7 follow-on)** — trade any two future, already-occupied sessions directly (e.g.
  today's ride with tomorrow's) — the gap Manual Move can't reach (it only moves onto a clear rest
  day). Reuses the existing swap-pair calendar mirror. `PATCH /api/reschedule`, `components/SwapDay.tsx`
- **Bidirectional calendar mirror (§7)** — every app-initiated move (reactive, proactive, manual) mirrors
  outbound to the athlete's real Intervals.icu calendar; moves made ON Intervals.icu itself (dragging a
  NodeVelo event) reconcile inbound at sync time — future-only, onto rest days only; anything ambiguous
  surfaces as a sync warning, never a silent mutation. `lib/calendar-mirror.ts`

## Trends page (Wave 5, verdict-first rebuild)
- **Fold-1 verdict** — one sentence, three axes: engine ↑/↓/steady (CTL slope + Pw:HR trend) ·
  delivery avg + direction (execution average) · fueling banded off the energy-availability proxy —
  each axis carries a derivation tip. Ranked coach insights follow (top 3 visible, rest + the
  validation track record behind a disclosure). `lib/trends-verdict.ts`
- **ENGINE group** — Pw:HR efficiency trajectory (outdoor-only, endurance band, ≥45 min), CTL fitness
  curve, and HRRc (heart-rate recovery after a sustained hard effort — the interval-day counterpart to
  Pw:HR's easy-day read), side by side. Section renders once any one signal has ≥3 qualifying points.
  HRRc is rendered as a **neutral, unscored sparkline** — deliberately no green/red trend verdict,
  since HRR can rise *or* fall normally depending on training-phase intent (rising during a
  well-tolerated overload block is expected, not a red flag) and the app can't yet disambiguate that
  without reading Season phase. `hrrcSeries` — `lib/trends.ts`
- **DELIVERY group** — execution-quality per-session bars and per-type planned-vs-actual merged into
  **one card with a toggle** (previously two separate flat sections).
- **LOAD & FUEL group** — fueling & weight (complete weeks only; absorbs latest weight, weight
  trend, and last intake — the old "Last 7 days" tile row is gone, its tenants relocated here) ·
  weekly volume chart, sized to use its card's full height (was ~109px of dead air below the caption).
- **MILESTONES group** — recent baselines row (**w/kg @ threshold** · weekly hours · rides/week ·
  avg load/ride, 90-day rolling, "Load" naming aligned to Intervals.icu) · block history, collapsed.
  `lib/trends.ts`, `components/Trends.tsx`, `components/trends/sections.tsx`

## Nutrition (code, not AI)
- **Early goal-trend warning** — Today surfaces an informational, evidence-gated warning when the
  observed 21-day weight trend misses the configured goal despite estimated prescription adherence;
  calories stay unchanged while maintenance calibration gathers stronger evidence.
- **Deterministic targets** — daily kcal = trusted rest/train `k` (pooled/default fallback while the
  active split is low-confidence) × RMR + net active burn + the feed-forward weight-goal buffer, with
  an RMR floor. Pre/in/post carbs and protein use the same resolved model; AI only phrases the table.
  `lib/nutrition.ts`
- **Prescription safety warning** — Today warns when the prescribed target itself falls into the app's
  low-EA band. Informational only: it never changes calories. `lib/nutrition.ts`
- **Weekly energy balance (§6)** — precise intake-vs-need ratio per complete week (need = the app's
  own daily-target formula, day-matched to logged days), banded low/adequate/ample; owns the
  snapshot's `fuelingState` when present (EA proxy is the fallback). Trends readout + CoachSnapshot.
  `lib/trends.ts`, `lib/nutrition.ts`
- **Post-ride fuel prompt** — log-nudge on qualifying rides (≥90 min or a Threshold/VO2max/SIT/RaceSim
  day) left unlogged; once calibration is trustworthy, a gap-vs-derived-optimum read instead. Quiet
  Today-card chip + one-line coach-note mention. `lib/fuel-prompt.ts`
- **Pre-ride loading loop** — day-before carb-loading target (7 g/kg) ahead of a durability long
  ride, one-tap loaded/skipped attribution, both frozen onto the ledger; the loop learns whether
  loading improves late-effort delivery (power-only outcome, templates B–E) and stops prescribing
  on a proven no-effect. `lib/loading.ts`, `app/api/loading`

## Profile · Knowledge · Settings

### Profile (Wave 5, read-first dossier)
- **The rider read (hero)** — power curve + phenotype line, current performance (FTP · tHR · maxHR,
  from Plan), synced weight, all-time PR strip — provenance badges kept. Rider-profile watts
  de-duplicated against the Power-PRs card (which already owns the power-duration curve numbers) —
  each "current numbers" surface now answers a different question instead of repeating watts.
- **Zones & effort bands** — synced; collapsed into a compact disclosure (reference data, not
  something read every visit).
- **Goals & weakpoints** — compact read view, grouped by focus (`groupGoalsByFocus`) instead of a
  flat list with a per-row chip — reads `goal → target` under focus headings, "general" clustering
  honestly as "all phases"; the add/edit/delete form (each goal taggable by `SeasonFocus`) sits behind
  an inline "▸ edit" disclosure, no modal. `lib/profile-goals.ts`
- **Nutrition formula** — compact read + buffer-adjustment status; the full form is behind a
  disclosure. Season objective/events moved to Plan — no longer edited here.

### Knowledge
- In-place markdown editor for the KB + retrospectives (read fresh on every generation), plus a
  new always-visible one-line **provenance header** above the file list — which files feed
  generation vs. reference-only vs. manual vs. seed (previously this context only surfaced per-file
  after selecting one).

### Settings (Wave 5, two labelled groups)
- **GENERATION** — weekly volume targets, weekly structure, training philosophy & equipment.
- **PLATFORM** — platform-behavior toggles (auto-sync-on-open, auto-post-coach-note), AI usage &
  cost, exact backup & restore. (Fixed a mis-grouping bug: these previously rendered under GENERATION.)

## Platform & reliability (local-first)
- **TanStack Query** client (focus/reconnect refetch, dedup) · **observability + cost** tracking ·
  **export/import backup & restore** · **error boundaries** · model + `promptVersion` provenance
  stamping · atomic JSON writes with `.bak` recovery. (See ARCHIVE P-series.)
