import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { buildAthleteModel, deriveInsights } from "@/lib/athlete-model";
import { compileTrainingBlock } from "@/lib/block-compiler";
import { checkBlockFeasibility, computeBlockSkeleton, computeWeekTargets } from "@/lib/block-skeleton";
import { resolveDurabilityInsertEnvelope } from "@/lib/calibration";
import { resolveCoachSignals } from "@/lib/coach-snapshot";
import {
  readAthleteProfile, readBlockSettings, readCurrentBlock, readIntentOverlays, readLastSync,
  readRollingBaselines, readScoreLog, readSeasonPlan, replaceGenerationVerdict,
  saveGenerationVerdict, updateSeasonPlan,
} from "@/lib/data-store";
import { resolveToday } from "@/lib/date";
import { selectDurabilityTemplate } from "@/lib/durability";
import { logError, logWarn } from "@/lib/log";
import {
  buildWorkoutNutritionPlan, resolveBuffer, resolveNutritionModel, smoothedCurrentWeightKg,
  weightTrendFromWellness, WEIGHT_TREND_LONG_WINDOW_DAYS,
} from "@/lib/nutrition";
import { readPhysiologyWithStatus, resolveHrZones } from "@/lib/physiology";
import {
  assessPhysiologyFreshnessFromReads, physiologyGenerationBlock, physiologyGenerationWarning,
  readPhysiologyStatus,
} from "@/lib/physiology-freshness";
import { verdictHash } from "@/lib/publication-gate";
import {
  achievedTssForPeriod, addWeeks, chooseNextFocus, findUpcomingAEvent, periodForDate,
  planRecoveryWeeks, realWeeksSinceLastRecovery, replanEventArc, SEASON_SHAPES_GENERATION,
  settleSeasonHistory,
} from "@/lib/season";
import { gatherFocusInputs } from "@/lib/season-signals";
import { deriveSessionRequirements } from "@/lib/session-requirements";
import { latestWeeklyBalance, weeklyEnergy } from "@/lib/trends";
import { WORKOUT_TYPES, type BlockParams, type FocusPeriod, type SeasonPlan } from "@/lib/types";

export const maxDuration = 300;

function parseBlockParams(body: unknown): BlockParams | string {
  if (!body || typeof body !== "object") return "Request body must be a JSON object.";
  const b = body as Record<string, unknown>;
  if (b.lengthWeeks !== 2 && b.lengthWeeks !== 4 && b.lengthWeeks !== 6 && b.lengthWeeks !== 8) {
    return "lengthWeeks must be 2, 4, 6 or 8.";
  }
  const goal = typeof b.goal === "string" ? b.goal.trim() : "";
  if (!goal) return "goal is required.";
  const startDate = typeof b.startDate === "string" ? b.startDate : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(startDate))) {
    return "startDate must be a valid YYYY-MM-DD date.";
  }
  const weakpoints = Array.isArray(b.weakpoints)
    ? b.weakpoints.filter((value): value is string => typeof value === "string" && value.trim() !== "")
    : [];
  return { lengthWeeks: b.lengthWeeks, goal, startDate, weakpoints };
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const blockParams = parseBlockParams(body);
  if (typeof blockParams === "string") return NextResponse.json({ error: blockParams }, { status: 400 });
  const today = resolveToday((body as Record<string, unknown>).today);

  try {
    const [profile, sync, blockSettings, scoreLog, intentStore, physRead, physStatusRead, baselines, currentBlock, existingSeason] = await Promise.all([
      readAthleteProfile(), readLastSync(), readBlockSettings(), readScoreLog(), readIntentOverlays(),
      readPhysiologyWithStatus(), readPhysiologyStatus(), readRollingBaselines(), readCurrentBlock(), readSeasonPlan(),
    ]);
    const feasibilityConflict = checkBlockFeasibility(blockSettings);
    if (feasibilityConflict) return NextResponse.json({ error: feasibilityConflict }, { status: 400 });
    const freshness = assessPhysiologyFreshnessFromReads(physRead, physStatusRead, today);
    const blockReason = physiologyGenerationBlock(freshness);
    if (blockReason) return NextResponse.json({ error: blockReason }, { status: 400 });

    const warnings: string[] = [];
    if (physRead.liveCorrupt && !physRead.corruptFallback && physRead.store) {
      warnings.push("Recovered physiology from the backup file after the live store became unreadable; using the recovered values.");
    }
    const freshnessWarning = physiologyGenerationWarning(freshness);
    if (freshnessWarning) warnings.push(freshnessWarning);

    const latestWeight = sync?.wellness
      .filter((entry) => entry.weightKg !== null)
      .sort((left, right) => right.date.localeCompare(left.date))[0]?.weightKg ?? profile.performance.weightKg;
    const weightTrend = (sync ? weightTrendFromWellness(sync.wellness) : null) ?? 0;
    const smoothedWeight = smoothedCurrentWeightKg(sync?.wellness ?? [], today) ?? latestWeight;
    const bufferStatus = resolveBuffer(
      profile.nutrition.neat, smoothedWeight, profile.nutrition.targetWeightKg,
      profile.nutrition.targetRateKgPerWeek, weightTrend,
      weightTrendFromWellness(sync?.wellness ?? [], WEIGHT_TREND_LONG_WINDOW_DAYS),
      profile.nutrition.buffer
    );
    const athleteModel = buildAthleteModel(scoreLog.entries, intentStore.overlays);
    const insights = deriveInsights(athleteModel);
    const nutritionModelFor = (isRestDay: boolean) => resolveNutritionModel(profile, latestWeight, today, isRestDay);
    const signals = resolveCoachSignals(
      sync, athleteModel, baselines, blockSettings.acwrBands, blockSettings.athleteStateWeights,
      today, scoreLog.entries, profile.performance.ftp,
      latestWeeklyBalance(weeklyEnergy(sync?.activities ?? [], sync?.wellness ?? [], today, nutritionModelFor), today)
    );
    const requirements = deriveSessionRequirements(blockParams.goal, blockParams.weakpoints);
    const focusInputs = await gatherFocusInputs({
      blockGoal: blockParams.goal,
      weakpoints: blockParams.weakpoints,
      today,
      preloaded: { currentBlock, scoreEntries: scoreLog.entries, overlays: intentStore.overlays },
    });
    const rollingFocusChoice = chooseNextFocus(focusInputs);
    const durability = selectDurabilityTemplate(insights, currentBlock?.durabilityTemplate ?? null, focusInputs.signals.goalText ?? "");

    const avgWeeklyTss = baselines.avgTss90d != null ? baselines.avgTss90d * 7 : null;
    const weeksSinceRecovery = realWeeksSinceLastRecovery(scoreLog.entries, avgWeeklyTss, today);
    const allRecoveryIndices = planRecoveryWeeks(weeksSinceRecovery, blockParams.lengthWeeks, !!signals.loadRamp?.triggered);
    let recoveryWeekIndices = allRecoveryIndices;
    let replannedSeason: SeasonPlan | null = null;
    let aEventForBlock: ReturnType<typeof findUpcomingAEvent> = null;
    const seasonDegradedWarnings: string[] = [];
    try {
      const achievedTssFor = (period: FocusPeriod) => achievedTssForPeriod(scoreLog.entries, period);
      aEventForBlock = findUpcomingAEvent(existingSeason.events, today);
      if (aEventForBlock) {
        replannedSeason = replanEventArc(existingSeason, aEventForBlock, {
          objective: existingSeason.objective,
          events: existingSeason.events,
          ctl: sync?.fitness.ctl ?? null,
          ftp: profile.performance.ftp,
          recentWeeklyTss: baselines.avgTss90d != null ? Math.round(baselines.avgTss90d * 7) : null,
          limiter: focusInputs.limiter,
          recentFocuses: [],
          heavyFatigue: !!signals.loadRamp?.triggered,
        }, achievedTssFor, today);
        recoveryWeekIndices = allRecoveryIndices.filter((weekIndex) => {
          const period = periodForDate(replannedSeason as SeasonPlan, addWeeks(blockParams.startDate, weekIndex));
          return period ? period.phase === "build" || period.phase === "base" : true;
        });
      } else {
        replannedSeason = settleSeasonHistory(existingSeason, achievedTssFor, today);
      }
    } catch (error) {
      logWarn("/api/generate", "season-replan", error instanceof Error ? error.message : String(error));
      seasonDegradedWarnings.push("SEASON: the season layer failed to update for this block; recovery placement and rolling focus still applied. Check data/season-plan.json.");
    }

    const weekTargets = computeWeekTargets(blockParams.lengthWeeks, blockSettings, recoveryWeekIndices);
    const blockSkeleton = computeBlockSkeleton(blockParams.startDate, weekTargets, blockSettings, rollingFocusChoice.focus, existingSeason.events);
    const nutritionByDateAndType = Object.fromEntries(blockSkeleton.weeks.flatMap((week) => week.days.map((slot) => [
      slot.date,
      Object.fromEntries(WORKOUT_TYPES.map((type) => [
        type,
        buildWorkoutNutritionPlan(profile, latestWeight, today, profile.performance.ftp, bufferStatus.bufferApplied, {
          type,
          durationMin: slot.duration.nominalMin,
        }),
      ])),
    ])));
    const hrZones = physRead.store ? resolveHrZones(physRead.store.current) : [];
    // Claim the single passport slot before composition. The pending hash can never match a plan's
    // SHA-256 verdict hash, and the final locked CAS prevents concurrent generations borrowing or
    // erasing each other's authority.
    const claimHash = `pending:${randomUUID()}`;
    await saveGenerationVerdict({
      verdictHash: claimHash,
      blockers: [],
      preferences: [],
      createdAt: new Date().toISOString(),
    });
    const compiled = compileTrainingBlock({
      blockParams,
      settings: blockSettings,
      weekTargets,
      skeleton: blockSkeleton,
      focus: rollingFocusChoice.focus,
      phase: SEASON_SHAPES_GENERATION && replannedSeason
        ? (periodForDate(replannedSeason, blockParams.startDate)?.phase ?? "build")
        : "build",
      focusRationale: rollingFocusChoice.rationale,
      durabilityTemplateId: durability.id,
      requirements,
      ftp: profile.performance.ftp,
      hrZone2CeilingBpm: hrZones[1]?.hi ?? null,
      nutritionByDateAndType,
      warnings: [...warnings, ...seasonDegradedWarnings],
      publication: {
        envelope: resolveDurabilityInsertEnvelope(blockSettings.durabilityInsertEnvelope),
        events: existingSeason.events,
        seasonContext: SEASON_SHAPES_GENERATION && aEventForBlock && replannedSeason
          ? { mode: "event-anchored", plan: replannedSeason }
          : { mode: "rolling", focus: rollingFocusChoice.focus },
      },
    });
    const plan = compiled.plan;
    const verdictResult = await replaceGenerationVerdict(claimHash, {
      verdictHash: verdictHash(plan.days, plan.blockParams),
      blockers: compiled.verdict.blockers,
      preferences: compiled.verdict.preferences,
      createdAt: new Date().toISOString(),
    });
    if (verdictResult === "lost") {
      throw new Error("A newer generation superseded this preview. Use the newer result.");
    }
    if (verdictResult === "write-failed") {
      logWarn("/api/generate", "verdict-persist", "The final verdict could not replace its pending claim.");
    }
    if (replannedSeason) {
      try {
        await updateSeasonPlan(() => replannedSeason as SeasonPlan, existingSeason.updatedAt);
      } catch (error) {
        logWarn("/api/generate", "season-persist", error instanceof Error ? error.message : String(error));
      }
    }
    return NextResponse.json({ plan });
  } catch (error) {
    logError("/api/generate", "generate", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Generation failed." }, { status: 502 });
  }
}
