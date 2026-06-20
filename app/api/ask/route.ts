import { NextResponse } from "next/server";
import { isAnthropicConfigured, streamAskCoach, type AskCoachContext } from "@/lib/anthropic-api";
import { readCurrentBlock, readDispositions, readInterventionLog, readLastSync, readRollingBaselines, readScoreLog, readTodayAnalysis } from "@/lib/data-store";
import { readPhysiology } from "@/lib/physiology";
import { computeAcwr, computeLoadRamp, computeReadiness } from "@/lib/readiness";
import { buildAthleteModel, deriveInsights } from "@/lib/athlete-model";
import { athleteStateInputsFrom, computeAthleteState } from "@/lib/athlete-state";
import { summariseValidation } from "@/lib/intervention";
import { synthesizeCoachingDirectives } from "@/lib/synthesis";
import { weightTrendFromWellness } from "@/lib/nutrition";
import { buildCoachSnapshot } from "@/lib/coach-snapshot";

export const maxDuration = 60;

// Low-cost spot-check on a small model. It now shares the same situational data the ride
// analysis uses — block position, today's session, current form, FTP — but still skips the
// full historical ledger to stay cheap and fast.
export async function POST(req: Request) {
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: "Anthropic API is not configured." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const raw = (body as Record<string, unknown>)?.query;
  const query = typeof raw === "string" ? raw.trim() : "";
  if (!query) return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  if (query.length > 600) return NextResponse.json({ error: "Question is too long (max 600 chars)." }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  const [block, sync, physStore, todayAnalysis, dispositions, scoreLog, baselines, interventionLog] = await Promise.all([
    readCurrentBlock(),
    readLastSync(),
    readPhysiology(),
    readTodayAnalysis(),
    readDispositions(),
    readScoreLog(),
    readRollingBaselines(),
    readInterventionLog(),
  ]);

  // Today's + next prescribed sessions — the exact rep detail the snapshot only names by type, so
  // forward-looking questions ("how should I do tomorrow's SIT?") use the real plan, not guesses (PW-6).
  const day = block?.days.find((d) => d.date === today && d.durationMin > 0) ?? null;
  const session = day
    ? { name: day.name, type: day.type, durationMin: day.durationMin, intervals: (day.prescription ?? []).map((p) => p.label) }
    : null;
  const dayMs = 86_400_000;
  const nextDay =
    block?.days
      .filter((d) => d.date > today && d.durationMin > 0)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const upcoming = nextDay
    ? {
        inDays: Math.max(1, Math.round((Date.parse(nextDay.date) - Date.parse(today)) / dayMs)),
        name: nextDay.name,
        type: nextDay.type,
        durationMin: nextDay.durationMin,
        intervals: (nextDay.prescription ?? []).map((p) => p.label),
      }
    : null;

  // Resolve the situational signals (all deterministic) and fold them into the one CoachSnapshot
  // the prompt reads — so the coach answers from resolved numbers it can't invent or override.
  const athleteModel = buildAthleteModel(scoreLog.entries);
  const acwr = sync ? computeAcwr(sync.activities) : null;
  const snapshot = buildCoachSnapshot({
    date: today,
    ftp: physStore?.current.ftp ?? null,
    block,
    todaySessionType: day?.type ?? null,
    fitness: sync?.fitness ?? null,
    readiness: sync ? computeReadiness(sync.fitness, sync.wellness) : null,
    acwr,
    loadRamp: sync ? computeLoadRamp(sync.activities) : null,
    athleteState: sync ? computeAthleteState(athleteStateInputsFrom(sync, athleteModel, baselines, acwr)) : null,
    todayAnalysis,
    weightTrend7dKg: sync ? weightTrendFromWellness(sync.wellness) : null,
    directives: synthesizeCoachingDirectives(deriveInsights(athleteModel), summariseValidation(interventionLog)),
    disposition: dispositions.entries.find((e) => e.date === today) ?? null,
  });

  const context: AskCoachContext = { snapshot, session, upcoming };

  // Stream the reply as plain-text chunks so the UI renders tokens as they arrive. All the
  // validation above already returned JSON errors with proper status codes; once we start the
  // stream the response is 200 and a mid-stream failure surfaces as the stream erroring (the client
  // reader throws and shows the error). The athlete-facing answer is short, so plain text — not SSE.
  const encoder = new TextEncoder();
  const gen = streamAskCoach(context, query);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of gen) controller.enqueue(encoder.encode(chunk));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await gen.return(undefined); // client disconnected — stop pulling from Anthropic
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no", // don't let a proxy buffer the stream
    },
  });
}
