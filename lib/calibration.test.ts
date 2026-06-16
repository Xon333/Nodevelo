import { describe, expect, it } from "vitest";
import { autoEwmaAlpha, DEFAULT_ACWR_BANDS, isAcwrBandsOverridden, resolveAcwrBands } from "./calibration";

describe("autoEwmaAlpha", () => {
  it("is more responsive with little history and smoother as it accumulates", () => {
    expect(autoEwmaAlpha(0)).toBe(0.45);
    expect(autoEwmaAlpha(4)).toBe(0.45);
    expect(autoEwmaAlpha(8)).toBe(0.38);
    expect(autoEwmaAlpha(20)).toBe(0.3);
  });

  it("is defensive against bad input", () => {
    expect(autoEwmaAlpha(-5)).toBe(0.45);
    expect(autoEwmaAlpha(NaN)).toBe(0.45);
  });
});

describe("resolveAcwrBands", () => {
  it("returns population defaults with no override", () => {
    expect(resolveAcwrBands()).toEqual(DEFAULT_ACWR_BANDS);
    expect(resolveAcwrBands(null)).toEqual(DEFAULT_ACWR_BANDS);
  });

  it("merges a partial override onto the defaults", () => {
    expect(resolveAcwrBands({ dangerHigh: 1.4 })).toEqual({ optimalLow: 0.8, optimalHigh: 1.3, dangerHigh: 1.4 });
  });

  it("enforces strict ordering when an override collapses the bands", () => {
    const b = resolveAcwrBands({ optimalLow: 1.5, optimalHigh: 1.0, dangerHigh: 0.9 });
    expect(b.optimalHigh).toBeGreaterThan(b.optimalLow);
    expect(b.dangerHigh).toBeGreaterThan(b.optimalHigh);
  });

  it("ignores non-finite values and clamps to sane ranges", () => {
    const b = resolveAcwrBands({ optimalLow: Number.NaN, dangerHigh: 99 });
    expect(b.optimalLow).toBe(DEFAULT_ACWR_BANDS.optimalLow);
    expect(b.dangerHigh).toBeLessThanOrEqual(4);
  });
});

describe("isAcwrBandsOverridden", () => {
  it("detects a real override vs none", () => {
    expect(isAcwrBandsOverridden(null)).toBe(false);
    expect(isAcwrBandsOverridden({})).toBe(false);
    expect(isAcwrBandsOverridden({ dangerHigh: 1.4 })).toBe(true);
  });
});
