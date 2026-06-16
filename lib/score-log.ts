// Builds and merges the per-ride execution score log. Deterministic — uses the same
// execution-score logic as the daily analysis, applied to EVERY ride in the synced window
// (not just planned days). Planned rides are scored on adherence/compliance; off-plan rides
// on intrinsic quality (decoupling, pacing) against an inferred type. Each entry records the
// FTP it used so the immutable ledger never re-shifts when FTP later changes.

import { computeExecutionScore } from "./execution-score";
import { inferWorkoutType } from "./ride-classify";
import type { ActivitySummary, BehaviourSummary, CurrentBlock, CurrentBlockDay, RideScoreEntry } from "./types";

const MAX_ENTRIES = 400; // ~6 months of all rides

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

function isRide(a: ActivitySummary): boolean {
  return a.type === "Ride" || a.type === "VirtualRide";
}

export function buildRideScores(
  block: CurrentBlock | null,
  activities: ActivitySummary[],
  ftpForDate: (date: string) => number,
  today: string = new Date().toISOString().slice(0, 10),
  // Marks where structured training begins (the first block's start). Off-plan rides BEFORE
  // it are still stored as history, but flagged `legacy` so they're excluded from the
  // execution-quality metric and the drift signal — there was no plan for them to be "off."
  // null = no block has ever existed, so every off-plan ride is legacy.
  offPlanFloor: string | null = null
): RideScoreEntry[] {
  // Prescribed sessions, by date (only days that actually plan a ride).
  const plannedByDate = new Map<string, CurrentBlockDay>();
  if (block) for (const d of block.days) if (d.durationMin > 0) plannedByDate.set(d.date, d);

  // One entry per date; if a date has two rides, keep the longer (the key session).
  const byDate = new Map<string, RideScoreEntry>();

  for (const act of activities) {
    if (act.date > today || !isRide(act)) continue;
    const actualMin = Math.round(act.movingTimeSec / 60);
    if (actualMin <= 0) continue;

    const ftp = ftpForDate(act.date);
    const ifBasis = act.normalizedPower ?? act.avgWatts;
    const intensityFactor = ifBasis !== null && ftp > 0 ? round2(ifBasis / ftp) : null;
    const variabilityIndex =
      act.normalizedPower !== null && act.avgWatts !== null && act.avgWatts > 0
        ? round2(act.normalizedPower / act.avgWatts)
        : null;

    const planned = plannedByDate.get(act.date);
    let entry: RideScoreEntry | null = null;

    if (planned) {
      const compliancePct = planned.durationMin > 0 ? Math.round((actualMin / planned.durationMin) * 100) : null;
      const executionScore = computeExecutionScore({
        compliancePct,
        intensityFactor,
        plannedType: planned.type,
        decoupling: act.decoupling,
        variabilityIndex,
      });
      if (executionScore !== null) {
        entry = {
          date: act.date,
          executionScore,
          plannedType: planned.type,
          inferredType: planned.type,
          planned: true,
          legacy: false,
          compliancePct,
          intensityFactor,
          ftpUsed: ftp,
          durationMin: actualMin,
          tss: act.trainingLoad,
        };
      }
    } else {
      // Off-plan ride — always stored as history, but flagged `legacy` if it predates the
      // first block (pre-structure), which keeps it out of the execution metric + drift.
      const isLegacy = offPlanFloor === null || act.date < offPlanFloor;
      const inferredType = inferWorkoutType(intensityFactor, actualMin);
      const executionScore = computeExecutionScore({
        compliancePct: null,
        intensityFactor,
        plannedType: inferredType,
        decoupling: act.decoupling,
        variabilityIndex,
        intrinsic: true,
      });
      if (executionScore !== null) {
        entry = {
          date: act.date,
          executionScore,
          plannedType: null,
          inferredType,
          planned: false,
          legacy: isLegacy,
          compliancePct: null,
          intensityFactor,
          ftpUsed: ftp,
          durationMin: actualMin,
          tss: act.trainingLoad,
        };
      }
    }

    if (!entry) continue;
    const prior = byDate.get(act.date);
    if (!prior || entry.durationMin > prior.durationMin) byDate.set(act.date, entry);
  }

  return [...byDate.values()];
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

// Complete-riding-behaviour signal from ALL logged rides (planned + off-plan).
export function summariseBehaviour(entries: RideScoreEntry[]): BehaviourSummary {
  const total = entries.length;
  const plannedRides = entries.filter((e) => e.planned).length;
  const unplannedRides = total - plannedRides;
  const offPlanPct = total > 0 ? Math.round((unplannedRides / total) * 100) : 0;

  const unplannedScores = entries.filter((e) => !e.planned).map((e) => e.executionScore);
  const unplannedAvgQuality = unplannedScores.length
    ? round1(unplannedScores.reduce((s, v) => s + v, 0) / unplannedScores.length)
    : null;

  let weeklyHours: number | null = null;
  if (total > 0) {
    const dates = entries.map((e) => e.date).sort();
    const spanDays = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000 + 1;
    const weeks = Math.max(1, spanDays / 7);
    const totalHours = entries.reduce((s, e) => s + e.durationMin, 0) / 60;
    weeklyHours = round1(totalHours / weeks);
  }

  return { totalRides: total, plannedRides, unplannedRides, offPlanPct, unplannedAvgQuality, weeklyHours };
}
