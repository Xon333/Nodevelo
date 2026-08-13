import { describe, expect, it } from "vitest";
import { addDaysIso } from "./date";
import { classifyWeekTolerance, resolveWeeklyEnvelope } from "./weekly-envelope";
import type { ActivitySummary, RideScoreEntry, WellnessEntry } from "./types";

const entry = (over: Partial<RideScoreEntry> = {}): RideScoreEntry => ({
  date: "2026-07-06",
  executionScore: 6,
  plannedType: "Z2",
  inferredType: "Z2",
  planned: true,
  legacy: false,
  compliancePct: 95,
  intensityFactor: 0.65,
  ftpUsed: 280,
  durationMin: 90,
  tss: 60,
  ...over,
});

const wellness = (date: string, ctl: number | null, atl: number | null): WellnessEntry => ({
  date,
  weightKg: null,
  hrv: null,
  sleepHours: null,
  sleepQuality: null,
  kcalConsumed: null,
  ctl,
  atl,
});

describe("classifyWeekTolerance", () => {
  it("tolerated: no compromised rides, no deep-fatigue read in the days after", () => {
    const entries = [entry({ date: "2026-07-06" }), entry({ date: "2026-07-08" })];
    // TSB = ctl - atl = 60 - 50 = 10, comfortably above deep-fatigue territory
    const w = [wellness("2026-07-13", 60, 50), wellness("2026-07-14", 61, 49)];
    expect(
      classifyWeekTolerance({ weekStart: "2026-07-06", weekEnd: "2026-07-12", entries, wellness: w })
    ).toBe("tolerated");
  });

  it("not-tolerated: a compromised ride inside the week", () => {
    // Two rides so the week clears MIN_RIDES_TO_CLASSIFY — the compromised flag on just one of them
    // still flags the whole week, it isn't diluted by the other ride being fine.
    const entries = [entry({ date: "2026-07-06", compromised: true }), entry({ date: "2026-07-08" })];
    const w = [wellness("2026-07-13", 60, 50)];
    expect(
      classifyWeekTolerance({ weekStart: "2026-07-06", weekEnd: "2026-07-12", entries, wellness: w })
    ).toBe("not-tolerated");
  });

  it("not-tolerated: deep fatigue in the days immediately after the week", () => {
    const entries = [entry({ date: "2026-07-06" }), entry({ date: "2026-07-08" })];
    // TSB = 40 - 70 = -30, deep-fatigue territory (computeReadiness's Recover band)
    const w = [wellness("2026-07-13", 40, 70)];
    expect(
      classifyWeekTolerance({ weekStart: "2026-07-06", weekEnd: "2026-07-12", entries, wellness: w })
    ).toBe("not-tolerated");
  });

  it("unknown: no rides synced for the week at all — never guessed tolerated", () => {
    expect(
      classifyWeekTolerance({
        weekStart: "2026-07-06",
        weekEnd: "2026-07-12",
        entries: [],
        wellness: [wellness("2026-07-13", 60, 50)],
      })
    ).toBe("unknown");
  });

  it("unknown: no post-week wellness data to read recovery from", () => {
    const entries = [entry({ date: "2026-07-06" }), entry({ date: "2026-07-08" })];
    expect(
      classifyWeekTolerance({ weekStart: "2026-07-06", weekEnd: "2026-07-12", entries, wellness: [] })
    ).toBe("unknown");
  });
});

const activity = (date: string, trainingLoad: number): ActivitySummary => ({
  id: `act-${date}`,
  date,
  type: "Ride",
  name: "Ride",
  movingTimeSec: 3600,
  avgWatts: 200,
  normalizedPower: null,
  maxWatts: null,
  icuFtp: null,
  avgHr: null,
  maxHr: null,
  kj: null,
  activeBurnKcal: null,
  trainingLoad,
  rpe: null,
  carbsIngestedG: null,
  decoupling: null,
  efficiencyFactor: null,
  powerHrZ2: null,
  powerHrZ2Mins: null,
  description: null,
  avgCadence: null,
  distanceMeters: null,
  elevationGain: null,
  powerZoneTimes: null,
  hrZoneTimes: null,
  wPrimeRollingJ: null,
  wBalDepletionJ: null,
  hrrc: null,
});

describe("resolveWeeklyEnvelope", () => {
  // n "tolerated" weeks (two rides each, ~325 TSS/ride via canonical trainingLoad, ~650/week), oldest first.
  const weeksOfData = (n: number, mondayOfCurrentWeek: string) => {
    const activities: ActivitySummary[] = [];
    const entries: RideScoreEntry[] = [];
    const w: WellnessEntry[] = [];
    let cursor = mondayOfCurrentWeek;
    for (let i = 0; i < n; i++) {
      cursor = addDaysIso(cursor, -7);
      const d1 = cursor;
      const d2 = addDaysIso(cursor, 2);
      activities.push(activity(d1, 325), activity(d2, 325));
      entries.push(entry({ date: d1 }), entry({ date: d2 }));
      w.push(wellness(addDaysIso(cursor, 8), 60, 45));
    }
    return { activities, entries, wellness: w };
  };

  it("Monday recompute: no persisted envelope yet resolves a fresh one for the current week", () => {
    const { activities, entries, wellness: w } = weeksOfData(7, "2026-08-10");
    const result = resolveWeeklyEnvelope({ today: "2026-08-10", persisted: null, activities, entries, wellness: w });
    expect(result.envelope.weekStart).toBe("2026-08-10");
    expect(result.envelope.previousRange).toBeNull();
    expect(result.wrote).toBe(true);
    expect(result.envelope.role).toBe("build");
  });

  it("non-Monday sync with no new reducing evidence reads the persisted value unchanged", () => {
    const persisted = {
      weekStart: "2026-08-10",
      role: "build" as const,
      range: { min: 600, max: 700 },
      previousRange: null,
      reductionApplied: false,
      reductionReason: null,
      calculationVersion: 1,
      resolvedAt: "2026-08-10T06:00:00.000Z",
    };
    const result = resolveWeeklyEnvelope({ today: "2026-08-12", persisted, activities: [], entries: [], wellness: [] });
    expect(result.envelope).toEqual(persisted);
    expect(result.wrote).toBe(false);
  });

  it("midweek: a not-tolerated recent week can only lower the range, never raise it", () => {
    const persisted = {
      weekStart: "2026-08-10",
      role: "build" as const,
      range: { min: 600, max: 700 },
      previousRange: null,
      reductionApplied: false,
      reductionReason: null,
      calculationVersion: 1,
      resolvedAt: "2026-08-10T06:00:00.000Z",
    };
    const { activities, entries } = weeksOfData(3, "2026-08-10");
    const w = [wellness(addDaysIso("2026-07-27", 8), 40, 70)]; // deep-fatigue read for the Jul27 week
    const result = resolveWeeklyEnvelope({ today: "2026-08-11", persisted, activities, entries, wellness: w });
    expect(result.envelope.range.max).toBeLessThanOrEqual(persisted.range.max);
    expect(result.envelope.range.min).toBeLessThanOrEqual(persisted.range.min);
    if (result.wrote) {
      expect(result.envelope.previousRange).toEqual(persisted.range);
      expect(result.envelope.reductionApplied).toBe(true);
    }
  });

  it("never raises an already-persisted range mid-week, even if this sync's fresh calc would be higher", () => {
    const persisted = {
      weekStart: "2026-08-10",
      role: "build" as const,
      range: { min: 600, max: 700 },
      previousRange: null,
      reductionApplied: false,
      reductionReason: null,
      calculationVersion: 1,
      resolvedAt: "2026-08-10T06:00:00.000Z",
    };
    const { activities, entries, wellness: w } = weeksOfData(8, "2026-08-10");
    const result = resolveWeeklyEnvelope({ today: "2026-08-11", persisted, activities, entries, wellness: w });
    expect(result.envelope.range.max).toBeLessThanOrEqual(700);
    expect(result.envelope.range.min).toBeLessThanOrEqual(600);
  });
});
