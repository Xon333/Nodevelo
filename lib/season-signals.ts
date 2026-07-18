// Shared focus-input assembly (season-continuous-focus-selection §6/§9): the exact signal-gathering
// logic app/api/generate/route.ts already ran inline for chooseNextFocus, extracted so
// app/api/season/route.ts's roadmap-outlook projection (a later plan) can build the identical input
// shape without a second, potentially-drifting copy. Server-only (imports lib/data-store) — never
// import this from a client component.
import { readAthleteProfile, readLastSync, readCurrentBlock, readBlockHistory, readScoreLog, readSeasonPlan } from "./data-store";
import { analyzePowerProfile } from "./power-profile";
import { buildAthleteModel } from "./athlete-model";
import { exposureFromSessions, execQualityByFocus, isSeasonFocus, type ChooseNextFocusInput } from "./season";
import { resolveToday } from "./date";
import type { PowerSystem, SeasonFocus } from "./types";

// Maps the power-profile's physiological systems onto the season engine's focus vocabulary. Threshold
// maps 1:1; anaerobic covers both neuromuscular and anaerobic (the season arc has no separate sprint
// focus). Moved here from app/api/generate/route.ts (was a private duplicate) — now the one definition
// both the generate route and this shared gatherer use.
export function mapSystemToFocus(system: PowerSystem): SeasonFocus {
  switch (system) {
    case "neuromuscular":
      return "anaerobic";
    case "anaerobic":
      return "anaerobic";
    case "vo2max":
      return "vo2max";
    case "threshold":
      return "threshold";
  }
}

// Assembles chooseNextFocus's full input from real, already-durable data — the single source both
// /api/generate (a real block, with blockGoal/weakpoints) and /api/season GET (a roadmap-only
// projection, neither present) call, so goal-text/exposure/execution assembly can't drift between the
// two the way two independently-hand-rolled copies eventually would (the exact drift class HR-18,
// 2026-07-17 hostile review, closed for durability-template selection).
export async function gatherFocusInputs(
  opts: { blockGoal?: string; weakpoints?: string[]; today?: string } = {}
): Promise<ChooseNextFocusInput> {
  // resolveToday's own fallback (no valid caller-supplied date) is the server's UTC-anchored "today" —
  // matches the same resolveToday(body.today) call /api/generate makes; never inline
  // new Date().toISOString().slice(0, 10) here (see AGENTS.md: that's the UTC-drift bug class).
  const today = resolveToday(opts.today);
  const [profile, sync, currentBlock, blockHistory, scoreLog, existingSeason] = await Promise.all([
    readAthleteProfile(),
    readLastSync(),
    readCurrentBlock(),
    readBlockHistory(),
    readScoreLog(),
    readSeasonPlan(),
  ]);

  const latestWeight =
    sync?.wellness.filter((w) => w.weightKg !== null).sort((a, b) => b.date.localeCompare(a.date))[0]?.weightKg ??
    profile.performance.weightKg;
  const powerProfile = analyzePowerProfile(sync?.powerCurveAllTime ?? sync?.powerCurve ?? [], profile.performance.ftp, latestWeight);
  const limiter = powerProfile?.easyWin
    ? { system: mapSystemToFocus(powerProfile.easyWin.system), confidence: powerProfile.confident ? ("high" as const) : ("low" as const) }
    : { system: null, confidence: "low" as const };

  const combinedGoalText = [
    existingSeason.objective,
    opts.blockGoal ?? "",
    ...(opts.weakpoints ?? []),
    ...profile.goals.map((g) => `${g.goal} ${g.target}`),
    ...profile.weakpoints.map((w) => `${w.weakpoint} ${w.detail}`),
  ].join(" \n ");

  const athleteModel = buildAthleteModel(scoreLog.entries);
  const lastFocus = isSeasonFocus(currentBlock?.seasonFocus) ? currentBlock.seasonFocus : null;

  return {
    limiter,
    lastFocus,
    signals: {
      goalText: combinedGoalText,
      exposure: exposureFromSessions(
        [...(currentBlock?.days ?? []), ...blockHistory.flatMap((h) => h.days ?? [])].filter((d) => d.date <= today),
        profile.performance.ftp,
        today
      ),
      execQuality: execQualityByFocus(athleteModel),
    },
  };
}
