# NodeVelo — live punch-list

Short-lived tracker for **incoming bugs and feedback** — things to action soon, not strategy.
Keep it lean: when an item ships, move its one-line record to [ARCHIVE.md](ARCHIVE.md).

- **What's next / strategy** → [ROADMAP.md](ROADMAP.md)
- **Completed work** → [ARCHIVE.md](ARCHIVE.md)
- **Research spikes** → [research.md](research.md)

**Legend** — Status: ☐ todo · ◑ partial · ☑ done · Priority: P1 correctness/data-integrity ·
P2 high-value UX/feature · P3 polish/education · Type: `bug` `ux` `feat` `audit` `edu`

---

## Open

**HR-2026-07-17 — hostile review of the block-generation-fidelity commits (`40e852c..f9db457`),
requested after the athlete reported the shipped fixes didn't actually resolve their symptoms.**
15 findings from an xhigh multi-agent review (10 independent finder angles — 4 hit a session-limit
mid-run and were retried after reset, all 10 completed — 32 raw candidates deduped). Continues the
HR- series (append, not renumber).

**5 of 7 P1s fixed same-session, each TDD'd and live-verified against the real athlete data**
(commits `fc0b78a..a31e3e9`): HR-21 (frontend season-disable propagation — a new regression from
this session's own Task 6), HR-16 (compound multi-effort line parsing), HR-18 (widened goalText),
HR-19 (reconcile `durationMin` to the real step-sum instead of only warning), HR-17 (confirmed root
cause of "only template A" — an environmentally-explained Overall-alert no longer forces the safe
template). A combined live `/api/generate` re-run after all 5 landed confirmed
`durabilityTemplate: B` (was `A`) and `protocolViolations: null` on the same real fixture.

**All 7 P1s resolved** (commits `fc0b78a..3622f04`) — HR-20 and HR-22 were deliberately left open
pending the user's own design call (asked via `AskUserQuestion` since both had genuine tradeoffs,
not a single obviously-correct fix), then implemented per their explicit choices: HR-20 as
prompt-only reinforcement (not deterministic auto-repair — `lib/schedule-validate.ts`'s own contract
is "never reorders the coach's plan," and which day is hard/easy is prescriptive content, not a
checksum-able stat); HR-22 fixed now (not deferred) by mirroring the existing `weeksSinceSeasonBreak`
pattern.

**All 8 P2/P3s also resolved** (commits `e69d3ff..9679f38`), **with one reclassified after
re-verification caught the finding's own premise was wrong before any edit landed**: HR-23 claimed
`SEASON_CONSTANTS`'s deload-cadence comments were stale — a direct diagnostic proved the opposite
(the comments correctly describe the fixed cadence; Task 1 made the *code* match the
already-correct comments, not the reverse) — marked Won't-fix, no edit made. HR-25 similarly had its
*suggested* fix (reuse `lib/season.ts`'s `goalRelevanceForFocus` wholesale) checked before
implementing — it would have broken VO2max goal-text detection, since season's own vocabulary has
no VO2max keyword at all — fixed narrower instead (reuse just the negation-aware `tagPresent`
primitive, keep durability's own correct keyword table). The rest: HR-24+HR-29 (duration-warning
wording + test-fixture dedup, one commit), HR-26 (test coverage for the `SEASON_SHAPES_GENERATION=
true` branch — a separate file, since `vi.mock` is file-scoped), HR-27 (a narrow `"Warmup 2x"`
double-count edge case), HR-28 (pure code relocation, no logic change), HR-30 (extracted a shared
`toleranceBand` helper into `lib/stats.ts`). 1190/1190 tests throughout, tsc/eslint clean at every
step.

### P1 — correctness / data-integrity (2026-07-17 round)

- ☑ P1 `bug` **HR-16** — **Fixed (commit 0046827).** Compound multi-effort workout lines (e.g.
  `"Move 3: Seated climb 2m30s 108%, then standing attack 25s 140%"`) silently dropped the second
  effort: `parseStep` used a non-global regex match, so only the FIRST duration+%FTP pair per line
  was ever captured. Confirmed against the athlete's real, already-written RaceSim day
  (`data/current-block.json`, 2026-07-30): the persisted `prescription` array was missing 3 real
  "standing attack" reps entirely, and `totalPrescribedMinutes` undercounted that session's real
  duration by ~75s. `parseStep` now global-matches every clause on a line, each measured from where
  the previous clause ended; `walkWorkoutSteps` iterates the returned array. Recomputed the real
  day: total duration 59min → 60.25min, prescription length 5 → 8.
- ☑ P1 `bug` **HR-17** — **Fixed (commit a31e3e9), confirmed root cause of "only template A."**
  `selectDurabilityTemplate`'s `LIMITER_TEMPLATE` mapped a systemic `Overall`/`alert` insight
  straight to the safest template (A) as a hard override, ahead of goalText, with no way to tell
  genuine systemic fatigue apart from an environmental cause `deriveInsights` already diagnoses
  separately (a co-occurring `"{type} splits indoor vs outdoor"` insight — hot outdoor rides
  depressing execution, not systemic fatigue). Rather than the full scored-candidate redesign
  originally considered (this codebase's `scoreFocusCandidates` pattern), shipped a narrower,
  safety-preserving fix: `overallDeclineIsExplained` skips the `Overall`→A rule only when that
  co-occurring insight is present, falling through to goalText/rotation; a genuinely unexplained
  Overall decline, and Threshold/VO2max/SIT limiters, still force their template unconditionally.
  Live-verified against the real athlete-model data: now correctly picks template B (matching the
  stated FTP/TTE goal) instead of A.
- ☑ P1 `bug` **HR-18** — **Fixed (commit dada480).** The `goalText` built for
  `selectDurabilityTemplate` at its route call site omitted `blockParams.weakpoints`,
  `profile.goals`, and `profile.weakpoints` — all of which the richer, near-identical
  `focusSignals.goalText` construction 35 lines later in the same function included. Hoisted one
  `combinedGoalText` local (the richer construction) before both use sites; the season-replan's
  `focusSignals.goalText` now reuses it instead of duplicating the join. New regression test
  RED-confirmed pre-fix (a profile-only "5-second power" weakpoint now correctly routes to
  template D).
- ☑ P1 `bug` **HR-19** — **Fixed (commit d9c5d92).** The duration-consistency check
  (`validateDurationConsistency`, Task 2) was warn-only — it flagged a mismatch but nothing derived
  `durationMin` from the real step-sum. Added `reconcileDurationMin` (`lib/prescription.ts`):
  treats `durationMin` as a derived statistic of the workout text (not part of the coach's
  prescriptive intent, which it never touches) and overwrites it with the real
  `totalPrescribedMinutes` total, exempting Rest (no steps) and Strength (gets an explicit
  `moving_time` from `durationMin` directly). Wired into `/api/generate` right after
  `structuredToPlannedDays`, before any validator runs — the 3 UI surfaces that sum `durationMin`
  now sum the reconciled, honest number, and `validateDurationConsistency` stays in place as a
  defensive check rather than being removed.
- ☑ P1 `bug` **HR-20** — **Fixed (commit 4505243, prompt-only reinforcement — user's explicit
  choice over deterministic auto-repair, given `lib/schedule-validate.ts`'s own stated "never
  reorders the coach's plan" contract).** `validateSchedule` only ever warned about back-to-back hard days and
  over-budget weeks; nothing enforced it. Tightened `lib/anthropic-prompts.ts`'s WEEKLY STRUCTURE
  rule: made the quality-session count an explicit CEILING that includes RaceSim (previously
  omitted from that line's count list, despite counting toward the budget in
  `schedule-validate.ts` — a likely real contributor to the reported overruns), and elevated
  "avoid back-to-back hard days" from a weak parenthetical to an explicit, bolded rule with a
  concrete self-check instruction. **Known, accepted residual gap** (same tradeoff as HR-19's
  detection-only cases): live-verified post-fix — the model still produced one schedule violation
  on the re-run (a back-to-back hard day, a 3-quality week) — this is a probabilistic improvement,
  not a guarantee; detection stays in place as the safety net either way.
- ☑ P1 `bug` **HR-21** — **Fixed (commit fc0b78a).** New regression, introduced by this session's own
  Task 6. The season-disable flag (`SEASON_SHAPES_GENERATION=false`) only gated
  `app/api/generate/route.ts` — it never reached the frontend. `components/dashboard/PlanView.tsx`
  independently called `formatSeasonContext()` and rendered phase/deload text as if it would drive
  the next generation, and narrowed the goal pre-fill to that phase; `components/SeasonRoadmap.tsx`'s
  onboarding stepper still claimed "Each block auto-targets the current phase & your goals." Fixed by
  importing the same flag into both components: `PlanView.tsx`'s `loadSeasonCtx` now treats
  "period exists but flag is off" like "no current period" (readout/focus pill hidden, all goals
  shown, not filtered); `SeasonRoadmap.tsx`'s step 3 now says "phase-targeting is temporarily paused"
  when the flag is off.
- ☑ P1 `bug` **HR-22** — **Fixed (commit 3622f04), user's explicit choice to fix now rather than
  defer** (mirrors an existing pattern closely, low architectural risk, and is currently dormant
  while `SEASON_SHAPES_GENERATION=false` — cheaper to do while fresh in context than re-derive
  later). `applyDeloadCadence`'s Task-1 fix ("a genuine rolling calendar-week count ACROSS period
  boundaries") didn't actually persist across `/api/generate` calls: `replanSeasonArc` preserves
  the in-progress "current" period verbatim and only redrafts the future tail via
  `draftSeasonArc`, which called `applyDeloadCadence` fresh on just that tail — `weeksSinceDeload`
  always restarted at 0, discarding whatever the kept periods had already accumulated. New
  `weeksSinceLastDeload(periods, asOf)` mirrors `weeksSinceSeasonBreak`'s exact pattern (find the
  most recent reset — a `deloadWeek:true` period or a `transition` — measure calendar weeks
  forward); `applyDeloadCadence` gains an optional `seedWeeks` parameter (default 0, every
  pre-existing caller unaffected); `replanSeasonArc` threads the real value through. Live-verified
  post-fix: season-plan.json's redrafted tail is unchanged from before for the athlete's *current*
  real data specifically (the in-progress period happens to already be a deload-reset point ending
  exactly at the redraft boundary, so the seed coincidentally computes to 0 either way) — the fix
  itself is proven correct via 2 new integration tests with a synthetic non-coincidental scenario
  (RED-confirmed pre-fix), not by this particular live dataset happening to show a visible diff.

### P2 — high-value correctness (2026-07-17 round)

- ☑ P2 `bug` **HR-23** — **Won't-fix (finding's premise was wrong, caught on re-verification before
  editing).** Claimed `SEASON_CONSTANTS.deloadEveryWeeks`/`deloadTightEveryWeeks`'s inline comments
  (`// 3:1 — a deload week after 3 loading weeks`, `// 2:1 under heavy fatigue`) describe the
  PRE-Task-1 buggy ratio. Traced the real cadence with a direct diagnostic before touching
  anything: `applyDeloadCadence` over eight 1-week periods (loose, `every=4`) produces
  `[false,false,false,true, false,false,false,true]` — 3 loading weeks then 1 lighter trailing
  week, repeating: a genuine 3:1 ratio, exactly as commented. Tight (`every=3`) over six 1-week
  periods produces `[false,false,true, false,false,true]` — 2:1, also exactly as commented. The
  boundary firing at cumulative weeks `>= every` means the FLAGGED period's own trailing week
  is the Nth week of the cycle, not an extra week beyond it — `every=4` correctly encodes "3 real
  loading weeks + 1 lighter week," not "4 loading weeks." The comments were correct before Task 1's
  fix too (they described the *intended* cadence the buggy code failed to deliver); Task 1 made the
  code match the comments, not the reverse. No edit made.
- ☑ P2 `bug` **HR-24** — **Fixed (commit e69d3ff).** `validateDurationConsistency`'s warning message
  always read "...the prescribed steps only sum to ~Xmin" even when the real total is LONGER than
  stated (overshoot direction) — self-contradictory ("only" implies shorter). Now picks "only sum
  to" / "actually sum to" by the sign of the gap. (Fixed together with HR-29 — see below.)
- ☑ P2 `bug` **HR-25** — **Fixed (commit 76dbc34), but not as originally suggested — verified the
  suggested reuse would have regressed a real behavior before implementing.** `GOAL_TEMPLATE_PATTERNS`
  used a plain `re.test()` with no negation awareness, unlike `lib/season.ts`'s own goal-text
  matching (`goalRelevanceForFocus` + the negation-aware `tagPresent`). The original finding
  suggested reusing `goalRelevanceForFocus`/`GOAL_PATTERNS` wholesale — checked first with a direct
  diagnostic: `goalRelevanceForFocus("...VO2max...", "vo2max")` returns `0.5` (season's own
  `GOAL_PATTERNS` has no VO2max-specific keyword at all), and a threshold-flavoured goal text
  spills an `0.8` "vo2max" weight via `GOAL_PATTERNS`' own cross-weighting — a full swap would have
  broken the existing "matches VO2max-flavoured goal text to template C" test. Fixed narrower
  instead: durability keeps its own purpose-built keyword table (which correctly covers VO2max),
  but now reuses `tagPresent` (the shared negation-aware matching primitive) directly against a
  lowercased haystack, matching the convention `lib/season.ts` itself follows.
- ☑ P2 `bug` **HR-26** — **Fixed (commit 838a934).** The pre-existing
  `app/api/generate/route.test.ts` season-wiring tests that verified `formatSeasonContext`/validator
  injection actually work were REPLACED by their negations (Task 6) rather than kept alongside a
  `SEASON_SHAPES_GENERATION=true` branch — the flag-on code path in `route.ts` was completely
  untested. New file `app/api/generate/route.season-enabled.test.ts` (a separate file, since
  `vi.mock` is hoisted/file-scoped — overriding the flag in route.test.ts itself would also flip it
  for that file's own flag-off assertions): mocks `SEASON_SHAPES_GENERATION` to `true` via
  `importOriginal`, reuses the same `seasonPlan` fixture + the exact pre-Task-6 assertions. Sanity-
  checked the test itself by flipping the mock back to `false` — both assertions correctly fail,
  confirming they genuinely exercise the flag.

### P3 — polish / edge-case (2026-07-17 round)

- ☑ P3 `bug` **HR-27** — **Fixed (commit 7ca5dba).** A `"Warmup 2x"`-style repeat header
  double-counted that excluded section's minutes in `totalPrescribedMinutes` only (not
  `parsePrescription`, which filters it to empty before the multiplier matters). A repeat count on
  an excluded-section header now always resolves to `blockReps=1` regardless of any "Nx" text on it.
- ☑ P3 `bug` **HR-28** — **Fixed (commit cb782b8), pure relocation, no logic change.**
  `carriesEmbeddedIntensity`'s doc comment was separated from its own function by the entire
  `walkWorkoutSteps` comment+body sitting between them — 3 of 10 review angles independently flagged
  this. `walkWorkoutSteps` now sits directly above `parsePrescription`, its primary caller;
  `carriesEmbeddedIntensity`'s comment now sits directly above its own function.
- ☑ P3 `bug` **HR-29** — **Fixed (commit e69d3ff, together with HR-24).**
  `lib/workout-validate.test.ts` had two divergent `PlannedDay` fixture builders (`day(...)` at the
  top of the file, and a redundant local `planDay(...)`). Widened `day()` to accept an optional
  `durationMin` (default 60, every existing 2-arg call site unaffected) and rewrote all of
  `validateDurationConsistency`'s tests to use it via the same "`day(...)` then override a field"
  pattern the `splitPlanProtocol` tests already established.
- ☑ P3 `bug` **HR-30** — **Fixed (commit 9679f38).** `durationTolerance`
  (`Math.max(statedMin * 0.15, 8)`) duplicated the same "relative-percent-or-absolute-floor,
  whichever is greater" shape already used by `lib/nutrition-validate.ts`'s `validateNutrition`
  (`Math.max(300, expected * 0.18)`). Extracted `toleranceBand(value, relPct, absFloor)` into
  `lib/stats.ts` (the repo's existing canonical home for tiny shared numeric helpers); both call
  sites now share it, no behavior change.

### P1 — correctness / data-integrity

- ☑ P1 `bug` **HR-1** — Today's trend-detector fix (`a3321c7`) only patched `trendOf()` in
  `lib/athlete-model.ts`. Three other files reimplement the identical split-half-mean trend
  algorithm and still lack the tail-turnaround guard: `halvesDir()` in
  [lib/trends-verdict.ts:27](lib/trends-verdict.ts:27), `trendDir()` in
  [components/trends/sections.tsx:12](components/trends/sections.tsx:12), and `trendArrow()` in
  [components/MultiSparkline.tsx:57](components/MultiSparkline.tsx:57). The Trends page verdict
  strip can still show "declining" on an engine/delivery/energy axis whose last two sessions have
  already recovered — the exact bug just fixed one call site over. **Fix once** in a shared helper
  all four call.
- ☑ P1 `bug` **HR-2** — `/api/generate` resolves "today" via raw
  `new Date().toISOString().slice(0, 10)` (UTC) at 4 separate call sites
  ([app/api/generate/route.ts:174,178,179,189](app/api/generate/route.ts:174)) instead of
  `resolveToday()`/`localToday()`. This is the AGENTS.md-documented recurring bug class, reintroduced
  in the same diff that correctly fixed it in `/api/ask` and `/api/sync` — and it breaks the CR-9
  "can't drift" guarantee `resolveCoachSignals` exists to give: a west-of-UTC athlete generating a
  block near local midnight gets a different "today" (and thus a different weekly-energy window and
  season phase) than Ask-Coach/Trends show for the same moment. 7 of 10 review angles independently
  flagged this.
- ☑ P1 `bug` **HR-3** — `reconcileInboundMoves`' conflict map (`dayAt`,
  [lib/calendar-mirror.ts:110](lib/calendar-mirror.ts:110)) is built once from the block's original
  days and never updated as the loop applies moves. Two events dragged onto the same
  originally-vacant date in one sync both pass the "target is Rest" check — the second silently
  overwrites the first instead of surfacing an occupied-day warning, permanently dropping one
  athlete-confirmed move.
- ☑ P1 `bug` **HR-4** — `writeCurrentBlock` ([lib/data-store.ts:90](lib/data-store.ts:90)) is a
  plain `writeJsonFile`, not the lock-protected `updateJsonFile` pattern `score-log.json`/
  `dispositions.json` use for exactly this reason. This diff adds several new concurrent writers of
  `current-block.json` (reschedule PUT/PATCH, morning-check PUT, sync's inbound-reconcile writes);
  two near-simultaneous requests can silently clobber each other's move with no error.
- ☑ P1 `bug` **HR-5** — **Won't-fix (athlete decision, 2026-07-12).** The IF-based over-intensity
  penalty for Z2/Recovery days was deleted ([lib/execution-score.ts:118](lib/execution-score.ts:118))
  and replaced with an HR-based judge that's a no-op when HR data is missing (no strap, sync gap).
  Re-reading the code comments at [lib/execution-score.ts:177-179](lib/execution-score.ts:177) showed
  this was a deliberate, documented tradeoff (not an oversight) when the HR-based judge replaced the
  old terrain-confounded power penalty — outdoor Z2 rides were getting falsely flagged "too hard" from
  hill/wind power spikes. Athlete confirmed: keep "no HR data → no penalty" as accepted behavior rather
  than reintroducing the terrain false-positives an IF-based fallback would bring back.

### P2 — high-value UX / correctness

- ☑ P2 `bug` **HR-6** — `MorningCheckIn`'s post-refresh verdict card
  ([components/MorningCheckIn.tsx:148](components/MorningCheckIn.tsx:148)) previews a reschedule
  suggestion recomputed live by the GET route, not the one frozen when the flag originally fired. If
  the block changes in between (a manual Move, say), the preview and what tapping Apply actually
  executes can silently diverge.
- ☑ P2 `bug` **HR-7** — `lib/trends.ts`'s new weekly-intake aggregation guards on
  `kcalConsumed > 0` ([lib/trends.ts:127](lib/trends.ts:127)) instead of `!== null`, so a
  legitimately-logged 0-kcal day (e.g. a tracked fast) silently drops out of the week's intake total
  and logged-day count — a regression vs. the codebase's own convention of treating 0 as a real
  value for this field.
- ☑ P2 `audit` **HR-8** — **Done (live smoke run, 2026-07-12).** The fuel-line prompt change
  (`9ec687b`, feeding `/api/generate`'s LLM prompt) shipped without the AGENTS.md-required live
  Anthropic smoke run. Ran it against the athlete's real (read-only) current data: the assembled
  line reads `"CURRENT FORM & FUEL (resolved — do not invent): TSB +5.7 (fresh) · ACWR low ·
  readiness Build · weight trend 7d 0.0 kg · fueling adequate."` — a live Claude Haiku call
  correctly interpreted it ("You're fresh and ready to push hard today..."). No formatting or
  comprehension issues found.
- ☑ P2 `ux` **HR-9** — **Won't-fix (finding's premise was wrong).** Rider Profile's systems tiles
  ([components/AthleteProfileForm.tsx:279](components/AthleteProfileForm.tsx:279)) dropped absolute
  watts and W/kg in `de4ebeb` ("de-duplicate Rider-profile watts — Power PRs owns the numbers").
  Verified against source: `analyzePowerProfile` only ever populates 3 system tiles (neuromuscular@5s,
  anaerobic@60s, vo2max@300s — threshold is explicitly excluded), and `POWER_CURVE_LABELS` confirms
  Power PRs' synced grid already shows exactly those durations ("5s"/"1 min"/"5 min") with the same
  watts, W/kg on hover. The de-dup commit's premise holds — the numbers ARE recoverable elsewhere on
  the same page. Minor residual: Power PRs' W/kg is hover-only (`title=`), not always-visible text,
  which is a smaller discoverability gap than "unreachable" — not worth a fix on its own.
- ☑ P2 `bug` **HR-10** — **No fix needed (verified no current defect).** `MorningCheckDecisionResult`
  returns `decision: "rest"` for both a genuine injury stop and a non-quality-day fatigue skip
  ([lib/morning-check.ts:42](lib/morning-check.ts:42)); only `flag` distinguishes them. Traced every
  current caller (`proactiveApplyBlock`, the route, `MorningCheckIn.tsx`) — all already carry `flag`/
  `reasons` alongside `decision` and none destructure `decision` alone; the UI's shared "Rest today"
  heading is itself a deliberate simplification (both cases mean "don't ride"), with the reasons text
  correctly differentiated underneath. Hypothetical-future-caller risk, not a live bug — no speculative
  type-splitting for a caller that doesn't exist.

### P3 — polish / cleanup

- ☑ P3 `bug` **HR-11** — `applyCalendarMirror`
  ([lib/calendar-mirror.ts:179](lib/calendar-mirror.ts:179)) and `/api/sync`'s inbound-reconcile loop
  ([app/api/sync/route.ts:448](app/api/sync/route.ts:448)) both `await` independent per-date
  Intervals.icu calls sequentially instead of running them concurrently — doubles mutation latency on
  any 2-date move (swap, downgrade-with-make-up).
- ☑ P3 `ux` **HR-12** — `components/MoveDay.tsx` and `components/SwapDay.tsx` are near-total
  structural duplicates (same state shape, same busy/error/note handling) differing only in HTTP
  verb and labels — extract a shared component/hook.
- ☑ P3 `bug` **HR-13** — `calendar-mirror.ts`'s `dayToEventPayload`
  ([lib/calendar-mirror.ts:16](lib/calendar-mirror.ts:16)) re-implements the event-payload shape
  `lib/plan-parser.ts`'s `planDayToEvent` already builds (the new code's own comment admits mirroring
  it) — the two can drift independently.
- ☑ P3 `bug` **HR-14** — `lib/trends.ts`'s `latestWeeklyBalance`
  ([lib/trends.ts:161](lib/trends.ts:161)) hand-rolls a 7-day date offset instead of calling
  `lib/date.ts`'s existing `isoDaysAgo`/`addDaysIso`.
- ☑ P3 `bug` **HR-15** — `/api/reschedule`'s PUT and PATCH handlers
  ([app/api/reschedule/route.ts:246](app/api/reschedule/route.ts:246)) duplicate the same
  request-parsing/existence/future-only-date validation prologue almost line for line — factor into
  one shared helper so a future validation fix doesn't have to be applied twice.

---

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).
