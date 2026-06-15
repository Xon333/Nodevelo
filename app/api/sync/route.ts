import { NextResponse } from "next/server";
import { fetchHrStream, isIntervalsConfigured, runFullSync, IntervalsApiError } from "@/lib/intervals-api";
import { readMdHrZones } from "@/lib/kb-loader";
import { bucketHrZones } from "@/lib/hr-zones";
import {
  readAthleteProfile,
  readComplianceMemory,
  readCurrentBlock,
  readLastSync,
  readScoreLog,
  writeTodayAnalysis,
  writeComplianceMemory,
  writeCurrentBlock,
  writeLastSync,
  writeRollingBaselines,
  writeScoreLog,
  readTodayAnalysis,
} from "@/lib/data-store";
import { analyseRide, buildRideAnalysisInput, isAnthropicConfigured } from "@/lib/anthropic-api";
import { adjustBuffer, weightTrendFromWellness } from "@/lib/nutrition";
import { computeExecutionScore } from "@/lib/execution-score";
import { buildRideScores, mergeScoreLog } from "@/lib/score-log";
import { computeFatigueAlert, computeLoadRamp, computeReadiness, computeRollingBaselines } from "@/lib/readiness";
import type { ComplianceMemory, TodayAnalysis, WorkoutType } from "@/lib/types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET returns the cached app state; it never hits Intervals.icu.
export async function GET() {
  const [lastSync, currentBlock, todayAnalysis, scoreLog] = await Promise.all([
    readLastSync(),
    readCurrentBlock(),
    readTodayAnalysis(),
    readScoreLog(),
  ]);
  const readiness = lastSync
    ? computeReadiness(lastSync.fitness, lastSync.wellness)
    : null;
  const fatigueAlert = lastSync ? computeFatigueAlert(lastSync.fitness) : null;
  const loadRamp = lastSync ? computeLoadRamp(lastSync.activities) : null;
  return NextResponse.json({
    configured: isIntervalsConfigured(),
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    lastSync,
    currentBlock,
    todayAnalysis,
    readiness,
    fatigueAlert,
    loadRamp,
    scores: scoreLog.entries,
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

    // Always update rolling baselines on sync (deterministic, no AI needed).
    const baselines = computeRollingBaselines(lastSync.activities, lastSync.wellness);
    await writeRollingBaselines({ ...baselines, updatedAt: new Date().toISOString() });

    // Accumulate per-ride execution scores for the trends view. Deterministic and
    // independent of Anthropic — covers every matched planned day of the active block.
    {
      const block = await readCurrentBlock();
      if (block) {
        const profile = await readAthleteProfile();
        const fresh = buildRideScores(block, lastSync.activities, profile.performance.ftp);
        if (fresh.length > 0) {
          const log = await readScoreLog();
          await writeScoreLog({
            entries: mergeScoreLog(log.entries, fresh),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }

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
          const actualMin = Math.round(todayActivity.movingTimeSec / 60);
          const ftp = profile.performance.ftp;
          const compliancePct =
            plannedDay && plannedDay.durationMin > 0
              ? Math.round((actualMin / plannedDay.durationMin) * 100)
              : null;
          // Intensity Factor is NP/FTP by definition; fall back to avg power
          // only when normalized power is unavailable.
          const ifBasis = todayActivity.normalizedPower ?? todayActivity.avgWatts;
          const intensityFactor =
            ifBasis !== null && ftp > 0
              ? Math.round((ifBasis / ftp) * 100) / 100
              : null;
          // Variability index = NP / avg power; ~1.0 = steady, higher = surgy.
          const variabilityIndex =
            todayActivity.normalizedPower !== null &&
            todayActivity.avgWatts !== null &&
            todayActivity.avgWatts > 0
              ? Math.round((todayActivity.normalizedPower / todayActivity.avgWatts) * 100) / 100
              : null;

          const executionScore = computeExecutionScore({
            compliancePct,
            intensityFactor,
            plannedType: plannedDay?.type ?? null,
            decoupling: todayActivity.decoupling,
            variabilityIndex,
          });

          // Advised daily intake using real ride kJ (1 kJ ≈ 1 kcal for cyclists)
          const weightTrend = weightTrendFromWellness(lastSync.wellness) ?? 0;
          const { bufferApplied } = adjustBuffer(profile.nutrition.buffer, weightTrend);
          const rideFuelKcal = todayActivity.kj ?? 0;
          const advisedBaseKcal = profile.nutrition.baseCalories;
          const advisedIntakeKcal = Math.round(advisedBaseKcal + rideFuelKcal + bufferApplied);

          // Re-bucket HR into the athlete's OWN zones (from athlete_profile.md) instead
          // of Intervals' icu_hr_zone_times, whose boundaries can differ. Best-effort:
          // falls back to Intervals' zones if the stream or md zones are unavailable.
          let hrZoneTimes = todayActivity.hrZoneTimes;
          if (todayActivity.avgHr !== null) {
            const mdZones = await readMdHrZones();
            if (mdZones.length > 0) {
              const stream = await fetchHrStream(todayActivity.id);
              if (stream.length > 0) {
                const bucketed = bucketHrZones(stream, mdZones);
                if (bucketed.some((t) => t > 0)) hrZoneTimes = bucketed;
              }
            }
          }

          const input = buildRideAnalysisInput(
            todayActivity,
            plannedDay ? { name: plannedDay.name, type: plannedDay.type, durationMin: plannedDay.durationMin } : null,
            ftp,
            profile.performance.thresholdHr
          );
          input.hrZoneTimes = hrZoneTimes;
          const coachNote = await analyseRide(input);

          todayAnalysis = {
            analysedAt: new Date().toISOString(),
            activityDate: today,
            activityName: todayActivity.name,
            activityDurationMin: actualMin,
            activityAvgWatts: todayActivity.avgWatts,
            activityNormalizedPower: todayActivity.normalizedPower,
            activityMaxWatts: todayActivity.maxWatts,
            activityAvgHr: todayActivity.avgHr,
            activityMaxHr: todayActivity.maxHr,
            activityKj: todayActivity.kj,
            activityTrainingLoad: todayActivity.trainingLoad,
            activityRpe: todayActivity.rpe,
            activityDecoupling: todayActivity.decoupling,
            plannedName: plannedDay?.name ?? null,
            plannedType: plannedDay?.type ?? null,
            plannedDurationMin: plannedDay?.durationMin ?? null,
            compliancePct,
            intensityFactor,
            advisedIntakeKcal,
            advisedBaseKcal,
            advisedBufferKcal: bufferApplied,
            advisedRideFuelKcal: rideFuelKcal,
            activityDescription: todayActivity.description,
            powerZoneTimes: todayActivity.powerZoneTimes,
            hrZoneTimes,
            executionScore,
            coachNote,
          };
          await writeTodayAnalysis(todayAnalysis);

          // Update compliance memory for the planned type.
          if (plannedDay && compliancePct !== null) {
            await updateComplianceMemory(plannedDay.type as WorkoutType, compliancePct, today);
          }
        } catch {
          // Analysis is best-effort — don't fail the whole sync.
        }
      }
    }

    const readiness = computeReadiness(lastSync.fitness, lastSync.wellness);
    const fatigueAlert = computeFatigueAlert(lastSync.fitness);
    const loadRamp = computeLoadRamp(lastSync.activities);
    const scoreLog = await readScoreLog();
    return NextResponse.json({ lastSync, todayAnalysis, readiness, fatigueAlert, loadRamp, scores: scoreLog.entries });
  } catch (err) {
    const status = err instanceof IntervalsApiError && err.status === 401 ? 401 : 502;
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status });
  }
}

async function updateComplianceMemory(
  type: WorkoutType,
  compliancePct: number,
  _date: string
): Promise<void> {
  try {
    const memory = await readComplianceMemory();
    const entry = memory.byType[type] ?? {
      sessions: 0,
      avgCompliancePct: 0,
      recentCompliancePct: null,
      highComplianceWorkouts: [],
    };
    const newCount = entry.sessions + 1;
    const newAvg = Math.round((entry.avgCompliancePct * entry.sessions + compliancePct) / newCount);
    const updated: ComplianceMemory = {
      byType: {
        ...memory.byType,
        [type]: {
          ...entry,
          sessions: newCount,
          avgCompliancePct: newAvg,
          recentCompliancePct: compliancePct,
        },
      },
      updatedAt: new Date().toISOString(),
    };
    await writeComplianceMemory(updated);
  } catch {
    // Non-critical, best-effort.
  }
}

// DELETE clears the current block so a new one can be generated.
export async function DELETE() {
  await writeCurrentBlock(null);
  return NextResponse.json({ ok: true });
}
