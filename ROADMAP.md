# NodeVelo roadmap

*Last reconciled 2026-08-23.* The forward backlog — open work only.

Phase charter: [accepted adversarial investment review](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md).
The review is an immutable point-in-time decision record; this file is its living operating backlog.
Live bugs → [todo.md](todo.md) · shipped detail → [ARCHIVE.md](ARCHIVE.md) · decisions →
[docs/DECISIONS.md](docs/DECISIONS.md) · architecture → [docs/COMPASS.md](docs/COMPASS.md).

IDs (`#1–4`, `§5–7`, `Track A–C`) are stable cross-reference handles. Never renumber them.

---

## State of the app

NodeVelo remains a personal, localhost-only cycling decision-support system for one informed
athlete. It is under a feature freeze while it repairs trust contracts and earns prospective
evidence. It is not a proven self-correcting coach and is not being productized.

The mechanical rides → score → model → generation → approval loop is real, but only one complete
turnover has occurred. Six intervention outcomes cover two repeated hypothesis families: four
validated, two inconclusive, none refuted. That is thin, correlated evidence—not a causal accuracy
rate. Trust, safety, integrity, and evidence outrank feature work.

## Active order

Do these phases in order. The only permitted overlap is Phase 7 after Phase 5; Phase 8 starts only
when a real A-event exists.

### Phase 1 · Repair trust contracts

- Complete the prospective evidence follow-up for the shipped publication gate: [publication-gate
  evidence log](docs/reviews/2026-08-24-publication-gate-evidence.md). The implementation is archived
  under PR #97; the long-term checklist remains open until the charter's evidence gate is met.
- Show physiology freshness; warn through temporary sync failure, but block missing, inconsistent,
  or explicitly obsolete physiology.
- Remove causal accuracy language, unqualified individualized injury-risk language, claims that
  every plan constraint is hard, automatic reuse of AI-authored root causes, and Ask Coach from the
  active UI during the freeze. Replace AI criticism with deterministic prose wherever facts suffice.
- Disclose local persistence and remote Anthropic processing separately.
- Make restore behavior and critical-state coverage honest about partial recovery risk. Off-machine
  backup remains deliberately deferred to Phase 9.

Optional within this phase: **Adaptive self-directed coach — Phase 4**, a one-time, human-reviewed,
provenance-bearing historical repair through overlays. The original ledger remains untouched; the
repair may improve current state but never counts as prospective effectiveness evidence.

### Phase 2 · Make the core journey excellent

Make Today → Plan → ride → deterministic closeout → adaptive week reliable without lost plans,
developer intervention, unexplained figures, avoidable prose, or confusing information placement.
Show provenance and confidence clearly throughout the UI. Judge changes through repeated task
completion. Keep all seven pages until Phase 7's task-based audit. **P9 · Stream `/api/generate`**
belongs here only if it removes measured core-journey latency; it is not a prerequisite for
conversational refinement.

### Phase 3 · Reduce Claude's generation authority

Move workout syntax, arithmetic, protocol templates, progression, and enforceable safety constraints
into deterministic code. Claude may interpret genuinely free-form language and phrase concise,
grounded suggestions inside those limits. Audit every AI call and keep the deterministic core useful
when Anthropic is unavailable. Validate five consecutive structurally valid test generations across
varied inputs before advancing.

### Phase 4 · Complete the narrow workout-library loop

Finish explicit manual curation, deterministic selection, generation-time reuse, management UI, and
accepted-use recording. Existing domain, persistence, export, API, and deterministic-template work
is recorded in [ARCHIVE.md](ARCHIVE.md#proven-workout-library--foundation-tasks-15-2026-08-031120).
Automatic promotion and broad historical bootstrapping remain deferred until the manual lane proves
useful. Any curated older workout used to bootstrap the lane is labeled as a manual import. The
immutable execution record remains
[the existing plan](docs/superpowers/plans/2026-08-02-proven-workout-library-generation.md).

### Phase 5 · Validate nutrition prospectively

Judge personalized energy-balance guidance against the athlete's existing acceptable monthly weight
range. Track energy, recovery, adherence, and workout quality separately. Automatic changes require
long-window evidence, capped movement, visible reasoning, immediate pause/override, and the RMR
floor. **Track C** and **§6** work is allowed only where it supports this validation; the daily
carbohydrate target is the remaining narrow product slice. Do not add calibration dimensions that
cannot discriminate outcomes.

### Phase 6 · Run four real block cycles

Each block closes cleanly through the adaptive bridge and records usefulness, trust, edits, retained
prescriptions, and adaptations. Repaired history, manually seeded workouts, and test generations do not count.
The first real turnover after 2026-08-23 also owes the deferred PR #92 live smoke run —
[RECIPES § block turnover](docs/RECIPES.md#turn-over-a-block-end--retrospective--next-block), step 9.

The feature freeze ends only when the [charter's evidence gate](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#evidence-gate)
is fully met:

- five consecutive structurally valid varied-input test generations;
- four completed real blocks without manual structural repair;
- at least 80% of prescribed sessions retained substantially as generated;
- at least three independent athlete-specific adaptations reaching later decisions;
- at least one genuine refutation handled honestly;
- no unresolved calendar, data-integrity, or serious safety failures; and
- usefulness and trust feedback recorded after every block.

A serious safety or integrity failure resets the clean-cycle count. After six clean prospective
cycles, apply the charter's [falsification criteria](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#falsification-criteria)
instead of adding another subsystem.

### Phase 7 · Consolidate secondary-page UX

After Phase 5, audit the real tasks on Trends, Profile, Model, Settings, and Knowledge; then merge,
move, or remove only what the evidence supports. This phase may run while Phase 6 accumulates cycles.

### Phase 8 · Activate event work from reality

When a real A-event exists, build and live-test the smallest deterministic taper, event scoring
exceptions, and race-fueling support required. Until then, **6a**, event-anchored season mode, P1
event text, P4/P5 event-week overstack, and dormant event validators remain unscheduled.

### Phase 9 · Deliberately scheduled recovery and conveniences

Schedule off-machine backup and any convenience work only after the earlier evidence sequence or in
response to an accepted risk change. Hosting, authentication, accounts, multi-athlete support,
wearables, and productization remain out of scope. After stabilization, maintenance is capped at
roughly two Codex sessions or four hours monthly; simplify, freeze, or remove a subsystem that
repeatedly exceeds it.

## Stable handles now deferred or evidence-gated

| Handle | Current disposition |
|---|---|
| **#2 · Per-athlete calibration** | No longer the keystone. Add a derivation only after discriminating prospective evidence exists. |
| **#10 · Conversational refinement** | Frozen until repeated, localized plan-rejection evidence exists. |
| **Track A · power anchors/references** | Deferred; no current evidence justifies expanding calibration depth. |
| **Track B · RaceSim cadence** | Deferred until real use demonstrates under-delivery. |
| **Track C · fueling** | Phase 5 only; nutrition validation owns its priority. |
| **§5 · athlete-state slivers** | Phase 2 only when a measured core-journey problem requires them. |
| **#3 · proactive reschedule slivers** | Frozen unless required to repair a demonstrated safety or core-journey failure. |
| **P8 · AI-route cost guard** | Phase 9 convenience unless actual cost becomes a trust or availability problem. |
| **SUB-2 · legacy backfill importer** | Paused; revisit only if manual relabeling proves painful. |
| **§6 · nutrition remainder** | Phase 5 only. |
| **§7 · calendar flexibility remainder** | Deferred; Phase 1 fixes integrity at the existing boundary only. |
| **P3d / P3e / P6** | Deliberately not built; no evidence yet justifies new code. |
| **P7 · urgency before app history** | Documented limitation; reopen only if goal-driven blocks stop masking it in real use. |
| **Event-date validator exclusion** | Accepted priority-blind limitation; remains dormant with event mode. |
| **Compound climb+descent matching** | Blocked on a trustworthy gradient data source and design review. |
| **Segment grading fidelity** | `gradeSegment` (`lib/intent-scoring.ts`) ships binary zone matching with per-component full-compliance precision; the design spec's adjacent-zone partial credit and middle-half-of-band precision criterion ([§ Component grading](docs/superpowers/specs/2026-08-19-segment-aware-intent-scoring-design.md#component-grading)) is not implemented. Either implement it or formally re-decide the simpler shipped semantics via a [decision record](docs/DECISIONS.md). |
| **Subjective-wellness follow-ons** | Form retirement needs measured Phase 2 friction; strain derivation needs motivation provenance and discriminating evidence. |

Mobile density polish remains evidence-gated. Rejected alternatives stay in [ADR-0012](docs/DECISIONS.md#adr-0012--rejected-alternatives-a-running-log).
