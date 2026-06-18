import { describe, expect, it } from "vitest";
import { detectPowerPRs, meanMax, prDurationLabel } from "./pr";
import type { PowerCurvePoint } from "./types";

const curve = (over: Record<number, number>): PowerCurvePoint[] =>
  Object.entries(over).map(([durationSec, watts]) => ({ durationSec: Number(durationSec), watts }));

describe("meanMax", () => {
  it("finds the best average over any window", () => {
    expect(meanMax([100, 100, 400, 400, 100], 2)).toBe(400); // the 400,400 window
    expect(meanMax([100, 200, 300], 3)).toBe(200);
  });
  it("returns null when the stream is shorter than the window", () => {
    expect(meanMax([100, 200], 5)).toBeNull();
  });
});

describe("detectPowerPRs", () => {
  it("flags durations where this ride beat the prior best", () => {
    // 30 samples at 350W → 5s/15s/30s mean-max = 350.
    const stream = Array.from({ length: 30 }, () => 350);
    const prs = detectPowerPRs(stream, curve({ 5: 300, 15: 320, 30: 360, 60: 400 }));
    // 5s (350>300) and 15s (350>320) are PRs; 30s (350<360) is not; 60s has no data in stream.
    expect(prs.map((p) => p.durationSec)).toEqual([5, 15]);
    expect(prs[0]).toEqual({ durationSec: 5, watts: 350, prevWatts: 300 });
  });

  it("returns nothing when there is no prior curve (first sync)", () => {
    expect(detectPowerPRs(Array.from({ length: 30 }, () => 350), [])).toEqual([]);
  });

  it("ignores durations longer than the ride and zero baselines", () => {
    const stream = Array.from({ length: 10 }, () => 500);
    const prs = detectPowerPRs(stream, curve({ 5: 0, 300: 250 }));
    expect(prs).toEqual([]); // 5s baseline is 0 (skipped); 300s longer than the 10-sample ride
  });
});

describe("prDurationLabel", () => {
  it("formats sub-minute as seconds and the rest as minutes", () => {
    expect(prDurationLabel(5)).toBe("5s");
    expect(prDurationLabel(30)).toBe("30s");
    expect(prDurationLabel(60)).toBe("1 min");
    expect(prDurationLabel(1200)).toBe("20 min");
  });
});
