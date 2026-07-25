import { NextResponse } from "next/server";
import { readSeasonPlan, updateSeasonPlan } from "@/lib/data-store";
import { findUpcomingAEvent, projectSeasonOutlook, validateSeasonPlanInput } from "@/lib/season";
import { gatherFocusInputs } from "@/lib/season-signals";
import { resolveToday } from "@/lib/date";

export async function GET(req: Request) {
  const today = resolveToday(new URL(req.url).searchParams.get("today"));
  const plan = await readSeasonPlan();
  // Roadmap preview (season-roadmap-preview §6): a stateless projection, computed fresh on every
  // request, never persisted. Only for the rolling case (no upcoming A-event — event mode already
  // shows a real, committed arc from `plan.periods`). P1 (2026-07-24): this projects the rolling,
  // state-scored chooseNextFocus selector, not the doubted fixed-phase-sequence model, so it's no
  // longer gated behind SEASON_SHAPES_GENERATION — that flag now only covers the event-anchored arc.
  const aEvent = findUpcomingAEvent(plan.events, today);
  const outlook = !aEvent ? projectSeasonOutlook(await gatherFocusInputs({ today }), today) : null;
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
