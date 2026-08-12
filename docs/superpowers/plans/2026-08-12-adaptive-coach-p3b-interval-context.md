# Adaptive self-directed coach — Phase 3b: curated-interval context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a self-directed ride's note claim HR ("stay under 154bpm"), cadence, or terrain ("did a
climb") get graded against curated intervals the same way duration/power/zone claims already are —
label-matched first, gradient/VAM always attached as evidence context.

**Architecture:** Extend `ExecutedInterval` with the metrics Intervals.icu already computes per curated
interval (`maxHr`, `avgCadenceRpm`, `maxGradientPct`, `elevationGainM`, `label`) and `IntentTarget` with
the new claim shapes (`targetHrBpm`, `targetCadenceRpm`, `terrain`). Generalize `matchLaps` to rank
candidates by whichever target field an objective actually stated (one field drives it, never a blend);
add a new `terrain` `ObjectiveKind` graded by existence+duration (never technique); extend `gradeEffort`
with HR-ceiling and cadence grading branches. No new persistence, no new API route, no new UI component —
`RideIntentBlock` already renders any measurable objective's `description`/`evidence` generically
(verified by reading it; Task 9 adds a test proving it rather than just asserting it).

**Tech Stack:** Next.js 16 (App Router), TypeScript 5, Vitest, `@testing-library/react` (jsdom).

## Global Constraints

- **One target field drives ranking per objective.** Never a weighted multi-signal blend — no
  defensible industry-standard formula exists to justify one (design doc §8).
- **Terrain claims are existence+duration, never quality/technique.** `gradeTerrain` must never produce
  a skill grade (design doc §15's non-goal on descending/cornering technique).
- **Label is the primary terrain match signal; gradient/VAM are *always* attached as evidence**,
  regardless of whether the match came via label or gradient fallback.
- **A genuinely ambiguous match stays ungraded — never guess.** Mirrors the existing zone-only-candidate
  rule (`matchLaps`'s `candidates.length === 1 ? candidates : []`).
- **HR/cadence targets are single ceiling/target values in this phase, not ranges.**
- **`Maxgradient` is the raw field's exact casing** — capital M, no underscore, unlike every other
  snake_case field on the same payload. Verified live 2026-08-12. Easy to mistype as `max_gradient`.
- **`distance` and `groupId` are out of scope.** VAM only needs `elevationGainM`/`durationSec` (both in
  scope); `groupId` is Intervals.icu's own auto-generated duration+watts+cadence bucket string, no
  terrain semantics, gets no new consumer.
- **No Strava segment resolution, no per-interval CP/W′, no sensor fields, no torque/speed/per-interval
  training-load/strain/intensity.** No plausible note-phrase consumer for any of these.
- **`INTENT_PROMPT_VERSION` bumps; one live smoke run is required before this is done** (AGENTS.md:
  "LLM-backed paths need one live smoke run") — **and a second, separate smoke run once the athlete has
  actually labelled a ride**, since all real data sampled during design had `label: null` everywhere
  (Task 11 covers the first; the second is the athlete's to trigger later, noted in Task 11's Step 3).
- **Adding `"terrain"` to `ObjectiveKind` will make the TypeScript compiler enumerate every switch
  statement over that union that needs a new case.** Task 7 relies on this — run `npx tsc --noEmit`
  after adding the type and let the compiler's own error list be the authority on what else needs a
  case, rather than trusting this plan's enumeration is exhaustive.
- **Task ordering matters here more than usual.** Task 7 (the `terrain` kind's grading) calls `matchLaps`
  expecting Task 6's (matchLaps generalization) shape to already exist — do these two in numeric order,
  not the reverse.

---

## Task 0: Confirm baseline

**Files:** none (verification only).

- [ ] **Step 1: Verify the branch and design doc exist**

```bash
git branch --show-current
```

Expected: `claude/adaptive-coach-p3-scoping` (or whatever branch this plan was committed on — if you're
implementing this as a separate `codex/<task>` branch off `origin/main`, expect this plan file and
`docs/superpowers/specs/2026-08-12-adaptive-coach-p3b-interval-context-design.md` to both be present on
`main` already, since the docs land there before implementation starts).

```bash
grep -n "export interface ExecutedInterval" lib/types.ts
grep -n "export function matchLaps" lib/intent-scoring.ts
grep -n "^[0-9]\+\." docs/INVARIANTS.md | tail -1
```

Expected: first two greps print a match; the third prints the current highest invariant number (55 as
of this plan's writing — Task 10 appends the next one after whatever this actually prints, not a
hard-coded value).

- [ ] **Step 2: Read the design doc**

Read `docs/superpowers/specs/2026-08-12-adaptive-coach-p3b-interval-context-design.md` in full before
starting Task 1. This plan implements it; it does not restate the reasoning behind each locked decision.

---

## Task 1: Sync — `ExecutedInterval` gains 5 fields

**Files:**
- Modify: `lib/types.ts` (`ExecutedInterval`, `lib/types.ts:398-411`)
- Modify: `lib/intervals-api.ts` (`fetchIntervals`, `lib/intervals-api.ts:186-210`)
- Test: `lib/intervals-api.test.ts`

**Interfaces:**
- Produces: `ExecutedInterval` gains `maxHr: number | null`, `avgCadenceRpm: number | null`,
  `maxGradientPct: number | null`, `elevationGainM: number | null`, `label: string | null`. Read by
  Tasks 6-8.

- [ ] **Step 1: Write the failing tests**

Add to `lib/intervals-api.test.ts` (extend the existing `fetchIntervals` describe block — grep the file
for `"maps the three newly-added interval fields"` to find its mocked raw payload pattern and reuse it):

```ts
it("maps the five Phase 3b interval fields", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
    type: "WORK", moving_time: 480, average_watts: 210,
    max_heartrate: 172, average_cadence: 88, Maxgradient: 11.7,
    total_elevation_gain: 42.5, label: "Climb 1",
  }]), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  const [interval] = await fetchIntervals("act-1");
  expect(interval.maxHr).toBe(172);
  expect(interval.avgCadenceRpm).toBe(88);
  expect(interval.maxGradientPct).toBeCloseTo(11.7, 1);
  expect(interval.elevationGainM).toBeCloseTo(42.5, 1);
  expect(interval.label).toBe("Climb 1");
});

it("maps all five to null when the raw payload omits them", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
    type: "WORK", moving_time: 480, average_watts: 210,
  }]), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  const [interval] = await fetchIntervals("act-1");
  expect(interval.maxHr).toBeNull();
  expect(interval.avgCadenceRpm).toBeNull();
  expect(interval.maxGradientPct).toBeNull();
  expect(interval.elevationGainM).toBeNull();
  expect(interval.label).toBeNull();
});

it("treats an empty-string label as null, not an empty match target", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
    type: "WORK", moving_time: 480, average_watts: 210, label: "",
  }]), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  const [interval] = await fetchIntervals("act-1");
  expect(interval.label).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/intervals-api.test.ts -t "Phase 3b"
```

Expected: FAIL — the five fields don't exist on `ExecutedInterval` yet (TypeScript error) or read as
`undefined`.

- [ ] **Step 3: Add the fields to the type**

In `lib/types.ts`, inside `ExecutedInterval` (`lib/types.ts:398-411`), add after `zone: number | null;`:

```ts
  // Phase 3b: the metrics Intervals.icu already computes per curated interval, beyond gradient/zone.
  // Peak HR (not just average) is needed so a claim like "stay under 154bpm" can catch a brief spike
  // even when the interval's average stayed under the ceiling.
  maxHr: number | null;
  avgCadenceRpm: number | null;
  // Peak gradient, not average — a real interval's average can read near 0% while its peak hits double
  // digits; the mean washes out short pitches (verified against real ride data during design).
  maxGradientPct: number | null;
  elevationGainM: number | null;
  // Athlete-typed free text on a manually curated interval (Intervals.icu's own "label" feature) — the
  // highest-confidence terrain/effort match signal this phase has, when present. Confirmed API-exposed
  // as `iv.label`; empty string is normalised to null at the mapping boundary (Step 4), never an
  // empty-but-present match target.
  label: string | null;
```

- [ ] **Step 4: Thread the mapping through**

In `lib/intervals-api.ts`'s `fetchIntervals` (`lib/intervals-api.ts:192-206`), add to the mapped object
literal, after `zone: num(iv.zone),`:

```ts
        maxHr: num(iv.max_heartrate),
        avgCadenceRpm: num(iv.average_cadence),
        // NOTE the exact raw key casing: `Maxgradient` — capital M, no underscore, unlike every other
        // snake_case field on this payload. Verified live 2026-08-12; do not "fix" it to max_gradient.
        maxGradientPct: num(iv.Maxgradient),
        elevationGainM: num(iv.total_elevation_gain),
        label: typeof iv.label === "string" && iv.label.trim() ? iv.label : null,
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run lib/intervals-api.test.ts
```

Expected: PASS, full file green.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/intervals-api.ts lib/intervals-api.test.ts
git commit -m "feat(intervals): map HR, cadence, peak gradient, elevation gain and label onto ExecutedInterval"
```

---

## Task 2: Patch existing `ExecutedInterval` fixtures

Task 1's five new required (non-optional) fields break every existing `ExecutedInterval`-typed literal
outside its own files — the same fixture-patch pattern Phase 2c's Task 11 already established for its
three fields.

**Files:**
- Modify: `lib/intent-scoring.test.ts` (`lap()` helper, `lib/intent-scoring.test.ts:65-78`)
- Modify: `lib/durability-score.test.ts` (`iv()` helper, `lib/durability-score.test.ts:7-10`)
- Modify: `lib/trace.test.ts` (`work()` helper, `lib/trace.test.ts:5-16`)
- Modify: `app/api/sync/route.test.ts` (10 inline literals: lines 1081-1083, 1141, 1305-1307, 1334-1336)

- [ ] **Step 1: Run the full suite to see the current breakage**

```bash
npx vitest run 2>&1 | grep -i "error\|fail" | head -30
```

Expected: TypeScript errors in the four files above, each missing the five new required fields.

- [ ] **Step 2: Patch `lib/intent-scoring.test.ts`'s `lap()` helper**

Replace (`lib/intent-scoring.test.ts:65-78`):

```ts
function lap(durationSec: number, avgWatts: number | null, startIndex: number | null = null): ExecutedInterval {
  return {
    type: "WORK",
    durationSec,
    avgWatts,
    npWatts: avgWatts,
    avgHr: null,
    startIndex,
    endIndex: startIndex === null ? null : startIndex + durationSec,
    avgGradientPct: null,
    groupId: null,
    zone: null,
  };
}
```

with:

```ts
function lap(durationSec: number, avgWatts: number | null, startIndex: number | null = null): ExecutedInterval {
  return {
    type: "WORK",
    durationSec,
    avgWatts,
    npWatts: avgWatts,
    avgHr: null,
    startIndex,
    endIndex: startIndex === null ? null : startIndex + durationSec,
    avgGradientPct: null,
    groupId: null,
    zone: null,
    maxHr: null,
    avgCadenceRpm: null,
    maxGradientPct: null,
    elevationGainM: null,
    label: null,
  };
}
```

- [ ] **Step 3: Patch `lib/durability-score.test.ts`'s `iv()` helper**

Replace (`lib/durability-score.test.ts:7-10`):

```ts
const iv = (over: Partial<ExecutedInterval>): ExecutedInterval => ({
  type: "WORK", durationSec: 0, avgWatts: null, npWatts: null, avgHr: null, startIndex: null, endIndex: null,
  avgGradientPct: null, groupId: null, zone: null, ...over,
});
```

with:

```ts
const iv = (over: Partial<ExecutedInterval>): ExecutedInterval => ({
  type: "WORK", durationSec: 0, avgWatts: null, npWatts: null, avgHr: null, startIndex: null, endIndex: null,
  avgGradientPct: null, groupId: null, zone: null,
  maxHr: null, avgCadenceRpm: null, maxGradientPct: null, elevationGainM: null, label: null,
  ...over,
});
```

- [ ] **Step 4: Patch `lib/trace.test.ts`'s `work()` helper**

Replace (`lib/trace.test.ts:5-16`):

```ts
const work = (startIndex: number, endIndex: number): ExecutedInterval => ({
  type: "WORK",
  durationSec: endIndex - startIndex,
  avgWatts: 300,
  npWatts: 305,
  avgHr: 165,
  startIndex,
  endIndex,
  avgGradientPct: null,
  groupId: null,
  zone: null,
});
```

with:

```ts
const work = (startIndex: number, endIndex: number): ExecutedInterval => ({
  type: "WORK",
  durationSec: endIndex - startIndex,
  avgWatts: 300,
  npWatts: 305,
  avgHr: 165,
  startIndex,
  endIndex,
  avgGradientPct: null,
  groupId: null,
  zone: null,
  maxHr: null,
  avgCadenceRpm: null,
  maxGradientPct: null,
  elevationGainM: null,
  label: null,
});
```

- [ ] **Step 5: Patch `app/api/sync/route.test.ts`'s 10 inline literals**

Each of the 10 lines (1081-1083, 1141, 1305-1307, 1334-1336) currently ends `..., avgGradientPct: null, groupId: null, zone: null }`. For each one, insert the five new fields before the closing brace, e.g. line 1081 becomes:

```ts
      { type: "WORK", durationSec: 720, avgWatts: 190, npWatts: 192, avgHr: 155, startIndex: 0, endIndex: 100, avgGradientPct: null, groupId: null, zone: null, maxHr: null, avgCadenceRpm: null, maxGradientPct: null, elevationGainM: null, label: null },
```

Apply the same `, maxHr: null, avgCadenceRpm: null, maxGradientPct: null, elevationGainM: null, label: null` insertion (before the final ` }`) to all 10 lines — they differ only in `startIndex`/`endIndex` values, which stay unchanged.

- [ ] **Step 6: Run the full suite**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: PASS, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add lib/intent-scoring.test.ts lib/durability-score.test.ts lib/trace.test.ts app/api/sync/route.test.ts
git commit -m "test(intervals): patch ExecutedInterval fixtures for Phase 3b's five new fields"
```

---

## Task 3: `IntentTarget` additions + Zod schema + prompt

**Files:**
- Modify: `lib/types.ts` (`IntentTarget`, `lib/types.ts:686-692`; `ObjectiveKind`, `lib/types.ts:683`)
- Modify: `lib/intent-schema.ts`
- Modify: `lib/intent-prompt.ts`
- Test: `lib/intent-schema.test.ts` (create if it doesn't already exist — check first)

**Interfaces:**
- Produces: `IntentTarget` gains `targetHrBpm?: number`, `targetCadenceRpm?: number`,
  `terrain?: "climb" | "descent"`. `ObjectiveKind` gains `"terrain"`. Read by Tasks 5-8.

- [ ] **Step 1: Check for an existing schema test file**

```bash
ls lib/intent-schema.test.ts 2>&1
```

If it exists, read it first and follow its existing pattern for Step 2 below instead of creating a new
file structure. If it does not exist, Step 2 creates one.

- [ ] **Step 2: Write the failing test**

Add (to the existing file, or create `lib/intent-schema.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { IntentToolSchema } from "./intent-schema";

describe("IntentToolSchema — Phase 3b fields", () => {
  const base = { primaryPurpose: "endurance", phases: [], confidence: "high" as const };

  it("accepts an objective with targetHrBpm", () => {
    const result = IntentToolSchema.safeParse({
      ...base,
      objectives: [{
        description: "stay under 154bpm", kind: "effort", zoneBasis: "heart-rate",
        target: { durationMin: 30, targetHrBpm: 154 }, grounded: true, sourceText: "under 154bpm",
      }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an objective with targetCadenceRpm", () => {
    const result = IntentToolSchema.safeParse({
      ...base,
      objectives: [{
        description: "high cadence spin", kind: "effort", zoneBasis: "unspecified",
        target: { durationMin: 20, targetCadenceRpm: 95 }, grounded: true, sourceText: "high cadence",
      }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a terrain objective", () => {
    const result = IntentToolSchema.safeParse({
      ...base,
      objectives: [{
        description: "did a climb", kind: "terrain", zoneBasis: "unspecified",
        target: { terrain: "climb" }, grounded: true, sourceText: "did a climb",
      }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a terrain value outside the climb/descent enum", () => {
    const result = IntentToolSchema.safeParse({
      ...base,
      objectives: [{
        description: "flat section", kind: "terrain", zoneBasis: "unspecified",
        target: { terrain: "flat" }, grounded: true, sourceText: null,
      }],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run lib/intent-schema.test.ts -t "Phase 3b"
```

Expected: FAIL — `kind: "effort"` with `targetHrBpm`/`targetCadenceRpm` rejected by the `.strict()`
schema (unrecognized key), and `kind: "terrain"` rejected (not in the enum).

- [ ] **Step 4: Add the fields to `IntentTarget` and `ObjectiveKind`**

In `lib/types.ts` (`IntentTarget`, `lib/types.ts:686-692`), replace:

```ts
export interface IntentTarget {
  durationMin?: number;
  watts?: number;
  targetPctFtp?: number;
  zone?: string;
  reps?: number;
}
```

with:

```ts
export interface IntentTarget {
  durationMin?: number;
  watts?: number;
  targetPctFtp?: number;
  zone?: string;
  reps?: number;
  // Phase 3b. Ceiling, not a range — matches the athlete's actual note style ("under 154bpm").
  targetHrBpm?: number;
  targetCadenceRpm?: number;
  // Qualifier, not a numeric target — resolved by ExecutedInterval.label first, ExecutedInterval's
  // maxGradientPct/elevationGainM as fallback. See lib/intent-scoring.ts's matchLaps.
  terrain?: "climb" | "descent";
}
```

Also update `ObjectiveKind` (`lib/types.ts:683`) — add `"terrain"`:

```ts
export type ObjectiveKind = "duration" | "zone-time" | "zone-emphasis" | "effort" | "structure" | "qualitative" | "terrain";
```

**This will break compilation across several files** (every exhaustive `switch` over `ObjectiveKind`).
That is expected — Task 7 fixes every break the compiler reports. Do not attempt to make the build green
again within this task; Steps 5-7 below only cover the schema/prompt layer, which does compile on its
own.

- [ ] **Step 5: Update the Zod schema**

In `lib/intent-schema.ts`:

Replace line 5:
```ts
const ObjectiveKindSchema = z.enum(["duration", "zone-time", "zone-emphasis", "effort", "structure", "qualitative"]);
```
with:
```ts
const ObjectiveKindSchema = z.enum(["duration", "zone-time", "zone-emphasis", "effort", "structure", "qualitative", "terrain"]);
```

Replace the `TargetSchema` (lines 8-19):
```ts
const TargetSchema = z
  .object({
    durationMin: z.number().positive().optional(),
    watts: z.number().min(30).max(2000).optional(),
    targetPctFtp: z.number().min(30).max(200).optional(),
    zone: z.string().optional(),
    reps: z.number().int().positive().optional(),
  })
  .strict()
  .refine((target) => target.watts === undefined || target.targetPctFtp === undefined, {
    message: "watts and targetPctFtp are mutually exclusive",
  });
```
with:
```ts
const TargetSchema = z
  .object({
    durationMin: z.number().positive().optional(),
    watts: z.number().min(30).max(2000).optional(),
    targetPctFtp: z.number().min(30).max(200).optional(),
    zone: z.string().optional(),
    reps: z.number().int().positive().optional(),
    targetHrBpm: z.number().min(60).max(230).optional(),
    targetCadenceRpm: z.number().min(30).max(150).optional(),
    terrain: z.enum(["climb", "descent"]).optional(),
  })
  .strict()
  .refine((target) => target.watts === undefined || target.targetPctFtp === undefined, {
    message: "watts and targetPctFtp are mutually exclusive",
  });
```

Replace the `PhaseSchema` (lines 21-35) to add the same three fields — `durationMin`, `zone`,
`zoneBasis`, `targetWatts`, `targetPctFtp`, `reps` are already there; add after `reps`:
```ts
    targetHrBpm: z.number().min(60).max(230).optional(),
    targetCadenceRpm: z.number().min(30).max(150).optional(),
    terrain: z.enum(["climb", "descent"]).optional(),
```
(immediately before the closing `})` and the existing `.strict().refine(...)` chain — grep the file for
`const PhaseSchema` to confirm the exact current field order before inserting.)

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run lib/intent-schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Update the prompt**

In `lib/intent-prompt.ts`, bump the version (line 1):
```ts
export const INTENT_PROMPT_VERSION = 1;
```
becomes:
```ts
export const INTENT_PROMPT_VERSION = 2;
```

Add a new rule to `buildIntentPrompt`'s rule list (after the existing `"Keep qualitative skill goals as
qualitative objectives; sensor data cannot establish their quality."` line):

```ts
- A stated HR ceiling (e.g. "stay under 154bpm") is an effort objective with zoneBasis heart-rate and target.targetHrBpm set to that number — not a zone-time claim, and not qualitative.
- A stated cadence target (e.g. "high cadence spin", "90rpm") is an effort objective with target.targetCadenceRpm set — only when the note gives a number or an unambiguous descriptor; do not invent a cadence value.
- A claim that a climb or descent of some length happened is a terrain objective with target.terrain set to "climb" or "descent" — this is an existence claim (did it happen, roughly how long), never a claim about how well it was ridden. A claim about descending or climbing SKILL or FEEL (e.g. "the descent felt great", "practiced cornering") stays qualitative — it is not a terrain objective.
```

**This is the one place this phase touches LLM behavior beyond adding fields.** Getting the
terrain-vs-qualitative distinction right in the prompt matters: too loose and every "great ride through
the hills" becomes a spurious terrain objective; too strict and real "did a climb" claims stay
qualitative and never get graded. Task 11's live smoke run is where this actually gets checked against a
real model response — do not consider this step done from the wording alone.

- [ ] **Step 8: Commit**

```bash
git add lib/types.ts lib/intent-schema.ts lib/intent-schema.test.ts lib/intent-prompt.ts
git commit -m "feat(intent): add HR ceiling, cadence and terrain to IntentTarget, schema and prompt"
```

---

## Task 4: VAM helper

**Files:**
- Modify: `lib/intent-scoring.ts`
- Test: `lib/intent-scoring.test.ts`

**Interfaces:**
- Produces: `vam(elevationGainM: number, durationSec: number): number` — meters climbed per hour. Read
  by Task 7's `gradeTerrain`.

- [ ] **Step 1: Write the failing test**

Add to `lib/intent-scoring.test.ts` (a new top-level `describe`, anywhere after the imports):

```ts
describe("vam", () => {
  it("computes vertical meters per hour", () => {
    // 500 m gained in 30 min (1800s) → 1000 m/h
    expect(vam(500, 1800)).toBeCloseTo(1000, 0);
  });

  it("matches a realistic club-cyclist reference point", () => {
    // ~800 m gained over a 1-hour climb is within the ~700-900 m/h club-cyclist VAM range
    // (Cycling Weekly / TrainingPeaks reference points cited in the design doc).
    expect(vam(800, 3600)).toBe(800);
  });
});
```

Add `vam` to the file's existing `import { ... } from "./intent-scoring"` line at the top of the test
file (grep for the current import list first).

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/intent-scoring.test.ts -t "vam"
```

Expected: FAIL — `vam` is not exported.

- [ ] **Step 3: Implement it**

Add to `lib/intent-scoring.ts`, near `lapMinutes` (`lib/intent-scoring.ts:537-538`):

```ts
// VAM (vertical ascent meters/hour) — Michele Ferrari's "Velocità Ascensionale Media", an established
// cycling climbing-effort metric independent of gradient noise. Evidence-text context only (design doc
// §6) — never a scored dimension by itself. Reference points: club cyclists ~700-900 m/h, professional
// mountain-stage efforts ~1650-1800 m/h.
export function vam(elevationGainM: number, durationSec: number): number {
  return elevationGainM / (durationSec / 3600);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run lib/intent-scoring.test.ts -t "vam"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "feat(intent-scoring): add vam() — vertical ascent meters/hour, evidence-text only"
```

---

## Task 5: Close the canonicalisation collision gap for HR/cadence

**Why this task exists:** `identityKey` (`lib/intent-scoring.ts:309-322`) and `mergeKey`'s `"effort"`
case (`lib/intent-scoring.ts:374-380`) build their dedup/merge keys from `(kind, zone, zoneBasis,
durationMin, watts, targetPctFtp, reps)` — **`targetHrBpm`/`targetCadenceRpm` are not in that key.** Left
unfixed, two genuinely different claims — "9 min at 250W" and "9 min under 154bpm" — with the same
stated duration would collide: `dropExactDuplicates` would silently drop one as a "duplicate" of the
other, or `mergeGroup` would merge them as if they were the same effort. This is a real correctness bug,
not a hypothetical — verified by reading `identityKey`/`mergeKey`'s actual current field lists during
this plan's writing. Fixing this does not depend on the `"terrain"` kind existing yet (Task 7), so it's
split out as its own task and done first.

**Files:**
- Modify: `lib/intent-scoring.ts` (`identityKey`, `lib/intent-scoring.ts:309-322`; `mergeKey`'s
  `"effort"` case, `lib/intent-scoring.ts:374-380`)
- Test: `lib/intent-scoring.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/intent-scoring.test.ts` (find the existing `describe("canonicalise"` or
`describe("identityKey"`/`describe("mergeKey"` block — grep the file — and add alongside it; if none of
those describe blocks exist, add a new one):

```ts
describe("identityKey — Phase 3b collision guard", () => {
  it("a power-targeted effort and an HR-targeted effort with the same duration do NOT collide", () => {
    const power = objective({ kind: "effort", target: { durationMin: 9, watts: 250 } });
    const hr = objective({ kind: "effort", target: { durationMin: 9, targetHrBpm: 154 } });
    expect(identityKey(power)).not.toBe(identityKey(hr));
  });

  it("a power-targeted effort and a cadence-targeted effort with the same duration do NOT collide", () => {
    const power = objective({ kind: "effort", target: { durationMin: 9, watts: 250 } });
    const cadence = objective({ kind: "effort", target: { durationMin: 9, targetCadenceRpm: 95 } });
    expect(identityKey(power)).not.toBe(identityKey(cadence));
  });
});
```

(`objective(...)` — reuse the file's existing objective-fixture helper; grep for `function objective(`
near the top of the file to confirm its exact signature before using it. Add `identityKey` to the file's
import list if not already imported.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run lib/intent-scoring.test.ts -t "collision guard"
```

Expected: FAIL — both pairs currently produce the same key.

- [ ] **Step 3: Fix `identityKey`**

Replace (`lib/intent-scoring.ts:309-322`):

```ts
export function identityKey(objective: ScoredObjective): string {
  const target = objective.target ?? {};
  const parts = [
    objective.kind,
    zoneKey(target.zone),
    objective.zoneBasis,
    roundOr(target.durationMin, 1),
    roundOr(target.watts, 5),
    roundOr(target.targetPctFtp, 1),
    roundOr(target.reps, 1),
  ];
  if (objective.kind === "qualitative") parts.push(objective.description);
  return parts.join("|");
}
```

with:

```ts
export function identityKey(objective: ScoredObjective): string {
  const target = objective.target ?? {};
  const parts = [
    objective.kind,
    zoneKey(target.zone),
    objective.zoneBasis,
    roundOr(target.durationMin, 1),
    roundOr(target.watts, 5),
    roundOr(target.targetPctFtp, 1),
    roundOr(target.reps, 1),
    // Phase 3b: without these, an HR- or cadence-targeted effort collides with a power-targeted one of
    // the same stated duration — a real bug found by reading this function's actual field list.
    roundOr(target.targetHrBpm, 1),
    roundOr(target.targetCadenceRpm, 1),
    target.terrain ?? "-",
  ];
  if (objective.kind === "qualitative") parts.push(objective.description);
  return parts.join("|");
}
```

- [ ] **Step 4: Fix `mergeKey`'s `"effort"` case**

Replace (`lib/intent-scoring.ts:374-380`):

```ts
    case "effort":
      // `reps` is deliberately absent: two readings of one effort that disagree only on rep count are
      // CONTRADICTORY, not additive.
      return `effort|${roundOr(target.durationMin, 1)}|${roundOr(target.watts, 5)}|${roundOr(
        target.targetPctFtp,
        1
      )}|${zoneKey(target.zone)}`;
```

with:

```ts
    case "effort":
      // `reps` is deliberately absent: two readings of one effort that disagree only on rep count are
      // CONTRADICTORY, not additive. targetHrBpm/targetCadenceRpm added (Phase 3b) for the same reason
      // identityKey needed them — otherwise an HR-targeted and a power-targeted effort of the same
      // duration merge into one.
      return `effort|${roundOr(target.durationMin, 1)}|${roundOr(target.watts, 5)}|${roundOr(
        target.targetPctFtp,
        1
      )}|${zoneKey(target.zone)}|${roundOr(target.targetHrBpm, 1)}|${roundOr(target.targetCadenceRpm, 1)}`;
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run lib/intent-scoring.test.ts
```

Expected: PASS. (`target.terrain` in `identityKey` references a field that exists as of Task 3; this
compiles regardless of whether `"terrain"` is a valid `ObjectiveKind` value yet, since `IntentTarget`
already carries `terrain?` independent of the kind.)

- [ ] **Step 6: Commit**

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "fix(intent-scoring): include targetHrBpm/targetCadenceRpm/terrain in dedup and merge keys"
```

---

## Task 6: Generalize `matchLaps` for HR, cadence and terrain

**Files:**
- Modify: `lib/intent-scoring.ts` (`matchLaps`, `lib/intent-scoring.ts:512-536`)
- Test: `lib/intent-scoring.test.ts`

**Interfaces:**
- Produces: `matchLaps` now also ranks by `target.targetHrBpm`/`target.targetCadenceRpm` distance when
  set, and resolves `target.terrain` via label-first/gradient-fallback with the zero-duration case
  requiring an unambiguous single candidate (mirrors the existing zone-only-candidate rule). Also
  produces `CLIMB_GRADIENT_FLOOR_PCT` (module-level constant) and `filterByTerrain` — both read by
  Task 7's `gradeTerrain` indirectly (through this task's `matchLaps`) and directly is not needed by
  Task 7, which only calls `matchLaps`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/intent-scoring.test.ts` (near the existing `describe("matchLaps"` block — grep for it):

```ts
describe("matchLaps — Phase 3b: HR and cadence ranking", () => {
  it("ranks by HR distance when targetHrBpm is set", () => {
    const target: IntentTarget = { durationMin: 10, targetHrBpm: 154 };
    const close = { ...lap(600, 200), avgHr: 152 };
    const far = { ...lap(600, 200), avgHr: 170 };
    expect(matchLaps(target, [far, close])).toEqual([close]);
  });

  it("ranks by cadence distance when targetCadenceRpm is set", () => {
    const target: IntentTarget = { durationMin: 10, targetCadenceRpm: 95 };
    const close = { ...lap(600, 200), avgCadenceRpm: 93 };
    const far = { ...lap(600, 200), avgCadenceRpm: 70 };
    expect(matchLaps(target, [far, close])).toEqual([close]);
  });
});

describe("matchLaps — Phase 3b: terrain, label-first with gradient fallback", () => {
  it("prefers a labelled climb over an unlabelled one clearing the gradient floor, with a stated duration", () => {
    const target: IntentTarget = { terrain: "climb", durationMin: 8 };
    const labelled = { ...lap(480, 220), label: "Climb 1", maxGradientPct: 5 };
    const unlabelled = { ...lap(480, 220), maxGradientPct: 12 };
    expect(matchLaps(target, [unlabelled, labelled])).toEqual([labelled]);
  });

  it("falls back to the gradient floor when no label exists, with a stated duration", () => {
    const target: IntentTarget = { terrain: "climb", durationMin: 8 };
    const climb = { ...lap(480, 220), maxGradientPct: 9 };
    const flat = { ...lap(480, 220), maxGradientPct: 1 };
    expect(matchLaps(target, [flat, climb])).toEqual([climb]);
  });

  it("never selects a duration-matched lap that clears neither label nor gradient floor — no guessing", () => {
    const target: IntentTarget = { terrain: "climb", durationMin: 8 };
    const flat = { ...lap(480, 220), maxGradientPct: 1 };
    expect(matchLaps(target, [flat])).toEqual([]);
  });

  it("resolves an unstated-duration climb claim only when exactly one candidate qualifies", () => {
    const target: IntentTarget = { terrain: "climb" };
    const one = { ...lap(300, 220), maxGradientPct: 9 };
    expect(matchLaps(target, [one])).toEqual([one]);
  });

  it("stays ungraded on an unstated-duration climb claim with two qualifying candidates — never guesses", () => {
    const target: IntentTarget = { terrain: "climb" };
    const a = { ...lap(300, 220), maxGradientPct: 9 };
    const b = { ...lap(400, 230), maxGradientPct: 10 };
    expect(matchLaps(target, [a, b])).toEqual([]);
  });

  it("descent uses the negative gradient floor", () => {
    const target: IntentTarget = { terrain: "descent", durationMin: 5 };
    const descent = { ...lap(300, 150), maxGradientPct: -6 };
    const flat = { ...lap(300, 150), maxGradientPct: 0.5 };
    expect(matchLaps(target, [flat, descent])).toEqual([descent]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/intent-scoring.test.ts -t "Phase 3b: HR and cadence ranking\|Phase 3b: terrain"
```

Expected: FAIL — `matchLaps` doesn't read `targetHrBpm`/`targetCadenceRpm`/`terrain` yet.

- [ ] **Step 3: Implement**

Replace `matchLaps` in full (`lib/intent-scoring.ts:512-536`):

```ts
export function matchLaps(
  target: IntentTarget,
  laps: ExecutedInterval[],
  resolvedWatts: number | null = null
): ExecutedInterval[] {
  const durationMin = numeric(target.durationMin);
  if (durationMin === null || durationMin <= 0) {
    if (target.terrain) return matchTerrainByLabelOrGradient(target.terrain, laps);
    const zone = zoneIndex(target.zone);
    if (zone === null) return [];
    const candidates = laps.filter((lap) => lap.zone === zone + 1);
    return candidates.length === 1 ? candidates : [];
  }
  const targetSec = durationMin * 60;
  const low = targetSec * (1 - LAP_DURATION_TOLERANCE);
  const high = targetSec * (1 + LAP_DURATION_TOLERANCE);
  let candidates = laps.filter((lap) => lap.durationSec >= low && lap.durationSec <= high);
  if (target.terrain) candidates = filterByTerrain(target.terrain, candidates);
  const wanted = Math.max(1, Math.round(numeric(target.reps) ?? 1));
  const distance = (lap: ExecutedInterval): number => {
    if (target.terrain) return hasLabelHint(lap, target.terrain) ? -1 : 0; // both already terrain-qualified by filterByTerrain; label just breaks ties
    if (target.targetHrBpm != null) {
      return lap.avgHr == null ? Number.MAX_SAFE_INTEGER : Math.abs(lap.avgHr - target.targetHrBpm);
    }
    if (target.targetCadenceRpm != null) {
      return lap.avgCadenceRpm == null ? Number.MAX_SAFE_INTEGER : Math.abs(lap.avgCadenceRpm - target.targetCadenceRpm);
    }
    if (resolvedWatts === null) return Math.abs(lap.durationSec - targetSec);
    if (lap.avgWatts == null) return Number.MAX_SAFE_INTEGER;
    return Math.abs(lap.avgWatts - resolvedWatts);
  };
  return [...candidates].sort((a, b) => distance(a) - distance(b)).slice(0, wanted);
}

// Strava's own published climb-categorization floor (support.strava.com/hc/en-us/articles/216917057) —
// borrowed here as the minimum |maxGradientPct| that counts as a climb/descent at all, not their full
// length×gradient category scoring, which this phase doesn't need.
const CLIMB_GRADIENT_FLOOR_PCT = 3;

function hasLabelHint(lap: ExecutedInterval, terrain: "climb" | "descent"): boolean {
  return (lap.label ?? "").trim().toLowerCase().includes(terrain);
}

function clearsGradientFloor(lap: ExecutedInterval, terrain: "climb" | "descent"): boolean {
  if (lap.maxGradientPct == null) return false;
  return terrain === "climb" ? lap.maxGradientPct >= CLIMB_GRADIENT_FLOOR_PCT : lap.maxGradientPct <= -CLIMB_GRADIENT_FLOOR_PCT;
}

// A candidate qualifies as the stated terrain only via its own label or a gradient clearing the floor
// above — NEVER by elimination among duration-matched laps. A lap that merely survived duration
// filtering but shows no climb/descent signal is not evidence of one; without this filter, "closest by
// distance" among non-qualifying candidates would silently guess.
function filterByTerrain(terrain: "climb" | "descent", candidates: ExecutedInterval[]): ExecutedInterval[] {
  const labelled = candidates.filter((lap) => hasLabelHint(lap, terrain));
  if (labelled.length > 0) return labelled; // label is the primary signal — don't dilute with gradient-only candidates once any label exists
  return candidates.filter((lap) => clearsGradientFloor(lap, terrain));
}

// The no-stated-duration path. Same ultra-conservative "exactly one candidate or nothing" rule the
// existing zone-only branch above already uses — a genuinely ambiguous terrain claim stays ungraded.
function matchTerrainByLabelOrGradient(terrain: "climb" | "descent", laps: ExecutedInterval[]): ExecutedInterval[] {
  const qualifying = filterByTerrain(terrain, laps);
  return qualifying.length === 1 ? qualifying : [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/intent-scoring.test.ts
```

Expected: PASS for every test added in this task. (Task 7's terrain-grading tests, if already written,
will now also pass — this task's `matchLaps` is their dependency.)

- [ ] **Step 5: Confirm the existing gradient-axis regression test still passes, and update its scope**

`lib/intent-scoring.test.ts:713-719` has an existing test: `"never introduces a gradient-based scoring
axis — gradient is evidence text only"`. Its scenario uses `target: { durationMin: 10, watts: 250, reps:
1 }` — a power-targeted objective with no `terrain` field — so it is unaffected by this task's changes
(the `distance` function's `target.terrain` check never fires for it) and should still pass as-is.
**Confirm this by running it explicitly:**

```bash
npx vitest run lib/intent-scoring.test.ts -t "never introduces a gradient-based scoring axis"
```

Expected: PASS, unchanged.

Its name is now a slight overstatement, though — gradient IS a real matching signal as of this task, for
`terrain`-targeted objectives specifically. Update the test's description (not its assertions) to scope
the claim correctly:

```ts
it("never uses gradient as a matching signal for power/duration-targeted objectives (terrain-targeted objectives do — see the describe block above)", () => {
```

This is the AGENTS.md "stale doc/comment pointer" bug class applied to a test name rather than a doc
cross-reference — the assertion stays true, but an absolute claim in its title would otherwise mislead
the next reader into thinking gradient plays no role anywhere in this file.

- [ ] **Step 6: Commit**

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "feat(intent-scoring): generalize matchLaps for HR/cadence ranking and label-first terrain matching"
```

---

## Task 7: The `"terrain"` kind — banding, gating, grading, dispatch

**Files:**
- Modify: `lib/intent-scoring.ts` (`GRADABLE_KINDS_BY_CONFIDENCE:71-75`, `KIND_BAND:173-180`,
  `mergeKey`'s switch:366-384, `gradeObjective`'s switch:710-737)
- Test: `lib/intent-scoring.test.ts`

**Interfaces:**
- Consumes: `matchLaps` (Task 6 — must be done first, per Global Constraints).
- Produces: `gradeTerrain(objective, pool): Verdict` — internal, dispatched from `gradeObjective`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/intent-scoring.test.ts`:

```ts
describe("gradeTerrain (via gradeObjective)", () => {
  it("grades a labelled climb as existence + duration compliance", () => {
    const o = objective({ kind: "terrain", target: { terrain: "climb", durationMin: 8 } });
    const climbLap = { ...lap(480, 220, 0), label: "Climb 1", maxGradientPct: 9.2, elevationGainM: 120 };
    const ev = evidence({ laps: [climbLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBeGreaterThanOrEqual(1);
    expect(result.objective.evidence).toMatch(/climb/i);
    expect(result.objective.evidence).toMatch(/labelled/i);
  });

  it("falls back to gradient when no label matches, and says so in evidence", () => {
    const o = objective({ kind: "terrain", target: { terrain: "climb", durationMin: 8 } });
    const climbLap = { ...lap(480, 220, 0), maxGradientPct: 9.2, elevationGainM: 120 };
    const ev = evidence({ laps: [climbLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.objective.evidence).toMatch(/gradient/i);
  });

  it("stays ungraded — never guesses — when nothing clears the climb floor and no label exists", () => {
    const o = objective({ kind: "terrain", target: { terrain: "climb", durationMin: 8 } });
    const flatLap = lap(480, 220, 0); // maxGradientPct null via the lap() helper default
    const ev = evidence({ laps: [flatLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(false);
    expect(result.delta).toBeNull();
  });

  it("includes VAM in the evidence text when elevationGainM is present", () => {
    const o = objective({ kind: "terrain", target: { terrain: "climb", durationMin: 8 } });
    // 480s = 1/7.5 h; 100 m gain → VAM = 100 / (480/3600) = 750 m/h
    const climbLap = { ...lap(480, 220, 0), label: "Climb", elevationGainM: 100, maxGradientPct: 6 };
    const ev = evidence({ laps: [climbLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.evidence).toMatch(/VAM/);
    expect(result.objective.evidence).toMatch(/750/);
  });

  it("never produces a technique/quality grade — only existence and duration compliance", () => {
    // A very short matched climb (well under the stated duration) still SCORES, on compliance — it is
    // never "ungraded" for being a bad climb. This is the design's existence-vs-quality boundary.
    const o = objective({ kind: "terrain", target: { terrain: "climb", durationMin: 20 } });
    const shortClimb = { ...lap(240, 220, 0), label: "Climb", maxGradientPct: 8 }; // 4 min vs 20 stated
    const ev = evidence({ laps: [shortClimb] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBeLessThan(0); // low compliance, not "ungraded", not a skill verdict
  });
});

describe("terrain kind — gating and banding", () => {
  it("is gradable at high and medium confidence, not low", () => {
    expect(GRADABLE_KINDS_BY_CONFIDENCE.high).toContain("terrain");
    expect(GRADABLE_KINDS_BY_CONFIDENCE.medium).toContain("terrain");
    expect(GRADABLE_KINDS_BY_CONFIDENCE.low).not.toContain("terrain");
  });
});
```

(`objective`, `lap`, `evidence` — reuse the file's existing fixture helpers. Add
`GRADABLE_KINDS_BY_CONFIDENCE`, `gradeObjective` to the import list if not already present.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/intent-scoring.test.ts -t "gradeTerrain\|terrain kind"
```

Expected: FAIL — `"terrain"` is not yet a valid `kind` in the gating/banding tables, and
`gradeObjective`'s switch doesn't handle it.

- [ ] **Step 3: Add `"terrain"` to the gradable-kinds table**

In `lib/intent-scoring.ts` (`GRADABLE_KINDS_BY_CONFIDENCE:71-75`), replace:

```ts
export const GRADABLE_KINDS_BY_CONFIDENCE: Record<IntentConfidence, readonly ObjectiveKind[]> = {
  high: ["duration", "zone-time", "zone-emphasis", "effort", "structure"],
  medium: ["duration", "zone-time", "zone-emphasis", "effort"], // structure dropped
  low: [],
};
```

with:

```ts
export const GRADABLE_KINDS_BY_CONFIDENCE: Record<IntentConfidence, readonly ObjectiveKind[]> = {
  high: ["duration", "zone-time", "zone-emphasis", "effort", "structure", "terrain"],
  // structure dropped at medium (ordinal/reward-only); terrain KEPT — it is a falsifiable existence
  // claim from lap data, the same rigor class as `effort`, not an ordinal claim like `structure`.
  medium: ["duration", "zone-time", "zone-emphasis", "effort", "terrain"],
  low: [],
};
```

- [ ] **Step 4: Add the `terrain` band**

In `lib/intent-scoring.ts` (`KIND_BAND:173-180`), add after `structure: { min: 0, max: 1 },`:

```ts
  terrain: { min: -2, max: 2 },
```

- [ ] **Step 5: Add `mergeKey`'s `"terrain"` case**

In `lib/intent-scoring.ts`'s `mergeKey` (`lib/intent-scoring.ts:366-384`), add a new case (placement
doesn't matter within the switch, but keep it near `"effort"` for readability):

```ts
    case "terrain":
      return `terrain|${target.terrain ?? "-"}|${roundOr(target.durationMin, 1)}`;
```

**Deliberately no new `mergeGroup` case.** Two terrain claims that share a merge key (same terrain
direction, same rounded duration) fall through to `mergeGroup`'s existing `default:` branch — "keep
first entry" — the same behavior `zone-emphasis`/`structure`/`qualitative` already get. This is a
documented choice, not an oversight: terrain claims are rare enough that two truly-identical-sounding
ones collapsing to one is an acceptable default, and it avoids adding merge logic with no test coverage
motivating its exact shape yet.

- [ ] **Step 6: Implement `gradeTerrain`**

Add to `lib/intent-scoring.ts`, near `gradeStructure` (`lib/intent-scoring.ts:686-701`):

```ts
// Existence + duration compliance ONLY — never a quality/technique grade (design doc §15's non-goal on
// descending/cornering skill). `matchLaps` (Task 6) does the label-first/gradient-fallback selection;
// this function only grades what it returns.
function gradeTerrain(objective: ScoredObjective, pool: ExecutedInterval[]): Verdict {
  const target = objective.target ?? {};
  const terrain = target.terrain;
  if (!terrain) return ungraded("no terrain stated");
  if (pool.length === 0) return ungraded("no interval data");

  const matched = matchLaps(target, pool);
  if (matched.length === 0) {
    return { delta: null, scored: false, measurable: true, scopeMin: 0, evidence: `no ${terrain} found in the curated intervals` };
  }

  const scopeMin = lapMinutes(matched);
  const primary = matched[0];
  const labelled = (primary.label ?? "").trim().length > 0;
  const contextParts = [
    primary.avgGradientPct != null ? `avg ${primary.avgGradientPct.toFixed(1)}%` : null,
    primary.maxGradientPct != null ? `max ${primary.maxGradientPct.toFixed(1)}%` : null,
    primary.elevationGainM != null && primary.durationSec > 0
      ? `VAM ${Math.round(vam(primary.elevationGainM, primary.durationSec))} m/h`
      : null,
  ].filter((part): part is string => part !== null);
  const context = contextParts.length > 0 ? ` — ${contextParts.join(", ")}` : "";
  const source = labelled ? "labelled" : "matched by gradient";

  const stated = numeric(target.durationMin);
  if (stated === null || stated <= 0) {
    return {
      delta: 1,
      scored: true,
      measurable: true,
      scopeMin,
      evidence: `${scopeMin.toFixed(1)} min ${terrain} (${source})${context}`,
      matchedLaps: matched,
    };
  }
  const pct = (scopeMin / stated) * 100;
  return {
    delta: complianceDelta(pct),
    scored: true,
    measurable: true,
    scopeMin,
    evidence: `${scopeMin.toFixed(1)} min ${terrain} vs ${stated} min stated (${source})${context}`,
    matchedLaps: matched,
  };
}
```

- [ ] **Step 7: Wire it into `gradeObjective`'s dispatcher**

In `lib/intent-scoring.ts`'s `gradeObjective` (`lib/intent-scoring.ts:710-737`), add a new case (after
`case "structure": ... break;`, before `case "qualitative":`):

```ts
    case "terrain":
      verdict = gradeTerrain(objective, pool);
      break;
```

- [ ] **Step 8: Run `npx tsc --noEmit` and fix whatever else it reports**

```bash
npx tsc --noEmit
```

Per this plan's Global Constraints note, adding `"terrain"` to `ObjectiveKind` makes the compiler
enumerate every exhaustive switch over that union. This plan's own investigation found exactly two —
`mergeKey` (Step 5 above) and `gradeObjective` (Step 7 above) — plus confirmed `mergeGroup`
(`lib/intent-scoring.ts:391-428`) has a catch-all `default:` and does not need one, and
`applySubsumption` (`lib/intent-scoring.ts:459-496`) is not a switch over `ObjectiveKind` at all (it
filters by explicit kind checks for `zone-time`/`zone-emphasis`/`duration` only, and a terrain claim is
none of those, so it passes through unaffected). **If `tsc` reports a switch this plan did not
anticipate, fix it and note what it was** — that is this plan's own verification method failing to be
exhaustive, worth recording for whoever reads this next.

- [ ] **Step 9: Run tests to verify they pass**

```bash
npx vitest run lib/intent-scoring.test.ts
```

Expected: PASS, full file green.

- [ ] **Step 10: Commit**

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "feat(intent-scoring): add the terrain ObjectiveKind — existence+duration grading, never technique"
```

---

## Task 8: Extend `gradeEffort` for HR-ceiling and cadence grading

**Files:**
- Modify: `lib/intent-scoring.ts` (`gradeEffort`, `lib/intent-scoring.ts:611-679`)
- Test: `lib/intent-scoring.test.ts`

**Interfaces:**
- Produces: `gradeEffort` now grades an objective by `targetHrBpm` or `targetCadenceRpm` when the note
  stated one instead of (or in addition to — the target field itself decides, mirroring
  `resolveTargetWatts`'s existing power/pctFtp exclusivity) a power target.

- [ ] **Step 1: Write the failing tests**

Add to `lib/intent-scoring.test.ts`:

```ts
describe("gradeEffort — Phase 3b: HR ceiling and cadence", () => {
  it("grades an HR ceiling claim by peak HR, not average — a brief spike still counts", () => {
    const o = objective({ kind: "effort", target: { durationMin: 30, targetHrBpm: 154 } });
    const matchedLap = { ...lap(1800, 200, 0), avgHr: 150, maxHr: 170 }; // avg under, peak well over
    const ev = evidence({ laps: [matchedLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBeLessThan(0); // peak spiked well past the ceiling
    expect(result.objective.evidence).toMatch(/peak HR 170/);
  });

  it("grades an HR ceiling claim as compliant when peak stayed under it", () => {
    const o = objective({ kind: "effort", target: { durationMin: 30, targetHrBpm: 154 } });
    const matchedLap = { ...lap(1800, 200, 0), avgHr: 145, maxHr: 150 };
    const ev = evidence({ laps: [matchedLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBe(2);
  });

  it("grades on presence when HR data is missing on all matched laps — never a failed metric", () => {
    const o = objective({ kind: "effort", target: { durationMin: 30, targetHrBpm: 154 } });
    const matchedLap = lap(1800, 200, 0); // avgHr/maxHr both null via the lap() helper default
    const ev = evidence({ laps: [matchedLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBe(1);
    expect(result.objective.evidence).toMatch(/no HR recorded/);
  });

  it("grades a cadence target using the same adherence-delta shape as power", () => {
    const o = objective({ kind: "effort", target: { durationMin: 20, targetCadenceRpm: 95 } });
    const matchedLap = { ...lap(1200, 200, 0), avgCadenceRpm: 96 }; // ~101% adherence
    const ev = evidence({ laps: [matchedLap] });
    const result = gradeObjective(o, ev, { laps: ev.laps });
    expect(result.objective.scored).toBe(true);
    expect(result.delta).toBe(2);
    expect(result.objective.evidence).toMatch(/96 rpm vs 95 rpm target/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/intent-scoring.test.ts -t "HR ceiling and cadence"
```

Expected: FAIL — `gradeEffort` currently only grades power.

- [ ] **Step 3: Add the delta function and two grading helpers**

Add to `lib/intent-scoring.ts`, near `adherenceDelta`/`complianceDelta` (`lib/intent-scoring.ts:142-160`):

```ts
// Asymmetric by design, unlike adherenceDelta — an HR ceiling is a cap, not a band to sit inside.
// Under the ceiling is unambiguously fine; the penalty scales with how far peak HR exceeded it.
function hrCeilingDelta(peakHr: number, ceilingBpm: number): number {
  const over = peakHr - ceilingBpm;
  if (over <= 0) return 2;
  if (over <= 3) return 1;
  if (over <= 8) return 0;
  if (over <= 15) return -1;
  return -2;
}
```

Add near `gradeEffort` (`lib/intent-scoring.ts:611`), just above it:

```ts
// Missing data is NEVER a failed metric (design §13, same rule gradeEffort's power branch already
// follows below) — matched-on-duration laps with no HR recorded grade on presence, not as a failure.
function gradeHrCeiling(matched: ExecutedInterval[], scopeMin: number, ceilingBpm: number): Verdict {
  const withHr = matched.filter((lap) => lap.avgHr != null || lap.maxHr != null);
  if (withHr.length === 0) {
    return {
      delta: 1,
      scored: true,
      measurable: true,
      scopeMin,
      evidence: `${matched.length} matching lap${matched.length === 1 ? "" : "s"} (no HR recorded on them, graded on presence)`,
    };
  }
  // Peak, not average — a brief spike over the ceiling is a real finding even if the average stayed under.
  const peakHr = Math.max(...withHr.map((lap) => lap.maxHr ?? lap.avgHr ?? 0));
  return {
    delta: hrCeilingDelta(peakHr, ceilingBpm),
    scored: true,
    measurable: true,
    scopeMin,
    evidence: `${matched.length} matching lap${matched.length === 1 ? "" : "s"}, peak HR ${Math.round(peakHr)} vs ${ceilingBpm} bpm ceiling`,
  };
}

function gradeCadenceTarget(matched: ExecutedInterval[], scopeMin: number, targetRpm: number): Verdict {
  const withCadence = matched.filter((lap) => lap.avgCadenceRpm != null);
  if (withCadence.length === 0) {
    return {
      delta: 1,
      scored: true,
      measurable: true,
      scopeMin,
      evidence: `${matched.length} matching lap${matched.length === 1 ? "" : "s"} (no cadence recorded on them, graded on presence)`,
    };
  }
  const meanCadence = withCadence.reduce((sum, lap) => sum + (lap.avgCadenceRpm ?? 0), 0) / withCadence.length;
  const pct = (meanCadence / targetRpm) * 100;
  return {
    delta: adherenceDelta(pct), // same symmetric band as power — a cadence TARGET (not ceiling) behaves like one
    scored: true,
    measurable: true,
    scopeMin,
    evidence: `${matched.length} matching lap${matched.length === 1 ? "" : "s"} averaging ${Math.round(meanCadence)} rpm vs ${targetRpm} rpm target (${Math.round(pct)}% adherence)`,
  };
}
```

- [ ] **Step 4: Route `gradeEffort` to the new branches**

In `gradeEffort` (`lib/intent-scoring.ts:611-679`), after the existing `if (matched.length < required) { ... }` block and before `const withPower = matched.filter(...)`, insert:

```ts
  // One target field drives grading — same priority matchLaps' ranking already used (Task 6).
  if (target.targetHrBpm != null) return gradeHrCeiling(matched, scopeMin, target.targetHrBpm);
  if (target.targetCadenceRpm != null) return gradeCadenceTarget(matched, scopeMin, target.targetCadenceRpm);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run lib/intent-scoring.test.ts
npx tsc --noEmit
```

Expected: PASS, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add lib/intent-scoring.ts lib/intent-scoring.test.ts
git commit -m "feat(intent-scoring): grade HR-ceiling and cadence effort claims in gradeEffort"
```

---

## Task 9: Verify the debrief renders terrain/HR/cadence evidence with no UI changes

**Why this task exists:** `components/dashboard/ride-intent.tsx`'s `RideIntentBlock` renders every
measurable objective generically — `measurable.map((o) => <li>{o.description}{o.evidence}</li>)`, no
per-kind branching (verified by reading the full 66-line file during this plan's writing). That means
Tasks 6-8's new `terrain`/HR-ceiling/cadence objectives should already render correctly with **zero**
changes to this component. "Should" is not "does" — this task proves it with a real test rather than
leaving it as an assumption the rest of this plan quietly depends on.

**Files:**
- Test: `components/dashboard/ride-intent.test.tsx` (check first whether it exists — if it does, add to
  it; if not, this step's fixture-setup should follow whatever pattern the nearest sibling component test
  uses, e.g. grep `components/dashboard/*.test.tsx` for an existing `EffectiveOutcome`/`IntentOverlay`
  fixture builder to reuse rather than inventing a new one)

- [ ] **Step 1: Check for an existing test file and its fixture pattern**

```bash
ls components/dashboard/ride-intent.test.tsx 2>&1
grep -rn "EffectiveOutcome\|IntentOverlay" components/dashboard/*.test.tsx 2>/dev/null | head -10
```

- [ ] **Step 2: Write the failing test**

Add (to the existing file, or create `components/dashboard/ride-intent.test.tsx` with a
`/** @vitest-environment jsdom */` docblock at the top, matching this repo's per-file jsdom convention):

```tsx
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RideIntentBlock } from "./ride-intent";
import type { EffectiveOutcome, ScoredObjective } from "@/lib/types";

function outcomeWith(objectives: ScoredObjective[]): EffectiveOutcome {
  return {
    effectiveExecutionScore: 7,
    origin: "self-directed",
    source: "overlay",
    overlay: {
      id: "ov-1", activityId: "act-1", date: "2026-08-12", noteFingerprint: "fp",
      status: "active", origin: "self-directed", effectiveExecutionScore: 7, notScoredReason: null,
      interpretation: {
        intent: { primaryPurpose: "endurance with a climb", phases: [] },
        confidence: "high", objectives, model: "claude-sonnet-4-6", promptVersion: 2,
      },
      scoringVersion: 1, schemaVersion: 1, createdAt: "2026-08-12T12:00:00.000Z",
      approvedAt: null, supersededBy: null,
    },
  };
}

describe("RideIntentBlock — Phase 3b evidence rendering (no component changes expected)", () => {
  it("renders a terrain objective's evidence text with no special-casing needed", () => {
    const outcome = outcomeWith([{
      description: "did a climb", kind: "terrain", target: { terrain: "climb", durationMin: 8 },
      zoneBasis: "unspecified", grounded: true, sourceText: "did a climb",
      measurable: true, scored: true, scopeMin: 8,
      evidence: "8.0 min climb vs 8 min stated (labelled) — avg 6.2%, VAM 780 m/h",
    }]);
    render(<RideIntentBlock outcome={outcome} activityDecoupling={1} />);
    expect(screen.getByText(/did a climb/)).toBeTruthy();
    expect(screen.getByText(/VAM 780 m\/h/)).toBeTruthy();
  });

  it("renders an HR-ceiling objective's evidence text", () => {
    const outcome = outcomeWith([{
      description: "stay under 154bpm", kind: "effort", target: { durationMin: 30, targetHrBpm: 154 },
      zoneBasis: "heart-rate", grounded: true, sourceText: "under 154bpm",
      measurable: true, scored: true, scopeMin: 30,
      evidence: "1 matching lap, peak HR 150 vs 154 bpm ceiling",
    }]);
    render(<RideIntentBlock outcome={outcome} activityDecoupling={1} />);
    expect(screen.getByText(/peak HR 150 vs 154 bpm ceiling/)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it currently fails or passes**

```bash
npx vitest run components/dashboard/ride-intent.test.tsx -t "Phase 3b"
```

**Expected: PASS already**, with zero changes to `ride-intent.tsx` — this is the point of the task. If
it fails, that means the "no UI changes needed" claim in this plan's Architecture section was wrong;
investigate `RideIntentBlock`'s actual rendering logic (`components/dashboard/ride-intent.tsx`) rather
than assuming this test is broken, and fix the component if it genuinely can't render a `terrain`-kind
or HR-targeted objective's evidence — do not silently work around a real rendering gap.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/ride-intent.test.tsx
git commit -m "test(ride-intent): prove terrain/HR-ceiling evidence renders with no component changes"
```

---

## Task 10: Docs — `INVARIANTS.md` and the scoring/learning systems doc

**Files:**
- Modify: `docs/INVARIANTS.md`
- Modify: `docs/systems/02-scoring-and-learning.md`

- [ ] **Step 1: Confirm the current invariant ceiling**

```bash
grep -n "^[0-9]\+\." docs/INVARIANTS.md | tail -1
```

Use the printed number + 1 below — do not hard-code 56 if this prints something else (another PR may
have landed an invariant since this plan was written).

- [ ] **Step 2: Append the new invariant**

Add to `docs/INVARIANTS.md`, after the current last item:

```
<N>. **A `terrain` objective is graded on existence and duration compliance only, never on technique.**
    `gradeTerrain` (`lib/intent-scoring.ts`) must never produce a skill/quality verdict for a climb or
    descent — that stays the explicit non-goal it always was (design doc §15: "no scoring technical
    descending/cornering from speed alone"). A future change that makes gradeTerrain's delta depend on
    anything besides matched-lap existence and duration-vs-stated compliance is the thing this invariant
    exists to catch.
```

(Replace `<N>` with the actual next number from Step 1.)

- [ ] **Step 3: Update the scoring/learning systems doc**

In `docs/systems/02-scoring-and-learning.md`'s "Known rough edges" section, add a new bullet (grep the
file for `## Known rough edges` to find the section, add at the end of the existing bullet list):

```
- **Phase 3b (2026-08-12) added HR-ceiling, cadence and terrain claims to self-directed intent-scoring.**
  `ExecutedInterval` gained `maxHr`/`avgCadenceRpm`/`maxGradientPct`/`elevationGainM`/`label`; `matchLaps`
  now ranks by whichever target field an objective stated (never a blend). Terrain matching is
  label-first (`ExecutedInterval.label`, athlete-typed free text — real per Intervals.icu's own labelling
  feature, but null on every real ride sampled during design; the athlete had not started labelling
  yet), gradient-fallback second (Strava's own published ≥3% climb floor). **Per-interval `decoupling`
  is also real and synced-for-free on the same payload but has no consumer yet** — flagged here as a
  future unlock for the segment-scoped aerobic drift feature this doc already notes is deferred (Phase
  2b's Handoff boundary), not built by Phase 3b.
```

- [ ] **Step 4: Commit**

```bash
git add docs/INVARIANTS.md docs/systems/02-scoring-and-learning.md
git commit -m "docs: record Phase 3b's terrain-grading invariant and cross-reference the decoupling unlock"
```

---

## Task 11: Live smoke test

Per AGENTS.md: "LLM-backed paths need one live smoke run. Unit tests + a green build only prove the
deterministic scaffolding around a prompt — they don't exercise the real Anthropic call." This phase
changed `lib/intent-prompt.ts` (Task 3) — that must be exercised against the real API before this phase
is done.

**Files:** none (verification only — do not skip this task or mark it done from unit tests alone).

- [ ] **Step 1: Run the app against a real note with an HR ceiling and a terrain claim**

Start the dev server (`npm run dev`), and either use a real upcoming self-directed ride's note or the
existing `/api/intent` flow against a test activity, with a note containing something like: *"Endurance
ride, stay under 154bpm on the climbs, otherwise easy spin."* Confirm:

- The parsed `StructuredIntent`/`objectives` include an `effort` objective with `zoneBasis:
  "heart-rate"` and `target.targetHrBpm: 154` (not misclassified as `zone-time` or `qualitative`).
- If the note also describes a climb explicitly (e.g. add "did a proper climb about 10 minutes long" to
  the test note), confirm a `terrain` objective with `target.terrain: "climb"` appears, distinct from
  the HR-ceiling effort objective — not merged, not dropped.

Read the actual model output — don't just confirm the request succeeded. This is exactly the
`INTENT_PROMPT_VERSION` bump's real test; the prompt wording in Task 3 was a best guess until this step
confirms it.

- [ ] **Step 2: Record the result**

If the model correctly distinguishes the HR-ceiling claim and the terrain claim, note this in the PR
description and move on. If it does not — e.g. it classifies the HR ceiling as `qualitative`, or invents
a terrain claim from a purely qualitative "nice climb" phrase — revise `lib/intent-prompt.ts`'s wording
from Task 3 Step 7 and re-run this smoke test before considering the phase done. This is the one step in
this plan that cannot be fully specified in advance; use judgment against the actual output.

- [ ] **Step 3: Flag the still-outstanding label-match smoke test**

The label-match path (a `label`-carrying interval actually winning a terrain match) has **not** been
live-smoke-tested by this task, because no real ride in the athlete's data had a label set as of this
plan's writing. Note this explicitly in the PR description: *"Label-match path verified by unit tests
only (Task 6) — needs a second live-smoke check once the athlete has labelled a real ride's intervals."*
Do not claim this path is fully verified; it isn't yet, by design (there's no real data to verify it
against until the athlete adopts the labelling habit).

- [ ] **Step 4: Final check and commit if anything changed**

```bash
npm run check
npx vitest run
```

Expected: PASS. If Step 2 required a prompt revision, commit it:

```bash
git add lib/intent-prompt.ts
git commit -m "fix(intent-prompt): correct HR-ceiling/terrain classification per live smoke test"
```

If no revision was needed, this task ends with no new commit — the smoke run itself is the deliverable,
recorded in the PR description per Steps 2-3.

---

## Handoff

This plan implements everything in `docs/superpowers/specs/2026-08-12-adaptive-coach-p3b-interval-context-design.md`.
Explicit non-goals (§10 of that doc) are not tasks here on purpose — Strava segment resolution,
per-interval CP/W′, HR/cadence ranges, speed, torque, per-interval training-load/strain/intensity,
`groupId` cleanup, and any change to the planned-ride adherence path (`lib/interval-match.ts`) all stay
out of scope.
