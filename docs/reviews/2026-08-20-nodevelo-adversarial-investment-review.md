# NodeVelo adversarial investment review

**Date:** 2026-08-20  
**Status:** Accepted review and product-decision record  
**Repository snapshot:** `d3dd228`  
**Scope:** Product coherence, coaching evidence, safety, AI boundaries, Intervals.icu ownership,
persistence, privacy, recovery, UX, architecture, maintainability, feature scope, and investment merit.

This is a point-in-time review, not a claim that its recommended work has shipped. Running code and
recorded evidence were treated as stronger than roadmap or marketing claims. The repository was
inspected read-only, the local application was walked through, and `npm run check` passed at the
audited snapshot: 113 test files, 2,292 tests, typecheck, lint, and link validation.

## Board judgment

Continue investing in NodeVelo, but only as a bounded personal decision-support system undergoing
stabilization and prospective validation.

It is not ready for productization, and the evidence does not support calling it a proven
self-correcting coach. Engineering quality is substantially ahead of coaching evidence. The right
investment is reliability, simplification, UX, and evidence rather than more surface area.

## Target product thesis

> NodeVelo is a local-first cycling decision-support system for one informed athlete. It turns
> Intervals.icu physiology, structured athlete intent, and accumulated execution evidence into
> auditable, human-approved training blocks and adaptations. Deterministic code owns arithmetic,
> workout syntax, constraints, provenance, and safety. AI is limited to genuinely linguistic
> interpretation and clearly labeled suggestions. NodeVelo earns the right to adapt only through
> prospective evidence.

Its primary job is:

> Generate and adapt coherent training blocks that improve from the athlete's accumulated execution
> evidence.

Supporting jobs, in order:

1. Prevent underfueling through personalized but explicitly uncertain estimates.
2. Explain whether training is working.
3. Recommend today's safest useful action.

## Evidence classification

### Facts

- The deterministic rides → scoring → model → generation → acceptance loop is mechanically real.
- The audited repository passed 2,292 tests across 113 files plus typecheck, lint, and link checks.
- Only one complete self-correcting turnover had occurred.
- Six recorded intervention outcomes represented only two repeated hypothesis families rather than
  six independent coaching experiments.
- Four outcomes validated, two were inconclusive, none refuted, and the demotion path had never
  fired.
- The UI displayed causal-sounding `100% right` language from this thin, correlated evidence.
- Claude still authored consequential interval content despite the README's broader `LLM only does
  language` description.
- Clear plan warnings could be published to the calendar without a violation-specific approval.
- Generation took roughly one to two minutes and regeneration was stateless beyond a short dedupe
  window.
- Event shaping existed but was disabled.
- The workout library had substrate but no complete user-facing or generation-time loop.
- Off-machine backup was optional and not configured at the audit snapshot.
- Ask Coach was not used because its answers did not demonstrate enough relevant plan context to be
  credible to the athlete. The route did load the shared coach snapshot plus today's and the next
  prescribed session; the observed quality failure was narrower than total context absence.

### Inferences

- NodeVelo's strongest current value is disciplined synthesis for a knowledgeable athlete, not
  autonomous coaching.
- The strongest differentiator is inspectable, human-approved memory and adaptation, not AI plan
  generation by itself.
- Current `coach accuracy` is associational and pseudo-replicated rather than causal evidence.
- A large active documentation system is valuable to agents but has become a second product the
  maintainer must keep synchronized.
- The current architecture is coherent only while one athlete, one trusted machine, localhost, and
  one process remain hard boundaries.

### Assumptions accepted for the next phase

- The athlete is an informed reviewer and retains final coaching authority.
- Daily intake logging is unusually complete and accurate, with several weigh-ins per week.
- A monthly weight-maintenance range already exists and is the observable nutrition target.
- Manually curated historical workouts can safely bootstrap the library if labeled as imported,
  not learned.
- The maintainer accepts deferring off-machine backup as a conscious personal-use risk.

### Unknowns

- Whether learned adaptations improve decisions, adherence, performance, safety, or trust compared
  with a simpler generator using current physiology, goals, and recent execution only.
- Whether the library improves session quality enough to justify its permanent complexity.
- Whether adaptive no-block mode consistently changes useful decisions.
- Whether nutrition calibration predicts the desired monthly weight trajectory without frequent
  manual correction.
- Whether a repeatable market exists, how NodeVelo compares with commercial coaching products, and
  whether anyone beyond the current athlete would pay for it.

## Sanitized evidence map

The code and committed docs below are durable at the audited SHA. Claims sourced from `data/` came
from the athlete's gitignored local snapshot on 2026-08-20; only aggregates are recorded here, so a
future reader can identify the source category without committing private athlete records.

| Finding | Durable source | Private snapshot source, where applicable |
|---|---|---|
| One complete turnover; four validated, two inconclusive, no refutation | [ROADMAP state](../../ROADMAP.md#state-of-the-app), [intervention evaluation](../../lib/intervention.ts) | `data/intervention-log.json`, `data/block-history.json` |
| Calendar mirror runs before the guarded local merge | [calendar mirror](../../lib/calendar-mirror.ts), [local-first invariant](../INVARIANTS.md) | — |
| Publication checks are partial and non-gating | [write route](../../app/api/write/route.ts), [generation pipeline](../systems/06-generation.md) | — |
| Retrospective progression used duration ratios and Claude causal prose | [retrospective route](../../app/api/retrospective/route.ts), [retrospective schema](../../lib/retrospective-schema.ts) | `data/block-history.json` |
| Named-segment interpretation used Claude before deterministic evidence matching | [historical design](../superpowers/specs/2026-08-19-segment-aware-intent-scoring-design.md), [intent scoring](../../lib/intent-scoring.ts) | `data/intent-overlays.json`, `data/last-sync.json` |
| Nutrition has known identifiability, historical-target, and weight-offset limits | [nutrition system](../systems/09-nutrition.md), [nutrition engine](../../lib/nutrition.ts) | `data/last-sync.json`, `data/calibration.json` |
| Ask Coach already received a shared snapshot plus today's and next prescribed session | `app/api/ask/route.ts` (removed 2026-08; point-in-time path) | Athlete-reported output quality and non-use |
| Backup is optional and localhost/no-auth is a deliberate boundary | [README](../../README.md), [backup](../../lib/backup.ts), [CSRF guard](../../lib/csrf.ts) | `.env.local` configuration state |
| Test and source-size counts | Repository files at `d3dd228`; `npm run check` | — |

## Strongest assets

1. **Coherent ownership model.** Intervals.icu owns measured physiology, the athlete owns intent,
   and NodeVelo owns derived judgment.
2. **Deterministic and inspectable core.** Scoring, nutrition, readiness, plan composition,
   provenance, and persistence are mostly plain TypeScript with strong tests.
3. **Human approval boundary.** Generation proposes and a separate action commits.
4. **Immutable provenance.** Frozen ledger entries defend against silently rewriting history when
   FTP or scoring logic changes.
5. **Local-first suitability.** JSON storage, atomic writes, locks, and readable data are coherent
   for one athlete on one trusted machine.
6. **Honest internal record.** The repository documents failures, approximations, and rejected
   alternatives more candidly than most projects.
7. **Real personal relevance.** Block generation, adaptive weeks, nutrition, and daily guidance
   address genuine recurring decisions.

## Weakest assumptions

1. One turnover demonstrates self-correction.
2. Repeated correlated intervention records represent independent coaching successes.
3. Duration completion proves a workout was absorbed successfully.
4. Human review compensates for warn-only safety validation.
5. Weight-derived calibration approaches true metabolic accuracy.
6. More calibration and feature depth will repair weak evidence.
7. Claude can infer causal coaching lessons safely from aggregate facts.
8. Internal documentation reliably describes runtime behavior.
9. A sophisticated personal system will translate into a repeatable product.
10. The only machine carrying NodeVelo's memory will remain available.

## Detailed findings

### Learning evidence and causal claims

- The intervention log's six outcomes were concentrated in Overall and Z2 and reused similar later
  snapshots. They were not six independent trials.
- Validation could be attributed to execution or a physiology proxy improving without controlling
  for exposure, adherence, weather, concurrent directives, or other changes.
- Demotion counted decisive records while UI prose described blocks. Multiple related records from
  one block could therefore satisfy what appeared to be a multi-block threshold.
- The intervention physiology fallback admitted broad rides despite being described as steady
  endurance evidence.
- `100% right`, `proved right`, and similar claims exceeded the evidence and were rejected.

### Calendar and persistence integrity

- The invariant says the local plan commits before Intervals.icu is mirrored.
- `persistMirroredMove` called the calendar mirror before the lock-held CAS merge. A late conflict
  could therefore change Intervals.icu, return `409`, and leave NodeVelo unchanged.
- Atomic writes, per-file locks, corruption-aware reads, and one-deep `.bak` rotation were strong
  file-level protections.
- Restore was file-by-file rather than transactional, so a later failure could leave a partial
  restore. Knowledge-base restoration did not use the same atomic store path.
- Some athlete-owned state was outside the critical backup set.
- Same-disk backups did not protect against machine loss or unnoticed logical corruption.

### Plan safety and Claude's authority

- Deterministic code owned the weekly/day-slot skeleton and numeric tables, but Claude still authored
  interval prescriptions and exact durations inside envelopes.
- Most schedule and protocol validators warned rather than blocked.
- `/api/write` reran protocol and duration-consistency checks only after calendar publication so it
  could stamp findings. Those checks did not gate publication, and the broader
  schedule/skeleton/week/season validator suite was not rerun there.
- The narrative critic was best-effort and overview-only. It had caught one bad overview and missed
  another.
- The accepted boundary is now: malformed structure and clear protocol, spacing, or load-envelope
  hazards block publication; lower-confidence coaching preferences permit an explicit informed
  override.

### Retrospective and turnover

- Deterministic retrospective inputs included planned/actual duration, type-level duration ratios,
  load, CTL movement, selected aerobic evidence, and power-curve classification.
- Duration ratio was labeled compliance and could classify large overshoots as safe to progress.
- Recorded workouts at roughly 156–181% duration were described as having landed well even though
  other execution evidence conflicted.
- Claude-authored `root_cause` and `adjusted_strategy` values were schema-checked mainly for shape,
  not factual correspondence or causal validity.
- Those suggestions could enter future prompts as `clinical notes` without explicit athlete
  approval.
- Normal block completion or an explicit early-end decision must precede a minimal deterministic
  closeout. Claude prose remains optional.

### Named segments and intent parsing

- Intervals.icu interval sync already carried athlete labels and structured metrics including
  duration, average/normalized power, heart rate, gradient, cadence, elevation, and indices.
- Claude received only the note and ride duration, not the available Intervals labels or evidence.
- TypeScript later matched the Claude-extracted label to Intervals data and scored it.
- Explicit notes such as `Short Climb (5 min, Z4 average, Z5 NP)` can be parsed and grounded
  deterministically against actual labels.
- Ambiguous labels, missing labels, and API failure collapsed toward the same user-facing failure.
- Unstated segment components could receive credit because they remained in the denominator with
  positive defaults.
- Accepted boundary: exact curated Intervals labels plus constrained syntax are the authoritative
  scoreable lane. Arbitrary prose may receive AI interpretation but remains unscored unless
  deterministic grounding succeeds.

### Nutrition

- Nutrition was a genuine primary concern for the athlete, not a speculative adjacent feature.
- The model was deterministic and unusually explicit about approximation.
- Weight and intake cannot separately identify metabolism, logging bias, glycogen, water, creatine,
  illness, or body-composition effects.
- The repository documented an unexplained rest-versus-training difference and substantial
  sensitivity to sustained non-energy weight shifts.
- Historical prescription adherence was reconstructed approximately rather than read from a complete
  immutable target history.
- The accepted promise is personalized energy-balance decision support and conservative underfueling
  protection, not metabolic truth or guaranteed performance recovery.
- Automatic increases and decreases are allowed only through established long-window evidence,
  capped movement, visible reasoning, an immediate pause/override, and the RMR safety floor.

### Intervals.icu ownership, privacy, and recovery

- Intervals.icu remained the system of record for physiology and training data; NodeVelo stored a
  local derived ledger and athlete-owned intent.
- Sport-settings failure could retain stale FTP/zones silently.
- Accepted behavior: show when physiology was last confirmed, warn and continue with previously valid
  data during a temporary failure, and block only when physiology was never established, internally
  inconsistent, or explicitly obsolete.
- `local-first` did not mean `local-only`: generation and analysis sent athlete information to
  Anthropic.
- The privacy promise must disclose local persistence and remote AI processing separately.
- No authentication was acceptable only for localhost on one trusted machine. LAN, hosting,
  accounts, and multiple athletes require a separate product architecture.

### UX and abandoned surfaces

- Today, Plan, Trends, Profile, Model, Settings, and Knowledge were all used frequently, but only
  Today—especially adaptive mode—was immediately identified as changing decisions.
- The user reported general dissatisfaction with consistency, data clarity, visibility, layout,
  clutter, prose density, and information placement.
- All seven pages remain until a separate task-based UX audit determines what should merge, move, or
  disappear.
- Ask Coach failed its own job because its outputs did not use the supplied snapshot and limited
  current/next-session context well enough to satisfy the athlete. It is removed from the active UI
  during the freeze.
- Conversational refinement remains deferred until repeated localized plan-rejection evidence exists.
- Event shaping remains permanent scope but dormant until a real A-event supplies requirements and a
  live validation cycle.

### Maintainability

- The audit measured roughly 32,000 production lines, 28,000 test lines, and 64,000 Markdown lines.
- Runtime dependencies were restrained, deterministic modules were well tested, and the full suite
  remained fast.
- Behavior and rationale were distributed across code, system docs, invariants, ADRs, recipes,
  roadmap, archive, and immutable plans.
- The calendar invariant's contradiction with code proved that documentation volume did not guarantee
  current truth.
- After stabilization, ongoing maintenance is capped at roughly two Codex sessions or four hours per
  month. A subsystem repeatedly exceeding that budget must be simplified, frozen, or removed.
- This document received an independent Codex pre-PR review because Claude was unavailable. Current
  repository law still requires Claude review before a `codex/*` PR merges; changing that standing
  rule requires a separate update to `AGENTS.md` and `WORKFLOW.md`.

## Ranked risks

| Rank | Risk | Impact | Likelihood | Evidence |
|---:|---|---|---|---|
| 1 | Retrospectives teach unsafe or incorrect progression lessons | Critical | High | Observed in stored output |
| 2 | Calendar changes without matching local state after a conflict | High | Medium | Directly present in code |
| 3 | False causal claims corrupt trust and future learning | High | High | Current UI and intervention data |
| 4 | Unsafe or malformed plans remain publishable | High | Medium | Current warning/write boundary |
| 5 | Nutrition adjusts intake from confounded weight trends | High | Medium | Documented model limitations |
| 6 | Named-segment scoring gives false credit or misleading failures | Medium-high | High | Code and recorded parser evidence |
| 7 | AI root causes become self-reinforcing plan inputs | High | Medium | Current retrospective pipeline |
| 8 | Single-maintainer complexity prevents stabilization | High | High | Measured code/doc volume and bug history |
| 9 | Silent stale physiology influences prescriptions | High | Low-medium | Current fallback behavior |
| 10 | Machine loss destroys accumulated memory | High | Low-medium | Off-machine backup deferred |
| 11 | Generation latency and statelessness cause abandonment | Medium | High | Known latency; usage impact unknown |
| 12 | Productization proceeds without market evidence | High | Unknown | No market or comparative outcome evidence |

## Decisions made

- Personal, localhost-only instrument for now; productization is a separate future pivot.
- Decision support, not an autonomous coach.
- Feature freeze on new coaching surfaces.
- Trust-contract violations stop feature work.
- Historical ledger remains frozen; human-approved factual/intent corrections use provenance-bearing
  overlays and do not rewrite the original record.
- Repaired history may improve present state but cannot validate prospective effectiveness.
- Clear structural and safety hazards block publication.
- Athlete-specific learning must alter a later decision; passive display is observation.
- AI-authored causal lessons require explicit approval before influencing another block.
- Structured Intervals labels are authoritative for scoreable named segments.
- Event shaping remains dormant until a real A-event exists.
- Ask Coach is removed during the freeze.
- Conversational refinement stays frozen.
- All seven current pages remain pending a task-based UX audit.
- Active documentation keeps one canonical current description per subsystem.

## Feature disposition

### Expand now

- Deterministic workout syntax and protocol construction.
- Narrow, athlete-curated workout-library reuse.
- Prospective learning measurement.
- Nutrition validation against adequately logged monthly weight trends.
- The Today → Plan → ride → closeout → adaptive-week journey.
- Clear provenance and confidence throughout the UI.

### Retain and simplify

- Today, Plan, Trends, Profile, Model, Settings, and Knowledge.
- Adaptive no-block mode.
- Local JSON persistence.
- Human-approved plan publication.
- Nutrition as personalized decision support.
- Claude for genuinely free-form interpretation and concise, grounded explanation.

### Disable, remove, or rewrite

- Ask Coach during the feature freeze.
- `100% right`, `proved correct`, and similar causal accuracy claims.
- Unqualified individualized injury-risk language.
- Misleading claims that every plan constraint is hard.
- Automatic propagation of Claude-authored root causes.
- AI narrative criticism where deterministic prose can state the same facts.

### Defer

- Conversational plan refinement.
- Automatic workout promotion.
- Broad historical library bootstrapping beyond manual curation.
- Event shaping until a real A-event exists.
- Wearable integrations.
- New calibration dimensions without discriminating evidence.
- Automated off-machine backup, as an explicitly accepted personal-use risk.
- Hosting, authentication, accounts, and multi-athlete support.

## Recommended evidence-first sequence (point-in-time)

This is the review board's accepted recommendation, not a replacement for the repository's living
`ROADMAP.md`. It must be reconciled into that file in a separate, deliberate prioritization task
before it becomes the current operating backlog.

1. **Repair trust contracts.** Fix calendar/local ordering, retrospective progression, segment-scoring
   semantics, unsafe publication, stale-physiology visibility, causal claims, and partial-recovery
   risks.
2. **Make the core journey excellent.** The primary journey must work without confusion, lost plans,
   developer intervention, unexplained figures, or avoidable prose.
3. **Reduce Claude's generation authority.** Deterministic code owns syntax, arithmetic, templates,
   protocol validity, progression, and enforcement.
4. **Complete the narrow library loop.** Support explicit manual curation, deterministic selection,
   generation reuse, and accepted-use recording.
5. **Validate nutrition prospectively.** Judge it against the existing acceptable monthly weight
   range while tracking energy, recovery, adherence, and workout quality separately.
6. **Run four real block cycles.** Each block closes cleanly, passes through the adaptive bridge, and
   records usefulness, trust, edits, retained prescriptions, and adaptations.
7. **Consolidate secondary-page UX.** This may proceed any time after nutrition validation and does
   not need to wait for the four real cycles.
8. **Activate event work from reality.** When a real A-event exists, build and live-test the smallest
   deterministic taper and scoring exceptions required.
9. **Add backup and deferred conveniences when deliberately scheduled.**

## Evidence gate

The freeze does not end until NodeVelo has:

- Five consecutive structurally valid test generations across varied inputs.
- Four completed real blocks without manual structural repair.
- At least 80% of prescribed sessions retained substantially as generated.
- At least three independent athlete-specific adaptations reaching later decisions.
- At least one genuine refutation handled honestly.
- No unresolved calendar, data-integrity, or serious safety failures.
- Recorded usefulness and trust feedback after every block.

A serious safety or integrity failure resets the clean-cycle count. Test generations, manually
repaired history, and manually seeded workouts demonstrate mechanics; they do not count as
prospective product evidence.

## Falsification criteria

The central thesis is falsified—or must be sharply narrowed—if after six clean prospective cycles:

- Learned adaptations do not repeatedly change useful decisions.
- Plans still require frequent expert structural correction.
- The learning-enabled system performs no better than a simpler generator using current physiology,
  goals, and recent execution only.
- Athlete trust or adherence does not improve.
- The system cannot distinguish uncertainty from evidence strongly enough to exercise an honest
  refutation and demotion.
- Nutrition cannot keep maintenance weight within its predefined acceptable monthly range despite
  adequate logging, without repeated manual correction.
- Maintenance exceeds roughly two Codex sessions or four hours per month after stabilization.

If falsified, do not add another subsystem. Reduce NodeVelo to the parts that demonstrably work:
deterministic planning, transparent analysis, nutrition tracking, and athlete-approved decisions.

## Interview decision record — Q1–Q53

This appendix preserves the decision frontier without reproducing the entire conversation.

| Q | Decision |
|---:|---|
| 1 | NodeVelo remains a personal instrument until evidence justifies a separate product pivot. |
| 2 | It is decision support, not an autonomous coach. |
| 3 | Freeze new coaching surfaces; allow measurement, correctness, maintenance, and agreed core work. |
| 4 | Trust-contract violations automatically outrank features. |
| 5 | Recurring bug-fixing and AI-assisted development cost are material sustainability constraints. |
| 6 | `Finished` means reliable daily use, coherent block cycles, a working adaptive bridge, quality library reuse, useful trends, trustworthy nutrition, and the evidence gate below. |
| 7 | Priority order: block generation/learning, nutrition, explanation, then today's recommendation. |
| 8 | Frozen history stays intact; a one-off human-reviewed correction may cover the blockless period. |
| 9 | Clear structural and safety hazards block publication; lower-confidence preferences allow explicit override. |
| 10 | Current deployment remains one athlete on localhost; revisit architecture only for productization. |
| 11 | After stabilization, maintenance is capped near two Codex sessions or four hours monthly. |
| 12 | This document receives independent Codex pre-PR review while Claude is unavailable; current repository law still requires Claude before merge unless the workflow is changed separately. |
| 13 | Completion ambitions include consistent generation, the narrow library, nutrition quality, excellent UX, and resolved material rough edges; these are deliverables, not evidence by themselves. |
| 14 | Learning must use athlete-specific evidence to change later behavior; reuse, calibration, inference, prediction, and adaptation are named precisely. |
| 15 | After six clean prospective cycles, lack of useful adaptation or advantage over a simpler baseline falsifies or narrows the thesis. |
| 16 | Adaptive mode begins after normal completion or an explicit early end plus deterministic closeout. |
| 17 | The library is narrow: approved promotion, selection, reuse, and accepted-use recording; deterministic syntax is part of generation quality. |
| 18 | Nutrition accuracy is extremely important but is framed as personalized estimation, not metabolic truth or guaranteed performance. |
| 19 | Human-reviewed historical repair may inform the current model but is excluded from effectiveness claims. |
| 20 | Off-machine recovery is desirable but not required immediately for personal use. |
| 21 | Local persistence and outbound Anthropic processing must be disclosed separately. |
| 22 | Event preparation is permanent scope, but evidence and implementation wait for a real event. |
| 23 | Allowed stabilization work is restricted to trust/correctness, generation/library, nutrition, UX, measurement, adaptive learning, and conditional event work. |
| 24 | The feature-freeze exit uses the explicit prospective evidence gate in this document. |
| 25 | Memory, calibration, inference, prediction, and adaptation are not collapsed into one `learning` claim. |
| 26 | Deterministic code owns workout syntax, arithmetic, protocol templates, progression, and enforcement; Claude works inside those limits. |
| 27 | Nutrition success is judged against the existing acceptable monthly weight range with very complete intake logging and several weigh-ins weekly. |
| 28 | Nutrition may adjust up and down from long-window evidence, subject to safety boundaries. |
| 29 | `9/10 UX` is task-based and includes consistency, clarity, visibility, layout, restrained prose, and correct information placement. |
| 30 | Resolve safety, integrity, misleading claims, broken workflows, and repeated friction; document harmless rare limitations. |
| 31 | Backup remains permanent but last-priority scope and does not block personal-use completion. |
| 32 | Event shaping is not current work without a real A-event and live validation cycle. |
| 33 | Make the core journey 9/10 before unrelated features; complete the narrow library after the core UX foundation. |
| 34 | All seven pages are frequently used and remain until a separate UX audit; Today is the clearest current decision-changing page. |
| 35 | Automatic calorie decreases require the same long-window model plus capped movement, evidence, floor, and override safeguards. |
| 36 | Audit every AI call; retain AI only where language understanding or grounded synthesis earns it. |
| 37 | Show physiology freshness, warn and continue through temporary failure, and block only missing, inconsistent, or obsolete physiology. |
| 38 | Event shaping stays dormant until a real A-event. |
| 39 | The athlete judges UX through repeated task completion rather than an aesthetic score alone. |
| 40 | Keep one canonical active description per subsystem; historical plans are records, not competing guidance. |
| 41 | Remove false precision and causal `100% right` language; show evidence and sample size. |
| 42 | The deterministic core remains useful when Anthropic is unavailable. |
| 43 | Ask Coach's outputs did not use its supplied snapshot and limited current/next-session context credibly enough to earn continued active scope. |
| 44 | Conversational refinement remains frozen until repeated localized rejection evidence exists. |
| 45 | Explicitly curated older workouts may bootstrap the library but are labeled manual imports. |
| 46 | The expand/retain/remove/defer portfolio is the accepted review decision; it becomes an operating scope boundary only after reconciliation into the living roadmap. |
| 47 | Curated Intervals labels plus constrained syntax are the authoritative scoreable segment contract. |
| 48 | Segment scoring fails closed and distinguishes missing evidence, API failure, ambiguity, and absent labels; unstated targets receive no credit. |
| 49 | Duration alone cannot authorize progression; execution and meaningful compliance evidence are required. |
| 50 | Claude root causes and adjusted strategies require an explicit turnover approval before reuse. |
| 51 | Deterministic facts, AI narrative, and approved future seeds remain separate in the retrospective artifact. |
| 52 | Remove Ask Coach from the active UI during the freeze. |
| 53 | Recommend the sequence above, with secondary-page UX allowed independently after nutrition validation; reconcile it into the living roadmap separately. |

## Final conclusion

NodeVelo is coherent and worth further bounded investment as a personal instrument. Its deterministic
foundation, provenance, and human-control model are real assets.

It is not yet trustworthy as a learning coach, not yet maintainable enough to call finished, and not
evidenced as a product. The next version should contain fewer unsupported claims, fewer AI-owned
decisions, fewer active ambitions, and much stronger prospective evidence.

The implementation is sophisticated. The product must now earn that sophistication.
