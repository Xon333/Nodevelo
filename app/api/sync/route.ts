import { NextResponse } from "next/server";
import { createEvent, fetchHrStream, fetchIntervals, fetchPowerStream, fetchSportSettings, isIntervalsConfigured, runFullSync, IntervalsApiError } from "@/lib/intervals-api";
import { physiologyAsOf, readHrZones, readPhysiology, readPowerZones, reconcile, writePhysiology } from "@/lib/physiology";
import { bucketZones } from "@/lib/zones";
import { matchPrescription } from "@/lib/interval-match";
import { buildRideTrace } from "@/lib/trace";
import {
  readAthleteProfile,
  readBlockSettings,
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
import { computeAcwr, computeFatigueAlert, computeIntensityDistribution, computeLoadRamp, computeReadiness, computeRollingBaselines } from "@/lib/readiness";
import type { ComplianceMemory, ExecutedInterval, TodayAnalysis, WorkoutType } from "@/lib/types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET returns the cached app state; it never hits Intervals.icu.
export async function GET() {
  const [lastSync, currentBlock, todayAnalysis, scoreLog, profile, settings] = await Promise.all([
    readLastSync(),
    readCurrentBlock(),
    readTodayAnalysis(),
    readScoreLog(),
    readAthleteProfile(),
    readBlockSettings(),
  ]);
  const readiness = lastSync
    ? computeReadiness(lastSync.fitness, lastSync.wellness)
    : null;
  const fatigueAlert = lastSync ? computeFatigueAlert(lastSync.fitness) : null;
  const loadRamp = lastSync ? computeLoadRamp(lastSync.activities) : null;
  const acwr = lastSync ? computeAcwr(lastSync.activities) : null;
  const polarization = lastSync ? computeIntensityDistribution(lastSync.activities, profile.performance.ftp) : null;
  return NextResponse.json({
    configured: isIntervalsConfigured(),
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    lastSync,
    currentBlock,
    todayAnalysis,
    readiness,
    fatigueAlert,
    loadRamp,
    acwr,
    polarization,
    scores: scoreLog.entries,
    autoSyncOnOpen: settings.autoSyncOnOpen,
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
    const today = todayIso();
    const lastSync = await runFullSync();
    await writeLastSync(lastSync);

    // Reconcile the physiology store against Intervals.icu's current sport-settings (FTP,
    // zones, threshold/max HR). On a real change the old snapshot is archived with its own
    // effective date, so historical analyses stay anchored to the FTP that was live then.
    const incomingPhys = await fetchSportSettings(today);
    if (incomingPhys) {
      const { store } = reconcile(await readPhysiology(), incomingPhys, today);
      await writePhysiology(store);
    }
    const physStore = await readPhysiology();

    let todayAnalysis: TodayAnalysis | null = null;

    // Always update rolling baselines on sync (deterministic, no AI needed).
    const baselines = computeRollingBaselines(lastSync.activities, lastSync.wellness);
    await writeRollingBaselines({ ...baselines, updatedAt: new Date().toISOString() });

    // FTP in effect on a given ride date — falls back to the current profile FTP when the
    // physiology history doesn't reach that far back.
    const fallbackFtp = (await readAthleteProfile()).performance.ftp;
    const ftpForDate = (date: string) => physiologyAsOf(physStore, date)?.ftp ?? fallbackFtp;

    // Accumulate per-ride execution scores for the trends view. Deterministic and
    // independent of Anthropic — covers every matched planned day of the active block. The
    // log is immutable per date; new dates are scored against their as-of FTP, and legacy
    // entries that predate this feature are backfilled once with a best-effort FTP.
    {
      const block = await readCurrentBlock();
      if (block) {
        const log = await readScoreLog();
        const backfilled = log.entries.map((e) =>
          e.ftpUsed != null ? e : { ...e, ftpUsed: ftpForDate(e.date) }
        );
        const fresh = buildRideScores(block, lastSync.activities, ftpForDate);
        await writeScoreLog({
          entries: mergeScoreLog(backfilled, fresh),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    if (isAnthropicConfigured()) {
      const todayActivity = lastSync.activities.find(
        (a) => a.date === today && (a.type === "Ride" || a.type === "VirtualRide")
      );

      if (todayActivity) {
        const [currentBlock, profile, priorAnalysis] = await Promise.all([
          readCurrentBlock(),
          readAthleteProfile(),
          readTodayAnalysis(),
        ]);
        const plannedDay = currentBlock?.days.find((d) => d.date === today) ?? null;
        // Only auto-post once per day — true until today's note has already been analysed.
        const firstAnalysisToday = priorAnalysis?.activityDate !== today;

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


          // Advised daily intake using real ride kJ (1 kJ ≈ 1 kcal for cyclists)
          const weightTrend = weightTrendFromWellness(lastSync.wellness) ?? 0;
          const { bufferApplied } = adjustBuffer(profile.nutrition.buffer, weightTrend);
          const rideFuelKcal = todayActivity.kj ?? 0;
          const advisedBaseKcal = profile.nutrition.baseCalories;
          const advisedIntakeKcal = Math.round(advisedBaseKcal + rideFuelKcal + bufferApplied);

          // Re-bucket power & HR into the athlete's OWN zones (from athlete_profile.md).
          // Intervals' power zones are often null and its HR boundaries can differ, so we
          // compute time-in-zone from the raw streams. Best-effort: fall back to whatever
          // Intervals provided if a stream or the md zones are unavailable.
          let powerZoneTimes = todayActivity.powerZoneTimes;
          let hrZoneTimes = todayActivity.hrZoneTimes;
          const [powerZones, hrZones, powerStream, hrStream] = await Promise.all([
            readPowerZones(),
            readHrZones(),
            todayActivity.avgWatts !== null ? fetchPowerStream(todayActivity.id) : Promise.resolve<number[]>([]),
            todayActivity.avgHr !== null ? fetchHrStream(todayActivity.id) : Promise.resolve<number[]>([]),
          ]);
          if (powerZones.length > 0 && powerStream.length > 0) {
            const b = bucketZones(powerStream, powerZones);
            if (b.some((t) => t > 0)) powerZoneTimes = b;
          }
          if (hrZones.length > 0 && hrStream.length > 0) {
            const b = bucketZones(hrStream, hrZones);
            if (b.some((t) => t > 0)) hrZoneTimes = b;
          }

          // Compare the coach's prescription against the intervals curated in
          // Intervals.icu, and build the power-trace (downsampled streams + work bands).
          const prescription = plannedDay?.prescription ?? [];
          let intervalComparison = null;
          let executed: ExecutedInterval[] = [];
          if (prescription.length > 0) {
            executed = await fetchIntervals(todayActivity.id);
            intervalComparison = matchPrescription(prescription, executed);
          }
          const trace = buildRideTrace(powerStream, hrStream, executed, prescription[0]?.targetWatts ?? null);

          // Execution score: on interval days the power-target adherence is the primary
          // execution signal; duration compliance is used otherwise. RPE adds effort.
          const executionScore = computeExecutionScore({
            compliancePct,
            intensityFactor,
            plannedType: plannedDay?.type ?? null,
            decoupling: todayActivity.decoupling,
            variabilityIndex,
            adherencePct: intervalComparison?.avgAdherencePct ?? null,
            rpe: todayActivity.rpe,
          });

          const input = buildRideAnalysisInput(
            todayActivity,
            plannedDay ? { name: plannedDay.name, type: plannedDay.type, durationMin: plannedDay.durationMin } : null,
            ftp,
            profile.performance.thresholdHr
          );
          input.powerZoneTimes = powerZoneTimes;
          input.hrZoneTimes = hrZoneTimes;
          input.intervalComparison = intervalComparison;
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
            powerZoneTimes,
            hrZoneTimes,
            executionScore,
            coachNote,
            intervalComparison,
            trace,
          };
          await writeTodayAnalysis(todayAnalysis);

          // Auto-post the coach note to Intervals.icu if the athlete opted in (once/day).
          if (coachNote && firstAnalysisToday) {
            const settings = await readBlockSettings();
            if (settings.autoPostCoachNote) {
              const scoreLine = executionScore !== null ? `\nExecution score: ${executionScore}/10` : "";
              await createEvent({
                category: "NOTE",
                start_date_local: `${today}T00:00:00`,
                name: "Coach analysis",
                description: `[Nodevelo coach] ${todayActivity.name}${scoreLine}\n\n${coachNote.trim()}`,
              }).catch(() => {}); // best-effort
            }
          }

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
    const acwr = computeAcwr(lastSync.activities);
    const polarization = computeIntensityDistribution(lastSync.activities, (await readAthleteProfile()).performance.ftp);
    const scoreLog = await readScoreLog();
    return NextResponse.json({ lastSync, todayAnalysis, readiness, fatigueAlert, loadRamp, acwr, polarization, scores: scoreLog.entries });
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
