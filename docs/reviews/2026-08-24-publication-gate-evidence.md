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

### 2026-08-28 — FR-1 current-code synthetic four-week generation

- Ran current `main` (`1571dd8`, including PR #105) through `POST /api/generate` with both
  `NODEVELO_DATA_DIR` and `NODEVELO_KB_DIR` pointed at isolated temporary directories. The KB
  directory was empty and preflight inspection confirmed generation used only the committed
  template corpus. Inputs were synthetic: default profile data, a coherent manual physiology
  snapshot (FTP 250 W, confirmed effective 2026-08-28), a four-week block starting 2026-08-31,
  and generic durability/threshold goals. No athlete data was used.
- The live response returned HTTP 200 and all 28 prescriptions were inspected. Dates were unique,
  contiguous, and complete, and the response was not truncated, but the persisted publication
  verdict was **blocked**, so this does not count as a structurally valid test generation.
- Loading-week hour results against the 12 h target were: week 1 **687 min, -33 min (-0.55 h)**;
  week 2 **704 min, -16 min (-0.27 h)**; week 3 **716 min, -4 min (-0.07 h)**. The recovery week
  was **432 min against 432 min (7.2 h), delta 0**. The loading-hour issue is improved but not
  closed because week 1 remained outside the 30-minute tolerance.
- Publication findings: three blockers, zero preferences. The blockers were the week-1 hour
  shortfall plus quality sequencing in weeks 1 and 2 (Threshold placed before the
  freshness-dependent SIT/VO2max session). No publish or `/api/write` call was attempted.
- Physiology status was **fresh** (`confirmedDate` and `effectiveFrom` both 2026-08-28).
- Deterministic repairs: duration reconciliation changed five model-declared durations
  (80→70, 75→52, 80→76, 75→63, and 90→71 min); nutrition repair emitted 25 correction notes.
  Manual repairs: **none**.
- Overview warnings: **none**. All 25 response warnings were nutrition-repair audit notes.
- Anthropic usage: `claude-sonnet-4-6`, prompt version 9, one call; 6,247 uncached input tokens,
  5,765 output tokens, 2,587 cache-write tokens, zero cache-read tokens, estimated cost
  **$0.114917**.
- An earlier same-day setup attempt is excluded from evidence: JSON state was isolated but the KB
  root was not, so repository-local athlete context reached the prompt. It was not published or
  recorded as an FR-1 result. The corrected run above isolated both roots.
