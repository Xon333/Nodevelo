# Season Macro-Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the rolling season engine a real macro layer — a limiter-aware event build path, bounded 8–12-week emphasis arcs, a genuine 2-week reduced-load "transition" break, an ~8-week FTP-retest nudge, and roadmap copy that explains peak/taper when an event drives the plan.

**Architecture:** Everything lands as pure, deterministic additions to `lib/season.ts` (no schema change, no data migration): arc boundaries are derived from period week-counts, not persisted — `SeasonPhase` already contains `"transition"` and `FocusPeriod` expresses everything needed. The event path (`backwardScheduleFromEvent`) gets the same selection quality as the rolling path via a new `pickBuildFocus` (least-recently-used across all four build systems, weighted toward a confident limiter), written as a drop-in seam for the sibling coverage-selector plan. The genuine season break is a 2-week `phase: "transition"` period (volume AND intensity down, ~50% load, exempt from deload flagging) inserted at an arc boundary only once ~20 loading weeks (≈ two 8–12-week arcs) have accrued since the last break — coaching practice schedules a real regeneration block every second or third mesocycle block, roughly twice a season, not at every boundary; the weekly 3:1 `deloadWeek` cadence already covers the smaller within-arc recoveries, so conflating the two would just double-count recovery.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest, Tailwind CSS.

## Global Constraints

- Use `localToday()` / `resolveToday()` for user-facing "what day is it" logic — never inline UTC date math for that specific question.
- This plan is written to land independently of (but should note conflicts with) two sibling plans also touching `lib/season.ts`: `2026-07-15-season-critical-fixes.md` and `2026-07-15-season-coverage-selector.md`. Check `git log` / re-read the live file before finalizing line numbers — this file may already have diverged from what's described below.
- The athlete has explicitly opted IN to building real event-driven scheduling now: they intend to add a real dated KOM-attempt event via the existing Season UI ("+ Add event" button) to exercise this path directly. Prioritize correctness of the event-driven (`backwardScheduleFromEvent`) path accordingly.
- As of writing (2026-07-15, `lib/season.ts` @ `a027ee4`), NEITHER sibling plan has landed: `grep -n "scoreFocus\|selectFocus\|nextBuildFocus" lib/season.ts` finds only `nextBuildFocus` (line 61). Task 1 Step 0 re-checks this at execution time.
- Run everything with `npm` (`npm test` = `vitest run`; full gate = `npm run check` = `tsc --noEmit && eslint && vitest run`).
- Commit on `main`, small and atomic; stage ONLY the files you touched (`git add <path>...`, never `git add -A`) — a concurrent agent session shares this checkout. End commit messages with the repo's `Co-Authored-By` trailer shown in each commit step.
- Do not pin test fixtures whose pre-rounding value sits on a `.x5` float boundary (repo memory: IEEE rounding flips them). All arithmetic expectations below were hand-traced away from boundaries.
- Tests are folded into each task (TDD) rather than deferred to one omnibus test task; the final integration task runs both suites (`lib/season.test.ts`, `components/SeasonRoadmap.test.tsx`) plus `npm run check` and the live manual verification.

---

### Task 1: `pickBuildFocus` — limiter-weighted LRU selection for the event-anchored path

The athlete is about to add a real KOM A-event, which routes every draft through `backwardScheduleFromEvent`. Its build loop (currently `lib/season.ts:166-175`) index-cycles `defaultBuildOrder()` = `[threshold, vo2max, durability]` — it can never schedule `anaerobic` and ignores the athlete's detected limiter entirely. Replace it with a recency-based selector over all four build systems.

**Files:**
- Modify: `lib/season.ts` (add `pickBuildFocus` after `nextBuildFocus`, ~line 74; rewrite the build loop inside `backwardScheduleFromEvent`, ~lines 166–175)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: `BUILD_FOCI` (module const, `lib/season.ts:53`), `SeasonDraftInput["limiter"]` (`{ system: SeasonFocus | null; confidence: "low" | "medium" | "high" }`), `SEASON_CONSTANTS.weeks`.
- Produces: `export function pickBuildFocus(limiter: SeasonDraftInput["limiter"], recentFocuses: SeasonFocus[]): SeasonFocus` — most-recent-last history in, one build focus out. No other task depends on it, but the sibling coverage-selector plan is expected to replace its body (see Step 0).

- [ ] **Step 0: Check whether the sibling coverage-selector already landed**

Run: `grep -n "scoreFocus\|selectFocus\|coverage" "/Users/otis/Cycling App/lib/season.ts"`

- Expected (as of plan-writing): no output — no scored selector exists yet. Proceed with the fallback below.
- If a scored selector function HAS landed (the `2026-07-15-season-coverage-selector.md` sibling), do NOT hand-roll a second one: implement `pickBuildFocus` in Step 3 as a one-line delegation to it (same signature contract — limiter + most-recent-last history in, `SeasonFocus` out), keep this task's tests unchanged (they specify behavior both implementations must satisfy: limiter preference, no back-to-back, anaerobic reachable), and skip any assertion that over-specifies LRU tie-break order if the scored selector legitimately differs — note the deviation in the commit message.

- [ ] **Step 1: Write the failing tests**

In `lib/season.test.ts`, add `pickBuildFocus` to the existing named-import list from `"./season"` (line 2, after `nextBuildFocus`). Then append after the `describe("draftSeasonArc — Mode-C", ...)` block:

```ts
describe("pickBuildFocus — LRU + limiter-weighted build selection", () => {
  it("prefers a confident limiter when it wasn't just used", () => {
    expect(pickBuildFocus({ system: "anaerobic", confidence: "high" }, ["threshold"])).toBe("anaerobic");
    expect(pickBuildFocus({ system: "durability", confidence: "medium" }, [])).toBe("durability");
  });
  it("never repeats the most recent focus — even the limiter", () => {
    expect(pickBuildFocus({ system: "anaerobic", confidence: "high" }, ["anaerobic"])).not.toBe("anaerobic");
  });
  it("falls back to the least-recently-used candidate across ALL four build systems", () => {
    // anaerobic has never appeared — the fixed [threshold, vo2max, durability] cycle could never pick it
    expect(pickBuildFocus({ system: null, confidence: "low" }, ["threshold", "vo2max", "durability"])).toBe("anaerobic");
    // durability is the most starved candidate here (oldest last appearance)
    expect(pickBuildFocus({ system: null, confidence: "low" }, ["durability", "anaerobic", "threshold", "vo2max"])).toBe("durability");
    // a low-confidence limiter gets no special weighting
    expect(pickBuildFocus({ system: "anaerobic", confidence: "low" }, ["anaerobic"])).toBe("threshold");
  });
  it("tie-breaks never-used candidates in BUILD_FOCI order", () => {
    expect(pickBuildFocus({ system: null, confidence: "low" }, [])).toBe("threshold");
  });
});

describe("backwardScheduleFromEvent — build rotation quality (the athlete's live KOM path)", () => {
  const ev = { name: "Alpe KOM", date: "2026-12-01", priority: "A" as const }; // 21-wk runway from 2026-07-01
  it("reaches anaerobic in a long runway (the fixed 3-focus cycle never did)", () => {
    const arc = backwardScheduleFromEvent(ev, baseInput(), "2026-07-01");
    expect(arc.filter((p) => p.phase === "build").map((p) => p.focus)).toContain("anaerobic");
  });
  it("schedules a confident limiter into the runway, landing nearest the peak", () => {
    const arc = backwardScheduleFromEvent(ev, baseInput({ limiter: { system: "anaerobic", confidence: "high" } }), "2026-07-01");
    const builds = arc.filter((p) => p.phase === "build");
    expect(builds[builds.length - 1].focus).toBe("anaerobic"); // last build before peak — the most race-specific slot
  });
  it("never repeats a focus back-to-back within the runway", () => {
    const arc = backwardScheduleFromEvent(ev, baseInput({ limiter: { system: "vo2max", confidence: "high" } }), "2026-07-01");
    const builds = arc.filter((p) => p.phase === "build");
    for (let i = 1; i < builds.length; i++) expect(builds[i].focus).not.toBe(builds[i - 1].focus);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: FAIL — the four `pickBuildFocus` tests fail with `TypeError: pickBuildFocus is not a function` (missing export → `undefined`), and "reaches anaerobic" + "landing nearest the peak" fail on the old fixed cycle (it produces `[..., durability, threshold, vo2max]`-style builds with no anaerobic and `threshold` in the nearest-peak slot). The back-to-back test may already pass (index-cycling never repeats adjacently). All pre-existing tests still pass.

- [ ] **Step 3: Implement `pickBuildFocus` and rewire the event loop**

In `lib/season.ts`, insert directly after `nextBuildFocus` (after line 73):

```ts
// Build-focus selection for the event-anchored path — and the drop-in seam for the scored coverage
// selector (sibling plan 2026-07-15-season-coverage-selector.md): when that lands, delegate this body
// to it; call sites and tests stay. Semantics: a confident (non-low) limiter wins any slot where it
// wasn't just used; otherwise the least-recently-used candidate across ALL four build systems
// (lastIndexOf: never-seen = -1 sorts oldest), tie-broken in BUILD_FOCI order. Never repeats the
// most recent focus back-to-back (KB variety).
export function pickBuildFocus(
  limiter: SeasonDraftInput["limiter"],
  recentFocuses: SeasonFocus[]
): SeasonFocus {
  const last = recentFocuses[recentFocuses.length - 1] ?? null;
  const wanted =
    limiter.system && limiter.confidence !== "low" && BUILD_FOCI.includes(limiter.system)
      ? limiter.system
      : null;
  if (wanted && wanted !== last) return wanted;
  const candidates = BUILD_FOCI.filter((f) => f !== last);
  let best = candidates[0];
  let bestIdx = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const idx = recentFocuses.lastIndexOf(c);
    if (idx < bestIdx) {
      bestIdx = idx;
      best = c;
    }
  }
  return best;
}
```

Then in `backwardScheduleFromEvent`, replace the build-fill loop (currently lines 166–175):

```ts
    let filled = peakWeeks + SEASON_CONSTANTS.taperWeeks;
    const order = [...defaultBuildOrder()];
    let i = 0;
    while (filled < runway) {
      const focus = order[i % order.length];
      const w = Math.min(SEASON_CONSTANTS.weeks[focus], runway - filled);
      if (w <= 0) break;
      tail.unshift(mk(focus, "build", w, `Build ${focus} toward ${event.name}.`));
      filled += w; i += 1;
    }
```

with:

```ts
    let filled = peakWeeks + SEASON_CONSTANTS.taperWeeks;
    // Backward fill, nearest-to-peak first: each pick sees the running `chosen` history, so a
    // confident limiter lands in the most race-specific slot (right before the peak) and the
    // in-between slots rotate least-recently-used across ALL four build systems. The old fixed
    // [threshold, vo2max, durability] index cycle could never schedule anaerobic and ignored the
    // limiter entirely. (Adjacency is symmetric, so no-back-to-back survives the reversal;
    // input.recentFocuses is deliberately NOT seeded here — chronologically it borders the START
    // of the runway, i.e. the LAST period this loop generates, not the first.)
    const chosen: SeasonFocus[] = [];
    while (filled < runway) {
      const focus = pickBuildFocus(input.limiter, chosen);
      const w = Math.min(SEASON_CONSTANTS.weeks[focus], runway - filled);
      if (w <= 0) break;
      tail.unshift(mk(focus, "build", w, `Build ${focus} toward ${event.name}.`));
      chosen.push(focus);
      filled += w;
    }
```

(`defaultBuildOrder` stays — `nextBuildFocus` and an existing test still use it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: PASS — all tests green, including the four pre-existing `event-anchored mode` tests (the 13-week Gran Fondo fixtures produce the same phase shapes under the new selector; they assert phases, not focus order).

- [ ] **Step 5: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts
git commit -m "fix(season): event-path build rotation — LRU across all four systems, limiter lands nearest the peak

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Bounded emphasis arcs — `arcWeeks` constant, `weeksSinceBase`, arc-capped base touch

`draftSeasonArc` currently rolls build periods indefinitely; only `needsBaseGate`'s 4-PERIOD lookback ever re-inserts base, and it goes quiet the moment any base sits in the window — an unbounded monotone build is exactly the Foster (1998) load×monotony illness pattern. Add a WEEK-denominated cap: consecutive loading weeks since the last aerobic-base touch may never exceed `arcWeeks.max` (12); when the next build would cross it (and at least `arcWeeks.min` = 8 loading weeks have accrued, so an arc is never cut absurdly short — with 3–4-week periods the min can't actually be violated, it documents the arc's intended size), insert an aerobic-base touch instead. The base touch resets the adjacency/recency window, so the exact pre-boundary rotation cannot repeat unchanged across the boundary. Arcs stay a pure derived concept — no `SeasonPlan.arcs` field, no migration (`lib/types.ts` confirmed: `FocusPeriod.plannedWeeks` + order fully determine arc boundaries).

**Files:**
- Modify: `lib/season.ts` (`SEASON_CONSTANTS`, ~line 8–17; new `weeksSinceBase` helper after `needsBaseGate`, ~line 58; `draftSeasonArc` loop, ~lines 94–116)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: `SEASON_CONSTANTS.weeks`, `needsBaseGate`, `nextBuildFocus`, `period()` (module-private helper), `addWeeks`.
- Produces: `SEASON_CONSTANTS.arcWeeks: { min: 8, max: 12 }` (readonly, `as const`); `export function weeksSinceBase(recentFocuses: SeasonFocus[]): number`. Task 4 rewrites this same insertion point into a `pushReset()` that can also emit a transition.

- [ ] **Step 1: Write the failing tests**

Add `weeksSinceBase` to the import list from `"./season"` in `lib/season.test.ts` (line 2). Append:

```ts
describe("bounded emphasis arcs (8–12 wk)", () => {
  it("encodes the arc bounds", () => {
    expect(SEASON_CONSTANTS.arcWeeks).toEqual({ min: 8, max: 12 });
  });
  it("estimates loading weeks since the last aerobic-base touch", () => {
    expect(weeksSinceBase([])).toBe(0);
    expect(weeksSinceBase(["aerobic-base"])).toBe(0);
    expect(weeksSinceBase(["aerobic-base", "threshold", "vo2max"])).toBe(8); // 4 + 4 KB default weeks
    expect(weeksSinceBase(["threshold", "durability"])).toBe(7); // no base anywhere → the whole history counts
  });
  it("inserts an aerobic-base touch before consecutive loading weeks exceed arcWeeks.max", () => {
    const arc = draftSeasonArc(baseInput(), "2026-07-01"); // seed: base already in the window → gate silent, 4 loading wk behind
    expect(needsBaseGate(baseInput().recentFocuses)).toBe(false); // proves the gate did NOT produce the base below
    expect(arc.some((p) => p.focus === "aerobic-base")).toBe(true); // the arc cap did
    // Invariant (selector-agnostic — survives the sibling plans' rotation fixes): no stretch of
    // consecutive loading periods exceeds the arc cap, counting the 4 weeks already on the athlete's
    // legs from the seeded threshold period. sharpen resets too — it is itself a lighter week.
    let run = 4;
    for (const p of arc) {
      if (p.focus === "aerobic-base" || p.focus === "sharpen") { run = 0; continue; }
      run += p.plannedWeeks;
      expect(run).toBeLessThanOrEqual(SEASON_CONSTANTS.arcWeeks.max);
    }
  });
  it("forces the reset at the cap even when the 4-period lookback still contains a base", () => {
    // 11 loading weeks since the base (4+4+3) — yet base is still inside needsBaseGate's window.
    expect(needsBaseGate(["aerobic-base", "threshold", "vo2max", "durability"])).toBe(false);
    const arc = draftSeasonArc(baseInput({ recentFocuses: ["aerobic-base", "threshold", "vo2max", "durability"] }), "2026-07-01");
    expect(arc[0].focus).toBe("aerobic-base"); // cap fires immediately: 11 + any build (3–4 wk) > 12
    expect(arc[0].rationale).toContain("Arc boundary");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: FAIL — `arcWeeks` test fails with `expected undefined to deeply equal { min: 8, max: 12 }`; `weeksSinceBase` tests fail with `TypeError: weeksSinceBase is not a function`; both draft tests fail (current draft never inserts a mid-arc base: default seed yields builds `vo2max, threshold, vo2max, threshold` — the run invariant breaks at 16, and `arc[0].focus` is a build, not base).

- [ ] **Step 3: Implement**

In `SEASON_CONSTANTS` (`lib/season.ts:8-17`), add one line after `horizonPeriods: 5,`:

```ts
  arcWeeks: { min: 8, max: 12 }, // bounded emphasis arc: consecutive loading weeks between aerobic-base touches
```

After `needsBaseGate` (line 58), add:

```ts
// Estimated consecutive loading weeks since the last aerobic-base touch in a focus history
// (most recent last). The history carries no per-period week counts, so KB default weeks per
// focus are the estimate — good enough to bound an arc; overrides that stretched a period only
// shift the boundary by a week or two.
export function weeksSinceBase(recentFocuses: SeasonFocus[]): number {
  const idx = recentFocuses.lastIndexOf("aerobic-base");
  const tail = idx === -1 ? recentFocuses : recentFocuses.slice(idx + 1);
  return tail.reduce((sum, f) => sum + SEASON_CONSTANTS.weeks[f], 0);
}
```

In `draftSeasonArc`, replace the body between the event-routing lines and the `sharpen` push (currently lines 94–116) with:

```ts
  const periods: FocusPeriod[] = [];
  const recent = [...input.recentFocuses];
  let cursor = today;
  const conf = input.limiter.confidence;

  if (needsBaseGate(recent)) {
    periods.push(period("aerobic-base", "base", cursor, conf, "Aerobic base — the ceiling for every later phase (KB)."));
    recent.push("aerobic-base");
    cursor = addWeeks(cursor, periods[periods.length - 1].plannedWeeks);
  }

  // Arc cap (Foster 1998: illness risk tracks load × monotony): consecutive loading weeks since the
  // last base touch may never exceed arcWeeks.max — the touch also resets the rotation's recency
  // window, so the same two-focus pattern can't repeat unchanged across an arc boundary.
  let sinceBase = weeksSinceBase(recent);

  while (periods.length < SEASON_CONSTANTS.horizonPeriods - 1) {
    const focus = nextBuildFocus(input.limiter, recent);
    const focusWeeks = SEASON_CONSTANTS.weeks[focus];
    if (sinceBase >= SEASON_CONSTANTS.arcWeeks.min && sinceBase + focusWeeks > SEASON_CONSTANTS.arcWeeks.max) {
      periods.push(period("aerobic-base", "base", cursor, conf, "Arc boundary — re-touch aerobic base so the build doesn't run monotone (Foster 1998: illness tracks load × monotony)."));
      recent.push("aerobic-base");
      sinceBase = 0;
      cursor = addWeeks(cursor, periods[periods.length - 1].plannedWeeks);
      continue;
    }
    const why =
      input.limiter.system === focus && conf !== "low"
        ? `Build ${focus} — your most depressed system relative to your engine.`
        : `Build ${focus} — rotating the quality focus (KB: avoid repeating one stimulus).`;
    periods.push(period(focus, "build", cursor, conf, why));
    recent.push(focus);
    sinceBase += focusWeeks;
    cursor = addWeeks(cursor, periods[periods.length - 1].plannedWeeks);
  }
```

(The trailing `periods.push(period("sharpen", ...))` / deload / load-target lines stay exactly as they are.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: PASS — all new arc tests green; the pre-existing `drafts base(if gated) → rotating build periods → a realize week` test still passes (an empty-history draft accrues only 11 loading weeks inside one horizon — under the cap, so its shape is unchanged).

- [ ] **Step 5: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): bounded 8-12wk emphasis arcs — week-capped base touches break rolling monotony

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Season-break clock — constants + `weeksSinceSeasonBreak`

Pure groundwork for the genuine reduced-load period: a helper that measures calendar weeks since the athlete's last `phase: "transition"` period ended (falling back to the season's first period start when there has never been one), and the cadence constants. Cadence choice: **a 2-week transition after 20 loading weeks** — two full arcs at the 8–12-week band's midpoint (~10 wk) of continuous loading, matching the coaching-practice pattern of a real regeneration block every second/third mesocycle block rather than every boundary (per-period `deloadWeek` weeks already handle those — a sibling plan tunes that cadence; do not touch `deloadWeek` semantics here).

**Files:**
- Modify: `lib/season.ts` (`SEASON_CONSTANTS`; new helper next to `periodForDate`, ~line 252)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: `addWeeks`, module-private `weeksBetween` (line 141 — same module, accessible), `FocusPeriod`.
- Produces: `SEASON_CONSTANTS.transitionEveryLoadingWeeks: 20`, `SEASON_CONSTANTS.transitionWeeks: 2`; `export function weeksSinceSeasonBreak(periods: FocusPeriod[], asOf: string): number | null` (null = no started periods, i.e. a brand-new season can't be "overdue"). Task 4 consumes both.

- [ ] **Step 1: Write the failing tests**

Add `weeksSinceSeasonBreak` to the import list from `"./season"` (line 2). Append:

```ts
describe("season-break clock", () => {
  it("encodes the break cadence: ~2 arcs of loading, then a 2-week transition", () => {
    expect(SEASON_CONSTANTS.transitionEveryLoadingWeeks).toBe(20);
    expect(SEASON_CONSTANTS.transitionWeeks).toBe(2);
  });
  it("measures from the last transition's end, else the season start; null before anything started", () => {
    const build = (startDate: string): FocusPeriod => ({
      focus: "threshold", phase: "build", startDate, plannedWeeks: 4, intensitySplit: "80/20",
      targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
    });
    expect(weeksSinceSeasonBreak([], "2026-07-01")).toBeNull();
    expect(weeksSinceSeasonBreak([build("2099-01-01")], "2026-07-01")).toBeNull(); // nothing started yet
    expect(weeksSinceSeasonBreak([build("2026-01-12")], "2026-07-01")).toBe(24); // no break ever → since season start
    const transition: FocusPeriod = { ...build("2026-04-06"), phase: "transition", plannedWeeks: 2 }; // ends 2026-04-20
    expect(weeksSinceSeasonBreak([build("2026-01-12"), transition], "2026-07-01")).toBe(10); // from its END
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: FAIL — constants `expected undefined to be 20` / `to be 2`; helper tests `TypeError: weeksSinceSeasonBreak is not a function`.

- [ ] **Step 3: Implement**

In `SEASON_CONSTANTS`, after the `arcWeeks` line added in Task 2:

```ts
  transitionEveryLoadingWeeks: 20, // a genuine season break after ~2 full arcs of continuous loading
  transitionWeeks: 2, // the break itself: a light fortnight — volume AND intensity down
```

Next to `periodForDate` (after line 254), add:

```ts
// Calendar weeks since the athlete's last genuine reduced-load break (phase "transition") ended,
// measured over periods that have started by `asOf`. No transition ever → measured from the first
// started period (season length so far). Null when nothing has started — a brand-new season cannot
// be "overdue for a break".
export function weeksSinceSeasonBreak(periods: FocusPeriod[], asOf: string): number | null {
  const started = periods.filter((p) => p.startDate <= asOf);
  if (started.length === 0) return null;
  const transitions = started.filter((p) => p.phase === "transition");
  const anchor = transitions.length > 0
    ? transitions.map((p) => addWeeks(p.startDate, p.plannedWeeks)).sort().reverse()[0]
    : started.map((p) => p.startDate).sort()[0];
  return weeksBetween(anchor, asOf); // clamps at 0 for an in-progress transition
}
```

Note: `weeksBetween` is defined at line 141, BELOW `SEASON_CONSTANTS` but above line 252 — function placement after `periodForDate` is fine.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): season-break clock — weeksSinceSeasonBreak + 20wk/2wk transition cadence constants

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Draft the genuine reduced-load transition period + replan wiring

When a reset point is reached (the base gate at draft start, or Task 2's arc cap) AND the break clock says ≥ 20 loading weeks have passed since the last transition, draft a 2-week `phase: "transition"` period instead of the 3-week base touch. `SeasonDraftInput` gains an optional `weeksSinceSeasonBreak` field (optional ⇒ every existing caller and test fixture compiles unchanged; absent/null = unknown = never draft a break — conservative). `replanSeasonArc` feeds the clock from the plan's own kept periods.

**Files:**
- Modify: `lib/season.ts` (`SeasonDraftInput`, ~line 42–51; `draftSeasonArc` body from Task 2; `replanSeasonArc`'s `derived` line, ~line 228)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: Task 3's `weeksSinceSeasonBreak(periods, asOf)` + constants; Task 2's `sinceBase` loop structure.
- Produces: `SeasonDraftInput.weeksSinceSeasonBreak?: number | null`; drafted transition periods with the exact shape `{ focus: "aerobic-base", phase: "transition", plannedWeeks: SEASON_CONSTANTS.transitionWeeks, intensitySplit: "95/5", deloadWeek: false, source: "derived" }` — Task 5 keys load/deload/fit handling off `phase === "transition"`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/season.test.ts`:

```ts
describe("genuine season break (phase transition) in the draft", () => {
  it("leads with a transition instead of a base touch when the break clock is overdue", () => {
    const arc = draftSeasonArc(baseInput({ recentFocuses: [], weeksSinceSeasonBreak: 24 }), "2026-07-01");
    expect(arc[0].phase).toBe("transition");
    expect(arc[0].focus).toBe("aerobic-base");
    expect(arc[0].plannedWeeks).toBe(SEASON_CONSTANTS.transitionWeeks);
    expect(arc[0].deloadWeek).toBe(false);
  });
  it("replaces the arc-boundary base touch with a transition when the clock runs out mid-draft — once", () => {
    const arc = draftSeasonArc(baseInput({ weeksSinceSeasonBreak: 24 }), "2026-07-01"); // default seed: no gate, 4 wk behind
    const idx = arc.findIndex((p) => p.phase === "transition");
    expect(idx).toBeGreaterThan(0); // mid-draft, at the arc cap — not the lead period
    expect(arc.filter((p) => p.phase === "transition").length).toBe(1); // the clock resets after the break
  });
  it("drafts a plain base touch when the clock is young or unknown", () => {
    const young = draftSeasonArc(baseInput({ weeksSinceSeasonBreak: 10 }), "2026-07-01");
    expect(young.every((p) => p.phase !== "transition")).toBe(true);
    expect(young.some((p) => p.focus === "aerobic-base")).toBe(true); // the arc cap still resets — just with base
    const unknown = draftSeasonArc(baseInput({ recentFocuses: [] }), "2026-07-01");
    expect(unknown.every((p) => p.phase !== "transition")).toBe(true);
  });
  it("replanSeasonArc feeds the break clock from the plan's own periods", () => {
    // Six frozen 4-week build periods = 24 calendar weeks of loading, no transition ever.
    const frozen: FocusPeriod[] = ["2026-01-12", "2026-02-09", "2026-03-09", "2026-04-06", "2026-05-04", "2026-06-01"].map((startDate, i) => ({
      focus: i % 2 === 0 ? "threshold" : "vo2max", phase: "build", startDate, plannedWeeks: 4,
      intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
    }));
    const out = replanSeasonArc(planWith(frozen), baseInput(), () => 400, "2026-07-01");
    const t = out.periods.find((p) => p.phase === "transition");
    expect(t).toBeDefined();
    expect(t!.startDate).toBe("2026-07-01"); // the redraft leads with the overdue break
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: FAIL — first compile-check: `weeksSinceSeasonBreak` is not yet a property of `SeasonDraftInput`, so `tsc`/vitest reports `Object literal may only specify known properties` on the `baseInput({ ... weeksSinceSeasonBreak: 24 })` calls (vitest surfaces it as a transform/type error) — or, if the transform is lax, the tests run and fail because no drafted period ever has `phase === "transition"`. Either failure mode is the expected red.

- [ ] **Step 3: Implement**

In `SeasonDraftInput` (line 42–51), add after `heavyFatigue: boolean;`:

```ts
  // Calendar weeks since the last genuine reduced-load break (phase "transition") ended — from
  // weeksSinceSeasonBreak(). Absent/null = unknown → never draft a break (conservative).
  weeksSinceSeasonBreak?: number | null;
```

In `draftSeasonArc`, replace the body produced by Task 2 (everything between the event-routing `if (aEvent) ...` line and the trailing `periods.push(period("sharpen", ...))`) with:

```ts
  const periods: FocusPeriod[] = [];
  const recent = [...input.recentFocuses];
  let cursor = today;
  const conf = input.limiter.confidence;
  let sinceBreak = input.weeksSinceSeasonBreak ?? null;

  // A "reset" is either a plain 3-wk aerobic-base touch (arc boundary / base gate) or — once
  // ~two arcs of continuous loading have accrued since the last one — a genuine 2-wk
  // phase-"transition" break: volume AND intensity down, a real seasonal breather the weekly
  // 3:1 deloadWeek cadence never provides. Either way it counts as the arc's base touch.
  const pushReset = () => {
    if (sinceBreak !== null && sinceBreak >= SEASON_CONSTANTS.transitionEveryLoadingWeeks) {
      periods.push({
        focus: "aerobic-base", phase: "transition", startDate: cursor,
        plannedWeeks: SEASON_CONSTANTS.transitionWeeks, intensitySplit: "95/5",
        targetWeeklyTss: null, deloadWeek: false,
        rationale: "Season break — ~two arcs of continuous loading absorbed; a genuinely light fortnight (volume AND intensity down) before the next arc.",
        source: "derived", confidence: conf,
      });
      sinceBreak = 0;
    } else {
      periods.push(period("aerobic-base", "base", cursor, conf,
        periods.length === 0 && needsBaseGate(input.recentFocuses)
          ? "Aerobic base — the ceiling for every later phase (KB)."
          : "Arc boundary — re-touch aerobic base so the build doesn't run monotone (Foster 1998: illness tracks load × monotony)."));
      if (sinceBreak !== null) sinceBreak += periods[periods.length - 1].plannedWeeks;
    }
    recent.push("aerobic-base");
    cursor = addWeeks(cursor, periods[periods.length - 1].plannedWeeks);
  };

  if (needsBaseGate(recent)) pushReset();

  let sinceBase = weeksSinceBase(recent);

  while (periods.length < SEASON_CONSTANTS.horizonPeriods - 1) {
    const focus = nextBuildFocus(input.limiter, recent);
    const focusWeeks = SEASON_CONSTANTS.weeks[focus];
    if (sinceBase >= SEASON_CONSTANTS.arcWeeks.min && sinceBase + focusWeeks > SEASON_CONSTANTS.arcWeeks.max) {
      pushReset();
      sinceBase = 0;
      continue;
    }
    const why =
      input.limiter.system === focus && conf !== "low"
        ? `Build ${focus} — your most depressed system relative to your engine.`
        : `Build ${focus} — rotating the quality focus (KB: avoid repeating one stimulus).`;
    periods.push(period(focus, "build", cursor, conf, why));
    recent.push(focus);
    sinceBase += focusWeeks;
    if (sinceBreak !== null) sinceBreak += focusWeeks;
    cursor = addWeeks(cursor, periods[periods.length - 1].plannedWeeks);
  }
```

In `replanSeasonArc`, replace the `derived` line (currently line 228):

```ts
  const derived = draftSeasonArc({ ...input, recentFocuses }, draftStart);
```

with:

```ts
  // Break clock from the KEPT periods only ([frozen, current, overrides]) — the old derived tail
  // being replaced must not count: a discarded drafted transition never actually happened.
  const derived = draftSeasonArc(
    { ...input, recentFocuses, weeksSinceSeasonBreak: weeksSinceSeasonBreak([...frozen, ...current, ...overrides], draftStart) },
    draftStart
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: PASS — including every pre-existing `replanSeasonArc` test (their fixtures never accrue 20 started calendar weeks, so no transition appears and frozen/current/override behavior is untouched; the idempotency fixed-point still holds because `weeksSinceSeasonBreak` is a deterministic function of the kept periods and the same `draftStart`).

- [ ] **Step 5: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): genuine 2wk reduced-load transition period every ~20 loading weeks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Transition-aware load targets, deload cadence, and season-fit validation

Three consumers must treat `phase: "transition"` as what it is — recovery: `assignLoadTargets` gives it ~50% of the running load (deeper than a deload's 60%) without advancing the ramp base; `applyDeloadCadence` never flags it AND resets its counter across it (a deload flag on a break period would double-count recovery); `validateSeasonFit` warns when a generated block puts hard riding inside one.

**Files:**
- Modify: `lib/season.ts` (`assignLoadTargets`, ~lines 126–138; `applyDeloadCadence`, ~lines 236–248; `validateSeasonFit`, ~lines 353–364)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: Task 4's transition shape (`phase === "transition"` is the discriminator).
- Produces: no new exports — behavior changes inside three existing functions, signatures unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `lib/season.test.ts`:

```ts
describe("transition-period load & cadence handling", () => {
  const p = (over: Partial<FocusPeriod> = {}): FocusPeriod => ({
    focus: "threshold", phase: "build", startDate: "2026-07-01", plannedWeeks: 3,
    intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium", ...over,
  });
  it("assigns a transition ~50% of the running load and does not advance the ramp base", () => {
    const out = assignLoadTargets([p(), p({ phase: "transition", plannedWeeks: 2 }), p()], 400, 1.3);
    expect(out[0].targetWeeklyTss).toBe(424); // 400 * 1.06
    expect(out[1].targetWeeklyTss).toBe(212); // 424 * 0.5 — a genuine cut, deeper than a deload's 0.6
    expect(out[2].targetWeeklyTss).toBe(449); // resumes from 424, not 212: 424 * 1.06, rounded
  });
  it("never flags a transition as a deload week and resets the deload counter across it", () => {
    const out = applyDeloadCadence([p({ plannedWeeks: 2 }), p({ phase: "transition", plannedWeeks: 2 }), p({ plannedWeeks: 2 })], false);
    expect(out[1].deloadWeek).toBe(false); // 2+2 wk crosses the 3:1 boundary, but a transition IS recovery already
    expect(out[2].deloadWeek).toBe(false); // counter restarted after the break — only 2 loading wk in
  });
  it("warns when hard riding lands inside a transition period", () => {
    const day = (date: string, type: PlannedDay["type"], durationMin: number): PlannedDay =>
      ({ date, weekNumber: 1, weekTheme: "", name: type, type, durationMin, workoutText: "", description: "" });
    const plan = planWith([p({ phase: "transition", startDate: "2026-07-12", plannedWeeks: 2, intensitySplit: "95/5" })]);
    const w = validateSeasonFit([day("2026-07-13", "VO2max", 60), day("2026-07-14", "Z2", 60)], plan, 280);
    expect(w.length).toBe(1);
    expect(w[0]).toContain("transition");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: FAIL — load test: `expected 449 to be 212` on `out[1]` (transition currently ramps like a loading period); cadence test: `expected true to be false` on `out[1].deloadWeek`; fit test: `expected 0 to be 1` (only `phase === "base"` warns today).

- [ ] **Step 3: Implement**

`assignLoadTargets` — replace the `return periods.map(...)` body (lines 133–137):

```ts
  return periods.map((p) => {
    const isBreak = p.phase === "transition"; // a genuine season break: ~50% load, deeper than a deload
    const target = isBreak
      ? Math.round(prev * 0.5)
      : p.deloadWeek
        ? Math.round(prev * 0.6)
        : Math.min(Math.round(prev * ramp), Math.round(ceiling));
    if (!isBreak && !p.deloadWeek) prev = target;
    return { ...p, targetWeeklyTss: target };
  });
```

`applyDeloadCadence` — replace the `return periods.map(...)` body (lines 240–247):

```ts
  return periods.map((p) => {
    // A transition IS recovery: never also flag it as a deload, and restart the cadence after it.
    if (p.phase === "transition") {
      weeksSinceDeload = 0;
      return { ...p, deloadWeek: false };
    }
    weeksSinceDeload += p.plannedWeeks;
    if (weeksSinceDeload >= threshold) {
      weeksSinceDeload = 0;
      return { ...p, deloadWeek: true };
    }
    return { ...p, deloadWeek: false };
  });
```

`validateSeasonFit` — replace the warning condition block (lines 358–363):

```ts
    if ((p.phase === "base" || p.phase === "transition") && hardShare > 0.2) {
      const label = p.phase === "transition" ? "transition (season-break)" : "base/aerobic";
      const dates = rides.map((d) => d.date).sort();
      warnings.push(
        `Season fit: ${dates[0]} → ${dates[dates.length - 1]} sits in a ${label} period (${p.intensitySplit}), but ${Math.round(hardShare * 100)}% of riding time is hard — expected mostly Z2.`
      );
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: PASS — the pre-existing `load envelope`, `deload cadence`, and `validateSeasonFit` suites all still pass (base-period warnings keep the exact `base/aerobic period (90/10)` wording their regex pins).

- [ ] **Step 5: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): transition periods get 50% load, deload exemption, and fit-check coverage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: FTP retest cadence — `formatRetestNote` pure function

A stale tested FTP quietly rots zones and every TSS-derived number. Concrete threshold: **due at 8 weeks (56 days)** — the intersection of the two coaching-practice consensus ranges (retest every 6–8 wk aggressive, 8–12 wk conservative), and exactly one `arcWeeks` arc, so "retest each arc" and "retest every 8 weeks" are the same statement. Input is the same figure `app/api/profile/route.ts:64` already computes (`ftpStaleDays`, days since `physiology.json`'s `current.effectiveFrom`); the function is pure over the number. The note points at the next lighter slot (sharpen / deload / transition period) where fresh legs make a valid test. A nudge, never a hard gate.

**Files:**
- Modify: `lib/season.ts` (new constant in `SEASON_CONSTANTS`; new function after `formatSeasonContext`, ~line 331)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: `SEASON_CONSTANTS`, module-private `periodEnd` (line 189), `SeasonPlan`.
- Produces: `SEASON_CONSTANTS.retestEveryWeeks: 8`; `export function formatRetestNote(ftpStaleDays: number | null, plan: SeasonPlan, today: string): string | null` — Task 7 wires it into the generate route.

- [ ] **Step 1: Write the failing tests**

Add `formatRetestNote` to the import list from `"./season"` (line 2). Append:

```ts
describe("formatRetestNote — FTP retest cadence", () => {
  const sharpen: FocusPeriod = {
    focus: "sharpen", phase: "build", startDate: "2026-08-10", plannedWeeks: 1, intensitySplit: "75/25",
    targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
  };
  it("encodes the ~8-week cadence (intersection of the 6–8 and 8–12 wk coaching ranges — one arc)", () => {
    expect(SEASON_CONSTANTS.retestEveryWeeks).toBe(8);
  });
  it("stays silent when the tested FTP is fresh or staleness is unknown", () => {
    expect(formatRetestNote(30, planWith([sharpen]), "2026-07-15")).toBeNull();
    expect(formatRetestNote(55, planWith([sharpen]), "2026-07-15")).toBeNull(); // one day under the line
    expect(formatRetestNote(null, planWith([sharpen]), "2026-07-15")).toBeNull();
  });
  it("fires at 8 weeks and points at the next lighter slot (sharpen / deload / transition)", () => {
    const note = formatRetestNote(56, planWith([sharpen]), "2026-07-15")!;
    expect(note).toContain("RETEST DUE");
    expect(note).toContain("56 days");
    expect(note).toContain("2026-08-10");
  });
  it("still nudges when there is no lighter slot to point at", () => {
    const note = formatRetestNote(70, planWith([]), "2026-07-15")!;
    expect(note).toContain("RETEST DUE");
    expect(note).not.toContain("Best slot");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: FAIL — `expected undefined to be 8` and `TypeError: formatRetestNote is not a function`.

- [ ] **Step 3: Implement**

In `SEASON_CONSTANTS`, after `transitionWeeks: 2,`:

```ts
  retestEveryWeeks: 8, // FTP/power-curve retest cadence: 6–8 wk (aggressive) ∩ 8–12 wk (conservative) = one arc
```

After `formatSeasonContext` (line 331), add:

```ts
// A short prompt-injectable nudge when the athlete's tested FTP has gone stale (ftpStaleDays is the
// figure /api/profile already computes off physiology.json's effectiveFrom). Due every
// retestEveryWeeks — one arc — and pointed at the next lighter slot (sharpen / deload / transition)
// where fresh legs make the test valid. Null when fresh or unknown. A nudge, never a hard gate.
export function formatRetestNote(ftpStaleDays: number | null, plan: SeasonPlan, today: string): string | null {
  if (ftpStaleDays === null || ftpStaleDays < SEASON_CONSTANTS.retestEveryWeeks * 7) return null;
  const slot = plan.periods
    .filter((p) => periodEnd(p) > today && (p.focus === "sharpen" || p.deloadWeek || p.phase === "transition"))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
  const where = slot
    ? ` Best slot: the lighter ${slot.phase === "transition" ? "transition" : slot.focus === "sharpen" ? "sharpen" : "deload"} period starting ${slot.startDate}.`
    : "";
  return `RETEST DUE: FTP last validated ${ftpStaleDays} days ago (cadence ~${SEASON_CONSTANTS.retestEveryWeeks} wk). Schedule an FTP/power-curve retest to re-anchor zones and load targets.${where}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): formatRetestNote — 8-week FTP retest nudge aimed at the next lighter slot

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Surface the retest note in the block-generation prompt

Wire `formatRetestNote` into `app/api/generate/route.ts`, appended to the existing `seasonContext` string (same surfacing pattern as `formatSeasonContext`). The route already has everything needed in scope: `physStore` (destructured ~line 100, used ~line 263), `replannedSeason` (~line 235), `today` via `resolveToday` (~line 96 — satisfies the local-today constraint), and the season import line (~line 39). Staleness math here is pure day-difference (lookback window), anchored on the already-resolved `today` — not an inline "what day is it now" UTC call.

**Files:**
- Modify: `app/api/generate/route.ts` (import line ~39; insert after the season try/catch, ~line 256)

**Interfaces:**
- Consumes: Task 6's `formatRetestNote(ftpStaleDays, plan, today)`; route locals `physStore`, `replannedSeason`, `today`, `seasonContext`.
- Produces: nothing new — `seasonContext` (already concatenated into the dynamic prompt half at ~line 280) may now carry a trailing `RETEST DUE: ...` line.

- [ ] **Step 1: Extend the import**

In `app/api/generate/route.ts` line 39, change:

```ts
import { formatSeasonContext, replanSeasonArc, validateSeasonFit } from "@/lib/season";
```

to:

```ts
import { formatRetestNote, formatSeasonContext, replanSeasonArc, validateSeasonFit } from "@/lib/season";
```

- [ ] **Step 2: Append the note after the season try/catch**

Directly after the closing `}` of the `catch (err) { ... logWarn("/api/generate", "season-replan", ...) }` block (~line 256), insert:

```ts
    // Retest cadence (macro-structure): a stale tested FTP quietly rots zones and TSS math — nudge
    // the generator to place a retest in the next lighter week. Additive to seasonContext; if the
    // replan above failed there is no season line to extend, and the nudge is skipped with it.
    if (physStore && replannedSeason) {
      const ftpStaleDays = Math.floor((Date.parse(today) - Date.parse(physStore.current.effectiveFrom)) / 86_400_000);
      const retestNote = formatRetestNote(Number.isFinite(ftpStaleDays) ? ftpStaleDays : null, replannedSeason, today);
      if (retestNote) seasonContext += `\n${retestNote}`;
    }
```

Note: `seasonContext` is declared with `let` (line 234) — the `+=` is valid. No unit test lands here (the route has no test harness; the pure function is fully covered by Task 6) — this wiring is verified by the typecheck now and the live smoke run in Task 9.

- [ ] **Step 3: Typecheck + lint + full unit suite**

Run: `cd "/Users/otis/Cycling App" && npm run check`

Expected: PASS (tsc clean, eslint clean, all vitest suites green). Per the repo's concurrent-agent rule: if `check` fails in a file this plan never touched, run `git status --short <file>` first — an uncommitted file is the other session mid-edit; wait ~30s, retry once, and report rather than patching it.

- [ ] **Step 4: Commit**

```bash
cd "/Users/otis/Cycling App"
git add app/api/generate/route.ts
git commit -m "feat(generate): surface the FTP retest nudge alongside the season context line

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Event-aware roadmap copy — explain peak/taper when an event drives the plan

`backwardScheduleFromEvent` emits `phase: "peak"` / `phase: "taper"` periods. `components/SeasonRoadmap.tsx` renders phase text raw (line 71: `{p.phase}` in the card's tiny uppercase label — legible) and colors/labels by FOCUS (`FOCUS_COLOR` line 10, `FOCUS_LABEL` in `lib/season.ts:368` — both keyed by `SeasonFocus`; peak/taper periods carry focus `"sharpen"`, so cards read "PEAK / Sharpen" and "TAPER / Sharpen" — they render, but nothing tells the athlete the whole roadmap is now a countdown). Extend the existing explanatory line (the `hasDerived` paragraph, lines 87–91) with an event-aware variant, mirroring the established copy pattern. Explicitly out of scope: any "please add an event" nudge — the athlete is adding one manually.

**Files:**
- Modify: `components/SeasonRoadmap.tsx` (~lines 54–59 and 87–91)
- Test: `components/SeasonRoadmap.test.tsx`

**Interfaces:**
- Consumes: `plan.events` (`SeasonEvent[]`), `localToday()` (already imported — the user-facing "what day is it" per Global Constraints), the existing `hasDerived` flag.
- Produces: UI copy only — no new exports.

- [ ] **Step 1: Write the failing test**

In `components/SeasonRoadmap.test.tsx`: add a type import after the existing imports (line 2):

```tsx
import type { SeasonPlan } from "@/lib/types";
```

Change the hoisted state's plan to be typed (so a test can reassign it) — the closing of the `vi.hoisted` literal (line 22–23) changes from:

```tsx
    updatedAt: "2026-07-13T00:00:00.000Z",
  },
}));
```

to:

```tsx
    updatedAt: "2026-07-13T00:00:00.000Z",
  } as SeasonPlan,
}));
```

Then append after the existing test:

```tsx
test("explains the countdown when a future A-priority event drives the roadmap", () => {
  state.calls = 0;
  // Far-future dates so the test never rots as the real clock advances (the component uses localToday()).
  state.plan = {
    objective: "KOM hunting",
    events: [{ name: "Alpe KOM", date: "2099-09-01", priority: "A" }],
    periods: [
      { focus: "threshold", phase: "build", startDate: "2099-07-01", plannedWeeks: 4, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium" },
      { focus: "sharpen", phase: "peak", startDate: "2099-07-29", plannedWeeks: 4, intensitySplit: "75/25", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium" },
      { focus: "sharpen", phase: "taper", startDate: "2099-08-26", plannedWeeks: 1, intensitySplit: "75/25", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium" },
    ],
    updatedAt: "2099-07-01T00:00:00.000Z",
  } as SeasonPlan;

  const html = renderToStaticMarkup(<SeasonRoadmap />);

  expect(html).toContain("Counting down to");
  expect(html).toContain("Alpe KOM");
  expect(html).toContain("race-specific sharpening");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/otis/Cycling App" && npx vitest run components/SeasonRoadmap.test.tsx`

Expected: FAIL — `expected html ... to contain "Counting down to"` (the component still renders the generic auto-drafted line). The pre-existing test stays green.

- [ ] **Step 3: Implement**

In `components/SeasonRoadmap.tsx`, after the `nextEvent` line (line 56), add:

```tsx
  // The A-priority event the engine is backward-scheduling toward — strict `>` mirrors
  // backwardScheduleFromEvent's routing (on race day itself the countdown framing is stale).
  const nextA = plan.events.filter((e) => e.priority === "A" && e.date > today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
```

Replace the `hasDerived` paragraph (lines 87–91):

```tsx
      {hasDerived && (
        <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
          Auto-drafted from your objective, events, fitness/load, and current limiter. It refreshes when you generate a block.
        </p>
      )}
```

with:

```tsx
      {hasDerived && (
        <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
          {nextA ? (
            <>
              Counting down to <span className="font-medium">{nextA.name}</span> ({nextA.date}): build blocks first, then a
              peak (race-specific sharpening), then a taper ending on race week. It refreshes when you generate a block.
            </>
          ) : (
            "Auto-drafted from your objective, events, fitness/load, and current limiter. It refreshes when you generate a block."
          )}
        </p>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run components/SeasonRoadmap.test.tsx`

Expected: PASS — both tests (the original generic-copy test's plan has no events, so it still renders the generic line).

- [ ] **Step 5: Commit**

```bash
cd "/Users/otis/Cycling App"
git add components/SeasonRoadmap.tsx components/SeasonRoadmap.test.tsx
git commit -m "feat(season-ui): countdown copy when an A-event drives the roadmap (peak/taper explained)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Integration — full check + live event-driven smoke run

**Files:**
- No source changes. Verification only (fix-forward anything it surfaces, committing per the rules above).

**Interfaces:**
- Consumes: everything Tasks 1–8 landed.
- Produces: a verified, shippable state.

- [ ] **Step 1: Full gate**

Run: `cd "/Users/otis/Cycling App" && npm run check`

Expected: PASS — `tsc --noEmit` clean, `eslint` clean, `vitest run` green across ALL suites (this is the omnibus pass over `lib/season.test.ts` and `components/SeasonRoadmap.test.tsx` plus everything else). Concurrent-agent rule applies: a failure in a file this plan never touched → `git status --short <file>` first; uncommitted = the other session's WIP; wait ~30s, retry once, report if it persists.

- [ ] **Step 2: Live manual verification — the athlete's real KOM event (REQUIRED, not skippable)**

Per this repo's AGENTS.md rule, LLM-backed paths need one live smoke run — unit tests only prove the deterministic scaffolding. This exercises the exact path the athlete opted into:

1. Start the dev server: `npm run dev` (or reuse the running instance).
2. Have the athlete open `/plan` → the **Season** card (`components/SeasonSection.tsx`) → click **"+ Add event"** → enter their real KOM attempt: a real name, a real future date, priority **A** → **Save**. (Saving stores objective/events only — `PUT /api/season` never redrafts periods; the redraft happens at generation.)
3. Generate a block from `/plan` (this is the live Anthropic call — do not stub it).
4. Verify, reading the actual outputs:
   - `data/season-plan.json` now holds a backward-scheduled arc: build period(s) → a `phase: "peak"` period → a `phase: "taper"` period whose end lands on/just before the event date.
   - The build focuses along the runway are NOT a fixed `threshold → vo2max → durability` march: with a confident limiter it appears in the runway (nearest the peak); `anaerobic` is reachable; no focus repeats back-to-back — i.e. the two-state trap Task 1 fixed does not reappear in the real data.
   - The `/plan` roadmap renders the peak/taper cards legibly and shows the Task 8 countdown line naming the event.
   - The generated block's weeks make sense against the season context (server log / the block itself); if the athlete's FTP is ≥ 56 days stale, confirm the `RETEST DUE` line reached the prompt (log the dynamic prompt half or check the generated plan references a retest).
5. If anything reads wrong, fix forward with a targeted commit — do not ship on green units alone.

- [ ] **Step 3: Final commit (only if Step 2 forced fixes)**

```bash
cd "/Users/otis/Cycling App"
git add <only-the-files-you-touched>
git commit -m "fix(season): <what the live smoke run surfaced>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Requirement coverage map (self-review)

| Spec requirement | Task |
|---|---|
| 1. Fix `backwardScheduleFromEvent` rotation (limiter-aware, anaerobic reachable, drop-in seam for the scored selector, sibling check first) | Task 1 (Step 0 = sibling check; found NOT landed as of writing) |
| 2. Bounded 8–12 wk arcs above periods, `arcWeeks` constant, variety/reset across boundaries, no persisted `arcs` field (types confirmed sufficient) | Task 2 |
| 3. Retest cadence — pure function first (8-wk threshold justified), then prompt surfacing as a separate task | Tasks 6 (pure) + 7 (wiring) |
| 4. Genuine reduced-load period, distinct from `deloadWeek`, cadence stated & justified in Architecture (2 wk every ~20 loading wk ≈ every 2 arcs) | Tasks 3 (clock) + 4 (draft) + 5 (load/deload/fit) |
| 5. Light UI: peak/taper explanation via the existing explanatory-copy pattern; no add-event nudge | Task 8 |
| Test updates in `lib/season.test.ts` / `components/SeasonRoadmap.test.tsx`, existing style | Folded into Tasks 1–6, 8; omnibus run in Task 9 Step 1 |
| `npm run check` clean + live KOM event added via Season UI + live Anthropic generation smoke (AGENTS.md rule) | Task 9 |
| Global constraints (localToday/resolveToday, sibling-plan conflicts, event-path priority) | Header + Tasks 1, 7, 8 |

Known sibling-conflict surfaces (re-read the live file before each task): `SEASON_CONSTANTS` (Tasks 2/3/6 add lines — trivial merges), `nextBuildFocus`/`draftSeasonArc`'s while-loop (Tasks 2/4 restructure it; the critical-fixes sibling changes the focus-selection call inside the same loop — if it lands first, keep ITS selector call where these tasks show `nextBuildFocus(...)`), `backwardScheduleFromEvent` (Task 1; the coverage-selector sibling may replace `pickBuildFocus`'s body — Step 0 handles both orders).
