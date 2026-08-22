# Phase 1 retrospective & turnover trust contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the block-closeout trust boundary so a deterministic closeout (evidence + seeds +
history entry) works without Claude, progression decisions require meaningful execution/compliance
evidence rather than uncapped duration ratios, and AI-authored reflections can never influence
another block without explicit athlete approval.

**Architecture:** One new pure module (`lib/block-closeout.ts`) owns all closeout math at the seam
between `/api/retrospective` and the frozen score ledger; `/api/retrospective` is reordered so
deterministic facts are computed first, both Claude calls become best-effort enrichment, and the
active-block clear happens strictly last behind the existing CAS guard. Three additive optional
fields on `BlockHistoryEntry` carry the separation (`closeout` facts vs `retrospective` narrative vs
`reflectionsApprovedAt` approval gate). Generation's reflection injection filters on the truthy
approval stamp. No new store, no new LLM call site, no prompt-text change, no PROMPT_VERSION bump.

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript 5, Vitest. No new dependencies.

## Global Constraints

These restate the accepted review boundaries ([review §Retrospective and turnover](../../../docs/reviews/2026-08-20-nodevelo-adversarial-investment-review.md),
decisions #49–51) plus repo law. Every task implicitly inherits them.

- **A normal completed block or an explicit early-end decision precedes closeout.** Gate:
  `isBlockFinished(block, today)` OR request carries `{ endedEarly: true, endReason: <non-empty> }`.
  Otherwise 409 before any write. No silent closeouts of mid-flight blocks.
- **Minimal deterministic closeout works without Claude.** Removing/unsetting `ANTHROPIC_API_KEY`
  must not prevent evidence collection, markdown persistence, history append, or the block clear.
  The current hard `400 Anthropic API is not configured.` preflight goes away.
- **Progression evidence is execution + capped compliance, never raw duration ratio alone.**
  Compliance figures come from the frozen ledger's `RideScoreEntry.compliancePct` — already
  `resolveCompliance`-capped by execution (INVARIANT 25). The route's inline uncapped
  `actualMin / day.durationMin * 100` math is deleted, not kept alongside.
- **Large overshoots cannot imply "safe to progress".** A session whose raw duration ratio exceeds
  `CLOSEOUT_OVERSHOOT_RATIO` (>1.25× planned) is recorded as an overshoot fact; any type containing
  one is barred from producing a progression seed regardless of its capped numbers.
- **Facts, narrative, and seeds stay separate fields/artifacts.** `BlockHistoryEntry.closeout`
  (deterministic), `.retrospective` (optional Claude prose), `.nextBlockSeeds` (deterministic,
  athlete-editable via the retro markdown frontmatter). Never merge them into one blob.
- **AI-authored root causes/strategies need explicit athlete approval before influencing another
  block.** `generateStructuredRetrospective` output persists WITHOUT an approval stamp;
  `app/api/generate/route.ts` injects only reflections whose entry has a truthy
  `structuredReflectionsApprovedAt`. Approval is one explicit action (POST on the existing
  `/api/history` route) surfaced on the Plan page — not a generic approval framework.
- **The score ledger stays frozen (INVARIANT 1).** Closeout only READS `score-log.json`. No new
  writes, backfills, or rebuilds anywhere in this plan.
- **Existing JSON without the new fields remains readable (INVARIANT 3).** All new
  `BlockHistoryEntry`/request-body fields are optional; every read site uses truthy checks, never
  `=== null` / `=== undefined`.
- **Failures cannot clear the active block before durable closeout succeeds.** Write order inside
  the route is exactly: retro markdown → `appendBlockHistory` → CAS-guarded
  `updateCurrentBlock(() => null, expectedCreatedAt)`. Any throw before the clear leaves the active
  block intact and returns an error response.
- **No prompt text changes, therefore no PROMPT_VERSION bump.** `buildRetrospectivePrompt` /
  `buildStructuredRetrospectivePrompt` signatures and text are untouched; only the *values* fed
  through the existing `overallCompliancePct` / `complianceByType` inputs change (now capped).
  `formatReflectionsForPrompt`'s wording stays as-is — with approval gating, "your own clinical
  notes" becomes accurate rather than misleading (INVARIANTS 16/54 considered; documented decision
  NOT to bump).
- **"Today" is local** (`resolveToday(b.today)`, INVARIANT 10) — the gate reuses the value the route
  already resolves; do not add a second clock read.
- **Live smoke run:** the retrospective path's call ordering/degradation changes, so one attended
  live smoke run against the real API is required before completion (INVARIANT 19).

---

## Task 0: Confirm baseline

**Files:** none (verification only).

- [ ] **Step 0: Verify branch and anchors**

```bash
git branch --show-current            # codex/retrospective-turnover-trust-contract (worktree)
grep -n "resolveCompliance" lib/execution-score.ts          # line ~373
grep -n "isAnthropicConfigured())" app/api/retrospective/route.ts   # the preflight to delete
grep -n "formatReflectionsForPrompt" app/api/generate/route.ts      # line ~169
grep -n "export async function updateBlockHistory" lib/data-store.ts
```

Expected: all four match. Read `app/api/retrospective/route.ts` and
`app/api/retrospective/route.test.ts` in full before Task 1 — the tests encode HR-32/33/35 behavior
that must survive unchanged.

---

## Task 1: `lib/block-closeout.ts` — deterministic evidence module

Deep module at the closeout seam: callers pass plain data, get back the complete separated fact set
and proposed seeds. Pure — no IO, no clock, no LLM. All route-side closeout math moves here.

**Files:**
- Create: `lib/block-closeout.ts`
- Test: `lib/block-closeout.test.ts`

**Interfaces:**
- Consumes: `CurrentBlock`, `CurrentBlockDay`, `RideScoreEntry`, `WorkoutType` from `lib/types.ts`;
  nothing else.
- Produces:

```ts
export const CLOSEOUT_OVERSHOOT_RATIO = 1.25;

export interface CloseoutTypeEvidence {
  type: WorkoutType;
  planned: number;              // days with durationMin > 0
  scored: number;               // with a matching frozen ledger entry
  missed: number;               // planned but no ledger entry
  meanExecution: number | null; // null when scored === 0
  meanCompliancePct: number | null; // ledger values — already resolveCompliance-capped
  overshootDays: string[];      // dates where raw actual/planned > CLOSEOUT_OVERSHOOT_RATIO
}

export interface CloseoutEvidence {
  perType: CloseoutTypeEvidence[];
  plannedSessions: number;
  scoredSessions: number;
  missedSessions: number;
  overshootSessions: number;
  overallMeanExecution: number | null;
  overallMeanCompliancePct: number | null;
}

export function buildCloseoutEvidence(
  block: CurrentBlock,
  entries: RideScoreEntry[],
  activities: Array<{ date: string; movingTimeSec: number }>
): CloseoutEvidence;

export function deriveCloseoutSeeds(
  evidence: CloseoutEvidence,
  ctlStart: number | null,
  ctlEnd: number | null,
  curveSeed: string | null
): string[];
```

- [ ] **Step 1: Write failing tests**

Cover these cases (fixture rides off .x5 float boundaries per INVARIANT 30):

```ts
// lib/block-closeout.test.ts
import { describe, expect, it } from "vitest";
import { buildCloseoutEvidence, deriveCloseoutSeeds, CLOSEOUT_OVERSHOOT_RATIO } from "./block-closeout";
import type { CurrentBlock, RideScoreEntry } from "./types";

// helpers: block(days), entry(date, {plannedType, executionScore, compliancePct}) …
```

Assertions that must hold:

1. A day ridden at 160% duration with `executionScore: 8` yields `compliancePct` taken verbatim
   from the ledger entry (Intervals/capped value, e.g. 100), and the date appears in
   `overshootDays` because raw ratio 1.6 > `CLOSEOUT_OVERSHOOT_RATIO`.
2. That same overshoot bar: `deriveCloseoutSeeds` emits NO seed containing "progress" for a type
   whose `overshootDays.length > 0`, even when `meanExecution ≥ 6 && meanCompliancePct ≥ 85`.
3. Progression seed fires only when a type has `meanExecution >= 6`, `meanCompliancePct >= 85`,
   `missed === 0`, `overshootDays.length === 0`.
4. Low execution caps the story: a type with `executionScore: 3`, ledger compliance 72 → no
   progression seed; a "review" seed names the low execution mean.
5. Missed sessions: planned day with no ledger entry increments `missed`, blocks progression, and
   produces an honest "N scheduled sessions have no recorded ride" seed.
6. Zero scored sessions anywhere → `overallMeanExecution === null`, no progression language, one
   "insufficient scored evidence" seed.
7. CTL gain branches preserved from current behavior (≥10 progress-flavored, ≤2 review-flavored)
   — but phrased as observations, gated the same way (no "safe to progress" when overshoots exist).
8. Curve seed passthrough: `curveSeed !== null` → included verbatim last.
9. Seed provenance: every returned string is templated from evidence fields — grep-style assertion
   that no seed embeds a raw uncapped ratio figure.

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run lib/block-closeout.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `lib/block-closeout.ts`**

Join rule per planned day (`durationMin > 0`): find `entries.find(e => e.planned && e.date === day.date)`
for the scored read; find `activities.find(a => a.date === day.date)` for the raw duration ratio.
Overshoot uses ONLY raw activity time vs `day.durationMin`; compliance/execution use ONLY ledger
fields. Type grouping keys on `day.type as WorkoutType` (same as today's route code). Means are
arithmetic over per-session values; round percentages to integers, execution to 1 decimal via
existing `round1` in `lib/stats.ts`.

Seed templates (exact strings, adjust freely in review but keep the gating):

```
progress: `${type} sessions executed well (execution ${x}/10, completion ${y}%) — evidence supports progressing ${type} load`
overshoot: `${type} ran ${pct}% over prescription on ${n} day(s) — treated as a data/anomaly signal, not progression evidence`
lowExec:   `${type} execution averaged ${x}/10 — review quality before adding load`
missed:    `${n} scheduled ${type} session(s) have no recorded ride — account for them before progressing`
thin:      `Insufficient scored sessions this block (${scored}/${planned}) — progression calls need more evidence`
ctlHigh:   `Strong CTL gain (+${g}) across the block`
ctlLow:    `Minimal CTL gain (+${g}) — review session quality or effective volume`
curve:     curveSeed verbatim
```

- [ ] **Step 4: Tests pass**

Run: `npx vitest run lib/block-closeout.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/block-closeout.ts lib/block-closeout.test.ts
git commit -m "feat(closeout): deterministic evidence + gated seed derivation module"
```

---

## Task 2: Types — additive optional fields

**Files:**
- Modify: `lib/types.ts` (`BlockHistoryEntry`, after `structuredReflections` ~line 667)

**Interfaces:**
- Produces (all optional; absent on pre-existing entries):

```ts
// Phase 1 trust contract: separation + approval fields. Absent on entries written before this
// shipped — read sites MUST truthy-check, never compare against null/undefined (INVARIANT 3).
closeout?: CloseoutEvidence;          // deterministic facts (imported from ./block-closeout)
reflectionsApprovedAt?: string;       // ISO instant; set only by explicit athlete action
endedEarlyAt?: string;                // ISO instant when the closeout was an explicit early end
endedEarlyReason?: string;
```

Note the import direction: `types.ts` must not import from `block-closeout.ts` if that creates a
cycle — instead declare the `CloseoutEvidence` shape IN `types.ts` (alongside `StructuredReflection`)
and have `lib/block-closeout.ts` import it from `types.ts`, mirroring how `StructuredReflection`
already lives in `types.ts` with `retrospective-schema.ts` mirroring it. Follow that same pattern.

- [ ] **Step 1:** Move the two interfaces into `lib/types.ts` (verbatim from Task 1), update
  `block-closeout.ts` to import them. Run `npx tsc --noEmit -p .` → clean.
- [ ] **Step 2:** Extend the existing back-compat test in `lib/data-store.test.ts` (HR-37 describe
  block): construct an entry fixture WITHOUT the four new fields, persist, read back, assert the
  fields are `undefined` and nothing throws.
- [ ] **Step 3: Commit**

```bash
git add lib/types.ts lib/data-store.test.ts lib/block-closeout.ts lib/block-closeout.test.ts
git commit -m "feat(types): additive closeout/approval/early-end fields on BlockHistoryEntry"
```

---

## Task 3: `/api/retrospective` — gate, reorder, de-hard-Claude

The core task. Rewrite the route body; keep GET, slugify, closestCtl, power-profile block, and all
HR-32/33/35 guards intact.

**Files:**
- Modify: `app/api/retrospective/route.ts`
- Test: `app/api/retrospective/route.test.ts` (extend; mocks for the new imports)

**New request contract:** optional body fields `today`, `expectedBlockCreatedAt` (unchanged), plus
`endedEarly?: boolean` and `endReason?: string`.

**Target control flow (in order):**

```
1. parse body; today = resolveToday(b.today)                      // unchanged
2. load block/sync/interventions/profile                          // unchanged
3. GATE: !sync → 400 (unchanged);
   allowed = isBlockFinished(block, today)
           || (b.endedEarly === true && typeof b.endReason === "string" && b.endReason.trim())
   !allowed → 409 { error } BEFORE any write
4. evidence = buildCloseoutEvidence(block, (await readScoreLog()).entries, blockActivities)
5. compliance figures FED TO THE MODEL switch to capped values:
   overallCompliancePct = evidence.overallMeanCompliancePct ?? 0
   complianceByType     = from evidence.perType means        // same RetrospectiveInput shape
6. narrative: if (!isAnthropicConfigured()) skip entirely (logWarn);
   else try generateRetrospective(...) catch → logWarn + continue (retrospective stays undefined)
7. structuredReflections: unchanged degrade-to-[] logic
8. seeds = deriveCloseoutSeeds(evidence, ctlStart, ctlEnd, curveSeed ?? null)
9. markdown: frontmatter gains `execution_evidence:` summary lines (scored/missed/overshoot counts
   + per-type means); Coach-reflections section header reads
   "## Coach reflections (UNAPPROVED — approve on Plan before they reach the next block)" when present
10. writeRetrospective(fileId, frontmatter)                       // unchanged helper
11. appendBlockHistory({ ...entry, closeout: evidence, nextBlockSeeds: seeds,
        retrospective?: narrative, structuredReflections,
        ...(earlyEnd ? { endedEarlyAt: new Date().toISOString(), endedEarlyReason } : {}) })
12. CAS-guarded updateCurrentBlock(() => null, expectedCreatedAt)  // LAST write, unchanged 409 shape
13. response: { retrospective ?? null, seeds, structuredReflections, fileId, complianceByType,
    closeout: evidence, narrativeSkipped?: true }
```

Delete: the `isAnthropicConfigured()` 400 preflight; the inline compliance-math block
(route lines ~88–117); the old seed-derivation loop (~lines 222–234, replaced by Task 1 module).
Import `readScoreLog` from `@/lib/data-store` and `isBlockFinished` from `@/lib/date`.

**Failure ordering guarantees to assert in tests** (extend `route.test.ts`; mock `readScoreLog`,
keep the existing vi.hoisted pattern):

1. Unfinished block, no `endedEarly` → 409; `writeRetrospective`, `appendBlockHistory`,
   `updateCurrentBlock` each NOT called.
2. Unfinished block WITH `{ endedEarly: true, endReason: "Race prep pivot" }` → proceeds; persisted
   entry has truthy `endedEarlyAt` and the reason; empty/whitespace reason → 409.
3. Finished block (`endDate < today`) without `endedEarly` → proceeds normally.
4. `h.isAnthropicConfigured.mockReturnValue(false)` → still 200; `appendBlockHistory` called with
   entry lacking `retrospective`; `updateCurrentBlock` called; response has `narrativeSkipped: true`.
5. `h.generateRetrospective` rejects → 200 (not 502); closeout completes; logWarn path hit.
6. `h.writeRetrospective` rejects → error status; `appendBlockHistory` and `updateCurrentBlock`
   NOT called; block survives.
7. `h.appendBlockHistory` rejects → error status; `updateCurrentBlock` NOT called.
8. Success path: `appendBlockHistory` receives `closeout` evidence whose per-type compliance equals
   the mocked ledger values (NOT raw moving-time ratios) even when the fixture rides 150%+ long.
9. Persisted `structuredReflections` non-empty ⇒ entry has NO `reflectionsApprovedAt` field.
10. Existing tests (CAS 409 mid-LLM window, bare-archive winner selection, today-threading) keep
    passing unmodified except where the removed 502-on-narrative-failure test flips to the new
    degradation expectation — rewrite THAT test only, preserving its intent comment.

Also update `components/dashboard/PlanView.tsx`'s retro call site minimally: when the block is NOT
finished, show an explicit early-end confirm (checkbox + required one-line reason) that sends
`endedEarly`/`endReason`; when finished, send neither. Keep the existing card layout; this is a
confirm state, not a new page. Add a component test asserting the confirm gates the fetch.

- [ ] Steps: write failing route tests (1–10) → run (`npx vitest run app/api/retrospective`) →
  implement route changes → green → PlanView confirm + test → green →
  `npm run check` (tsc + lint + vitest) green.

- [ ] **Commit**

```bash
git add app/api/retrospective/route.ts app/api/retrospective/route.test.ts \
        components/dashboard/PlanView.tsx components/dashboard/plan.tsx components/dashboard/plan.test.tsx
git commit -m "feat(retro): gated, deterministic-first closeout; Claude becomes best-effort"
```

---

## Task 4: Reflection approval — `/api/history` POST + generation filter

**Files:**
- Modify: `app/api/history/route.ts` (add POST; GET untouched)
- Test: `app/api/history/route.test.ts` (new, following `route.test.ts` patterns elsewhere under `app/api/*/`)
- Modify: `app/api/generate/route.ts:169-171`
- Test: extend whichever existing generate-route test file covers context assembly
  (`grep -rl "reflectionsContext\|COACH REFLECTIONS" app/api/generate lib` to locate; if none covers
  it, add a focused unit test around the selection expression extracted to a tiny exported helper
  `latestApprovedReflections(history)` placed in `lib/retrospective-schema.ts` — pure, unit-testable,
  keeps the route thin per RECIPES §API-route)
- Modify: `components/dashboard/plan.tsx` (`BlockHistory`): entries with non-empty
  `structuredReflections` and falsy `reflectionsApprovedAt` render the reflections collapsed with an
  explicit "Review & approve for future blocks" button → POSTs `{ id, approveReflections: true }`;
  approved entries show the stamp. Entries without reflections unchanged.

**Interfaces:**

```ts
// POST /api/history  body: { id: string; approveReflections: true }
// 200 → { ok: true }   · 404 unknown id · 409 already approved · 502 store failure
// impl: updateBlockHistory(entries => entries.map(e =>
//   e.id === id ? { ...e, reflectionsApprovedAt: new Date().toISOString() } : e))
```

Generation filter (replaces the current `.find`):

```ts
const reflectionsContext = formatReflectionsForPrompt(latestApprovedReflections(blockHistory));
// latestApprovedReflections finds the newest entry where
// h.structuredReflections?.length && h.reflectionsApprovedAt  (truthy checks — INVARIANT 3)
```

Tests:
- POST sets the stamp exactly once; second POST → 409; unknown id → 404.
- Old-shape history JSON (no stamp field) → treated unapproved; generation excludes its reflections.
- Approved entry → reflections appear in the assembled context.
- Historical-ledger freeze: the history route test also asserts `score-log.json` is byte-identical
  before/after the POST (reads via the test's data dir fixture).

- [ ] Steps: failing tests → implement → green → `npm run check` green.

- [ ] **Commit**

```bash
git add app/api/history/route.ts app/api/history/route.test.ts \
        lib/retrospective-schema.ts lib/retrospective-schema.test.ts \
        app/api/generate/route.ts components/dashboard/plan.tsx
git commit -m "feat(reflections): explicit athlete approval gates AI strategies out of prompts"
```

---

## Task 5: Docs — canonical descriptions move with the code

**Files:**
- Modify: `docs/systems/04-knowledge.md` — rewrite "The two feedback channels": channel 2 now
  approval-gated; frontmatter contract gains the unapproved-reflections labeling note.
- Modify: `docs/systems/02-scoring-and-learning.md` — Known rough edges: remove/replace the
  duration-ratio-compliance description of retrospectives with the capped-evidence description.
- Modify: `docs/RECIPES.md` § Turn over a block — steps become: backup → sync → wrap up (finished
  blocks auto-proceed; unfinished blocks require the explicit early-end reason) → verify
  `block-history.json` entry has `closeout` → optionally approve reflections on Plan → generate next
  block. Note the no-Claude degraded mode explicitly.
- Modify: `docs/FILE_INDEX.md` — add `lib/block-closeout.ts`; note the `/api/history` POST.
- Modify: `docs/INVARIANTS.md` — append ONE numbered invariant (next free number): closeout order
  (markdown → history → clear-last), approval-gated reflection injection, and the overshoot bar;
  cross-reference review decisions #49–51.
- Check stale pointers (AGENTS.md bug class): `grep -rn "next_block_seeds\|Coach reflections"
  docs/*.md docs/systems docs/superpowers/specs` — fix any anchor that renames.

- [ ] **Commit**

```bash
git add docs/systems/04-knowledge.md docs/systems/02-scoring-and-learning.md \
        docs/RECIPES.md docs/FILE_INDEX.md docs/INVARIANTS.md
git commit -m "docs: canonical closeout/approval descriptions follow the code"
```

---

## Task 6: Attended live smoke run (with the athlete, backup first)

The changed AI path needs one attended live run (INVARIANT 19). Do NOT improvise against live data
(RECIPES turnover failure clause applies).

- [ ] **Step 1:** `GET /api/export` → save the bundle off-machine (the undo).
- [ ] **Step 2:** Sync so final rides are scored. Confirm the block is finished (or agree the
  early-end reason together).
- [ ] **Step 3:** Wrap up the block from /plan. READ the generated markdown
  (`knowledge-base/block-retrospectives/<id>.md`): compliance figures must match the capped ledger
  values; any overshoot day must be labeled a data signal, never "landed well"; seeds sane.
- [ ] **Step 4:** Verify `data/block-history.json`: newest entry has `closeout`, no
  `reflectionsApprovedAt`; `data/current-block.json` cleared.
- [ ] **Step 5:** Degraded-mode check (no new API spend): temporarily unset the key in the dev
  environment, repeat wrap-up on a throwaway block, confirm closeout still lands; restore the key.
- [ ] **Step 6:** Check `data/ai-usage.json` recorded the retrospective call(s); record findings
  (verbatim quotes of any suspicious prose) in the PR description.
- [ ] **Step 7:** If anything is wrong: stop, `POST /api/import` the backup, report.

---

## Completion criteria

Each boundary maps to shipped proof:

| Boundary | Proof |
|---|---|
| Completed block or explicit early-end precedes closeout | Route test 1–3; PlanView confirm |
| Deterministic closeout without Claude | Route test 4 + smoke Step 5 |
| Execution/compliance evidence, not uncapped ratio | `block-closeout` tests 1, 4; route test 8 |
| Overshoot ≠ safe-to-progress | `block-closeout` tests 1–2; smoke Step 3 reading |
| Facts/narrative/seeds separate | `BlockHistoryEntry.closeout` vs `.retrospective` vs `.nextBlockSeeds`; markdown section split |
| AI reflections need explicit approval | History POST tests; generate-filter tests; Plan UI button |
| Ledger stays frozen | Ledger-freeze assertion in Task 4; zero score-log writes in diff |
| Old JSON readable | Task 2 back-compat test; truthy-check audit |
| Failures never clear block early | Route tests 6–7; write-order invariant text |
| Live smoke run | Task 6 artifacts in PR description |

Final gate: `npm run check` green; then `npm run finish:agent-task` opens the implementation PR
(this plan's own PR is docs-only and opened separately). Update ROADMAP.md's Phase 1 retrospective
bullet status in the implementation PR's closing-ritual pass, never in `docs/superpowers/plans/`
(IMMUTABLE per INVARIANT 27).
