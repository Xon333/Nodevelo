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

// ---------- FTP-retest advisory (#4) — overdelivery → stale-low ONLY ----------
// Physiological asymmetry (locked design decision): with a CORRECT FTP, sustained riding above the
// band collapses completion — you blow up. Repeated above-band delivery AT HIGH COMPLETION is only
// possible if the real threshold sits above the configured one. The inverse does NOT hold
// (underdelivery is fatigue/illness/heat-confounded), so no "FTP too high" branch exists — by design.

// Population defaults, tuned low-false-positive (an advisory that cries wolf gets ignored). All five
// are a ROADMAP #2 calibration hook: per-athlete derivation (e.g. margin from the athlete's own IF
// variance) later overrides this object; the detector itself never changes.
export interface FtpRetestConfig {
  windowDays: number; // trailing window (~a training block + spillover)
  minSessions: number; // n gate — below it the signal is withheld (null), like other gated signals
  minCompletionPct: number; // a session must have been DELIVERED to count (compliancePct gate; the
  // resolveCompliance cap means ≥85 also implies executionScore ≥ 5 — blow-ups can't qualify)
  minOverFraction: number; // ≥ this share individually above their band top (tolerates one diluted outlier)
  minMeanOvershoot: number; // mean IF excess above the band top, as FTP fraction (noise floor ~2% FTP)
}
export const FTP_RETEST_DEFAULTS: FtpRetestConfig = {
  windowDays: 42,
  minSessions: 4,
  minCompletionPct: 85,
  minOverFraction: 0.75,
  minMeanOvershoot: 0.02,
};

export interface FtpRetestSignal {
  n: number; // qualifying FTP-anchored sessions in the window
  overCount: number; // how many individually exceeded their band top
  meanOvershootPct: number; // mean (IF − band top) across the n, as % of FTP
  windowDays: number;
  evidence: string; // deterministic human/LLM-readable line — a model may rephrase, never invent
}

// The execution-driven FTP-staleness read. Each entry is judged against the band that scored IT
// (population top + the entry's frozen calibration.ifBandOffset — ledger-reproducible), and only
// entries scored against the CURRENT ftp count (`ftpUsed === currentFtp`): the moment the athlete
// re-tests, old-FTP evidence stops counting and the window restarts — the flag can never nag
// "re-test" right after a re-test.
export function detectFtpRetest(
  entries: RideScoreEntry[],
  today: string,
  currentFtp: number | null,
  cfg: FtpRetestConfig = FTP_RETEST_DEFAULTS
): FtpRetestSignal | null {
  if (currentFtp === null || !Number.isFinite(currentFtp) || currentFtp <= 0) return null;
  const anchored = qualifying(entries, today, cfg.windowDays).filter(
    (e) =>
      e.plannedType !== null &&
      e.plannedType in FTP_ANCHORED_IF_BANDS &&
      e.intensityFactor !== null &&
      e.compliancePct !== null &&
      e.compliancePct >= cfg.minCompletionPct &&
      e.ftpUsed === currentFtp
  );
  if (anchored.length < cfg.minSessions) return null;
  const overshoots = anchored.map((e) => {
    const band = FTP_ANCHORED_IF_BANDS[e.plannedType as keyof typeof FTP_ANCHORED_IF_BANDS];
    return (e.intensityFactor as number) - (band.hi + (e.calibration?.ifBandOffset ?? 0));
  });
  const overCount = overshoots.filter((d) => d > 0).length;
  const meanOvershoot = overshoots.reduce((a, b) => a + b, 0) / overshoots.length;
  if (overCount / anchored.length < cfg.minOverFraction || meanOvershoot < cfg.minMeanOvershoot) return null;
  const meanOvershootPct = round1(meanOvershoot * 100);
  return {
    n: anchored.length,
    overCount,
    meanOvershootPct,
    windowDays: cfg.windowDays,
    evidence:
      `${overCount} of ${anchored.length} FTP-anchored quality sessions (Threshold/VO2max, last ${cfg.windowDays}d, ` +
      `≥${cfg.minCompletionPct}% completion) delivered IF above the FTP-derived target band — on average ` +
      `${meanOvershootPct}% of FTP over the band top. FTP ${currentFtp}W is likely set too low; re-test in ` +
      `Intervals.icu (the new value syncs back automatically).`,
  };
}
