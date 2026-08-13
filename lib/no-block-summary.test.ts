import { describe, expect, it } from "vitest";
import { composeNoBlockSummary } from "./no-block-summary";
import type { BehaviourSummary, SessionSuggestion, WeeklyEnvelope } from "./types";

const envelope = (over: Partial<WeeklyEnvelope> = {}): WeeklyEnvelope => ({
  weekStart: "2026-08-10",
  role: "build",
  range: { min: 600, max: 700 },
  previousRange: null,
  reductionApplied: false,
  reductionReason: null,
  calculationVersion: 1,
  resolvedAt: "2026-08-10T06:00:00.000Z",
  ...over,
});

const behaviour = (over: Partial<BehaviourSummary> = {}): BehaviourSummary => ({
  totalRides: 10,
  plannedRides: 3,
  unplannedRides: 7,
  offPlanPct: 20,
  driftAvgQuality: 6.5,
  weeklyHours: 8,
  ...over,
});

const suggestion: SessionSuggestion = {
  purpose: "aerobic base",
  structure: "mostly Z2, controlled climbing optional",
  durationRangeMin: [90, 120],
  expectedTssRange: [85, 115],
  reason: "weekly load is progressing normally, but recent high-intensity exposure means another threshold session adds little value today.",
};

describe("composeNoBlockSummary", () => {
  it("build role + fresh readiness reads as productive training with a Build headline", () => {
    const result = composeNoBlockSummary(
      envelope({ role: "build" }),
      suggestion,
      behaviour({ offPlanPct: 15, driftAvgQuality: 7 }),
      { level: "Build", reason: "TSB 5 — good conditions to train" },
      450
    );
    expect(result.headline.toLowerCase()).toMatch(/productive|build/);
  });

  it("Hold readiness reads as mild fatigue in the headline", () => {
    const result = composeNoBlockSummary(
      envelope({ role: "build" }),
      suggestion,
      behaviour(),
      { level: "Hold", reason: "TSB -5 — moderate load, stick to plan" },
      450
    );
    expect(result.headline.toLowerCase()).toMatch(/fatigue|hold/);
  });

  it("reproduces the design's own shared example: Productive training · mild fatigue", () => {
    const result = composeNoBlockSummary(
      envelope({ role: "build" }),
      suggestion,
      behaviour({ offPlanPct: 10, driftAvgQuality: 7 }),
      { level: "Hold", reason: "TSB -5 — moderate load, stick to plan" },
      450
    );
    expect(result.headline).toBe("Productive training · mild fatigue");
  });

  it("suggestion: null renders a body that omits the suggestion block entirely", () => {
    const result = composeNoBlockSummary(envelope(), null, behaviour(), { level: "Build", reason: "TSB 5" }, 450);
    expect(result.suggestion).toBeNull();
  });

  it("weeklyRange carries min/max/thisWeekTss, not just the raw envelope range", () => {
    const result = composeNoBlockSummary(
      envelope({ range: { min: 600, max: 700 } }),
      suggestion,
      behaviour(),
      { level: "Build", reason: "TSB 5" },
      450
    );
    expect(result.weeklyRange.min).toBe(600);
    expect(result.weeklyRange.max).toBe(700);
    expect(result.weeklyRange.thisWeekTss).toBe(450);
  });
});
