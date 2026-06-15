// Builds and merges the per-ride execution score log. Deterministic — uses the
// same execution-score logic as the daily analysis, but applied to every planned
// day of the active block that already has a matching ride.

import { computeExecutionScore } from "./execution-score";
import type { ActivitySummary, CurrentBlock, RideScoreEntry } from "./types";

const MAX_ENTRIES = 250;

// ftpForDate resolves the FTP that was in effect on a given ride date (physiologyAsOf),
// so each entry is scored against the right physiological context — never today's FTP.
export function buildRideScores(
  block: CurrentBlock,
  activities: ActivitySummary[],
  ftpForDate: (date: string) => number,
  today: string = new Date().toISOString().slice(0, 10)
): RideScoreEntry[] {
  const out: RideScoreEntry[] = [];
  for (const day of block.days) {
    if (day.durationMin <= 0 || day.date > today) continue;
    const act = activities.find(
      (a) => a.date === day.date && (a.type === "Ride" || a.type === "VirtualRide")
    );
    if (!act) continue;

    const ftp = ftpForDate(day.date);
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

    out.push({ date: day.date, executionScore, plannedType: day.type, compliancePct, intensityFactor, ftpUsed: ftp });
  }
  return out;
}

// The score log is an immutable historical ledger: once a date is scored it is frozen, so a
// later FTP change never rewrites the past. Existing entries win on a date collision; fresh
// entries only fill in dates not yet recorded.
export function mergeScoreLog(existing: RideScoreEntry[], fresh: RideScoreEntry[]): RideScoreEntry[] {
  const byDate = new Map<string, RideScoreEntry>();
  for (const e of fresh) byDate.set(e.date, e);
  for (const e of existing) byDate.set(e.date, e); // existing overrides fresh — immutable
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_ENTRIES);
}
