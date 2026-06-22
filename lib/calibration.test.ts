import { describe, expect, it } from "vitest";
import { autoEwmaAlpha, confidenceFromN, defaultParameter, DEFAULT_ACWR_BANDS, DEFAULT_POWER_ZONE_TOPS_PCT, deriveDecouplingGood, deriveIfBandOffsets, emptyCalibration, isAcwrBandsOverridden, resolveAcwrBands, resolveCalibratedValue } from "./calibration";
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

describe("deriveDecouplingGood", () => {
  it("stays a population default with no data", () => {
    const p = deriveDecouplingGood(undefined, null, 0);
    expect(p.source).toBe("default");
    expect(resolveCalibratedValue(p, 4)).toBe(4);
  });

  it("derives from the 90-day mean with sample-size confidence (never auto-locks)", () => {
    const p = deriveDecouplingGood(undefined, 6, 25);
    expect(p).toMatchObject({ source: "derived", value: 6, confidence: "high", locked: false, dataPoints: 25 });
    expect(resolveCalibratedValue(p, 4)).toBe(6);

    const low = deriveDecouplingGood(undefined, 6, 5);
    expect(low.confidence).toBe("low");
    expect(resolveCalibratedValue(low, 4)).toBe(4); // not enough data yet → population default
  });

  it("clamps a silly window to a sane cutoff", () => {
    expect(deriveDecouplingGood(undefined, 0.2, 30).value).toBe(2.5);
    expect(deriveDecouplingGood(undefined, 99, 30).value).toBe(8);
  });

  it("keeps adapting to the rolling window instead of freezing (CR-E)", () => {
    const high = deriveDecouplingGood(undefined, 6, 25); // high confidence, value 6
    // A fitter athlete's window drops to 3 — the cutoff must follow, not stay stuck at 6.
    const next = deriveDecouplingGood(high, 3, 40);
    expect(next.value).toBe(3);
    expect(resolveCalibratedValue(next, 4)).toBe(3);
  });

  it("keeps the last derived value when a window carries no new signal (no jitter to default)", () => {
    const high = deriveDecouplingGood(undefined, 6, 25);
    const gap = deriveDecouplingGood(high, null, 0); // a window with no decoupling readings
    expect(gap.value).toBe(6);
    expect(gap.source).toBe("derived");
    expect(resolveCalibratedValue(gap, 4)).toBe(6);
  });

  it("preserves a manual override across re-derivation", () => {
    const high = deriveDecouplingGood(undefined, 6, 25);
    const next = deriveDecouplingGood({ ...high, manualOverride: 5 }, 3, 40);
    expect(next.manualOverride).toBe(5);
    expect(resolveCalibratedValue(next, 4)).toBe(5); // manual override still wins at resolve
  });
});

describe("deriveIfBandOffsets (ROADMAP #2 — per-type IF cutoffs)", () => {
  it("returns no offsets for default power zones (identical scoring guarantee)", () => {
    expect(deriveIfBandOffsets(DEFAULT_POWER_ZONE_TOPS_PCT)).toEqual({});
  });

  it("returns no offsets for missing/empty zones", () => {
    expect(deriveIfBandOffsets([])).toEqual({});
    expect(deriveIfBandOffsets(undefined as unknown as number[])).toEqual({});
  });

  it("shifts a type's bands when its anchoring zone edge deviates", () => {
    // Threshold anchors to the Z4 top (index 3, default 105). A 110% Z4 top → +0.05.
    const zones = [55, 75, 90, 110, 120, 150];
    expect(deriveIfBandOffsets(zones)).toEqual({ Threshold: 0.05 });
  });

  it("ignores deviations inside the deadband (≈ noise / near-default)", () => {
    // Z2 top 76 vs default 75 → 0.01 < 0.02 deadband → omitted.
    expect(deriveIfBandOffsets([55, 76, 90, 105, 120, 150])).toEqual({});
  });

  it("clamps a wildly customised zone set to a bounded shift", () => {
    // Z5 top 150 vs default 120 → raw +0.30, clamped to +0.08.
    expect(deriveIfBandOffsets([55, 75, 90, 105, 150, 180]).VO2max).toBe(0.08);
  });

  it("shifts down for a lower-than-default zone edge", () => {
    // Z2 top 70 vs default 75 → -0.05.
    expect(deriveIfBandOffsets([55, 70, 90, 105, 120, 150])).toEqual({ Z2: -0.05 });
  });
});
