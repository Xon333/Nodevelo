import { describe, expect, it } from "vitest";
import { aerobicDisciplineRead, AEROBIC_HR_DIALED_MAX, AEROBIC_HR_DRIFT_MAX, computeExecutionScore, executionScoreLabel, FTP_ANCHORED_IF_BANDS, resolveCompliance, timeAboveAerobicHrFraction, timeAboveZ2Fraction, type ExecutionScoreInput } from "./execution-score";

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

  it("ignores the aerobic read on a planned (non-intrinsic) ride of non-easy type", () => {
    // Planned easy types (Z2/Recovery) now use aerobicEffPct via mergedEasyRead. This test checks that
    // planned NON-easy types (e.g., Threshold) remain inert to it.
    const planned = (aerobicEffPct: number | null) =>
      computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 0.85, plannedType: "Threshold", variabilityIndex: 1.1, aerobicEffPct })!;
    expect(planned(8)).toBe(planned(null)); // Threshold planned (not easy) → no aerobic contribution
  });

  it("doesn't penalise above-Z2 time on a durability template that embeds efforts; template A still does (Track B)", () => {
    // re-baselined: easy-ride effort now HR-judged, power/VI reward-only — aboveZ2Frac is inert; use
    // aboveAerobicHrFrac (hot) so the HR judge actually has something to gate on.
    const drifted = { ...base, compliancePct: 100, intensityFactor: 0.7, plannedType: "Z2", variabilityIndex: 1.05, aboveAerobicHrFrac: 0.4 };
    const plainZ2 = computeExecutionScore(drifted)!; // hot HR read → easy-discipline penalty applies
    expect(computeExecutionScore({ ...drifted, durabilityTemplate: "B" })!).toBeGreaterThan(plainZ2); // B embeds efforts → HR judge skipped
    expect(computeExecutionScore({ ...drifted, durabilityTemplate: "A" })!).toBe(plainZ2); // A = unbroken Z2 → still HR-gated
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

  it("ignores a durability-delivery grade when the template embeds no efforts (EC-3: no double-count)", () => {
    // Template A (pure accumulation) prescribes no efforts, so a delivery grade must not move the score —
    // otherwise it stacks on the full interval-adherence axis and double-counts in the frozen ledger.
    const steady = { ...base, compliancePct: 100, intensityFactor: 0.7, plannedType: "Z2" as const, variabilityIndex: 1.05 };
    const templateA = computeExecutionScore({ ...steady, durabilityTemplate: "A" })!;
    expect(computeExecutionScore({ ...steady, durabilityTemplate: "A", durabilityDelivery: -2 })!).toBe(templateA);
    // Same guard when no durability template is attached at all.
    const noTemplate = computeExecutionScore(steady)!;
    expect(computeExecutionScore({ ...steady, durabilityDelivery: -2 })!).toBe(noTemplate);
  });

  it("rewards a hard, variable RaceSim and penalises a soft one", () => {
    const hard = computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 0.86, plannedType: "RaceSim" });
    const soft = computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 0.62, plannedType: "RaceSim" });
    expect(hard!).toBeGreaterThan(soft!);
  });

  it("rewards a SIT day for clearing the target hard, not penalising overshoot (BUG-2026-07-03)", () => {
    // 6/6 reps at full duration, avg 131% of a 432W target — a genuine sprint PR, not a pacing failure.
    // Regression: this used to score 2/10 ("Poor") — a -2 "blew past it" penalty on the generic band,
    // stacked with a -1 from a whole-ride-IF band that a short-sprint/long-recovery day can't clear.
    const score = computeExecutionScore({ ...base, adherencePct: 131, intensityFactor: 0.82, plannedType: "SIT" });
    expect(score).toBeGreaterThanOrEqual(7);
  });

  it("still penalises a SIT day that undershoots the sprint target", () => {
    const nailed = computeExecutionScore({ ...base, adherencePct: 100, plannedType: "SIT" })!;
    const undershot = computeExecutionScore({ ...base, adherencePct: 60, plannedType: "SIT" })!;
    expect(undershot).toBeLessThan(nailed);
  });

  it("doesn't grade SIT on whole-ride IF — the band is unreachable by a short-sprint/long-recovery day", () => {
    // A low whole-ride IF is EXPECTED on a SIT day (mostly warmup/recovery); it must not drag the score
    // down when there's no adherence signal to fall back on.
    const lowWholeRideIf = computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 0.4, plannedType: "SIT" });
    const noIfSignal = computeExecutionScore({ ...base, compliancePct: 100, plannedType: "SIT" });
    expect(lowWholeRideIf).toBe(noIfSignal);
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
    // re-baselined: easy-ride effort now HR-judged, power/VI reward-only — IF/VI no longer carry a
    // penalty branch for Z2, so a hot HR read is needed to still reach the score-1 floor.
    const score = computeExecutionScore({
      ...base,
      compliancePct: 30,
      intensityFactor: 1.2,
      plannedType: "Z2",
      variabilityIndex: 1.3,
      aboveAerobicHrFrac: 0.5, // hot — the only "too hard" judge left for Z2
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

describe("computeExecutionScore — easy-ride discipline (HR time above the aerobic ceiling)", () => {
  // re-baselined: easy-ride effort now HR-judged, power/VI reward-only — this whole block used to drive
  // the removed power-based aboveZ2Frac penalty ladder; it now drives aboveAerobicHrFrac, the field the
  // scorer actually reads (dialed ≤0.10 → +1, drift ≤0.25 → 0, hot >0.25 → −4).
  // A clean-on-average Z2 ride (IF 0.68); only aboveAerobicHrFrac varies.
  const z2 = (aboveAerobicHrFrac?: number | null, type = "Z2"): number =>
    computeExecutionScore({ ...base, compliancePct: 100, intensityFactor: 0.68, plannedType: type, aboveAerobicHrFrac })!;

  it("is inert when HR-zone data is absent — scoring is unchanged", () => {
    const baseline = z2(); // no aboveAerobicHrFrac at all
    expect(z2(null)).toBe(baseline);
    expect(z2(undefined)).toBe(baseline);
  });

  it("rewards a dialed-in easy ride and grades down as HR drifts above the aerobic ceiling", () => {
    expect(z2(0.05)).toBeGreaterThan(z2(0.15)); // dialed (+1) > drift (0)
    expect(z2(0.15)).toBeGreaterThan(z2(0.30)); // drift (0) > hot (−4)
  });

  it("penalises a Z2 ride that hid its spikes behind a clean AVERAGE IF (the whole point)", () => {
    // Identical textbook 0.68 avg IF; the one whose HEART sat above the aerobic ceiling must score lower.
    expect(z2(0.4)).toBeLessThan(z2(0.03));
  });

  it("applies to Recovery as well as Z2", () => {
    expect(z2(0.4, "Recovery")).toBeLessThan(z2(0.02, "Recovery"));
  });

  it("does not touch non-easy types — a Threshold ride ignores HR time-above-aerobic", () => {
    const args = { ...base, compliancePct: 100, intensityFactor: 0.9, plannedType: "Threshold" };
    expect(computeExecutionScore({ ...args, aboveAerobicHrFrac: 0.5 })).toBe(computeExecutionScore(args));
  });

  it("does not apply off-plan (intrinsic) — there was no plan to be disciplined against", () => {
    const args = { ...base, intensityFactor: 0.68, plannedType: "Z2", intrinsic: true };
    expect(computeExecutionScore({ ...args, aboveAerobicHrFrac: 0.5 })).toBe(computeExecutionScore(args));
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

describe("timeAboveAerobicHrFraction", () => {
  it("returns the fraction of HR-zone time in zones 3+", () => {
    // [Z1, Z2, Z3, Z4] seconds: 300 aerobic-below-cap in Z1+Z2 is index 0..1; 100 above.
    expect(timeAboveAerobicHrFraction([1200, 1800, 200, 100])).toBeCloseTo(300 / 3300, 5);
  });
  it("treats a mostly-aerobic outdoor ride as low fraction despite brief spikes", () => {
    // 55 min aerobic (Z1 600s + Z2 2700s), 5 min above (Z3 300s) → 300/3600 ≈ 0.083 ≤ 0.10
    expect(timeAboveAerobicHrFraction([600, 2700, 300])).toBeCloseTo(0.0833, 3);
  });
  it("returns null with fewer than 3 zones or no usable data", () => {
    expect(timeAboveAerobicHrFraction([100, 200])).toBeNull();
    expect(timeAboveAerobicHrFraction(null)).toBeNull();
    expect(timeAboveAerobicHrFraction([0, 0, 0])).toBeNull();
  });
  it("ignores non-finite / negative buckets", () => {
    expect(timeAboveAerobicHrFraction([600, NaN, -5, 200])).toBeCloseTo(200 / 800, 5);
  });
});

describe("aerobicDisciplineRead", () => {
  it("dialed in when almost all time is aerobic", () => {
    expect(aerobicDisciplineRead(0.05)).toBe("dialed");
    expect(aerobicDisciplineRead(AEROBIC_HR_DIALED_MAX)).toBe("dialed"); // boundary inclusive
  });
  it("some drift in the tolerance band", () => {
    expect(aerobicDisciplineRead(0.18)).toBe("drift");
    expect(aerobicDisciplineRead(AEROBIC_HR_DRIFT_MAX)).toBe("drift"); // boundary inclusive
  });
  it("ran hot above the drift ceiling", () => {
    expect(aerobicDisciplineRead(0.4)).toBe("hot");
  });
  it("null when there is no HR data", () => {
    expect(aerobicDisciplineRead(null)).toBeNull();
    expect(aerobicDisciplineRead(undefined)).toBeNull();
  });
});

describe("easy-ride execution — HR judges effort, terrain does not", () => {
  const baseZ2 = {
    compliancePct: 100,      // rode the planned duration (or longer)
    intensityFactor: 0.68,   // NP/FTP of a genuine outdoor Z2 ride
    plannedType: "Z2" as const,
    variabilityIndex: 1.15,  // surgy — outdoor terrain, NOT a discipline failure
  };

  it("scores a well-ridden OUTDOOR Z2 highly despite power spikes and high VI", () => {
    // HR stayed aerobic (only 8% of HR-time above zone) → the ride was genuinely easy.
    const score = computeExecutionScore({ ...baseZ2, aboveAerobicHrFrac: 0.08 });
    expect(score).not.toBeNull();
    expect(score as number).toBeGreaterThanOrEqual(7); // "Good" is now reachable outdoors
  });

  it("does NOT penalize surgy VI or brief power spikes on an easy ride", () => {
    const steady = computeExecutionScore({ ...baseZ2, variabilityIndex: 1.02, aboveAerobicHrFrac: 0.08 });
    const surgy = computeExecutionScore({ ...baseZ2, variabilityIndex: 1.20, aboveAerobicHrFrac: 0.08 });
    // Steady may earn the +1 VI bonus, but surgy is never penalized below steady-minus-bonus.
    expect(surgy as number).toBeGreaterThanOrEqual((steady as number) - 1);
    expect(surgy as number).toBeGreaterThanOrEqual(7);
  });

  it("still flags a genuinely over-cooked easy ride via HR (the overtraining guardrail)", () => {
    // 40% of HR-time above aerobic → the heart was working; this was not an easy ride.
    const score = computeExecutionScore({ ...baseZ2, aboveAerobicHrFrac: 0.40 });
    expect(score as number).toBeLessThanOrEqual(5);
  });

  it("no HR data → no HR penalty (rides on duration + power bonuses)", () => {
    const score = computeExecutionScore({ ...baseZ2, aboveAerobicHrFrac: null });
    expect(score as number).toBeGreaterThanOrEqual(7);
  });

  it("guardrail holds at the exact zero-margin boundary: max reward stack + hot HR = 5, not below (path a: duration+IF-band+VI)", () => {
    // Baseline 5 +2 (compliance ≥95) +1 (IF in-band, ≤0.74) +1 (VI ≤1.06) −4 (hot) = 5 exactly.
    const score = computeExecutionScore({
      compliancePct: 100,
      intensityFactor: 0.68,
      plannedType: "Z2",
      variabilityIndex: 1.0,
      aboveAerobicHrFrac: 0.4,
    });
    expect(score).toBe(5);
  });

  it("guardrail holds at the exact zero-margin boundary: max reward stack + hot HR = 5, not below (path b: duration+VI+RPE substitutes for IF-band)", () => {
    // IF 0.90 is outside the Z2 in-band (≤0.74), so no IF-band bonus — but the RPE-undershoot bonus
    // substitutes for it: expected RPE = IF*10 = 9, rpe 7 → gap −2, intensityFactor ≥0.85 → +1.
    // Baseline 5 +2 (compliance ≥95) +0 (IF band, out of range) +1 (VI ≤1.06) +1 (RPE gap) −4 (hot) = 5.
    const score = computeExecutionScore({
      compliancePct: 100,
      intensityFactor: 0.9,
      plannedType: "Z2",
      variabilityIndex: 1.0,
      aboveAerobicHrFrac: 0.4,
      rpe: 7,
    });
    expect(score).toBe(5);
  });

  it("no-stacking regression: hot + eff = −10 scores identically to hot + eff = null", () => {
    // Hot always returns −4, regardless of aerobicEffPct. The two should be identical.
    const withNullEff = computeExecutionScore({
      compliancePct: 100,
      intensityFactor: 0.68,
      plannedType: "Z2",
      variabilityIndex: 1.0,
      aboveAerobicHrFrac: 0.4, // hot
      aerobicEffPct: null,
    });
    const withNegativeEff = computeExecutionScore({
      compliancePct: 100,
      intensityFactor: 0.68,
      plannedType: "Z2",
      variabilityIndex: 1.0,
      aboveAerobicHrFrac: 0.4, // hot
      aerobicEffPct: -10,
    });
    expect(withNegativeEff).toBe(withNullEff);
  });

  it("zero-margin boundaries: drift/dialed + eff threshold at −2×deadband (−6)", () => {
    const baselineZ2 = {
      compliancePct: 100,
      intensityFactor: 0.68,
      plannedType: "Z2" as const,
      variabilityIndex: 1.0,
    };
    // Drift + eff = −6.0 (at boundary) → −2
    const driftAtBoundary = computeExecutionScore({
      ...baselineZ2,
      aboveAerobicHrFrac: 0.15, // drift
      aerobicEffPct: -6.0,
    });
    // Drift + eff = −5.9 (just above boundary) → 0
    const driftAboveBoundary = computeExecutionScore({
      ...baselineZ2,
      aboveAerobicHrFrac: 0.15, // drift
      aerobicEffPct: -5.9,
    });
    // Dialed + eff = −6.0 (at boundary) → 0 (not −1)
    const dialedAtBoundary = computeExecutionScore({
      ...baselineZ2,
      aboveAerobicHrFrac: 0.05, // dialed
      aerobicEffPct: -6.0,
    });
    // Dialed + eff = −5.9 (just above boundary) → +1
    const dialedAboveBoundary = computeExecutionScore({
      ...baselineZ2,
      aboveAerobicHrFrac: 0.05, // dialed
      aerobicEffPct: -5.9,
    });

    // Base 5 + 2 (duration) +1 (if in-band) +1 (vi) +0 (drift) −2 (eff) = 7
    expect(driftAtBoundary).toBe(7);
    // Base 5 + 2 (duration) +1 (if in-band) +1 (vi) +0 (drift) +0 (eff) = 9
    expect(driftAboveBoundary).toBe(9);
    // Base 5 + 2 (duration) +1 (if in-band) +1 (vi) +0 (dialed) +0 (eff) = 9
    expect(dialedAtBoundary).toBe(9);
    // Base 5 + 2 (duration) +1 (if in-band) +1 (vi) +1 (dialed) +1 (eff) = 11 → clamped to 10
    expect(dialedAboveBoundary).toBe(10);
  });

  it("corroborated-drift ceiling: max stack + drift + poor eff = 7 exactly", () => {
    // Max positive stack: duration ≥95%, in-band IF for Z2 (≤0.74), VI ≤1.06
    // Base 5 + 2 (compliance ≥95) + 1 (IF in-band) + 1 (VI ≤1.06) = 9
    // Then + drift + eff ≤ −6: mergedEasyRead returns −2
    // Total: 9 + 0 (drift) − 2 (eff) = 7
    const score = computeExecutionScore({
      compliancePct: 100,
      intensityFactor: 0.68,
      plannedType: "Z2",
      variabilityIndex: 1.05,
      aboveAerobicHrFrac: 0.15, // drift
      aerobicEffPct: -6.0,
    });
    expect(score).toBe(7);
  });

  it("null-HR fallback: eff thresholds −2×deadband (−6), −deadband (−3), else 0 (penalty-only)", () => {
    const baselineZ2 = {
      compliancePct: 100,
      intensityFactor: 0.68,
      plannedType: "Z2" as const,
      variabilityIndex: 1.0,
      aboveAerobicHrFrac: null, // no HR data
    };
    // eff = −6.0 → −2
    const effAtBoundary2x = computeExecutionScore({
      ...baselineZ2,
      aerobicEffPct: -6.0,
    });
    // eff = −3.0 → −1
    const effAtBoundary1x = computeExecutionScore({
      ...baselineZ2,
      aerobicEffPct: -3.0,
    });
    // eff = −2.9 → 0 (no penalty)
    const effAboveThreshold = computeExecutionScore({
      ...baselineZ2,
      aerobicEffPct: -2.9,
    });
    // eff = +10 → 0 (no bonus, penalty-only path)
    const effPositive = computeExecutionScore({
      ...baselineZ2,
      aerobicEffPct: 10,
    });

    // Base 5 + 2 (duration) + 1 (if in-band, even without HR) + 1 (vi) = 9
    // Then mergedEasyRead returns −2, −1, 0, 0
    expect(effAtBoundary2x).toBe(7); // 9 − 2
    expect(effAtBoundary1x).toBe(8); // 9 − 1
    expect(effAboveThreshold).toBe(9); // 9 + 0
    expect(effPositive).toBe(9); // 9 + 0 (no bonus)
  });

  it("inert on planned non-easy types: Threshold + eff has no effect", () => {
    const baseThreshold = {
      compliancePct: 100,
      intensityFactor: 0.87,
      plannedType: "Threshold" as const,
      variabilityIndex: 1.05,
    };
    const withoutEff = computeExecutionScore(baseThreshold);
    const withEff = computeExecutionScore({
      ...baseThreshold,
      aerobicEffPct: -10, // even strong negative eff
    });
    expect(withEff).toBe(withoutEff);
  });

  it("inert on intrinsic (off-plan) rides — they use their own ±2 aerobic axis via the off-plan block", () => {
    // Off-plan rides score on their own off-plan aerobic path, not the merged easy-read.
    // Verify that the merged easy-read does not interfere.
    const baseOffPlan = {
      compliancePct: null,
      intensityFactor: 0.68,
      plannedType: "Z2" as const,
      intrinsic: true,
      variabilityIndex: 1.05,
    };
    const z2Ride = (hrFrac: number | null, eff: number | null) =>
      computeExecutionScore({ ...baseOffPlan, aboveAerobicHrFrac: hrFrac, aerobicEffPct: eff })!;

    // Off-plan: ignore HR read, use only the off-plan ±2 axis for eff.
    // Base 5, variabilityIndex no bonus for Z2 off-plan → base 5
    // eff +10 → +2 (off-plan axis), eff −10 → −2 (off-plan axis)
    const withGoodEffNoHR = z2Ride(null, 10);
    const withBadEffNoHR = z2Ride(null, -10);
    // The merged easy-read (if applied) would penalize hot HR, but intrinsic skips it entirely.
    const withHotHR = z2Ride(0.4, null); // hot HR, no eff
    // Off-plan should ignore the HR entirely.
    expect(withHotHR).toBe(z2Ride(null, null)); // intrinsic → no HR penalty
    expect(withGoodEffNoHR).toBeGreaterThan(withBadEffNoHR); // off-plan eff axis still works
  });

  it("inert on durability templates B–E (embedsEfforts): the merged easy-read is skipped", () => {
    const baselineTemplateB = {
      compliancePct: 100,
      intensityFactor: 0.68,
      plannedType: "Z2" as const,
      variabilityIndex: 1.05,
      durabilityTemplate: "B" as const,
      aboveAerobicHrFrac: 0.4, // hot
      aerobicEffPct: -10,
    };
    const templateA = {
      ...baselineTemplateB,
      durabilityTemplate: "A" as const, // does NOT embed efforts
    };
    // Template A (no embedded efforts) applies the merged easy-read and gets penalized by hot HR
    const scoreA = computeExecutionScore(templateA);
    // Template B (embedded efforts) skips the merged easy-read entirely
    const scoreB = computeExecutionScore(baselineTemplateB);
    // Template B should be higher than Template A (no easy-read penalty applied)
    expect(scoreB).toBeGreaterThan(scoreA!);
  });
});

describe("variability index on off-plan (intrinsic) rides", () => {
  // Both rides in each pair share IDENTICAL intensityFactor/plannedType/aerobicEffPct — only
  // variabilityIndex differs — so any score difference within a pair is attributable to VI alone,
  // regardless of what the intensity-vs-type axis happens to do for that IF/type combination.
  const commonBase = {
    compliancePct: null,
    intensityFactor: 0.84, // inside the Threshold sweet spot [0.82, 0.92] — held constant across both
                            // rides in each pair, so the intensity-vs-type branch's effect cancels out
                            // of the WITHIN-PAIR difference regardless of what it equals.
    plannedType: "Threshold" as const,
    aerobicEffPct: null,
  };

  it("does not penalise a surgy off-plan ride, but a steady one still earns its pacing bonus", () => {
    const steady = computeExecutionScore({ ...commonBase, variabilityIndex: 1.02, intrinsic: true })!; // <=1.08 -> +1
    const surgy = computeExecutionScore({ ...commonBase, variabilityIndex: 1.21, intrinsic: true })!; // >=1.15, penalty suppressed -> +0
    expect(steady).toBe(6); // 5 baseline + 1 VI bonus (intensity-vs-type skipped entirely: intrinsic)
    expect(surgy).toBe(5); // 5 baseline, no VI effect either way
    expect(steady).toBe(surgy + 1); // the ONLY difference between these two rides is the VI bonus
  });

  it("still penalises a surgy PLANNED threshold ride relative to a steady one", () => {
    const steady = computeExecutionScore({ ...commonBase, variabilityIndex: 1.02, intrinsic: false })!;
    const surgy = computeExecutionScore({ ...commonBase, variabilityIndex: 1.21, intrinsic: false })!;
    expect(steady).toBe(8); // 5 baseline + 2 intensity-band (IF 0.84 in [0.82,0.92]) + 1 VI bonus
    expect(surgy).toBe(6); // 5 baseline + 2 intensity-band - 1 VI penalty (planned, so NOT suppressed)
    expect(steady).toBe(surgy + 2); // steady's +1 bonus AND surgy's -1 penalty both apply here — a
                                     // 2-point gap, vs only a 1-point gap for the intrinsic pair above.
  });
});
