# Adaptive self-directed coach — Phase 3a scoping handoff

**Superseded 2026-08-13 — Phase 3a shipped.** This briefing did its job (the design/plan/implementation
it kicked off are in [ARCHIVE.md](../../ARCHIVE.md#adaptive-self-directed-coach--phases-13c-2026-08-0614));
kept as a historical record, not a live pointer. For what Phase 3a actually built, read the design
(`docs/superpowers/specs/2026-08-12-adaptive-coach-p3a-no-block-today-design.md`) and plan
(`docs/superpowers/plans/2026-08-13-adaptive-coach-p3a-no-block-today.md`) directly.

**This is a kickoff briefing, not a design or a plan.** It exists so a fresh session doesn't have to
re-derive what this session spent real effort establishing: what Phase 3a actually is, what it is
*not*, and what's already shipped underneath it. Start here, then run the `brainstorming` skill with
the user to work out the implementation shape — the product requirements below are already locked
(design review approved them 2026-08-06); what's still open is how to build them against the current
codebase.

## Why this doc exists

ROADMAP.md's "Phase 3" line used to point at one thing. Mid-brainstorm in the session that wrote this
doc, it became clear "Phase 3" actually covers two unrelated bodies of work that had been merged onto
one ROADMAP line:

- **Phase 3a** (this doc's subject) — the original, canonical Phase 3 scope: a personalized weekly TSS
  envelope, next-session suggestion, and the no-block Today UI. Defined in the design spec's §8-10 and
  §12.1, and confirmed independently by two other docs written on different days that never cross-referenced
  each other but agree exactly: Phase 1's plan ("Phase map — interfaces Phases 2-4 will consume",
  `docs/superpowers/plans/2026-08-06-adaptive-coach-p1-aerobic-eligibility.md:1102-1108`) and Phase 2c's
  plan ("Handoff boundary to Phase 3", `docs/superpowers/plans/2026-08-12-adaptive-coach-p2c-debrief-ui.md:2582-2608`).
- **Phase 3b** — curated-interval HR/cadence/gradient/VAM context for self-directed ride matching
  (`ExecutedInterval` enrichment, a generalized `matchLaps`, `IntentTarget` gaining `targetHrBpm`/
  `targetCadenceRpm`/`terrain`). This was a newer addition to ROADMAP's Phase 3 line — a real, separate
  design gate ("do not infer terrain or widen the matching hierarchy before that design"), but a
  different subsystem (self-directed intent-scoring) than 3a's (weekly load budgeting). **Phase 3b has
  its own design doc and implementation plan, written the same day as this handoff — see
  `docs/superpowers/specs/2026-08-12-adaptive-coach-p3b-interval-context-design.md`. Do not duplicate
  that work here or re-open the gradient/terrain question in a Phase 3a session — it's owned there.**

ROADMAP.md's entry has been split accordingly. If it hasn't (check first — this file is a snapshot,
ROADMAP is live), that split still stands; update ROADMAP to match rather than trusting this doc over it.

## What Phase 3a actually is

Quoting the canonical scope line directly (Phase 1's plan, line 1107):

> Weekly cycling-TSS envelope, no-block state read, one session suggestion, Today UI

Four pieces, all specified in `docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md`:

1. **§8 — Personalized weekly TSS envelope.** A robust anchor (median load of recent "tolerated" weeks —
   good recovery, no execution collapse, not just "survived a high number"), a role per coming week
   (Build / Maintain / Recovery), a range roughly ±7-8% around the role-adjusted centre. Resolved Monday
   via `localToday()`/`resolveToday()` (never UTC), persisted so it doesn't drift on every sync, frozen
   through Sunday except a one-way midweek *reduction* on new fatigue evidence — never raised midweek.
   Finishing below/inside/above the range is context, not pass/fail. No fixed-percentage injury claims.
2. **§9 — Next suggested session.** One concrete optional session (not a menu, not a plan), priority
   ordered: recovery/readiness guardrails → hard-session spacing/recent intensity → goals/weaknesses →
   neglected training systems → a dose that fits the weekly envelope. Output: purpose, simple structure,
   duration range, expected TSS range, one short evidence-based reason. Non-coercive around the
   envelope — no desperate catch-up rides below range, no "failure" framing above it, no penalty for an
   ignored suggestion.
3. **§10 — No-block athlete-state read.** The single blended athlete-state result can misread as poor
   off-plan execution when there's no block to be off of. Needs three separate evidence streams instead
   of one blended number (read the rest of §10 in the design doc — this handoff doesn't reproduce it in
   full).
4. **§12.1 — No-block Today UI.** The pre-ride half of Today. Phase 2c (2026-08-12) only ever built the
   post-ride debrief half (§12.2, `mode === "post"` in `TodayView.tsx`) — the `mode === "pre"` branch is
   untouched by any phase so far.

**This is not a from-scratch requirements brainstorm.** The product decisions above were locked at
design review (2026-08-06) alongside everything Phases 1-2c already implemented from the same document.
The brainstorming session's job is the *implementation* shape — module boundaries, persistence format,
exact UI composition — the same kind of work Phase 1's plan did for §§ covering aerobic eligibility, not
a re-litigation of whether a ±7-8% envelope or a single suggested session is the right product call.

## What's already shipped to build on

Phases 1, 2a, 2b, 2c are done (`ARCHIVE.md`). Concretely reusable, per Phase 2c's own handoff note
(`docs/superpowers/plans/2026-08-12-adaptive-coach-p2c-debrief-ui.md:2584-2597`, quoted/paraphrased):

- **`resolveEffectiveOutcome`'s `EffectiveOutcome.origin`** (`lib/intent-overlay.ts`) — Phase 3a's
  weekly-range/suggestion logic must read *effective* origin the same way `countsAsDrift` already does
  (INVARIANT 37), not a raw ledger row. A self-directed ride must not count as "off-plan" when there was
  no plan to be off of (design decision #1).
- **`TodayAnalysis.activityId` / `findLedgerEntry`** (`lib/ride-origin.ts`) — now a general-purpose join
  key from a single ride to its ledger row; reuse it rather than re-deriving a lookup.
- **`summariseBehaviour`'s `driftAvgQuality` and `scoreIntentExecution`'s zero-objective classification**
  (`lib/score-log.ts`, `lib/intent-scoring.ts`) — already-fixed (PR #38) behaviour-derivation machinery
  that §8.1's "recent execution" input reads through. Inherited for free; no separate fix needed.
- `TodayView.tsx`'s existing `mode: "pre" | "post"` split (`components/dashboard/TodayView.tsx:100`,
  verified live 2026-08-12) is exactly where §12.1's pre-ride UI slots in — `mode === "pre"` is the
  untouched branch.
- `lib/athlete-state.ts` (`computeAthleteState`, `athleteStateInputsFrom`) is very likely the "single
  athlete-state result" §10 says can misread self-directed rides as poor execution — read it, don't
  assume; this handoff hasn't verified its internals in depth.

**Explicit warning, carried over from Phase 2c's own handoff note — do not assume this generalizes for
free:** Phase 2b/2c's overlay-resolution work was proven correct at *single-ride* resolution. Phase 3a
adds a new consumer — the weekly envelope — that aggregates `origin`/`effectiveExecutionScore` across
*many* rides, not one. Re-verify from scratch that `resolveAll`'s output composes correctly under
aggregation (e.g. a week straddling an overlay's `createdAt` mid-week). Phase 2a's own postmortem found
the same defect shape four times — a validity check correct where its author was looking, silently
absent at a different point reading the same field through a different path
(`docs/systems/02-scoring-and-learning.md` § Known rough edges has the full account) — treat that as a
live warning for this phase specifically, not settled history.

## Suggested first steps for the fresh session

1. Read `docs/COMPASS.md` if this is a cold start (skip if the session already has recent context).
2. Read this doc in full.
3. Read the design doc's §8, §9, §10, §12.1 in full (`docs/superpowers/specs/2026-08-06-adaptive-self-directed-coach-design.md`) — this handoff summarizes but does not replace it.
4. Skim Phase 2c's "Handoff boundary to Phase 3" section directly (line 2582 of its plan doc) for the exact wording this doc paraphrases.
5. Invoke the `brainstorming` skill to work through implementation shape with the user — module boundaries for the weekly-envelope calculation, where it persists, how `mode === "pre"` composes with existing Today components, what "one session suggestion" reuses from `lib/season.ts`'s existing selector machinery vs. needs new.
6. Do not touch Phase 3b's files/scope (see "Why this doc exists" above) — check `docs/superpowers/specs/2026-08-12-adaptive-coach-p3b-interval-context-design.md`'s status before assuming it's still in flight or already shipped.
7. Start implementation, once a plan exists, the normal way — `npm run start:agent-task`, never directly on `main`.

## What this doc is not

Not CONTINUE.md (that's `/handoff`'s, reserved for resuming *this* session's own interrupted work — a
different thing from kicking off a new session on a different phase). Not a design spec — once the
implementation shape is brainstormed, write one properly to `docs/superpowers/specs/` per the
`brainstorming` skill's normal process. Not itself authoritative on product requirements — the design
doc is; this is a map to it.
