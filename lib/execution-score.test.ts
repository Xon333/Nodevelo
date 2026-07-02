import { describe, expect, it } from "vitest";
import { computeExecutionScore, executionScoreLabel, FTP_ANCHORED_IF_BANDS, resolveCompliance, timeAboveZ2Fraction, type ExecutionScoreInput } from "./execution-score";

const base: ExecutionScoreInput = {
  compliancePct: null,
  intensityFactor: null,
  plannedType: null,
  variabilityIndex: null,
};

// Decoupling was demoted out of execution scoring (ACC-2026-06-25) — it's a steady-ride durability
// signal now, not an execution input — so it no longer appears here.

describe("computeExecutionScore", () => {
  it("returns null when no signal is present", () => {
    expect(computeExecutionScore(base)).toBeNull();
  });

  it("grades off-plan rides on the aerobic read (Z2 Pw:HR vs baseline) — the gap decoupling left", () => {
    // Off-plan: intrinsic, no duration target, neutral VI → without the aerobic read it scores ~flat.
    const offPlan = (aerobicEffPct: number | null) =>
      computeExecutionScore({ ...base, intensityFactor: 0.7, plannedType: "Z2", variabilityIndex: 1.1, intrinsic: true, aerobicEffPct })!;
    const neutral = offPlan(null);
    expect(offPlan(8)).toBeGreaterThan(neutral); // well above baseline = good aerobic day (+2)
    expect(offPlan(4)).toBeGreaterThan(neutral); // modestly above (+1)
    expect(offPlan(-8)).toBeLessThan(neutral); // well below = aerobic strain (−2)
    expect(offPlan(0)).toBe(neutral); // within the deadband = no signal
  });

  it("ignores the aerobic read on a planned (non-intrinsic) ride", () => {
    const planned = (aerobicEffPct: number | null) =>
      computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 0.7, plannedType: "Z2", variabilityIndex: 1.1, aerobicEffPct })!;
    expect(planned(8)).toBe(planned(null)); // not intrinsic → no aerobic contribution
  });

  it("doesn't penalise above-Z2 time on a durability template that embeds efforts; template A still does (Track B)", () => {
    const drifted = { ...base, compliancePct: 100, intensityFactor: 0.7, plannedType: "Z2", variabilityIndex: 1.05, aboveZ2Frac: 0.4 };
    const plainZ2 = computeExecutionScore(drifted)!; // easy-discipline penalty applies
    expect(computeExecutionScore({ ...drifted, durabilityTemplate: "B" })!).toBeGreaterThan(plainZ2); // B embeds efforts → not penalised
    expect(computeExecutionScore({ ...drifted, durabilityTemplate: "A" })!).toBe(plainZ2); // A = unbroken Z2 → still penalised
  });

  it("applies the durability effort-delivery signal (Track B)", () => {
    const longRide = { ...base, compliancePct: 100, intensityFactor: 0.7, plannedType: "Z2" as const, variabilityIndex: 1.05, durabilityTemplate: "B" };
    expect(computeExecutionScore({ ...longRide, durabilityDelivery: 2 })!).toBeGreaterThan(
      computeExecutionScore({ ...longRide, durabilityDelivery: -2 })!
    );
  });

  it("suppresses the generic interval-adherence penalty on a durability ride graded by delivery (Track B)", () => {
    // A fatigued 13.5/20m climb reads as a near-miss on the strict interval axis (low adherencePct),
    // but the durability grader is the right lens for it — so the generic penalty must not double-count.
    const longRide = { ...base, compliancePct: 95, intensityFactor: 0.7, plannedType: "Z2" as const, variabilityIndex: 1.05, durabilityTemplate: "B", durabilityDelivery: 2 };
    const lowAdherence = computeExecutionScore({ ...longRide, adherencePct: 9 })!; // would be −2 if applied
    const noAdherence = computeExecutionScore({ ...longRide, adherencePct: null })!;
    expect(lowAdherence).toBe(noAdherence); // adherence ignored → climb not penalised twice
    // Template A (no embedded effort, no delivery grade) still applies the generic penalty.
    const templateA = { ...longRide, durabilityTemplate: "A", durabilityDelivery: null };
    expect(computeExecutionScore({ ...templateA, adherencePct: 9 })!).toBeLessThan(
      computeExecutionScore({ ...templateA, adherencePct: null })!
    );
  });

  it("rewards a hard, variable RaceSim and penalises a soft one", () => {
    const hard = computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 0.86, plannedType: "RaceSim" });
    const soft = computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 0.62, plannedType: "RaceSim" });
    expect(hard!).toBeGreaterThan(soft!);
  });

  it("scores a well-executed steady Z2 ride near the top", () => {
    const score = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 0.68,
      plannedType: "Z2",
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
      variabilityIndex: 1.02,
    })!;
    const surgy = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 0.68,
      plannedType: "Z2",
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
      variabilityIndex: 1.4,
    })!;
    const withoutVi = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 1.0,
      plannedType: "VO2max",
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
    })!;
    const sandbagged = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 0.7,
      plannedType: "VO2max",
    })!;
    expect(sandbagged).toBeLessThan(proper);
  });

  it("marks down a wildly over-cooked VO2max / RaceSim, not just an under-cooked one (RV2-8)", () => {
    const properVo2 = computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 1.0, plannedType: "VO2max" })!;
    const overVo2 = computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 1.3, plannedType: "VO2max" })!;
    expect(overVo2).toBeLessThan(properVo2);
    const properRace = computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 0.88, plannedType: "RaceSim" })!;
    const overRace = computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 1.15, plannedType: "RaceSim" })!;
    expect(overRace).toBeLessThan(properRace);
  });

  it("uses interval adherence as the execution signal on interval days", () => {
    const onTarget = computeExecutionScore({
      ...base,
      intensityFactor: 1.0,
      plannedType: "VO2max",
      adherencePct: 100,
    })!;
    const wellUnder = computeExecutionScore({
      ...base,
      intensityFactor: 1.0,
      plannedType: "VO2max",
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
      rpe: 7,
    })!;
    const struggled = computeExecutionScore({
      ...base,
      compliancePct: 100,
      intensityFactor: 0.7,
      plannedType: "Z2",
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
  // Isolate the IF-vs-type branch: full duration (+2), no VI/RPE signal.
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

describe("computeExecutionScore — easy-ride discipline (time above the Z2 cap)", () => {
  // A clean-on-average Z2 ride (IF 0.68); only aboveZ2Frac varies.
  const z2 = (aboveZ2Frac?: number | null, type = "Z2"): number =>
    computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 0.68, plannedType: type, aboveZ2Frac })!;

  it("is inert when zone data is absent — scoring is unchanged", () => {
    const baseline = z2(); // no aboveZ2Frac at all
    expect(z2(null)).toBe(baseline);
    expect(z2(undefined)).toBe(baseline);
  });

  it("rewards a dialed-in easy ride and grades down as it drifts above zone", () => {
    expect(z2(0.02)).toBeGreaterThan(z2(0.1)); // dialed in > merely fine
    expect(z2(0.1)).toBeGreaterThan(z2(0.25)); // fine > drifted
    expect(z2(0.25)).toBeGreaterThan(z2(0.45)); // drifted > blew it
  });

  it("penalises a Z2 ride that hid its spikes behind a clean AVERAGE IF (the whole point)", () => {
    // Identical textbook 0.68 avg IF; the one that spent 40% above the cap must score lower.
    expect(z2(0.4)).toBeLessThan(z2(0.03));
  });

  it("applies to Recovery as well as Z2", () => {
    expect(z2(0.4, "Recovery")).toBeLessThan(z2(0.02, "Recovery"));
  });

  it("does not touch non-easy types — a Threshold ride ignores time-above-Z2", () => {
    const args = { ...base, compliancePct: 100, intensityFactor: 0.9, plannedType: "Threshold" };
    expect(computeExecutionScore({ ...args, aboveZ2Frac: 0.5 })).toBe(computeExecutionScore(args));
  });

  it("does not apply off-plan (intrinsic) — there was no plan to be disciplined against", () => {
    const args = { ...base, intensityFactor: 0.68, plannedType: "Z2", intrinsic: true };
    expect(computeExecutionScore({ ...args, aboveZ2Frac: 0.5 })).toBe(computeExecutionScore(args));
  });
});

describe("timeAboveZ2Fraction", () => {
  it("returns null without usable zone data", () => {
    expect(timeAboveZ2Fraction(null)).toBeNull();
    expect(timeAboveZ2Fraction(undefined)).toBeNull();
    expect(timeAboveZ2Fraction([10, 20])).toBeNull(); // too short to carry a Z3
    expect(timeAboveZ2Fraction([0, 0, 0, 0, 0, 0, 0])).toBeNull(); // no time logged at all
  });

  it("is 0 when all time sits in Z1–Z2", () => {
    expect(timeAboveZ2Fraction([1800, 1800, 0, 0, 0, 0, 0])).toBe(0);
  });

  it("is the share of time in zones 3+ (above the Z2 cap)", () => {
    // total 4000s, 1000s above the cap → 0.25
    expect(timeAboveZ2Fraction([0, 3000, 600, 400, 0, 0, 0])).toBe(0.25);
  });

  it("ignores non-finite / negative buckets defensively", () => {
    // z1=2000 ok, z2=NaN→0, z3=2000 ok, z4=-50→0 → total 4000, above 2000 → 0.5
    expect(timeAboveZ2Fraction([2000, NaN, 2000, -50, 0, 0, 0])).toBe(0.5);
  });
});

// #4: the exported FTP-anchored bands must be the very numbers the scorer's +2 sweet-spot tier uses —
// this pins export↔scorer so the retest detector / Trends "target IF" can never drift from scoring.
describe("FTP_ANCHORED_IF_BANDS export (#4)", () => {
  it("matches the scorer's +2 sweet-spot behaviour at the band edges", () => {
    for (const [type, band] of Object.entries(FTP_ANCHORED_IF_BANDS)) {
      const at = (IF: number) => computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: IF, plannedType: type })!;
      expect(at(band.lo)).toBe(at(band.hi)); // both sweet-spot edges score identically (+2 tier)
      expect(at(band.hi)).toBeGreaterThan(at(band.hi + 0.05)); // just above the top drops out of the tier
    }
  });
});
