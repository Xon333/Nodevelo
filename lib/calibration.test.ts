import { describe, expect, it } from "vitest";
import { autoEwmaAlpha, confidenceFromN, defaultParameter, DEFAULT_ACWR_BANDS, emptyCalibration, isAcwrBandsOverridden, resolveAcwrBands, resolveCalibratedValue } from "./calibration";
import type { CalibratedParameter } from "./types";

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

describe("confidenceFromN", () => {
  it("escalates with sample size and is defensive", () => {
    expect(confidenceFromN(0)).toBe("low");
    expect(confidenceFromN(7)).toBe("low");
    expect(confidenceFromN(8)).toBe("medium");
    expect(confidenceFromN(19)).toBe("medium");
    expect(confidenceFromN(20)).toBe("high");
    expect(confidenceFromN(NaN)).toBe("low");
  });
});

describe("resolveCalibratedValue", () => {
  const param = (o: Partial<CalibratedParameter>): CalibratedParameter => ({ ...defaultParameter(), ...o });
  const FALLBACK = 4;

  it("falls back to the population default when there is no parameter or it's still a default", () => {
    expect(resolveCalibratedValue(undefined, FALLBACK)).toBe(FALLBACK);
    expect(resolveCalibratedValue(null, FALLBACK)).toBe(FALLBACK);
    expect(resolveCalibratedValue(defaultParameter(), FALLBACK)).toBe(FALLBACK);
  });

  it("uses a derived value only once it's trustworthy (locked or ≥ medium confidence)", () => {
    expect(resolveCalibratedValue(param({ source: "derived", value: 6, confidence: "low" }), FALLBACK)).toBe(FALLBACK); // not trusted yet
    expect(resolveCalibratedValue(param({ source: "derived", value: 6, confidence: "medium" }), FALLBACK)).toBe(6);
    expect(resolveCalibratedValue(param({ source: "derived", value: 6, confidence: "low", locked: true }), FALLBACK)).toBe(6);
  });

  it("lets a manual override win regardless of confidence, and ignores non-finite values", () => {
    expect(resolveCalibratedValue(param({ source: "derived", value: 6, confidence: "high", manualOverride: 9 }), FALLBACK)).toBe(9);
    expect(resolveCalibratedValue(param({ source: "derived", value: NaN, confidence: "high" }), FALLBACK)).toBe(FALLBACK); // never returns NaN
  });
});

describe("emptyCalibration", () => {
  it("starts every parameter at its population default (resolves to the fallback)", () => {
    const cal = emptyCalibration();
    expect(cal.decouplingGood.source).toBe("default");
    expect(resolveCalibratedValue(cal.decouplingGood, 4)).toBe(4);
  });
});
