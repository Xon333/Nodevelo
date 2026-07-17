import { describe, expect, it } from "vitest";
import { clamp, median, round1, round2, toleranceBand } from "./stats";

describe("stats helpers", () => {
  it("round1 / round2 round to 1 / 2 decimals", () => {
    expect(round1(10.06)).toBe(10.1);
    expect(round2(1.2349)).toBe(1.23);
  });

  it("clamp bounds to [lo, hi]", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("median handles odd and even lengths without mutating the input", () => {
    const xs = [3, 1, 2];
    expect(median(xs)).toBe(2); // odd → middle of sorted
    expect(xs).toEqual([3, 1, 2]); // unchanged
    expect(median([4, 1, 3, 2])).toBe(2.5); // even → mean of the two middles
    expect(median([-30])).toBe(-30);
  });

  it("toleranceBand (HR-30) returns whichever is more lenient — the relative % or the absolute floor", () => {
    expect(toleranceBand(90, 0.15, 8)).toBe(13.5); // relative (13.5) beats the 8 floor
    expect(toleranceBand(10, 0.15, 8)).toBe(8); // floor (8) beats the 1.5 relative
    expect(toleranceBand(2000, 0.18, 300)).toBe(360); // relative (360) beats the 300 floor
    expect(toleranceBand(500, 0.18, 300)).toBe(300); // floor (300) beats the 90 relative
  });
});
