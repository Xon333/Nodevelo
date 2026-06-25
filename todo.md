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

**BUG-2026-06-25 — interval-order misparse on multi-step repeat blocks.**
- ☑ P1 `bug` `parsePrescription` expanded "Main Set 3x { Over 1m, Under 2m, … }" as each-step-×3
  (`[O,O,O,U,U,U,…]`) instead of repeating the block in sequence (`[O,U,O,U,…]×3`). The order-based
  interval matcher then scored every executed rep against the wrong target — a perfectly-ridden
  over-under read as "mixed, 5 reps cut short," unders deflated to ~90%, overs inflated to 112–122%.
  **Fix:** the parser now expands repeat blocks in execution order, then collapses consecutive-identical
  reps for a compact label (single-step VO2/SIT blocks still read "5×5m"; flat matching unchanged for
  those). The sync today-analysis re-parses the prescription from `workoutText`, so an already-written
  block **self-heals on the next sync** (re-sync today, then Re-analyse for the note) — no re-generate.
  3 parser tests incl. the exact reported session; the old test that encoded the bug was corrected.
  _[prescription.ts](lib/prescription.ts) · [sync/route.ts:340](app/api/sync/route.ts)._
- ☐ P3 `feat` **Follow-up (the lap-data idea — NOT the cause of the above).** Prefer device LAP markers
  over intervals.icu auto-detection for the *executed* side when laps are present (a Wahoo auto-laps each
  structured interval, so laps are a ground-truth record of the ridden structure; auto-detection can
  merge/split differently). Would harden the matcher's rep-count + structural-mismatch logic. Needs care
  to distinguish workout laps from incidental ones (e.g. the commute to/from the climb), and a clean
  fallback to detection when no usable laps exist. Scoping TBD — separate change to the executed source
  in [intervals-api.ts](lib/intervals-api.ts) + [interval-match.ts](lib/interval-match.ts).

**ACC-2026-06-25 — second-brain state accuracy (athlete request).**
- ☑ P2 `bug` **Aerobic signal → intervals.icu's Z2-isolated Pw:HR (`icu_power_hr_z2`).** The state fed
  the latest ANY-type ride's WHOLE-ride decoupling vs an all-rides 90d average — a ride-STRUCTURE artifact
  on interval days (hard-first inflates first-half Pw:HR), not aerobic strain, and as a "lived negative" it
  could wrongly CAP the score. First gated decoupling to steady-Z2 rides; then the athlete pointed out
  intervals.icu already exposes `icu_power_hr_z2` (Pw:HR over the ride's Z2 SAMPLES) — confirmed on the API,
  present even on the interval day. Final: the aerobic driver is now Pw:HR-Z2-vs-baseline (HIGHER = fresher;
  inverse polarity of decoupling), gated on ≥15 Z2-min, latest ≤14d, baseline mean over ≥3 qualifying rides
  (else sits out). Present on any ride with real Z2 — the coverage the athlete wanted, no confound. Repurposed
  the `decoupling` state-weight → `aerobicEff`; the unneeded FTP threading was reverted. Decoupling stays in
  execution scoring + Trends. spec doc updated; 2 tests. _[athlete-state.ts](lib/athlete-state.ts) ·
  [intervals-api.ts](lib/intervals-api.ts) · [docs/specs/athlete-state.md](docs/specs/athlete-state.md)._
- ☑ P2 `bug` **OLS weight trend.** Replaced the latest-minus-one-reference diff (a single outlier exactly
  7 days ago produced a false reading) with an ordinary-least-squares slope over every weigh-in in the
  trailing 14 days → kg/7d (≥3 weigh-ins). Robust to one noisy reading, handles 5×/week logging natively.
  Feeds the nutrition buffer + the Trends "7-day trend" tile. 2 tests incl. the outlier case. Theil–Sen is
  the further-robust upgrade if ever needed. _[nutrition.ts](lib/nutrition.ts)._

**RV-2026-06-24 — senior-dev general review (architecture + edge cases).** 10 findings from a
full read of the deterministic core, sync orchestrator, routes, and Intervals client. **9 of 10 shipped**
(RV-1…RV-6, RV-8, RV-9, RV-5b). Only **RV-7** (AI spend cap) is left — de-prioritised: usage/spend is
very low, so a hard cap isn't worth the friction yet. Verdict: 8.5/10.

### P1 — fixed this session

- ☑ P1 `bug` **RV-1** — the readiness window functions computed "today" from the server's UTC date,
  while activities are matched on their LOCAL date and the rest of sync threads `resolveToday` (the
  local day). Near the UTC boundary in a non-UTC timezone the ACWR acute/chronic, load-ramp, and
  polarization windows shifted a day off the calendar the rides live on. **Fix:** `computeLoadRamp` /
  `computeAcwr` / `computeIntensityDistribution` / `computeRollingBaselines` now take a `today` arg
  (default = `utcToday()`, byte-identical to before) and anchor their offsets to `Date.parse(today)`;
  sync (GET+POST), morning-check, and `resolveCoachSignals`→CoachSnapshot all pass the resolved local
  date. 3 tests added. _[readiness.ts](lib/readiness.ts) · [sync/route.ts](app/api/sync/route.ts) ·
  [coach-snapshot.ts:117](lib/coach-snapshot.ts:117)._
- ☑ P1 `bug` **RV-2** — `/api/write` POSTed each day to Intervals.icu with `upsertOnUid=false`, so a
  partial failure (day N of M fails) left days 1..N-1 as orphaned calendar events with no local block,
  and the natural retry **duplicated** every already-written day. **Fix:** `planDayToEvent` stamps a
  deterministic `uid = nodevelo-<date>`; `createEvent` posts `upsertOnUid=true` whenever the payload
  carries a uid, so block writes are idempotent — a retry/re-write upserts the same per-day event
  instead of duplicating, and a regenerated block cleanly replaces the prior NodeVelo event on a date.
  Ad-hoc note posts (no uid) keep create semantics. 1 test added. _[plan-parser.ts](lib/plan-parser.ts) ·
  [intervals-api.ts:432](lib/intervals-api.ts:432)._ **Note:** this makes the write retry-safe but is
  not a true rollback — a deleteEvent-based cleanup of a partial set is still open (folded into RV-9).

### P2 — needs a decision or design before acting

- ☑ P2 `bug` **RV-3** — HRV gated OUT of readiness by default (no overnight HRV source), code retained
  for later. `computeReadiness` takes `opts.useHrv` (default false); the suppression branch only runs
  when enabled. README §3 + the module header now state HRV is excluded-by-default / opt-in, so docs and
  code agree. Flip on with `computeReadiness(..., { useHrv: true })` once an overnight strap is worn.
  _[readiness.ts](lib/readiness.ts) · [README.md:261](README.md:261)._
- ☑ P2 `bug` **RV-4** — hardened the (now opt-in) HRV branch so it's sound when re-enabled: rejects a
  STALE reading (`MAX_HRV_STALE_DAYS = 2`, mirrors the form carry cap) and EXCLUDES today from the 7-day
  baseline so the latest reading is graded against its own history. 3 tests: off-by-default, fresh-on,
  stale-on. _[readiness.ts](lib/readiness.ts)._
- ☑ P2 `arch` **RV-5** — fixed by anchoring ledger scoring to the ride's OWN per-activity FTP. Investigation:
  sport-settings exposes only current values (no change-date), but intervals.icu stamps each activity with
  the FTP it applied (`icu_ftp`) — its own record of the FTP live that day, exact even when an FTP change
  wasn't synced for days. `buildRideScores` now uses `act.icuFtp ?? ftpForDate(date)`, so gap rides score
  against the real FTP; effective-dated physiology stays the fallback (and still drives zones + the change
  banner). 2 tests. _[score-log.ts](lib/score-log.ts) · [intervals-api.ts:228](lib/intervals-api.ts:228) ·
  [README.md:335](README.md:335)._
- ☑ P3 `arch` **RV-5b** — `reconcile` now caps physiology `history` at the most recent 23 superseded
  snapshots (+ current = 24; ~2 years of monthly changes, far past the 182-day window). Pre-earliest
  dates still anchor gracefully via `physiologyAsOf`. 1 test. _[physiology.ts](lib/physiology.ts)._
- ☐ P3 `feat` **RV-7** — _Deferred (usage/spend is very low — revisit only if it grows)._ AI spend is
  measured (`ai-usage.ts`) but never capped: `recordUsage` only accumulates; nothing refuses a call past
  a threshold. If revisited, needs a monthly cap value + behaviour (warn vs hard-429). _[ai-usage.ts](lib/ai-usage.ts)._

### P3 — altitude / cleanup

- ☑ P3 `audit` **RV-6** — documented the two interval-matcher tradeoffs that were implicit: (a) the
  structural-mismatch guard intentionally launders a deliberately-short-but-strong session into a pass
  (false-positive accepted to dodge detection noise), and (b) order-based rep alignment mis-aligns every
  rep after a skipped middle rep. Comment-only; behaviour unchanged. _[interval-match.ts](lib/interval-match.ts)._
- ☑ P3 `feat`+`test` **RV-9** — transactional block writes + calendar cleanup. Added `deleteEvent` /
  `deleteEvents` to the Intervals client. `/api/write` now AUTO-ROLLS-BACK a partial write (deletes the
  days that wrote, returns `rolledBack` / `rollbackFailed`) so a failure never leaves a half-block on the
  calendar. Block days now store their `eventId`, so DELETE `/api/sync` removes the whole block's events
  on discard, and a replacement write prunes the old block's dropped FUTURE events (past days keep their
  marker; re-covered dates upsert in place via the stable uid). Pure id-selection in `block-events.ts`
  (6 tests) + 2 write-route integration tests + the earlier partial-failure guard. _[block-events.ts](lib/block-events.ts) ·
  [write/route.ts](app/api/write/route.ts) · [sync/route.ts:458](app/api/sync/route.ts)._
- ☑ P3 `refactor` **RV-8** — three monoliths split, all behavior-preserving (verbatim JSX/prompt moves):
  - `anthropic-api.ts` 773→211 LOC: pure prompt assembly → `anthropic-prompts.ts` (618, now unit-tested,
    +5 tests), call layer keeps a shared `textOf` helper (deduped 4× response parsing). Public surface
    re-exported, no call site moved.
  - `Dashboard.tsx` 529→25 LOC: the dual-mode container split into a thin mode-switch + `TodayView` (186)
    / `PlanView` (241), each owning only its own page state (the hooks were already mode-gated), plus the
    tangled inline generator form → `BlockGenerator` (159).
  - `Trends.tsx` 508→279 LOC: payload types → `trends/types.ts` (73); standalone chart sections +
    helpers → `trends/sections.tsx` (171).
  Verified: tsc + lint clean, 520 tests, all routes SSR 200. _[components/dashboard/](components/dashboard) ·
  [components/trends/](components/trends) · [anthropic-prompts.ts](lib/anthropic-prompts.ts)._
- ☐ P3 `cleanup` **RV-10** — `data/` accumulates one-shot rebuild backups
  (`score-log.json.pre-rebuild-*.bak`) forever; no rotation. Gitignored so harmless, low priority.

---

**CR-2026-06-24 — xhigh code-review sweep of the Jun-23 logic commits + the a11y pass.** 15 findings,
verified against source. Act top-down; P1 = data-integrity, fix first.

### P1 — data-integrity (act first)

- ☑ P1 `bug` **LEDGER-1** — SYNC-2 rebuild could reclassify pre-current-block planned rides as off-plan
  (`buildRideScores` knows only the current block; block history keeps no per-day plan, so it can't be
  reconstructed). **Audit: live ledger clean** — only one block has ever existed (all 8 planned entries
  fall inside it; the 100 pre-block rides are legitimately legacy), so the rebuild caused 0 downgrades. It
  was a latent landmine (detonates on the first rebuild after a 2nd block exists). **Fix:** new
  `mergeScoreLogRebuild` guarantees a rebuild never downgrades a frozen `planned` entry to off-plan; wired
  into the rebuild branch. Off-plan/current-block/new dates still re-score. 6 tests added.
  _[score-log.ts](lib/score-log.ts) · [sync/route.ts:267](app/api/sync/route.ts:267)._
- ☑ P1 `bug` **SET-1** — settings PUT silently dropped `strainBands` / `durabilityInsertEnvelope` /
  `athleteStateWeights` (rebuilt `updated`, only re-attached `acwrBands` + `tsbModifierEdges`; full-overwrite
  wiped the rest every save). **Fix:** all three now accept+clamp via their resolvers and preserve-when-omitted
  — `strainBands` + `durabilityInsertEnvelope` in SET-1, `athleteStateWeights` accept block added with CAL-1
  once its resolver clamped. 6 route tests. _[settings/route.ts](app/api/settings/route.ts)._
- ☑ P1 `bug` **LEDGER-2** — SYNC-2 rebuild dropped frozen `formState`/`morningCheck` provenance for rides
  older than the fresh wellness window (`fresh` won the merge with `formState:undefined`, deleting
  correlation-engine data points). **Fix:** `mergeScoreLogRebuild` now carries forward any context stamp
  the re-scored `fresh` entry lacks (a fresh stamp still wins when present; context-free stays context-free).
  3 tests added. _[score-log.ts](lib/score-log.ts)._
- ☑ P1 `audit` **LEDGER-3** — `rebuildLedger` was an unguarded destructive boolean on the hot sync route
  that re-ran on every sync if set. **Fix:** persisted one-shot marker (`ledger-rebuild.json`) + pure
  `shouldRebuildLedger(requested, alreadyRebuilt, force)` predicate — a normal sync never rebuilds, a repeat
  request is refused once the marker is set, and `force:true` is the explicit re-run path. (Kept on the sync
  trigger by design: the rebuild needs fresh-sync-derived state — calibration/ftpForDate/context — so a
  standalone endpoint would just re-run a sync; the guard is the right-depth fix.) 4 predicate tests added.
  _[sync-ledger.ts](lib/sync-ledger.ts) · [sync/route.ts:158](app/api/sync/route.ts:158)._
- ☑ P1 `bug` **CAL-1** — `resolveAthleteStateWeights` was the only resolver with no clamp/ordering, so an
  extreme override could disable the lived-fatigue safety cap at [athlete-state.ts:122](lib/athlete-state.ts:122).
  **Fix:** a per-leaf `ATHLETE_STATE_WEIGHT_BOUNDS` spec + `clampLeaves` walker bounds every leaf; key
  safety invariants — `override.scoreCap` ≤70 (stays below the 80+ "primed" band) and `override.livedThreshold`
  ≤3 (only 3 lived signals exist, so the cap stays reachable); scales pinned ≥0 and ACWR optimal/danger
  sign-locked so polarity can't invert; `tsb.freshAbove` order-enforced above `deepBelow`. Resolver is the
  single chokepoint (sync + coach-snapshot both route through it). Settings PUT now accepts the override.
  5 tests added. _[calibration.ts:238](lib/calibration.ts:238)._ Deeper schema-driven unification = CAL-2.

### P2 — correctness, lower urgency / latent

- ☑ P2 `bug` **CAL-3** — durability envelope split-brain fixed: `validateSchedule` now resolves the
  durability envelope once and threads `embeddedHardPct` through `isHardDay`→`carriesEmbeddedIntensity`, so
  spacing agrees with `validatePlanProtocol` on what counts as an embedded effort. 1 test added.
  _[schedule-validate.ts](lib/schedule-validate.ts)._
- ☑ P2 `bug` **API-1** — added `numPos` (treats a present-but-zero power reading as absent), used for the
  activity `normalizedPower` and interval `npWatts`, so a 0-watt weighted-avg no longer short-circuits the
  `??` and forces IF=0. 1 test added. _[intervals-api.ts:210](lib/intervals-api.ts:210)._
- ☑ P2 `bug` **API-2** — added `numLoose` (accepts a numeric string), used for `decoupling`, so a
  string-serialised value is no longer silently dropped. Safe no-op when the API sends a number (the real
  payload does). 1 test added. _[intervals-api.ts:218](lib/intervals-api.ts:218)._
- ☑ P2 `feat` **FUEL-1** — `fuelStampFor` now keeps an explicitly-logged `0g` ride (`grams < 0` drop, not
  `<= 0`): unlogged stays `null`→absent, fasted stays `0`→a real data point for the Track-C correlation.
  `RideScoreEntry.fuel` has no consumer yet, so no behavioural ripple. _[score-log.ts:46](lib/score-log.ts:46)._

### P3 — altitude / cleanup / a11y polish

- ☑ P3 `audit` **CAL-2** (scoped) — hoisted the duplicated finite-guard `pick` to one module-level helper in
  [calibration.ts](lib/calibration.ts); the four band resolvers now share it. The full schema-driven
  unification was **deliberately not done**: the resolvers' ordering rules are heterogeneous (ACWR nudges
  up, strain nudges the lower band down, durability nudges the ceiling, TSB chains ascending), so a generic
  resolver is ~as complex as the four, and CAL-1 already closed the bug this was tied to — marginal gain vs
  regression risk on tested scoring code.
- ☑ P3 `audit` **A11Y-1** — **detector rule** (`muted-contrast` in [detect.mjs](prototypes/impeccable-audit/detect.mjs))
  flags `text-zinc-400` used as a light-mode color (≈2.6:1 on white, under AA) while passing the correct
  `text-zinc-500 dark:text-zinc-400`. **Sweep done:** every genuine bare usage across 14 components swapped to
  the AA pattern (`text-zinc-500 dark:text-zinc-400`; the two `dark:text-zinc-600` tiers kept their dark tier),
  including the close-× control and empty-state placeholders. Detector now reports 0 muted-contrast.
- ☑ P3 `bug` **A11Y-2** + `ux` **UI-1** — fixed together: extracted `BAND_COLOR`/`DIR`/`driverEffectClass`
  into [athlete-state-ui.tsx](components/athlete-state-ui.tsx); both StateDriversCard and AthleteStateCard
  import it, so the duplicated band/effect logic (which drifted and left the bare-`text-zinc-400` neutral
  arm in two places) is gone and the neutral arm is now `text-zinc-500 dark:text-zinc-400` (AA) in one place.
- ☑ P3 `bug` **CAL-4** — exported `DECOUPLING_GOOD_BOUNDS` from [calibration.ts](lib/calibration.ts);
  `deriveDecouplingGood`, the calibration route, and the CalibrationPanel input/validation all share it.
- ☑ P3 `ux` **UI-2** — `CalibrationPanel.submit` now validates the `DECOUPLING_GOOD_BOUNDS` range, not just
  finiteness, so an out-of-range entry shows the error instead of being silently server-clamped.
  _[CalibrationPanel.tsx](components/CalibrationPanel.tsx)._

_Prior 2026-06-23 sync triage (SYNC-1, NP/decoupling map, SYNC-2, SYNC-3) shipped/closed → [ARCHIVE.md](ARCHIVE.md).
Note: this sweep found LEDGER-1/2/3 are regressions in SYNC-2 itself._

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).

_Design/judgment calls that surfaced during the CR sweep now live in [ROADMAP.md](ROADMAP.md): power-zone
SoT vs personal override; the "Z2 dialed-in" overstatement; Recent-Baselines content / TSS-vs-Load naming;
whether IF should be replaced rather than annotated; CR-C observability (P8); CR-F per-carb checks (Track C)._
