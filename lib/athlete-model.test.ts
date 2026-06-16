import { describe, expect, it } from "vitest";
import { buildAthleteModel, deriveInsights } from "./athlete-model";
import type { RideScoreEntry, WorkoutType } from "./types";

let day = 0;
const entry = (type: WorkoutType, executionScore: number, compliancePct: number | null = 100): RideScoreEntry => ({
  date: `2026-01-${String(++day).padStart(2, "0")}`,
  executionScore,
  plannedType: type,
  inferredType: type,
  planned: true,
  legacy: false,
  compliancePct,
  intensityFactor: null,
  ftpUsed: 288,
  durationMin: 60,
  tss: null,
});

describe("buildAthleteModel", () => {
  it("aggregates per type and overall with recency weighting", () => {
    day = 0;
    const scores = [entry("VO2max", 4), entry("VO2max", 5), entry("VO2max", 4), entry("Z2", 9), entry("Z2", 9)];
    const m = buildAthleteModel(scores);
    const vo2 = m.byType.find((t) => t.type === "VO2max")!;
    const z2 = m.byType.find((t) => t.type === "Z2")!;
    expect(vo2.n).toBe(3);
    expect(vo2.execEwma).toBeLessThan(z2.execEwma);
    expect(m.sampleSize).toBe(5);
  });

  it("windows recent behaviour to ~8 weeks but keeps the full ledger in behaviourAllTime", () => {
    // Old off-plan block (>8 weeks before the latest ride) + a recent on-plan block.
    const old = (date: string): RideScoreEntry => ({ ...entry("Z2", 6), date, planned: false, plannedType: null });
    const recent = (date: string): RideScoreEntry => ({ ...entry("Z2", 8), date, planned: true });
    const scores = [
      old("2026-01-05"), old("2026-01-08"), old("2026-01-12"),
      recent("2026-05-01"), recent("2026-05-08"), recent("2026-05-15"),
    ];
    const m = buildAthleteModel(scores);
    // Recent window (anchored to 2026-05-15) excludes January → 0% off-plan now…
    expect(m.behaviour.offPlanPct).toBe(0);
    expect(m.behaviour.totalRides).toBe(3);
    // …but the 6-month view still sees the old off-plan riding.
    expect(m.behaviourAllTime.offPlanPct).toBe(50);
    expect(m.behaviourAllTime.totalRides).toBe(6);
  });

  it("excludes legacy (pre-first-block) rides from behaviour", () => {
    const legacyRide = (date: string): RideScoreEntry => ({ ...entry("Z2", 6), date, planned: false, plannedType: null, legacy: true });
    const live = (date: string): RideScoreEntry => ({ ...entry("Z2", 8), date, planned: true });
    const m = buildAthleteModel([
      legacyRide("2026-02-01"), legacyRide("2026-02-03"), // stored, but not counted
      live("2026-02-10"), live("2026-02-12"),
    ]);
    expect(m.behaviourAllTime.totalRides).toBe(2); // only the non-legacy rides
    expect(m.behaviourAllTime.offPlanPct).toBe(0);
  });
});

describe("deriveInsights", () => {
  it("flags a weak interval type as an alert", () => {
    day = 0;
    const scores = [entry("VO2max", 4), entry("VO2max", 5), entry("VO2max", 4), entry("VO2max", 5)];
    const insights = deriveInsights(buildAthleteModel(scores));
    const vo2 = insights.find((i) => i.dimension === "VO2max")!;
    expect(vo2.severity).toBe("alert");
  });

  it("flags consistent under-delivery as a watch", () => {
    day = 0;
    const scores = [entry("Threshold", 7, 70), entry("Threshold", 7, 65), entry("Threshold", 7, 72)];
    const insights = deriveInsights(buildAthleteModel(scores));
    const t = insights.find((i) => i.dimension === "Threshold")!;
    expect(t.severity).toBe("watch");
  });

  it("celebrates a strong, stable type and stays silent below the observation floor", () => {
    day = 0;
    const strong = deriveInsights(buildAthleteModel([entry("Z2", 9), entry("Z2", 8), entry("Z2", 9), entry("Z2", 9)]));
    expect(strong.find((i) => i.dimension === "Z2")?.severity).toBe("good");

    day = 0;
    const tooFew = deriveInsights(buildAthleteModel([entry("SIT", 3), entry("SIT", 3)]));
    expect(tooFew.find((i) => i.dimension === "SIT")).toBeUndefined();
  });
});
