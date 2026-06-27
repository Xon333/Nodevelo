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
import { efSeries, mondayOf, weeklyEnergy } from "@/lib/trends";

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
  const today = new Date().toISOString().slice(0, 10);
  // Pw:HR efficiency-factor trend — outdoor, steady-endurance, ≥45-min rides only (lib/trends).
  const ef = efSeries(sync?.activities ?? [], ftp);

  // CTL trajectory over the synced window.
  const ctl = (sync?.wellness ?? [])
    .filter((w) => w.ctl !== null)
    .map((w) => ({ date: w.date, value: Math.round((w.ctl as number) * 10) / 10 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Energy balance & weight by week (Monday-anchored), COMPLETE weeks only — the in-progress
  // week's running totals are misleadingly low, so it's dropped (TRENDS-2). See lib/trends.
  const energy = weeklyEnergy(sync?.activities ?? [], sync?.wellness ?? [], today);

  // Weekly training volume (hours) — for the Trend Pulse "are you building or slipping?" bar.
  // Keeps the current (in-progress) week, which the Trend Pulse labels "this wk".
  const hoursByWeek = new Map<string, number>();
  for (const a of sync?.activities ?? []) {
    if (a.type !== "Ride" && a.type !== "VirtualRide") continue;
    hoursByWeek.set(mondayOf(a.date), (hoursByWeek.get(mondayOf(a.date)) ?? 0) + a.movingTimeSec);
  }
  const weeklyHours = [...hoursByWeek.entries()]
    .map(([date, sec]) => ({ date, hours: Math.round((sec / 3600) * 10) / 10 }))
    .filter((w) => w.hours > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12);

  // Recent time-in-zone (last 28d), seconds per power zone Z1..Z7 — for the polarization bar.
  const zoneCutoff = new Date(Date.now() - 27 * 86_400_000).toISOString().slice(0, 10);
  const zones = [0, 0, 0, 0, 0, 0, 0];
  for (const a of sync?.activities ?? []) {
    if (a.date < zoneCutoff || !a.powerZoneTimes) continue;
    for (let i = 0; i < Math.min(7, a.powerZoneTimes.length); i++) zones[i] += a.powerZoneTimes[i] ?? 0;
  }

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
  const model = buildAthleteModel(scoreLog.entries);
  const insights = deriveInsights(model);

  // Recent-7-day snapshot — the live-data intent relocated from the Profile page, where it
  // sits with the rest of the long-term tracking.
  const cutoff7 = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  // 7-day training load (sum of TSS) — an actionable "have I trained enough this week?" signal,
  // replacing the trivial 7-day average RPE (a single mixed-type RPE average says little).
  const load7Day = (sync?.activities ?? [])
    .filter((a) => a.date >= cutoff7)
    .reduce((s, a) => s + (a.trainingLoad ?? 0), 0);
  const lastKcal = (sync?.wellness ?? [])
    .filter((w) => w.kcalConsumed !== null)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const latestWeight = (sync?.wellness ?? [])
    .filter((w) => w.weightKg !== null)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  // w/kg @ threshold — a current snapshot (FTP now ÷ latest weight), not a 90-day rolling baseline, so it's
  // resolved here from the synced FTP + most recent weigh-in rather than stored in the rolling-baselines file.
  const weightKg = latestWeight?.weightKg ?? null;
  const wkgAtThreshold = ftp != null && weightKg != null && weightKg > 0 ? Math.round((ftp / weightKg) * 10) / 10 : null;
  const recent = sync
    ? {
        latestWeightKg: weightKg,
        weightTrend7Day: weightTrendFromWellness(sync.wellness),
        load7Day: load7Day > 0 ? Math.round(load7Day) : null,
        lastKcalConsumed: lastKcal?.kcalConsumed ?? null,
        wkgAtThreshold,
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
    // Execution-quality metric excludes legacy (pre-first-block) + compromised
    // (equipment/sickness) rides — kept in the ledger as history, just not counted in the metric.
    scores: scoreLog.entries.filter((e) => !e.legacy && !e.compromised),
    insights,
    recent,
    validation,
    recentInterventions,
    weeklyHours,
    zones,
    behaviour: { avgWeeklyHours: model.behaviour.weeklyHours, offPlanPct: model.behaviour.offPlanPct },
    syncedAt: sync?.syncedAt ?? null,
  });
}
