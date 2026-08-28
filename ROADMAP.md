# NodeVelo roadmap

*Last reconciled 2026-08-27.* The forward backlog — open work only.

Phase charter: [accepted adversarial investment review](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md).
The adversarial review is the **master decision record for the freeze**. Its
[board judgment](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#board-judgment),
[target product thesis](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#target-product-thesis),
[ranked risks](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ranked-risks),
[decisions](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#decisions-made),
[feature disposition](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#feature-disposition),
[evidence gate](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#evidence-gate),
and [falsification criteria](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#falsification-criteria)
govern this roadmap. Each package below links to the exact governing section;
the roadmap operationalizes those decisions and does not replace them.
Live bugs → [todo.md](todo.md) · shipped detail → [ARCHIVE.md](ARCHIVE.md) ·
decisions → [docs/DECISIONS.md](docs/DECISIONS.md) · architecture → [docs/COMPASS.md](docs/COMPASS.md).

IDs (`#1–4`, `§5–7`, `Track A–C`) are stable cross-reference handles. Never renumber them.

---

## State of the app

NodeVelo remains a personal, localhost-only cycling decision-support system for one informed
athlete. It is under a feature freeze while it earns prospective evidence. It is not a proven
self-correcting coach and is not being productized.

The main mechanical trust-contract repairs are shipped and recorded in
[the archive closeout](ARCHIVE.md#adversarial-review-trust-contract-closeout-2026-08-20--2026-08-27).
The freeze remains active because prospective evidence, restore honesty, core-journey validation,
Claude-authority reduction, library completion, nutrition validation, and real block cycles remain
open. Shipped mechanics are not evidence that NodeVelo improves decisions.

## Freeze implementation-plan queue

Status: **READY** may be planned now · **EVIDENCE** is an attended run/record, not a code plan ·
**BLOCKED** waits for its entry gate. Select the first READY package. One package produces one
design spec and one implementation plan unless its text explicitly says evidence-only.

### Phase 1 · Finish trust evidence and recovery honesty

#### FR-1 · Current-generation evidence run — EVIDENCE, next action

- **Review basis:** [evidence gate](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#evidence-gate),
  [plan safety](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#plan-safety-and-claudes-authority),
  and [physiology ownership](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#intervalsicu-ownership-privacy-and-recovery).
- **Verified current state:** publication and physiology gates are shipped; the evidence checklist
  remains open. `todo.md` still requires one live four-week generation to confirm loading-week
  hours.
- **Remaining outcome:** run one attended, current-code four-week generation and append its
  structural result, loading-week hour deltas, publication findings/verdict, physiology status,
  manual repairs, overview warnings, and Anthropic usage to the publication-gate evidence log.
- **Entry gate:** current Anthropic credit and synthetic or explicitly approved athlete data.
- **Plan scope:** no implementation plan exists because this is an attended evidence run, not code
  work. Run the current generation and record it in
  `docs/reviews/2026-08-24-publication-gate-evidence.md`.
- **Exit evidence:** one dated evidence-log entry plus the loading-hours todo disposition. This
  run may count toward varied-input structural evidence; it does not count as a completed real
  block.
- **Non-goals:** prompt/model/provider tuning, feature work, or treating one successful run as
  coaching effectiveness.

#### FR-2 · Restore and critical-state honesty — READY, first implementation plan

- **Review basis:** [calendar and persistence integrity](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#calendar-and-persistence-integrity),
  ranked risks [#8 and #10](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ranked-risks),
  and decision [Q20/Q31](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Verified current state:** `lib/backup.ts`, `app/api/export/route.ts`, and
  `app/api/import/route.ts` export/import the bundle; optional snapshots run from
  `app/api/sync/route.ts`. Restore is file-by-file, while `lib/json-store.ts` protects only its
  critical JSON set, `lib/data-store.ts` defines typed stores, and `lib/kb-loader.ts` owns direct
  knowledge-base and retrospective writes.
- **Remaining outcome:** write one implementation plan that inventories athlete-owned state,
  defines partial-restore behavior, aligns knowledge-base restoration with atomic-store guarantees
  where justified, and makes UI/docs truthful about unrecoverable cases.
- **Entry gate:** none.
- **Plan scope:** `lib/backup.ts`, `lib/json-store.ts`, `lib/data-store.ts`, `lib/kb-loader.ts`,
  `app/api/export/route.ts`, `app/api/import/route.ts`, and `app/api/sync/route.ts`; their
  `*.test.ts` coverage; `components/BackupRestore.tsx` and `app/settings/page.tsx`; and
  `docs/systems/01-sync-and-data.md`, `docs/FILE_INDEX.md`, and `docs/RECIPES.md`.
- **Exit evidence:** destructive-path tests for the accepted recovery contract, a current
  critical-state coverage table, and user-facing copy matching actual guarantees.
- **Non-goals:** transactional database migration, hosted backup, authentication, or automatically
  configuring off-machine storage.

### Phase 2 · Make the core journey excellent

#### FR-3 · Core-journey task audit — BLOCKED until FR-1 and FR-2 close

- **Review basis:** [UX findings](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ux-and-abandoned-surfaces),
  [expand now](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#expand-now),
  and decision [Q29/Q39](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Verified current state:** Today, Plan, the ride closeout, and the adaptive-week path are live;
  FR-1 and FR-2 are still open, so their evidence and recovery boundaries are not yet closed.
- **Remaining outcome:** observe Today → Plan → ride → closeout → adaptive week as tasks; record
  failures, confusion, avoidable prose, lost-state risks, and latency before proposing changes.
- **Entry gate:** FR-1 and FR-2 closed.
- **Plan scope:** no implementation plan exists until this audit selects a failure. The audit covers
  `app/today/page.tsx`, `app/plan/page.tsx`, `app/api/retrospective/route.ts`, and the adaptive
  path in `lib/season.ts`; its findings record is the decision surface for FR-4.
- **Exit evidence:** task-by-task findings ranked by correctness, completion failure, and repeated
  friction; no aesthetic-only backlog.
- **Non-goals:** page consolidation, new surfaces, or implementation during the audit.

#### FR-4 · Core-journey fixes — BLOCKED on FR-3 evidence

- **Review basis:** [UX findings](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ux-and-abandoned-surfaces),
  [expand now](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#expand-now),
  and decision [Q29/Q39](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Verified current state:** no independently evidenced FR-3 failure has been selected, and all
  current journey surfaces remain pending that audit.
- **Remaining outcome:** select exactly one independently evidenced FR-3 failure and create one new
  additive FR-* package, design spec, and implementation plan for that failure.
- **Entry gate:** FR-3 exit evidence with one ranked failure selected.
- **Plan scope:** the selected FR-3 finding, its owning current journey files, and the new additive
  FR-* package/spec/plan only; no implementation plan exists before selection.
- **Exit evidence:** one selected finding cites FR-3 evidence; one new additive package/spec/plan
  targets it; repeated task completion no longer shows that failure without regressing publication
  or turnover gates.
- **Non-goals:** a portfolio of fixes, unrelated UI polish, or scope not supported by the selected
  FR-3 evidence.

### Phase 3 · Reduce Claude's generation authority

#### FR-5 · Deterministic-authority audit and replacement plan — BLOCKED until Phase 2 closes

- **Review basis:** [plan safety and Claude authority](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#plan-safety-and-claudes-authority),
  [decision Q26/Q36/Q42](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53),
  and [falsification criteria](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#falsification-criteria).
- **Verified current state:** four Anthropic call categories remain: block generation,
  ride-analysis coach note, prose retrospective, and structured retrospective. The critic and Ask
  Coach calls are gone.
- **Remaining outcome:** classify each remaining output as deterministic fact/process, constrained
  composition, free-form interpretation, or optional explanation; plan replacements only where code
  can own the result more reliably.
- **Entry gate:** Phase 2 closed.
- **Plan scope:** `app/api/generate/route.ts`, `app/api/analyze/route.ts`, and
  `app/api/retrospective/route.ts`; `lib/anthropic-api.ts`, `lib/anthropic-prompts.ts`,
  `lib/plan-schema.ts`, and `lib/retrospective-schema.ts`; and the authority boundary in
  `docs/systems/06-generation.md` and `docs/systems/07-ai-layer.md`.
- **Exit evidence:** five consecutive structurally valid varied-input generations, a deterministic
  core useful without Anthropic, and no arithmetic/protocol/progression authority left solely to
  prose.
- **Non-goals:** replacing genuinely linguistic interpretation, broad prompt rewrites, or adding
  another AI call.

#### FR-6 · Provider/model/cost experiment — SEPARATE, BLOCKED on FR-5 baseline

- **Review basis:** [maintainability](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#maintainability)
  and decision [Q5/Q11](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Verified current state:** `lib/anthropic-config.ts` and `lib/ai-usage.ts` provide the current
  provider/configuration and usage surfaces; no FR-5 deterministic baseline exists yet.
- **Remaining outcome:** hold inputs and prompts constant; compare validity, publication findings,
  usefulness, latency, and cost. Change a live route only if measured results justify it.
- **Entry gate:** FR-5 baseline closed.
- **Plan scope:** `lib/anthropic-config.ts`, `lib/anthropic-api.ts`, `lib/ai-usage.ts`,
  `app/api/generate/route.ts`, and the publication-gate evidence record; preserve the FR-5
  deterministic-authority decision surface.
- **Exit evidence:** a recorded fixed-input comparison with validity, publication findings,
  usefulness, latency, and cost; any live-route change is justified by that record.
- **Non-goals:** mixing vendor/model tuning into deterministic cleanup.

### Phase 4 · Complete the narrow workout-library loop

#### FR-7 · Manual curated-library completion — BLOCKED until Phase 3 closes

- **Review basis:** [feature disposition](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#expand-now)
  and decisions [Q17/Q45](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Verified current state:** workout-library storage, service/export helpers, and API routes exist,
  but the review found no complete user-facing or generation-time loop.
- **Remaining outcome:** one plan covering explicit curation, deterministic selection, generation
  reuse, management, and accepted-use recording.
- **Entry gate:** Phase 3 closed.
- **Plan scope:** `lib/workout-library.ts`, `lib/workout-library-service.ts`,
  `lib/workout-library-export.ts`, `app/api/workout-library/route.ts`,
  `app/api/workout-library/[id]/route.ts`, `app/api/generate/route.ts`, and
  `docs/systems/06-generation.md`.
- **Exit evidence:** the athlete can curate, reuse, inspect provenance, accept a generated use,
  and see that use recorded.
- **Non-goals:** automatic promotion or broad historical bootstrapping.

### Phase 5 · Validate nutrition prospectively

#### FR-8 · Nutrition evidence contract and daily carbohydrate slice — BLOCKED until Phase 4 closes

- **Review basis:** [nutrition findings](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#nutrition),
  ranked risk [#5](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ranked-risks),
  and decisions [Q18/Q27/Q28/Q35](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Verified current state:** `lib/nutrition.ts` and `lib/nutrition-validate.ts` provide the
  deterministic model and safeguards; `docs/systems/09-nutrition.md` records the accepted
  uncertainty and remaining validation boundary.
- **Remaining outcome:** plan prospective validation against the accepted monthly weight range while
  tracking energy, recovery, adherence, and workout quality separately; implement only the remaining
  narrow daily-carbohydrate product slice needed for that validation.
- **Entry gate:** Phase 4 closed.
- **Plan scope:** `lib/nutrition.ts`, `lib/nutrition-validate.ts`, `lib/calibration.ts`,
  `app/api/sync/route.ts`, the current nutrition UI, and `docs/systems/09-nutrition.md`; retain the
  review's monthly-range, pause/override, and RMR-floor decision surfaces.
- **Exit evidence:** long-window results, capped movement, visible reasoning, immediate
  pause/override, and RMR floor retained.
- **Non-goals:** metabolic-truth claims or new calibration dimensions without discriminating
  evidence.

### Phase 6 · Run four real block cycles

#### FR-9 · Prospective cycle evidence — EVIDENCE, accumulates throughout the freeze

- **Review basis:** [evidence gate](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#evidence-gate)
  and [falsification criteria](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#falsification-criteria).
- **Verified current state:** prospective-cycle evidence is incomplete; the review recorded only one
  complete self-correcting turnover and no honest refutation.
- **Remaining outcome:** complete four clean real blocks with retention, usefulness, trust, edits,
  independent adaptations, and at least one honest refutation recorded.
- **Entry gate:** a real block begins; this package may accumulate while earlier phase gates close.
- **Plan scope:** no implementation plan exists because this is attended prospective evidence. Record
  each real block in the
  [publication-gate evidence log](docs/reviews/2026-08-24-publication-gate-evidence.md), including
  `data/block-history.json`, `data/intervention-log.json`, and the review's evidence-gate criteria.
- **Exit evidence:** every evidence-gate row satisfied. A serious safety/integrity failure resets
  the clean-cycle count.
- **Non-goals:** counting test generations, repaired history, manually seeded workouts, or
  correlated intervention rows as independent evidence.

### Phase 7 · Consolidate secondary-page UX

#### FR-10 · Task-based secondary-page audit — BLOCKED until Phase 5; may overlap FR-9

- **Review basis:** [UX findings](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ux-and-abandoned-surfaces)
  and decision [Q34](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Verified current state:** Trends, Profile, Model, Settings, and Knowledge remain live pending a
  task-based audit; no observed secondary-page evidence selects a change.
- **Remaining outcome:** audit real tasks on Trends, Profile, Model, Settings, and Knowledge; merge,
  move, retain, or remove only from observed evidence.
- **Entry gate:** Phase 5 closed; FR-9 may continue in parallel.
- **Plan scope:** no implementation plan exists until the audit selects a failure. Audit
  `app/trends/page.tsx`, `app/profile/page.tsx`, `app/model/page.tsx`, `app/settings/page.tsx`, and
  `app/knowledge/page.tsx` against the review's retain-and-simplify decision surface.
- **Exit evidence:** task findings name the retained, moved, merged, or removed surface and cite
  observed evidence rather than preference.
- **Non-goals:** pre-deciding page deletion or aesthetic redesign.

### Phase 8 · Activate event work from reality

#### FR-11 · Real A-event minimum slice — BLOCKED until a real A-event exists

- **Review basis:** [deferred feature disposition](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#defer)
  and decisions [Q22/Q32/Q38](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Verified current state:** event shaping is deliberately dormant; current season and nutrition
  systems have no real A-event requirements to satisfy.
- **Remaining outcome:** plan the smallest deterministic taper, event-scoring exceptions, and race
  fueling required by the actual event.
- **Entry gate:** a real A-event with date, demands, and athlete intent.
- **Plan scope:** no implementation plan exists before a real event. The eventual plan starts with
  `lib/season.ts`, `lib/intent-scoring.ts`, `lib/nutrition.ts`, and the actual event brief, bounded
  by the review's dormant-until-real-use decision.
- **Exit evidence:** one real-event plan defines and live-tests only the required taper, scoring
  exceptions, and fueling slice.
- **Non-goals:** speculative event architecture or dormant validators without live requirements.

### Phase 9 · Deliberately schedule recovery and conveniences

#### FR-12 · Off-machine recovery and accepted conveniences — DEFERRED

- **Review basis:** ranked risk [#10](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ranked-risks)
  and decisions [Q20/Q31](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#interview-decision-record--q1q53).
- **Verified current state:** off-machine snapshots are optional via `lib/backup.ts`; the review
  accepts their absence as a personal-use risk, and conveniences remain deferred.
- **Remaining outcome:** schedule off-machine recovery or convenience work only after an explicit
  accepted-risk change or the earlier freeze sequence.
- **Entry gate:** an explicit accepted-risk change or completion of the earlier freeze sequence.
- **Plan scope:** no implementation plan exists because this is DEFERRED. The record scope is the
  accepted-risk decision, `ROADMAP.md`, and `lib/backup.ts` for recovery; convenience scope must be
  named only when scheduled.
- **Exit evidence:** an accepted-risk record or completed earlier sequence identifies one scheduled
  recovery/convenience slice and its evidence.
- **Non-goals:** hosting, accounts, multi-athlete support, wearables, or productization.

## Stable handles now deferred or evidence-gated

- **#2 · Per-athlete calibration:** No longer the keystone. Add a derivation only after
  discriminating prospective evidence exists.
- **#10 · Conversational refinement:** Frozen until repeated, localized plan-rejection evidence
  exists.
- **Track A · power anchors/references:** Deferred; no current evidence justifies expanding
  calibration depth.
- **Track B · RaceSim cadence:** Deferred until real use demonstrates under-delivery.
- **Track C · fueling:** Phase 5 only; nutrition validation owns its priority.
- **§5 · athlete-state slivers:** Phase 2 only when a measured core-journey problem requires them.
- **#3 · proactive reschedule slivers:** Frozen unless required to repair a demonstrated safety or
  core-journey failure.
- **P8 · AI-route cost guard:** Phase 9 convenience unless actual cost becomes a trust or
  availability problem.
- **P9 · stream `/api/generate`:** Phase 2 only if it removes measured core-journey latency.
- **SUB-2 · legacy backfill importer:** Paused; revisit only if manual relabeling proves painful.
- **§6 · nutrition remainder:** Phase 5 only.
- **§7 · calendar flexibility remainder:** Deferred; Phase 1 fixes integrity at the existing
  boundary only.
- **P3d / P3e / P6:** Deliberately not built; no evidence yet justifies new code.
- **P7 · urgency before app history:** Documented limitation; reopen only if goal-driven blocks
  stop masking it in real use.
- **6a, P1 event text, P4/P5 event-week overstack, event-date validator exclusion:** Dormant until
  a real A-event; the validator exclusion remains an accepted priority-blind limitation.
- **Compound climb+descent matching:** Blocked on a trustworthy gradient data source and design
  review.
- **Segment grading fidelity:** `gradeSegment` (`lib/intent-scoring.ts`) ships binary zone matching
  with per-component full-compliance precision; [adjacent-zone partial credit and middle-half
  precision](docs/superpowers/specs/2026-08-19-segment-aware-intent-scoring-design.md#component-grading)
  remain an implement-or-re-decide boundary via [a decision record](docs/DECISIONS.md).
- **Subjective-wellness follow-ons:** Form retirement needs measured Phase 2 friction; strain
  derivation needs motivation provenance and discriminating evidence.
- **Adaptive self-directed coach — Phase 4:** One-time human-reviewed, provenance-bearing
  historical repair through overlays only; never rewrites the ledger or counts as prospective
  effectiveness evidence.

Mobile density polish remains evidence-gated. Rejected alternatives stay in [ADR-0012](docs/DECISIONS.md#adr-0012--rejected-alternatives-a-running-log).
