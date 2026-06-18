import { describe, expect, it } from "vitest";
import { detectPowerPRs, prDurationLabel } from "./pr";
import type { PowerCurvePoint } from "./types";

const curve = (over: Record<number, number>): PowerCurvePoint[] =>
  Object.entries(over).map(([durationSec, watts]) => ({ durationSec: Number(durationSec), watts }));

describe("detectPowerPRs", () => {
  it("flags durations where the fresh curve beat the previous sync's curve, with the true delta", () => {
    const prev = curve({ 5: 700, 30: 600, 60: 500, 300: 340 });
    const cur = curve({ 5: 740, 30: 626, 60: 500, 300: 335 });
    const prs = detectPowerPRs(prev.length ? cur : [], prev);
    // 5s (+40) and 30s (+26) rose; 60s unchanged; 300s dropped → not PRs.
    expect(prs).toEqual([
      { durationSec: 5, watts: 740, prevWatts: 700 },
      { durationSec: 30, watts: 626, prevWatts: 600 },
    ]);
  });

  it("does NOT flag an unchanged curve (re-sync) — no fake +1W PRs", () => {
    const c = curve({ 5: 739, 30: 626, 60: 507 });
    expect(detectPowerPRs(c, c)).toEqual([]);
  });

  it("returns nothing when there's no prior curve (first sync) or no current curve", () => {
    expect(detectPowerPRs(curve({ 5: 740 }), [])).toEqual([]);
    expect(detectPowerPRs([], curve({ 5: 700 }))).toEqual([]);
  });

  it("ignores zero/absent baselines and durations missing from the current curve", () => {
    const prs = detectPowerPRs(curve({ 5: 740 }), curve({ 5: 0, 30: 600 }));
    expect(prs).toEqual([]); // 5s baseline is 0 (skipped); 30s absent from current curve
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
