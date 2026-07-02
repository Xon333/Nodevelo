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

- ☐ P3 `polish` **Goals form's Focus dropdown omits `sharpen`.** The API/engine both accept it; only the
  `/profile` picker is short one option, so a `sharpen`-focused season period can't have a goal directly
  authored via the UI yet. One-line fix: add `<option value="sharpen">`. _[AthleteProfileForm.tsx](components/AthleteProfileForm.tsx)._

_Season/block goals-flow (Goals/Weakpoints centralization + Season/Block hierarchy + block-completion
prompt) + FB-2026-06-30 (Today + Profile sweep) + the EA→CoachSnapshot wire-up + SUB-1 (block-history
durable corpus) shipped → [ARCHIVE.md](ARCHIVE.md). SUB-2 (legacy backfill) investigated and paused →
[ROADMAP.md](ROADMAP.md) "Data substrate"._

**EC-2026-06-27 — edge-case sweep (EA/baseline tiles + a read-audit of the off-plan-aerobic & durability
scoring diffs).** None ship yet; ordered by blast radius. The fixed trust-consistency cases (EA fasted-0,
EA exercise-burn label, w/kg stale-FTP flag) shipped → ARCHIVE.

### P2 — correctness / signal quality

- ☑ P2 `audit` **EC-1 — aerobic Pw:HR baseline now outdoor-filtered.** `qualifyingPwHr` requires
  `type === "Ride"` (excludes VirtualRide), so the Z2 Pw:HR baseline AND the per-ride read both drop indoor
  rides whose Pw:HR is distorted (ERG-flat power + cardiac drift) — parity with the Trends Pw:HR
  (`isSteadyEnduranceRide`). One shared gate covers all three consumers (off-plan execution signal,
  athlete-state aerobic driver, today path). +1 test. _[aerobic.ts](lib/aerobic.ts)._
- ☑ P2 `bug` **EC-2 — durability effort timing now sample-index based.** `gradeDurabilityDelivery` computes an
  effort's ride-fraction as `start_index ÷ max(end_index)` (both stream sample indices, same stream) instead
  of `start_index ÷ movingTimeSec` — immune to non-1 Hz smart-recording and paused time, where a sample index
  ≠ elapsed seconds and moving time excludes pauses. A genuinely late effort no longer mis-reads as
  "mis-placed" (signal 0 → 2). +1 test (half-rate stream). _[durability-score.ts](lib/durability-score.ts)._

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

---

Add new bugs/feedback here as they come in; strategy → [ROADMAP.md](ROADMAP.md).
