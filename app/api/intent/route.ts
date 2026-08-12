import { NextResponse } from "next/server";
import { resolveToday } from "@/lib/date";
import { runIntentParsing } from "@/lib/intent-runner";

export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { today?: unknown; force?: unknown; skip?: unknown } | null = null;
  try {
    body = await req.json();
  } catch {
    /* no body — local-date resolver fallback */
  }

  const today = resolveToday(body?.today);
  const warnings: string[] = [];
  const result = await runIntentParsing(today, warnings, {
    force: body?.force === true,
    skip: Array.isArray(body?.skip) ? body.skip.filter((id): id is string => typeof id === "string") : [],
  });
  return NextResponse.json({ ...result, warnings });
}
