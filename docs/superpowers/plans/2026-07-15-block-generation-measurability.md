# Block Generation Measurability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every LLM-generated training session a stable, comparable difficulty stamp (`sessionLevel`) persisted into block history, and promote quality-session protocol violations from generic warnings into a distinct, higher-severity category the athlete can't miss.

**Architecture:** A new pure module `lib/session-level.ts` derives `{score, workMin, avgPctFtp, bandPosition}` from a day's already-parsed `PrescribedInterval[]`, and `app/api/write/route.ts` freezes it onto `CurrentBlockDay` at write time — it flows into `block-history.json` for free via the existing SUB-1 `days` archiving. `lib/workout-validate.ts` gains `splitPlanProtocol` (replacing flat `validatePlanProtocol`), which routes quality-type findings into a new `GeneratedPlan.protocolViolations` field that `PlanPreview` renders as a red box above the ordinary amber warnings. **Scope boundary:** commercial adaptive platforms (TrainerRoad, Xert, WKO5) get measurability by selecting from a curated, leveled workout library — a per-workout identity this app's LLM-freehand approach lacks. Fully adopting that model means abandoning LLM-authored workouts for a rule-engine/library architecture: a multi-week pivot the athlete has not asked for, which needs its own brainstorming/spec pass first. This plan deliberately stops short of it — it only stamps a comparable identity onto freehand output and raises violation severity. **Task 2's design decision:** the single-day auto-regeneration option was evaluated and rejected — `generateTrainingBlock` (lib/anthropic-api.ts:155) generates whole blocks only via one forced tool call whose schema requires the full `weeks` array; a targeted day-retry would need a new day-level tool schema, a new prompt builder carrying the surrounding week's context, merge-and-revalidate plumbing, and a `dedupeGeneration` bypass (an identical retry inside the 60 s TTL is served the cached result, lib/generate-cache.ts:15). That is disproportionate new plumbing for this slice, so per the spec this lands as the scoped-down "distinct, higher-severity warning category the UI visually distinguishes" path.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Vitest, Anthropic SDK.

## Global Constraints

- This is deliberately the SMALLEST defensible slice of a much larger idea (see Scope note below) — do not plan a full curated-workout-library rewrite.
- A changed LLM generation path requires one live smoke run and inspection of its actual output before being called done (this repo's AGENTS.md rule) — every task that touches the generation prompt or schema must end with this, not just the final integration task.
- Guard any new `fooMigratedAt`-style field with a truthy check, never `=== null`.
- No task in this plan touches the generation prompt (`lib/anthropic-prompts.ts`) or the tool schema (`lib/plan-schema.ts` / `TRAINING_BLOCK_TOOL`) — Task 3 changes only deterministic post-processing in the route — so the one required live smoke run lives in Task 5, which immediately follows the last generation-path change.
- `PrescribedInterval` (lib/types.ts:228) must NOT gain fields: `lib/interval-match.ts` consumes it (reads only `reps`/`durationSec`/`targetWatts`/`label`) and adding none keeps the execution matcher provably untouched.
- Repo workflow: run everything with `npm`; commit on `main` (no branches — a concurrent agent session shares this checkout); stage ONLY the files you touched (`git add <path>...`), never `git add -A`.
- New optional JSON fields follow the sparse-field convention: spread in only when present (`...(x ? { x } : {})`), truthy-check on read, never `=== null`.

---

### Task 1: `computeSessionLevel` — the pure, comparable difficulty stamp

**Files:**
- Create: `lib/session-level.ts`
- Create: `lib/session-level.test.ts`
- Modify: `lib/types.ts:228-234` (add `SessionLevel` interface after the `PrescribedInterval` block)
- Modify: `lib/workout-validate.ts:17-31` (export `ProtocolRule` + `PROTOCOL` so the band table has one source of truth)
- Modify: `lib/prescription.test.ts` (one characterization test pinning parse-stability the stamp relies on)

**Interfaces:**
- Consumes: `parsePrescription(workoutText: string, ftp: number): PrescribedInterval[]` (lib/prescription.ts:79), `PROTOCOL: Partial<Record<WorkoutType, ProtocolRule>>` (lib/workout-validate.ts:27).
- Produces (later tasks rely on these exact names):
  - `interface SessionLevel { score: number; workMin: number; avgPctFtp: number; bandPosition: number | null }` exported from `lib/types.ts`.
  - `computeSessionLevel(type: WorkoutType, prescription: PrescribedInterval[]): SessionLevel | null` exported from `lib/session-level.ts`. Returns `null` when the prescription carries no work efforts (Rest, pure endurance, Strength).

Design notes for the implementer:
- `score` = total work minutes × (duration-weighted avg %FTP ÷ 100) — the intensity-weighted work dose. Comparable across two independently-generated sessions of the same type: same per-rep intensity ⇒ same score *per work-minute*, more reps ⇒ proportionally higher total.
- `bandPosition` = where the avg intensity sits inside the type's KB protocol intensity band (0 = floor, 1 = ceiling, clamped) — the within-type normalization the `PROTOCOL` table already implies. `null` for types with no band (RaceSim, endurance days).
- `durationMin` is deliberately NOT an input: it counts warmup/cooldown/recovery time, which varies freely without changing what the session trains. The parsed work efforts ARE the identity.
- Rounding: compute score/band from the RAW (pre-rounding) figures, then round for storage (`score`/`workMin`/`avgPctFtp` to 1 dp, `bandPosition` to 2 dp). Fixture values below were checked against IEEE floats — none sit on a rounding boundary.

- [ ] **Step 1: Write the failing test**

Create `lib/session-level.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeSessionLevel } from "./session-level";
import { parsePrescription } from "./prescription";

const FTP = 288;

describe("computeSessionLevel — cross-block comparability", () => {
  it("scores two SIT sessions with different rep counts identically per unit of work time", () => {
    const a = computeSessionLevel("SIT", parsePrescription("Main Set 4x\n- 30s 150%\n- 4m 40%", FTP))!;
    const b = computeSessionLevel("SIT", parsePrescription("Main Set 6x\n- 30s 150%\n- 4m 40%", FTP))!;
    expect(a.avgPctFtp).toBe(150);
    expect(b.avgPctFtp).toBe(150);
    expect(a.bandPosition).toBe(b.bandPosition); // same identity within the SIT band…
    expect(b.score / b.workMin).toBeCloseTo(a.score / a.workMin, 5); // …same intensity per work-minute
    expect(b.score).toBeGreaterThan(a.score); // more reps = more total dose
  });

  it("scores a session at the top of its protocol band higher than one at the bottom", () => {
    const bottom = computeSessionLevel("Threshold", parsePrescription("Main Set 2x\n- 20m 95%\n- 5m 55%", FTP))!;
    const top = computeSessionLevel("Threshold", parsePrescription("Main Set 2x\n- 20m 110%\n- 5m 55%", FTP))!;
    // 2×20m @ 95%: 40 work-min × 0.95 = 38; band (95−80)/(115−80) = 0.43.
    expect(bottom).toEqual({ score: 38, workMin: 40, avgPctFtp: 95, bandPosition: 0.43 });
    expect(top.score).toBe(44);
    expect(top.bandPosition).toBe(0.86);
  });

  it("duration-weights mixed efforts (over-unders) into one average intensity", () => {
    // 4×(1m @ 110% + 2m @ 95%): 12 work-min, weighted avg = (60·110 + 120·95)/180 = 100%.
    const level = computeSessionLevel("Threshold", parsePrescription("Main Set 4x\n- 1m 110%\n- 2m 95%", FTP))!;
    expect(level).toEqual({ score: 12, workMin: 12, avgPctFtp: 100, bandPosition: 0.57 });
  });

  it("normalises SIT against the KB 130–200% band (the protocol table pins only the floor)", () => {
    const level = computeSessionLevel("SIT", parsePrescription("Main Set 5x\n- 30s 150%", FTP))!;
    expect(level.bandPosition).toBe(0.29); // (150 − 130) / (200 − 130)
  });

  it("computes a score but no band position for types without a protocol band (RaceSim)", () => {
    const level = computeSessionLevel("RaceSim", parsePrescription("Main Set 3x\n- 4m 105%\n- 5m 55%", FTP))!;
    expect(level.workMin).toBe(12);
    expect(level.avgPctFtp).toBe(105);
    expect(level.bandPosition).toBeNull();
  });

  it("returns null when the day has no parsed work efforts (Rest, pure endurance)", () => {
    expect(computeSessionLevel("Rest", [])).toBeNull();
    expect(computeSessionLevel("Z2", parsePrescription("- 180m 65%", FTP))).toBeNull();
  });

  it("is identical for a repeat-block and its explicit enumeration (stability across LLM phrasings)", () => {
    const collapsed = computeSessionLevel("VO2max", parsePrescription("Main Set 5x\n- 5m 110%\n- 5m 55%", FTP));
    const explicit = computeSessionLevel(
      "VO2max",
      parsePrescription("- 5m 110%\n- 5m 110%\n- 5m 110%\n- 5m 110%\n- 5m 110%", FTP)
    );
    expect(explicit).toEqual(collapsed);
    expect(collapsed!.score).toBe(27.5); // 25 work-min × 1.10
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/session-level.test.ts`
Expected: FAIL — `Failed to resolve import "./session-level" from "lib/session-level.test.ts"` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

3a. In `lib/types.ts`, insert after the `PrescribedInterval` interface (currently ends line 234, before `ExecutedInterval`):

```ts
// Measurability: a stable, comparable difficulty stamp for a generated session, derived at write time
// from the parsed prescription (lib/session-level.ts) and frozen onto the block day — so block N's
// Threshold session can be compared to block N+2's even though the LLM wrote them independently.
export interface SessionLevel {
  score: number; // work minutes × (avg %FTP / 100) — the intensity-weighted work dose
  workMin: number; // total prescribed work-effort minutes (warmup/cooldown/recovery excluded)
  avgPctFtp: number; // duration-weighted mean %FTP across the work efforts
  bandPosition: number | null; // 0–1 position inside the type's KB protocol intensity band; null when the type has no band
}
```

3b. In `lib/workout-validate.ts`, export the rule table (lines 17 and 27 — change `interface ProtocolRule` to `export interface ProtocolRule` and `const PROTOCOL` to `export const PROTOCOL`, adding to the comment above the table):

```ts
// Only the structured "quality" types carry a protocol worth validating; Z2/Recovery/Strength/
// Rest have no fixed interval shape. Bands include tolerance past the KB edges. Exported as the
// single source of truth for lib/session-level.ts's within-type band normalisation.
export const PROTOCOL: Partial<Record<WorkoutType, ProtocolRule>> = {
```

(The three entries inside the table are unchanged.)

3c. Create `lib/session-level.ts`:

```ts
// Measurability (docs/superpowers/plans/2026-07-15-block-generation-measurability.md): derive a
// stable, comparable difficulty stamp for a generated session from its parsed prescription. The LLM
// writes each block's intervals freehand, so two Threshold sessions in different blocks share no
// stable identity — this composite gives retrospectives an apples-to-apples number without moving
// to a curated workout library. Pure + deterministic: same prescription in, same stamp out,
// whichever block or prompt produced it.
//
// score        = total work minutes × (duration-weighted avg %FTP / 100) — intensity-weighted dose.
// bandPosition = where the avg intensity sits inside the type's KB protocol band (0 = floor,
//                1 = ceiling) — the within-type normalisation the PROTOCOL table already implies.
//                null for types without a band (RaceSim, endurance days' inserts).
//
// durationMin is deliberately NOT an input: it counts warmup/cooldown/recovery time, which varies
// freely without changing what the session trains — the parsed work efforts ARE the identity.

import type { PrescribedInterval, SessionLevel, WorkoutType } from "./types";
import { PROTOCOL } from "./workout-validate";

// KB training §4 puts SIT at 130–200% FTP. The PROTOCOL table pins only the floor (an all-out
// effort can't violate a ceiling), so the band ceiling used for normalisation lives here.
const SIT_BAND_CEILING_PCT = 200;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeSessionLevel(
  type: WorkoutType,
  prescription: PrescribedInterval[]
): SessionLevel | null {
  const workSec = prescription.reduce((s, p) => s + p.reps * p.durationSec, 0);
  if (workSec <= 0) return null;
  const avgRaw =
    prescription.reduce((s, p) => s + p.reps * p.durationSec * p.targetPctFtp, 0) / workSec;

  const rule = PROTOCOL[type];
  const lo = rule?.minIntensityPct;
  const hi = rule?.maxIntensityPct ?? (type === "SIT" ? SIT_BAND_CEILING_PCT : undefined);
  const bandPosition =
    lo !== undefined && hi !== undefined && hi > lo
      ? round2(Math.min(1, Math.max(0, (avgRaw - lo) / (hi - lo))))
      : null;

  return {
    // Score/band derive from the RAW (pre-rounding) figures; rounding is storage-only.
    score: round1((workSec / 60) * (avgRaw / 100)),
    workMin: round1(workSec / 60),
    avgPctFtp: round1(avgRaw),
    bandPosition,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/session-level.test.ts lib/workout-validate.test.ts`
Expected: PASS (both files — the `PROTOCOL` export must not disturb existing validation tests).

- [ ] **Step 5: Pin the parse-stability the stamp depends on (characterization test — passes immediately)**

Append inside the existing `describe("parsePrescription", ...)` block in `lib/prescription.test.ts` (after the "labels sub-minute…" test, currently line 112-116):

```ts
  it("parses a repeat-block and its explicit enumeration to the same structure (session-level stability)", () => {
    // The sessionLevel stamp (lib/session-level.ts) relies on structurally-equal prescriptions for
    // equivalent workouts, however the LLM happened to phrase the repeat.
    const collapsed = parsePrescription("Main Set 5x\n- 5m 110%\n- 5m 55%", FTP);
    const explicit = parsePrescription("- 5m 110%\n- 5m 110%\n- 5m 110%\n- 5m 110%\n- 5m 110%", FTP);
    expect(explicit).toEqual(collapsed);
  });
```

Run: `npm test -- lib/prescription.test.ts`
Expected: PASS (this is a regression pin on existing collapse behaviour, not a failing-first test).

- [ ] **Step 6: Commit**

```bash
git add lib/session-level.ts lib/session-level.test.ts lib/types.ts lib/workout-validate.ts lib/prescription.test.ts
git commit -m "feat(measurability): comparable sessionLevel score derived from the parsed prescription"
```

---

### Task 2: Stamp `sessionLevel` onto block days at write time

**Files:**
- Modify: `lib/types.ts:275-290` (add the optional field to `CurrentBlockDay`)
- Modify: `app/api/write/route.ts:12` (import) and `:140-154` (the days mapping)
- Test: `app/api/write/route.test.ts` (append a new describe)

**Interfaces:**
- Consumes: `computeSessionLevel(type: WorkoutType, prescription: PrescribedInterval[]): SessionLevel | null` from Task 1.
- Produces: `CurrentBlockDay.sessionLevel?: SessionLevel` — persisted in `current-block.json` and carried into `block-history.json` automatically, because `BlockHistoryEntry.days` reuses `CurrentBlockDay` verbatim (lib/types.ts:434) and the write route archives via `truncateBlockDays(existing.days, …)` (app/api/write/route.ts:110). No retrospective/prompt wiring — compute and persist only.

- [ ] **Step 1: Write the failing test**

Append to `app/api/write/route.test.ts` (top level, after the intervention-recording describe):

```ts
describe("/api/write sessionLevel stamp (measurability)", () => {
  const qualityPlan = {
    ...plan,
    days: [
      day("2026-06-15", "Endurance"), // Z2 @ 65% — no work efforts, so no stamp
      { ...day("2026-06-16", "Threshold 2x20"), type: "Threshold", workoutText: "Main Set 2x\n- 20m 95%\n- 5m 55%" },
    ],
  };

  it("stamps a comparable sessionLevel on quality days and omits it on pure endurance", async () => {
    h.createEvent.mockResolvedValue(200);
    const json = await (await post({ plan: qualityPlan })).json();
    expect(json.blockSaved).toBe(true);
    const [endurance, threshold] = json.currentBlock.days;
    expect(endurance.sessionLevel).toBeUndefined();
    // 2×20m @ 95%: 40 work-min × 0.95 = 38; band (95−80)/(115−80) = 0.43. Frozen for retrospectives.
    expect(threshold.sessionLevel).toEqual({ score: 38, workMin: 40, avgPctFtp: 95, bandPosition: 0.43 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/api/write/route.test.ts`
Expected: FAIL — `expected undefined to deeply equal { score: 38, workMin: 40, avgPctFtp: 95, bandPosition: 0.43 }` (the stamp is not computed yet). The pre-existing tests in the file must still pass.

- [ ] **Step 3: Write the minimal implementation**

3a. In `lib/types.ts`, inside `CurrentBlockDay` add after the `durabilityTemplate?: string;` line (currently line 283):

```ts
  // Measurability: the session's difficulty stamp (see SessionLevel), computed from `prescription`
  // at write time and frozen so retrospectives can compare like sessions across blocks. Absent on
  // days with no parsed work efforts (Rest / pure endurance / Strength) and on blocks written
  // before this shipped — read sites must truthy-check, never `=== null`.
  sessionLevel?: SessionLevel;
```

3b. In `app/api/write/route.ts` add the import (next to line 12's `parsePrescription` import):

```ts
import { computeSessionLevel } from "@/lib/session-level";
```

3c. In the days mapping (currently lines 140-154), compute and spread the stamp:

```ts
      return plan.days.map((d) => {
        // Capture the coach's prescription structurally so execution can be compared.
        const prescription = parsePrescription(d.workoutText, ftp);
        // Measurability: freeze the comparable difficulty stamp alongside the prescription it
        // derives from, so block history carries a stable per-session identity.
        const sessionLevel = computeSessionLevel(d.type, prescription);
        const eventId = eventIdByDate.get(d.date) ?? null;
        return {
          date: d.date,
          name: d.name,
          type: d.type,
          durationMin: d.durationMin,
          ...(isLongRide(d) && plan.durabilityTemplate ? { durabilityTemplate: plan.durabilityTemplate } : {}),
          ...(d.workoutText ? { workoutText: d.workoutText } : {}),
          ...(prescription.length > 0 ? { prescription } : {}),
          ...(sessionLevel ? { sessionLevel } : {}),
          ...(eventId !== null ? { eventId } : {}),
        };
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/api/write/route.test.ts`
Expected: PASS (all describes, old and new).

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts app/api/write/route.ts app/api/write/route.test.ts
git commit -m "feat(measurability): stamp sessionLevel onto block days at write time"
```

---

### Task 3: `splitPlanProtocol` — quality-session violations become a distinct category

Scoped-down design (stated per the spec): this surfaces protocol violations as a distinct, higher-severity category instead of building a single-day regeneration loop. Rationale lives in the Architecture section above — the generator is whole-block-only, so a targeted retry would demand a new day-level tool schema, prompt builder, merge/revalidate plumbing, and a dedupe-cache bypass.

**Files:**
- Modify: `lib/workout-validate.ts:84-92` (replace `validatePlanProtocol` with `splitPlanProtocol`; `validateWorkoutProtocol` is untouched)
- Modify: `lib/types.ts:193-206` (add `protocolViolations?: string[]` to `GeneratedPlan`)
- Modify: `app/api/generate/route.ts:33` (import) and `:322-325` (warnings collection) and `:344-353` (the plan literal)
- Test: `lib/workout-validate.test.ts` (replace the `validatePlanProtocol` describe), `app/api/generate/route.test.ts` (new describe)

**Interfaces:**
- Consumes: `validateWorkoutProtocol(day, ftp, envelope)` (lib/workout-validate.ts:47 — unchanged), `resolveDurabilityInsertEnvelope` (lib/calibration.ts:114).
- Produces:
  - `interface ProtocolFindings { violations: string[]; advisories: string[] }` exported from `lib/workout-validate.ts`.
  - `splitPlanProtocol(days: PlannedDay[], ftp: number, envelope?: DurabilityInsertEnvelope): ProtocolFindings` exported from `lib/workout-validate.ts`. `validatePlanProtocol` is DELETED (its only production caller was the generate route; grep confirms the other mentions are comments).
  - `GeneratedPlan.protocolViolations?: string[]` — sparse (spread in only when non-empty), consumed by Task 4's UI.

- [ ] **Step 1: Write the failing tests (workout-validate)**

In `lib/workout-validate.test.ts`, change the import (line 2) to:

```ts
import { validateWorkoutProtocol, splitPlanProtocol } from "./workout-validate";
```

and replace the whole `describe("validatePlanProtocol", ...)` block (currently lines 140-150) with:

```ts
describe("splitPlanProtocol", () => {
  it("routes quality-session breaches to violations and leaves clean days silent", () => {
    const days = [
      day("SIT", "Main Set 5x\n- 1m 150%\n- 4m 40%"), // 1-min SIT reps — protocol breach
      day("Threshold", "Main Set 2x\n- 20m 95%\n- 10m 50%"), // clean
    ];
    const f = splitPlanProtocol(days, FTP);
    expect(f.violations).toHaveLength(1);
    expect(f.violations[0]).toMatch(/SIT/);
    expect(f.violations[0]).toMatch(/longer than protocol/);
    expect(f.advisories).toEqual([]);
  });

  it("keeps endurance-day durability-insert findings advisory (the existing lighter touch)", () => {
    const f = splitPlanProtocol([day("Z2", "- 5m 140%")], FTP);
    expect(f.violations).toEqual([]);
    expect(f.advisories).toHaveLength(1);
    expect(f.advisories[0]).toMatch(/exceeds the 122% ceiling/);
  });

  it("returns empty findings for a clean plan", () => {
    expect(splitPlanProtocol([day("VO2max", "Main Set 4x\n- 4m 110%\n- 4m 50%")], FTP)).toEqual({
      violations: [],
      advisories: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/workout-validate.test.ts`
Expected: FAIL — `./workout-validate` does not provide an export named `splitPlanProtocol`.

- [ ] **Step 3: Implement the split in workout-validate**

In `lib/workout-validate.ts`, replace the `validatePlanProtocol` function and its comment (currently lines 84-92) with:

```ts
// The structured quality types whose protocol findings are VIOLATIONS — a malformed session would
// be lived (and measured) against the wrong identity — vs endurance days, whose durability-insert
// findings stay advisory (the lighter touch those days already get above). RaceSim is listed for
// completeness: it has no PROTOCOL entry today, so it cannot currently produce findings.
const QUALITY_TYPES = new Set<WorkoutType>(["Threshold", "VO2max", "SIT", "RaceSim"]);

export interface ProtocolFindings {
  violations: string[]; // quality-session protocol breaches — a distinct, higher-severity category
  advisories: string[]; // endurance-day insert findings — ordinary warnings
}

// Validate a whole generated block, split by severity. The generate route folds `advisories` into
// the plan's generic warnings and carries `violations` separately (GeneratedPlan.protocolViolations)
// so the UI can render them as their own category. Replaces the old flat validatePlanProtocol.
export function splitPlanProtocol(
  days: PlannedDay[],
  ftp: number,
  envelope: DurabilityInsertEnvelope = DEFAULT_DURABILITY_INSERT_ENVELOPE
): ProtocolFindings {
  const out: ProtocolFindings = { violations: [], advisories: [] };
  for (const d of days) {
    const findings = validateWorkoutProtocol(d, ftp, envelope);
    if (findings.length === 0) continue;
    (QUALITY_TYPES.has(d.type) ? out.violations : out.advisories).push(...findings);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/workout-validate.test.ts`
Expected: PASS. (`app/api/generate/route.test.ts` is now broken — route.ts still imports the deleted `validatePlanProtocol` — fixed in the next steps.)

- [ ] **Step 5: Write the failing route tests**

Append to `app/api/generate/route.test.ts`:

```ts
describe("POST /api/generate — protocol-violation severity (measurability)", () => {
  it("carries quality-session protocol breaches as plan.protocolViolations, not generic warnings", async () => {
    const badSit = {
      overview: "o",
      weeks: [{
        weekNumber: 1,
        theme: "t",
        days: [{ date: "2026-06-15", name: "SIT 5x1min", type: "SIT", durationMin: 45, workout: "Main Set 5x\n- 1m 150%\n- 4m 40%", description: "x" }],
      }],
    };
    vi.mocked(anthropic.generateTrainingBlock).mockResolvedValueOnce({ toolInput: badSit, raw: "", truncated: false, stopReason: null } as never);
    const json = await (await gen("Build FTP")).json();
    expect(json.plan.protocolViolations).toHaveLength(1);
    expect(json.plan.protocolViolations[0]).toMatch(/longer than protocol/);
    expect(json.plan.warnings.some((w: string) => /longer than protocol/.test(w))).toBe(false); // not double-reported
  });

  it("omits protocolViolations entirely on a clean plan (sparse-field convention)", async () => {
    const json = await (await gen("Build FTP")).json(); // default mocked toolInput is protocol-clean
    expect(json.plan.protocolViolations).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- app/api/generate/route.test.ts`
Expected: FAIL — the suite errors because `app/api/generate/route.ts` imports `validatePlanProtocol`, which no longer exists.

- [ ] **Step 7: Wire the route + the plan type**

7a. In `lib/types.ts`, inside `GeneratedPlan` add after the `durabilityTemplate?: string;` line (currently line 205):

```ts
  // Protocol violations on quality sessions (Threshold/VO2max/SIT/RaceSim) — a distinct,
  // higher-severity category than `warnings`: the session contradicts its own KB protocol, so
  // writing it means the plan and the lived session describe different things. Kept out of
  // `warnings` so the UI renders it as its own red category. Optional: plans generated before this
  // field parse back as undefined — truthy-check on read.
  protocolViolations?: string[];
```

7b. In `app/api/generate/route.ts` line 33, change the import to:

```ts
import { splitPlanProtocol } from "@/lib/workout-validate";
```

7c. Replace the protocol-check call (comment + call, currently lines 322-325) with:

```ts
    // KB-grounded protocol check: flag any generated workout that contradicts the knowledge base
    // (e.g. SIT prescribed as 1-min efforts). Quality-session breaches are carried as a distinct,
    // higher-severity category (plan.protocolViolations); endurance-day durability-insert findings
    // stay ordinary warnings.
    const protocol = splitPlanProtocol(days, profile.performance.ftp, resolveDurabilityInsertEnvelope(blockSettings.durabilityInsertEnvelope));
    warnings.push(...protocol.advisories);
```

7d. In the `plan` literal (currently lines 344-353), add the sparse field after `warnings`:

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
      durabilityTemplate: durability.id, // Track B: stamp the template for rotation + future scoring
    };
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- app/api/generate/route.test.ts lib/workout-validate.test.ts`
Expected: PASS (new describes AND every pre-existing generate-route test — the Track B/season/validation tests assert against `plan.warnings`, whose non-protocol content is unchanged).

- [ ] **Step 9: Run the full suite (the deleted export must break nothing else)**

Run: `npm test`
Expected: PASS, all files.

- [ ] **Step 10: Commit**

```bash
git add lib/workout-validate.ts lib/workout-validate.test.ts lib/types.ts app/api/generate/route.ts app/api/generate/route.test.ts
git commit -m "feat(generate): split protocol findings into quality-session violations vs advisories"
```

---

### Task 4: PlanPreview renders violations as a distinct red category

**Files:**
- Modify: `components/PlanPreview.tsx:74-76` (derive `violations`) and `:103-112` (insert the red box above the amber warnings box)
- Create: `components/PlanPreview.test.tsx`

**Interfaces:**
- Consumes: `GeneratedPlan.protocolViolations?: string[]` from Task 3. No new props — the plan object already flows into the component.
- Produces: nothing consumed later; UI only.

- [ ] **Step 1: Write the failing test**

Create `components/PlanPreview.test.tsx` (same `renderToStaticMarkup` style as `components/dashboard/BlockGenerator.test.tsx` — runs in the node environment, no jsdom):

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import PlanPreview from "./PlanPreview";
import type { GeneratedPlan } from "@/lib/types";

const base: GeneratedPlan = {
  overview: "Test block.",
  days: [{
    date: "2026-06-15", weekNumber: 1, weekTheme: "Build", name: "SIT 5x1min", type: "SIT",
    durationMin: 45, workoutText: "Main Set 5x\n- 1m 150%\n- 4m 40%", description: "d",
  }],
  warnings: ["Expected 14 days, got 1."],
  raw: "",
  blockParams: { lengthWeeks: 2, goal: "g", startDate: "2026-06-15", weakpoints: [] },
};

const render = (plan: GeneratedPlan) =>
  renderToStaticMarkup(
    <PlanPreview plan={plan} writing={false} results={null} intervalsConfigured={true} onWrite={() => {}} onDismiss={() => {}} />
  );

test("renders protocol violations as a distinct red category above the amber warnings", () => {
  const html = render({
    ...base,
    protocolViolations: ["DAY 2026-06-15 (SIT): effort 5×1m @ 432W runs 1m — longer than protocol."],
  });
  expect(html).toContain("Protocol violations");
  expect(html).toContain("border-red-300"); // its own severity styling…
  expect(html).toContain("border-amber-200"); // …without replacing the ordinary warnings box
  expect(html.indexOf("Protocol violations")).toBeLessThan(html.indexOf("Warnings — review before writing"));
});

test("renders no violations box when the plan carries none (pre-field plans included)", () => {
  const html = render(base);
  expect(html).not.toContain("Protocol violations");
  expect(html).toContain("Warnings — review before writing");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- components/PlanPreview.test.tsx`
Expected: FAIL — `expected html to contain "Protocol violations"` (second test passes; the first fails).

- [ ] **Step 3: Write the minimal implementation**

In `components/PlanPreview.tsx`, add a derivation next to the existing ones (after line 76's `resultFor`):

```tsx
  // Truthy-check, never `=== null`: plans generated before this field parse back as undefined.
  const violations = plan.protocolViolations ?? [];
```

Then insert the red box directly ABOVE the existing amber warnings block (before line 105's `{plan.warnings.length > 0 && (`):

```tsx
      {violations.length > 0 && (
        <div className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 dark:border-red-700 dark:bg-red-950">
          <p className="text-xs font-semibold text-red-800 dark:text-red-300">
            Protocol violations — these quality sessions contradict the KB protocol. Regenerate, or write anyway if deliberate:
          </p>
          <ul className="mt-0.5 list-inside list-disc text-xs text-red-700 dark:text-red-300">
            {violations.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}
```

The write flow is intentionally unchanged: the athlete can still write through a violation (warn-and-let-the-athlete-decide stays the fallback behaviour) — the category is just impossible to mistake for an advisory.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- components/PlanPreview.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add components/PlanPreview.tsx components/PlanPreview.test.tsx
git commit -m "feat(plan-ui): render protocol violations as a distinct high-severity category"
```

---

### Task 5: Integration — full check + the mandatory live smoke run

**Files:**
- Create (throwaway, NOT committed): `smoke-session-level.mts` at the repo root
- Modify: `ARCHIVE.md` (record the shipped slice, per repo doc discipline)

**Interfaces:**
- Consumes: everything above. No new exports.

- [ ] **Step 1: Full verification suite**

Run: `npm run check`
Expected: `tsc --noEmit` silent, `eslint` clean, `vitest run` all files passing. Fix anything red before proceeding — but per the concurrent-agent rule in CLAUDE.md, if an error surfaces in a file NOT touched by Tasks 1–4, first run `git status --short <file>`; if it shows uncommitted changes it is the other session's WIP — wait ~30s, retry once, then stop and report rather than patching it.

- [ ] **Step 2: Live smoke run — generate a real block (AGENTS.md LLM-path rule)**

The generation route's post-processing changed in Task 3, so run the real path once and read the actual output. Requires `.env.local` with `ANTHROPIC_API_KEY`. This step spends real API money (one 1–2 min generation) and does NOT write to the calendar.

```bash
npm run dev &
sleep 8
curl -s -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"lengthWeeks":2,"goal":"Build FTP for hilly road racing","startDate":"2026-07-20","weakpoints":[]}' \
  > /tmp/live-plan.json
```

(If a dev server is already running on 3000, skip `npm run dev`. curl sends no `Origin` header, so the CSRF same-origin guard in `lib/csrf.ts` allows it.)

- [ ] **Step 3: Inspect the real output with a throwaway script**

Create `smoke-session-level.mts` at the repo root:

```ts
// Throwaway live-smoke inspector (AGENTS.md LLM-path rule) — run from the repo root:
//   npx tsx smoke-session-level.mts /tmp/live-plan.json <athlete FTP>
// Prints the sessionLevel each generated day WOULD receive at write time (the identical pure code
// path app/api/write/route.ts runs), without writing real calendar events. DELETE after the run.
import { readFileSync } from "node:fs";
import { parsePrescription } from "./lib/prescription";
import { computeSessionLevel } from "./lib/session-level";
import type { GeneratedPlan } from "./lib/types";

const plan: GeneratedPlan = JSON.parse(readFileSync(process.argv[2], "utf8")).plan;
const FTP = Number(process.argv[3] ?? 280);
for (const d of plan.days) {
  const level = computeSessionLevel(d.type, parsePrescription(d.workoutText, FTP));
  console.log(
    `${d.date}  ${d.type.padEnd(9)}  ${d.name.slice(0, 32).padEnd(32)}  ` +
      (level
        ? `score=${level.score} workMin=${level.workMin} avg%=${level.avgPctFtp} band=${level.bandPosition ?? "—"}`
        : "(no stamp)")
  );
}
console.log(`\nprotocolViolations: ${JSON.stringify(plan.protocolViolations ?? "(absent)")}`);
console.log(`warnings (${plan.warnings.length}): ${JSON.stringify(plan.warnings, null, 2)}`);
```

Run: `npx tsx smoke-session-level.mts /tmp/live-plan.json 280` (substitute the athlete's live FTP from `data/physiology.json`).

READ the output and confirm, by eye:
- Every Threshold/VO2max/SIT day prints a stamp with sane values — `bandPosition` inside [0, 1]; scores in plausible ranges for real work volumes (SIT roughly 2–8, VO2max roughly 12–35, Threshold roughly 25–60); Rest and pure-Z2 days print `(no stamp)`.
- Two same-type quality days (if the block has them) have stamps that order the harder session higher — sanity-check against the printed workout names/durations.
- `protocolViolations` is absent on a clean generation; if the model DID produce a breach, each message names a quality day and reads correctly — that is the feature working on real output, not a failure. Either way, `warnings` must contain no quality-day protocol text (no double-report).
- The generation itself completed end-to-end (no 502) — proving Task 3's route rewiring holds on the live path.

The deliberately-malformed visual case is proven by `components/PlanPreview.test.tsx` (red box, positioned above amber) — a real calendar write is NOT performed here because `/api/write` creates real Intervals.icu events; the write-time stamping path is already proven at its IO boundary by `app/api/write/route.test.ts`, and this script runs the identical pure functions over the real LLM output. The first real block the athlete writes will carry the stamps.

- [ ] **Step 4: Clean up the throwaway script**

```bash
kill %1 2>/dev/null; rm smoke-session-level.mts /tmp/live-plan.json
```

- [ ] **Step 5: Record the shipped slice in ARCHIVE.md**

Add at the top of the entries (below the intro block ending at the `---`, above the current top entry), following the existing entry format:

```markdown
## Block-generation measurability: sessionLevel stamp + protocol-violation severity (2026-07-15)

The smallest slice of the "curated workout library" measurability idea, deliberately WITHOUT the
library pivot (see docs/superpowers/plans/2026-07-15-block-generation-measurability.md): every
generated quality session now carries a stable, comparable difficulty stamp, and quality-session
protocol breaches are a distinct high-severity category instead of a generic warning.

- **sessionLevel stamp** (`lib/session-level.ts`, `app/api/write/route.ts`, `lib/types.ts`).
  `computeSessionLevel` derives `{score, workMin, avgPctFtp, bandPosition}` from the parsed
  prescription (score = work-minutes × avg %FTP/100; bandPosition = position inside the type's KB
  protocol band). Stamped onto `CurrentBlockDay` at write time and frozen, flowing into block
  history via the existing SUB-1 `days` archiving. Not yet fed into retrospectives/prompts —
  compute-and-persist only, so the number exists when that wiring lands.
- **Protocol-violation severity** (`lib/workout-validate.ts`, `app/api/generate/route.ts`,
  `components/PlanPreview.tsx`). `splitPlanProtocol` replaces the flat `validatePlanProtocol`:
  quality-type (Threshold/VO2max/SIT/RaceSim) breaches land in `plan.protocolViolations` and render
  as a red box above the amber warnings; endurance-day durability-insert findings stay advisory.
  Scoped down from single-day auto-regeneration: the generator is whole-block-only
  (`generateTrainingBlock`), so a targeted retry needs a new day-level tool schema + prompt +
  merge plumbing and a dedupe-cache bypass — disproportionate for this slice.
```

- [ ] **Step 6: Commit**

```bash
git add ARCHIVE.md
git commit -m "docs(archive): record the measurability slice (sessionLevel stamp + protocol severity)"
git push
```
