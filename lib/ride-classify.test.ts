import { describe, expect, it } from "vitest";
import { inferWorkoutType } from "./ride-classify";

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
