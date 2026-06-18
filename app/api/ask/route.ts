import { NextResponse } from "next/server";
import { askCoach, isAnthropicConfigured, type AskCoachContext } from "@/lib/anthropic-api";
import { readCurrentBlock, readDispositions, readLastSync, readTodayAnalysis } from "@/lib/data-store";
import { readPhysiology } from "@/lib/physiology";
import { computeAcwr, computeReadiness } from "@/lib/readiness";

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
  const [block, sync, physStore, todayAnalysis, dispositions] = await Promise.all([
    readCurrentBlock(),
    readLastSync(),
    readPhysiology(),
    readTodayAnalysis(),
    readDispositions(),
  ]);

  const blockCtx = block
    ? {
        goal: block.goal,
        weekOfBlock: Math.min(
          block.lengthWeeks,
          Math.max(1, Math.floor((Date.parse(today) - Date.parse(block.startDate)) / (7 * 86_400_000)) + 1)
        ),
        totalWeeks: block.lengthWeeks,
        overview: (block.overview ?? "").slice(0, 160),
      }
    : null;

  const day = block?.days.find((d) => d.date === today && d.durationMin > 0) ?? null;
  const session = day
    ? { name: day.name, type: day.type, durationMin: day.durationMin, intervals: (day.prescription ?? []).map((p) => p.label) }
    : null;

  // Next planned session after today — so forward-looking questions ("how should I do tomorrow's
  // SIT?") are answered from the real prescription, not a guessed rep structure (PW-6).
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

  let form: string | null = null;
  if (sync) {
    const parts: string[] = [];
    const tsb = sync.fitness.tsb;
    if (tsb !== null) parts.push(`TSB ${tsb > 0 ? "+" : ""}${tsb}`);
    const acwr = computeAcwr(sync.activities)?.level;
    if (acwr) parts.push(`ACWR ${acwr}`);
    const readiness = computeReadiness(sync.fitness, sync.wellness)?.level;
    if (readiness) parts.push(`readiness ${readiness}`);
    form = parts.length > 0 ? parts.join(", ") : null;
  }

  const rideLogged =
    todayAnalysis && todayAnalysis.activityDate === today
      ? `Today's ride is already logged${todayAnalysis.executionScore != null ? ` — execution ${todayAnalysis.executionScore}/10` : ""}.`
      : null;

  const disp = dispositions.entries.find((e) => e.date === today);
  const disposition =
    disp?.disposition === "compromised"
      ? `IMPORTANT: the athlete marked today's session COMPROMISED${disp.reason ? ` (${disp.reason})` : ""}. A low execution score reflects that, NOT under-recovery or under-fuelling — do not infer recovery debt or recommend skipping on the basis of it.`
      : disp?.disposition === "partial"
        ? "The athlete marked today's session partial (cut short)."
        : null;

  const context: AskCoachContext = {
    block: blockCtx,
    session,
    upcoming,
    form,
    ftp: physStore?.current.ftp ?? null,
    rideLogged,
    disposition,
  };

  try {
    const answer = await askCoach(context, query);
    return NextResponse.json({ answer });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Ask failed." }, { status: 502 });
  }
}
