# NodeVelo — archive (completed work)

A record of shipped work, kept out of the lean live trackers so they stay readable.

- **Live punch-list** (incoming bugs / feedback): [todo.md](todo.md)
- **Forward backlog** (what's next): [ROADMAP.md](ROADMAP.md)
- **Research spikes** (not committed): [research.md](research.md)
- **This file**: everything already done.

Entries are grouped by theme. Most reference the module(s) touched; see git history for the
exact commits.

---

## 6-week block review: season multi-period, protocol false-positives, hours, press-lap (2026-07-14)

Reviewed a live 6-week block generated after the token-budget fix above and traced its four validator
warnings plus a volume complaint to root cause, then fixed all of them (three parallel subagents, one
each — file-disjoint by design so they could run concurrently with no merge risk — plus a fourth
research-only agent for the press-lap syntax question).

- **Season multi-period awareness** (`lib/season.ts`, `app/api/generate/route.ts`). The season context
  injected into the prompt, and `validateSeasonFit`'s check, were both a single static snapshot of
  whichever period was active at generation time — fine for a 2-4 week block, broken for 6-8 weeks,
  which routinely spans 2-3 periods. A live block spanning aerobic-base → anaerobic → threshold had its
  own overview call the whole thing "aerobic-base," and the fit-check blamed build-week quality work on
  the base period's 90/10 expectation. New `periodForDate`/`periodsInRange` + a multi-segment
  `formatSeasonContext` (byte-identical single-period output preserved, pinned by test) + per-day-scoped
  `validateSeasonFit` fix it. Also switched hard-share from session-count to duration-weighted, which
  independently fixes a structural false positive: `qualitySessionsPerLoadingWeek=2` on a 6-day week is
  already ~33% by count, guaranteeing the old 20%-ceiling warning fired on every base-period block
  regardless of what was generated.
- **Warmup/cooldown steps mis-validated as work** (`lib/prescription.ts`, `lib/workout-validate.ts`).
  `parsePrescription`'s own doc comment said warmups are ignored, but the implementation was blind to
  sections entirely — a warmup priming step at 80-85% FTP cleared the flat 80% work-threshold and got
  validated against the day's *main-set* protocol, producing warnings like "effort at 80% FTP is below
  the 130% floor" for what was actually a normal warmup, not a malformed SIT set. Steps under a
  Warmup/Cooldown label are now dropped outright; TDD confirmed 7 of 10 new tests were red for exactly
  the reported shape before the fix.
- **Weekly hours under-following their own stated floor** (`lib/anthropic-prompts.ts`). A live block's
  loading weeks landed at 8.5-10.8h against a stated "10-12h, at least 10h" instruction — two of four
  weeks below the floor, not a target-setting mismatch. The long ride was correctly sized every week;
  the shortfall was in easy Z2 sessions landing compact (60-90min, an explicit prompt cap) rather than
  filling the range. Rewrote the instruction to make hitting only the minimum count as a shortfall and
  named easy-session duration as the lever, removing the `(60-90 min each)` cap that was itself part of
  the problem.
- **Intervals.icu "press lap" step syntax** — researched (forum + official docs, not just the athlete's
  paraphrase) and added to `WORKOUT_SYNTAX_GUIDE` plus `knowledge-base/training_knowledge.md` §7. Verified
  mechanism: the literal phrase "press lap" in a step ends it on the device's lap button instead of a
  timer — Garmin/Suunto via Garmin Connect only, inert elsewhere — adoptable through the exact same
  plain-text calendar-description path this app already uses, no new integration. Scoped to
  positioning/readiness steps only; never the actual prescribed work interval.

**Live-verified together** (not just unit tests): a fresh 6-week generation, after all three fixes
landed, produced an overview that correctly narrates the phase shift ("Weeks 1-2 are a base deload...
Weeks 3-5 shift into an anaerobic build... Week 6 pivots to threshold"), a season-fit warning precisely
date-scoped to the base-period portion at a plausible 25% (vs. a blanket 33-71% before), no SIT/VO2max
false positives, and loading weeks in the 10.2-10.8h band for the weeks not affected by a season deload
flag.

---

## Goals/weakpoints: profile ↔ block-generator round-trip (2026-07-14)

Follow-up from the block-generation work below, prompted by the athlete asking for concrete goal/
weakpoint suggestions based on the just-finished block's retrospective and actual power-curve data
(FTP 288W, 1-min 507W, 5s 749W vs. reference ratios — confirmed neuromuscular/5s is the real
depressed system, not 5-min/VO2max as the stale weakpoint text implied). That surfaced a structural
gap: the block-generator's free-text goal/weakpoints boxes and the Profile page's structured editor
were two fully disconnected surfaces — edits in one never reached the other.

- **Weakpoints textarea silently dropped `detail`.** `PlanView.tsx`'s prefill joined only
  `w.weakpoint`, discarding every weakpoint's explanation on every page load. Now pre-fills as
  `"label: detail"`.
- **Opt-in "Save to profile" action** (`components/dashboard/BlockGenerator.tsx`,
  `lib/profile-goals.ts`) parses the edited free text back into the profile's structured shape and
  PUTs it — deliberately not automatic, so a one-off per-block wording tweak doesn't force a
  permanent profile change. Goals need a **scoped merge**, not a blind replace: the goal box is
  pre-filled from `filterGoalsByFocus` (only the current season period's goals + `general`), so a
  goal outside that shown subset is always preserved untouched; a shown goal still present in the
  text keeps its `focus` and takes the edited target; a shown goal removed from the text is treated
  as a deliberate deletion; a genuinely new label defaults to `focus: "general"` (the text has no way
  to express a focus). Weakpoints have no subset problem (the box always shows the full list), so
  parsing the text is the new array directly.
- **Verified live** against the real API and `data/athlete.json`: added a throwaway goal/weakpoint
  through the UI, confirmed the merge preserved all 8 existing goals' targets and all 9 weakpoints'
  `detail` text while adding the new entries, then removed them and re-saved to confirm deletion
  semantics and restore the original profile exactly.

_Deferred:_ focus-tag selection in the block-generator box itself. On inspection, `focus` only
controls whether a goal auto-populates into the box for the *current* season period — it's not a
scheduling constraint, doesn't change what the model generates, and (since a goal tagged to a
non-current focus can silently vanish from the box on the next profile refresh) risks being mistaken
for something it isn't. The athlete's goals are all `general` today (always shown) and no
phase-scoped goals were wanted, so this wasn't built.

---

## Reliable long-block generation + generator/season UI fixes (2026-07-14)

Debugged three athlete-reported issues that traced back to one unfinished plan
(`docs/superpowers/plans/2026-07-13-reliable-long-blocks-and-season-clarity.md`) an external agent
(Codex, branch `codex/reliable-long-blocks`) had started but only partially shipped — it committed
the (insufficient) grid-breakpoint change and left failing test scaffolding for the other two tasks.

- **6/8-week generation failures.** `generateTrainingBlock` (`lib/anthropic-api.ts`) used a fixed
  8,000-token ceiling regardless of block length; a 6-week block's 42 structured days routinely hit
  it mid tool-call, producing a generic "did not return a structured plan" error with no hint why.
  Added `generationMaxTokens(lengthWeeks)` (8k/8k/12k/16k for 2/4/6/8 weeks) and threaded the
  provider's `stop_reason` through `GenerationResult` so `/api/generate` can surface a precise,
  retryable "exceeded the response limit" error instead. **Live-tested against the real Anthropic
  API**: a 6-week block generated cleanly, 42/42 days, no truncation.
- **BlockGenerator field overlap.** Codex's committed fix (`lg:grid-cols-4` → `xl:grid-cols-4`)
  didn't actually resolve it — measured real ~44–60px overlap between the "8 weeks" button and the
  Start Date field at both 1280px and 1440px (MacBook-realistic widths) via live DOM measurement.
  Root cause was the length-buttons' fixed min-content width exceeding any single grid column at
  realistic widths, not the breakpoint. Fix: the four buttons render as a 2×2 grid
  (`components/dashboard/BlockGenerator.tsx`) instead of a shrinking single row, so they can't
  overflow their cell regardless of viewport width.
- **Unexplained season roadmap.** `SeasonRoadmap` showed the auto-derived roadmap with no
  explanation of where it came from. Traced construction: `replanSeasonArc` (`lib/season.ts`) runs
  inside every `/api/generate` call, freezing past periods, preserving the in-progress period and any
  athlete-edited overrides, and re-drafting future ("derived") periods from the saved objective/
  events/CTL/FTP/recent load/limiter. Added one line under the roadmap explaining this when any
  period has `source: "derived"`.
- **Side effect caught mid-verification**: `npm test`/`npm run lint` weren't excluding the gitignored
  top-level `.worktrees/` (only `.claude/worktrees/*` was covered) — a stray worktree's own copy of a
  test fired a real, bogus-key network call to Anthropic during the verification run. Fixed both
  `vitest.config.ts` and `eslint.config.mjs`.

**Cleanup**: removed the superseded `codex/reliable-long-blocks` branch + its `.worktrees/` checkout,
and two other stale branches (`ui-fixes`, `worktree-ui-research`) that had zero commits beyond what
`main` already contained.

---

## On-plan Z2/Recovery aerobic-baseline merge + diagnostic insight (2026-07-12)

Athlete-flagged discrepancy: the block retrospective's `complianceByType.Z2 = 107%` (pure duration
ratio) contradicted the coaching insight "Z2 is a weak point, 5.4/10" (the HR-ceiling execution-score
axis from the 2026-07-10/11 rework, above). Investigation confirmed both numbers were honest —
they measure different things — but also surfaced a real gap: planned Z2/Recovery rides were graded
against the single-ride HR-ceiling breach (`aerobicDisciplineRead`) only; they never got compared to
the athlete's own 90-day aerobic-efficiency baseline (`aerobicEffPct`, `lib/aerobic.ts`), which
already existed but was wired for off-plan rides and the Today athlete-state driver only. Plan:
`docs/superpowers/plans/2026-07-12-01-z2-aerobic-baseline-merge.md`, executed via
subagent-driven-development (6 code tasks, each independently reviewed).

- **Real-data diagnosis before any code changed.** Pulled the athlete's actual June block ledger:
  all 4 indoor (VirtualRide) Z2 sessions scored 9–10 at 0–1.5% HR time above the aerobic ceiling;
  outdoor rides split bimodally — controlled ones (1.3–8.7% above ceiling) scored 8–10, "ran hot"
  ones (17.7–34.1%) scored 1–6. Confirmed separately that fatigue-cost tracking (CTL/ATL/TSB/ACWR)
  was already correct — it reads Intervals.icu's real per-ride `trainingLoad`, not a planned figure —
  measured controlled Z2 rides at ~0.73–0.84 TSS/min vs. ~1.03–1.15 TSS/min for ran-hot ones, a real
  25–55% load premium already flowing into the fatigue model with no code change needed.
- **The merge (`lib/execution-score.ts`, `mergedEasyRead`).** The HR-ceiling read and the aerobic-
  efficiency-vs-baseline read share one physiological cause (HR up relative to power) observed at two
  granularities — resolved to one merged read, not two stacked penalties. HR-ceiling "hot" stays the
  primary judge (−4, unchanged, eff ignored — already the full guardrail). A new "corroborated drift"
  path (drift + `aerobicEffPct ≤ −6%`) adds **−2**, capping that ride at 7/10 — an intermediate step
  between plain drift (0) and hot (−4). A "hollow dialed" ride (HR-ceiling clean, but a bad baseline
  reading) withholds the +1 bonus rather than penalizing — Pw:HR is flaky (heat/hydration/caffeine),
  so it should never cost points when the HR-ceiling discipline itself held. No new bonus is ever
  granted from `aerobicEffPct` on-plan, preserving the existing zero-margin guardrail invariant.
- **Ledger provenance stamp.** `RideScoreEntry.easy?: { indoor, hrRead?, aerobicEffPct? }`
  (`lib/score-log.ts`, `easyStampFor`) freezes the inputs behind the merged read, planned Z2/Recovery
  + non-embeds-efforts only — mirrors the `fuel`/`intervals` provenance pattern so the athlete model
  can diagnose indoor/outdoor + ran-hot patterns without re-joining activities. The sync route's
  today-patch re-stamps from the same re-bucketed HR data the day's `executionScore` uses (not the
  raw synced zones), closing the exact drift-class gap the 2026-07-11 rework's own follow-up fix
  ("Coach-prompt aerobic-discipline gap closed") had already warned about for a different surface.
- **Diagnostic insight (`lib/athlete-model.ts`).** `deriveInsights` now recognises the bimodal
  indoor/outdoor pattern (≥2 hot outdoor rides among ≥3, with a genuinely healthy indoor/controlled-
  outdoor side) and replaces the generic "ease the prescription" suggestion with one naming the real
  pattern and its measured TSS/min premium, falling through unchanged to the old generic branches
  when the pattern isn't present (verified byte-identical against a no-stamp fixture). One deliberate
  judgment call: the "healthy side" check uses a new `outdoorControlledExecAvg` field (outdoor rides
  excluding the hot ones) rather than the mixed outdoor average, because the mixed figure would let
  hot rides pollute the very check meant to isolate from them — hand-verified with a worked example
  during review.
- **Narration.** The ride-note LLM prompt (`lib/anthropic-prompts.ts`) and the Ask-Coach SITUATION
  line (`lib/coach-snapshot.ts`) both surface the efficiency figure when it's notably below baseline
  (`AEROBIC_DEADBAND_PCT`, shared constant — not a re-typed literal), and the "ran hot" label now
  states explicitly that the ride's real training load (not the plan's) is what the fatigue model
  reads, so the extra cost is already counted against freshness.

**Live verification (2026-07-12).** `/api/analyze` re-run on the athlete's actual "ran hot" ride from
today: the real coach note said *"that cost is already sitting in your fatigue model"* — the new
narration confirmed against the live Anthropic API, not a mock. A live block-generation smoke run (to
confirm the new insight reaches `lib/synthesis.ts`'s directive block) was intentionally skipped this
session — the athlete was mid-generating their own next block in the UI at the time, and triggering
`/api/generate` myself would have crossed that boundary even though the endpoint alone is preview-only.
`lib/synthesis.ts` is a plain title/evidence/suggestion string passthrough (independently confirmed
during task review), so the risk of it silently breaking only in the live prompt is low; worth a real
check next time a block is actually generated.

**Ledger rebuild (2026-07-12, `rebuildLedger: true, force: true`).** Re-scored all 15 of the athlete's
real planned Z2 rides under the new logic. Every score matched hand-derived expectations exactly: hot/
dialed/indoor rides stayed byte-identical (the −4 guardrail predates this work); the two rides sitting
in the 10–25% "drift" band did **not** trip the new corroborated-drift penalty, because their real
`aerobicEffPct` was positive or unavailable, not corroborating — a legitimate real-data outcome, not a
bug (this athlete's drift-band rides and bad-baseline rides simply never coincided in this block). One
durability-template ride correctly received no `easy` stamp (the embeds-efforts gate held on real data).

---

## Trend detector was blind to a recovered tail (2026-07-12)

`trendOf` (`lib/athlete-model.ts`) classified a workout type as "trending down" off a blunt
first-half-vs-second-half mean split — so two hot rides sitting mid-window could outvote a real
recent recovery. Live case, post-rebuild (see the entry above): real Z2 history
`[8,10,3,9,10,9,6,6,9,10,3,3,10,8]` read "declining over 14 sessions, consider a recovery week"
despite the athlete's two most recent sessions scoring 10 and 8 — already recovered, contradicting
the insight's own suggestion.

- **Why re-weighting alone doesn't fix it.** `execEwma` (the level stat shown beside trend) is
  already recency-weighted; trend was the one stat in the model that wasn't. But hand-verified: EWMA
  and OLS slope both *still* classify this exact sequence "down" — any global weighting lets a
  two-ride dip buried mid-window outvote a genuine tail recovery. The fix has to explicitly ask "has
  the trajectory already turned?", not just weight recency harder.
- **The fix: a tail-turnaround guard**, symmetric for both directions (a stale "up" is equally
  dishonest — `athlete-state.ts` consumes both). A "down"/"up" verdict only stands if it still holds
  across the **last two** sessions (two, not one, so a single fluky ride can't flip the read either
  way) — reuses the existing `eps` tolerance, no new magic numbers.
- **Genuine declines still read as declines** — the existing monotonic-decline test case
  (`[8,7,6,5,4,3]`) is untouched by the guard (tail stays meaningfully below baseline).
- Designed and implemented by a Fable 5 subagent per the architecture/design-tradeoff escalation
  trigger — this changes trend semantics for every workout type plus the overall-execution insight,
  not a Z2-specific patch.

**Live verification:** `/api/trends` and the rendered `/trends` page no longer show "Z2 trending
down" against the real ledger. The "Execution trending down" (Overall, 22-ride window) insight still
fires — checked by hand: a genuine borderline case, its tail sits 0.08 below the recovery bar, not a
regression, and already carries the hedged "could be accumulated fatigue, a harder block, or more
outdoor riding" wording from the 2026-07-11 honesty fix.

---

## Morning-check live-use fixes + ride-note HR-discipline surface + the one-time ledger rebuild (2026-07-12)

Four fixes from one live-use report (the athlete skipped a 60-min Z2 for extreme fatigue and the app
fought them at every step), landing the day the block turns over — so the turnover reads honest data.

- **Morning check: verdict survives refresh.** The GET already returned today's stored flag, but the
  component only rendered the in-memory POST result — a reload silently fell back to the collapsed
  prompt (the athlete's flag "disappeared" every refresh; the write had in fact persisted). The card
  now re-derives from the stored entry: `MorningCheckEntry` gains sparse `reasons` (frozen at flag
  time — recomputing later drifts once an applied downgrade changes today's quality-day status) and
  `appliedAt` (stamped by PUT, so a refreshed UI shows "applied" instead of re-offering an Apply that
  would now 400). A "Change" affordance re-opens the prompt; one entry per day, re-submission replaces.
- **Morning check: ill/extreme-fatigue on easy days.** Previously gated to quality days ("nothing to
  downgrade"), leaving only "Injured" on a Z2 day — the athlete had to record a false injury to skip.
  All three flags now surface on any ride day; on an easy day ill/fatigue verdict **rest** (skip the
  volume day — it costs little; grinding through digs the hole deeper), preserving the quality-day
  downgrade machinery unchanged.
- **`formatCoachSnapshot` morning-check line mislabeled.** An injury flag rendered as "extreme fatigue
  → no change (not a quality day)" — both halves wrong (the label map only knew two flags, the decision
  map only knew downgrade). All three flags and decisions now render honestly, with rest framed as
  deliberate recovery, not a lapse.
- **Ride-note prompt: the third LLM surface with the terrain-confound bug.** `buildRideAnalysisPrompt`
  still said "Power is the primary lens" and handed the model a raw power-zone distribution with no HR
  context, so the debrief coach note re-derived the exact "zone creep" narrative the 2026-07-11 scoring
  rework eliminated (the real 07-10 note called a dialed-in hilly Z2 "significant zone creep", score 3,
  while the rebuilt ledger scores it 8). `RideAnalysisInput` gains `aerobicDiscipline` (wired from the
  stored `TodayAnalysis` in `addCoachNote` — first-generation and re-analyse both carry it); when
  present the prompt instructs judging "was it easy" ONLY on the HR-judged read. **Live smoke run:**
  force-regenerated the real 07-10 note — now *"discipline was genuinely dialed in: 91% of the ride in
  Z1–Z2 HR"*, credits the −3.5% Pw:HR drift as durability, and critiques only the honest deviation
  (92 min ridden vs 60 planned).

**One-time data operations (same session, not commits — `data/` is local):**
- **The sanctioned ledger rebuild ran** (`POST /api/sync {rebuildLedger: true}`, one-shot marker now
  written). All 124 entries re-scored from synced activity data under the current HR-judged
  methodology: Z2/Recovery average **5.6 → 7.4** (07-10: 3→8, 07-01: 6→9, 06-28: 1→6) while genuinely
  hot rides stayed low (07-04: 1→3, 07-05: 2→3). Athlete-state execution read 5.4 → 7.3; the false
  "struggling with Z2 (4.9/10)" insight pattern is gone from the block-turnover inputs. What remains
  ("Z2 trending down", watch severity) is derived from honest scores — driven by the two real hot rides.
- **The same sync pulled HRRc for the first time** — the cached `last-sync.json` predated the HRRc
  parser (0/191 activities had the field; the Trends card correctly hid). Now 91/190 carry a reading,
  52 qualify for the outdoor-only series, and the HRRc sparkline renders in Trends' Engine group.
- **Corrected the 2026-07-11 morning-check entry** from `injury` (the only button available at the
  time) to `extreme-fatigue`/rest — what the athlete actually reported.
- **Aligned the frozen 07-10 debrief** with the rebuilt ledger (score 3→8, compliance un-capped
  54→100, `aerobicDiscipline: "dialed"` added) before regenerating its note.

---

## HRRc — heart-rate-recovery Trends signal (2026-07-10, shipped 2026-07-11)

Adds HRRc (heart-rate recovery after a sustained hard effort) as a second HR-derived Engine signal on
Trends, alongside Pw:HR — Pw:HR only reads on easy Z2 rides, HRRc only reads on hard/interval rides, so
together they cover both ends of the intensity spectrum from the same HR strap. Plan:
`docs/superpowers/plans/2026-07-10-06-hrrc-trends-signal.md`.

- **Synced defensively.** `ActivitySummary.hrrc: number | null` — multi-keyed against the Intervals.icu
  payload the same way `decoupling` already hedges two possible keys, since the exact field name was
  unconfirmed going in.
- **`hrrcSeries()`** (`lib/trends.ts`) mirrors `efSeries()`'s shape exactly: outdoor rides only, sorted
  by date, `{date, value}[]`. Wired into `/api/trends`.
- **Rendered as a neutral, unscored sparkline** — deliberately no `trendDir` verdict badge (the
  green/red "improving"/"declining" treatment every other Engine card gets). **Why it stays out of the
  Today fatigue fusion, on purpose:** functional-overreaching research finds HRR *rises* (not falls)
  during a deliberate, well-tolerated overload block — the opposite of the "faster recovery = fresher"
  intuition. A metric whose "good" direction flips depending on training-phase intent can't safely cap
  a daily readiness score without knowing whether the athlete is intentionally mid-overload, and the
  app has no such disambiguation today (it would need to read Season phase — real scope, not a tweak).
  Same "read the trend, not the point" caveat Pw:HR already carries, stated explicitly in the caption.
- **Engine section gate extended** — the section now renders on `data.hrrc.length >= 3` alone, not just
  `ef`/`ctl`, so a rider with qualifying interval efforts but no steady Z2 rides still sees Engine.

**Live verification (2026-07-11):** checked against 42 real rides (~45 days) via the live Intervals.icu
API. The plan's original field-name guess (`numLoose(a.icu_hrr)`, a flat number) would have silently
read `null` forever — the real payload nests it (`icu_hrr: {start_bpm, end_bpm, hrr, ...}` or `null`),
so the actual bpm-drop value lives at `icu_hrr.hrr`. `icu_hrrc` doesn't exist in the real payload at all
(kept as a harmless dead fallback alongside a bare `hrrc` key, in case a future API revision adds it).

**Final-review fixes:** removed a dead unused `FOCUS_LABELS` import in `SeasonRoadmap.tsx` (left over
from the season-teaching-flow plan below); the new `hrrcSeries` test used untyped `{...} as any`
fixtures instead of the file's own typed `act()` helper — 4 real `@typescript-eslint/no-explicit-any`
lint errors, caught and fixed when this batch was finished and pushed after the session that built it
ran out of credits mid-review.

---

## Layout density — Plan calendar & Trends dead-space (2026-07-10, shipped 2026-07-11)

Two presentational fixes, each grounded in measured DOM geometry (1280×800 viewport,
`getBoundingClientRect`, re-measured after each change rather than trusted from a screenshot — the
capture pipeline scales the JPEG). Plan: `docs/superpowers/plans/2026-07-10-05-layout-density.md`.

- **Plan calendar hoisted + resized.** The Active-block card previously stacked header → overview →
  "This week" → calendar, burying the block's primary artifact and reschedule surface (28px cells)
  under 393px of text/stats. Calendar now sits directly under the header with a proper drag/tap cell
  height; the long overview moved to the bottom.
- **Trends "Weekly volume" card filled.** Force-stretched (`items-stretch`) to match its taller sibling
  card, its 56px bar chart left ~109px of dead air below the caption. Bars now sized to use the space
  (chart height ≈130px).
- Explicitly **not** touched: `RescheduleBanner` position (alerts stay high, per UX-CONSTITUTION §4);
  the Engine sparkline cards' padding (intentional thin-SVG look); a "Recent baselines stretched"
  concern that was measured and found to be a non-issue.

---

## Profile page density (2026-07-10, shipped 2026-07-11)

Cut Profile-page redundancy and bulk across two presentational components, no data/API changes. Plan:
`docs/superpowers/plans/2026-07-10-04-profile-density.md`.

- **Effort Bands collapsed** into a compact disclosure — reference data, not something read every
  visit.
- **Rider-profile watts de-duplicated against Power PRs** — Power PRs already owns the power-duration
  curve numbers; Rider-profile keeps the phenotype label + strong/weak read, drops the redundant watts.
- **Goals grouped by focus** (`lib/profile-goals.ts groupGoalsByFocus`) instead of a flat list with a
  chip per row — reads `goal → target` under focus headings; shares the `SeasonFocus | "general"`
  union and `FOCUS_LABELS` (below) with `lib/season.ts`, so "general" clusters honestly as "all phases"
  rather than reading as noise.
- **Scope correction made during planning, not after:** the Profile "Current performance" tiles and the
  Trends "Recent baselines" tiles mostly show *different* things (the only real overlap is
  w/kg@threshold) — no broad Current-Performance↔Recent-Baselines de-dup was needed; the actual
  intra-page duplication was Rider-profile↔Power-PRs, above.

---

## Season ↔ Block teaching flow (2026-07-10, shipped 2026-07-11)

Makes the Season → Block → goal relationship legible through UI structure instead of prose — the
pieces already existed and were wired in data (`SeasonRoadmap`, `currentPeriod`,
`filterGoalsByFocus`, `suggestedBlockWeeks`); the gap was purely presentational. No new engine logic.
Plan: `docs/superpowers/plans/2026-07-10-03-season-block-teaching-flow.md`.

- **Honest focus labels.** `FOCUS_LABELS` (`lib/season.ts`) maps `general` → **"all phases"** instead of
  a meaningless-looking default — `general` isn't a physiological system, it means "relevant in every
  phase" (`filterGoalsByFocus` already always includes it; this is display-only, stored values
  unchanged). Consumed by the Profile goals grouping above too.
- **No-season teaching stub** — the roadmap slot on `/plan` now teaches "what a season does" in three
  steps when no season exists yet, instead of sitting empty.
- **Objective field re-scoped, not replaced** — the existing season `objective` input's intro copy and
  label now state the relationship explicitly ("one line on what you're chasing... blocks are generated
  *against* it"), rather than reading as a vague freeform text box.
- **Generator shows what it's targeting** — a "Targeting `<phase>` · pulling N goals · edit profile →"
  line now renders above the block generator, sourced from `FOCUS_LABELS` + `filterGoalsByFocus`
  against the season's current period.

---

## NP-missing ledger honesty stamp + two UX v2 Wave 5 polish nits (2026-07-11)

Three small, independently-diagnosed items closed together from ROADMAP's UI-refinements and
scoring-core-gaps sections.

- **`RideScoreEntry.npUnverified` (ROADMAP #8).** The Today debrief already shows an "NP"/"avg" IF
  provenance badge for the live ride (`components/dashboard/today.tsx`), but the historical ledger
  had no equivalent — a ride whose `intensityFactor` fell back from normalized power to raw avg
  watts (NP absent) was indistinguishable from a true NP-based entry once frozen. `npStampFor`
  (`lib/score-log.ts`, mirroring the existing `calStampFor`/`fuelStampFor` provenance-stamp pattern)
  freezes `npUnverified: true` onto both planned and off-plan entries in `buildRideScores` when
  `normalizedPower` is null but `avgWatts` still let the IF compute — sparse-field convention, absent
  (not `false`) on every other entry, so the corpus's trainable data carries this honesty signal
  without a migration. Provenance only for now, same as `formState`/`fuel`/`preLoad` — no new UI
  consumer yet.
- **`VerdictStrip`'s "down" axis chip colored amber, not red** (`components/trends/verdict.tsx`) —
  every other declining Trends signal (`trendDir`, `driverEffectClass`, `ScoreBars`,
  `StateDriversCard`'s bars) uses red for a decline; this one didn't. One-line fix:
  `DIR_CLS.down` now reuses the same `text-red-600 dark:text-red-400` the file's own `WORD_CLS`
  already used for "Slipping". Live-verified: a real "delivery ↓" chip rendered red immediately.
- **`deriveTrendsVerdict`'s "Mixed" bucket fired on net score alone, not real disagreement**
  (`lib/trends-verdict.ts`) — e.g. steady engine + steady delivery + fueling-down netted a mildly
  negative score and bucketed "Mixed," even though no axis was actually in tension with another,
  while a genuine disagreement case (engine down, delivery up) landed on "Holding" instead — backwards
  from what the word should mean. Fixed by gating "Mixed" on an explicit engine-vs-delivery direction
  conflict (one up, one down) instead of a score range; everything else falls through to a
  magnitude-only Improving/Holding/Slipping read (fueling still only ever drags, never lifts). All 4
  pre-existing word tests — including the genuine-disagreement case — still pass unchanged; one new
  test pins the fixed steady+steady+fueling-down → Holding case.

---

## `formatFormFuelLine` mislabel bug closed — block-generation fuel line tracks fuelingState's real source (2026-07-11)

Closed the milder sibling of the `formatCoachSnapshot` fuel-line mislabel bug (fixed earlier the same
day, see the weekly energy-balance entry further down this file): `formatFormFuelLine`
(`lib/coach-snapshot.ts`, feeds the `/api/generate` block-generation prompt) unconditionally labeled
`fuelingState` "energy availability" even when the weekly intake-vs-need ratio, not the EA proxy, was
the actual source — no contradicting kcal/kg figure attached like the Ask-Coach line had, just the
wrong word ("energy availability low" when the athlete's own EA band would call the same kcal/kg
figure adequate).

- **Fix.** Same shape as the already-shipped fix: `label = weekBalance ? "fueling" : "energy
  availability"`, applied before the `fuelingState` value in the generation prompt line.
- **Coverage gap closed.** No existing test exercised the weekly-ratio-present path through this
  specific function (ROADMAP had flagged this) — added one using the same `weekBalance` fixture the
  sibling `formatCoachSnapshot` tests use.
- **No live block-generation smoke run.** `/api/generate` unconditionally re-plans and persists
  `data/season-plan.json` on every call (`replanSeasonArc` → `writeSeasonPlan`) before generating, and
  the generation call itself takes 1–2 minutes against the larger generation model — both a real
  mutation of shared live app state and a real cost, disproportionate to verifying a one-word label
  swap in one line of a much larger, otherwise-unchanged prompt. Verified instead via the new unit
  test against the real `weekBalance` fixture shape, plus typecheck + the full suite green
  (951 tests). The sibling label fix already got a live LLM verification on the equivalent text
  (formatCoachSnapshot → real `/api/ask` call, see below) confirming the LLM handles this label
  correctly when it appears in a prompt.

---

## Coach-prompt aerobic-discipline gap closed — `CoachSnapshot.today.execution` reads the HR-judged signal (2026-07-11)

Closed the gap the HR-judged easy-ride discipline rework surfaced but didn't fix (see "HR-judged
easy-ride discipline" further down this file): `formatCoachSnapshot`'s `today.execution` block
(`lib/coach-snapshot.ts`) independently recomputed `z2Frac` from the old, terrain-confounded
`timeAboveZ2Fraction(ride.powerZoneTimes)`, so the Ask-Coach prompt could still call a genuinely easy,
hilly outdoor ride "drifted hard above zone" on the same ride the HR-based score and Today debrief UI
had already correctly rewarded.

- **Fix.** Deleted the recomputation entirely — `CoachSnapshot.today.execution` now reads
  `ride?.aerobicDiscipline ?? null` straight off `TodayAnalysis`, the field `lib/ride-analysis.ts`
  already computes with the correct HR-based measure and the correct gating (on-plan, Z2/Recovery
  only, `!embedsEfforts`). No gating logic is duplicated in `coach-snapshot.ts` anymore, so it can't
  independently drift from the score's own gates again.
- **Type + prompt line.** `CoachSnapshot.today.execution.aboveZ2Pct: number | null` (a percentage)
  became `aerobicDiscipline: AerobicDiscipline | null` (`"dialed" | "drift" | "hot"`).
  `formatCoachSnapshot`'s SITUATION line changed from `"25% above Z2 cap (dialed in)"` to
  `"aerobic discipline: dialed in"` / `"some drift"` / `"ran hot"` — matching the Today debrief UI's
  own wording exactly, so the athlete and the coach prompt now say the same thing.

**Live verification (2026-07-11):** real `/api/ask` POST against the running app, using the actual
2026-07-10 synced Z2 ride (92 min, hilly outdoor route — HR only 9.6% above aerobic ceiling but power
zones 3+ totalled 20% of ride time). Before this fix that ride's old power-based measure would have
rendered `"20% above Z2 cap (drifted above zone)"` in the coach prompt; the correctly-gated HR read is
`"dialed"`. Patched the one missing field into a scratch copy of `data/today-analysis.json` (the
on-disk record predates this rework and was missing `aerobicDiscipline` — a genuine pre-existing-file
migration gap, not new; the field will backfill on the next real sync) with the exact value the real
`aerobicDisciplineRead(timeAboveAerobicHrFraction(...))` functions compute for that ride's real
HR-zone data, called the live endpoint, then restored the original file. The LLM's actual reply opened
with *"You nailed the aerobic discipline yesterday—that's your strength"* — the terrain-confound bug
is gone on this surface too.

---

## Weekly energy-balance surfacing — §6 part (a) / closes #1's last slot (2026-07-08, shipped 2026-07-11)

Computes the precise weekly intake-vs-need ratio (logged kcal vs. the app's own deterministic daily
targets + ride kJ out) and surfaces it on Trends and in `CoachSnapshot.fuel` — closing `#1`'s last
reserved slot. Plan: `docs/superpowers/plans/2026-07-08-energy-balance-surfacing.md`.

- **Day-matched need formula** — `weeklyEnergy` (`lib/trends.ts`) sums "need" using the app's own
  daily-target formula (`baseCalories + ride kJ + buffer` on ride days, `restDayTarget` otherwise)
  **only over days with logged intake**, so under-logging withholds the ratio instead of faking a
  deficit. `balanceLevel` (`lib/nutrition.ts`) bands the ratio low/adequate/ample (<0.9 / 0.9–1.05 /
  >1.05), reusing the existing `EaLevel` vocabulary rather than inventing a new one.
- **Withholding rules** — a week's ratio only computes with ≥4 logged-intake days
  (`MIN_LOGGED_DAYS_FOR_BALANCE`); `latestWeeklyBalance` fills the CoachSnapshot slot with the
  immediately-prior complete week **only** — a missing or under-logged prior week withholds (`null`)
  rather than substituting an older, stale week.
- **`fuelingState` precedence** — one verdict, never two disagreeing ones (UX-CONSTITUTION §4
  discipline): the precise weekly ratio owns `fuelingState` when present; the daily EA proxy
  (`eaLevel`) remains the fallback band when the weekly ratio is absent (thin data). Documented on
  `CoachSignals.weeklyBalance` and the `fuel` build site in `lib/coach-snapshot.ts`.
- **Two surfaces, deliberately different pickers** — the Trends readout (`components/Trends.tsx`,
  under the fueling & weight chart) shows the **latest available** ratio week (a trends surface:
  show whatever data exists); the CoachSnapshot prompt line shows specifically the week that **just
  closed** (a coaching-context slot: a stale week is worse than silence). Both read off the same
  `weeklyEnergy`/`balanceLevel` computation — never two separate formulas.

**Live verification (2026-07-11):** a real `/api/ask` POST ("How was my fueling last week?") against
the running app returned: *"Your fueling last week was **adequate but slightly short** — you
consumed 95% of your estimated need (21,851 vs 23,001 kcal), which is acceptable for a training
block but leaves minimal margin. Your weight held steady and energy availability sits at a healthy
~33 kcal/kg, so no immediate concern..."* The cited 21,851 / 23,001 / 95% figures were independently
confirmed to exactly match the real `/trends` page numbers for the same week — the LLM phrased the
pre-computed numbers verbatim; it did not invent them.

**Final-review fix:** `formatCoachSnapshot`'s fuel line unconditionally labeled `fuelingState` "energy
availability" and attached the EA kcal/kg figure — wrong once the weekly ratio owns the verdict (a
disagreement case reads self-contradictory, e.g. "energy availability low (~30 kcal/kg)" when the
app's own EA banding calls 30 kcal/kg adequate). Label now tracks the actual source: "fueling X" with
no EA figure when the weekly ratio owns it, unchanged "energy availability X (~Y kcal/kg)" otherwise.
A milder sibling (`formatFormFuelLine`, used by `/api/generate`) had the same label-only mismatch —
fixed same day, see "`formatFormFuelLine` mislabel bug closed" at the top of this file.

---

## Today Athlete-State de-noising — ACWR demoted + Pw:HR three-layer caution (2026-07-10, shipped 2026-07-11)

De-noised the two noisiest signals feeding the Today "Athlete State" verdict — one scientifically
weak, one genuinely flaky — so neither could manufacture a false-fatigue read on its own. Plan:
`docs/superpowers/plans/2026-07-10-02-today-daily-read-signals.md`. Depended on the execution-scoring
rework below landing first (the execution EWMA driving this fusion needed to be HR-honest before
tuning the fusion around it).

- **ACWR demoted, not removed.** `DEFAULT_ATHLETE_STATE_WEIGHTS.acwr` shrank from a dominant hammer
  (`optimal +4 / danger −20`) to a minor nudge (`optimal +2 / danger −8`) — TSB and the separate
  load-ramp readiness check already carry the "you ramped load fast" story, and ACWR is redundant
  with them and unreliable for endurance readiness specifically (Impellizzeri et al.). New defaults
  sit inside the pre-existing `ATHLETE_STATE_WEIGHT_BOUNDS`, so no bound change was needed and a
  coach can still re-weight it back up per-athlete.
- **Aerobic efficiency (Pw:HR-Z2) gets three independent caution layers**, since it's confounded by
  heat/hydration/caffeine/sleep and was previously read from a single latest ride:
  1. **Smoothing** — `athleteStateInputsFrom` now means the last ≤3 qualifying rides inside the
     14-day recency window, not just the latest one.
  2. **Minimum-sample floor** (`AEROBIC_MIN_RECENT_SAMPLES = 2`) — a lone qualifying ride in the
     window sits the signal out entirely (`null`) rather than reporting itself disguised as
     "smoothed."
  3. **A stricter, separate `livedAt` threshold** (new `AthleteStateWeights.aerobicEff.livedAt`
     leaf, default 6) — `deadband` (widened 2→3) still gates whether the signal has *any* score
     effect; `livedAt` is the larger, independent bar a dip must clear to count as a corroborating
     "lived negative" toward the hard fatigue-override score-cap. A modest dip still nudges the
     score a little; only a confidently large one can help cap it. `SignalContribution` gained one
     optional `livedNegative` field, set only by `evalAerobicEff`.
- **HRV explicitly deferred, not built** — the athlete has no wearable that syncs HRV consistently
  yet, so wiring an evaluator now would be dead code. The exact add-back (a new weight leaf, an
  `AthleteStateInputs.hrvSuppressionPct` field, an `evalHrv` mirroring `evalAerobicEff`) is documented
  as a pointer in the plan, not scaffolded.

**Live verification (2026-07-11):** reloaded `/today` before/after on real synced data and diffed the
"what moved it" breakdown. ACWR's contribution: `+4` → `+2` (matches the demoted default exactly).
Aerobic efficiency: `"2% above baseline +3"` → `"near baseline 0"` — the smoothing + widened deadband
correctly absorbed what had been a single noisy ride's signal. Overall score `59` → `54` (both
previously-generous signals correctly tempered, not just moved in one direction). Supporting Signals
panel shows ACWR as a small, non-dominant tile (`0.87 optimal`), not the dominant driver it was before.

**Final-review fix (docs only):** the spec doc (`docs/specs/athlete-state.md`) and one interface
comment still described `aerobicEffLatest` as "latest ride's Pw:HR" — updated to describe the
smoothing + minimum-sample-floor behavior actually shipped.

---

## HR-judged easy-ride discipline — execution scoring rework (2026-07-10, shipped 2026-07-11)

Outdoors you cannot hold Zone-2 *power* — descents, rollers, restarts, and corners spike watts even
on a genuinely easy ride — so the old power-based discipline penalty (`aboveZ2Frac`, see the
superseded entry below) and the pacing (VI) penalty were marking down physiologically-perfect
aerobic rides and only ever rewarding indoor ERG. This rework makes the heart, not the power meter,
the judge of "was this ride actually easy?" Plan:
`docs/superpowers/plans/2026-07-10-01-execution-scoring-hr-leniency.md`.

- **The measure.** `timeAboveAerobicHrFraction(hrZoneTimes)` (`lib/execution-score.ts`) — the
  terrain-immune counterpart to the old power-based helper — returns the share of measured HR-zone
  time spent above the aerobic ceiling (HR zones 3+), from already-synced `hrZoneTimes`. `null` when
  there's no usable HR data, so scoring falls back to duration + bonuses only (an older ride or one
  with no HR monitor scores exactly as before).
- **The read.** `aerobicDisciplineRead` bands the fraction into a lenient three-state read:
  dialed in (≤10% above aerobic — tolerates terrain-driven HR bumps) / some drift (≤25%) / ran hot
  (>25% — genuinely not an easy ride). Research-grounded: Friel's LTHR Zone-2 ceiling ≈89% LTHR, the
  80/20 polarized-training principle backs "a single easy ride should be ~100% aerobic."
- **Power and VI became reward-only for Z2/Recovery.** An in-band IF or a steady VI (≤1.06) still
  earns a bonus, but neither is ever penalized anymore for these ride types — outdoor NP/VI inflate
  on terrain, which isn't a discipline failure. The HR read is now the *sole* penalty axis: dialed
  +1 / drift 0 / ran hot **−4** (deepened from the plan's original −2 mid-implementation — see below).
- **The −4 guardrail deviation.** The plan's own guardrail test (a hot-reading ride should score
  ≤5, the overtraining safeguard) contradicted its own other numbers: with duration (+2) and
  in-band-IF (+1) now unconditional bonuses, a −2 hot penalty could only ever net a hot ride to 6,
  never below baseline. Escalated and resolved by deepening the penalty to −4 — sized so the
  guardrail holds under *every* bonus-stacking combination (duration +2, IF-band +1, VI +1, or the
  RPE-substitution path that reaches the same +4 max without the IF-band bonus), not just the one
  case the plan happened to test. Verified by hand for every combination; holds with exactly zero
  margin, pinned by two boundary tests added in final review.
- **Debrief UI.** `TodayAnalysis.aerobicDiscipline` (✓ dialed in / ~ some drift / ✗ ran hot) surfaces
  in the Today debrief drill-down — gated identically to the scorer (`!intrinsic`, `!embedsEfforts`,
  Z2/Recovery only), so the UI never shows a read the score didn't actually apply. Two gaps caught
  and fixed during review: an off-plan ride whose inferred type happened to be Z2/Recovery was
  showing a read the score's own `!intrinsic` gate never used; a durability template B–E day (where
  embedded efforts are the point, not a lapse) had the same problem for `!embedsEfforts`.
- **Honesty fix.** The athlete-model insight for "execution trending down" was reworded from a
  fatigue diagnosis to a hypothesis — plausible causes now include accumulated fatigue, a harder
  training block, *or* more outdoor riding (since this rework changes what a downtrend can mean).

**Live verification (2026-07-11):** ran the real shipped scoring function against real synced ride
data (not a mock). A well-ridden outdoor Z2 from 2026-07-01 (100% duration compliance, in-band IF,
HR only 2.2% above aerobic) went from an old ledger score of **6** to a new score of **9** — meeting
the plan's own acceptance bar ("a well-ridden outdoor Z2 now reads ≥7, not the old ~5/6"). The
historical ledger (`data/score-log.json`) was deliberately **not** rebuilt with the new methodology
as part of this work (that's a separate, one-time-migration-gated operation, too consequential to
trigger for a smoke check) — past scores stay frozen until a real sync or an explicit rebuild.

**Known gap surfaced by this work, closed 2026-07-11:** `CoachSnapshot.today.execution.aboveZ2Pct`
(the LLM-facing coach-prompt line, `lib/coach-snapshot.ts`) computed its own "% above Z2 cap" from the
old power-based `timeAboveZ2Fraction`, entirely independent of this rework — the coach's own prompt
could still call an outdoor ride "drifted hard above zone" on the same ride the HR-based score just
correctly rewarded. Fixed same-day — see "Coach-prompt aerobic-discipline gap closed" further up this
file.

---

## In-app rescheduling + bidirectional calendar mirror — §7 lean slice (2026-07-08, shipped 2026-07-10)

Lets the athlete move a planned session in-app and keeps the Intervals.icu calendar in step in
both directions, closing the "app serves the wrong workout on the wrong day" risk (the athlete's
head unit reads from the calendar, not the app). Plan:
`docs/superpowers/plans/2026-07-08-reschedule-calendar-mirror.md`.

- **Manual move** — a click-to-pin popover on any future Plan day cell (`components/MoveDay.tsx`)
  lets the athlete shift a planned session onto a clear rest day; `PUT /api/reschedule` validates
  server-side (future-only, rest-target-only, past days immutable).
- **Outbound mirror** — every app-initiated move — this manual move, the existing reactive make-up
  POST, and the morning-check proactive swap/downgrade (`app/api/morning-check/route.ts`) — now
  mirrors onto the athlete's real Intervals.icu calendar. `lib/calendar-mirror.ts`
  (`dayToEventPayload`, `buildMovePayloads`, `applyCalendarMirror`, `persistMirroredMove`) owns the
  decisions; `createEvent` does the write. The mirror was originally built on the pre-existing
  uid-upsert path (`?upsertOnUid=true` + a client-supplied `uid`) — since corrected to a real
  `external_id`-keyed upsert, a separate foundational bug fix documented in the next entry below. A
  moved day carries its **source event's description wholesale** to the destination — descriptions
  live only on the calendar (`CurrentBlockDay` has no description field), so a delete+recreate would
  silently drop the intent/nutrition text the athlete actually reads.
- **Inbound reconcile** — `POST /api/sync` (`app/api/sync/route.ts`) now fetches the block window's
  events once (`lib/intervals-api.ts` gained `fetchEvents`/`parseCalendarEvents`) and reconciles
  calendar-side moves (the athlete dragging a NodeVelo event on Intervals.icu itself) into the local
  block before scoring, via `reconcileInboundMoves`. Deliberately limited: future-only both sides;
  applies only onto rest/empty days; a calendar-side **swap** (two events trading dates) surfaces as
  two separate conflict warnings rather than being auto-paired (deferred, not a bug); a vanished
  future event warns rather than silently deleting the local prescription. Nothing ambiguous ever
  mutates silently.
- **Design invariant** — one NodeVelo-owned calendar event per block date; past dates are never
  mutated by either direction; a local move always persists even if the calendar mirror call fails
  (failure surfaces as a warning, never a rollback).
- **Known limitation (cosmetic, documented in code)** — an inbound-accepted move leaves the
  calendar event's `external_id` stamped with its OLD date; `CurrentBlockDay.eventId` (the numeric
  id) is the true key everywhere the app matches events, so this doesn't affect correctness, only
  the calendar's own bookkeeping field.
- **Fixed same slice:** a pre-existing UTC-vs-local-date bug in `/api/reschedule` — both GET and
  POST previously inlined `new Date().toISOString().slice(0,10)` (AGENTS.md's recurring bug class);
  now uses `resolveToday`/`localToday` like the rest of the app.

**Live verification (2026-07-10):** the current block had zero rest days left (ends 2026-07-12,
taper week), so a full "move a real session onto a real rest day" round trip wasn't possible this
session — flagged as a follow-up for the next block that has rest days. What *was* verified live:
(a) the calendar API round-trip itself — create → read-back with description intact → delete,
against the real Intervals.icu API; (b) the manual-move UI's full interaction chain end-to-end
through a real rejected move — clicking a future day cell pins an accessible popover
(`role="dialog"`), the date input is bounded correctly (tomorrow through block end), submitting
calls the real `PUT /api/reschedule`, the server correctly rejected an occupied-target attempt with
a clear message, and the UI surfaced that error via `role="alert"` without losing state or
persisting anything (the block was confirmed unchanged after).

---

## Fix: createEvent's upsert was broken (external_id, not uid) — discovered during §7 live verification (2026-07-10)

`createEvent` (`lib/intervals-api.ts`) POSTed to the singular `/athlete/{id}/events` endpoint with
`?upsertOnUid=true` and a client-supplied `uid`, intending an idempotent per-date upsert. It never
worked: Intervals.icu ignores a client-supplied `uid` (server-assigned, read-only) and silently
created a **new duplicate event on every call** instead of updating the existing one — confirmed
live by calling it twice with the same `uid` and getting two different event ids back. This
predates the §7 calendar-mirror plan entirely (traces to the app's first commit); every historical
block write, regeneration, or reschedule that touched an already-written date has likely been
leaving orphaned duplicate events on the athlete's real calendar since day one. It surfaced only now
because §7's live-verification step (above) was the first time a round-trip against the real
calendar API was actually watched closely.

**Fix** (commit `aa16797`, cosmetic-comment follow-up `ec9e591`): `createEvent` now calls
`POST /athlete/{id}/events/bulk?upsert=true` with the event wrapped in a single-element array,
using `external_id` (not `uid`) as the client idempotency key — confirmed against Intervals.icu's
own published integration cookbook. `IntervalsEventPayload.uid` was renamed to `external_id`
(snake_case, since this interface is serialized verbatim as the wire body); `IntervalsCalendarEvent`
kept its existing `uid` field (now documented as read-only/server-assigned) and gained a new
`externalId` field (what inbound matching actually uses). All call sites (`lib/calendar-mirror.ts`,
`lib/plan-parser.ts`) and test fixtures updated to match. Live-reconfirmed end-to-end through the
actual fixed application code: the same `external_id` sent twice now returns the identical numeric
id, content genuinely replaces, and the event count on the calendar stays at one.

Not part of the §7 plan's original scope — a foundational primitive fix that plan's
live-verification step happened to uncover, documented separately rather than folded silently into
the calendar-mirror feature entry above.

---

## Two-way session swap — §7 follow-on (2026-07-11)

Closes the gap the original §7 lean slice deliberately left open: Manual Move only moves a session
onto a *clear rest day*; this adds a genuine swap between two already-occupied future sessions (e.g.
today's ride with tomorrow's), reusing the swap-pair calendar-mirror path the morning-check proactive
swap already exercised and this session's final-review fixes already hardened (id-based
description-carry). `PATCH /api/reschedule` validates both days are in-block, future, distinct, and
both carry a real session; `components/SwapDay.tsx` mounts alongside the existing `MoveDay` in the
same pinned day-cell popover. Outbound only — calendar-side (inbound) swap-pairing stays deferred, per
`lib/calendar-mirror.ts`'s existing `reconcileInboundMoves` comment. Design:
`docs/superpowers/specs/2026-07-11-session-swap-design.md`. Plan:
`docs/superpowers/plans/2026-07-11-session-swap.md`.

---

## UX v2 — the zero-based redesign, Waves 1–5 (2026-07-08 → 2026-07-09)

A moment-first zero-based review of all seven surfaces (live-app walkthrough with real data, desktop
1440×900) that re-justified every card, metric, and nav slot from scratch — no page or component was
assumed to keep its place. Governed by [UX-CONSTITUTION.md](UX-CONSTITUTION.md); sequenced into 5
waves per [UX-MASTERPLAN.md](UX-MASTERPLAN.md) (the framework — moment map, moves ledger, per-page
target layouts — full detail lives there). Each wave closed with a whole-wave review (Fable 5, Opus
4.8 fallback); the final wave's review walked the entire UX-MASTERPLAN §8 success-measures list as a
program-closing gate. Distinct from, and shipped after, the v1 defect-audit UX program below —
v2 started from a blank page rather than fixing findings against the existing layout.

- **Wave 1 — nav tiering + relocations** (2026-07-08, commits `4fe638c`…`a8c29e9`; plan
  `docs/superpowers/plans/2026-07-08-ux-v2-wave-1-nav-and-relocations.md`). The flat 7-tab rail
  became a 3-tier rail (Today/Plan/Trends full-weight · Profile/Model under "YOU & THE COACH" ·
  Settings/Knowledge under "SYSTEM"). Every pure cross-page relocation from the moves ledger executed
  as a straight component move, no redesign yet: goals off Plan → Profile, effort bands Model →
  Profile, season Profile → Plan, delete-block → overflow menu. "Knowledge Base"/"Docs" unified to
  one name, "Knowledge," everywhere. Final review found one fix: season save now refreshes the
  roadmap + generator context co-located on `/plan`.
- **Wave 2 — Today auto-switch** (2026-07-08; plan
  `docs/superpowers/plans/2026-07-08-ux-v2-wave-2-today-auto-switch.md`). Today's mode is now
  data-derived, never a tab the athlete picks: a synced ride matching today's *local* date
  (`localToday()`, per AGENTS.md) puts the page in post-ride mode, otherwise pre-ride. Pre-ride is
  capped at ≤3 elements by construction (alert → verdict → session prescription); post-ride leads
  with the debrief. Cut entirely: `TrendPulse` (duplicated Trends' own question) and the
  viewport-lock + internal-scroll edge-fade machinery (pre-ride now fits without it; post-ride
  scrolls like every other page). Constitution §3/§4 amended same-commit (moment-aware layout
  clause; one-canonical-home-per-metric rule).
- **Wave 3 — Trends rebuild** (2026-07-09; plan
  `docs/superpowers/plans/2026-07-09-ux-v2-wave-3-trends-rebuild.md`). Nine equal-weight sections
  replaced by a verdict-first structure: a new pure `lib/trends-verdict.ts` derives a three-axis
  verdict (engine / delivery / fueling) client-side over the existing payload, rendered as one
  sentence in fold-1 with the ranked coach insights promoted alongside it (top 3 visible, rest
  disclosed). Below it, four named groups (ENGINE, DELIVERY, LOAD & FUEL, MILESTONES) replace the
  nine sections; the Delivery merge folds session-level execution bars and per-type
  planned-vs-actual into one card behind a toggle. Cut: the "Last 7 days" tile row, the
  not-a-duplicate-of-intervals.icu mission-statement intro.
- **Wave 4 — Model three-groups + Profile dossier** (2026-07-09; plan
  `docs/superpowers/plans/2026-07-09-ux-v2-wave-4-profile-model.md`). Model reorganized into NOW
  (fused score + ranked drivers as signed magnitude bars, largest first) / LEARNED (one calibration
  card per learned value — number, provenance, confidence tier, override) / STANDING GUIDANCE
  (directives rendered straight from their structured source, sharing the demote rule with the
  generator — `CoachDirectivesCard` retired). Profile became a read-first dossier: rider read
  (power curve, phenotype, current performance, weight, PR strip) → zones/effort bands → goals &
  weakpoints (compact read, edit behind inline "▸ edit") → nutrition formula, each editable on
  demand rather than a long scroll of always-open forms.
- **Wave 5 — Plan hero + Settings/Knowledge + density polish** (2026-07-09, commits
  `fe81520`…`56a9f1f`; plan
  `docs/superpowers/plans/2026-07-09-ux-v2-wave-5-plan-settings-knowledge-polish.md`). Plan's hero
  gained week orientation: "Active block — week N of M · `<week character>`" plus an in-hero week
  strip (hours vs. target · load · top session) — `<week character>` is explicitly disclosed as
  volume-derived, not a per-week periodization phase (the data model has none); `WeeklyDebrief`
  retired as the strip absorbs it. Settings split into GENERATION (volume targets, weekly structure,
  philosophy & equipment) and PLATFORM (platform behavior, AI usage & cost, backup & restore) —
  fixing a real bug where the platform-behavior card rendered under the wrong divider. Knowledge
  gained a one-line provenance header (which files feed generation vs. reference-only). Density
  polish cleared the whole Waves 3–4 backlog in the same wave: driver bars negative→red (matching
  `driverEffectClass`, DESIGN §2), touch-readable driver notes, calibration confidence adjacency,
  `DeliveryCard` toggle accessibility (`type=button` + `role=group`), `InsightsFold` empty-state
  hint honesty, Profile rider-read empty-state + weight-tile gating + double-label removal.

**Two small open items surfaced by the Wave 5 closing review, not actioned (out of that wave's
scope, tracked in [ROADMAP.md](ROADMAP.md) "UI refinements"):** `components/trends/verdict.tsx`'s
`VerdictStrip` still colors its "down" axis chip amber where every other declining signal in the app
uses red (the same fix already applied to `StateDriversCard`'s bars); `lib/trends-verdict.ts`'s
score-to-word mapping can label the verdict "Mixed" even when no two axes actually disagree (a
labeling nit in the score→word bucket, not a logic bug).

---

## Pre-ride loading loop — Track C (2026-07-08)

Deterministic day-before carb-loading prescription (7 g/kg, all templates A–E), one-tap loaded/skipped
attribution stored in `data/loading-log.json`, and `preLoad`/`durabilityDelivery` ledger stamps (provenance
only). A heuristic delivered-rate assessment via `assessLoadingEffect` learns whether loading improves
late-effort delivery and gates the prompt with a `no-effect` kill-switch that stops prescribing once
proven ineffective. Power-only outcome (decoupling deliberately excluded per the `deriveCarbsOptimum`
demotion rationale in `lib/calibration.ts`). Today chip surfaces the day-before target on durability
longs; `/api/loading` GET queries whether to show the prompt, POST attributes the athlete's loaded/skipped
choice. `lib/loading.ts`, `data/loading-log.json`.

**Known limits (deliberately kept, tracked):** late-synced durability rides get no delivery stamp (the
birth-fetch exclusion stands — extend if the corpus starves); template A rides are prescribed like B–E
but permanently excluded from the learner (no embedded efforts, so no honest delivery outcome to grade)
— separately, even among B–E the assessment stays `unproven` until ≥3 loaded AND ≥3 unloaded observations
exist; binary loaded/skipped attribution pending actual grams logged; `/model` verdict surfacing deferred;
a retro-ask response now back-stamps an already-born ledger entry at POST time (first answer wins). Plan:
`docs/superpowers/plans/2026-07-08-preride-loading-loop.md`.

---

## UX program v1 — full-product audit through implementation, Waves 1–4 (2026-07-03 → 2026-07-05)

A ground-up UX audit of all seven surfaces (Today, Plan, Trends, Profile, Model, Settings, Knowledge)
against timeless HCI/trust principles and red-team personas (first-time athlete, injured athlete,
ADHD, sleep-deprived, outdoors in sunlight, returning after months away) — then every finding
implemented, desktop-first per standing instruction. Full detail (every finding, file:line evidence,
what shipped vs. what was deliberately deferred) lives in [UX-MASTERPLAN.md](UX-MASTERPLAN.md),
governed by [UX-CONSTITUTION.md](UX-CONSTITUTION.md) (the decision rules — verdict hierarchy,
trust/provenance/contestability, disclosure limits, an explicit ban list). Summary by wave:

- **Wave 1 — system primitives.** The entire explanation layer (`MetricTip`/`InfoDot`) was
  hover-only — invisible to keyboard and screen readers, the single largest gap between the app's
  stated trust philosophy and its actual behaviour. Now opens on focus too. Best-effort fetches that
  used to fail silently (a `catch {}` making a broken feature indistinguishable from an absent one)
  now render a `LoadFailed` retry state. The canonical dark theme flashed light on every page load —
  fixed with a pre-hydration `<head>` script.
- **Wave 2 — Today's one verdict.** "Can I go hard?" was answered four times in three vocabularies
  (a fused 0–100 score, a separate Build/Hold/Recover badge, a narrative coach-read card, raw
  TSB/ACWR tiles) with no stated precedence. `AthleteStateCard` is now the sole fold-1 verdict;
  everything else became its supporting evidence, collapsed but not deleted.
  `components/CoachSnapshotCard.tsx` was deleted (content absorbed).
- **Wave 3 — page-level fixes.** Empty states became onboarding (links instead of dead ends); the
  block calendar's day-cell detail (previously 100% hover-locked) is now keyboard-focusable; every
  `window.confirm()` in the app — including the highest-stakes one, full-data restore — became an
  in-product confirmation that states the actual consequence.
- **Wave 4 — polish + a real coaching gap.** An "injured athlete" path that didn't exist before: the
  morning check-in previously didn't even *render* on a non-quality day, so an injured athlete facing
  an easy ride had zero way to report it. Injury now gets its own `rest` decision (not a reused
  downgrade — the reasoning is metabolic-vs-musculoskeletal, written into `lib/morning-check.ts`).
  Plus loading skeletons (five sites, sized to each page's real layout) and a scroll-position-aware
  fade so an internally-scrolling card never reads as a dead end.

**Deliberately not done:** S2-4 (swapping Model/Knowledge's mobile nav prominence) — evaluated and
skipped, since desktop's nav rail already shows both correctly labelled; there's no desktop-relevant
work to do until mobile polish resumes. S3-5 (a "what changed while you were away" re-entry summary)
stays a roadmap-tier idea, not attempted this pass.

Two implementation waves (2 and 4) were dispatched to subagents (Fable 5 for the mechanical passes,
Opus for S2-9's coaching-safety judgment call) and independently re-verified — code read line-by-line,
tsc/lint/test re-run, browser-checked — before commit, since the safety classifier that normally
reviews subagent work was unavailable both times.

---

## Post-ride fuel prompt — Track C accumulation flywheel (2026-07-04)

`carbsOptimum` (ARCHIVE "Carbs-optimum derivation — Track C first leg") sat dormant for lack of data —
only ~20% of ledger entries (23/117) carried a logged carb intake. Rather than add more derivation
machinery to a starved signal, this ships the nudge that fills the gap: a deterministic post-ride prompt
that gets `carbs_ingested` logged on the exact rides that teach the model.

Shipped: `deriveFuelPrompt()` (`lib/fuel-prompt.ts`) — a pure, unit-tested decision, no LLM/IO/side
effects, with two variants. `log-nudge` fires when a qualifying ride (`movingTimeSec ≥ 90 min` OR
`plannedType ∈ {Threshold, VO2max, SIT, RaceSim}`) has no logged `carbsIngestedG`; a logged `0` is kept
as a real "fasted" data point (the FUEL-1 distinction) and never nudges. `gap` fires only when logged
carbs resolve to `< optimum − 20 g/h` (`GAP_UNDER_G_PER_H`) *and* the resolved `carbsOptimum` confidence
is medium or high (`EXCLUDED_CONFIDENCE_FOR_GAP = "low"` gates it off) — under-fueling only in v1, since
over-fueling has no validated harm signal yet. Wired into the sync route's today-analysis path
(`app/api/sync/route.ts`, computed once per sync against today's ride only) via a new
`resolveCarbsOptimumForPrompt` helper that mirrors the generic calibration resolver's precedence (manual
override, else a trustworthy derived value) but — unlike that generic resolver — always falls back to
`null` rather than a population default, so a "gap" claim can never be built on a number that isn't
actually personalized. Persisted as `TodayAnalysis.fuelPrompt` (sparse-field convention: absent/null omits
the key entirely, so a pre-existing `today-analysis.json` written before this field existed renders
cleanly). Surfaced as a quiet chip on the Today card (`components/dashboard/today.tsx`, truthy-checked
per this project's migration-flag convention, neutral zinc/cyan tone — informational, not a celebration)
and threaded to the coach note as one context line (`RideAnalysisInput.fuelPromptContext` →
`buildRideAnalysisPrompt` in `lib/anthropic-prompts.ts`, formatted by `lib/sync-analysis.ts`'s
`formatFuelPromptContext`) with an instruction that the LLM may mention it in one sentence using the
pre-computed numbers verbatim — it never invents or recomputes a gram.

Closes the ROADMAP Track C "Contextual post-ride prompts" item (removed from ROADMAP.md; the Track C
"Pre-ride loading loop" item is separate and stays open). Plan:
`docs/superpowers/plans/2026-07-03-postride-fuel-prompt.md`. Success metric to watch over the next ~3
weeks: fuel-stamp fill-rate on qualifying rides (baseline ~20%, target ≥60%) and `carbsOptimum.dataPoints`
(1 → ≥8) — if fill-rate doesn't move, the nudge's placement failed and surfacing needs revisiting before
any more Track C machinery is added.

**Open item, not yet verified live:** this touches an LLM-backed path — the coach note may now mention
the fuel prompt. Per this project's `AGENTS.md` convention, a live smoke run against the real Anthropic
API (one real sync on a qualifying ride day, reading the actual generated coach note + Today card) is
still outstanding. Only unit-tested so far; the real model call has not been exercised.

---

## First-loop-turnover readiness — build half (SUB-5) (2026-07-03)

Everything buildable before the first-ever full loop turnover (retrospective → `block-history.json`
born → next block write → `intervention-log.json` born, ~2026-07-12) shipped ahead of the event:
route tests characterizing `/api/retrospective` (the destructive current-block-clearing path,
previously the only turnover-critical route untested — `b62a3aa`, `a233321`), the season-stamp fix
(`seasonFocus`/`seasonPhase` land on the new block at write time — `app/api/write/route.ts`), and an
attended runbook in [WORKFLOW.md](WORKFLOW.md) (backup → sync → retro → verify → generate → write →
verify, with an import-restore abort path). What remains is *executing* the runbook at block end —
an event, not build work — tracked as SUB-5 in [ROADMAP.md](ROADMAP.md).
Plan: `docs/superpowers/plans/2026-07-03-first-loop-turnover-readiness.md`.

---

## Ledger interval-adherence at birth (2026-07-03)

The root-cause fix for the gap the SIT execution-score fix (below) surfaced: the immutable ledger's
batch builder (`score-log.ts`) never computed or received interval-target adherence for *any* ride, so
every Threshold/VO2max/SIT/RaceSim day was permanently scored off whole-ride duration/IF the moment it
rolled past "today" — a coarser proxy than the reps actually ridden, and irreversible once frozen. That
gap is why the SIT 2/10 entry needed a manual one-off correction: even after the scoring formula was
fixed, the frozen entry had no adherence input to honestly re-derive from.

Shipped: `RideScoreEntry.intervals?: { adherencePct, structuralMismatch, completed, total }`
(`lib/types.ts`) — the same prescription-vs-executed comparison the "today" path already computed, now
frozen onto the ledger entry via a shared mapper, `intervalStampFrom()` (`lib/score-log.ts`). It feeds
`computeExecutionScore` as the primary signal on planned interval days (an
`adherencePct`/`structuralMismatch` pair, not a pass-through raw comparison). `buildRideScores` gained an
`adherenceForDate` lookup param to source it. On `POST /api/sync`, a bounded **birth-time fetch** picks
up rides that synced a day or more late: it finds planned interval days not yet in the ledger, fetches
each ride's executed intervals (capped at 6 dates per sync, newest first — logged + surfaced as a sync
warning past the cap), and stamps the comparison so the entry is born interval-aware instead of frozen
coarse forever. A fetch failure per date falls back silently to the coarse whole-ride score rather than
failing the sync. The same stamp lookup also serves the existing one-shot ledger rebuild path, letting a
corrected scoring formula re-score already-frozen entries from their stamped adherence data with no
re-fetch.

**Deliberate exclusion, not an oversight:** Z2/Recovery days and any day carrying a Track B durability
template are never looked up on this axis — they're graded by their own systems
(`gradeDurabilityDelivery` for durability; steady duration-compliance for Z2/Recovery) and this stamp
would be meaningless for them. Closes the "Ledger scoring lacks interval-level adherence for
non-durability interval types" item that was tracked in [ROADMAP.md](ROADMAP.md) "Scoring-core gaps."
Plan: `docs/superpowers/plans/2026-07-03-ledger-interval-adherence.md`.

---

## SIT execution-score fix — sprint overshoot + unreachable IF band (2026-07-03)

A flawless 6/6, full-duration sprint day (131% of a 432W target) scored 2/10 "Poor". Two compounding
bugs in `computeExecutionScore`, both SIT-specific: (1) the generic `adherencePct` overshoot band
penalised clearing a sprint target hard the same as a bad Threshold/VO2max overshoot ("blew past it,
won't recover well") — the wrong lens for a 30s max effort, which has no sustainability risk within the
rep (the 4-minute recovery windows exist precisely so each rep can be maximal); (2) the whole-ride
NP/FTP band for SIT required IF ≥ 0.90, structurally unreachable given the workout's own shape (long
warmup/recovery diluting a few 30s efforts), silently capping every well-executed SIT day at −1
regardless of quality. Fix: SIT's adherence axis now only penalises undershoot (not clearing the bar);
the unreachable whole-ride-IF case was dropped, since `adherencePct` already grades sprint quality
directly and correctly. +3 tests (`lib/execution-score.test.ts`) lock the regression. The 2026-07-03
ledger entry (frozen at the buggy 2) needed a one-off manual correction — re-derived via the actual fixed
functions with the ride's real stored inputs, not hand math — because a normal sync never touches an
already-scored ledger date (`mergeScoreLog`: existing wins, immutable per date); this surfaced the
broader **ledger scoring lacks interval-level adherence for non-durability interval types** gap now
tracked in [ROADMAP.md](ROADMAP.md) (Scoring-core gaps).

Also fixed same session, unrelated: prescription **display** labels could show a stale duration
(`"6×1m"` for a `durationSec: 30` session) on blocks generated before an earlier label-rounding fix —
`formatPrescriptionLabel` now derives the label from structural fields at the point of use (Today card +
the ask-coach interval context) instead of trusting the stored `label` string, so a stale stored value
can never surface again.

---

## SUB-2 · Legacy backfill importer — investigated & paused (2026-07-02)

Investigation record (decision + stub live in [ROADMAP.md](ROADMAP.md) "Data substrate"). The prior
~6 months (100 legacy rides) followed real structure but have no app prescription to grade against,
so they're excluded from execution learning. A live-API check against Intervals.icu's actual
`/events` endpoint falsified the "whole window recoverable" assumption: of the 100 legacy dates only
**28 have a same-date calendar event at all** (22 with machine-parseable `workout_doc.steps`); 72
have none — Jan/Feb (29 rides) has zero calendar events in the window. Athlete's read: legacy
structure was Z2 + 2 interval sessions/week, and only interval days tended to get a named calendar
entry. So the calendar recovers roughly the hard-day subset (~22–28%), not the window — not enough
to justify an importer. The athlete handles any legacy relabeling manually (renaming calendar
events) if specific rides should become gradable. Grading a ride against its own executed profile
(no independent prescription) is circular and was not pursued.

---

## Carbs-optimum derivation — Track C first leg (2026-07-02)

The optimum shape joins the shared correlation engine, and carbs g/h becomes the framework's third
calibrated parameter. `deriveOptimum` (`lib/correlation.ts`) mirrors `deriveExecutionEdge` with the roles
flipped — the median signal of the athlete's *successes*, credited only when failures exist to contrast
against AND sit ≥ a margin away on the expected side (successes alone are habit, not signal — same
"don't calibrate to where they train" refusal as the edge). First consumer: `deriveCarbsOptimum`
(`lib/calibration.ts`) classifies steady long endurance rides (the sync route's existing steady-endurance
candidate pool, ≥90 min, `carbs_ingested` logged) good/bad by `aerobicEffPct` — `lib/aerobic.ts`'s
Z2-isolated Pw:HR %Δ vs the athlete's own trailing baseline, the same non-circular signal the off-plan
execution-score driver already uses — outside its established `AEROBIC_DEADBAND_PCT` noise floor, with a
10 g/h discrimination margin, a [30, 120] clamp, `DEFAULT_CARBS_OPTIMUM = 75` (the literal
`inRideCarbTarget` >90-min endurance value), and the same quiet-window/`manualOverride` preservation
semantics as `deriveDecouplingGood`. **Not decoupling** (the first cut, swapped same-night before review):
this app already demoted whole-ride decoupling out of the athlete-state driver (ACC) and out of execution
scoring (ACC-2026-06-25) for being a noisy ride-structure artifact confounded by heat/course effects
unrelated to fueling — reusing it as carbs' outcome label would have repeated that mistake, and it would
have made `carbsOptimum` depend on `decouplingGood`'s own confidence for no real reason (`aerobicEffPct`
is already baseline-relative, so no second calibrated parameter is needed as a reference point). Wired:
`CalibrationStore.carbsOptimum` (optional — pre-existing stores parse back `undefined`, the migration-flag
gotcha), derived each sync, `/api/calibration` generalised to a param→bounds map, and a second
contest/correct row on the `/model` panel (config-driven `ParamRow` refactor; verified live — the on-disk
store predating the field renders the default row correctly). **Deliberate non-goal:** the fueling table
(`inRideCarbTarget`) is untouched — surfacing a learned optimum into prescriptions is §6.
Dormant until fueling data accrues, by design. Plan:
`docs/superpowers/plans/2026-07-02-carbs-optimum-derivation.md`. +20 tests (742 total, 66 files).

---

## Off-machine backup (2026-07-02, SUB-4 half)

`lib/backup.ts`: `buildBackupBundle()` (the same data/ + knowledge-base/ bundle GET /api/export already
produced — extracted so both share one implementation instead of two) and `snapshotBackup()`, wired into
`/api/sync`'s POST as a best-effort last step. Writes a timestamped snapshot to `NODEVELO_BACKUP_DIR`
(write-then-rename, same atomicity idiom as `json-store.ts`) and rotates to the newest 14. Deliberately
env-gated with no same-machine default: unset, it's a no-op rather than a same-disk "backup" that
wouldn't buy anything the existing `.bak`/manual-export coverage doesn't already give — "off-machine"
only happens once the directory actually points at something that leaves the machine (a synced
Dropbox/iCloud/Drive folder, a mounted NAS), which is the athlete's infrastructure to choose, not this
app's. A misconfigured-after-the-fact destination (e.g. an unmounted sync folder) surfaces through the
existing sync `warnings[]` → `SyncNotice` path rather than failing the sync. `export/route.ts` now calls
the shared bundle builder instead of carrying its own copy of the collect/walk logic. Branch discipline
(SUB-4's other half) remains open.

---

## Route tests for the destructive write routes (2026-07-02, extends SUB-3)

SUB-3 covered `sync` + `generate`; this closes the same gap on the routes that can overwrite a store
outright with zero prior coverage: `app/api/import` (restores `data/` + `knowledge-base/` from an
uploaded bundle — the highest-risk route in the app), `profile`, `season`, `calibration`, `knowledge`.
43 new tests, same pattern as `settings`/`sync` (data layer mocked at the module boundary, route handler
called directly against a constructed `Request`). Each suite targets the write path's actual risk, not
just line coverage: `import` gets dedicated path-traversal coverage (relative and absolute `rel` keys
must never reach `writeJsonFile`/`fs.writeFile` — `fs` mocked too, since `KB_DIR` has no env override to
redirect to a throwaway dir); `season` guards engine-drafted `periods` surviving an athlete-owned PUT;
`profile` guards a partial nutrition/goals/weakpoints update not clobbering the other two; `calibration`
guards the manual-override clamp (the same "disable-the-safety-cap" shape SET-1 caught for
`BlockSettings`). `export` stayed out of scope — GET-only, never mutates.

---

## Structured logging — P8 half (2026-07-02)

Silent-catch observability gap closed: `lib/log.ts` (`logError`/`logWarn`, JSON lines shaped
`{t, route, step, status, message}` to `console.error`/`warn` — ROADMAP P8's shape) + `lib/log.test.ts`.
Routed through the 17 substrate-facing call sites that used to swallow real failures across `write`,
`note`, `ask`, `disposition`, `retrospective`, `knowledge`, `generate`, `import`, `sync`. Deliberately
skipped: client-input-validation catches (`400 Invalid JSON body` — already visible to the caller) and
benign no-body-fallback branches (`morning-check`, `analyze`, `sync`'s optional `?today` parse) — neither
is a substrate failure. AI-route cost guard (P8's other half) remains open.

---

## Edge-case sweep EC-2026-06-27 — closeout (2026-07-02)

The EA/baseline edge-case + off-plan-aerobic/durability scoring read-audit, fully resolved.

- **EC-1** — aerobic Pw:HR baseline outdoor-filtered (VirtualRide excluded); **EC-2** — durability effort
  timing made stream-sample-index based (immune to smart-recording / paused time). (Shipped earlier in the sweep.)
- **EC-3** — `computeExecutionScore` now gates `durabilityDelivery` on `gradedByDurability`, so a lone
  delivery grade (template A / none) can't double-count on top of the interval-adherence axis in the
  immutable ledger. +1 test.
- **EC-4** — energy-availability anchors a no-weigh-in day to the nearest weigh-in ON/BEFORE it (not the
  most-recent overall, which could post-date the day) — the `physiologyAsOf` convention. +1 test.
- **EC-7** — the Today "Power execution" drill-down titles itself "Aerobic drift" when only decoupling is
  present (no zones/trace/intervals), instead of mislabeling drift as power execution.
- **EC-8** — retired the computed-but-unused `avgCadence90d` from the rolling-baselines compute / type /
  default / fixtures.
- **`sharpen` Focus option** added to the `/profile` goals form (the API + season engine already accepted it).
- Consciously **accepted, no fix:** EC-5 (EA trend sensitive to rest-day composition — kept a soft arrow;
  a per-athlete band is Track C) and EC-6 (new baseline fields hide until the first post-deploy sync —
  inherent to the derive-on-sync model).

---

## Directive demote — the validation loop acts (#4, demote half) (2026-07-02)

ROADMAP #4's second half: `synthesizeCoachingDirectives` (`lib/synthesis.ts`) now DEMOTES a coaching
directive whose past nudges have a proven-poor track record, instead of only annotating the hit-rate.
Completes the loop end-to-end (the measurement half — planned-vs-actual + FTP-retest — shipped the same day).

- **Demote rule:** a directive is demoted only when its dimension has BOTH ≥3 decisive
  (validated|refuted) matured verdicts AND a hit-rate ≤34% — one noisy 28-day window can't bury a
  directive. Demoted directives are reframed ("past X nudges have a poor track record here — try a
  different lever, don't just repeat it") and sunk below the still-trusted ones; the measured *evidence*
  stays visible (a real weak point is never hidden — calibrated-honesty pillar), only the failed
  *suggestion* is de-emphasised. The block header flags how many are de-prioritised.
- **Thresholds** exported as `DIRECTIVE_DEMOTE_DEFAULTS` (taken as a defaulted param) — population
  defaults now, a #2 per-athlete calibration hook later (same shape as `FTP_RETEST_DEFAULTS`).
- **Feeds both LLM surfaces** unchanged: the generation prompt's directive block and the CoachSnapshot
  directives (Today card + Ask-Coach). Backward-compatible — the new config is an optional 3rd arg, so
  the two existing call sites (`coach-snapshot.ts`, `generate/route.ts`) needed no change.
- **Dormant until data:** `intervention-log.json` is empty, so nothing demotes on the real corpus yet —
  the demote path is proven by 6 new unit tests; the live `/api/ask` smoke confirmed the non-demote path
  renders directives identically to before ("Execution trending down", "Z2 trending down") and the coach
  answers coherently. #4 is now code-complete but won't visibly act until real verdicts mature.

---

## FTP-retest advisory + planned-vs-actual (#4, measurement half) (2026-07-02)

ROADMAP #4's measurement half — the validation loop starts ACTING on execution data. Spec:
[design](docs/superpowers/specs/2026-07-02-ftp-retest-planned-vs-actual-design.md) · plan:
[plan](docs/superpowers/plans/2026-07-02-ftp-retest-planned-vs-actual.md).

- **`lib/plan-vs-actual.ts` created** (pure, unit-tested): `aggregatePlanVsActual` — per-type n /
  mean IF / target band / completion / execution over the trailing 90d of planned, non-legacy,
  non-compromised ledger entries — and `detectFtpRetest` — the overdelivery→stale-low advisory
  (≥4 FTP-anchored sessions in 42d, ≥75% individually above their frozen band top at ≥85% completion,
  mean overshoot ≥2% FTP, all scored against the *current* FTP so a re-test resets the window).
  Underdelivery deliberately excluded (fatigue-confounded). Thresholds exported as
  `FTP_RETEST_DEFAULTS` — a #2 per-athlete calibration hook.
- **`FTP_ANCHORED_IF_BANDS` exported from `lib/execution-score.ts`** (behaviour-preserving refactor):
  scorer, detector and the Trends target-band column share one source and can't drift.
- **CoachSnapshot gains `ftpRetest`** via `CoachSignals`/`resolveCoachSignals` → the `/api/ask` prompt
  ("FTP check: …" in `formatCoachSnapshot`), the Today card (amber advisory on `CoachSnapshotCard`),
  and `/api/generate`'s resolution (not rendered in the generation prompt by design — the planner must
  not compensate for unvalidated physiology).
- **`/api/trends`** now resolves the client's local `?today=` (AGENTS.md local-today class) and ships
  `planVsActual` + `ftpRetest`; new "Planned vs actual" card beside Weekly volume
  (`components/trends/sections.tsx`). Complements — doesn't replace — the age-based >90d stale-FTP
  warnings (Profile banner, Trends w/kg tile): execution flag = threshold moved; age flag = the
  fallback when no anchored quality work exists to measure.
- Advisory ONLY: nothing writes FTP or `physiology.json` (locked design decision). Live-smoked against
  the real corpus (flag correctly null — mean IF Threshold 0.79 vs band 0.82–0.92, VO2max 0.82 vs
  0.90–1.10, nothing over; table renders 4 type rows on Trends) + a live `/api/ask` run (coherent,
  grounded in FTP 288W, no invented flag).

---

## Route tests (`sync` + `generate`) — SUB-3 (2026-07-02)

Closed the 2026-06-30 audit's "test coverage lopsided" finding: the two highest-stakes, least-tested
routes now have wiring-level characterization coverage. Executed via subagent-driven development, 10
tasks, every task approved on first review pass. Plan:
[plan](docs/superpowers/plans/2026-07-02-sub3-route-tests.md).

- **`app/api/sync/route.test.ts` created — 19 tests.** GET cache/filtering; POST config/empty-sync
  guards + 401/502 error mapping; POST happy-path + per-date ledger immutability + disposition
  stamping; ledger-rebuild one-shot gating (runs once / marker refuses repeats / force overrides);
  physiology reconcile wiring; best-effort failures (quirk/intervention/analysis) surfaced as warnings
  not hard-fails; today-ride deterministic-analysis path (write + ledger patch + pending flag); DELETE
  discard (lived-days archive, calendar cleanup, same-day noise guard).
- **`app/api/generate/route.test.ts` extended +9 → 11 tests.** Request validation (400
  not-configured/non-JSON/invalid-params); structured-payload failure paths (502 null / 502
  schema-invalid / thrown→502); truncation-first + day-count-shortfall warnings; provenance +
  audit-trail stamping; best-effort season-replan (a persistence failure never blocks generation).
- **Architecture: I/O mocked only at the module boundary** (`intervals-api` network, `data-store`/
  `physiology` fs, `anthropic-api` LLM); the pure pipeline (score-log, sync-ledger, disposition,
  readiness, coach-snapshot, validators, plan-schema) runs for real — so these prove the wiring, not
  the already-unit-tested internals. Handlers invoked directly as functions with a `Request`, no server.
- Full suite 647 tests (58 files), up from 619 pre-SUB-3.

---

## SUB-1 · Durable planned corpus (block-history) (2026-07-02)

Closed the 2026-06-30 audit's "planned corpus isn't durable across blocks" finding: `buildRideScores`
matched a ride only against the *live* current block, so a ride whose block had since rolled over,
finished, or been discarded was stuck `planned:false` forever — indistinguishable from a ride with no
plan at all, even though a plan genuinely existed. 5 tasks via subagent-driven development, every task
approved on first review pass, plus one final-review fix batch — 6 commits, 619 tests (up from 611).
Design/build records: [design](docs/superpowers/specs/2026-07-02-block-history-durable-corpus-design.md) ·
[plan](docs/superpowers/plans/2026-07-02-block-history-durable-corpus.md).

- **`BlockHistoryEntry` gained per-day prescriptions.** New optional `days?: CurrentBlockDay[]` field
  (verbatim reuse of the live-block day type), populated by a new pure helper `truncateBlockDays(days,
  asOfDate)` that keeps only the *lived* portion — a superseded or discarded block's un-lived future was
  never a real plan, so archiving it would just manufacture match ambiguity. `lib/types.ts`,
  `lib/score-log.ts`.
- **`buildRideScores` matches against historical blocks, not just the current one.** New optional
  `history?: BlockHistoryEntry[]` param, seeded oldest-first so the live current block always wins a
  date collision, else the most-recently-created historical block wins — with a guard so a block can't
  retroactively claim to have prescribed an already-past day (`createdAt` must be ≤ the day it prescribes).
  The one production call site (`app/api/sync/route.ts`) threads the already-in-scope `blockHistory`
  variable through — no new I/O. `lib/score-log.ts`.
- **All three block-death paths now archive `days`** — write-time supersede and retrospective completion
  already called `appendBlockHistory`, just gained the field; **discard** (`DELETE` on `/api/sync`)
  previously archived *nothing at all*, silently losing any days already ridden against a block the
  athlete threw away. Now archives the lived portion (skipped entirely when zero days were lived — a
  same-day discard has nothing worth preserving). `app/api/write/route.ts`,
  `app/api/retrospective/route.ts`, `app/api/sync/route.ts`.
- **Design choice: history-aware *first*-scoring, not a rebuild-trigger.** The ledger's existing rebuild
  merge (`mergeScoreLogRebuild`) already permitted an off-plan→planned upgrade with zero changes — the
  gap was only that `buildRideScores` never had a historical prescription to find. Making it history-aware
  on every normal sync (not just on the rare, deliberately-manual full rebuild) means a ride gets scored
  correctly the *first* time, so nothing is ever frozen wrong and nothing needs retroactive fixing. No new
  ledger mechanism; LEDGER-1/2/3 composed with, not modified.
- **Final whole-branch review (Fable 5) caught 3 real cross-task interactions no per-task review could
  see**, all fixed in one batch (commit `8c2d32e`): `appendBlockHistory`'s pre-existing 20-entry cap
  (`lib/data-store.ts`) would have evicted real history within a season once discard-archival raised churn
  — raised to 200; `app/api/generate/route.ts` read `blockHistory[0]?.structuredReflections` blindly,
  which could now be a reflections-less discard entry, silently dropping Track D context on a common
  reroll flow — fixed to search for the most recent entry that actually has reflections (matching the
  robust pattern already used by the retrospective GET); and archiving a same-day zero-lived-days discard
  was creating noise entries on athlete-visible surfaces (`PlanView`'s block-history list, the Trends block
  timeline) — guarded to skip archiving when nothing was lived. The design spec's claims about pruning,
  discard "costing nothing," and "nothing here is athlete-visible" were corrected in place as dated notes
  once the review falsified them.
- **Sibling item paused, not shipped:** SUB-2 (legacy backfill importer) → see ROADMAP.md "Data substrate"
  for why (a live Intervals.icu API check found only 22–28% of the pre-app legacy corpus has calendar
  backing, not the whole window as originally assumed).

---

## Season/block goals-flow: Goals/Weakpoints centralization + Season/Block hierarchy + block-completion prompt (2026-07-01)

Three approved specs, built together in dependency order (Task 1–3 foundational, 4–5 depend on the new
goals shape, 6 independent) via subagent-driven development — 6 commits, each independently task-reviewed
and passed a final whole-branch review clean on first pass. Suite grew 597 → 611. Design/build records:
[goals-weakpoints-centralization](docs/superpowers/specs/2026-07-01-goals-weakpoints-centralization-design.md) ·
[season-block-hierarchy](docs/superpowers/specs/2026-07-01-season-block-hierarchy-design.md) ·
[block-completion-prompt](docs/superpowers/specs/2026-07-01-block-completion-prompt-design.md) ·
[plan](docs/superpowers/plans/2026-07-01-season-block-goals-flow.md).

- **Goals/Weakpoints off markdown, into a real form.** `AthleteProfile.goals`/`weakpoints` widened to
  `{goal, target, focus}` / `{weakpoint, detail}` (`focus` a `SeasonFocus` tag or `"general"`), replacing
  the old `string[]` shape read from hand-edited `athlete_profile.md` tables. A one-time migration
  (`applyGoalsMigration`, gated on `goalsMigratedAt`) seeds them from whatever was in the markdown file
  the first time this runs; never re-runs once set, never overwrites already-non-empty data. The
  read-only Goals/Weakpoints list on `/profile` is now a real add/edit/delete form with its own
  independent Save button/state (no cross-talk with Nutrition/Season saves). `athleteProfileToMarkdown`/
  `writeAthleteProfileMd` (confirmed zero remaining callers) deleted. `lib/types.ts`, `lib/data-store.ts`,
  `lib/kb-loader.ts`, `components/AthleteProfileForm.tsx`.
- **Generation prompt freshness.** The markdown GOALS/WEAKPOINTS tables are now stripped
  (`stripGoalsWeakpointsSections`) before `athlete_profile.md` is inlined into the generation prompt, so
  a stale copy can never sit alongside the live `goalsContext`/`weakpointsContext` injected straight from
  `AthleteProfile`. `/api/profile` GET/PUT extended to expose/accept `goals`/`weakpoints`.
  `lib/kb-loader.ts`, `app/api/generate/route.ts`, `app/api/profile/route.ts`.
- **Season informs Block.** Two pure helpers in `lib/season.ts` — `suggestedBlockWeeks` (ceiling-rounds
  the current season period's remaining weeks to the nearest of `[2,4,6,8]`, floor 2 / cap 8) and
  `filterGoalsByFocus` (keeps focus-matching + every `"general"`-tagged goal) — wired into the block
  generator's pre-fills, plus `SeasonPlan.objective` folded into the existing `formatSeasonContext` line.
  `components/dashboard/PlanView.tsx` fetches the season plan independently of the profile fetch (two
  effects; the season effect re-derives the goal pre-fill once both resolve, in either order) and passes
  a season-context readout + the widened 2/4/6/8 length buttons through to `BlockGenerator.tsx`. Nothing
  is ever locked — every pre-fill stays freely overridable before generating.
- **Block-completion prompt.** A pure `isBlockFinished(block, today)` predicate (`lib/date.ts`, strict
  `today > block.endDate`) hooked into `PlannedToday`'s existing empty-state branch: once the active
  block's dates have passed, `/today` proactively nudges the athlete to generate the next one instead of
  silently showing stale "no session planned" copy.
- **Post-ship bugfix (user-reported): real goals/weakpoints weren't migrating.** `readAthleteProfile`'s
  and `applyGoalsMigration`'s migration guards checked `goalsMigratedAt === null` / `!== null` strictly —
  a real, pre-existing `athlete.json` written before this field existed parses back with the key entirely
  *absent* (`undefined`, not `null`), which the strict guard misread as "already migrated," permanently
  skipping the athlete's real GOALS/WEAKPOINTS content. Fixed both guards to truthy checks; added a
  regression test that simulates the missing key by destructuring it away rather than only ever setting
  it explicitly (the gap every prior review layer missed, since in-memory fixtures always set the field).
  Ran the real migration and verified end to end in-browser (8 goals + 9 weakpoints now render on
  `/profile` and the `/plan` Goals card). `lib/data-store.ts`.
- **Known debt (accept-as-tracked)** → [ROADMAP.md](ROADMAP.md) "Season engine — known debt":
  Focus dropdown omits `sharpen`; a narrow goal-textarea race between the profile/season fetches;
  `stripGoalsWeakpointsSections`'s case-sensitive regex doesn't match the *default* KB template's
  differently-worded headings (real KB unaffected — it already uses the matching uppercase form).

## Season event-entry UI (2026-07-01)

Closed the MACRO-1 gap left by macro-periodization below: `SeasonPlan.objective`/`events` were
athlete-owned intent already persisted by `PUT /api/season`, but nothing in the UI let the athlete set
them, so event-anchored mode could never activate for a real athlete. Added a "Season" card to
`/profile` (objective field + a controlled add/edit/delete event list — name/date/A-B-C priority),
reusing the already-shipped `/api/season` GET/PUT and `validateSeasonPlanInput` (client-side
pre-validation, zero new backend). `components/AthleteProfileForm.tsx`. Design:
[season-event-entry-ui](docs/superpowers/specs/2026-07-01-season-event-entry-ui-design.md).

## Macro periodization & season scope — MACRO-1/2/3 (2026-07-01)

Closed the 2026-06-30 audit's "no periodization above the block" finding — the planner previously
optimised each 2–4 wk block in isolation with no target event, no weeks-to-event, and no base→build→
peak→taper sequence. 10 tasks via subagent-driven development, 15 commits, final whole-branch review
clean. Design/build record:
[macro-periodization](docs/superpowers/specs/2026-07-01-macro-periodization-design.md) ·
[plan](docs/superpowers/plans/2026-07-01-macro-periodization.md).

- **New store `data/season-plan.json`** — `SeasonPlan { objective, events: SeasonEvent[], periods:
  FocusPeriod[], updatedAt }`. Each `FocusPeriod` picks one system to emphasise (`aerobic-base` /
  `threshold` / `vo2max` / `anaerobic` / `durability` / `sharpen`) with a phase (`base`/`build`/`peak`/
  `taper`), grounded in the KB's Annual Periodisation Framework constants (base 90/10 easy/mod, build
  80/20, deload 30–50% volume every 3–4 weeks, cadence 3:1 default / 2:1 under heavy fatigue) — not
  invented by the LLM. `lib/season.ts`, `lib/types.ts`.
- **Two macro-periodization modes.** **Mode C (the live default, no event on the calendar)** —
  `replanSeasonArc` runs a rolling base→build→realize cycle: limiter-driven focus rotation (reusing the
  power-profile "easy win" + durability-template machinery rather than a parallel phase system), forced
  deload cadence, and an ACWR-capped load ramp between periods. Re-planning preserves the in-progress
  ("current") period verbatim as a 3rd bucket distinct from frozen history/manual overrides, so a
  re-plan never yanks the rug from under a period the athlete is mid-way through. **Event-anchored mode
  (built, tested, dormant)** — schedules backward from a future A-priority event (taper→peak→build);
  activates automatically the moment `SeasonPlan.events` holds one (see "Season event-entry UI" above
  for how an event gets there).
- **Feeds generation.** `POST /api/generate` calls `replanSeasonArc` + `validateSeasonFit` and folds
  `formatSeasonContext`'s one-line `SEASON CONTEXT` (phase/focus/week-of/rationale) into the prompt;
  `lengthWeeks` widened to `2 | 4 | 6 | 8` end to end (type, route validator, UI). `app/api/generate/route.ts`.
- **`SeasonRoadmap` stepper UI on `/plan`.** Done/current/upcoming period cards + an event flag,
  visually verified end-to-end against a seeded season plan.
- **`GET`/`PUT /api/season`** — read the plan / update `objective`+`events` (periods are engine-managed,
  not directly editable); `validateSeasonPlanInput` guards the PUT.
- **Known debt** → [ROADMAP.md](ROADMAP.md) "Season engine — known debt": event-mode peak/taper
  share one `sharpen` focus value (cosmetic, same roadmap color); `CurrentBlock.seasonFocus`/
  `seasonPhase` stamped from "today" not the block's actual start date (no readers yet); `anaerobic` is
  a valid build focus but unreachable via the default rotation fallback (intentional per KB).

---

## Fueling-aware coach + Today/Profile feedback sweep (FB-2026-06-30)

- **#1 — energy availability now feeds the coach.** EA is a first-class `CoachSignal` (computed once in
  `resolveCoachSignals`, anchored to the resolved local day): it fills the previously-reserved
  `fuel.fuelingState` (low/adequate/ample band) + `fuel.intakeVsNeed` (kcal/kg) slots, renders on both LLM
  paths (`formatCoachSnapshot` + `formatFormFuelLine`, framed as a body-weight proxy) and the athlete-facing
  `CoachSnapshotCard`. Null until ≥3 complete logged days. The coach can finally reason about under-fueling.
  _[coach-snapshot.ts](lib/coach-snapshot.ts) · [nutrition.ts](lib/nutrition.ts) · [CoachSnapshotCard.tsx](components/CoachSnapshotCard.tsx)._
- **EA reads low/adequate/ample.** New pure `eaLevel()` — soft, non-clinical bands shifted to a body-weight
  basis (the FFM 30/45 cutoffs don't map), framed as a rough reference. _[nutrition.ts](lib/nutrition.ts) · [dashboard/today.tsx](components/dashboard/today.tsx)._
- **RPE dropped as an athlete-state driver (revisit later).** Over-swung the state against a ~0 baseline (no
  historical RPE logged). Removed `evalRpe` from the fusion + the ride-card tile; high-confidence gate relaxed
  ≥4→≥3 (5→4 core signals); calibration `rpe` weights left dormant. _[athlete-state.ts](lib/athlete-state.ts)._
- **Coach-note frame glitch fixed.** Unified the analysing/loaded/empty branches into one content-height Zone
  (the `fill` divergence had snapped the cyber-bracket frame mid-sync). _[dashboard/TodayView.tsx](components/dashboard/TodayView.tsx)._
- **Power curve: drag-scrub + half-size + side-by-side.** Interactive client chart (drag/hover to read off
  any duration's watts + W/kg); laid beside the rider profile in a two-column row. PR recognition now covers
  all 9 synced durations (adds 2m/30m/60m). _[PowerCurveChart.tsx](components/PowerCurveChart.tsx) · [AthleteProfileForm.tsx](components/AthleteProfileForm.tsx) · [pr.ts](lib/pr.ts)._

---

## Calibrated-honesty UX pass — Today / Trends / Profile

The UI now grades its own certainty the way the engine already does: provenance stamped, thin reads
flagged, flaky/off-vocabulary numbers pruned or relabelled. Display-only — no engine changes.

- **A — confidence tiers.** Athlete-State `low` confidence renders as an amber caution (thin read — few
  core signals or a tiny exec sample); thin aggregates the engine can't trust are withheld (`—`) rather
  than shown (ACWR already returns `null` below 14 days, RV2-2). _[AthleteStateCard.tsx](components/AthleteStateCard.tsx)._
- **B — provenance stamps.** The IF tile stamps its basis (`· NP` vs `· avg`, since `ride-analysis` reads
  `normalizedPower ?? avgWatts` and an avg-based IF understates variable efforts); decoupling carries a
  "context only — not in your execution score" note. _[dashboard/today.tsx](components/dashboard/today.tsx)._
- **C — prune to a trusted core.** Avg speed removed from the Today glance; decoupling relocated to the
  "Power execution" drill-down (it's not a scored signal). Profile makes the two-memory split visible —
  measured sections carry a cyan "synced" badge, owned intent keeps "Edit →". Metric name standardised to
  **"Load"** (Intervals.icu's term) across Today/Trends/Plan; the readiness tooltip stopped claiming HRV
  (it's gated off). _[today.tsx](components/dashboard/today.tsx) · [AthleteProfileForm.tsx](components/AthleteProfileForm.tsx)._
- **Recent Baselines curated.** The card now holds single numbers that aren't already a chart: **w/kg @
  threshold** (a current snapshot, FTP ÷ latest weight, resolved in the trends route) · weekly hours ·
  **rides/week** (new 90-day rolling metric) · avg load/ride. Dropped cadence (low value) + decoupling (the
  Pw:HR chart tells it). _[trends/sections.tsx](components/trends/sections.tsx) · [readiness.ts](lib/readiness.ts)._
- **Energy-availability tile** ⭐ — deterministic fuel proxy `(intake − ride burn)/kg`, trailing mean over
  complete days (today excluded), week-over-week trend, **no clinical band** (a body-weight proxy off
  self-logged intake can't claim the 30/45 kcal/kg·FFM cutoff; on real data the athlete straddles 30 day to
  day, so a band would flicker). Withheld below 3 logged days. `computeEnergyAvailability` + 3 tests.
  _[nutrition.ts](lib/nutrition.ts) · [dashboard/today.tsx](components/dashboard/today.tsx)._
- **Device-lap path reverted** (`f81f4dc` → `c439ba4`) — Intervals.icu's one-click "use laps" already folds
  laps into `icu_intervals`, so the app stays single-source; no second fetch path. _[intervals-api.ts](lib/intervals-api.ts)._

## Accuracy & hardening sweeps — Jun 24–25

Three senior-dev deep-reads of the deterministic core plus an athlete-requested accuracy pass, all shipped;
the suite grew to ~558. Only RV2-15 (data-gated) and a lap-field confirmation remain → [todo.md](todo.md).

- **RV2 — accuracy review (engine deep-read, 15 findings; 13 shipped).** Theme: *windows that include their
  own comparison point*, *divisors that assumed full history*, *open-top scoring bands*. Shipped: ACWR &
  weekly-hours divisors use the days of history that exist + an explicit ≥14-day gate (RV2-2/3); aerobic + RPE
  baselines exclude the recent window they're compared against, with min-sample floors (RV2-4/5); Theil–Sen
  weight trend (RV2-6); HR zones with no LTHR/maxHR anchor return `[]` (RV2-7); VO2max/RaceSim penalise an
  over-cooked effort (RV2-8); `today` threaded into athlete-state for replay (RV2-11); one shared heavy-fatigue
  predicate (RV2-9); `stats.median` reuse (RV2-10); power-curve match tolerance clamped [5s,120s] (RV2-13);
  post-ride meal recommendation deleted — athlete fuels pre/intra only (RV2-14). RV2-1 closed as not-a-bug
  (`bucketZones` already drops zero-fill); RV2-12 accepted limitation (an NP scalar can't yield time-in-zone).
  _`125fde9` · `f9d2510` · `15789ea`._
- **Interval-order misparse (BUG-2026-06-25).** `parsePrescription` expanded `3x{Over,Under}` as
  each-step-×3 instead of repeating the block in sequence, so the order-based matcher scored every rep against
  the wrong target; it now expands in execution order then collapses identical reps for the label, and written
  blocks self-heal on the next sync. (A device-lap preference for the executed side was tried in `f81f4dc` and
  **reverted** — Intervals.icu's one-click "use laps" already folds laps into `icu_intervals`, so the app stays
  single-path on `icu_intervals` as before; no second fetch path to maintain.)
  _[prescription.ts](lib/prescription.ts) · [intervals-api.ts](lib/intervals-api.ts)._
- **ACC — second-brain state accuracy (athlete request).** Aerobic driver moved off whole-ride decoupling (a
  ride-structure artifact) to Intervals' Z2-isolated `icu_power_hr_z2` (higher = fresher; ≥15 Z2-min, latest
  ≤14d, baseline ≥3 rides). Weight trend moved to a least-squares/Theil–Sen slope over the trailing 14 days.
  Decoupling stays in execution scoring + Trends. _[athlete-state.ts](lib/athlete-state.ts) · [nutrition.ts](lib/nutrition.ts) · [docs/specs/athlete-state.md](docs/specs/athlete-state.md)._
- **RV — general review (10 findings, all closed).** Local-date threading through the readiness windows (RV-1);
  idempotent block writes via a deterministic uid + auto-rollback of a partial write + block-discard cleanup
  (RV-2/RV-9); HRV gated off-by-default and hardened for re-enable (RV-3/4); ledger anchored to each ride's own
  `icu_ftp` (RV-5); physiology history capped at 24 snapshots (RV-5b); matcher tradeoffs documented (RV-6);
  three monoliths split behaviour-preserving (RV-8). RV-7 (AI spend cap) closed won't-do — spend is cents.
- **CR — xhigh review of the Jun-23 logic + a11y pass (15 findings, all shipped).** Rebuild never downgrades a
  frozen `planned` entry or drops `formState`/`morningCheck` provenance (LEDGER-1/2), and is guarded behind a
  one-shot marker (LEDGER-3); settings PUT preserves + clamps every band/weight override (SET-1/CAL-1);
  durability-envelope split-brain fixed (CAL-3); zero-power / string-decoupling parse guards (API-1/2); a fasted
  `0g` ride kept as a real fuel data-point (FUEL-1); shared `pick` helper (CAL-2); muted-contrast a11y sweep,
  shared `athlete-state-ui`, `DECOUPLING_GOOD_BOUNDS` reuse, calibration-range validation (A11Y-1/2, UI-1/2, CAL-4).

## Per-athlete calibration framework — first pass (ROADMAP #2)

The keystone framework + its first calibrated parameter. Three commits; tests grew to 333.

- **The framework (Phase 0).** `lib/calibration.ts` promoted beyond α/ACWR into a uniform
  `CalibratedParameter { value, source, confidence, dataPoints, lastUpdated, locked, manualOverride }`
  (`lib/types.ts`) + `CalibrationStore`. `resolveCalibratedValue` resolves the effective value
  (precedence: manual override > trusted-derived [locked or ≥ medium confidence] > population default;
  never returns NaN); `confidenceFromN` is the sample-size confidence/lock layer (the additive
  uncertainty model Track D deferred into #2 — built once here). `data/calibration.json` is a derived
  store (`readCalibration`/`writeCalibration`, no backup, like rolling-baselines).
- **Decoupling "good" cutoff (Phase 1).** `deriveDecouplingGood` turns `rolling-baselines.avgDecoupling90d`
  (clamped 2.5–8, sample-size confidence) into the band's "good" cutoff, preserving a manual override and
  freezing once locked. `computeExecutionScore` takes optional `calibration.decouplingGood` and scales the
  decoupling bands off it — at the default G=4 the cutoffs are exactly `[2,4,7,10]`, so an uncalibrated
  score is byte-identical (no silent ledger regime split).
- **Immutable-ledger stamping.** `RideScoreEntry.calibration` freezes the values each entry was scored
  against (like `ftpUsed`; absent on pre-calibration entries). `buildRideScores` + the sync POST's
  interval-aware re-score both stamp it; a calibration change only affects new entries.
- **Wiring + UI.** Sync POST derives → writes → resolves → scores+stamps; GET returns `calibration` on
  `AppState`; read-only `CalibrationPanel` on Settings shows the effective value + provenance
  (default / learning / calibrated). Until a sync derives a confident value, everything resolves to the
  population default — a fresh athlete scores exactly as before.
- **Per-type IF cutoffs (second parameter under the framework).** `deriveIfBandOffsets(powerZonePct)`
  (`lib/calibration.ts`) shifts the `computeExecutionScore` `switch (plannedType)` IF bands to the
  athlete's OWN power-zone %FTP edges — Recovery/Z2/Threshold/VO2max/SIT anchored to their zone top
  (Z1/Z2/Z4/Z5/Z6), RaceSim deliberately left on population constants (no single anchoring edge). The
  per-type shift is a bounded FTP-fraction offset (±0.08 clamp, 0.02 deadband) added to every band edge
  in the IF branch; `DEFAULT_POWER_ZONE_TOPS_PCT = [55,75,90,105,120,150]` (Coggan/Intervals defaults)
  yields `{}` → **byte-identical scoring for a default-zoned athlete** (the regression net: the existing
  execution-score suite stays green unchanged). Threaded through `resolvedCal.ifBandOffsets` in the sync
  route to **both** the ledger re-score and today scoring; `execution-score.ts` gained a
  `ScoringCalibration { decouplingGood?, ifBandOffsets? }` type, `o = calibration?.ifBandOffsets?.[type] ?? 0`.
  Pure + deterministic + tested (offset derivation + the IF-branch shift in isolation). _Slivers left
  in ROADMAP #2:_ surface on Settings (derived live from zones, not yet in `CalibrationStore`); anchor RaceSim.

- **IF offset frozen onto ledger entries (provenance, ROADMAP #2 sliver).** `buildRideScores` now stamps
  the per-type IF-band offset that actually scored an entry alongside the decoupling cutoff, via the new
  exported `calStampFor(calibration, scoringType, intrinsic)` helper — replacing the single global
  `calStamp`. Only **planned** entries carry an offset (off-plan rides skip the intensity-vs-type branch,
  so none applied); a zero/deadband offset or an irrelevant type is omitted, so uncalibrated/default-zoned
  entries stay key-free (byte-identical). `RideScoreEntry.calibration` widened to
  `{ decouplingGood?; ifBandOffset? }` (both independently optional — backward-compatible with stored
  entries). The sync route's live-today re-score reuses `calStampFor` so today's entry stamps the same
  shape. Tested (planned stamp, type-scoping, deadband, off-plan omission); full suite green.

- **TSB adaptation-window edges under the framework (ROADMAP #2, closes #1's `form.tsbModifier` sliver).**
  `resolveTsbModifier`'s literal band edges (`-25 / -10 / 5`) are now a calibrated parameter:
  `TsbModifierEdges` + `DEFAULT_TSB_MODIFIER_EDGES` + `resolveTsbModifierEdges(override)` /
  `isTsbModifierEdgesOverridden` in `lib/calibration.ts`, mirroring `resolveAcwrBands` (defensive merge:
  ignore non-finite, clamp to a sane TSB range, enforce strict ascending order). **Deliberately the
  ACWR-bands pattern, NOT auto-derived** — the honest per-athlete signal (where THIS athlete stops
  adapting under fatigue) is measured nowhere; recentering on their TSB *distribution* would calibrate to
  where they train, not where they adapt (the framework header's "don't pretend to derive what we lack
  data for" rule). So: population-validated defaults + a manual override (`BlockSettings.tsbModifierEdges`,
  persisted/clamped in `/api/settings` like `acwrBands`). `resolveTsbModifier` gained an
  `edges = DEFAULT_TSB_MODIFIER_EDGES` param; `buildCoachSnapshot` resolves from a new
  `tsbModifierEdgesOverride` input, threaded through `CoachSnapshotSources` + all four snapshot build
  sites (sync ×2, ask, generate). Absent override → byte-identical classification (the fresh-athlete
  guarantee, tested across a TSB sweep). Tested (resolver clamp/order, override band shift); full suite green.

- **Form-state context stamped onto the ledger (ROADMAP #2 — input side of the context-stamp data play).**
  The play that makes the override-only edges (e.g. the TSB adaptation window) eventually *learnable*:
  freeze the athlete-state context an entry was scored under, so a later state→subsequent-execution
  correlation has something to correlate against. First parameter stamped = **form** (CTL/ATL/TSB).
  `buildFormStateLookup(wellness)` (`lib/readiness.ts`) returns a per-date resolver over intervals.icu's
  OWN per-day CTL/ATL (authoritative, not reconstructed): the most recent **strictly-prior** day (the form
  carried IN — not same-day, whose end-of-day CTL/ATL already absorbed that day's ride, which would leak
  the session's own load into the signal; also matches the PMC "form = yesterday's CTL−ATL" convention),
  carried forward across gaps up to a 10-day staleness cap (CTL drifts over weeks), `tsb = round1(ctl −
  atl)`, null when nothing recent enough exists. _[review-hardened: strictly-prior + staleness cap.]_
  `buildRideScores` gained a 7th optional resolver and stamps `RideScoreEntry.formState = { tsb, ctl, atl }` on each entry
  (spread-ready — absent when no wellness covers the date or no resolver passed → byte-identical). The
  sync route builds the lookup from `lastSync.wellness`. **Provenance only — `formState` never feeds the
  entry's own `executionScore`** (it's the input for a *future* correlation, kept out of the score it
  describes to avoid circularity). Backfill + the live-today re-score preserve it via `...e`. Tested
  (same-day / carry-forward / missing / rounding + the stamp present-and-absent).

- **Morning-check context stamped + resolver generalized (ROADMAP #2 — input side completed).** The
  subjective half of the context stamp: `RideScoreEntry.morningCheck = { fatigue, sleep, soreness }`
  (1–5, same-day only — no carry-forward; the first-person signal not captured by objective load). The
  `buildRideScores` resolver was generalized from `formStateForDate` → `contextForDate: (date) =>
  RideEntryContext | null` (`{ formState?, morningCheck? }`), each field stamped independently and
  spread-ready (byte-identical when absent). The sync route builds the combined resolver from
  `lastSync.wellness` + a `readMorningChecks()` map. **Readiness deliberately NOT stamped** — it's a
  derived composite of form + HRV, reconstructable from what's already frozen, so storing it would
  duplicate derivable state. Tested (form + morning-check together, form-only, absent).

- **First auto-derivation off the stamped context: the TSB deep-fatigue edge (ROADMAP #2 — payoff of
  the data play).** `deriveTsbDeepFatigue(entries)` (`lib/calibration.ts`) recenters the deep-fatigue
  edge on the **median TSB of the athlete's under-executed quality sessions** — **prescribed** quality only
  (`planned && plannedType ∈ {Threshold,VO2max,SIT,RaceSim}`; off-plan rides are scored intrinsically, a
  different failure axis, so they're excluded), `executionScore ≤ 4`, legacy + compromised excluded.
  **Honesty guards**, all falling back to the population default: a confidence gate on the failure count
  (`confidenceFromN`, never applied below medium); a **contrast requirement** — needs ≥1 successful quality
  session, else there's nothing to discriminate against; and a **discrimination guard** — failures must sit
  ≥4 TSB points deeper than the successes' median, else fatigue isn't the driver. _[review-hardened:
  planned-only + required success contrast.]_ Derived value clamped to
  `[-45, -12]`. `resolveTsbEdgesOverride(entries, settingsOverride)` layers the derived edge as the new
  default **under** any manual override (precedence: manual > derived > population), returning a partial
  that flows through the existing `resolveTsbModifierEdges`. Wired at every snapshot site
  (`buildCoachSnapshotFromSources` + generate). No-signal/no-formState athletes resolve to the population
  edges → byte-identical classification. This is the first override-only edge to become *learned*, exactly
  the roadmap worked example — turning the 2b override-only TSB window into a derived one once the data
  earns it. Tested (derivation, both guards, exclusions, clamp, precedence, low-confidence fallback);
  full suite green (834).

- **TSB-derivation review follow-ups CS-5..CS-8 (after findings 1–4 fixed inline).**
  - **CS-5 — per-edge precedence.** `resolveTsbEdgesOverride` now resolves precedence per-edge: a manual
    `deepFatigue` short-circuits the derived value entirely, and a derived edge **yields** below a manually-set
    `productiveOverload` (`min(derived, manualPO − 1)`) so `resolveTsbModifierEdges`' ordering pass can no
    longer nudge a manual neighbour up. Manual > derived > population, for the *neighbour* edges too.
  - **CS-6 — single morning-check read.** The sync POST read `readMorningChecks()` twice (ledger stamp +
    snapshot); hoisted to one read reused by both.
  - **CS-7 — TSB-specific confidence gate.** Replaced `confidenceFromN(nUnder)` with
    `tsbDeepFatigueConfidence(nUnder, nGood)`: lower failure bar (quality failures are rare + informative)
    but now requires real **contrast** (≥3 successes) — effective take-effect gate is nUnder ≥ 5 ∧ nGood ≥ 3
    (was an ~unreachable ≥8 failures). The contrast requirement also blunts CS-8's tiny-N median concern,
    since the applied derivation now rests on ≥3 successes.
  - **CS-8 — shared `lib/stats.ts`.** Extracted `round1` / `round2` / `clamp` / `median` into one module;
    `calibration.ts`, `readiness.ts`, `score-log.ts` now import them instead of re-defining. Tested. Full
    suite green (839 + stats).

### Population-fallback fold-in — strain bands, durability envelope, fusion weights (ROADMAP #2/§5)

Three scattered groups of "magic numbers" brought under the same `resolve-with-fallback` machinery as the
ACWR/TSB-edge bands — population fallback, manually overridable via `BlockSettings`, **no** derivation
(no honest per-athlete signal exists yet). Each consumer takes the resolved value as an optional param
defaulting to the population default, so an absent override behaves byte-identically. Two commits; tests
grew to 462.

- **Morning-check strain bands + TSB-deep cutoff.** `StrainBands` (`high`=15/`med`=12) +
  `resolveStrainBands` in `calibration.ts`; `decideMorningCheck` takes the resolved bands. The TSB-deep
  cutoff dropped its duplicate `-25` literal and now routes through the existing
  `resolveTsbModifierEdges().deepFatigue` (one source for the edge). Wired via the morning-check route.
- **Durability-insert envelope.** `DurabilityInsertEnvelope` (88% floor, ≤122% / ≤20 min) +
  `resolveDurabilityInsertEnvelope`; dedups `EMBEDDED_HARD_PCT` (was defined twice — `prescription.ts`
  + `workout-validate.ts`). `validateWorkoutProtocol` / `validatePlanProtocol` / `carriesEmbeddedIntensity`
  take the resolved value; wired via the generate route.
- **Athlete-state fusion weights.** `athlete-state.ts`'s private `const C` promoted to
  `DEFAULT_ATHLETE_STATE_WEIGHTS` + `resolveAthleteStateWeights` (recursive finite-leaf deep-merge, never
  mutates the default) + a shared `DeepPartial` helper. `computeAthleteState(i, weights = DEFAULT)` —
  evaluators are now pure fns of `(inputs, weights)`. Threaded through `resolveCoachSignals` +
  `CoachSnapshotSources` and every snapshot site (sync GET + POST, `/api/ask`, generate).
- **Overrides** live on `BlockSettings` (`strainBands` / `durabilityInsertEnvelope` /
  `athleteStateWeights`), alongside the existing `acwrBands` / `tsbModifierEdges`. Per-athlete
  *derivation* of any of these stays future work (← #2's shared correlation engine).

### Shared correlation engine + carbs ledger stamp (ROADMAP #2 / Track C)

The reusable substrate the roadmap asked for ("build the derivation once, reuse it") plus the first new
signal stamped against it. Two commits; tests grew to 474.

- **The engine (`lib/correlation.ts`).** `deriveExecutionEdge(entries, spec)` generalises the guarded
  regression `deriveTsbDeepFatigue` hard-coded: population filter (planned · !legacy · !compromised ·
  in-scope type · present signal), under/good outcome partition, a discrimination guard with a
  `failureSide` direction (`lower`|`higher`), confidence gate + clamp → `CalibratedParameter`. Depends
  only on `./types` + `./stats` (no `./calibration`) so calibration consumes it cycle-free.
  `deriveTsbDeepFatigue` is now a thin `failureSide: "lower"` spec over it — behaviour byte-identical
  (every existing deep-fatigue test still green).
- **Carbs input stamped (`fuel.carbsGPerH`).** intervals-api maps `carbs_ingested` ("CHO In") into
  `ActivitySummary.carbsIngestedG`; `score-log.fuelStampFor` freezes it as g/h (grams over moving hours)
  onto each entry, alongside the calibration + context stamps. Only a positive logged intake is stamped
  (a blank/zero field is indistinguishable from "didn't fuel" — no fake zeros). Provenance only; never
  feeds `executionScore`. Sparse until athletes fill it in, accumulating like `formState` did.
- **Not yet built** (ROADMAP Track C): the *optimum*-derivation shape carbs needs (the engine finds a
  failure edge, not an optimum); consuming the derived optimal g/h (#1 fuel slots, §6 surfacing); the
  `productiveOverload`/`balanced` edges (no honest execution outcome) and the morning-check strain edge
  (needs `motivation` stamped — the ledger freezes only fatigue/sleep/soreness).
- **Subjective wellness now synced (Inc 1 of the form-retirement plan, `98464b9`).** Reframed: the morning
  read is sourced from the **Intervals.icu wellness sync** (the athlete already logs it there next to
  weight/kcal), not a NodeVelo form. `fetchWellness` now maps soreness/fatigue/stress/mood/motivation/injury
  into `WellnessEntry` (raw 1–4, higher = worse). The strain-edge derivation + form retirement (Inc 2–3) and
  the open strain-scale decision are tracked in [ROADMAP.md](ROADMAP.md) → *Subjective wellness from
  Intervals.icu*.

### One-time ledger rebuild after the mapping fix (SYNC-2, 2026-06-23 triage)

The field-mapping fix corrected future syncs, but `mergeScoreLog` freezes past dates (existing-wins),
so 108 historical entries kept execution scores + IF computed off the old null NP (IF fell back to raw
avg). Added an opt-in `rebuildLedger` flag to POST `/api/sync`: when set, the score-log step merges
**fresh-wins** (recomputed entries override existing) instead of the normal freeze, re-scoring every date
inside the 182-day activity window from corrected activities while preserving anything outside it. Off by
default (normal sync stays immutable per date); reuses the entire build pipeline (ftpForDate / resolvedCal
/ contextForDate / backfill / dispositions) so there's no divergence. Ran once + verified: entries with
IF<0.70 dropped 72→39, and e.g. the 2026-06-18 **SIT** session went IF 0.63→0.86 / exec 2→8 (it was
wrongly scored as failed purely from the understated IF). Backups: json-store `.bak` + an explicit
`score-log.json.pre-rebuild-*.bak`. (Entries that stayed low are genuinely NP-less rides.)

### Coach-note render collapse fix (SYNC-1, 2026-06-23 triage)

The Today coach note was generated, persisted, and returned by GET (correct `activityDate` + `coachNote`)
but rendered invisibly: its `fill` Zone (`flex-1 min-h-0 overflow-y-auto` body) collapsed to **0px**
(`clientHeight 0`, `scrollHeight 333`) whenever the Trend-pulse sibling consumed the viewport-locked
right column. Confirmed with a headless-Chromium measurement against the live app. Fix
([components/Dashboard.tsx](components/Dashboard.tsx)): drop `fill` from the coach-note Zone (size to
content) and make the right column itself scroll (`lg:overflow-y-auto`) — the note now has real height
(section 28px → 385px) and is reachable. Verified before/after via Playwright + screenshot. (Further
above-the-fold density tuning stays the UI lane's page-density item.)

### Activity power-field mapping fix (P1 data integrity, 2026-06-23 triage)

`fetchActivities` read NP/decoupling/max from keys intervals.icu never returns, so they were `null` on
every ride — silently dropping IF back to raw avg watts (a VO2 4×4 read as 0.62 / "recovery") and
zeroing decoupling + its rolling baseline. Verified against the raw activity API: NP is
`icu_weighted_avg_watts` (not `icu_normalized_power`), decoupling is a bare `decoupling` (not
`icu_power_hr_decoupling`), max power is `icu_pm_p_max` (not `max_watts`); `icu_efficiency_factor` was
present all along, which is what exposed the gap (EF needs NP). Fixed with the correct keys (old ones
kept as defensive fallbacks) + a mapping test. _Follow-up open in todo (SYNC-2):_ historical score-log
entries are frozen with the wrong IF/decoupling and need a one-time rebuild. (Triage also confirmed the
coach-note non-display is a client render bug — SYNC-1 — and that "no power PRs" was correct, not a bug.)

---

## Scoring-core — Z2 "dialed-in" discipline signal

**Superseded 2026-07-11** — the *scoring* mechanism below (`aboveZ2Frac`, the power-based ±2 band) was
replaced by an HR-based, terrain-immune read; see "HR-judged easy-ride discipline" further up this file.
The `CoachSnapshot.today.execution.aboveZ2Pct` *surfacing* described here initially survived that
rework untouched, then was itself replaced the same day by the HR-based `aerobicDiscipline` field — see
"Coach-prompt aerobic-discipline gap closed" at the top of this file. Kept below as the historical
record of what originally shipped.

Closed the ROADMAP scoring-core gap: easy aerobic rides were scored on *average* IF + decoupling, so a
Z2 ride that averaged a textbook 0.68 IF while repeatedly surging into Tempo+ read as disciplined — the
mean hid the spikes and the variability index only blurred them.

- **The measure.** `timeAboveZ2Fraction(powerZoneTimes)` (`lib/execution-score.ts`, pure + defensive)
  returns the share of measured in-zone time spent in **power zones 3+** (above the Z2 aerobic cap),
  from the already-synced `ActivitySummary.powerZoneTimes` — `null` when there's no usable zone data so
  scoring falls back to its other signals.
- **The score.** A bounded **±2** band in `computeExecutionScore` (`aboveZ2Frac` input): ≤5% above cap
  → +1 (genuinely dialed in), ≤15% → 0, ≤30% → −1, >30% → −2. Gated to **prescribed Z2/Recovery** and
  skipped for off-plan (intrinsic) rides — no plan to be disciplined against — and absent-safe, so every
  existing ride without zone data scores byte-identically (the execution-score suite stayed green
  unchanged). Threaded through both score call sites: `buildRideScores` (the ledger; past entries stay
  frozen via `mergeScoreLog`, so only new rides see it) and `buildTodayAnalysis` (today, re-scored live).
- **Surfaced.** `CoachSnapshot.today.execution.aboveZ2Pct` (% above cap, Z2/Recovery only) renders in
  `formatCoachSnapshot` with a qualitative tag (dialed in / drifted / drifted hard) so Ask-Coach reads
  the resolved discipline number instead of inferring it. 12 new tests (helper + band + surfacing); suite 394 → 406.

---

## Code-review hardening sweep (CR-A..H)

A "senior dev who hates this implementation" pass over the whole repo, 2026-06-22 — eight findings,
each shipped as its own atomic commit with tests. Suite grew 333 → 394. Deferred sub-items (real but
lower-leverage) are routed to ROADMAP; the design-judgment calls live there too.

- **CR-A — transactional ledger writes.** `json-store` serialized byte-*writes*, not read-modify-write,
  so a concurrent `/api/sync` + `/api/disposition` each doing `read→mutate→write` on `score-log.json`
  could lose an update. Added `updateJsonFile<T>(file, fallback, mutate)` (reads INSIDE the per-file
  lock via the generalized `withFileLock`) + `updateScoreLog`/`updateDispositions` helpers; wired both
  sync score-log writes and both disposition writes through them. (Other ledger touchers are read-only.)
  `lib/json-store.ts`, `lib/data-store.ts`, `app/api/disposition/route.ts`.
- **CR-B — external-fetch timeouts.** `AbortSignal.timeout(20s)` on `icuFetch` (abort/network → typed
  `IntervalsApiError`), `timeout:240s` + `maxRetries:2` on the Anthropic client, `maxDuration=120` on
  `/api/sync`. New `intervals-api.test.ts`. `lib/intervals-api.ts`, `lib/anthropic-api.ts`.
- **CR-C — refuse a destructive empty sync.** `isSuspectEmptySync(prev, fresh)` (pure, tested): a sync
  with no activities AND no wellness when the prior had data returns 502 instead of overwriting
  `last-sync.json` + resetting baselines from `[]`. _Deferred → ROADMAP P8:_ persistent sub-step
  failures deserve real observability, not a recurring toast. `lib/intervals-api.ts`, `app/api/sync/route.ts`.
- **CR-D — same-origin API guard.** Next 16 `proxy.ts` (the renamed middleware) matching `/api/:path*`,
  backed by unit-tested `lib/csrf.ts` `isForbiddenCrossSiteWrite` (state-changing methods need a
  same-origin `Origin`; safe methods + non-browser clients exempt). Verified live: cross-site POST →
  403 before the handler, same-origin POST passes. Closes the drive-by `/api/import` hole. NEW `proxy.ts`, `lib/csrf.ts`.
- **CR-E — immutability contradictions fixed.** `deriveDecouplingGood` no longer auto-locks at n≥20 —
  it re-derives from the 90-day rolling mean every sync (input is already recency-windowed; a season of
  getting fitter must move the cutoff), confidence gate still guards noise, last-known-good kept across
  an empty window. `mergeScoreLog` comment now states the real contract (past frozen, today re-derived
  live). `lib/calibration.ts`, `lib/score-log.ts`.
- **CR-F — enforce the AI's nutrition numbers.** `validateNutrition` recomputes each day's daily-intake
  kcal from the same deterministic formula the reference table is built from, parses the figure the
  model wrote, flags a material deviation (generous tolerance). Wired into `/api/generate`. _Deferred →
  ROADMAP Track C:_ per-carb (pre/in/post) checks — shared free-text line makes which-number-is-which
  parsing ambiguous. NEW `lib/nutrition-validate.ts`.
- **CR-G — decompose the sync god-route + first mutating-route test (worktree).** Extracted the
  today-ride pure logic into `lib/ride-analysis.ts` (`computeRideMetrics`, `computeAdvisedIntake`,
  `buildTodayAnalysis`) and the ledger schema migration into `lib/sync-ledger.ts` (`backfillLedgerEntries`);
  the route now does I/O + calls the tested pure builders (~130 lines lighter). Added
  `app/api/disposition/route.test.ts` — first coverage for a mutating route (the CR-A transactional path).
  _Deferred → ROADMAP:_ full step-by-step pipeline split + component tests. NEW `lib/ride-analysis.ts`, `lib/sync-ledger.ts`.
- **CR-H — edge cases (H1 shipped, rest triaged).** `resolveAllTimeCurve` merges fresh + prior all-time
  taking max-per-duration so the all-time power curve stays monotonic on a missing/partial/regressed
  fetch (84-day curve only as a first-sync last resort) — PR detection can't false-drop. The other three
  (physiologyAsOf re-sort cost, dual weight-trend display, HR bpm-vs-%LTHR heuristic) triaged as
  not-a-bug / not-worth-the-risk, documented. `lib/intervals-api.ts`.

---

## Code-review hardening pass (CR-1..16)

A self-review of the §5/#1/#3/Track B work, worked as a gated pre-feature pass. All 16 items resolved.

- **CR-1 — durability intensity made visible.** `carriesEmbeddedIntensity` (`lib/prescription.ts`): a
  ride carrying ≥5 min of ≥88%-FTP work counts as hard. `validateSchedule` (now takes `ftp`) treats
  such a Z2 ride as a hard day for back-to-back spacing; `validateWorkoutProtocol` checks the embedded
  inserts against a threshold∪VO2 envelope (≤122%, ≤20 min). Budget stays type-based.
- **CR-2 — guarded the proactive apply.** `proactiveApplyBlock`: `PUT /api/morning-check` refuses
  unless today's stored check recommended `downgrade` and no ride is logged.
- **CR-3 — client-local dates.** `/api/ask` + `/api/morning-check` resolve the client date
  (`resolveToday`); `AskCoach` + `MorningCheckIn` send `localToday()`. UTC-boundary disagreement gone.
- **CR-4 — KB resilience + skeleton.** `knowledge-base-defaults/` (committed schema + cited §-anchors);
  `kb-loader.ts` reads local-else-default and never `readdir`-throws on a fresh clone.
- **CR-5 — one ACWR.** `/api/ask` uses calibrated `resolveAcwrBands(settings)` like Today/generation.
- **CR-6 — carry-forward is real.** A no-make-up-slot downgrade records the dropped session on
  `CurrentBlock.deferredQuality`; generation re-prioritises it. No longer silently lost.
- **CR-7 — negation-aware goal matching.** "avoid hills" / "no racing" stop forcing a RaceSim.
- **CR-8 — route/integration tests.** vitest `@/` alias + IO/LLM-mocked tests for morning-check
  (incl. the CR-2 guard), ask (snapshot assembly), generate (Track-B requirement + durability stamp).
- **CR-9 — one signal resolver.** `resolveCoachSignals` removes the snapshot-assembly duplication
  across `/api/ask` + `/api/generate`.
- **CR-10 — honest deload.** Recovery downgrade capped at `min(45, original)`; docs corrected (only the
  easy-day swap preserves load; the rest-day path is a deload).
- **CR-11 — calibration debt catalogued.** ROADMAP #2 now lists the recent population magic-numbers to
  fold in.
- **CR-12 — per-loading-week RaceSim** enforcement (≥2 quality + no RaceSim flags the week).
- **CR-13 — mild-illness nuance** (sickness always downgrades; mild only with strain/objective).
- **CR-14/15/16** — accepted as designed / deferred to §7 / monitor (rotation cadence, calendar
  mutation, ask-coach cost). See todo history.

Tests grew to 281 across 37 files over the pass.

---

## Re-review hardening pass (RR-1..12)

A senior-dev re-review of `63a9263` (the CR-9..16 batch) caught 12 items; all resolved over 6 atomic commits. Tests grew from 281 → 289.

- **RR-1 — honest deload on the proactive path.** `suggestProactiveReschedule` is now easy-only (`findMakeUpSlot(..., ["easy"])`). A rest day is never raided when the athlete is compromised; with no easy slot, today deloads to a capped Recovery spin and the quality carries forward (CR-6). `toWasRest` removed from the interface, route response, and `MorningCheckIn`. "Only the easy-day swap preserves load" is now true by construction.
- **RR-2 — missing reschedule tests added.** Cases for `min(45, original)` Recovery cap, swap-skips-rest-day, and honest-deload-instead-of-raiding-rest.
- **RR-3 — loading-week detection is theme-aware.** `isLoadingWeek` = ≥2 quality AND `weekTheme` not recovery/deload/unload/taper. A recovery week that keeps 2 quality sessions is no longer flagged as needing a RaceSim.
- **RR-4 — negation is clause-scoped.** Replaced the 15-char back-scan in `tagPresent` with `clauseStart()`, which walks back only to the nearest clause break (punctuation, dashes, `but`/`however`/`yet`). A negation now flips a tag only within its own clause — `"no gym, hilly race"` correctly requires a RaceSim.
- **RR-5 — band resolution lives once.** `resolveCoachSignals` now takes the raw `acwrBands` override and calls `resolveAcwrBands` internally; both routes drop the duplicated call + calibration import.
- **RR-6 — `CoachSnapshotInput extends CoachSignals`.** The six form/fuel/state signal fields are inherited; the compiler now enforces what was a comment-only contract.
- **RR-7 — named ACWR band type.** Opaque `Parameters<typeof computeAcwr>[1]` replaced with `Partial<AcwrBands> | null`.
- **RR-8 — consolidated validator warnings.** One GOAL warning names all offending loading weeks (`"weeks 1, 3 …"`) instead of one per week. Bounded fan-out.
- **RR-9 — validator branch coverage.** Tests for multi-week consolidation, recovery-week exclusion, and the `!anyRaceSim && !flaggedAWeek` block-floor fallback.
- **RR-10 — `proceed-easy` intensity cap (neck-check rule).** Mild illness on fresh legs now produces a third decision state. `applyEasyCap` converts today's quality session to a same-duration Z2 ride (structured intervals dropped) in place — no relocation or deferral. `MorningCheckDecision` type, route, and `MorningCheckIn` all handle the new state.
- **RR-11 — `strainScore` input clamping.** Route is the real validation boundary (400 on non-1–5 ratings); `strainScore` also clamps each input so its 4–20 range holds for any direct caller.
- **RR-12 — week-sort cleanup.** `validateSessionRequirements` sorts the small offending-week array rather than the Map entries; no week-numbering assumptions.

- **RR-1 follow-up — explain the skipped rest day.** When the proactive path deloads because the only free slot is a rest day, `suggestProactiveReschedule` now returns `skippedRestDay` (the clear rest day it deliberately didn't raid). The morning-check preview and the apply note name it ("there's a rest day on X, but moving a hard session there would add load while you're compromised…") instead of implying nothing was available.

---

## Coaching depth — CoachSnapshot, proactive reschedule, session variety

A run of ROADMAP "Next up" + Track B items. Remaining slivers for each stay in [ROADMAP.md](ROADMAP.md).

### CoachSnapshot — resolved-numbers lens (ROADMAP #1)
- `lib/coach-snapshot.ts`: one deterministic snapshot (today execution · form + TSB-as-actionable-
  modifier · fuel · fused state · directives · disposition · morning check) read by Ask-Coach
  (`/api/ask`, fully wired) and generation (`/api/generate`, compact form+fuel line) so the LLM is
  handed resolved numbers instead of inventing them. `buildCoachSnapshot` + `formatCoachSnapshot` +
  `formatFormFuelLine` + `resolveTsbModifier`; the compromised-disposition guard rides in the snapshot.
- **Surfaced on Today (the remaining sliver).** `buildCoachSnapshotFromSources` is now the one shared
  assembler (model → signals → directives → snapshot) the sync GET and `/api/ask` both call, so the
  Today card shows the *identical* snapshot the LLM reads — `/api/ask`'s parallel assembly was removed.
  `coachSnapshot` rides on `AppState` (GET takes `?today=` for the client-local date; POST rebuilds it
  on fresh data so the card updates after a sync), and `components/CoachSnapshotCard.tsx` renders the
  resolved form (TSB-as-actionable-modifier) + fuel in the Today readiness zone, hiding when empty.

### Proactive reschedule — "not feeling it?" morning check-in (ROADMAP #3)
- `lib/morning-check.ts` + `app/api/morning-check` + `components/MorningCheckIn.tsx`: a pre-session
  check (fatigue/sleep/soreness/motivation + illness) → deterministic proceed/downgrade
  (`decideMorningCheck`: subjective strain + objective TSB/readiness/ACWR). Applying it downgrades today
  and moves the quality stimulus to the next rest day (a deload) — else a load-preserving swap with the
  next easy day (`suggestProactiveReschedule` / `applyProactiveReschedule` in `lib/reschedule.ts`). Stored in
  `morning-check.json`; feeds the CoachSnapshot. Also shipped the §3 "wider target slots" sliver.

### Session selection & prescription variety (Track B)
- **Goal-driven selection** — `lib/session-requirements.ts`: terrain/race goal tags → a RaceSim
  requirement injected into the prompt and enforced by `validateSessionRequirements` (warns if the block
  ships none); RaceSim already counts toward the quality budget + spacing.
- **Durability taxonomy** — KB §12 + `lib/durability.ts`: 5 rotating templates (A–E),
  `selectDurabilityTemplate` limiter-driven (Threshold→B, VO2max→C, SIT→D, systemic fatigue→A) else
  rotated; the long ride stays TYPE Z2 with intensity inside the duration. The chosen template is
  stamped on the block (`durabilityTemplate` through generate→write→history) for rotation + scoring.

### Structural debt paydown
- Split `components/Dashboard.tsx` (1453→516 LOC) into `components/dashboard/{shared,today,plan}.tsx`;
  cleared all 11 ESLint problems; deleted the legacy `parsePlan` regex text-parser fallback (structured
  tool-use is now the sole generation path) — `plan-parser.ts` keeps only `planDayToEvent`.

---

## Trends & Today card polish (TR batch)

From a real-use feedback pass on the Trends and Today pages.
- **TR-1 — Weekly-volume card compacted.** The Trends "Weekly volume" card is now half-width
  (paired in a `lg:grid-cols-2`, right column intentionally empty) to match the "Execution quality"
  card instead of spreading full-width. `components/Trends.tsx`
- **TR-2 — Weekly-volume colour-by-magnitude.** Bars are shaded across four blues relative to the
  window max (darker = bigger week), so volume reads by hue as well as height. `components/Trends.tsx`
- **TR-3 — Card ⓘ hovers.** `Card` gained a reusable `tip` prop rendering a `MetricTip` ⓘ next to
  the title; applied to the Weekly-volume + Execution-quality cards. `MetricTip` promoted from
  `components/dashboard/shared.tsx` to `components/ui.tsx` as a generic primitive. (Slice of ROADMAP
  "Popups where needed".)
- **TR-4 — Today metric strip.** Split the combined "NP / Avg" tile into distinct **NP** and **Avg
  power** tiles, kept **Avg speed**, and gave **IF** context (effort-band sublabel + ⓘ hover
  explaining NP÷FTP). Verified the tiles are correctly wired from sync (`app/api/sync/route.ts`) —
  a missing value means absent Intervals data, not a bug. `components/dashboard/today.tsx`

## Feedback sweep — all items cleared

A full pass over a feedback dump (bugs + UX + features), worked P1 → P3.

### Data integrity & interval detection
- **DI-1 — plan-vs-detection mismatch guard.** `matchPrescription` flags `structuralMismatch`
  (every rep ~half its prescribed length yet power nailed + rep count matched = a plan-definition
  vs detection mismatch, not a bail). Scoring drops the untrustworthy duration penalty; the coach
  note + Today card explain it. `lib/interval-match.ts`
- **DI-2 — interval power mis-read.** Adherence now reads `avgWatts` (what was actually held), not
  NP (which overstates short/variable efforts by 20%+). NP is kept only to filter warm-up/recovery
  laps out of the work band. `lib/interval-match.ts`
- **DI-3 — mid-ride added intervals.** Executed work efforts beyond the prescribed count are
  captured as `extras` and shown as dashed "+extra" chips instead of being silently dropped.
- **DI-4 / PW-10 — power-PR recognition.** New PRs surfaced to the coach note (called out first)
  and as a 🏆 trophy banner on Today with the gain over the prior best. `lib/pr.ts`

### Workout protocol & vocabulary
- **PW-2 — SIT consistency.** SIT progress marker moved from 1-min to 30-sec power to match the
  30s all-out protocol; all surfaces (KB, validator, prompt, Ask-Coach, marker) now agree.
- **PW-7 / PW-8 — KB-grounded protocols.** `lib/workout-validate.ts` flags generated workouts that
  violate KB interval protocols (SIT 4–6×20–30s @ 130–200%, VO2max 3–8min @ 106–120%, threshold
  88–105%); the same rules are stated in the generation prompt — guard on both ends.
- **PW-1 — standing-sprint technique.** KB distinguishes seated SIT (aerobic, consistent power)
  from standing sprints (neuromuscular/race skill) + technique cues; generation coaches standing
  only on dedicated sprint/RaceSim work.
- **PW-3 — RaceSim as a real workout type.** Added `RaceSim` to `WorkoutType` (+ styles, nutrition
  factor, execution band, reschedule quality list, generation TYPE list, KB protocol): variable
  race-moves, peaking/event-window use, scored on intensity not rep-match.
- **PW-9 — terrain-flexible sessions.** KB + generation rule to prescribe structured-but-flexible
  outdoor quality (target efforts as ranges + a placement rule + strict-Z2/HR-cap floor), scored
  on intrinsic quality. Keep one fixed ERG benchmark per week.
- **PW-4 / PW-5 — execution cues in descriptions.** Optional `Execution:` line in the DESCRIPTION
  format + KB-grounded cues (HR-ceiling on hilly Z2, sit-down sprints, descents as cornering
  practice). `lib/anthropic-api.ts`

### Coaching context
- **PW-6 — Ask-Coach sees the next session.** The coach now gets the nearest upcoming session's
  exact prescription ("do not invent durations") — kills the "4-min for a 30s SIT day"
  hallucination. `app/api/ask/route.ts`, `lib/anthropic-api.ts`
- **#9 — all-time power PRs.** `fetchPowerCurveAllTime()` pulls Intervals.icu's `curves=all` into
  `SyncData.powerCurveAllTime`; the Profile shows all-time bests and PR detection uses the all-time
  curve as a monotonic baseline (no window false-drops, true all-time deltas), with an 84-day
  fallback. `lib/intervals-api.ts`, `lib/pr.ts`
- **NUT-6 — nutrition formula audit (pass).** Verified: weight is live-synced, the buffer is
  weight-trend-adaptive + clamped (0–600) and skipped on rest days, carbs scale by mass (glycogen)
  while protein is flat (MPS saturates). Sound; the real enhancement (energy-availability signal)
  is ROADMAP §6.

### Today / Plan / Trends UX
- **TODAY-1 — ride-card de-dup.** Merged NP + Avg into one tile and dropped TSS (identical to
  Intervals' "Load"); 6 → 4 metric tiles.
- **TODAY-6 / TODAY-8 — ACWR & TSB tooltips.** What they are, calc basis, good/concerning bands.
- **TODAY-7 — session-state fix.** The calendar showed *compromised* rides as "Missed" (they're
  excluded from `scores`). Threaded `compromisedDates`/`partialDates` through sync → state →
  calendar; compromised now reads "Compromised — ridden, excluded from scoring", partial reads
  "Partial". `missed` confirmed correctly auto-derived.
- **TODAY-2 / TODAY-3 / TODAY-5** — power-zone bar labels → hover tooltip; Trend-Pulse per-week
  hover + "this wk" label; ride-card energy unit kJ → kcal.
- **PLAN-3** — audited; "This week" Hours/TSS aren't duplicated on the Plan page itself, left as-is.
- **TRENDS-1** — Pw:HR excludes indoor rides (distorted power:HR); ≥45-min + endurance-band +
  Intervals' efficiency-factor method. `lib/trends.ts`
- **TRENDS-2** — fueling/weight graph shows complete weeks only (drops the partial current week).
- **TRENDS-3** — replaced trivial 7-day avg RPE with an actionable 7-day training-load total.
- **UI-5 — ride-card power trace.** 30s rolling-mean smoothing tames the jumpy line; short
  work-interval bands get a minimum width + stronger fill so 30s reps are visible; band-alignment
  fixed (bands sit exactly under the line). `lib/trace.ts`, `components/RideTrace.tsx`

---

## Platform & performance (P-series)

The local-first cost / robustness / observability hardening, in order. Forward items live under
ROADMAP "Platform & performance"; P4 is partially done (1 of 4 items shipped).

- **P1 — Prompt caching + singleton Anthropic client.** One lazily-constructed `Anthropic`
  client reused across all calls (was `new Anthropic()` per call ×4) for connection pooling.
  Generation's system prompt is split into a cached prefix (persona + workout-syntax guide +
  reference KB, marked `cache_control: ephemeral`) and a dynamic tail (carry-forward seeds +
  directives + athlete data + block params), so a repeat generation within the cache TTL re-reads
  the bulk at ~0.1× input cost. A test locks the invariant that per-block dynamic content never
  leaks into the cached prefix (which would defeat the cache). `lib/anthropic-api.ts`,
  `app/api/generate/route.ts`.
- **P2 — Structured generation via tool-use.** Generation no longer regex-parses Claude's
  markdown — it forces a `submit_training_block` tool whose `input_schema` is derived (via
  `z.toJSONSchema`) from one shared zod schema (`lib/plan-schema.ts`), which also validates the
  response. The route maps the typed output → `PlannedDay[]` and falls back to the regex parser
  (`plan-parser.ts`, retained) only if the tool payload is absent/malformed. `workout-validate`
  stays as the coaching-validity guard (tool-use is only *schema*-valid). Added `zod` v4. New
  schema/mapping tests. `lib/plan-schema.ts`, `lib/anthropic-api.ts`, `app/api/generate/route.ts`.
- **P3 — Decoupled sync + surfaced warnings.** `/api/sync` now returns fast with the
  deterministic analysis (metrics, zones, intervals, PRs, execution score) and defers only the slow
  LLM coach note to a follow-up `/api/analyze` (extracted `lib/sync-analysis.ts addCoachNote`,
  idempotent — preserves a note across re-syncs, auto-posts once). PR detection stays in the fast
  path (it needs the pre-sync curve). Non-fatal step failures (intervention validation, ride
  analysis, coach note) now collect into a `warnings[]` array surfaced in the nav rail instead of
  being swallowed by best-effort catches; the Today card shows "Analysing today's ride…" while the
  note lands. `app/api/sync/route.ts`, `app/api/analyze/route.ts`, `lib/sync-analysis.ts`,
  `components/SyncProvider.tsx`, `components/Nav.tsx`, `components/Dashboard.tsx`.
- **P4 (item 4 of 4 — section COMPLETE) — Generation dedupe.** Decision: a **short dedupe-only
  window**, not a long reuse cache (generation runs at temperature 0.3, so a considered regenerate is
  partly *for* the variation). `lib/generate-cache.ts dedupeGeneration(key, compute)` keys on a sha256
  of the three assembled prompt parts and runs `compute` at most once per key while it's in flight +
  ~60 s after it completes — so a double-click or a second request landing mid-generation shares the
  one Claude call, a failure evicts immediately so retries re-run, and a deliberate regenerate
  outside the window re-calls. In-memory + single-process (same assumption as the singleton client; a
  restart just forgets the window). Wired into `app/api/generate/route.ts`. 6 new tests
  (in-flight dedupe, per-key, failure-evict, fake-timer window expiry). `lib/generate-cache.ts`.
- **P4 (item 3 of 4) — Stream `/api/ask`.** `streamAskCoach` (async generator) yields Anthropic text
  deltas as they arrive and records usage from the final message; `/api/ask` wraps it in a plain-text
  `ReadableStream` (validation still returns JSON errors *before* the 200 stream; a mid-stream failure
  surfaces as the stream erroring); `AskCoach` reads `res.body` incrementally and renders the reply as
  it streams ("thinking…" only until the first token). `lib/anthropic-api.ts`, `app/api/ask/route.ts`,
  `components/AskCoach.tsx`. Type-checked + build-verified; live token path needs a real Anthropic key
  to exercise. _P4 now has only generation caching left — blocked on the regenerate-vs-cache product
  question (ROADMAP)._
- **P4 (item 2 of 4) — Coach-accuracy % on the dashboard.** `overallCoachAccuracy(log)` rolls the
  intervention validation loop into one headline hit-rate (validated / decisive across all
  dimensions; null until the 28-day horizon produces a decisive outcome). Computed in the `/api/sync`
  GET handler, carried on `AppState.coachAccuracy`, surfaced as a compact line in the Today
  Trend-pulse zone — hidden entirely until there's a decisive % *or* pending interventions, so it
  never shows an empty tile on a fresh install. `lib/intervention.ts`, `app/api/sync/route.ts`,
  `components/SyncProvider.tsx`, `components/Dashboard.tsx`. 2 new tests.
- **P4 (item 1 of 4) — Token/cost tracker.** `lib/ai-usage.ts` folds every Anthropic call's
  `usage` into `data/ai-usage.json` (best-effort, fire-and-forget — never blocks the request; a
  serialized read-modify-write chain prevents lost increments under concurrency). Cost is estimated
  from a per-model price table (sonnet-4-6 $3/$15, haiku-4-5 $1/$5 per 1M) with the cache-write
  premium (1.25×) and cache-read discount (0.1×) applied to the input rate. `recordUsage` wired into
  all four call sites (generate, ride analysis, retrospective, ask-coach); `AiUsageCard` shows total
  + per-model spend on the (now dynamic) Settings page. Pure `estimateCostUsd` unit-tested.
  `lib/ai-usage.ts`, `lib/anthropic-api.ts`, `components/AiUsageCard.tsx`, `app/settings/page.tsx`.
  (P4 is now complete — items 2/3/4 above.)
- **P5 — Deterministic schedule validator.** Generation was *instructed* to space quality
  sessions ("avoid back-to-back hard days") and cap them at the weekly budget, but nothing enforced
  placement — `workout-validate.ts` checks each session's protocol bands in isolation. New
  `lib/schedule-validate.ts validateSchedule(days, settings)` does a post-generation pass over the
  block's day sequence and flags (a) two hard/quality days on consecutive calendar dates (by date
  adjacency, so it spans the week boundary and never false-pairs across a gap) and (b) any week over
  the `qualitySessionsPerLoadingWeek` budget. Quality set = Threshold/VO2max/SIT/**RaceSim** (RaceSim
  counts toward the budget + spacing). Folded into the generate route's `warnings[]` next to the
  protocol checks — warns only, never reorders. 11 new tests. `lib/schedule-validate.ts`,
  `app/api/generate/route.ts`.
- **P6 — Reliability & resilience quick-wins.** Five independent hardening wins:
  - **Error boundaries** — `app/error.tsx` (route-segment fallback; the nav rail above it stays
    mounted) + `app/global-error.tsx` (root-shell fallback). Use Next 16's `unstable_retry` prop
    (not `reset` — verified against `node_modules/next/dist/docs`).
  - **Provenance stamping** — `PROMPT_VERSION` constant + `model`/`promptVersion` (optional) on
    `GeneratedPlan`, `TodayAnalysis`, `BlockHistoryEntry`, `CurrentBlock`, stamped at generation /
    coach-note time and carried through block archive → history; makes past AI outputs auditable
    when the model or prompt later changes. `lib/anthropic-api.ts`, `lib/types.ts`, generate/write/
    retrospective routes, `lib/sync-analysis.ts`.
  - **Export / import backup** — `GET /api/export` bundles `data/*.json` + `knowledge-base/**/*.md`
    into one downloadable JSON (no zip dep); `POST /api/import` restores it, guarded (must self-id as
    a NodeVelo backup, path-traversal-confined, data files go through `writeJsonFile` so critical
    stores keep their pre-import `.bak`). Settings "Backup & restore" card. `components/BackupRestore.tsx`.
  - **json-store per-file write mutex** — concurrent writes to the same store chain one-at-a-time
    (last-write-wins) so a sync + disposition POST can't clobber the shared temp file; different
    files stay parallel. Data dir made env-overridable (`NODEVELO_DATA_DIR`) for test isolation.
    `lib/json-store.ts` + new mutex/round-trip tests.
  - **Manual re-analyse** — `addCoachNote(today, warnings, force)` regenerates today's coach note on
    demand (force bypasses the idempotency guard); `/api/analyze` reads `force`; `SyncProvider`
    exposes `reAnalyse`; the Today coach-note card shows a re-analyse / "generate note" button so an
    Anthropic hiccup is recoverable without a full re-sync. The sync route already preserves a good
    note + its stamp across a re-sync (never overwrites with empty).

- **P7 — TanStack Query data layer.** Replaced the hand-rolled cache (`SyncProvider`'s
  fetch-on-mount `useEffect` + a separate `useEffect` fetch in Trends) with `@tanstack/react-query`
  v5. New `QueryProvider` (one `QueryClient`, `staleTime` 30 s, `refetchOnWindowFocus` +
  `refetchOnReconnect` + retry) wraps the app above `SyncProvider`. The `['sync']` GET is now a
  `useQuery`; Trends uses `useQuery(['trends', syncedAt])` (re-fetches when a sync completes, plus
  focus/reconnect/dedup/retry). Crucially the **`useSync()` context API is unchanged** — `state`
  comes from the query, and `setState` writes through to the query cache via `setQueryData`, so
  every existing `setState(...)` call in `doSync`/`runAnalysis`/`RescheduleBanner` keeps working and
  Nav/Dashboard/RescheduleBanner needed no changes. `doSync` (the POST that hits Intervals.icu) and
  the deferred `/api/analyze` step stay explicit actions that write results back into the cache.
  Fixes the "stale after an overnight tab" UX. Verified: tsc/build/lint clean, 211 tests, dev server
  boots and Today/Trends render with the new provider wiring. `components/QueryProvider.tsx`,
  `components/SyncProvider.tsx`, `components/Trends.tsx`, `app/layout.tsx`, `package.json`
  (`@tanstack/react-query`). _Deferred:_ `doSync`→`useMutation` + optimistic updates (not needed for
  the win).

## Signal fusion — Athlete State v1 (ROADMAP §5)

- **`computeAthleteState` (the fused glance).** `lib/athlete-state.ts` collapses the parallel signals
  the brain otherwise surfaces (and lets contradict) — TSB, ACWR, execution-trend (EWMA), decoupling
  vs the 90d baseline, RPE recent-vs-baseline, off-plan behaviour — into one **0–100 score** + band
  (`primed/ready/steady/strained/depleted`) + recommendation + `drivers[]` + confidence. Built as a
  **list of signal evaluators** (add energy-availability later = one evaluator); score = base + Σ
  effects, clamped, then a **lived-signal override** (≥2 of execution-down / decoupling-up / RPE-up
  cap the score even when TSB looks fresh — corroborated fatigue beats a fresh load model). All
  weights/thresholds are named constants in one block (foundations — built to be tuned). Deterministic;
  the AI only phrases the headline. 8 directional tests (not pinned to exact numbers). Design spec:
  `docs/specs/athlete-state.md`.
- **Surfaced + consumed (all three).** `AthleteStateCard` on Today — the 0–100 score is the glance,
  band + drivers reveal on hover (above the individual signals, not replacing them). Computed in the
  `/api/sync` GET **and** POST (so it refreshes after a sync), carried on `AppState.athleteState`.
  Folded into **generation** (a fused-state directive line) and **Ask-Coach** (context), both via the
  pure `athleteStateInputsFrom` adapter. `lib/athlete-state.ts`, `app/api/sync/route.ts`,
  `app/api/generate/route.ts`, `app/api/ask/route.ts`, `lib/anthropic-api.ts`,
  `components/AthleteStateCard.tsx`, `components/SyncProvider.tsx`, `components/Dashboard.tsx`,
  `lib/types.ts`. (v1 foundations; tuning + energy-availability + per-athlete weights remain — ROADMAP §5.)

## Metric-consistency + Today/Trends UX (feedback batch)

A batch of real-use feedback, routed through todo.md (MR/UX/RC) and cleared:
- **MR-1 — IF basis consistency.** The coach-note prompt (`analyseRide`) computed IF from *avg*
  watts while the Today card + `score-log` use NP (`normalizedPower ?? avgWatts`). Made the note
  NP-based too (and ftp>0-guarded), so the note's IF can't disagree with the card; fixed the stale
  `// avg watts / FTP` comment on `TodayAnalysis.intensityFactor`. (NP was already synced from
  `icu_normalized_power`.) `lib/anthropic-api.ts`, `lib/types.ts`.
- **MR-2 — Weekly-hours window.** Recent-Baselines "Weekly hours" was an all-logged-window mean
  while its sibling tiles are 90-day rolling. Added `avgWeeklyHours90d` to `RollingBaselines`
  (computed in `computeRollingBaselines` as total hours ÷ 90/7 over the same 90d window); the card
  now reads it, so all four tiles share one horizon. Populates on the next sync. `lib/readiness.ts`,
  `lib/types.ts`, `lib/data-store.ts`, `components/Trends.tsx`.
- **RC-1 — Avg speed on the Today ride card.** Threaded `activityDistanceMeters` onto `TodayAnalysis`
  (sync route) and added an "Avg speed" tile (distance ÷ moving time). Populates on the next sync.
  `lib/types.ts`, `app/api/sync/route.ts`, `components/Dashboard.tsx`.
- **UX-1 — Power bar horizontal overflow.** `ZoneBars` segments had `shrink-0` + `gap-px`, so widths
  summed past 100% and the bar overflowed on narrow cards. Switched to `min-w-0` (let flex absorb the
  gap). `components/Dashboard.tsx`.
- **UX-2 — Trend-pulse "Weekly volume" tile dead-end.** The tile pushed to /trends, which had no
  weekly-volume view. Added a "Weekly volume" card (`WeeklyVolumeBars` over the existing
  `data.weeklyHours`) so the click lands somewhere. `components/Trends.tsx`.
- **UX-3 — Execution-quality card compression + hover.** `ScoreBars` (capped at 24) used
  `min-w-[4px]` + `gap-[3px]` (~165px min → overflowed narrow cards); reduced to `min-w-[2px]` +
  `gap-px` (~71px) and added a `hover:opacity` affordance on top of the existing per-bar title.
  `components/Trends.tsx`.

## Foundations & earlier milestones

- **Timezone-correct "today" (code-audit fix).** The server matched today's ride on a UTC date
  while activities carry their *local* date, so an evening ride could be missed entirely (no
  analysis/PR). `lib/date.ts` now makes the client's local date the single source of "today"
  (client sends it; server prefers it, UTC fallback). No date-fns dep.
- **Disposition flag + learning gate.** Athlete marks Completed / Partial / Compromised(reason);
  compromised rides stay as history but are excluded from the execution EWMA + metric and surfaced
  to Ask-Coach, so a fluke can't be misread as under-recovery. `data/dispositions.json`
- **Auto-reschedule engine.** `lib/reschedule.ts` + `/api/reschedule` + RescheduleBanner detects a
  not-delivered quality session and suggests/applies a make-up on the next clear rest day in the
  local block (no back-to-back hard days), athlete-confirmed.
- **UI refinements (audit images 1–5).** Readiness card trimmed to TSB/ACWR/Polarization; Trend
  Pulse reworked to CTL + weekly-volume + time-in-zone bars; Trends compacted to a 2-col pair;
  Profile modernized to match the other pages.
- **Calibration v1.** Auto-tuned EWMA α + ACWR bands with a manual override (`lib/calibration.ts`).
- **Synthesis.** One ranked coaching-directive block fed to generation; dropped redundant
  `compliance-memory`.
- **Closed learning loop.** All rides scored into the immutable ledger; interventions snapshotted
  at block-write and later validated/refuted.
- **Atomic writes + ledger backup/recovery** (`lib/json-store.ts`).
- **Compliance unified** into the execution/completion index; duration-aware interval scoring;
  time-in-zone polarization; physiology single-source-of-truth; Ask-Coach (block + form context).
