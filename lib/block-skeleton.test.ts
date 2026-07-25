import { describe, expect, it } from "vitest";
import { checkBlockFeasibility, computeWeekTargets, formatWeekTargets, validateWeekHours, type WeekTarget } from "./block-skeleton";
import { DEFAULT_BLOCK_SETTINGS, type BlockSettings, type PlannedDay } from "./types";

function day(date: string, weekNumber: number, durationMin: number): PlannedDay {
  return { date, weekNumber, weekTheme: "t", name: "s", type: "Z2", durationMin, workoutText: "- 1m 60%", description: "x" };
}

describe("checkBlockFeasibility", () => {
  it("passes the population defaults", () => {
    expect(checkBlockFeasibility(DEFAULT_BLOCK_SETTINGS)).toBeNull();
  });

  it("flags weeklyHoursMin greater than weeklyHoursMax", () => {
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, weeklyHoursMin: 13, weeklyHoursMax: 12 };
    expect(checkBlockFeasibility(settings)).toMatch(/weeklyHoursMin.*greater than weeklyHoursMax/);
  });

  it("flags too many fixed-shape days for a 7-day week", () => {
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, qualitySessionsPerLoadingWeek: 5, restDaysPerWeek: 2 };
    // 5 quality + 1 long ride + 2 rest = 8 > 7
    expect(checkBlockFeasibility(settings)).toMatch(/more than a 7-day week holds/);
  });

  it("flags a weekly hour ceiling too low for the required content", () => {
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, weeklyHoursMax: 5, weeklyHoursMin: 4, qualitySessionsPerLoadingWeek: 3, longRideDurationMinutes: 180 };
    expect(checkBlockFeasibility(settings)).toMatch(/already over the 5h weekly ceiling/);
  });

  it("passes a tight but genuinely feasible configuration", () => {
    // 2 quality (45min floor each) + 1 long ride (180min) + 1 rest + 3 easy days (60min floor each)
    // = 90 + 180 + 180 = 450min = 7.5h, under an 8h ceiling.
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, weeklyHoursMax: 8, weeklyHoursMin: 6, qualitySessionsPerLoadingWeek: 2, longRideDurationMinutes: 180, restDaysPerWeek: 1 };
    expect(checkBlockFeasibility(settings)).toBeNull();
  });
});

describe("computeWeekTargets", () => {
  it("targets weeklyHoursMax flat for every non-recovery week", () => {
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, weeklyHoursMax: 12 };
    const targets = computeWeekTargets(3, settings, []);
    expect(targets).toEqual([
      { weekNumber: 1, isRecovery: false, targetHours: 12 },
      { weekNumber: 2, isRecovery: false, targetHours: 12 },
      { weekNumber: 3, isRecovery: false, targetHours: 12 },
    ]);
  });

  it("derives recovery-week depth from the loading target, clamped to the configured band", () => {
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, weeklyHoursMax: 12, recoveryWeekHoursMin: 6, recoveryWeekHoursMax: 9 };
    const targets = computeWeekTargets(4, settings, [3]); // 0-indexed week 3 = weekNumber 4
    expect(targets[3]).toEqual({ weekNumber: 4, isRecovery: true, targetHours: 7.2 }); // 60% of 12h
  });

  it("clamps the derived recovery figure down when the configured max is tighter", () => {
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, weeklyHoursMax: 12, recoveryWeekHoursMin: 6, recoveryWeekHoursMax: 7 };
    const targets = computeWeekTargets(1, settings, [0]);
    expect(targets[0].targetHours).toBe(7); // 60% of 12 = 7.2, clamped down to the 7h ceiling
  });

  it("clamps the derived recovery figure up when the configured min is higher", () => {
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, weeklyHoursMax: 8, recoveryWeekHoursMin: 6, recoveryWeekHoursMax: 9 };
    const targets = computeWeekTargets(1, settings, [0]);
    expect(targets[0].targetHours).toBe(6); // 60% of 8 = 4.8, clamped up to the 6h floor
  });
});

describe("formatWeekTargets", () => {
  it("renders one exact figure per week, labelled loading/recovery", () => {
    const targets: WeekTarget[] = [
      { weekNumber: 1, isRecovery: false, targetHours: 12 },
      { weekNumber: 2, isRecovery: true, targetHours: 7 },
    ];
    const text = formatWeekTargets(targets);
    expect(text).toContain("Week 1 (LOADING): target 12h total");
    expect(text).toContain("Week 2 (RECOVERY): target 7h total");
    expect(text).not.toMatch(/\d+–\d+h/); // no ranges anywhere
  });
});

describe("validateWeekHours", () => {
  const targets: WeekTarget[] = [{ weekNumber: 1, isRecovery: false, targetHours: 12 }];

  it("passes within tolerance", () => {
    const days = [day("2026-07-27", 1, 12 * 60 - 20)]; // 20min under, inside the 30min tolerance
    expect(validateWeekHours(days, targets)).toEqual([]);
  });

  it("flags an undershoot beyond tolerance", () => {
    const days = [day("2026-07-27", 1, 9 * 60 + 23)]; // 9h23 — the real reviewed-block defect
    const w = validateWeekHours(days, targets);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/HOURS: week 1 \(loading\) totals 9\.4h — under its 12h target by 2\.6h/);
  });

  it("flags an overshoot beyond tolerance too", () => {
    const days = [day("2026-07-27", 1, 14 * 60)];
    const w = validateWeekHours(days, targets);
    expect(w[0]).toMatch(/over its 12h target/);
  });

  it("treats a week with no generated days as a full shortfall", () => {
    const w = validateWeekHours([], targets);
    expect(w[0]).toMatch(/totals 0h — under its 12h target by 12h/);
  });
});
