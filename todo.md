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

**EC-2026-06-27 — edge-case sweep (EA/baseline tiles + a read-audit of the off-plan-aerobic & durability
scoring diffs).** None ship yet; ordered by blast radius. The fixed trust-consistency cases (EA fasted-0,
EA exercise-burn label, w/kg stale-FTP flag) shipped → ARCHIVE.

### P2 — correctness / signal quality

- ☐ P2 `audit` **EC-1 — aerobic Pw:HR baseline isn't outdoor-filtered.** `z2PwHrBaselineBefore(activities, …)`
  builds the Z2 Pw:HR baseline over ALL activities (feeds the off-plan execution signal AND the athlete-state
  aerobic driver), but the Trends Pw:HR is deliberately OUTDOOR-ONLY (README §4 — indoor/ERG-flattened power +
  cardiac drift distort Pw:HR). So an indoor ride can both pollute the baseline and be graded against a
  mostly-outdoor one → an indoor-conditions penalty misread as aerobic strain. Filter to outdoor (exclude
  trainer/virtual) for parity. _[aerobic.ts](lib/aerobic.ts) · [score-log.ts:153](lib/score-log.ts:153) ·
  [athlete-state.ts:185](lib/athlete-state.ts:185) · [sync/route.ts:384](app/api/sync/route.ts:384)._
- ☐ P2 `bug` **EC-2 — durability effort timing assumes 1 Hz, no-pause sampling.** `gradeDurabilityDelivery`
  computes an effort's ride-fraction as `startIndex / movingTimeSec`, but `start_index` indexes the
  ELAPSED-time stream (and at smart-recording rates ≠ seconds) while `movingTimeSec` excludes pauses. A paused
  or smart-recorded ride mis-places efforts in the late/on-fatigue + distributed checks → a genuinely late
  effort can read "mis-placed" (signal 0 not +2), under-scoring a correctly-ridden durability session. Use
  elapsed seconds consistently, or the interval start TIME if exposed.
  _[durability-score.ts:60](lib/durability-score.ts:60) · [ride-analysis.ts:123](lib/ride-analysis.ts:123)._

### P3 — defensive / polish / cleanup

- ☐ P3 `audit` **EC-3 — `durabilityDelivery` applied independent of the template guard.** `computeExecutionScore`
  adds `durabilityDelivery` whenever finite, but only suppresses the interval-adherence axis when
  `embedsEfforts && durabilityDelivery` (`gradedByDurability`). Callers pair template+delivery today, so it's
  safe — but a lone `durabilityDelivery` (no `durabilityTemplate`) would double-count with adherence. Gate the
  application on `gradedByDurability`, or assert the pairing. _[execution-score.ts:169](lib/execution-score.ts:169)._
- ☐ P3 `bug` **EC-4 — EA weight fallback can be anachronistic.** A windowed day with logged intake but no
  weigh-in uses the MOST-RECENT weight (possibly logged after that day); nearest-PRIOR would be cleaner. Weight
  moves slowly → small impact. _[nutrition.ts](lib/nutrition.ts)._
- ☐ P3 `audit` **EC-5 — EA trend is sensitive to rest-day composition (accepted).** The cur-vs-prior 7-day
  windows can hold different counts of rest days (high EA) vs hard days (low EA), so the arrow can move from
  SCHEDULING, not intake. Kept a soft arrow (no verdict) for this reason; a per-athlete band is Track C. _[nutrition.ts](lib/nutrition.ts)._
- ☐ P3 `polish` **EC-6 — new rolling baselines are silent until the next sync.** `ridesPerWeek90d` (and any
  future field) isn't in the stored `rolling-baselines.json` until a POST sync recomputes, so the tile hides
  (`!= null`) right after deploy. Self-heals on first sync. _[trends/sections.tsx](components/trends/sections.tsx)._
- ☐ P3 `polish` **EC-7 — "Power execution" drill-down can hold only decoupling.** With decoupling relocated
  there (C), a steady ride with no trace/zones/intervals renders a section titled "Power execution" containing
  only aerobic drift — a mild mislabel. Retitle or gate the section. _[dashboard/today.tsx](components/dashboard/today.tsx)._
- ☐ P3 `cleanup` **EC-8 — `avgCadence90d` computed-but-unused.** Dropped from the Recent-Baselines card
  (curation), still computed + stored. Retire from the type/default/compute/store, or leave as a cheap spare.
  _[readiness.ts](lib/readiness.ts) · [types.ts](lib/types.ts) · [data-store.ts](lib/data-store.ts)._

_Also a background task: wire energy availability into `CoachSnapshot.fuel` (`intakeVsNeed`/`fuelingState`) —
the reserved slots + the stale "no intake logging yet" comment (ROADMAP #1 / Track C)._

---

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).
