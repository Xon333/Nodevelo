import { NextResponse } from "next/server";
import { createEvent, isIntervalsConfigured } from "@/lib/intervals-api";

// POST — write the coach analysis back to Intervals.icu calendar as a NOTE event.
export async function POST(req: Request) {
  if (!isIntervalsConfigured()) {
    return NextResponse.json({ error: "Intervals.icu not configured." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { date, activityName, coachNote, executionScore } = (body ?? {}) as Record<string, unknown>;

  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  }
  if (typeof coachNote !== "string" || !coachNote.trim()) {
    return NextResponse.json({ error: "coachNote is required." }, { status: 400 });
  }

  const scoreLine = typeof executionScore === "number" ? `\nExecution score: ${executionScore}/10` : "";
  const description = `[Velox coach] ${activityName ?? "Ride"}${scoreLine}\n\n${coachNote.trim()}`;

  try {
    const eventId = await createEvent({
      category: "NOTE",
      start_date_local: `${date}T00:00:00`,
      name: "Coach analysis",
      description,
    });
    return NextResponse.json({ ok: true, eventId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to post note" },
      { status: 502 }
    );
  }
}
