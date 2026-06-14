// Deterministic daily readiness signal from TSB, ATL/CTL ratio, and HRV.
// Returns a "Build / Hold / Recover" level with a plain-English reason.

import type { FatigueAlert, FitnessMetrics, ReadinessSignal, WellnessEntry } from "./types";

export function computeFatigueAlert(fitness: FitnessMetrics): FatigueAlert {
  const { ctl, atl, tsb } = fitness;

  if (atl !== null && ctl !== null && ctl > 0 && atl / ctl > 1.5) {
    return {
      triggered: true,
      type: "atl_ctl_ratio",
      reason: `ATL/CTL ratio is ${(atl / ctl).toFixed(2)} — heavy fatigue load. Consider a recovery day.`,
    };
  }
  if (tsb !== null && tsb < -30) {
    return {
      triggered: true,
      type: "tsb",
      reason: `Form (TSB) is ${tsb} — significantly fatigued. Prioritise sleep and rest.`,
    };
  }
  return { triggered: false, type: "none", reason: null };
}

export function computeReadiness(
  fitness: FitnessMetrics,
  wellness: WellnessEntry[]
): ReadinessSignal {
  const { ctl, atl, tsb } = fitness;

  // Fatigue overrides everything.
  if (atl !== null && ctl !== null && ctl > 0 && atl / ctl > 1.5) {
    return { level: "Recover", reason: `ATL/CTL ${(atl / ctl).toFixed(2)} — excessive load, prioritise recovery` };
  }
  if (tsb !== null && tsb < -30) {
    return { level: "Recover", reason: `TSB ${tsb} — deep fatigue, rest or easy movement only` };
  }

  // HRV suppression vs 7-day average.
  const sorted = [...wellness]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((w) => w.hrv !== null) as Array<WellnessEntry & { hrv: number }>;
  if (sorted.length >= 3) {
    const latest = sorted[0].hrv;
    const avg7 = sorted.slice(0, 7).reduce((s, w) => s + w.hrv, 0) / Math.min(sorted.length, 7);
    if (latest < avg7 * 0.88) {
      return { level: "Hold", reason: `HRV ${Math.round(latest)} vs 7-day avg ${Math.round(avg7)} — signs of stress, hold intensity` };
    }
  }

  if (tsb === null) return { level: "Hold", reason: "No fitness data — sync to get readiness" };

  if (tsb > 10 && tsb <= 25) return { level: "Build", reason: `TSB ${tsb} — fresh and primed, push today's session` };
  if (tsb > 0 && tsb <= 10) return { level: "Build", reason: `TSB ${tsb} — slightly fresh, good conditions to train` };
  if (tsb > 25) return { level: "Hold", reason: `TSB ${tsb} — very fresh, may be tapering or underloaded` };
  if (tsb >= -15) return { level: "Hold", reason: `TSB ${tsb} — moderate load, stick to plan` };
  return { level: "Recover", reason: `TSB ${tsb} — accumulated fatigue, consider softening today` };
}

// Rolling 90-day averages from recent activities.
export function computeRollingBaselines(
  activities: Array<{
    date: string;
    trainingLoad: number | null;
    decoupling: number | null;
    avgCadence: number | null;
  }>,
  wellness: WellnessEntry[]
): {
  avgTss90d: number | null;
  avgDecoupling90d: number | null;
  avgCadence90d: number | null;
  avgCtl90d: number | null;
} {
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

  const recent = activities.filter((a) => a.date >= cutoff);

  const tssList = recent.map((a) => a.trainingLoad).filter((v): v is number => v !== null);
  const decoupList = recent.map((a) => a.decoupling).filter((v): v is number => v !== null);
  const cadList = recent.map((a) => a.avgCadence).filter((v): v is number => v !== null);

  const avg = (arr: number[]) => arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10 : null;

  const ctlList = wellness
    .filter((w) => w.date >= cutoff && w.ctl !== null)
    .map((w) => w.ctl as number);

  return {
    avgTss90d: avg(tssList),
    avgDecoupling90d: avg(decoupList),
    avgCadence90d: avg(cadList),
    avgCtl90d: avg(ctlList),
  };
}
