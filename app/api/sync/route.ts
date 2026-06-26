import { NextResponse } from "next/server";
import { deleteEvents, fetchHrStream, fetchIntervals, fetchPowerStream, fetchSportSettings, isIntervalsConfigured, isSuspectEmptySync, runFullSync, IntervalsApiError } from "@/lib/intervals-api";
import { blockEventIds } from "@/lib/block-events";
import { physiologyAsOf, readHrZones, readPhysiology, readPowerZones, reconcile, writePhysiology } from "@/lib/physiology";
import { bucketZones } from "@/lib/zones";
import { matchPrescription } from "@/lib/interval-match";
import { parsePrescription } from "@/lib/prescription";
import { buildRideTrace } from "@/lib/trace";
import {
  readAthleteProfile,
  readBlockHistory,
  readBlockSettings,
  readCurrentBlock,
  readDispositions,
  readCalibration,
  readInterventionLog,
  readLastSync,
  readLedgerRebuild,
  readMorningChecks,
  readRollingBaselines,
  readScoreLog,
  updateScoreLog,
  writeLedgerRebuild,
  writeCalibration,
  writeInterventionLog,
  writeQuirks,
  writeTodayAnalysis,
  writeCurrentBlock,
  writeLastSync,
  writeRollingBaselines,
  readTodayAnalysis,
} from "@/lib/data-store";
import { extractQuirks } from "@/lib/quirks";
import { isAnthropicConfigured } from "@/lib/anthropic-api";
import { buildAthleteModel } from "@/lib/athlete-model";
import { athleteStateInputsFrom, computeAthleteState } from "@/lib/athlete-state";
import { overallCoachAccuracy, validateInterventions } from "@/lib/intervention";
import { weightTrendFromWellness } from "@/lib/nutrition";
import { isSteadyEnduranceRide } from "@/lib/trends";
import { buildTodayAnalysis } from "@/lib/ride-analysis";
import { backfillLedgerEntries, shouldRebuildLedger } from "@/lib/sync-ledger";
import { detectPowerPRs } from "@/lib/pr";
import { buildRideScores, calStampFor, mergeScoreLog, mergeScoreLogRebuild } from "@/lib/score-log";
import { applyDispositions, compromisedDates } from "@/lib/disposition";
import { buildFormStateLookup, computeAcwr, computeFatigueAlert, computeIntensityDistribution, computeLoadRamp, computeReadiness, computeRollingBaselines } from "@/lib/readiness";
import { deriveDecouplingGood, deriveIfBandOffsets, resolveAcwrBands, resolveAthleteStateWeights } from "@/lib/calibration";
import { buildCoachSnapshotFromSources } from "@/lib/coach-snapshot";
import { resolveToday } from "@/lib/date";
import type { ExecutedInterval, RideEntryContext, TodayAnalysis } from "@/lib/types";

// A sync fires several sequential Intervals.icu requests (each network-bounded to 20s in the API
// client) plus, on a ride day, per-ride stream/interval fetches. Cap the whole handler so a slow
// upstream surfaces as an error rather than an open-ended request (CR-B). The slow LLM coach note is
// deferred to /api/analyze, so this ceiling doesn't need to cover model latency.
export const maxDuration = 120;

// GET returns the cached app state; it never hits Intervals.icu. `?today=` is the client's local date
// (so the CoachSnapshot resolves against the calendar day the athlete sees); falls back to UTC.
export async function GET(req: Request) {
  const today = resolveToday(new URL(req.url).searchParams.get("today"));
  const [lastSync, currentBlock, todayAnalysis, scoreLog, profile, settings, dispositions, interventionLog, baselines, morningChecks, physStore, calibration] =
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
    athleteStateInputsFrom(lastSync, buildAthleteModel(scoreLog.entries), acwr, today),
    resolveAthleteStateWeights(settings.athleteStateWeights)
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
    tsbModifierEdgesOverride: settings.tsbModifierEdges,
    athleteStateWeightsOverride: settings.athleteStateWeights,
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
    // ROADMAP #2: the per-athlete calibration (read-only on Settings).
    calibration,
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
    const baselines = computeRollingBaselines(lastSync.activities, lastSync.wellness, today);
    await writeRollingBaselines({ ...baselines, updatedAt: new Date().toISOString() });

    // Durability reference (ACC-2026-06-25): decoupling is no longer an execution input — it's a
    // steady-ride durability signal. Derive the athlete's "typical drift" from STEADY endurance rides
    // only (an interval day's whole-ride decoupling is a ride-structure artifact), so the reference the
    // CalibrationPanel shows is a clean number. Confidence comes from how many steady rides had a reading.
    const cutoff90 = new Date(Date.parse(today) - 90 * 86_400_000).toISOString().slice(0, 10);
    const stateFtp = physStore?.current.ftp ?? 0;
    const steadyDecoup = lastSync.activities.filter(
      (a) => a.decoupling !== null && a.date >= cutoff90 && isSteadyEnduranceRide(a, stateFtp)
    );
    const steadyDecoupMean = steadyDecoup.length
      ? Math.round((steadyDecoup.reduce((s, a) => s + (a.decoupling as number), 0) / steadyDecoup.length) * 10) / 10
      : null;
    const priorCal = await readCalibration();
    const calibration = {
      decouplingGood: deriveDecouplingGood(priorCal.decouplingGood, steadyDecoupMean, steadyDecoup.length),
      updatedAt: new Date().toISOString(),
    };
    await writeCalibration(calibration);
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
      const block = await readCurrentBlock();
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
      const fresh = buildRideScores(block, lastSync.activities, ftpForDate, today, offPlanFloor, resolvedCal, contextForDate);
      // Stamp the athlete's compromised attributions onto the ledger (re-derived each sync).
      const dispositions = (await readDispositions()).entries;
      // One-shot guard (LEDGER-3): the rebuild runs at most once. A normal sync never requests it; a
      // repeat request after the persisted marker is refused unless `force` is set.
      const rebuildMarker = await readLedgerRebuild();
      const doRebuild = shouldRebuildLedger(rebuildRequested, rebuildMarker.rebuiltAt !== null, rebuildForce);
      if (rebuildRequested && !doRebuild) {
        warnings.push(`Ledger rebuild skipped — already rebuilt ${rebuildMarker.rebuiltAt} (one-time migration; pass force to re-run).`);
      }
      // Transactional (CR-A): the backfill is computed from the ledger read INSIDE the lock, so a
      // concurrent disposition POST (or the deferred analyze patch) can't clobber these scores. The
      // backfill itself is the pure, unit-tested backfillLedgerEntries (CR-G).
      await updateScoreLog((entries) => {
        const backfilled = backfillLedgerEntries(entries, ftpForDate, offPlanFloor);
        // Normal sync: existing wins (immutable per date). Rebuild: fresh (recomputed from corrected
        // activities) wins, while existing still fills any date outside the activity window — but a
        // rebuild never downgrades a frozen planned ride to off-plan and carries forward frozen context
        // (LEDGER-1/2; see mergeScoreLogRebuild).
        const merged = doRebuild ? mergeScoreLogRebuild(fresh, backfilled) : mergeScoreLog(backfilled, fresh);
        return applyDispositions(merged, dispositions);
      });
      if (doRebuild) {
        await writeLedgerRebuild(new Date().toISOString());
        warnings.push("Ledger rebuilt: past entries re-scored from corrected activity data (NP/decoupling).");
      }
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

          // --- Pure: assemble the deterministic analysis (metrics, execution score, capped
          // compliance, advised intake, coach-note preservation) — extracted + unit-tested (CR-G).
          const { todayAnalysis: built, executionScore, resolvedCompliancePct } = buildTodayAnalysis({
            today,
            activity: todayActivity,
            plannedDay,
            ftp: profile.performance.ftp,
            nutrition: { baseCalories: profile.nutrition.baseCalories, buffer: profile.nutrition.buffer },
            weightTrend7Day: weightTrendFromWellness(lastSync.wellness) ?? 0,
            powerZoneTimes,
            hrZoneTimes,
            // The athlete's synced zone tops (%FTP) as-of the ride — the IF band label's boundaries, so it
            // reflects their own Intervals.icu zones and tracks any FTP/zone change (effective-dated).
            powerZoneTopsPct: physiologyAsOf(physStore, todayActivity.date)?.powerZonePct ?? null,
            intervalComparison,
            trace,
            powerPRs,
            preserved: priorAnalysis,
            resolvedCal,
          });
          todayAnalysis = built;
          await writeTodayAnalysis(todayAnalysis);

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
                      }
                    : e
                )
              );
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
    const loadRamp = computeLoadRamp(lastSync.activities, today);
    const acwr = computeAcwr(lastSync.activities, resolveAcwrBands((await readBlockSettings()).acwrBands), today);
    const polarization = computeIntensityDistribution(lastSync.activities, (await readAthleteProfile()).performance.ftp, 7, today);
    const scoreLog = await readScoreLog();
    const dispositions = await readDispositions();
    // A fresh ride has its deterministic analysis but no coach note yet — tell the client to
    // trigger /api/analyze for the (slow) LLM note rather than blocking this response on it.
    const analysisPending = todayAnalysis !== null && !todayAnalysis.coachNote;
    // Signal fusion (§5) recomputed on the fresh data so the glanceable state updates after a sync.
    const athleteState = computeAthleteState(
      athleteStateInputsFrom(lastSync, buildAthleteModel(scoreLog.entries), acwr, today),
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
      tsbModifierEdgesOverride: settingsForSnap.tsbModifierEdges,
      athleteStateWeightsOverride: settingsForSnap.athleteStateWeights,
    });
    return NextResponse.json({ lastSync, todayAnalysis, analysisPending, warnings, readiness, fatigueAlert, loadRamp, acwr, polarization, scores: scoreLog.entries.filter((e) => !e.legacy && !e.compromised), compromisedDates: [...compromisedDates(dispositions.entries)], partialDates: dispositions.entries.filter((e) => e.disposition === "partial").map((e) => e.date), athleteState, coachSnapshot, calibration });
  } catch (err) {
    const status = err instanceof IntervalsApiError && err.status === 401 ? 401 : 502;
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE discards the active block so a new one can be generated. RV-9: it also removes the block's
// planned-workout events from the Intervals.icu calendar — the whole plan is being thrown away, so its
// markers shouldn't linger (the old behaviour orphaned them). Best-effort + configured-guarded so a
// calendar hiccup never blocks the local clear; completed rides are separate activities, untouched.
export async function DELETE() {
  const block = await readCurrentBlock();
  const ids = blockEventIds(block);
  let eventsRemoved = 0;
  let eventsFailed: number[] = [];
  if (ids.length > 0 && isIntervalsConfigured()) {
    const { deleted, failed } = await deleteEvents(ids);
    eventsRemoved = deleted.length;
    eventsFailed = failed;
  }
  await writeCurrentBlock(null);
  return NextResponse.json({ ok: true, eventsRemoved, eventsFailed });
}
