// Pure transforms for the Trends page's time-series. Extracted from the route so the
// data-quality rules (which rides count, which weeks show) are deterministic + unit-testable.

import type { ActivitySummary, WellnessEntry } from "./types";

// Monday (UTC) of the ISO week containing `dateStr`, as YYYY-MM-DD.
export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Efficiency Factor = NP / avg HR — the standard aerobic-efficiency marker. Restricted so the
// trend compares like-for-like:
//   • OUTDOOR rides only — indoor/virtual rides (no wind cooling → cardiac drift, ERG-flattened
//     power) have a distorted Pw:HR and would corrupt the trend (TRENDS-1).
//   • steady endurance band (~0.56–0.85 FTP) — hard/easy days aren't comparable.
//   • ≥45 min — short rides don't yield a meaningful aerobic signal.
// Uses Intervals.icu's icu_efficiency_factor when present, falling back to NP/HR. If FTP is
// unknown the band is skipped and the duration floor still applies.
export function efSeries(activities: ActivitySummary[], ftp: number): { date: string; value: number }[] {
  const MIN_SEC = 45 * 60;
  const isEndurance = (w: number) => ftp <= 0 || (w / ftp >= 0.56 && w / ftp <= 0.85);
  return activities
    .filter((a) => {
      if (a.type !== "Ride") return false; // outdoor only — excludes VirtualRide (indoor)
      if (a.avgHr === null || a.avgHr <= 0) return false;
      if (a.movingTimeSec < MIN_SEC) return false;
      const power = a.normalizedPower ?? a.avgWatts;
      return power !== null && isEndurance(power);
    })
    .map((a) => {
      const power = (a.normalizedPower ?? a.avgWatts) as number;
      const value = a.efficiencyFactor ?? Math.round((power / (a.avgHr as number)) * 100) / 100;
      return { date: a.date, value: Math.round(value * 100) / 100 };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface WeeklyEnergyPoint {
  date: string; // Monday of the week
  burnKcal: number | null;
  intakeKcal: number | null;
  weightKg: number | null;
}

// Energy balance & weight aggregated by week (Monday-anchored): total ride burn (≈kJ) and total
// intake for the week, against the week's MEDIAN bodyweight. The in-progress current week is
// dropped — its running totals are always misleadingly low until the week closes, so only
// COMPLETE weeks are shown (TRENDS-2). Day-level granularity is untouched in the synced data.
export function weeklyEnergy(
  activities: ActivitySummary[],
  wellness: WellnessEntry[],
  today: string
): WeeklyEnergyPoint[] {
  const currentMonday = mondayOf(today);
  const wk = new Map<string, { burn: number; burnN: number; intake: number; intakeN: number; weights: number[] }>();
  const getW = (monday: string) => {
    let e = wk.get(monday);
    if (!e) {
      e = { burn: 0, burnN: 0, intake: 0, intakeN: 0, weights: [] };
      wk.set(monday, e);
    }
    return e;
  };
  for (const a of activities) {
    if (a.type !== "Ride" && a.type !== "VirtualRide") continue;
    if (a.kj === null) continue;
    const e = getW(mondayOf(a.date));
    e.burn += a.kj;
    e.burnN += 1;
  }
  for (const w of wellness) {
    const e = getW(mondayOf(w.date));
    if (w.kcalConsumed !== null) {
      e.intake += w.kcalConsumed;
      e.intakeN += 1;
    }
    if (w.weightKg !== null) e.weights.push(w.weightKg);
  }
  return [...wk.entries()]
    .filter(([date]) => date < currentMonday) // complete weeks only
    .map(([date, e]) => ({
      date,
      burnKcal: e.burnN > 0 ? Math.round(e.burn) : null,
      intakeKcal: e.intakeN > 0 ? Math.round(e.intake) : null,
      weightKg: e.weights.length > 0 ? Math.round(median(e.weights) * 10) / 10 : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
