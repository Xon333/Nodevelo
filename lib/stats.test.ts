import { describe, expect, it } from "vitest";
import { clamp, median, round1, round2 } from "./stats";

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
});
