import { NextResponse } from "next/server";
import { readCurrentBlock, readDispositions, readScoreLog, writeCurrentBlock } from "@/lib/data-store";
import { suggestReschedule, type DispositionByDate } from "@/lib/reschedule";

// GET → the current reschedule suggestion (or null).
export async function GET() {
  const today = new Date().toISOString().slice(0, 10);
  const [block, scoreLog, dispositions] = await Promise.all([readCurrentBlock(), readScoreLog(), readDispositions()]);
  const scoredDates = new Set(scoreLog.entries.map((e) => e.date));
  const dispositionByDate: DispositionByDate = Object.fromEntries(dispositions.entries.map((e) => [e.date, e.disposition]));
  return NextResponse.json({ suggestion: suggestReschedule(block, scoredDates, dispositionByDate, today) });
}

// POST { from, to } → make up the missed `from` session on the `to` rest day. Athlete-confirmed.
// Local block only — the Intervals.icu calendar mutation is a separate (larger) step, so the
// response flags that the athlete should mirror the move there.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const from = typeof b.from === "string" ? b.from : null;
  const to = typeof b.to === "string" ? b.to : null;
  if (!from || !to) return NextResponse.json({ error: "from and to dates are required." }, { status: 400 });

  const block = await readCurrentBlock();
  if (!block) return NextResponse.json({ error: "No active block." }, { status: 400 });

  const fromDay = block.days.find((d) => d.date === from);
  const toDay = block.days.find((d) => d.date === to);
  if (!fromDay || !toDay) return NextResponse.json({ error: "from/to not in the current block." }, { status: 400 });
  if (to <= new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ error: "Can only reschedule onto a future day." }, { status: 400 });
  }

  // Place the missed quality work on the target day (keep its date); leave `from` as history.
  const days = block.days.map((d) =>
    d.date === to
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
  await writeCurrentBlock({ ...block, days });

  return NextResponse.json({ ok: true, note: "Moved in the app plan. Mirror it on your Intervals.icu calendar." });
}
