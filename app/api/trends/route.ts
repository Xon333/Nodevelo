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
  // Pa:HR is only comparable across like-intensity steady rides, so restrict to an
  // endurance band (~0.56–0.85 of FTP) — excludes recovery spins and hard days that
  // would make the efficiency trend noisy. If FTP is unknown, fall back to all rides.
  const isEndurance = (w: number) => ftp <= 0 || (w / ftp >= 0.56 && w / ftp <= 0.85);

  const paHr = (sync?.activities ?? [])
    .filter(
      (a) =>
        (a.type === "Ride" || a.type === "VirtualRide") &&
        a.avgWatts !== null &&
        a.avgHr !== null &&
        a.avgHr > 0 &&
        isEndurance(a.avgWatts)
    )
    .map((a) => ({ date: a.date, value: Math.round(((a.avgWatts as number) / (a.avgHr as number)) * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // CTL trajectory over the synced window.
  const ctl = (sync?.wellness ?? [])
    .filter((w) => w.ctl !== null)
    .map((w) => ({ date: w.date, value: Math.round((w.ctl as number) * 10) / 10 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Energy balance & weight per day (ride burn ≈ kJ, intake + weight from wellness).
  const energyMap = new Map<string, { burnKcal: number | null; intakeKcal: number | null; weightKg: number | null }>();
  const getE = (date: string) => {
    let e = energyMap.get(date);
    if (!e) {
      e = { burnKcal: null, intakeKcal: null, weightKg: null };
      energyMap.set(date, e);
    }
    return e;
  };
  for (const a of sync?.activities ?? []) {
    if ((a.type === "Ride" || a.type === "VirtualRide") && a.kj !== null) {
      const e = getE(a.date);
      e.burnKcal = (e.burnKcal ?? 0) + a.kj;
    }
  }
  for (const w of sync?.wellness ?? []) {
    const e = getE(w.date);
    if (w.kcalConsumed !== null) e.intakeKcal = w.kcalConsumed;
    if (w.weightKg !== null) e.weightKg = w.weightKg;
  }
  const energy = [...energyMap.entries()]
    .map(([date, e]) => ({ date, ...e }))
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
    paHr,
    ctl,
    energy,
    blocks,
    complianceByType,
    baselines,
    scores: scoreLog.entries,
    syncedAt: sync?.syncedAt ?? null,
  });
}
