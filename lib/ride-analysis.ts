// Deterministic today-ride analysis, extracted from the sync route (CR-G). Everything here is pure:
// the route does the I/O (fetch streams, re-bucket zones, fetch intervals, build the trace, detect
// PRs), then hands the already-fetched results to buildTodayAnalysis, which computes the metrics and
// assembles the TodayAnalysis. Splitting it out makes the hardest part of the sync (execution scoring,
// compliance capping, advised intake, coach-note preservation) unit-testable without mocking HTTP.
import { adjustBuffer } from "./nutrition";
import { computeExecutionScore, resolveCompliance, type ScoringCalibration } from "./execution-score";
import type {
  ActivitySummary,
  CurrentBlockDay,
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

// Advised daily intake for a completed ride: base + ride kJ (≈ kcal for cyclists) + weight-adjusted
// buffer. Same buffer formula block generation uses, so the Today card and the plan never disagree.
export function computeAdvisedIntake(
  rideKj: number | null,
  baseCalories: number,
  buffer: number,
  weightTrend7Day: number
): AdvisedIntake {
  const { bufferApplied } = adjustBuffer(buffer, weightTrend7Day);
  const advisedRideFuelKcal = rideKj ?? 0;
  return {
    advisedIntakeKcal: Math.round(baseCalories + advisedRideFuelKcal + bufferApplied),
    advisedBaseKcal: baseCalories,
    advisedBufferKcal: bufferApplied,
    advisedRideFuelKcal,
  };
}

export interface TodayAnalysisInputs {
  today: string;
  activity: ActivitySummary;
  plannedDay: Pick<CurrentBlockDay, "name" | "type" | "durationMin"> | null;
  ftp: number;
  nutrition: { baseCalories: number; buffer: number };
  weightTrend7Day: number;
  // Already re-bucketed by the route from the raw streams (falls back to Intervals' own times).
  powerZoneTimes: number[] | null;
  hrZoneTimes: number[] | null;
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
  const intake = computeAdvisedIntake(
    activity.kj,
    input.nutrition.baseCalories,
    input.nutrition.buffer,
    input.weightTrend7Day
  );

  // On interval days, power-target adherence is the primary execution signal; otherwise duration
  // compliance. A structural plan/detection mismatch drops adherence so a correct session isn't
  // mis-scored on an untrustworthy rep-duration comparison.
  const executionScore = computeExecutionScore({
    compliancePct: metrics.compliancePct,
    intensityFactor: metrics.intensityFactor,
    plannedType: plannedDay?.type ?? null,
    decoupling: activity.decoupling,
    variabilityIndex: metrics.variabilityIndex,
    adherencePct:
      intervalComparison && !intervalComparison.structuralMismatch
        ? intervalComparison.effectiveAdherencePct
        : null,
    rpe: activity.rpe,
    calibration: input.resolvedCal,
  });

  // Compliance capped by execution so 100% can never sit next to a poor execution (trust guarantee).
  const resolvedCompliancePct = resolveCompliance(metrics.compliancePct, executionScore);

  const preserved = input.preserved?.activityDate === input.today ? input.preserved : null;
  const coachNote = preserved?.coachNote ?? "";

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
    activityTrainingLoad: activity.trainingLoad,
    activityRpe: activity.rpe,
    activityDecoupling: activity.decoupling,
    activityDistanceMeters: activity.distanceMeters,
    plannedName: plannedDay?.name ?? null,
    plannedType: plannedDay?.type ?? null,
    plannedDurationMin: plannedDay?.durationMin ?? null,
    compliancePct: resolvedCompliancePct,
    intensityFactor: metrics.intensityFactor,
    advisedIntakeKcal: intake.advisedIntakeKcal,
    advisedBaseKcal: intake.advisedBaseKcal,
    advisedBufferKcal: intake.advisedBufferKcal,
    advisedRideFuelKcal: intake.advisedRideFuelKcal,
    activityDescription: activity.description,
    powerZoneTimes: input.powerZoneTimes,
    hrZoneTimes: input.hrZoneTimes,
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
