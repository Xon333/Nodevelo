import { NextResponse } from "next/server";
import {
  readAthleteProfile,
  readBlockHistory,
  readLastSync,
  readRollingBaselines,
  readScoreLog,
} from "@/lib/data-store";

// GET assembles the long-term, second-brain-derived trends. It deliberately does
// NOT reproduce intervals.icu's raw PMC/power-curve charts — only signals that
// tie training execution to the athlete's own blocks and adaptation.
export async function GET() {
  const [sync, profile, history, baselines, scoreLog] = await Promise.all([
    readLastSync(),
    readAthleteProfile(),
    readBlockHistory(),
    readRollingBaselines(),
    readScoreLog(),
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
      const power = (a.normalizedPower ?? a.avgWatts) as number;
      return { date: a.date, value: Math.round((power / (a.avgHr as number)) * 100) / 100 };
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

  // Cumulative compliance by type, derived from the per-ride score log (which
  // backfills every matched planned day on each sync) rather than compliance-memory
  // (which only records today's ride at sync time and is therefore gappy).
  const compAgg = new Map<string, { sum: number; n: number }>();
  for (const e of scoreLog.entries) {
    if (e.compliancePct === null) continue;
    const a = compAgg.get(e.plannedType) ?? { sum: 0, n: 0 };
    a.sum += e.compliancePct;
    a.n += 1;
    compAgg.set(e.plannedType, a);
  }
  const complianceByType = [...compAgg.entries()]
    .map(([type, a]) => ({ type, avgCompliancePct: Math.round(a.sum / a.n), sessions: a.n }))
    .sort((a, b) => b.sessions - a.sessions);

  return NextResponse.json({
    ef,
    ctl,
    energy,
    blocks,
    complianceByType,
    baselines,
    scores: scoreLog.entries,
    syncedAt: sync?.syncedAt ?? null,
  });
}
