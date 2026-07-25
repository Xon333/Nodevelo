# Season engine (macro-periodization)

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

## Known debt & the flag decision

Open items and the residual `exposureFromSessions` gap are tracked in [ROADMAP.md](../../ROADMAP.md) ("Season engine" section + P7 entry) — that file, not this one, is current for open work. The `SEASON_SHAPES_GENERATION` rollout decision record: `docs/superpowers/specs/2026-07-17-season-architecture-redesign-design.md`.

## Splitting warning

`season.ts` carries four concerns side by side (coverage selector, event backward-scheduling, validators, prompt formatters) — a natural 4-way split if it grows further. Don't extract partially; the validators and formatters share internal helpers with the selectors.
