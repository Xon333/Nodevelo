// Converts structured PlannedDay objects into Intervals.icu event payloads.
//
// The legacy regex text-parser (parsePlan) was retired once tool-use / structured output became
// the proven, sole generation path — see app/api/generate/route.ts, which now derives PlannedDays
// from the validated tool payload via lib/plan-schema.ts.
import type { IntervalsEventPayload, PlannedDay } from "./types";

// ---------- Intervals.icu event conversion ----------

// Shared Intervals.icu event payload shape — used by planDayToEvent below (a freshly-generated
// PlannedDay) and calendar-mirror.ts's dayToEventPayload (an existing CurrentBlockDay being
// re-upserted). The two inputs differ in how they source `description` and decide `isRest`, so
// those stay caller-computed; only the resulting payload construction is shared.
export function eventPayloadShape(day: {
  date: string;
  isRest: boolean;
  name: string;
  type: string;
  durationMin: number;
  description: string;
}): IntervalsEventPayload {
  const start_date_local = `${day.date}T00:00:00`;
  // One NodeVelo-owned event per calendar day. A stable external_id (the client idempotency key) makes
  // the block write idempotent: re-writing (or retrying a partial write of) a block upserts each day
  // instead of duplicating it, and a regenerated block cleanly replaces the prior NodeVelo event on the
  // same date. The `nodevelo-` prefix namespaces it so it never collides with the athlete's own events.
  const external_id = `nodevelo-${day.date}`;
  if (day.isRest) {
    return { category: "NOTE", start_date_local, name: day.name || "Rest day", description: day.description, external_id };
  }
  const isStrength = day.type === "Strength";
  return {
    category: "WORKOUT",
    start_date_local,
    name: day.name,
    type: isStrength ? "WeightTraining" : "Ride",
    description: day.description,
    external_id,
    // Rides get their time from parsed steps; strength has no steps.
    ...(isStrength && day.durationMin > 0 ? { moving_time: day.durationMin * 60 } : {}),
  };
}

// For WORKOUT events Intervals.icu parses "- 10m 65%" step lines out of the
// description; plain-text lines (our nutrition block) remain as notes.
export function planDayToEvent(day: PlannedDay): IntervalsEventPayload {
  const isRest = day.type === "Rest";
  const description = isRest
    ? day.description
    : [day.workoutText.trim(), day.description.trim()].filter(Boolean).join("\n\n");
  return eventPayloadShape({ date: day.date, isRest, name: day.name, type: day.type, durationMin: day.durationMin, description });
}
