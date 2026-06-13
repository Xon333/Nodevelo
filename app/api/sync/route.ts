import { NextResponse } from "next/server";
import { isIntervalsConfigured, runFullSync, IntervalsApiError } from "@/lib/intervals-api";
import {
  readAthleteProfile,
  readCurrentBlock,
  readLastSync,
  writeTodayAnalysis,
  writeCurrentBlock,
  writeLastSync,
  readTodayAnalysis,
} from "@/lib/data-store";
import { analyseRide, buildRideAnalysisInput, isAnthropicConfigured } from "@/lib/anthropic-api";
import type { TodayAnalysis } from "@/lib/types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET returns the cached app state; it never hits Intervals.icu.
export async function GET() {
  const [lastSync, currentBlock, todayAnalysis] = await Promise.all([
    readLastSync(),
    readCurrentBlock(),
    readTodayAnalysis(),
  ]);
  return NextResponse.json({
    configured: isIntervalsConfigured(),
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    lastSync,
    currentBlock,
    todayAnalysis,
  });
}

// POST pulls fresh data from Intervals.icu, then (if a ride happened today)
// runs a short Claude analysis comparing actual vs planned.
export async function POST() {
  if (!isIntervalsConfigured()) {
    return NextResponse.json(
      { error: "Intervals.icu is not configured. Set INTERVALS_API_KEY and INTERVALS_ATHLETE_ID in .env.local." },
      { status: 400 }
    );
  }
  try {
    const lastSync = await runFullSync();
    await writeLastSync(lastSync);

    let todayAnalysis: TodayAnalysis | null = null;

    if (isAnthropicConfigured()) {
      const today = todayIso();
      const todayActivity = lastSync.activities.find(
        (a) => a.date === today && (a.type === "Ride" || a.type === "VirtualRide")
      );

      if (todayActivity) {
        const [currentBlock, profile] = await Promise.all([
          readCurrentBlock(),
          readAthleteProfile(),
        ]);
        const plannedDay = currentBlock?.days.find((d) => d.date === today) ?? null;

        try {
          const input = buildRideAnalysisInput(
            todayActivity,
            plannedDay
              ? {
                  name: plannedDay.name,
                  type: plannedDay.type,
                  durationMin: plannedDay.durationMin,
                }
              : null,
            profile.performance.ftp,
            profile.performance.thresholdHr
          );
          const analysis = await analyseRide(input);
          todayAnalysis = {
            analysedAt: new Date().toISOString(),
            activityDate: today,
            activityName: todayActivity.name,
            activityDurationMin: Math.round(todayActivity.movingTimeSec / 60),
            activityAvgWatts: todayActivity.avgWatts,
            activityAvgHr: todayActivity.avgHr,
            activityKj: todayActivity.kj,
            activityTrainingLoad: todayActivity.trainingLoad,
            activityRpe: todayActivity.rpe,
            plannedName: plannedDay?.name ?? null,
            plannedType: plannedDay?.type ?? null,
            plannedDurationMin: plannedDay?.durationMin ?? null,
            analysis,
          };
          await writeTodayAnalysis(todayAnalysis);
        } catch {
          // Analysis is best-effort — don't fail the whole sync.
        }
      }
    }

    return NextResponse.json({ lastSync, todayAnalysis });
  } catch (err) {
    const status = err instanceof IntervalsApiError && err.status === 401 ? 401 : 502;
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE clears the current block so a new one can be generated.
export async function DELETE() {
  await writeCurrentBlock(null);
  return NextResponse.json({ ok: true });
}
