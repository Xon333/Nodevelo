// Converts structured PlannedDay objects into Intervals.icu event payloads.
//
// The legacy regex text-parser (parsePlan) was retired once tool-use / structured output became
// the proven, sole generation path — see app/api/generate/route.ts, which now derives PlannedDays
// from the validated tool payload via lib/plan-schema.ts.
import type { IntervalsEventPayload, PlannedDay } from "./types";

// ---------- Intervals.icu event conversion ----------

// For WORKOUT events Intervals.icu parses "- 10m 65%" step lines out of the
// description; plain-text lines (our nutrition block) remain as notes.
export function planDayToEvent(day: PlannedDay): IntervalsEventPayload {
  const startDateLocal = `${day.date}T00:00:00`;
  if (day.type === "Rest") {
    return {
      category: "NOTE",
      start_date_local: startDateLocal,
      name: day.name || "Rest day",
      description: day.description,
    };
  }
  const isStrength = day.type === "Strength";
  const description = [day.workoutText.trim(), day.description.trim()]
    .filter(Boolean)
    .join("\n\n");
  return {
    category: "WORKOUT",
    start_date_local: startDateLocal,
    name: day.name,
    type: isStrength ? "WeightTraining" : "Ride",
    description,
    // Rides get their time from parsed steps; strength has no steps.
    ...(isStrength && day.durationMin > 0 ? { moving_time: day.durationMin * 60 } : {}),
  };
}
