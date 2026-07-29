# Block Generation — Phase B: Deterministic Week Skeleton

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move per-day *composition* (which session type, which day, how long, what intensity ceiling) from the LLM to a deterministic, offline-testable computation — so a week's hours sum to its target by construction instead of by the model's arithmetic, and so a session type the skeleton never allocated cannot appear.

**Architecture:** A pure `computeBlockSkeleton()` in `lib/block-skeleton.ts` allocates seven typed day-slots per week from inputs the route already has (focus, recovery-week indices, block settings, events). It renders as a per-day table in the prompt, replacing today's single weekly hour figure. A conformance validator compares the returned plan against the skeleton. **The LLM keeps interval prescriptions, exact durations within envelopes, and all prose** — composition is where it has been wrong; content is where it has been right.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest 4. No new dependencies.

**Why now:** Phase A closed the recovery-week composition defect and was live-verified 2026-07-29. That smoke run left exactly one warning class: loading weeks came in at 11.2/11.5/10.9h against a 12h target (−0.8/−0.5/−1.1h) while the recovery week hit its own. The cause is structural — the model receives one weekly total and must solve the per-day split itself. This plan makes the split deterministic.

## Global Constraints

- **Test baseline is 1417 passing tests in 91 files** (`npm test`, ~3s). Every task leaves the suite green. If a task legitimately changes an existing assertion, update it in that task — never delete a test to make it pass. Do not treat the running test count as a target to hit exactly; if a task needs an extra test, add it.
- **Warn-only contract (ADR-0004).** Exactly two output mutations are sanctioned in this pipeline: `reconcileDurationMin` and `repairNutrition`. **No task here adds a third.** The conformance validator returns `string[]` and mutates nothing.
- **Do NOT clamp `durationMin`.** `reconcileDurationMin` (`lib/prescription.ts:196-202`) already overwrites it with the real step-sum (HR-19). Any additional duration mutation reopens that bug.
- **Do not add per-day type enums to the Anthropic tool schema.** A per-block-varying tool definition invalidates the tools + system + messages prompt cache on every generation, and the cached prefix is the full knowledge base. Enforce via prompt text + validator instead.
- **Warning-duplication discipline.** Phase A ended by collapsing three overlapping recovery-week warnings into one owner. Do not reintroduce overlap: the conformance validator owns *per-day* facts; `validateWeekHours` keeps owning the *weekly total*; `validateRecoveryWeekDensity` keeps owning recovery composition. If a new warning would restate an existing one, don't emit it.
- **Local dates only.** Use `resolveToday()` / `localToday()` from `lib/date.ts` for "what day is it now". Pure day-math (`addDays`) may stay UTC-anchored.
- **Concurrent session.** This working directory is shared. Stage only files you touched, by explicit path — **never `git add -A` / `git add .`**. Commit directly on `main`; do not branch.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Design decisions made up front

**D1 — Recovery weeks scale the long ride too, not just the easy volume.** Today a recovery week keeps a full-length long ride and cuts everything else; the 2026-07-29 smoke run produced a 180-min long ride inside a 7.0h recovery week (43% of the week in one session). This plan scales it by the same `RECOVERY_RETENTION_PCT` used for the weekly figure (180 → 108 min). Rationale: the KB's rule is a *volume* cut of 30–50%, and exempting the single largest session makes the rest of the week absorb a disproportionate share. **This is a real change to what the athlete is prescribed** — it is called out here so it is a decision, not a side effect.

**D2 — Conformance is warn-only in this phase.** The research recommended hard-failing a locked-type mismatch. That is deferred: a skeleton that is too rigid on its first outing turns every generation into a 502. Ship warn-only, read the warnings from real generations, then escalate to hard-fail in a follow-up once there is evidence the model complies. `validateSkeletonConformance` is written so the escalation is a one-line change.

**D3 — Quality-session placement is deterministic and canonical.** Rest priority `[Mon, Thu, Sun]`, quality priority `[Tue, Thu, Fri]`, long ride on Saturday. For the default settings (1 rest, 2 quality) this yields Mon rest / Tue quality / Wed easy / Thu quality / Fri easy / Sat long / Sun easy; for a recovery week (2 rest, 1 quality) it yields Mon rest / Tue quality / Wed easy / Thu rest / Fri easy / Sat long / Sun easy — **which is exactly the shape the model already converged on in the live smoke run.** The skeleton codifies an observed-good shape rather than imposing a novel one. With 3+ quality sessions placement is best-effort and may produce adjacency; `validateSchedule` still runs and will flag it.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `lib/block-skeleton.ts` | Slot vocabulary, `computeBlockSkeleton`, the renderer. Already owns per-week targets and recovery constants — the natural home. | 1, 2 |
| `lib/block-skeleton.test.ts` | Unit tests for allocation + rendering | 1, 2 |
| `lib/schedule-validate.ts` | `validateSkeletonConformance` (joins the existing validator family) | 3 |
| `lib/schedule-validate.test.ts` | Unit tests for conformance | 3 |
| `lib/anthropic-prompts.ts` | `buildUserMessage` consumes the skeleton instead of bare week targets; the prose structure section shrinks | 4 |
| `lib/anthropic-prompts.test.ts` | Prompt assertions | 4 |
| `app/api/generate/route.ts` | Compute the skeleton, pass it to the prompt, run conformance | 4 |
| `app/api/generate/route.test.ts` | Integration proof | 4 |
| `lib/anthropic-api.ts`, docs | `PROMPT_VERSION`, doc sync | 5 |

---

### Task 1: Slot types and `computeBlockSkeleton`

**Files:**
- Modify: `lib/block-skeleton.ts` (append; do not reorganize existing exports)
- Test: `lib/block-skeleton.test.ts`

**Interfaces:**
- Consumes: `WeekTarget` (`lib/block-skeleton.ts:53-57`, fields `weekNumber` 1-indexed, `isRecovery`, `targetHours`), `RECOVERY_QUALITY_CAP` and `RECOVERY_RETENTION_PCT` (same file), `BlockSettings` (`lib/types.ts:422-439` — `weeklyHoursMax`, `qualitySessionsPerLoadingWeek: 2`, `longRideDurationMinutes: 180`, `restDaysPerWeek: 1`), `WorkoutType` (`lib/types.ts`).
- Produces: `SlotKind`, `DaySlot`, `WeekSkeleton`, `BlockSkeleton`, `computeBlockSkeleton(...)`. **Tasks 2, 3 and 4 all import these.**

- [ ] **Step 1: Write the failing tests**

Add to `lib/block-skeleton.test.ts`:

```ts
describe("computeBlockSkeleton", () => {
  const weeks = (n: number, recoveryIdx: number[] = []) =>
    computeWeekTargets(n, DEFAULT_BLOCK_SETTINGS, recoveryIdx);

  it("allocates exactly 7 day slots per week, dated from the block start", () => {
    const sk = computeBlockSkeleton("2026-08-03", weeks(2), DEFAULT_BLOCK_SETTINGS, "anaerobic", []);
    expect(sk.weeks).toHaveLength(2);
    expect(sk.weeks[0].days).toHaveLength(7);
    expect(sk.weeks[0].days[0].date).toBe("2026-08-03");
    expect(sk.weeks[1].days[6].date).toBe("2026-08-16");
  });

  it("day durations sum EXACTLY to the week's hour target — the whole point", () => {
    for (const target of weeks(4)) {
      const sk = computeBlockSkeleton("2026-08-03", [target], DEFAULT_BLOCK_SETTINGS, "anaerobic", []);
      const sum = sk.weeks[0].days.reduce((t, d) => t + d.duration.nominalMin, 0);
      expect(sum).toBe(Math.round(target.targetHours * 60));
    }
  });

  it("uses the canonical loading shape: Mon rest, Tue+Thu quality, Sat long", () => {
    const sk = computeBlockSkeleton("2026-08-03", weeks(1), DEFAULT_BLOCK_SETTINGS, "anaerobic", []);
    expect(sk.weeks[0].days.map((d) => d.kind)).toEqual([
      "rest", "quality", "easy", "quality", "easy", "longRide", "easy",
    ]);
  });

  it("a recovery week gets one extra rest day, one quality slot, and a scaled long ride (D1)", () => {
    const sk = computeBlockSkeleton("2026-08-03", weeks(1, [0]), DEFAULT_BLOCK_SETTINGS, "anaerobic", []);
    const w = sk.weeks[0];
    expect(w.days.map((d) => d.kind)).toEqual([
      "rest", "quality", "easy", "rest", "easy", "longRide", "easy",
    ]);
    expect(w.qualityBudget).toBe(1);
    // 180 * 0.6 = 108 — scaled, not kept at full length
    expect(w.days[5].duration.nominalMin).toBe(108);
  });

  it("locks the quality slot to the block's focus type, and never to a dropped type", () => {
    const sk = computeBlockSkeleton("2026-08-03", weeks(1), DEFAULT_BLOCK_SETTINGS, "anaerobic", []);
    const q = sk.weeks[0].days.filter((d) => d.kind === "quality");
    expect(q[0].allowedTypes).toEqual(["SIT"]);
    expect(q[0].allowedTypes).not.toContain("Threshold");
  });

  it("a recovery week's long ride carries an intensity ceiling; a loading week's does not", () => {
    const rec = computeBlockSkeleton("2026-08-03", weeks(1, [0]), DEFAULT_BLOCK_SETTINGS, "anaerobic", []);
    const load = computeBlockSkeleton("2026-08-03", weeks(1), DEFAULT_BLOCK_SETTINGS, "anaerobic", []);
    expect(rec.weeks[0].days[5].maxIntensityPct).not.toBeNull();
    expect(load.weeks[0].days[5].maxIntensityPct).toBeNull();
  });

  it("gives a focus with no required session type zero quality slots in a recovery week", () => {
    const sk = computeBlockSkeleton("2026-08-03", weeks(1, [0]), DEFAULT_BLOCK_SETTINGS, "durability", []);
    expect(sk.weeks[0].qualityBudget).toBe(0);
    expect(sk.weeks[0].days.some((d) => d.kind === "quality")).toBe(false);
  });

  it("marks an event day as a locked event slot", () => {
    const events = [{ name: "KOM", date: "2026-08-08", priority: "B" as const, type: "road-race" as const }];
    const sk = computeBlockSkeleton("2026-08-03", weeks(1), DEFAULT_BLOCK_SETTINGS, "anaerobic", events);
    const ev = sk.weeks[0].days.find((d) => d.date === "2026-08-08")!;
    expect(ev.kind).toBe("event");
    expect(ev.locked).toBe(true);
  });
});
```

Ensure the file imports `computeBlockSkeleton`, `computeWeekTargets`, `DEFAULT_BLOCK_SETTINGS`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- block-skeleton.test.ts -t "computeBlockSkeleton"`
Expected: FAIL — `computeBlockSkeleton is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/block-skeleton.ts`. Add `SeasonEvent`, `SeasonFocus`, `WorkoutType` to the existing `./types` type import, and `addDays` from `./date` (verify the export name before using it; if `lib/date.ts` names it differently, use that name).

```ts
// ---------- Phase B: the deterministic week skeleton ----------
// Composition (which type, which day, how long, what intensity ceiling) is computed here and handed
// to the model as a filled table; the model supplies interval prescriptions, exact durations inside
// each envelope, and prose. The 2026-07-29 live run showed why: given one weekly hour figure the
// model must solve the per-day split itself, and undershot every loading week by 0.5-1.1h.

export type SlotKind = "quality" | "longRide" | "easy" | "rest" | "event";

export interface DaySlot {
  date: string;
  kind: SlotKind;
  /** Allowed WorkoutType values. length === 1 ⇒ locked to that type. */
  allowedTypes: WorkoutType[];
  /** nominalMin is the figure that makes the week sum to target; the envelope is the model's leeway. */
  duration: { nominalMin: number; minMin: number; maxMin: number };
  /** %FTP ceiling for ANY work step this day, including steps embedded in an otherwise-easy ride. */
  maxIntensityPct: number | null;
  locked: boolean;
  /** One-line WHY — rendered into the prompt AND quoted back by the conformance validator. */
  reason: string;
}

export interface WeekSkeleton extends WeekTarget {
  qualityBudget: number;
  days: DaySlot[];
}

export interface BlockSkeleton {
  focus: SeasonFocus;
  weeks: WeekSkeleton[];
}

// Nominal session lengths. Easy days absorb the remainder, so these only need to be realistic.
const QUALITY_NOMINAL_MIN = 75;
const QUALITY_RECOVERY_MIN = 45; // "SHORT" — the recovery week's single retained touch
const EASY_MIN_MIN = 45;
const EASY_MAX_MIN = 150;
const DURATION_SLACK_MIN = 15; // envelope half-width around each nominal
const EASY_CEILING_PCT = 75;   // easy days stay genuinely easy
const RECOVERY_LONG_RIDE_CEILING_PCT = 75; // recovery long ride: unbroken Z2, no embedded work
const RECOVERY_QUALITY_CEILING_PCT = 95;   // retained touch sits at the bottom of its band

// Day-of-week placement priorities (index 0 = the week's first day). See D3 in the plan.
const REST_PRIORITY = [0, 3, 6];
const QUALITY_PRIORITY = [1, 3, 4];
const LONG_RIDE_INDEX = 5;

/** The single session type that satisfies a focus, or null when the focus has no required type. */
function focusWorkoutType(focus: SeasonFocus): WorkoutType | null {
  switch (focus) {
    case "threshold": return "Threshold";
    case "vo2max": return "VO2max";
    case "anaerobic": return "SIT";
    default: return null; // aerobic-base, durability, sharpen — no single required type
  }
}

/** Spread `total` across `count` integer slots so they sum EXACTLY to total. */
function spread(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const rem = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rem ? 1 : 0));
}

export function computeBlockSkeleton(
  startDate: string,
  weekTargets: WeekTarget[],
  settings: BlockSettings,
  focus: SeasonFocus,
  events: SeasonEvent[]
): BlockSkeleton {
  const eventByDate = new Map(events.map((e) => [e.date, e]));
  const focusType = focusWorkoutType(focus);

  const weeks = weekTargets.map((t, wi) => {
    const totalMin = Math.round(t.targetHours * 60);
    const restCount = settings.restDaysPerWeek + (t.isRecovery ? 1 : 0);
    // Recovery: at most the shared cap, and zero when the focus has no required type (a durability
    // recovery week can't keep its own quality touch — that type carries embedded work by definition).
    const qualityBudget = t.isRecovery
      ? focusType
        ? Math.min(RECOVERY_QUALITY_CAP, Math.max(0, settings.qualitySessionsPerLoadingWeek - 1))
        : 0
      : settings.qualitySessionsPerLoadingWeek;

    // D1: a recovery week scales its long ride by the same retention fraction as its weekly figure.
    let longRideMin = t.isRecovery
      ? Math.round(settings.longRideDurationMinutes * RECOVERY_RETENTION_PCT)
      : settings.longRideDurationMinutes;
    const qualityMin = t.isRecovery ? QUALITY_RECOVERY_MIN : QUALITY_NOMINAL_MIN;

    const kinds: SlotKind[] = Array.from({ length: 7 }, () => "easy");
    kinds[LONG_RIDE_INDEX] = "longRide";
    let placed = 0;
    for (const i of REST_PRIORITY) {
      if (placed >= restCount) break;
      if (kinds[i] === "easy") { kinds[i] = "rest"; placed++; }
    }
    placed = 0;
    for (const i of QUALITY_PRIORITY) {
      if (placed >= qualityBudget) break;
      if (kinds[i] === "easy") { kinds[i] = "quality"; placed++; }
    }

    const easyIdx = kinds.map((k, i) => (k === "easy" ? i : -1)).filter((i) => i >= 0);
    const easyTotal = totalMin - longRideMin - qualityBudget * qualityMin;
    let easyMins = spread(Math.max(0, easyTotal), easyIdx.length);
    // Keep easy days realistic; the long ride absorbs any residual so the week still sums exactly.
    if (easyIdx.length > 0) {
      const clamped = easyMins.map((m) => clamp(m, EASY_MIN_MIN, EASY_MAX_MIN));
      const delta = easyMins.reduce((a, b) => a + b, 0) - clamped.reduce((a, b) => a + b, 0);
      easyMins = clamped;
      longRideMin += delta;
    } else {
      longRideMin += Math.max(0, easyTotal);
    }

    let easyCursor = 0;
    const days: DaySlot[] = kinds.map((kind, i) => {
      const date = addDays(startDate, wi * 7 + i);
      const ev = eventByDate.get(date);
      if (ev) {
        return {
          date, kind: "event", allowedTypes: ["RaceSim"],
          duration: { nominalMin: 0, minMin: 0, maxMin: 24 * 60 },
          maxIntensityPct: null, locked: true,
          reason: `${ev.name} (priority ${ev.priority}) — the athlete's own event; never overwrite this day`,
        };
      }
      const env = (n: number) => ({
        nominalMin: n,
        minMin: Math.max(0, n - DURATION_SLACK_MIN),
        maxMin: n + DURATION_SLACK_MIN,
      });
      switch (kind) {
        case "rest":
          return {
            date, kind, allowedTypes: ["Rest"], duration: { nominalMin: 0, minMin: 0, maxMin: 0 },
            maxIntensityPct: null, locked: true,
            reason: t.isRecovery ? "recovery week: one extra rest day" : "weekly rest day",
          };
        case "quality":
          return {
            date, kind, allowedTypes: focusType ? [focusType] : ["Threshold", "VO2max", "SIT", "RaceSim"],
            duration: env(qualityMin),
            maxIntensityPct: t.isRecovery ? RECOVERY_QUALITY_CEILING_PCT : null,
            locked: !!focusType,
            reason: t.isRecovery
              ? `the ONE retained quality touch — short, early, at the bottom of its band`
              : `the block's primary quality (focus: ${focus})`,
          };
        case "longRide":
          return {
            date, kind, allowedTypes: ["Z2"], duration: env(longRideMin),
            maxIntensityPct: t.isRecovery ? RECOVERY_LONG_RIDE_CEILING_PCT : null,
            locked: true,
            reason: t.isRecovery
              ? "recovery week: unbroken Z2, no embedded threshold/VO2 efforts whatever the block's durability template says"
              : "the week's long endurance ride",
          };
        default: {
          const m = easyMins[easyCursor++] ?? EASY_MIN_MIN;
          return {
            date, kind: "easy", allowedTypes: ["Z2", "Recovery"], duration: env(m),
            maxIntensityPct: EASY_CEILING_PCT, locked: false,
            reason: "easy Z2 — the week's volume lever",
          };
        }
      }
    });

    return { ...t, qualityBudget, days };
  });

  return { focus, weeks };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- block-skeleton.test.ts` then `npm test`
Expected: all PASS. If the exact-sum test fails, the clamp/residual logic is the place to look — the long ride must absorb whatever the easy days give up.

- [ ] **Step 5: Commit**

```bash
git add lib/block-skeleton.ts lib/block-skeleton.test.ts
git commit -m "feat(skeleton): compute deterministic per-day slots for a block

Allocates seven typed day-slots per week whose nominal durations sum
exactly to the week's hour target, so the model no longer has to solve
the per-day split itself - the cause of every loading week undershooting
by 0.5-1.1h in the 2026-07-29 live run. Recovery weeks scale the long
ride by the same retention fraction as the weekly figure rather than
keeping it full-length.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Render the skeleton for the prompt

**Files:**
- Modify: `lib/block-skeleton.ts`
- Test: `lib/block-skeleton.test.ts`

**Interfaces:**
- Consumes: `BlockSkeleton`, `WeekSkeleton`, `DaySlot` (Task 1).
- Produces: `formatBlockSkeleton(skeleton: BlockSkeleton): string`. **Task 4 imports this.**

- [ ] **Step 1: Write the failing test**

```ts
describe("formatBlockSkeleton", () => {
  const sk = () =>
    computeBlockSkeleton("2026-08-03", computeWeekTargets(2, DEFAULT_BLOCK_SETTINGS, [0]), DEFAULT_BLOCK_SETTINGS, "anaerobic", []);

  it("renders one row per day with date, slot, type, duration and reason", () => {
    const out = formatBlockSkeleton(sk());
    expect(out).toContain("2026-08-04");
    expect(out).toContain("SIT");
    expect(out).toMatch(/\| *rest *\|/);
  });

  it("states the week total so the model can verify its own arithmetic", () => {
    const out = formatBlockSkeleton(sk());
    expect(out).toMatch(/sum to 432 min/); // recovery week 1: 7.2h
    expect(out).toMatch(/sum to 720 min/); // loading week 2: 12h
  });

  it("names the types that are NOT allowed in a recovery week", () => {
    const out = formatBlockSkeleton(sk());
    expect(out).toMatch(/NOT this week: Threshold, VO2max, RaceSim/);
  });

  it("marks the skeleton as fixed and forbids adding, dropping or retyping days", () => {
    const out = formatBlockSkeleton(sk());
    expect(out).toMatch(/do NOT add, drop, move, merge or retype/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- block-skeleton.test.ts -t "formatBlockSkeleton"`
Expected: FAIL — `formatBlockSkeleton is not a function`.

- [ ] **Step 3: Implement**

Append to `lib/block-skeleton.ts`:

```ts
const ALL_QUALITY: WorkoutType[] = ["Threshold", "VO2max", "SIT", "RaceSim"];

function slotTypeLabel(d: DaySlot): string {
  return d.allowedTypes.length === 1 ? d.allowedTypes[0] : d.allowedTypes.join(" or ");
}

function slotDurationLabel(d: DaySlot): string {
  if (d.kind === "rest") return "0";
  if (d.kind === "event") return "as the event demands";
  return `${d.duration.nominalMin} min (${d.duration.minMin}–${d.duration.maxMin} ok)`;
}

// Replaces formatWeekTargets' single weekly figure. Rendering the whole week as a filled table means
// the model picks a number inside each envelope instead of solving a 7-day allocation problem.
export function formatBlockSkeleton(skeleton: BlockSkeleton): string {
  const blocks = skeleton.weeks.map((w) => {
    const total = w.days.reduce((t, d) => t + d.duration.nominalMin, 0);
    const rows = w.days.map((d) => {
      const ceiling = d.maxIntensityPct === null ? "—" : `≤${d.maxIntensityPct}% FTP`;
      return `| ${d.date} | ${d.kind} | ${slotTypeLabel(d)} | ${slotDurationLabel(d)} | ${ceiling} | ${d.reason} |`;
    });
    const dropped = w.isRecovery
      ? ALL_QUALITY.filter((t) => !w.days.some((d) => d.allowedTypes.includes(t)))
      : [];
    const notThisWeek = dropped.length > 0
      ? `\nNOT this week: ${dropped.join(", ")} — dropped entirely, not shortened.`
      : "";
    return [
      `WEEK ${w.weekNumber} — ${w.isRecovery ? "RECOVERY" : "LOADING"} · target ${w.targetHours}h.`,
      `| Date | Slot | Type | Duration | Ceiling | Why |`,
      `|---|---|---|---|---|---|`,
      ...rows,
      `The nominal durations above already sum to ${total} min. Stay inside each range and the week's total lands on its target.${notThisWeek}`,
    ].join("\n");
  });

  return [
    `WEEK SKELETON (FIXED — fill each slot, do NOT add, drop, move, merge or retype any day).`,
    `Each row is one calendar day. Pick a duration inside the stated range. Never place any effort above a row's intensity ceiling, including efforts embedded inside an otherwise-easy ride.`,
    ...blocks,
  ].join("\n\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- block-skeleton.test.ts` then `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/block-skeleton.ts lib/block-skeleton.test.ts
git commit -m "feat(skeleton): render the skeleton as a per-day prompt table

Replaces a single weekly hour figure with a filled day-by-day table
whose nominal durations already sum to the target, plus an explicit
list of the quality types dropped from a recovery week.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `validateSkeletonConformance`

**Files:**
- Modify: `lib/schedule-validate.ts` (append)
- Test: `lib/schedule-validate.test.ts`

**Interfaces:**
- Consumes: `BlockSkeleton`, `DaySlot` from `./block-skeleton` (Task 1); `PlannedDay` from `./types`.
- Produces: `validateSkeletonConformance(days: PlannedDay[], skeleton: BlockSkeleton): string[]`. **Task 4 wires it in.**

**Scope discipline — do not restate what another validator already owns.** This one owns *per-day* facts only: a day missing from the plan, a type outside its slot's `allowedTypes`, and a duration outside its envelope. It must NOT re-check weekly totals (`validateWeekHours` owns that) or recovery composition counts (`validateRecoveryWeekDensity` owns that). Per D2 it is warn-only.

- [ ] **Step 1: Write the failing tests**

```ts
describe("validateSkeletonConformance", () => {
  const skel = () =>
    computeBlockSkeleton("2026-08-03", computeWeekTargets(1, DEFAULT_BLOCK_SETTINGS, []), DEFAULT_BLOCK_SETTINGS, "anaerobic", []);

  const fromSkeleton = (over: Partial<PlannedDay> & { date: string }): PlannedDay[] =>
    skel().weeks[0].days.map((s) => ({
      date: s.date,
      weekNumber: 1,
      weekTheme: "t",
      name: "s",
      type: s.allowedTypes[0],
      durationMin: s.duration.nominalMin,
      workoutText: "- 10m 60%",
      description: "x",
      ...(s.date === over.date ? over : {}),
    }));

  it("passes a plan that matches the skeleton exactly", () => {
    expect(validateSkeletonConformance(fromSkeleton({ date: "none" }), skel())).toEqual([]);
  });

  it("flags a day whose type is not allowed in its slot", () => {
    const days = fromSkeleton({ date: "2026-08-04", type: "Threshold" }); // slot is locked to SIT
    const w = validateSkeletonConformance(days, skel());
    expect(w.some((s) => /SKELETON/.test(s) && /Threshold/.test(s) && /SIT/.test(s))).toBe(true);
  });

  it("flags a duration outside its envelope but accepts one inside it", () => {
    const inside = fromSkeleton({ date: "2026-08-05", durationMin: skel().weeks[0].days[2].duration.maxMin });
    expect(validateSkeletonConformance(inside, skel())).toEqual([]);
    const outside = fromSkeleton({ date: "2026-08-05", durationMin: 400 });
    expect(validateSkeletonConformance(outside, skel()).some((s) => /SKELETON/.test(s))).toBe(true);
  });

  it("flags a missing day", () => {
    const days = fromSkeleton({ date: "none" }).filter((d) => d.date !== "2026-08-06");
    expect(validateSkeletonConformance(days, skel()).some((s) => /2026-08-06/.test(s))).toBe(true);
  });

  it("does not restate the weekly-total or recovery-composition warnings other validators own", () => {
    const days = fromSkeleton({ date: "none" });
    const w = validateSkeletonConformance(days, skel());
    expect(w.some((s) => /HOURS|RECOVERY DENSITY/.test(s))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- schedule-validate.test.ts -t "validateSkeletonConformance"`
Expected: FAIL — not a function.

- [ ] **Step 3: Implement**

Append to `lib/schedule-validate.ts` (add `BlockSkeleton` to its existing `./block-skeleton` import):

```ts
// Per-day conformance against the computed skeleton. Deliberately narrow: this owns DAY-level facts
// only — a missing day, a type outside its slot, a duration outside its envelope. Weekly totals stay
// with validateWeekHours and recovery composition stays with validateRecoveryWeekDensity, so the
// athlete never reads two warnings about one fact (the duplication Phase A ended by collapsing).
//
// Warn-only for now (plan decision D2): a skeleton that hard-fails on its first outing turns every
// generation into a 502. Escalate the type-mismatch branch to a throw once real runs show the model
// complies — that is a one-line change here.
export function validateSkeletonConformance(days: PlannedDay[], skeleton: BlockSkeleton): string[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const warnings: string[] = [];

  for (const week of skeleton.weeks) {
    for (const slot of week.days) {
      const day = byDate.get(slot.date);
      if (!day) {
        warnings.push(`SKELETON: ${slot.date} is missing from the plan — the skeleton allocated a ${slot.kind} slot there (${slot.reason}).`);
        continue;
      }
      if (!slot.allowedTypes.includes(day.type)) {
        warnings.push(
          `SKELETON: ${slot.date} is typed ${day.type} but its slot allows ${slot.allowedTypes.join(" or ")} — ${slot.reason}.`
        );
      }
      if (day.durationMin < slot.duration.minMin || day.durationMin > slot.duration.maxMin) {
        warnings.push(
          `SKELETON: ${slot.date} is ${day.durationMin} min, outside its ${slot.duration.minMin}–${slot.duration.maxMin} min slot (nominal ${slot.duration.nominalMin}).`
        );
      }
    }
  }
  return warnings;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- schedule-validate.test.ts` then `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/schedule-validate.ts lib/schedule-validate.test.ts
git commit -m "feat(validate): add validateSkeletonConformance

Owns day-level facts only - missing day, type outside its slot,
duration outside its envelope. Weekly totals and recovery composition
stay with their existing owners so no fact gets two warnings.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire the skeleton through the prompt and the route

**Files:**
- Modify: `lib/anthropic-prompts.ts` (`buildUserMessage`)
- Modify: `app/api/generate/route.ts`
- Test: `lib/anthropic-prompts.test.ts`, `app/api/generate/route.test.ts`

**Interfaces:**
- Consumes: `computeBlockSkeleton`, `formatBlockSkeleton` (Tasks 1–2), `validateSkeletonConformance` (Task 3).
- Produces: `buildUserMessage(..., skeleton?: BlockSkeleton)` — a new optional trailing param so existing callers and tests compile.

**Read the current route before editing.** Nine tasks across two plans have edited it. Locate anchors by searching for `computeWeekTargets(`, `buildUserMessage(`, `validateWeekHours(` — do not trust line numbers.

- [ ] **Step 1: Write the failing tests**

In `lib/anthropic-prompts.test.ts`:

```ts
  it("renders the per-day skeleton table when a skeleton is supplied", () => {
    const targets = computeWeekTargets(2, DEFAULT_BLOCK_SETTINGS, [0]);
    const sk = computeBlockSkeleton("2026-08-03", targets, DEFAULT_BLOCK_SETTINGS, "anaerobic", []);
    const p = buildUserMessage(
      { lengthWeeks: 2, goal: "g", startDate: "2026-08-03", weakpoints: [] },
      [["2026-08-03"], ["2026-08-10"]],
      "",
      DEFAULT_BLOCK_SETTINGS,
      targets,
      sk
    );
    expect(p).toContain("WEEK SKELETON (FIXED");
    expect(p).toContain("2026-08-04");
    expect(p).not.toContain("WEEK-BY-WEEK HOUR TARGETS"); // superseded by the table
  });
```

In `app/api/generate/route.test.ts`:

```ts
  it("Phase B: the skeleton table reaches the model and conformance runs", async () => {
    const res = await POST(
      new Request("http://t/api/generate", {
        method: "POST",
        body: JSON.stringify({ lengthWeeks: 2, goal: "Build FTP", startDate: "2026-06-15", weakpoints: [], today: "2026-06-15" }),
      })
    );
    const json = await res.json();
    const userMessage = vi.mocked(anthropic.generateTrainingBlock).mock.calls[0][2];
    expect(userMessage).toContain("WEEK SKELETON (FIXED");
    // The mocked tool payload only returns 2 days for a 14-day block, so conformance must notice.
    expect(json.plan.warnings.some((w: string) => /^SKELETON:/.test(w))).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- anthropic-prompts.test.ts route.test.ts`
Expected: FAIL — arity error on `buildUserMessage`, and no `SKELETON:` warnings.

- [ ] **Step 3: Implement**

In `lib/anthropic-prompts.ts`, add the optional parameter and use it:

```ts
export function buildUserMessage(
  blockParams: BlockParams,
  weeks: string[][],
  nutritionTableMd: string,
  settings: BlockSettings = DEFAULT_BLOCK_SETTINGS,
  weekTargets?: WeekTarget[],
  skeleton?: BlockSkeleton
): string {
```

Import `formatBlockSkeleton` and the `BlockSkeleton` type from `./block-skeleton`. Where the message currently embeds `formatWeekTargets(weekTargets)`, prefer the skeleton when present:

```ts
  const volumeSection = skeleton
    ? formatBlockSkeleton(skeleton)
    : weekTargets && weekTargets.length > 0
      ? formatWeekTargets(weekTargets)
      : "";
```

Then, in the rules list, replace the **WEEKLY STRUCTURE (loading weeks)** bullet's day-composition content with a short pointer when a skeleton is present — the table now owns composition, and leaving both is the warning-duplication mistake in prompt form. Keep the polarised/sweet-spot sentence, the sequencing bullet, and the rest-day formatting bullet; those are not composition. Concretely, make that bullet conditional. **Copy the existing bullet text verbatim into the `else` branch — read it out of the file and paste it exactly; do not retype, paraphrase, or abbreviate it, and do not leave any placeholder.** The shape is:

```ts
- **WEEKLY STRUCTURE:** ${skeleton
    ? "see WEEK SKELETON above — it is the authority on which day carries which session type, how long it is, and its intensity ceiling. Do not deviate from it."
    : <THE ENTIRE CURRENT BULLET TEXT, COPIED BYTE-FOR-BYTE FROM THE FILE>}
```

In `app/api/generate/route.ts`, after `weekTargets` is computed and after `rollingFocusChoice` is available, add:

```ts
    // Phase B: composition is computed here, not left to the model. The 2026-07-29 live run showed a
    // single weekly hour figure is not enough — every loading week undershot by 0.5-1.1h.
    const blockSkeleton = computeBlockSkeleton(
      blockParams.startDate,
      weekTargets,
      blockSettings,
      rollingFocusChoice?.focus ?? "aerobic-base",
      existingSeason.events
    );
```

Pass it to `buildUserMessage` as the new trailing argument, and add the conformance check next to the other validators, immediately after the `validateWeekHours` line:

```ts
    warnings.push(...validateSkeletonConformance(days, blockSkeleton));
```

Add both imports to the route's existing import lines.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS. Existing `anthropic-prompts.test.ts` assertions that pin `WEEK-BY-WEEK HOUR TARGETS` still pass, because those call `buildUserMessage` without a skeleton and hit the fallback path. If one fails, check you kept the fallback rather than deleting `formatWeekTargets`.

- [ ] **Step 5: Commit**

```bash
git add lib/anthropic-prompts.ts lib/anthropic-prompts.test.ts app/api/generate/route.ts app/api/generate/route.test.ts
git commit -m "feat(generate): drive the prompt from the computed skeleton

The per-day table supersedes the single weekly hour figure, and the
prose WEEKLY STRUCTURE bullet defers to it rather than restating
composition in a second place. Conformance runs alongside the existing
validators.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Prompt version, docs, and the live smoke run

**Files:** `lib/anthropic-api.ts`, `docs/systems/05-season.md`, `docs/systems/06-generation.md`, `ROADMAP.md`, `todo.md`

- [ ] **Step 1: Bump `PROMPT_VERSION` from 5 to 6**

It is write-only (stamped for provenance, never compared). The prompt's structure changed materially, so the bump is required.

- [ ] **Step 2: Run the full suite**

Run: `npm test` — expected green. Update any prompt assertion that legitimately drifted; never weaken one.

- [ ] **Step 3: The live smoke run — REQUIRED, and this is the real gate**

Unit tests only prove the deterministic scaffolding. Generate a **4-week** block (guaranteed to contain a recovery week regardless of the athlete's current state — `planRecoveryWeeks` fires at a 4-week cadence). Then read the output and check:

- Every week's actual total lands within 30 min of its target — **this is the headline check**; the 2026-07-29 baseline was −0.8/−0.5/−1.1h on loading weeks.
- Zero `SKELETON:` warnings, or, if any appear, note exactly which slots the model refused and why.
- The recovery week still shows one quality session of the focus type, no dropped types, and an unbroken long ride.
- `data/ai-usage.json` recorded the call.

Record the actual per-week hours in the report — that number is the whole point of this phase.

- [ ] **Step 4: Update docs**

- `docs/systems/06-generation.md` — document the skeleton as the composition authority and the LLM's narrowed role.
- `docs/systems/05-season.md` — the tripwire entry says the deterministic-skeleton response is "scoped as Phase B, not started". Update it to reflect what shipped.
- `ROADMAP.md` "Watch" — the **P2 · hour-target precision** row should record the new measured result rather than the old "up to ~1.5h off".
- `todo.md` — tick the Phase B item and the P2 hour-target item, moving their one-line records to `ARCHIVE.md`.

- [ ] **Step 5: Commit**

```bash
git add lib/anthropic-api.ts docs/systems/05-season.md docs/systems/06-generation.md ROADMAP.md todo.md
git commit -m "chore(generate): PROMPT_VERSION 6, document the shipped skeleton

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Out of scope for Phase B

- **Hard-failing conformance** (D2) — warn-only until real runs show the model complies.
- **Per-day type enums in the tool schema** — invalidates the KB prompt cache every generation.
- **Intra-block progression** — loading weeks stay flat within a block; progression happens between blocks.
- **B/C-priority event differentiation in taper handling** — a C-priority event arguably should occupy a quality slot rather than trigger a taper; that changes athlete-facing planning, not just correctness.
- **Retiring `formatWeekTargets` / `formatRecoveryWeeks`** — both stay as the no-skeleton fallback and narrative framing respectively.
- **Any UI work.**

## Verification checklist

- [ ] `npm test` green (baseline 1417, expect ~1435)
- [ ] `npm run build` succeeds
- [ ] One live 4-week smoke run, per-week hours recorded and within tolerance
- [ ] No warning restates a fact another validator already owns
- [ ] `git log` shows 5 focused commits, none sweeping unrelated files
