# Publication-gate prospective evidence

**Owner:** Phase 6 evidence work  
**Implementation:** [PR #97](https://github.com/Xon333/Nodevelo/pull/97) and [publication-gate trust contract](../superpowers/plans/2026-08-23-publication-gate-trust-contract.md)  
**Source contract:** [adversarial investment review — Evidence gate](2026-08-20-nodevelo-adversarial-investment-review.md#evidence-gate)

The publication gate is shipped. This log tracks the longer-term evidence required before the
feature freeze can end. Test generations demonstrate mechanics but do not count as completed real
blocks.

## Exit checklist

| Requirement | Status | Evidence / notes |
|---|---|---|
| Five consecutive structurally valid test generations across varied inputs | ☐ Not started | Record dates, inputs, and whether any structural repair was needed. |
| Four completed real blocks without manual structural repair | ☐ Not started | Record the block dates and any publication blockers or overrides. |
| At least 80% of prescribed sessions retained substantially as generated | ☐ Not started | Calculate from the four completed blocks; link the closeout records. |
| At least three independent athlete-specific adaptations reached later decisions | ☐ Not started | Record the source evidence, later decision, and provenance. |
| At least one genuine refutation handled honestly | ☐ Not started | Record the hypothesis, refuting evidence, demotion, and later behavior. |
| No unresolved calendar, data-integrity, or serious safety failures | ☐ Not started | Record incidents and their resolution; any serious failure resets the clean cycle. |
| Usefulness and trust feedback recorded after every block | ☐ Not started | Link each block's feedback and note unanswered concerns. |

## Evidence log

Append dated entries here after each attended generation or completed block. Keep this file about
observations and links; implementation details belong in the archived PR and system docs.

### 2026-08-23 — initial publication-gate smoke

- Three real four-week generations were run against the live Anthropic API in an isolated worktree.
- One generation exposed a real skeleton envelope miss; a later generation produced zero skeleton
  findings.
- Tampered-plan and exact-plan `/api/write` replays returned 422 before calendar mutation.
- This smoke validates the gate mechanics but does not satisfy the prospective evidence checklist
  above.

