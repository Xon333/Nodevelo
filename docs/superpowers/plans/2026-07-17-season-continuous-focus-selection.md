# Season Continuous Focus Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rolling-mode period-sequence engine (`draftSeasonArc`'s Mode-C loop, `applyDeloadCadence`'s cross-call counter, `needsBaseGate`/`weeksSinceBase`'s arc-cap machinery) with `chooseNextFocus` — a stateless function that scores the next block's focus fresh from real data every `/api/generate` call — plus a real-data recovery hard cap that replaces the deload-cadence counter. Event-anchored mode (a real upcoming A-priority race) keeps its existing persisted, backward-scheduled arc, untouched in behavior.

**Architecture:** `lib/season.ts` gains `chooseNextFocus` (wraps the existing `scoreFocusCandidates`/`selectBuildFocus` scorer, now including `aerobic-base` as a normal competing candidate) and a real-data recovery check (`realWeeksSinceLastRecovery` + `planRecoveryWeeks`), replacing `replanSeasonArc` with two narrower functions: `settleSeasonHistory` (rolling — freezes/prunes, drafts nothing) and `replanEventArc` (event mode — unchanged three-bucket re-plan, still calling `backwardScheduleFromEvent`). `app/api/generate/route.ts` branches on whether an A-event exists and wires the right path through; `app/api/write/route.ts` reads the focus choice straight off the `GeneratedPlan` the client already has, instead of re-deriving it. The chosen focus/rationale ride through `GeneratedPlan` → `CurrentBlock` → `BlockHistoryEntry` as one un-recomputed value. `SEASON_SHAPES_GENERATION` stays `false` at the end of this plan (unchanged from today) — flipping it is the roadmap-preview plan's final task, once the UI can represent the new model.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, Vitest.

## Global Constraints

- Run `npm run check` (tsc --noEmit && eslint && vitest run) before every commit — 0 errors.
- New/changed optional fields on persisted types are read with a truthy check, never `=== null` (AGENTS.md migration-flag rule).
- `SEASON_SHAPES_GENERATION` stays `false` throughout this plan — every new prompt-injection string and validator call added below must be gated behind it, exactly mirroring how the code being replaced was gated. Only the underlying tracking (writing `season-plan.json`, stamping `GeneratedPlan.seasonFocus`) runs unconditionally, matching today's "season state keeps being tracked underneath this flag" behavior (`lib/season.ts`'s own top-of-file comment).
- Do not touch event-anchored mode's *behavior* — `backwardScheduleFromEvent`'s output for a given input must be byte-identical before and after this plan (only its selector call and callers change).
- Task 8 (generate-route wiring) changes what data reaches the Anthropic prompt only when the flag is on; since the flag stays off throughout this plan, **no live LLM smoke run is required** here — the roadmap-preview plan (which flips the flag) owns that smoke run per AGENTS.md's LLM-backed-path rule.

---

### Task 1: `aerobic-base` becomes a normal scored candidate

**Files:**
- Modify: `lib/season.ts` (`BUILD_FOCI`, `FOCUS_TRAINABILITY`, `goalRelevanceForFocus`, `execQualityByFocus`, `exposureFromSessions`)
- Modify: `lib/season.test.ts` (extend existing describe blocks for the functions above; see Step 5)

**Interfaces:**
- Produces: `BUILD_FOCI` now `["aerobic-base", "threshold", "vo2max", "anaerobic", "durability"]` (was 4 items, now 5) — every consumer (`scoreFocusCandidates`, `selectBuildFocus`, `pickBuildFocus`) picks it up automatically since none hardcode the array's length.
- Produces: `FOCUS_TRAINABILITY` gains `"aerobic-base": 0.9`
- Produces: `goalRelevanceForFocus(goalText, "aerobic-base")` always returns `0.5` (neutral — foundational, not goal-gated)
- Produces: `execQualityByFocus` maps `"aerobic-base"` to the same `"Z2"` execution dimension as `"durability"` (the athlete model has no finer distinction than "Z2 execution quality")
- Produces: `exposureFromSessions` splits its existing Z2/Recovery bucket: WITH embedded intensity/durability template → `"durability"` (unchanged); WITHOUT → `"aerobic-base"` (new)

- [ ] **Step 1: Write the failing tests**

Add to `lib/season.test.ts`. First, find the existing `describe` block(s) covering `scoreFocusCandidates`/`selectBuildFocus`/`execQualityByFocus`/`FOCUS_TRAINABILITY` (grep `describe("execQualityByFocus"` and similar — these exist somewhere between lines ~344-688, not yet read in detail) and add these cases there, matching that file's existing helper/fixture style:

```ts
describe("aerobic-base as a scored candidate (season-continuous-focus-selection §4)", () => {
  it("BUILD_FOCI now includes aerobic-base alongside the four build systems", () => {
    const scores = scoreFocusCandidates({ system: null, confidence: "low" }, []);
    expect(scores.map((s) => s.focus).sort()).toEqual(["aerobic-base", "anaerobic", "durability", "threshold", "vo2max"]);
  });

  it("goalRelevanceForFocus never penalizes aerobic-base to 0, even when another pattern fires", () => {
    expect(goalRelevanceForFocus("Raise my FTP", "aerobic-base")).toBe(0.5);
    expect(goalRelevanceForFocus(undefined, "aerobic-base")).toBe(0.5);
    expect(goalRelevanceForFocus("", "aerobic-base")).toBe(0.5);
  });

  it("execQualityByFocus maps aerobic-base onto the same Z2 dimension as durability", () => {
    const model = {
      byType: [{ type: "Z2", n: 5, execEwma: 7.1, complianceEwma: 90, trend: "flat" as const }],
      overallExecEwma: 7, overallTrend: "flat" as const, sampleSize: 5,
      behaviour: { totalRides: 5, plannedRides: 5, unplannedRides: 0, offPlanPct: 0, unplannedAvgQuality: null, weeklyHours: 8 },
      behaviourAllTime: { totalRides: 5, plannedRides: 5, unplannedRides: 0, offPlanPct: 0, unplannedAvgQuality: null, weeklyHours: 8 },
    };
    const out = execQualityByFocus(model);
    expect(out["aerobic-base"]).toBe(7.1);
    expect(out["aerobic-base"]).toBe(out.durability);
  });

  it("exposureFromSessions splits plain Z2/Recovery (aerobic-base) from embedded-intensity Z2/Recovery (durability)", () => {
    const days = [
      { date: "2026-07-01", type: "Z2" as const, durationMin: 120, workoutText: "" }, // plain — no template, no embedded intensity
      { date: "2026-07-03", type: "Recovery" as const, durationMin: 300, durabilityTemplate: "B" }, // durability-templated
    ];
    const out = exposureFromSessions(days, 250, "2026-07-10");
    expect(out["aerobic-base"]).toBe(1); // whole weeks since 2026-07-01
    expect(out.durability).toBe(1); // whole weeks since 2026-07-03
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/season.test.ts -t "aerobic-base as a scored candidate"`
Expected: FAIL — `scores.map(...)` currently returns only 4 foci; `execQualityByFocus`/`exposureFromSessions` don't produce an `"aerobic-base"` key yet.

- [ ] **Step 3: Implement**

In `lib/season.ts`:

Change `BUILD_FOCI` (~line 158):

```ts
const BUILD_FOCI: SeasonFocus[] = ["aerobic-base", "threshold", "vo2max", "anaerobic", "durability"];
```

Change `FOCUS_TRAINABILITY`'s type and value (~line 192):

```ts
export const FOCUS_TRAINABILITY: Record<"aerobic-base" | "threshold" | "vo2max" | "anaerobic" | "durability", number> = {
  "aerobic-base": 0.9, // responds quickly to a short re-touch (KB: 2-4wk sufficient to re-establish the ceiling)
  threshold: 1.0,
  vo2max: 0.9,
  durability: 0.6,
  anaerobic: 0.3,
};
```

Change `scoreFocusCandidates`'s cast at its trainability lookup (~line 235) since the union type widened:

```ts
      trainability: SELECTOR_WEIGHTS.trainability * FOCUS_TRAINABILITY[focus as keyof typeof FOCUS_TRAINABILITY],
```

(No change needed here — the cast already reads from the object generically; confirm it still compiles once `aerobic-base` is a valid key.)

Change `goalRelevanceForFocus` (~line 72) to special-case aerobic-base before the pattern-matching logic:

```ts
export function goalRelevanceForFocus(goalText: string | undefined, focus: SeasonFocus): number {
  // Foundational, not goal-gated (season-continuous-focus-selection §4, KB: "base is non-negotiable") —
  // no goal ever names aerobic-base explicitly, so letting the fired-pattern penalty zero it out
  // whenever ANY other pattern fires would make it lose every goal-driven scoring round by construction.
  if (focus === "aerobic-base") return 0.5;
  const haystack = (goalText ?? "").toLowerCase();
  if (!haystack.trim()) return 0.5;
  const fired = GOAL_PATTERNS.filter((p) => tagPresent(haystack, p.re));
  if (fired.length === 0) return 0.5;
  return Math.max(...fired.map((p) => p.weights[focus] ?? 0));
}
```

Change `execQualityByFocus` (~line 260) to add the aerobic-base dim:

```ts
export function execQualityByFocus(model: AthleteModel): Partial<Record<SeasonFocus, number>> {
  const dims: Array<[SeasonFocus, string]> = [
    ["threshold", "Threshold"],
    ["vo2max", "VO2max"],
    ["anaerobic", "SIT"],
    ["durability", "Z2"],
    // Same Z2 dimension as durability — the athlete model has no finer distinction between a
    // durability-templated Z2 ride and a plain aerobic-base Z2 ride; both are steady-state execution.
    ["aerobic-base", "Z2"],
  ];
  const out: Partial<Record<SeasonFocus, number>> = {};
  for (const [focus, dim] of dims) {
    const e = execFor(model, dim);
    if (e !== null) out[focus] = e;
  }
  return out;
}
```

Change `exposureFromSessions` (~line 107-130) to split the Z2/Recovery bucket:

```ts
export function exposureFromSessions(
  days: SessionSample[],
  ftp: number,
  asOf: string
): Partial<Record<SeasonFocus, number>> {
  const latest: Partial<Record<SeasonFocus, string>> = {};
  const note = (focus: SeasonFocus, date: string) => {
    if (!latest[focus] || date > latest[focus]!) latest[focus] = date;
  };
  for (const d of days) {
    if (d.date > asOf || d.durationMin <= 0) continue;
    if (d.type === "Threshold") note("threshold", d.date);
    else if (d.type === "VO2max") note("vo2max", d.date);
    else if (d.type === "SIT") note("anaerobic", d.date);
    else if (d.type === "Z2" || d.type === "Recovery") {
      if (d.durabilityTemplate || carriesEmbeddedIntensity(d.workoutText, ftp)) note("durability", d.date);
      else note("aerobic-base", d.date);
    }
  }
  const out: Partial<Record<SeasonFocus, number>> = {};
  for (const [focus, date] of Object.entries(latest) as Array<[SeasonFocus, string]>) {
    out[focus] = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(date)) / (7 * 86_400_000)));
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/season.test.ts -t "aerobic-base as a scored candidate"`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the whole `season.test.ts` file and fix fallout**

Run: `npx vitest run lib/season.test.ts`

`BUILD_FOCI` growing from 4 to 5 items changes `scoreFocusCandidates`'/`selectBuildFocus`'s output shape and tie-break order for any existing test that asserts an exact array length or a hardcoded candidate list (e.g. a `toHaveLength(4)` near a `scoreFocusCandidates` call, or a fixed 4-element `builds` array in a rotation test). Read each failure, and:
- If it's a `describe("scoreFocusCandidates"...)`/`describe("selectBuildFocus"...)` block: update the assertion to account for the 5th candidate (aerobic-base now competes — depending on the fixture's `recentFocuses`/`signals`, it may or may not win a given round; adjust the fixture's `recentFocuses` to include `"aerobic-base"` recently if the test's intent was specifically "among the four BUILD systems", to keep that test's original intent intact).
- If it's a `describe("execQualityByFocus"...)` block asserting the exact returned object shape: add the expected `"aerobic-base"` key wherever a Z2 execEwma was supplied in that test's fixture.
- Do **not** touch `describe("draftSeasonArc — Mode-C"...)`, `describe("draftSeasonArc — scored coverage selection"...)`, or any other rolling-loop test here — those are deleted wholesale in Task 4, not patched.

- [ ] **Step 6: Full gate + commit**

Run: `npm run check`

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): aerobic-base becomes a normal scored focus candidate"
```

---

### Task 2: `chooseNextFocus` + `findUpcomingAEvent`

**Files:**
- Modify: `lib/season.ts`
- Modify: `lib/season.test.ts`

**Interfaces:**
- Consumes: `scoreFocusCandidates`, `SeasonDraftInput["limiter"]`, `FocusSignals`, `FocusScore` (all already exist, Task 1 extended their candidate set)
- Produces: `export interface FocusChoice { focus: SeasonFocus; rationale: string; scores: FocusScore[] }`
- Produces: `export interface ChooseNextFocusInput { limiter: SeasonDraftInput["limiter"]; lastFocus: SeasonFocus | null; signals: FocusSignals }`
- Produces: `export function chooseNextFocus(input: ChooseNextFocusInput): FocusChoice`
- Produces: `export function findUpcomingAEvent(events: SeasonEvent[], today: string): SeasonEvent | null`
- Produces: `export function isSeasonFocus(v: string | undefined): v is SeasonFocus`

- [ ] **Step 1: Write the failing tests**

Add to `lib/season.test.ts`:

```ts
describe("chooseNextFocus (season-continuous-focus-selection §4)", () => {
  it("picks the highest-scored candidate that isn't the last focus", () => {
    const choice = chooseNextFocus({
      limiter: { system: "vo2max", confidence: "high" },
      lastFocus: "threshold",
      signals: {},
    });
    expect(choice.focus).toBe("vo2max"); // limiter bonus wins
    expect(choice.focus).not.toBe("threshold"); // no-back-to-back
    expect(choice.scores).toHaveLength(5); // full ranking, including the loser
  });

  it("gives a KB-grounded rationale distinguishing a confident-limiter pick from a rotation pick", () => {
    const limiterPick = chooseNextFocus({ limiter: { system: "vo2max", confidence: "high" }, lastFocus: "threshold", signals: {} });
    expect(limiterPick.rationale).toContain("depressed system");
    const rotationPick = chooseNextFocus({ limiter: { system: null, confidence: "low" }, lastFocus: "threshold", signals: {} });
    expect(rotationPick.rationale).toBeTruthy();
    expect(rotationPick.rationale).not.toBe(limiterPick.rationale);
  });

  it("gives aerobic-base its own rationale wording when it wins", () => {
    const choice = chooseNextFocus({
      limiter: { system: null, confidence: "low" },
      lastFocus: "threshold",
      signals: { exposure: { "aerobic-base": undefined, threshold: 0, vo2max: 0, anaerobic: 0, durability: 0 } },
    });
    expect(choice.focus).toBe("aerobic-base"); // never-seen urgency (undefined exposure) outranks saturated staleness
    expect(choice.rationale.toLowerCase()).toContain("aerobic");
  });

  it("real signals (goal text, exposure, execution) shape the pick, same as scoreFocusCandidates directly", () => {
    const choice = chooseNextFocus({
      limiter: { system: "anaerobic", confidence: "high" },
      lastFocus: "aerobic-base",
      signals: { goalText: "Raise my FTP from 280 to 300 W" },
    });
    expect(choice.focus).toBe("threshold"); // goal-relevance overrides the anaerobic limiter, same as the old draft-level regression test proved
  });
});

describe("findUpcomingAEvent", () => {
  it("finds the nearest future A-priority event", () => {
    const events = [
      { name: "B race", date: "2026-08-01", priority: "B" as const },
      { name: "A race", date: "2026-10-01", priority: "A" as const },
    ];
    expect(findUpcomingAEvent(events, "2026-07-01")?.name).toBe("A race");
  });
  it("returns null when the only A-event is today or in the past", () => {
    const events = [{ name: "A race", date: "2026-07-01", priority: "A" as const }];
    expect(findUpcomingAEvent(events, "2026-07-01")).toBeNull();
  });
  it("returns null when there is no A-event at all", () => {
    expect(findUpcomingAEvent([{ name: "B race", date: "2026-08-01", priority: "B" as const }], "2026-07-01")).toBeNull();
  });
});

describe("isSeasonFocus", () => {
  it("narrows a valid focus string, rejects anything else", () => {
    expect(isSeasonFocus("threshold")).toBe(true);
    expect(isSeasonFocus("aerobic-base")).toBe(true);
    expect(isSeasonFocus("made-up")).toBe(false);
    expect(isSeasonFocus(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/season.test.ts -t "chooseNextFocus|findUpcomingAEvent|isSeasonFocus"`
Expected: FAIL — none of these three are exported yet.

- [ ] **Step 3: Implement**

In `lib/season.ts`, add after `scoreFocusCandidates`/`selectBuildFocus` (~line 256, right before the `execQualityByFocus` comment block):

```ts
// One stateless focus decision for the next block, made fresh every /api/generate call from real data —
// replaces the old drafted-period-sequence model for the rolling (no upcoming A-event) case (season-
// continuous-focus-selection §4). Thin wrapper over the existing scored selector: no new scoring logic,
// just a caller-friendly input/output shape plus a rationale string for the prompt.
export interface FocusChoice {
  focus: SeasonFocus;
  rationale: string;
  scores: FocusScore[]; // full ranking, for the roadmap outlook + debug
}

export interface ChooseNextFocusInput {
  limiter: SeasonDraftInput["limiter"];
  lastFocus: SeasonFocus | null; // no-back-to-back variety rule
  signals: FocusSignals;
}

export function chooseNextFocus(input: ChooseNextFocusInput): FocusChoice {
  const recent = input.lastFocus ? [input.lastFocus] : [];
  const scores = scoreFocusCandidates(input.limiter, recent, input.signals);
  const focus = scores.filter((s) => s.focus !== input.lastFocus)[0].focus;
  const rationale =
    input.limiter.system === focus && input.limiter.confidence !== "low"
      ? "your most depressed system relative to your engine"
      : focus === "aerobic-base"
        ? "re-touching the aerobic ceiling — every later phase depends on it (KB)"
        : "rotating the quality focus (KB: avoid repeating one stimulus)";
  return { focus, rationale, scores };
}

// The same A-event lookup draftSeasonArc used to gate on internally — extracted so /api/generate can
// branch on it directly (season-continuous-focus-selection §4/§9: the rolling and event-anchored paths
// now diverge before this point, not inside one dispatcher function).
export function findUpcomingAEvent(events: SeasonEvent[], today: string): SeasonEvent | null {
  return events.find((e) => e.priority === "A" && Date.parse(e.date) > Date.parse(today)) ?? null;
}

// Type guard for a persisted-but-untyped focus string (CurrentBlock.seasonFocus is `string`, not
// SeasonFocus, so a block written before this field existed — or corrupted by hand-editing JSON —
// can't be trusted without a runtime check before feeding it into chooseNextFocus's lastFocus).
const SEASON_FOCI: readonly SeasonFocus[] = ["aerobic-base", "threshold", "vo2max", "anaerobic", "durability", "sharpen"];
export function isSeasonFocus(v: string | undefined): v is SeasonFocus {
  return v !== undefined && (SEASON_FOCI as readonly string[]).includes(v);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/season.test.ts -t "chooseNextFocus|findUpcomingAEvent|isSeasonFocus"`
Expected: PASS (9 tests).

- [ ] **Step 5: Full gate + commit**

Run: `npm run check`

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): add chooseNextFocus, findUpcomingAEvent, isSeasonFocus"
```

---

### Task 3: Real-data recovery hard cap

**Files:**
- Modify: `lib/season.ts` (add `realWeeksSinceLastRecovery`, `planRecoveryWeeks`, `formatRecoveryWeeks`; replace `formatRetestNote`)
- Modify: `lib/season.test.ts`

**Interfaces:**
- Consumes: `RideScoreEntry` (`date`, `tss`), `SEASON_CONSTANTS.deloadEveryWeeks`/`deloadTightEveryWeeks`/`retestEveryWeeks`, `addWeeks`
- Produces: `realWeeksSinceLastRecovery(entries: Array<Pick<RideScoreEntry, "date" | "tss">>, avgWeeklyTss: number | null, today: string): number`
- Produces: `planRecoveryWeeks(weeksSinceRecovery: number, lengthWeeks: number, tight: boolean): number[]` (0-indexed week numbers within the block)
- Produces: `formatRecoveryWeeks(indices: number[], lengthWeeks: number): string | null`
- Changes: `formatRetestNote(ftpStaleDays: number | null, recoveryWeekIndices: number[], blockStartDate: string): string | null` — **signature change**, old `(ftpStaleDays, plan, today)` signature is removed

- [ ] **Step 1: Write the failing tests**

Add to `lib/season.test.ts`:

```ts
describe("realWeeksSinceLastRecovery (season-continuous-focus-selection §5)", () => {
  it("returns 0 with no baseline (never force a cap blind)", () => {
    expect(realWeeksSinceLastRecovery([], null, "2026-07-01")).toBe(0);
    expect(realWeeksSinceLastRecovery([{ date: "2026-06-01", tss: 500 }], 0, "2026-07-01")).toBe(0);
  });

  it("finds the most recent week whose real TSS sits at/below 50% of the baseline", () => {
    const entries = [
      { date: "2026-06-15", tss: 90 }, // light week (3wk ago): 90 <= 400*0.5=200
      { date: "2026-06-22", tss: 380 }, // loading
      { date: "2026-06-29", tss: 410 }, // loading
      { date: "2026-07-01", tss: 60 }, // this week so far
    ];
    // Week ending 2026-07-01 (this week, partial): 60 <= 200 → light. 0 weeks since.
    expect(realWeeksSinceLastRecovery(entries, 400, "2026-07-01")).toBe(0);
  });

  it("counts real calendar weeks back to the last genuinely light week", () => {
    const entries = [
      { date: "2026-06-08", tss: 100 }, // light week, 3 weeks before 2026-06-29
      { date: "2026-06-15", tss: 420 },
      { date: "2026-06-22", tss: 410 },
      { date: "2026-06-29", tss: 430 }, // "today" — a loading week
    ];
    expect(realWeeksSinceLastRecovery(entries, 400, "2026-06-29")).toBe(3);
  });

  it("gives up at the lookback cap when no light week exists in the ledger's history", () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({ date: addWeeks("2026-01-05", i), tss: 450 }));
    expect(realWeeksSinceLastRecovery(entries, 400, "2026-07-27")).toBe(26);
  });
});

describe("planRecoveryWeeks", () => {
  it("places no recovery week when already recently recovered and the block is short", () => {
    expect(planRecoveryWeeks(0, 4, false)).toEqual([]);
  });
  it("forces week 1 (index 0) when already at/over the hard cap", () => {
    expect(planRecoveryWeeks(4, 4, false)).toEqual([0]);
    expect(planRecoveryWeeks(6, 2, false)).toEqual([0]);
  });
  it("places a recovery week exactly when the cumulative count reaches the cap, then repeats every `every` weeks", () => {
    expect(planRecoveryWeeks(2, 8, false)).toEqual([1, 5]); // 2+1+1=4 at index 1; resets; +4 more at index 5
  });
  it("uses the tighter 3-week cadence under heavy fatigue", () => {
    expect(planRecoveryWeeks(0, 6, true)).toEqual([2]); // 0+1+1+1=3 at index 2
  });
});

describe("formatRecoveryWeeks", () => {
  it("returns null when nothing is due", () => {
    expect(formatRecoveryWeeks([], 4)).toBeNull();
  });
  it("names the week(s) and the hard-cap rationale", () => {
    const line = formatRecoveryWeeks([2], 6);
    expect(line).toContain("week 3");
    expect(line).toContain("6-week block");
  });
});

describe("formatRetestNote (new signature — season-continuous-focus-selection §5)", () => {
  it("returns null when fresh", () => {
    expect(formatRetestNote(10, [], "2026-07-01")).toBeNull();
    expect(formatRetestNote(null, [], "2026-07-01")).toBeNull();
  });
  it("fires once stale, pointing at this block's own recovery week when one exists", () => {
    const note = formatRetestNote(60, [2], "2026-07-01");
    expect(note).toContain("RETEST DUE");
    expect(note).toContain(addWeeks("2026-07-01", 2));
  });
  it("fires with no slot line when this block has no recovery week", () => {
    const note = formatRetestNote(60, [], "2026-07-01");
    expect(note).toContain("RETEST DUE");
    expect(note).not.toContain("Best slot");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/season.test.ts -t "realWeeksSinceLastRecovery|planRecoveryWeeks|formatRecoveryWeeks|formatRetestNote"`
Expected: FAIL — the three new functions don't exist; the old `formatRetestNote` tests (if any predate this task, e.g. anything asserting a `(ftpStaleDays, plan, today)` call) fail to typecheck once the signature below lands — that's expected and resolved in Step 5.

- [ ] **Step 3: Implement**

In `lib/season.ts`, add after `chooseNextFocus`/`findUpcomingAEvent` (Task 2's additions):

```ts
// A week is "genuinely light" at/below this fraction of the athlete's own rolling weekly baseline —
// mirrors assignLoadTargets' "a genuine season break: ~50% load" convention and
// BlockSettings.recoveryWeekHoursMin/Max's real recovery-week volume band, so "light" means the same
// thing everywhere in this codebase.
const LIGHT_WEEK_FRACTION = 0.5;
// Give up after this many weeks of backward search (a new athlete with under ~6mo of ledger) rather
// than loop indefinitely — the whole available history simply counts as "since the last light week".
const MAX_RECOVERY_LOOKBACK_WEEKS = 26;

// Real-data recovery hard cap (season-continuous-focus-selection §5) — replaces applyDeloadCadence's
// cross-call counter (the single largest source of correctness bugs across the last three sessions,
// most recently HR-22) with a value re-derived fresh from real ride history every call: nothing is
// stored or threaded between /api/generate calls, so there's no cross-call state to drift.
export function realWeeksSinceLastRecovery(
  entries: Array<Pick<RideScoreEntry, "date" | "tss">>,
  avgWeeklyTss: number | null,
  today: string
): number {
  if (avgWeeklyTss === null || !Number.isFinite(avgWeeklyTss) || avgWeeklyTss <= 0) return 0;
  const dayMs = 86_400_000;
  for (let w = 0; w < MAX_RECOVERY_LOOKBACK_WEEKS; w++) {
    const weekEndMs = Date.parse(today) - w * 7 * dayMs;
    const weekStartMs = weekEndMs - 6 * dayMs;
    const weekEnd = new Date(weekEndMs).toISOString().slice(0, 10);
    const weekStart = new Date(weekStartMs).toISOString().slice(0, 10);
    const weekTss = entries
      .filter((e) => e.date >= weekStart && e.date <= weekEnd && e.tss !== null)
      .reduce((sum, e) => sum + (e.tss as number), 0);
    if (weekTss <= avgWeeklyTss * LIGHT_WEEK_FRACTION) return w;
  }
  return MAX_RECOVERY_LOOKBACK_WEEKS;
}

// Which 0-indexed week(s) within a new block of `lengthWeeks` must be recovery, given how many real
// calendar weeks have already elapsed since the last genuinely light one. Hard cap: never more than
// `every` weeks without recovery — continues counting forward within a block longer than the cap, so
// an 8-week block still gets recovery weeks spaced correctly, not just one at the front.
export function planRecoveryWeeks(weeksSinceRecovery: number, lengthWeeks: number, tight: boolean): number[] {
  const every = tight ? SEASON_CONSTANTS.deloadTightEveryWeeks : SEASON_CONSTANTS.deloadEveryWeeks;
  const indices: number[] = [];
  let sinceRecovery = weeksSinceRecovery;
  for (let wk = 0; wk < lengthWeeks; wk++) {
    sinceRecovery += 1;
    if (sinceRecovery >= every) {
      indices.push(wk);
      sinceRecovery = 0;
    }
  }
  return indices;
}

// Prompt-injectable recovery-week callout — additive to formatFocusContext/formatSeasonContext (Task 5).
export function formatRecoveryWeeks(indices: number[], lengthWeeks: number): string | null {
  if (indices.length === 0) return null;
  const label = indices.map((i) => `week ${i + 1}`).join(", ");
  return `RECOVERY: cut volume ~30–50% in ${label} of this ${lengthWeeks}-week block (hard cap — real training history shows ≥${SEASON_CONSTANTS.deloadEveryWeeks} calendar weeks since the last genuinely light week).`;
}
```

Replace the existing `formatRetestNote` function (~line 746-755) entirely:

```ts
// A short prompt-injectable nudge when the athlete's tested FTP has gone stale (ftpStaleDays is the
// figure /api/profile already computes off physiology.json's effectiveFrom). Due every
// retestEveryWeeks — one arc. Points at THIS block's own recovery week (from planRecoveryWeeks, above)
// instead of looking ahead into a drafted period array — there is no such array to look ahead into
// once a block's focus is chosen fresh each call (season-continuous-focus-selection §5). Null when
// fresh or unknown. A nudge, never a hard gate.
export function formatRetestNote(ftpStaleDays: number | null, recoveryWeekIndices: number[], blockStartDate: string): string | null {
  if (ftpStaleDays === null || ftpStaleDays < SEASON_CONSTANTS.retestEveryWeeks * 7) return null;
  const where = recoveryWeekIndices.length > 0
    ? ` Best slot: this block's recovery week starting ${addWeeks(blockStartDate, recoveryWeekIndices[0])}.`
    : "";
  return `RETEST DUE: FTP last validated ${ftpStaleDays} days ago (cadence ~${SEASON_CONSTANTS.retestEveryWeeks} wk). Schedule an FTP/power-curve retest to re-anchor zones and load targets.${where}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/season.test.ts -t "realWeeksSinceLastRecovery|planRecoveryWeeks|formatRecoveryWeeks|formatRetestNote"`
Expected: PASS (13 tests).

- [ ] **Step 5: Find and remove any pre-existing `formatRetestNote` tests using the OLD signature**

Run: `grep -n "formatRetestNote" lib/season.test.ts`

Any test calling `formatRetestNote(ftpStaleDays, somePlan, today)` (three args, second one a `SeasonPlan`) predates this task and no longer typechecks — delete those specific `it(...)` blocks (the new Step 1 tests above already cover the function's contract under its new signature). Do not delete anything else in the same `describe` block if it's testing something unrelated.

- [ ] **Step 6: Full gate + commit**

Run: `npm run check`

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): real-data recovery hard cap, replacing applyDeloadCadence"
```

---

### Task 4: `settleSeasonHistory` + `replanEventArc`, replacing `replanSeasonArc`; delete the rolling-loop machinery

**Files:**
- Modify: `lib/season.ts` (add `settleSeasonHistory`/`replanEventArc`; delete `replanSeasonArc`, `draftSeasonArc`, `needsBaseGate`, `weeksSinceBase`, `applyDeloadCadence`, `weeksSinceSeasonBreak`, `weeksSinceLastDeload`, `assignLoadTargets`, `nextBuildFocus`, `pickBuildFocus`; update `backwardScheduleFromEvent` to call `selectBuildFocus` directly; trim now-unused `SEASON_CONSTANTS` keys and `SeasonDraftInput` fields)
- Modify: `lib/season.test.ts` (heavy surgery — see steps below)
- Modify: `ROADMAP.md` (close the `nextBuildFocus`/`pickBuildFocus` collapse debt item)

**Interfaces:**
- Produces: `settleSeasonHistory(plan: SeasonPlan, achievedTssFor: (p: FocusPeriod) => number | null, today: string): SeasonPlan`
- Produces: `replanEventArc(plan: SeasonPlan, event: SeasonEvent, input: SeasonDraftInput, achievedTssFor: (p: FocusPeriod) => number | null, today: string): SeasonPlan`
- Removed: `replanSeasonArc`, `draftSeasonArc`, `needsBaseGate`, `weeksSinceBase`, `applyDeloadCadence`, `weeksSinceSeasonBreak`, `weeksSinceLastDeload`, `assignLoadTargets`, `nextBuildFocus`, `pickBuildFocus`
- Changes: `backwardScheduleFromEvent`'s internal call `pickBuildFocus(input.limiter, chosen)` → `selectBuildFocus(input.limiter, chosen)` (byte-identical behavior — `pickBuildFocus` was already a pure delegation)

- [ ] **Step 1: Write the failing tests for the two new functions**

Add to `lib/season.test.ts`, replacing the entire existing `describe("replanSeasonArc", () => { ... })` block (the one starting `const achieved = () => 400;`) with:

```ts
describe("settleSeasonHistory (rolling mode — season-continuous-focus-selection §4/§9)", () => {
  const achieved = () => 400;
  it("freezes elapsed periods with achievedTss and never re-drafts them", () => {
    const past = { focus: "aerobic-base" as const, phase: "base" as const, startDate: "2026-06-01", plannedWeeks: 3, intensitySplit: "90/10", targetWeeklyTss: 380, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "medium" as const };
    const out = settleSeasonHistory(planWith([past]), achieved, "2026-07-01");
    const frozen = out.periods.find((p) => p.startDate === "2026-06-01")!;
    expect(frozen.achievedTss).toBe(400);
  });
  it("drops a future period entirely — rolling mode no longer preserves a forward-drafted tail of any kind", () => {
    const future = { focus: "durability" as const, phase: "build" as const, startDate: "2026-07-15", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "was an override", source: "override" as const, confidence: "high" as const };
    const out = settleSeasonHistory(planWith([future]), achieved, "2026-07-01");
    expect(out.periods).toHaveLength(0);
  });
  it("preserves the period straddling today verbatim, without stamping achievedTss", () => {
    const current = { focus: "threshold" as const, phase: "build" as const, startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "in progress", source: "derived" as const, confidence: "medium" as const };
    const out = settleSeasonHistory(planWith([current]), achieved, "2026-07-01");
    const preserved = out.periods.find((p) => p.startDate === "2026-06-22")!;
    expect(preserved).toEqual(current);
    expect(preserved.achievedTss).toBeUndefined();
  });
  it("is idempotent: settling an already-settled plan with the same today reproduces it unchanged", () => {
    const current = { focus: "threshold" as const, phase: "build" as const, startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "in progress", source: "derived" as const, confidence: "medium" as const };
    const first = settleSeasonHistory(planWith([current]), achieved, "2026-07-01");
    const second = settleSeasonHistory(first, achieved, "2026-07-01");
    expect(second.periods).toEqual(first.periods);
  });
});

describe("replanEventArc (event-anchored mode — unchanged behavior, narrower entry point)", () => {
  const achieved = () => 400;
  const event = { name: "Gran Fondo", date: "2026-10-01", priority: "A" as const };
  it("freezes elapsed periods with achievedTss and never re-drafts them", () => {
    const past = { focus: "aerobic-base" as const, phase: "base" as const, startDate: "2026-06-01", plannedWeeks: 3, intensitySplit: "90/10", targetWeeklyTss: 380, deloadWeek: false, rationale: "", source: "derived" as const, confidence: "medium" as const };
    const out = replanEventArc(planWith([past]), event, baseInput(), achieved, "2026-07-01");
    const frozen = out.periods.find((p) => p.startDate === "2026-06-01")!;
    expect(frozen.achievedTss).toBe(400);
  });
  it("preserves a future override period", () => {
    const ovr = { focus: "durability" as const, phase: "build" as const, startDate: "2026-07-15", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "mine", source: "override" as const, confidence: "high" as const };
    const out = replanEventArc(planWith([ovr]), event, baseInput(), achieved, "2026-07-01");
    expect(out.periods.some((p) => p.source === "override" && p.rationale === "mine")).toBe(true);
  });
  it("preserves the period straddling today verbatim, without stamping achievedTss", () => {
    const current = { focus: "threshold" as const, phase: "build" as const, startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "in progress", source: "derived" as const, confidence: "medium" as const };
    const out = replanEventArc(planWith([current]), event, baseInput(), achieved, "2026-07-01");
    const preserved = out.periods.find((p) => p.startDate === "2026-06-22")!;
    expect(preserved).toEqual(current);
    expect(preserved.achievedTss).toBeUndefined();
  });
  it("starts the redrafted tail strictly after the straddling period ends, not at today", () => {
    const current = { focus: "threshold" as const, phase: "build" as const, startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "in progress", source: "derived" as const, confidence: "medium" as const };
    const out = replanEventArc(planWith([current]), event, baseInput(), achieved, "2026-07-01");
    const currentEnd = addWeeks(current.startDate, current.plannedWeeks);
    const firstDerived = out.periods.filter((p) => p.startDate > current.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    expect(firstDerived.startDate).toBe(currentEnd);
  });
  it("is idempotent for the current-period bucket specifically", () => {
    const current = { focus: "threshold" as const, phase: "build" as const, startDate: "2026-06-22", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: 420, deloadWeek: false, rationale: "in progress", source: "derived" as const, confidence: "medium" as const };
    const first = replanEventArc(planWith([current]), event, baseInput(), achieved, "2026-07-01");
    const second = replanEventArc(first, event, baseInput(), achieved, "2026-07-01");
    const preserved = second.periods.find((p) => p.startDate === "2026-06-22")!;
    expect(preserved).toEqual(current);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run lib/season.test.ts -t "settleSeasonHistory|replanEventArc"`
Expected: FAIL — neither function is exported yet.

- [ ] **Step 3: Implement `settleSeasonHistory` and `replanEventArc`**

In `lib/season.ts`, replace the entire `replanSeasonArc` function (~line 496-543, including its doc comment) with:

```ts
// Rolling mode (season-continuous-focus-selection §4/§9): freeze past periods with achieved load
// (same semantics the old replanSeasonArc always had for this bucket), preserve a period straddling
// today verbatim until it ends, and drop every future period — rolling mode no longer drafts a
// forward sequence; chooseNextFocus decides each block's focus fresh instead. What remains after this
// is pure settled history: done-cards for the roadmap, achievedTss for the selector's execution
// signal. Pure + idempotent.
export function settleSeasonHistory(
  plan: SeasonPlan,
  achievedTssFor: (period: FocusPeriod) => number | null,
  today: string
): SeasonPlan {
  const frozen = plan.periods
    .filter((p) => periodEnd(p) <= today)
    .map((p) => ({ ...p, achievedTss: p.achievedTss ?? achievedTssFor(p) ?? undefined }));
  const current = plan.periods.filter((p) => p.startDate <= today && periodEnd(p) > today);
  const periods = [...frozen, ...current].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { ...plan, periods, updatedAt: plan.updatedAt };
}

// Event-anchored mode (season-continuous-focus-selection §7 — kept close to shipped behavior): the
// same three-bucket re-plan the old replanSeasonArc always did for this case (freeze past / preserve
// current / preserve overrides / redraft the tail), with the tail always going straight to
// backwardScheduleFromEvent instead of through draftSeasonArc's now-removed dispatcher. Deload-cadence
// threading is gone because it never applied to this path (see backwardScheduleFromEvent's own
// comment: peak/taper are exempt).
export function replanEventArc(
  plan: SeasonPlan,
  event: SeasonEvent,
  input: SeasonDraftInput,
  achievedTssFor: (period: FocusPeriod) => number | null,
  today: string
): SeasonPlan {
  const frozen = plan.periods
    .filter((p) => periodEnd(p) <= today)
    .map((p) => ({ ...p, achievedTss: p.achievedTss ?? achievedTssFor(p) ?? undefined }));
  const current = plan.periods.filter((p) => p.startDate <= today && periodEnd(p) > today);
  const overrides = plan.periods.filter(
    (p) => periodEnd(p) > today && p.source === "override" && !current.includes(p)
  );
  const anchors = [...current, ...overrides];
  const draftStart = anchors.length ? anchors.map((p) => periodEnd(p)).sort().reverse()[0] : today;
  const keptPeriods = [...frozen, ...current, ...overrides];
  const derived = backwardScheduleFromEvent(event, input, draftStart);
  const periods = [...keptPeriods, ...derived].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { ...plan, periods, updatedAt: plan.updatedAt };
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx vitest run lib/season.test.ts -t "settleSeasonHistory|replanEventArc"`
Expected: PASS (9 tests).

- [ ] **Step 5: Delete the now-dead rolling-loop machinery**

In `lib/season.ts`, delete entirely (in this order, to avoid intermediate compile errors from a still-referenced deleted function):

1. `draftSeasonArc` (the whole function, ~line 309-410, including its doc comment) — its rolling loop is gone; its event-branch responsibility moved into `replanEventArc` (Step 3).
2. `needsBaseGate` (~line 161-163) — only called from inside `draftSeasonArc`, just deleted.
3. `weeksSinceBase` (~line 169-173) — same.
4. `assignLoadTargets` (~line 421-436) — only called from inside `draftSeasonArc`, just deleted. (Event-mode periods never got a `targetWeeklyTss` — `backwardScheduleFromEvent`'s `mk` helper always sets it `null` — so this deletion has zero effect on event mode.)
5. `applyDeloadCadence` (~line 573-589) — superseded by Task 3's `planRecoveryWeeks`; never applied to the event path (its own doc comment says so).
6. `weeksSinceSeasonBreak` (~line 601-609) — only fed `draftSeasonArc`'s rolling loop via `SeasonDraftInput.weeksSinceSeasonBreak`.
7. `weeksSinceLastDeload` (~line 621-629) — only fed `applyDeloadCadence`'s seed via `SeasonDraftInput.weeksSinceLastDeload` and `replanSeasonArc`'s (now `replanEventArc`'s, which no longer threads it) draft-tail call.
8. `nextBuildFocus` (~line 279-284) — zero production callers (already a tracked debt item in ROADMAP.md's "Season engine — known debt" section: "byte-identical one-line delegations to `selectBuildFocus`... zero production callers left").
9. `pickBuildFocus` (~line 289-294) — same debt item; its one production caller (`backwardScheduleFromEvent`) is updated in Step 6 below to call `selectBuildFocus` directly.

In `SeasonDraftInput` (~line 137-156), remove the now-unused `weeksSinceSeasonBreak` and `weeksSinceLastDeload` optional fields (their doc comments reference the deleted functions).

In `SEASON_CONSTANTS` (~line 22-35), remove the now-unused `loadRampPct`, `horizonPeriods`, `arcWeeks`, `transitionEveryLoadingWeeks` keys. Before deleting each, run `grep -n "SEASON_CONSTANTS\.\(loadRampPct\|horizonPeriods\|arcWeeks\|transitionEveryLoadingWeeks\)" lib/*.ts app/**/*.ts` to confirm zero remaining references outside `season.ts`/`season.test.ts` — if any turns up in a file not touched by this plan, stop and leave that specific key in place, noting it in the commit message. Keep `deloadEveryWeeks`/`deloadTightEveryWeeks` (used by `planRecoveryWeeks`), `weeks`/`split` (used by `backwardScheduleFromEvent`), `peakWeeks`/`taperWeeks` (used by `backwardScheduleFromEvent`), `retestEveryWeeks` (used by `formatRetestNote`), and `transitionWeeks` (still used by `backwardScheduleFromEvent`'s tail — confirm with the same grep pattern before deciding; if `backwardScheduleFromEvent` doesn't reference it, remove it too).

- [ ] **Step 6: Update `backwardScheduleFromEvent` to call `selectBuildFocus` directly**

In `lib/season.ts`, inside `backwardScheduleFromEvent`'s backward-fill loop (~line 474), change:

```ts
      const focus = pickBuildFocus(input.limiter, chosen);
```

to:

```ts
      const focus = selectBuildFocus(input.limiter, chosen);
```

Update the function's own doc comment where it references `pickBuildFocus` if it does (check the comment block above the loop, ~line 465-472) to say `selectBuildFocus` instead.

- [ ] **Step 7: Delete the now-obsolete describe blocks in `lib/season.test.ts`**

Delete these `describe` blocks entirely (search by the exact header string given — do not delete by line number, since earlier tasks in this plan already shifted line numbers):

1. `describe("draftSeasonArc — Mode-C", () => {` — **before deleting**, run `grep -n "describe(\"selectBuildFocus\|describe(\"scoreFocusCandidates" lib/season.test.ts`. If no dedicated block for `selectBuildFocus`'s "confident-limiter-wins" / "LRU-fallback-reaches-all-four-systems" / "never-repeats-back-to-back" behavior already exists elsewhere in the file, port the four `nextBuildFocus`-based tests in this block (lines starting `it("picks the weakest system first...`, `it("never repeats a focus back-to-back"...`, `it("confident-limiter rotation eventually surfaces every build focus...`, `it("REGRESSION: the fallback is least-recently-used...`) into a new `describe("selectBuildFocus — LRU + limiter-weighted build selection", ...)` block first, replacing every `nextBuildFocus(...)` call with `selectBuildFocus(...)` (identical signature and behavior — this is a pure rename). Then delete the whole `"draftSeasonArc — Mode-C"` block, including its `needsBaseGate` tests and the two `draftSeasonArc(...)`-calling tests at the end.
2. `describe("load envelope", () => {` — tested `assignLoadTargets`, deleted.
3. `describe("deload cadence — rolling calendar weeks across period boundaries", () => {` — tested `applyDeloadCadence`; Task 3's `planRecoveryWeeks` tests supersede it.
4. `describe("draftSeasonArc — scored coverage selection (replaces the two-state/LRU selector)", () => {` — tests the rolling loop's multi-slot extrapolation, which no longer exists on the generation path (moves to the roadmap-preview plan's `projectSeasonOutlook`, the surviving multi-slot-loop consumer — **do not** try to port these here; leave a one-line comment where the block used to be noting they're re-verified against `projectSeasonOutlook` in the follow-up plan, or simply delete without a stub if this file's convention doesn't use marker comments for future work — check a few other places in this file for precedent before deciding).
5. `describe("bounded emphasis arcs (8–12 wk)", () => {` — arc-cap concept + `weeksSinceBase`, both deleted.
6. `describe("season-break clock", () => {` — `weeksSinceSeasonBreak`, deleted.
7. `describe("genuine season break (phase transition) in the draft", () => {` — rolling-mode transition drafting, deleted.
8. `describe("deload-cadence clock (HR-22, 2026-07-17 hostile review)", () => {` — `weeksSinceLastDeload`, deleted.
9. `describe("transition-period load & cadence handling", () => {` — `assignLoadTargets`/`applyDeloadCadence`, both deleted.

In `describe("event-anchored mode (dormant until an A-event exists)", () => {` (KEEP this block — it tests `backwardScheduleFromEvent`, which survives), delete only the two secondary assertions that call the now-removed `draftSeasonArc` (`it("draftSeasonArc routes to the event scheduler only for a future A-event"...)` — delete this whole `it`, it's redundant with `backwardScheduleFromEvent`'s own direct tests elsewhere in the same block; and inside `it("never applies deload cadence to the event-anchored tail...")`, delete only the trailing `// Also verify via draftSeasonArc's routing...` lines and their `routed = draftSeasonArc(...)` assertions, keeping the rest of that test intact).

In `describe("pickBuildFocus — LRU + limiter-weighted build selection", () => {` (if this survived Step 5's port as a distinct block from the new `selectBuildFocus` one — check for duplication), rename every `pickBuildFocus(` call to `selectBuildFocus(` and rename the describe title to `"selectBuildFocus — LRU + limiter-weighted build selection (used by chooseNextFocus + backwardScheduleFromEvent)"`. If Step 5 already created a `describe("selectBuildFocus"...)` block covering the same ground, merge instead of leaving two near-duplicate describe blocks.

Update the file's top-of-file import line (currently one giant destructure from `"./season"`) to drop every removed export (`needsBaseGate, weeksSinceBase, nextBuildFocus, pickBuildFocus, draftSeasonArc, applyDeloadCadence, assignLoadTargets, replanSeasonArc, weeksSinceSeasonBreak, weeksSinceLastDeload`) and add every new one (`chooseNextFocus, findUpcomingAEvent, isSeasonFocus, realWeeksSinceLastRecovery, planRecoveryWeeks, formatRecoveryWeeks, settleSeasonHistory, replanEventArc, selectBuildFocus` — several of these may already be imported from earlier tasks in this same plan; only add what's missing).

- [ ] **Step 8: Run the whole file and fix remaining fallout**

Run: `npx vitest run lib/season.test.ts`

Read every remaining failure. Sections of this file not explicitly touched above (`validateFocusMatch`, `validateSeasonFit`, `formatSeasonContext`, `roadmapView`, `suggestedBlockWeeks`, `filterGoalsByFocus`, `labelExposureWeeks`, `periodForDate`/`periodsInRange`) exercise functions that are **unchanged** by this task and should still pass untouched — a failure there means an import-line or fixture-sharing issue introduced by Step 7's surgery, not an intentional behavior change; fix the import/fixture, don't rewrite the assertion.

- [ ] **Step 9: Full gate**

Run: `npm run check`
Expected: 0 tsc errors (confirms no dangling references to deleted exports anywhere in the app, not just this test file), 0 lint errors, all tests pass.

- [ ] **Step 10: Close the ROADMAP debt item + commit**

In `ROADMAP.md`, under "Season engine — known debt", remove the bullet: `` `nextBuildFocus`/`pickBuildFocus` are now byte-identical one-line delegations to `selectBuildFocus`... `` (Step 5/6 above close it — both wrappers are gone, `backwardScheduleFromEvent` calls `selectBuildFocus` directly).

```bash
git add lib/season.ts lib/season.test.ts ROADMAP.md
git commit -m "refactor(season): replace replanSeasonArc/draftSeasonArc with settleSeasonHistory + replanEventArc"
```

---

### Task 5: Rolling-mode formatter + validator (`formatFocusContext`, `validateBlockFocus`)

**Files:**
- Modify: `lib/season.ts`
- Modify: `lib/season.test.ts`

**Interfaces:**
- Consumes: `FocusChoice` (Task 2), `PlannedDay`, `carriesEmbeddedIntensity` (already imported)
- Produces: `formatFocusContext(choice: FocusChoice, objective: string): string`
- Produces: `validateBlockFocus(days: PlannedDay[], focus: SeasonFocus, ftp: number): string[]`

- [ ] **Step 1: Write the failing tests**

Add to `lib/season.test.ts`:

```ts
describe("formatFocusContext (rolling mode — season-continuous-focus-selection §4)", () => {
  it("names the focus and rationale, with an objective prefix when set", () => {
    const line = formatFocusContext({ focus: "threshold", rationale: "rotating the quality focus", scores: [] }, "get faster");
    expect(line).toContain("get faster");
    expect(line).toContain("threshold");
    expect(line).toContain("rotating the quality focus");
    expect(line).toContain("every week shares it");
  });
  it("omits the objective prefix when there is none", () => {
    const line = formatFocusContext({ focus: "vo2max", rationale: "r", scores: [] }, "");
    expect(line.startsWith("BLOCK FOCUS: vo2max")).toBe(true);
  });
});

describe("validateBlockFocus (rolling mode)", () => {
  const day = (date: string, type: PlannedDay["type"], durationMin: number, workoutText = ""): PlannedDay =>
    ({ date, weekNumber: 1, weekTheme: "", name: type, type, durationMin, workoutText, description: "" });

  it("flags a build-focus block with zero matching sessions", () => {
    const days = [day("2026-07-01", "Z2", 90), day("2026-07-03", "Z2", 90)];
    const warnings = validateBlockFocus(days, "vo2max", 250);
    expect(warnings.some((w) => w.includes("vo2max") && w.includes("zero"))).toBe(true);
  });
  it("passes a build-focus block with at least one matching session", () => {
    const days = [day("2026-07-01", "VO2max", 60), day("2026-07-03", "Z2", 90)];
    expect(validateBlockFocus(days, "vo2max", 250)).toEqual([]);
  });
  it("flags an aerobic-base block with too much hard riding time", () => {
    const days = [day("2026-07-01", "Threshold", 60), day("2026-07-03", "Z2", 60)]; // 50% hard by time
    const warnings = validateBlockFocus(days, "aerobic-base", 250);
    expect(warnings.some((w) => w.includes("aerobic-base"))).toBe(true);
  });
  it("passes an aerobic-base block that stays mostly easy", () => {
    const days = [day("2026-07-01", "Threshold", 20), day("2026-07-03", "Z2", 180)]; // ~10% hard by time
    expect(validateBlockFocus(days, "aerobic-base", 250)).toEqual([]);
  });
  it("has no matcher for sharpen — never fires", () => {
    const days = [day("2026-07-01", "Z2", 60)];
    expect(validateBlockFocus(days, "sharpen", 250)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/season.test.ts -t "formatFocusContext|validateBlockFocus"`
Expected: FAIL — neither function exported yet.

- [ ] **Step 3: Implement**

In `lib/season.ts`, add near `formatSeasonContext` (which stays, for event mode):

```ts
// Rolling-mode prompt context (season-continuous-focus-selection §4) — replaces formatSeasonContext
// for the no-upcoming-A-event case. Instruction-shaped, not "you are in phase X": there is no drafted
// period for "wk N of M" to refer to — one focus covers the whole block, every week, full stop (no
// mid-block phase shift, unlike the old period-boundary model).
export function formatFocusContext(choice: FocusChoice, objective: string): string {
  const obj = objective.trim() ? `${objective.trim()} — ` : "";
  return `BLOCK FOCUS: ${obj}${choice.focus} — ${choice.rationale}. Build this block's quality sessions around this focus; every week shares it (no mid-block phase shift).`;
}

// Rolling-mode validator (season-continuous-focus-selection §4) — replaces validateSeasonFit +
// validateFocusMatch for the no-upcoming-A-event case: one block-wide focus, no per-period bucketing,
// no spanDays fairness gate (the whole block belongs to its one chosen focus, so it always gets a fair
// chance). Merges both old checks: a build focus needs >=1 matching session; aerobic-base needs a
// duration-weighted hard-share <= 20%. Mirrors validateFocusMatch's matcher table and
// validateSeasonFit's hard-share math exactly (same thresholds, same "Season fit:" prefix contract).
export function validateBlockFocus(days: PlannedDay[], focus: SeasonFocus, ftp: number): string[] {
  const rides = days.filter((d) => d.type !== "Rest" && d.type !== "Strength");
  if (rides.length === 0) return [];
  const dates = rides.map((d) => d.date).sort();

  if (focus === "aerobic-base") {
    const totalMin = rides.reduce((sum, d) => sum + d.durationMin, 0);
    if (totalMin <= 0) return [];
    const HARD = new Set(["Threshold", "VO2max", "SIT", "RaceSim"]);
    const hardMin = rides.filter((d) => HARD.has(d.type)).reduce((sum, d) => sum + d.durationMin, 0);
    const hardShare = hardMin / totalMin;
    if (hardShare <= 0.2) return [];
    return [`Season fit: ${dates[0]} → ${dates[dates.length - 1]} — this block's focus is aerobic-base, but ${Math.round(hardShare * 100)}% of riding time is hard — expected mostly Z2.`];
  }

  const matchers: Partial<Record<SeasonFocus, { label: string; match: (d: PlannedDay) => boolean }>> = {
    vo2max: { label: "VO2max", match: (d) => d.type === "VO2max" },
    threshold: { label: "Threshold", match: (d) => d.type === "Threshold" },
    anaerobic: { label: "SIT (anaerobic)", match: (d) => d.type === "SIT" },
    durability: {
      label: "durability-loaded Z2 (embedded threshold+ work)",
      match: (d) => (d.type === "Z2" || d.type === "Recovery") && carriesEmbeddedIntensity(d.workoutText, ftp),
    },
  };
  const m = matchers[focus];
  if (!m || rides.some(m.match)) return [];
  return [`Season fit: ${dates[0]} → ${dates[dates.length - 1]} — this block's focus is ${focus} but carries zero ${m.label} sessions.`];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/season.test.ts -t "formatFocusContext|validateBlockFocus"`
Expected: PASS (9 tests).

- [ ] **Step 5: Full gate + commit**

Run: `npm run check`

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "feat(season): formatFocusContext + validateBlockFocus for rolling-mode blocks"
```

---

### Task 6: `lib/season-signals.ts` — shared focus-input assembly

**Files:**
- Create: `lib/season-signals.ts`
- Create: `lib/season-signals.test.ts`

**Interfaces:**
- Consumes: `readAthleteProfile`, `readLastSync`, `readCurrentBlock`, `readBlockHistory`, `readScoreLog`, `readSeasonPlan` (`lib/data-store.ts`), `analyzePowerProfile` (`lib/power-profile.ts`), `buildAthleteModel` (`lib/athlete-model.ts`), `exposureFromSessions`, `execQualityByFocus`, `isSeasonFocus`, `ChooseNextFocusInput` (`lib/season.ts`)
- Produces: `mapSystemToFocus(system: PowerSystem): SeasonFocus` (moved here from `app/api/generate/route.ts`, which had a private duplicate)
- Produces: `gatherFocusInputs(opts?: { blockGoal?: string; weakpoints?: string[]; today?: string }): Promise<ChooseNextFocusInput>`

- [ ] **Step 1: Write the failing test**

Create `lib/season-signals.test.ts`. Mock `lib/data-store.ts` the same way `app/api/generate/route.test.ts` already mocks it (read that file's mock setup first — grep `vi.mock("@/lib/data-store"` in `app/api/generate/route.test.ts` and copy the shape, since `gatherFocusInputs` reads exactly the same functions that file already exercises):

```ts
import { describe, expect, it, vi } from "vitest";
import { gatherFocusInputs, mapSystemToFocus } from "./season-signals";

// Mirror app/api/generate/route.test.ts's data-store mock shape.
vi.mock("@/lib/data-store", () => ({
  readAthleteProfile: vi.fn(async () => ({
    performance: { ftp: 250, weightKg: 75, maxHr: 190, thresholdHr: 170, weeklyHoursMin: 6, weeklyHoursMax: 10 },
    goals: [{ goal: "Raise FTP", target: "300W", focus: "threshold" }],
    weakpoints: [],
    nutrition: { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 75 },
    goalsMigratedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "",
  })),
  readLastSync: vi.fn(async () => null),
  readCurrentBlock: vi.fn(async () => null),
  readBlockHistory: vi.fn(async () => []),
  readScoreLog: vi.fn(async () => ({ entries: [], updatedAt: "" })),
  readSeasonPlan: vi.fn(async () => ({ objective: "get faster", events: [], periods: [], updatedAt: "" })),
}));

describe("mapSystemToFocus", () => {
  it("maps both neuromuscular and anaerobic power systems onto the anaerobic season focus", () => {
    expect(mapSystemToFocus("neuromuscular")).toBe("anaerobic");
    expect(mapSystemToFocus("anaerobic")).toBe("anaerobic");
    expect(mapSystemToFocus("vo2max")).toBe("vo2max");
    expect(mapSystemToFocus("threshold")).toBe("threshold");
  });
});

describe("gatherFocusInputs", () => {
  it("folds the season objective + profile goals into signals.goalText, same as combinedGoalText used to", () => {
    const input = await gatherFocusInputs({ blockGoal: "Build for a fondo", weakpoints: ["climbing"] });
    expect(input.signals.goalText).toContain("get faster");
    expect(input.signals.goalText).toContain("Build for a fondo");
    expect(input.signals.goalText).toContain("climbing");
    expect(input.signals.goalText).toContain("Raise FTP");
  });
  it("defaults limiter to null/low when there's no synced power curve", async () => {
    const input = await gatherFocusInputs();
    expect(input.limiter).toEqual({ system: null, confidence: "low" });
  });
  it("defaults lastFocus to null when there's no current block", async () => {
    const input = await gatherFocusInputs();
    expect(input.lastFocus).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/season-signals.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement**

Create `lib/season-signals.ts`:

```ts
// Shared focus-input assembly (season-continuous-focus-selection §6/§9): the exact signal-gathering
// logic app/api/generate/route.ts already ran inline for chooseNextFocus, extracted so
// app/api/season/route.ts's roadmap-outlook projection (a later plan) can build the identical input
// shape without a second, potentially-drifting copy. Server-only (imports lib/data-store) — never
// import this from a client component.
import { readAthleteProfile, readLastSync, readCurrentBlock, readBlockHistory, readScoreLog, readSeasonPlan } from "./data-store";
import { analyzePowerProfile } from "./power-profile";
import { buildAthleteModel } from "./athlete-model";
import { exposureFromSessions, execQualityByFocus, isSeasonFocus, type ChooseNextFocusInput } from "./season";
import type { PowerSystem, SeasonFocus } from "./types";

// Maps the power-profile's physiological systems onto the season engine's focus vocabulary. Threshold
// maps 1:1; anaerobic covers both neuromuscular and anaerobic (the season arc has no separate sprint
// focus). Moved here from app/api/generate/route.ts (was a private duplicate) — now the one definition
// both the generate route and this shared gatherer use.
export function mapSystemToFocus(system: PowerSystem): SeasonFocus {
  switch (system) {
    case "neuromuscular":
      return "anaerobic";
    case "anaerobic":
      return "anaerobic";
    case "vo2max":
      return "vo2max";
    case "threshold":
      return "threshold";
  }
}

// Assembles chooseNextFocus's full input from real, already-durable data — the single source both
// /api/generate (a real block, with blockGoal/weakpoints) and /api/season GET (a roadmap-only
// projection, neither present) call, so goal-text/exposure/execution assembly can't drift between the
// two the way two independently-hand-rolled copies eventually would (the exact drift class HR-18,
// 2026-07-17 hostile review, closed for durability-template selection).
export async function gatherFocusInputs(
  opts: { blockGoal?: string; weakpoints?: string[]; today?: string } = {}
): Promise<ChooseNextFocusInput> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const [profile, sync, currentBlock, blockHistory, scoreLog, existingSeason] = await Promise.all([
    readAthleteProfile(),
    readLastSync(),
    readCurrentBlock(),
    readBlockHistory(),
    readScoreLog(),
    readSeasonPlan(),
  ]);

  const latestWeight =
    sync?.wellness.filter((w) => w.weightKg !== null).sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ??
    profile.performance.weightKg;
  const powerProfile = analyzePowerProfile(sync?.powerCurveAllTime ?? sync?.powerCurve ?? [], profile.performance.ftp, latestWeight);
  const limiter = powerProfile?.easyWin
    ? { system: mapSystemToFocus(powerProfile.easyWin.system), confidence: powerProfile.confident ? ("high" as const) : ("low" as const) }
    : { system: null, confidence: "low" as const };

  const combinedGoalText = [
    existingSeason.objective,
    opts.blockGoal ?? "",
    ...(opts.weakpoints ?? []),
    ...profile.goals.map((g) => `${g.goal} ${g.target}`),
    ...profile.weakpoints.map((w) => `${w.weakpoint} ${w.detail}`),
  ].join(" \n ");

  const athleteModel = buildAthleteModel(scoreLog.entries);
  const lastFocus = isSeasonFocus(currentBlock?.seasonFocus) ? currentBlock.seasonFocus : null;

  return {
    limiter,
    lastFocus,
    signals: {
      goalText: combinedGoalText,
      exposure: exposureFromSessions(
        [...(currentBlock?.days ?? []), ...blockHistory.flatMap((h) => h.days ?? [])].filter((d) => d.date <= today),
        profile.performance.ftp,
        today
      ),
      execQuality: execQualityByFocus(athleteModel),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/season-signals.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Full gate + commit**

Run: `npm run check`

```bash
git add lib/season-signals.ts lib/season-signals.test.ts
git commit -m "feat(season): extract gatherFocusInputs + mapSystemToFocus into a shared module"
```

---

### Task 7: Wire it into `/api/generate`

**Files:**
- Modify: `app/api/generate/route.ts`
- Modify: `app/api/generate/route.test.ts`

**Interfaces:**
- Consumes: `gatherFocusInputs`, `mapSystemToFocus` (Task 6), `chooseNextFocus`, `findUpcomingAEvent`, `isSeasonFocus`, `realWeeksSinceLastRecovery`, `planRecoveryWeeks`, `formatRecoveryWeeks`, `formatFocusContext`, `validateBlockFocus`, `settleSeasonHistory`, `replanEventArc`, `periodForDate`, `addWeeks`, `formatRetestNote` (new signature), `SEASON_SHAPES_GENERATION` (all `lib/season.ts` / `lib/season-signals.ts`)
- Produces: `GeneratedPlan.seasonFocus?: SeasonFocus`, `GeneratedPlan.seasonFocusRationale?: string` (added to `lib/types.ts` in this task)

- [ ] **Step 1: Add the two fields to `GeneratedPlan`**

In `lib/types.ts`, extend the `GeneratedPlan` interface (right after `durabilityTemplate?: string;`, ~line 205):

```ts
  // Season-architecture-redesign §4: the rolling-mode focus chosen at generation time (chooseNextFocus),
  // carried through so /api/write can stamp CurrentBlock.seasonFocus without recomputing it against
  // different "as of" data. Absent for an event-anchored block (that path keeps its own persisted
  // period lookup) and for plans generated before this shipped — truthy-check, never `=== null`.
  seasonFocus?: SeasonFocus;
  seasonFocusRationale?: string;
```

Add `SeasonFocus` to this file's existing type imports if not already present (it's defined further down in the same file, so no import needed — it's a same-file type reference).

- [ ] **Step 2: Write the failing integration tests**

Add to `app/api/generate/route.test.ts`, in whatever section already covers the season-replan behavior (grep `season` in that file first to find the right `describe` block and its existing mock setup for `lib/season`/`lib/data-store`):

```ts
it("stamps GeneratedPlan.seasonFocus + seasonFocusRationale in rolling mode (no upcoming A-event)", async () => {
  // Arrange: existingSeason.events has no A-priority event; mock readSeasonPlan/readSeasonPlan-adjacent
  // calls accordingly (follow this file's existing mock pattern for readSeasonPlan/writeSeasonPlan).
  const res = await POST(buildRequest({ /* ...standard valid blockParams body, per this file's existing helper... */ }));
  const { plan } = await res.json();
  expect(plan.seasonFocus).toBeDefined();
  expect(plan.seasonFocusRationale).toBeDefined();
});

it("does not stamp seasonFocus for an event-anchored block", async () => {
  // Arrange: existingSeason.events includes a future A-priority event.
  const res = await POST(buildRequest({ /* ...body, with the season mock set to include an A-event... */ }));
  const { plan } = await res.json();
  expect(plan.seasonFocus).toBeUndefined();
});

it("injects no season/recovery prompt text while SEASON_SHAPES_GENERATION is false (unchanged default)", async () => {
  // This mirrors whatever existing test already asserts the system prompt excludes "SEASON CONTEXT"/
  // "BLOCK FOCUS"/"RECOVERY:" while the flag is off — extend it to also assert no "RECOVERY:" line,
  // rather than writing a wholly new test if one already exists for the seasonContext exclusion.
});
```

Fill in the exact request-building/mock helpers using this test file's established conventions (it already has season-adjacent tests from the block-generation-fidelity plan — follow those, don't invent a new mocking shape).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run app/api/generate/route.test.ts -t "seasonFocus"`
Expected: FAIL — `plan.seasonFocus` is `undefined` in both cases (not wired yet).

- [ ] **Step 4: Implement**

In `app/api/generate/route.ts`:

Replace the import line (~line 40):

```ts
import { achievedTssForPeriod, addWeeks, chooseNextFocus, findUpcomingAEvent, formatFocusContext, formatRecoveryWeeks, formatRetestNote, formatUpcomingEventsForBlock, isSeasonFocus, periodForDate, planRecoveryWeeks, realWeeksSinceLastRecovery, replanEventArc, SEASON_SHAPES_GENERATION, settleSeasonHistory, validateBlockFocus, validateFocusMatch, validateSeasonFit, formatSeasonContext } from "@/lib/season";
import { gatherFocusInputs } from "@/lib/season-signals";
```

Delete the private `mapSystemToFocus` function (~line 49-60) — it now lives in `lib/season-signals.ts` (Task 6) and is consumed indirectly via `gatherFocusInputs`; this route no longer needs its own copy since `combinedGoalText`/`limiter` construction moves into `gatherFocusInputs` too (next edit).

Replace the `combinedGoalText` construction (~line 219-225) with a single call to `gatherFocusInputs`, placed where `combinedGoalText` used to be built (still before `selectDurabilityTemplate`, which consumes it):

```ts
    const focusInputs = await gatherFocusInputs({ blockGoal: blockParams.goal, weakpoints: blockParams.weakpoints, today });
    const combinedGoalText = focusInputs.signals.goalText ?? "";
```

Replace the entire season-replan `try { ... } catch { ... }` block (~line 242-297) with:

```ts
    // Season (season-continuous-focus-selection): rolling blocks get a fresh, stateless focus choice
    // every call (chooseNextFocus) instead of a drafted period sequence; a future A-event keeps the
    // existing persisted, backward-scheduled build→peak→taper arc. Best-effort — a failure here must
    // never block generation.
    let seasonContext = "";
    let recoveryContext = "";
    let upcomingEventsContext = "";
    let replannedSeason: import("@/lib/types").SeasonPlan | null = null;
    let rollingFocusChoice: import("@/lib/season").FocusChoice | null = null;
    let aEventForBlock: import("@/lib/types").SeasonEvent | null = null;
    let recoveryWeekIndices: number[] = [];
    try {
      const achievedTssFor = (p: import("@/lib/types").FocusPeriod) => achievedTssForPeriod(scoreLog.entries, p);
      aEventForBlock = findUpcomingAEvent(existingSeason.events, today);

      // §5 recovery hard cap — computed once, shared by both branches (it applies to a rolling block
      // AND the build stretch leading into an event; peak/taper keep their own load-shaping untouched).
      const avgWeeklyTss = baselines.avgTss90d != null ? baselines.avgTss90d * 7 : null;
      const weeksSinceRecovery = realWeeksSinceLastRecovery(scoreLog.entries, avgWeeklyTss, today);
      const allRecoveryIndices = planRecoveryWeeks(weeksSinceRecovery, blockParams.lengthWeeks, !!(signals.loadRamp?.triggered));

      if (aEventForBlock) {
        replannedSeason = replanEventArc(
          existingSeason,
          aEventForBlock,
          {
            objective: existingSeason.objective, events: existingSeason.events,
            ctl: sync?.fitness.ctl ?? null, ftp: profile.performance.ftp,
            recentWeeklyTss: baselines.avgTss90d != null ? Math.round(baselines.avgTss90d * 7) : null,
            limiter: focusInputs.limiter, recentFocuses: [], heavyFatigue: !!(signals.loadRamp?.triggered),
          },
          achievedTssFor,
          today
        );
        // Peak/taper hold their own deliberate load-shaping — never overlay the generic recovery cap there.
        recoveryWeekIndices = allRecoveryIndices.filter((wk) => {
          const weekStart = addWeeks(blockParams.startDate, wk);
          const period = periodForDate(replannedSeason as import("@/lib/types").SeasonPlan, weekStart);
          return period ? period.phase === "build" || period.phase === "base" : true;
        });
      } else {
        replannedSeason = settleSeasonHistory(existingSeason, achievedTssFor, today);
        recoveryWeekIndices = allRecoveryIndices;
        // Tracked underneath the flag, same as season-plan.json itself (SEASON_SHAPES_GENERATION only
        // gates the prompt/validator opinion, never the tracking) — chooseNextFocus always runs so
        // GeneratedPlan.seasonFocus (write-time provenance) and the next call's no-back-to-back rule
        // both stay live regardless of the flag.
        rollingFocusChoice = chooseNextFocus(focusInputs);
      }
      await writeSeasonPlan(replannedSeason);

      const blockEnd = weeks[weeks.length - 1][weeks[weeks.length - 1].length - 1];
      const upcomingEventsLine = formatUpcomingEventsForBlock(existingSeason.events, { startDate: blockParams.startDate, endDate: blockEnd });
      if (upcomingEventsLine) upcomingEventsContext = `\n${upcomingEventsLine}`;

      if (SEASON_SHAPES_GENERATION) {
        if (aEventForBlock) {
          const line = formatSeasonContext(replannedSeason, today, { startDate: blockParams.startDate, endDate: blockEnd });
          if (line) seasonContext = `\n${line}`;
        } else if (rollingFocusChoice) {
          seasonContext = `\n${formatFocusContext(rollingFocusChoice, existingSeason.objective)}`;
        }
        const recoveryLine = formatRecoveryWeeks(recoveryWeekIndices, blockParams.lengthWeeks);
        if (recoveryLine) recoveryContext = `\n${recoveryLine}`;
      }
    } catch (err) {
      logWarn("/api/generate", "season-replan", err instanceof Error ? err.message : String(err)); // best-effort
    }
```

Replace the retest-note block (~line 289-297) with:

```ts
    // Retest cadence: a stale tested FTP quietly rots zones and TSS math — nudge the generator to place
    // a retest in the next lighter week. Additive to seasonContext. Temporarily disabled with the rest
    // of the phase-derived context (SEASON_SHAPES_GENERATION).
    if (SEASON_SHAPES_GENERATION && physStore) {
      const ftpStaleDays = Math.floor((Date.parse(today) - Date.parse(physStore.current.effectiveFrom)) / 86_400_000);
      const retestNote = formatRetestNote(Number.isFinite(ftpStaleDays) ? ftpStaleDays : null, recoveryWeekIndices, blockParams.startDate);
      if (retestNote) seasonContext += `\n${retestNote}`;
    }
```

In the `buildSystemPrompt` call (~line 319-324), add `recoveryContext` to the joined dynamic string:

```ts
    const { cached, dynamic } = buildSystemPrompt(
      kbContext,
      seedsContext + reflectionsContext + stateContext + directivesContext + quirkContext + powerProfileContext + formFuelContext + sessionReqContext + durabilityContext + deferredContext + goalsContext + weakpointsContext + seasonContext + recoveryContext + upcomingEventsContext,
      buildAthleteDataSection(profile, sync, zonesText),
      blockParams
    );
```

Replace the two season-validator lines (~line 385-388):

```ts
    if (SEASON_SHAPES_GENERATION && replannedSeason) {
      if (aEventForBlock) {
        warnings.push(...validateSeasonFit(days, replannedSeason, profile.performance.ftp));
        warnings.push(...validateFocusMatch(days, replannedSeason, profile.performance.ftp));
      } else if (rollingFocusChoice) {
        warnings.push(...validateBlockFocus(days, rollingFocusChoice.focus, profile.performance.ftp));
      }
    }
```

Update the `GeneratedPlan` literal (~line 395-405) to stamp the rolling choice:

```ts
    const plan: GeneratedPlan = {
      overview,
      days,
      warnings,
      ...(protocol.violations.length > 0 ? { protocolViolations: protocol.violations } : {}),
      raw: rawForAudit,
      blockParams,
      model: GENERATION_MODEL,
      promptVersion: PROMPT_VERSION,
      durabilityTemplate: durability.id,
      ...(rollingFocusChoice ? { seasonFocus: rollingFocusChoice.focus, seasonFocusRationale: rollingFocusChoice.rationale } : {}),
    };
```

Remove the now-unused `PowerSystem` import if `mapSystemToFocus`'s deletion leaves it unused (check the `import type { BlockParams, GeneratedPlan, PowerSystem, SeasonFocus } from "@/lib/types";` line, ~line 42) — `SeasonFocus` is still needed for the inline type usages above; `PowerSystem` likely isn't anymore.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/api/generate/route.test.ts`
Expected: PASS — including the new tests and every pre-existing test in this file (the flag stays `false`, so every existing assertion about prompt content / warnings should be unaffected; if any existing test asserted something about `replanSeasonArc`-specific mock call shapes, update the mock target name to `settleSeasonHistory`/`replanEventArc` per which branch that test's fixture routes through).

- [ ] **Step 6: Full gate + commit**

Run: `npm run check`

```bash
git add app/api/generate/route.ts app/api/generate/route.test.ts lib/types.ts
git commit -m "feat(generate): wire chooseNextFocus + recovery hard cap into rolling-mode generation"
```

---

### Task 8: `/api/write` reads the stamped focus instead of re-deriving it

**Files:**
- Modify: `lib/types.ts` (`BlockHistoryEntry.seasonFocus`)
- Modify: `app/api/write/route.ts`
- Modify: `app/api/write/route.test.ts`
- Modify: `app/api/retrospective/route.ts`
- Modify: `app/api/sync/route.ts` (the `DELETE` handler's `appendBlockHistory` call)

**Interfaces:**
- Produces: `BlockHistoryEntry.seasonFocus?: SeasonFocus`
- Changes: `CurrentBlock.seasonFocus`/`seasonPhase` stamping logic in `app/api/write/route.ts`

- [ ] **Step 1: Add `BlockHistoryEntry.seasonFocus`**

In `lib/types.ts`, extend `BlockHistoryEntry` (right after `durabilityTemplate?: string; // Track B...`, ~line 450):

```ts
  // Season-architecture-redesign §8: carries forward whatever focus/phase the archived block itself
  // was stamped with (CurrentBlock.seasonFocus) — a self-contained record for the selector's exposure
  // signal and future scorer weighting, without a separate cross-reference. Absent on entries archived
  // before this field existed, or when the block predates season-focus stamping entirely.
  seasonFocus?: SeasonFocus;
```

- [ ] **Step 2: Write the failing tests**

Add to `app/api/write/route.test.ts`:

```ts
it("stamps CurrentBlock.seasonFocus/seasonPhase from GeneratedPlan.seasonFocus when present (rolling mode)", async () => {
  const body = {
    plan: {
      overview: "", seasonFocus: "threshold", seasonFocusRationale: "rotating the quality focus",
      blockParams: { lengthWeeks: 2, goal: "g", startDate: "2026-07-20", weakpoints: [] },
      days: [{ date: "2026-07-20", name: "Threshold", type: "Threshold", durationMin: 60, workoutText: "", description: "" }],
    },
  };
  const req = new Request("http://localhost/api/write", { method: "POST", body: JSON.stringify(body) });
  const res = await POST(req);
  const { currentBlock } = await res.json();
  expect(currentBlock.seasonFocus).toBe("threshold");
  expect(currentBlock.seasonPhase).toBe("build");
});

it("stamps seasonPhase 'base' when the rolling focus is aerobic-base", async () => {
  const body = {
    plan: {
      overview: "", seasonFocus: "aerobic-base", seasonFocusRationale: "r",
      blockParams: { lengthWeeks: 2, goal: "g", startDate: "2026-07-20", weakpoints: [] },
      days: [{ date: "2026-07-20", name: "Z2", type: "Z2", durationMin: 90, workoutText: "", description: "" }],
    },
  };
  const req = new Request("http://localhost/api/write", { method: "POST", body: JSON.stringify(body) });
  const res = await POST(req);
  const { currentBlock } = await res.json();
  expect(currentBlock.seasonPhase).toBe("base");
});

it("falls back to the period lookup when GeneratedPlan carries no seasonFocus (event mode / pre-upgrade plans)", async () => {
  // Arrange: mock readSeasonPlan to return a plan whose periods cover dates[0] with focus "vo2max"/phase "build".
  const body = {
    plan: {
      overview: "", // no seasonFocus field
      blockParams: { lengthWeeks: 2, goal: "g", startDate: "2026-07-20", weakpoints: [] },
      days: [{ date: "2026-07-20", name: "VO2max", type: "VO2max", durationMin: 60, workoutText: "", description: "" }],
    },
  };
  const req = new Request("http://localhost/api/write", { method: "POST", body: JSON.stringify(body) });
  const res = await POST(req);
  const { currentBlock } = await res.json();
  expect(currentBlock.seasonFocus).toBe("vo2max"); // from the mocked period lookup, not the plan
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run app/api/write/route.test.ts -t "seasonFocus|seasonPhase"`
Expected: FAIL — current code always uses the `currentPeriod` lookup, ignoring `plan.seasonFocus`.

- [ ] **Step 4: Implement**

In `app/api/write/route.ts`, replace the season-stamping lines (~line 117-121):

```ts
  const dates = plan.days.map((d) => d.date).sort();
  const ftp = (await readAthleteProfile()).performance.ftp;
  // Season-architecture-redesign §4/§8: a rolling-mode plan already carries the focus chooseNextFocus
  // picked at GENERATION time — use it directly rather than re-deriving via a period lookup (which
  // would consult different "as of" data at write time and could disagree). An event-anchored plan (or
  // one generated before this field existed) carries no seasonFocus, so it falls back to the original
  // period lookup by the block's own startDate.
  const seasonPeriod = plan.seasonFocus ? null : currentPeriod(await readSeasonPlan(), dates[0]);
```

Replace the `currentBlock` literal's season-stamp spread (~line 134):

```ts
    ...(plan.seasonFocus
      ? { seasonFocus: plan.seasonFocus, seasonPhase: plan.seasonFocus === "aerobic-base" ? "base" : "build" }
      : seasonPeriod
        ? { seasonFocus: seasonPeriod.focus, seasonPhase: seasonPeriod.phase }
        : {}),
```

In the existing-block archive call (`appendBlockHistory`, ~line 98-113), add the carry-forward stamp:

```ts
    await appendBlockHistory({
      id: existing.createdAt,
      goal: existing.goal,
      startDate: existing.startDate,
      endDate: existing.endDate,
      lengthWeeks: existing.lengthWeeks,
      overview: existing.overview,
      createdAt: existing.createdAt,
      model: existing.model,
      promptVersion: existing.promptVersion,
      durabilityTemplate: existing.durabilityTemplate,
      ...(existing.seasonFocus && isSeasonFocus(existing.seasonFocus) ? { seasonFocus: existing.seasonFocus } : {}),
      days: truncateBlockDays(existing.days, utcToday()),
    });
```

Add the import: `import { currentPeriod, isSeasonFocus } from "@/lib/season";` (replacing the existing `import { currentPeriod } from "@/lib/season";` line).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/api/write/route.test.ts`
Expected: PASS.

- [ ] **Step 6: Carry the stamp forward in the other two `appendBlockHistory` call sites**

In `app/api/retrospective/route.ts`, in the `historyEntry` literal (~line 242-263), add:

```ts
    ...(block.seasonFocus && isSeasonFocus(block.seasonFocus) ? { seasonFocus: block.seasonFocus } : {}),
```

Add the import: `import { isSeasonFocus } from "@/lib/season";`.

In `app/api/sync/route.ts`'s `DELETE` handler, in the `appendBlockHistory` literal (~line 814-826), add:

```ts
        ...(block.seasonFocus && isSeasonFocus(block.seasonFocus) ? { seasonFocus: block.seasonFocus } : {}),
```

Add `isSeasonFocus` to this file's existing `@/lib/season` import (currently `import { currentPeriod } from "@/lib/season";`).

- [ ] **Step 7: Write one test per additional call site**

Add to `app/api/retrospective/route.test.ts`:

```ts
it("carries seasonFocus forward onto the archived history entry", async () => {
  // Arrange: mock readCurrentBlock to return a block with seasonFocus: "durability".
  // ...call POST()...
  // Assert appendBlockHistory was called with an entry containing seasonFocus: "durability".
});
```

Add to `app/api/sync/route.test.ts` (near the existing `DELETE` handler tests):

```ts
it("carries seasonFocus forward when archiving a discarded block", async () => {
  // Arrange: mock readCurrentBlock to return a block with seasonFocus: "vo2max".
  // ...call DELETE()...
  // Assert appendBlockHistory was called with an entry containing seasonFocus: "vo2max".
});
```

Fill in each using the respective file's existing mock conventions for `readCurrentBlock`/`appendBlockHistory`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run app/api/retrospective/route.test.ts app/api/sync/route.test.ts -t "seasonFocus"`
Expected: PASS.

- [ ] **Step 9: Full gate + commit**

Run: `npm run check`

```bash
git add lib/types.ts app/api/write/route.ts app/api/write/route.test.ts app/api/retrospective/route.ts app/api/retrospective/route.test.ts app/api/sync/route.ts app/api/sync/route.test.ts
git commit -m "feat(write): stamp CurrentBlock.seasonFocus from GeneratedPlan, carry it into block history"
```

---

### Task 9: Whole-plan verification

- [ ] **Step 1: Full gate**

Run: `npm run check`
Expected: 0 tsc errors, 0 lint errors, all tests pass (existing suite + every test added across Tasks 1-8).

- [ ] **Step 2: Confirm the flag-off invariant**

Run: `grep -n "SEASON_SHAPES_GENERATION" lib/season.ts app/api/generate/route.ts` — confirm it's still `false` in `lib/season.ts` and every new prompt-injection/validator call added in Task 7 is gated behind it.

- [ ] **Step 3: Confirm zero dangling references to deleted exports**

Run: `grep -rn "draftSeasonArc\|replanSeasonArc\|needsBaseGate\|weeksSinceBase\b\|applyDeloadCadence\|weeksSinceSeasonBreak\|weeksSinceLastDeload\|assignLoadTargets\|nextBuildFocus\|pickBuildFocus" --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules`

Expected: no matches (the `npm run check` tsc pass in Step 1 already guarantees this for compiled code, but this catches any stray reference in a comment/doc that's now misleading — fix any found in code comments, e.g. `README.md`, `ROADMAP.md`, or doc comments inside `lib/*.ts` that still narrate the old mechanism).

- [ ] **Step 4: Manual generate/write smoke check (not a live LLM call — the flag stays off)**

Run a real `npm run dev` generate + write against local data (the athlete's real `data/` files) for a rolling-mode block (no upcoming A-event in `data/season-plan.json`). Confirm via the API response / `data/current-block.json` that `currentBlock.seasonFocus` is now populated with a real `SeasonFocus` value and `seasonPhase` is `"base"` or `"build"` — this exercises the whole chooseNextFocus → GeneratedPlan.seasonFocus → CurrentBlock.seasonFocus chain end-to-end against real data, even though the athlete-visible prompt/warnings stay unchanged (flag off).

```bash
node -e "const b = require('./data/current-block.json'); console.log(b.seasonFocus, b.seasonPhase)"
```

- [ ] **Step 5: Update ROADMAP.md**

Under "Season engine — known debt", update the top framing paragraph: the rolling-mode engine described there (arc caps, deload cadence, transitions) has been replaced by `chooseNextFocus` + the real-data recovery hard cap; leave the "Season is currently NOT shaping or gating block generation" note as-is (still true — the flag stays off until the roadmap-preview plan flips it), but strike the tracked-debt bullets that named now-deleted functions/concepts (arc caps, `nextBuildFocus`/`pickBuildFocus` — already closed in Task 4/Step 10 — and the old `applyDeloadCadence`-cadence-math note, now moot by construction rather than by a prior fix). Leave the event-mode-specific debt bullets (event path bypasses the macro layer, peak/taper "sharpen" color collision, `formatRetestNote`'s "best slot" label on the event path, `GeneratedPlan.protocolViolations` not persisted — closed by the block-history-enrichment plan if that's landed first, check before editing) untouched or updated only if this plan's changes directly affect them.

```bash
git add ROADMAP.md
git commit -m "docs(roadmap): reflect the continuous-focus-selection engine replacing the rolling arc"
```
