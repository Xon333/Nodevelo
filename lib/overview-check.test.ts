import { describe, expect, it } from "vitest";
import { checkOverviewAgainstFacts, extractBlockFacts, type WeekFacts } from "./overview-check";
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

const week = (over: Partial<WeekFacts>): WeekFacts => ({
  weekNumber: 1,
  isRecovery: false,
  totalHours: 12,
  qualityCounts: { Threshold: 1 },
  longestRideMinutes: 240,
  ...over,
});

describe("checkOverviewAgainstFacts", () => {
  it("returns [] when the overview agrees with the schedule", () => {
    const warnings = checkOverviewAgainstFacts(
      "Week 1 is a 12-hour week built around a threshold session.",
      [week({})],
    );
    expect(warnings).toEqual([]);
  });

  it("flags a stated hour total that contradicts the scheduled total for that week", () => {
    const warnings = checkOverviewAgainstFacts("Week 1 is a big 16-hour building week.", [week({})]);
    expect(warnings).toEqual([
      "Overview says 16h for week 1, but the scheduled total is 12h.",
    ]);
  });

  it("keeps decimal hour totals inside one sentence", () => {
    expect(checkOverviewAgainstFacts("Week 1 is a 14.5-hour building week.", [week({})])).toEqual([
      "Overview says 14.5h for week 1, but the scheduled total is 12h.",
    ]);
  });

  it("flags a session type named in a week the schedule does not give it to", () => {
    const weeks = [week({}), week({ weekNumber: 2, totalHours: 10, qualityCounts: { VO2max: 1, Threshold: 1 } })];
    const warnings = checkOverviewAgainstFacts(
      "Week 1 centers on VO2max work. Week 2 is a 10-hour maintenance week around threshold.",
      weeks,
    );
    expect(warnings).toEqual([
      'Overview names "VO2max" in week 1, but no VO2max session is scheduled that week.',
    ]);
  });

  it("does not attribute one week's session type to another week in the same sentence", () => {
    const weeks = [
      week({ qualityCounts: { RaceSim: 1 } }),
      week({ weekNumber: 2, qualityCounts: { Threshold: 1 } }),
    ];
    expect(
      checkOverviewAgainstFacts(
        "Week 1 includes RaceSim work — while Week 2 progresses threshold work.",
        weeks,
      ),
    ).toEqual([]);
  });

  it("flags the historical false SIT-escalation claim once", () => {
    const warnings = checkOverviewAgainstFacts(
      "Week 1 escalates SIT work from one session to two.",
      [week({ qualityCounts: { Threshold: 1 } }), week({ weekNumber: 2, qualityCounts: { Threshold: 1 } })],
    );
    expect(warnings).toEqual([
      'Overview claims escalating SIT work in week 1, but no SIT session is scheduled that week.',
    ]);
  });

  it("flags the historical four-hour description of a 190-minute ride", () => {
    const warnings = checkOverviewAgainstFacts(
      "Week 1 includes a four-hour ride.",
      [week({ longestRideMinutes: 190 })],
    );
    expect(warnings).toEqual([
      "Overview describes a 4-hour ride in week 1, but the longest scheduled ride is 190 minutes.",
    ]);
  });

  it("checks a final sentence without terminal punctuation", () => {
    expect(checkOverviewAgainstFacts("Week 1 includes an eight-hour ride", [week({})])).toEqual([
      "Overview describes a 8-hour ride in week 1, but the longest scheduled ride is 240 minutes.",
    ]);
  });

  it("never mutates the overview — warnings only", () => {
    const overview = "Week 1 is a 12-hour week.";
    checkOverviewAgainstFacts(overview, [week({})]);
    expect(overview).toBe("Week 1 is a 12-hour week.");
  });
});
