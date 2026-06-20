// Deterministic daily readiness signal from TSB, ATL/CTL ratio, and HRV.
// Returns a "Build / Hold / Recover" level with a plain-English reason.

import type { AcwrResult, FatigueAlert, FitnessMetrics, IntensityDistribution, LoadRampAlert, ReadinessSignal, WellnessEntry } from "./types";
import { DEFAULT_ACWR_BANDS, type AcwrBands } from "./calibration";

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

// Week-over-week training-load ramp. Compares the trailing 7 days of TSS against
// the 7 days before that. The ~10% weekly progression guideline is a widely used
// injury-risk heuristic; a noise floor avoids firing on early-season ramps from a
// near-zero base.
export function computeLoadRamp(
  activities: Array<{ date: string; trainingLoad: number | null }>
): LoadRampAlert {
  const today = new Date().toISOString().slice(0, 10);
  const dayMs = 86_400_000;
  const iso = (offsetDays: number) => new Date(Date.now() - offsetDays * dayMs).toISOString().slice(0, 10);

  const thisStart = iso(6); // [today-6 .. today]
  const lastEnd = iso(7);
  const lastStart = iso(13); // [today-13 .. today-7]

  const sum = (from: string, to: string) =>
    Math.round(
      activities
        .filter((a) => a.date >= from && a.date <= to && a.trainingLoad !== null)
        .reduce((s, a) => s + (a.trainingLoad as number), 0)
    );

  const thisWeekTss = sum(thisStart, today);
  const lastWeekTss = sum(lastStart, lastEnd);

  const NOISE_FLOOR = 150; // ignore ramps off a trivial base
  if (lastWeekTss < NOISE_FLOOR) {
    return { triggered: false, level: "none", thisWeekTss, lastWeekTss, changePct: null, reason: null };
  }

  const changePct = Math.round(((thisWeekTss - lastWeekTss) / lastWeekTss) * 100);

  if (changePct > 30) {
    return {
      triggered: true,
      level: "high",
      thisWeekTss,
      lastWeekTss,
      changePct,
      reason: `Load jumped ${changePct}% over the previous 7 days (${thisWeekTss} vs ${lastWeekTss} TSS) — well past the ~10% safe ramp. High overreach/injury risk; ease the next day or two.`,
    };
  }
  if (changePct > 10) {
    return {
      triggered: true,
      level: "caution",
      thisWeekTss,
      lastWeekTss,
      changePct,
      reason: `Load up ${changePct}% on the previous 7 days (${thisWeekTss} vs ${lastWeekTss} TSS) — above the ~10% progressive-overload guideline. Watch recovery.`,
    };
  }

  return { triggered: false, level: "none", thisWeekTss, lastWeekTss, changePct, reason: null };
}

// Acute:chronic workload ratio — acute = avg daily TSS over the last 7 days, chronic =
// avg daily TSS over the last 28. The classic injury-risk signal: sweet spot ~0.8–1.3,
// >1.5 = spike/danger. Returns null until there's enough chronic base to be meaningful.
export function computeAcwr(
  activities: Array<{ date: string; trainingLoad: number | null }>,
  bands: AcwrBands = DEFAULT_ACWR_BANDS
): AcwrResult | null {
  const today = new Date().toISOString().slice(0, 10);
  const dayMs = 86_400_000;
  const iso = (offsetDays: number) => new Date(Date.now() - offsetDays * dayMs).toISOString().slice(0, 10);
  const sumFrom = (from: string) =>
    activities
      .filter((a) => a.date >= from && a.date <= today && a.trainingLoad !== null)
      .reduce((s, a) => s + (a.trainingLoad as number), 0);

  const acute = sumFrom(iso(6)) / 7;
  const chronic = sumFrom(iso(27)) / 28;
  if (chronic < 5) return null; // not enough chronic load to compute a stable ratio

  const ratio = Math.round((acute / chronic) * 100) / 100;
  const level =
    ratio > bands.dangerHigh ? "danger" : ratio >= bands.optimalHigh ? "high" : ratio >= bands.optimalLow ? "optimal" : "low";
  return { acute: Math.round(acute), chronic: Math.round(chronic), ratio, level };
}

// Polarization check: share of training TIME spent easy / moderate / hard over the window.
// Uses true time-in-zone from Intervals (Z1–2 easy, Z3 moderate, Z4+ hard) so a threshold
// session with a long Z2 warm-up still registers its hard work — bucketing a whole ride by
// its AVERAGE power hides the intensity (the average drifts down into "easy"). Falls back to
// average power only for rides with no per-zone data (e.g. no power meter). ~80% easy is the
// endurance-base target.
export function computeIntensityDistribution(
  activities: Array<{ date: string; movingTimeSec: number; avgWatts: number | null; normalizedPower?: number | null; powerZoneTimes?: number[] | null }>,
  ftp: number,
  days = 7
): IntensityDistribution | null {
  if (ftp <= 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  let easy = 0;
  let moderate = 0;
  let hard = 0;
  for (const a of activities) {
    if (a.date < from || a.date > today) continue;
    const z = a.powerZoneTimes;
    if (z && z.length >= 4 && z.some((t) => t > 0)) {
      easy += (z[0] ?? 0) + (z[1] ?? 0);
      moderate += z[2] ?? 0;
      hard += (z[3] ?? 0) + (z[4] ?? 0) + (z[5] ?? 0) + (z[6] ?? 0);
    } else if ((a.normalizedPower ?? a.avgWatts) !== null && a.movingTimeSec > 0) {
      // No per-zone data: classify by NP (not raw avg, which descents/coasting drag down).
      const r = (a.normalizedPower ?? (a.avgWatts as number)) / ftp;
      if (r < 0.75) easy += a.movingTimeSec;
      else if (r < 0.9) moderate += a.movingTimeSec;
      else hard += a.movingTimeSec;
    }
  }
  const total = easy + moderate + hard;
  if (total === 0) return null;
  return {
    easyPct: Math.round((easy / total) * 100),
    moderatePct: Math.round((moderate / total) * 100),
    hardPct: Math.round((hard / total) * 100),
  };
}

// Rolling 90-day averages from recent activities.
export function computeRollingBaselines(
  activities: Array<{
    date: string;
    trainingLoad: number | null;
    decoupling: number | null;
    avgCadence: number | null;
    movingTimeSec: number;
  }>,
  wellness: WellnessEntry[]
): {
  avgTss90d: number | null;
  avgDecoupling90d: number | null;
  avgCadence90d: number | null;
  avgCtl90d: number | null;
  avgWeeklyHours90d: number | null;
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

  // Mean weekly ride hours over the SAME 90-day window as the other baselines (total hours ÷ 90/7
  // weeks), so the Recent-Baselines card doesn't mix a 90d-rolling tile with an all-time one (MR-2).
  const totalHours90d = recent.reduce((s, a) => s + a.movingTimeSec, 0) / 3600;
  const avgWeeklyHours90d = recent.length ? Math.round((totalHours90d / (90 / 7)) * 10) / 10 : null;

  return {
    avgTss90d: avg(tssList),
    avgDecoupling90d: avg(decoupList),
    avgCadence90d: avg(cadList),
    avgCtl90d: avg(ctlList),
    avgWeeklyHours90d,
  };
}
