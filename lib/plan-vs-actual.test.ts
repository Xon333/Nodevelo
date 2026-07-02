import { describe, expect, it } from "vitest";
import { aggregatePlanVsActual } from "./plan-vs-actual";
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
