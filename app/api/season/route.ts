import { NextResponse } from "next/server";
import { readSeasonPlan, updateSeasonPlan } from "@/lib/data-store";
import { findUpcomingAEvent, projectSeasonOutlook, SEASON_SHAPES_GENERATION, validateSeasonPlanInput } from "@/lib/season";
import { gatherFocusInputs } from "@/lib/season-signals";
import { resolveToday } from "@/lib/date";

export async function GET(req: Request) {
  const today = resolveToday(new URL(req.url).searchParams.get("today"));
  const plan = await readSeasonPlan();
  // Roadmap preview (season-roadmap-preview §6): a stateless projection, computed fresh on every
  // request, never persisted. Only for the rolling case (no upcoming A-event — event mode already
  // shows a real, committed arc from `plan.periods`) and only while SEASON_SHAPES_GENERATION is on
  // (this is exactly the "phase-derived opinion" the flag exists to gate — centralizing the check here
  // means every consumer (SeasonRoadmap, PlanView) gets it for free instead of re-checking the flag
  // itself).
  const aEvent = findUpcomingAEvent(plan.events, today);
  const outlook = SEASON_SHAPES_GENERATION && !aEvent ? projectSeasonOutlook(await gatherFocusInputs({ today }), today) : null;
  return NextResponse.json({ plan, outlook });
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = validateSeasonPlanInput(body);
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  // HR-58: read-modify-write inside the lock (updateSeasonPlan) instead of a separate read then a
  // separate write — closes the same lost-update race /api/generate's own season persistence had:
  // this save and a concurrent /api/generate call could otherwise each read the same stale base and
  // clobber one another's periods/objective+events.
  const plan = await updateSeasonPlan((current) => ({ ...current, objective: parsed.objective, events: parsed.events }));
  return NextResponse.json({ plan });
}
