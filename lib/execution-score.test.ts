import { describe, expect, it } from "vitest";
import { computeExecutionScore, executionScoreLabel, resolveCompliance, type ExecutionScoreInput } from "./execution-score";

const base: ExecutionScoreInput = {
  compliancePct: null,
  intensityFactor: null,
  plannedType: null,
  decoupling: null,
  variabilityIndex: null,
};

describe("computeExecutionScore", () => {
  it("returns null when no signal is present", () => {
    expect(computeExecutionScore(base)).toBeNull();
  });

  it("recenters the decoupling band on the calibrated 'good' cutoff, unchanged at the default (ROADMAP #2)", () => {
    const ride: ExecutionScoreInput = { ...base, compliancePct: 100, intensityFactor: 0.7, plannedType: "Z2", decoupling: 6 };
    const uncalibrated = computeExecutionScore(ride)!; // G=4 → 6 ∈ [4,7) → +0
    const drifty = computeExecutionScore({ ...ride, calibration: { decouplingGood: 8 } })!; // G=8 → 6 < 8 → +1
    expect(drifty).toBeGreaterThan(uncalibrated);
    // An explicit default cutoff must score identically to passing no calibration at all.
    expect(computeExecutionScore({ ...ride, calibration: { decouplingGood: 4 } })).toBe(uncalibrated);
  });

  it("rewards a hard, variable RaceSim and penalises a soft one", () => {
    const hard = computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 0.86, plannedType: "RaceSim", decoupling: 4 });
    const soft = computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 0.62, plannedType: "RaceSim", decoupling: 4 });
    expect(hard!).toBeGreaterThan(soft!);
  });

  it("scores a well-executed steady Z2 ride near the top", () => {
    const score = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 0.68,
      plannedType: "Z2",
      decoupling: 1.5,
      variabilityIndex: 1.02,
    });
    expect(score).toBeGreaterThanOrEqual(9);
  });

  it("penalises a surgy Z2 relative to a steady one (variability index)", () => {
    const steady = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 0.68,
      plannedType: "Z2",
      decoupling: 3,
      variabilityIndex: 1.02,
    })!;
    const surgy = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 0.68,
      plannedType: "Z2",
      decoupling: 3,
      variabilityIndex: 1.22,
    })!;
    expect(surgy).toBeLessThan(steady);
  });

  it("does not penalise high variability for interval sessions", () => {
    const withVi = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 1.0,
      plannedType: "VO2max",
      decoupling: 5,
      variabilityIndex: 1.4,
    })!;
    const withoutVi = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 1.0,
      plannedType: "VO2max",
      decoupling: 5,
      variabilityIndex: null,
    })!;
    expect(withVi).toBe(withoutVi);
  });

  it("marks down a sandbagged VO2max session (intensity too low)", () => {
    const proper = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 1.0,
      plannedType: "VO2max",
      decoupling: 5,
    })!;
    const sandbagged = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 0.7,
      plannedType: "VO2max",
      decoupling: 5,
    })!;
    expect(sandbagged).toBeLessThan(proper);
  });

  it("uses interval adherence as the execution signal on interval days", () => {
    const onTarget = computeExecutionScore({
      ...base,
      intensityFactor: 1.0,
      plannedType: "VO2max",
      decoupling: 5,
      adherencePct: 100,
    })!;
    const wellUnder = computeExecutionScore({
      ...base,
      intensityFactor: 1.0,
      plannedType: "VO2max",
      decoupling: 5,
      adherencePct: 78,
    })!;
    expect(onTarget).toBeGreaterThan(wellUnder);
  });

  it("penalises a ride that felt much harder than the power warranted (RPE)", () => {
    const aligned = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 0.7,
      plannedType: "Z2",
      decoupling: 3,
      rpe: 7,
    })!;
    const struggled = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 0.7,
      plannedType: "Z2",
      decoupling: 3,
      rpe: 10,
    })!;
    expect(struggled).toBeLessThan(aligned);
  });

  it("clamps the worst case to 1", () => {
    const score = computeExecutionScore({
      ...base,
      compliancePct: 30,
      intensityFactor: 1.2,
      plannedType: "Z2",
      decoupling: 18,
      variabilityIndex: 1.3,
    });
    expect(score).toBe(1);
  });

  it("clamps the best case to 10", () => {
    const score = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 0.88,
      plannedType: "Threshold",
      decoupling: 0.5,
      variabilityIndex: 1.03,
    });
    expect(score).toBe(10);
  });
});

describe("intrinsic (off-plan) scoring", () => {
  it("skips the circular intensity-vs-type branch", () => {
    // A Z2-inferred ride at IF 0.7: planned scoring adds +1 for hitting the band; intrinsic
    // must not, since the type was inferred FROM that intensity.
    const args = { ...base, intensityFactor: 0.7, plannedType: "Z2" as const };
    const planned = computeExecutionScore(args)!;
    const intrinsic = computeExecutionScore({ ...args, intrinsic: true })!;
    expect(intrinsic).toBeLessThan(planned);
  });

  it("still rewards clean aerobic execution off-plan (decoupling)", () => {
    const tight = computeExecutionScore({ ...base, intensityFactor: 0.7, plannedType: "Z2", decoupling: 1, intrinsic: true })!;
    const drifty = computeExecutionScore({ ...base, intensityFactor: 0.7, plannedType: "Z2", decoupling: 12, intrinsic: true })!;
    expect(tight).toBeGreaterThan(drifty);
  });
});

describe("resolveCompliance", () => {
  it("leaves compliance alone when execution is adequate or unknown", () => {
    expect(resolveCompliance(100, null)).toBe(100);
    expect(resolveCompliance(100, 5)).toBe(100);
    expect(resolveCompliance(90, 8)).toBe(90);
  });

  it("caps compliance when execution is poor — no 100% next to a 1/10", () => {
    expect(resolveCompliance(100, 1)).toBe(18);
    expect(resolveCompliance(100, 3)).toBe(54);
    expect(resolveCompliance(100, 4)).toBe(72);
  });

  it("never raises compliance and is null/overshoot safe", () => {
    expect(resolveCompliance(40, 3)).toBe(40); // already below the ceiling
    expect(resolveCompliance(130, 8)).toBe(100); // overshoot capped at 100
    expect(resolveCompliance(null, 5)).toBeNull();
  });
});

describe("executionScoreLabel", () => {
  it("maps score bands to labels", () => {
    expect(executionScoreLabel(10)).toBe("Excellent");
    expect(executionScoreLabel(7)).toBe("Good");
    expect(executionScoreLabel(5)).toBe("Adequate");
    expect(executionScoreLabel(3)).toBe("Below target");
    expect(executionScoreLabel(1)).toBe("Poor");
  });
});

describe("computeExecutionScore — per-type IF-band offset (ROADMAP #2)", () => {
  // Isolate the IF-vs-type branch: full duration (+2), no decoupling/VI/RPE signal.
  const threshold = (ifVal: number, calibration?: ExecutionScoreInput["calibration"]): number =>
    computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: ifVal, plannedType: "Threshold", calibration })!;

  it("scores identically with no offset, an empty offset map, or a zero offset", () => {
    const plain = threshold(0.95);
    expect(threshold(0.95, { ifBandOffsets: {} })).toBe(plain);
    expect(threshold(0.95, { ifBandOffsets: { Threshold: 0 } })).toBe(plain);
  });

  it("a positive offset lifts a just-above-band IF back into the +2 band", () => {
    // IF 0.95: default +2 band [0.82,0.92] misses → +1 (8). Shift +0.05 → +2 band [0.87,0.97] hits → +2 (9).
    expect(threshold(0.95)).toBe(8);
    expect(threshold(0.95, { ifBandOffsets: { Threshold: 0.05 } })).toBe(9);
  });

  it("a positive offset can also drop a now-too-easy IF out of the +2 band", () => {
    // IF 0.84: default +2 band [0.82,0.92] hits → +2 (9). Shift +0.05 → +2 band [0.87,0.97] misses → +1 (8).
    expect(threshold(0.84)).toBe(9);
    expect(threshold(0.84, { ifBandOffsets: { Threshold: 0.05 } })).toBe(8);
  });

  it("only shifts the matching type's bands, leaving others on population constants", () => {
    // A VO2max offset must not touch a Threshold ride.
    expect(threshold(0.95, { ifBandOffsets: { VO2max: 0.05 } })).toBe(threshold(0.95));
  });
});
