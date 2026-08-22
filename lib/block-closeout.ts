// Phase 1 trust contract (review decisions #49–51): the ONE place block-closeout math lives.
// Pure and deterministic — no IO, no clock, no LLM. Compliance figures come ONLY from the frozen
// ledger (already resolveCompliance-capped by execution, INVARIANT 25); raw duration ratios are
// used exclusively to DETECT overshoot, never to grade it. Overshoot binds to the ride the ledger
// scored (INVARIANT 52's primary-ride rule), never "first activity on the date".
import { primaryRideOfDate } from "./intent-queue";
import { round1 } from "./stats";
import type {
  ActivitySummary,
  CloseoutEvidence,
  CloseoutTypeEvidence,
  CurrentBlock,
  RideScoreEntry,
  WorkoutType,
} from "./types";

export const CLOSEOUT_OVERSHOOT_RATIO = 1.25;

interface TypeAccumulator {
  type: WorkoutType;
  planned: number;
  scores: number[];
  compliances: number[];
  missed: number;
  overshootDays: string[];
}

export function buildCloseoutEvidence(
  block: CurrentBlock,
  entries: RideScoreEntry[],
  activities: ActivitySummary[],
  throughIso: string
): CloseoutEvidence {
  const acc = new Map<WorkoutType, TypeAccumulator>();
  for (const d of block.days) {
    if (d.durationMin <= 0 || d.date > throughIso) continue; // future days: excluded, never "missed"
    const t = acc.get(d.type) ?? { type: d.type, planned: 0, scores: [], compliances: [], missed: 0, overshootDays: [] };
    t.planned += 1;
    const row = entries.find((e) => e.planned && e.date === d.date);
    if (row && typeof row.executionScore === "number") {
      t.scores.push(row.executionScore);
      if (typeof row.compliancePct === "number") t.compliances.push(row.compliancePct);
      // INVARIANT 52: judge the ride the ledger actually scored.
      const scoredActivity = row.activityId
        ? activities.find((a) => a.id === row.activityId)
        : primaryRideOfDate(activities, d.date);
      if (scoredActivity && scoredActivity.movingTimeSec / 60 > d.durationMin * CLOSEOUT_OVERSHOOT_RATIO) {
        t.overshootDays.push(d.date);
      }
    } else {
      t.missed += 1;
    }
    acc.set(d.type, t);
  }

  const types = [...acc.values()];
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const allScores = types.flatMap((t) => t.scores);
  const allComps = types.flatMap((t) => t.compliances);

  return {
    perType: types.map(
      (t): CloseoutTypeEvidence => ({
        type: t.type,
        planned: t.planned,
        scored: t.scores.length,
        missed: t.missed,
        meanExecution: mean(t.scores) !== null ? round1(mean(t.scores) as number) : null,
        meanCompliancePct: mean(t.compliances) !== null ? Math.round(mean(t.compliances) as number) : null,
        overshootDays: t.overshootDays,
      })
    ),
    plannedSessions: types.reduce((s, t) => s + t.planned, 0),
    scoredSessions: allScores.length,
    missedSessions: types.reduce((s, t) => s + t.missed, 0),
    overshootSessions: types.reduce((s, t) => s + t.overshootDays.length, 0),
    overallMeanExecution: mean(allScores) !== null ? round1(mean(allScores) as number) : null,
    overallMeanCompliancePct: mean(allComps) !== null ? Math.round(mean(allComps) as number) : null,
  };
}

// Proposed next-block priorities. GATING RULES (each independently bars progression language):
// overshoot days on the type · unrecorded sessions on the type · mean execution < 6.
// Everything here is an observation templated from evidence — never coaching invention.
export function deriveCloseoutSeeds(
  evidence: CloseoutEvidence,
  ctlStart: number | null,
  ctlEnd: number | null,
  curveSeed: string | null
): string[] {
  const seeds: string[] = [];
  for (const t of evidence.perType) {
    if (t.scored === 0) continue;
    const overshoot = t.overshootDays.length > 0;
    const lowExec = (t.meanExecution ?? 0) < 6;
    if (!overshoot && t.missed === 0 && !lowExec && (t.meanCompliancePct ?? 0) >= 85) {
      seeds.push(
        `${t.type} sessions executed well (mean execution ${t.meanExecution}/10, completion ${t.meanCompliancePct}%) — evidence supports progressing ${t.type} load`
      );
    }
    if (overshoot) {
      seeds.push(
        `${t.type} ran past ${Math.round(CLOSEOUT_OVERSHOOT_RATIO * 100)}% of prescribed duration on ${t.overshootDays.length} day(s) (${t.overshootDays.join(", ")}) — treated as a data signal to review, not progression evidence`
      );
    }
    if (lowExec) {
      seeds.push(`${t.type} mean execution ${t.meanExecution}/10 — review session quality before adding load`);
    }
    if (t.missed > 0) {
      seeds.push(`${t.missed} scheduled ${t.type} session(s) have no recorded ride — account for them before adding ${t.type} load`);
    }
  }
  if (evidence.plannedSessions > 0 && evidence.scoredSessions === 0) {
    seeds.push(`Insufficient scored sessions this block (0/${evidence.plannedSessions}) — progression decisions need scored evidence`);
  }
  if (ctlStart !== null && ctlEnd !== null) {
    const gain = round1(ctlEnd - ctlStart);
    if (gain >= 10) seeds.push(`Strong CTL gain (+${gain}) across the block`);
    else if (gain <= 2) seeds.push(`Minimal CTL gain (+${gain}) — review session quality or effective volume`);
  }
  if (curveSeed) seeds.push(curveSeed);
  return seeds;
}
