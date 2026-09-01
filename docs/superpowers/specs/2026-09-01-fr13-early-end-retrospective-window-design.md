# FR-13 early-end retrospective effective-window design

**Date:** 2026-09-01
**Status:** Shipped 2026-09-01

## Outcome

An explicitly early-ended block produces one internally consistent retrospective record. Optional
AI prose, structured reflections, deterministic closeout evidence, and persisted history hours all
describe only the period the athlete actually lived. Days after the effective closeout date do not
exist for evaluation and cannot be described as missed work.

This design implements the single failure selected by the
[accepted FR-3 audit](../../reviews/2026-09-01-fr3-core-journey-audit.md#fr3-01--early-end-narrative-grades-the-unlived-future)
and preserves [INVARIANT 59](../../INVARIANTS.md#block-closeout--acknowledgement), the trustworthy
post-ride surface in [the daily loop](../../systems/03-daily-loop.md), and the FR-5 authority boundary
in [the AI layer](../../systems/07-ai-layer.md#authority-boundary).

## Observed failure

On 2026-09-01, a block scheduled through 2026-09-13 was ended after one lived day. Deterministic
closeout correctly reported zero of one scored sessions and one missed session. The route separately
summed every scheduled day into `plannedHours`, sent 19.2 planned hours to the prose generator, and
persisted that full total. The saved narrative evaluated zero completed hours against the unlived
two-week schedule despite the UI promise that remaining sessions would not count.

The existing early-end regression checks `closeout.plannedSessions`; it does not inspect either AI
call or the persisted hour totals.

## Approaches considered

1. **One route-owned effective window — selected.** Compute the cutoff once, derive filtered planned
   days and activities, and feed every retrospective consumer from those views. This fixes the seam
   without changing deterministic closeout internals.
2. Filter only `plannedHours` and `actualHours`. This is smaller but leaves scheduled dates and other
   block-window evidence able to contradict the corrected hours.
3. Move a new retrospective-summary abstraction into `lib/block-closeout.ts`. This centralizes more
   values but expands a deterministic evidence module for a route with only one caller.

## Effective-window contract

The route computes one date after the existing normal-completion/explicit-early-end gate:

```ts
const effectiveCloseoutDate = today < block.endDate ? today : block.endDate;
```

There are not separate normal and early-end algorithms:

- normal completion resolves the effective date to `block.endDate`;
- explicit early end resolves it to the athlete's local `today` supplied through `resolveToday`;
- planned evidence includes block days from `block.startDate` through the effective date;
- actual evidence includes ride activities in that same inclusive range.

The route uses those filtered collections for planned hours, actual hours, top sessions, average
decoupling, and deterministic closeout input. The CTL endpoint is resolved against the effective
date, not the original scheduled end. `buildCloseoutEvidence` still receives the cutoff explicitly
and remains the sole deterministic owner of closeout counts, compliance, misses, and overshoot.

The current power-profile snapshot and matured-intervention selection remain unchanged. Neither was
identified as a future-session leak, and widening FR-13 into their semantics would exceed the
selected evidence.

## Optional-language input

`RetrospectiveInput` gains the minimum context needed to state the truth:

- the existing `startDate`, `endDate`, and `lengthWeeks` remain scheduled block facts;
- `effectiveCloseoutDate` identifies the last included day;
- `endedEarly` distinguishes an explicit early end from a normal completion.

Both retrospective prompt builders state, when `endedEarly` is true, that the block was scheduled
for its original range but evaluated only through `effectiveCloseoutDate`; later days are excluded
and must not be treated as missed. The volume line uses the already-filtered planned and actual
hours. Normal-completion prompt output remains materially unchanged.

This is a structural prompt-input change, so `PROMPT_VERSION` increments once. Both optional calls
receive the same input object. AI continues to phrase supplied facts only: it cannot alter closeout
evidence, history, seeds, acknowledgement, generation, or publication.

## Persistence and failure behavior

`BlockHistoryEntry.startDate`, `endDate`, and `lengthWeeks` retain the original scheduled identity.
The existing `endedEarlyAt` and `endedEarlyReason` fields retain the closeout decision. No persisted
field or migration is added.

`plannedHours` and `actualHours` store the effective-window totals used by the retrospective. This
keeps Plan history and Trends consistent with the closeout record. Archived `days` continue through
the same effective date.

The existing markdown → history → CAS-clear ordering, degraded no-AI closeout, error responses,
provenance stamping, acknowledgement records, seed derivation, and ledger read-only behavior do not
change.

## Regression-first coverage

Before route implementation, add the exact early-end regression to
`app/api/retrospective/route.test.ts`:

- scheduled block ends 2026-09-13 and is explicitly ended on 2026-09-01;
- one positive-duration day exists on/before 2026-09-01 and later scheduled sessions remain;
- no scored ride exists for the lived session, so deterministic closeout stays `0/1` with one miss;
- a ride after 2026-09-01 is present as a sentinel and must not contribute to actual hours, top
  sessions, or decoupling;
- both `generateRetrospective` and `generateStructuredRetrospective` receive only the effective
  planned/actual hours plus the early-end context;
- the appended history entry stores the same effective hours and original scheduled identity.

Add a normal-completion case proving the same formula retains the full scheduled and actual window.
Prompt-builder tests cover the early-end exclusion instruction and unchanged normal-completion
shape. Existing closeout tests continue to prove deterministic semantics.

## Verification

Implementation must run the focused retrospective route, prompt, and closeout tests; the repository
check; `npm run check-links`; and `git diff --check`. Because the prompt changes, run one attended
live early-end smoke against isolated data and read the saved narrative. It must not grade or name
days after the effective closeout date.

The final diff is checked against FR-3 commit
`cf8dddf86519d175b961671aea2fe120419ca4a9`; only FR-13 implementation and canonical documentation
files may differ.

## Explicit non-goals

- No adaptive-roadmap refetch or season-selector changes.
- No plan-preview persistence or navigation guard.
- No retrospective tone, length, or general prose cleanup.
- No UI changes.
- No changes to deterministic closeout math, seed derivation, acknowledgement, or frozen ledger
  semantics.
- No new AI call, provider/model experiment, or AI influence on deterministic generation.
