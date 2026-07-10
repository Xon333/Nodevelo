import { NextResponse } from "next/server";
import { readCurrentBlock, readDispositions, readScoreLog, writeCurrentBlock } from "@/lib/data-store";
import { suggestReschedule, type DispositionByDate } from "@/lib/reschedule";
import { applyCalendarMirror, type PlannedMove } from "@/lib/calendar-mirror";
import { isIntervalsConfigured } from "@/lib/intervals-api";
import { resolveToday } from "@/lib/date";
import type { CurrentBlock, CurrentBlockDay } from "@/lib/types";

// GET → the current reschedule suggestion (or null). `today` comes from the client (local date),
// falling back to UTC — the previous inline toISOString() drifted a day near midnight (AGENTS.md
// recurring bug class; fixed here).
export async function GET(req: Request) {
  const today = resolveToday(new URL(req.url).searchParams.get("today"));
  const [block, scoreLog, dispositions] = await Promise.all([readCurrentBlock(), readScoreLog(), readDispositions()]);
  const scoredDates = new Set(scoreLog.entries.map((e) => e.date));
  const dispositionByDate: DispositionByDate = Object.fromEntries(dispositions.entries.map((e) => [e.date, e.disposition]));
  return NextResponse.json({ suggestion: suggestReschedule(block, scoredDates, dispositionByDate, today) });
}

// Shared: persist the local change, then best-effort mirror to the Intervals.icu calendar. The local
// move ALWAYS stands; a mirror failure is surfaced, never a rollback (the athlete can re-sync later).
async function persistAndMirror(block: CurrentBlock, days: CurrentBlockDay[], moves: PlannedMove[], today: string) {
  let updated: CurrentBlock = { ...block, days };
  let mirrored: string[] = [];
  let mirrorFailed: string[] = [];
  if (isIntervalsConfigured()) {
    try {
      const res = await applyCalendarMirror(updated, moves, today);
      updated = res.updatedBlock;
      mirrored = res.mirrored;
      mirrorFailed = res.failed;
    } catch {
      mirrorFailed = moves.flatMap((m) => (m.to ? [m.from, m.to] : [m.from]));
    }
  }
  await writeCurrentBlock(updated);
  return { mirrored, mirrorFailed };
}

function parseBody(body: unknown): { from: string; to: string; today: string } | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const from = typeof b.from === "string" ? b.from : null;
  const to = typeof b.to === "string" ? b.to : null;
  if (!from || !to) return null;
  return { from, to, today: resolveToday(b.today) };
}

// POST { from, to, today } → make up the missed `from` session on the `to` rest day (athlete-confirmed).
// `from` stays as history; the calendar mirror writes the workout onto `to`.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const p = parseBody(body);
  if (!p) return NextResponse.json({ error: "from and to dates are required." }, { status: 400 });

  const block = await readCurrentBlock();
  if (!block) return NextResponse.json({ error: "No active block." }, { status: 400 });
  const fromDay = block.days.find((d) => d.date === p.from);
  const toDay = block.days.find((d) => d.date === p.to);
  if (!fromDay || !toDay) return NextResponse.json({ error: "from/to not in the current block." }, { status: 400 });
  if (p.to <= p.today) return NextResponse.json({ error: "Can only reschedule onto a future day." }, { status: 400 });

  const days = block.days.map((d) =>
    d.date === p.to
      ? {
          ...d,
          name: fromDay.name,
          type: fromDay.type,
          durationMin: fromDay.durationMin,
          ...(fromDay.workoutText ? { workoutText: fromDay.workoutText } : {}),
          ...(fromDay.prescription ? { prescription: fromDay.prescription } : {}),
        }
      : d
  );
  const { mirrored, mirrorFailed } = await persistAndMirror(block, days, [{ from: p.from, to: p.to }], p.today);
  return NextResponse.json({ ok: true, mirrored, mirrorFailed });
}

// PUT { from, to, today } → MANUAL move (§7 lean slice): shift a future planned session to a clear
// rest/empty day. Unlike the make-up POST, `from` genuinely vacates (becomes a rest day) — this is
// "I can't ride Thursday, make it Friday," not "I missed it."
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const p = parseBody(body);
  if (!p) return NextResponse.json({ error: "from and to dates are required." }, { status: 400 });

  const block = await readCurrentBlock();
  if (!block) return NextResponse.json({ error: "No active block." }, { status: 400 });
  const fromDay = block.days.find((d) => d.date === p.from);
  const toDay = block.days.find((d) => d.date === p.to);
  if (!fromDay || !toDay) return NextResponse.json({ error: "from/to not in the current block." }, { status: 400 });
  if (p.from < p.today) return NextResponse.json({ error: "Can't move a past session." }, { status: 400 });
  if (p.to < p.today) return NextResponse.json({ error: "Can't move onto a past day." }, { status: 400 });
  if (fromDay.durationMin <= 0 || fromDay.type === "Rest") return NextResponse.json({ error: "Nothing planned on the from day." }, { status: 400 });
  if (toDay.durationMin > 0 && toDay.type !== "Rest") return NextResponse.json({ error: `${toDay.name} is already planned on ${p.to} — move onto a rest day.` }, { status: 400 });

  const { date: _d, eventId: _e, ...content } = fromDay;
  const days = block.days.map((d) => {
    if (d.date === p.to) return { date: p.to, ...content, ...(typeof fromDay.eventId === "number" ? { eventId: fromDay.eventId } : {}) };
    if (d.date === p.from) return { date: p.from, name: `Rest (moved to ${p.to})`, type: "Rest" as CurrentBlockDay["type"], durationMin: 0 };
    return d;
  });
  const { mirrored, mirrorFailed } = await persistAndMirror(block, days, [{ from: p.from, to: p.to }], p.today);
  return NextResponse.json({ ok: true, mirrored, mirrorFailed });
}
