# First Loop-Turnover Readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **HARD DEADLINE: 2026-07-12** — the current block's `endDate`. This is the first-ever full learning-loop turnover in the app's life.

**Goal:** The first block completion → retrospective → block-history archive → next-block write → intervention snapshot runs cleanly. Two files that anchor the entire learning thesis get created **for the first time ever** in this event: `block-history.json` (at retrospective) and `intervention-log.json` (at next block write). Neither path has ever run against real data. If the turnover silently fails or writes malformed first entries, weeks of waiting for loop data are lost — and the audit's P1 ("turn the loop over") slips a full block.

**What this is:** mostly *verification + two small fixes*, not a feature. Scope is deliberately tight.

**Known facts (verified 2026-07-03):**
- `/api/retrospective` is the **only turnover-critical route with no route test** (`app/api/*/route.test.ts` exists for write, sync, generate, and 9 others — not retrospective). It generates the retro (LLM), builds the first `BlockHistoryEntry` (`app/api/retrospective/route.ts:241-264`), and **destructively clears the current block** (`writeCurrentBlock(null)`).
- `/api/write` records interventions (`app/api/write/route.ts:166-180`) — `intervention-log.json` does not exist yet, so the first write exercises the empty-log path for the first time.
- Known debt (ROADMAP "Macro periodization → Known debt"): `CurrentBlock.seasonFocus`/`seasonPhase` are stamped from **today** (`app/api/write/route.ts:119` — `currentPeriod(await readSeasonPlan(), today)`), not the block's start date. "Worth a conscious choice once #4-style validation reads them back" — that moment is now: the first block-history entry is about to inherit these stamps permanently.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, Vitest.

## Global Constraints

- **Do not refactor the retrospective route** — add tests around current behavior; fix only what the tests prove broken.
- **The retro is an LLM path** — per `AGENTS.md`, unit tests + green build don't count as exercising it; the live smoke run happens *attended* via the runbook (Task 4), not in CI. Mock `generateRetrospective` in tests.
- **Concurrent checkout:** stage only files you touched; commit on `main`.
- **Verification loop:** `npx tsc --noEmit && npm run lint && npm test && npm run build`.

---

### Task 1: Season stamp uses the block's start date

**Files:**
- Modify: `app/api/write/route.ts:119` (and the stamp at `:132`)
- Test: `app/api/write/route.test.ts`

**Steps:**
- [ ] Change `currentPeriod(await readSeasonPlan(), today)` → resolve the period **as of the block's `startDate`** (the request's start date, already in scope for the block being written). A block starting next Monday inside a new focus period must be stamped with *that* period, not the one live at generation time.
- [ ] Test: write a block whose `startDate` falls in a different `FocusPeriod` than today → stamped `seasonFocus`/`seasonPhase` match the start-date period. Also: no season plan / no matching period → stamp absent (existing spread semantics at `:132` preserved).
- [ ] ROADMAP: delete this bullet from "Macro periodization → Known debt" (it's fixed, not tracked-accepted anymore).

### Task 2: Route test for `/api/retrospective`

**Files:**
- Create: `app/api/retrospective/route.test.ts` (follow the harness/mocking pattern of `app/api/write/route.test.ts` — same data-store mocking approach as SUB-3)

**Steps:**
- [ ] Mock the LLM (`generateRetrospective`, and the structured-reflections call) and the data stores. Cover:
  - **History entry integrity:** completed block → `BlockHistoryEntry` carries `id`, `goal`, dates, `complianceByType`, `nextBlockSeeds`, `retrospective`, `structuredReflections`, `model`, `promptVersion`, and `days` (SUB-1 — truncated via `truncateBlockDays`, every day past for a finished block).
  - **Current block cleared** (`writeCurrentBlock(null)`) only after the history append succeeds — if append throws, the block must not be orphaned (verify current behavior; if the ordering is wrong, fix it: append first, clear second).
  - **Structured-reflections failure tolerance:** that call throwing → retro still completes with `structuredReflections: []` (`:180-181` claims this — prove it).
  - **Matured interventions** (`:142`) read from an **empty/missing** `intervention-log.json` → no crash, empty input (this is exactly the state on 2026-07-12).
  - **Retro file written** to `block-retrospectives/` with frontmatter (`next_block_seeds` present).
- [ ] Any failures found: fix minimally, one commit per fix, in the same task.

### Task 3: First-ever intervention write

**Files:**
- Test: extend `app/api/write/route.test.ts`
- Possibly touch: `lib/intervention.ts` (`buildInterventions` `:80`, `mergeInterventions` `:109`) — only if the test proves a bug

**Steps:**
- [ ] Test: block write with **no existing** `intervention-log.json` (store read returns the empty default) + non-empty coaching directives → log created with one record per directive, each with a baseline snapshot (`physMarkerFor`), correct block id linkage.
- [ ] Test: directives empty (possible — the model may return no insights above the gate) → write succeeds, no intervention records, no file-shape corruption.
- [ ] Watch for the **migration-flag bug class** (`AGENTS.md`): any guard on a field of the never-yet-written log must be truthy-checked, not `=== null`.

### Task 4: Turnover runbook (attended, 2026-07-12 or the first sync after)

**Files:**
- Modify: `WORKFLOW.md` (append a short "First block turnover — runbook" section; keep it lean, it's the personal cheat sheet)

**Steps:**
- [ ] Write the runbook:
  1. **Backup first:** `GET /api/export` → save the bundle off-machine (SUB-4 path). The retro clears `current-block.json` — this is the undo.
  2. Sync (`POST /api/sync`) so the final rides are scored into the ledger.
  3. `POST /api/retrospective` — **read the generated retro** (this is the live LLM smoke run per AGENTS.md; judge the narrative + seeds for sanity).
  4. Verify: `data/block-history.json` exists, entry has `days` (28), `seasonFocus`/`seasonPhase` (per Task 1), `nextBlockSeeds` non-empty.
  5. Generate + preview + write the next block on `/plan`.
  6. Verify: `data/intervention-log.json` now exists with this block's directives + baselines; `current-block.json` is the new block.
  7. Confirm `/today` shows the new block's first session; the block-completion nudge is gone.
  - If any step fails: stop, `POST /api/import` the backup, report — do not improvise against live data.

## Acceptance criteria

1. Season stamps derive from block start date (test-proven).
2. `/api/retrospective` has a route test covering the five behaviors above; suite green.
3. First-ever intervention write path test-proven against a missing log file.
4. Runbook in `WORKFLOW.md`.
5. `npx tsc --noEmit && npm run lint && npm test && npm run build` pass.

## Edge cases

- Retro invoked while block unfinished (`isBlockFinished` false) → route's existing guard behavior preserved (test it, whatever it is).
- Block with zero scored planned rides (all compromised/missed) → complianceByType empty but retro must not crash.
- Two A-events / no season plan → stamp absent, not wrong.
