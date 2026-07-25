import { describe, expect, it } from "vitest";
import {
  buildNarrativeCriticPrompt,
  extractBlockFacts,
  formatBlockFacts,
  parseNarrativeCriticOutput,
  type WeekFacts,
} from "./narrative-critic";
import type { PlannedDay } from "./types";
import type { WeekTarget } from "./block-skeleton";

function day(date: string, weekNumber: number, type: PlannedDay["type"], durationMin: number): PlannedDay {
  return { date, weekNumber, weekTheme: "t", name: type, type, durationMin, workoutText: "", description: "x" };
}

describe("extractBlockFacts", () => {
  const targets: WeekTarget[] = [
    { weekNumber: 1, isRecovery: false, targetHours: 12 },
    { weekNumber: 2, isRecovery: true, targetHours: 7 },
  ];

  it("computes total hours, quality-type counts, and the longest ride per week", () => {
    const days = [
      day("2026-07-27", 1, "Threshold", 75),
      day("2026-07-28", 1, "SIT", 53),
      day("2026-07-29", 1, "Z2", 190),
      day("2026-08-03", 2, "Rest", 0),
      day("2026-08-04", 2, "Z2", 60),
    ];
    const facts = extractBlockFacts(days, targets);
    expect(facts).toEqual([
      { weekNumber: 1, isRecovery: false, totalHours: 5.3, qualityCounts: { Threshold: 1, SIT: 1 }, longestRideMinutes: 190 },
      { weekNumber: 2, isRecovery: true, totalHours: 1, qualityCounts: {}, longestRideMinutes: 60 },
    ]);
  });

  it("still reports a week with zero generated days, rather than dropping it", () => {
    const facts = extractBlockFacts([day("2026-07-27", 1, "Z2", 90)], targets);
    const week2 = facts.find((f) => f.weekNumber === 2);
    expect(week2).toEqual({ weekNumber: 2, isRecovery: true, totalHours: 0, qualityCounts: {}, longestRideMinutes: 0 });
  });
});

describe("formatBlockFacts", () => {
  it("renders one line per week naming type counts and the longest ride", () => {
    const facts: WeekFacts[] = [
      { weekNumber: 1, isRecovery: false, totalHours: 12, qualityCounts: { SIT: 2, Threshold: 1 }, longestRideMinutes: 190 },
      { weekNumber: 2, isRecovery: true, totalHours: 7, qualityCounts: {}, longestRideMinutes: 60 },
    ];
    const text = formatBlockFacts(facts);
    expect(text).toContain("Week 1 (loading): 12h total, quality sessions: 2x SIT, 1x Threshold, longest single ride: 190min.");
    expect(text).toContain("Week 2 (recovery): 7h total, quality sessions: none, longest single ride: 60min.");
  });
});

describe("buildNarrativeCriticPrompt", () => {
  it("includes both the written overview and the extracted facts, and asks for a same-length correction", () => {
    const facts: WeekFacts[] = [{ weekNumber: 1, isRecovery: false, totalHours: 12, qualityCounts: { SIT: 2 }, longestRideMinutes: 190 }];
    const prompt = buildNarrativeCriticPrompt("This block escalates SIT load.", facts);
    expect(prompt).toContain("This block escalates SIT load.");
    expect(prompt).toContain("Week 1 (loading): 12h total, quality sessions: 2x SIT");
    expect(prompt).toMatch(/return it completely unchanged/);
  });
});

describe("parseNarrativeCriticOutput", () => {
  it("accepts a well-formed tool response", () => {
    expect(parseNarrativeCriticOutput({ accurate: true, overview: "x" })).toEqual({ accurate: true, overview: "x" });
  });
  it("rejects a malformed response", () => {
    expect(parseNarrativeCriticOutput({ accurate: true })).toBeNull();
    expect(parseNarrativeCriticOutput(null)).toBeNull();
  });
});
