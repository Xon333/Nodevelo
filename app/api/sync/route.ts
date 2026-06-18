import { NextResponse } from "next/server";
import { createEvent, fetchHrStream, fetchIntervals, fetchPowerStream, fetchSportSettings, isIntervalsConfigured, runFullSync, IntervalsApiError } from "@/lib/intervals-api";
import { physiologyAsOf, readHrZones, readPhysiology, readPowerZones, reconcile, writePhysiology } from "@/lib/physiology";
import { bucketZones } from "@/lib/zones";
import { matchPrescription } from "@/lib/interval-match";
import { buildRideTrace } from "@/lib/trace";
import {
  readAthleteProfile,
  readBlockHistory,
  readBlockSettings,
  readCurrentBlock,
  readDispositions,
  readInterventionLog,
  readLastSync,
  readScoreLog,
  writeInterventionLog,
  writeTodayAnalysis,
  writeCurrentBlock,
  writeLastSync,
  writeRollingBaselines,
  writeScoreLog,
  readTodayAnalysis,
} from "@/lib/data-store";
import { analyseRide, buildRideAnalysisInput, isAnthropicConfigured } from "@/lib/anthropic-api";
import { buildAthleteModel } from "@/lib/athlete-model";
import { validateInterventions } from "@/lib/intervention";
import { adjustBuffer, weightTrendFromWellness } from "@/lib/nutrition";
import { computeExecutionScore, resolveCompliance } from "@/lib/execution-score";
import { detectPowerPRs } from "@/lib/pr";
import { buildRideScores, mergeScoreLog } from "@/lib/score-log";
import { applyDispositions, compromisedDates } from "@/lib/disposition";
import { computeAcwr, computeFatigueAlert, computeIntensityDistribution, computeLoadRamp, computeReadiness, computeRollingBaselines } from "@/lib/readiness";
import { resolveAcwrBands } from "@/lib/calibration";
import type { ExecutedInterval, TodayAnalysis } from "@/lib/types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET returns the cached app state; it never hits Intervals.icu.
export async function GET() {
  const [lastSync, currentBlock, todayAnalysis, scoreLog, profile, settings, dispositions] = await Promise.all([
    readLastSync(),
    readCurrentBlock(),
    readTodayAnalysis(),
    readScoreLog(),
    readAthleteProfile(),
    readBlockSettings(),
    readDispositions(),
  ]);
  const readiness = lastSync
    ? computeReadiness(lastSync.fitness, lastSync.wellness)
    : null;
  const fatigueAlert = lastSync ? computeFatigueAlert(lastSync.fitness) : null;
  const loadRamp = lastSync ? computeLoadRamp(lastSync.activities) : null;
  const acwr = lastSync ? computeAcwr(lastSync.activities, resolveAcwrBands(settings.acwrBands)) : null;
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
    // Legacy (pre-first-block) and compromised (equipment/sickness) rides stay in the ledger
    // but are excluded from the execution metrics the client renders (trend pulse, calendar).
    scores: scoreLog.entries.filter((e) => !e.legacy && !e.compromised),
    // Compromised dates are sent separately so the calendar can mark them "Compromised" (the
    // ride happened, attributed) rather than falsely "Missed" once they're out of `scores`.
    compromisedDates: [...compromisedDates(dispositions.entries)],
    // Partial dates let the calendar label a cut-short session "Partial" instead of "Completed"
    // (it still has a score — the athlete attributed it as cut short).
    partialDates: dispositions.entries.filter((e) => e.disposition === "partial").map((e) => e.date),
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
    // The power curve as it stood BEFORE this sync — the baseline a new PR must beat (the fresh
    // sync absorbs today's ride into the curve, so the comparison has to use the prior one).
    const prevSync = await readLastSync();
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

    // Accumulate per-ride execution scores for the trends view + the learning model.
    // Deterministic and independent of Anthropic. Planned rides are scored on adherence;
    // off-plan rides on intrinsic quality, but only once structured training has begun (on/
    // after the first block's start) so the ledger starts fresh with the first block instead
    // of pre-loading months of pre-app legacy rides. The log is immutable per date; new dates
    // are scored against their as-of FTP, and legacy entries are backfilled once to the schema.
    {
      const block = await readCurrentBlock();
      const blockHistory = await readBlockHistory();
      const blockStarts = [block?.startDate, ...blockHistory.map((h) => h.startDate)].filter(
        (d): d is string => !!d
      );
      const offPlanFloor = blockStarts.length ? blockStarts.sort()[0] : null;

      const log = await readScoreLog();
      const backfilled = log.entries.map((e) => {
        const planned = e.planned ?? e.plannedType != null;
        return {
          ...e,
          ftpUsed: e.ftpUsed ?? ftpForDate(e.date),
          planned,
          inferredType: e.inferredType ?? e.plannedType ?? "Z2",
          durationMin: e.durationMin ?? 0,
          tss: e.tss ?? null,
          // Off-plan rides before structured training began are kept as history but flagged
          // legacy so they're excluded from the execution metric + drift.
          legacy: e.legacy ?? (!planned && (offPlanFloor === null || e.date < offPlanFloor)),
        };
      });
      const fresh = buildRideScores(block, lastSync.activities, ftpForDate, today, offPlanFloor);
      // Stamp the athlete's compromised attributions onto the ledger (re-derived each sync).
      const dispositions = (await readDispositions()).entries;
      await writeScoreLog({
        entries: applyDispositions(mergeScoreLog(backfilled, fresh), dispositions),
        updatedAt: new Date().toISOString(),
      });
    }

    // Close the learning loop: re-evaluate any matured interventions against the freshly
    // updated model + sync, marking whether acting on each past insight actually worked.
    try {
      const scoreLog = await readScoreLog();
      const model = buildAthleteModel(scoreLog.entries);
      const interventionLog = await readInterventionLog();
      const { log: updatedInterventions, changed } = validateInterventions(interventionLog, model, lastSync, today);
      if (changed) await writeInterventionLog(updatedInterventions);
    } catch {
      // Best-effort — never fail a sync on the validation pass.
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

          // Power PRs: durations where the freshly-synced curve beat the previous sync's curve
          // (both Intervals.icu's own math, so the delta is honest — no stream-vs-curve noise).
          const powerPRs = detectPowerPRs(lastSync.powerCurve, prevSync?.powerCurve ?? []);

          // Execution score: on interval days the power-target adherence is the primary
          // execution signal; duration compliance is used otherwise. RPE adds effort.
          const executionScore = computeExecutionScore({
            compliancePct,
            intensityFactor,
            plannedType: plannedDay?.type ?? null,
            decoupling: todayActivity.decoupling,
            variabilityIndex,
            // Duration-aware: a rep nailed on watts but cut short scores lower than a full one.
            // But when the plan's rep-duration definition disagrees with what was ridden
            // (structuralMismatch), the duration-discounted adherence is untrustworthy — drop it
            // so execution falls back to duration-compliance + intensity + decoupling instead of
            // confidently mis-scoring a correct session.
            adherencePct:
              intervalComparison && !intervalComparison.structuralMismatch
                ? intervalComparison.effectiveAdherencePct
                : null,
            rpe: todayActivity.rpe,
          });

          // Compliance is the macro "did you complete the session" number, but capped by
          // execution so it can never contradict a poor execution (the trust guarantee).
          const resolvedCompliancePct = resolveCompliance(compliancePct, executionScore);

          const input = buildRideAnalysisInput(
            todayActivity,
            plannedDay ? { name: plannedDay.name, type: plannedDay.type, durationMin: plannedDay.durationMin } : null,
            ftp,
            profile.performance.thresholdHr
          );
          input.powerZoneTimes = powerZoneTimes;
          input.hrZoneTimes = hrZoneTimes;
          input.intervalComparison = intervalComparison;
          input.powerPRs = powerPRs;
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
            compliancePct: resolvedCompliancePct,
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
            powerPRs,
          };
          await writeTodayAnalysis(todayAnalysis);

          // Keep the ledger's entry for today consistent with this richer, interval-aware
          // analysis. buildRideScores can't see interval bails (it doesn't fetch per-ride
          // intervals); this can — so today's execution + capped compliance match across the
          // Today card, the Plan calendar, the trend pulse, and Trends.
          try {
            if (executionScore !== null) {
              const log = await readScoreLog();
              const patched = log.entries.map((e) =>
                e.date === today && !e.legacy
                  ? { ...e, executionScore, compliancePct: resolvedCompliancePct }
                  : e
              );
              await writeScoreLog({ entries: patched, updatedAt: new Date().toISOString() });
            }
          } catch {
            // Best-effort — the ledger already has a coarse entry from buildRideScores.
          }

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

        } catch {
          // Analysis is best-effort — don't fail the whole sync.
        }
      }
    }

    const readiness = computeReadiness(lastSync.fitness, lastSync.wellness);
    const fatigueAlert = computeFatigueAlert(lastSync.fitness);
    const loadRamp = computeLoadRamp(lastSync.activities);
    const acwr = computeAcwr(lastSync.activities, resolveAcwrBands((await readBlockSettings()).acwrBands));
    const polarization = computeIntensityDistribution(lastSync.activities, (await readAthleteProfile()).performance.ftp);
    const scoreLog = await readScoreLog();
    const dispositions = await readDispositions();
    return NextResponse.json({ lastSync, todayAnalysis, readiness, fatigueAlert, loadRamp, acwr, polarization, scores: scoreLog.entries.filter((e) => !e.legacy && !e.compromised), compromisedDates: [...compromisedDates(dispositions.entries)], partialDates: dispositions.entries.filter((e) => e.disposition === "partial").map((e) => e.date) });
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
