import { NextResponse } from "next/server";
import { logWarn } from "@/lib/log";
import { readDispositions, updateDispositions, updateScoreLog } from "@/lib/data-store";
import { applyDispositions, mergeDisposition } from "@/lib/disposition";
import { resolveToday } from "@/lib/date";
import type { CompromiseReason, DispositionEntry, SessionDisposition } from "@/lib/types";

const DISPOSITIONS: SessionDisposition[] = ["completed", "partial", "missed", "compromised"];
const REASONS: CompromiseReason[] = ["equipment", "sickness", "weather", "injury", "other"];

// GET → the disposition for a given ?date (or today — an optional client-supplied ?today, resolved
// the same way every other route resolves "today," instead of inlining a UTC-only computation here).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? resolveToday(url.searchParams.get("today"));
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
  // Transactional (CR-A): read+merge+write inside the per-file lock so concurrent disposition POSTs
  // can't clobber each other.
  const { entries } = await updateDispositions((cur) => mergeDisposition(cur, entry));

  // Re-stamp the ledger immediately so the learning gate + metrics reflect this without
  // waiting for the next sync (sync re-derives the same flag, idempotently). Transactional so it
  // can't lose a concurrent sync's freshly-written scores.
  try {
    await updateScoreLog((cur) => applyDispositions(cur, entries));
  } catch (err) {
    logWarn("/api/disposition", "re-stamp-ledger", err instanceof Error ? err.message : String(err), { date });
  }

  return NextResponse.json({ disposition: entry });
}
