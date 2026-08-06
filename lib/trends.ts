// Pure transforms for the Trends page's time-series. Extracted from the route so the
// data-quality rules (which rides count, which weeks show) are deterministic + unit-testable.

import type { ActivitySummary, WellnessEntry } from "./types";
import { addDaysIso } from "./date";
import { activeBurn, calculateDailyTarget, exerciseBurn, restingKcalPerHourOf, type ModelOrResolver } from "./nutrition";
import { isSteadyEnduranceRide } from "./aerobic";

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

// Efficiency Factor = NP / avg HR — the standard aerobic-efficiency marker. Restricted by
// isSteadyEnduranceRide (lib/aerobic.ts) so the trend compares like-for-like: outdoor only, >= 45 min,
// steady-endurance band, and low variability. Uses Intervals.icu's icu_efficiency_factor when present,
// falling back to NP/HR.

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
  // Every day this week with logged intake, regardless of whether that day's activity burn resolved —
  // deliberately never dropped (see the "excludes unknown-burn activity days from balance without
  // dropping their intake total" test): understating real logged intake because an unrelated activity's
  // burn didn't sync is the wrong direction for an athlete whose presenting problem is underfuelling.
  intakeKcal: number | null;
  // Rides only, and GROSS — the source active-burn figure, the same basis Strava/Intervals.icu report,
  // NOT the rest-netted `exerciseBurn` the need side uses. Genuinely kcal, matching the name: it is
  // charted against `intakeKcal` on one kcal axis, so the two must share a unit.
  burnKcal: number | null;
  weightKg: number | null;
  // §6 energy balance — filled only when a nutrition model is supplied AND the week has enough
  // logged-intake days. Need is DAY-MATCHED: summed only over days whose intake was logged AND whose
  // activity burn resolved, so under-logging or a sync gap withholds the ratio instead of faking a
  // deficit — this is why `needKcal` can legitimately span FEWER days than `intakeKcal` above.
  needKcal: number | null;
  // The intake actually paired with `needKcal` — same day-set, so `ratio` = balanceIntakeKcal / needKcal
  // exactly (review §2.8: this used to be undocumented and unexposed, and the UI fell back to
  // `intakeKcal` next to the ratio, which could show a numerator that didn't actually divide to it
  // whenever a week had an unresolved-burn day). `null` under the same `hasBalance` gate as `needKcal`/`ratio`.
  balanceIntakeKcal: number | null;
  ratio: number | null; // balanceIntakeKcal / needKcal, 2 dp
  loggedDays: number;
}

export const MIN_LOGGED_DAYS_FOR_BALANCE = 4; // a weekly verdict needs most of the week logged

export interface WeeklyEnergyBalance {
  weekOf: string;
  intakeKcal: number;
  // The intake actually paired with `needKcal`/`ratio` (same day-set) — see WeeklyEnergyPoint's
  // balanceIntakeKcal doc comment. Consumers pairing a number with `ratio`/`needKcal` in one sentence
  // must use THIS field, never `intakeKcal`, or the shown figures won't actually divide to the shown
  // ratio whenever the week had an unresolved-burn day (review §2.8).
  balanceIntakeKcal: number;
  needKcal: number;
  ratio: number;
  loggedDays: number;
}

// Energy balance & weight aggregated by week (Monday-anchored): total ride burn (kcal, gross) and
// total intake for the week, against the week's MEDIAN bodyweight. The in-progress current week is
// dropped — its running totals are always misleadingly low until the week closes, so only
// COMPLETE weeks are shown (TRENDS-2). Day-level granularity is untouched in the synced data.
export function weeklyEnergy(
  activities: ActivitySummary[],
  wellness: WellnessEntry[],
  today: string,
  modelOrResolver?: ModelOrResolver | null
): WeeklyEnergyPoint[] {
  const currentMonday = mondayOf(today);
  // Need-side burn counts every activity carrying an active-burn figure (D5) — a run, a hike and a gym
  // session all cost energy. The chart's separate `burn` series below stays rides-only, deliberately.
  // Netting rate for the need side, taken from the model itself so `k` and the burn added to it always
  // share one basis (see lib/nutrition.ts's exerciseBurn). Both day types share one rmr/basis, so
  // either side of a resolver gives the same rate.
  const restingKcalPerHour = modelOrResolver
    ? restingKcalPerHourOf(typeof modelOrResolver === "function" ? modelOrResolver(false) : modelOrResolver)
    : 0;
  const unresolvedBurnDates = new Set<string>();
  const needBurnByDate = new Map<string, number>();
  // Day-type classification stays on the SOURCE figure — a short session whose exercise cost nets to 0
  // is still a training day (same split as computeUnderfuelStreak / calibrateNeatByDayType).
  const grossBurnByDate = new Map<string, number>();
  for (const a of activities) {
    const gross = activeBurn(a);
    if (gross === null) {
      unresolvedBurnDates.add(a.date);
      continue;
    }
    grossBurnByDate.set(a.date, (grossBurnByDate.get(a.date) ?? 0) + gross.kcal);
    const net = exerciseBurn(a, restingKcalPerHour);
    if (net !== null) needBurnByDate.set(a.date, (needBurnByDate.get(a.date) ?? 0) + net.kcal);
  }
  const wk = new Map<string, { burn: number; burnN: number; intake: number; balanceIntake: number; intakeN: number; weights: number[]; need: number; logged: number }>();
  const getW = (monday: string) => {
    let e = wk.get(monday);
    if (!e) {
      e = { burn: 0, burnN: 0, intake: 0, balanceIntake: 0, intakeN: 0, weights: [], need: 0, logged: 0 };
      wk.set(monday, e);
    }
    return e;
  };
  for (const a of activities) {
    if (a.type !== "Ride" && a.type !== "VirtualRide") continue;
    // `activeBurn`, not a raw `a.kj` read. `burnKcal` below is plotted by Trends.tsx on a kcal-formatted
    // axis directly against the `intakeKcal` series, so summing kJ here put two different units on one
    // chart under one unit label. Going through the ONE energy accessor also stops a ride that synced
    // with `activeBurnKcal` and no `kj` from dropping out of the series entirely — the old `a.kj === null`
    // guard skipped it. GROSS, deliberately: this series answers "what did the riding cost", the
    // question every other tool answers too, and it is NOT the need-side figure (that one nets, above).
    const burn = activeBurn(a);
    if (burn === null) continue;
    const e = getW(mondayOf(a.date));
    e.burn += burn.kcal;
    e.burnN += 1;
  }
  for (const w of wellness) {
    const e = getW(mondayOf(w.date));
    if (w.kcalConsumed !== null) {
      e.intake += w.kcalConsumed;
      e.intakeN += 1;
      // Day-matched need: the app's own daily-target formula for THIS day.
      if (modelOrResolver && !unresolvedBurnDates.has(w.date)) {
        const dayBurn = needBurnByDate.get(w.date) ?? 0;
        const isRestDay = (grossBurnByDate.get(w.date) ?? 0) === 0;
        const model = typeof modelOrResolver === "function"
          ? modelOrResolver(isRestDay)
          : modelOrResolver;
        // One formula, with the day-type multiplier selected from this day's burn. Buffer is 0, not
        // `model.buffer`: the live weight-trend adjustment (resolveBuffer's output) is a CURRENT
        // steering signal, unknowable for a past week — but `model.buffer` is worse than not using it,
        // not a neutral fallback. It reads NutritionSettings.buffer, the setting the buffer-redesign
        // deprecated and froze (see resolveNutritionModel's `shared` object) — a stale, arbitrary
        // number from whenever the athlete last saved a nutrition-settings edit before the redesign,
        // carrying no meaning today. 0 (pure maintenance) is a stable, principled baseline instead of a
        // frozen artifact; ±250 kcal/day of buffer effect either way already sits inside the bands'
        // documented coarseness (review §2.8).
        e.need += calculateDailyTarget(dayBurn, model, 0, isRestDay).dailyTarget;
        e.balanceIntake += w.kcalConsumed;
        e.logged += 1;
      }
    }
    if (w.weightKg !== null) e.weights.push(w.weightKg);
  }
  return [...wk.entries()]
    .filter(([date]) => date < currentMonday) // complete weeks only
    .map(([date, e]) => {
      const hasBalance = modelOrResolver != null && e.logged >= MIN_LOGGED_DAYS_FOR_BALANCE && e.need > 0;
      return {
        date,
        burnKcal: e.burnN > 0 ? Math.round(e.burn) : null,
        intakeKcal: e.intakeN > 0 ? Math.round(e.intake) : null,
        weightKg: e.weights.length > 0 ? Math.round(median(e.weights) * 10) / 10 : null,
        needKcal: hasBalance ? Math.round(e.need) : null,
        balanceIntakeKcal: hasBalance ? Math.round(e.balanceIntake) : null,
        ratio: hasBalance ? Math.round((e.balanceIntake / e.need) * 100) / 100 : null,
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
  // balanceIntakeKcal is gated by the SAME hasBalance condition as ratio/needKcal in weeklyEnergy, so
  // it is non-null here whenever ratio/needKcal are — asserted, not re-checked, to keep one gate.
  return p && p.ratio !== null && p.needKcal !== null && p.intakeKcal !== null
    ? { weekOf: p.date, intakeKcal: p.intakeKcal, balanceIntakeKcal: p.balanceIntakeKcal as number, needKcal: p.needKcal, ratio: p.ratio, loggedDays: p.loggedDays }
    : null;
}
