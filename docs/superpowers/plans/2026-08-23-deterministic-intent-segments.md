# Deterministic Intent Segments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score strict, label-led Intervals.icu intent bullets without using Claude for intent extraction.

**Architecture:** A pure parser converts `Label (targets...)` bullets into segment objectives. The existing runner fetches curated Intervals.icu laps, invokes the parser, and passes its interpretation to the existing deterministic scorer; Claude remains only in `/api/analyze` for prose.

**Tech Stack:** TypeScript, Vitest, existing Intervals.icu adapter and intent scorer.

## Global Constraints

- Intervals.icu labels and metrics are authoritative.
- Matching stays exact/unique through `matchSegment`; unmatched labels remain ungraded.
- Parse each bullet independently; malformed bullets cannot invalidate valid siblings.
- Support `1h`, `7m`, `3m30s`, `24m`, qualified `Z4 avg`/`Z5 NP`, and one unqualified zone.
- No new dependency and no Claude call for intent extraction.

---

### Task 1: Strict deterministic note parser

**Files:**
- Create: `lib/intent-note-parser.ts`
- Create: `lib/intent-note-parser.test.ts`
- Modify: `lib/intent-grounding.ts`
- Test: `lib/intent-grounding.test.ts`

**Interfaces:**
- Consumes: activity note text.
- Produces: `parseDeterministicIntent(note): IntentInterpretation | null`.

- [x] Write a failing test using the August 23 note and assert four segment objectives with exact labels, durations, and zone qualifiers.
- [x] Run `npx vitest run lib/intent-note-parser.test.ts` and confirm it fails because the parser does not exist.
- [x] Implement the smallest line-oriented parser and deterministic provenance stamp.
- [x] Add a failing grounding assertion for `3m30s`, then extend `groundsDuration` to accept compound minute/second notation.
- [x] Run `npx vitest run lib/intent-note-parser.test.ts lib/intent-grounding.test.ts` and confirm both pass.

### Task 2: Honest segment component grading

**Files:**
- Modify: `lib/intent-scoring.ts`
- Test: `lib/intent-scoring.test.ts`

**Interfaces:**
- Consumes: existing `scoreIntentExecution(interpretation, evidence, note)`.
- Produces: segment deltas based only on target components actually stated in the note.

- [x] Write a failing test proving an unstated NP component contributes no credit and the August 23 four-lap fixture scores 9/10.
- [x] Run the targeted test and confirm the unstated-component assertion fails.
- [x] Change `gradeSegment` to construct components only for stated duration, average/zone, and NP targets; missing evidence for a stated metric remains ungraded.
- [x] Run `npx vitest run lib/intent-scoring.test.ts` and confirm it passes.

### Task 3: Replace Claude extraction in the runner

**Files:**
- Modify: `lib/intent-runner.ts`
- Modify: `lib/intent-runner.test.ts`
- Modify: `lib/types.ts`

**Interfaces:**
- Consumes: `parseDeterministicIntent(note)` and fetched curated laps.
- Produces: the existing versioned `IntentOverlay` through `buildOverlay`.

- [x] Write a failing runner test asserting the August 23 note produces a scored overlay and never calls `parseRideIntent`.
- [x] Run `npx vitest run lib/intent-runner.test.ts` and confirm it fails.
- [x] Route non-empty notes through the deterministic parser; an unsupported note records an untrusted deterministic interpretation instead of calling Claude.
- [x] Update provenance comments to permit deterministic parser identifiers in `IntentInterpretation.model`.
- [x] Run `npx vitest run lib/intent-runner.test.ts` and confirm it passes.

### Task 4: Documentation and verification

**Files:**
- Modify: `docs/systems/02-scoring-and-learning.md`
- Modify: `docs/INVARIANTS.md`
- Modify: `docs/FILE_INDEX.md`
- Modify: `FEATURES.md`
- Modify: `ARCHIVE.md`

**Interfaces:**
- Consumes: shipped behavior.
- Produces: one coherent description of the deterministic segment lane.

- [x] Update the owning system docs and product records; preserve existing linked headings.
- [x] Run `npx vitest run lib/intent-note-parser.test.ts lib/intent-grounding.test.ts lib/intent-scoring.test.ts lib/intent-runner.test.ts lib/intent-overlay.test.ts lib/sync-analysis.test.ts components/dashboard/today.test.tsx components/SyncProvider.test.tsx`.
- [x] Run `npm run check`.
- [x] Run one live forced sync/intent analysis for activity `i178790011` and verify a deterministic 9/10 overlay with four segment-local evidence rows.
