# Freeze Roadmap Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `agent-orchestration` to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the accepted adversarial investment review into a current, plan-sized freeze-period dispatcher without duplicating or rewriting the master decision record.

**Architecture:** The [adversarial review](../../reviews/2026-08-20-nodevelo-adversarial-investment-review.md) remains the immutable master decision record. `ROADMAP.md` operationalizes it as ordered `FR-*` packages; `ARCHIVE.md` records work already shipped; `todo.md` retains only short live checks; `docs/COMPASS.md` routes future planning sessions to the first ready package.

**Tech Stack:** Markdown, repository link checker, Git, existing documentation ownership rules.

## Global Constraints

- The adversarial review's [board judgment](../../reviews/2026-08-20-nodevelo-adversarial-investment-review.md#board-judgment), [target product thesis](../../reviews/2026-08-20-nodevelo-adversarial-investment-review.md#target-product-thesis), [ranked risks](../../reviews/2026-08-20-nodevelo-adversarial-investment-review.md#ranked-risks), [decisions](../../reviews/2026-08-20-nodevelo-adversarial-investment-review.md#decisions-made), [feature disposition](../../reviews/2026-08-20-nodevelo-adversarial-investment-review.md#feature-disposition), [evidence gate](../../reviews/2026-08-20-nodevelo-adversarial-investment-review.md#evidence-gate), and [falsification criteria](../../reviews/2026-08-20-nodevelo-adversarial-investment-review.md#falsification-criteria) are binding.
- Do not edit the adversarial review, immutable plans, `CONTINUE.md`, `AGENTS.md`, or runtime code.
- `ROADMAP.md` is forward-only. Shipped work belongs in `ARCHIVE.md`.
- Preserve existing stable handles (`#1–4`, `§5–7`, `Track A–C`) and add, never recycle, `FR-*` package IDs.
- Evidence collection is not implementation. Test generations, repaired history, and manually seeded workouts do not count as prospective effectiveness evidence.
- Provider/model/cost experiments are a separate measured package from deterministic-authority cleanup.
- Keep blocked work blocked until its recorded trigger occurs.
- Use direct anchor links to the master review instead of reproducing its rationale.
- Prefer the smallest living-doc change that makes the next planning boundary unambiguous.

---

### Task 1: Record the shipped adversarial-review trust repairs

**Files:**
- Modify: `ARCHIVE.md`

**Interfaces:**
- Consumes: merged PRs #87, #92/#94, #96/#97, #101, and #103; master-review risks 1–4, 6–7, and 9.
- Produces: one compact shipped closeout that `ROADMAP.md` can link instead of repeating historical implementation detail.

- [ ] **Step 1: Verify each shipment against current history and code**

Run:

```bash
git log --oneline --all --grep='calendar trust\|retro trust\|segment intent\|publication gate\|physiology freshness\|claims ai cleanup'
rg -n "persistMirroredMove|reflectionsApprovedAt|evaluatePublicationGate|checkOverviewAgainstFacts|DataPrivacyCard" \
  lib app components docs/INVARIANTS.md
```

Expected: evidence for local-before-calendar persistence, retrospective adoption gates, deterministic segment scoring, publication gating, physiology freshness, deterministic overview checks, and privacy disclosure.

- [ ] **Step 2: Add one archive closeout**

Insert near the top of `ARCHIVE.md`, after the current leading shipped section:

```markdown
## Adversarial-review trust-contract closeout (2026-08-20 → 2026-08-27)

The accepted [adversarial investment review](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md)
remains the freeze's master decision record. The following implementation risks are now closed in
code; prospective effectiveness evidence remains open in ROADMAP `FR-1`.

| Review decision/risk | Shipped resolution |
|---|---|
| [Calendar/local divergence](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#calendar-and-persistence-integrity) | PR #87 commits local state before best-effort calendar mirroring and preserves CAS conflicts. |
| [Unsafe retrospective progression and self-reinforcing AI lessons](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#retrospective-and-turnover) | PRs #92/#94 separate deterministic closeout facts, optional AI prose, and explicitly adopted future seeds/reflections. |
| [Named-segment false credit](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#named-segments-and-intent-parsing) | PR #96 makes the authoritative labelled lane deterministic and evidence-backed; the simpler adjacent-zone grading contract remains an explicit deferred decision. |
| [Publishable structural/safety hazards](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#plan-safety-and-claudes-authority) | PR #97 adds the persisted publication gate: blockers refuse, preferences require acknowledgment, advisories remain informational. |
| [Silent stale physiology](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#intervalsicu-ownership-privacy-and-recovery) | PR #101 exposes freshness, permits temporary sync failure with last-valid data, and blocks missing, malformed, inconsistent, or obsolete physiology. |
| [Causal claims, redundant AI criticism, Ask Coach, and privacy ambiguity](docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md#disable-remove-or-rewrite) | PR #103 removes causal/injury-risk product claims and Ask Coach, replaces the narrative critic with deterministic warnings, labels retained AI prose, and separates local persistence from remote Anthropic processing. |
```

Do not copy the review's full reasoning into the archive.

- [ ] **Step 3: Verify archive links**

Run:

```bash
npm run check-links
git diff --check
```

Expected: no broken links and no whitespace errors.

- [ ] **Step 4: Commit**

```bash
git add ARCHIVE.md
git commit -m "docs: archive adversarial-review trust repairs"
```

---

### Task 2: Replace the stale phase prose with planning-ready freeze packages

**Files:**
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: Task 1 archive closeout; the master review's sequence, evidence gate, decisions, and deferred boundaries.
- Produces: stable `FR-1` through `FR-12` package IDs and one unambiguous “write this plan next” pointer.

- [ ] **Step 1: Reconcile current state before editing**

Run:

```bash
git log --oneline -20
sed -n '1,220p' ROADMAP.md
sed -n '1,220p' docs/reviews/2026-08-24-publication-gate-evidence.md
rg -n "FR-[0-9]+" ROADMAP.md todo.md ARCHIVE.md docs || true
```

Expected: the latest trust repairs are shipped; publication-gate prospective checklist entries remain open; `FR-*` IDs are unused.

- [ ] **Step 2: Update the roadmap header and state**

Set the reconciliation date to `2026-08-27`. Immediately after the phase-charter link, add:

```markdown
The adversarial review is the **master decision record for the freeze**. Its board judgment, target
product thesis, ranked risks, accepted decisions, feature disposition, evidence gate, and
falsification criteria govern this roadmap. Each package below links to the exact governing section;
the roadmap operationalizes those decisions and does not replace them.
```

Update “State of the app” to distinguish:

```markdown
The main mechanical trust-contract repairs are shipped and recorded in
[the archive closeout](ARCHIVE.md#adversarial-review-trust-contract-closeout-2026-08-20--2026-08-27).
The freeze remains active because prospective evidence, restore honesty, core-journey validation,
Claude-authority reduction, library completion, nutrition validation, and real block cycles remain
open. Shipped mechanics are not evidence that NodeVelo improves decisions.
```

- [ ] **Step 3: Replace “Active order” with the package contract**

Keep the nine accepted phases in order, but make `FR-*` packages the executable units. Add this legend:

```markdown
## Freeze implementation-plan queue

Status: **READY** may be planned now · **EVIDENCE** is an attended run/record, not a code plan ·
**BLOCKED** waits for its entry gate. Select the first READY package. One package produces one design
spec and one implementation plan unless its text explicitly says evidence-only.
```

Then add these packages with direct master-review links:

```markdown
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

- **Outcome:** write one implementation plan per independently evidenced journey failure; never bundle unrelated UI polish.
- **Exit evidence:** repeated task completion without the targeted failure and no regression to publication/turnover gates.

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
```

- [ ] **Step 4: Preserve the stable deferred-handle table**

Keep the existing `#2`, `#10`, `Track A–C`, `§5–7`, and other stable entries. Update only entries whose status is contradicted by shipped PRs; do not renumber them. Keep segment grading fidelity as an explicit implement-or-re-decide boundary unless a separate decision closes it.

- [ ] **Step 5: Verify roadmap structure and links**

Run:

```bash
for id in $(seq 1 12); do rg -q "FR-$id" ROADMAP.md || exit 1; done
rg -n "master decision record|READY|EVIDENCE|BLOCKED|Non-goals" ROADMAP.md
npm run check-links
git diff --check
```

Expected: all twelve packages exist once; direct master-review anchors resolve; no whitespace errors.

- [ ] **Step 6: Commit**

```bash
git add ROADMAP.md
git commit -m "docs: turn freeze roadmap into plan-sized packages"
```

---

### Task 3: Reconcile the live punch-list and planning route

**Files:**
- Modify: `todo.md`
- Modify: `docs/COMPASS.md`

**Interfaces:**
- Consumes: Task 2 `FR-*` package queue.
- Produces: no duplicated strategy in `todo.md`; one clear “what next?” route in COMPASS.

- [ ] **Step 1: Keep only executable live checks in todo**

Retain the loading-week generation item, but replace its strategic explanation with a pointer:

```markdown
- ☐ P2 `audit` **FR-1 live generation:** run the attended four-week current-code generation defined
  by [ROADMAP FR-1](ROADMAP.md#fr-1--current-generation-evidence-run--evidence-next-action), then
  record the loading-week deltas and close or refine this item from observed evidence.
```

Do not duplicate the publication evidence checklist in `todo.md`. Preserve unrelated live checks and the `CONTINUE.md` ownership warning.

- [ ] **Step 2: Route future planning sessions through the package queue**

In `docs/COMPASS.md`'s “know what to work on next” row, replace the current generic roadmap pointer with:

```markdown
| **know** what to work on next | [../ROADMAP.md](../ROADMAP.md#freeze-implementation-plan-queue): select the first READY `FR-*` package; evidence-only packages use their linked run log; phase law comes from the [master adversarial review](reviews/2026-08-20-nodevelo-adversarial-investment-review.md) | — |
```

In the closing ownership table, keep ROADMAP as owner of open/planned work; add no second backlog.

- [ ] **Step 3: Run docs-health and duplication checks**

Run:

```bash
wc -l ROADMAP.md todo.md
rg -n "FR-1 live generation|publication-gate prospective|five consecutive structurally valid" todo.md ROADMAP.md
npm run check-links
git diff --check
```

Expected: `todo.md` carries one short FR-1 live-check pointer; strategy/evidence criteria live in ROADMAP and the evidence log.

- [ ] **Step 4: Commit**

```bash
git add todo.md docs/COMPASS.md
git commit -m "docs: route freeze planning through roadmap packages"
```

---

### Task 4: Final decision-record and documentation conformance gate

**Files:**
- Verify only: `docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md`
- Verify only: `docs/reviews/2026-08-24-publication-gate-evidence.md`
- Verify only: `docs/DECISIONS.md`
- Verify: all files changed in Tasks 1–3

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a reviewed documentation-only branch ready for the sanctioned finish workflow.

- [ ] **Step 1: Prove the master review was not edited**

Run:

```bash
git diff origin/main...HEAD -- docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md
```

Expected: no output.

- [ ] **Step 2: Audit every package against the master review**

Create a temporary checklist outside the repository and verify:

```text
FR-1  evidence gate + safety + physiology
FR-2  persistence/recovery + risks 8/10 + Q20/Q31
FR-3  UX findings + expand-now + Q29/Q39
FR-4  FR-3 evidence only
FR-5  Claude authority + Q26/Q36/Q42 + falsification
FR-6  maintainability + Q5/Q11; separate experiment
FR-7  library disposition + Q17/Q45
FR-8  nutrition + risk 5 + Q18/Q27/Q28/Q35
FR-9  evidence gate + falsification
FR-10 UX + Q34
FR-11 defer + Q22/Q32/Q38
FR-12 risk 10 + Q20/Q31
```

Expected: every line has at least one direct ROADMAP anchor link and no package contradicts its source.

- [ ] **Step 3: Check forward-only ownership and scope**

Run:

```bash
git diff --name-only origin/main...HEAD
rg -n "PR #87|PR #92|PR #94|PR #96|PR #97|PR #101|PR #103" ROADMAP.md ARCHIVE.md
rg -n "provider|model|cost" ROADMAP.md
git diff --check
```

Expected: changed files are the design, this plan, `ARCHIVE.md`, `ROADMAP.md`, `todo.md`, and `docs/COMPASS.md`; shipped PR detail lives in ARCHIVE; provider/model/cost work appears only in separate `FR-6`.

- [ ] **Step 4: Run the full repository check**

Run:

```bash
npm run check
```

Expected: typecheck, lint, all tests, workflow guards, sync guards, and Markdown links pass.

- [ ] **Step 5: Review the complete branch**

Use the repository `code-review` skill against `origin/main...HEAD`. Required review questions:

```text
1. Does ROADMAP contain only open work?
2. Does every FR package link to the master adversarial review?
3. Are shipped trust repairs represented once in ARCHIVE rather than duplicated?
4. Can a new planning session identify the first READY implementation package without inference?
5. Are evidence-only, blocked, and deferred packages impossible to mistake for ready code work?
```

Fix substantive findings and re-run Steps 1–4.

- [ ] **Step 6: Finish through the repository workflow**

```bash
npm run finish:agent-task
```

Expected: branch pushed and PR opened for reciprocal review; no manual push or merge.
