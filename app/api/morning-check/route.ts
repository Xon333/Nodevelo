import { NextResponse } from "next/server";
import { readCurrentBlock, readMorningChecks, readTodayAnalysis, writeMorningChecks } from "@/lib/data-store";
import { decideMorningCheck, mergeMorningCheck, proactiveApplyBlock } from "@/lib/morning-check";
import { applyProactiveReschedule, suggestProactiveReschedule } from "@/lib/reschedule";
import { persistMirroredMove, type PlannedMove } from "@/lib/calendar-mirror";
import { resolveToday } from "@/lib/date";
import type { CurrentBlock, MorningCheckEntry, MorningCheckFlag, WorkoutType } from "@/lib/types";

const QUALITY = new Set<WorkoutType>(["Threshold", "VO2max", "SIT", "RaceSim"]);
const FLAGS: MorningCheckFlag[] = ["ill", "extreme-fatigue", "injury"];

// "today" is the CLIENT's local date (query param on GET, body field otherwise) so client + server agree
// across the UTC day boundary — same discipline as /api/sync (resolveToday falls back to UTC).

function isQualityToday(block: CurrentBlock | null, date: string): boolean {
  const day = block?.days.find((d) => d.date === date) ?? null;
  return !!day && day.durationMin > 0 && QUALITY.has(day.type);
}

// Is any ride planned today (quality or easy — anything with duration)? Injury can be reported on ANY ride
// day, not just quality ones (S2-9), so the surface needs this even when isQualityDay is false. A true rest
// day (duration 0 / no entry) has no ride to skip, so nothing is surfaced there.
function hasRideToday(block: CurrentBlock | null, date: string): boolean {
  const day = block?.days.find((d) => d.date === date) ?? null;
  return !!day && day.durationMin > 0;
}

// GET → today's stored flag (if any), whether today is a quality day, and the proactive reschedule target
// (so the UI can preview the move before applying).
export async function GET(req: Request) {
  const date = resolveToday(new URL(req.url).searchParams.get("today"));
  const [block, checks] = await Promise.all([readCurrentBlock(), readMorningChecks()]);
  return NextResponse.json({
    check: checks.entries.find((e) => e.date === date) ?? null,
    isQualityDay: isQualityToday(block, date),
    hasRideToday: hasRideToday(block, date),
    suggestion: suggestProactiveReschedule(block, date),
  });
}

// POST → set today's manual flag (feeling ill / extreme fatigue). Computes the deterministic decision
// (either flag downgrades a quality day), stores it, and returns the decision + the proposed move. Does
// NOT auto-apply.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (!FLAGS.includes(b.flag as MorningCheckFlag)) {
    return NextResponse.json({ error: "flag must be 'ill', 'extreme-fatigue', or 'injury'." }, { status: 400 });
  }
  const flag = b.flag as MorningCheckFlag;

  const date = resolveToday(b.today);
  const block = await readCurrentBlock();
  const { decision, reasons } = decideMorningCheck(flag, { isQualityDay: isQualityToday(block, date) });

  const entry: MorningCheckEntry = { date, flag, decision, setAt: new Date().toISOString() };
  const log = await readMorningChecks();
  await writeMorningChecks({ entries: mergeMorningCheck(log.entries, entry), updatedAt: new Date().toISOString() });

  return NextResponse.json({
    decision,
    reasons,
    // Only a "downgrade" moves the session, so only it carries a reschedule suggestion. "rest" (injury) is
    // a skip-today verdict with no swap target (S2-9); "proceed" has nothing to move.
    suggestion: decision === "downgrade" ? suggestProactiveReschedule(block, date) : null,
  });
}

// PUT → athlete-confirmed apply: downgrade today + move/swap/defer the quality stimulus, then best-effort
// mirror the change to the Intervals.icu calendar (never blocks the local move — a failure surfaces via
// mirrorFailed), matching the reactive /api/reschedule POST. Guarded: only applies when today's stored
// flag recommended a downgrade and the ride hasn't already been logged (the route is the contract, not
// just UI).
export async function PUT(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* no body — fall back to UTC today */
  }
  const date = resolveToday((body as Record<string, unknown> | null)?.today);
  const [block, checks, todayAnalysis] = await Promise.all([readCurrentBlock(), readMorningChecks(), readTodayAnalysis()]);
  if (!block) return NextResponse.json({ error: "No active block." }, { status: 400 });

  const check = checks.entries.find((e) => e.date === date) ?? null;
  const blocked = proactiveApplyBlock(check, todayAnalysis?.activityDate === date);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });

  const applied = applyProactiveReschedule(block, date);
  if (!applied) return NextResponse.json({ error: "Today isn't a quality day to downgrade." }, { status: 400 });
  const updated: CurrentBlock = { ...block, days: applied.days };
  // No make-up slot → carry the dropped stimulus forward so the next block re-prioritises it (CR-6).
  if (applied.deferred) updated.deferredQuality = [...(block.deferredQuality ?? []), applied.deferred];

  // A swap touches both dates (today ↔ the easy day); an honest deload only touches today (to: null).
  const moves: PlannedMove[] =
    applied.to !== null ? [{ from: date, to: applied.to }, { from: applied.to, to: date }] : [{ from: date, to: null }];
  const { mirrored, failed } = await persistMirroredMove(updated, updated.days, moves, date);

  return NextResponse.json({
    ok: true,
    to: applied.to,
    mirrored,
    mirrorFailed: failed,
    note: applied.to
      ? "Swapped with that day's easy ride — mirrored to your Intervals.icu calendar."
      : applied.skippedRestDay
        ? `Deloaded today — adding a hard session to your ${applied.skippedRestDay} rest day isn't worth it while you're compromised, so it carries to your next block.`
        : "Deloaded today; no make-up slot left this block — it's a priority for your next block.",
  });
}
