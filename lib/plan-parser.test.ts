import { describe, expect, it } from "vitest";
import { parsePlan, planDayToEvent } from "./plan-parser";

const SAMPLE = `BLOCK OVERVIEW
This block develops FTP through progressive threshold work while maintaining
aerobic volume. Week 2 adds durability work late in long rides.

WEEK 1: Threshold foundation
DAY 2026-06-15: Threshold 3x12
  TYPE: Threshold
  DURATION: 75
  WORKOUT:
  Warmup
  - 15m ramp 50-70%

  Main Set 3x
  - 12m 95%
  - 4m 55%

  Cooldown
  - 10m 50%
  DESCRIPTION:
  Intent: Raise sustainable power with cumulative time at threshold.
  Pre-ride: 115 g carbs 2-3 h before (oats, banana, toast).
  In-ride: 75 g/hr from a 2:1 maltodextrin:fructose mix.
  Post-ride: 85 g carbs + 30 g protein within 60 min.
  Daily target: 3270 kcal.

DAY 2026-06-16: Easy spin
  TYPE: Recovery
  DURATION: 45
  WORKOUT:
  - 45m 50%
  DESCRIPTION:
  Intent: Flush the legs, nothing more.
  Pre-ride: Normal breakfast.
  Post-ride: 85 g carbs + 30 g protein with the next meal.
  Daily target: 2620 kcal.

DAY 2026-06-17: Rest
  TYPE: Rest
  DURATION: 0
  WORKOUT: Rest
  DESCRIPTION:
  Intent: Full recovery day.
  Daily target: 2600 kcal.
`;

describe("parsePlan", () => {
  it("extracts the overview, weeks and all days", () => {
    const result = parsePlan(SAMPLE);
    expect(result.overview).toContain("develops FTP");
    expect(result.days).toHaveLength(3);
    expect(result.days[0]).toMatchObject({
      date: "2026-06-15",
      name: "Threshold 3x12",
      type: "Threshold",
      durationMin: 75,
      weekNumber: 1,
      weekTheme: "Threshold foundation",
    });
  });

  it("captures multi-line workout text with repeat blocks intact", () => {
    const { days } = parsePlan(SAMPLE);
    expect(days[0].workoutText).toContain("Main Set 3x");
    expect(days[0].workoutText).toContain("- 12m 95%");
    expect(days[0].workoutText).toContain("Cooldown");
    // Description must not leak into the workout.
    expect(days[0].workoutText).not.toContain("Daily target");
  });

  it("captures the full description including nutrition lines", () => {
    const { days } = parsePlan(SAMPLE);
    expect(days[0].description).toContain("Intent: Raise sustainable power");
    expect(days[0].description).toContain("Daily target: 3270 kcal.");
  });

  it("treats rest days as having no structured workout", () => {
    const { days } = parsePlan(SAMPLE);
    expect(days[2].type).toBe("Rest");
    expect(days[2].workoutText).toBe("");
  });

  it("produces no warnings for a well-formed plan with matching dates", () => {
    const result = parsePlan(SAMPLE, ["2026-06-15", "2026-06-16", "2026-06-17"]);
    expect(result.warnings).toEqual([]);
  });

  it("warns about missing dates and unparseable content", () => {
    const result = parsePlan(SAMPLE, ["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18"]);
    expect(result.warnings.some((w) => w.includes("2026-06-18"))).toBe(true);
    expect(parsePlan("garbage with no structure").warnings).toContain(
      "No DAY entries could be parsed from the AI output."
    );
  });

  it("maps alias types and warns on unknown ones", () => {
    const text = SAMPLE.replace("TYPE: Threshold", "TYPE: Sweet Spot");
    const result = parsePlan(text);
    expect(result.days[0].type).toBe("Threshold");
  });

  it("warns when a ride day has no step lines", () => {
    const broken = SAMPLE.replace("- 45m 50%", "ride easy for a while");
    const result = parsePlan(broken);
    expect(result.warnings.some((w) => w.includes("2026-06-16") && w.includes("step"))).toBe(true);
  });
});

describe("planDayToEvent", () => {
  const days = parsePlan(SAMPLE).days;

  it("converts ride days to WORKOUT events with steps + nutrition in the description", () => {
    const event = planDayToEvent(days[0]);
    expect(event).toMatchObject({
      category: "WORKOUT",
      type: "Ride",
      name: "Threshold 3x12",
      start_date_local: "2026-06-15T00:00:00",
    });
    expect(event.description).toContain("- 12m 95%");
    expect(event.description).toContain("Daily target: 3270 kcal.");
    expect(event.moving_time).toBeUndefined();
  });

  it("converts rest days to NOTE events without a sport type", () => {
    const event = planDayToEvent(days[2]);
    expect(event.category).toBe("NOTE");
    expect(event.type).toBeUndefined();
    expect(event.description).toContain("Full recovery day");
  });

  it("gives strength days a WeightTraining type and moving_time", () => {
    const strength = { ...days[1], type: "Strength" as const, workoutText: "", durationMin: 45 };
    const event = planDayToEvent(strength);
    expect(event.type).toBe("WeightTraining");
    expect(event.moving_time).toBe(45 * 60);
  });
});
