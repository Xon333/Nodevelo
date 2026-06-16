// The validation loop. When an insight drives a generated block it is recorded as an
// "intervention" with a baseline snapshot (per-dimension execution EWMA + a physiological
// marker). After a horizon it is re-evaluated: did acting on it actually move the needle?
// This turns asserted advice into measured advice, and the hit-rate feeds back as confidence.
//
// Pure + deterministic so it's testable; persistence lives in data-store.

import type {
  AthleteModel,
  Insight,
  InterventionLog,
  InterventionRecord,
  InterventionVerdict,
  SyncData,
  ValidationSummary,
} from "./types";
import { WORKOUT_TYPES } from "./types";

const HORIZON_DAYS = 28; // evaluate a block's interventions after ~4 weeks
const EPS_EXEC = 0.4; // execution-EWMA change that counts as real movement
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const isWorkoutDimension = (d: string): boolean => (WORKOUT_TYPES as string[]).includes(d);

// ---------- metric snapshots ----------

// Per-dimension execution quality (EWMA), the same number the model already tracks.
function execFor(model: AthleteModel, dimension: string): number | null {
  if (dimension === "Overall") return model.overallExecEwma || null;
  const t = model.byType.find((x) => x.type === dimension);
  return t ? t.execEwma : null;
}

function curveWatts(sync: SyncData, secs: number): number | null {
  const p = sync.powerCurve.find((pt) => pt.durationSec === secs);
  return p ? p.watts : null;
}

// Pw:HR (efficiency factor) over recent steady endurance rides — the FTP-independent aerobic
// marker. Median of the last ~6 weeks of ≥45-min rides that report an efficiency factor.
function currentPwHr(sync: SyncData): number | null {
  const cutoff = new Date(Date.now() - 42 * 86_400_000).toISOString().slice(0, 10);
  const efs = sync.activities
    .filter(
      (a) =>
        (a.type === "Ride" || a.type === "VirtualRide") &&
        a.date >= cutoff &&
        a.movingTimeSec >= 45 * 60 &&
        a.efficiencyFactor !== null
    )
    .map((a) => a.efficiencyFactor as number);
  return efs.length > 0 ? Math.round(median(efs) * 100) / 100 : null;
}

// Map a dimension to its physiological marker. All markers are "higher = better", so a
// positive delta always means improvement (direction-normalised).
export function physMarkerFor(dimension: string, sync: SyncData): { value: number | null; metric: string } {
  switch (dimension) {
    case "VO2max":
      return { value: curveWatts(sync, 300), metric: "5-min power" };
    case "Threshold":
      return { value: curveWatts(sync, 1200), metric: "20-min power" };
    case "SIT":
      return { value: curveWatts(sync, 60), metric: "1-min power" };
    default:
      return { value: currentPwHr(sync), metric: "Pw:HR" };
  }
}

// ---------- build (at block-write time) ----------

// Snapshot the insights that drove a block. Only physiology/execution dimensions (workout
// types + Overall) are validatable; behaviour nudges like "Structure" are skipped.
export function buildInterventions(
  insights: Insight[],
  model: AthleteModel,
  sync: SyncData | null,
  blockStartDate: string,
  firedAt: string
): InterventionRecord[] {
  return insights
    .filter((i) => i.dimension === "Overall" || isWorkoutDimension(i.dimension))
    .map((i) => {
      const phys = sync ? physMarkerFor(i.dimension, sync) : { value: null, metric: "Pw:HR" };
      return {
        id: `${firedAt}_${i.dimension}_${i.severity}`,
        firedAt,
        blockStartDate,
        dimension: i.dimension,
        severity: i.severity,
        title: i.title,
        horizonDays: HORIZON_DAYS,
        baselineExecEwma: execFor(model, i.dimension),
        baselinePhys: phys.value,
        physMetric: phys.metric,
        outcome: null,
      };
    });
}

// New records win only for ids not already present (a re-write of the same block on the same
// day shouldn't double-count); existing records are immutable once matured.
export function mergeInterventions(existing: InterventionRecord[], fresh: InterventionRecord[]): InterventionRecord[] {
  const byId = new Map<string, InterventionRecord>();
  for (const r of fresh) byId.set(r.id, r);
  for (const r of existing) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => a.firedAt.localeCompare(b.firedAt));
}

// ---------- evaluate (at sync time) ----------

function physThreshold(baseline: number): number {
  return Math.max(1, Math.abs(baseline) * 0.02); // 2% of the marker, floor 1
}

// Re-evaluate any matured, not-yet-judged interventions against the current model + sync.
export function validateInterventions(
  log: InterventionLog,
  model: AthleteModel,
  sync: SyncData | null,
  today: string = new Date().toISOString().slice(0, 10)
): { log: InterventionLog; changed: boolean } {
  let changed = false;
  const records = log.records.map((r) => {
    if (r.outcome !== null) return r;
    if (daysBetween(r.firedAt, today) < r.horizonDays) return r;

    const execNow = execFor(model, r.dimension);
    const physNow = sync ? physMarkerFor(r.dimension, sync).value : null;
    const execDelta = execNow !== null && r.baselineExecEwma !== null ? Math.round((execNow - r.baselineExecEwma) * 10) / 10 : null;
    const physDelta = physNow !== null && r.baselinePhys !== null ? Math.round((physNow - r.baselinePhys) * 100) / 100 : null;

    const improved =
      (execDelta !== null && execDelta > EPS_EXEC) ||
      (physDelta !== null && r.baselinePhys !== null && physDelta > physThreshold(r.baselinePhys));
    const worsened =
      (execDelta !== null && execDelta < -EPS_EXEC) ||
      (physDelta !== null && r.baselinePhys !== null && physDelta < -physThreshold(r.baselinePhys));

    const verdict: InterventionVerdict =
      execDelta === null && physDelta === null
        ? "inconclusive"
        : improved && !worsened
          ? "validated"
          : worsened && !improved
            ? "refuted"
            : "inconclusive";

    changed = true;
    return {
      ...r,
      outcome: { evaluatedAt: today, execNow, physNow, execDelta, physDelta, verdict },
    };
  });
  return { log: { records, updatedAt: changed ? new Date().toISOString() : log.updatedAt }, changed };
}

// ---------- summarise (fed back into generation as confidence) ----------

export function summariseValidation(log: InterventionLog): ValidationSummary {
  const byDim = new Map<string, { validated: number; refuted: number; inconclusive: number }>();
  let evaluated = 0;
  let pending = 0;
  for (const r of log.records) {
    if (!r.outcome) {
      pending += 1;
      continue;
    }
    evaluated += 1;
    const e = byDim.get(r.dimension) ?? { validated: 0, refuted: 0, inconclusive: 0 };
    e[r.outcome.verdict] += 1;
    byDim.set(r.dimension, e);
  }
  const byDimension = [...byDim.entries()].map(([dimension, c]) => {
    const decisive = c.validated + c.refuted;
    return {
      dimension,
      validated: c.validated,
      refuted: c.refuted,
      inconclusive: c.inconclusive,
      hitRate: decisive > 0 ? Math.round((c.validated / decisive) * 100) / 100 : null,
    };
  });
  return { byDimension, evaluated, pending };
}

// Compact directive block for the generation prompt — tells the model which past nudges
// actually worked, so it can lean into what's validated and reconsider what's been refuted.
export function validationToPromptBlock(summary: ValidationSummary): string {
  if (summary.evaluated === 0) return "";
  const lines = summary.byDimension
    .filter((d) => d.hitRate !== null)
    .map((d) => `- ${d.dimension}: past nudges worked ${Math.round((d.hitRate as number) * 100)}% of the time (${d.validated} validated / ${d.refuted} refuted)`);
  if (lines.length === 0) return "";
  return `\nINTERVENTION TRACK RECORD (which past coaching changes actually moved the needle — trust the validated dimensions, rethink the refuted)\n${lines.join("\n")}`;
}
