import { describe, expect, it } from "vitest";
import { buildAthleteModel, deriveInsights } from "./athlete-model";
import type { RideScoreEntry, WorkoutType } from "./types";

let day = 0;
const entry = (type: WorkoutType, executionScore: number, compliancePct: number | null = 100): RideScoreEntry => ({
  date: `2026-01-${String(++day).padStart(2, "0")}`,
  executionScore,
  plannedType: type,
  compliancePct,
  intensityFactor: null,
  ftpUsed: 288,
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
