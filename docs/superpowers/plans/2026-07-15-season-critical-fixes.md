# Season Engine Critical Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two confirmed season-engine defects — the deload-flag collision in `assignLoadTargets` that flattens every period to ~0.6x seed and makes the taper week the season's heaviest, and the two-state build-focus oscillation in `nextBuildFocus` that permanently starves vo2max/durability — test-first, with no public signature changes.

**Architecture:** Both fixes are internal to the pure, deterministic functions in `lib/season.ts`. `deloadWeek` keeps its existing meaning everywhere ("this period's trailing week is lighter") — it is still set by `applyDeloadCadence`, still surfaces in `formatSeasonContext`'s prompt phrase and the roadmap UI, and the actual lighter week is still sized by the block generator's `BlockSettings.recoveryWeekHoursMin/Max`; the only change is that `assignLoadTargets` stops (mis)reading the flag as "dampen this whole period and freeze the ramp." `nextBuildFocus`'s fallback becomes least-recently-used over `BUILD_FOCI` instead of a first-non-last scan. Signatures of `assignLoadTargets`, `nextBuildFocus`, `draftSeasonArc`, `applyDeloadCadence`, and `replanSeasonArc` are all unchanged, so `app/api/generate/route.ts` (the only external caller, via `replanSeasonArc`/`formatSeasonContext`/`validateSeasonFit`) is NOT touched.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest.

## Global Constraints

- Use `localToday()` / `resolveToday()` for user-facing current-date behavior — never inline UTC date math for "what day is it now." (No new "today" logic is expected in this plan; if any creeps in, this rule applies.)
- Guard any new `fooMigratedAt`-style field with a truthy check, never `=== null`. (No migration flags are expected in this plan.)
- No damping/gradual rollout for the corrected load math — apply the fix immediately (explicit product decision; the athlete will delete and regenerate their current block after this ships).
- Do NOT touch `lib/anthropic-prompts.ts` or `app/api/generate/route.ts` — both fixes stay purely internal to `lib/season.ts` with no signature changes (verified: the route only imports `formatSeasonContext`, `replanSeasonArc`, `validateSeasonFit`, none of which change shape).
- Out of scope: the fuller weighted/scored focus-selector redesign (goals/trainability scoring) — that is a separate, later plan. This plan ships only the narrow LRU fallback.
- All test fixtures below were computed against the real rounding path and checked for IEEE `.x5` boundary flips (pre-rounding values: 424.0…, 449.44, 475.94, 504.56, 854.36, 905.24, 959.30, 1016.54, 1078.02 — none sit on a .5 boundary). Do not "simplify" them to other seeds without re-checking.

---

### Task 1: Bug 1 — `assignLoadTargets` must ignore `deloadWeek` (every period ramps, ramp base always advances)

The bug (verified in current source, `lib/season.ts:126-138`): `assignLoadTargets` reads `deloadWeek` as "run this WHOLE period at 0.6x and freeze the ramp base," but `applyDeloadCadence` flags essentially every 3-4-week period (the 3:1 boundary trips inside every multi-week period), so every real season plateaus at `round(seed * 0.6)` ≈ 484 for this athlete's seed of 806, and the one unflagged single-week sharpen period inherits the never-advanced `prev` and spikes to `round(806 * 1.06)` = 854 — +76% above the plateau, on the nominal taper week. The fix: `targetWeeklyTss` is the period's LOADING-week target; remove the `p.deloadWeek ? ... : ...` branch entirely so every period computes `min(round(prev * 1.06), round(seed * acwrCeiling))` and `prev` always advances. `deloadWeek` itself and all its other consumers (roadmap UI, `formatSeasonContext`'s " · deload week" phrase, the block generator's recovery-week hours) stay byte-identical.

**Files:**
- Modify: `lib/season.ts:122-138` (the doc comment at 122-125 and the function body at 126-138; line numbers verified 2026-07-15)
- Test: `lib/season.test.ts` (replace the obsolete test at lines 80-94 inside `describe("load envelope", ...)`; add one test to the same describe and one to `describe("draftSeasonArc — Mode-C", ...)` at lines 34-59)

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first task).
- Produces (unchanged signature, changed behavior): `assignLoadTargets(periods: FocusPeriod[], seedWeeklyTss: number | null, acwrCeiling: number): FocusPeriod[]` — every returned period has `targetWeeklyTss = Math.min(Math.round(prev * 1.06), Math.round(seedWeeklyTss * acwrCeiling))` with `prev` advancing every period regardless of `deloadWeek`; `null`/non-finite/`<= 0` seed still yields all-`null` targets. Task 3 relies on this behavior being live when it runs the integration check.

- [ ] **Step 1: Replace the obsolete deload-damping test with the corrected-semantics test (this is the failing test)**

In `lib/season.test.ts`, inside `describe("load envelope", ...)`, DELETE this entire obsolete test (it pins the buggy behavior — currently lines 80-94):

```ts
  it("does not advance the ramp base past a deload — resumes the ramp from the pre-deload target", () => {
    const periods = [
      { ...p(), deloadWeek: false },
      { ...p(), deloadWeek: false },
      { ...p(), deloadWeek: true }, // deload — must not become the new ramp base
      { ...p(), deloadWeek: false },
      { ...p(), deloadWeek: false },
    ];
    const out = assignLoadTargets(periods, 400, 1.3);
    expect(out[0].targetWeeklyTss).toBe(424); // 400 * 1.06
    expect(out[1].targetWeeklyTss).toBe(449); // 424 * 1.06, rounded
    expect(out[2].targetWeeklyTss).toBe(269); // deload: 449 * 0.6, rounded — prev stays 449
    expect(out[3].targetWeeklyTss).toBe(476); // resumes from 449 (pre-deload), NOT 269: 449 * 1.06, rounded
    expect(out[4].targetWeeklyTss).toBe(505); // 476 * 1.06, rounded
  });
```

and WRITE this in its place (the existing `p()` helper at the top of the same describe is reused as-is):

```ts
  it("ignores deloadWeek entirely — every period ramps and the base always advances (the lighter week lives inside the block, not in this envelope)", () => {
    const periods = [
      { ...p(), deloadWeek: false },
      { ...p(), deloadWeek: false },
      { ...p(), deloadWeek: true }, // flagged: the TRAILING week is lighter — but the loading-week target still ramps
      { ...p(), deloadWeek: false },
      { ...p(), deloadWeek: false },
    ];
    const out = assignLoadTargets(periods, 400, 1.3);
    expect(out.map((x) => x.targetWeeklyTss)).toEqual([424, 449, 476, 505, 520]); // +6% each, last capped at 400 * 1.3
    expect(out[2].deloadWeek).toBe(true); // the flag itself is untouched — display/prompt consumers still see it
  });
```

- [ ] **Step 2: Add the failing all-periods-flagged test with the real athlete seed**

In `lib/season.test.ts`, immediately after the test added in Step 1 (still inside `describe("load envelope", ...)`), add:

```ts
  it("real cadence shape (every multi-week period flagged) ramps off the seed instead of freezing at 0.6x", () => {
    // Real generated-season shape: every 3-4-week period trips the 3:1 boundary and carries
    // deloadWeek: true; only the single-week sharpen doesn't. Seed = this athlete's real
    // 90-day baseline x 7 ~= 806. The old bug produced [484, 484, 484, 484, 854] — a 0.6x
    // plateau with the nominal taper week spiking +76% above it.
    const flagged = (weeks: number, deload: boolean) => ({ ...p(), plannedWeeks: weeks, deloadWeek: deload });
    const out = assignLoadTargets(
      [flagged(4, true), flagged(3, true), flagged(4, true), flagged(3, true), flagged(1, false)],
      806,
      1.3
    );
    expect(out.map((x) => x.targetWeeklyTss)).toEqual([854, 905, 959, 1017, 1048]); // +6% ramp, capped at round(806 * 1.3)
  });
```

- [ ] **Step 3: Add the failing arc-level envelope test**

In `lib/season.test.ts`, inside `describe("draftSeasonArc — Mode-C", ...)`, after the `it("drafts base(if gated) → rotating build periods → a realize week, dated contiguously", ...)` test, add:

```ts
  it("drafted arcs carry a monotonically ramping load envelope — no 0.6x plateau, no taper-week spike", () => {
    // baseInput's recentFocuses includes aerobic-base → no base gate → exactly horizonPeriods (5) periods.
    const arc = draftSeasonArc(baseInput({ recentWeeklyTss: 806 }), "2026-07-01");
    expect(arc).toHaveLength(5);
    // Every 3-4-week period trips the 3:1 cadence; only the 1-week sharpen doesn't — the real pathology shape.
    expect(arc.map((x) => x.deloadWeek)).toEqual([true, true, true, true, false]);
    const targets = arc.map((x) => x.targetWeeklyTss!);
    expect(targets).toEqual([854, 905, 959, 1017, 1048]);
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i]).toBeGreaterThanOrEqual(targets[i - 1]); // never a spike after a plateau
    }
  });
```

(Note: this test's `deloadWeek`/target expectations hold under BOTH the current and the Task-2 focus rotation — every non-sharpen focus is 3 or 4 planned weeks, and targets depend only on period count, not focus — so Task ordering cannot break it.)

- [ ] **Step 4: Run the season suite, expect exactly the three new tests to fail**

Run: `npm test -- lib/season.test.ts`

Expected: 3 failures, all in the tests just written, with these shapes (all other tests pass):
- Step 1 test: `expected [ 424, 449, 269, 476, 505 ] to deeply equal [ 424, 449, 476, 505, 520 ]`
- Step 2 test: `expected [ 484, 484, 484, 484, 854 ] to deeply equal [ 854, 905, 959, 1017, 1048 ]`
- Step 3 test: `expected [ 484, 484, 484, 484, 854 ] to deeply equal [ 854, 905, 959, 1017, 1048 ]`

If anything OTHER than these three fails, stop — check `git status --short` on the failing file first (a concurrent session may be mid-edit) before assuming this change caused it.

- [ ] **Step 5: Implement the fix in `lib/season.ts`**

Replace the doc comment + function at `lib/season.ts:122-138` (currently the comment "Ramps each period's targetWeeklyTss ~+loadRampPct% off the prior period (first period off seedWeeklyTss). / A deload period gets ~60% of the running load and does NOT advance the ramp base. / Capped so a target never exceeds seedWeeklyTss * acwrCeiling. / Null seed → all targets remain null." and the function below it) with:

```ts
// Ramps each period's targetWeeklyTss ~+loadRampPct% off the prior period (first period off seedWeeklyTss).
// targetWeeklyTss is the period's LOADING-week target: every period advances the ramp — deloadWeek does
// NOT dampen it. The flag means "this period's TRAILING week is lighter", and that lighter week is sized
// downstream (BlockSettings.recoveryWeekHoursMin/Max in the block generator + formatSeasonContext's
// "deload week" prompt phrase), never by this envelope. (The old 0.6x/frozen-base branch here collided
// with applyDeloadCadence flagging every 3-4-week period, flattening whole seasons to ~0.6x seed and
// making the unflagged sharpen week the heaviest of the season.)
// Capped so a target never exceeds seedWeeklyTss * acwrCeiling.
// Null seed → all targets remain null.
export function assignLoadTargets(periods: FocusPeriod[], seedWeeklyTss: number | null, acwrCeiling: number): FocusPeriod[] {
  if (seedWeeklyTss === null || !Number.isFinite(seedWeeklyTss) || seedWeeklyTss <= 0) {
    return periods.map((p) => ({ ...p, targetWeeklyTss: null }));
  }
  const ramp = 1 + SEASON_CONSTANTS.loadRampPct / 100;
  const ceiling = seedWeeklyTss * acwrCeiling;
  let prev = seedWeeklyTss;
  return periods.map((p) => {
    const target = Math.min(Math.round(prev * ramp), Math.round(ceiling));
    prev = target;
    return { ...p, targetWeeklyTss: target };
  });
}
```

Touch nothing else in the file — `applyDeloadCadence`, `formatSeasonContext`, `roadmapView`, and `period()`'s `deloadWeek: false` initializer all keep their current text and behavior.

- [ ] **Step 6: Run the season suite, expect all green**

Run: `npm test -- lib/season.test.ts`

Expected: all tests pass, including the pre-existing `"ramps ~+6% off the seed, capped by ACWR"`, `"withholds targets when there is no seed (no FTP/CTL)"`, both `"deload cadence"` tests, the `formatSeasonContext` COMPAT byte-identical test, and the event-anchored deload-exemption test — none of those touch the removed branch.

- [ ] **Step 7: Commit**

Run:
```
git add lib/season.ts lib/season.test.ts
git commit -m "fix(season): deloadWeek no longer dampens/freezes the load ramp — every period advances"
```
(Stage ONLY these two files — never `git add -A`; a concurrent session may share this checkout.)

---

### Task 2: Bug 2 — `nextBuildFocus` fallback becomes least-recently-used (breaks the two-state trap)

The bug (verified in current source, `lib/season.ts:61-73`): with a confident limiter of `"anaerobic"`, the function alternates `anaerobic → threshold → anaerobic → threshold → ...` forever, because whenever `last === "anaerobic"` the fallback `defaultBuildOrder().find((f) => f !== last)` immediately returns `"threshold"` (index 0 — `"anaerobic"` was never in that array). `vo2max` and `durability` are structurally unreachable. The narrow fix: when the confident-limiter branch doesn't fire, rank all of `BUILD_FOCI` (`["threshold", "vo2max", "anaerobic", "durability"]`, `lib/season.ts:53`) by how recently each appeared anywhere in `recentFocuses` (`lastIndexOf`; `-1` = never = maximally stale) and pick the least-recently-used, breaking ties by `defaultBuildOrder()`'s existing order (`["threshold", "vo2max", "durability"]`), with `anaerobic` — absent from the default order — sorting last among ties so it only ever surfaces via genuine staleness, never as a tiebreak default. `defaultBuildOrder()` itself is unchanged (a test pins its value, and `backwardScheduleFromEvent` still consumes it directly).

**Files:**
- Modify: `lib/season.ts:60-73` (the comment at line 60 and the `nextBuildFocus` function; line numbers verified 2026-07-15)
- Test: `lib/season.test.ts` (two new tests inside `describe("draftSeasonArc — Mode-C", ...)`, after the existing `it("never repeats a focus back-to-back", ...)` at lines 47-49)

**Interfaces:**
- Consumes: nothing from Task 1 (independent change; the shared file is the only overlap — Task 1's commit lands first).
- Produces (unchanged signature, changed fallback behavior): `nextBuildFocus(limiter: SeasonDraftInput["limiter"], recentFocuses: SeasonFocus[]): SeasonFocus` — confident-limiter branch identical; fallback returns the least-recently-used member of `BUILD_FOCI`, never equal to `recentFocuses[recentFocuses.length - 1]`. Task 3 relies on this being live for the roadmap-rotation smoke check.

- [ ] **Step 1: Write the failing oscillation-break test (the real athlete's scenario)**

In `lib/season.test.ts`, inside `describe("draftSeasonArc — Mode-C", ...)`, after `it("never repeats a focus back-to-back", ...)`, add:

```ts
  it("confident-limiter rotation eventually surfaces every build focus — not a two-state trap", () => {
    // Real athlete case: limiter = confident anaerobic. The old fallback alternated
    // anaerobic → threshold forever; vo2max and durability were structurally unreachable.
    const limiter = { system: "anaerobic" as const, confidence: "high" as const };
    const recent: import("./types").SeasonFocus[] = ["aerobic-base"];
    const picks: import("./types").SeasonFocus[] = [];
    for (let i = 0; i < 6; i++) {
      const f = nextBuildFocus(limiter, recent);
      picks.push(f);
      recent.push(f);
    }
    expect(picks).not.toEqual(["anaerobic", "threshold", "anaerobic", "threshold", "anaerobic", "threshold"]); // the old trap
    expect(picks).toContain("vo2max");
    expect(picks).toContain("durability");
    // The limiter still leads every other period; the interleaved periods rotate least-recently-used.
    expect(picks).toEqual(["anaerobic", "threshold", "anaerobic", "vo2max", "anaerobic", "durability"]);
  });
```

- [ ] **Step 2: Write the failing LRU-preference regression test**

Immediately after the Step 1 test, add:

```ts
  it("REGRESSION: the fallback is least-recently-used, not first-in-default-order", () => {
    // Old code returned "threshold" for both of these unconditionally (first non-last entry of
    // defaultBuildOrder), even when vo2max/durability had never appeared at all.
    expect(nextBuildFocus({ system: "anaerobic", confidence: "high" }, ["threshold", "anaerobic"])).toBe("vo2max");
    expect(nextBuildFocus({ system: "anaerobic", confidence: "high" }, ["threshold", "vo2max", "anaerobic"])).toBe("durability");
  });
```

- [ ] **Step 3: Run the season suite, expect exactly the two new tests to fail**

Run: `npm test -- lib/season.test.ts`

Expected: 2 failures, both in the tests just written (all others pass, including all Task 1 tests):
- Step 1 test: fails at `expect(picks).not.toEqual([...])` (old code produces exactly the oscillation) — or, if Vitest reports the first failing matcher differently, at `expect(picks).toContain("vo2max")` with `expected [ 'anaerobic', 'threshold', 'anaerobic', 'threshold', 'anaerobic', 'threshold' ] to include 'vo2max'`
- Step 2 test: `expected 'threshold' to be 'vo2max'`

- [ ] **Step 4: Implement the LRU fallback in `lib/season.ts`**

Replace the comment + function at `lib/season.ts:60-73` (currently the comment "// Weakest system first when confident; else default rotation. Never repeat the last focus (KB variety)." and the `nextBuildFocus` function) with:

```ts
// Weakest system first when confident; else a least-recently-used rotation over BUILD_FOCI (KB variety).
// Never repeats the last focus — the last focus is by definition the most recently used candidate.
export function nextBuildFocus(
  limiter: SeasonDraftInput["limiter"],
  recentFocuses: SeasonFocus[]
): SeasonFocus {
  const last = recentFocuses[recentFocuses.length - 1] ?? null;
  const wanted =
    limiter.system && limiter.confidence !== "low" && BUILD_FOCI.includes(limiter.system)
      ? limiter.system
      : null;
  if (wanted && wanted !== last) return wanted;
  // LRU fallback: the candidate that appeared furthest back in recentFocuses wins (lastIndexOf === -1,
  // i.e. never appeared, wins outright). Ties break by defaultBuildOrder()'s stable order; anaerobic
  // (absent from the default order) sorts last among ties, so it surfaces only via genuine staleness,
  // never as a tiebreak default. This replaces the old first-non-last scan over defaultBuildOrder(),
  // which locked a confident limiter into a permanent two-focus alternation (anaerobic → threshold →
  // anaerobic → ...) and starved vo2max/durability forever.
  const order = defaultBuildOrder();
  const tiebreak = (f: SeasonFocus): number => {
    const i = order.indexOf(f);
    return i === -1 ? order.length : i;
  };
  return [...BUILD_FOCI].sort(
    (a, b) => recentFocuses.lastIndexOf(a) - recentFocuses.lastIndexOf(b) || tiebreak(a) - tiebreak(b)
  )[0];
}
```

Declaration order is already correct and needs no moves: `defaultBuildOrder` (line 33) and `BUILD_FOCI` (line 53) both sit above `nextBuildFocus` (line 61), and `nextBuildFocus` already references `BUILD_FOCI` today. Touch nothing else — `defaultBuildOrder()` keeps returning `["threshold", "vo2max", "durability"]`.

- [ ] **Step 5: Run the season suite, expect all green — including the pre-existing rotation assertions**

Run: `npm test -- lib/season.test.ts`

Expected: all tests pass. Specifically confirm these pre-existing assertions still hold under the new fallback (they do by construction — verified by hand-trace):
- `nextBuildFocus({ system: "vo2max", confidence: "high" }, ["threshold"])` → `"vo2max"` (limiter branch, untouched)
- `nextBuildFocus({ system: null, confidence: "low" }, ["threshold"])` → `"vo2max"` (LRU: vo2max/durability/anaerobic all never-seen; tiebreak picks vo2max)
- `nextBuildFocus({ system: "threshold", confidence: "high" }, ["threshold"])` → not `"threshold"` (LRU never returns the most-recent candidate)
- `defaultBuildOrder()` → `["threshold", "vo2max", "durability"]` (unchanged)
- the `replanSeasonArc` idempotency tests (the LRU fallback is deterministic, so fixed-point replans are preserved)

- [ ] **Step 6: Commit**

Run:
```
git add lib/season.ts lib/season.test.ts
git commit -m "fix(season): least-recently-used build-focus fallback breaks the anaerobic/threshold two-state trap"
```
(Stage ONLY these two files.)

---

### Task 3: Integration check + live smoke verification

**Files:**
- Verify (no edits): `lib/season.ts`, `lib/season.test.ts`, `app/api/generate/route.ts` (confirm untouched)

**Interfaces:**
- Consumes: Task 1's corrected `assignLoadTargets` behavior and Task 2's LRU `nextBuildFocus` behavior (both already committed; no new symbols).
- Produces: nothing — verification only.

- [ ] **Step 1: Run the full static + test gate**

Run: `npm run check`

Expected: `tsc --noEmit` clean, lint clean, full Vitest suite green. If a failure surfaces in a file NOT edited in Tasks 1-2, run `git status --short <file>` first — an uncommitted concurrent-session edit is not this plan's regression; wait ~30s, retry once, and if it persists report it instead of patching.

- [ ] **Step 2: Confirm no call-site changes were needed**

Run: `grep -rn "assignLoadTargets\|nextBuildFocus" app components lib --include="*.ts" --include="*.tsx" | grep -v "lib/season.ts\|lib/season.test.ts"`

Expected: no output. Both fixed functions are consumed only inside `lib/season.ts` (by `draftSeasonArc`, whose signature is unchanged); `app/api/generate/route.ts` imports only `formatSeasonContext`/`replanSeasonArc`/`validateSeasonFit` (verified 2026-07-15, `route.ts:39`) and therefore needs zero edits. If this grep unexpectedly finds a new external caller, stop and report before touching the route.

- [ ] **Step 3: Live smoke run (MANDATORY — actually run it, do not skip)**

Per this repo's AGENTS.md rule, an LLM-backed path needs one live run before it's "done" — block generation triggers the season replan that persists these fixes' output, so the plan-executor must exercise it for real:

1. Start the dev server: use the `.claude/launch.json` config `nodevelo` (`npm run dev:preview`, serves on `http://127.0.0.1:3100`).
2. Open `http://127.0.0.1:3100/plan` in the browser.
3. Regenerate a block via the block generator on that page (this is a real Anthropic API call — expected and required).
4. On the season roadmap card (rendered by `components/SeasonRoadmap.tsx` inside `PlanView`), confirm all three of:
   - **Ramp, not plateau:** successive periods' target TSS/wk climb ~6% per period up to the ACWR cap — with this athlete's live seed still ≈806, that is ≈854 → 905 → 959 → 1017 → ~1048(capped), NOT the old ~484-488 plateau (exact numbers shift with the live 90-day baseline; the shape — monotonic ramp to a cap — is what must hold).
   - **No taper spike:** the sharpen/taper period is no longer the highest-load period of the season.
   - **Rotation escapes the trap:** the drafted build periods are no longer a strict anaerobic/threshold alternation — with the athlete's confident anaerobic limiter, a `VO2max` or `Durability` period appears within the drafted horizon (hand-trace of the LRU fallback says vo2max surfaces within the first redraft).
5. Read the generated block output itself once (not just the roadmap card) to confirm nothing downstream of `formatSeasonContext` regressed — the " · deload week" phrase should still appear for flagged periods and the generated block should still contain a reduced-volume recovery week.

(The athlete will delete and regenerate their current block after this ships — no compatibility shim or damping is wanted; see Global Constraints.)

- [ ] **Step 4: Push**

Run: `git push`

Expected: both Task 1 and Task 2 commits land on `main`. Nothing else staged or swept up.
