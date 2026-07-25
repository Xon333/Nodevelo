# 03 · Daily loop — readiness → ride → debrief

**Why this exists:** a block is a plan; a day is a negotiation. This layer answers "should I actually do today's session, and how did it go?" — deterministic readiness signals, an athlete-confirmed override path, and a post-ride debrief the athlete can trust. **Where it sits:** reads [02-scoring](02-scoring-and-learning.md)'s model and today's sync; feeds dispositions back into the ledger; surfaces on the Today page ([08-frontend](08-frontend.md)). **Tradeoff:** signals never auto-mutate the plan — only the athlete-confirmed morning-check path does; advisory-by-default costs automation but preserves trust.

Surface: the Today page (auto-switches pre-ride ↔ post-ride when a synced ride matches today's **local** date — always `localToday()`/`resolveToday()` from `lib/date.ts`, never UTC).

## Morning (pre-ride)

1. **Morning check** (`lib/morning-check.ts`, `MorningCheckIn.tsx`, `/api/morning-check`): optional ill / extreme-fatigue / injury flag → deterministic decision. Injury → rest, any day (musculoskeletal: motion is the hazard regardless of intensity). Metabolic flags → downgrade on quality days, rest on easy days. The athlete confirms; the apply path swaps/deloads via `reschedule.ts` and mirrors to the calendar. (Note: this PUT is the one block mutation without a CAS version guard — accepted, same-day scope.)
2. **Readiness** (`lib/readiness.ts`): Build/Hold/Recover from prior-day TSB + ATL:CTL ratio; fatigue alerts, load-ramp alerts, ACWR. HRV suppression exists but is off by default.
3. **Athlete state** (`lib/athlete-state.ts`): the 0–100 fused score — TSB, ACWR, execution EWMA (from the athlete model), Z2 aerobic efficiency, off-plan behaviour — with the **lived-signal override**: ≥2 corroborated negative signals cap a fresh-looking load-model score. Shown on Today (`AthleteStateCard`) with its "why" drivers on Model (`StateDriversCard`); both share `athlete-state-ui.tsx` so band colors can't drift. Spec: [../specs/athlete-state.md](../specs/athlete-state.md).
4. **Coach snapshot** (`lib/coach-snapshot.ts`): fuses all of the above plus fuel state, FTP-retest advisory, and TSB-modifier guidance (`resolveTsbModifier`: deep-fatigue / productive-overload / balanced / fresh, calibratable edges) into the ONE bundle both the Today card and Ask-Coach read. There is deliberately **no auto-mutation of today's plan from readiness** — signals are advisory; only the athlete-confirmed morning-check path changes the plan.
5. **Carb-loading prompt** (`lib/loading.ts`, `/api/loading`): day-before g/kg target ahead of a durability long ride; one-tap loaded/skipped attribution feeds an effectiveness assessment.

## After the ride

`doSync()` (SyncProvider) → `POST /api/sync` computes everything deterministic — zones, interval match, PRs (`lib/pr.ts`, curve-to-curve), execution score, advised intake — into `data/today-analysis.json`, then returns `analysisPending: true`. The client then calls `POST /api/analyze` (the deferred LLM step) for the coach note ([ADR-0005](../DECISIONS.md)); with `autoPostCoachNote` on, the note is also posted to Intervals.icu as a NOTE event.

Post-ride surfaces on Today: `TodayRideCard` (rep breakdown, `RideTrace` power chart, PR banner, coach note), **session disposition** chips (`SessionDisposition.tsx` — "compromised" is the one that changes learning), **fuel prompt** (`lib/fuel-prompt.ts` nudges logging when a long/interval ride has no carbs logged), and **Ask Coach** (`AskCoach.tsx`, streamed haiku, grounded in the same coach snapshot so it cannot disagree with the card).

**Nutrition is code, not AI** ([DECISIONS](../DECISIONS.md) ADR-0002 applied to food): `lib/nutrition.ts` computes daily targets deterministically (base + session kJ + a buffer that self-adjusts ±150 kcal against the synced 7-day weight trend, capped 0–600; flat target on rest days) plus pre/in/post-ride carbs. The fuel prompt's rules are pure code too: a logged `0` is a real "fasted" data point, never nudged; the logged-vs-optimum gap only surfaces once the athlete's derived `carbsOptimum` reaches medium/high confidence — a population default never masquerades as personalized. The LLM phrases these numbers verbatim; it never computes them.

## Missed/failed sessions

- **Reactive**: a quality session missed or compromised in the last 10 days → `reschedule.suggestReschedule` proposes the earliest future rest day not flanked by quality (`RescheduleBanner` on Plan).
- **Proactive**: "can't deliver today's quality" → load-neutral swap with an upcoming easy day, or an honest deload with the dropped stimulus carried on `CurrentBlock.deferredQuality` for the next generation. Never raids a rest day. All moves go through `calendar-mirror.persistMirroredMove` (local commit first, then best-effort mirror).

## Common modifications

| Change | Where |
|---|---|
| New readiness signal | `readiness.ts` → wire into `athlete-state.athleteStateInputsFrom` and/or `coach-snapshot.resolveCoachSignals`; weights via `calibration.resolveAthleteStateWeights` |
| State-fusion weights/bands | `calibration.ts` (defaults) / Settings overrides; spec's tunable-knobs section |
| Morning-check decision rules | `morning-check.decideMorningCheck` (pure, tested) |
| Today-card content | `components/dashboard/today.tsx` (740 lines — the page's named-export module) |
