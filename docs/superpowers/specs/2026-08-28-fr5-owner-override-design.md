# FR-5 owner-override design

**Status:** Approved 2026-08-28

## Purpose

Use the attended FR-1 generation as falsifying evidence for the deterministic-authority work it
identified, instead of repeatedly regenerating before the package intended to reduce Claude's
authority is allowed to start.

## Decision

- Close FR-1 as an evidence task: its required attended run and record exist. The blocked verdict
  remains explicit and the run does not count toward the structurally-valid-generation checklist.
- Explicitly waive FR-5's "Phase 2 closed" entry gate by owner instruction on 2026-08-28 and make
  FR-5 the next READY package.
- Keep FR-3 READY but deliberately deferred behind FR-5. Keep FR-4 blocked on FR-3 evidence. The
  waiver does not claim Phase 2 completed.
- Carry the observed duration-reconciliation hour loss and deterministic skeleton/validator
  sequencing conflict into FR-5 as concrete audit evidence.
- Keep FR-5's existing exit evidence unchanged, including five consecutive structurally valid
  varied-input generations. The blocked FR-1 run is a baseline failure, not one of those five.

## Documentation changes

- `ROADMAP.md`: remove closed FR-1 from the forward queue; mark FR-3 deferred by owner sequencing;
  mark FR-5 READY with the explicit waiver and evidence inputs.
- `todo.md`: remove the FR-1 live-generation item from Open.
- `ARCHIVE.md`: record FR-1's completed evidence outcome and accepted handoff to FR-5.
- `docs/DECISIONS.md`: append the owner sequencing decision so the exceptional gate waiver is not
  inferred later from roadmap ordering alone.
- `docs/reviews/2026-08-24-publication-gate-evidence.md`: retain the failed run unchanged as the
  factual source record.

## Non-goals

- No generation, prompt, validator, model, or publication behavior changes.
- No downgrade or override of publication blockers.
- No claim that FR-3 or FR-4 completed.
- No provider/model experiment; FR-6 stays blocked on the FR-5 baseline.

## Acceptance

- The forward queue names FR-5 as the next action and explains the owner waiver.
- FR-1 appears in the archive, not the open roadmap or todo list.
- FR-3/FR-4 and FR-6 retain honest independent gates.
- The failed generation remains excluded from structurally valid evidence.
- `npm run check` passes with no broken documentation links.
