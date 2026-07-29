import { describe, expect, it } from "vitest";
import { validateEventTaper, validateRecoveryWeekDensity, validateSchedule, validateWeekSequencing } from "./schedule-validate";
import { DEFAULT_BLOCK_SETTINGS, type BlockSettings, type PlannedDay, type SeasonEvent, type WorkoutType } from "./types";

// Budget of 2 quality sessions/loading week (the default).
const SETTINGS: BlockSettings = { ...DEFAULT_BLOCK_SETTINGS, qualitySessionsPerLoadingWeek: 2 };

function day(date: string, type: WorkoutType, weekNumber = 1): PlannedDay {
  return {
    date,
    weekNumber,
    weekTheme: "test",
    name: `${type} session`,
    type,
    durationMin: type === "Rest" ? 0 : 60,
    workoutText: type === "Rest" ? "" : "- 60m 80%",
    description: "x",
  };
}

describe("validateSchedule — back-to-back hard days", () => {
  it("flags two quality sessions on consecutive dates", () => {
    const w = validateSchedule([day("2026-06-20", "Threshold"), day("2026-06-21", "VO2max")], SETTINGS, 250);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/back-to-back hard days/);
    expect(w[0]).toMatch(/Threshold on 2026-06-20 then VO2max on 2026-06-21/);
  });

  it("counts RaceSim as a hard day", () => {
    const w = validateSchedule([day("2026-06-20", "SIT"), day("2026-06-21", "RaceSim")], SETTINGS, 250);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/back-to-back hard days/);
  });

  it("passes when a rest day separates two quality sessions", () => {
    const w = validateSchedule(
      [day("2026-06-20", "Threshold"), day("2026-06-21", "Rest"), day("2026-06-22", "VO2max")],
      SETTINGS, 250
    );
    expect(w).toEqual([]);
  });

  it("does not treat Z2/Recovery/Strength as hard", () => {
    const w = validateSchedule(
      [day("2026-06-20", "Strength"), day("2026-06-21", "Threshold"), day("2026-06-22", "Z2")],
      SETTINGS, 250
    );
    expect(w).toEqual([]);
  });

  it("treats a durability Z2 ride with embedded threshold work as a hard day (CR-1)", () => {
    const durability: PlannedDay = {
      date: "2026-06-20", weekNumber: 1, weekTheme: "t", name: "Durability", type: "Z2",
      durationMin: 240, workoutText: "Main Set 3x\n- 12m 95%\n- 6m 60%", description: "x",
    };
    const w = validateSchedule([durability, day("2026-06-21", "VO2max")], SETTINGS, 250);
    expect(w.some((m) => /back-to-back hard days/.test(m))).toBe(true);
    expect(w.some((m) => /embedded intensity/.test(m))).toBe(true);
  });

  it("uses the athlete's durability-envelope override for the embedded-intensity floor (CAL-3)", () => {
    // A 92% embedded block: hard at the 88% population floor, not hard once the athlete raises it to 95%.
    // validatePlanProtocol already honours the resolved envelope — this keeps validateSchedule consistent.
    const durability: PlannedDay = {
      date: "2026-06-20", weekNumber: 1, weekTheme: "t", name: "Durability", type: "Z2",
      durationMin: 240, workoutText: "Main Set 3x\n- 12m 92%\n- 6m 60%", description: "x",
    };
    const pair = [durability, day("2026-06-21", "VO2max")];
    expect(validateSchedule(pair, SETTINGS, 250).some((m) => /embedded intensity/.test(m))).toBe(true);
    const raised: BlockSettings = { ...SETTINGS, durabilityInsertEnvelope: { embeddedHardPct: 95, maxIntensityPct: 122, maxEffortMin: 20 } };
    expect(validateSchedule(pair, raised, 250).some((m) => /embedded intensity/.test(m))).toBe(false);
  });

  it("leaves a plain Z2 ride (no embedded intensity) easy next to a quality day", () => {
    expect(validateSchedule([day("2026-06-20", "Z2"), day("2026-06-21", "VO2max")], SETTINGS, 250)).toEqual([]);
  });

  it("does not pair quality days that are two calendar days apart", () => {
    // Same array positions, but a gap in dates (a missing day) must not false-flag.
    const w = validateSchedule([day("2026-06-20", "Threshold"), day("2026-06-22", "VO2max")], SETTINGS, 250);
    expect(w).toEqual([]);
  });

  it("catches a back-to-back pair across the week boundary (Sat → Sun)", () => {
    const w = validateSchedule(
      [day("2026-06-20", "VO2max", 1), day("2026-06-21", "SIT", 2)],
      SETTINGS, 250
    );
    expect(w.some((m) => /back-to-back/.test(m))).toBe(true);
  });
});

describe("validateSchedule — weekly quality budget", () => {
  it("flags a week with more quality sessions than the budget", () => {
    const w = validateSchedule(
      [
        day("2026-06-15", "Threshold", 1),
        day("2026-06-17", "VO2max", 1),
        day("2026-06-19", "SIT", 1),
      ],
      SETTINGS, 250
    );
    const budget = w.find((m) => /over the 2\/week budget for a loading week/.test(m));
    expect(budget).toBeDefined();
    expect(budget).toMatch(/week 1 has 3 quality sessions/);
  });

  it("passes a week exactly at budget", () => {
    const w = validateSchedule(
      [day("2026-06-15", "Threshold", 1), day("2026-06-17", "VO2max", 1)],
      SETTINGS, 250
    );
    expect(w.some((m) => /budget/.test(m))).toBe(false);
  });

  it("does not flag a recovery week that sits under budget", () => {
    const w = validateSchedule([day("2026-07-06", "Threshold", 4)], SETTINGS, 250);
    expect(w).toEqual([]);
  });
});

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

describe("validateSchedule — edges", () => {
  it("returns [] for an empty block", () => {
    expect(validateSchedule([], SETTINGS, 250)).toEqual([]);
  });

  it("returns [] for an all-easy week", () => {
    const w = validateSchedule(
      [day("2026-06-15", "Z2"), day("2026-06-16", "Recovery"), day("2026-06-17", "Rest")],
      SETTINGS, 250
    );
    expect(w).toEqual([]);
  });
});

// P4 (2026-07-24 block-generation redesign): a lightweight taper tier for priority-B/C events.
describe("validateEventTaper — B/C-event taper protection", () => {
  const kom = (): SeasonEvent => ({ name: "Prepih-Vahta KOM Attempt", date: "2026-08-02", priority: "B" });

  it("flags a quality session 1 day before the event", () => {
    const days = [day("2026-08-01", "RaceSim"), day("2026-08-02", "RaceSim")];
    const w = validateEventTaper(days, [kom()], 250, DEFAULT_BLOCK_SETTINGS);
    expect(w.some((m) => /EVENT TAPER/.test(m) && /1 day before/.test(m))).toBe(true);
  });

  it("flags a quality session 2 days before the event", () => {
    const days = [day("2026-07-31", "Threshold"), day("2026-08-01", "Z2"), day("2026-08-02", "RaceSim")];
    const w = validateEventTaper(days, [kom()], 250, DEFAULT_BLOCK_SETTINGS);
    expect(w.some((m) => /EVENT TAPER/.test(m) && /2 days before/.test(m))).toBe(true);
  });

  it("passes when the 2 days before are easy/rest", () => {
    const days = [day("2026-07-31", "Z2"), day("2026-08-01", "Rest"), day("2026-08-02", "RaceSim")];
    expect(validateEventTaper(days, [kom()], 250, DEFAULT_BLOCK_SETTINGS)).toEqual([]);
  });

  it("does not count the event's own session toward the week's quality cap", () => {
    // Only the event-day RaceSim is quality this week — fine, that's the point of the event.
    const days = [day("2026-07-27", "Rest", 1), day("2026-08-02", "RaceSim", 1)];
    expect(validateEventTaper(days, [kom()], 250, DEFAULT_BLOCK_SETTINGS)).toEqual([]);
  });

  it("flags more than 1 other quality session in the event's own week", () => {
    const days = [
      day("2026-07-28", "Threshold", 1),
      day("2026-07-30", "SIT", 1),
      day("2026-08-02", "RaceSim", 1),
    ];
    const w = validateEventTaper(days, [kom()], 250, DEFAULT_BLOCK_SETTINGS);
    expect(w.some((m) => /EVENT TAPER/.test(m) && /other quality session/.test(m))).toBe(true);
  });

  it("passes at exactly 1 other quality session in the event's week", () => {
    const days = [day("2026-07-28", "Threshold", 1), day("2026-08-02", "RaceSim", 1)];
    expect(validateEventTaper(days, [kom()], 250, DEFAULT_BLOCK_SETTINGS)).toEqual([]);
  });

  it("ignores priority-A events entirely (they get the full backward-scheduled arc elsewhere)", () => {
    const days = [day("2026-08-01", "RaceSim"), day("2026-08-02", "RaceSim")];
    const aEvent: SeasonEvent = { ...kom(), priority: "A" };
    expect(validateEventTaper(days, [aEvent], 250, DEFAULT_BLOCK_SETTINGS)).toEqual([]);
  });

  it("ignores an event whose date falls outside this block's own generated days", () => {
    const days = [day("2026-08-01", "RaceSim"), day("2026-08-02", "RaceSim")];
    const laterEvent: SeasonEvent = { ...kom(), date: "2026-09-15" };
    expect(validateEventTaper(days, [laterEvent], 250, DEFAULT_BLOCK_SETTINGS)).toEqual([]);
  });

  it("returns [] for no days or no events", () => {
    expect(validateEventTaper([], [kom()], 250, DEFAULT_BLOCK_SETTINGS)).toEqual([]);
    expect(validateEventTaper([day("2026-08-02", "RaceSim")], [], 250, DEFAULT_BLOCK_SETTINGS)).toEqual([]);
  });
});

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

// P5b (2026-07-24 block-generation redesign): freshness-dependent quality (VO2max/SIT) should land
// earlier in the week than fatigue-tolerant quality (Threshold/RaceSim).
describe("validateWeekSequencing — freshness-priority ordering (P5b)", () => {
  it("flags Threshold landing before SIT in the same week — the pattern every live smoke test has shown", () => {
    const days = [day("2026-07-28", "Threshold", 1), day("2026-07-30", "SIT", 1)];
    const w = validateWeekSequencing(days);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/SEQUENCING: week 1/);
    expect(w[0]).toMatch(/Threshold on 2026-07-28 lands before SIT on 2026-07-30/);
  });

  it("flags Threshold before VO2max the same way", () => {
    const days = [day("2026-07-28", "Threshold", 1), day("2026-07-30", "VO2max", 1)];
    expect(validateWeekSequencing(days)).toHaveLength(1);
  });

  it("flags RaceSim before SIT too (both fatigue-tolerant vs freshness-priority)", () => {
    const days = [day("2026-07-28", "RaceSim", 1), day("2026-07-30", "SIT", 1)];
    expect(validateWeekSequencing(days)).toHaveLength(1);
  });

  it("passes when the freshness-priority session lands first", () => {
    const days = [day("2026-07-28", "SIT", 1), day("2026-07-30", "Threshold", 1)];
    expect(validateWeekSequencing(days)).toEqual([]);
  });

  it("passes a week with only one quality type — nothing to sequence", () => {
    expect(validateWeekSequencing([day("2026-07-28", "Threshold", 1), day("2026-07-30", "Z2", 1)])).toEqual([]);
  });

  it("ignores durability-template embedded efforts — only standalone quality types count", () => {
    // A Z2 day (even a long durability-template ride) is never a standalone quality type for this check.
    const days = [day("2026-07-28", "Z2", 1), day("2026-07-30", "SIT", 1)];
    expect(validateWeekSequencing(days)).toEqual([]);
  });

  it("checks each week independently", () => {
    const days = [
      day("2026-07-28", "SIT", 1), day("2026-07-30", "Threshold", 1), // week 1: correct order
      day("2026-08-04", "Threshold", 2), day("2026-08-06", "VO2max", 2), // week 2: backwards
    ];
    const w = validateWeekSequencing(days);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/week 2/);
  });

  it("returns [] for an empty block", () => {
    expect(validateWeekSequencing([])).toEqual([]);
  });
});

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

  // Fix 1 (2026-07-29 whole-branch review, season.ts formatRecoveryWeeks): a durability-focus block's
  // COMPOSITION instruction used to ask for a "durability-loaded Z2 (embedded threshold+ work)"
  // session as the recovery week's one surviving quality session — a plan that followed that
  // instruction literally still tripped this validator's embedded-intensity check below, because the
  // Z2 ride carrying the embedded work isn't the long ride but isn't quality-typed either. This is the
  // integration check: a durability recovery week that instead follows the FIXED instruction (zero
  // quality sessions, zero embedded work anywhere, an unbroken long Z2 ride) must produce no warning.
  it("a durability-focus recovery week that follows the fixed 'no quality at all' instruction produces no warning", () => {
    const days: PlannedDay[] = [
      { date: "2026-06-20", weekNumber: 1, weekTheme: "t", name: "Long Z2", type: "Z2", durationMin: 180, workoutText: "- 180m 65%", description: "x" },
      { date: "2026-06-21", weekNumber: 1, weekTheme: "t", name: "Recovery spin", type: "Recovery", durationMin: 45, workoutText: "- 45m 55%", description: "x" },
      { date: "2026-06-22", weekNumber: 1, weekTheme: "t", name: "Rest", type: "Rest", durationMin: 0, workoutText: "", description: "x" },
    ];
    expect(validateRecoveryWeekDensity(days, target, DEFAULT_BLOCK_SETTINGS, 250, [])).toEqual([]);
  });
});
