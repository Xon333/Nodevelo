import { NextResponse } from "next/server";
import { askCoach, isAnthropicConfigured, type AskCoachSession } from "@/lib/anthropic-api";
import { readCurrentBlock } from "@/lib/data-store";

export const maxDuration = 60;

// Low-token spot-check: only today's planned session + the athlete's question are sent to a
// cheap model. No historical ledger, no sync — fast and rock-bottom cost.
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
  const query = typeof (body as Record<string, unknown>)?.query === "string" ? ((body as Record<string, unknown>).query as string).trim() : "";
  if (!query) return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  if (query.length > 600) return NextResponse.json({ error: "Question is too long (max 600 chars)." }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  const block = await readCurrentBlock();
  const day = block?.days.find((d) => d.date === today) ?? null;
  const session: AskCoachSession | null =
    day && day.durationMin > 0
      ? {
          name: day.name,
          type: day.type,
          durationMin: day.durationMin,
          intervals: (day.prescription ?? []).map((p) => p.label),
        }
      : null;

  try {
    const answer = await askCoach(session, query);
    return NextResponse.json({ answer });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Ask failed." }, { status: 502 });
  }
}
