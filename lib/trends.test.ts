import { describe, expect, it } from "vitest";
import { efSeries, hrrcSeries, latestWeeklyBalance, mondayOf, weeklyEnergy } from "./trends";
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
  icuFtp: null,
  powerHrZ2: null,
  powerHrZ2Mins: null,
  avgHr: 140,
  maxHr: 175,
  kj: 700,
  trainingLoad: 60,
  rpe: null,
  carbsIngestedG: null,
  decoupling: null,
  efficiencyFactor: null,
  description: null,
  avgCadence: null,
  distanceMeters: null,
  elevationGain: null,
  powerZoneTimes: null,
  hrZoneTimes: null,
  hrrc: null,
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

describe("hrrcSeries", () => {
  it("returns outdoor rides with a non-null HRRc, sorted by date", () => {
    const activities = [
      { date: "2026-06-20", type: "Ride", hrrc: 22 } as any,
      { date: "2026-06-10", type: "Ride", hrrc: 30 } as any,
      { date: "2026-06-15", type: "Ride", hrrc: null } as any, // no qualifying effort
      { date: "2026-06-18", type: "VirtualRide", hrrc: 25 } as any, // indoor — excluded
    ];
    const series = hrrcSeries(activities);
    expect(series).toEqual([
      { date: "2026-06-10", value: 30 },
      { date: "2026-06-20", value: 22 },
    ]);
  });
  it("returns [] when no rides qualify", () => {
    expect(hrrcSeries([])).toEqual([]);
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
    expect(out[0]).toEqual({
      date: "2026-06-01",
      burnKcal: 1200,
      intakeKcal: 6300,
      weightKg: 71,
      needKcal: null,
      ratio: null,
      loggedDays: 0,
    });
  });
});

describe("weeklyEnergy balance columns", () => {
  const settings = { baseCalories: 2000, restDayTarget: 2600, buffer: 300, targetWeightKg: 70 };
  // Week Mon 2026-06-22 … Sun 2026-06-28; today Wed 2026-07-01 → that week is complete.
  const wellness = [
    // 5 logged-intake days (2500 each), 2 unlogged (null)
    { date: "2026-06-22", kcalConsumed: 2500 }, // rest day
    { date: "2026-06-23", kcalConsumed: 2500 }, // ride day (1000 kJ)
    { date: "2026-06-24", kcalConsumed: null },
    { date: "2026-06-25", kcalConsumed: 2500 }, // rest day
    { date: "2026-06-26", kcalConsumed: 2500 }, // ride day (1500 kJ)
    { date: "2026-06-27", kcalConsumed: null }, // ride day 800 kJ — UNLOGGED, must not enter need
    { date: "2026-06-28", kcalConsumed: 2500 }, // rest day
  ].map((w) => well(w));
  const activities = [
    { date: "2026-06-23", kj: 1000 },
    { date: "2026-06-26", kj: 1500 },
    { date: "2026-06-27", kj: 800 },
  ].map((a) => act(a));

  it("computes need day-matched to logged-intake days and the ratio", () => {
    const [week] = weeklyEnergy(activities, wellness, "2026-07-01", settings);
    // need = 3 rest days × 2600 + (2000+1000+300) + (2000+1500+300) = 7800 + 3300 + 3800 = 14900
    expect(week.needKcal).toBe(14900);
    expect(week.loggedDays).toBe(5);
    // intake = 5 × 2500 = 12500 → ratio 12500/14900 = 0.8389… → 0.84
    expect(week.ratio).toBe(0.84);
  });

  it("withholds the ratio below 4 logged days and without settings", () => {
    const thin = wellness.map((w, i) => (i > 2 ? { ...w, kcalConsumed: null } : w)); // 2 logged
    expect(weeklyEnergy(activities, thin, "2026-07-01", settings)[0].ratio).toBeNull();
    expect(weeklyEnergy(activities, wellness, "2026-07-01")[0].ratio).toBeNull();
  });
});

describe("latestWeeklyBalance", () => {
  it("returns the immediately-prior complete week only", () => {
    const pts = [
      { date: "2026-06-15", burnKcal: 1, intakeKcal: 1, weightKg: null, needKcal: 14000, ratio: 0.95, loggedDays: 6 },
      { date: "2026-06-22", burnKcal: 1, intakeKcal: 12500, weightKg: null, needKcal: 14900, ratio: 0.84, loggedDays: 5 },
    ];
    expect(latestWeeklyBalance(pts, "2026-07-01")).toEqual({
      weekOf: "2026-06-22", intakeKcal: 12500, needKcal: 14900, ratio: 0.84, loggedDays: 5,
    });
    // Prior week under-logged (ratio null) → withheld, NOT the older week substituted
    const gap = [pts[0], { ...pts[1], ratio: null }];
    expect(latestWeeklyBalance(gap, "2026-07-01")).toBeNull();
  });
});

describe("mondayOf", () => {
  it("snaps any day to its ISO-week Monday", () => {
    expect(mondayOf("2026-06-18")).toBe("2026-06-15"); // Thu → Mon
    expect(mondayOf("2026-06-15")).toBe("2026-06-15"); // Mon → Mon
    expect(mondayOf("2026-06-21")).toBe("2026-06-15"); // Sun → that week's Mon
  });
});
