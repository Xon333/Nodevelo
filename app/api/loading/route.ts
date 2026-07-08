// app/api/loading/route.ts — the pre-ride loading loop's surface (Track C).
// GET: the one prompt Today may show (pre-ask / retro-ask), the stored response for that ride,
// and the current effect assessment. POST: record the athlete's one-tap attribution.
import { NextResponse } from "next/server";
import { readAthleteProfile, readCurrentBlock, readLastSync, readLoadingLog, readScoreLog, updateScoreLog, writeLoadingLog } from "@/lib/data-store";
import { assessLoadingEffect, deriveLoadingPrompt, preLoadTargetG } from "@/lib/loading";
import { resolveToday } from "@/lib/date";
import type { LoadingEntry } from "@/lib/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Latest synced weigh-in, falling back to the profile's target weight — same source order the
// nutrition config uses (weight is synced physiology, never hand-edited).
async function currentWeightKg(): Promise<number> {
  const [sync, profile] = await Promise.all([readLastSync(), readAthleteProfile()]);
  const weighIns = (sync?.wellness ?? []).filter((w) => w.weightKg !== null).sort((a, b) => a.date.localeCompare(b.date));
  return weighIns.length > 0 ? (weighIns[weighIns.length - 1].weightKg as number) : profile.nutrition.targetWeightKg;
}

export async function GET(req: Request) {
  const today = resolveToday(new URL(req.url).searchParams.get("today"));
  const [block, log, scoreLog, weightKg] = await Promise.all([
    readCurrentBlock(),
    readLoadingLog(),
    readScoreLog(),
    currentWeightKg(),
  ]);
  const assessment = assessLoadingEffect(scoreLog.entries);
  // A proven no-effect verdict stops the whole loop — no prescription, no retro-ask.
  const prompt =
    assessment.verdict === "no-effect"
      ? null
      : deriveLoadingPrompt(block, today, weightKg, new Set(log.entries.map((l) => l.rideDate)));
  const response = prompt ? null : (log.entries.find((l) => l.rideDate === today) ?? null);
  return NextResponse.json({ prompt, response, assessment });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { rideDate, response } = (body ?? {}) as { rideDate?: unknown; response?: unknown };
  if (typeof rideDate !== "string" || !ISO_DATE.test(rideDate) || (response !== "loaded" && response !== "skipped")) {
    return NextResponse.json({ error: "rideDate (YYYY-MM-DD) and response (loaded|skipped) required" }, { status: 400 });
  }
  const block = await readCurrentBlock();
  const day = block?.days.find((d) => d.date === rideDate) ?? null;
  if (!day?.durabilityTemplate || day.durationMin <= 0) {
    return NextResponse.json({ error: "rideDate is not a durability day in the active block" }, { status: 400 });
  }
  const weightKg = await currentWeightKg();
  const entry: LoadingEntry = { rideDate, targetG: preLoadTargetG(weightKg), response, respondedAt: new Date().toISOString() };
  const log = await readLoadingLog();
  await writeLoadingLog({ entries: [...log.entries.filter((l) => l.rideDate !== rideDate), entry] });
  // Retro-ask ordering: the entry may already be born (sync ran before the athlete answered).
  // Stamp the response as provenance at data-arrival time — executionScore untouched, existing
  // stamp never overwritten (first answer wins, matching the ledger's existing-wins ethos).
  await updateScoreLog((entries) =>
    entries.map((e) =>
      e.date === rideDate && e.durabilityTemplate && !e.legacy && !e.preLoad
        ? { ...e, preLoad: { loaded: response === "loaded", targetG: entry.targetG } }
        : e
    )
  );
  return NextResponse.json({ entry });
}
