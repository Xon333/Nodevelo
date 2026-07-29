import { describe, expect, it } from "vitest";
import { checkBlockFeasibility, computeBlockSkeleton, computeWeekTargets, formatWeekTargets, validateWeekHours, type WeekTarget } from "./block-skeleton";
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

  // Supplementary coverage: DEFAULT_BLOCK_SETTINGS' own numbers (12h loading week, 2×75min quality,
  // 180min long ride, 1 rest day, 3 easy days) work out to exactly 130min/easy day — comfortably
  // inside the [45,150] clamp band, so none of the tests above ever actually exercise the
  // clamp-and-residual path the brief calls "the whole point." These two force it in each direction.
  it("clamps easy days DOWN to the ceiling and grows the long ride by exactly what they gave up", () => {
    // easyTotal = 1200 - 180 - 150 = 870min / 3 easy days = 290min each, over the 150min ceiling.
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, weeklyHoursMax: 20 };
    const target = computeWeekTargets(1, settings, [])[0];
    const sk = computeBlockSkeleton("2026-08-03", [target], settings, "anaerobic", []);
    const days = sk.weeks[0].days;
    const easyDays = days.filter((d) => d.kind === "easy");
    expect(easyDays.map((d) => d.duration.nominalMin)).toEqual([150, 150, 150]);
    // 3 * (290 - 150) = 420min given up by the easy days must land on the long ride: 180 + 420 = 600.
    const longRide = days.find((d) => d.kind === "longRide")!;
    expect(longRide.duration.nominalMin).toBe(600);
    const sum = days.reduce((t, d) => t + d.duration.nominalMin, 0);
    expect(sum).toBe(Math.round(target.targetHours * 60));
  });

  it("clamps easy days UP to the floor and shrinks the long ride by exactly what they took", () => {
    // easyTotal = 360 - 180 - 150 = 30min / 3 easy days = 10min each, under the 45min floor.
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, weeklyHoursMax: 6 };
    const target = computeWeekTargets(1, settings, [])[0];
    const sk = computeBlockSkeleton("2026-08-03", [target], settings, "anaerobic", []);
    const days = sk.weeks[0].days;
    const easyDays = days.filter((d) => d.kind === "easy");
    expect(easyDays.map((d) => d.duration.nominalMin)).toEqual([45, 45, 45]);
    // 3 * (45 - 10) = 105min taken by the easy days must come OFF the long ride: 180 - 105 = 75.
    const longRide = days.find((d) => d.kind === "longRide")!;
    expect(longRide.duration.nominalMin).toBe(75);
    const sum = days.reduce((t, d) => t + d.duration.nominalMin, 0);
    expect(sum).toBe(Math.round(target.targetHours * 60));
  });

  it("maps each required-type focus to its own quality session type (not a neighbour's)", () => {
    const t = computeBlockSkeleton("2026-08-03", weeks(1), DEFAULT_BLOCK_SETTINGS, "threshold", []);
    const v = computeBlockSkeleton("2026-08-03", weeks(1), DEFAULT_BLOCK_SETTINGS, "vo2max", []);
    expect(t.weeks[0].days.find((d) => d.kind === "quality")!.allowedTypes).toEqual(["Threshold"]);
    expect(v.weeks[0].days.find((d) => d.kind === "quality")!.allowedTypes).toEqual(["VO2max"]);
  });

  it("caps a recovery week's quality budget at RECOVERY_QUALITY_CAP even when more sessions are configured", () => {
    // qualitySessionsPerLoadingWeek: 3 means (sessions - 1) = 2, which must still be capped down to 1.
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, qualitySessionsPerLoadingWeek: 3 };
    const sk = computeBlockSkeleton("2026-08-03", computeWeekTargets(1, settings, [0]), settings, "anaerobic", []);
    expect(sk.weeks[0].qualityBudget).toBe(1);
  });
});
