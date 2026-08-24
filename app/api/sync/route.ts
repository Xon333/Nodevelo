import { NextResponse } from "next/server";
import { logError, logWarn } from "@/lib/log";
import { snapshotBackup } from "@/lib/backup";
import { createEvent, deleteEvents, fetchEvents, fetchHrStream, fetchIntervals, fetchPowerStream, fetchSportSettings, isIntervalsConfigured, isSuspectEmptySync, runFullSync, IntervalsApiError } from "@/lib/intervals-api";
import { blockEventIds } from "@/lib/block-events";
import { blockChangedResponse } from "@/lib/block-version";
import { dayToEventPayload, reconcileInboundMoves } from "@/lib/calendar-mirror";
import { physiologyAsOf, readHrZones, readPhysiology, readPowerZones, reconcile, updatePhysiology } from "@/lib/physiology";
import { bucketZones } from "@/lib/zones";
import { matchPrescription } from "@/lib/interval-match";
import { parsePrescription } from "@/lib/prescription";
import { buildRideTrace } from "@/lib/trace";
import {
  appendBlockHistory,
  readAthleteProfile,
  readBlockHistory,
  readBlockSettings,
  readCurrentBlock,
  readDispositions,
  readCalibration,
  readInterventionLog,
  readIntentOverlays,
  readLastSync,
  readLedgerRebuild,
  readLoadingLog,
  readMorningChecks,
  readRollingBaselines,
  readScoreLog,
  updateScoreLog,
  updateInterventionLog,
  updateCalibration,
  updateAthleteProfile,
  writeLedgerRebuild,
  writeQuirks,
  writeTodayAnalysis,
  updateCurrentBlock,
  updateBlockHistory,
  mergeCurrentBlockDays,
  writeLastSync,
  writeRollingBaselines,
  readTodayAnalysis,
} from "@/lib/data-store";
import { extractQuirks } from "@/lib/quirks";
import { buildAthleteModel } from "@/lib/athlete-model";
import { athleteStateInputsFrom, computeAthleteState } from "@/lib/athlete-state";
import { overallCoachAccuracy, validateInterventions } from "@/lib/intervention";
import { calibrateNeat, calibrateNeatByDayType, computeNutritionTrendWarning, eaLevel, isRestDayFor, planEaKcalPerKg, resolveBuffer, resolveNeatImbalance, resolveNutritionModel, smoothedCurrentWeightKg, weightTrendFromWellness, CALIBRATION_PREFERRED_WINDOW_DAYS, DAY_TYPE_WINDOW_DAYS, WEIGHT_TREND_LONG_WINDOW_DAYS } from "@/lib/nutrition";
import { latestWeeklyBalance, weeklyEnergy } from "@/lib/trends";
import { buildTodayAnalysis } from "@/lib/ride-analysis";
import { gradeDurabilityDelivery } from "@/lib/durability-score";
import { backfillLedgerEntries, shouldRebuildLedger } from "@/lib/sync-ledger";
import { detectPowerPRs } from "@/lib/pr";
import { backfillExecutionOntoDays, buildRideScores, calStampFor, easyStampFor, fuelStampFor, intervalStampFrom, mergeScoreLog, mergeScoreLogRebuild, truncateBlockDays } from "@/lib/score-log";
import { applyDispositions, compromisedDates } from "@/lib/disposition";
import { buildFormStateLookup, computeAcwr, computeFatigueAlert, computeIntensityDistribution, computeLoadRamp, computeReadiness, computeRollingBaselines } from "@/lib/readiness";
import { deriveCarbsOptimum, deriveDecouplingGood, deriveIfBandOffsets, resolveAcwrBands, resolveAthleteStateWeights, trustedCalibration } from "@/lib/calibration";
import { buildCoachSnapshotFromSources } from "@/lib/coach-snapshot";
import { aerobicEffPct, isSteadyEnduranceRide, z2PwHrBaselineBefore } from "@/lib/aerobic";
import { timeAboveAerobicHrFraction } from "@/lib/execution-score";
import { resolveToday } from "@/lib/date";
import { deriveFuelPrompt } from "@/lib/fuel-prompt";
import { isAnthropicConfigured } from "@/lib/anthropic-config";
import { isSeasonFocus } from "@/lib/season";
import { findLedgerEntry } from "@/lib/ride-origin";
import { indexOverlaysByActivity, indexOverlaysByDate, resolveEffectiveOutcome } from "@/lib/intent-overlay";
import type { AcwrResult, ActivitySummary, CalibratedParameter, CurrentBlock, CurrentBlockDay, EffectiveOutcome, ExecutedInterval, IntentOverlay, LoadRampAlert, NoBlockSummary, PrescribedInterval, ReadinessSignal, RideEntryContext, RideScoreEntry, TodayAnalysis, WellnessEntry } from "@/lib/types";
import { resolveWeeklyEnvelope } from "@/lib/weekly-envelope";
import { updateWeeklyEnvelope } from "@/lib/data-store";
import { suggestSession } from "@/lib/session-suggestion";
import { composeNoBlockSummary } from "@/lib/no-block-summary";
import { isBlockFinished } from "@/lib/date";

// A sync fires several sequential Intervals.icu requests (each network-bounded to 20s in the API
// client) plus, on a ride day, per-ride stream/interval fetches. Cap the whole handler so a slow
// upstream surfaces as an error rather than an open-ended request (CR-B). The slow LLM coach note is
// deferred to /api/analyze, so this ceiling doesn't need to cover model latency.
export const maxDuration = 120;

function resolveTodayOutcome(
  todayAnalysis: TodayAnalysis | null,
  entries: RideScoreEntry[],
  overlays: IntentOverlay[]
): EffectiveOutcome | null {
  if (!todayAnalysis) return null;
  const entry = findLedgerEntry(entries, todayAnalysis.activityId, todayAnalysis.activityDate);
  if (!entry) return null;
  return resolveEffectiveOutcome(entry, indexOverlaysByActivity(overlays), indexOverlaysByDate(overlays));
}

// Phase 3a §8/§9/§10. Weekly-envelope + suggested-session + three-stream summary for the no-block Today
// surface — shared by GET and POST so the resolution logic exists exactly once.
function weekToDateLoad(activities: ActivitySummary[], weekStart: string, today: string): number {
  return activities
    .filter((a) => a.date >= weekStart && a.date <= today && a.trainingLoad !== null)
    .reduce((sum, a) => sum + (a.trainingLoad as number), 0);
}

async function resolveNoBlockSummary(
  block: CurrentBlock | null,
  today: string,
  activities: ActivitySummary[],
  scoreEntries: RideScoreEntry[],
  overlays: IntentOverlay[],
  wellness: WellnessEntry[],
  readiness: ReadinessSignal | null,
  loadRamp: LoadRampAlert | null,
  acwr: AcwrResult | null
): Promise<NoBlockSummary | null> {
  const noActiveBlock = !block || isBlockFinished(block, today);
  if (!noActiveBlock) return null;
  // GET's readiness/loadRamp are themselves null pre-first-sync (`lastSync ? computeX(...) : null`) —
  // there is no history to build an envelope OR a suggestion from yet, so this is its own real state,
  // not a 0-0 envelope manufactured from nothing.
  if (!readiness || !loadRamp) return null;

  // Read-compute-write as ONE atomic operation via updateWeeklyEnvelope — resolveWeeklyEnvelope's own
  // read of `current` happens INSIDE updateJson's lock, so two concurrent syncs can never both read the
  // same base and clobber each other's midweek reduction.
  const envelope = await updateWeeklyEnvelope(
    (persisted) => resolveWeeklyEnvelope({ today, persisted, activities, entries: scoreEntries, wellness }).envelope
  );

  const weekToDateTss = weekToDateLoad(activities, envelope.weekStart, today);
  const suggestion = await suggestSession(today, envelope, weekToDateTss, readiness, loadRamp, acwr, {
    currentBlock: block,
    scoreEntries,
    overlays,
  });
  const behaviour = buildAthleteModel(scoreEntries, overlays).behaviour;
  return composeNoBlockSummary(envelope, suggestion, behaviour, readiness, weekToDateTss);
}

// Resolve the athlete's carbsOptimum calibration into the shape deriveFuelPrompt wants — a value PLUS
// its confidence, so a "gap" claim can be gated on trustworthiness (calibrated-honesty: never let a
// population default masquerade as personalized). A named re-export of lib/calibration's shared
// trustedCalibration core (kept as a distinct function here for the existing test import and for local
// readability at the call site below) — no independent trust-precedence logic lives in this file, so it
// can't silently drift from resolveCalibratedValue's own precedence if that gate ever changes.
export function resolveCarbsOptimumForPrompt(
  param: CalibratedParameter | undefined | null
): { value: number; confidence: "low" | "medium" | "high" } | null {
  return trustedCalibration(param);
}

// GET returns the cached app state; it never hits Intervals.icu. `?today=` is the client's local date
// (so the CoachSnapshot resolves against the calendar day the athlete sees); falls back to UTC.
export async function GET(req: Request) {
  const today = resolveToday(new URL(req.url).searchParams.get("today"));
  const [lastSync, currentBlock, todayAnalysis, scoreLog, intentStore, profile, settings, dispositions, interventionLog, baselines, morningChecks, physStore, calibration] =
    await Promise.all([
      readLastSync(),
      readCurrentBlock(),
      readTodayAnalysis(),
      readScoreLog(),
      readIntentOverlays(),
      readAthleteProfile(),
      readBlockSettings(),
      readDispositions(),
      readInterventionLog(),
      readRollingBaselines(),
      readMorningChecks(),
      readPhysiology(),
      readCalibration(),
    ]);
  const readiness = lastSync
    ? computeReadiness(lastSync.fitness, lastSync.wellness)
    : null;
  const fatigueAlert = lastSync ? computeFatigueAlert(lastSync.fitness) : null;
  const loadRamp = lastSync ? computeLoadRamp(lastSync.activities, today) : null;
  const acwr = lastSync ? computeAcwr(lastSync.activities, resolveAcwrBands(settings.acwrBands), today) : null;
  const polarization = lastSync ? computeIntensityDistribution(lastSync.activities, profile.performance.ftp, 7, today) : null;
  // Signal fusion (§5): one glanceable state from the fused signals.
  const athleteState = computeAthleteState(
    athleteStateInputsFrom(lastSync, buildAthleteModel(scoreLog.entries, intentStore.overlays), acwr, today),
    resolveAthleteStateWeights(settings.athleteStateWeights)
  );
  // Phase 3a: the no-block weekly-envelope/session-suggestion/three-stream surface — null while a block
  // is genuinely active, or before the first sync (readiness/loadRamp themselves null there).
  const noBlockSummary = await resolveNoBlockSummary(
    currentBlock,
    today,
    lastSync?.activities ?? [],
    scoreLog.entries,
    intentStore.overlays,
    lastSync?.wellness ?? [],
    readiness,
    loadRamp,
    acwr
  );
  // The resolved-numbers snapshot the LLM is handed (ROADMAP #1) — same builder as /api/ask, so the
  // Today card shows the exact figures the coach reasons from (FTP off the physiology SoT).
  const latestWeightKgForEnergy =
    (lastSync?.wellness ?? [])
      .filter((w) => w.weightKg !== null)
      .sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ?? profile.performance.weightKg;
  const nutritionModelsByDayType = {
    rest: resolveNutritionModel(profile, latestWeightKgForEnergy, today, true),
    train: resolveNutritionModel(profile, latestWeightKgForEnergy, today, false),
  };
  // Resolved once and reused below for neatImbalance — same boolean the Today card's model pick is
  // already made from, so the two can never disagree on which day type "today" is.
  const isRestDayToday = isRestDayFor(lastSync?.activities ?? [], today);
  const nutritionModelForEnergy = isRestDayToday
    ? nutritionModelsByDayType.rest
    : nutritionModelsByDayType.train;
  const smoothedWeightKgForEnergy = smoothedCurrentWeightKg(lastSync?.wellness ?? [], today) ?? latestWeightKgForEnergy;
  const bufferStatus = resolveBuffer(
    profile.nutrition.neat,
    smoothedWeightKgForEnergy,
    profile.nutrition.targetWeightKg,
    profile.nutrition.targetRateKgPerWeek,
    weightTrendFromWellness(lastSync?.wellness ?? []),
    weightTrendFromWellness(lastSync?.wellness ?? [], WEIGHT_TREND_LONG_WINDOW_DAYS),
    profile.nutrition.buffer
  );
  // The prescribed target's OWN EA proxy — informational, see
  // docs/superpowers/specs/2026-08-06-prescribed-ea-warning-design.md. Uses the SAME
  // nutritionModelForEnergy + bufferStatus.bufferApplied the Today card's fuel figures already use —
  // one resolve, no second call.
  const planEaKcalPerKgValue = planEaKcalPerKg(nutritionModelForEnergy, bufferStatus.bufferApplied);
  const planEaLevel = planEaKcalPerKgValue === null ? null : eaLevel(planEaKcalPerKgValue);
  const nutritionTrendWarning = computeNutritionTrendWarning(
    lastSync?.wellness ?? [],
    lastSync?.activities ?? [],
    (isRestDay) => isRestDay ? nutritionModelsByDayType.rest : nutritionModelsByDayType.train,
    today,
    profile.nutrition.targetWeightKg,
    profile.nutrition.targetRateKgPerWeek,
    bufferStatus.bufferApplied
  );
  const coachSnapshot = buildCoachSnapshotFromSources({
    date: today,
    ftp: physStore?.current.ftp ?? profile.performance.ftp,
    block: currentBlock,
    sync: lastSync,
    todayAnalysis,
    scoreEntries: scoreLog.entries,
    intentOverlays: intentStore.overlays,
    baselines,
    dispositions: dispositions.entries,
    interventionLog,
    morningChecks: morningChecks.entries,
    acwrBandsOverride: settings.acwrBands,
    tsbModifierEdgesOverride: settings.tsbModifierEdges,
    athleteStateWeightsOverride: settings.athleteStateWeights,
    weeklyBalance: latestWeeklyBalance(
      weeklyEnergy(
        lastSync?.activities ?? [],
        lastSync?.wellness ?? [],
        today,
        (isRestDay) => isRestDay ? nutritionModelsByDayType.rest : nutritionModelsByDayType.train
      ),
      today
    ),
  });
  return NextResponse.json({
    configured: isIntervalsConfigured(),
    anthropicConfigured: isAnthropicConfigured(),
    lastSync,
    currentBlock,
    todayAnalysis,
    todayOutcome: resolveTodayOutcome(todayAnalysis, scoreLog.entries, intentStore.overlays),
    readiness,
    fatigueAlert,
    loadRamp,
    acwr,
    noBlockSummary,
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
    // Completed dates with no ledger score (true rest days taken, or a session the athlete attributed
    // before/without a synced ride) — lets the calendar show them as taken instead of blank/Missed.
    completedDates: dispositions.entries.filter((e) => e.disposition === "completed").map((e) => e.date),
    autoSyncOnOpen: settings.autoSyncOnOpen,
    // How often acting on the coach's matured directives proved right (validation loop). Null until
    // the 28-day horizon yields a decisive outcome; `pending` shows how many are still accruing.
    coachAccuracy: overallCoachAccuracy(interventionLog),
    // Signal fusion (§5): the glanceable "second brain's read on you now".
    athleteState,
    // ROADMAP #1: the resolved-numbers snapshot the LLM reads, surfaced so the athlete sees the same.
    coachSnapshot,
    // ROADMAP #2: the per-athlete calibration (read-only on Settings).
    calibration,
    // §10: the raw model + imbalance the Today tile needs for the under-fuelling streak alert and the
    // log-bias reconciliation line. Reuses the same resolved model coachSnapshot's fuel figures use
    // `nutritionModelForEnergy` is today's side of the same rest/train pair sent for historical reads.
    nutritionModel: nutritionModelForEnergy,
    nutritionModelsByDayType,
    // Once dayTypeNeat is adopted, the pooled solve clearing cleanly can mask a genuine out-of-band
    // clamp on the rest- or train-only split alone (docs/systems/09-nutrition.md, Calibration rule 3) —
    // resolveNeatImbalance picks whichever split is active today (isRestDayToday, same boolean the
    // model pick above uses) and tags which one it is; falls back to the pooled figure, untagged, when
    // no split exists yet (unchanged prior behaviour).
    neatImbalance: resolveNeatImbalance(profile.nutrition.neat, profile.nutrition.dayTypeNeat, isRestDayToday),
    nutritionTrendWarning,
    planEaKcalPerKg: planEaKcalPerKgValue,
    planEaLevel,
  });
}

// POST pulls fresh data from Intervals.icu, then (if a ride happened today)
// runs a short Claude analysis comparing actual vs planned.
export async function POST(req: Request) {
  if (!isIntervalsConfigured()) {
    return NextResponse.json(
      { error: "Connect Intervals.icu to sync." },
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
    // One-time ledger rebuild (SYNC-2): re-derive PAST entries from the freshly-synced activities
    // instead of freezing them. Needed once after the activity power-field mapping fix, which had
    // left NP/decoupling null on historical rides (so their IF/execution scores were computed off raw
    // avg watts). Off by default — a normal sync stays immutable per date. It's a destructive one-shot:
    // a persisted marker stops it re-running every sync (LEDGER-3); `force` re-runs after a future fix.
    const rebuildRequested = (reqBody as { rebuildLedger?: unknown } | null)?.rebuildLedger === true;
    const rebuildForce = (reqBody as { force?: unknown } | null)?.force === true;
    // Non-fatal step failures are collected here and returned so they surface (a toast) instead of
    // being swallowed by best-effort catches.
    const warnings: string[] = [];
    // The power curve as it stood BEFORE this sync — the baseline a new PR must beat (the fresh
    // sync absorbs today's ride into the curve, so the comparison has to use the prior one).
    const prevSync = await readLastSync();
    // Pass the prior all-time curve so it's preserved + kept monotonic when the fresh all-time fetch
    // is unavailable or partial, instead of being mislabelled by the 84-day curve (CR-H).
    const lastSync = await runFullSync(prevSync?.powerCurveAllTime ?? []);
    // CR-C: never let a garbage/empty upstream response overwrite a healthy store. A sync that comes
    // back with no activities AND no wellness when we had data before is an upstream problem, not a
    // reset — refuse loudly (the client shows the error) and keep the previous data intact.
    if (isSuspectEmptySync(prevSync, lastSync)) {
      return NextResponse.json(
        {
          error:
            "Intervals.icu returned no activities or wellness — likely a temporary upstream issue. Your previous data was kept; please retry shortly.",
        },
        { status: 502 }
      );
    }
    await writeLastSync(lastSync);

    // Task 4 (Phase 2): recalibrate the athlete's own NEAT multiplier from the freshly-synced data.
    // Deterministic, no AI. Best-effort — a calibration failure must never break a sync, so this is
    // wrapped independently and logged rather than left to bubble into the outer catch.
    //
    // DT Task 2: calibrateNeatByDayType (the rest/train split) is solved ALONGSIDE the pooled solve in
    // this same try/catch and persisted in the SAME updateAthleteProfile call — one lock acquisition,
    // one override guard re-check, so `neat` and `dayTypeNeat.pooled` can never observe two different
    // on-disk states mid-sync.
    try {
      const profileForNeat = await readAthleteProfile();
      const latestWeightKgForNeat =
        lastSync.wellness
          .filter((w) => w.weightKg !== null)
          .sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ?? profileForNeat.performance.weightKg;
      const isRestDayForNeat = isRestDayFor(lastSync.activities, today);
      const nutritionModelForNeat = resolveNutritionModel(profileForNeat, latestWeightKgForNeat, today, isRestDayForNeat);
      // Only the derived model carries an RMR to calibrate against — a legacy (pre-migration)
      // profile has nothing for calibrateNeat/calibrateNeatByDayType to solve relative to.
      if (nutritionModelForNeat.kind === "derived") {
        // The RMR fed into a calibration solve is applied uniformly across that solve's ENTIRE window
        // (calibrateNeat/calibrateNeatByDayType treat it as one constant), so it should reflect the
        // athlete's weight OVER that window, not today's single latest reading — a meaningful weight
        // change across a 42- or 90-day window biases `k` by ~2% per kg of drift. Only the calibration
        // RMR changes here: `nutritionModelForNeat`/`latestWeightKgForNeat` above stay on the raw
        // latest reading for the legacy-profile gate check (kind doesn't depend on weight) and are
        // untouched elsewhere in this file, where RMR SHOULD track current mass (today's actual target).
        const pooledWeightKgForNeat =
          smoothedCurrentWeightKg(lastSync.wellness, today, CALIBRATION_PREFERRED_WINDOW_DAYS) ?? latestWeightKgForNeat;
        const dayTypeWeightKgForNeat =
          smoothedCurrentWeightKg(lastSync.wellness, today, DAY_TYPE_WINDOW_DAYS) ?? latestWeightKgForNeat;
        const pooledRmr = resolveNutritionModel(profileForNeat, pooledWeightKgForNeat, today, isRestDayForNeat);
        const dayTypeRmr = resolveNutritionModel(profileForNeat, dayTypeWeightKgForNeat, today, isRestDayForNeat);
        // Both are guaranteed "derived" here — `kind` depends only on dateOfBirth/heightCm/sex, which
        // are identical across all three resolves; only the weight input (and therefore rmr) differs.
        const pooledRmrValue = pooledRmr.kind === "derived" ? pooledRmr.rmr : nutritionModelForNeat.rmr;
        const dayTypeRmrValue = dayTypeRmr.kind === "derived" ? dayTypeRmr.rmr : nutritionModelForNeat.rmr;
        const neatResult = calibrateNeat(lastSync.wellness, lastSync.activities, pooledRmrValue, today);
        const dayTypeResult = calibrateNeatByDayType(lastSync.wellness, lastSync.activities, dayTypeRmrValue, today);
        // Persist only a genuine derived solve. calibrateNeat's `stale` sentinel is also non-null (so
        // its reason survives for a live renderer to show), but persisting it here would silently
        // REVERT a good prior calibration to the population default the moment the athlete's batch
        // transfer lags past the staleness window — worse than just leaving the last good solve in
        // place until fresh data resumes. `dayTypeResult` shares the identical staleness/floor gate —
        // it wraps the SAME calibrateNeat call internally — so checking `.pooled.source === "derived"`
        // (rather than just `dayTypeResult !== null`) excludes that same stale/"default" pooled case
        // from being adopted as a fresh day-type split. Persisted even at shrinkageWeight 0 (forced
        // below DAY_TYPE_MIN_LOGGED_DAYS): that's still informative for Task 3's derivation panel, not
        // withheld like a bare null.
        const neatOk = neatResult !== null && neatResult.source === "derived";
        const dayTypeOk = dayTypeResult !== null && dayTypeResult.pooled.source === "derived";
        if (neatOk || dayTypeOk) {
          await updateAthleteProfile((p) =>
            // Re-checked INSIDE the lock against whatever's actually on disk right now, not the
            // `profileForNeat` snapshot read above — that read can be stale by the time this lock is
            // acquired (e.g. a concurrent PUT just set an override). An athlete's manual value
            // survives every re-solve, forever, until they clear it via the override endpoint (Step 5).
            // The same guard covers `dayTypeNeat` too: an override changes what "pooled" means, so a
            // day-type split shrunk toward the OLD pooled figure must not land while the override is live.
            p.nutrition.neat?.source === "override"
              ? p
              : {
                  ...p,
                  nutrition: {
                    ...p.nutrition,
                    ...(neatResult !== null && neatResult.source === "derived" ? { neat: neatResult } : {}),
                    ...(dayTypeResult !== null && dayTypeResult.pooled.source === "derived"
                      ? { dayTypeNeat: dayTypeResult }
                      : {}),
                  },
                }
          );
        }
      }
    } catch (e) {
      logWarn("/api/sync", "neat-calibration", e instanceof Error ? e.message : String(e));
    }

    // Reconcile the physiology store against Intervals.icu's current sport-settings (FTP,
    // zones, threshold/max HR). On a real change the old snapshot is archived with its own
    // effective date, so historical analyses stay anchored to the FTP that was live then.
    const incomingPhys = await fetchSportSettings(today);
    if (incomingPhys.status === "ok") {
      // HR-52: read-modify-write inside one locked critical section — two concurrent syncs (two open
      // tabs) previously could each reconcile from the same stale prior store and clobber each other's
      // FTP/zone change or history entry.
      await updatePhysiology((prev) => reconcile(prev, incomingPhys.snapshot, today).store);
    }
    // Task 7: surface `unavailable` vs `invalid` explicitly in sync warnings/status without changing
    // this route's best-effort behavior in Task 6.
    const physStore = await readPhysiology();

    let todayAnalysis: TodayAnalysis | null = null;

    // Always update rolling baselines on sync (deterministic, no AI needed).
    const baselines = computeRollingBaselines(lastSync.activities, lastSync.wellness, today);
    await writeRollingBaselines({ ...baselines, updatedAt: new Date().toISOString() });

    // Durability reference (ACC-2026-06-25): decoupling is no longer an execution input — it's a
    // steady-ride durability signal. Derive the athlete's "typical drift" from STEADY endurance rides
    // only (an interval day's whole-ride decoupling is a ride-structure artifact), so the reference the
    // CalibrationPanel shows is a clean number. Confidence comes from how many steady rides had a reading.
    const cutoff90 = new Date(Date.parse(today) - 90 * 86_400_000).toISOString().slice(0, 10);
    const stateFtp = physStore?.current.ftp ?? 0;
    const steadyEndurance90d = lastSync.activities.filter((a) => a.date >= cutoff90 && isSteadyEnduranceRide(a, stateFtp));
    const steadyDecoup = steadyEndurance90d.filter((a) => a.decoupling !== null);
    const steadyDecoupMean = steadyDecoup.length
      ? Math.round((steadyDecoup.reduce((s, a) => s + (a.decoupling as number), 0) / steadyDecoup.length) * 10) / 10
      : null;
    // HR-51: read-modify-write inside one locked critical section — the Model page's manual-override
    // POST (`app/api/calibration/route.ts`) already routes through `updateCalibration`; this re-derive
    // was the one-sided half, reading unlocked and writing with a plain `writeCalibration`. A manual
    // override landing in that window was real user input, not re-derivable, and would be silently
    // lost the moment this write landed.
    const calibration = await updateCalibration((priorCal) => ({
      decouplingGood: deriveDecouplingGood(priorCal.decouplingGood, steadyDecoupMean, steadyDecoup.length),
      // Track C: carbs optimum from the same steady-endurance candidate pool, classified against the
      // athlete's own trailing Z2 Pw:HR baseline (lib/aerobic.ts) — not decoupling, which this app
      // already demoted from scoring for being a ride-structure artifact (ACC-2026-06-25).
      carbsOptimum: deriveCarbsOptimum(
        priorCal.carbsOptimum,
        steadyEndurance90d.map((a) => ({
          carbsIngestedG: a.carbsIngestedG,
          aerobicEffPct: aerobicEffPct(a, z2PwHrBaselineBefore(lastSync.activities, a.date)),
          movingTimeSec: a.movingTimeSec,
        }))
      ),
      updatedAt: new Date().toISOString(),
    }));
    // The only value the scorer still needs: the per-type IF-band offsets from the athlete's power zones
    // (decoupling left execution scoring). Default zones → empty offsets → identical scoring.
    const resolvedCal = {
      ifBandOffsets: deriveIfBandOffsets(physStore?.current.powerZonePct ?? []),
    };

    // Track D: mine ride notes for recurring quirks (deterministic, no AI). Regenerated in full each
    // sync. Best-effort — extraction must never break a sync.
    try {
      await writeQuirks(extractQuirks(lastSync.activities));
    } catch (e) {
      logWarn("/api/sync", "quirk-extraction", e instanceof Error ? e.message : "unknown error");
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
    // Morning-check log read once here and reused for the snapshot below (CS-6 — previously read twice).
    const morningChecks = await readMorningChecks();
    {
      let block = await readCurrentBlock();
      const blockHistory = await readBlockHistory();
      const blockStarts = [block?.startDate, ...blockHistory.map((h) => h.startDate)].filter(
        (d): d is string => !!d
      );
      const offPlanFloor = blockStarts.length ? blockStarts.sort()[0] : null;

      // Athlete-state context as of each ride's date, stamped onto each entry for the future
      // state→execution correlation (ROADMAP #2): the objective form (CTL/ATL/TSB, carried-forward from the
      // synced wellness stream). The subjective morning read was removed — the morning override is now a
      // manual ill/extreme-fatigue flag that isn't ledger provenance.
      const formStateForDate = buildFormStateLookup(lastSync.wellness);
      const contextForDate = (date: string): RideEntryContext | null => {
        const formState = formStateForDate(date) ?? undefined;
        return formState ? { formState } : null;
      };

      // Birth-time interval-adherence fetch (the late-sync gap): buildRideScores only ever gets
      // interval-aware scoring for TODAY (the richer today-patch below, which fetches per-ride
      // intervals for the day's own activity). A ride synced a day or more late never got that
      // treatment — it was born coarse (duration/IF only) and stayed that way forever, since a
      // ledger entry is immutable per date. Best-effort fetch a small, bounded number of recently
      // missed planned interval dates here so they're BORN with adherence data instead.
      const existingLedger = await readScoreLog();
      const existingByDate = new Map<string, RideScoreEntry>(existingLedger.entries.map((e) => [e.date, e]));

      // Same planned-day-by-date map buildRideScores builds internally (not exported — replicated
      // here deliberately; this task's scope is this route file only, not lib/score-log.ts).
      const plannedByDate = new Map<string, CurrentBlockDay>();
      const sortedHistory = [...blockHistory].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const h of sortedHistory) {
        if (!h.days) continue;
        const createdDate = h.createdAt.slice(0, 10);
        for (const d of h.days) if (d.durationMin > 0 && createdDate <= d.date) plannedByDate.set(d.date, d);
      }
      if (block) for (const d of block.days) if (d.durationMin > 0) plannedByDate.set(d.date, d);

      // The date's longest ride (mirrors buildRideScores' own "two rides one date, longer wins" rule),
      // and the FTP basis that ride will actually be scored against — shared by the gating pass (to
      // check the re-parsed prescription is non-empty) and the fetch pass, so the two can never
      // compute a different prescription for the same date.
      const longestRideOn = (date: string): ActivitySummary | null => {
        const dayActivities = lastSync.activities.filter(
          (a) => a.date === date && (a.type === "Ride" || a.type === "VirtualRide")
        );
        if (dayActivities.length === 0) return null;
        return dayActivities.reduce((longest, a) => (a.movingTimeSec > longest.movingTimeSec ? a : longest));
      };
      const prescriptionFor = (day: CurrentBlockDay, act: ActivitySummary): PrescribedInterval[] => {
        const ftp = act.icuFtp ?? ftpForDate(day.date);
        return day.workoutText ? parsePrescription(day.workoutText, ftp) : day.prescription ?? [];
      };

      // Candidates: genuine interval days (not Z2/Recovery/durability — those don't grade on
      // adherence at all), not already frozen in the ledger (immutability preserved by construction),
      // strictly before today (today owns the richer today-path), with a non-empty re-parsed
      // prescription (nothing worth fetching for otherwise).
      const candidateDates: string[] = [];
      for (const [date, day] of plannedByDate) {
        if (day.type === "Z2" || day.type === "Recovery" || Boolean(day.durabilityTemplate)) continue;
        if (existingByDate.has(date)) continue;
        if (date >= today) continue;
        const act = longestRideOn(date);
        if (!act) continue; // defensive — shouldn't happen for a planned date, but nothing to fetch
        if (prescriptionFor(day, act).length === 0) continue;
        candidateDates.push(date);
      }
      candidateDates.sort((a, b) => b.localeCompare(a)); // newest first
      const totalQualifying = candidateDates.length;
      if (totalQualifying > 6) {
        logWarn("/api/sync", "birth-adherence", `capped at 6 of ${totalQualifying} candidate dates`);
        warnings.push(`Interval-adherence birth-fetch capped at 6 of ${totalQualifying} eligible past dates.`);
      }
      const cappedDates = candidateDates.slice(0, 6);

      // Wall-clock budget (CR-review Finding 2): each fetchIntervals call is bounded to 20s
      // (REQUEST_TIMEOUT_MS in lib/intervals-api.ts) and the cap allows up to 6 sequential calls —
      // worst case 120s, exactly this route's own `maxDuration`. A degraded-but-not-down upstream
      // (slow responses, queued rate-limiting) could push an otherwise-healthy sync into a hard
      // timeout. Stop attempting further candidates once the budget is exceeded. Anything left
      // unfetched is NOT deferred or retried — it still gets a normal (coarse) ledger entry from
      // buildRideScores in this same sync, and the birth-fetch candidate filter permanently excludes
      // any date already in the ledger. Skipped-for-budget dates are born coarse permanently, exactly
      // like a candidate that exceeded the cap-of-6 above.
      const BIRTH_FETCH_BUDGET_MS = 40_000;
      const birthFetchStart = Date.now();
      const fetchedStamps = new Map<string, RideScoreEntry["intervals"]>();
      let candidatesAttempted = 0;
      for (const date of cappedDates) {
        if (Date.now() - birthFetchStart > BIRTH_FETCH_BUDGET_MS) break;
        candidatesAttempted++;
        try {
          const act = longestRideOn(date);
          if (!act) continue; // defensive — already checked during gating, but never trust it twice
          const planned = plannedByDate.get(date)!;
          const prescription = prescriptionFor(planned, act);
          const executed = await fetchIntervals(act.id);
          // CRITICAL (CR-review Finding 1): fetchIntervals never rejects — it swallows timeouts,
          // rate-limits, and malformed responses internally and resolves to [] (see its own
          // "Best-effort: [] on failure" comment). matchPrescription does NOT treat an empty
          // `executed` against a non-empty `prescription` as null — it returns a fully-formed
          // comparison with a fabricated real 0% adherence (structuralMismatch: false), which
          // buildRideScores' guard would treat as trustworthy signal and freeze onto the immutable
          // ledger forever (this date is never retried once present). Treat an empty fetch result
          // exactly like a thrown failure: skip stamping and let the entry born coarse — the plan's
          // own intended fallback for "no executed intervals curated".
          if (executed.length === 0) {
            logWarn("/api/sync", "birth-adherence", `no executed intervals for ${date} — entry born coarse.`);
            warnings.push(`Interval-adherence fetch returned no executed intervals for ${date} — entry born coarse.`);
            continue;
          }
          const comparison = matchPrescription(prescription, executed);
          if (comparison) fetchedStamps.set(date, intervalStampFrom(comparison));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          logWarn("/api/sync", "birth-adherence", `fetch failed for ${date}: ${message}`);
          warnings.push(`Interval-adherence fetch failed for ${date}: ${message} — entry born coarse.`);
        }
      }
      const candidatesSkippedForBudget = cappedDates.length - candidatesAttempted;
      if (candidatesSkippedForBudget > 0) {
        logWarn("/api/sync", "birth-adherence", `time budget exceeded — skipped ${candidatesSkippedForBudget} of ${cappedDates.length} candidate dates`);
        warnings.push(`Interval-adherence birth-fetch time budget exceeded — ${candidatesSkippedForBudget} candidate date(s) born coarse.`);
      }

      // Fetched (fresh) first; frozen stamps second — serves the rebuild path, where `fresh` re-scores
      // overlapping dates and needs the frozen adherence stamp an existing entry already carries
      // instead of re-fetching it.
      const adherenceForDate = (date: string): RideScoreEntry["intervals"] | null =>
        fetchedStamps.get(date) ?? existingByDate.get(date)?.intervals ?? null;

      // Track C: day-before loading attribution, stamped at birth on durability-day entries.
      const loadingLog = await readLoadingLog();
      const preLoadForDate = (date: string): { loaded: boolean; targetG: number } | null => {
        const rec = loadingLog.entries.find((l) => l.rideDate === date);
        return rec ? { loaded: rec.response === "loaded", targetG: rec.targetG } : null;
      };

      // §7 inbound: the athlete may have moved NodeVelo events on the Intervals.icu calendar (the head
      // unit's source of truth). Reconcile date moves into the local block BEFORE scoring, so this
      // sync's planned-day matching sees the same calendar the athlete rode from. Best-effort — a
      // calendar hiccup must never fail the sync. Note: this does NOT retroactively update the
      // birth-adherence `plannedByDate` map built earlier in this block (lines 306-315) — that map is a
      // separate, already-existing best-effort enhancement scoped to PAST dates; buildRideScores below
      // is the consumer this task cares about, and it sees the reconciled `block` directly.
      if (block) {
        try {
          const calendarEvents = await fetchEvents(block.startDate, block.endDate);
          const rec = reconcileInboundMoves(block, calendarEvents, today);
          if (rec) {
            if (rec.applied.length > 0) {
              block = { ...block, days: rec.days };
              // HR-4: only the dates this reconcile actually touched go to disk, merged onto a fresh
              // read — a concurrent reschedule/morning-check write to some other day can't be clobbered.
              const touchedDates = new Set(rec.applied.flatMap((m) => [m.from, m.to]));
              await mergeCurrentBlockDays(block.days.filter((d) => touchedDates.has(d.date)));
              warnings.push(...rec.applied.map((m) => `Calendar move applied: ${m.from} → ${m.to} (from Intervals.icu).`));

              // Fix B (final review): reconcileInboundMoves relocates the block day but — by that
              // function's own documented limit — never re-keys the calendar event's own external_id,
              // which is still stamped with its OLD date. Left alone, a SUBSEQUENT outbound move
              // touching this date would miss it (buildMovePayloads' id-keyed lookup finds nothing) and
              // createEvent would spawn a duplicate instead of updating it. Re-stamp best-effort, per
              // move, via create+delete (not an unverified bulk re-key-by-id — create+delete are the
              // primitives already proven to work live): create a fresh event at `to` with the current
              // `nodevelo-<to>` external_id, carrying the OLD (drifted) event's description, then delete
              // the old numeric id. A failure here never fails the sync — the local move already stands.
              // Each move's re-stamp (create + delete) is independent of every other move's, so run
              // them concurrently instead of one at a time — sequential per-date network round-trips
              // here meant N moves paid N times the latency for no reason.
              const byCalendarId = new Map(calendarEvents.filter((e) => e.id !== null).map((e) => [e.id as number, e]));
              const snapshot = block;
              const restampResults = await Promise.allSettled(
                rec.applied.map(async ({ to }) => {
                  const toDay = snapshot.days.find((d) => d.date === to);
                  if (!toDay || typeof toDay.eventId !== "number") return null;
                  const oldId = toDay.eventId;
                  const matched = byCalendarId.get(oldId);
                  const newId = await createEvent(dayToEventPayload(toDay, matched?.description ?? ""));
                  if (newId === null) return null;
                  await deleteEvents([oldId]);
                  return { to, newId };
                })
              );
              const restampedByDate = new Map<string, number>();
              restampResults.forEach((r, i) => {
                if (r.status === "fulfilled" && r.value) {
                  restampedByDate.set(r.value.to, r.value.newId);
                } else if (r.status === "rejected") {
                  const { to } = rec.applied[i];
                  logWarn("/api/sync", "calendar-restamp", r.reason instanceof Error ? r.reason.message : String(r.reason));
                  warnings.push(`Calendar external_id re-stamp failed for ${to} — a later outbound move to/from this date may create a duplicate event.`);
                }
              });
              if (restampedByDate.size > 0) {
                block = { ...block, days: block.days.map((d) => (restampedByDate.has(d.date) ? { ...d, eventId: restampedByDate.get(d.date)! } : d)) };
                await mergeCurrentBlockDays(block.days.filter((d) => touchedDates.has(d.date)));
              }
            }
            warnings.push(...rec.warnings);
          }
        } catch (e) {
          logWarn("/api/sync", "calendar-reconcile", e instanceof Error ? e.message : String(e));
          warnings.push("Intervals.icu calendar check skipped (fetch failed) — plan/calendar may be out of step until the next sync.");
        }
      }

      const fresh = buildRideScores(
        block,
        lastSync.activities,
        ftpForDate,
        today,
        offPlanFloor,
        resolvedCal,
        contextForDate,
        blockHistory,
        adherenceForDate,
        preLoadForDate
      );
      // One-shot guard (LEDGER-3): the rebuild runs at most once. A normal sync never requests it; a
      // repeat request after the persisted marker is refused unless `force` is set.
      // HR-53: truthy check, not `!== null` — the AGENTS.md-documented migration-flag anti-pattern. A
      // hand-edited or partially-imported marker file (`{}` on disk) parses back with `rebuiltAt`
      // entirely absent (`undefined`, not `null`), which a strict null-check would wrongly read as
      // "already rebuilt" and silently refuse a genuinely-requested rebuild forever.
      const rebuildMarker = await readLedgerRebuild();
      const doRebuild = shouldRebuildLedger(rebuildRequested, Boolean(rebuildMarker.rebuiltAt), rebuildForce);
      if (rebuildRequested && !doRebuild) {
        warnings.push(`Ledger rebuild skipped — already rebuilt ${rebuildMarker.rebuiltAt} (one-time migration; pass force to re-run).`);
      }
      // Transactional (CR-A): the backfill is computed from the ledger read INSIDE the lock, so a
      // concurrent disposition POST (or the deferred analyze patch) can't clobber these scores. The
      // backfill itself is the pure, unit-tested backfillLedgerEntries (CR-G).
      await updateScoreLog(async (entries) => {
        const backfilled = backfillLedgerEntries(entries, ftpForDate, offPlanFloor);
        // Normal sync: existing wins (immutable per date). Rebuild: fresh (recomputed from corrected
        // activities) wins, while existing still fills any date outside the activity window — but a
        // rebuild never downgrades a frozen planned ride to off-plan and carries forward frozen context
        // (LEDGER-1/2; see mergeScoreLogRebuild).
        const merged = doRebuild ? mergeScoreLogRebuild(fresh, backfilled) : mergeScoreLog(backfilled, fresh);
        // HR-40: re-read dispositions INSIDE the lock, immediately before applying them — reading them
        // once outside (before this critical section) meant a disposition POST landing in that window
        // had its stamp immediately un-set by this sync's now-stale snapshot the moment this write
        // landed, since applyDispositions sets `compromised` to exactly the snapshot it's handed.
        const dispositions = (await readDispositions()).entries;
        return applyDispositions(merged, dispositions);
      });
      if (doRebuild) {
        await writeLedgerRebuild(new Date().toISOString());
        warnings.push("Ledger rebuilt: past entries re-scored from corrected activity data (NP/decoupling).");
      }

      // §8 (season-architecture-redesign): now that the ledger reflects this sync's fresh scores,
      // backfill the real execution outcome onto the matching day — current block first (the common
      // case: a sync usually lands while the block that prescribed the ride is still live), then any
      // block-history entry that still carries the same date (a late sync after the block was already
      // archived/replaced). Best-effort: never fail the sync over a provenance stamp.
      try {
        const freshLog = await readScoreLog();
        const blockForBackfill = await readCurrentBlock();
        if (blockForBackfill) {
          const patchedDays = backfillExecutionOntoDays(blockForBackfill.days, freshLog.entries);
          if (patchedDays !== blockForBackfill.days) {
            const changedDates = new Set(
              patchedDays.filter((d, i) => d !== blockForBackfill.days[i]).map((d) => d.date)
            );
            await mergeCurrentBlockDays(patchedDays.filter((d) => changedDates.has(d.date)));
          }
        }
        const history = await readBlockHistory();
        const historyNeedsPatch = history.some((h) => h.days && backfillExecutionOntoDays(h.days, freshLog.entries) !== h.days);
        if (historyNeedsPatch) {
          await updateBlockHistory((entries) =>
            entries.map((h) => (h.days ? { ...h, days: backfillExecutionOntoDays(h.days, freshLog.entries) } : h))
          );
        }
      } catch (e) {
        logWarn("/api/sync", "execution-backfill", e instanceof Error ? e.message : String(e));
        warnings.push(`Execution-outcome backfill failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Close the learning loop: re-evaluate any matured interventions against the freshly
    // updated model + sync, marking whether acting on each past insight actually worked.
    try {
      const [scoreLog, intentStore] = await Promise.all([readScoreLog(), readIntentOverlays()]);
      const model = buildAthleteModel(scoreLog.entries, intentStore.overlays);
      // HR-36: read-modify-write inside one locked critical section — a concurrent write's
      // fresh-intervention merge (app/api/write/route.ts) can no longer read the same stale base and
      // clobber this validation pass (or vice versa). validateInterventions itself only bumps
      // updatedAt when something actually changed, so an unchanged pass still rewrites identical
      // content — harmless, and simpler than threading `changed` through the lock.
      await updateInterventionLog((log) => validateInterventions(log, model, lastSync, today).log);
    } catch (e) {
      // Never fail a sync on the validation pass — but surface it instead of swallowing silently.
      logWarn("/api/sync", "intervention-validation", e instanceof Error ? e.message : String(e));
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
          // --- I/O: re-bucket power & HR into the athlete's OWN zones (from the physiology store).
          // Intervals' power zones are often null and its HR boundaries can differ, so we compute
          // time-in-zone from the raw streams. Best-effort: fall back to whatever Intervals provided
          // if a stream or the zone definitions are unavailable.
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

          // --- I/O: compare the coach's prescription against the intervals curated in Intervals.icu,
          // and build the power-trace (downsampled streams + work bands).
          // Re-derive the prescription from the day's workout text rather than trusting the stored
          // array: a block written before the repeat-block parser fix carries a mis-ordered prescription
          // (over-unders flattened [O,O,U,U] instead of [O,U,O,U]), which mis-aligned every rep. Re-parsing
          // self-heals the matching AND the PRESCRIBED chips on the next sync, no block re-write needed.
          // Falls back to the stored array if a day has no workout text. FTP targets are %FTP-based.
          const prescription = plannedDay?.workoutText
            ? parsePrescription(plannedDay.workoutText, profile.performance.ftp)
            : plannedDay?.prescription ?? [];
          let intervalComparison = null;
          let executed: ExecutedInterval[] = [];
          if (prescription.length > 0) {
            executed = await fetchIntervals(todayActivity.id);
            // CRITICAL (CR-review Finding 1, re-review): fetchIntervals never rejects — it resolves
            // to [] on any upstream failure. matchPrescription does NOT treat an empty `executed`
            // against a non-empty `prescription` as null — it fabricates a fully-formed 0% adherence
            // comparison (structuralMismatch: false), which this patch would freeze onto the immutable
            // ledger entry for today. The "self-healing" defense (re-runs every sync until day
            // rollover) does not reliably hold — sync here is user-triggered only, so a transient
            // blip on the day's last sync freezes permanently. Mirror the birth-fetch loop's guard:
            // skip matching entirely when there's nothing executed to compare.
            intervalComparison = executed.length > 0 ? matchPrescription(prescription, executed) : null;
          }
          const trace = buildRideTrace(powerStream, hrStream, executed, prescription[0]?.targetWatts ?? null);

          // Power PRs: durations where this sync's ALL-TIME best beat the previous sync's all-time
          // best. All-time is monotonic (only rises on a genuine PR), so unlike the 84-day curve it
          // never false-drops as efforts age out of a window — and the delta is a true all-time PR.
          const powerPRs = detectPowerPRs(
            lastSync.powerCurveAllTime ?? lastSync.powerCurve,
            prevSync?.powerCurveAllTime ?? []
          );

          // Hoisted once — reused by buildTodayAnalysis's aerobicEffPct input AND the easy-ride
          // ledger stamp in the today-patch below, so today's frozen `easy` stamp is built from the exact
          // same re-bucketed hrZoneTimes / aerobicEffPct that produced this entry's executionScore (the
          // drift class the 2026-07-11 "Coach-prompt aerobic-discipline gap closed" fix cleaned up for a
          // different surface). Avoids a duplicate aerobicEffPct(...) call with identical arguments.
          const todayAerobicEffPct = aerobicEffPct(todayActivity, z2PwHrBaselineBefore(lastSync.activities, todayActivity.date));
          const todayAboveAerobicHrFrac = timeAboveAerobicHrFraction(hrZoneTimes);

          // Resolve the model + buffer ONCE here, the same way the profile route does, so the Today
          // card's advised intake can never disagree with the reference table block generation built.
          const latestWeightKgForToday =
            lastSync.wellness
              .filter((w) => w.weightKg !== null)
              .sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ?? profile.performance.weightKg;
          // GOAL comparison (resolveBuffer's currentKg) uses the smoothed figure, not the raw latest
          // weigh-in — a single reading swings ±0.5–1 kg and was flipping the buffer across the deadband
          // boundary depending on which weigh-in happened to be last (I2). resolveNutritionModel above
          // stays on the raw latest reading — RMR should track current mass, not a smoothed goal figure.
          const smoothedWeightKgForToday =
            smoothedCurrentWeightKg(lastSync.wellness, today) ?? latestWeightKgForToday;
          const todayNutritionModel = resolveNutritionModel(
            profile,
            latestWeightKgForToday,
            today,
            isRestDayFor(lastSync.activities, today)
          );
          // buffer-redesign-feedforward Task 2: resolveBuffer replaces adjustBuffer — goal-rate
          // feed-forward when profile.nutrition.neat is trustworthy, else the trend-servo fallback
          // seeded from the goal surplus (never the retired profile.nutrition.buffer setting).
          const todayBufferStatus = resolveBuffer(
            profile.nutrition.neat,
            smoothedWeightKgForToday,
            profile.nutrition.targetWeightKg,
            profile.nutrition.targetRateKgPerWeek,
            weightTrendFromWellness(lastSync.wellness),
            weightTrendFromWellness(lastSync.wellness, WEIGHT_TREND_LONG_WINDOW_DAYS),
            profile.nutrition.buffer
          );

          // --- Pure: assemble the deterministic analysis (metrics, execution score, capped
          // compliance, advised intake, coach-note preservation) — extracted + unit-tested (CR-G).
          const { todayAnalysis: built, executionScore, resolvedCompliancePct } = buildTodayAnalysis({
            today,
            activity: todayActivity,
            plannedDay,
            ftp: profile.performance.ftp,
            nutrition: { model: todayNutritionModel, bufferApplied: todayBufferStatus.bufferApplied },
            powerZoneTimes,
            hrZoneTimes,
            // The athlete's synced zone tops (%FTP) as-of the ride — the IF band label's boundaries, so it
            // reflects their own Intervals.icu zones and tracks any FTP/zone change (effective-dated).
            powerZoneTopsPct: physiologyAsOf(physStore, todayActivity.date)?.powerZonePct ?? null,
            // Off-plan aerobic read: today's Z2 Pw:HR vs the athlete's baseline from prior qualifying rides.
            aerobicEffPct: todayAerobicEffPct,
            executed, // Track B: the ride's intervals, to grade a durability long ride's effort delivery
            intervalComparison,
            trace,
            powerPRs,
            preserved: priorAnalysis,
            resolvedCal,
          });
          // Deterministic post-ride fuel prompt (lib/fuel-prompt.ts) — computed once per sync, today's
          // ride only. Pure decision, no LLM. Absent/null → key omitted entirely (sparse-field
          // convention this codebase already uses for formState/intervals — never persist `null`).
          const fuelPrompt = deriveFuelPrompt({
            activity: todayActivity,
            plannedType: plannedDay?.type ?? null,
            carbsOptimum: resolveCarbsOptimumForPrompt(calibration.carbsOptimum),
          });
          todayAnalysis = { ...built, ...(fuelPrompt ? { fuelPrompt } : {}) };
          await writeTodayAnalysis(todayAnalysis);

          // Track C: the same pure grader buildTodayAnalysis calls internally (lib/ride-analysis.ts)
          // to feed executionScore — it isn't returned from that result, and only the today-patch below
          // needs the raw signal for provenance, so it's cheaper to recompute here (same inputs, already
          // in scope) than to widen buildTodayAnalysis's return shape for one caller.
          const durabilityDelivery = gradeDurabilityDelivery(
            plannedDay?.durabilityTemplate ?? null,
            executed,
            profile.performance.ftp,
            todayActivity.movingTimeSec
          );

          // Keep the ledger's entry for today consistent with this richer, interval-aware
          // analysis. buildRideScores can't see interval bails (it doesn't fetch per-ride
          // intervals); this can — so today's execution + capped compliance match across the
          // Today card, the Plan calendar, the trend pulse, and Trends.
          try {
            if (executionScore !== null) {
              // Transactional (CR-A): re-read + patch today's entry inside the per-file lock so this
              // richer interval-aware score can't clobber (or be clobbered by) a concurrent write.
              await updateScoreLog((entries) =>
                entries.map((e) =>
                  e.date === today && !e.legacy
                    ? {
                        ...e,
                        executionScore,
                        compliancePct: resolvedCompliancePct,
                        // Re-stamp with the current calibration (this entry may be a stale prior one) —
                        // the per-type IF offset for a planned day; off-plan rides skip it (intensity-vs-type
                        // branch is circular for them), so they stamp nothing.
                        ...calStampFor(resolvedCal, e.planned ? e.plannedType : null, !e.planned),
                        // Freeze the adherence input that produced this richer score (the direct SIT-bug
                        // fix): without this, a re-derivation later has no adherence data to work from.
                        // Guarded the same way the birth-fetch path gates its candidates (Finding 3):
                        // Z2/Recovery/durability days are scored by an entirely different system, so an
                        // `intervals` stamp there would be meaningless provenance — a latent trap for any
                        // future consumer of `entry.intervals` that assumes its presence implies relevance.
                        ...(intervalComparison &&
                        plannedDay?.type !== "Z2" &&
                        plannedDay?.type !== "Recovery" &&
                        !plannedDay?.durabilityTemplate
                          ? { intervals: intervalStampFrom(intervalComparison) }
                          : {}),
                        // Track C: freeze the delivery grade that judged today's durability ride — the
                        // loading loop's power-only outcome. Only the today path can stamp this (it alone
                        // fetches executed intervals); a late-synced durability ride stays unstamped and
                        // simply doesn't feed the loop.
                        ...(plannedDay?.durabilityTemplate && durabilityDelivery != null
                          ? { durabilityDelivery: { signal: durabilityDelivery.signal } }
                          : {}),
                        // Re-stamp the easy-ride merged-read provenance from THIS richer, re-bucketed
                        // HR data — without this, today's frozen `easy` stamp would stay whatever
                        // buildRideScores computed from the raw (non-re-bucketed) hrZoneTimes, drifting from
                        // the executionScore this same patch just replaced. Gated internally by easyStampFor
                        // itself (Z2/Recovery, non-embeds-efforts template) — `{}` when it doesn't apply.
                        ...easyStampFor(todayActivity, plannedDay?.type ?? "", plannedDay?.durabilityTemplate, todayAboveAerobicHrFrac, todayAerobicEffPct),
                        // NV-13 (2026-08-15): mergeScoreLog's "existing overrides fresh" rule freezes
                        // whatever fuelStampFor read at the FIRST sync of the day — if carbs were logged
                        // on Intervals.icu after that (a common sequence: sync, then log nutrition), every
                        // later sync's freshly-computed fuel stamp was discarded in favour of the stale,
                        // carbs-less one. Only this today-patch can still mutate today's entry, so it's the
                        // one place that can refresh the stamp while the date is still mutable.
                        // Spread-ready `{}` from fuelStampFor when nothing is logged — preserves whatever
                        // this entry already had (does not un-stamp on a transient carbs read failure).
                        ...fuelStampFor(todayActivity),
                      }
                    : e
                )
              );
            }
          } catch (e) {
            // Best-effort — the ledger already has a coarse entry from buildRideScores.
            logWarn("/api/sync", "ride-trace-match", e instanceof Error ? e.message : String(e));
          }
          // The coach note + its Intervals.icu auto-post now happen in /api/analyze (the deferred
          // LLM step), so this deterministic block returns without an AI call.
        } catch (e) {
          // Don't fail the whole sync on the deterministic analysis — but surface it.
          logWarn("/api/sync", "ride-analysis", e instanceof Error ? e.message : String(e));
          warnings.push(`Ride analysis failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    const readiness = computeReadiness(lastSync.fitness, lastSync.wellness);
    const fatigueAlert = computeFatigueAlert(lastSync.fitness);
    const loadRamp = computeLoadRamp(lastSync.activities, today);
    const acwr = computeAcwr(lastSync.activities, resolveAcwrBands((await readBlockSettings()).acwrBands), today);
    const polarization = computeIntensityDistribution(lastSync.activities, (await readAthleteProfile()).performance.ftp, 7, today);
    const [scoreLog, intentStore, dispositions] = await Promise.all([
      readScoreLog(),
      readIntentOverlays(),
      readDispositions(),
    ]);
    // A fresh ride has its deterministic analysis but no coach note yet — tell the client to
    // trigger /api/analyze for the (slow) LLM note rather than blocking this response on it.
    const analysisPending = todayAnalysis !== null && !todayAnalysis.coachNote;
    // Signal fusion (§5) recomputed on the fresh data so the glanceable state updates after a sync.
    const athleteState = computeAthleteState(
      athleteStateInputsFrom(lastSync, buildAthleteModel(scoreLog.entries, intentStore.overlays), acwr, today),
      resolveAthleteStateWeights((await readBlockSettings()).athleteStateWeights)
    );
    // Rebuild the CoachSnapshot on the fresh data so the Today card updates after a sync without a
    // second round-trip (same builder as the GET + /api/ask — the athlete sees the LLM's numbers).
    const [blockForSnap, interventionLogForSnap, profileForSnap, settingsForSnap, baselinesForSnap] = await Promise.all([
      readCurrentBlock(),
      readInterventionLog(),
      readAthleteProfile(),
      readBlockSettings(),
      readRollingBaselines(), // the freshly-persisted baselines (with updatedAt), written earlier this sync
    ]); // morningChecks already read once above (CS-6)
    // Phase 3a: the no-block weekly-envelope/session-suggestion/three-stream surface. POST's
    // readiness/loadRamp/acwr are never null (computed unconditionally above from lastSync, which POST
    // has already confirmed exists by this point) — resolveNoBlockSummary's nullable params simply never
    // read null on this path. Reuses blockForSnap rather than a second readCurrentBlock() call.
    const noBlockSummary = await resolveNoBlockSummary(
      blockForSnap,
      today,
      lastSync.activities,
      scoreLog.entries,
      intentStore.overlays,
      lastSync.wellness,
      readiness,
      loadRamp,
      acwr
    );
    const latestWeightKgForSnapEnergy =
      (lastSync?.wellness ?? [])
        .filter((w) => w.weightKg !== null)
        .sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ?? profileForSnap.performance.weightKg;
    const nutritionModelForSnapDay = (isRestDay: boolean) =>
      resolveNutritionModel(profileForSnap, latestWeightKgForSnapEnergy, today, isRestDay);
    const coachSnapshot = buildCoachSnapshotFromSources({
      date: today,
      ftp: physStore?.current.ftp ?? profileForSnap.performance.ftp,
      block: blockForSnap,
      sync: lastSync,
      todayAnalysis,
      scoreEntries: scoreLog.entries,
      intentOverlays: intentStore.overlays,
      baselines: baselinesForSnap,
      dispositions: dispositions.entries,
      interventionLog: interventionLogForSnap,
      morningChecks: morningChecks.entries,
      acwrBandsOverride: settingsForSnap.acwrBands,
      tsbModifierEdgesOverride: settingsForSnap.tsbModifierEdges,
      athleteStateWeightsOverride: settingsForSnap.athleteStateWeights,
      weeklyBalance: latestWeeklyBalance(weeklyEnergy(lastSync?.activities ?? [], lastSync?.wellness ?? [], today, nutritionModelForSnapDay), today),
    });

    // SUB-4: best-effort off-machine snapshot. A no-op (not a failure) when NODEVELO_BACKUP_DIR isn't
    // set; a configured destination that stops working (e.g. an unmounted sync folder) surfaces.
    const backup = await snapshotBackup();
    if (!backup.ok && backup.reason === "not configured") {
      logWarn("/api/sync", "backup-snapshot", "NODEVELO_BACKUP_DIR not set — off-machine backup disabled");
    } else if (!backup.ok) {
      logError("/api/sync", "backup-snapshot", backup.reason);
      warnings.push("A background backup didn't complete — your training data itself is unaffected.");
    }

    return NextResponse.json({ lastSync, todayAnalysis, todayOutcome: resolveTodayOutcome(todayAnalysis, scoreLog.entries, intentStore.overlays), analysisPending, warnings, readiness, fatigueAlert, loadRamp, acwr, noBlockSummary, polarization, scores: scoreLog.entries.filter((e) => !e.legacy && !e.compromised), compromisedDates: [...compromisedDates(dispositions.entries)], partialDates: dispositions.entries.filter((e) => e.disposition === "partial").map((e) => e.date), completedDates: dispositions.entries.filter((e) => e.disposition === "completed").map((e) => e.date), athleteState, coachSnapshot, calibration });
  } catch (err) {
    const status = err instanceof IntervalsApiError && err.status === 401 ? 401 : 502;
    const message = err instanceof Error ? err.message : "Sync failed";
    logError("/api/sync", "sync", err, { status });
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE discards the active block so a new one can be generated. RV-9: it also removes the block's
// planned-workout events from the Intervals.icu calendar — the whole plan is being thrown away, so its
// markers shouldn't linger (the old behaviour orphaned them). Best-effort + configured-guarded so a
// calendar hiccup never blocks the local clear; completed rides are separate activities, untouched.
// SUB-1: archive the lived portion before clearing — "discard" rejects the block's un-lived future, not
// the days already ridden against it, which stay real coaching history the matcher can still use.
export async function DELETE(req: Request) {
  const block = await readCurrentBlock();
  // UXA-24: a stale tab's Delete button shouldn't silently discard a block another tab already
  // replaced — `expectedBlockCreatedAt` is absent for any older/other caller (check skipped).
  const url = new URL(req.url);
  const expected = url.searchParams.get("expectedBlockCreatedAt");
  const expectedCreatedAt = expected === null ? undefined : expected;
  const versionError = blockChangedResponse(block, expectedCreatedAt);
  if (versionError) return versionError;
  // HR-32: was utcToday() below — for an athlete west of UTC, a day ridden this morning (local) can
  // still read as "not yet lived" (UTC) and silently drop out of the archive (worst case: the block's
  // ONLY lived day, and the archive is skipped entirely). Matches GET/POST's own resolveToday pattern.
  const today = resolveToday(url.searchParams.get("today"));

  // HR-35: commit the local clear FIRST, re-checking createdAt inside the per-file lock (a real
  // compare-and-swap) — closes the check-then-act race between the guard above and this write. The
  // guard only ran once, near the top; `deleteEvents` below is a network round-trip that opens a window
  // where a second mutation (another tab's write/reschedule) could land and this DELETE would otherwise
  // still clobber it using the now-stale premise. Gating the calendar/archive side effects on the CAS
  // actually succeeding also means a rejected delete never deletes calendar events or archives a block
  // this request no longer has authority over.
  const result = await updateCurrentBlock(() => null, expectedCreatedAt);
  if (result !== null) {
    return NextResponse.json(
      { error: "This plan changed in another tab — reload to see the latest before continuing." },
      { status: 409 }
    );
  }

  const ids = blockEventIds(block);
  let eventsRemoved = 0;
  let eventsFailed: number[] = [];
  if (ids.length > 0 && isIntervalsConfigured()) {
    const { deleted, failed } = await deleteEvents(ids);
    eventsRemoved = deleted.length;
    eventsFailed = failed;
  }
  if (block) {
    const livedDays = truncateBlockDays(block.days, today);
    // SUB-1: only archive when something was actually lived — a same-day discard (regenerated before
    // any day passed) has nothing worth preserving, and archiving it anyway shows a noise entry (no
    // compliance, no hours, empty days) on the athlete-visible Plan history + Trends block timeline.
    if (livedDays.length > 0) {
      await appendBlockHistory({
        id: block.createdAt,
        goal: block.goal,
        startDate: block.startDate,
        endDate: block.endDate,
        lengthWeeks: block.lengthWeeks,
        overview: block.overview,
        createdAt: block.createdAt,
        model: block.model,
        promptVersion: block.promptVersion,
        durabilityTemplate: block.durabilityTemplate,
        ...(block.seasonFocus && isSeasonFocus(block.seasonFocus) ? { seasonFocus: block.seasonFocus } : {}),
        days: livedDays,
      });
    }
  }
  return NextResponse.json({ ok: true, eventsRemoved, eventsFailed });
}
