import { describe, expect, it } from "vitest";
import { computeExecutionScore, executionScoreLabel, type ExecutionScoreInput } from "./execution-score";

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

describe("executionScoreLabel", () => {
  it("maps score bands to labels", () => {
    expect(executionScoreLabel(10)).toBe("Excellent");
    expect(executionScoreLabel(7)).toBe("Good");
    expect(executionScoreLabel(5)).toBe("Adequate");
    expect(executionScoreLabel(3)).toBe("Below target");
    expect(executionScoreLabel(1)).toBe("Poor");
  });
});
