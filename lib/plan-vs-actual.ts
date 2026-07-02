// ROADMAP #4 (measurement half): the planned-vs-actual read over the immutable score ledger, and the
// execution-driven FTP-retest advisory derived from it. Pure + deterministic — no IO, no clock (the
// caller passes `today`), no LLM: any model downstream only ever REPHRASES the evidence string here.
// Advisory only: nothing in this module (or its consumers) writes FTP — physiology.json stays the
// synced source of truth; the athlete re-tests in Intervals.icu and the new value syncs back.

import { FTP_ANCHORED_IF_BANDS } from "./execution-score";
import { isoDaysAgo } from "./date";
import { round1, round2 } from "./stats";
import { WORKOUT_TYPES } from "./types";
import type { RideScoreEntry, WorkoutType } from "./types";

// The trainable slice of the ledger, windowed: executed-against-a-real-prescription entries only.
// legacy (pre-app — no plan to be "off") and compromised (equipment/sickness — must not teach) are
// excluded, matching the execution-metric filter used across the app. Window is (today−windowDays,
// today] — pure day-math off the passed local date (AGENTS.md: the module never reads the clock).
function qualifying(entries: RideScoreEntry[], today: string, windowDays: number): RideScoreEntry[] {
  const cutoff = isoDaysAgo(windowDays, Date.parse(today));
  return entries.filter((e) => e.planned && !e.legacy && !e.compromised && e.date > cutoff && e.date <= today);
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export interface TypePlanVsActual {
  type: WorkoutType;
  n: number; // qualifying planned sessions of this type in the window
  meanIf: number | null; // mean delivered whole-ride IF (over the entries that carry one)
  // The FTP-derived "prescribed intensity" for FTP-anchored types — the same sweet-spot band
  // computeExecutionScore awards +2 for (population values; per-entry calibration offsets shift the
  // DETECTOR's math below, not this display band — a ≤±0.08 display shift isn't worth a second path).
  targetIf: { lo: number; hi: number } | null;
  meanCompliancePct: number | null;
  meanExecution: number; // qualifying entries always carry an executionScore
}

// Per-session-type planned-vs-actual over the trailing window: what was prescribed (type + its IF
// band) vs what was delivered (mean IF, completion, execution). Types with no qualifying sessions are
// omitted; rows follow WORKOUT_TYPES order. Default 90d = the same "rolling 90 days" era the Trends
// baselines card speaks in.
export function aggregatePlanVsActual(entries: RideScoreEntry[], today: string, windowDays = 90): TypePlanVsActual[] {
  const byType = new Map<WorkoutType, RideScoreEntry[]>();
  for (const e of qualifying(entries, today, windowDays)) {
    if (!e.plannedType) continue; // planned entries always carry one; defensive
    const arr = byType.get(e.plannedType) ?? [];
    arr.push(e);
    byType.set(e.plannedType, arr);
  }
  return [...byType.entries()]
    .map(([type, es]) => {
      const ifMean = mean(es.map((e) => e.intensityFactor).filter((v): v is number => v !== null));
      const compMean = mean(es.map((e) => e.compliancePct).filter((v): v is number => v !== null));
      const band = type in FTP_ANCHORED_IF_BANDS ? FTP_ANCHORED_IF_BANDS[type as keyof typeof FTP_ANCHORED_IF_BANDS] : null;
      return {
        type,
        n: es.length,
        meanIf: ifMean !== null ? round2(ifMean) : null,
        targetIf: band ? { lo: band.lo, hi: band.hi } : null,
        meanCompliancePct: compMean !== null ? Math.round(compMean) : null,
        meanExecution: round1(es.reduce((s, e) => s + e.executionScore, 0) / es.length),
      };
    })
    .sort((a, b) => WORKOUT_TYPES.indexOf(a.type) - WORKOUT_TYPES.indexOf(b.type));
}
