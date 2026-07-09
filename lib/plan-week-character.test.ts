import { describe, expect, it } from "vitest";
import { weekCharacters } from "./plan-week-character";

describe("weekCharacters", () => {
  it("labels a classic ramp+deload block: load → build → peak → taper", () => {
    // avg = 330; peak week = index 2 (420); final week (240) is below avg → taper.
    expect(weekCharacters([300, 360, 420, 240])).toEqual(["load", "build", "peak", "taper"]);
  });

  it("does not label the final week 'taper' when it is the block's biggest week", () => {
    // avg = 300; peak = final week (400) which is >= avg → 'peak', not 'taper'.
    expect(weekCharacters([200, 300, 400])).toEqual(["load", "build", "peak"]);
  });

  it("handles a flat block deterministically (first week reads peak, rest build)", () => {
    // all equal → nothing is below avg; peakIdx defaults to 0.
    expect(weekCharacters([300, 300, 300])).toEqual(["peak", "build", "build"]);
  });

  it("returns a single 'peak' for a one-week block and [] for empty", () => {
    expect(weekCharacters([200])).toEqual(["peak"]);
    expect(weekCharacters([])).toEqual([]);
  });
});
