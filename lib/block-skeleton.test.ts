import { describe, expect, it } from "vitest";
import {
  checkBlockFeasibility,
  computeBlockSkeleton,
  computeWeekTargets,
  validateWeekHours,
  type WeekTarget,
} from "./block-skeleton";
import { DEFAULT_BLOCK_SETTINGS, type BlockSettings, type PlannedDay, type SeasonEvent, type SeasonFocus } from "./types";
import { addDaysIso } from "./date";

function day(date: string, weekNumber: number, durationMin: number): PlannedDay {
  return { date, weekNumber, weekTheme: "t", name: "s", type: "Z2", durationMin, workoutText: "- 1m 60%", description: "x" };
}

describe("checkBlockFeasibility", () => {
  it("passes the population defaults", () => {
    expect(checkBlockFeasibility(DEFAULT_BLOCK_SETTINGS)).toBeNull();
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

  it("rejects a loading target below the minimum realistic content even when availability fits", () => {
    expect(checkBlockFeasibility({ ...DEFAULT_BLOCK_SETTINGS, targetWeeklyHours: 6, maxAvailableHours: 12 }))
      .toMatch(/minimum realistic content.*6h weekly target/i);
  });

  it("rejects a recovery minimum above available time", () => {
    expect(checkBlockFeasibility({
      ...DEFAULT_BLOCK_SETTINGS,
      targetWeeklyHours: 4,
      maxAvailableHours: 4,
      recoveryWeekHoursMin: 6,
      recoveryWeekHoursMax: 8,
    })).toMatch(/recovery.*minimum.*available/i);
  });

  it("flags too many fixed-shape days for a 7-day week", () => {
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, qualitySessionsPerLoadingWeek: 5, restDaysPerWeek: 2 };
    // 5 quality + 1 long ride + 2 rest = 8 > 7
    expect(checkBlockFeasibility(settings)).toMatch(/more than a 7-day week holds/);
  });

  it("flags a weekly target too low for the required content", () => {
    const settings: BlockSettings = {
      ...DEFAULT_BLOCK_SETTINGS,
      targetWeeklyHours: 5,
      maxAvailableHours: 5,
      recoveryWeekHoursMin: 2,
      recoveryWeekHoursMax: 5,
      qualitySessionsPerLoadingWeek: 3,
      longRideDurationMinutes: 180,
    };
    expect(checkBlockFeasibility(settings)).toMatch(/already over the 5h weekly target/);
  });

  it("passes a tight but genuinely feasible configuration", () => {
    // 2 quality (45min floor each) + 1 long ride (180min) + 1 rest + 3 easy days (60min floor each)
    // = 90 + 180 + 180 = 450min = 7.5h, under an 8h ceiling.
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, targetWeeklyHours: 8, maxAvailableHours: 8, qualitySessionsPerLoadingWeek: 2, longRideDurationMinutes: 180, restDaysPerWeek: 1 };
    expect(checkBlockFeasibility(settings)).toBeNull();
  });
});

describe("computeWeekTargets", () => {
  it("targets targetWeeklyHours flat for every non-recovery week", () => {
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, targetWeeklyHours: 12 };
    const targets = computeWeekTargets(3, settings, []);
    expect(targets).toEqual([
      { weekNumber: 1, isRecovery: false, targetHours: 12 },
      { weekNumber: 2, isRecovery: false, targetHours: 12 },
      { weekNumber: 3, isRecovery: false, targetHours: 12 },
    ]);
  });

  it("derives recovery-week depth from the loading target, clamped to the configured band", () => {
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, targetWeeklyHours: 12, recoveryWeekHoursMin: 6, recoveryWeekHoursMax: 9 };
    const targets = computeWeekTargets(4, settings, [3]); // 0-indexed week 3 = weekNumber 4
    expect(targets[3]).toEqual({ weekNumber: 4, isRecovery: true, targetHours: 7.2 }); // 60% of 12h
  });

  it("clamps the derived recovery figure down when the configured max is tighter", () => {
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, targetWeeklyHours: 12, recoveryWeekHoursMin: 6, recoveryWeekHoursMax: 7 };
    const targets = computeWeekTargets(1, settings, [0]);
    expect(targets[0].targetHours).toBe(7); // 60% of 12 = 7.2, clamped down to the 7h ceiling
  });

  it("clamps the derived recovery figure up when the configured min is higher", () => {
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, targetWeeklyHours: 8, recoveryWeekHoursMin: 6, recoveryWeekHoursMax: 9 };
    const targets = computeWeekTargets(1, settings, [0]);
    expect(targets[0].targetHours).toBe(6); // 60% of 8 = 4.8, clamped up to the 6h floor
  });

  it("caps a recovery target to availability when the recovery band starts above it", () => {
    const settings: BlockSettings = {
      ...DEFAULT_BLOCK_SETTINGS,
      targetWeeklyHours: 4,
      maxAvailableHours: 4,
      recoveryWeekHoursMin: 6,
      recoveryWeekHoursMax: 8,
    };
    expect(computeWeekTargets(1, settings, [0])[0].targetHours).toBe(4);
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

  it("locks only the FIRST loading-week quality slot to the block's focus type; later slots stay flexible", () => {
    // DEFAULT_BLOCK_SETTINGS.qualitySessionsPerLoadingWeek is 2 — this is the over-constraint defect:
    // locking BOTH quality slots to the focus type contradicts validatePrimaryQualityCadence (which
    // only requires >=1 focus-type session per loading week), forecloses RaceSim when it does not
    // crowd out the primary, and makes
    // deriveSessionRequirements'/validateSessionRequirements' block-wide >=1-RaceSim floor
    // unsatisfiable when the goal is terrain/race-driven (lib/season.ts, lib/session-requirements.ts).
    const sk = computeBlockSkeleton("2026-08-03", weeks(1), DEFAULT_BLOCK_SETTINGS, "anaerobic", []);
    const q = sk.weeks[0].days.filter((d) => d.kind === "quality");
    expect(q).toHaveLength(2);
    // First slot: locked to the focus type — this structurally guarantees the >=1-per-week floor.
    expect(q[0].allowedTypes).toEqual(["SIT"]);
    expect(q[0].locked).toBe(true);
    // Second slot: flexible across all four quality types, including RaceSim, and NOT locked.
    expect(q[1].allowedTypes).toEqual(["Threshold", "VO2max", "SIT", "RaceSim"]);
    expect(q[1].allowedTypes).toContain("RaceSim");
    expect(q[1].locked).toBe(false);
  });

  it("keeps a recovery week's single quality slot locked to the focus type", () => {
    // A recovery week has at most one quality slot (RECOVERY_QUALITY_CAP); the loading-week
    // second-slot flexibility must not leak into it — the single retained touch stays the primary.
    const sk = computeBlockSkeleton("2026-08-03", weeks(1, [0]), DEFAULT_BLOCK_SETTINGS, "anaerobic", []);
    const q = sk.weeks[0].days.filter((d) => d.kind === "quality");
    expect(q).toHaveLength(1);
    expect(q[0].allowedTypes).toEqual(["SIT"]);
    expect(q[0].locked).toBe(true);
  });

  it("leaves every loading-week quality slot flexible when the focus has no required session type", () => {
    // durability (like aerobic-base/sharpen) has no single required type — focusWorkoutType returns
    // null — so there is no "primary" slot to lock in the first place; every slot stays flexible.
    const sk = computeBlockSkeleton("2026-08-03", weeks(1), DEFAULT_BLOCK_SETTINGS, "durability", []);
    const q = sk.weeks[0].days.filter((d) => d.kind === "quality");
    expect(q).toHaveLength(2);
    for (const slot of q) {
      expect(slot.allowedTypes).toEqual(["Threshold", "VO2max", "SIT", "RaceSim"]);
      expect(slot.locked).toBe(false);
    }
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

  // Supplementary coverage: DEFAULT_BLOCK_SETTINGS' own numbers work out to an easy-day figure
  // comfortably inside the [45,150] clamp band, so none of the tests above ever actually exercise the
  // clamp-and-residual path the brief calls "the whole point." These two force it in each direction.
  // Quality minutes below are type-aware: an `anaerobic` block's locked first slot is SIT (55min, its
  // real protocol length) and its flexible second slot takes the 75min middle figure — 130min total.
  it("clamps easy days DOWN to the ceiling and grows the long ride by exactly what they gave up", () => {
    // easyTotal = 1200 - 180 - 130 = 890min / 3 easy days = ~297min each, over the 150min ceiling.
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, targetWeeklyHours: 20, maxAvailableHours: 20 };
    const target = computeWeekTargets(1, settings, [])[0];
    const sk = computeBlockSkeleton("2026-08-03", [target], settings, "anaerobic", []);
    const days = sk.weeks[0].days;
    const easyDays = days.filter((d) => d.kind === "easy");
    expect(easyDays.map((d) => d.duration.nominalMin)).toEqual([150, 150, 150]);
    // 890 - (3 * 150) = 440min given up by the easy days must land on the long ride: 180 + 440 = 620.
    const longRide = days.find((d) => d.kind === "longRide")!;
    expect(longRide.duration.nominalMin).toBe(620);
    const sum = days.reduce((t, d) => t + d.duration.nominalMin, 0);
    expect(sum).toBe(Math.round(target.targetHours * 60));
  });

  it("clamps easy days UP to the floor and shrinks the long ride by exactly what they took", () => {
    // easyTotal = 360 - 180 - 130 = 50min / 3 easy days = ~17min each, under the 45min floor.
    const settings: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, targetWeeklyHours: 6 };
    const target = computeWeekTargets(1, settings, [])[0];
    const sk = computeBlockSkeleton("2026-08-03", [target], settings, "anaerobic", []);
    const days = sk.weeks[0].days;
    const easyDays = days.filter((d) => d.kind === "easy");
    expect(easyDays.map((d) => d.duration.nominalMin)).toEqual([45, 45, 45]);
    // (3 * 45) - 50 = 85min taken by the easy days must come OFF the long ride: 180 - 85 = 95.
    const longRide = days.find((d) => d.kind === "longRide")!;
    expect(longRide.duration.nominalMin).toBe(95);
    const sum = days.reduce((t, d) => t + d.duration.nominalMin, 0);
    expect(sum).toBe(Math.round(target.targetHours * 60));
  });

  // A quality slot's length is a property of its TYPE. Two live runs flagged the Tuesday SIT slot at
  // 55min against a flat 60-90 range every single week, and the generated session was correct — a
  // 5x30s SIT protocol is ~55min and cannot fill 75 without padding. The slot was mis-sized.
  it("sizes the locked quality slot to its own type's natural length, not a flat figure", () => {
    const nominalFor = (focus: "anaerobic" | "vo2max" | "threshold") =>
      computeBlockSkeleton("2026-08-03", weeks(1), DEFAULT_BLOCK_SETTINGS, focus, [])
        .weeks[0].days.find((d) => d.kind === "quality")!.duration;

    expect(nominalFor("anaerobic").nominalMin).toBe(55); // SIT — the shortest protocol
    expect(nominalFor("vo2max").nominalMin).toBe(75);
    expect(nominalFor("threshold").nominalMin).toBe(80);
    // A real 55min SIT session must now FIT its slot rather than being flagged every week.
    expect(nominalFor("anaerobic").minMin).toBeLessThanOrEqual(55);
    expect(nominalFor("anaerobic").maxMin).toBeGreaterThanOrEqual(55);
  });

  it("widens the flexible quality slot to span every type it allows", () => {
    // The second loading-week slot may legitimately be a ~55min SIT or a ~100min RaceSim; an envelope
    // sized for one middle figure would reject both correct answers.
    const slots = computeBlockSkeleton("2026-08-03", weeks(1), DEFAULT_BLOCK_SETTINGS, "anaerobic", [])
      .weeks[0].days.filter((d) => d.kind === "quality");
    expect(slots).toHaveLength(2);
    const flex = slots[1].duration;
    expect(flex.minMin).toBeLessThanOrEqual(55); // a SIT fits
    expect(flex.maxMin).toBeGreaterThanOrEqual(100); // a RaceSim fits
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

// ---------- Phase B task 1 (2026-07-29 review): exhaustive invariant sweep ----------
// The tests above only ever exercised DEFAULT_BLOCK_SETTINGS (plus two hand-picked clamp cases),
// which missed four Critical/Important defects that a review proved reachable: an event zeroing an
// already-allocated day (C1), the arithmetic reading a *budget* instead of what was actually placed
// when the rest/quality priority lists collide (C2), a Math.max(0, ...) silently discarding a
// negative deficit (I3), and the long ride going negative (I4). Rather than adding four more
// one-off cases, this sweeps the settings space and asserts the two invariants
// computeBlockSkeleton exists to guarantee on every single week produced:
//   1. every slot satisfies 0 <= minMin <= nominalMin <= maxMin
//   2. the week's nominalMin values sum EXACTLY to Math.round(targetHours * 60)
function assertWeekInvariants(sk: ReturnType<typeof computeBlockSkeleton>, label: string, failures: string[]): void {
  for (const week of sk.weeks) {
    let sum = 0;
    for (const day of week.days) {
      const { minMin, nominalMin, maxMin } = day.duration;
      if (!(minMin >= 0 && minMin <= nominalMin && nominalMin <= maxMin)) {
        failures.push(
          `[${label}] week ${week.weekNumber} ${day.date} (${day.kind}): envelope broken — min=${minMin} nominal=${nominalMin} max=${maxMin}`
        );
      }
      sum += nominalMin;
    }
    const target = Math.round(week.targetHours * 60);
    if (sum !== target) {
      failures.push(`[${label}] week ${week.weekNumber}: sum=${sum} target=${target} (diff ${sum - target})`);
    }
  }
}

describe("computeBlockSkeleton invariants — exhaustive settings sweep", () => {
  // Every dimension called out in the brief, using its own suggested extremes. Deliberately NOT
  // filtered through checkBlockFeasibility first — this function's contract does not state "assumes
  // pre-validated settings" as a precondition, so the sweep includes combinations feasibility would
  // reject (that's exactly how I3 and I4 were reproduced) as well as ones it passes (C2's shape).
  const MAX_AVAILABLE_HOURS = [2, 6, 10, 12, 20, 30];
  const LONG_RIDE_MIN = [10, 120, 180, 300];
  const REST_DAYS = [0, 1, 2, 3];
  const QUALITY_SESSIONS = [0, 1, 2, 3, 4];
  const BLOCK_LENGTHS = [2, 4, 8];
  const RECOVERY_PRESENT = [false, true];
  const FOCI: SeasonFocus[] = ["anaerobic", "durability"]; // required-type vs. no-required-type

  it("holds for every combination in the matrix (no events)", () => {
    const failures: string[] = [];
    let combos = 0;
    for (const [ceilingIndex, maxAvailableHours] of MAX_AVAILABLE_HOURS.entries()) {
      // Reuse the original sweep's target values while covering both target=ceiling and target<ceiling.
      const lowerTarget = MAX_AVAILABLE_HOURS[Math.max(0, ceilingIndex - 1)];
      for (const targetWeeklyHours of [maxAvailableHours, lowerTarget]) {
        for (const longRideDurationMinutes of LONG_RIDE_MIN) {
          for (const restDaysPerWeek of REST_DAYS) {
            for (const qualitySessionsPerLoadingWeek of QUALITY_SESSIONS) {
              for (const lengthWeeks of BLOCK_LENGTHS) {
                for (const recoveryPresent of RECOVERY_PRESENT) {
                  for (const focus of FOCI) {
                    combos++;
                    // recoveryWeekHoursMin/Max relaxed to [0, maxAvailableHours] so a low ceiling
                    // extreme actually propagates into the recovery week's target too, instead of being
                    // floor-clamped back up by the population-default recovery band.
                    const settings: BlockSettings = {
                      ...DEFAULT_BLOCK_SETTINGS,
                      targetWeeklyHours,
                      maxAvailableHours,
                      longRideDurationMinutes,
                      restDaysPerWeek,
                      qualitySessionsPerLoadingWeek,
                      recoveryWeekHoursMin: 0,
                      recoveryWeekHoursMax: maxAvailableHours,
                    };
                    const recoveryIdx = recoveryPresent ? [lengthWeeks - 1] : [];
                    const targets = computeWeekTargets(lengthWeeks, settings, recoveryIdx);
                    const sk = computeBlockSkeleton("2026-08-03", targets, settings, focus, []);
                    assertWeekInvariants(
                      sk,
                      `target=${targetWeeklyHours} ceiling=${maxAvailableHours} ride=${longRideDurationMinutes} rest=${restDaysPerWeek} q=${qualitySessionsPerLoadingWeek} len=${lengthWeeks} rec=${recoveryPresent} focus=${focus}`,
                      failures
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
    // 6 * 2 * 4 * 4 * 5 * 3 * 2 * 2 = 11520 settings combinations, each producing 2/4/8 weeks.
    expect(combos).toBe(MAX_AVAILABLE_HOURS.length * 2 * LONG_RIDE_MIN.length * REST_DAYS.length * QUALITY_SESSIONS.length * BLOCK_LENGTHS.length * RECOVERY_PRESENT.length * FOCI.length);
    if (failures.length > 0) {
      throw new Error(`${failures.length} invariant violation(s) across ${combos} combos (showing up to 25):\n${failures.slice(0, 25).join("\n")}`);
    }
  });
});

describe("computeBlockSkeleton invariants — events on every day (C1 sweep)", () => {
  // A few settings shapes layered onto the day-of-week x recovery sweep: the population default, the
  // C2 priority-collision shape, and the I3/I4 tiny-hours-vs-long-long-ride shape — so an event
  // interacting with any of those three defect shapes at once is also covered, not just in isolation.
  const SETTINGS_VARIANTS: { label: string; settings: BlockSettings }[] = [
    { label: "default", settings: DEFAULT_BLOCK_SETTINGS },
    { label: "C2 collision shape", settings: { ...DEFAULT_BLOCK_SETTINGS, restDaysPerWeek: 2, qualitySessionsPerLoadingWeek: 3 } },
    { label: "I3/I4 overshoot shape", settings: { ...DEFAULT_BLOCK_SETTINGS, targetWeeklyHours: 2, maxAvailableHours: 2, longRideDurationMinutes: 10 } },
  ];

  it("an event on each of the seven days, loading and recovery, holds both invariants for every settings shape", () => {
    const failures: string[] = [];
    for (const { label, settings } of SETTINGS_VARIANTS) {
      for (const recovery of [false, true]) {
        const targets = computeWeekTargets(1, settings, recovery ? [0] : []);
        for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
          const date = addDaysIso("2026-08-03", dayIdx);
          const events: SeasonEvent[] = [{ name: "Event", date, priority: "B" }];
          const sk = computeBlockSkeleton("2026-08-03", targets, settings, "anaerobic", events);
          assertWeekInvariants(sk, `${label} recovery=${recovery} eventDay=${dayIdx}`, failures);
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(`${failures.length} invariant violation(s):\n${failures.slice(0, 25).join("\n")}`);
    }
  });

  it("two events in one week holds both invariants", () => {
    const failures: string[] = [];
    const targets = computeWeekTargets(1, DEFAULT_BLOCK_SETTINGS, []);
    const events: SeasonEvent[] = [
      { name: "E1", date: addDaysIso("2026-08-03", 1), priority: "B" },
      { name: "E2", date: addDaysIso("2026-08-03", 5), priority: "A" },
    ];
    const sk = computeBlockSkeleton("2026-08-03", targets, DEFAULT_BLOCK_SETTINGS, "anaerobic", events);
    assertWeekInvariants(sk, "two events in one week", failures);
    if (failures.length > 0) throw new Error(failures.join("\n"));
  });

  it("C1 repro: an event on the canonical Saturday long-ride day still sums the week to target", () => {
    const targets = computeWeekTargets(1, DEFAULT_BLOCK_SETTINGS, []);
    const events: SeasonEvent[] = [{ name: "KOM Race", date: "2026-08-08", priority: "A" }]; // Saturday = index 5
    const sk = computeBlockSkeleton("2026-08-03", targets, DEFAULT_BLOCK_SETTINGS, "anaerobic", events);
    const days = sk.weeks[0].days;
    const sum = days.reduce((t, d) => t + d.duration.nominalMin, 0);
    expect(sum).toBe(Math.round(targets[0].targetHours * 60));
    const ev = days.find((d) => d.date === "2026-08-08")!;
    expect(ev.kind).toBe("event");
    expect(ev.duration.nominalMin).toBeGreaterThan(0); // C1: used to be 0, silently losing this day's minutes
  });

  it("C1 repro: an event on a quality day still sums the week to target", () => {
    const targets = computeWeekTargets(1, DEFAULT_BLOCK_SETTINGS, []);
    const events: SeasonEvent[] = [{ name: "Crit", date: "2026-08-04", priority: "B" }]; // Tuesday = index 1 (quality)
    const sk = computeBlockSkeleton("2026-08-03", targets, DEFAULT_BLOCK_SETTINGS, "anaerobic", events);
    const days = sk.weeks[0].days;
    const sum = days.reduce((t, d) => t + d.duration.nominalMin, 0);
    expect(sum).toBe(Math.round(targets[0].targetHours * 60));
    const ev = days.find((d) => d.date === "2026-08-04")!;
    expect(ev.duration.nominalMin).toBeGreaterThan(0);
  });
});
