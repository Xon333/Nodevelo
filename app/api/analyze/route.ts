import { NextResponse } from "next/server";
import { isAnthropicConfigured } from "@/lib/anthropic-api";
import { resolveToday } from "@/lib/date";
import { addCoachNote } from "@/lib/sync-analysis";

// The deferred AI step of a sync: /api/sync returns the deterministic analysis fast, then the
// client calls this to fill in the coach note (the slow LLM call), keeping the sync snappy and
// isolating an Anthropic hiccup from the data path.
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: "Anthropic API is not configured." }, { status: 400 });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* no body — UTC fallback */
  }
  const today = resolveToday((body as { today?: unknown } | null)?.today);
  const warnings: string[] = [];
  const todayAnalysis = await addCoachNote(today, warnings);
  return NextResponse.json({ todayAnalysis, warnings });
}
