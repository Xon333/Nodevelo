import { NextResponse } from "next/server";
import { readCurrentBlock, readDispositions, readScoreLog } from "@/lib/data-store";
import { suggestReschedule, type DispositionByDate } from "@/lib/reschedule";
import { persistMirroredMove } from "@/lib/calendar-mirror";
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

function parseBody(body: unknown): { from: string; to: string; today: string } | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const from = typeof b.from === "string" ? b.from : null;
  const to = typeof b.to === "string" ? b.to : null;
  if (!from || !to) return null;
  return { from, to, today: resolveToday(b.today) };
}

// Shared prologue for POST/PUT/PATCH: parse the body, load the block, and look up both days — each
// verb's own move/swap/make-up rules (future-only, content-vs-rest requirements) stay in the handler,
// since those genuinely differ per verb.
async function loadRescheduleContext(
  req: Request
): Promise<{ block: CurrentBlock; fromDay: CurrentBlockDay; toDay: CurrentBlockDay; p: { from: string; to: string; today: string } } | NextResponse> {
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

  return { block, fromDay, toDay, p };
}

// POST { from, to, today } → make up the missed `from` session on the `to` rest day (athlete-confirmed).
// `from` stays as history; the calendar mirror writes the workout onto `to`.
export async function POST(req: Request) {
  const ctx = await loadRescheduleContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { block, fromDay, p } = ctx;
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
  const { mirrored, failed: mirrorFailed } = await persistMirroredMove(block, days, [{ from: p.from, to: p.to }], p.today);
  return NextResponse.json({ ok: true, mirrored, mirrorFailed });
}

// PUT { from, to, today } → MANUAL move (§7 lean slice): shift a future planned session to a clear
// rest/empty day. Unlike the make-up POST, `from` genuinely vacates (becomes a rest day) — this is
// "I can't ride Thursday, make it Friday," not "I missed it."
export async function PUT(req: Request) {
  const ctx = await loadRescheduleContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { block, fromDay, toDay, p } = ctx;
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
  const { mirrored, failed: mirrorFailed } = await persistMirroredMove(block, days, [{ from: p.from, to: p.to }], p.today);
  return NextResponse.json({ ok: true, mirrored, mirrorFailed });
}

// PATCH { from, to, today } → SWAP two occupied sessions (§7 follow-on): both days trade their full
// content, symmetrically. Unlike PUT (move onto a clear rest day), neither side becomes Rest — this
// is "swap Tuesday's Threshold with Saturday's long ride," not "move X onto empty space." Each day's
// content carries its OWN eventId to its new date (mirrors PUT's precedent of always stamping the
// source's eventId onto the destination in the local write) — if the calendar mirror is configured
// and succeeds, persistMirroredMove overwrites both with the freshly-created events' real ids anyway;
// this only matters as the value that survives when isIntervalsConfigured() is false.
export async function PATCH(req: Request) {
  const ctx = await loadRescheduleContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { block, fromDay, toDay, p } = ctx;
  if (p.from === p.to) return NextResponse.json({ error: "from and to must be different days." }, { status: 400 });
  if (p.from < p.today) return NextResponse.json({ error: "Can't swap a past session." }, { status: 400 });
  if (p.to < p.today) return NextResponse.json({ error: "Can't swap onto a past day." }, { status: 400 });
  if (fromDay.durationMin <= 0 || fromDay.type === "Rest") {
    return NextResponse.json({ error: `${p.from} has no session — use Move instead.` }, { status: 400 });
  }
  if (toDay.durationMin <= 0 || toDay.type === "Rest") {
    return NextResponse.json({ error: `${p.to} has no session — use Move instead.` }, { status: 400 });
  }

  const { date: _fd, eventId: _fe, ...fromContent } = fromDay;
  const { date: _td, eventId: _te, ...toContent } = toDay;
  const days = block.days.map((d) => {
    if (d.date === p.to) return { date: p.to, ...fromContent, ...(typeof fromDay.eventId === "number" ? { eventId: fromDay.eventId } : {}) };
    if (d.date === p.from) return { date: p.from, ...toContent, ...(typeof toDay.eventId === "number" ? { eventId: toDay.eventId } : {}) };
    return d;
  });
  const { mirrored, failed: mirrorFailed } = await persistMirroredMove(
    block,
    days,
    [{ from: p.from, to: p.to }, { from: p.to, to: p.from }],
    p.today
  );
  return NextResponse.json({ ok: true, mirrored, mirrorFailed });
}
