# NodeVelo — feature catalogue

What the app can do today, grouped by area. This is the **capability map**; for *how* it works see
[README.md](README.md) (architecture), for *what's next* see [ROADMAP.md](ROADMAP.md), and for the
*work log* see [ARCHIVE.md](ARCHIVE.md). Everything here is deterministic TypeScript unless noted as
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

## Season & macro-periodization (Plan / Profile pages)
- **Season objective + target events** — an athlete-owned objective string and A/B/C-priority event
  list, edited on `/profile`'s Season section. `GET`/`PUT /api/season`, `lib/season.ts`
- **Macro-periodization engine** — a rolling base→build→realize cycle (deload cadence + ACWR-capped
  load ramp) is the live default with no event on the calendar; a fully-built event-anchored mode
  (backward taper→peak→build scheduling) activates automatically the moment a future A-event exists.
  `replanSeasonArc`, `validateSeasonFit` — `lib/season.ts`
- **Season-aware block pre-fill** — the block generator's length selector (now **2/4/6/8** weeks)
  pre-fills from the season's current period (`suggestedBlockWeeks`); the goal textarea pre-fills to
  goals tagged with the period's focus + every general-tagged goal (`filterGoalsByFocus`); a
  one-line season-context readout renders above the generator fields. All freely overridable, never
  locked. `components/dashboard/{PlanView,BlockGenerator}.tsx`
- **Block-completion prompt** — once the active block's `endDate` has passed, the Today planned-
  session card proactively nudges the athlete to generate the next one instead of sitting on stale
  "no session planned" copy. `isBlockFinished`, `lib/date.ts`, `components/dashboard/today.tsx`

## Block generation (Plan page)
- **Goal-driven, KB-grounded generation** — knowledge base + live zones + athlete-model insights +
  retrospective seeds + season context + a deterministic nutrition table → `claude-sonnet-4-6` via
  **structured tool-use** → validated `PlannedDay[]`. `app/api/generate`, `lib/anthropic-api.ts`, `lib/plan-schema.ts`
- **Deterministic session selection (Track B)** — a terrain/race goal *requires* a RaceSim quality
  session: the requirement is injected into the prompt and enforced post-generation (warning if missing).
  `lib/session-requirements.ts`
- **Durability templates (Track B)** — durability is a category of 5 rotating long-ride templates
  (A pure accumulation … E mixed density), picked limiter-driven from the athlete model else rotated,
  and stamped on the block. KB §12 + `lib/durability.ts`
- **KB-grounded protocol validation** — every generated workout checked against KB interval bands
  (SIT 4–6×20–30s all-out · VO2max 3–8min 106–120% · threshold 88–105%); drift surfaces as a warning.
  `lib/workout-validate.ts`
- **Schedule-placement validation** — flags back-to-back hard days and any week over the quality budget.
  `lib/schedule-validate.ts`
- **Execution cues** — each day can carry one KB-/weakpoint-grounded pacing or technique cue.
- **Preview → write** — `PlanPreview` shows every day before anything is written; `POST /api/write`
  posts to the Intervals.icu calendar and freezes the block (with the FTP used). `app/api/write`
- **Generation dedupe** — a double-click / repeat request in a short window shares one Claude call.
  `lib/generate-cache.ts`

## Today page
- **Readiness zone** — fused **Athlete State** (0–100 + band + recommendation, §5 signal fusion),
  readiness badge (Build/Hold/Recover), fatigue + load-ramp alerts, and a TSB·ACWR·polarization strip
  with explanatory hovers. `lib/athlete-state.ts`, `lib/readiness.ts`
- **Proactive morning check-in (#3)** — before a quality session, a few chips (fatigue/sleep/soreness/
  motivation + illness) → a deterministic *proceed* or *downgrade + reschedule* decision; applying it
  downgrades today and moves the stimulus to the next rest day (else swaps with an easy day).
  `components/MorningCheckIn.tsx`, `lib/morning-check.ts`, `app/api/morning-check`
- **Today's ride card** — planned vs actual, a curated metric strip (IF + effort band + **basis stamp**
  `· NP`/`· avg` · NP · avg power · RPE), the 1–10 execution score, prescription-vs-execution rep breakdown,
  a smoothed power/HR trace with interval bands, power-zone bars, and advised daily intake. *Decoupling*
  lives in the collapsed "Power execution" drill-down (it's context, not a scored signal); avg speed was
  dropped. `components/dashboard/today.tsx`, `lib/trace.ts`
- **Energy-availability tile** ⭐ — a deterministic fuel proxy `(logged intake − ride burn)/kg`, averaged
  over recent *complete* days (today excluded), with a week-over-week trend. No clinical band (it's a
  body-weight proxy off self-logged intake — said so in copy); withheld below 3 logged days. `lib/nutrition.ts`
- **Calibrated-honesty UX** — the UI grades its own certainty: metric **provenance** stamped (IF NP-vs-avg),
  thin **Athlete-State** reads flagged (amber "low confidence"), and numbers the engine can't trust yet are
  withheld (`—`) rather than shown flaky. `components/AthleteStateCard.tsx`, `components/dashboard/today.tsx`
- **Power-PR trophy** — a new best vs the previous sync's curve is called out (banner + coach note). `lib/pr.ts`
- **Session disposition** — attribute a ride completed/partial/compromised; only *compromised* changes scoring.
- **Coach note** — AI 2–3 sentence narrative of today vs plan; re-analysable. `app/api/analyze`
- **Ask-Coach** — a low-token spot-check that reads the resolved **CoachSnapshot** (block, today's
  execution, form + TSB modifier, fuel, directives, the morning check, and the disposition guard).
  `app/api/ask`, `lib/coach-snapshot.ts`
- **Trend pulse + coach accuracy** — a glanceable improvement read + how often matured directives proved right.

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
  actionable-modifier · fuel · fused state · directives · disposition · morning check) read by Ask-Coach
  and generation, so the LLM can't invent numbers. `lib/coach-snapshot.ts`
- **Per-athlete calibration (partial)** — auto-tuned EWMA α + ACWR bands (the hybrid auto/manual hook). `lib/calibration.ts`

## Adaptive scheduling
- **Reactive reschedule** — a missed/compromised quality session is detected and offered a make-up on the
  next clear rest day (athlete-confirmed, local block). `lib/reschedule.ts`, `components/RescheduleBanner.tsx`
- **Proactive reschedule** — the morning check-in's downgrade path, with a load-preserving rest-or-easy-day swap (Track B / §3 slot-finder).

## Trends page
- **Pw:HR efficiency trajectory** (outdoor-only, endurance band, ≥45 min) · **CTL fitness** curve ·
  **execution-quality** + **weekly-volume** bars (magnitude-shaded, with hovers) · **fueling & weight**
  (complete weeks only) · **insight track record** · **block history**. `lib/trends.ts`, `components/Trends.tsx`
- **Recent baselines (curated)** — single numbers not already a chart: **w/kg @ threshold** · weekly hours ·
  rides/week · avg load/ride (90-day rolling, "Load" naming aligned to Intervals.icu). `components/trends/sections.tsx`

## Nutrition (code, not AI)
- **Deterministic targets** — daily kcal (base + session kJ + buffer; flat on rest days) + pre/in/post
  carbs & protein; buffer self-adjusts ±150 kcal against the 7-day weight trend. The AI only phrases the
  pre-computed table. `lib/nutrition.ts`
- **Post-ride fuel prompt** — log-nudge on qualifying rides (≥90 min or a Threshold/VO2max/SIT/RaceSim
  day) left unlogged; once calibration is trustworthy, a gap-vs-derived-optimum read instead. Quiet
  Today-card chip + one-line coach-note mention. `lib/fuel-prompt.ts`

## Profile · Knowledge · Settings
- **Profile** — synced performance (FTP, threshold/max HR), all-time PRs, an add/edit/delete goals &
  weakpoints form (each goal taggable by `SeasonFocus`), a Season section (objective + target
  events), nutrition settings.
- **Knowledge** — in-place markdown editor for the KB + retrospectives (read fresh on every generation).
- **Settings** — volume/structure knobs, polarised vs sweet-spot, quality budget, platform toggles.

## Platform & reliability (local-first)
- **TanStack Query** client (focus/reconnect refetch, dedup) · **observability + cost** tracking ·
  **export/import** backup · **error boundaries** · model + `promptVersion` provenance stamping ·
  atomic JSON writes with `.bak` recovery. (See ARCHIVE P-series.)
