# NodeVelo roadmap

*Last reconciled 2026-08-27.* The forward backlog — open work only.

Phase charter: [accepted adversarial investment review](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md).
The adversarial review is the **master decision record for the freeze**. Its board judgment, target product thesis, ranked risks, accepted decisions, feature disposition, evidence gate, and falsification criteria govern this roadmap. Each package below links to the exact governing section; the roadmap operationalizes those decisions and does not replace them.
Live bugs → [todo.md](todo.md) · shipped detail → [ARCHIVE.md](ARCHIVE.md) · decisions → [docs/DECISIONS.md](docs/DECISIONS.md) · architecture → [docs/COMPASS.md](docs/COMPASS.md).

IDs (`#1–4`, `§5–7`, `Track A–C`) are stable cross-reference handles. Never renumber them.

---

## State of the app

NodeVelo remains a personal, localhost-only cycling decision-support system for one informed athlete. It is under a feature freeze while it earns prospective evidence. It is not a proven self-correcting coach and is not being productized.

The main mechanical trust-contract repairs are shipped and recorded in [the archive closeout](ARCHIVE.md#adversarial-review-trust-contract-closeout-2026-08-20--2026-08-27). The freeze remains active because prospective evidence, restore honesty, core-journey validation, Claude-authority reduction, library completion, nutrition validation, and real block cycles remain open. Shipped mechanics are not evidence that NodeVelo improves decisions.

## Freeze implementation-plan queue

Status: **READY** may be planned now · **EVIDENCE** is an attended run/record, not a code plan · **BLOCKED** waits for its entry gate. Select the first READY package. One package produces one design spec and one implementation plan unless its text explicitly says evidence-only.

### Phase 1 · Finish trust evidence and recovery honesty

#### FR-1 · Current-generation evidence run — EVIDENCE, next action

- **Review basis:** [evidence gate](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#evidence-gate), [plan safety](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#plan-safety-and-claudes-authority), and [physiology ownership](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#intervalsicu-ownership-privacy-and-recovery).
- **Current state:** publication and physiology gates are shipped; the evidence checklist remains open. `todo.md` still requires one live four-week generation to confirm loading-week hours.
- **Outcome:** run one attended, current-code four-week generation and append the structural result, loading-week hour deltas, publication findings/verdict, physiology status, manual repairs, overview warnings, and Anthropic usage to the publication-gate evidence log.
- **Entry gate:** current Anthropic credit and synthetic or explicitly approved athlete data.
- **Exit evidence:** one dated evidence-log entry plus the loading-hours todo disposition. This run may count toward varied-input structural evidence; it does not count as a completed real block.
- **Non-goals:** prompt/model/provider tuning, feature work, or treating one successful run as coaching effectiveness.

#### FR-2 · Restore and critical-state honesty — READY, first implementation plan

- **Review basis:** [calendar and persistence integrity](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#calendar-and-persistence-integrity), ranked risks [#8 and #10](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ranked-risks), and decision [Q20/Q31](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Current state:** export/import and optional off-machine snapshots exist; restore remains file-by-file and the critical set/recovery promise needs an explicit current audit.
- **Outcome:** write one implementation plan that inventories athlete-owned state, defines partial-restore behavior, aligns knowledge-base restoration with atomic store guarantees where justified, and makes UI/docs truthful about unrecoverable cases.
- **Entry gate:** none.
- **Exit evidence:** destructive-path tests for the accepted recovery contract, current critical-state coverage table, and user-facing copy matching actual guarantees.
- **Non-goals:** transactional database migration, hosted backup, authentication, or automatically configuring off-machine storage.

### Phase 2 · Make the core journey excellent

#### FR-3 · Core-journey task audit — BLOCKED until FR-1 and FR-2 close

- **Review basis:** [UX findings](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ux-and-abandoned-surfaces), [expand now](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#expand-now), and decision [Q29/Q39](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Outcome:** observe Today → Plan → ride → closeout → adaptive week as tasks; record failures, confusion, avoidable prose, lost-state risks, and latency before proposing changes.
- **Exit evidence:** task-by-task findings ranked by correctness, completion failure, and repeated friction. No aesthetic-only backlog.
- **Non-goals:** page consolidation, new surfaces, or implementation during the audit.

#### FR-4 · Core-journey fixes — BLOCKED on FR-3 evidence

- **Review basis:** [UX findings](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ux-and-abandoned-surfaces), [expand now](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#expand-now), and decision [Q29/Q39](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Outcome:** write one implementation plan per independently evidenced journey failure; never bundle unrelated UI polish.
- **Exit evidence:** repeated task completion without the targeted failure and no regression to publication/turnover gates.
- **Non-goals:** scope not supported by FR-3 evidence.

### Phase 3 · Reduce Claude's generation authority

#### FR-5 · Deterministic-authority audit and replacement plan — BLOCKED until Phase 2 closes

- **Review basis:** [plan safety and Claude authority](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#plan-safety-and-claudes-authority), [decision Q26/Q36/Q42](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53), and [falsification criteria](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#falsification-criteria).
- **Current state:** exactly four Anthropic call categories remain: block generation, ride-analysis coach note, prose retrospective, and structured retrospective. The critic and Ask Coach calls are gone.
- **Outcome:** classify each remaining output as deterministic fact/process, constrained composition, free-form interpretation, or optional explanation; plan replacements only where code can own the result more reliably.
- **Exit evidence:** five consecutive structurally valid varied-input generations, deterministic core useful without Anthropic, and no arithmetic/protocol/progression authority left solely to prose.
- **Non-goals:** replacing genuinely linguistic interpretation, broad prompt rewrites, or adding another AI call.

#### FR-6 · Provider/model/cost experiment — SEPARATE, BLOCKED on FR-5 baseline

- **Review basis:** [maintainability](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#maintainability) and decision [Q5/Q11](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Outcome:** hold inputs and prompts constant; compare validity, publication findings, usefulness, latency, and cost. Change a live route only if measured results justify it.
- **Non-goals:** mixing vendor/model tuning into deterministic cleanup.

### Phase 4 · Complete the narrow workout-library loop

#### FR-7 · Manual curated-library completion — BLOCKED until Phase 3 closes

- **Review basis:** [feature disposition](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#expand-now) and decisions [Q17/Q45](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Outcome:** one plan covering explicit curation, deterministic selection, generation reuse, management, and accepted-use recording.
- **Exit evidence:** athlete can curate, reuse, inspect provenance, accept a generated use, and see that use recorded.
- **Non-goals:** automatic promotion or broad historical bootstrapping.

### Phase 5 · Validate nutrition prospectively

#### FR-8 · Nutrition evidence contract and daily carbohydrate slice — BLOCKED until Phase 4 closes

- **Review basis:** [nutrition findings](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#nutrition), ranked risk [#5](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ranked-risks), and decisions [Q18/Q27/Q28/Q35](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Outcome:** plan prospective validation against the accepted monthly weight range while tracking energy, recovery, adherence, and workout quality separately; implement only the remaining narrow daily-carbohydrate product slice needed for that validation.
- **Exit evidence:** long-window results, capped movement, visible reasoning, immediate pause/override, and RMR floor retained.
- **Non-goals:** metabolic-truth claims or new calibration dimensions without discriminating evidence.

### Phase 6 · Run four real block cycles

#### FR-9 · Prospective cycle evidence — EVIDENCE, accumulates throughout the freeze

- **Review basis:** [evidence gate](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#evidence-gate) and [falsification criteria](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#falsification-criteria).
- **Outcome:** four clean real blocks with retention, usefulness, trust, edits, independent adaptations, and at least one honest refutation recorded.
- **Exit evidence:** every evidence-gate row satisfied. A serious safety/integrity failure resets the clean-cycle count.
- **Non-goals:** counting test generations, repaired history, manually seeded workouts, or correlated intervention rows as independent evidence.

### Phase 7 · Consolidate secondary-page UX

#### FR-10 · Task-based secondary-page audit — BLOCKED until Phase 5; may overlap FR-9

- **Review basis:** [UX findings](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ux-and-abandoned-surfaces) and decision [Q34](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Outcome:** audit real tasks on Trends, Profile, Model, Settings, and Knowledge; merge, move, retain, or remove only from observed evidence.
- **Non-goals:** pre-deciding page deletion or aesthetic redesign.

### Phase 8 · Activate event work from reality

#### FR-11 · Real A-event minimum slice — BLOCKED until a real A-event exists

- **Review basis:** [deferred feature disposition](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#defer) and decisions [Q22/Q32/Q38](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Outcome:** plan the smallest deterministic taper, event scoring exceptions, and race fueling required by the actual event.
- **Non-goals:** speculative event architecture or dormant validators without live requirements.

### Phase 9 · Deliberately schedule recovery and conveniences

#### FR-12 · Off-machine recovery and accepted conveniences — DEFERRED

- **Review basis:** ranked risk [#10](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ranked-risks) and decisions [Q20/Q31](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Outcome:** schedule off-machine recovery or convenience work only after an explicit accepted-risk change or the earlier freeze sequence.
- **Non-goals:** hosting, accounts, multi-athlete support, wearables, or productization.

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
| **P9 · stream `/api/generate`** | Phase 2 only if it removes measured core-journey latency. |
| **SUB-2 · legacy backfill importer** | Paused; revisit only if manual relabeling proves painful. |
| **§6 · nutrition remainder** | Phase 5 only. |
| **§7 · calendar flexibility remainder** | Deferred; Phase 1 fixes integrity at the existing boundary only. |
| **P3d / P3e / P6** | Deliberately not built; no evidence yet justifies new code. |
| **P7 · urgency before app history** | Documented limitation; reopen only if goal-driven blocks stop masking it in real use. |
| **6a, P1 event text, P4/P5 event-week overstack, event-date validator exclusion** | Dormant until a real A-event; the validator exclusion remains an accepted priority-blind limitation. |
| **Compound climb+descent matching** | Blocked on a trustworthy gradient data source and design review. |
| **Segment grading fidelity** | `gradeSegment` (`lib/intent-scoring.ts`) ships binary zone matching with per-component full-compliance precision; [adjacent-zone partial credit and middle-half precision](docs/superpowers/specs/2026-08-19-segment-aware-intent-scoring-design.md#component-grading) remain an implement-or-re-decide boundary via [a decision record](docs/DECISIONS.md). |
| **Subjective-wellness follow-ons** | Form retirement needs measured Phase 2 friction; strain derivation needs motivation provenance and discriminating evidence. |
| **Adaptive self-directed coach — Phase 4** | One-time human-reviewed, provenance-bearing historical repair through overlays only; never rewrites the ledger or counts as prospective effectiveness evidence. |

Mobile density polish remains evidence-gated. Rejected alternatives stay in [ADR-0012](docs/DECISIONS.md#adr-0012--rejected-alternatives-a-running-log).
