import { describe, expect, it } from "vitest";
import { inferredTypeLabel, inferWorkoutType } from "./ride-classify";

describe("inferWorkoutType", () => {
  it("buckets off-plan rides by intensity factor", () => {
    expect(inferWorkoutType(0.5, 60)).toBe("Recovery");
    expect(inferWorkoutType(0.65, 120)).toBe("Z2");
    expect(inferWorkoutType(0.82, 60)).toBe("Threshold");
    expect(inferWorkoutType(1.0, 50)).toBe("VO2max");
  });

  it("falls back on duration when there's no power", () => {
    expect(inferWorkoutType(null, 90)).toBe("Z2");
    expect(inferWorkoutType(null, 30)).toBe("Recovery");
  });
});

// NV-12 (2026-08-15): the broad 0.75-0.9 IF band (tempo / sweet-spot / threshold) reuses the same
// "Threshold" name as the real, narrower PRESCRIBED session type — live-confirmed misleading on the
// Trends hover title (both IF 0.78 and IF 0.82 off-plan rides showed "Threshold (off-plan)" while the
// coach note correctly called the latter "tempo"). Display-layer only: the underlying WorkoutType/
// inferredType value is unchanged.
describe("inferredTypeLabel", () => {
  it("relabels an off-plan Threshold inference as the neutral Tempo/Threshold band", () => {
    expect(inferredTypeLabel("Threshold", false)).toBe("Tempo/Threshold");
  });

  it("leaves a PRESCRIBED Threshold session's label untouched — it's a real, narrower type there", () => {
    expect(inferredTypeLabel("Threshold", true)).toBe("Threshold");
  });

  it("leaves every other off-plan inferred type untouched — only the broad Threshold band is ambiguous", () => {
    expect(inferredTypeLabel("Recovery", false)).toBe("Recovery");
    expect(inferredTypeLabel("Z2", false)).toBe("Z2");
    expect(inferredTypeLabel("VO2max", false)).toBe("VO2max");
  });
});
