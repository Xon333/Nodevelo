# 05 · Season — which system to train next, and why

**Why this exists:** blocks generated in isolation drift into repetition or neglect; the season layer is the general "why" above each block's specific "what" — it picks the next focus from measured reality (what's actually been trained, what's decaying, what the goal demands) instead of a fixed rotation. **Where it sits:** consumes [02-scoring](02-scoring-and-learning.md)'s model + [04-knowledge](04-knowledge.md)'s goals; its focus choice and context feed [06-generation](06-generation.md). **Tradeoff:** the full event-anchored phase machinery is built but flag-gated off — the athlete chose block-level honesty over imposed macro-shapes.

`lib/season.ts` (925 lines — the largest engine) + `lib/season-signals.ts` (its IO assembler). Surface: Plan page (`SeasonSection`, `SeasonRoadmap`), `/api/season`.

## Two modes

| | Rolling | Event-anchored |
|---|---|---|
| When | No upcoming A-priority event | An A-event exists |
| Mechanism | Each block's focus chosen fresh by the **coverage selector** `chooseNextFocus` | `backwardScheduleFromEvent`: taper → peak → build backward from race day; `replanEventArc` re-plans on change |
| Status | **Live** | Mechanism shipped, **feature-flagged off**: `SEASON_SHAPES_GENERATION = false` (2026-07-16 athlete decision) — season context still informs prompts, but phase shapes don't drive generation |

## The coverage selector

`scoreFocusCandidates` ranks each focus by **goal-relevance × decay-urgency × trainability × execution-quality + limiter bonus**:

- *Goal relevance* — from goal/weakpoint text (`tagPresent`, negation-aware).
- *Decay urgency* — how long since that system was actually trained, from **real session exposure** (`exposureFromSessions`), not planned intent.
- *Execution quality* — the athlete's measured EWMA for that focus (`intervention.execFor` — the same accessor generation uses, so the two can't read different numbers).
- *Limiter bonus* — the power-profile-derived weak system (`mapSystemToFocus`) biases, never overrides.

`season-signals.gatherFocusInputs` is the **single place** these inputs are assembled, so `/api/generate` and `/api/season` cannot drift.

## Recovery weeks

`planRecoveryWeeks` places deloads every 3–4 weeks based on `realWeeksSinceLastRecovery` — derived from actual ride history, not a cross-call counter (a stale counter was a shipped-bug class). Recovery-week hour targets come from `block-skeleton.ts` (retention % of loading weeks).

## Validators (all warn-only, post-generation)

`validateBlockFocus` / `validatePrimaryQualityCadence` (rolling) or `validateSeasonFit` / `validateFocusMatch` (event-anchored) check the generated block agrees with the chosen focus/arc. They only run if the season re-plan succeeded; season context assembly in `/api/generate` is try/catch-wrapped — best-effort, never blocks generation.

## Persistence rules

`data/season-plan.json`. `/api/generate` persists a season re-plan **only after a successful generation**, CAS-guarded on `updatedAt` (HR-58). `/api/season` PUT owns objective/events CRUD. `settleSeasonHistory` reconciles past periods; `projectSeasonOutlook` powers the roadmap preview (stateless).

## Season → Plan-page conveniences

`suggestedBlockWeeks` pre-fills the generator's length selector (2/4/6/8) by ceiling-rounding the current period's remaining weeks; `filterGoalsByFocus` narrows the goal-textarea pre-fill to goals tagged with the current focus plus `"general"`-tagged ones — both are overridable pre-fills, never locks. Once a block's `endDate` passes, the Today page proactively nudges "generate the next block" (`isBlockFinished`, a pure date check) instead of sitting on stale copy.

## Known rough edges

Open action items live in [ROADMAP.md](../../ROADMAP.md) ("Then"/"Watch" sections) — this section
is the *why* behind them. `SEASON_SHAPES_GENERATION` rollout decision record:
`docs/superpowers/specs/2026-07-17-season-architecture-redesign-design.md`.

#### The 2026-07-24 redesign's open items (P1–P7)

Root cause, full per-item detail, live-smoke results, and the 11-candidate re-architecture
evaluation → [ARCHIVE.md](../../ARCHIVE.md) "Block-generation architecture redesign — P1–P7
(2026-07-24)". What's still open, and why:

- **P1 — A-priority events get no phase text.** `formatSeasonContext` is the only channel for the
  backward-scheduled taper arc, and it stays behind `SEASON_SHAPES_GENERATION` by design — latent
  since no A-event exists yet.
- **P2 — recovery-week depth and hour-target precision are narrowed, not exact.** Live smoke: a
  loading week landed ~9% under a 12h target; a recovery week ranged from 12min under to 1.5h over
  its derived target across runs. Now visible (`validateWeekHours`), not solved.
- **P3c — the narrative critic doesn't reliably catch approximate duration language.** Fired and
  corrected a real overview on one smoke run; a later run let a "4-hour" mis-description of a
  200-minute ride through. Inconsistent, not proven broken — worth sharpening the prompt if it
  recurs.
- **P3d — consequence forecast.** Deliberately not built: needs new forward-projection code
  (`lib/readiness.ts`'s `computeAcwr`/`computeLoadRamp` only analyze past activity; nothing projects
  CTL/ATL/TSB forward from a hypothetical block) and no live smoke run has yet shown a dangerous
  ramp-rate or bad event-day form to justify it.
- **P3e — aggregate-miss hard-fail + targeted single-week regeneration.** Deliberately not built:
  the largest, riskiest piece (new partial-regen prompt/schema/splicing/bounded-retry, ~doubling
  worst-case latency when it fires, a new boundary-conflict failure mode of its own). Recommended as
  its own dedicated session once real data shows blocks still miss badly enough to need it — smoke
  tests so far have only produced modest (≤1.5h) misses.
- **P4/P5 — the event week can still overstack, and a hard ride can still land the day before the
  event.** Live-confirmed after P5 shipped: the KOM event's own week stacked 3 quality sessions and
  a hard embedded-effort Z2 landed the day immediately before the event — `validateEventTaper`'s
  "no quality in the final 2 days" rule checks standalone quality types only, not embedded-effort
  endurance rides the way `validateSchedule`'s older, broader "hard day" definition already does.
  Worth extending `validateEventTaper` to reuse that broader definition if this recurs.
- **P6 — week-boundary re-anchoring.** Not yet scoped to file/function detail. Recompute the
  remaining weeks' skeleton from actual executed load at each week rollover — drops the feedback
  loop from 42 days to 7 without a daily engine. Carries the per-zone progression ledger as state.
- **P7 — the focus selector's urgency signal is blind to pre-app fitness.** `exposureFromSessions`
  (`lib/season-signals.ts:76`) is built only from NodeVelo-generated block history. A focus with no
  in-app exposure hits `NEVER_SEEN_URGENCY` (1.3), and for `aerobic-base` specifically that spike
  can still win a goal-neutral block's slot. Heavily masked in practice (goal-driven blocks
  out-score it) but not structurally closed. Fix direction: feed `aerobic-base`'s urgency partly
  from a real, ledger-independent signal (synced CTL/volume-baseline trend) instead of the flat
  spike.

#### Decision log (full evaluations in ARCHIVE.md)

- **Tripwire:** if a future block reproduces a structural defect (a missed hour target, a missing
  limiter session, an escalation the narrative critic misses), that's real evidence the LLM
  shouldn't author structure at all — next step would be a fully deterministic skeleton with
  parameterized protocol templates, LLM narrating only. Hasn't fired; the P4/P5 event-week
  overstack above is the closest call so far.
- **Held for a scheduled reopen, not rejected:** the TrainerRoad-style per-zone progression-level
  state machine (→ ARCHIVE for why it's the standout alternative). Reopen once per-type observation
  counts clear the athlete-model's own ≥3-obs gates (watch after the 2026-08-12 verdict
  maturation).
- **Eliminated outright (don't re-propose without a real reason):** a full constraint solver (its
  one good idea — refuse to silently arbitrate an over-constrained ask — is already in P2a); full
  rolling-horizon generation with no block concept; a full backward-from-event planner as the
  *primary* generative move (→ ARCHIVE for the full evaluation).

#### Other known edge cases (none currently worth a dedicated pass)

- Event-mode peak vs. taper share one `focus: "sharpen"` value → same roadmap color/label; only
  the phase caption distinguishes them. Cosmetic; visible only once event mode activates.
- `exposureFromSessions` measures generated (prescribed) sessions, not ridden ones — a
  planned-but-skipped VO2max day still counts as real exposure. `execQualityByFocus` only
  partially compensates. Worth a join against the score log if this ever mis-steers the selector
  in practice.
- No re-plan trigger from the Season form itself (the next `POST /api/generate` re-plans and
  activates event mode the moment a future A-event exists); no UI warning about multiple A-events
  or the array-order tie-break.
- **The `PlanView` goal-textarea race (UXA-19, 2026-07-22, narrowed not eliminated → ARCHIVE.md):**
  `seasonQuery`'s render-time sync block re-applies `goalPrefill` onto the goal textarea any time
  the query result changes reference, with no check for whether the athlete has already started
  editing. Saving the Season form bumps `seasonVersion` → a real refetch → a real trigger, so an
  athlete who saves Season while mid-edit on the goal textarea below it can still get overwritten —
  same shape as before, one specific trigger instead of a timing race. Judgment call, not a bug:
  decide whether the sync should also skip once the textarea has unsaved user edits, or whether
  this is rare enough (same page, two adjacent actions) to leave as-is.
- B/C-priority event surfacing (`formatUpcomingEventsForBlock`) and `formatSeasonContext`'s call
  currently share one `try`/`catch` in `app/api/generate/route.ts` — if
  `chooseNextFocus`/`replanEventArc`/`settleSeasonHistory` itself ever throws, the
  (currently-disabled anyway) phase text AND the always-on event line are silently dropped
  together. Pre-existing fragility inherited from the original event-surfacing plan's own
  "best-effort" design. Worth unwinding (pull the event-line computation out of the replan's
  try/catch) if event-surfacing reliability ever matters more than it does today.

#### Splitting warning

`season.ts` carries four concerns side by side (coverage selector, event backward-scheduling, validators, prompt formatters) — a natural 4-way split if it grows further. Don't extract partially; the validators and formatters share internal helpers with the selectors.

## Common modifications

| Change | Where |
|---|---|
| Focus selection weights | `season.ts` — `scoreFocusCandidates` |
| New focus input | `season-signals.ts` |
