// Builds and merges the per-ride execution score log. Deterministic — uses the
// same execution-score logic as the daily analysis, but applied to every planned
// day of the active block that already has a matching ride.

import { computeExecutionScore } from "./execution-score";
import type { ActivitySummary, CurrentBlock, RideScoreEntry } from "./types";

const MAX_ENTRIES = 250;

export function buildRideScores(
  block: CurrentBlock,
  activities: ActivitySummary[],
  ftp: number,
  today: string = new Date().toISOString().slice(0, 10)
): RideScoreEntry[] {
  const out: RideScoreEntry[] = [];
  for (const day of block.days) {
    if (day.durationMin <= 0 || day.date > today) continue;
    const act = activities.find(
      (a) => a.date === day.date && (a.type === "Ride" || a.type === "VirtualRide")
    );
    if (!act) continue;

    const actualMin = Math.round(act.movingTimeSec / 60);
    const compliancePct = day.durationMin > 0 ? Math.round((actualMin / day.durationMin) * 100) : null;
    const ifBasis = act.normalizedPower ?? act.avgWatts;
    const intensityFactor = ifBasis !== null && ftp > 0 ? Math.round((ifBasis / ftp) * 100) / 100 : null;
    const variabilityIndex =
      act.normalizedPower !== null && act.avgWatts !== null && act.avgWatts > 0
        ? Math.round((act.normalizedPower / act.avgWatts) * 100) / 100
        : null;

    const executionScore = computeExecutionScore({
      compliancePct,
      intensityFactor,
      plannedType: day.type,
      decoupling: act.decoupling,
      variabilityIndex,
    });
    if (executionScore === null) continue;

    out.push({ date: day.date, executionScore, plannedType: day.type, compliancePct, intensityFactor });
  }
  return out;
}

// Fresh entries override existing ones for the same date (recompute on each sync).
export function mergeScoreLog(existing: RideScoreEntry[], fresh: RideScoreEntry[]): RideScoreEntry[] {
  const byDate = new Map<string, RideScoreEntry>();
  for (const e of existing) byDate.set(e.date, e);
  for (const e of fresh) byDate.set(e.date, e);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_ENTRIES);
}
