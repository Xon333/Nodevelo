import { NextResponse } from "next/server";
import { readCurrentBlock, readLastSync, readMorningChecks, readTodayAnalysis, writeCurrentBlock, writeMorningChecks } from "@/lib/data-store";
import { decideMorningCheck, mergeMorningCheck, proactiveApplyBlock, type MorningCheckAnswers } from "@/lib/morning-check";
import { applyProactiveReschedule, suggestProactiveReschedule } from "@/lib/reschedule";
import { computeAcwr, computeReadiness } from "@/lib/readiness";
import { resolveToday } from "@/lib/date";
import type { IllnessLevel, MorningCheckEntry, WorkoutType } from "@/lib/types";

const QUALITY = new Set<WorkoutType>(["Threshold", "VO2max", "SIT", "RaceSim"]);
const ILLNESS: IllnessLevel[] = ["none", "mild", "sick"];

// "today" is the CLIENT's local date (query param on GET, body field otherwise) so client + server
// agree across the UTC day boundary — same discipline as /api/sync (resolveToday falls back to UTC).

// GET → the UI's state: today's stored check (if any), whether today is a quality day, and the
// proactive reschedule target (so the form can preview the move before the athlete applies it).
export async function GET(req: Request) {
  const date = resolveToday(new URL(req.url).searchParams.get("today"));
  const [block, checks] = await Promise.all([readCurrentBlock(), readMorningChecks()]);
  const todayDay = block?.days.find((d) => d.date === date) ?? null;
  const isQualityDay = !!todayDay && todayDay.durationMin > 0 && QUALITY.has(todayDay.type);
  return NextResponse.json({
    check: checks.entries.find((e) => e.date === date) ?? null,
    isQualityDay,
    suggestion: suggestProactiveReschedule(block, date),
  });
}

function parseAnswers(b: Record<string, unknown>): MorningCheckAnswers | string {
  const rating = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  };
  const fatigue = rating(b.fatigue);
  const sleep = rating(b.sleep);
  const soreness = rating(b.soreness);
  const motivation = rating(b.motivation);
  if (fatigue === null || sleep === null || soreness === null || motivation === null) {
    return "fatigue, sleep, soreness and motivation must each be an integer 1–5.";
  }
  if (!ILLNESS.includes(b.illness as IllnessLevel)) return "illness must be none, mild or sick.";
  return { fatigue, sleep, soreness, motivation, illness: b.illness as IllnessLevel };
}

// POST → submit the check-in. Computes the deterministic decision (subjective strain + the objective
// form signals), stores it, and returns the decision + the proposed move. Does NOT auto-apply.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const answers = parseAnswers(b);
  if (typeof answers === "string") return NextResponse.json({ error: answers }, { status: 400 });

  const date = resolveToday(b.today);
  const [block, sync] = await Promise.all([readCurrentBlock(), readLastSync()]);
  const todayDay = block?.days.find((d) => d.date === date) ?? null;
  const isQualityDay = !!todayDay && todayDay.durationMin > 0 && QUALITY.has(todayDay.type);

  const { decision, strain, reasons } = decideMorningCheck(answers, {
    isQualityDay,
    tsb: sync?.fitness.tsb ?? null,
    readiness: sync ? computeReadiness(sync.fitness, sync.wellness)?.level ?? null : null,
    acwr: sync ? computeAcwr(sync.activities)?.level ?? null : null,
  });

  const entry: MorningCheckEntry = { date, ...answers, strain, decision, setAt: new Date().toISOString() };
  const log = await readMorningChecks();
  await writeMorningChecks({ entries: mergeMorningCheck(log.entries, entry), updatedAt: new Date().toISOString() });

  return NextResponse.json({
    decision,
    reasons,
    suggestion: decision === "downgrade" ? suggestProactiveReschedule(block, date) : null,
  });
}

// PUT → athlete-confirmed apply: downgrade today + move/swap the quality stimulus. Local block only
// (the Intervals.icu calendar mutation is a separate, larger step — so the note tells the athlete to
// mirror it), matching the reactive /api/reschedule POST. Guarded: only applies when today's stored
// check-in recommended a downgrade and the ride hasn't already been logged (the route is the contract,
// not just the UI).
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
  await writeCurrentBlock({ ...block, days: applied.days });
  return NextResponse.json({
    ok: true,
    to: applied.to,
    toWasRest: applied.toWasRest,
    note: applied.to
      ? "Moved in the app plan. Mirror it on your Intervals.icu calendar."
      : "Downgraded today; no make-up slot left this block — it's a priority for your next block.",
  });
}
