# Freeze-roadmap reconciliation design

**Status:** Approved design  
**Date:** 2026-08-27  
**Decision source:** [NodeVelo adversarial investment review](../../reviews/2026-08-20-nodevelo-adversarial-investment-review.md)

## Problem

`ROADMAP.md` still mixes Phase 1 work that shipped in PRs #87, #92/#94, #96/#97, #101, and #103
with genuinely open evidence and recovery work. That makes the next planning boundary ambiguous and
risks re-planning completed trust-contract repairs. The accepted adversarial review remains the
phase charter, but it is an immutable point-in-time record rather than the live dispatcher.

## Outcome

Keep `ROADMAP.md` as the single forward-only freeze-period dispatcher. Reconcile it against current
code, `ARCHIVE.md`, recent merges, and the review, then express every remaining phase as ordered,
plan-sized packages with explicit entry and exit gates.

After the change, a planning session can select the first ready package, follow its source links,
and write one implementation plan without rediscovering scope or accidentally pulling in deferred
work.

## Source precedence

When sources disagree:

1. Current code and verification evidence establish what is shipped.
2. `ARCHIVE.md` records shipped work.
3. `ROADMAP.md` owns current open order.
4. The adversarial review supplies accepted rationale, risks, evidence gates, and scope boundaries.
5. Immutable specs and plans preserve history but do not define current priority.

The adversarial review is linked, not rewritten. Claims that were accurate at snapshot `d3dd228` but
are now resolved must be marked shipped in the living docs rather than silently left as open work.

## Documentation ownership

- `ROADMAP.md`: remaining freeze work, package order, prerequisites, and exit gates.
- `ARCHIVE.md`: concise record of trust-contract work shipped after the roadmap's 2026-08-23
  reconciliation.
- `todo.md`: short-lived bugs and attended live checks only; no strategy duplicated from ROADMAP.
- `docs/COMPASS.md`: route future “what next?” sessions to the first ready roadmap package.
- `docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md`: unchanged decision record.
- `docs/reviews/2026-08-24-publication-gate-evidence.md`: observations only, not implementation scope.

## Roadmap package format

Each package states:

1. **Review basis** — direct links to the accepted finding, ranked risk, decision, or evidence gate.
2. **Verified current state** — what is already shipped and the evidence proving it.
3. **Remaining outcome** — one result suitable for one implementation plan.
4. **Entry gate** — facts or earlier packages that must be complete before planning starts.
5. **Plan scope** — files/systems and decisions the future plan must cover.
6. **Exit evidence** — observable proof required to close the package.
7. **Non-goals** — adjacent deferred work that must not leak into the plan.

Package identifiers are additive and stable. Existing roadmap handles (`#1–4`, `§5–7`, and
`Track A–C`) are not renumbered or repurposed.

## Freeze sequence

1. **Close Phase 1 evidence and recovery honesty.** Record current-generation evidence, resolve the
   remaining restore/critical-state honesty gap, and separate shipped trust repairs from open proof.
2. **Make the core journey reliable and understandable.** Plan only measured Today → Plan → ride →
   closeout → adaptive-week failures or confusion.
3. **Reduce Claude's generation authority.** Audit the four live call categories, replace
   deterministic facts/processes first, and keep provider/model-cost experiments as a separate
   measured package.
4. **Complete the narrow workout-library loop.** Manual curation, deterministic selection, reuse,
   management, and accepted-use recording only.
5. **Validate nutrition prospectively.** Measure against the accepted monthly weight range before
   allowing additional automatic adaptation.
6. **Run four real block cycles.** This is evidence collection, not a feature phase; repaired or test
   history does not count.
7. **Consolidate secondary-page UX.** Starts only after Phase 5 and may overlap Phase 6.
8. **Activate event work from a real A-event.** No speculative event implementation.
9. **Schedule recovery and conveniences deliberately.** Off-machine backup and other conveniences
   remain accepted deferred risk until explicitly scheduled.

## Reconciliation rules

- Remove shipped work from active roadmap prose and add a compact archive record with PR links.
- Preserve unresolved review findings even when nearby findings shipped.
- Do not turn evidence collection into implementation work.
- Do not count test generations, repaired history, or manually seeded workouts as prospective
  effectiveness evidence.
- Do not combine provider/model-cost experiments with deterministic-authority cleanup.
- Keep blocked/dormant items blocked until their recorded trigger occurs.
- Keep ROADMAP concise enough to remain a dispatcher; link to owning evidence/system docs instead of
  repeating their detail.

## Verification

- Every active package links to its adversarial-review basis and owning current document.
- Every claimed shipment is supported by current code, `ARCHIVE.md`, or a merged PR.
- No shipped item remains phrased as open work.
- No active package duplicates a `todo.md` live check.
- Existing stable handles and inbound Markdown anchors still resolve.
- `npm run check` passes, including link validation.

## Non-goals

- Writing the implementation plans themselves.
- Changing runtime behavior, feature scope, or the accepted review.
- Updating `CONTINUE.md`, agent instructions, immutable plans, or productization assumptions.
- Starting Phase 2 or Phase 3 implementation before the reconciled roadmap package is selected and
  separately planned.
