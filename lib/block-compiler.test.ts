import { describe, expect, it, vi } from "vitest";
import { computeBlockSkeleton, computeWeekTargets, type BlockSkeleton } from "./block-skeleton";
import {
  BlockCompilationError,
  compileTrainingBlock,
  type DeterministicBlockInput,
} from "./block-compiler";
import type { WorkoutNutritionPlan } from "./nutrition";
import { parseCyclingPrescription } from "./prescription";
import * as publicationGate from "./publication-gate";
import { deriveSessionRequirements } from "./session-requirements";
import {
  DEFAULT_BLOCK_SETTINGS,
  WORKOUT_TYPES,
  type BlockParams,
  type BlockSettings,
  type SeasonEvent,
  type SeasonFocus,
  type SeasonPhase,
} from "./types";

const nutrition: WorkoutNutritionPlan = {
  dailyTarget: 2800,
  maintenanceKcal: 2600,
  preRideCarbs: 80,
  inRideCarbsPerHour: 60,
  bufferApplied: 200,
  floored: false,
};

function settings(overrides: Partial<BlockSettings> = {}): BlockSettings {
  return {
    ...DEFAULT_BLOCK_SETTINGS,
    targetWeeklyHours: 9,
    maxAvailableHours: 10,
    longRideDurationMinutes: 150,
    qualitySessionsPerLoadingWeek: 2,
    ...overrides,
  };
}

function blockParams(lengthWeeks: BlockParams["lengthWeeks"]): BlockParams {
  return {
    lengthWeeks,
    goal: "Build durable cycling fitness",
    weakpoints: [],
    startDate: "2026-09-07",
  };
}

function nutritionTable(skeleton: BlockSkeleton): DeterministicBlockInput["nutritionByDateAndType"] {
  return Object.fromEntries(skeleton.weeks.flatMap((week) => week.days.map((slot) => [
    slot.date,
    Object.fromEntries(WORKOUT_TYPES.map((type) => [type, nutrition])),
  ])));
}

function compilerInput(options: {
  lengthWeeks: BlockParams["lengthWeeks"];
  focus: SeasonFocus;
  phase?: SeasonPhase;
  recoveryWeekIndices?: number[];
  settings?: Partial<BlockSettings>;
  events?: SeasonEvent[];
  requireRaceSim?: boolean;
}): DeterministicBlockInput {
  const blockSettings = settings(options.settings);
  const params = blockParams(options.lengthWeeks);
  const weekTargets = computeWeekTargets(params.lengthWeeks, blockSettings, options.recoveryWeekIndices ?? []);
  const events = options.events ?? [];
  const skeleton = computeBlockSkeleton(params.startDate, weekTargets, blockSettings, options.focus, events);
  return {
    blockParams: params,
    settings: blockSettings,
    weekTargets,
    skeleton,
    focus: options.focus,
    phase: options.phase ?? "build",
    focusRationale: "Deterministic test rationale",
    durabilityTemplateId: "A",
    requirements: options.requireRaceSim
      ? deriveSessionRequirements("Prepare for a hilly race", [])
      : deriveSessionRequirements("General cycling fitness", []),
    ftp: 280,
    hrZone2CeilingBpm: 145,
    nutritionByDateAndType: nutritionTable(skeleton),
    warnings: ["existing warning"],
    publication: {
      envelope: { embeddedHardPct: 88, maxIntensityPct: 122, maxEffortMin: 20 },
      events,
      seasonContext: null,
    },
  };
}

function expectExactSchedule(input: DeterministicBlockInput): void {
  const result = compileTrainingBlock(input);
  const slots = input.skeleton.weeks.flatMap((week) => week.days);
  expect(result.plan.days.map((day) => day.date)).toEqual(slots.map((slot) => slot.date));
  expect(result.plan.days.map((day) => day.durationMin)).toEqual(slots.map((slot) => slot.duration.nominalMin));
  for (const target of input.weekTargets) {
    expect(result.plan.days.filter((day) => day.weekNumber === target.weekNumber)
      .reduce((sum, day) => sum + day.durationMin, 0)).toBe(Math.round(target.targetHours * 60));
  }
  for (const day of result.plan.days.filter((candidate) => candidate.type !== "Rest")) {
    expect(parseCyclingPrescription(day.workoutText)).toEqual(result.prescriptions[day.date]);
  }
  expect(result.verdict.blockers).toEqual([]);
}

describe("compileTrainingBlock", () => {
  it("compiles five varied exact block shapes through the public seam", () => {
    const cases: DeterministicBlockInput[] = [
      compilerInput({ lengthWeeks: 2, focus: "threshold", settings: { maxAvailableHours: 9 } }),
      compilerInput({
        lengthWeeks: 4,
        focus: "vo2max",
        recoveryWeekIndices: [2],
        settings: { qualitySessionsPerLoadingWeek: 1 },
      }),
      compilerInput({ lengthWeeks: 6, focus: "anaerobic", settings: { qualitySessionsPerLoadingWeek: 3 } }),
      compilerInput({ lengthWeeks: 2, focus: "vo2max", requireRaceSim: true }),
      compilerInput({
        lengthWeeks: 8,
        focus: "vo2max",
        settings: { targetWeeklyHours: 8, maxAvailableHours: 9, qualitySessionsPerLoadingWeek: 1 },
        events: [{ name: "Local race", date: "2026-09-13", priority: "C" }],
      }),
    ];

    for (const input of cases) expectExactSchedule(input);
  });

  it("keeps a locked Threshold primary on its date and chooses the next temporally compatible complement", () => {
    const result = compileTrainingBlock(compilerInput({ lengthWeeks: 2, focus: "threshold" }));
    const weekOneQuality = result.plan.days
      .filter((day) => day.weekNumber === 1 && ["Threshold", "VO2max", "SIT", "RaceSim"].includes(day.type))
      .map((day) => day.type);

    expect(weekOneQuality).toEqual(["Threshold", "RaceSim"]);
    expect(result.verdict.blockers.some((finding) => finding.startsWith("SEQUENCING:"))).toBe(false);
  });

  it("places required RaceSim once in the first compatible flexible block slot", () => {
    const result = compileTrainingBlock(compilerInput({ lengthWeeks: 4, focus: "vo2max", requireRaceSim: true }));
    const raceDays = result.plan.days.filter((day) => day.type === "RaceSim");
    const firstFlexibleDate = compilerInput({ lengthWeeks: 4, focus: "vo2max", requireRaceSim: true })
      .skeleton.weeks.flatMap((week) => week.days)
      .find((slot) => slot.kind === "quality" && !slot.locked)!.date;

    expect(raceDays).toHaveLength(1);
    expect(raceDays[0].date).toBe(firstFlexibleDate);
  });

  it("keeps a required RaceSim on the first flexible slot when later complements are reordered", () => {
    const input = compilerInput({
      lengthWeeks: 2,
      focus: "anaerobic",
      requireRaceSim: true,
      settings: { qualitySessionsPerLoadingWeek: 3 },
    });
    const firstFlexibleDate = input.skeleton.weeks[0].days
      .find((slot) => slot.kind === "quality" && !slot.locked)!.date;
    const result = compileTrainingBlock(input);

    expect(result.plan.days.find((day) => day.type === "RaceSim")?.date).toBe(firstFlexibleDate);
  });

  it("orders flexible freshness work before tolerant work without moving dates or durations", () => {
    const input = compilerInput({ lengthWeeks: 2, focus: "anaerobic", settings: { qualitySessionsPerLoadingWeek: 3 } });
    const result = compileTrainingBlock(input);
    const qualities = result.plan.days
      .filter((day) => day.weekNumber === 1 && ["Threshold", "VO2max", "SIT", "RaceSim"].includes(day.type));

    expect(qualities.map((day) => day.type)).toEqual(["SIT", "VO2max", "Threshold"]);
    expect(qualities.map((day) => [day.date, day.durationMin])).toEqual(
      input.skeleton.weeks[0].days
        .filter((slot) => slot.kind === "quality")
        .map((slot) => [slot.date, slot.duration.nominalMin])
    );
  });

  it("jointly assigns heterogeneous flexible quality slots without losing a valid stable solution", () => {
    const input = compilerInput({
      lengthWeeks: 2,
      focus: "anaerobic",
      settings: { qualitySessionsPerLoadingWeek: 3 },
    });
    const qualitySlots = input.skeleton.weeks[0].days.filter((slot) => slot.kind === "quality");
    qualitySlots[1].allowedTypes = ["Threshold", "RaceSim"];
    qualitySlots[2].allowedTypes = ["VO2max", "Threshold", "RaceSim"];

    const result = compileTrainingBlock(input);

    expect(result.plan.days
      .filter((day) => day.weekNumber === 1 && ["Threshold", "VO2max", "SIT", "RaceSim"].includes(day.type))
      .map((day) => day.type)).toEqual(["SIT", "Threshold", "RaceSim"]);
  });

  it("uses loading ordinals for stages and does not advance them during recovery", () => {
    const input = compilerInput({
      lengthWeeks: 4,
      focus: "vo2max",
      recoveryWeekIndices: [2],
      settings: { qualitySessionsPerLoadingWeek: 1 },
    });
    const result = compileTrainingBlock(input);
    const primaryNames = result.plan.days
      .filter((day) => day.type === "VO2max")
      .map((day) => day.name);

    expect(primaryNames).toEqual([
      "VO2max — 4×3m @ 110% FTP",
      "VO2max — 5×4m @ 112% FTP",
      "VO2max — 5×5m @ 115% FTP",
    ]);
    const recoveryWeek = result.plan.days.filter((day) => day.weekNumber === 3);
    expect(recoveryWeek.filter((day) => day.type === "Recovery").length).toBeGreaterThan(0);
    expect(recoveryWeek.find((day) => input.skeleton.weeks[2].days.find((slot) => slot.date === day.date)?.kind === "longRide")?.type).toBe("Z2");
    expect(recoveryWeek.some((day) => ["VO2max", "SIT", "RaceSim"].includes(day.type))).toBe(false);
  });

  it("uses the dedicated Threshold touch when a recovery quality slot is compatible", () => {
    const input = compilerInput({ lengthWeeks: 4, focus: "threshold", recoveryWeekIndices: [2] });
    const result = compileTrainingBlock(input);
    const recoveryQualityDate = input.skeleton.weeks[2].days.find((slot) => slot.kind === "quality")!.date;
    const recoveryQuality = result.plan.days.find((day) => day.date === recoveryQualityDate)!;

    expect(recoveryQuality.type).toBe("Threshold");
    expect(recoveryQuality.name).toBe("Threshold — 2×8m @ 90% FTP");
  });

  it("uses HR only for Recovery and pure durability-A Z2", () => {
    const input = compilerInput({ lengthWeeks: 4, focus: "threshold", recoveryWeekIndices: [2] });
    const result = compileTrainingBlock(input);

    for (const day of result.plan.days.filter((candidate) => candidate.type !== "Rest")) {
      const expectedMode = day.type === "Recovery" || day.type === "Z2" ? "heartRate" : "power";
      expect(result.prescriptions[day.date].targetMode).toBe(expectedMode);
    }
  });

  it("emits stable deterministic provenance, sparse findings, and calls the gate once", () => {
    const input = compilerInput({ lengthWeeks: 2, focus: "vo2max", phase: "peak" });
    const gateSpy = vi.spyOn(publicationGate, "evaluatePublicationGate");
    const first = compileTrainingBlock(input);
    const second = compileTrainingBlock(input);

    expect(first.plan.overview).toBe("2-week VO2max Peak");
    expect(first.plan.raw).toBe(second.plan.raw);
    expect(first.plan.days).toEqual(second.plan.days);
    expect(first.plan).not.toHaveProperty("model");
    expect(first.plan).not.toHaveProperty("promptVersion");
    expect(first.plan).not.toHaveProperty("findings");
    expect(JSON.parse(first.plan.raw)).toMatchObject({
      blockParams: input.blockParams,
      focus: "vo2max",
      phase: "peak",
      durabilityTemplateId: "A",
      days: first.plan.days,
      prescriptions: first.prescriptions,
    });
    expect(gateSpy).toHaveBeenCalledTimes(2);
    gateSpy.mockRestore();
  });

  it("throws on missing selected nutrition and locked recovery conflicts", () => {
    const missing = compilerInput({ lengthWeeks: 2, focus: "vo2max" });
    const selected = missing.skeleton.weeks[0].days[0];
    delete missing.nutritionByDateAndType[selected.date]?.Rest;
    expect(() => compileTrainingBlock(missing)).toThrow(
      new BlockCompilationError(`Missing nutrition for ${selected.date} Rest.`)
    );

    const conflict = compilerInput({ lengthWeeks: 4, focus: "vo2max", recoveryWeekIndices: [2] });
    expect(() => compileTrainingBlock(conflict)).toThrow(BlockCompilationError);
  });

  it("throws when a required RaceSim has no compatible flexible loading slot", () => {
    const input = compilerInput({
      lengthWeeks: 2,
      focus: "vo2max",
      requireRaceSim: true,
      settings: { qualitySessionsPerLoadingWeek: 1 },
    });

    expect(() => compileTrainingBlock(input)).toThrow(BlockCompilationError);
  });

  it("reports a protected event that cannot fit its zero-minute slot as a block compilation error", () => {
    const input = compilerInput({
      lengthWeeks: 2,
      focus: "vo2max",
      events: [{ name: "Rest-day race", date: "2026-09-07", priority: "C" }],
    });

    let error: unknown;
    try {
      compileTrainingBlock(input);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BlockCompilationError);
    expect((error as Error).message).toMatch(/2026-09-07 RaceSim.*needs .*min; got 0/);
  });
});
