import { NextResponse } from "next/server";
import { fetchHrStream, fetchIntervals, fetchPowerStream, fetchSportSettings, isIntervalsConfigured, runFullSync, IntervalsApiError } from "@/lib/intervals-api";
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
  readMorningChecks,
  readRollingBaselines,
  readScoreLog,
  writeInterventionLog,
  writeQuirks,
  writeTodayAnalysis,
  writeCurrentBlock,
  writeLastSync,
  writeRollingBaselines,
  writeScoreLog,
  readTodayAnalysis,
} from "@/lib/data-store";
import { extractQuirks } from "@/lib/quirks";
import { isAnthropicConfigured } from "@/lib/anthropic-api";
import { buildAthleteModel } from "@/lib/athlete-model";
import { athleteStateInputsFrom, computeAthleteState } from "@/lib/athlete-state";
import { overallCoachAccuracy, validateInterventions } from "@/lib/intervention";
import { adjustBuffer, weightTrendFromWellness } from "@/lib/nutrition";
import { computeExecutionScore, resolveCompliance } from "@/lib/execution-score";
import { detectPowerPRs } from "@/lib/pr";
import { buildRideScores, mergeScoreLog } from "@/lib/score-log";
import { applyDispositions, compromisedDates } from "@/lib/disposition";
import { computeAcwr, computeFatigueAlert, computeIntensityDistribution, computeLoadRamp, computeReadiness, computeRollingBaselines } from "@/lib/readiness";
import { resolveAcwrBands } from "@/lib/calibration";
import { buildCoachSnapshotFromSources } from "@/lib/coach-snapshot";
import { resolveToday } from "@/lib/date";
import type { ExecutedInterval, TodayAnalysis } from "@/lib/types";

// GET returns the cached app state; it never hits Intervals.icu. `?today=` is the client's local date
// (so the CoachSnapshot resolves against the calendar day the athlete sees); falls back to UTC.
export async function GET(req: Request) {
  const today = resolveToday(new URL(req.url).searchParams.get("today"));
  const [lastSync, currentBlock, todayAnalysis, scoreLog, profile, settings, dispositions, interventionLog, baselines, morningChecks, physStore] =
    await Promise.all([
      readLastSync(),
      readCurrentBlock(),
      readTodayAnalysis(),
      readScoreLog(),
      readAthleteProfile(),
      readBlockSettings(),
      readDispositions(),
      readInterventionLog(),
      readRollingBaselines(),
      readMorningChecks(),
      readPhysiology(),
    ]);
  const readiness = lastSync
    ? computeReadiness(lastSync.fitness, lastSync.wellness)
    : null;
  const fatigueAlert = lastSync ? computeFatigueAlert(lastSync.fitness) : null;
  const loadRamp = lastSync ? computeLoadRamp(lastSync.activities) : null;
  const acwr = lastSync ? computeAcwr(lastSync.activities, resolveAcwrBands(settings.acwrBands)) : null;
  const polarization = lastSync ? computeIntensityDistribution(lastSync.activities, profile.performance.ftp) : null;
  // Signal fusion (§5): one glanceable state from the fused signals.
  const athleteState = computeAthleteState(
    athleteStateInputsFrom(lastSync, buildAthleteModel(scoreLog.entries), baselines, acwr)
  );
  // The resolved-numbers snapshot the LLM is handed (ROADMAP #1) — same builder as /api/ask, so the
  // Today card shows the exact figures the coach reasons from (FTP off the physiology SoT).
  const coachSnapshot = buildCoachSnapshotFromSources({
    date: today,
    ftp: physStore?.current.ftp ?? profile.performance.ftp,
    block: currentBlock,
    sync: lastSync,
    todayAnalysis,
    scoreEntries: scoreLog.entries,
    baselines,
    dispositions: dispositions.entries,
    interventionLog,
    morningChecks: morningChecks.entries,
    acwrBandsOverride: settings.acwrBands,
  });
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
    // How often acting on the coach's matured directives proved right (validation loop). Null until
    // the 28-day horizon yields a decisive outcome; `pending` shows how many are still accruing.
    coachAccuracy: overallCoachAccuracy(interventionLog),
    // Signal fusion (§5): the glanceable "second brain's read on you now".
    athleteState,
    // ROADMAP #1: the resolved-numbers snapshot the LLM reads, surfaced so the athlete sees the same.
    coachSnapshot,
  });
}

// POST pulls fresh data from Intervals.icu, then (if a ride happened today)
// runs a short Claude analysis comparing actual vs planned.
export async function POST(req: Request) {
  if (!isIntervalsConfigured()) {
    return NextResponse.json(
      { error: "Intervals.icu is not configured. Set INTERVALS_API_KEY and INTERVALS_ATHLETE_ID in .env.local." },
      { status: 400 }
    );
  }
  // "today" is the CLIENT's local date (sent in the body) so client + server agree across the UTC
  // day boundary — activities are matched on their local date, so a UTC "today" would miss an
  // evening ride whose local date hasn't ticked over yet. Falls back to UTC when absent.
  let reqBody: unknown = null;
  try {
    reqBody = await req.json();
  } catch {
    /* no body — UTC fallback */
  }
  try {
    const today = resolveToday((reqBody as { today?: unknown } | null)?.today);
    // Non-fatal step failures are collected here and returned so they surface (a toast) instead of
    // being swallowed by best-effort catches.
    const warnings: string[] = [];
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

    // Track D: mine ride notes for recurring quirks (deterministic, no AI). Regenerated in full each
    // sync. Best-effort — extraction must never break a sync.
    try {
      await writeQuirks(extractQuirks(lastSync.activities));
    } catch (e) {
      warnings.push(`Quirk extraction failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }

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
    } catch (e) {
      // Never fail a sync on the validation pass — but surface it instead of swallowing silently.
      warnings.push(`Intervention validation failed: ${e instanceof Error ? e.message : String(e)}`);
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

          // Power PRs: durations where this sync's ALL-TIME best beat the previous sync's all-time
          // best. All-time is monotonic (only rises on a genuine PR), so unlike the 84-day curve it
          // never false-drops as efforts age out of a window — and the delta is a true all-time PR.
          const powerPRs = detectPowerPRs(
            lastSync.powerCurveAllTime ?? lastSync.powerCurve,
            prevSync?.powerCurveAllTime ?? []
          );

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

          // The coach note (the slow LLM call) is deferred to /api/analyze so this sync returns
          // fast. Preserve an already-generated note (and its provenance stamp) across a re-sync of
          // the same day so an Anthropic hiccup during re-analysis can't wipe a good note; a fresh
          // ride starts empty and the client triggers the follow-up analysis to fill it.
          const preserved = priorAnalysis?.activityDate === today ? priorAnalysis : null;
          const coachNote = preserved?.coachNote ?? "";

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
            activityDistanceMeters: todayActivity.distanceMeters,
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
            ...(preserved?.model ? { model: preserved.model } : {}),
            ...(preserved?.promptVersion ? { promptVersion: preserved.promptVersion } : {}),
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
          // The coach note + its Intervals.icu auto-post now happen in /api/analyze (the deferred
          // LLM step), so this deterministic block returns without an AI call.
        } catch (e) {
          // Don't fail the whole sync on the deterministic analysis — but surface it.
          warnings.push(`Ride analysis failed: ${e instanceof Error ? e.message : String(e)}`);
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
    // A fresh ride has its deterministic analysis but no coach note yet — tell the client to
    // trigger /api/analyze for the (slow) LLM note rather than blocking this response on it.
    const analysisPending = todayAnalysis !== null && !todayAnalysis.coachNote;
    // Signal fusion (§5) recomputed on the fresh data so the glanceable state updates after a sync.
    const athleteState = computeAthleteState(
      athleteStateInputsFrom(lastSync, buildAthleteModel(scoreLog.entries), baselines, acwr)
    );
    // Rebuild the CoachSnapshot on the fresh data so the Today card updates after a sync without a
    // second round-trip (same builder as the GET + /api/ask — the athlete sees the LLM's numbers).
    const [blockForSnap, morningChecks, interventionLogForSnap, profileForSnap, settingsForSnap, baselinesForSnap] = await Promise.all([
      readCurrentBlock(),
      readMorningChecks(),
      readInterventionLog(),
      readAthleteProfile(),
      readBlockSettings(),
      readRollingBaselines(), // the freshly-persisted baselines (with updatedAt), written earlier this sync
    ]);
    const coachSnapshot = buildCoachSnapshotFromSources({
      date: today,
      ftp: physStore?.current.ftp ?? profileForSnap.performance.ftp,
      block: blockForSnap,
      sync: lastSync,
      todayAnalysis,
      scoreEntries: scoreLog.entries,
      baselines: baselinesForSnap,
      dispositions: dispositions.entries,
      interventionLog: interventionLogForSnap,
      morningChecks: morningChecks.entries,
      acwrBandsOverride: settingsForSnap.acwrBands,
    });
    return NextResponse.json({ lastSync, todayAnalysis, analysisPending, warnings, readiness, fatigueAlert, loadRamp, acwr, polarization, scores: scoreLog.entries.filter((e) => !e.legacy && !e.compromised), compromisedDates: [...compromisedDates(dispositions.entries)], partialDates: dispositions.entries.filter((e) => e.disposition === "partial").map((e) => e.date), athleteState, coachSnapshot });
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
