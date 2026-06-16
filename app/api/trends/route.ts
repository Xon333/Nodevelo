import { NextResponse } from "next/server";
import {
  readAthleteProfile,
  readBlockHistory,
  readInterventionLog,
  readLastSync,
  readRollingBaselines,
  readScoreLog,
} from "@/lib/data-store";
import { buildAthleteModel, deriveInsights } from "@/lib/athlete-model";
import { summariseValidation } from "@/lib/intervention";
import { weightTrendFromWellness } from "@/lib/nutrition";

// GET assembles the long-term, second-brain-derived trends. It deliberately does
// NOT reproduce intervals.icu's raw PMC/power-curve charts — only signals that
// tie training execution to the athlete's own blocks and adaptation.
export async function GET() {
  const [sync, profile, history, baselines, scoreLog, interventionLog] = await Promise.all([
    readLastSync(),
    readAthleteProfile(),
    readBlockHistory(),
    readRollingBaselines(),
    readScoreLog(),
    readInterventionLog(),
  ]);

  const ftp = profile.performance.ftp;
  // Efficiency Factor = NP / avg HR — the standard aerobic-efficiency marker. Restrict
  // to steady endurance rides (~0.56–0.85 FTP) of at least 45 min so the trend compares
  // like-for-like; short rides and hard/easy days would make it noisy. NP (falling back
  // to avg power) keeps variable-terrain rides comparable. If FTP is unknown the band is
  // skipped and the duration floor still applies.
  const MIN_SEC = 45 * 60;
  const isEndurance = (w: number) => ftp <= 0 || (w / ftp >= 0.56 && w / ftp <= 0.85);

  const ef = (sync?.activities ?? [])
    .filter((a) => {
      if (a.type !== "Ride" && a.type !== "VirtualRide") return false;
      if (a.avgHr === null || a.avgHr <= 0) return false;
      if (a.movingTimeSec < MIN_SEC) return false;
      const power = a.normalizedPower ?? a.avgWatts;
      return power !== null && isEndurance(power);
    })
    .map((a) => {
      // Pull Pw:HR straight from Intervals.icu (icu_efficiency_factor); only fall back to
      // computing NP/HR if the field is missing on an activity.
      const power = (a.normalizedPower ?? a.avgWatts) as number;
      const value = a.efficiencyFactor ?? Math.round((power / (a.avgHr as number)) * 100) / 100;
      return { date: a.date, value: Math.round(value * 100) / 100 };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // CTL trajectory over the synced window.
  const ctl = (sync?.wellness ?? [])
    .filter((w) => w.ctl !== null)
    .map((w) => ({ date: w.date, value: Math.round((w.ctl as number) * 10) / 10 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Energy balance & weight aggregated by week (Monday-anchored): total ride burn
  // (≈kJ) and total intake for the week, against the week's MEDIAN bodyweight.
  // Weekly buckets smooth out day-to-day logging gaps; this fills in over a few weeks.
  const mondayOf = (dateStr: string): string => {
    const d = new Date(`${dateStr}T00:00:00Z`);
    const dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    return d.toISOString().slice(0, 10);
  };
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const wk = new Map<string, { burn: number; burnN: number; intake: number; intakeN: number; weights: number[] }>();
  const getW = (monday: string) => {
    let e = wk.get(monday);
    if (!e) {
      e = { burn: 0, burnN: 0, intake: 0, intakeN: 0, weights: [] };
      wk.set(monday, e);
    }
    return e;
  };
  for (const a of sync?.activities ?? []) {
    if ((a.type === "Ride" || a.type === "VirtualRide") && a.kj !== null) {
      const e = getW(mondayOf(a.date));
      e.burn += a.kj;
      e.burnN += 1;
    }
  }
  for (const w of sync?.wellness ?? []) {
    const e = getW(mondayOf(w.date));
    if (w.kcalConsumed !== null) {
      e.intake += w.kcalConsumed;
      e.intakeN += 1;
    }
    if (w.weightKg !== null) e.weights.push(w.weightKg);
  }
  const energy = [...wk.entries()]
    .map(([date, e]) => ({
      date,
      burnKcal: e.burnN > 0 ? Math.round(e.burn) : null,
      intakeKcal: e.intakeN > 0 ? Math.round(e.intake) : null,
      weightKg: e.weights.length > 0 ? Math.round(median(e.weights) * 10) / 10 : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Block timeline — newest first. Already accumulates across blocks.
  const blocks = history.map((h) => ({
    goal: h.goal,
    startDate: h.startDate,
    endDate: h.endDate,
    lengthWeeks: h.lengthWeeks,
    complianceByType: h.complianceByType ?? null,
    ctlGain: h.ctlGain ?? null,
    actualHours: h.actualHours ?? null,
    plannedHours: h.plannedHours ?? null,
    nextBlockSeeds: h.nextBlockSeeds ?? null,
  }));


  // Learned coaching insights from the execution history (the "second brain").
  const insights = deriveInsights(buildAthleteModel(scoreLog.entries));

  // Recent-7-day snapshot — the live-data intent relocated from the Profile page, where it
  // sits with the rest of the long-term tracking.
  const cutoff7 = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const recentRpes = (sync?.activities ?? [])
    .filter((a) => a.date >= cutoff7 && a.rpe !== null)
    .map((a) => a.rpe as number);
  const lastKcal = (sync?.wellness ?? [])
    .filter((w) => w.kcalConsumed !== null)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const latestWeight = (sync?.wellness ?? [])
    .filter((w) => w.weightKg !== null)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const recent = sync
    ? {
        latestWeightKg: latestWeight?.weightKg ?? null,
        weightTrend7Day: weightTrendFromWellness(sync.wellness),
        avgRpe7Day:
          recentRpes.length > 0
            ? Math.round((recentRpes.reduce((a, b) => a + b, 0) / recentRpes.length) * 10) / 10
            : null,
        lastKcalConsumed: lastKcal?.kcalConsumed ?? null,
      }
    : null;

  // Validation track record (the closed learning loop) + the most recent evaluated nudges.
  const validation = summariseValidation(interventionLog);
  const recentInterventions = interventionLog.records
    .filter((r) => r.outcome !== null)
    .sort((a, b) => (b.outcome as { evaluatedAt: string }).evaluatedAt.localeCompare((a.outcome as { evaluatedAt: string }).evaluatedAt))
    .slice(0, 6)
    .map((r) => ({
      dimension: r.dimension,
      title: r.title,
      firedAt: r.firedAt,
      verdict: r.outcome?.verdict ?? "inconclusive",
      execDelta: r.outcome?.execDelta ?? null,
      physDelta: r.outcome?.physDelta ?? null,
      physMetric: r.physMetric,
    }));

  return NextResponse.json({
    ef,
    ctl,
    energy,
    blocks,
    baselines,
    // Execution-quality metric excludes legacy (pre-first-block) rides — they remain stored
    // in the ledger as history, they just don't count toward the metric or the drift signal.
    scores: scoreLog.entries.filter((e) => !e.legacy),
    insights,
    recent,
    validation,
    recentInterventions,
    syncedAt: sync?.syncedAt ?? null,
  });
}
