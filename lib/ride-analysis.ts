// Deterministic today-ride analysis, extracted from the sync route (CR-G). Everything here is pure:
// the route does the I/O (fetch streams, re-bucket zones, fetch intervals, build the trace, detect
// PRs), then hands the already-fetched results to buildTodayAnalysis, which computes the metrics and
// assembles the TodayAnalysis. Splitting it out makes the hardest part of the sync (execution scoring,
// compliance capping, advised intake, coach-note preservation) unit-testable without mocking HTTP.
import { activeBurn, calculateDailyTarget, exerciseBurn, restingKcalPerHourOf, type NutritionModel } from "./nutrition";
import { computeExecutionScore, resolveCompliance, timeAboveAerobicHrFraction, aerobicDisciplineRead, type ScoringCalibration } from "./execution-score";
import { inferWorkoutType } from "./ride-classify";
import { gradeDurabilityDelivery, EXPECTS_EMBEDDED_EFFORTS } from "./durability-score";
import type {
  ActivitySummary,
  CurrentBlockDay,
  ExecutedInterval,
  IntervalComparison,
  PowerPR,
  RideTrace,
  TodayAnalysis,
} from "./types";

export interface RideMetrics {
  actualMin: number;
  compliancePct: number | null; // actual / planned duration %
  intensityFactor: number | null; // NP / FTP (avg-power fallback when NP absent)
  variabilityIndex: number | null; // NP / avg power; ~1.0 = steady, higher = surgy
}

export function computeRideMetrics(
  activity: Pick<ActivitySummary, "movingTimeSec" | "normalizedPower" | "avgWatts">,
  plannedDurationMin: number | null,
  ftp: number
): RideMetrics {
  const actualMin = Math.round(activity.movingTimeSec / 60);
  const compliancePct =
    plannedDurationMin && plannedDurationMin > 0 ? Math.round((actualMin / plannedDurationMin) * 100) : null;
  const ifBasis = activity.normalizedPower ?? activity.avgWatts;
  const intensityFactor = ifBasis !== null && ftp > 0 ? Math.round((ifBasis / ftp) * 100) / 100 : null;
  const variabilityIndex =
    activity.normalizedPower !== null && activity.avgWatts !== null && activity.avgWatts > 0
      ? Math.round((activity.normalizedPower / activity.avgWatts) * 100) / 100
      : null;
  return { actualMin, compliancePct, intensityFactor, variabilityIndex };
}

export interface AdvisedIntake {
  advisedIntakeKcal: number;
  advisedBaseKcal: number;
  advisedBufferKcal: number;
  advisedRideFuelKcal: number;
}

export interface AdvisedIntakeParts {
  baseKcal: number;
  rideFuelKcal: number;
  bufferKcal: number;
}

/**
 * Whole-kcal breakdown of an advised daily target, guaranteed to sum back to that target.
 *
 * ONE implementation, used both when the breakdown is COMPUTED (computeAdvisedIntake, below) and when
 * an already-persisted one is RENDERED (EatToday in components/dashboard/today.tsx) — `TodayAnalysis`
 * is written to today-analysis.json at sync time and read back for the rest of the day, so a record
 * written before this normalisation existed is still on disk and still has to display cleanly. Two
 * copies of this arithmetic would let the stored figure and the shown figure drift.
 *
 * Both properties this enforces broke when `exerciseBurn` started netting a per-hour resting cost off
 * the source burn figure. `rideBurnKcal` went fractional, so the old `plan.maintenanceKcal -
 * rideBurnKcal` (a ROUNDED total minus an UNROUNDED part) surfaced the residual as "2,202.512 base",
 * and because `dailyTarget` rounds to the nearest 10 the line read 2202.512 + 1283.488 + 60 under a
 * 3,550 headline — a breakdown that visibly failed to add up to the number it was breaking down.
 *
 * The ≤5 kcal rounding residual lands on `baseKcal` deliberately: base is the one ESTIMATED term
 * (k × RMR). The ride figure is measured and the buffer is an explicit goal choice, and neither should
 * absorb an artifact of display rounding. Deriving base as the remainder also keeps the identity true
 * when the RMR safety floor raised the target above what the formula computed.
 */
export function advisedIntakeParts(
  advisedIntakeKcal: number,
  rideBurnKcal: number,
  bufferKcalRaw: number
): AdvisedIntakeParts {
  const rideFuelKcal = Math.round(rideBurnKcal);
  const bufferKcal = Math.round(bufferKcalRaw);
  return { baseKcal: advisedIntakeKcal - rideFuelKcal - bufferKcal, rideFuelKcal, bufferKcal };
}

// Advised daily intake for a completed ride: base + the ride's resolved active burn + weight-adjusted
// buffer. Same buffer formula block generation uses, so the Today card and the plan never disagree.
//
// Takes the already-resolved burn (activeBurn(activity)?.kcal), not a raw kj/activeBurnKcal field —
// callers must go through activeBurn() so kj-only legacy activities and activeBurnKcal-only activities
// are both handled the one way the codebase agrees on. Returns null — never a fallback number — when
// the burn itself is unknown: a completed ride with no resolvable energy figure must WITHHOLD the
// advised intake, not silently read as a rest day (0 kcal of ride fuel), which understates the card by
// the entire burn and is exactly the wrong direction for an athlete who is chronically underfuelled.
export function computeAdvisedIntake(
  rideBurnKcal: number | null,
  model: NutritionModel,
  bufferApplied: number
): AdvisedIntake | null {
  if (rideBurnKcal === null) return null;
  // Delegates to THE formula rather than re-deriving base + burn + buffer, so the Today card and the
  // generated plan can never disagree. isRestDay is false: this path only runs for a completed ride.
  const plan = calculateDailyTarget(rideBurnKcal, model, bufferApplied, false);
  // Whole kcal, and the three parts sum to `advisedIntakeKcal` — see advisedIntakeParts for why the
  // old `plan.maintenanceKcal - rideBurnKcal` satisfied neither once burns went fractional.
  const parts = advisedIntakeParts(plan.dailyTarget, rideBurnKcal, bufferApplied);
  return {
    advisedIntakeKcal: plan.dailyTarget,
    advisedBaseKcal: parts.baseKcal,
    advisedBufferKcal: parts.bufferKcal,
    advisedRideFuelKcal: parts.rideFuelKcal,
  };
}

export interface TodayAnalysisInputs {
  today: string;
  activity: ActivitySummary;
  plannedDay: Pick<CurrentBlockDay, "name" | "type" | "durationMin" | "durabilityTemplate"> | null;
  ftp: number;
  nutrition: { model: NutritionModel; bufferApplied: number };
  // Already re-bucketed by the route from the raw streams (falls back to Intervals' own times).
  powerZoneTimes: number[] | null;
  hrZoneTimes: number[] | null;
  // The athlete's power-zone tops as %FTP, as-of the ride's date (Intervals.icu's synced zone defs) — the
  // boundary source of truth for the IF effort-band label. Null when no zones are on file.
  powerZoneTopsPct: number[] | null;
  // Aerobic read: this ride's Z2 Pw:HR vs the athlete's baseline (signed %Δ), computed by the route
  // from the ride history. Scored when today is off-plan (intrinsic mode) or on a planned Z2/Recovery day
  // (via the merged aerobic-discipline read). null → no effect.
  aerobicEffPct: number | null;
  // The ride's executed intervals (Track B): used to grade whether a durability long ride delivered its
  // template's prescribed efforts. Empty when none were fetched.
  executed: ExecutedInterval[];
  intervalComparison: IntervalComparison | null;
  trace: RideTrace | null;
  powerPRs: PowerPR[];
  // Prior analysis for the same day, so a re-sync preserves an already-generated coach note + its
  // provenance stamp instead of blanking it.
  preserved: TodayAnalysis | null;
  resolvedCal: ScoringCalibration;
}

export interface TodayAnalysisResult {
  todayAnalysis: TodayAnalysis;
  executionScore: number | null;
  resolvedCompliancePct: number | null;
}

export function buildTodayAnalysis(input: TodayAnalysisInputs): TodayAnalysisResult {
  const { activity, plannedDay, ftp, intervalComparison } = input;
  const metrics = computeRideMetrics(activity, plannedDay?.durationMin ?? null, ftp);
  // Resolved burn, not the raw kj field: the highest-visibility consumer of activeBurnKcal must not
  // bypass the one accessor that knows how to read it (C1). withheld (null), never 0, when unknown.
  const intake = computeAdvisedIntake(
    // NET of the ride's own resting-equivalent cost, at the rate the model's own calibration basis
    // dictates — `k × RMR` already charges resting metabolism for these hours (lib/nutrition.ts's
    // exerciseBurn). Still routed through the shared accessor, so kj-only legacy activities and
    // activeBurnKcal-only activities are handled the one way the codebase agrees on (C1), and an
    // unresolvable burn still withholds (null) rather than reading as 0.
    exerciseBurn(activity, restingKcalPerHourOf(input.nutrition.model))?.kcal ?? null,
    input.nutrition.model,
    input.nutrition.bufferApplied
  );

  // On interval days, power-target adherence is the primary execution signal; otherwise duration
  // compliance. A structural plan/detection mismatch drops adherence so a correct session isn't
  // mis-scored on an untrustworthy rep-duration comparison.
  // Off-plan (no planned session) → infer a scoring type, exactly as the ledger does, so the VI pacing
  // BONUS can still apply. As of 2026-08-06 the VI penalty is suppressed for intrinsic rides (it was
  // circular — the type comes from the ride's own intensity; see computeExecutionScore's VI block), so
  // this enables the reward half only. The OUTPUT plannedType field below stays null (nothing was planned).
  const scoringType = plannedDay?.type ?? inferWorkoutType(metrics.intensityFactor, metrics.actualMin);
  // Track B: grade a durability long ride against its template's expected signal — did the prescribed
  // efforts happen, at the right intensity + timing? Only the today path has the ride's intervals. Null
  // (template A, off-plan, or no intervals) → no effect.
  const durabilityDelivery = gradeDurabilityDelivery(plannedDay?.durabilityTemplate ?? null, input.executed, ftp, activity.movingTimeSec);
  const executionScore = computeExecutionScore({
    compliancePct: metrics.compliancePct,
    intensityFactor: metrics.intensityFactor,
    plannedType: scoringType,
    variabilityIndex: metrics.variabilityIndex,
    adherencePct:
      intervalComparison && !intervalComparison.structuralMismatch
        ? intervalComparison.effectiveAdherencePct
        : null,
    rpe: activity.rpe,
    // Easy-ride effort judged on a merged read: HR-ceiling breach + aerobic-efficiency-vs-baseline (terrain-immune).
    aboveAerobicHrFrac: timeAboveAerobicHrFraction(input.hrZoneTimes),
    // Off-plan (no planned session today) → score the non-circular aerobic read, matching the ledger.
    intrinsic: plannedDay == null,
    aerobicEffPct: input.aerobicEffPct,
    durabilityTemplate: plannedDay?.durabilityTemplate ?? null,
    durabilityDelivery: durabilityDelivery?.signal ?? null,
    calibration: input.resolvedCal,
  });

  // Compliance capped by execution so 100% can never sit next to a poor execution (trust guarantee).
  const resolvedCompliancePct = resolveCompliance(metrics.compliancePct, executionScore);

  const preserved = input.preserved?.activityDate === input.today ? input.preserved : null;
  const coachNote = preserved?.coachNote ?? "";

  // Easy-ride effort read for the debrief (Z2/Recovery only; null for off-plan rides — the score's own
  // HR-judge axis is gated !intrinsic, so an off-plan ride's inferred Z2/Recovery type never actually used
  // this signal in scoring; also null for durability templates B–E, since the scorer's HR judge is gated
  // !embedsEfforts there too — embedded efforts ARE the point for those templates, not a discipline lapse).
  // The same HR signal the score used, gated the same way (never applied where the score didn't apply it).
  const embedsEfforts = EXPECTS_EMBEDDED_EFFORTS.has(plannedDay?.durabilityTemplate ?? "");
  const aerobicDiscipline =
    plannedDay != null && !embedsEfforts && (scoringType === "Z2" || scoringType === "Recovery")
      ? aerobicDisciplineRead(timeAboveAerobicHrFraction(input.hrZoneTimes))
      : null;
  const aerobicEffPctForToday =
    plannedDay != null && !embedsEfforts && (scoringType === "Z2" || scoringType === "Recovery")
      ? input.aerobicEffPct
      : null;

  const todayAnalysis: TodayAnalysis = {
    analysedAt: new Date().toISOString(),
    activityDate: input.today,
    activityName: activity.name,
    activityDurationMin: metrics.actualMin,
    activityAvgWatts: activity.avgWatts,
    activityNormalizedPower: activity.normalizedPower,
    activityMaxWatts: activity.maxWatts,
    activityAvgHr: activity.avgHr,
    activityMaxHr: activity.maxHr,
    activityKj: activity.kj,
    // GROSS kcal, via the one accessor — the figure the debrief header shows under a "kcal" label.
    // `activityKj` above stays the raw mechanical-work field (kJ) that coach-snapshot reads AS kJ.
    activityBurnKcal: activeBurn(activity)?.kcal ?? null,
    activityTrainingLoad: activity.trainingLoad,
    activityRpe: activity.rpe,
    activityDecoupling: activity.decoupling,
    aerobicDiscipline,
    aerobicEffPct: aerobicEffPctForToday,
    activityDistanceMeters: activity.distanceMeters,
    plannedName: plannedDay?.name ?? null,
    plannedType: plannedDay?.type ?? null,
    plannedDurationMin: plannedDay?.durationMin ?? null,
    compliancePct: resolvedCompliancePct,
    intensityFactor: metrics.intensityFactor,
    advisedIntakeKcal: intake?.advisedIntakeKcal ?? null,
    advisedBaseKcal: intake?.advisedBaseKcal ?? null,
    advisedBufferKcal: intake?.advisedBufferKcal ?? null,
    advisedRideFuelKcal: intake?.advisedRideFuelKcal ?? null,
    activityDescription: activity.description,
    powerZoneTimes: input.powerZoneTimes,
    hrZoneTimes: input.hrZoneTimes,
    powerZoneTopsPct: input.powerZoneTopsPct,
    executionScore,
    coachNote,
    intervalComparison,
    trace: input.trace,
    powerPRs: input.powerPRs,
    ...(preserved?.model ? { model: preserved.model } : {}),
    ...(preserved?.promptVersion ? { promptVersion: preserved.promptVersion } : {}),
  };
  return { todayAnalysis, executionScore, resolvedCompliancePct };
}
