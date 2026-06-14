import { NextResponse } from "next/server";
import { readAthleteProfile, readLastSync, writeAthleteProfile } from "@/lib/data-store";
import { parseAthleteMd } from "@/lib/kb-loader";
import { adjustBuffer, weightTrendFromWellness } from "@/lib/nutrition";

// GET returns the parsed athlete_profile.md snapshot plus Intervals.icu auto-sync data.
// Performance, goals and weakpoints all come from the markdown — no re-entry needed.
export async function GET() {
  const [profile, sync, athleteMd] = await Promise.all([
    readAthleteProfile(),
    readLastSync(),
    parseAthleteMd(),
  ]);

  const weighIns = (sync?.wellness ?? [])
    .filter((w) => w.weightKg !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
  const weightTrend7Day = sync ? weightTrendFromWellness(sync.wellness) : null;

  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const recentRpes = (sync?.activities ?? [])
    .filter((a) => a.date >= cutoff && a.rpe !== null)
    .map((a) => a.rpe as number);
  const lastKcal = (sync?.wellness ?? [])
    .filter((w) => w.kcalConsumed !== null)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  const ftpStaleDays = Math.floor(
    (Date.now() - Date.parse(profile.updatedAt)) / 86_400_000
  );

  return NextResponse.json({
    nutrition: profile.nutrition,
    ftpStaleDays: Number.isFinite(ftpStaleDays) ? ftpStaleDays : null,
    athleteMd,
    syncedPowerCurve: sync?.powerCurve ?? [],
    weightHistory: (sync?.wellness ?? [])
      .filter((w) => w.weightKg !== null)
      .map((w) => ({ date: w.date, weightKg: w.weightKg as number }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-56), // last 8 weeks
    latestWeightKg:
      (sync?.wellness ?? [])
        .filter((w) => w.weightKg !== null)
        .sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ?? null,
    autoSync: {
      syncedAt: sync?.syncedAt ?? null,
      latestWeightKg: weighIns[0]?.weightKg ?? null,
      latestWeightDate: weighIns[0]?.date ?? null,
      weightTrend7Day,
      avgRpe7Day:
        recentRpes.length > 0
          ? Math.round((recentRpes.reduce((a, b) => a + b, 0) / recentRpes.length) * 10) / 10
          : null,
      lastKcalConsumed: lastKcal?.kcalConsumed ?? null,
      lastKcalDate: lastKcal?.date ?? null,
    },
    bufferStatus: adjustBuffer(profile.nutrition.buffer, weightTrend7Day ?? 0),
  });
}

// PUT only saves nutrition settings — performance/goals/weakpoints live in athlete_profile.md
// and are edited there via the Knowledge Base manager.
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const input = body && typeof body === "object"
    ? (body as Record<string, unknown>).nutrition as Record<string, unknown> | undefined
    : undefined;
  if (!input) return NextResponse.json({ error: "Missing nutrition." }, { status: 400 });

  const { baseCalories, restDayTarget, buffer, targetWeightKg } = input;
  const pos = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!pos(baseCalories)) return NextResponse.json({ error: "baseCalories must be a positive number." }, { status: 400 });
  if (!pos(restDayTarget)) return NextResponse.json({ error: "restDayTarget must be a positive number." }, { status: 400 });
  if (!pos(targetWeightKg)) return NextResponse.json({ error: "targetWeightKg must be a positive number." }, { status: 400 });
  if (typeof buffer !== "number" || !Number.isFinite(buffer) || buffer < 0 || buffer > 600) {
    return NextResponse.json({ error: "buffer must be between 0 and 600 kcal." }, { status: 400 });
  }

  const current = await readAthleteProfile();
  const updated = {
    ...current,
    nutrition: {
      baseCalories: baseCalories as number,
      restDayTarget: restDayTarget as number,
      buffer: buffer as number,
      targetWeightKg: targetWeightKg as number,
    },
    updatedAt: new Date().toISOString(),
  };
  await writeAthleteProfile(updated);
  return NextResponse.json({ nutrition: updated.nutrition });
}
