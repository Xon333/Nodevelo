import { describe, expect, it } from "vitest";
import { autoEwmaAlpha, confidenceFromN, defaultParameter, DEFAULT_ACWR_BANDS, DEFAULT_ATHLETE_STATE_WEIGHTS, DEFAULT_DURABILITY_INSERT_ENVELOPE, DEFAULT_POWER_ZONE_TOPS_PCT, DEFAULT_STRAIN_BANDS, DEFAULT_TSB_MODIFIER_EDGES, deriveDecouplingGood, deriveIfBandOffsets, deriveTsbDeepFatigue, emptyCalibration, isAcwrBandsOverridden, isAthleteStateWeightsOverridden, isDurabilityInsertEnvelopeOverridden, isStrainBandsOverridden, isTsbModifierEdgesOverridden, resolveAcwrBands, resolveAthleteStateWeights, resolveCalibratedValue, resolveDurabilityInsertEnvelope, resolveStrainBands, resolveTsbEdgesOverride, resolveTsbModifierEdges } from "./calibration";
import type { CalibratedParameter, RideScoreEntry } from "./types";

// Minimal quality-session ledger entry with a stamped TSB, for the deep-fatigue derivation tests.
function qEntry(tsb: number, executionScore: number, over: Partial<RideScoreEntry> = {}): RideScoreEntry {
  return {
    date: "2026-01-01",
    executionScore,
    plannedType: "VO2max",
    inferredType: "VO2max",
    planned: true,
    legacy: false,
    compliancePct: 100,
    intensityFactor: 1.0,
    ftpUsed: 250,
    durationMin: 60,
    tss: 80,
    formState: { tsb, ctl: 50, atl: 50 - tsb },
    ...over,
  };
}

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

describe("resolveTsbModifierEdges (ROADMAP #2 — TSB adaptation window)", () => {
  it("returns population defaults with no override", () => {
    expect(resolveTsbModifierEdges()).toEqual(DEFAULT_TSB_MODIFIER_EDGES);
    expect(resolveTsbModifierEdges(null)).toEqual(DEFAULT_TSB_MODIFIER_EDGES);
    expect(resolveTsbModifierEdges({})).toEqual(DEFAULT_TSB_MODIFIER_EDGES);
  });

  it("merges a partial override onto the defaults", () => {
    expect(resolveTsbModifierEdges({ deepFatigue: -30 })).toEqual({ deepFatigue: -30, productiveOverload: -10, balanced: 5 });
  });

  it("enforces strict ascending order when an override collapses the bands", () => {
    const e = resolveTsbModifierEdges({ deepFatigue: -5, productiveOverload: -20, balanced: -30 });
    expect(e.productiveOverload).toBeGreaterThan(e.deepFatigue);
    expect(e.balanced).toBeGreaterThan(e.productiveOverload);
  });

  it("ignores non-finite values and clamps to a sane TSB range", () => {
    const e = resolveTsbModifierEdges({ deepFatigue: Number.NaN, balanced: 999 });
    expect(e.deepFatigue).toBe(DEFAULT_TSB_MODIFIER_EDGES.deepFatigue);
    expect(e.balanced).toBeLessThanOrEqual(30);
  });
});

describe("isTsbModifierEdgesOverridden", () => {
  it("detects a real override vs none", () => {
    expect(isTsbModifierEdgesOverridden(null)).toBe(false);
    expect(isTsbModifierEdgesOverridden({})).toBe(false);
    expect(isTsbModifierEdgesOverridden({ deepFatigue: -30 })).toBe(true);
  });
});

describe("resolveStrainBands (ROADMAP #2 — morning-check strain)", () => {
  it("returns population defaults with no override", () => {
    expect(resolveStrainBands()).toEqual(DEFAULT_STRAIN_BANDS);
    expect(resolveStrainBands(null)).toEqual(DEFAULT_STRAIN_BANDS);
    expect(resolveStrainBands({})).toEqual(DEFAULT_STRAIN_BANDS);
  });

  it("merges a partial override onto the defaults", () => {
    expect(resolveStrainBands({ high: 17 })).toEqual({ high: 17, med: 12 });
  });

  it("keeps high above med when an override inverts them", () => {
    const b = resolveStrainBands({ high: 10, med: 14 });
    expect(b.med).toBeLessThan(b.high);
  });

  it("ignores non-finite values and clamps to strain's 4–20 range", () => {
    const b = resolveStrainBands({ high: Number.NaN, med: 99 });
    expect(b.high).toBe(DEFAULT_STRAIN_BANDS.high);
    expect(b.med).toBeLessThan(b.high);
    expect(b.med).toBeGreaterThanOrEqual(4);
  });
});

describe("isStrainBandsOverridden", () => {
  it("detects a real override vs none", () => {
    expect(isStrainBandsOverridden(null)).toBe(false);
    expect(isStrainBandsOverridden({})).toBe(false);
    expect(isStrainBandsOverridden({ high: 17 })).toBe(true);
  });
});

describe("resolveDurabilityInsertEnvelope (ROADMAP #2 — durability inserts)", () => {
  it("returns population defaults with no override", () => {
    expect(resolveDurabilityInsertEnvelope()).toEqual(DEFAULT_DURABILITY_INSERT_ENVELOPE);
    expect(resolveDurabilityInsertEnvelope(null)).toEqual(DEFAULT_DURABILITY_INSERT_ENVELOPE);
    expect(resolveDurabilityInsertEnvelope({})).toEqual(DEFAULT_DURABILITY_INSERT_ENVELOPE);
  });

  it("merges a partial override onto the defaults", () => {
    expect(resolveDurabilityInsertEnvelope({ maxEffortMin: 15 })).toEqual({ embeddedHardPct: 88, maxIntensityPct: 122, maxEffortMin: 15 });
  });

  it("keeps the %FTP ceiling above the floor when an override collapses them", () => {
    const e = resolveDurabilityInsertEnvelope({ embeddedHardPct: 100, maxIntensityPct: 95 });
    expect(e.maxIntensityPct).toBeGreaterThan(e.embeddedHardPct);
  });

  it("ignores non-finite values and clamps to sane ranges", () => {
    const e = resolveDurabilityInsertEnvelope({ embeddedHardPct: Number.NaN, maxEffortMin: 999 });
    expect(e.embeddedHardPct).toBe(DEFAULT_DURABILITY_INSERT_ENVELOPE.embeddedHardPct);
    expect(e.maxEffortMin).toBeLessThanOrEqual(60);
  });
});

describe("isDurabilityInsertEnvelopeOverridden", () => {
  it("detects a real override vs none", () => {
    expect(isDurabilityInsertEnvelopeOverridden(null)).toBe(false);
    expect(isDurabilityInsertEnvelopeOverridden({})).toBe(false);
    expect(isDurabilityInsertEnvelopeOverridden({ maxEffortMin: 15 })).toBe(true);
  });
});

describe("resolveAthleteStateWeights (ROADMAP §5 — fusion weights)", () => {
  it("returns population defaults with no override", () => {
    expect(resolveAthleteStateWeights()).toEqual(DEFAULT_ATHLETE_STATE_WEIGHTS);
    expect(resolveAthleteStateWeights(null)).toEqual(DEFAULT_ATHLETE_STATE_WEIGHTS);
    expect(resolveAthleteStateWeights({})).toEqual(DEFAULT_ATHLETE_STATE_WEIGHTS);
  });

  it("deep-merges a partial override, leaving untouched leaves at their default", () => {
    const w = resolveAthleteStateWeights({ BASE: 50, tsb: { scale: 1.0 } });
    expect(w.BASE).toBe(50);
    expect(w.tsb.scale).toBe(1.0);
    expect(w.tsb.cap).toBe(DEFAULT_ATHLETE_STATE_WEIGHTS.tsb.cap); // sibling leaf preserved
    expect(w.acwr).toEqual(DEFAULT_ATHLETE_STATE_WEIGHTS.acwr); // untouched group preserved
  });

  it("ignores non-finite leaves and falls back to the default", () => {
    const w = resolveAthleteStateWeights({ BASE: Number.NaN, override: { scoreCap: Number.POSITIVE_INFINITY } });
    expect(w.BASE).toBe(DEFAULT_ATHLETE_STATE_WEIGHTS.BASE);
    expect(w.override.scoreCap).toBe(DEFAULT_ATHLETE_STATE_WEIGHTS.override.scoreCap);
  });

  it("does not mutate the default", () => {
    resolveAthleteStateWeights({ tsb: { scale: 9 } });
    expect(DEFAULT_ATHLETE_STATE_WEIGHTS.tsb.scale).toBe(0.6);
  });

  it("clamps every leaf to a sane range (CAL-1)", () => {
    const w = resolveAthleteStateWeights({ BASE: 999, tsb: { scale: -5, cap: 999 }, behaviour: { effect: 50 } });
    expect(w.BASE).toBe(80); // [40, 80]
    expect(w.tsb.scale).toBe(0); // [0, 3] — a negative scale would invert TSB polarity
    expect(w.tsb.cap).toBe(40); // [0, 40]
    expect(w.behaviour.effect).toBe(0); // [-20, 0] — stays a penalty, never a bonus
  });

  it("keeps the lived-fatigue safety cap real: scoreCap stays below 'primed' and livedThreshold stays reachable (CAL-1)", () => {
    // The review attack: { scoreCap: 100, livedThreshold: 99 } silently disables the corroborated-fatigue cap.
    const w = resolveAthleteStateWeights({ override: { scoreCap: 100, livedThreshold: 99 } });
    expect(w.override.scoreCap).toBe(70); // ≤ 70 → can't land a wrecked athlete in the 80+ "primed/push" band
    expect(w.override.livedThreshold).toBe(3); // only 3 lived signals exist (exec/aerobicEff/rpe) — must stay ≤ 3
  });

  it("enforces fresh > deep on the TSB direction edges so an override can't invert them (CAL-1)", () => {
    const w = resolveAthleteStateWeights({ tsb: { freshAbove: -10, deepBelow: 8 } });
    expect(w.tsb.deepBelow).toBeLessThanOrEqual(0);
    expect(w.tsb.freshAbove).toBeGreaterThan(w.tsb.deepBelow);
  });

  it("keeps ACWR level effects from flipping sign at the extremes (CAL-1)", () => {
    const w = resolveAthleteStateWeights({ acwr: { danger: 50, optimal: -50 } });
    expect(w.acwr.danger).toBeLessThanOrEqual(0); // danger is a penalty, never a boost
    expect(w.acwr.optimal).toBeGreaterThanOrEqual(0); // optimal is a boost, never a penalty
  });
});

describe("isAthleteStateWeightsOverridden", () => {
  it("detects a real (possibly deep) override vs none", () => {
    expect(isAthleteStateWeightsOverridden(null)).toBe(false);
    expect(isAthleteStateWeightsOverridden({})).toBe(false);
    expect(isAthleteStateWeightsOverridden({ tsb: {} })).toBe(false); // empty group is not an override
    expect(isAthleteStateWeightsOverridden({ BASE: 50 })).toBe(true);
    expect(isAthleteStateWeightsOverridden({ tsb: { scale: 1 } })).toBe(true);
  });
});

describe("deriveTsbDeepFatigue (ROADMAP #2 — auto-derive from stamped TSB context)", () => {
  it("derives the edge from under-executed quality sessions when fatigue discriminates", () => {
    const entries = [
      ...Array.from({ length: 4 }, () => qEntry(-30, 3)), // failed quality at deep fatigue
      qEntry(-5, 7), // nailed quality when fresh
      qEntry(-6, 8),
    ];
    const p = deriveTsbDeepFatigue(entries);
    expect(p.source).toBe("derived");
    expect(p.value).toBe(-30); // median TSB of the failures
    expect(p.dataPoints).toBe(4);
  });

  it("stays on the default when there are no quality failures to learn from", () => {
    expect(deriveTsbDeepFatigue([qEntry(-5, 8), qEntry(-8, 7)]).source).toBe("default");
  });

  it("refuses to derive when fatigue does NOT discriminate (failures aren't deeper than successes)", () => {
    // Failures at −10, successes at −12 → fatigue isn't the driver, so no honest edge.
    const entries = [...Array.from({ length: 4 }, () => qEntry(-10, 3)), qEntry(-12, 7), qEntry(-13, 8)];
    expect(deriveTsbDeepFatigue(entries).source).toBe("default");
  });

  it("refuses to derive without any successful sessions to contrast against", () => {
    // Under-executes ALL quality work, deep — but with no successes there's no contrast, so deriving
    // would calibrate to where they train, not where they adapt.
    expect(deriveTsbDeepFatigue(Array.from({ length: 8 }, () => qEntry(-30, 3))).source).toBe("default");
  });

  it("excludes off-plan rides — only prescribed quality counts (intrinsic scoring is a different axis)", () => {
    const offPlan = Array.from({ length: 8 }, () => qEntry(-30, 3, { planned: false, plannedType: null }));
    expect(deriveTsbDeepFatigue([...offPlan, qEntry(-5, 8)]).source).toBe("default");
  });

  it("excludes legacy + compromised entries and non-quality types", () => {
    const entries = [
      qEntry(-30, 3, { legacy: true }),
      qEntry(-32, 3, { compromised: true }),
      qEntry(-31, 3, { inferredType: "Z2", plannedType: "Z2" }),
    ];
    expect(deriveTsbDeepFatigue(entries).source).toBe("default"); // nothing eligible
  });

  it("clamps the derived edge to a sane deep-fatigue range", () => {
    const entries = [...Array.from({ length: 4 }, () => qEntry(-70, 2)), qEntry(-5, 8)];
    expect(deriveTsbDeepFatigue(entries).value).toBe(-45); // clamped from −70
  });
});

describe("resolveTsbEdgesOverride (derived edge + manual override precedence)", () => {
  it("falls back to the population deep-fatigue default with no signal", () => {
    expect(resolveTsbEdgesOverride([])).toEqual({ deepFatigue: DEFAULT_TSB_MODIFIER_EDGES.deepFatigue });
  });

  it("does not apply a low-confidence derivation (too few failures)", () => {
    const entries = [...Array.from({ length: 3 }, () => qEntry(-30, 3)), qEntry(-5, 8)];
    expect(resolveTsbEdgesOverride(entries)).toEqual({ deepFatigue: -25 }); // derived but low conf → default
  });

  it("applies a confident derived edge, with any manual override winning", () => {
    // CS-7: needs both ≥5 failures AND ≥3 successes (contrast) to clear the gate.
    const entries = [...Array.from({ length: 8 }, () => qEntry(-30, 3)), qEntry(-5, 8), qEntry(-6, 7), qEntry(-7, 7)];
    expect(resolveTsbEdgesOverride(entries)).toEqual({ deepFatigue: -30 }); // medium confidence
    expect(resolveTsbEdgesOverride(entries, { deepFatigue: -18 })).toEqual({ deepFatigue: -18 }); // manual deepFatigue wins
  });

  it("does not apply a derived edge without enough success contrast (CS-7)", () => {
    // 8 failures but only 2 successes → low confidence → derived value not applied.
    const entries = [...Array.from({ length: 8 }, () => qEntry(-30, 3)), qEntry(-5, 8), qEntry(-6, 7)];
    expect(resolveTsbEdgesOverride(entries)).toEqual({ deepFatigue: -25 });
  });

  it("yields the derived edge below a manually-set productiveOverload — never nudges the manual value (CS-5)", () => {
    // Derives a shallow deepFatigue (~−12) that would collide with a manual productiveOverload of −15.
    const entries = [...Array.from({ length: 5 }, () => qEntry(-8, 3)), ...Array.from({ length: 3 }, () => qEntry(-3, 8))];
    const edges = resolveTsbModifierEdges(resolveTsbEdgesOverride(entries, { productiveOverload: -15 }));
    expect(edges.productiveOverload).toBe(-15); // manual neighbour preserved, not nudged to −11
    expect(edges.deepFatigue).toBeLessThan(-15); // derived edge yielded below it
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
