# Reliable Long Blocks and Season Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate six- and eight-week blocks without a fixed-output truncation failure, preserve readable generator controls at laptop widths, and explain the automatic season roadmap.

**Architecture:** Keep output-budget selection in the Anthropic call layer, keyed solely by block length. Thread the provider stop reason into the route so it can return a precise error. Keep SeasonRoadmap presentational: it describes the already persisted derived plan without changing how `replanSeasonArc` builds periods.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Tailwind CSS, Anthropic SDK.

## Global Constraints

- Use `localToday()` / `resolveToday()` for user-facing current-date behavior.
- Do not alter the season-periodization algorithm or automatic calendar writes.
- A changed LLM generation path requires one live smoke run and inspection of its actual output.
- Preserve the existing 2/4/6/8 week API contract.

---

### Task 1: Length-aware generation allowance and truncation reporting

**Files:**
- Modify: `lib/anthropic-api.ts:42-175`
- Modify: `app/api/generate/route.ts:285-301`
- Modify: `app/api/generate/route.test.ts`

**Interfaces:**
- Produces: `generationMaxTokens(lengthWeeks: 2 | 4 | 6 | 8): number`.
- Produces: `GenerationResult.stopReason: string | null`.
- Consumes: `BlockParams.lengthWeeks` at the existing route-to-client call boundary.

- [ ] **Step 1: Write failing tests**

Add focused assertions that `generationMaxTokens(4)` is `8000`, that 6 and 8 weeks receive larger limits, and that a mocked response with `stop_reason: "max_tokens"` is returned to the route. Add a route test that expects the user-facing error `The generated 6-week plan exceeded the response limit. Please retry; the app will request a larger response.` when the structured payload is absent and the stop reason is `max_tokens`.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npm test -- lib/anthropic-api.test.ts app/api/generate/route.test.ts`

Expected: failure because the selector and stop-reason behavior do not yet exist.

- [ ] **Step 3: Implement the minimum behavior**

Add a pure length-to-budget function in `lib/anthropic-api.ts`, retain 8,000 tokens for 2/4-week plans, and pass the requested block length to `generateTrainingBlock`. Include `response.stop_reason` in `GenerationResult`. In the route, test `stopReason === "max_tokens"` before generic structured-payload validation and return the precise truncation error.

- [ ] **Step 4: Re-run focused tests**

Run: `npm test -- lib/anthropic-api.test.ts app/api/generate/route.test.ts`

Expected: all focused tests pass.

### Task 2: Responsive generator layout regression

**Files:**
- Modify: `components/dashboard/BlockGenerator.tsx:139`
- Test: `components/dashboard/BlockGenerator.test.tsx`

**Interfaces:**
- Produces: four-column layout only at the `xl` breakpoint.

- [ ] **Step 1: Write a failing component regression test**

Render `BlockGenerator` with the required props and assert that its field-grid class contains `sm:grid-cols-2` and `xl:grid-cols-4`, and does not contain `lg:grid-cols-4`.

- [ ] **Step 2: Run the component test and verify it fails**

Run: `npm test -- components/dashboard/BlockGenerator.test.tsx`

Expected: failure because the grid currently has `lg:grid-cols-4`.

- [ ] **Step 3: Implement the minimum class change**

Replace `lg:grid-cols-4` with `xl:grid-cols-4`; preserve the existing two-column small-screen behavior and all field markup.

- [ ] **Step 4: Re-run the component test**

Run: `npm test -- components/dashboard/BlockGenerator.test.tsx`

Expected: pass.

### Task 3: Explain automatic season construction

**Files:**
- Modify: `components/SeasonRoadmap.tsx:14-84`
- Test: `components/SeasonRoadmap.test.tsx`

**Interfaces:**
- Produces: a concise roadmap explanation for derived periods without changing the period data.

- [ ] **Step 1: Write a failing component test**

Render a roadmap response containing at least one `source: "derived"` period. Assert that the UI explains that the roadmap is auto-drafted from season inputs and refreshes when a block is generated.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- components/SeasonRoadmap.test.tsx`

Expected: failure because the derived-plan explanation is absent.

- [ ] **Step 3: Implement the minimum presentation-only explanation**

When `plan.periods.some((period) => period.source === "derived")`, render a small explanatory line below the roadmap: `Auto-drafted from your objective, events, fitness/load, and current limiter. It refreshes when you generate a block.` Do not alter fetches, persistence, or the season engine.

- [ ] **Step 4: Re-run the component test**

Run: `npm test -- components/SeasonRoadmap.test.tsx`

Expected: pass.

### Task 4: Verify the integrated change

**Files:**
- Verify: the files changed in Tasks 1–3

- [ ] **Step 1: Run static and full automated verification**

Run: `npm run check`

Expected: TypeScript, ESLint, and all Vitest files pass.

- [ ] **Step 2: Run a live six-week generation smoke test**

Start the app locally, submit a six-week block through `POST /api/generate` with the configured Anthropic key, and inspect the returned plan. Verify it contains exactly 42 days and does not report a truncation error.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check && git diff -- lib/anthropic-api.ts app/api/generate/route.ts components/dashboard/BlockGenerator.tsx components/SeasonRoadmap.tsx`

Expected: no whitespace errors and only the planned behavior changes.
