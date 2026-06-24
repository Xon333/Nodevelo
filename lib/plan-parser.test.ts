import { describe, expect, it } from "vitest";
import { planDayToEvent } from "./plan-parser";
import type { PlannedDay } from "./types";

// Hand-built PlannedDays standing in for what the generator's structured tool output yields
// (lib/plan-schema.ts). Previously derived from the retired regex parser's SAMPLE text.
const RIDE_DAY: PlannedDay = {
  date: "2026-06-15",
  weekNumber: 1,
  weekTheme: "Threshold foundation",
  name: "Threshold 3x12",
  type: "Threshold",
  durationMin: 75,
  workoutText: ["Warmup", "- 15m ramp 50-70%", "", "Main Set 3x", "- 12m 95%", "- 4m 55%", "", "Cooldown", "- 10m 50%"].join("\n"),
  description: [
    "Intent: Raise sustainable power with cumulative time at threshold.",
    "Pre-ride: 115 g carbs 2-3 h before (oats, banana, toast).",
    "In-ride: 75 g/hr from a 2:1 maltodextrin:fructose mix.",
    "Post-ride: 85 g carbs + 30 g protein within 60 min.",
    "Daily target: 3270 kcal.",
  ].join("\n"),
};

const RECOVERY_DAY: PlannedDay = {
  date: "2026-06-16",
  weekNumber: 1,
  weekTheme: "Threshold foundation",
  name: "Easy spin",
  type: "Recovery",
  durationMin: 45,
  workoutText: "- 45m 50%",
  description: "Intent: Flush the legs, nothing more.\nDaily target: 2620 kcal.",
};

const REST_DAY: PlannedDay = {
  date: "2026-06-17",
  weekNumber: 1,
  weekTheme: "Threshold foundation",
  name: "Rest",
  type: "Rest",
  durationMin: 0,
  workoutText: "",
  description: "Intent: Full recovery day.\nDaily target: 2600 kcal.",
};

describe("planDayToEvent", () => {
  it("converts ride days to WORKOUT events with steps + nutrition in the description", () => {
    const event = planDayToEvent(RIDE_DAY);
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
    const event = planDayToEvent(REST_DAY);
    expect(event.category).toBe("NOTE");
    expect(event.type).toBeUndefined();
    expect(event.description).toContain("Full recovery day");
  });

  it("gives strength days a WeightTraining type and moving_time", () => {
    const strength: PlannedDay = { ...RECOVERY_DAY, type: "Strength", workoutText: "", durationMin: 45 };
    const event = planDayToEvent(strength);
    expect(event.type).toBe("WeightTraining");
    expect(event.moving_time).toBe(45 * 60);
  });

  it("stamps a stable nodevelo-<date> uid so re-writes upsert instead of duplicating (idempotent)", () => {
    // The uid is what makes createEvent post upsertOnUid=true; re-writing or retrying a partial block
    // write then updates the same per-day event instead of creating a duplicate on the calendar.
    expect(planDayToEvent(RIDE_DAY).uid).toBe("nodevelo-2026-06-15"); // WORKOUT
    expect(planDayToEvent(REST_DAY).uid).toBe("nodevelo-2026-06-17"); // NOTE (rest)
    const strength: PlannedDay = { ...RECOVERY_DAY, type: "Strength" };
    expect(planDayToEvent(strength).uid).toBe(`nodevelo-${RECOVERY_DAY.date}`);
    // Deterministic: same day in → same uid out, so a retry can't duplicate.
    expect(planDayToEvent(RIDE_DAY).uid).toBe(planDayToEvent(RIDE_DAY).uid);
  });
});
