import { NextResponse } from "next/server";
import { readDispositions, readScoreLog, writeDispositions, writeScoreLog } from "@/lib/data-store";
import { applyDispositions, mergeDisposition } from "@/lib/disposition";
import type { CompromiseReason, DispositionEntry, SessionDisposition } from "@/lib/types";

const DISPOSITIONS: SessionDisposition[] = ["completed", "partial", "missed", "compromised"];
const REASONS: CompromiseReason[] = ["equipment", "sickness", "weather", "other"];

// GET → the disposition for a given ?date (or today).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const log = await readDispositions();
  return NextResponse.json({ disposition: log.entries.find((e) => e.date === date) ?? null });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
  if (!date) return NextResponse.json({ error: "A valid date is required." }, { status: 400 });
  if (!DISPOSITIONS.includes(b.disposition as SessionDisposition)) {
    return NextResponse.json({ error: "Invalid disposition." }, { status: 400 });
  }
  const disposition = b.disposition as SessionDisposition;
  const reason =
    disposition === "compromised" && REASONS.includes(b.reason as CompromiseReason)
      ? (b.reason as CompromiseReason)
      : null;

  const entry: DispositionEntry = { date, disposition, reason, setAt: new Date().toISOString() };
  const log = await readDispositions();
  const entries = mergeDisposition(log.entries, entry);
  await writeDispositions({ entries, updatedAt: new Date().toISOString() });

  // Re-stamp the ledger immediately so the learning gate + metrics reflect this without
  // waiting for the next sync (sync re-derives the same flag, idempotently).
  try {
    const scoreLog = await readScoreLog();
    await writeScoreLog({ entries: applyDispositions(scoreLog.entries, entries), updatedAt: new Date().toISOString() });
  } catch {
    // best-effort — the next sync will re-derive
  }

  return NextResponse.json({ disposition: entry });
}
