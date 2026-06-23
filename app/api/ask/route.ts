import { NextResponse } from "next/server";
import { isAnthropicConfigured, streamAskCoach, type AskCoachContext } from "@/lib/anthropic-api";
import { readBlockSettings, readCurrentBlock, readDispositions, readInterventionLog, readLastSync, readMorningChecks, readRollingBaselines, readScoreLog, readTodayAnalysis } from "@/lib/data-store";
import { readPhysiology } from "@/lib/physiology";
import { buildCoachSnapshotFromSources } from "@/lib/coach-snapshot";
import { resolveToday } from "@/lib/date";

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

  const today = resolveToday((body as Record<string, unknown>)?.today);
  const [block, sync, physStore, todayAnalysis, dispositions, scoreLog, baselines, interventionLog, morningChecks, settings] = await Promise.all([
    readCurrentBlock(),
    readLastSync(),
    readPhysiology(),
    readTodayAnalysis(),
    readDispositions(),
    readScoreLog(),
    readRollingBaselines(),
    readInterventionLog(),
    readMorningChecks(),
    readBlockSettings(),
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

  // The one deterministic CoachSnapshot the prompt reads — so the coach answers from resolved numbers
  // it can't invent. The same builder feeds the Today card, so the athlete sees identical figures.
  const snapshot = buildCoachSnapshotFromSources({
    date: today,
    ftp: physStore?.current.ftp ?? null,
    block,
    sync,
    todayAnalysis,
    scoreEntries: scoreLog.entries,
    baselines,
    dispositions: dispositions.entries,
    interventionLog,
    morningChecks: morningChecks.entries,
    acwrBandsOverride: settings.acwrBands,
    tsbModifierEdgesOverride: settings.tsbModifierEdges,
    athleteStateWeightsOverride: settings.athleteStateWeights,
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
