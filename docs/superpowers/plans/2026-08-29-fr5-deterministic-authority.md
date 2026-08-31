# FR-5 Deterministic Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `agent-orchestration` to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AI-authored block generation with a pure deterministic compiler that owns workout selection, progression, canonical Intervals.icu syntax, and publication eligibility while preserving preview-before-publish.

**Architecture:** Keep the route as the I/O orchestrator: it resolves current athlete, physiology, season, nutrition, and settings facts, then calls one pure `compileTrainingBlock` function. The compiler composes typed cycling prescriptions from the existing skeleton and selector authorities, renders and parses them through one prescription module, and evaluates the existing publication gate. Persist `PlannedDay.workoutText` as today; retain Anthropic only for ride-analysis and retrospective language.

**Tech Stack:** TypeScript 5, Next.js 16 route handlers, React 19, Vitest 4, Zod only where already used.

## Global Constraints

- Generate all work and rest days; `/api/generate` must not require Anthropic configuration.
- Preserve `/api/generate` as preview-only and `/api/write` as the only publication path.
- Preserve the persisted publication-verdict passport, blocker/preference severity, CAS guards, local-before-calendar ordering, and `nodevelo-<date>` event keys.
- Use `targetWeeklyHours` for intended loading-week load and `maxAvailableHours` only as a hard ceiling; require `targetWeeklyHours <= maxAvailableHours`.
- Migrate both new hour fields from the old `weeklyHoursMax`, keep existing recovery settings, and
  default the owner-verified `lapButtonSteps` capability to `true` using missing-field fallback checks
  rather than `=== null`.
- Generate every stock cycling workout with power as its target family. Keep HR syntax parser support
  for stored history only.
- A steady easy segment in a power-led Z2, Recovery, or durability ride may show a resolved bpm HR
  ceiling as cue text. Warmups, cooldowns, recovery intervals, and standalone quality sessions never
  do, and no workout serializes it as a second structured target.
- Generate no cadence targets. Continue parsing legacy cadence tokens without treating them as semantic targets.
- Support `%FTP` points/ranges, standard power zones, standard HR zones, `% HR`, `% LTHR`, power ramps, repeats, cues, `intensity=<role>`, and eligible `Press lap` endings.
- Allow `Press lap` only when `lapButtonSteps` is true and only on the safe Z2 readiness step before
  prescribed work; the owner verified this path on Wahoo.
- Use ramps only for warmup/cooldown progression, never for stimulus-critical main work.
- Exclude absolute watts, MMP, custom zones, pace, distance, freeride, timed prompts, power-display averaging, HTML/Markdown decoration, and nested repeats.
- Every generated cycling workout must satisfy `typed prescription -> render -> parse -> semantic equality` before it can reach the publication gate.
- Progress work duration or repetitions before intensity and keep every protocol inside the existing bands.
- Fill each ride to the slot's exact `nominalMin`; never pad hard work, exceed the slot ceiling, or reconcile compiler-owned output after rendering.
- Keep deterministic plans free of `model` and `promptVersion`; retain those fields only for historical plans and genuine AI artifacts.
- Do not add a new dependency, parser family, validator family, device matrix, workout library behavior, automatic publication, or UI redesign.

---

## File map

- `lib/types.ts`: migrate the public settings shape and retain backward-compatible optional AI provenance on historical plan types.
- `lib/data-store.ts`: heal pre-FR-5 settings into the new shape on every read/update.
- `app/api/settings/route.ts`: validate and persist target, ceiling, and lap capability.
- `components/BlockSettingsForm.tsx`: expose only the three FR-5 settings changes in the existing form.
- `lib/block-skeleton.ts`: consume target/ceiling with unchanged slot-allocation authority.
- `lib/prescription.ts`: own typed cycling semantics, canonical serialization, rich parsing, equality, and legacy work-only adapters.
- `lib/workout-templates.ts`: own the deterministic Rest/Strength/Recovery/Z2/Threshold/VO2max/SIT/RaceSim and durability A–E catalogue.
- `lib/block-compiler.ts`: new pure composition seam; choose slot types/stages, build days, enforce round trips, and call the publication gate once.
- `app/api/generate/route.ts`: resolve facts, calculate nutrition values, invoke the compiler, persist verdict/season state, and return the preview.
- `lib/anthropic-api.ts`, `lib/anthropic-prompts.ts`, `lib/plan-schema.ts`, `lib/generate-cache.ts`: remove generation-only AI code after the deterministic route is proven; keep ride analysis and retrospectives.
- Tests colocated beside each changed module plus `app/api/generate/route.test.ts` and `app/api/generate/route.season-enabled.test.ts`.
- `docs/systems/06-generation.md`, `docs/systems/07-ai-layer.md`, `docs/FILE_INDEX.md`, `ROADMAP.md`, `ARCHIVE.md`: record the shipped authority boundary and remove stale generation pointers.
- `docs/reviews/2026-08-29-fr5-acceptance.md`: record the five deterministic runs and the owner-approved Intervals/Wahoo inspection.

### Task 1: Migrate target, ceiling, and lap settings

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/data-store.ts`
- Modify: `lib/data-store.test.ts`
- Modify: `lib/block-skeleton.ts`
- Modify: `lib/block-skeleton.test.ts`
- Modify: `app/api/settings/route.ts`
- Modify: `app/api/settings/route.test.ts`
- Modify: `components/BlockSettingsForm.tsx`

**Interfaces:**
- Consumes: existing `readBlockSettings`, `updateBlockSettings`, `computeWeekTargets`, and `checkBlockFeasibility` callers.
- Produces: `BlockSettings.targetWeeklyHours: number`, `BlockSettings.maxAvailableHours: number`, and `BlockSettings.lapButtonSteps: boolean`.

- [ ] **Step 1: Write failing migration and arithmetic tests**

Add these cases to `lib/data-store.test.ts` and `lib/block-skeleton.test.ts`:

```ts
it("migrates legacy weeklyHoursMax to target and ceiling and defaults verified lap steps on", async () => {
  await fs.writeFile(
    p("block-settings.json"),
    JSON.stringify({ ...DEFAULT_BLOCK_SETTINGS, targetWeeklyHours: undefined, maxAvailableHours: undefined, lapButtonSteps: undefined, weeklyHoursMax: 12 }),
    "utf-8"
  );
  const settings = await readBlockSettings();
  expect(settings.targetWeeklyHours).toBe(12);
  expect(settings.maxAvailableHours).toBe(12);
  expect(settings.lapButtonSteps).toBe(true);
});

it("uses targetWeeklyHours for loading load and maxAvailableHours only as a ceiling", () => {
  const settings = { ...DEFAULT_BLOCK_SETTINGS, targetWeeklyHours: 10, maxAvailableHours: 14 };
  expect(computeWeekTargets(2, settings, [])).toEqual([
    { weekNumber: 1, isRecovery: false, targetHours: 10 },
    { weekNumber: 2, isRecovery: false, targetHours: 10 },
  ]);
  expect(checkBlockFeasibility(settings)).toBeNull();
});

it("rejects a target above available time", () => {
  expect(checkBlockFeasibility({ ...DEFAULT_BLOCK_SETTINGS, targetWeeklyHours: 13, maxAvailableHours: 12 }))
    .toMatch(/target.*available/i);
});
```

- [ ] **Step 2: Run the focused tests and confirm the old shape fails**

Run: `npm test -- lib/data-store.test.ts lib/block-skeleton.test.ts`

Expected: FAIL because the new settings fields do not exist and `computeWeekTargets` still reads `weeklyHoursMax`.

- [ ] **Step 3: Replace the settings fields and add one migration normalizer**

In `lib/types.ts`, replace the two loading-week fields and extend the platform settings:

```ts
export interface BlockSettings {
  targetWeeklyHours: number;
  maxAvailableHours: number;
  recoveryWeekHoursMin: number;
  recoveryWeekHoursMax: number;
  qualitySessionsPerLoadingWeek: number;
  longRideDurationMinutes: number;
  restDaysPerWeek: number;
  polarisedApproach: boolean;
  autoSyncOnOpen: boolean;
  autoPostCoachNote: boolean;
  lapButtonSteps: boolean;
  updatedAt: string;
}

export const DEFAULT_BLOCK_SETTINGS: BlockSettings = {
  targetWeeklyHours: 12,
  maxAvailableHours: 12,
  recoveryWeekHoursMin: 6,
  recoveryWeekHoursMax: 8,
  qualitySessionsPerLoadingWeek: 2,
  longRideDurationMinutes: 180,
  restDaysPerWeek: 1,
  polarisedApproach: true,
  autoSyncOnOpen: true,
  autoPostCoachNote: false,
  lapButtonSteps: true,
  updatedAt: new Date(0).toISOString(),
};
```

Keep the existing optional calibration fields in `BlockSettings` between the platform booleans and `updatedAt`.

In `lib/data-store.ts`, replace `healBlockSettingsBooleans` with a single shape normalizer that accepts legacy JSON without widening the exported type:

```ts
type StoredBlockSettings = Partial<BlockSettings> & {
  weeklyHoursMin?: number;
  weeklyHoursMax?: number;
};

function normalizeBlockSettings(stored: StoredBlockSettings): BlockSettings {
  const legacyTarget = stored.weeklyHoursMax ?? DEFAULT_BLOCK_SETTINGS.targetWeeklyHours;
  const { weeklyHoursMin: _legacyMin, weeklyHoursMax: _legacyMax, ...current } = stored;
  return {
    ...DEFAULT_BLOCK_SETTINGS,
    ...current,
    targetWeeklyHours: stored.targetWeeklyHours ?? legacyTarget,
    maxAvailableHours: stored.maxAvailableHours ?? legacyTarget,
    lapButtonSteps: stored.lapButtonSteps ?? true,
    autoSyncOnOpen: stored.autoSyncOnOpen ?? DEFAULT_BLOCK_SETTINGS.autoSyncOnOpen,
    polarisedApproach: stored.polarisedApproach ?? DEFAULT_BLOCK_SETTINGS.polarisedApproach,
  };
}
```

Use `normalizeBlockSettings` in both `readBlockSettings` and inside the locked `updateBlockSettings` callback. Do not persist `weeklyHoursMin` or `weeklyHoursMax` back out.

- [ ] **Step 4: Update skeleton arithmetic**

Change `checkBlockFeasibility` and `computeWeekTargets` in `lib/block-skeleton.ts` to use the new meanings:

```ts
if (settings.targetWeeklyHours > settings.maxAvailableHours) {
  return `Settings conflict: target weekly hours (${settings.targetWeeklyHours}h) exceed available time (${settings.maxAvailableHours}h).`;
}

const maxAvailableMinutes = settings.maxAvailableHours * 60;
const loadingTarget = settings.targetWeeklyHours;
const derivedRecoveryTarget = clamp(
  loadingTarget * RECOVERY_RETENTION_PCT,
  settings.recoveryWeekHoursMin,
  Math.min(settings.recoveryWeekHoursMax, settings.maxAvailableHours)
);
```

Rename loop variables and assertion labels in `lib/block-skeleton.test.ts`; preserve its exhaustive settings/event invariant sweeps with both `targetWeeklyHours === maxAvailableHours` and target-below-ceiling cases.

- [ ] **Step 5: Update the settings API and form**

In `app/api/settings/route.ts`, construct the new fields in the locked merge:

```ts
const next: BlockSettings = {
  targetWeeklyHours: num("targetWeeklyHours", 4, 25),
  maxAvailableHours: num("maxAvailableHours", 4, 30),
  recoveryWeekHoursMin: num("recoveryWeekHoursMin", 2, 15),
  recoveryWeekHoursMax: num("recoveryWeekHoursMax", 2, 15),
  qualitySessionsPerLoadingWeek: num("qualitySessionsPerLoadingWeek", 1, 4),
  longRideDurationMinutes: num("longRideDurationMinutes", 60, 480),
  restDaysPerWeek: num("restDaysPerWeek", 0, 3),
  polarisedApproach: typeof b.polarisedApproach === "boolean" ? b.polarisedApproach : current.polarisedApproach,
  autoSyncOnOpen: typeof b.autoSyncOnOpen === "boolean" ? b.autoSyncOnOpen : current.autoSyncOnOpen,
  autoPostCoachNote: typeof b.autoPostCoachNote === "boolean" ? b.autoPostCoachNote : current.autoPostCoachNote,
  lapButtonSteps: typeof b.lapButtonSteps === "boolean" ? b.lapButtonSteps : current.lapButtonSteps,
  updatedAt: new Date().toISOString(),
};
if (next.targetWeeklyHours > next.maxAvailableHours) {
  throw new SettingsValidationError("Target weekly hours can't exceed maximum available hours.");
}
```

Preserve the four existing calibration override merge blocks after this object.

In `components/BlockSettingsForm.tsx`, replace the two loading inputs with “Target weekly hours” and “Maximum available hours”, validate `targetWeeklyHours > maxAvailableHours`, and add this existing `ToggleRow` under Training philosophy:

```tsx
<ToggleRow
  label="Allow Press lap steps"
  hint="Ends a safe readiness step when you press lap; verified on Wahoo, Garmin, and Suunto workflows."
  checked={settings.lapButtonSteps}
  onChange={(value) => set("lapButtonSteps", value)}
/>
```

Add API tests that reject target-over-ceiling and preserve `lapButtonSteps` across unrelated PUTs.

- [ ] **Step 6: Run settings and skeleton checks**

Run: `npm test -- lib/data-store.test.ts lib/block-skeleton.test.ts app/api/settings/route.test.ts`

Expected: PASS with the property sweep still covering exact weekly sums.

- [ ] **Step 7: Commit the settings migration**

```bash
git add lib/types.ts lib/data-store.ts lib/data-store.test.ts lib/block-skeleton.ts lib/block-skeleton.test.ts app/api/settings/route.ts app/api/settings/route.test.ts components/BlockSettingsForm.tsx
git commit -m "feat: separate weekly target from availability"
```

### Task 2: Add typed prescription round trips

**Files:**
- Modify: `lib/prescription.ts`
- Modify: `lib/prescription.test.ts`

**Interfaces:**
- Consumes: stored Intervals text and existing work-only callers of `parsePrescription`, `walkWorkoutSteps`, and `totalPrescribedMinutes`.
- Produces: `CyclingPrescription`, `renderPrescription`, `parseCyclingPrescription`, `prescriptionsEqual`, and `assertPrescriptionValid`.

- [ ] **Step 1: Write failing semantic round-trip tests**

Add a table-driven suite to `lib/prescription.test.ts` using exact typed values:

```ts
describe("typed prescription round trip", () => {
  it.each<CyclingPrescription>([
    { targetMode: "power", sections: [{ name: "Main Set", repeats: 1, steps: [{ durationSec: 300, end: "timer", role: "active", target: { kind: "power-percent", minPctFtp: 95, maxPctFtp: 100 }, cue: "Smooth power", hrCeilingBpm: 145 }] }] },
    { targetMode: "power", sections: [{ name: "Warmup", repeats: 1, steps: [{ durationSec: 600, end: "timer", role: "warmup", target: { kind: "power-ramp", fromPctFtp: 50, toPctFtp: 75 }, cue: "Settle in" }] }] },
    { targetMode: "power", sections: [{ name: "Cooldown", repeats: 1, steps: [{ durationSec: 600, end: "timer", role: "cooldown", target: { kind: "power-zone", minZone: 1, maxZone: 2 } }] }] },
    { targetMode: "heartRate", sections: [{ name: "Main Set", repeats: 3, steps: [{ durationSec: 240, end: "timer", role: "active", target: { kind: "hr-percent", basis: "lthr", minPct: 95, maxPct: 100 } }, { durationSec: 120, end: "timer", role: "recovery", target: { kind: "hr-zone", minZone: 1, maxZone: 2 } }] }] },
    { targetMode: "heartRate", sections: [{ name: "Warmup", repeats: 1, steps: [{ durationSec: 600, end: "lapButton", role: "warmup", target: { kind: "hr-zone", minZone: 1, maxZone: 2 }, cue: "When safely positioned" }] }] },
  ])("round-trips %#", (value) => {
    const text = renderPrescription(value, { lapButtonSteps: true });
    expect(prescriptionsEqual(parseCyclingPrescription(text), value)).toBe(true);
  });

  it("keeps legacy cadence parseable but never renders cadence", () => {
    const parsed = parseCyclingPrescription("Main Set 2x\n- 5m 95%-100% 90rpm intensity=active");
    expect(renderPrescription(parsed, { lapButtonSteps: false })).not.toMatch(/rpm|cadence/i);
  });
});
```

Add rejection cases for mixed target families, main-set ramps, nested repeats, missing lap capability, and lap endings on active steps.

- [ ] **Step 2: Run the prescription suite and confirm the new API is absent**

Run: `npm test -- lib/prescription.test.ts`

Expected: FAIL because the typed exports are not defined.

- [ ] **Step 3: Define the semantic types and validation error**

Add these exports to `lib/prescription.ts`:

```ts
export type PrescriptionTargetMode = "power" | "heartRate";
export type PrescriptionSectionName = "Warmup" | "Main Set" | "Cooldown";
export type StepRole = "warmup" | "active" | "recovery" | "cooldown";
export type StepTarget =
  | { kind: "power-percent"; minPctFtp: number; maxPctFtp: number }
  | { kind: "power-ramp"; fromPctFtp: number; toPctFtp: number }
  | { kind: "power-zone"; minZone: 1 | 2 | 3 | 4 | 5 | 6; maxZone: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: "hr-percent"; basis: "max" | "lthr"; minPct: number; maxPct: number }
  | { kind: "hr-zone"; minZone: 1 | 2 | 3 | 4 | 5; maxZone: 1 | 2 | 3 | 4 | 5 };
export interface PrescriptionStep {
  cue?: string;
  durationSec: number;
  end: "timer" | "lapButton";
  role: StepRole;
  target: StepTarget;
  hrCeilingBpm?: number;
}
export interface PrescriptionSection {
  name: PrescriptionSectionName;
  repeats: number;
  steps: PrescriptionStep[];
}
export interface CyclingPrescription {
  targetMode: PrescriptionTargetMode;
  sections: PrescriptionSection[];
}
export class PrescriptionSyntaxError extends Error {}
```

Implement `assertPrescriptionValid(value, options)` as the sole invariant check. It must reject non-positive duration/repeats, empty sections, reversed ranges/zones, a target kind outside `targetMode`, a ramp outside Warmup/Cooldown, HR ceilings on HR-led workouts, `lapButton` without capability, and `lapButton` unless the role is `warmup` or `recovery`.

- [ ] **Step 4: Implement one canonical renderer**

Add pure helpers with these signatures:

```ts
export function formatDuration(durationSec: number): string;
export function renderPrescription(
  prescription: CyclingPrescription,
  options: { lapButtonSteps: boolean }
): string;
```

Canonical line construction must follow this exact token order:

```ts
const cueParts = [
  step.end === "lapButton" ? "Press lap" : null,
  step.cue,
  step.hrCeilingBpm ? `HR cap ${step.hrCeilingBpm}bpm` : null,
].filter((value): value is string => Boolean(value));
return `- ${[...cueParts, formatDuration(step.durationSec), renderTarget(step.target), `intensity=${step.role}`].join(" ")}`;
```

Render section headers as the section name plus ` ${repeats}x` only when repeats exceed one, and join sections with exactly one blank line. Render point ranges as one value, ranges with a hyphen, HR zones with ` HR`, `% HR` for max-HR percentages, `% LTHR` for threshold-HR percentages, and lowercase `ramp`.

- [ ] **Step 5: Implement the rich parser and preserve old adapters**

Add:

```ts
export function parseCyclingPrescription(workoutText: string): CyclingPrescription;
export function prescriptionsEqual(left: CyclingPrescription, right: CyclingPrescription): boolean;
```

Parse section headers, repeat count, duration tokens, `intensity=`, `Press lap`, `HR cap <n>bpm`, cue text, and exactly one target using anchored token regexes. Treat legacy unlabelled step groups as `Main Set`, accept the existing apostrophe/quote duration spellings, and ignore a trailing legacy cadence token (`<n>rpm`, `<n>-<n>rpm`) before role parsing. When legacy text lacks `intensity=`, infer warmup/cooldown from the section, recovery from a sub-80% power target or Z1-Z2 HR target, and active otherwise. Reject nested/noncanonical repeat headers and mixed target families instead of guessing.

Keep the existing multi-clause power scanner as the backward-compatible implementation of `walkWorkoutSteps` and `parsePrescription`; extend it to ignore the new role/cap tokens and to skip percentages followed by `HR` or `LTHR` so HR-led work cannot masquerade as `%FTP`. Make `totalPrescribedMinutes` use the rich parse for canonical power or HR workouts and fall back to the legacy scanner for stored multi-clause text. This preserves old work-only `PrescribedInterval[]` behavior without forcing lossy legacy strings through the new canonical semantic type.

- [ ] **Step 6: Run all parser consumers**

Run: `npm test -- lib/prescription.test.ts lib/workout-validate.test.ts lib/workout-library.test.ts lib/session-level.test.ts app/api/write/route.test.ts app/api/sync/route.test.ts`

Expected: PASS; legacy power-work labels and duration behavior remain unchanged.

- [ ] **Step 7: Commit the prescription seam**

```bash
git add lib/prescription.ts lib/prescription.test.ts
git commit -m "feat: add typed workout prescription syntax"
```

### Task 3: Replace prose templates with the deterministic protocol catalogue

**Files:**
- Modify: `lib/workout-templates.ts`
- Modify: `lib/workout-templates.test.ts`
- Modify: `lib/durability.ts`
- Modify: `lib/durability.test.ts`

**Interfaces:**
- Consumes: `DaySlot`, `DurabilityTemplateId`, `WorkoutNutritionPlan`, and prescription types from Task 2.
- Produces: `compileWorkoutTemplate(input: WorkoutTemplateInput): CompiledWorkoutTemplate` for every `WorkoutType`.

- [ ] **Step 1: Write failing catalogue and progression tests**

Add table-driven tests that call the public catalogue for stages `0`, `1`, and `2` and assert:

```ts
expect(compileWorkoutTemplate({ ...base, type: "SIT", stage: 0 }).summary).toBe("4×30s @ 150% FTP");
expect(compileWorkoutTemplate({ ...base, type: "SIT", stage: 2 }).summary).toBe("6×30s @ 150% FTP");
expect(compileWorkoutTemplate({ ...base, type: "VO2max", stage: 0 }).summary).toBe("4×3m @ 110% FTP");
expect(compileWorkoutTemplate({ ...base, type: "Threshold", stage: 0 }).summary).toBe("2×12m @ 90% FTP");
expect(compileWorkoutTemplate({ ...base, type: "Threshold", stage: 2 }).summary).toBe("3×15m @ 95% FTP");
```

For each protocol, expand the prescription and assert exact slot duration, allowed intensity band, and nondecreasing work seconds across stages. Add one RaceSim assertion for 3–5 distinct moves with its highest target in the final third, and durability B–E assertions that the hard mechanism is encoded as steps rather than prose.

- [ ] **Step 2: Run the template suite and confirm quality/durability coverage fails**

Run: `npm test -- lib/workout-templates.test.ts lib/durability.test.ts`

Expected: FAIL because the current builder only covers Rest, Strength, Recovery, and durability-A Z2.

- [ ] **Step 3: Define the single catalogue interface**

Replace `buildTemplateDay` with:

```ts
export interface WorkoutTemplateInput {
  type: WorkoutType;
  slot: DaySlot;
  stage: 0 | 1 | 2;
  isRecoveryWeek: boolean;
  durabilityTemplateId: DurabilityTemplateId;
  targetMode: "power" | "heartRate";
  hrCeilingBpm: number | null;
  lapButtonSteps: boolean;
  nutrition: WorkoutNutritionPlan;
}
export interface CompiledWorkoutTemplate {
  name: string;
  summary: string;
  prescription: CyclingPrescription | null;
  workoutText: string;
  description: string;
}
export function compileWorkoutTemplate(input: WorkoutTemplateInput): CompiledWorkoutTemplate;
```

Rest returns `prescription: null` and `workoutText: ""`; Strength returns `prescription: null` and keeps the existing deterministic prose in `workoutText`. Every cycling type returns a typed prescription, an empty `workoutText`, and a deterministic nutrition-only description.

- [ ] **Step 4: Encode ordered quality recipes**

Use a local constant, not classes or factories:

```ts
const QUALITY_STAGES = {
  SIT: [
    { reps: 4, workSec: 30, workPct: 150, recoverySec: 240 },
    { reps: 5, workSec: 30, workPct: 150, recoverySec: 240 },
    { reps: 6, workSec: 30, workPct: 150, recoverySec: 240 },
  ],
  VO2max: [
    { reps: 4, workSec: 180, workPct: 110, recoverySec: 180 },
    { reps: 5, workSec: 240, workPct: 112, recoverySec: 240 },
    { reps: 5, workSec: 300, workPct: 115, recoverySec: 300 },
  ],
  Threshold: [
    { reps: 2, workSec: 720, workPct: 90, recoverySec: 300 },
    { reps: 2, workSec: 1200, workPct: 93, recoverySec: 300 },
    { reps: 3, workSec: 900, workPct: 95, recoverySec: 300 },
  ],
} as const;
```

Recovery weeks always use the dedicated `2×8m @ 90% FTP` Threshold touch, never a stage lookup. SIT
always uses 30-second maximal efforts, with seated cues and one standing final rep; standing remains
a cue rather than a workout type. Build RaceSim from a fixed stage table of 3, 4, or 5 varied moves
and keep the hardest move in the final third. HR ceilings are reserved for Z2, Recovery, and
durability rides; standalone quality sessions remain power-only throughout.

- [ ] **Step 5: Encode easy rides, ramps, HR control, and durability A–E**

Use one power ramp from 50% to 70–75% for at most five minutes. Put any remaining pre-interval time
at power Z2, interval recovery and cooldown at power Z1, and attach `hrCeilingBpm` only to steady
endurance steps. All generated prescriptions use `targetMode: "power"`.

Encode durability mechanisms with fixed stage-appropriate steps:

```ts
const DURABILITY_RECIPES = {
  A: { kind: "steady" },
  B: { kind: "late-repeats", reps: 2, workSec: 600, workPct: 90, recoverySec: 300 },
  C: { kind: "late-repeats", reps: 4, workSec: 180, workPct: 110, recoverySec: 180 },
  D: { kind: "late-repeats", reps: 8, workSec: 15, workPct: 150, recoverySec: 225 },
  E: { kind: "distributed", reps: 6, workSec: 60, workPct: 105, recoverySec: 840 },
} as const;
```

Place B–D work after at least half of total ride time and distribute E throughout. In a recovery week, override every durability recipe to A. Fill unused seconds only with warmup, easy, recovery, or cooldown steps; throw `TemplateCoverageError` if the required recipe cannot fit.

Only the initial readiness/easy transition may use `lapButton` and only when the input switch is true. Quality work and recovery between quality reps remain timer-ended.

- [ ] **Step 6: Render every template and validate existing protocol rules**

Extend the existing protocol test loop:

```ts
const rendered = renderPrescription(result.prescription!, { lapButtonSteps: input.lapButtonSteps });
expect(totalPrescribedMinutes(rendered)).toBe(input.slot.duration.nominalMin);
expect(validateWorkoutProtocol(dayFrom(result, rendered, input), FTP)).toEqual([]);
expect(prescriptionsEqual(parseCyclingPrescription(rendered), result.prescription!)).toBe(true);
```

Run: `npm test -- lib/workout-templates.test.ts lib/durability.test.ts lib/workout-validate.test.ts`

Expected: PASS for every type, stage, durability recipe, and recovery override.

- [ ] **Step 7: Commit the catalogue**

```bash
git add lib/workout-templates.ts lib/workout-templates.test.ts lib/durability.ts lib/durability.test.ts
git commit -m "feat: compile deterministic workout protocols"
```

### Task 4: Build the pure deterministic block compiler

**Files:**
- Create: `lib/block-compiler.ts`
- Create: `lib/block-compiler.test.ts`

**Interfaces:**
- Consumes: exact skeleton, focus, selected durability template, session requirements, resolved nutrition/HR facts, and publication context.
- Produces: `compileTrainingBlock(input: DeterministicBlockInput): DeterministicBlockResult`.

- [ ] **Step 1: Write compiler contract and varied-input tests**

Create fixtures through the public interface and assert deterministic equality, all dates present, exact daily/weekly sums, freshness-first ordering, recovery rules, one RaceSim when required, no AI provenance, and five varied block shapes. Use this input/result shape in the tests:

```ts
export interface DeterministicBlockInput {
  blockParams: BlockParams;
  settings: BlockSettings;
  weekTargets: WeekTarget[];
  skeleton: BlockSkeleton;
  focus: SeasonFocus;
  phase: SeasonPhase;
  focusRationale?: string;
  durabilityTemplateId: DurabilityTemplateId;
  requirements: SessionRequirements;
  ftp: number;
  hrZone2CeilingBpm: number | null;
  nutritionByDateAndType: Record<string, Partial<Record<WorkoutType, WorkoutNutritionPlan>>>;
  warnings: string[];
  publication: Omit<PublicationGateArgs, "days" | "truncated" | "expectedDayCount" | "ftp" | "blockSettings" | "weekTargets" | "blockSkeleton" | "requirements">;
}
export interface DeterministicBlockResult {
  plan: GeneratedPlan;
  prescriptions: Record<string, CyclingPrescription>;
  verdict: { blockers: string[]; preferences: string[] };
}
```

- [ ] **Step 2: Run the compiler test and verify the module is missing**

Run: `npm test -- lib/block-compiler.test.ts`

Expected: FAIL because `lib/block-compiler.ts` does not exist.

- [ ] **Step 3: Implement stable slot selection**

In `lib/block-compiler.ts`, add a pure `chooseWorkoutTypes` helper with these rules in order:

```ts
const COMPLEMENTS: QualityLibraryType[] = ["Threshold", "VO2max", "SIT", "RaceSim"];
const FRESHNESS_FIRST: QualityLibraryType[] = ["SIT", "VO2max", "Threshold", "RaceSim"];
```

- Rest slots become Rest.
- Event slots become RaceSim.
- Long rides become Z2.
- Easy slots become Recovery in recovery weeks and Z2 otherwise.
- Recovery quality becomes Threshold.
- The first loading quality slot uses its locked type, or Threshold when flexible.
- Reserve the first compatible flexible quality slot in the block for a required RaceSim unless an event already satisfies it.
- Fill remaining flexible quality slots from `COMPLEMENTS`, excluding that week's primary type.
- Reorder only quality assignments within their existing quality dates so SIT/VO2max precede Threshold/RaceSim; never move dates, events, rest, or durations.

Throw `BlockCompilationError` if a locked slot and rule conflict rather than silently substituting.

- [ ] **Step 4: Compile stages, targets, and exact days**

For loading week ordinal `0`, `1`, `2+`, select stage `0`, `1`, `2`; recovery weeks use their
dedicated touch without advancing the loading ordinal. Use `targetMode: "power"` for every generated
ride and pass the chosen type/stage and the exact date's nutrition to `compileWorkoutTemplate`.

Resolve the final workout's nutrition before calling the catalogue:

```ts
const nutrition = input.nutritionByDateAndType[slot.date]?.[type];
if (!nutrition) throw new BlockCompilationError(`Missing nutrition for ${slot.date} ${type}.`);
```

Build each day as:

```ts
const workoutText = template.prescription
  ? renderPrescription(template.prescription, { lapButtonSteps: input.settings.lapButtonSteps })
  : template.workoutText;
const day: PlannedDay = {
  date: slot.date,
  weekNumber: week.weekNumber,
  weekTheme: week.isRecovery ? "Recovery" : `${focusLabel(input.focus)} build`,
  name: template.summary ? `${template.name} — ${template.summary}` : template.name,
  type,
  durationMin: slot.duration.nominalMin,
  workoutText,
  description: template.description,
};
```

Before storing a cycling day, parse `workoutText`, compare it with the typed value, and verify `totalPrescribedMinutes(workoutText) * 60` equals the sum of the typed expanded steps and `durationMin * 60`. Throw on any mismatch.

- [ ] **Step 5: Build provenance and run the gate exactly once**

Create the deterministic title with a small focus-label record, `input.phase`, and the block length, for example `4-week Threshold Build`. Capitalize the fixed phase union (`base`, `build`, `peak`, `taper`, `transition`) without accepting free-form text. Set `raw` to stable JSON containing `blockParams`, selected focus/phase/durability, days, and typed prescriptions. Do not set `model` or `promptVersion`.

Define the title vocabulary locally so it cannot drift with prompt copy:

```ts
const FOCUS_LABEL: Record<SeasonFocus, string> = {
  "aerobic-base": "Aerobic Base",
  threshold: "Threshold",
  vo2max: "VO2max",
  anaerobic: "Anaerobic",
  durability: "Durability",
  sharpen: "Sharpen",
};
const focusLabel = (focus: SeasonFocus) => FOCUS_LABEL[focus];
```

Call the existing gate once:

```ts
const gate = evaluatePublicationGate({
  ...input.publication,
  days,
  truncated: false,
  expectedDayCount: input.blockParams.lengthWeeks * 7,
  ftp: input.ftp,
  blockSettings: input.settings,
  weekTargets: input.weekTargets,
  blockSkeleton: input.skeleton,
  requirements: input.requirements,
});
```

Add `findings` only when a blocker or preference exists. Return gate advisories appended to `warnings`, the prescriptions keyed by date, and the verdict buckets separately for persistence.

- [ ] **Step 6: Run compiler and validator tests**

Run: `npm test -- lib/block-compiler.test.ts lib/publication-gate.test.ts lib/schedule-validate.test.ts lib/workout-validate.test.ts`

Expected: PASS. Re-running the same compiler fixture produces byte-identical `plan.raw` and days.

- [ ] **Step 7: Commit the compiler**

```bash
git add lib/block-compiler.ts lib/block-compiler.test.ts
git commit -m "feat: compile complete training blocks deterministically"
```

### Task 5: Make `/api/generate` an AI-free orchestrator

**Files:**
- Modify: `app/api/generate/route.ts`
- Modify: `app/api/generate/route.test.ts`
- Modify: `app/api/generate/route.season-enabled.test.ts`
- Modify: `lib/nutrition.ts`
- Modify: `lib/nutrition.test.ts`

**Interfaces:**
- Consumes: `compileTrainingBlock`, existing reads/selectors/season persistence, physiology zones, and nutrition formula.
- Produces: the same `{ plan: GeneratedPlan }` route response and persisted generation verdict, without Anthropic configuration or calls.

- [ ] **Step 1: Rewrite route tests around deterministic output**

Remove the `@/lib/anthropic-api`, `@/lib/generate-cache`, KB, plan-schema, and prompt mocks from both generate-route suites. Add a compiler spy that calls through to the real implementation where an integration assertion needs real days.

Add these route assertions:

```ts
it("generates with Anthropic unconfigured and omits AI provenance", async () => {
  const res = await gen("Improve threshold power");
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.plan.days).toHaveLength(14);
  expect(json.plan.model).toBeUndefined();
  expect(json.plan.promptVersion).toBeUndefined();
});

it("persists the compiler verdict and keeps generation preview-only", async () => {
  await gen("Improve threshold power");
  expect(store.saveGenerationVerdict).toHaveBeenCalledTimes(1);
});
```

Keep freshness 400s, feasibility 400s, season CAS/degradation, event/focus, and verdict-persistence fail-safe cases. Delete tests whose only behavior was malformed tool payload, token truncation, prompt contents, or Anthropic failure.

- [ ] **Step 2: Run route tests and confirm they fail at the old AI guard**

Run: `npm test -- app/api/generate/route.test.ts app/api/generate/route.season-enabled.test.ts`

Expected: FAIL because the route returns “Connect the AI coach” or invokes the old generator.

- [ ] **Step 3: Add one reusable exact-duration nutrition function**

In `lib/nutrition.ts`, expose the already-existing formula composition instead of making the route duplicate it:

```ts
export function buildWorkoutNutritionPlan(
  profile: AthleteProfile,
  latestWeightKg: number,
  today: string,
  ftp: number,
  bufferApplied: number,
  workout: WorkoutContext
): WorkoutNutritionPlan {
  const isRestDay = workout.type === "Rest";
  const model = resolveNutritionModel(profile, latestWeightKg, today, isRestDay);
  return calculateDailyTarget(
    estimateWorkoutBurnKcal(workout.type, workout.durationMin, ftp),
    model,
    bufferApplied,
    isRestDay,
    workout
  );
}
```

Have `buildNutritionReferenceRows` call this helper. Add a test proving a non-reference duration such as 83 minutes gets the same formula result as direct `calculateDailyTarget`.

- [ ] **Step 4: Remove generation-only reads and build compiler input**

In `app/api/generate/route.ts`, remove the initial Anthropic configuration guard and stop reading KB context, retrospective seeds, quirks, and prompt-only reflection material. Retain athlete/sync/settings/physiology/season/score/intent/baseline/current-block reads needed by deterministic selectors.

After computing `blockSkeleton`, build:

```ts
const nutritionByDateAndType = Object.fromEntries(
  blockSkeleton.weeks.flatMap((week) => week.days.map((slot) => [
    slot.date,
    Object.fromEntries(WORKOUT_TYPES.map((type) => [
      type,
      buildWorkoutNutritionPlan(profile, latestWeight, today, profile.performance.ftp, bufferStatus.bufferApplied, {
        type,
        durationMin: slot.duration.nominalMin,
      }),
    ])),
  ]))
);
const hrZones = physStore ? resolveHrZones(physStore.current) : [];
const hrZone2CeilingBpm = hrZones[1]?.hi ?? null;
```

The compiler must read `nutritionByDateAndType[slot.date]?.[selectedType]` and throw when it is absent. This keeps the compiler pure and ensures type-dependent carbohydrate targets match the final selected workout.

- [ ] **Step 5: Invoke the compiler and persist its passport**

Replace prompt construction, dedupe, Anthropic invocation, schema parsing, reconciliation, nutrition repair, overview checking, and the route's direct gate call with:

```ts
const compiled = compileTrainingBlock({
  blockParams,
  settings: blockSettings,
  weekTargets,
  skeleton: blockSkeleton,
  focus: rollingFocusChoice?.focus ?? "aerobic-base",
  phase: SEASON_SHAPES_GENERATION && replannedSeason
    ? (periodForDate(replannedSeason, blockParams.startDate)?.phase ?? "build")
    : "build",
  ...(rollingFocusChoice ? { focusRationale: rollingFocusChoice.rationale } : {}),
  durabilityTemplateId: durability.id,
  requirements,
  ftp: profile.performance.ftp,
  hrZone2CeilingBpm,
  nutritionByDateAndType,
  warnings: [...warnings, ...seasonDegradedWarnings],
  publication: {
    envelope: resolveDurabilityInsertEnvelope(blockSettings.durabilityInsertEnvelope),
    events: existingSeason.events,
    seasonContext: SEASON_SHAPES_GENERATION && aEventForBlock && replannedSeason
      ? { mode: "event-anchored", plan: replannedSeason }
      : rollingFocusChoice
        ? { mode: "rolling", focus: rollingFocusChoice.focus }
        : null,
  },
});
const plan = compiled.plan;
```

Persist `compiled.verdict` with `verdictHash(plan.days, plan.blockParams)` and `createdAt`, omitting `model` and `promptVersion`. Preserve the existing best-effort failure handling, delayed season CAS update, and final JSON response.

- [ ] **Step 6: Run route, write, and sync regression tests**

Run: `npm test -- app/api/generate/route.test.ts app/api/generate/route.season-enabled.test.ts app/api/write/route.test.ts app/api/sync/route.test.ts lib/nutrition.test.ts`

Expected: PASS; `/api/write` still rejects unknown/blocking passports and only publishes acknowledged preference findings.

- [ ] **Step 7: Commit the route cutover**

```bash
git add app/api/generate/route.ts app/api/generate/route.test.ts app/api/generate/route.season-enabled.test.ts lib/nutrition.ts lib/nutrition.test.ts
git commit -m "feat: remove AI from block generation"
```

### Task 6: Delete obsolete block-generation AI machinery and update system documentation

**Files:**
- Modify: `lib/anthropic-api.ts`
- Modify: `lib/anthropic-api.test.ts`
- Modify: `lib/anthropic-prompts.ts`
- Modify: `lib/anthropic-prompts.test.ts`
- Delete: `lib/plan-schema.ts`
- Delete: `lib/plan-schema.test.ts`
- Delete: `lib/generate-cache.ts`
- Delete: `lib/generate-cache.test.ts`
- Modify: `lib/workout-validate.ts`
- Modify: `docs/systems/06-generation.md`
- Modify: `docs/systems/07-ai-layer.md`
- Modify: `docs/FILE_INDEX.md`
- Modify: `ROADMAP.md`
- Modify: `ARCHIVE.md`

**Interfaces:**
- Consumes: the completed deterministic route from Task 5.
- Produces: an Anthropic layer containing only optional language paths and documentation with no stale pointers.

- [ ] **Step 1: Add a dependency-boundary assertion**

Add this test to `app/api/generate/route.test.ts`:

```ts
it("has no block-generation Anthropic or tool-schema dependency", async () => {
  const source = await readFile(join(process.cwd(), "app/api/generate/route.ts"), "utf8");
  expect(source).not.toMatch(/generateTrainingBlock|PlanToolSchema|buildSystemPrompt|buildUserMessage|dedupeGeneration|isAnthropicConfigured/);
});
```

Run: `npm test -- app/api/generate/route.test.ts`

Expected: PASS after Task 5.

- [ ] **Step 2: Remove generation-only exports and tests**

Delete `generateTrainingBlock`, `generationMaxTokens`, its result type, and the training-block tool import from `lib/anthropic-api.ts`. Keep `GENERATION_MODEL` and `PROMPT_VERSION` because ride analysis and retrospective provenance still use them.

Delete the block-generation sections `blockDates`, `buildAthleteDataSection`, `buildSystemPrompt`, and `buildUserMessage` from `lib/anthropic-prompts.ts` and their matching test describe block. Retain ride-analysis and retrospective prompt builders.

Delete `lib/plan-schema.ts`, `lib/plan-schema.test.ts`, `lib/generate-cache.ts`, and `lib/generate-cache.test.ts` after `rg` confirms they have no remaining imports. Update the stale `buildUserMessage` comment in `lib/workout-validate.ts` to point to `lib/workout-templates.ts` and `lib/block-compiler.ts`.

- [ ] **Step 3: Update canonical project documentation**

In `docs/systems/06-generation.md`, replace the LLM composition flow with:

```text
resolved facts -> week targets -> block skeleton -> compileTrainingBlock
               -> typed prescription -> canonical render/parse equality
               -> publication gate -> preview -> explicit /api/write
```

Document target versus ceiling, single target family, HR-cap cue semantics, ramp/device limits, and lap default-off behavior. In `docs/systems/07-ai-layer.md`, list only ride-analysis notes and retrospectives as active Anthropic paths. Update `docs/FILE_INDEX.md` with `lib/block-compiler.ts` and the richer responsibilities of `lib/prescription.ts`/`lib/workout-templates.ts`.

Move FR-5 from ROADMAP to ARCHIVE with links to the approved design, implementation plan, and acceptance evidence file. Run `rg` for every renamed/removed heading and repair all pointers.

- [ ] **Step 4: Run dead-reference, type, lint, and link checks**

Run:

```bash
rg -n "generateTrainingBlock|PlanToolSchema|TRAINING_BLOCK_TOOL|buildUserMessage|buildSystemPrompt|dedupeGeneration" app lib components
npm run check-links
npx tsc --noEmit
npm run lint
```

Expected: `rg` returns no active-code references; links, typecheck, and lint pass.

- [ ] **Step 5: Run the full automated suite**

Run: `npm test`

Expected: PASS with no Anthropic call needed by `/api/generate` tests.

- [ ] **Step 6: Commit cleanup and docs**

```bash
git add lib/anthropic-api.ts lib/anthropic-api.test.ts lib/anthropic-prompts.ts lib/anthropic-prompts.test.ts lib/workout-validate.ts docs/systems/06-generation.md docs/systems/07-ai-layer.md docs/FILE_INDEX.md ROADMAP.md ARCHIVE.md
git add -u lib/plan-schema.ts lib/plan-schema.test.ts lib/generate-cache.ts lib/generate-cache.test.ts
git commit -m "docs: record deterministic generation authority"
```

### Task 7: Record FR-5 acceptance evidence

**Files:**
- Create: `docs/reviews/2026-08-29-fr5-acceptance.md`

**Interfaces:**
- Consumes: the completed implementation, local API, one owner-approved Intervals publication, and Wahoo execution observations.
- Produces: the auditable FR-5 acceptance record; no product behavior.

- [ ] **Step 1: Run five deterministic generation cases**

Start the local app with Anthropic unset:

```bash
env -u ANTHROPIC_API_KEY npm run dev
```

Generate and retain the response JSON for:

1. Two-week Threshold, target equal to ceiling.
2. Four-week VO2max, recovery week, target below ceiling.
3. Six-week anaerobic, three quality slots.
4. Terrain/race goal requiring RaceSim.
5. Eight-week event displacement with constrained availability.

Run the five cases consecutively. For each case, generate twice and compare `plan.raw`, `plan.days`, weekly sums, blockers, and preferences. Expected: identical outputs, every date present, zero blockers for feasible fixtures, and no `model`/`promptVersion`.

- [ ] **Step 2: Create the acceptance record with exact evidence fields**

Create `docs/reviews/2026-08-29-fr5-acceptance.md` only after the observations exist. Use this exact section/table structure, inserting the actual commit, timestamps, outcomes, and observations gathered in Steps 1 and 3:

```markdown
# FR-5 acceptance evidence

**Date:** 2026-08-29
**Commit:** the exact tested commit SHA

## Automated verification

- `npm run check`: pass or fail plus the execution timestamp
- Anthropic unset generation: pass or fail

## Varied deterministic generations

| Case | Input summary | Stable repeat | Days | Weekly sums | Blockers | Notes |
|---|---|---:|---:|---|---:|---|

## Intervals.icu inspection

- Owner approval recorded: date and time
- Power-led target and repeat order: observed result
- HR-led Z1-Z2 target: observed result
- Ramp graph interpretation: observed result
- Duration/load and role classification: observed result
- Explicit rest days: observed result

## Wahoo execution

- Representative power workout: observed result
- Representative HR workout: observed result
- Ramp degradation: observed result
- Press lap absent: observed result

## Verdict

`PASS` only when all required rows and inspections above contain recorded evidence.
```

Do not commit the document until every evidence line contains the observed value.

- [ ] **Step 3: Publish only after explicit owner approval**

Use the existing preview UI and `/api/write` flow for one selected result. Do not bypass blocker/preference acknowledgment or call Intervals directly. Inspect the Intervals graph before executing representative power-led and HR-led sessions on Wahoo.

- [ ] **Step 4: Run final verification**

Run: `npm run check`

Expected: typecheck, lint, unit/integration tests, workflow tests, sync tests, and link checks all pass.

- [ ] **Step 5: Commit the filled acceptance record**

```bash
git add docs/reviews/2026-08-29-fr5-acceptance.md
git commit -m "test: record FR-5 acceptance evidence"
```

Stop after this commit. Use the repository's sanctioned `npm run finish:agent-task` workflow only when the owner asks to finish the implementation branch.
