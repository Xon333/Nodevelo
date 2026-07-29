# Block Generation — Phase A Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the recovery-week composition defect and three adjacent silent-degradation bugs in `/api/generate`, so a recovery week actually reduces quality *density* (not just hours) and the season layer can no longer go dark without saying so.

**Architecture:** Phase A of a two-phase plan. Phase A is prompt + validator + orchestration corrections only — no new architecture. It deliberately does NOT build the deterministic `WeekSkeleton` (that's Phase B, planned separately). Three commit groups, executed in order: **orchestration** (route.ts, must be first — later tasks depend on focus being non-null), then **validators** (pure functions), then **prompt** (needs a live smoke run).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest 4. No new dependencies.

**Research backing:** `https://claude.ai/code/artifact/1e56ae63-5bf6-4012-84b5-7a992b8921e7` (two-pass research report — root causes, edge-case audit, external references).

## Global Constraints

- **Test baseline is 1394 passing tests in 91 files, ~3.1s** (`npm test`). Every task must leave the suite green. If a task's own change legitimately alters an existing assertion, update that assertion in the same task — never delete a test to make it pass.
- **Warn-only contract (ADR-0004).** Exactly two mutations are sanctioned in this pipeline: `reconcileDurationMin` and `repairNutrition`. **No task in this plan adds a third.** Every new validator returns `string[]` and mutates nothing.
- **Do NOT clamp `durationMin`.** `reconcileDurationMin` (`lib/prescription.ts:196-202`) already overwrites it with the real step-sum (HR-19). Any additional duration mutation reopens that bug.
- **Local dates only.** Use `resolveToday()` / `localToday()` from `lib/date.ts` for "what day is it now"; never inline `new Date().toISOString().slice(0,10)`.
- **Migration-flag rule.** Any new persisted field is guarded with a truthy check (`if (x)`), never `=== null`.
- **Concurrent session warning.** This working directory is shared. `ROADMAP.md` and `todo.md` currently have uncommitted modifications that are NOT yours — do not revert, stage, or "fix" them. Stage only files you personally touched (`git add <path>`), never `git add -A`.
- **Commit style:** small and atomic, one per task. End messages with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Never edit** `CONTINUE.md` or any existing file under `docs/superpowers/plans/` (immutable records).

## Execution Order & Parallelism

Tasks are numbered in **mandatory execution order**. Two hard dependencies:

1. **Task 1 must precede Task 7.** Task 7 rewrites `formatRecoveryWeeks` to name which quality type survives — which requires a non-null `SeasonFocus`. Task 1 is what guarantees focus is always computed. Doing 7 first means writing null-handling that Task 1 immediately makes dead.
2. **Tasks 1 and 2 both edit `app/api/generate/route.ts`** and must not run concurrently.

Tasks 3–6 are pure-function work across three different files and could parallelize if you deviate from sequential execution. Tasks 3, 4, 5 all touch `lib/schedule-validate.ts` — if parallelizing, treat those three as one serial chain.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `app/api/generate/route.ts` | Orchestration: what deterministic context reaches the prompt | 1, 2, 3, 8 |
| `app/api/generate/route.test.ts` | Integration proof that wiring is live (mocks IO + LLM, runs real validators) | 1, 2, 8 |
| `lib/block-skeleton.ts` | Recovery-week shape constants (cycle-safe shared home) | 4 |
| `lib/schedule-validate.ts` | Placement validators — spacing, budgets, taper, recovery density | 3, 4, 5 |
| `lib/schedule-validate.test.ts` | Unit tests for the above | 3, 4, 5 |
| `lib/season.ts` | Focus/recovery prompt builders + focus cadence validator | 6, 7 |
| `lib/season.test.ts` | Unit tests for the above | 6, 7 |
| `lib/durability.ts` | Long-ride template selection + prompt line | 8 |
| `lib/durability.test.ts` | Unit tests for the above | 8 |
| `lib/anthropic-api.ts` | `PROMPT_VERSION` | 9 |
| `lib/anthropic-prompts.test.ts` | Exact-string prompt assertions (these ARE the prompt spec) | 9 |

**Why `RECOVERY_QUALITY_CAP` lives in `lib/block-skeleton.ts`:** both `season.ts` and `schedule-validate.ts` need it. `season.ts` already imports `WeekTarget` from `block-skeleton`, and `block-skeleton` imports nothing from either — verified no import cycle. Note this upgrades season.ts's existing *type-only* import to a value import.

---

### Task 1: Run focus selection on both season branches (EC-9)

**The bug:** `rollingFocusChoice = chooseNextFocus(focusInputs)` sits only in the `else` of `if (aEventForBlock)`. With `SEASON_SHAPES_GENERATION = false` (today's shipped state), an A-priority event on the calendar means: no focus context in the prompt, `validateBlockFocus` + `validatePrimaryQualityCadence` never run, and `GeneratedPlan.seasonFocus` is never stamped — which also degrades the *next* block's no-back-to-back-focus rule. A comment at `route.ts:276-278` currently claims the opposite.

**Files:**
- Modify: `app/api/generate/route.ts:253-280`
- Test: `app/api/generate/route.test.ts`

**Interfaces:**
- Consumes: `chooseNextFocus(focusInputs)` — already imported; `focusInputs` is already awaited at `route.ts:214`, *outside* the try block, so it is available unconditionally.
- Produces: `rollingFocusChoice` is non-null on every successful path. **Task 7 depends on this.**

- [ ] **Step 1: Write the failing test**

Add to `app/api/generate/route.test.ts`, inside the existing `describe("POST /api/generate — season wiring (multi-period blocks)")` block:

```ts
  it("EC-9: an A-priority event does NOT silently disable rolling focus selection", async () => {
    // Before this fix, chooseNextFocus lived only in the else-branch of `if (aEventForBlock)`.
    // With SEASON_SHAPES_GENERATION off, an A-event meant NEITHER the event arc (flag-gated) NOR
    // the rolling focus ran — the prompt lost its BLOCK FOCUS line, two validators went dark, and
    // seasonFocus was never stamped (breaking the next block's variety rule too).
    vi.mocked(store.readSeasonPlan).mockResolvedValue({
      objective: "",
      events: [{ name: "Nationals", date: "2026-09-05", priority: "A", type: "road-race" }],
      periods: [],
      updatedAt: "",
    } as never);
    const res = await POST(
      new Request("http://t/api/generate", {
        method: "POST",
        body: JSON.stringify({ lengthWeeks: 2, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
      })
    );
    const json = await res.json();
    const dynamic = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][1];
    expect(dynamic).toContain("BLOCK FOCUS:");
    expect(json.plan.seasonFocus).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- route.test.ts -t "EC-9"`
Expected: FAIL — `dynamic` does not contain `"BLOCK FOCUS:"` (the A-event routes past the rolling branch).

- [ ] **Step 3: Implement**

Hoist the call **fully outside the season `try` block**, not merely above the inner `if`. `chooseNextFocus` is pure and `focusInputs` is already awaited at `:214`, outside the try — so it has no dependency on `season-plan.json` and does not belong inside a catch that exists to tolerate season-plan failures. The whole handler body is already wrapped in an outer try/catch returning a 502, so a genuine throw here surfaces loudly instead of silently degrading, matching `checkBlockFeasibility`'s "fail before spending an LLM call" posture. Task 2 hoists the recovery computation into the same region and depends on this placement.

In `app/api/generate/route.ts`, find the line that opens the season block (around `:243`):

```ts
    let recoveryWeekIndices: number[] = [];
    try {
```

Insert the hoisted assignment and its comment immediately **above** `try {`:

```ts
    // Tracked underneath the flag, same as season-plan.json itself (SEASON_SHAPES_GENERATION only
    // gates the prompt/validator OPINION, never the tracking). This must run unconditionally: it used
    // to sit inside the else of `if (aEventForBlock)` below, so an A-priority event on the calendar
    // silently skipped focus selection entirely — and with the flag off (today's state) that meant the
    // event arc was gated AND the rolling focus never ran, so seasonContext stayed "",
    // validateBlockFocus and validatePrimaryQualityCadence never fired, and GeneratedPlan.seasonFocus
    // was never stamped (degrading the NEXT block's no-back-to-back rule too). The old comment there
    // claimed this "always runs regardless of the flag" — true only of the branch it sat in.
    // Pure, and focusInputs is already resolved above, so it sits outside the season try/catch: a
    // throw here is a real failure worth a 502, not something to degrade past in silence.
    rollingFocusChoice = chooseNextFocus(focusInputs);

```

Then delete the old assignment + comment from the `else` branch. The `else` branch's final three lines change from:

```ts
        replannedSeason = settleSeasonHistory(existingSeason, achievedTssFor, today);
        recoveryWeekIndices = allRecoveryIndices;
        // Tracked underneath the flag, same as season-plan.json itself (SEASON_SHAPES_GENERATION only
        // gates the prompt/validator opinion, never the tracking) — chooseNextFocus always runs so
        // GeneratedPlan.seasonFocus (write-time provenance) and the next call's no-back-to-back rule
        // both stay live regardless of the flag.
        rollingFocusChoice = chooseNextFocus(focusInputs);
      }
```

to:

```ts
        replannedSeason = settleSeasonHistory(existingSeason, achievedTssFor, today);
        recoveryWeekIndices = allRecoveryIndices;
      }
```

Leave `let rollingFocusChoice: import("@/lib/season").FocusChoice | null = null;` declared as-is. Keeping the `| null` type (rather than switching to a non-null `const`) keeps the existing `else if (rollingFocusChoice)` and `...(rollingFocusChoice ? { seasonFocus } : {})` guards compiling untouched — they simply become always-true at runtime, which is the intended behavior. This is why Task 7's call site still carries a `?? "aerobic-base"` narrowing guard that never fires in practice.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- route.test.ts`
Expected: PASS, all tests in the file. Then `npm test` — expected 1395 passing.

- [ ] **Step 5: Commit**

```bash
git add app/api/generate/route.ts app/api/generate/route.test.ts
git commit -m "fix(generate): run chooseNextFocus on both season branches

An A-priority event on the calendar silently skipped focus selection:
with SEASON_SHAPES_GENERATION off, neither the (gated) event arc nor
the rolling focus ran, so the prompt lost its BLOCK FOCUS line,
validateBlockFocus/validatePrimaryQualityCadence never fired, and
seasonFocus was never stamped - degrading the next block's variety
rule too. The comment claiming this 'always runs' was true only of
the branch it sat in.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Stop recovery weeks and events vanishing on a season exception (EC-3, EC-12)

**The bug:** `recoveryWeekIndices` defaults to `[]` and is only assigned inside the season `try` block. If anything in that block throws — a hand-edited malformed date in `data/season-plan.json` makes `addWeeks`'s `Date.parse` return `NaN`, and `new Date(NaN).toISOString()` throws `RangeError` — the block silently gets **zero recovery weeks**, no recovery instruction reaches the model, and `validateWeekHours` can't flag it (it measures against the wrong target). The existing comment at `route.ts:313-315` claims `computeWeekTargets` is outside the try "so it degrades safely (`recoveryWeekIndices` defaults to `[]`)" — but defaulting to `[]` *is* the silent failure. This task finishes the refactor that comment started.

The recovery computation has **no dependency on `season-plan.json`** — `realWeeksSinceLastRecovery` reads the score log, `planRecoveryWeeks` is pure arithmetic. Same for `formatUpcomingEventsForBlock`, which needs only `existingSeason.events` and `weeks`.

**Files:**
- Modify: `app/api/generate/route.ts:242-309`, and the warnings assembly around `:391`
- Test: `app/api/generate/route.test.ts`

**Interfaces:**
- Consumes: `realWeeksSinceLastRecovery`, `planRecoveryWeeks`, `formatUpcomingEventsForBlock` (all already imported).
- Produces: `recoveryWeekIndices` is correct-by-default even when the season replan throws; `seasonDegradedWarnings: string[]` is folded into the plan's `warnings`.

- [ ] **Step 1: Write the failing test**

Add to `app/api/generate/route.test.ts`:

```ts
describe("POST /api/generate — season layer degradation (EC-3)", () => {
  it("still plans recovery weeks and surfaces a warning when the season replan throws", async () => {
    // A malformed period date makes addWeeks' Date.parse return NaN, and new Date(NaN).toISOString()
    // throws RangeError inside settleSeasonHistory. Before this fix, recoveryWeekIndices silently
    // stayed [] -> zero recovery weeks in the block, no RECOVERY instruction in the prompt, and
    // validateWeekHours measuring every week against the loading target. Only a server log said so.
    vi.mocked(store.readSeasonPlan).mockResolvedValue({
      objective: "",
      events: [],
      periods: [
        { focus: "threshold", phase: "build", startDate: "not-a-date", plannedWeeks: 3, intensitySplit: "80/20", targetWeeklyTss: null, deloadWeek: false, rationale: "x", source: "derived", confidence: "medium" },
      ],
      updatedAt: "",
    } as never);
    // weeksSinceRecovery is derived from an empty score log -> hits the lookback cap, so a 4-week
    // block is guaranteed at least one recovery week (planRecoveryWeeks(n>=0, 4) always fires).
    const res = await POST(
      new Request("http://t/api/generate", {
        method: "POST",
        body: JSON.stringify({ lengthWeeks: 4, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
      })
    );
    const json = await res.json();
    const [, dynamic, userMessage] = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0];
    expect(userMessage).toContain("RECOVERY"); // the hour-target table still labels the week
    expect(dynamic).toContain("RECOVERY:"); // and the recovery instruction still reaches the model
    expect(json.plan.warnings.some((w: string) => /season/i.test(w))).toBe(true); // athlete-visible
  });
});
```

Both assertions matter and they cover different halves: `userMessage` carries the hour-target table (proving `computeWeekTargets` saw the indices), `dynamic` carries `formatRecoveryWeeks`' instruction (proving the line survived the exception).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- route.test.ts -t "EC-3"`
Expected: FAIL — no `RECOVERY` row in the hour targets, and no season warning surfaced.

- [ ] **Step 3: Implement**

In `app/api/generate/route.ts`, replace the declaration line and the opening of the try block. Currently:

```ts
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
```

Becomes:

```ts
    // EC-3 / EC-12: these three computations depend ONLY on the score log, the rolling baselines and
    // this block's own params — never on season-plan.json. They used to live inside the try below, so
    // any throw in the season replan (e.g. a hand-edited malformed date making addWeeks' Date.parse
    // return NaN) silently produced a block with ZERO recovery weeks and no event callout, announced
    // by nothing but a server log. The pre-existing comment above computeWeekTargets claimed that
    // defaulting to [] "degrades safely" — it doesn't; [] is the silent failure. Hoisted so the
    // correct value survives a season-layer failure.
    const avgWeeklyTss = baselines.avgTss90d != null ? baselines.avgTss90d * 7 : null;
    const weeksSinceRecovery = realWeeksSinceLastRecovery(scoreLog.entries, avgWeeklyTss, today);
    const allRecoveryIndices = planRecoveryWeeks(weeksSinceRecovery, blockParams.lengthWeeks, !!(signals.loadRamp?.triggered));
    // Default to the UNFILTERED set: the event-arc branch below narrows it to base/build phases, but
    // if that branch throws we want the plain cadence answer, not none at all.
    let recoveryWeekIndices: number[] = allRecoveryIndices;

    const blockEndDate = weeks[weeks.length - 1][weeks[weeks.length - 1].length - 1];
    const upcomingEventsLine = formatUpcomingEventsForBlock(existingSeason.events, { startDate: blockParams.startDate, endDate: blockEndDate });
    if (upcomingEventsLine) upcomingEventsContext = `\n${upcomingEventsLine}`;

    // Athlete-visible record that the season layer degraded — folded into plan.warnings below.
    const seasonDegradedWarnings: string[] = [];

    try {
      const achievedTssFor = (p: import("@/lib/types").FocusPeriod) => achievedTssForPeriod(scoreLog.entries, p);
      aEventForBlock = findUpcomingAEvent(existingSeason.events, today);

      if (aEventForBlock) {
```

Then **delete** the now-duplicated event-line block that remains inside the try (the three lines computing `blockEnd` / `upcomingEventsLine` / `upcomingEventsContext`).

Then update the catch:

```ts
    } catch (err) {
      logWarn("/api/generate", "season-replan", err instanceof Error ? err.message : String(err)); // best-effort
      seasonDegradedWarnings.push(
        "SEASON: the season layer failed to update for this block — recovery-week placement and the event callout still applied, but season phase tracking did not. Check data/season-plan.json for a malformed date."
      );
    }
```

Next, **move the recovery-line rendering from inside the try to just after the catch.** Delete these two lines from inside the try (they currently sit at the end of it):

```ts
      const recoveryLine = formatRecoveryWeeks(recoveryWeekIndices, blockParams.lengthWeeks);
      if (recoveryLine) recoveryContext = `\n${recoveryLine}`;
```

and re-add them immediately **below** the closing `}` of the catch:

```ts
    // Rendered after the try/catch, not inside it: by this point recoveryWeekIndices holds the
    // event-arc-filtered set if that branch ran, and the plain cadence set otherwise — including
    // after a throw. Computing it here means a season-plan failure loses the season PHASE text but
    // never the recovery-week instruction itself.
    const recoveryLine = formatRecoveryWeeks(recoveryWeekIndices, blockParams.lengthWeeks);
    if (recoveryLine) recoveryContext = `\n${recoveryLine}`;
```

Do **not** hoist this one above the try: the `aEventForBlock` branch narrows `recoveryWeekIndices` to base/build phases, and rendering before that filter runs would announce recovery weeks the arc deliberately removed. After the catch is the only placement correct on all three paths.

Finally, fold the collector into the plan's warnings. Find:

```ts
    const warnings: string[] = [...nutritionRepair.repairs];
```

and change it to:

```ts
    const warnings: string[] = [...seasonDegradedWarnings, ...nutritionRepair.repairs];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- route.test.ts`
Expected: PASS. Then `npm test` — expected 1396 passing.

- [ ] **Step 5: Commit**

```bash
git add app/api/generate/route.ts app/api/generate/route.test.ts
git commit -m "fix(generate): recovery weeks survive a season-replan exception

recoveryWeekIndices defaulted to [] and was only assigned inside the
season try/catch, so any throw there (a malformed season-plan.json
date reaches addWeeks -> RangeError) silently produced a block with
zero recovery weeks and no event callout - visible only in a server
log. Both computations depend solely on the score log and this
block's own params, so they hoist out cleanly. The catch now also
surfaces an athlete-visible warning.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Harden `validateEventTaper` — embedded intensity and multi-event weeks (A7, EC-1)

**Two bugs in one function.** (a) The final-days clean-window check calls the narrow `isQuality(d)` instead of the broader `isHardDay(...)` already used for spacing at `:62` — so a durability long-ride carrying embedded threshold work the day before a B-priority event passes clean. This is the live-confirmed P4/P5 gap. (b) Both halves of the function scan *all* days including **other events' days**, so back-to-back weekend races flag each other: checking Sunday's window, Saturday's race (typed `RaceSim`) reads as "a quality session 1 day before it."

**Files:**
- Modify: `lib/schedule-validate.ts:102-135`
- Modify: `app/api/generate/route.ts` (the `validateEventTaper` call site)
- Test: `lib/schedule-validate.test.ts`

**Interfaces:**
- Consumes: `isHardDay(day, ftp, embeddedHardPct)` (`:33-35`), `resolveDurabilityInsertEnvelope` (already imported at `:14`).
- Produces: `validateEventTaper(days, events, ftp, settings)` — **signature widened by two params.** Task 8's route edits must not revert this.

- [ ] **Step 1: Write the failing test**

Add to `lib/schedule-validate.test.ts`:

```ts
describe("validateEventTaper — embedded intensity + multi-event weeks", () => {
  const ev = (date: string, name: string) => ({ name, date, priority: "B" as const, type: "road-race" as const });

  it("A7: flags a durability long ride with embedded threshold work the day before an event", () => {
    // isQuality() only sees the TYPE (Z2), missing 3x10min @ 95% buried in the workout text.
    const days: PlannedDay[] = [
      { date: "2026-06-19", weekNumber: 1, weekTheme: "t", name: "Long", type: "Z2", durationMin: 240, workoutText: "- 120m 65%\nMain Set 3x\n- 10m 95%\n- 5m 55%", description: "x" },
      { date: "2026-06-20", weekNumber: 1, weekTheme: "t", name: "Race", type: "RaceSim", durationMin: 120, workoutText: "- 120m 85%", description: "x" },
    ];
    const w = validateEventTaper(days, [ev("2026-06-20", "KOM")], 250, DEFAULT_BLOCK_SETTINGS);
    expect(w.some((s) => /EVENT TAPER/.test(s) && /embedded/i.test(s))).toBe(true);
  });

  it("EC-1: back-to-back race days do not flag each other as taper violations", () => {
    const days: PlannedDay[] = [
      { date: "2026-06-20", weekNumber: 1, weekTheme: "t", name: "Sat race", type: "RaceSim", durationMin: 120, workoutText: "- 120m 85%", description: "x" },
      { date: "2026-06-21", weekNumber: 1, weekTheme: "t", name: "Sun race", type: "RaceSim", durationMin: 120, workoutText: "- 120m 85%", description: "x" },
    ];
    const w = validateEventTaper(days, [ev("2026-06-20", "Sat"), ev("2026-06-21", "Sun")], 250, DEFAULT_BLOCK_SETTINGS);
    expect(w).toEqual([]);
  });
});
```

Ensure the file's imports include `validateEventTaper` and `DEFAULT_BLOCK_SETTINGS`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- schedule-validate.test.ts -t "validateEventTaper — embedded"`
Expected: FAIL — first test finds no embedded warning; second returns two false warnings.

- [ ] **Step 3: Implement**

Replace `validateEventTaper` in `lib/schedule-validate.ts` (currently `:102-135`) with:

```ts
export function validateEventTaper(
  days: PlannedDay[],
  events: SeasonEvent[],
  ftp: number,
  settings: BlockSettings
): string[] {
  if (days.length === 0 || events.length === 0) return [];
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((d) => [d.date, d]));
  const warnings: string[] = [];
  // Same resolved floor validateSchedule uses, so the two agree on what counts as embedded hard work.
  const embeddedHardPct = resolveDurabilityInsertEnvelope(settings.durabilityInsertEnvelope).embeddedHardPct;
  // EC-1: every event's own day is protected training, not a taper breach. A second race in the same
  // week must never read as "a quality session N days before" the first, in either direction.
  const eventDates = new Set(events.map((e) => e.date));

  for (const event of events.filter((e) => e.priority !== "A").sort((a, b) => a.date.localeCompare(b.date))) {
    const eventDay = byDate.get(event.date);
    if (!eventDay) continue; // the event falls outside this block's own generated days

    // (a) the final QUALITY_FREE_DAYS_BEFORE_EVENT calendar days before the event must carry no hard
    // work. A7: isHardDay, not isQuality — an endurance ride with embedded threshold/VO2 efforts is
    // exactly what a taper must exclude, and the narrow type-only check missed it (live-confirmed).
    for (const d of sorted) {
      if (eventDates.has(d.date)) continue; // another event's own day — not a training breach
      const gap = daysBetween(d.date, event.date);
      if (gap >= 1 && gap <= QUALITY_FREE_DAYS_BEFORE_EVENT && isHardDay(d, ftp, embeddedHardPct)) {
        warnings.push(
          `EVENT TAPER: ${event.name} (priority ${event.priority}) on ${event.date} has a hard session (${hardLabel(d)}) ${gap} day${gap > 1 ? "s" : ""} before it — keep the final ${QUALITY_FREE_DAYS_BEFORE_EVENT} days free of hard work so the taper actually protects the event.`
        );
      }
    }

    // (b) the event's own week shouldn't carry more quality work than the cap, beyond the event
    // session itself (a RaceSim/priority effort ON the event day is the point, not a budget breach).
    // EC-1: exclude EVERY event day, not just this one — two legitimate same-week races previously
    // counted against each other.
    const otherQuality = sorted.filter(
      (d) => d.weekNumber === eventDay.weekNumber && !eventDates.has(d.date) && isQuality(d)
    );
    if (otherQuality.length > EVENT_WEEK_QUALITY_CAP) {
      warnings.push(
        `EVENT TAPER: ${event.name} (priority ${event.priority}) week carries ${otherQuality.length} other quality session(s) besides the event itself — cap it at ${EVENT_WEEK_QUALITY_CAP} to protect the taper.`
      );
    }
  }

  return warnings;
}
```

Then update the call site in `app/api/generate/route.ts`. Find:

```ts
    warnings.push(...validateEventTaper(days, existingSeason.events));
```

Replace with:

```ts
    warnings.push(...validateEventTaper(days, existingSeason.events, profile.performance.ftp, blockSettings));
```

- [ ] **Step 4: Update the 11 existing call sites, then run tests**

`ftp` and `settings` are **required**, not optional — `ftp` has no sane default and is a hard input to the intensity check. That means every existing `validateEventTaper(...)` call in `lib/schedule-validate.test.ts` currently passes 2 args and **will fail to compile**. There are 11, at roughly lines 142, 148, 154, 160, 169, 175, 181, 187, 191, 192 (one line holds two calls). Update each from:

```ts
validateEventTaper(days, [kom()])
```

to:

```ts
validateEventTaper(days, [kom()], 250, DEFAULT_BLOCK_SETTINGS)
```

preserving each call's own `days`/events arguments. Add `DEFAULT_BLOCK_SETTINGS` to the file's imports from `./types` if not already present. This is mechanical — do not change any assertion's expected value while doing it.

Then run: `npm test -- schedule-validate.test.ts`
Expected: PASS. Then `npm test` — all green. One pre-existing assertion will legitimately need its expected text updated: the warning wording changed from "has a quality session" to "has a hard session". Update that string; do not weaken the assertion.

- [ ] **Step 5: Commit**

```bash
git add lib/schedule-validate.ts lib/schedule-validate.test.ts app/api/generate/route.ts
git commit -m "fix(validate): event taper sees embedded intensity and other events

Two bugs in validateEventTaper. (a) The clean-window check used the
narrow isQuality() instead of isHardDay(), so a durability long ride
with embedded threshold work the day before a B-event passed clean -
the live-confirmed P4/P5 gap. (b) Both halves scanned other events'
days, so back-to-back race weekends flagged each other.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Per-week quality budget, recovery-aware and event-excluding (A4, EC-11)

**The bug:** `validateSchedule` applies the flat loading-week budget to *every* week and counts event days against it, while `validateEventTaper` uses a different cap and excludes the event — two validators enforcing inconsistent budgets over the same week. Its own comment at `:69-71` states the assumption the reviewed block falsified: *"A recovery week naturally sits under the budget, so only over-prescribed weeks fire."*

**Files:**
- Modify: `lib/block-skeleton.ts` (add + export `RECOVERY_QUALITY_CAP`)
- Modify: `lib/schedule-validate.ts:48-95`
- Modify: `app/api/generate/route.ts` (the `validateSchedule` call site)
- Test: `lib/schedule-validate.test.ts`

**Interfaces:**
- Consumes: `WeekTarget` (`lib/block-skeleton.ts:53-57`) — has `weekNumber` (1-indexed), `isRecovery`, `targetHours`.
- Produces: `export const RECOVERY_QUALITY_CAP = 1` in `lib/block-skeleton.ts` — **Tasks 5 and 7 import this.** `validateSchedule(days, settings, ftp, weekTargets?, events?)` — two new **optional** params so the ~15 existing test call sites compile unchanged.

**On the deliberate asymmetry with Task 3** (which made its new params required): these two are optional because both have a genuine, correct empty-set meaning — `[]` week targets means "no recovery weeks known, apply the loading budget everywhere", and `[]` events means "no events to exclude". Both degrade to exactly today's behavior. Task 3's `ftp` has no such sane default, which is why it is required there. Keep this asymmetry; it is reasoned, not an oversight.

- [ ] **Step 1: Write the failing test**

Add to `lib/schedule-validate.test.ts`:

```ts
describe("validateSchedule — per-week budget (EC-11)", () => {
  const q = (date: string, weekNumber: number, type: "Threshold" | "SIT" | "RaceSim"): PlannedDay =>
    ({ date, weekNumber, weekTheme: "t", name: type, type, durationMin: 60, workoutText: "- 10m 95%", description: "x" });

  it("applies the recovery cap, not the loading budget, to a recovery week", () => {
    // Two quality sessions is legal in a loading week and over-budget in a recovery week.
    const days = [q("2026-06-16", 1, "Threshold"), q("2026-06-18", 1, "SIT")];
    const targets = [{ weekNumber: 1, isRecovery: true, targetHours: 7.2 }];
    const w = validateSchedule(days, DEFAULT_BLOCK_SETTINGS, 250, targets);
    expect(w.some((s) => /week 1 has 2 quality sessions/.test(s))).toBe(true);
  });

  it("does not count an event day against the week's quality budget", () => {
    const days = [q("2026-06-16", 1, "Threshold"), q("2026-06-18", 1, "SIT"), q("2026-06-20", 1, "RaceSim")];
    const targets = [{ weekNumber: 1, isRecovery: false, targetHours: 12 }];
    const events = [{ name: "KOM", date: "2026-06-20", priority: "B" as const, type: "road-race" as const }];
    const w = validateSchedule(days, DEFAULT_BLOCK_SETTINGS, 250, targets, events);
    expect(w.some((s) => /quality sessions/.test(s))).toBe(false); // 3 days, but the race isn't budgeted
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- schedule-validate.test.ts -t "per-week budget"`
Expected: FAIL — first test produces no warning (flat budget of 2 not exceeded); second produces one.

- [ ] **Step 3: Implement**

First, in `lib/block-skeleton.ts`, immediately below the existing `RECOVERY_RETENTION_PCT` declaration (`:63`), add:

```ts
// A recovery week's quality-session CEILING (not a target). KB cycling_database.md:225 pairs its
// 30–50% volume cut with "drop intensity slightly"; TrainerRoad's recovery-week guidance drops high
// intensity entirely; Friel/Roadman keep at most one short quality touch early in the week. The
// volume lever (RECOVERY_RETENTION_PCT above) was already enforced; this is the composition lever
// that was missing entirely — the reviewed 2026-07 block kept all three quality types in its
// "recovery" week, just trimmed. Imported by schedule-validate.ts and season.ts.
export const RECOVERY_QUALITY_CAP = 1;
```

Then in `lib/schedule-validate.ts`, add to the imports at the top:

```ts
import { RECOVERY_QUALITY_CAP, type WeekTarget } from "./block-skeleton";
```

Replace the `validateSchedule` signature and its section (b). The signature becomes:

```ts
export function validateSchedule(
  days: PlannedDay[],
  settings: BlockSettings,
  ftp: number,
  weekTargets: WeekTarget[] = [],
  events: SeasonEvent[] = []
): string[] {
```

And section (b) — currently the block starting `// (b) Weekly quality budget:` — becomes:

```ts
  // (b) Weekly quality budget, per week. EC-11: this used to apply the flat loading-week budget to
  // EVERY week, with a comment asserting "a recovery week naturally sits under the budget, so only
  // over-prescribed weeks fire" — the assumption the 2026-07 reviewed block falsified by keeping a
  // full loading-week quality skeleton in its recovery week. Event days are excluded so this agrees
  // with validateEventTaper rather than double-counting a protected race against the budget.
  const recoveryWeeks = new Set(weekTargets.filter((t) => t.isRecovery).map((t) => t.weekNumber));
  const eventDates = new Set(events.map((e) => e.date));
  const byWeek = new Map<number, PlannedDay[]>();
  for (const d of sorted) {
    const list = byWeek.get(d.weekNumber);
    if (list) list.push(d);
    else byWeek.set(d.weekNumber, [d]);
  }
  for (const [week, weekDays] of [...byWeek.entries()].sort((a, b) => a[0] - b[0])) {
    const budget = recoveryWeeks.has(week) ? RECOVERY_QUALITY_CAP : settings.qualitySessionsPerLoadingWeek;
    const quality = weekDays.filter((d) => isQuality(d) && !eventDates.has(d.date));
    if (quality.length > budget) {
      const label = recoveryWeeks.has(week) ? "recovery" : "loading";
      warnings.push(
        `SCHEDULE: week ${week} has ${quality.length} quality sessions (${quality
          .map((d) => d.type)
          .join(", ")}) — over the ${budget}/week budget for a ${label} week.`
      );
    }
  }
```

Finally, update the call site in `app/api/generate/route.ts`. Find:

```ts
    warnings.push(...validateSchedule(days, blockSettings, profile.performance.ftp));
```

Replace with:

```ts
    warnings.push(...validateSchedule(days, blockSettings, profile.performance.ftp, weekTargets, existingSeason.events));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- schedule-validate.test.ts`
Expected: PASS. Then `npm test`. Existing `validateSchedule` tests that assert the old budget wording (`over the 2/week budget.`) will need the ` for a loading week` suffix added — update them.

- [ ] **Step 5: Commit**

```bash
git add lib/block-skeleton.ts lib/schedule-validate.ts lib/schedule-validate.test.ts app/api/generate/route.ts
git commit -m "fix(validate): per-week quality budget, recovery-aware

validateSchedule applied the flat loading-week budget to every week -
its own comment asserted a recovery week 'naturally sits under the
budget', which the reviewed block falsified. Event days are now
excluded so this agrees with validateEventTaper instead of counting a
protected race against the budget.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: New `validateRecoveryWeekDensity` (A3)

**The gap:** there is a *minimum* quality check for loading weeks (`validatePrimaryQualityCadence`) and, after Task 4, a *maximum* count. Neither catches intensity hidden inside an endurance ride — the exact evasion that made the reviewed recovery week's long ride carry 2×10min @ 95%. `carriesEmbeddedIntensity` already exists and is already wired into spacing; it has never been applied to recovery weeks.

**Files:**
- Modify: `lib/schedule-validate.ts` (append the new export)
- Modify: `app/api/generate/route.ts` (wire it in)
- Test: `lib/schedule-validate.test.ts`

**Interfaces:**
- Consumes: `RECOVERY_QUALITY_CAP` (Task 4), `carriesEmbeddedIntensity`, `resolveDurabilityInsertEnvelope`, `WeekTarget`.
- Produces: `validateRecoveryWeekDensity(days, weekTargets, settings, ftp, events)` → `string[]`.

- [ ] **Step 1: Write the failing test**

```ts
describe("validateRecoveryWeekDensity", () => {
  const target = [{ weekNumber: 1, isRecovery: true, targetHours: 7.2 }];

  it("flags an endurance ride carrying embedded threshold work in a recovery week", () => {
    const days: PlannedDay[] = [
      { date: "2026-06-20", weekNumber: 1, weekTheme: "t", name: "Long", type: "Z2", durationMin: 160, workoutText: "- 105m 65%\nMain Set 2x\n- 10m 95%\n- 5m 55%", description: "x" },
    ];
    const w = validateRecoveryWeekDensity(days, target, DEFAULT_BLOCK_SETTINGS, 250, []);
    expect(w.some((s) => /RECOVERY DENSITY/.test(s) && /embedded/i.test(s))).toBe(true);
  });

  it("EC-2: does not count a race that falls inside a recovery week", () => {
    // A B-priority event IS the week's one retained intensity touch — not a density breach.
    const days: PlannedDay[] = [
      { date: "2026-06-20", weekNumber: 1, weekTheme: "t", name: "Race", type: "RaceSim", durationMin: 90, workoutText: "- 90m 85%", description: "x" },
      { date: "2026-06-17", weekNumber: 1, weekTheme: "t", name: "Opener", type: "Threshold", durationMin: 50, workoutText: "Main Set 3x\n- 3m 95%\n- 3m 55%", description: "x" },
    ];
    const events = [{ name: "KOM", date: "2026-06-20", priority: "B" as const, type: "road-race" as const }];
    expect(validateRecoveryWeekDensity(days, target, DEFAULT_BLOCK_SETTINGS, 250, events)).toEqual([]);
  });

  it("ignores loading weeks entirely", () => {
    const days: PlannedDay[] = [
      { date: "2026-06-16", weekNumber: 1, weekTheme: "t", name: "A", type: "Threshold", durationMin: 60, workoutText: "- 10m 95%", description: "x" },
      { date: "2026-06-18", weekNumber: 1, weekTheme: "t", name: "B", type: "SIT", durationMin: 50, workoutText: "- 30s 200%", description: "x" },
    ];
    expect(validateRecoveryWeekDensity(days, [{ weekNumber: 1, isRecovery: false, targetHours: 12 }], DEFAULT_BLOCK_SETTINGS, 250, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- schedule-validate.test.ts -t "validateRecoveryWeekDensity"`
Expected: FAIL — `validateRecoveryWeekDensity is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/schedule-validate.ts`:

```ts
// The composition half of the recovery-week contract. RECOVERY_RETENTION_PCT (block-skeleton.ts)
// already enforced the VOLUME cut and validateWeekHours already checked it; nothing checked what the
// week was made OF. The 2026-07 reviewed block cut volume ~19% against a mandated ~40% AND kept all
// three quality types (SIT, Threshold, and a long ride with embedded threshold efforts) — just
// trimmed. A recovery week drops quality types entirely; it does not shrink every one slightly.
//
// Counts BOTH standalone quality days and endurance days hiding a real dose of threshold/VO2 work —
// the latter is the evasion route a count-only check can't see. EC-2: a B/C-priority event inside a
// recovery week IS that week's one retained intensity touch, so its day never counts here.
export function validateRecoveryWeekDensity(
  days: PlannedDay[],
  weekTargets: WeekTarget[],
  settings: BlockSettings,
  ftp: number,
  events: SeasonEvent[] = []
): string[] {
  const recoveryWeeks = new Set(weekTargets.filter((t) => t.isRecovery).map((t) => t.weekNumber));
  if (recoveryWeeks.size === 0) return [];
  const embeddedHardPct = resolveDurabilityInsertEnvelope(settings.durabilityInsertEnvelope).embeddedHardPct;
  const eventDates = new Set(events.map((e) => e.date));
  const warnings: string[] = [];

  for (const week of [...recoveryWeeks].sort((a, b) => a - b)) {
    const weekDays = days.filter((d) => d.weekNumber === week && !eventDates.has(d.date));
    const standalone = weekDays.filter(isQuality);
    const embedded = weekDays.filter(
      (d) => !isQuality(d) && carriesEmbeddedIntensity(d.workoutText, ftp, embeddedHardPct)
    );

    if (embedded.length > 0) {
      warnings.push(
        `RECOVERY DENSITY: week ${week} (recovery) has an endurance ride carrying embedded threshold/VO2 work (${embedded
          .map((d) => `${d.type} on ${d.date}`)
          .join(", ")}). A recovery week's long ride should be unbroken Z2 — no embedded efforts.`
      );
    }
    if (standalone.length > RECOVERY_QUALITY_CAP) {
      warnings.push(
        `RECOVERY DENSITY: week ${week} (recovery) has ${standalone.length} quality sessions (${standalone
          .map((d) => d.type)
          .join(", ")}) — a recovery week keeps at most ${RECOVERY_QUALITY_CAP}. Drop the extra type entirely rather than shortening every one.`
      );
    }
  }
  return warnings;
}
```

Then wire it into `app/api/generate/route.ts`, immediately after the `validateWeekHours` line:

```ts
    // The composition half of the recovery contract — validateWeekHours only checks volume.
    warnings.push(...validateRecoveryWeekDensity(days, weekTargets, blockSettings, profile.performance.ftp, existingSeason.events));
```

and add it to the existing `schedule-validate` import at the top of the route.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- schedule-validate.test.ts` then `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/schedule-validate.ts lib/schedule-validate.test.ts app/api/generate/route.ts
git commit -m "feat(validate): add validateRecoveryWeekDensity

The volume half of the recovery contract was enforced and checked;
nothing checked composition. The reviewed block kept all three quality
types in its recovery week, just trimmed, and hid threshold efforts
inside the long ride. Counts standalone quality AND embedded
intensity; a race inside a recovery week is that week's retained
touch, not a breach.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Make `validatePrimaryQualityCadence` two-sided (A5)

**The gap:** it skips recovery weeks with `if (t.isRecovery) continue`, and its own comment (`lib/season.ts:748-749`) states the design intent that was never enforced anywhere — *"recovery weeks are exempt — the KB's own 'quality is minimal' framing applies there."* Task 5 now owns the ceiling; this task makes the exemption explicit rather than silent, and updates the stale comment.

**Files:**
- Modify: `lib/season.ts:744-776`
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: `focusSessionMatchers` (`:694`), `WeekTarget`.
- Produces: signature unchanged — `validatePrimaryQualityCadence(days, focus, weekTargets, ftp)`.

- [ ] **Step 1: Write the failing test**

Add to the existing `describe("validatePrimaryQualityCadence (P5a)")` block in `lib/season.test.ts`:

```ts
  it("flags a recovery week that carries MORE than the retained primary-quality touch", () => {
    // The exemption was silent: a recovery week could carry any number of focus sessions unchallenged.
    const days: PlannedDay[] = [
      { date: "2026-06-15", weekNumber: 1, weekTheme: "t", name: "V1", type: "VO2max", durationMin: 60, workoutText: "- 4m 110%", description: "x" },
      { date: "2026-06-17", weekNumber: 1, weekTheme: "t", name: "V2", type: "VO2max", durationMin: 60, workoutText: "- 4m 110%", description: "x" },
    ];
    const w = validatePrimaryQualityCadence(days, "vo2max", targets([{ isRecovery: true }]), 250);
    expect(w.some((s) => /recovery/.test(s) && /at most/.test(s))).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- season.test.ts -t "carries MORE than the retained"`
Expected: FAIL — returns `[]` (recovery weeks are skipped entirely).

- [ ] **Step 3: Implement**

In `lib/season.ts`, add the import of the shared cap. The existing type-only import becomes a value import:

```ts
import { RECOVERY_QUALITY_CAP, type WeekTarget } from "./block-skeleton";
```

Replace the comment block above `validatePrimaryQualityCadence` and the loop body. The comment's final sentence changes from describing the exemption to describing the two-sided check:

```ts
// P5a (2026-07-24 block-generation redesign): validateBlockFocus's block-wide floor ("at least 1
// somewhere") doesn't catch the actual defects found live — Week 3 silently dropped its standalone
// Threshold session, and SIT vanished entirely in weeks 5-6 despite the overview claiming escalation.
// Both are "primary quality disappeared mid-block," which a block-wide minimum of 1 can't see. This
// checks every LOADING week specifically, reusing the same matcher table so this can never disagree
// with formatFocusCoverageLine's prompt instruction or validateBlockFocus's own floor.
//
// 2026-07-29: now two-sided. Recovery weeks used to be skipped outright, with only a comment
// recording the intent ("quality is minimal there") — which meant a recovery week could carry any
// number of focus sessions unchallenged, and did. Loading weeks owe at least 1; recovery weeks owe
// at most RECOVERY_QUALITY_CAP. The count-and-composition ceiling across ALL quality types lives in
// validateRecoveryWeekDensity (lib/schedule-validate.ts); this is the focus-type-specific half.
```

And the loop:

```ts
  const warnings: string[] = [];
  for (const t of weekTargets) {
    const weekDays = byWeek.get(t.weekNumber) ?? [];
    const matches = weekDays.filter(m.match);
    if (t.isRecovery) {
      if (matches.length > RECOVERY_QUALITY_CAP) {
        warnings.push(
          `PRIMARY QUALITY: week ${t.weekNumber} (recovery) has ${matches.length} ${m.label} sessions — a recovery week keeps at most ${RECOVERY_QUALITY_CAP}.`
        );
      }
      continue;
    }
    if (matches.length === 0) {
      warnings.push(
        `PRIMARY QUALITY: week ${t.weekNumber} (loading) — this block's focus is ${focus} but has no ${m.label} session this week. The primary quality should appear every loading week, not skip weeks.`
      );
    }
  }
  return warnings;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- season.test.ts` then `npm test`
Expected: all PASS. The existing test at `season.test.ts:948` (recovery week exempt from the floor) should still pass — a recovery week with *zero* focus sessions is still legal.

- [ ] **Step 5: Commit**

```bash
git add lib/season.ts lib/season.test.ts
git commit -m "fix(season): make validatePrimaryQualityCadence two-sided

Recovery weeks were skipped outright, with only a comment recording
the intent that quality should be minimal there - so a recovery week
could carry any number of focus sessions unchallenged, and did.
Loading weeks owe at least 1; recovery weeks owe at most the cap.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Give the prompt a recovery-week composition rule (A1)

**Depends on Task 1.** This is the primary root cause. `formatRecoveryWeeks` injects volume only — *"cut volume ~30–50% in week X"* — and the prompt's only structural section is headed **"WEEKLY STRUCTURE (loading weeks)"** with no recovery counterpart. Given a ceiling for loading weeks and none for recovery, the model's most literal reading is that loading structure still applies and only hours change. That is exactly what it produced.

**Files:**
- Modify: `lib/season.ts:417-422`
- Modify: `app/api/generate/route.ts` (the `formatRecoveryWeeks` call site)
- Test: `lib/season.test.ts`

**Interfaces:**
- Consumes: `focusSessionMatchers(ftp)` for the surviving type's label; `RECOVERY_QUALITY_CAP` (imported in Task 6).
- Produces: `formatRecoveryWeeks(indices, lengthWeeks, focus, ftp)` — **two new required params.**

- [ ] **Step 1: Write the failing test**

Replace the existing `describe("formatRecoveryWeeks")` block in `lib/season.test.ts` with:

```ts
describe("formatRecoveryWeeks", () => {
  it("returns null when there are no recovery weeks", () => {
    expect(formatRecoveryWeeks([], 4, "vo2max", 250)).toBeNull();
  });

  it("names the volume cut, the cap, the surviving type, and what is dropped entirely", () => {
    const line = formatRecoveryWeeks([2], 6, "vo2max", 250)!;
    expect(line).toContain("week 3");
    expect(line).toMatch(/30–50%/);
    expect(line).toMatch(/at most 1/i);
    expect(line).toContain("VO2max"); // the focus type is the one that survives
    expect(line).toMatch(/dropped entirely, not shortened/i);
    expect(line).toMatch(/no embedded/i); // the long ride carve-out
  });

  it("asks for zero quality when the focus has no single required session type", () => {
    const line = formatRecoveryWeeks([0], 2, "aerobic-base", 250)!;
    expect(line).toMatch(/no quality sessions/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- season.test.ts -t "formatRecoveryWeeks"`
Expected: FAIL — TypeScript arity error, then missing content.

- [ ] **Step 3: Implement**

Replace `formatRecoveryWeeks` in `lib/season.ts`:

```ts
// Prompt-injectable recovery-week callout. Until 2026-07-29 this carried VOLUME only ("cut volume
// ~30–50%"), and the prompt's only structural section is headed "WEEKLY STRUCTURE (loading weeks)"
// with no recovery counterpart — so the model's most literal reading was that loading structure still
// applies and only hours change. It did exactly that: the reviewed block's "recovery" week kept SIT,
// Threshold AND a long ride with embedded threshold efforts, each merely trimmed. Composition is now
// stated explicitly: a cap, which type survives, and what is dropped ENTIRELY rather than shortened.
export function formatRecoveryWeeks(
  indices: number[],
  lengthWeeks: number,
  focus: SeasonFocus,
  ftp: number
): string | null {
  if (indices.length === 0) return null;
  const label = indices.map((i) => `week ${i + 1}`).join(", ");
  const m = focusSessionMatchers(ftp)[focus];
  const composition = m
    ? `Keep at most ${RECOVERY_QUALITY_CAP} quality session — a SHORT ${m.label} session early in the week, at the BOTTOM of its intensity band. Every other quality type (SIT, VO2max, RaceSim, and any second ${m.label}) is dropped entirely, not shortened.`
    : `Prescribe no quality sessions at all in ${label} — this block's focus has no single required session type, so a recovery week carries none.`;
  return [
    `RECOVERY: ${label} of this ${lengthWeeks}-week block ${indices.length > 1 ? "are" : "is"} a recovery week (hard cap — real training history shows ≥${SEASON_CONSTANTS.deloadEveryWeeks} calendar weeks since the last genuinely light week).`,
    `- VOLUME: cut ~30–50% versus a loading week — the exact figure is in the WEEK-BY-WEEK HOUR TARGETS table; hit it.`,
    `- COMPOSITION: ${composition}`,
    `- LONG RIDE: unbroken Z2 at its duration target — no embedded threshold/VO2 efforts this week, whatever this block's durability template says.`,
    `- Add one extra rest day versus a loading week.`,
    `A recovery week is a different SHAPE of week, not a smaller copy of a loading week.`,
  ].join("\n");
}
```

Then update the call site in `app/api/generate/route.ts`. Find:

```ts
      const recoveryLine = formatRecoveryWeeks(recoveryWeekIndices, blockParams.lengthWeeks);
```

Replace with (note `rollingFocusChoice` is guaranteed non-null by Task 1; the `?? "aerobic-base"` is a compile-time narrowing guard only):

```ts
      const recoveryLine = formatRecoveryWeeks(
        recoveryWeekIndices,
        blockParams.lengthWeeks,
        rollingFocusChoice?.focus ?? "aerobic-base",
        profile.performance.ftp
      );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- season.test.ts` then `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/season.ts lib/season.test.ts app/api/generate/route.ts
git commit -m "fix(season): give the prompt a recovery-week composition rule

formatRecoveryWeeks carried volume only, and the prompt's only
structural section is headed 'loading weeks' with no recovery
counterpart - so the model kept the full loading-week quality
skeleton and merely trimmed it, which is exactly what the reviewed
block did. Now states the cap, which type survives, what is dropped
entirely, and the long-ride carve-out.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Recovery-week durability carve-out (A2)

**The second root cause.** `selectDurabilityTemplate` picks one template for the **entire block**, and `formatDurabilityForPrompt` instructs the model to build *"the week's long Z2 ride"* that way — unconditionally, every week. Template B is *"~2–3h steady Z2, then 2–3 × 8–15 min threshold efforts late in the ride."* So the recovery week's long ride was **instructed** to carry embedded threshold work. Task 7's prompt line says otherwise; without this task the prompt contradicts itself.

**Files:**
- Modify: `lib/durability.ts:125-127`
- Test: `lib/durability.test.ts`
- Test: `app/api/generate/route.test.ts`

**Interfaces:**
- Consumes: `DurabilityTemplate` (`lib/durability.ts:13-18`), `DURABILITY_TEMPLATES[0]` is template A ("Pure accumulation" — *"a long, unbroken Z2 ride at the duration target — no embedded efforts"*).
- Produces: `formatDurabilityForPrompt(t, hasRecoveryWeek?)` — one new **optional** param, default `false`, so existing callers compile.

- [ ] **Step 1: Write the failing test**

Add to `lib/durability.test.ts`:

```ts
describe("formatDurabilityForPrompt — recovery-week carve-out", () => {
  it("adds an explicit recovery-week exception when the block has one", () => {
    const b = DURABILITY_TEMPLATES.find((t) => t.id === "B")!;
    const line = formatDurabilityForPrompt(b, true);
    expect(line).toMatch(/recovery week/i);
    expect(line).toMatch(/unbroken Z2/i);
    expect(line).toMatch(/no embedded/i);
  });

  it("omits the exception when the block has no recovery week", () => {
    const b = DURABILITY_TEMPLATES.find((t) => t.id === "B")!;
    expect(formatDurabilityForPrompt(b, false)).not.toMatch(/recovery week/i);
  });
});
```

And add to `app/api/generate/route.test.ts`:

```ts
  it("A2: a block containing a recovery week carves the durability template out of it", async () => {
    // Asserts on the durability line's own EXCEPTION marker specifically. A looser /recovery week/i
    // match would pass on formatRecoveryWeeks' output alone (Task 7) and prove nothing about Task 8.
    const res = await POST(
      new Request("http://t/api/generate", {
        method: "POST",
        body: JSON.stringify({ lengthWeeks: 4, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
      })
    );
    await res.json();
    const dynamic = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][1];
    expect(dynamic).toContain("DURABILITY FOCUS THIS BLOCK");
    expect(dynamic).toMatch(/EXCEPTION — in a RECOVERY week this template does not apply/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- durability.test.ts -t "recovery-week carve-out"`
Expected: FAIL — arity error, then no recovery text.

- [ ] **Step 3: Implement**

Replace `formatDurabilityForPrompt` in `lib/durability.ts`:

```ts
// `hasRecoveryWeek` appends the recovery-week exception. The template is chosen ONCE per block but
// this line is injected for every week — so template B ("fatigue-then-threshold") was instructing the
// model to put threshold efforts inside the recovery week's long ride too. That is the second root
// cause of the 2026-07 recovery-week defect, and it contradicts formatRecoveryWeeks' own long-ride
// rule (lib/season.ts) unless stated here as well.
export function formatDurabilityForPrompt(t: DurabilityTemplate, hasRecoveryWeek = false): string {
  const base = `DURABILITY FOCUS THIS BLOCK — template ${t.id} (${t.name}): ${t.mechanism}. Build the week's long Z2 ride as ${t.structure} The intensity sits INSIDE the duration target, never replacing it, and the long ride stays TYPE Z2 (the late efforts are part of it, not a separate quality session). See KB §12.`;
  if (!hasRecoveryWeek) return base;
  return `${base} EXCEPTION — in a RECOVERY week this template does not apply: that week's long ride is unbroken Z2 at its duration target with no embedded threshold/VO2 efforts at all.`;
}
```

Then update the call site in `app/api/generate/route.ts`. **This requires a small move — do not skip it.** `durabilityContext` is currently assigned around `:217`, which is *above* where Task 2 hoisted `recoveryWeekIndices` (just before the season `try`). Referencing it in place would be a use-before-declaration error.

Split the two: leave the template *selection* where it is, and move only the *rendering* down. Find:

```ts
    const durability = selectDurabilityTemplate(insights, currentBlock?.durabilityTemplate ?? null, combinedGoalText);
    const durabilityContext = `\n${formatDurabilityForPrompt(durability)}`;
```

Cut the second line, leaving only:

```ts
    const durability = selectDurabilityTemplate(insights, currentBlock?.durabilityTemplate ?? null, combinedGoalText);
```

Then add the rendering immediately after the `recoveryLine` block that Task 2 placed below the catch:

```ts
    // Rendered here rather than beside selectDurabilityTemplate above, because the recovery-week
    // exception needs recoveryWeekIndices — the template is chosen per BLOCK but this line is injected
    // for every week, so without the carve-out template B tells the model to put threshold efforts in
    // the recovery week's long ride, contradicting formatRecoveryWeeks' own long-ride rule.
    const durabilityContext = `\n${formatDurabilityForPrompt(durability, recoveryWeekIndices.length > 0)}`;
```

Confirm `durabilityContext` is still assigned before `buildSystemPrompt` consumes it (around `:346`) — it is; both the recovery line and this sit between the catch and the prompt assembly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- durability.test.ts route.test.ts` then `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/durability.ts lib/durability.test.ts app/api/generate/route.ts app/api/generate/route.test.ts
git commit -m "fix(durability): carve the recovery week out of the block template

selectDurabilityTemplate picks one template per block and the prompt
line was injected for every week, so template B instructed threshold
efforts inside the recovery week's long ride - the second root cause
of the recovery-week defect, and a direct contradiction of
formatRecoveryWeeks' own long-ride rule.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Prompt version, doc sync, and the live smoke run (A6)

**Files:**
- Modify: `lib/anthropic-api.ts:39`
- Modify: `lib/anthropic-prompts.test.ts` (if prompt assertions drifted)
- Modify: `docs/systems/05-season.md` (the tripwire "Hasn't fired" claim)
- Modify: `ROADMAP.md` (the same claim in the Watch section)
- Modify: `todo.md` (record what shipped)

**Interfaces:** none — terminal task.

- [ ] **Step 1: Bump the prompt version**

`PROMPT_VERSION` is write-only — stamped onto artifacts for provenance, never compared anywhere (verified across `lib/`, `app/`, `components/`). The bump is zero-risk and required because the prompt's structure changed.

In `lib/anthropic-api.ts:39`:

```ts
export const PROMPT_VERSION = 5;
```

- [ ] **Step 2: Run the full suite and fix any drifted prompt assertions**

Run: `npm test`
Expected: PASS. `lib/anthropic-prompts.test.ts:170-189` asserts exact strings (e.g. `"Week 4 (RECOVERY): target 7.2h total"`). Those specific assertions are about the hour-target table, which this plan does not change — but if any fail, update the expected string to match the new prompt rather than deleting the assertion.

- [ ] **Step 3: Run the live smoke run**

Per AGENTS.md's standing rule, unit tests and a green build only prove the deterministic scaffolding. This changed a real AI path and needs one live run.

```bash
npm run dev
```

Then in the app, generate a **4-week block**. This length matters: `planRecoveryWeeks(0, 4, false)` returns `[3]` — verified in `lib/season.test.ts:711` — so **a 4-week block is guaranteed to contain a recovery week regardless of the athlete's current recovery state.** A 2-week block is conditional and may not exercise the path at all.

Read the generated block and confirm, by eye:
- The recovery week carries **at most one** quality session, and it is the block's focus type.
- SIT / VO2max / RaceSim are **absent** from the recovery week, not merely shortened.
- The recovery week's long ride has **no** embedded threshold/VO2 efforts.
- The recovery week's hours land near its target (the table figure, ~60% of loading).
- `data/ai-usage.json` recorded the call.

**Do not write the block to the calendar** unless you want it — reviewing the preview is the whole point.

- [ ] **Step 4: Update the docs the change falsifies**

In `docs/systems/05-season.md`, the tripwire entry currently ends *"Hasn't fired; the P4/P5 event-week overstack above is the closest call so far."* That claim is now false. Replace that clause with:

```
**Fired 2026-07-29** — a reviewed 2-week block's "recovery" week cut volume ~19% against a mandated
~40% AND kept all three quality types (SIT, Threshold, and a long ride with embedded threshold
efforts), each merely trimmed. Root causes were a volume-only recovery instruction and a
block-scoped durability template with no recovery carve-out; both fixed in the Phase A pass
(2026-07-29). The deterministic-skeleton response is scoped as Phase B — see
docs/superpowers/plans/2026-07-29-block-generation-phase-a-correctness.md.
```

Apply the equivalent correction to `ROADMAP.md`'s Watch section, which carries the same "Hasn't fired" wording.

Also delete the now-falsified assumption comment at `lib/schedule-validate.ts:69-71` if Task 4 did not already remove it.

- [ ] **Step 5: Record it in todo.md and commit**

Add one line under todo.md's Open section:

```markdown
- ☑ Block-generation Phase A (2026-07-29) — recovery-week composition + 3 silent-degradation fixes →
  [ARCHIVE.md](ARCHIVE.md). Phase B (deterministic week skeleton) not started; plan not yet written.
```

```bash
git add lib/anthropic-api.ts lib/anthropic-prompts.test.ts docs/systems/05-season.md ROADMAP.md todo.md
git commit -m "chore(generate): bump PROMPT_VERSION to 5, record the fired tripwire

The season tripwire's 'hasn't fired' claim is now false - a reviewed
block reproduced a structural defect. Records the Phase A fixes and
scopes the deterministic-skeleton response as Phase B.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Out of scope for Phase A

Stated explicitly so no task quietly grows:

- **The `WeekSkeleton` / `BlockSkeleton` types and `computeWeekSkeleton`.** That is Phase B, needs its own plan, and should be written after Phase A's smoke run informs it.
- **Any change to `RECOVERY_RETENTION_PCT` (0.6).** It is correctly calibrated against three independent sources. The reviewed week retained ~81% — an enforcement failure, not a calibration failure.
- **Deriving recovery-week parameters per athlete.** `RECOVERY_QUALITY_CAP` is a population constant here. Per ROADMAP #2's own gate, a derivation needs an honest execution outcome separating good recovery weeks from bad ones; that signal does not exist yet.
- **Rendering any of this in the UI.** No `PlanView`/`PlanPreview` changes.
- **The A-event backward-scheduled arc** (`replanEventArc`, `formatSeasonContext`), which stays dormant behind `SEASON_SHAPES_GENERATION`.
- **B-vs-C event priority differentiation in taper handling.** Identified in research as correct (a C-priority event should occupy a quality slot rather than trigger a taper) but it changes athlete-facing planning behavior beyond a correctness fix — Phase B.

## Verification checklist

- [ ] `npm test` green, ≥1394 tests
- [ ] `npm run build` succeeds
- [ ] One live smoke run on a **4-week** block, output read by eye against Task 9 Step 3's five checks
- [ ] `git log --oneline` shows 9 focused commits, none containing `ROADMAP.md`/`todo.md` changes that were not yours (except Task 9's deliberate edits)
