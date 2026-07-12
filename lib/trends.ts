// Pure transforms for the Trends page's time-series. Extracted from the route so the
// data-quality rules (which rides count, which weeks show) are deterministic + unit-testable.

import type { ActivitySummary, NutritionSettings, WellnessEntry } from "./types";
import { addDaysIso } from "./date";

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
const ENDURANCE_MIN_SEC = 45 * 60;

// The like-for-like gate that makes an aerobic metric (Pw:HR / decoupling) comparable across rides:
// OUTDOOR (excludes indoor/virtual, whose Pw:HR is distorted), steady-endurance band (~0.56–0.85 FTP —
// hard/easy days aren't comparable), and ≥45 min. Shared by the Trends EF series and the athlete-state
// decoupling signal so both apply the SAME definition. Metric presence (avgHr for EF, decoupling for the
// state) is checked by each caller. When FTP is unknown the band is skipped (duration + outdoor still apply).
export function isSteadyEnduranceRide(
  a: { type: string; movingTimeSec: number; avgWatts: number | null; normalizedPower?: number | null },
  ftp: number
): boolean {
  if (a.type !== "Ride") return false;
  if (a.movingTimeSec < ENDURANCE_MIN_SEC) return false;
  const power = a.normalizedPower ?? a.avgWatts;
  if (power === null) return false;
  return ftp <= 0 || (power / ftp >= 0.56 && power / ftp <= 0.85);
}

export function efSeries(activities: ActivitySummary[], ftp: number): { date: string; value: number }[] {
  return activities
    .filter((a) => isSteadyEnduranceRide(a, ftp) && a.avgHr !== null && a.avgHr > 0)
    .map((a) => {
      const power = (a.normalizedPower ?? a.avgWatts) as number;
      const value = a.efficiencyFactor ?? Math.round((power / (a.avgHr as number)) * 100) / 100;
      return { date: a.date, value: Math.round(value * 100) / 100 };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Heart-rate recovery (HRRc) per ride — outdoor only, same environmental-confound rationale as
// isSteadyEnduranceRide (indoor/no wind cooling distorts HR-derived signals). No steady-endurance-band
// gate here (unlike efSeries): HRRc only ever populates on a ride with a qualifying hard effort, so its
// presence is already the qualifying signal — intervals.icu's own Z5 gate did the filtering upstream.
export function hrrcSeries(activities: ActivitySummary[]): { date: string; value: number }[] {
  return activities
    .filter((a) => a.type === "Ride" && a.hrrc !== null && a.hrrc > 0)
    .map((a) => ({ date: a.date, value: a.hrrc as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface WeeklyEnergyPoint {
  date: string; // Monday of the week
  burnKcal: number | null;
  intakeKcal: number | null;
  weightKg: number | null;
  // §6 energy balance — filled only when nutrition settings are supplied AND the week has enough
  // logged-intake days. Need is DAY-MATCHED: summed only over days whose intake was logged, so
  // under-logging withholds the ratio instead of faking a deficit.
  needKcal: number | null;
  ratio: number | null; // intakeKcal / needKcal, 2 dp
  loggedDays: number;
}

export const MIN_LOGGED_DAYS_FOR_BALANCE = 4; // a weekly verdict needs most of the week logged

export interface WeeklyEnergyBalance {
  weekOf: string;
  intakeKcal: number;
  needKcal: number;
  ratio: number;
  loggedDays: number;
}

// Energy balance & weight aggregated by week (Monday-anchored): total ride burn (≈kJ) and total
// intake for the week, against the week's MEDIAN bodyweight. The in-progress current week is
// dropped — its running totals are always misleadingly low until the week closes, so only
// COMPLETE weeks are shown (TRENDS-2). Day-level granularity is untouched in the synced data.
export function weeklyEnergy(
  activities: ActivitySummary[],
  wellness: WellnessEntry[],
  today: string,
  settings?: NutritionSettings | null
): WeeklyEnergyPoint[] {
  const currentMonday = mondayOf(today);
  // Burn for the NEED formula counts every activity carrying kJ (same convention as the EA proxy —
  // a strength session costs energy too); the chart's burn series stays rides-only as before.
  const needBurnByDate = new Map<string, number>();
  for (const a of activities) {
    if (a.kj === null) continue;
    needBurnByDate.set(a.date, (needBurnByDate.get(a.date) ?? 0) + a.kj);
  }
  const wk = new Map<string, { burn: number; burnN: number; intake: number; intakeN: number; weights: number[]; need: number; logged: number }>();
  const getW = (monday: string) => {
    let e = wk.get(monday);
    if (!e) {
      e = { burn: 0, burnN: 0, intake: 0, intakeN: 0, weights: [], need: 0, logged: 0 };
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
      // Day-matched need: the app's own daily-target formula for THIS day. Flat config buffer — the
      // live formula's weight-trend adjustment is a *current* steering signal, unknowable for past
      // weeks; ±150 kcal/day noise is inside the bands' coarseness.
      if (settings) {
        const dayBurn = needBurnByDate.get(w.date) ?? 0;
        e.need += dayBurn > 0 ? settings.baseCalories + dayBurn + settings.buffer : settings.restDayTarget;
        e.logged += 1;
      }
    }
    if (w.weightKg !== null) e.weights.push(w.weightKg);
  }
  return [...wk.entries()]
    .filter(([date]) => date < currentMonday) // complete weeks only
    .map(([date, e]) => {
      const hasBalance = settings != null && e.logged >= MIN_LOGGED_DAYS_FOR_BALANCE && e.need > 0;
      return {
        date,
        burnKcal: e.burnN > 0 ? Math.round(e.burn) : null,
        intakeKcal: e.intakeN > 0 ? Math.round(e.intake) : null,
        weightKg: e.weights.length > 0 ? Math.round(median(e.weights) * 10) / 10 : null,
        needKcal: hasBalance ? Math.round(e.need) : null,
        ratio: hasBalance ? Math.round((e.intake / e.need) * 100) / 100 : null,
        loggedDays: e.logged,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// The snapshot's slot wants exactly ONE honest number: the week that just closed. An older week is
// stale coaching context, so a missing/under-logged prior week withholds (null) rather than substitutes.
export function latestWeeklyBalance(points: WeeklyEnergyPoint[], today: string): WeeklyEnergyBalance | null {
  const priorMonday = addDaysIso(mondayOf(today), -7);
  const p = points.find((x) => x.date === priorMonday);
  return p && p.ratio !== null && p.needKcal !== null && p.intakeKcal !== null
    ? { weekOf: p.date, intakeKcal: p.intakeKcal, needKcal: p.needKcal, ratio: p.ratio, loggedDays: p.loggedDays }
    : null;
}
