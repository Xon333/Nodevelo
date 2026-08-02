# Nutrition Safety Transparency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the active RMR floor honestly and make every coach-signal fallback use the athlete's local date.

**Architecture:** `GET /api/profile` computes today's target from today's resolved activity burn with the existing `calculateDailyTarget` authority and returns that plan in `derivation`; the Profile UI renders it without duplicating arithmetic. `resolveCoachSignals` resolves `today ?? localToday()` once and passes that date to every downstream calculation. Weekly adherence remains explicitly approximate until complete day-level prescription provenance exists.

**Tech Stack:** TypeScript 5, Next.js 16 App Router, React 19, Vitest.

## Global Constraints

- No historical buffer reconstruction or mixed exact/approximate weekly ratio.
- No new nutrition equation or AI prompt change.
- Use athlete-local dates for user-facing "today".
- Preserve legacy nutrition behavior (`floored: false`).
- Verify with `npm run check` and inspect the Profile derivation in the local UI.

---

### Task 1: Coach signals use one local date

**Files:**
- Modify: `lib/coach-snapshot.ts`
- Test: `lib/coach-snapshot.test.ts`

**Interfaces:**
- Consumes: `localToday(): string`
- Produces: unchanged `resolveCoachSignals(...)`; its optional-date fallback becomes local.

- [ ] Add a failing test comparing an omitted-date call with an explicit `localToday()` call.
- [ ] Run `npx vitest run lib/coach-snapshot.test.ts` and verify the test fails against the UTC fallback.
- [ ] Replace `utcToday()` with one `resolvedToday = today ?? localToday()` and feed it to ACWR, load ramp, athlete state, energy availability, and FTP retest.
- [ ] Re-run the focused test and TypeScript.

### Task 2: Return and render the authoritative floored target

**Files:**
- Modify: `app/api/profile/route.ts`
- Test: `app/api/profile/route.test.ts`
- Modify: `components/AthleteProfileForm.tsx`

**Interfaces:**
- Consumes: `activeBurn(activity)` and `calculateDailyTarget(todayBurn, nutritionModel, bufferStatus.bufferApplied, isRestDayToday)`
- Produces: `derivation.todayPlan: WorkoutNutritionPlan`

- [ ] Add a failing profile-route test whose negative buffer activates the RMR floor and assert `todayPlan.floored`, final target, and pre-floor arithmetic inputs.
- [ ] Run the focused route test and verify it fails because `todayPlan` is absent.
- [ ] Compute `todayPlan` once in the profile route and return it in `derivation`.
- [ ] Extend the client `Derivation` type and render `todayPlan.dailyTarget`; when `floored`, show the unclamped arithmetic and explain that the target was raised to RMR.
- [ ] Re-run profile tests and TypeScript.

### Task 3: Documentation and completion

**Files:**
- Modify: `docs/systems/09-nutrition.md`
- Modify: `todo.md`

- [ ] Record the conditional floor display, local-date fix, and why weekly adherence remains approximate.
- [ ] Run `npm run check`.
- [ ] Inspect the Profile derivation in the local UI.
- [ ] Review `git diff --check`, commit exact files, and push `codex`.
