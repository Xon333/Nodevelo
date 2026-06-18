import { describe, expect, it } from "vitest";
import { efSeries, mondayOf, weeklyEnergy } from "./trends";
import type { ActivitySummary, WellnessEntry } from "./types";

const act = (over: Partial<ActivitySummary>): ActivitySummary => ({
  id: "1",
  date: "2026-06-01",
  type: "Ride",
  name: "Ride",
  movingTimeSec: 60 * 60,
  avgWatts: 200,
  normalizedPower: 205,
  maxWatts: 400,
  avgHr: 140,
  maxHr: 175,
  kj: 700,
  trainingLoad: 60,
  rpe: null,
  decoupling: null,
  efficiencyFactor: null,
  description: null,
  avgCadence: null,
  distanceMeters: null,
  elevationGain: null,
  powerZoneTimes: null,
  hrZoneTimes: null,
  ...over,
});
const well = (over: Partial<WellnessEntry>): WellnessEntry => ({
  date: "2026-06-01",
  weightKg: null,
  hrv: null,
  sleepHours: null,
  sleepQuality: null,
  kcalConsumed: null,
  ctl: null,
  atl: null,
  ...over,
});

describe("efSeries (TRENDS-1)", () => {
  const ftp = 300; // endurance band 168–255W

  it("excludes indoor VirtualRide rides", () => {
    const out = efSeries(
      [
        act({ date: "2026-06-01", type: "Ride", normalizedPower: 200, avgHr: 140 }),
        act({ date: "2026-06-02", type: "VirtualRide", normalizedPower: 200, avgHr: 150 }),
      ],
      ftp
    );
    expect(out.map((e) => e.date)).toEqual(["2026-06-01"]); // VirtualRide dropped
  });

  it("excludes rides under 45 min and outside the endurance band", () => {
    const out = efSeries(
      [
        act({ date: "2026-06-01", movingTimeSec: 30 * 60 }), // too short
        act({ date: "2026-06-02", normalizedPower: 280 }), // too hard (>0.85 FTP)
        act({ date: "2026-06-03", avgHr: 0 }), // no HR
        act({ date: "2026-06-04", normalizedPower: 200, avgHr: 140 }), // ✓
      ],
      ftp
    );
    expect(out.map((e) => e.date)).toEqual(["2026-06-04"]);
  });

  it("prefers Intervals.icu efficiencyFactor, falling back to NP/HR", () => {
    const out = efSeries(
      [
        act({ date: "2026-06-01", efficiencyFactor: 1.55, normalizedPower: 200, avgHr: 140 }),
        act({ date: "2026-06-02", efficiencyFactor: null, normalizedPower: 210, avgHr: 140 }),
      ],
      ftp
    );
    expect(out[0].value).toBe(1.55);
    expect(out[1].value).toBe(1.5); // 210/140
  });
});

describe("weeklyEnergy (TRENDS-2)", () => {
  // Weeks (Mondays): 2026-06-01 (complete), 2026-06-08 (complete), 2026-06-15 = current.
  const today = "2026-06-18"; // a Thursday in the week of Mon 2026-06-15

  it("drops the in-progress current week, keeping complete weeks", () => {
    const out = weeklyEnergy(
      [
        act({ date: "2026-06-02", kj: 500 }), // wk of 06-01
        act({ date: "2026-06-09", kj: 600 }), // wk of 06-08
        act({ date: "2026-06-16", kj: 400 }), // current wk 06-15 — dropped
      ],
      [],
      today
    );
    expect(out.map((e) => e.date)).toEqual(["2026-06-01", "2026-06-08"]);
    expect(out.find((e) => e.date === "2026-06-15")).toBeUndefined();
  });

  it("sums burn + intake and takes the median weekly weight", () => {
    const out = weeklyEnergy(
      [
        act({ date: "2026-06-01", kj: 500 }),
        act({ date: "2026-06-03", kj: 700 }),
      ],
      [
        well({ date: "2026-06-01", kcalConsumed: 2000, weightKg: 70 }),
        well({ date: "2026-06-02", kcalConsumed: 2500, weightKg: 71 }),
        well({ date: "2026-06-03", kcalConsumed: 1800, weightKg: 72 }),
      ],
      today
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ date: "2026-06-01", burnKcal: 1200, intakeKcal: 6300, weightKg: 71 });
  });
});

describe("mondayOf", () => {
  it("snaps any day to its ISO-week Monday", () => {
    expect(mondayOf("2026-06-18")).toBe("2026-06-15"); // Thu → Mon
    expect(mondayOf("2026-06-15")).toBe("2026-06-15"); // Mon → Mon
    expect(mondayOf("2026-06-21")).toBe("2026-06-15"); // Sun → that week's Mon
  });
});
