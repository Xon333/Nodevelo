# NodeVelo roadmap

*Last verified 2026-07-25.* The forward backlog — open work only. Mission: be a coaching **layer**
that fuses signals into one coherent, self-correcting athlete model — not a re-skin of Intervals.icu.

Companion docs: live bugs → [todo.md](todo.md) · shipped detail → [ARCHIVE.md](ARCHIVE.md) · why
it's built this way / rejected alternatives → [docs/DECISIONS.md](docs/DECISIONS.md) · exploratory
spikes → [research.md](research.md) · full architecture → [docs/COMPASS.md](docs/COMPASS.md).

Only open work appears here — anything shipped moves to ARCHIVE.md. IDs (`#1–4`, `§5–7`,
`Track A–C`) are stable cross-ref handles — append new ones, never renumber. `← X` = depends on /
derives from.

---

## ⚑ State of the app

**Engineering is ahead of data.** The deterministic core and the "calibrated honesty" UX both hold.
The one thing not yet proven is the *self-correcting loop* — it has turned over exactly once.

- First in-app block: 2026-06-15. Rides before that are `legacy` — real training, excluded from
  learning by design (no plan to score against).
- First loop turnover fired 2026-07-15 (SUB-5 → ARCHIVE.md): 6 directives are live in
  `intervention-log.json`, `outcome: null`, on 28-day horizons.
  **First verdicts mature ~2026-08-12.** Until then, most calibrated parameters return population
  defaults (n=1–8 per type, below the trend/discrimination gates) — expected, not a bug.

**Standing focus: data over features.** Every learning mechanism is code-complete and dormant. The
loop pays out as generate→ride→score→learn cycles accrue, not as more code ships.

## 🎯 Do this — #2 · Per-athlete calibration (the keystone)

The only unblocked, standalone, high-leverage build available right now — everything in "Then"
below either derives from this or is waiting on data maturity.

Extend the shipped `parameterise → derive-with-fallback → stamp` machinery to more parameters.
**Pattern per param:** default = today's literal value → derive with a confidence-gated fallback →
stamp on every ledger entry it scores → test that a fresh athlete scores identically.

- Only add a derivation where an **honest** execution outcome separates failures from successes —
  the `productiveOverload`/`balanced` edges and the #3 reschedule thresholds still lack that signal.
- Per-type IF cutoffs have two low-priority slivers: RaceSim stays intentionally unanchored
  (surgy/mixed, no single zone edge); `/model` offsets are derived-live, not persisted in
  `CalibrationStore` (fine unless a manual override is ever wanted).
- Carbs g/h optimum is owned by **Track C**, not this item.
- **Explainability follow-on:** the build-focus selector already computes a decomposed score
  (`parts: {goal, urgency, trainability, execution, limiter}`, `lib/season.ts:187-230`) but never
  persists or surfaces it. Stamp it onto the ledger entry alongside this item's other stamps —
  turns "why Threshold not VO2" into inspectable evidence instead of a black box, for free.

## Then — unblocked, ranked

| | Why it's next | |
|---|---|---|
| **P9 · Stream `/api/generate`** | Generation blocks the UI 1–2 min today — the other real, unblocked lever this session. **Scope it as refine-loop phase 1**, not a progress bar: streaming is the prerequisite for `#10` below | — |
| **#10 · Conversational refine on a generated block** ⭐ | Regeneration is free but *stateless* — an objection to week 2 means editing the goal text and re-rolling. Take the prior plan + an NL delta, mutate the shipped skeleton, re-validate. Athlete-initiated, so ADR-0004 holds | [skeleton](docs/systems/06-generation.md#the-week-skeleton-composition-authority) |
| **Track A · W′-derived power anchors** | `wPrimeRollingJ` syncs as of 2026-07-30 and governs the 1-/5-min anchors — the one Track A slice not waiting on `#2`. `wBalDepletionJ` is an unused per-ride anaerobic-strain signal | `power-profile.ts` |
| **§5 · Athlete-state slivers** | Derive fusion weights `← #2`; tune score→band thresholds against real use | [spec](docs/specs/athlete-state.md) |
| **#3 · Proactive reschedule slivers** | Decision thresholds `← #2`; possible auto-downgrade on `fatigueAlert` before a miss | — |
| **Scoring-core gaps** | Recovery-specific aerobic HR cap (only if the shared band proves too soft in real use); zones source-of-truth decision (lean strict-consistency) | `execution-score.ts` |
| **Track A · Power-curve reference multiples (remainder)** | The 5s/20min anchors W′ can't explain — still local magic-numbers in `power-profile.ts` `← #2`. The 1-/5-min half moved up to the W′ row above | — |
| **Track B · RaceSim cadence** | Tighten per-loading-week only if real use shows under-delivery | — |
| **Track C · Fueling** | Per-ride-type optimums + richer outcome signals once the endurance read proves out; `/model` verdict surfacing | — |
| **P8 · AI-route cost guard** | In-memory token-bucket on `/api/generate` + `/api/ask`, plus a soft warning at 75% off the cost `ai-usage.ts` already tracks — a meter, not a 429; at the cap AI goes dark and the deterministic app stays whole (ADR-0005) | `ai-usage.ts` |
| **Adaptive self-directed coach — Phase 3a** | Weekly TSS envelope + next-session suggestion + no-block Today UI (design §8-10, §12.1). Phases 1–2c shipped → [ARCHIVE](ARCHIVE.md#adaptive-self-directed-coach--phases-12c-2026-08-0612). Not started; scope in a fresh session via the kickoff brief. | [design](docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md) · [scoping handoff](docs/superpowers/2026-08-12-adaptive-coach-p3a-scoping-handoff.md) |
| **Adaptive self-directed coach — Phase 3b** | Curated-interval HR/cadence/gradient/VAM context for self-directed intent-matching (label-first match, gradient+VAM always attached as evidence). Design brainstormed and written 2026-08-12; implementation plan for Codex in progress. | [design](docs/superpowers/specs/2026-08-12-adaptive-coach-p3b-interval-context-design.md) |
| **Adaptive self-directed coach — Phase 4** | One-time historical three-week repair (report → human approval → overlay write → derived-state rebuild), human-reviewed. Not started. | [design](docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md) |

## Blocked / dormant

| | Waiting on |
|---|---|
| **#4 · Validation loop → auto-down-weight** | Mechanism complete — needs matured verdicts (~2026-08-12) |
| **SUB-2 · Legacy backfill importer** | Paused — Intervals.icu recovers only ~25% of legacy rides, doesn't justify an importer. Revisit only if manual relabeling proves painful. |
| **Event-anchored season mode** | `SEASON_SHAPES_GENERATION=false` — an athlete decision (2026-07-16); reopen when event-mode planning is wanted |
| **P1 · Event phase text** | Gated by the flag above; also needs a future A-event to matter |

## Watch — known, dormant, not scheduled

Live-confirmed or suspected rough edges in the season/generation engine, worth knowing before you
touch that code. Full rationale: [docs/systems/05-season.md § Known rough edges](docs/systems/05-season.md#known-rough-edges).

| | State |
|---|---|
| **P4/P5 · event-week overstack** | Live-confirmed; dormant until event mode is active |
| **P3c · narrative critic reliability** | Inconsistent — caught a bad overview once, missed one once |
| **P2 · hour-target precision** | Much improved, not closed. Phase B's per-day skeleton took loading weeks from 1/4 inside the 30-min tolerance to 3/4 (measured 2026-07-29: −20/−34/−10 min vs 12h; recovery week −4). The residual mis-sized-slot cause was fixed after that measurement, so the next live run should read better — unverified. |
| **P7 · urgency signal blind to pre-app fitness** | Masked by goal-driven blocks in practice; not structurally closed |
| **P3d / P3e / P6** | Deliberately not built — need new code, no evidence yet justifies the investment |
| **Event-date exclusion is unconditional & priority-blind (3 validators)** | Accepted 2026-07-29 — `isQuality` tightening false-positives on a real Threshold-typed test day; see `lib/schedule-validate.ts`'s `validateEventTaper` `eventDates` comment |

**Tripwire:** if a future block reproduces a structural defect (a missed hour target, a missing
limiter session, an escalation the critic misses), that's real evidence the LLM shouldn't author
structure at all — next step is a deterministic skeleton with parameterized protocol templates.
**Fired 2026-07-29, and answered** — a recovery week kept all three quality types, merely trimmed;
root causes fixed in Phase A, and Phase B shipped the deterministic skeleton, which now owns
composition. The LLM still authors interval *content* inside each slot — deliberately, not by
omission. Detail + the reopen trigger for taking it further:
[docs/systems/05-season.md § Known rough edges](docs/systems/05-season.md#known-rough-edges).

## Later — scoped, not started

- **6a · Event-aware race planning** ⭐ — event date/priority/type → taper + carb-load + race-day
  timeline. KB already holds the protocol; LLM only phrases it, never invents grams.
- **§6 · Nutrition energy-balance (remainder)** — precise fluid/sodium/carb targets pre/intra/post
  by IF + duration. (The weekly intake-vs-need ratio half already shipped.)
- **§7 · Calendar flexibility (remainder)** — condition-driven auto-swaps (react to fatigue/load
  automatically, not athlete-initiated); content-edit inbound sync; calendar-side swap-pairing.
- **Wearable morning-readiness** — objective HRV/sleep/resting-HR replacing the manual fatigue flag,
  once a wearable is in the loop.
- **In-app proven-workout library (generation-time reuse + Intervals.icu export)** — NodeVelo builds a
  local library of athlete-curated well-executed sessions and selects from it during generation instead
  of always asking Claude to author `← #4`; every promotion also exports to Intervals.icu's own library,
  absorbing the older manual-push-only idea (`docs/superpowers/specs/2026-07-18-workout-library-sync-design.md`,
  retired 2026-08-05 — do not implement that doc). **v1 is manual-promotion-only** (athlete decision,
  2026-08-05) — automatic evidence-based promotion + historical bootstrap are designed (§5a) but
  deferred until the manual path shows real usage. 1 of 10 planned tasks shipped 2026-08-03:
  `lib/workout-library.ts` (fingerprinting, promotion rules, slot-matched selection) + tests, tracked at
  [FILE_INDEX.md](docs/FILE_INDEX.md). **Not wired in** — no persistence store, no `app/api/generate`
  integration, no write-route use-count accounting, no export, no management UI. Remaining 9 tasks + full
  design: `docs/superpowers/plans/2026-08-02-proven-workout-library-generation.md`.
- **Mobile density polish** — desktop-first was a deliberate scope call (UX-MASTERPLAN §3); revisit
  only if it causes real confusion, not urgent on its own.

## Won't do

Rejected tech and UX alternatives, with reasoning →
[docs/DECISIONS.md § ADR-0012](docs/DECISIONS.md#adr-0012--rejected-alternatives-a-running-log).
Don't re-propose without new evidence.

## Exploratory → [research.md](research.md)

The "Second Brain" spike (LangGraph / Mem0 / GraphRAG / HRV) — findings, not commitments. Lean
spin-offs worth pursuing: knowledge-connections, HRV-readiness.
