import { describe, expect, it } from "vitest";
import { aggregatePlanVsActual, detectFtpRetest, FTP_RETEST_DEFAULTS } from "./plan-vs-actual";
import { FTP_ANCHORED_IF_BANDS } from "./execution-score";
import type { RideScoreEntry } from "./types";

const TODAY = "2026-07-02";

// A qualifying planned Threshold entry; override per test.
const mk = (over: Partial<RideScoreEntry> = {}): RideScoreEntry => ({
  date: "2026-06-25",
  executionScore: 8,
  plannedType: "Threshold",
  inferredType: "Threshold",
  planned: true,
  legacy: false,
  compliancePct: 100,
  intensityFactor: 0.96,
  ftpUsed: 288,
  durationMin: 75,
  tss: 90,
  ...over,
});

describe("aggregatePlanVsActual", () => {
  it("groups planned rides by type with means and the FTP-anchored target band", () => {
    const rows = aggregatePlanVsActual(
      [
        mk({ date: "2026-06-20", intensityFactor: 0.85, compliancePct: 100, executionScore: 8 }),
        mk({ date: "2026-06-25", intensityFactor: 0.91, compliancePct: 90, executionScore: 7 }),
        mk({ date: "2026-06-22", plannedType: "Z2", inferredType: "Z2", intensityFactor: 0.68, compliancePct: 95, executionScore: 9 }),
      ],
      TODAY
    );
    expect(rows.map((r) => r.type)).toEqual(["Z2", "Threshold"]); // WORKOUT_TYPES order
    const th = rows.find((r) => r.type === "Threshold")!;
    expect(th).toMatchObject({ n: 2, meanIf: 0.88, meanCompliancePct: 95, meanExecution: 7.5 });
    expect(th.targetIf).toEqual({ lo: FTP_ANCHORED_IF_BANDS.Threshold.lo, hi: FTP_ANCHORED_IF_BANDS.Threshold.hi });
    expect(rows.find((r) => r.type === "Z2")!.targetIf).toBeNull(); // no single FTP anchor for Z2
  });

  it("excludes off-plan, legacy, compromised and out-of-window entries", () => {
    const rows = aggregatePlanVsActual(
      [
        mk({ date: "2026-06-25" }),
        mk({ date: "2026-06-26", planned: false, plannedType: null }),
        mk({ date: "2026-06-27", legacy: true }),
        mk({ date: "2026-06-28", compromised: true }),
        mk({ date: "2026-03-01" }), // beyond the 90d window
        mk({ date: "2026-07-03" }), // future — not yet lived
      ],
      TODAY
    );
    expect(rows).toEqual([expect.objectContaining({ type: "Threshold", n: 1 })]);
  });

  it("averages IF over only the entries that carry one, but counts all in n", () => {
    const rows = aggregatePlanVsActual([mk({ intensityFactor: 0.9 }), mk({ date: "2026-06-26", intensityFactor: null })], TODAY);
    expect(rows[0]).toMatchObject({ n: 2, meanIf: 0.9 });
  });
});

describe("detectFtpRetest", () => {
  // 3 Threshold sessions at IF 0.96 (top 0.92 → +0.04 each) + 1 VO2max at 1.14 (top 1.10 → +0.04):
  // n=4, all over, mean overshoot 0.04 → fires with meanOvershootPct 4. (A .xx5 mean would sit ON the
  // round1 boundary, where IEEE float error decides the direction — keep the fixture off knife-edges.)
  const trippingLedger = [
    mk({ date: "2026-06-10" }),
    mk({ date: "2026-06-16" }),
    mk({ date: "2026-06-22" }),
    mk({ date: "2026-06-28", plannedType: "VO2max", inferredType: "VO2max", intensityFactor: 1.14 }),
  ];

  it("fires on consistent overdelivery above the band top at high completion", () => {
    const sig = detectFtpRetest(trippingLedger, TODAY, 288);
    expect(sig).toMatchObject({ n: 4, overCount: 4, windowDays: 42, meanOvershootPct: 4 });
    expect(sig!.evidence).toContain("288");
    expect(sig!.evidence).toContain("re-test in Intervals.icu");
  });

  it("withholds below the session gate (thin data → null)", () => {
    expect(detectFtpRetest(trippingLedger.slice(0, 3), TODAY, 288)).toBeNull();
  });

  it("withholds when the over-fraction is too low, even with a big mean overshoot", () => {
    const mixed = [
      mk({ date: "2026-06-10", intensityFactor: 1.05 }),
      mk({ date: "2026-06-16", intensityFactor: 1.05 }),
      mk({ date: "2026-06-22", intensityFactor: 0.9 }),
      mk({ date: "2026-06-28", intensityFactor: 0.9 }),
    ];
    expect(detectFtpRetest(mixed, TODAY, 288)).toBeNull(); // 2/4 over < 0.75 despite mean +0.055
  });

  it("withholds when the mean margin is thin (borderline noise)", () => {
    const thin = trippingLedger.map((e) => ({ ...e, intensityFactor: e.plannedType === "VO2max" ? 1.11 : 0.93 }));
    expect(detectFtpRetest(thin, TODAY, 288)).toBeNull(); // all over, but mean +0.01 < 0.02
  });

  it("respects each entry's frozen per-athlete band offset (ROADMAP #2)", () => {
    const shifted = trippingLedger.map((e) => ({ ...e, calibration: { ifBandOffset: 0.06 } }));
    expect(detectFtpRetest(shifted, TODAY, 288)).toBeNull(); // tops move to 0.98 / 1.16 — nothing is over
  });

  it("counts only sessions scored against the CURRENT FTP — a re-test resets the window", () => {
    const reTested = trippingLedger.map((e) => ({ ...e, ftpUsed: 260 }));
    expect(detectFtpRetest(reTested, TODAY, 288)).toBeNull(); // old-FTP evidence must not nag post-re-test
  });

  it("gates on completion and skips non-anchored / IF-less / off-plan entries", () => {
    const noisy = [
      ...trippingLedger.slice(0, 3),
      mk({ date: "2026-06-29", compliancePct: 70 }), // cut short / blown up — not threshold evidence
      mk({ date: "2026-06-30", plannedType: "Z2", inferredType: "Z2" }), // not FTP-anchored
      mk({ date: "2026-07-01", intensityFactor: null }),
      mk({ date: "2026-07-02", planned: false, plannedType: null }),
    ];
    expect(detectFtpRetest(noisy, TODAY, 288)).toBeNull(); // only 3 qualify — below the gate
  });

  it("returns null without a current FTP", () => {
    expect(detectFtpRetest(trippingLedger, TODAY, null)).toBeNull();
  });

  it("takes overridden thresholds — the ROADMAP #2 calibration hook", () => {
    const sig = detectFtpRetest(trippingLedger.slice(0, 3), TODAY, 288, { ...FTP_RETEST_DEFAULTS, minSessions: 3 });
    expect(sig).toMatchObject({ n: 3, overCount: 3 });
  });
});
