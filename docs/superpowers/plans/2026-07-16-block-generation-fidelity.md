# Block-Generation Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five concrete defects surfaced by the athlete's first real generation on the redesigned season/coverage-selector engine (2026-07-16): (1) a genuine deload-cadence bug that fires roughly every 3 weeks instead of every ~4, (2) a workout-duration self-inconsistency that makes NodeVelo's displayed hours disagree with what Intervals.icu actually shows, (3) a missing precedence rule that lets the season's rotating phase silently override the athlete's stated goal, (4) a durability-template selector that only listens for detected weaknesses and never for the athlete's stated goal text, and (5) real B/C-priority events that are stored but never surfaced into generation, so a planned test day gets overwritten with a generic session.

**Architecture:** All five fixes land as scoped, deterministic changes inside the EXISTING season/generation architecture — no period, phase, or rotation concept is added, removed, or redesigned. The athlete has separately and explicitly flagged a deeper question (whether the fixed phase-sequence model itself, e.g. always prescribing an aerobic-base phase regardless of a rider's existing base fitness, is the right model) as its own dedicated future research effort, NOT part of this plan. Every task here treats periods, phases, and the scored coverage selector as a fixed substrate.

- **Task 1** (`lib/season.ts`) fixes `applyDeloadCadence`'s threshold math — it currently trips on almost every period (each ≥3 weeks) because the threshold (`every - 1` = 3) is smaller than a single period's own length. Dropping the `-1` makes the cadence genuinely accumulate across period boundaries: a 3-week period alone no longer self-trips, and consecutive short periods correctly combine before the next deload fires.
- **Task 2** (`lib/prescription.ts`, `lib/workout-validate.ts`, `lib/anthropic-prompts.ts`) adds a new pure `totalPrescribedMinutes` function (a sibling to the existing work-only `parsePrescription`, sharing its repeat-block/duration-token parsing but summing EVERY step — warmup, main, cooldown — the same way Intervals.icu's own step-parser would), and a new `validateDurationConsistency` check wired into the existing `splitPlanProtocol`/`GeneratedPlan.protocolViolations` category Plan 4 already shipped. Mirrors an established pattern instead of inventing a new one.
- **Task 3** (`lib/anthropic-prompts.ts`) adds one explicit precedence rule reconciling the season's macro-phase context against the athlete's stated block/season goal text, so the model has a rule to follow instead of two unweighted instructions.
- **Task 4** (`lib/durability.ts`, `app/api/generate/route.ts`) lets goal/season-objective text bias durability-template selection (today it is 100% insight-driven), without breaking the existing insight-first precedence or the block-to-block rotation fallback.
- **Task 5** (`lib/season.ts`, `app/api/generate/route.ts`) surfaces B/C-priority events that fall inside the block's date range into the generation prompt as a protected day, without touching the A-priority event-anchored backward-scheduling path at all.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest, Anthropic SDK.

> **Amendment (2026-07-16, athlete decision, made before execution began):** Season is to be
> **temporarily disabled from shaping or gating block generation** — the fixed phase-sequence model
> itself is under separate, deferred review (see ROADMAP.md "Season architecture doubt": whether
> always prescribing a phase sequence regardless of a rider's existing base is even the right model).
> This directly conflicts with **Task 3** below, whose entire point is a prompt rule reconciling goal
> text against season-phase text shown to the model — moot once that phase text is no longer shown.
> Resolution: **Task 3 is SKIPPED** (marked below, not deleted — the reasoning stays for whenever
> season is revisited). A **new Task 6** implements the disable itself: season state keeps being
> tracked in the background (`replanSeasonArc` still runs, `season-plan.json` still updates, Task 5's
> B/C-event surfacing still injects — those are calendar facts, not phase opinion) behind one named,
> reversible flag; only the phase-derived prompt text and the two season-fit/focus-match validators
> are switched off. The original Task 6 (integration + live smoke run) is renumbered **Task 7**, with
> its checklist adjusted accordingly. Tasks 1, 2, 4, 5 are unaffected in scope — Task 1 fixes
> `season.ts`'s own math (still correct regardless of whether the output is shown to the model), and
> Tasks 4/5 read the athlete's stated objective/events, not phase logic.

## Global Constraints

- Use `localToday()` / `resolveToday()` for user-facing "what day is it" logic — never inline UTC date math for that specific question. (No task here computes "today" fresh; all consume an already-resolved date.)
- This plan is written against `lib/season.ts` / `lib/anthropic-prompts.ts` / `lib/durability.ts` / `lib/workout-validate.ts` / `lib/prescription.ts` as they exist after the 2026-07-15 four-plan season redesign and the two live-feedback fixes already shipped today (`d62bf5c` deload-week wording, `40e852c` RaceSim escalating-effort rewrite). Re-read the live file before finalizing line numbers if this plan sits unexecuted for long — a concurrent session may touch these files.
- Do NOT touch the season phase-sequence model itself: no new phase, no change to what triggers a new period, no change to `SEASON_CONSTANTS.weeks`, no change to `scoreFocusCandidates`/`selectBuildFocus`. If any task's natural implementation would require this, STOP and flag it to the human — do not decide it yourself.
- Guard any new `fooMigratedAt`-style field with a truthy check, never `=== null`. New optional fields follow the sparse-field convention (spread in only when present, e.g. `...(x ? { x } : {})`).
- Run everything with `npm` (`npm test` = `vitest run`; full gate = `npm run check` = `tsc --noEmit && eslint && vitest run`).
- Commit on `main`, small and atomic; stage ONLY the files you touched (`git add <path>...`, never `git add -A`) — a concurrent agent session shares this checkout. End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do not pin test fixtures whose pre-rounding value sits on a `.x5` float boundary (repo memory: IEEE rounding flips them).
- Per this repo's AGENTS.md: any task that changes the generation prompt requires one live smoke run before being called done. Tasks 2 (partially), 5, and 6 (route.ts's prompt-assembly, not `lib/anthropic-prompts.ts`) touch what reaches the model; Task 3 is skipped (would have touched `lib/anthropic-prompts.ts` but is moot). Task 7 is the integration task that runs the mandatory live check covering all of them at once.
- A PRE-EXISTING test in `lib/season.test.ts` (`describe("deload cadence", ...)`, the `"tightens to 2:1 under heavy fatigue"` test) is built on the same flawed premise Task 1 fixes — its current pinned expectation is WRONG relative to real periodization math, not a compatibility contract to preserve. Task 1 explicitly supersedes it with corrected values.

---

### Task 1: Rolling calendar-week deload cadence

`applyDeloadCadence` (`lib/season.ts`) accumulates whole period lengths and fires as soon as the running total crosses `threshold = every - 1`. Since every KB-default period is already ≥3 weeks (`SEASON_CONSTANTS.weeks`: aerobic-base 3, threshold 4, vo2max 4, anaerobic 3, durability 3), and the loose-cadence threshold is 3, a SINGLE period always trips the boundary on its own first accumulation — producing a deload at the end of almost every period (confirmed live: 5 of 6 currently-drafted season periods carry `deloadWeek: true`) instead of a genuine "every ~4 calendar weeks" cadence. A real 6-week block generated today landed deloads in week 2 (aerobic-base's own 3-week span alone exceeded the loose threshold) AND week 5 (anaerobic's own 3-week span, again alone) — a deload every 3 weeks, not every 4.

**Files:**
- Modify: `lib/season.ts` (`applyDeloadCadence`, currently lines 547–564)
- Test: `lib/season.test.ts` (`describe("deload cadence", ...)`, currently lines 183–199)

**Interfaces:**
- Consumes: `SEASON_CONSTANTS.deloadEveryWeeks` (4), `SEASON_CONSTANTS.deloadTightEveryWeeks` (3) — unchanged.
- Produces: no signature or export change — `applyDeloadCadence(periods: FocusPeriod[], tight: boolean): FocusPeriod[]` stays the same; only the internal threshold arithmetic changes.

- [ ] **Step 1: Write the failing tests**

Replace the existing `describe("deload cadence", ...)` block (`lib/season.test.ts`, currently lines 183–199) with:

```ts
describe("deload cadence — rolling calendar weeks across period boundaries", () => {
  const p = (weeks: number): import("./types").FocusPeriod => ({
    focus: "threshold", phase: "build", startDate: "2026-07-01", plannedWeeks: weeks,
    intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "", source: "derived", confidence: "medium",
  });
  it("does not self-trip on a single period whose own length already reaches the OLD (buggy) threshold", () => {
    // A lone 3-week period must NOT be flagged deload under the loose (4-wk) cadence — 3 < 4.
    // The old code used threshold = every - 1 = 3, so a bare 3-week period alone used to trip it.
    expect(applyDeloadCadence([p(3)], false)[0].deloadWeek).toBe(false);
  });
  it("flags a deload once cumulative loading weeks reach the FULL cadence (4wk default)", () => {
    const out = applyDeloadCadence([p(2), p(2), p(2)], false); // cumulative 2, 4, 6
    expect(out[0].deloadWeek).toBe(false); // 2 wk in
    expect(out[1].deloadWeek).toBe(true); // crosses the 4-week boundary exactly
    expect(out[2].deloadWeek).toBe(false); // counter reset after the deload — next period only 2 wk in
  });
  it("tightens to every 3 calendar weeks under heavy fatigue — corrected from the old, buggy pinned values", () => {
    // REGRESSION (2026-07-16 live feedback): the OLD threshold (every - 1 = 2) made p(2) alone ALWAYS
    // trip immediately, giving [true, true] for two 2-week periods — every single period flagged,
    // not a genuine 3-week rolling cadence. The correct cadence: first period (2wk) doesn't yet reach
    // 3, second period's cumulative (4wk) crosses it.
    const out = applyDeloadCadence([p(2), p(2)], true);
    expect(out[0].deloadWeek).toBe(false);
    expect(out[1].deloadWeek).toBe(true);
  });
  it("REGRESSION (found live, 2026-07-16): real KB period lengths no longer deload almost every period", () => {
    // Exact shape of the athlete's real season-plan.json at the time of the report: aerobic-base(3),
    // anaerobic(3), threshold(4), vo2max(4), aerobic-base(3, arc boundary), sharpen(1). The live bug
    // flagged 5 of 6 as deloadWeek:true (deloads every ~3 weeks); the fix produces genuine ~4-week
    // spacing: aerobic-base+anaerobic together (3+3=6wk) cross the boundary once at anaerobic's end,
    // threshold (exactly 4wk) and vo2max (exactly 4wk) each cross it on their own (a 4-week period
        // IS one full cadence cycle), the arc-boundary aerobic-base (3wk) doesn't reach 4 alone, and
    // sharpen's single week completes the cadence a 4th time (3 + 1 = 4).
    const periods = [
      { ...p(3), focus: "aerobic-base" as const, phase: "base" as const },
      { ...p(3), focus: "anaerobic" as const },
      { ...p(4), focus: "threshold" as const },
      { ...p(4), focus: "vo2max" as const },
      { ...p(3), focus: "aerobic-base" as const, phase: "base" as const },
      { ...p(1), focus: "sharpen" as const },
    ];
    const out = applyDeloadCadence(periods, false);
    expect(out.map((x) => x.deloadWeek)).toEqual([false, true, true, true, false, true]);
    // The direct symptom the athlete reported: a 6-week block spanning just the first two periods
    // (aerobic-base tail + anaerobic) now shows exactly ONE deload, not two.
    expect(out.slice(0, 2).filter((x) => x.deloadWeek).length).toBe(1);
  });
  it("still resets the counter across a genuine transition period (untouched by this fix)", () => {
    const transitionPeriod = { ...p(2), phase: "transition" as const };
    const out = applyDeloadCadence([p(3), transitionPeriod, p(2)], false);
    expect(out[1].deloadWeek).toBe(false); // a transition is never itself flagged deload
    expect(out[2].deloadWeek).toBe(false); // counter restarted after the break — only 2 wk in
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: FAIL — the single-period test (`expect(...).toBe(false)`) fails because the current code flags a lone 3-week period `true` (3 >= threshold 3); the tight-cadence test fails on `out[0]` (currently `true`, should become `false`); the real-KB-shape regression test fails (`[true, true, true, true, true, true]` — wait, actually re-derive with OLD code to state precisely: OLD threshold=3 for loose — P1(3):cum=3,>=3→true. So old output is `[true, true, true, true, true, true]` minus whichever period the OLD code's actual behavior gives — state simply: "the array does not equal `[false, true, true, true, false, true]`"). The transition test should already pass (untouched behavior).

- [ ] **Step 3: Implement**

In `lib/season.ts`, replace `applyDeloadCadence` (currently lines 547–564):

```ts
// Mark the period that crosses each deload boundary (30–50% volume cut lands in its trailing week).
// Boundary fires when cumulative loading weeks reach `every` (a genuine rolling count ACROSS period
// boundaries, not per-period): a period shorter than `every` on its own must not self-trip just
// because it happens to be a whole mesocycle — it combines with the next period(s) until the full
// cadence is reached. A period whose own length equals or exceeds `every` still fires on its own,
// which is correct (a 4-week period IS one full 4-week loading cycle). Fixed live, 2026-07-16: the
// previous `every - 1` threshold was smaller than any real KB period's own length (all ≥3 weeks),
// so it fired on almost every period regardless of how many calendar weeks had actually passed.
export function applyDeloadCadence(periods: FocusPeriod[], tight: boolean): FocusPeriod[] {
  const every = tight ? SEASON_CONSTANTS.deloadTightEveryWeeks : SEASON_CONSTANTS.deloadEveryWeeks;
  let weeksSinceDeload = 0;
  return periods.map((p) => {
    // A transition IS recovery: never also flag it as a deload, and restart the cadence after it.
    if (p.phase === "transition") {
      weeksSinceDeload = 0;
      return { ...p, deloadWeek: false };
    }
    weeksSinceDeload += p.plannedWeeks;
    if (weeksSinceDeload >= every) {
      weeksSinceDeload = 0;
      return { ...p, deloadWeek: true };
    }
    return { ...p, deloadWeek: false };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: PASS — all new/updated tests green. Also confirm the pre-existing `"flags a deload after ~3 loading weeks (3:1 default)"`-shaped assertions elsewhere (if any survived the replacement above) and the peak/taper exemption test (`"never applies deload cadence to the event-anchored tail"`) are unaffected — that path never calls `applyDeloadCadence` at all. The `assignLoadTargets` tests in `describe("load envelope", ...)` construct `deloadWeek` flags directly as fixtures (they do not call `applyDeloadCadence`) — confirm they still pass unchanged, since this task does not touch `assignLoadTargets`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts
git commit -m "fix(season): deload cadence is a genuine rolling calendar-week count, not per-period

Found live 2026-07-16: applyDeloadCadence's threshold (every - 1 = 3 for the loose cadence) was
smaller than any real KB period's own length (all >=3 weeks), so it fired on almost every period
regardless of how many calendar weeks had actually passed -- 5 of 6 season periods were flagged
deloadWeek:true, producing a real deload every ~3 weeks instead of every ~4. Dropping the -1 makes
short periods correctly accumulate across boundaries before the next deload fires, while a period
whose own length already equals the cadence (a 4-week mesocycle under the 4-week cadence) still
fires on its own -- which is correct, not a regression.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Workout-duration self-consistency check

`lib/plan-parser.ts`'s `eventPayloadShape()` only sets an explicit Intervals.icu `moving_time` for `Strength` events — every `Ride`-category event (Z2, Threshold, VO2max, SIT, RaceSim, Recovery) gets NO explicit duration, so Intervals.icu derives the REAL displayed duration by parsing the workout-text steps in the description itself. NodeVelo's own weekly-hours totals use the AI's *stated* `durationMin` field verbatim. Nothing validates that a workout's actual prescribed steps sum to its stated duration, and the prompt's own rule ("Workout step durations must sum **approximately** to DURATION") explicitly hedges. Confirmed live: interval-heavy sessions (SIT/VO2max/RaceSim) were off by up to 32 minutes; flat Z2/long-ride days matched exactly.

**Files:**
- Modify: `lib/prescription.ts` (extract a shared line-iteration helper from `parsePrescription`, currently lines 79–124; add `totalPrescribedMinutes`)
- Modify: `lib/workout-validate.ts` (add `validateDurationConsistency`; wire into `splitPlanProtocol`, currently lines 91–110)
- Modify: `lib/anthropic-prompts.ts` (tighten the "approximately" hedge, line 309)
- Test: `lib/prescription.test.ts`, `lib/workout-validate.test.ts`

**Interfaces:**
- Consumes: nothing new — reuses `durationToSec`/`parseStep`'s existing token parsing (`lib/prescription.ts:20–38`) and the existing repeat-block/section state machine inside `parsePrescription`.
- Produces: `export function totalPrescribedMinutes(workoutText: string): number` (`lib/prescription.ts`) — sums EVERY step (warmup, main, cooldown, any section, any intensity) times its repeat multiplier, the same way Intervals.icu's own step-parser computes real ride duration. `export function validateDurationConsistency(day: PlannedDay): string | null` (`lib/workout-validate.ts`) — null when the day has no `workoutText` or the stated/actual durations agree within tolerance. Both feed into the EXISTING `splitPlanProtocol`/`GeneratedPlan.protocolViolations` category (Plan 4) — no new plan field.

- [ ] **Step 1: Write the failing tests (prescription)**

Append to `lib/prescription.test.ts` (after the existing `parsePrescription` tests):

```ts
describe("totalPrescribedMinutes — the REAL duration Intervals.icu's own step-parser computes", () => {
  it("sums every step regardless of section or intensity (warmup + main + cooldown)", () => {
    const text = "Warmup\n- 15m ramp 50-65%\n\nMain\n- 3h 60-70%\n\nCooldown\n- 15m 55%";
    expect(totalPrescribedMinutes(text)).toBe(15 + 180 + 15); // 210 — matches a real long-ride day
  });
  it("applies the repeat-block multiplier to every step inside it, matching parsePrescription's own repeat semantics", () => {
    const text = "Warmup\n- 10m ramp 50-65%\n- 5m 65%\n\nMain Set 5x\n- Seated all-out 30s 150%\n- Easy spin 4m 50%\n\nCooldown\n- 10m 50%";
    // warmup 15 + 5x(0.5+4) + cooldown 10 = 15 + 22.5 + 10 = 47.5
    expect(totalPrescribedMinutes(text)).toBeCloseTo(47.5, 5);
  });
  it("returns 0 for an empty or Rest workout text", () => {
    expect(totalPrescribedMinutes("")).toBe(0);
  });
  it("counts steps below the work floor and inside warmup/cooldown sections — the opposite of parsePrescription's exclusions", () => {
    // parsePrescription would return [] for this (all sub-80% / inside Warmup/Cooldown); the total-
    // duration view must still count it, because Intervals.icu counts it too.
    const text = "Warmup\n- 10m ramp 50-60%\n\nMain\n- 70m 62%\n\nCooldown\n- 10m 50%";
    expect(totalPrescribedMinutes(text)).toBe(90);
  });
});
```

Add `totalPrescribedMinutes` to the import list from `"./prescription"` (`lib/prescription.test.ts` top of file).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/prescription.test.ts`

Expected: FAIL — `totalPrescribedMinutes is not a function` / `is not exported`.

- [ ] **Step 3: Implement `totalPrescribedMinutes` (extract the shared line-iteration state machine)**

In `lib/prescription.ts`, `parsePrescription` (currently lines 79–124) contains a line-by-line state machine (blank line flushes a repeat block and clears the excluded-section flag; a non-`-` line flushes, sets `inExcludedSection`, and reads a leading `Nx` repeat count; a `-` line inside an excluded section is skipped; otherwise `parseStep` extracts `{durationSec, pct}` and is dropped if below `WORK_THRESHOLD_PCT`). Extract the shared shape (everything except the two `parsePrescription`-specific exclusions — the `inExcludedSection` skip and the `WORK_THRESHOLD_PCT` filter) into a private helper both functions call:

```ts
// Shared line-iteration state machine: walks a workout's step lines, expanding "Nx" repeat blocks
// in order (matching Intervals.icu's own step semantics — a repeat header repeats the WHOLE
// following block N times, not each step in place). `keep` decides whether a given step (with its
// section-excluded flag) counts at all — parsePrescription excludes warmup/cooldown sections and
// sub-work-floor steps; totalPrescribedMinutes below keeps everything, matching how Intervals.icu's
// own parser computes real ride duration (it does not distinguish warmup from work).
function walkWorkoutSteps(
  workoutText: string,
  keep: (step: { durationSec: number; pct: number }, inExcludedSection: boolean) => boolean
): Array<{ durationSec: number; pct: number }> {
  if (!workoutText) return [];
  const expanded: Array<{ durationSec: number; pct: number }> = [];
  let block: Array<{ durationSec: number; pct: number }> = [];
  let blockReps = 1;
  const flush = () => {
    for (let r = 0; r < blockReps; r++) expanded.push(...block);
    block = [];
    blockReps = 1;
  };
  let inExcludedSection = false;
  for (const raw of workoutText.split("\n")) {
    const line = raw.trim();
    if (line === "") {
      flush();
      inExcludedSection = false;
      continue;
    }
    if (!line.startsWith("-")) {
      flush();
      inExcludedSection = EXCLUDED_SECTION_RX.test(line);
      const rx = line.match(/(\d+)\s*x/i);
      blockReps = rx ? Math.max(1, Number(rx[1])) : 1;
      continue;
    }
    const step = parseStep(line);
    if (!step) continue;
    if (!keep(step, inExcludedSection)) continue;
    block.push(step);
  }
  flush();
  return expanded;
}
```

Replace `parsePrescription`'s body (the part that builds `expanded` — currently the `for (const raw of workoutText.split("\n"))` loop and the `let inExcludedSection` line above it) to call the shared helper instead:

```ts
export function parsePrescription(workoutText: string, ftp: number): PrescribedInterval[] {
  const expanded = walkWorkoutSteps(
    workoutText,
    (step, inExcludedSection) => !inExcludedSection && step.pct >= WORK_THRESHOLD_PCT
  ).map((s) => ({
    durationSec: s.durationSec,
    pct: s.pct,
    targetWatts: ftp > 0 ? Math.round((s.pct / 100) * ftp) : 0,
  }));
  // ... (the collapse-consecutive-identical-into-reps loop and `iv.label` assignment stay exactly as they are)
}
```

Then add `totalPrescribedMinutes` after `parsePrescription`:

```ts
// The REAL total ride duration Intervals.icu's own step-parser computes from the workout text —
// every step, every section (warmup/cooldown included), no intensity floor. This is deliberately
// the OPPOSITE filter from parsePrescription's WORK-only view; the two answer different questions
// ("what did the coach prescribe as work" vs. "how long will this ride actually run").
export function totalPrescribedMinutes(workoutText: string): number {
  const steps = walkWorkoutSteps(workoutText, () => true);
  return steps.reduce((sum, s) => sum + s.durationSec, 0) / 60;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/prescription.test.ts`

Expected: PASS — all new tests green, AND every pre-existing `parsePrescription`/`carriesEmbeddedIntensity` test still passes unchanged (the refactor must be behavior-preserving for the existing function — confirm by running the full file, not just the new describe block).

- [ ] **Step 5: Write the failing tests (workout-validate)**

Append to `lib/workout-validate.test.ts`:

```ts
describe("validateDurationConsistency — stated durationMin vs. the real prescribed total", () => {
  const day = (workoutText: string, durationMin: number): PlannedDay =>
    ({ date: "2026-07-21", weekNumber: 1, weekTheme: "", name: "n", type: "SIT", durationMin, workoutText, description: "" });
  it("stays silent when the stated duration matches the real prescribed total", () => {
    const d = day("Warmup\n- 15m ramp 50-65%\n\nMain\n- 3h 60-70%\n\nCooldown\n- 15m 55%", 210);
    expect(validateDurationConsistency(d)).toBeNull();
  });
  it("flags a day whose real prescribed total runs meaningfully short of the stated duration", () => {
    // Real live case: RaceSim stated 90min, steps summed to ~58min.
    const d = day(
      "Warmup\n- 15m ramp 50-70%\n\nMove 1\n- Seated climb 2m 102%\n- Standing attack 25s 130%\n- Easy 3m 50%\n\nCooldown\n- 10m 50%",
      90
    );
    const msg = validateDurationConsistency(d)!;
    expect(msg).toContain("2026-07-21");
    expect(msg).toContain("stated 90min");
    expect(msg).toMatch(/prescribed steps.*sum.*~2\d min/); // ~20-21 min real total (15+2+25/60+3+10)
  });
  it("tolerates small rounding gaps (within the tolerance band) without flagging", () => {
    const d = day("Warmup\n- 10m ramp 50-65%\n\nMain\n- 48m 62%\n\nCooldown\n- 10m 50%", 70); // 68 real vs 70 stated
    expect(validateDurationConsistency(d)).toBeNull();
  });
  it("returns null for Rest days / days with no workoutText", () => {
    expect(validateDurationConsistency({ date: "2026-07-21", weekNumber: 1, weekTheme: "", name: "Rest", type: "Rest", durationMin: 0, workoutText: "", description: "" })).toBeNull();
  });
});
```

Add `validateDurationConsistency` to the import list from `"./workout-validate"` (`lib/workout-validate.test.ts` top of file).

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/workout-validate.test.ts`

Expected: FAIL — `validateDurationConsistency is not a function`.

- [ ] **Step 7: Implement + wire into `splitPlanProtocol`**

In `lib/workout-validate.ts`, add the import and the new function (after `PROTOCOL`, before `QUALITY_TYPES`):

```ts
import { totalPrescribedMinutes } from "./prescription";

// Tolerance: the greater of 15% relative or 8 minutes absolute, whichever is more lenient — small
// rounding/estimation gaps are normal and must not fire on every session; a 30+ minute real-world
// gap on a stated 90-minute session (found live, 2026-07-16) must.
function durationTolerance(statedMin: number): number {
  return Math.max(statedMin * 0.15, 8);
}

// Real prescribed total vs. stated duration — the SAME number Intervals.icu's own step-parser will
// compute and display, since Ride-category events never set an explicit moving_time (lib/plan-
// parser.ts). A mismatch here is exactly why NodeVelo's own weekly-hours totals can disagree with
// what the athlete's calendar actually shows. null when the day has no workoutText or the gap is
// within tolerance.
export function validateDurationConsistency(day: PlannedDay): string | null {
  if (!day.workoutText) return null;
  const real = totalPrescribedMinutes(day.workoutText);
  const gap = day.durationMin - real;
  if (Math.abs(gap) <= durationTolerance(day.durationMin)) return null;
  return `DAY ${day.date} (${day.type}): stated ${day.durationMin}min but the prescribed steps only sum to ~${Math.round(real)}min — tighten the workout text or the stated duration so Intervals.icu's real displayed time matches what NodeVelo shows.`;
}
```

In `splitPlanProtocol` (currently lines 96–110), add the duration check alongside the existing protocol check inside the loop:

```ts
export function splitPlanProtocol(
  days: PlannedDay[],
  ftp: number,
  envelope: DurabilityInsertEnvelope = DEFAULT_DURABILITY_INSERT_ENVELOPE
): ProtocolFindings {
  const out: ProtocolFindings = { violations: [], advisories: [] };
  for (const d of days) {
    const findings = validateWorkoutProtocol(d, ftp, envelope);
    const durationFinding = validateDurationConsistency(d);
    if (durationFinding) findings.push(durationFinding);
    if (findings.length === 0) continue;
    (QUALITY_TYPES.has(d.type) ? out.violations : out.advisories).push(...findings);
  }
  return out;
}
```

(`findings` from `validateWorkoutProtocol` — confirm its return type is a mutable `string[]`, not a frozen array, before pushing onto it; if it returns a `readonly` or literal array type, build a new array instead: `const findings = [...validateWorkoutProtocol(d, ftp, envelope)]; const durationFinding = ...; if (durationFinding) findings.push(durationFinding);`.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/workout-validate.test.ts`

Expected: PASS. Also re-run `lib/session-level.test.ts` (Plan 4) — it imports `PROTOCOL` from this file; confirm the table itself is untouched.

- [ ] **Step 9: Tighten the prompt hedge**

In `lib/anthropic-prompts.ts`, line 309, change:

```ts
- Workout step durations must sum approximately to DURATION.
```

to:

```ts
- **Workout step durations must sum to DURATION — no hedging.** Add up every warmup + main + cooldown step before finalising a session; if they don't match, adjust the steps (never just the stated number) so Intervals.icu's own parsed ride time (which is what actually shows on the athlete's calendar) matches what you tell them the session costs.
```

- [ ] **Step 10: Full check**

Run: `cd "/Users/otis/Cycling App" && npm run check`

Expected: PASS — `tsc --noEmit` clean, `eslint` clean, all vitest files green (this catches any other consumer of `parsePrescription`'s internals affected by the refactor).

- [ ] **Step 11: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/prescription.ts lib/prescription.test.ts lib/workout-validate.ts lib/workout-validate.test.ts lib/anthropic-prompts.ts
git commit -m "feat(measurability): flag workouts whose real prescribed total disagrees with stated duration

Found live 2026-07-16: Ride-category calendar events never carry an explicit moving_time
(lib/plan-parser.ts), so Intervals.icu derives real ride duration by parsing the workout-text steps
itself -- while NodeVelo's own weekly-hours totals use the AI's stated durationMin verbatim. Nothing
validated that the two agreed, and the prompt's own rule hedged with 'approximately'. A real 6-week
block had every interval session (SIT/VO2max/RaceSim) off by up to 32 minutes. totalPrescribedMinutes
(a sibling to parsePrescription sharing its repeat-block parsing, but keeping every step instead of
excluding warmup/cooldown/sub-floor) now feeds a new validateDurationConsistency check wired into the
existing protocolViolations category from the measurability plan.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Goal-vs-season-phase precedence rule — **SKIPPED (2026-07-16 amendment above)**

> **Do not execute this task.** Season-phase text is no longer injected into the prompt at all (new
> Task 6) — there is nothing left for this precedence rule to reconcile against. Left in place,
> unexecuted, as the record of the original finding; revisit if/when season is re-enabled.

The prompt concatenates the block goal (`lib/anthropic-prompts.ts:246`, one line: `- Block goal: ${blockParams.goal}`) and the season context (a separate injected block, `formatSeasonContext` in `lib/season.ts`) with no instruction on how to weigh them when they're in tension. Confirmed live: the athlete's season objective explicitly says "move up TTE (time to exhaustion)" and their block goal listed FTP/TTE targets, yet the season was mid-"anaerobic build" and the model produced only 1–2 Threshold sessions across 6 weeks — resolving the tension entirely in the season's favor with no instruction telling it that was even a choice to make.

**Files:**
- Modify: `lib/anthropic-prompts.ts` (near line 246, the block goal line, and/or near the "Hard rules" section starting line 295 — read the live file to place it where it reads naturally against both the goal line and the season-context injection point)

**Interfaces:**
- Consumes: nothing new — pure prompt text.
- Produces: nothing — no test possible for prompt wording itself; verified by the Task 6 live smoke run.

- [ ] **Step 1: Implement**

In `lib/anthropic-prompts.ts`, directly after the `- Block goal: ${blockParams.goal}` line (currently line 246), add:

```ts
- **Reconciling the block goal against the season's current phase (SEASON CONTEXT below):** the season phase decides which quality TYPE gets the week's primary emphasis (e.g. an anaerobic-build period means SIT/anaerobic work leads); the block goal decides how the OTHER quality slot(s) and the durability/long-ride work get spent. A stated goal never gets zero representation across a multi-week block just because the season is currently emphasising something else — if the goal names a system the current phase doesn't emphasise (e.g. a threshold/TTE goal during an anaerobic-build phase), give it at least one genuine touch per 2–3 weeks (a Threshold session, or a durability long ride that embeds threshold work) rather than deferring it entirely to a future phase.
```

(Exact placement: read the live file first — this must sit where both the block-goal line above it and the season-context block below it are already in the model's immediate context, so the rule reads as connecting the two. If the season context is injected much later in the prompt than line 246, consider placing this rule adjacent to the season-context injection point instead, or duplicating a one-line pointer at both locations — use judgment based on the live file's actual layout.)

- [ ] **Step 2: No unit test — flag for the live smoke run**

This is prompt-only; there is no deterministic function to test. Note this task's completion in the ledger as "prompt change, verification deferred to Task 6."

- [ ] **Step 3: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/anthropic-prompts.ts
git commit -m "feat(prompt): give the model an explicit rule for reconciling goal text against season phase

Found live 2026-07-16: the prompt handed the model both the block goal and the season's current
phase emphasis with no precedence rule when they're in tension. A real block whose season objective
said 'move up TTE' and was mid-anaerobic-build produced only 1-2 Threshold sessions in 6 weeks --
the model resolved the tension entirely in the season's favor with nothing telling it that was even
a choice. The season phase still leads (unchanged), but a goal-named system now gets at least one
genuine touch every 2-3 weeks rather than zero representation for a whole build.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Goal-aware durability template selection

`selectDurabilityTemplate` (`lib/durability.ts`) picks one template per block — by design, meant to rotate ACROSS blocks (seeing the same template on every long ride within a single block is not itself a bug). But selection today is 100% insight-driven (`LIMITER_TEMPLATE`, keyed on detected weakness severity) — it has no awareness of the athlete's stated goal text at all. Template B ("Fatigue-then-threshold": 2–3h Z2 then 2–3×8–15min threshold efforts late in the ride) is close to exactly what a stated TTE/durability/threshold goal calls for, yet nothing routes to it without a formal "weak" insight already flagging Threshold specifically.

**Files:**
- Modify: `lib/durability.ts` (`selectDurabilityTemplate`, currently lines 65–74)
- Modify: `app/api/generate/route.ts` (the call site, currently line 214)
- Test: create `lib/durability.test.ts` if it does not already exist — check first (`ls lib/durability.test.ts`); if it exists, append.

**Interfaces:**
- Consumes: nothing new for the pure function beyond an added parameter.
- Produces: `selectDurabilityTemplate(insights: Insight[], lastId: string | null, goalText?: string): DurabilityTemplate` — the `goalText` parameter is OPTIONAL and appended last so every existing call site (and test) compiles unchanged if not passed. Precedence: a detected weakness insight (alert or watch) still wins outright — a real, measured limiter must never be silently deprioritized by goal text alone. Goal text only matters when NO insight-driven match fires; it then checks for the same dimensions `LIMITER_TEMPLATE` already maps (Threshold → B, VO2max → C, SIT/neuromuscular → D) via keyword matching against the goal text, falling through to `nextAfter(lastId)` (unchanged rotation) if goal text names nothing recognizable either.

- [ ] **Step 1: Write the failing tests**

Check whether `lib/durability.test.ts` exists (`ls lib/durability.test.ts`). If it does, read it first to match its existing style and import list before appending. Add or append:

```ts
import { describe, expect, it } from "vitest";
import { selectDurabilityTemplate } from "./durability";
import type { Insight } from "./types";

describe("selectDurabilityTemplate — goal text as a fallback signal (2026-07-16)", () => {
  it("still lets a detected weakness insight win outright, even when goal text points elsewhere", () => {
    const insights: Insight[] = [{ dimension: "SIT", severity: "alert" } as Insight];
    const t = selectDurabilityTemplate(insights, null, "I want to raise my FTP and TTE");
    expect(t.id).toBe("D"); // the measured limiter (SIT/neuromuscular) still wins, not goal text
  });
  it("falls back to goal-text matching when no insight fires", () => {
    const t = selectDurabilityTemplate([], null, "Raise FTP to 300w and move up TTE (time to exhaustion)");
    expect(t.id).toBe("B"); // threshold/TTE language -> Fatigue-then-threshold
  });
  it("matches VO2max-flavoured goal text to template C", () => {
    const t = selectDurabilityTemplate([], null, "Raise my VO2max and high-end repeatability");
    expect(t.id).toBe("C");
  });
  it("falls through to the existing rotation when goal text names nothing recognisable", () => {
    const t = selectDurabilityTemplate([], "A", "Have fun and stay consistent");
    expect(t.id).toBe("B"); // nextAfter("A") — unchanged rotation behaviour
  });
  it("falls through to the existing rotation when goalText is omitted entirely (pre-existing call sites)", () => {
    const t = selectDurabilityTemplate([], "A");
    expect(t.id).toBe("B");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/durability.test.ts`

Expected: FAIL — `selectDurabilityTemplate` doesn't accept a third argument yet, so goal-text-driven cases fall through to `nextAfter(null)` = template A instead of B/C.

- [ ] **Step 3: Implement**

In `lib/durability.ts`, add a goal-text pattern table (mirroring `GOAL_PATTERNS`'s style in `lib/season.ts` — same negation-free simple keyword approach is fine here, no need for `tagPresent`'s negation-aware matching since durability template selection is a soft fallback, not a hard gate) and extend the function:

```ts
// Goal-text fallback (2026-07-16 live feedback): the insight-driven LIMITER_TEMPLATE map above only
// fires on a formally DETECTED weakness. A stated goal (e.g. "move up TTE") should still bias
// selection toward the matching template when no insight already decided it -- otherwise a goal the
// athlete explicitly named can go completely unaddressed by the long ride for as many blocks as it
// takes a weakness to get formally flagged. Same three dimensions LIMITER_TEMPLATE already covers.
const GOAL_TEMPLATE_PATTERNS: Array<{ re: RegExp; id: DurabilityTemplateId }> = [
  { re: /\b(threshold|ftp|tte|time.?to.?exhaustion|sustained|steady.?state)\b/i, id: "B" },
  { re: /\b(vo2.?max|vo2|high.?end|aerobic (power|ceiling))\b/i, id: "C" },
  { re: /\b(sprint|neuromuscular|explosive|1.?min(ute)? power|5.?sec(ond)? power)\b/i, id: "D" },
];

// Pick this block's durability template: address the strongest flagged limiter (alert beats watch;
// a systemic Overall alert deliberately wins -> A, the safest, rather than stacking hard late efforts
// on a fatigued athlete); else — new, 2026-07-16 — check the athlete's stated goal text for the same
// three dimensions; else rotate from the last block's template to keep adaptation broad. `goalText`
// is optional so every pre-existing call site/test compiles and behaves unchanged without it.
export function selectDurabilityTemplate(insights: Insight[], lastId: string | null, goalText?: string): DurabilityTemplate {
  const weak = insights.filter((i) => i.severity === "alert" || i.severity === "watch");
  for (const sev of ["alert", "watch"] as const) {
    for (const { dimension, id } of LIMITER_TEMPLATE) {
      if (weak.some((i) => i.severity === sev && i.dimension === dimension)) return BY_ID.get(id)!;
    }
  }
  if (goalText) {
    for (const { re, id } of GOAL_TEMPLATE_PATTERNS) {
      if (re.test(goalText)) return BY_ID.get(id)!;
    }
  }
  return nextAfter(lastId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/durability.test.ts`

Expected: PASS.

- [ ] **Step 5: Wire the route**

In `app/api/generate/route.ts`, the call site (currently line 214):

```ts
const durability = selectDurabilityTemplate(insights, currentBlock?.durabilityTemplate ?? null);
```

Change to pass a combined goal-text signal (the same construction pattern Plan 2's `focusSignals.goalText` already used at this call site's neighborhood — search `goalText:` in this file for the established join pattern):

```ts
const durability = selectDurabilityTemplate(
  insights,
  currentBlock?.durabilityTemplate ?? null,
  [existingSeason.objective, blockParams.goal].filter(Boolean).join(" \n ")
);
```

(`existingSeason` is already destructured in scope at this point in the route — confirm by reading the live file; it is used later at line ~242 for the season replan input, so it must already be available before line 214, or move this call site's goal-text construction to reuse whatever the season-replan block already builds, rather than duplicating the join logic — check for an existing `goalText` local first and reuse it if one already exists by the time you implement this.)

- [ ] **Step 6: Full check**

Run: `cd "/Users/otis/Cycling App" && npm run check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/durability.ts lib/durability.test.ts app/api/generate/route.ts
git commit -m "feat(durability): let stated goal text bias template selection when no weakness insight fires

Found live 2026-07-16: selectDurabilityTemplate only ever responded to a formally DETECTED weakness
insight -- an athlete's explicitly stated goal (e.g. 'move up TTE') had zero influence on which
durability template got picked, so a goal-matching template (B, Fatigue-then-threshold) could go
unused indefinitely without a matching insight ever firing. A detected weakness still wins outright
(unchanged); goal text is now a second-tier fallback signal before the existing block-to-block
rotation, added as an optional trailing parameter so every prior call site/test is unaffected.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Surface B/C-priority events into the generation prompt

Only A-priority events trigger anything today (`draftSeasonArc`'s `input.events.find((e) => e.priority === "A" && ...)` in `lib/season.ts` routes to full backward-scheduling). B/C-priority events are stored in `season-plan.json` but never surfaced into block generation at all. Confirmed live: a real B-priority "Areh FTP Test" event on 2026-07-22 got a generic "Easy Z2 — Aerobic Flush" session generated directly on top of it.

**Files:**
- Modify: `lib/season.ts` (new function, placed near `formatSeasonContext`)
- Modify: `app/api/generate/route.ts` (wire the new function's output into the prompt context, near the existing `seasonContext`/`durabilityContext` construction)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: `SeasonEvent[]` (`lib/types.ts:337-341`, unchanged), a block date range.
- Produces: `export function formatUpcomingEventsForBlock(events: SeasonEvent[], blockRange: { startDate: string; endDate: string }): string | null` (`lib/season.ts`) — a prompt-injectable line listing every B/C-priority event whose date falls inside the block's range, null when there are none. Does NOT touch A-priority routing or `draftSeasonArc` at all — this is purely additive prompt content for events that do NOT already redirect the whole season.

- [ ] **Step 1: Write the failing tests**

Add `formatUpcomingEventsForBlock` to the import list from `"./season"` in `lib/season.test.ts`. Append:

```ts
describe("formatUpcomingEventsForBlock — B/C-priority events inside the block's own date range", () => {
  it("lists a B-priority event that falls inside the block range, naming the date and asking it be protected", () => {
    const events: import("./types").SeasonEvent[] = [{ name: "Areh FTP Test", date: "2026-07-22", priority: "B" }];
    const line = formatUpcomingEventsForBlock(events, { startDate: "2026-07-20", endDate: "2026-08-30" })!;
    expect(line).toContain("Areh FTP Test");
    expect(line).toContain("2026-07-22");
    expect(line).toMatch(/protect|build around|do not overwrite/i);
  });
  it("returns null when no B/C event falls inside the range", () => {
    const events: import("./types").SeasonEvent[] = [{ name: "Late Event", date: "2026-09-15", priority: "C" }];
    expect(formatUpcomingEventsForBlock(events, { startDate: "2026-07-20", endDate: "2026-08-30" })).toBeNull();
  });
  it("returns null for an empty events array", () => {
    expect(formatUpcomingEventsForBlock([], { startDate: "2026-07-20", endDate: "2026-08-30" })).toBeNull();
  });
  it("ignores A-priority events entirely — those already redirect the whole season via draftSeasonArc, not this line", () => {
    const events: import("./types").SeasonEvent[] = [{ name: "A-Race", date: "2026-07-22", priority: "A" }];
    expect(formatUpcomingEventsForBlock(events, { startDate: "2026-07-20", endDate: "2026-08-30" })).toBeNull();
  });
  it("lists multiple in-range events in chronological order", () => {
    const events: import("./types").SeasonEvent[] = [
      { name: "Second", date: "2026-08-10", priority: "C" },
      { name: "First", date: "2026-07-25", priority: "B" },
    ];
    const line = formatUpcomingEventsForBlock(events, { startDate: "2026-07-20", endDate: "2026-08-30" })!;
    expect(line.indexOf("First")).toBeLessThan(line.indexOf("Second"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: FAIL — `formatUpcomingEventsForBlock is not a function`.

- [ ] **Step 3: Implement**

In `lib/season.ts`, add near `formatSeasonContext`:

```ts
// B/C-priority events inside this block's own date range — surfaced so a real planned test/race
// day doesn't get a generic session written on top of it. A-priority events are deliberately
// excluded here: they already take over the whole arc via draftSeasonArc's backward-scheduling
// (this is the ONLY place a B/C event gets any generation-time visibility at all).
export function formatUpcomingEventsForBlock(
  events: SeasonEvent[],
  blockRange: { startDate: string; endDate: string }
): string | null {
  const inRange = events
    .filter((e) => e.priority !== "A" && e.date >= blockRange.startDate && e.date <= blockRange.endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (inRange.length === 0) return null;
  const lines = inRange.map((e) => `- ${e.date}: ${e.name} (priority ${e.priority}) — protect this day; build the week around it rather than overwriting it with a generic session.`);
  return `UPCOMING EVENTS THIS BLOCK:\n${lines.join("\n")}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run lib/season.test.ts`

Expected: PASS.

- [ ] **Step 5: Wire the route**

In `app/api/generate/route.ts`, the season try/catch block (currently lines 236–274) computes `blockEnd` as a `const` INSIDE the try block (line 269: `const blockEnd = weeks[weeks.length - 1][weeks[weeks.length - 1].length - 1];`), used immediately for `formatSeasonContext`'s call at line 270. `blockEnd` is block-scoped to the `try` and is NOT visible after its closing `}` (line 274) — the retest-note wiring that follows (lines 276–283) never needed it, so this is the first task to hit that scoping boundary. Insert the new call INSIDE the try block, directly after the existing `if (line) seasonContext = ...` line (line 271) and before the closing `}`, while `blockEnd` is still in scope:

```ts
      if (line) seasonContext = `\n${line}`;
      const upcomingEventsLine = formatUpcomingEventsForBlock(existingSeason.events, { startDate: blockParams.startDate, endDate: blockEnd });
      if (upcomingEventsLine) seasonContext += `\n${upcomingEventsLine}`;
    } catch (err) {
```

(`existingSeason.events` is already destructured in scope at the top of the route handler and used a few lines above, inside this same try block, at line 242 — reuse it directly, do not read `replannedSeason.events` instead: `replannedSeason` is only assigned on success a few lines earlier in this same block, and using the already-available `existingSeason.events` avoids any question of whether replanning could ever touch `events` — it doesn't, but there is no reason to depend on that invariant here when the un-replanned source is already in scope.)

Add `formatUpcomingEventsForBlock` to the `@/lib/season` import line.

- [ ] **Step 6: Full check**

Run: `cd "/Users/otis/Cycling App" && npm run check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts lib/season.test.ts app/api/generate/route.ts
git commit -m "feat(season): surface B/C-priority events inside the block's own range into the prompt

Found live 2026-07-16: a real B-priority event (an FTP test) on a date inside the generated block's
range got a generic Easy Z2 session written directly on top of it -- only A-priority events do
anything today (they redirect the whole season via backward-scheduling in draftSeasonArc). B/C
events were stored but never surfaced at generation time at all. formatUpcomingEventsForBlock adds
one prompt line naming every B/C event inside the block's date range and asking the model to protect
that day, without touching A-priority routing or draftSeasonArc.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Temporarily disable season phase/deload/retest context from shaping block generation

**Added by the 2026-07-16 amendment (see note near the top of this plan).** Season's rotating phase
must stop biasing or gating what gets generated, until the athlete revisits the fixed phase-sequence
model itself (a separate, deferred question — not this plan's scope, and this task does NOT touch
`draftSeasonArc`, `scoreFocusCandidates`, `selectBuildFocus`, or any phase/period logic itself, only
whether its output reaches the generation prompt/validators). Season state keeps being tracked
underneath: `replanSeasonArc` still runs and `season-plan.json` still gets written every generation
(so Task 1's deload-cadence fix keeps exercising against real data, and nothing atrophies for whenever
this is revisited) — only the phase-derived prompt text (`formatSeasonContext`, `formatRetestNote`)
and the two validators that grade generated days against the season's period labels
(`validateSeasonFit`, `validateFocusMatch`) are switched off. Task 5's B/C-priority event surfacing
must keep working — those are calendar facts about specific dates, not a phase opinion — so it must
be decoupled from the phase-context variable rather than gated with it.

**Files:**
- Modify: `lib/season.ts` (add one exported flag near `SEASON_CONSTANTS`, currently line 11)
- Modify: `app/api/generate/route.ts` (the season try-block and the two validator call sites — read
  the live file first: Tasks 1, 2, 4, 5 landed before this task and may have shifted exact line
  numbers from what the earlier tasks' steps described)
- Test: `app/api/generate/route.test.ts` (`describe("POST /api/generate — season wiring (multi-period
  blocks)", ...)`, currently lines 105–140 as of plan-writing time — re-locate live)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const SEASON_SHAPES_GENERATION = false;` (`lib/season.ts`) — a single named,
  reversible switch. No function signature changes anywhere.

- [ ] **Step 1: Add the flag**

In `lib/season.ts`, near `SEASON_CONSTANTS` (currently line 11), add:

```ts
// Season phase/deload/retest context + the two season-fit/focus-match validators are TEMPORARILY
// DISABLED from shaping or gating block generation (2026-07-16, athlete decision) -- the fixed
// phase-sequence model itself is a separate, deferred question (see ROADMAP.md "Season architecture
// doubt": whether always prescribing a phase sequence regardless of a rider's existing base is even
// the right model). Season state keeps being tracked underneath this flag (replanSeasonArc still
// runs, season-plan.json still updates, B/C-priority event surfacing still injects -- those are
// calendar facts, not phase opinion) -- only the PHASE-DERIVED opinion about what a week should
// emphasise, and the validators that grade generated days against it, are switched off. Flip back to
// true once the season model is revisited.
export const SEASON_SHAPES_GENERATION = false;
```

- [ ] **Step 2: Decouple event-surfacing from the phase-context variable, then gate the phase text**

Read the live `app/api/generate/route.ts` season try-block (originally lines 234–274, shifted by
Tasks 1/2/4/5). It currently builds one `seasonContext` string that both the phase text
(`formatSeasonContext`) and Task 5's event line (`formatUpcomingEventsForBlock`) get appended to, plus
a retest-note append (`formatRetestNote`) right after the try block. Restructure so events are their
own always-on variable and the phase/retest text is flag-gated:

```ts
let seasonContext = "";
let upcomingEventsContext = "";
let replannedSeason: import("@/lib/types").SeasonPlan | null = null;
try {
  // ... limiter calc and replanSeasonArc(...) call, writeSeasonPlan(replanned), replannedSeason =
  // replanned, and the blockEnd calc all stay EXACTLY as they are -- season state must keep being
  // tracked regardless of the flag.
  const upcomingLine = formatUpcomingEventsForBlock(existingSeason.events, { startDate: blockParams.startDate, endDate: blockEnd });
  if (upcomingLine) upcomingEventsContext = `\n${upcomingLine}`;
  if (SEASON_SHAPES_GENERATION) {
    const line = formatSeasonContext(replanned, today, { startDate: blockParams.startDate, endDate: blockEnd });
    if (line) seasonContext = `\n${line}`;
  }
} catch (err) {
  logWarn("/api/generate", "season-replan", err instanceof Error ? err.message : String(err));
}

if (SEASON_SHAPES_GENERATION && physStore && replannedSeason) {
  const ftpStaleDays = Math.floor((Date.parse(today) - Date.parse(physStore.current.effectiveFrom)) / 86_400_000);
  const retestNote = formatRetestNote(Number.isFinite(ftpStaleDays) ? ftpStaleDays : null, replannedSeason, today);
  if (retestNote) seasonContext += `\n${retestNote}`;
}
```

Update the prompt-assembly join line (the `buildSystemPrompt(...)` call's second argument, the long
`seedsContext + reflectionsContext + ...` concatenation) to add `+ upcomingEventsContext` alongside
the existing `+ seasonContext`, so events keep reaching the model unconditionally while phase text
only does when the flag is on.

(Exact placement of `formatUpcomingEventsForBlock`'s call depends on exactly how Task 5's implementer
wired it — read the live file and adapt if it landed slightly differently than shown here; the
required end state is: the event line's computation and inclusion in the final prompt must NOT be
inside the `if (SEASON_SHAPES_GENERATION)` block and must NOT depend on `seasonContext`.)

- [ ] **Step 3: Gate the two season validators**

At the two existing call sites (originally lines 366 and 369):

```ts
if (SEASON_SHAPES_GENERATION && replannedSeason) warnings.push(...validateSeasonFit(days, replannedSeason, profile.performance.ftp));
if (SEASON_SHAPES_GENERATION && replannedSeason) warnings.push(...validateFocusMatch(days, replannedSeason, profile.performance.ftp));
```

- [ ] **Step 4: Update the pre-existing season-wiring tests**

In `app/api/generate/route.test.ts`, `describe("POST /api/generate — season wiring (multi-period
blocks)", ...)` currently asserts the OLD (now-disabled) behavior. Update in place:

```ts
describe("POST /api/generate — season wiring (multi-period blocks)", () => {
  // ... existing seasonPlan fixture and genWithSeason() helper unchanged ...

  it("does NOT inject season-phase context into the prompt while SEASON_SHAPES_GENERATION is off (2026-07-16)", async () => {
    vi.mocked(store.readSeasonPlan).mockResolvedValue(seasonPlan as never);
    await genWithSeason();
    const dynamic = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][1];
    expect(dynamic).not.toContain("spans 2 season periods");
    expect(dynamic).not.toContain("focus aerobic-base");
    // Season state must still be tracked underneath even though it's not shown to the model.
    expect(store.writeSeasonPlan).toHaveBeenCalled();
  });

  it("does NOT push Season fit / focus-match warnings while SEASON_SHAPES_GENERATION is off", async () => {
    vi.mocked(store.readSeasonPlan).mockResolvedValue(seasonPlan as never);
    const json = await (await genWithSeason()).json();
    expect(json.plan.warnings.some((w: string) => /^Season fit/.test(w))).toBe(false);
  });

  it("still surfaces a B/C-priority event inside the block range even with phase context disabled (Task 5 stays decoupled)", async () => {
    const withEvent = { ...seasonPlan, events: [{ name: "Areh FTP Test", date: "2026-06-16", priority: "B" }] };
    vi.mocked(store.readSeasonPlan).mockResolvedValue(withEvent as never);
    await genWithSeason();
    const dynamic = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][1];
    expect(dynamic).toContain("Areh FTP Test");
    expect(dynamic).not.toContain("spans 2 season periods"); // phase text still absent
  });
});
```

(Adjust the exact `not.toContain` fixture strings to whatever `formatSeasonContext` actually emits
for this fixture if it differs from what's shown here — read the live test file's current assertions
first, since Tasks 1/2/4/5 do not touch this describe block but re-confirm before editing.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd "/Users/otis/Cycling App" && npx vitest run app/api/generate/route.test.ts`

Expected: PASS — the three updated/added tests green, and every other test in the file (session
requirements, protocol violations, request validation, generation outcomes) unaffected.

- [ ] **Step 6: Full check**

Run: `cd "/Users/otis/Cycling App" && npm run check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd "/Users/otis/Cycling App"
git add lib/season.ts app/api/generate/route.ts app/api/generate/route.test.ts
git commit -m "feat(season): temporarily disable phase/retest context and fit validators from generation

Athlete decision, 2026-07-16: the fixed phase-sequence model itself is under separate, deferred
review (whether always prescribing a phase sequence regardless of a rider's existing base is even
right) -- until that's resolved, season must stop shaping or gating what actually gets generated.
SEASON_SHAPES_GENERATION (lib/season.ts) gates formatSeasonContext/formatRetestNote's prompt text and
the validateSeasonFit/validateFocusMatch warnings off; replanSeasonArc still runs and season-plan.json
still updates every generation so nothing atrophies, and Task 5's B/C-priority event surfacing (a
calendar fact, not a phase opinion) is decoupled onto its own always-on context variable so it keeps
working. No phase/period/rotation logic itself changed -- draftSeasonArc, scoreFocusCandidates, and
selectBuildFocus are untouched; only whether their output reaches generation.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Integration — full check + the mandatory live smoke run

**Files:**
- No source changes. Verification only (fix-forward anything it surfaces, committing per the rules above).

**Interfaces:**
- Consumes: everything Tasks 1–2, 4–6 landed (Task 3 skipped).
- Produces: a verified, shippable state.

- [ ] **Step 1: Full gate**

Run: `cd "/Users/otis/Cycling App" && npm run check`

Expected: PASS — `tsc --noEmit` clean, `eslint` clean, `vitest run` all green. Per this repo's concurrent-agent convention: a failure in a file this plan never touched → `git status --short <file>` first; if uncommitted, that's likely a concurrent session's WIP — wait ~30s, retry once, then report rather than patching it.

- [ ] **Step 2: Live smoke run (AGENTS.md rule — Task 2's prompt hedge, Task 5's event line, and Task 6's context restructuring all changed generation-prompt content)**

Generate a real block against the SAME parameters the athlete's real report was based on (reuse the exact `gen_body.json` fixture already used for prior live checks this session: 6 weeks, startDate 2026-07-20, the athlete's real goal/weakpoints text) via the running dev server:

```bash
curl -sS -X POST http://127.0.0.1:3100/api/generate \
  --data-binary @<the same gen_body.json fixture used earlier this session> \
  -H "Content-Type: application/json" \
  -o /tmp/live-plan-fidelity-check.json
```

Read the actual output and confirm, by eye and by direct inspection of `data/season-plan.json` after the call:

- **Deload cadence (Task 1):** inspect `data/season-plan.json` directly (not the prompt — season phase text is no longer shown to the model as of Task 6) — the redrafted periods should no longer show 5 of 6 flagged `deloadWeek: true`; spacing should be roughly every 4 weeks, not every period.
- **Duration consistency (Task 2):** `plan.protocolViolations` should be empty (or, if the model still produces a mismatch despite the tightened prompt wording, confirm the violation message is accurate and would have been caught) — this is the one item where "the model still gets it wrong sometimes and the check catches it" is an ACCEPTABLE outcome (the goal was measurability, not a hard guarantee), but a total mismatch is not — spot-check 2–3 interval sessions' workoutText against their durationMin by hand.
- **Task 3:** skipped — no check.
- **Durability template (Task 4):** confirm `plan.durabilityTemplate` reflects a goal-aware pick (should be `B` given this athlete's real stated goals, absent a stronger insight-driven override) rather than defaulting to `A`.
- **Event surfacing (Task 5):** if a B/C-priority event exists in `data/season-plan.json` within the block's date range at the time of this run, confirm that specific day's generated session is NOT a generic filler — read its `name`/`workoutText` and confirm it acknowledges the event (e.g., an easy/rest day ahead of a test, or the test itself if the athlete intends it as a session).
- **Season disabled from generation (Task 6):** grep the raw prompt sent to the model (or re-derive from `buildSystemPrompt`'s inputs) and confirm no season-phase/period text (e.g. "season period", "phase: build") reached it, while confirming `data/season-plan.json`'s `updatedAt`/periods DID still update from this call (background tracking preserved) and no `Season fit`/focus-match warning appears in `plan.warnings`.
- The generation itself completed end-to-end (no 502) — proving the prompt changes hold on the live path.

If anything reads wrong, fix forward with a targeted commit — do not ship on green units alone.

- [ ] **Step 3: Final commit (only if Step 2 forced fixes)**

```bash
cd "/Users/otis/Cycling App"
git add <only-the-files-you-touched>
git commit -m "fix: <what the live smoke run surfaced>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Record in ARCHIVE.md**

Add an entry (following the established format — see the "Training-engine redesign" entry already at the top of `ARCHIVE.md` for the exact style) summarizing the four shipped fixes (Tasks 1, 2, 4, 5), Task 3's skip and why, and Task 6's temporary season-disable flag (name it explicitly, `SEASON_SHAPES_GENERATION` in `lib/season.ts`, so it's easy to find when revisiting). Remove/update any now-stale ROADMAP.md items this plan resolves, and add a ROADMAP.md note under the existing "Season architecture doubt" / "Season engine — known debt" context that generation currently runs with season shaping switched off pending that revisit.

- [ ] **Step 5: Push**

```bash
cd "/Users/otis/Cycling App"
git push
```

---

## Requirement coverage map (self-review)

| Spec requirement | Task |
|---|---|
| 1. Deload cadence — genuine rolling calendar-week count, not per-period | Task 1 |
| 2. Workout-duration self-consistency (NodeVelo vs. Intervals.icu real time) | Task 2 |
| 3. Goal-vs-season-phase precedence rule | **SKIPPED** (2026-07-16 amendment — moot once season-phase text is disabled) |
| 4. Goal-aware durability template selection (insight still wins outright) | Task 4 |
| 5. B/C-priority event surfacing into generation | Task 5 |
| Season phase-sequence architecture untouched | Global Constraints + every task's own scope |
| Season temporarily disabled from shaping/gating generation (2026-07-16 amendment) | Task 6 |
| `npm run check` clean + live smoke run (AGENTS.md rule) | Task 7 |

Known cross-task note: Task 4's route wiring (Step 5) should check whether the existing season-replan block's `goalText` construction can be reused rather than duplicated (Task 3 is skipped, so no such construction exists from it) — read the live file at execution time, since exact locals in scope may have shifted since this plan was written.
