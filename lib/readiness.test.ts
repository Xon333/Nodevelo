import { describe, expect, it } from "vitest";
import { computeLoadRamp } from "./readiness";

// Build a date `n` days ago in YYYY-MM-DD (local), matching computeLoadRamp's basis.
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

describe("computeLoadRamp", () => {
  it("does not fire when the prior week is below the noise floor", () => {
    const activities = [
      { date: daysAgo(1), trainingLoad: 200 }, // this week
      { date: daysAgo(9), trainingLoad: 50 }, // last week, under floor
    ];
    const r = computeLoadRamp(activities);
    expect(r.triggered).toBe(false);
    expect(r.changePct).toBeNull();
  });

  it("does not fire when load is flat week-over-week", () => {
    const activities = [
      { date: daysAgo(1), trainingLoad: 200 },
      { date: daysAgo(3), trainingLoad: 100 }, // this week total 300
      { date: daysAgo(8), trainingLoad: 200 },
      { date: daysAgo(10), trainingLoad: 100 }, // last week total 300
    ];
    const r = computeLoadRamp(activities);
    expect(r.triggered).toBe(false);
    expect(r.changePct).toBe(0);
  });

  it("raises a caution between 10% and 30%", () => {
    const activities = [
      { date: daysAgo(1), trainingLoad: 250 }, // this week 250
      { date: daysAgo(9), trainingLoad: 200 }, // last week 200 → +25%
    ];
    const r = computeLoadRamp(activities);
    expect(r.triggered).toBe(true);
    expect(r.level).toBe("caution");
    expect(r.changePct).toBe(25);
  });

  it("raises a high alert above 30%", () => {
    const activities = [
      { date: daysAgo(2), trainingLoad: 400 }, // this week 400
      { date: daysAgo(9), trainingLoad: 200 }, // last week 200 → +100%
    ];
    const r = computeLoadRamp(activities);
    expect(r.triggered).toBe(true);
    expect(r.level).toBe("high");
    expect(r.changePct).toBe(100);
  });

  it("ignores activities with null training load", () => {
    const activities = [
      { date: daysAgo(1), trainingLoad: null },
      { date: daysAgo(9), trainingLoad: 200 },
    ];
    const r = computeLoadRamp(activities);
    expect(r.thisWeekTss).toBe(0);
    expect(r.lastWeekTss).toBe(200);
  });
});
